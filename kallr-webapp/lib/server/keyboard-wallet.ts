import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  buildQuoteRequest,
  buildSubmitRequest,
  FLASH_BASE_ASSETS,
  flashCancelMessage,
  type FlashOrderInput,
  type FlashSignatures,
} from "@kallr/integrations/definitive";
import { createPublicClient, createWalletClient, erc20Abi, type Hex, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { baseTransport } from "@/lib/chain";
import { parseTypedData } from "@/lib/typed-data";
import { flash } from "./flash";

/**
 * The Kall keyboard wallet: a wallet the server holds so the iPhone keyboard can place an order in
 * one tap, the way a card works once it's topped up. It's a demo hot wallet: the user funds it with a
 * little ETH on Base and swaps some to USDC, every order is capped (KALL_EXEC_MAX_USD), and only builds that carry
 * KALL_EXEC_TOKEN can spend from it. The same quote → approve → sign → submit as the desk, with the
 * server signing instead of a wallet prompt.
 */

const key = process.env.KALL_EXEC_PRIVATE_KEY;
const token = process.env.KALL_EXEC_TOKEN ?? "";
export const MAX_ORDER_USD = Number(process.env.KALL_EXEC_MAX_USD ?? "25");

const account = key && isHex(key) ? privateKeyToAccount(key) : null;
export const keyboardWalletAddress: Hex | null = account?.address ?? null;

const transport = process.env.BASE_RPC_URL ? http(process.env.BASE_RPC_URL) : baseTransport();
const publicClient = createPublicClient({ chain: base, transport });
const walletClient = account ? createWalletClient({ chain: base, transport, account }) : null;

/** The keyboard proves it's a Kall build with a bearer token; compared in constant time. */
export function authorized(req: Request): boolean {
  if (!token) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sign(json: string): Promise<Hex> {
  if (!account) throw new Error("The keyboard wallet isn't set up.");
  // biome-ignore lint/suspicious/noExplicitAny: typed data shapes come from Flash at runtime.
  return account.signTypedData(parseTypedData(json) as any);
}

async function send(tx: { to: string; data: string; value?: string }, failure: string) {
  if (!walletClient) throw new Error("The keyboard wallet isn't set up.");
  const hash = await walletClient.sendTransaction({ to: tx.to as Hex, data: tx.data as Hex, value: tx.value ? BigInt(tx.value) : undefined });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error(failure);
}

const approve = (tx: { to: string; data: string }) => send(tx, "The approval failed on Base.");

/** WETH the wallet already holds, e.g. from a wrap whose order then failed. */
async function wethBalance(): Promise<bigint> {
  if (!account) return 0n;
  return publicClient.readContract({ address: FLASH_BASE_ASSETS.ETH.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
}

/** Cancel an open order the keyboard wallet placed: a gasless signed message, no transaction. */
export async function cancelFromKeyboardWallet(orderId: string) {
  if (!account) throw new Error("The keyboard wallet isn't set up.");
  return flash.cancel(orderId, await account.signMessage({ message: flashCancelMessage(orderId) }));
}

// One order at a time, so approvals never race the wallet's nonce.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Quote, approve, sign and submit an order from the keyboard wallet. With dryRun it quotes and
 * signs but sends nothing: no approval, no order.
 */
export function placeFromKeyboardWallet(input: FlashOrderInput, dryRun = false) {
  const run = queue.then(async () => {
    const request = buildQuoteRequest(input);
    const quote = await flash.quote(request);
    const approvals: string[] = [];

    // Selling native ETH: wrap it first, unless WETH from an earlier try already covers it.
    const wrap = quote.wrap?.evmTx;
    if (wrap) {
      approvals.push("Wrap ETH to WETH");
      if (!dryRun && (await wethBalance()) < BigInt(wrap.value)) await send(wrap, "Wrapping ETH failed on Base.");
    }
    if (quote.evm.approveTx) {
      approvals.push(input.side === "sell" ? "WETH for this swap" : "USDC for this order");
      if (!dryRun) await approve(quote.evm.approveTx);
    }
    const signatures: FlashSignatures = { quoteId: quote.quoteId, userSignature: "0x", evmOrderTypedData: quote.evm.orderTypedData };
    if (quote.evm.permitTypedData) {
      signatures.evmPermitTypedData = quote.evm.permitTypedData;
      signatures.evmPermitSignature = await sign(quote.evm.permitTypedData);
    }
    const pair = quote.attachedBracket;
    if (pair?.evm.approveTx) {
      approvals.push("the take-profit / stop-loss");
      if (!dryRun) await approve(pair.evm.approveTx);
    }
    signatures.userSignature = await sign(quote.evm.orderTypedData);
    if (pair) {
      signatures.bracket = {
        userSignature: await sign(pair.evm.orderTypedData),
        salt: pair.salt,
        deadline: pair.deadline,
        signedMaxFromAmount: pair.signedMaxFromAmount,
      };
      if (pair.evm.permitTypedData) {
        signatures.bracket.evmPermitTypedData = pair.evm.permitTypedData;
        signatures.bracket.evmPermitSignature = await sign(pair.evm.permitTypedData);
      }
    }
    if (dryRun) return { dryRun: true as const, quote, approvals };
    const submitted = await flash.submit(buildSubmitRequest(request, signatures));
    return { dryRun: false as const, quote, approvals, submitted };
  });
  queue = run.catch(() => undefined);
  return run;
}
