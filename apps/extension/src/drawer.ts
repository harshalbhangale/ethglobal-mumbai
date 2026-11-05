import { formatBps, type SeenCall } from "./card-metrics";
import { type Answer, copyActions, outcome, type PostRef, postUrl, type ScoredCall } from "./call-view";
import { el, safeLink, shadowHost } from "./dom";
import { usd } from "./post";
import { recordPanel } from "./record-panel";
import type { LivePrice } from "./ticker-price";
import { formatPrice } from "./ticker-price";

/**
 * Call check: a side drawer with the evidence behind a card. What the post says, how this call
 * has moved, the caller's recent calls and record, and the copy buttons. Renders from data the
 * card already has, so opening it costs no extra request.
 */

const row = (label: string, value: Node | string) => el("div", { class: "kv" }, el("span", {}, label), el("span", {}, value));
const section = (title: string, ...children: Array<Node | null | false>) =>
  el("section", { class: "section" }, el("h3", {}, title), ...children);

const HOUR = 3600;
export function horizonLabel(call: Pick<ScoredCall, "postedAt" | "expiresAt" | "horizonStated">) {
  if (call.postedAt === undefined) return "—";
  const hours = Math.round((call.expiresAt - call.postedAt) / HOUR);
  const text = hours >= 48 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
  return call.horizonStated ? `${text} (stated in the post)` : `${text} (default; none stated)`;
}

function thisCall(call: ScoredCall, live: LivePrice | null) {
  return section(
    "This call",
    row("Called", el("span", { class: call.direction === "up" ? "up" : "down" }, `$${call.asset} ${call.direction}`)),
    row("Horizon", horizonLabel(call)),
    row("Price at posting", call.entry === null ? "Unavailable" : usd(call.entry)),
    row(call.status === "open" ? "Price now" : "Price at expiry", call.last === null ? "Unavailable" : usd(call.last)),
    row(
      "Move in the called direction",
      call.returnBps === null ? "—" : el("span", { class: call.returnBps >= 0 ? "up" : "down" }, formatBps(call.returnBps)),
    ),
    row("Status", outcome(call.status, call.expiresAt)),
    live ? row("Live", `${formatPrice(live.price)} · ${live.source === "x" ? "X" : "Chainlink on Base"}`) : null,
    el("p", { class: "note" }, "Scored directional-return-v1: any move in the called direction by expiry is a hit."),
  );
}

export function recentCalls(handle: string, calls: SeenCall[], limit = 8) {
  if (!calls.length) return section("Recent calls", el("p", { class: "note" }, "None seen yet."));
  const list = el("ol", { class: "calls" });
  for (const c of calls.slice(0, limit)) {
    const move =
      c.returnBps === null ? el("span", { class: "muted" }, "—") : el("span", { class: c.returnBps >= 0 ? "up" : "down" }, formatBps(c.returnBps));
    const when = new Date(c.postedAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    list.append(
      el(
        "li",
        {},
        safeLink(postUrl({ handle, postId: c.postId }), `$${c.asset} ${c.direction} · ${when}`),
        el("span", {}, move, el("span", { class: "muted" }, ` ${outcome(c.status, c.expiresAt)}`)),
      ),
    );
  }
  return section(`Recent calls · ${Math.min(limit, calls.length)} of ${calls.length}`, list);
}

let current: { host: HTMLElement } | null = null;
let lastFocus: Element | null = null;

export function closeDrawer() {
  current?.host.remove();
  current = null;
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}

export function isDrawerOpen() {
  return current !== null;
}

export function openDrawer(input: { post: PostRef & { text: string }; answer: Answer; live: LivePrice | null }) {
  closeDrawer();
  lastFocus = document.activeElement;
  const { post, answer, live } = input;
  const shell = shadowHost("aftermarkets-drawer-host");
  shell.host.style.margin = "0";
  current = shell;

  const close = el("button", { type: "button", class: "close", "aria-label": "Close" }, "×");
  close.addEventListener("click", closeDrawer);
  const drawer = el(
    "aside",
    { class: "drawer", role: "dialog", "aria-modal": "false", "aria-label": `Call check for @${post.handle}` },
    el(
      "header",
      {},
      el("div", {}, el("strong", {}, "Call check"), el("small", { class: "muted" }, ` @${post.handle}`)),
      close,
    ),
    section("What the post says", el("blockquote", {}, post.text), safeLink(postUrl(post), "View post on X ↗")),
    answer.call ? thisCall(answer.call, live) : null,
    section("Caller's record", recordPanel(post.handle, answer.calls ?? [])),
    recentCalls(post.handle, answer.calls ?? []),
    answer.call ? section("Copy this call", copyActions(answer.call.asset, post)) : null,
    el(
      "p",
      { class: "note footer" },
      "Identity, call results and wallet returns are separate signals. Covers posts this browser has seen; deleted posts are missing. Not financial advice.",
    ),
  );
  drawer.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") closeDrawer();
  });
  shell.root.append(drawer);
  document.body.append(shell.host);
  close.focus();
}
