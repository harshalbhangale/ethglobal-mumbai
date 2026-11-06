import "server-only";
import {
  buildQuoteRequest,
  buildSubmitRequest,
  FLASH_BASE_ASSETS,
  type FlashOrderInput,
  type FlashQuote,
  type FlashSignatures,
} from "@kallr/integrations/definitive";
import { createPublicClient, erc20Abi, type Hex, http } from "viem";
import { base } from "viem/chains";
import { flash } from "./flash";

/** A wallet the server signs with: the keyboard's hot wallet, or a user's Kall wallet through Privy. */
export type ServerSigner = {
  address: Hex;
  signTypedData: (json: string) => Promise<Hex>;
  /** Broadcasts a transaction on Base and returns its hash. */
  sendTransaction: (tx: { to: string; data: string; value?: string }) => Promise<Hex>;
};

export const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_RPC_URL),
});

/** WETH a wallet already holds, e.g. from a wrap whose order then failed. */
function wethBalance(address: Hex): Promise<bigint> {
  return baseClient.readContract({ address: FLASH_BASE_ASSETS.ETH.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

type PlaceOptions = { dryRun?: boolean; check?: (quote: FlashQuote) => void };
type DryRun = { dryRun: true; quote: FlashQuote; approvals: string[] };
type Placed = {
  dryRun: false;
  quote: FlashQuote;
  approvals: string[];
  txs: Array<{ label: string; hash: Hex }>;
  signatures: FlashSignatures;
  submitted: Awaited<ReturnType<typeof flash.submit>>;
};

/**
 * Quote, approve, sign and submit a Flash order with a server-side signer: the same steps as the
 * desk, with the server signing instead of a wallet prompt. `check` sees the quote before anything is
 * sent or signed (a per-order cap, say). With dryRun it quotes and signs but sends nothing.
 */
export function placeWithSigner(input: FlashOrderInput, signer: ServerSigner, opts: PlaceOptions & { dryRun: true }): Promise<DryRun>;
export function placeWithSigner(input: FlashOrderInput, signer: ServerSigner, opts?: PlaceOptions & { dryRun?: false }): Promise<Placed>;
export function placeWithSigner(input: FlashOrderInput, signer: ServerSigner, opts?: PlaceOptions): Promise<DryRun | Placed>;
export async function placeWithSigner(input: FlashOrderInput, signer: ServerSigner, opts: PlaceOptions = {}): Promise<DryRun | Placed> {
  const dryRun = opts.dryRun === true;
  const request = buildQuoteRequest(input);
  const quote = await flash.quote(request);
  opts.check?.(quote);
  const approvals: string[] = [];
  /** Transactions sent from the wallet (wrap, approvals), for Basescan links. */
  const txs: Array<{ label: string; hash: Hex }> = [];
  const send = async (label: string, tx: { to: string; data: string; value?: string }, failure: string) => {
    const hash = await signer.sendTransaction(tx);
    const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error(failure);
    txs.push({ label, hash });
  };

  // Selling native ETH: wrap it first, unless WETH from an earlier try already covers it.
  const wrap = quote.wrap?.evmTx;
  if (wrap) {
    approvals.push("Wrap ETH to WETH");
    if (!dryRun && (await wethBalance(signer.address)) < BigInt(wrap.value)) await send("Wrap ETH", wrap, "Wrapping ETH failed on Base.");
  }
  if (quote.evm.approveTx) {
    approvals.push(input.side === "sell" ? "WETH for this swap" : "USDC for this order");
    if (!dryRun) await send("Approve", quote.evm.approveTx, "The approval failed on Base.");
  }
  const signatures: FlashSignatures = { quoteId: quote.quoteId, userSignature: "0x", evmOrderTypedData: quote.evm.orderTypedData };
  if (quote.evm.permitTypedData) {
    signatures.evmPermitTypedData = quote.evm.permitTypedData;
    signatures.evmPermitSignature = await signer.signTypedData(quote.evm.permitTypedData);
  }
  const pair = quote.attachedBracket;
  if (pair?.evm.approveTx) {
    approvals.push("the take-profit / stop-loss");
    if (!dryRun) await send("Approve exits", pair.evm.approveTx, "The approval failed on Base.");
  }
  signatures.userSignature = await signer.signTypedData(quote.evm.orderTypedData);
  if (pair) {
    signatures.bracket = {
      userSignature: await signer.signTypedData(pair.evm.orderTypedData),
      salt: pair.salt,
      deadline: pair.deadline,
      signedMaxFromAmount: pair.signedMaxFromAmount,
    };
    if (pair.evm.permitTypedData) {
      signatures.bracket.evmPermitTypedData = pair.evm.permitTypedData;
      signatures.bracket.evmPermitSignature = await signer.signTypedData(pair.evm.permitTypedData);
    }
  }
  if (dryRun) return { dryRun: true as const, quote, approvals };
  const submitted = await flash.submit(buildSubmitRequest(request, signatures));
  return { dryRun: false as const, quote, approvals, txs, signatures, submitted };
}
