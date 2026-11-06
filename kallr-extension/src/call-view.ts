import type { SeenCall } from "./card-metrics";
import { timeLeft } from "./post";

/** The scored call the API returns for the post on screen. */
export type ScoredCall = {
  asset: string;
  direction: "up" | "down";
  postedAt?: number;
  expiresAt: number;
  horizonStated?: boolean;
  entry: number | null;
  last: number | null;
  status: "hit" | "miss" | "flat" | "open" | "unpriced";
  returnBps: number | null;
};
export type CallerRecord = { scored: number; hits: number; hitRate: number | null; medianReturnBps: number | null; open: number };
export type Answer = {
  call: ScoredCall | null;
  record: CallerRecord;
  calls?: SeenCall[];
  /** Safety checks on a contract the post shares (GoPlus + Dexscreener). */
  checks?: { token: import("./token-card").TokenCheck | null };
  /** This call's entity on Arkiv, for a direct explorer link; null until it's written. */
  arkivKey?: string | null;
};

export type PostRef = { handle: string; postId: string };

export const postUrl = (p: PostRef) => `https://x.com/${p.handle}/status/${p.postId}`;

export function outcome(status: ScoredCall["status"], expiresAt: number, now = Math.floor(Date.now() / 1000)) {
  switch (status) {
    case "open":
      return timeLeft(expiresAt - now);
    case "hit":
      return "moved their way";
    case "miss":
      return "moved against";
    case "flat":
      return "flat";
    default:
      return "unpriced";
  }
}

/** "3h ago", "2d ago" */
export function ago(seconds: number, now = Math.floor(Date.now() / 1000)) {
  const d = Math.max(0, now - seconds);
  if (d >= 2 * 86400) return `${Math.round(d / 86400)}d ago`;
  if (d >= 3600) return `${Math.round(d / 3600)}h ago`;
  return `${Math.max(1, Math.round(d / 60))}m ago`;
}
