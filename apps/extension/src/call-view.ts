import { appOrigin } from "./config";
import { el, openDesk } from "./dom";
import { COPYABLE, deskUrl, PRESETS, pct, timeLeft, usd } from "./post";
import type { SeenCall } from "./card-metrics";

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
export type Answer = { call: ScoredCall | null; record: CallerRecord; calls?: SeenCall[] };

export type PostRef = { handle: string; postId: string };

export const postUrl = (p: PostRef) => `https://x.com/${p.handle}/status/${p.postId}`;

export function outcome(status: ScoredCall["status"], expiresAt: number, now = Math.floor(Date.now() / 1000)) {
  switch (status) {
    case "open":
      return timeLeft(expiresAt - now);
    case "hit":
      return "hit";
    case "miss":
      return "missed";
    case "flat":
      return "flat";
    default:
      return "unpriced";
  }
}

/** "This call: $ETH up from $2,418 → $2,455 +1.5% · 22h left" */
export function callLine(call: ScoredCall | null, asset: string) {
  if (!call) return el("div", { class: "line muted" }, `$${asset} call · pricing…`);
  if (call.entry === null) return el("div", { class: "line muted" }, `$${call.asset} ${call.direction} · no price at posting time`);
  const moved = call.returnBps === null ? null : el("span", { class: call.returnBps >= 0 ? "up" : "down" }, pct(call.returnBps));
  return el(
    "div",
    { class: "line" },
    `This call: $${call.asset} ${call.direction} from ${usd(call.entry)}`,
    call.last !== null ? ` → ${usd(call.last)} ` : " ",
    moved,
    call.status === "unpriced" ? "" : ` · ${outcome(call.status, call.expiresAt)}`,
  );
}

/** Copy presets plus Custom; each opens the desk prefilled, where the user reviews and signs. */
export function copyActions(asset: string, post: PostRef) {
  const actions = el("div", { class: "row" });
  if (!COPYABLE.has(asset)) {
    actions.append(el("span", { class: "muted" }, `$${asset} isn't tradable on Base yet`));
    return actions;
  }
  PRESETS.forEach((p, i) => {
    const b = el("button", { class: i === 0 ? "primary" : "", type: "button" }, `Copy $${p.usd} · TP ${p.tpPct}% SL ${p.slPct}%`);
    b.addEventListener("click", () => openDesk(deskUrl(appOrigin, asset, p, post)));
    actions.append(b);
  });
  const custom = el("button", { type: "button" }, "Custom");
  custom.addEventListener("click", () => openDesk(deskUrl(appOrigin, asset, null, post)));
  actions.append(custom);
  return actions;
}
