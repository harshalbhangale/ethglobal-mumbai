"use client";

import type { FlashOrder, FlashOrderInput, FlashQuote, FlashSignatures } from "@kallr/integrations/definitive";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { Hex } from "viem";
import { closedWithoutFill, fillFrom, type ReceiptEvent, receiptQuote } from "@kallr/domain/flash-receipt";
import { publicClient } from "./chain";
import { parseTypedData } from "./typed-data";

export type PlaceStep = "quoting" | "approving" | "approving-exits" | "signing" | "signing-exits" | "submitting";

export const stepLabel: Record<PlaceStep, string> = {
  quoting: "Getting a quote…",
  approving: "Approving this amount on Base…",
  "approving-exits": "Approving the take-profit / stop-loss…",
  signing: "Signing the order…",
  "signing-exits": "Signing the take-profit / stop-loss…",
  submitting: "Placing the order…",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

async function sendAndWait(provider: Eip1193, from: string, tx: { to: string; data: string }) {
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, data: tx.data }] })) as Hex;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The approval transaction failed on Base.");
}

const signTyped = (provider: Eip1193, from: string, typedDataJson: string) =>
  provider.request({ method: "eth_signTypedData_v4", params: [from, typedDataJson] }) as Promise<Hex>;

export async function quoteFlashOrder(order: FlashOrderInput) {
  return api<{ quote: FlashQuote; uniswapOut?: string | null }>("/api/flash/quote", { method: "POST", body: JSON.stringify({ order }) });
}

/** Which surface sent the user to the desk, and whose call they copied. Recorded on Arkiv. */
export type OrderContext = { source: "desk" | "extension" | "keyboard"; caller?: string | null };

/** What each step after the quote knows: Flash's quote and the wallet signing it. */
export type StepInfo = { quote: FlashQuote; from: string; uniswapOut?: string | null };

/**
 * A placement step as Flash receipt events: the quote row completes on the first step after it,
 * the signing row shows what is being signed, and submitting means the signature is done.
 */
export function receiptEvents(step: PlaceStep, info: StepInfo | undefined, side: "buy" | "sell"): ReceiptEvent[] {
  if (step === "quoting") return [{ type: "quoting" }];
  const quoted: ReceiptEvent[] = info ? [{ type: "quoted", quote: receiptQuote(info.quote, side, info.uniswapOut) }] : [];
  if (step === "submitting") return [...quoted, ...(info ? [{ type: "signed", wallet: info.from } as const] : []), { type: "sending" }];
  return [...quoted, { type: "signing", wallet: info?.from ?? null, note: stepLabel[step] }];
}

/** What a placed order leaves to verify: the order, the wallet and the EIP-712 signature over what it signed. */
export type Placed = {
  orderId: string;
  bracketStatus: string | null;
  from: string;
  signature: Hex;
  /** The order's EIP-712 typed data as Flash sent it, to check the signature against. */
  typedData: string;
};

/**
 * Quote → fund → sign → submit with the Kall wallet (Privy's embedded wallet, no pop-ups: the ticket
 * shows the order first). Every approval is sized to this order (forceMinimalAllowance).
 */
export async function placeFlashOrder(
  order: FlashOrderInput,
  wallet: ConnectedWallet,
  report: (step: PlaceStep, info?: StepInfo) => void,
  context: OrderContext = { source: "desk" },
): Promise<Placed> {
  report("quoting");
  const { quote, uniswapOut } = await quoteFlashOrder(order);
  const from = wallet.address;
  // Every later step carries the quote and the signing wallet, for the Flash receipt.
  const onStep = (step: PlaceStep) => report(step, { quote, from, uniswapOut: uniswapOut ?? null });

  await wallet.switchChain(8453);
  const provider = (await wallet.getEthereumProvider()) as Eip1193;

  if (quote.evm.approveTx) {
    onStep("approving");
    await sendAndWait(provider, from, quote.evm.approveTx);
  }
  const signatures: FlashSignatures = { quoteId: quote.quoteId, userSignature: "0x", evmOrderTypedData: quote.evm.orderTypedData };
  if (quote.evm.permitTypedData) {
    onStep("signing");
    signatures.evmPermitTypedData = quote.evm.permitTypedData;
    signatures.evmPermitSignature = await signTyped(provider, from, quote.evm.permitTypedData);
  }

  const pair = quote.attachedBracket;
  if (pair?.evm.approveTx) {
    onStep("approving-exits");
    await sendAndWait(provider, from, pair.evm.approveTx);
  }

  onStep("signing");
  signatures.userSignature = await signTyped(provider, from, quote.evm.orderTypedData);

  if (pair) {
    onStep("signing-exits");
    signatures.bracket = {
      userSignature: await signTyped(provider, from, pair.evm.orderTypedData),
      salt: pair.salt,
      deadline: pair.deadline,
      signedMaxFromAmount: pair.signedMaxFromAmount,
    };
    if (pair.evm.permitTypedData) {
      signatures.bracket.evmPermitTypedData = pair.evm.permitTypedData;
      signatures.bracket.evmPermitSignature = await signTyped(provider, from, pair.evm.permitTypedData);
    }
  }

  onStep("submitting");
  const res = await api<{ orderId: string; attachedBracket?: { status: string } | null }>("/api/flash/order", {
    method: "POST",
    body: JSON.stringify({ order, signatures, context }),
  });
  return {
    orderId: res.orderId,
    bracketStatus: res.attachedBracket?.status ?? null,
    from,
    signature: signatures.userSignature as Hex,
    typedData: quote.evm.orderTypedData,
  };
}

/** The fill's transaction on Base, once Flash has executed the order. */
export async function fillTransaction(orderId: string, funder: string): Promise<string | null> {
  const res = await fetch(`/api/flash/orders/${orderId}?funder=${funder}`).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { fills?: Array<{ transactionId: string | null }> } | null;
  return body?.fills?.find((f) => f.transactionId && /^0x[0-9a-fA-F]{64}$/.test(f.transactionId))?.transactionId ?? null;
}

/** One poll of an order: its fill (swap hash and amount received), or that it closed without one. */
export async function orderFill(orderId: string, funder: string, side: "buy" | "sell") {
  const res = await fetch(`/api/flash/orders/${orderId}?funder=${funder}`).catch(() => null);
  if (!res?.ok) return { fill: null, closed: false };
  const body = (await res.json().catch(() => null)) as Parameters<typeof fillFrom>[0];
  return { fill: fillFrom(body, side), closed: closedWithoutFill(body?.status) };
}

/**
 * Polls Flash until the order fills, feeding the receipt: "slow" after ~45s, "failed" if Flash closes
 * it unfilled. A resting order (limit, TWAP) is polled more slowly for up to ~10 minutes.
 */
export async function watchFill(
  o: { orderId: string; funder: string; side: "buy" | "sell"; symbol: string; resting: boolean },
  emit: (e: ReceiptEvent) => void,
  alive: () => boolean,
) {
  const every = o.resting ? 10_000 : 3_000;
  const tries = o.resting ? 60 : 40;
  for (let i = 0; i < tries && alive(); i++) {
    const { fill, closed } = await orderFill(o.orderId, o.funder, o.side);
    if (!alive()) return;
    if (fill) return emit({ type: "filled", tx: fill.tx, received: fill.received, symbol: o.symbol });
    if (closed) return emit({ type: "failed", message: "Definitive closed the order without filling it." });
    if (i === 15 && !o.resting) emit({ type: "slow" });
    await new Promise((r) => setTimeout(r, every));
  }
  if (alive() && !o.resting) emit({ type: "slow" });
}

/** The order's Arkiv trade record, once the server has written it. */
export async function arkivRecord(orderId: string, funder: string): Promise<string | null> {
  const res = await fetch(`/api/history?wallets=${funder}`).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { orders?: Array<{ orderId: string; arkivKey: string | null }> } | null;
  return body?.orders?.find((o) => o.orderId === orderId)?.arkivKey ?? null;
}

/**
 * Checks a signature against the EIP-712 data it signed: the address it recovers to. Null when the
 * typed data can't be read.
 */
export async function signer(typedDataJson: string, signature: Hex): Promise<string | null> {
  try {
    const { recoverTypedDataAddress } = await import("viem");
    return await recoverTypedDataAddress({ ...parseTypedData(typedDataJson), signature } as never);
  } catch {
    return null;
  }
}

export async function listFlashOrders(funder: string) {
  return (await api<{ orders: FlashOrder[] }>(`/api/flash/orders?funder=${funder}`)).orders;
}
