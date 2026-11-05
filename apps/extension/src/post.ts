/** Pure helpers for reading X posts and building copy links. No DOM or chrome APIs here. */

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** The handle and post ID from a post's timestamp link, e.g. /cryptorover/status/2110…. */
export function identityFromHref(href: string): { handle: string; postId: string } | null {
  let path: string;
  try {
    path = new URL(href, "https://x.com").pathname;
  } catch {
    return null;
  }
  const m = /^\/([^/]+)\/status\/([0-9]{1,30})\/?$/.exec(path);
  if (!m?.[1] || !m[2] || !HANDLE.test(m[1])) return null;
  return { handle: m[1].toLowerCase(), postId: m[2] };
}

/**
 * Cheap pre-check before asking the API: a cashtag, a coin we can price, or a contract
 * address (which gets token safety checks). The API makes the real decision.
 */
export function mightBeCall(text: string) {
  return (
    /\$[A-Za-z][A-Za-z0-9]{1,9}\b/.test(text) ||
    /\b(btc|bitcoin|eth|ether|ethereum|sol|solana|mon|monad)\b/i.test(text) ||
    /0x[0-9a-fA-F]{40}/.test(text)
  );
}

/** Assets the desk can trade on Base today. Other calls get the after market but no copy button. */
export const COPYABLE = new Set(["ETH", "BTC"]);

export type CopyPreset = { usd: number; tpPct: number; slPct: number };
export const PRESETS: CopyPreset[] = [
  { usd: 5, tpPct: 10, slPct: 5 },
  { usd: 20, tpPct: 10, slPct: 5 },
];

export function copyOrderText(asset: string, p: CopyPreset) {
  return `copy $${p.usd} of ${asset} tp ${p.tpPct}% sl ${p.slPct}%`;
}

/** Desk link that opens prefilled; the user reviews and signs there. */
export function deskUrl(origin: string, asset: string, p: CopyPreset | null, post: { handle: string; postId: string }) {
  return deskOrderUrl(origin, p ? copyOrderText(asset, p) : `copy $ of ${asset} tp 10% sl 5%`, post);
}

export function deskOrderUrl(origin: string, order: string, post: { handle: string; postId: string }) {
  const q = new URLSearchParams();
  q.set("order", order);
  q.set("post", post.postId);
  q.set("caller", post.handle);
  return `${origin}/app?${q}`;
}

/** Positive decimal string as typed, e.g. "25" or "0.5"; no exponents, no signs. */
export const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * The order text the desk parses (packages/domain order.ts) for what the card shows:
 *   buy  → "copy $25 of ETH tp 10% sl 5%"  (exits optional, both or neither)
 *   sell → "sell $25 of ETH"              (USD value; the desk sizes the ETH)
 * Null when the input can't make a valid order.
 */
export function cardOrderText(input: {
  side: "buy" | "sell";
  asset: string;
  usd: string;
  tpPct: number | null;
  slPct: number | null;
}): string | null {
  if (!DECIMAL.test(input.usd) || !(Number(input.usd) > 0)) return null;
  if (input.side === "sell") return `sell $${input.usd} of ${input.asset}`;
  if ((input.tpPct === null) !== (input.slPct === null)) return null;
  const exits = input.tpPct !== null && input.slPct !== null ? ` tp ${input.tpPct}% sl ${input.slPct}%` : "";
  return `copy $${input.usd} of ${input.asset}${exits}`;
}

/** Keeps the newest posts per caller, deduplicated, capped. */
export function mergeHistory<T extends { postId: string }>(existing: T[], incoming: T, cap = 40): T[] {
  const rest = existing.filter((p) => p.postId !== incoming.postId);
  return [incoming, ...rest].sort((a, b) => (BigInt(b.postId) > BigInt(a.postId) ? 1 : -1)).slice(0, cap);
}

export const pct = (bps: number) => `${bps >= 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(1)}%`;
export const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 4 })}`;

export function timeLeft(seconds: number) {
  if (seconds <= 0) return "scoring";
  if (seconds >= 2 * 86400) return `${Math.round(seconds / 86400)}d left`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h left`;
  return `${Math.max(1, Math.round(seconds / 60))}m left`;
}
