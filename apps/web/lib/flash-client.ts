"use client";

import type { FlashOrder, FlashOrderInput, FlashQuote, FlashSignatures } from "@aftermarkets/integrations/definitive";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { Hex } from "viem";
import { publicClient } from "./chain";

export type PlaceStep = "quoting" | "approving" | "approving-exits" | "signing" | "signing-exits" | "submitting";

export const stepLabel: Record<PlaceStep, string> = {
  quoting: "Getting a quote…",
  approving: "Approve the spend in your wallet…",
  "approving-exits": "Approve the take-profit / stop-loss in your wallet…",
  signing: "Sign the order in your wallet…",
  "signing-exits": "Sign the take-profit / stop-loss in your wallet…",
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
  return (await api<{ quote: FlashQuote }>("/api/flash/quote", { method: "POST", body: JSON.stringify({ order }) })).quote;
}

/**
 * Quote → fund → sign → submit with the user's own wallet. Every approval is sized to this order
 * (forceMinimalAllowance) and every signature is a wallet prompt the user can reject.
 */
export async function placeFlashOrder(
  order: FlashOrderInput,
  wallet: ConnectedWallet,
  onStep: (step: PlaceStep) => void,
): Promise<{ orderId: string; bracketStatus: string | null }> {
  onStep("quoting");
  const quote = await quoteFlashOrder(order);

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
    body: JSON.stringify({ order, signatures }),
  });
  return { orderId: res.orderId, bracketStatus: res.attachedBracket?.status ?? null };
}

export async function listFlashOrders(funder: string) {
  return (await api<{ orders: FlashOrder[] }>(`/api/flash/orders?funder=${funder}`)).orders;
}
