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
import type { CallRead } from "./server/ai";

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
  /** What the trade panel can buy for this call: ETH/BTC or a liquid, unflagged Base token. */
  trade: { token: string; symbol: string; price: number; logo: string | null } | null;
  /** The AI's one-line read of the message (coin, direction, timeframe), when the AI layer is on. */
  ai: { summary: string; symbol: string | null; direction: "up" | "down" | null; timeframe: string | null } | null;
  /** A shared contract that claims a ticker but isn't the main token with that ticker on Base. Blocks the trade. */
  fake: { claimed: string; contract: string; real: string } | null;
  /** An order the message or the typed line asks for, to fill the trade panel. */
  prefill: {
    kind: "swap" | "limit" | "twap" | null;
    usd: number | null;
    limitPct: number | null;
    twapMinutes: number | null;
    tpPct: number | null;
    slPct: number | null;
  } | null;
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
  /** The Base token a ticker means, or null when there's no liquid, unflagged match. */
  findTradeToken?: (symbol: string) => Promise<{ token: string; symbol: string; price: number; logo: string | null } | null>;
  /** The AI layer: reads coin, contract, direction and any order from a message. */
  readCall?: (text: string) => Promise<CallRead | null>;
};

/** Base contracts for the ETH and BTC keys, so "real" comparisons work for them too. */
const CORE_ADDRESS: Record<string, string> = {
  ETH: "0x4200000000000000000000000000000000000006",
  BTC: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
};

/** Worth sending to the AI: a post we fetched, a $CASHTAG, a contract, or a trade instruction. */
export function looksCrypto(text: string): boolean {
  return /\$[A-Za-z][A-Za-z0-9]{1,9}\b|0x[0-9a-fA-F]{40}|\b(buy|sell|ape|long|short|bucks|usd|dollars?)\b/i.test(text);
}

/** The first $CASHTAG in a post, for calls on coins we can't score (no price feed) but can still trade. */
export function firstCashtag(text: string): string | null {
  return /(?:^|[^A-Za-z0-9$])\$([A-Za-z][A-Za-z0-9]{1,9})\b/.exec(text)?.[1]?.toUpperCase() ?? null;
}

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
  return /\$\s*\d|\bmy\s+\$?[a-z]|\d+\s*(?:bucks|usd|dollars?)\b/i.test(candidate) ? candidate : null;
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
  const out: KeyboardResponse = {
    post: null,
    call: null,
    record: null,
    token: null,
    trade: null,
    ai: null,
    fake: null,
    prefill: null,
    order: null,
  };

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

  // 2. The AI read: a post we fetched, or a pasted message (Telegram, a tweet's text) that looks like crypto.
  const source = postText || (link ? "" : text);
  const read = source && deps.readCall && (postText || looksCrypto(source)) ? await deps.readCall(source).catch(() => null) : null;
  if (read) {
    out.ai = { summary: read.summary, symbol: read.symbol, direction: read.direction, timeframe: read.timeframe };
    if (read.order) out.prefill = read.order;
  }

  // 3. A contract address, in the post or pasted on its own: check the token, and whether it's the real one.
  const evm = tokenReferences(postText || text).find((r) => r.kind === "evm");
  let check: TokenCheck | null = null;
  if (evm) {
    check = await deps.checkToken(evm.address).catch(() => null);
    if (check) out.token = { address: check.address, symbol: check.symbol, ...tokenLine(check) };
  }
  const claimed = read?.symbol ?? firstCashtag(source) ?? check?.symbol?.toUpperCase() ?? null;
  if (evm && claimed && deps.findTradeToken) {
    const real = await deps.findTradeToken(claimed).catch(() => null);
    const realAddress = real ? (CORE_ADDRESS[real.token] ?? real.token) : null;
    if (real && realAddress) {
      if (realAddress.toLowerCase() === evm.address.toLowerCase()) {
        if (!check?.flags.some((f) => f.severity === "danger")) out.trade = real;
      } else {
        out.fake = { claimed, contract: evm.address, real: realAddress };
      }
    }
  }

  // 4. What the trade panel can buy. A shared contract only trades when it is the real token.
  const symbol = out.call?.asset ?? read?.symbol ?? (source ? firstCashtag(source) : null);
  if (symbol && !evm && deps.findTradeToken) {
    out.trade = await deps.findTradeToken(symbol).catch(() => null);
  }

  // 5. An order being typed: the AI reads plain words ("buy 20 bucks of degen if it dips 10%") into the panel.
  const typed = req.typed ? typedOrder(req.typed) : null;
  if (typed && deps.readCall) {
    const said = await deps.readCall(typed).catch(() => null);
    if (said?.order) out.prefill = said.order;
    if (said?.symbol && !out.trade && !evm && deps.findTradeToken) out.trade = await deps.findTradeToken(said.symbol).catch(() => null);
  }
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
