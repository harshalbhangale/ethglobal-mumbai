import { COPYABLE, deskUrl, identityFromHref, mightBeCall, PRESETS, pct, timeLeft, usd } from "./post";

declare const AFTERMARKETS_APP_ORIGIN: string;

/**
 * Content script on x.com: finds posts that are crypto calls and draws an AfterMarkets card
 * under them with the caller's record, this call's move since posting, and copy buttons that
 * open the desk to review and sign. It reads only what's on screen; no X API, no cookies.
 */

type ScoredCall = {
  asset: string;
  direction: "up" | "down";
  expiresAt: number;
  entry: number | null;
  last: number | null;
  status: "hit" | "miss" | "flat" | "open" | "unpriced";
  returnBps: number | null;
};
type Record = { scored: number; hits: number; hitRate: number | null; medianReturnBps: number | null; open: number };
type Answer = { call: ScoredCall | null; record: Record } | { error: string } | null;

const CSS = `
:host { all: initial; display: block; margin-top: 10px; }
.card { font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; border-radius: 14px;
  border: 1px solid var(--rule); background: var(--bg); color: var(--ink); padding: 10px 12px; }
.top { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.brand { font-weight: 700; font-size: 13px; letter-spacing: -0.01em; }
.muted { color: var(--muted); font-size: 13px; }
.line { margin-top: 6px; }
.up { color: #12935f; } .down { color: #d93f45; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
button { font: 600 13px/1 inherit; font-family: inherit; border-radius: 999px; padding: 8px 12px; cursor: pointer;
  border: 1px solid var(--rule); background: transparent; color: var(--ink); }
button.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
button:hover { border-color: var(--ink); }
.light { --bg: #ffffff; --ink: #14213d; --muted: #5b6b82; --rule: #d9dfe8; }
.dark { --bg: #16181c; --ink: #e7e9ea; --muted: #8b98a5; --rule: #2f3336; }
`;

const handled = new WeakMap<HTMLElement, string>();

function isDark() {
  const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
  if (!m || m.length < 3) return matchMedia("(prefers-color-scheme: dark)").matches;
  return Number(m[0]) * 0.2126 + Number(m[1]) * 0.7152 + Number(m[2]) * 0.0722 < 128;
}

function h(tag: string, attrs: { [k: string]: string } = {}, ...children: (Node | string | null | false)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function readPost(article: HTMLElement) {
  const link = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].find((a) => a.querySelector("time"));
  const id = link ? identityFromHref(link.getAttribute("href") ?? "") : null;
  const textNode = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const text = textNode?.innerText.trim();
  if (!id || !textNode || !text || text.length > 2000) return null;
  return { ...id, text, textNode };
}

function send(message: unknown): Promise<Answer> {
  try {
    if (!chrome.runtime?.id) return Promise.resolve(null);
    return chrome.runtime.sendMessage(message).catch(() => null) as Promise<Answer>;
  } catch {
    return Promise.resolve(null); // extension reloaded under an open tab
  }
}

function openDesk(url: string) {
  window.open(url, "aftermarkets", "popup,width=480,height=820");
}

function callLine(call: ScoredCall | null, asset: string) {
  if (!call) return h("div", { class: "line muted" }, `$${asset} call · pricing…`);
  if (call.entry === null) return h("div", { class: "line muted" }, `$${call.asset} ${call.direction} · no price at posting time`);
  const moved = call.returnBps === null ? null : h("span", { class: call.returnBps >= 0 ? "up" : "down" }, pct(call.returnBps));
  const now = Math.floor(Date.now() / 1000);
  const tail =
    call.status === "open"
      ? ` · ${timeLeft(call.expiresAt - now)}`
      : call.status === "hit"
        ? " · hit"
        : call.status === "miss"
          ? " · missed"
          : call.status === "flat"
            ? " · flat"
            : "";
  return h(
    "div",
    { class: "line" },
    `This call: $${call.asset} ${call.direction} from ${usd(call.entry)}`,
    call.last !== null ? ` → ${usd(call.last)} ` : " ",
    moved,
    tail,
  );
}

function recordLine(handle: string, r: Record | null) {
  if (!r) return h("div", { class: "line muted" }, `@${handle}'s record · loading…`);
  if (!r.scored)
    return h("div", { class: "line muted" }, `@${handle}: no scored calls seen yet${r.open ? ` · ${r.open} open` : ""}`);
  const rate = Math.round((r.hitRate ?? 0) * 100);
  return h(
    "div",
    { class: "line" },
    `@${handle}: ${r.hits} of ${r.scored} calls hit (${rate}%)`,
    r.medianReturnBps !== null ? " · median " : "",
    r.medianReturnBps !== null ? h("span", { class: r.medianReturnBps >= 0 ? "up" : "down" }, pct(r.medianReturnBps)) : null,
    r.open ? ` · ${r.open} open` : "",
  );
}

async function decorate(article: HTMLElement) {
  const post = readPost(article);
  if (!post) return;
  const key = `${post.handle}:${post.postId}`;
  if (handled.get(article) === key) return;
  handled.set(article, key);
  article.querySelector(".aftermarkets-host")?.remove();

  if (!mightBeCall(post.text)) return;
  // The API classifies the post; only real, priceable calls get a card.
  const answer = await send({ type: "after-market", handle: post.handle, post: { postId: post.postId, text: post.text } });
  if (!answer || "error" in answer || !answer.call) return;
  if (!article.isConnected || handled.get(article) !== key) return;
  const asset = answer.call.asset;

  const host = h("div", { class: "aftermarkets-host" });
  host.addEventListener("click", (e) => e.stopPropagation()); // don't open the post
  const root = host.attachShadow({ mode: "open" });
  const card = h("div", { class: `card ${isDark() ? "dark" : "light"}` });
  root.append(h("style", {}, CSS), card);

  const body = h("div", {});
  const actions = h("div", { class: "row" });
  if (COPYABLE.has(asset)) {
    PRESETS.forEach((p, i) => {
      const b = h("button", { class: i === 0 ? "primary" : "", type: "button" }, `Copy $${p.usd} · TP ${p.tpPct}% SL ${p.slPct}%`);
      b.addEventListener("click", () => openDesk(deskUrl(AFTERMARKETS_APP_ORIGIN, asset, p, post)));
      actions.append(b);
    });
    const custom = h("button", { type: "button" }, "Custom");
    custom.addEventListener("click", () => openDesk(deskUrl(AFTERMARKETS_APP_ORIGIN, asset, null, post)));
    actions.append(custom);
  } else {
    actions.append(h("span", { class: "muted" }, `$${asset} isn't tradable on Base yet`));
  }
  card.append(
    h("div", { class: "top" }, h("span", { class: "brand" }, "AfterMarkets"), h("span", { class: "muted" }, "priced at posting · not advice")),
    body,
    actions,
  );
  body.append(recordLine(post.handle, answer.record), callLine(answer.call, asset));
  article.querySelector(".aftermarkets-host")?.remove();
  post.textNode.after(host);
}

function scan() {
  document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]').forEach((a) => void decorate(a));
}

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    scan();
  });
}).observe(document.body, { childList: true, subtree: true });
scan();
