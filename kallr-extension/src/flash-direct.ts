import {
  type FlashOrderInput,
  flashOrderInputSchema,
  type FlashQuote,
  flashQuoteSchema,
  type FlashSignatures,
} from "@kallr/integrations/definitive";
import { send } from "./dom";
import { connect, ensureBase, sendAndWait, signTypedData } from "./wallet";

/**
 * Places a Definitive Flash order on Base from X, signed by the user's browser wallet: the same
 * quote → approve → sign → submit as the desk, through the app's /api/flash routes (the server
 * re-validates the order and holds the API key). Every approval and signature is a wallet prompt.
 */

/** Decimal string without exponent, truncated (never rounded up) to `dp` places. */
export function toDecimal(n: number, dp: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const factor = 10 ** dp;
  const fixed = (Math.floor(n * factor) / factor).toFixed(dp);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

const decimalsOf = (s: string) => (s.includes(".") ? (s.split(".")[1]?.length ?? 0) : 0);

export type CardOrder = {
  /** ETH / BTC, or any Base token by contract address (from the token picker). */
  asset: "ETH" | "BTC" | `0x${string}` | string;
  /** Token decimals, for a picked token; caps how many decimals a sell amount may have. */
  decimals?: number;
  side: "buy" | "sell";
  /** As typed: USDC on a buy, asset units on a sell. */
  amount: string;
  /** Percent from the live price; both or neither, buys only. */
  tpPct: number | null;
  slPct: number | null;
  /** Live USD price, for the exit trigger prices. */
  price: number;
  postId?: string;
  /** The caller whose post this card sits under, for the trades dashboard. */
  caller?: string;
  /** Sell the wallet's native ETH (wrapped to WETH first) instead of WETH it already holds. */
  native?: boolean;
};

/** The order the server will quote, or a reason it can't be placed. */
export function toFlashInput(o: CardOrder, funderAddress: string): { ok: true; input: FlashOrderInput } | { ok: false; error: string } {
  // USDC has 6 decimals; a sold token takes up to its own decimals, capped at 8 for sane input.
  const max = o.side === "buy" ? 6 : Math.min(o.decimals ?? 8, 8);
  if (decimalsOf(o.amount) > max) return { ok: false, error: `Use at most ${max} decimals.` };
  const input: FlashOrderInput = { asset: o.asset, side: o.side, qty: o.amount, orderType: "market", funderAddress };
  if (o.native && o.asset === "ETH" && o.side === "sell") input.native = true;
  if (o.side === "buy" && o.tpPct !== null && o.slPct !== null) {
    if (!(o.price > 0)) return { ok: false, error: "Waiting for a price to set the exits." };
    input.takeProfit = { notionalPrice: toDecimal(o.price * (1 + o.tpPct / 100), 2) };
    input.stopLoss = { notionalPrice: toDecimal(o.price * (1 - o.slPct / 100), 2) };
  }
  if (o.postId && /^[0-9]{1,30}$/.test(o.postId)) input.sourcePostId = o.postId;
  const parsed = flashOrderInputSchema.safeParse(input);
  return parsed.success ? { ok: true, input: parsed.data } : { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
}

export type Step = "connecting" | "quoting" | "wrapping" | "approving" | "approving-exits" | "signing" | "signing-exits" | "submitting";
export const STEP_LABEL: Record<Step, string> = {
  connecting: "Connect your wallet…",
  wrapping: "Wrap ETH to WETH in your wallet…",
  quoting: "Getting a Flash quote…",
  approving: "Approve the spend in your wallet (one-time, sized to this order)…",
  "approving-exits": "Approve the take-profit / stop-loss in your wallet…",
  signing: "Sign the order in your wallet…",
  "signing-exits": "Sign the take-profit / stop-loss in your wallet…",
  submitting: "Placing the order on Base…",
};

async function api<T>(type: "flash-quote" | "flash-order", payload: Record<string, unknown>): Promise<T> {
  const answer = await send<T & { failed?: string }>({ type, ...payload });
  if (!answer) throw new Error("Couldn't reach Kallr. Check the app is running, then try again.");
  if (answer.failed) throw new Error(answer.failed);
  return answer;
}

export async function placeOnX(o: CardOrder, onStep: (step: Step) => void) {
  onStep("connecting");
  const from = await connect();
  await ensureBase();
  const built = toFlashInput(o, from);
  if (!built.ok) throw new Error(built.error);
  const order = built.input;

  onStep("quoting");
  const raw = await api<{ quote: unknown }>("flash-quote", { order });
  const parsed = flashQuoteSchema.safeParse(raw.quote);
  if (!parsed.success) throw new Error("Flash returned a quote we couldn't read. Try again.");
  const quote: FlashQuote = parsed.data;

  // Selling native ETH: turn exactly the order amount into WETH first (one deposit transaction).
  if (quote.wrap?.evmTx) {
    onStep("wrapping");
    await sendAndWait(from, quote.wrap.evmTx);
  }
  if (quote.evm.approveTx) {
    onStep("approving");
    await sendAndWait(from, quote.evm.approveTx);
  }
  const signatures: FlashSignatures = { quoteId: quote.quoteId, userSignature: "0x", evmOrderTypedData: quote.evm.orderTypedData };
  if (quote.evm.permitTypedData) {
    onStep("signing");
    signatures.evmPermitTypedData = quote.evm.permitTypedData;
    signatures.evmPermitSignature = await signTypedData(from, quote.evm.permitTypedData);
  }
  const pair = quote.attachedBracket;
  if (pair?.evm.approveTx) {
    onStep("approving-exits");
    await sendAndWait(from, pair.evm.approveTx);
  }
  onStep("signing");
  signatures.userSignature = await signTypedData(from, quote.evm.orderTypedData);
  if (pair) {
    onStep("signing-exits");
    signatures.bracket = {
      userSignature: await signTypedData(from, pair.evm.orderTypedData),
      salt: pair.salt,
      deadline: pair.deadline,
      signedMaxFromAmount: pair.signedMaxFromAmount,
    };
    if (pair.evm.permitTypedData) {
      signatures.bracket.evmPermitTypedData = pair.evm.permitTypedData;
      signatures.bracket.evmPermitSignature = await signTypedData(from, pair.evm.permitTypedData);
    }
  }

  onStep("submitting");
  const res = await api<{ orderId?: string; attachedBracket?: { status: string } | null }>("flash-order", {
    order,
    signatures,
    context: { source: "extension", caller: o.caller ?? null },
  });
  if (!res.orderId) throw new Error("Flash didn't return an order ID.");
  return { orderId: res.orderId, from, exits: res.attachedBracket?.status ?? null, received: quote.to.amount };
}
