"use client";

import type { FlashOrder, FlashOrderInput, FlashQuote, FlashSignatures } from "@kallr/integrations/definitive";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { Hex } from "viem";
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
  return api<{ quote: FlashQuote }>("/api/flash/quote", { method: "POST", body: JSON.stringify({ order }) });
}

/** Which surface sent the user to the desk, and whose call they copied. Recorded on Arkiv. */
export type OrderContext = { source: "desk" | "extension" | "keyboard"; caller?: string | null };

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
  onStep: (step: PlaceStep) => void,
  context: OrderContext = { source: "desk" },
): Promise<Placed> {
  onStep("quoting");
  const { quote } = await quoteFlashOrder(order);

  await wallet.switchChain(8453);
  const provider = (await wallet.getEthereumProvider()) as Eip1193;
  const from = wallet.address;

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
