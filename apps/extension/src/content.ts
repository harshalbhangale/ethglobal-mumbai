import { appOrigin } from "./config";
import { el as h, openDesk, send, shadowHost } from "./dom";
import { COPYABLE, deskUrl, identityFromHref, mightBeCall, PRESETS, pct, timeLeft, usd } from "./post";
import { livePrice, priceLine } from "./ticker-price";
import { ALIASES, attachToXTicker } from "./x-ticker";

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
type Answer = { call: ScoredCall | null; record: Record };

const handled = new WeakMap<HTMLElement, string>();

function readPost(article: HTMLElement) {
  const link = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].find((a) => a.querySelector("time"));
  const id = link ? identityFromHref(link.getAttribute("href") ?? "") : null;
  const textNode = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const text = textNode?.innerText.trim();
  if (!id || !textNode || !text || text.length > 2000) return null;
  return { ...id, text, textNode };
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

  // X's own ticker card names the asset outright: offer a copy button there, call or not.
  const ticker = attachToXTicker(article, post);
  if (!ticker && !mightBeCall(post.text)) return;
  // The API classifies the post; only real, priceable calls get a card.
  const answer = await send<Answer>({ type: "after-market", handle: post.handle, post: { postId: post.postId, text: post.text } });
  if (!answer?.call) return;
  if (!article.isConnected || handled.get(article) !== key) return;
  const asset = answer.call.asset;

  const { host, root } = shadowHost("aftermarkets-host");
  const card = h("div", { class: "card" });
  root.append(card);

  const body = h("div", {});
  const actions = h("div", { class: "row" });
  if (COPYABLE.has(asset)) {
    PRESETS.forEach((p, i) => {
      const b = h("button", { class: i === 0 ? "primary" : "", type: "button" }, `Copy $${p.usd} · TP ${p.tpPct}% SL ${p.slPct}%`);
      b.addEventListener("click", () => openDesk(deskUrl(appOrigin, asset, p, post)));
      actions.append(b);
    });
    const custom = h("button", { type: "button" }, "Custom");
    custom.addEventListener("click", () => openDesk(deskUrl(appOrigin, asset, null, post)));
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
  void livePrice(article, asset, ALIASES[asset as keyof typeof ALIASES] ?? []).then((live) => body.append(priceLine(asset, live)));
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
