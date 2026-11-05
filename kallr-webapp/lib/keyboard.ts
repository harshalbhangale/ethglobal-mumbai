import { describeOrder, orderText, parseOrder, withCallAsset } from "@kallr/domain/order";
import {
  type CallPost,
  describeCall,
  describeRecord,
  type ScoredCall,
  summarize,
} from "@kallr/integrations/after-market";
import { parsePostUrl } from "@kallr/integrations/calls";
import type { TokenCheck } from "@kallr/integrations/safety-checks";
import { tokenReferences } from "@kallr/integrations/token-references";

/**
 * What the Kallr row on the Android keyboard shows. The keyboard sends what's on
 * the clipboard (or selected) and the line being typed; this answers with display-ready
 * lines so the Kotlin side stays a thin view. The keyboard never holds keys: an order
 * comes back as a desk link, and the user signs there.
 */

export type KeyboardRequest = {
  /** Clipboard or selected text: an X post link, a pasted call or a contract address. */
  text?: string;
  /** The line being typed, e.g. "copy $5 tp 10% sl 5%". */
  typed?: string;
  /** Posts this keyboard has looked up before, for the caller's record. */
  history?: CallPost[];
};

export type KeyboardResponse = {
  /** The post the link points at, when the clipboard holds an X post link. */
  post: CallPost | null;
  call: { line: string; status: ScoredCall["status"]; asset: string; direction: "up" | "down" } | null;
  record: { line: string; coverage: string } | null;
  token: { address: string; symbol: string | null; warnings: string[]; line: string } | null;
  order:
    | { ok: true; text: string; summary: string; tradable: boolean; deskUrl: string }
    | { ok: false; error: string }
    | null;
};

export type KeyboardDeps = {
  appOrigin: string;
  nowSeconds: number;
  fetchPost: (postId: string) => Promise<{ postId: string; authorHandle: string; text: string } | null>;
  score: (post: CallPost) => Promise<ScoredCall | null>;
  checkToken: (address: string) => Promise<TokenCheck | null>;
};

/** Assets the desk can trade on Base today (same as the extension). */
const TRADABLE = new Set(["ETH", "BTC"]);

const POST_LINK = /https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/[0-9]{1,20}/;
const ORDER_START = /\b(copy|buy|long|sell|short)\b/gi;

/** The order at the end of the typed line, from its last verb: "gm, copy $5 tp 10%" → "copy $5 tp 10%". */
export function typedOrder(typed: string): string | null {
  const line = typed.split("\n").pop() ?? "";
  const starts = [...line.matchAll(ORDER_START)];
  const last = starts.at(-1);
  if (last?.index === undefined) return null;
  const candidate = line.slice(last.index).trim();
  // A sentence that merely says "buy" isn't an order; one with a dollar amount or "my <asset>" is.
  return /\$\s*\d|\bmy\s+\$?[a-z]/i.test(candidate) ? candidate : null;
}

export function deskUrl(appOrigin: string, order: string, post: CallPost | null) {
  const q = new URLSearchParams({ order, src: "keyboard" });
  if (post) {
    q.set("post", post.postId);
    q.set("caller", post.handle);
  }
  return `${appOrigin.replace(/\/$/, "")}/app?${q}`;
}

export function tokenLine(t: TokenCheck): { warnings: string[]; line: string } {
  const warnings = t.flags.filter((f) => f.severity === "danger" || f.severity === "warning").map((f) => f.text);
  const name = t.symbol ? `$${t.symbol}` : `${t.address.slice(0, 6)}…${t.address.slice(-4)}`;
  const facts: string[] = [];
  if (t.liquidityUsd !== null) facts.push(`liquidity $${Math.round(t.liquidityUsd).toLocaleString("en-US")}`);
  if (t.ageDays !== null) facts.push(`${t.ageDays < 1 ? "<1" : Math.floor(t.ageDays)}d old`);
  const unavailable = t.sources.goplus === "unavailable" || t.sources.dexscreener === "unavailable";
  const verdict = warnings.length
    ? `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`
    : unavailable
      ? "checks partly unavailable"
      : "no red flags found";
  return { warnings, line: [`${name}: ${verdict}`, ...facts].join(" · ") };
}

export async function keyboardLookup(req: KeyboardRequest, deps: KeyboardDeps): Promise<KeyboardResponse> {
  const text = req.text?.trim() ?? "";
  const out: KeyboardResponse = { post: null, call: null, record: null, token: null, order: null };

  // 1. A copied X post link: read the post, score the call, and the caller's record.
  const link = POST_LINK.exec(text)?.[0];
  const target = link ? parsePostUrl(link) : null;
  let postText = "";
  if (target) {
    const post = await deps.fetchPost(target.postId).catch(() => null);
    if (post) {
      out.post = { postId: post.postId, handle: post.authorHandle, text: post.text.slice(0, 280) };
      postText = post.text;
      const current: CallPost = { postId: post.postId, handle: post.authorHandle, text: post.text };
      const call = await deps.score(current).catch(() => null);
      if (call) {
        out.call = {
          line: describeCall(call, deps.nowSeconds),
          status: call.status,
          asset: call.asset,
          direction: call.direction,
        };
      }
      const others = (req.history ?? []).filter((h) => h.handle === post.authorHandle && h.postId !== post.postId);
      const scored: ScoredCall[] = [];
      for (const h of others.slice(0, 20)) {
        const c = await deps.score(h).catch(() => null);
        if (c) scored.push(c);
      }
      if (call) scored.push(call);
      out.record = {
        line: `@${post.authorHandle}: ${describeRecord(summarize(post.authorHandle, scored))}`,
        coverage: "calls looked up on this keyboard",
      };
    }
  }

  // 2. A contract address, in the post or pasted on its own: check the token.
  const evm = tokenReferences(postText || text).find((r) => r.kind === "evm");
  if (evm) {
    const check = await deps.checkToken(evm.address).catch(() => null);
    if (check) out.token = { address: check.address, symbol: check.symbol, ...tokenLine(check) };
  }

  // 3. An order being typed: parse it and hand back a desk link to sign.
  const typed = req.typed ? typedOrder(req.typed) : null;
  if (typed) {
    const parsed = parseOrder(typed);
    if (!parsed.ok) {
      out.order = { ok: false, error: parsed.error };
    } else if (out.token) {
      // Same rule as the extension: never offer a ticker copy next to a shared contract.
      out.order = { ok: false, error: "There's a contract address here; check the token before trading it." };
    } else {
      const order = withCallAsset(parsed.order, out.call?.asset ?? null);
      const text = orderText(order);
      const tp = order.takeProfitPct === null ? "" : `, TP ${+(order.takeProfitPct * 100).toFixed(2)}%`;
      const sl = order.stopLossPct === null ? "" : `, SL ${+(order.stopLossPct * 100).toFixed(2)}%`;
      out.order = {
        ok: true,
        text,
        summary: `${describeOrder(order)}${tp}${sl}`,
        tradable: TRADABLE.has(order.asset),
        deskUrl: deskUrl(deps.appOrigin, text, out.post),
      };
    }
  }

  return out;
}
