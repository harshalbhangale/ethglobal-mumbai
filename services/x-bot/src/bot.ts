import { orderText, type ParsedOrder, parseOrder, withCallAsset } from "@aftermarkets/domain/order";
import {
  type CallerRecord,
  type CallPost,
  describeCall,
  describeRecord,
  type Observe,
  scoreCall,
} from "@aftermarkets/integrations/after-market";
import { heuristicSignal } from "@aftermarkets/integrations/signals";

/**
 * What @AfterMarkets says when it's tagged. Pure apart from the injected lookups, so it
 * runs the same from the mentions loop, the `try` command and tests.
 *
 * The bot never trades: a copy request gets a link to the desk, where the user reviews
 * the order and signs it in their own wallet.
 */

export type Tag = {
  /** The reply that tags @AfterMarkets. */
  postId: string;
  text: string;
  fromHandle: string;
  /** The post it replies to: the call. */
  parent: CallPost | null;
};

export type BotDeps = {
  botHandle: string;
  appUrl: string;
  nowSeconds: number;
  /** The caller's after market; null when their posts can't be read. */
  record: (handle: string) => Promise<CallerRecord | null>;
  observe?: Observe;
};

/** X counts every link as 23 characters. */
const LINK_LENGTH = 23;
export const MAX_REPLY = 280;

export function xLength(text: string) {
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(LINK_LENGTH))].length;
}

/** Drops the leading @handles X puts on replies, e.g. "@kol @AfterMarkets copy $2" → "copy $2". */
export function commandText(text: string) {
  return text.replace(/^(?:\s*@[A-Za-z0-9_]{1,15})+\s*/, "").trim();
}

const COMMAND = /^(copy|buy|long|sell|short)\b/i;

export { orderText };

export function deskLink(appUrl: string, o: ParsedOrder, parent: CallPost | null) {
  const q = new URLSearchParams({ order: orderText(o) });
  if (parent) {
    q.set("post", parent.postId);
    q.set("caller", parent.handle);
  }
  return `${appUrl.replace(/\/$/, "")}/app?${q}`;
}

function fit(lines: string[]) {
  const out = [...lines];
  // Drop optional lines from the end (never the first) until the reply fits.
  while (out.length > 1 && xLength(out.join("\n")) > MAX_REPLY) out.splice(out.length - 2, 1);
  const text = out.join("\n");
  return xLength(text) > MAX_REPLY ? `${[...text].slice(0, MAX_REPLY - 1).join("")}…` : text;
}

const HELP = 'Reply to a crypto call and tag me to see how the caller\'s calls played out. Add "copy $2, TP 10%, SL 5%" to trade it on Base.';

export async function replyFor(tag: Tag, deps: BotDeps): Promise<string | null> {
  if (tag.fromHandle.toLowerCase() === deps.botHandle.toLowerCase()) return null;
  const command = commandText(tag.text);

  if (COMMAND.test(command)) {
    const parsed = parseOrder(command);
    if (!parsed.ok) return fit([`@${tag.fromHandle} ${parsed.error}`, `Like: "copy $2, TP 10%, SL 5%"`]);
    const parentSignal = tag.parent
      ? heuristicSignal({ postId: tag.parent.postId, handle: tag.parent.handle, text: tag.parent.text })
      : null;
    // A post that shares a contract is about that contract; a ticker copy next to it could be a scam's bait.
    if (parentSignal?.tokenReferences.length)
      return fit([
        `@${tag.fromHandle} This post shares a contract address, so I won't copy a ticker trade from it.`,
        "Check the contract first: unverified tokens are where most rugs happen.",
      ]);
    const order = withCallAsset(parsed.order, parentSignal?.asset ?? null);
    const exits =
      order.takeProfitPct !== null || order.stopLossPct !== null
        ? `, ${[
            order.takeProfitPct !== null ? `TP +${+(order.takeProfitPct * 100).toFixed(2)}%` : "",
            order.stopLossPct !== null ? `SL −${+(order.stopLossPct * 100).toFixed(2)}%` : "",
          ]
            .filter(Boolean)
            .join(" / ")}`
        : "";
    const what = `${order.side} ${order.amountUsd === null ? `your ${order.asset}` : `$${order.amountUsd} of $${order.asset}`}${exits}`;
    const whose = tag.parent ? `@${tag.parent.handle}'s call` : "this";
    return fit([
      `@${tag.fromHandle} Copy ${whose}: ${what} on Base.`,
      `Review and sign in your wallet (nothing trades until you do): ${deskLink(deps.appUrl, order, tag.parent)}`,
    ]);
  }

  if (!tag.parent) return fit([`@${tag.fromHandle} ${HELP}`]);

  const [call, record] = await Promise.all([
    scoreCall(tag.parent, deps.nowSeconds, deps.observe),
    deps.record(tag.parent.handle).catch(() => null),
  ]);
  const lines = [`@${tag.fromHandle} After market for @${tag.parent.handle}:`];
  lines.push(record ? describeRecord(record) : "Track record unavailable right now");
  lines.push(call ? `This call: ${describeCall(call, deps.nowSeconds)}` : "This post isn't a call I can price");
  if (call) lines.push(`Copy it: reply "copy $2, TP 10%, SL 5%"`);
  lines.push("Priced at posting, scored at expiry. Not advice.");
  return fit(lines);
}
