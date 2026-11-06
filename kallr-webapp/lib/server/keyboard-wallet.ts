import "server-only";
import { timingSafeEqual } from "node:crypto";
import { flashCancelMessage, type FlashOrderInput } from "@kallr/integrations/definitive";
import { createWalletClient, encodeFunctionData, erc20Abi, type Hex, http, isHex, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { USDC_BASE, USDC_DECIMALS } from "@/lib/chain";
import { parseTypedData } from "@/lib/typed-data";
import { flash } from "./flash";
import { placeWithSigner, type ServerSigner } from "./flash-place";

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

const walletClient = account
  ? createWalletClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_RPC_URL), account })
  : null;

const signer: ServerSigner | null =
  account && walletClient
    ? {
        address: account.address,
        // biome-ignore lint/suspicious/noExplicitAny: typed data shapes come from Flash at runtime.
        signTypedData: (json) => account.signTypedData(parseTypedData(json) as any),
        sendTransaction: (tx) => walletClient.sendTransaction({ to: tx.to as Hex, data: tx.data as Hex, value: tx.value ? BigInt(tx.value) : undefined }),
      }
    : null;

/** The keyboard proves it's a Kall build with a bearer token; compared in constant time. */
export function authorized(req: Request): boolean {
  if (!token) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
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
  const run = queue.then(() => {
    if (!signer) throw new Error("The keyboard wallet isn't set up.");
    return placeWithSigner(input, signer, { dryRun });
  });
  queue = run.catch(() => undefined);
  return run;
}

export type Withdrawal = { asset: "ETH" | "USDC"; amount: string; to: Hex };

/**
 * Send ETH or USDC from the keyboard wallet to an address the user typed: the way their money comes back
 * out. Runs in the same queue as orders so nonces never race. Resolves to the transaction hash.
 */
export function withdrawFromKeyboardWallet(w: Withdrawal): Promise<Hex> {
  const run = queue.then(() => {
    if (!walletClient) throw new Error("The keyboard wallet isn't set up.");
    if (w.asset === "ETH") return walletClient.sendTransaction({ to: w.to, value: parseEther(w.amount) });
    return walletClient.sendTransaction({
      to: USDC_BASE,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [w.to, parseUnits(w.amount, USDC_DECIMALS)] }),
    });
  });
  queue = run.catch(() => undefined);
  return run;
}
