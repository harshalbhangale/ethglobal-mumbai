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
 * Cheap pre-check before asking the API: a cashtag or a coin we can price. The API's
 * classifier makes the real call/not-a-call decision.
 */
export function mightBeCall(text: string) {
  return /\$[A-Za-z][A-Za-z0-9]{1,9}\b/.test(text) || /\b(btc|bitcoin|eth|ether|ethereum|sol|solana|mon|monad)\b/i.test(text);
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
  const q = new URLSearchParams();
  q.set("order", p ? copyOrderText(asset, p) : `copy $ of ${asset} tp 10% sl 5%`);
  q.set("post", post.postId);
  q.set("caller", post.handle);
  return `${origin}/app?${q}`;
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
