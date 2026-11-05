import { type Answer, callLine, copyActions } from "./call-view";
import { el as h, send, shadowHost } from "./dom";
import { addFollowBadge } from "./creator-badge";
import { openDrawer } from "./drawer";
import { onFollowsChanged } from "./follows";
import { identityFromHref, mightBeCall } from "./post";
import { scanProfile } from "./profile";
import { recordPanel } from "./record-panel";
import { type LivePrice, livePrice, priceLine } from "./ticker-price";
import { ALIASES, attachToXTicker } from "./x-ticker";

/**
 * Content script on x.com: finds posts that are crypto calls and draws an AfterMarkets card
 * under them with the caller's record, this call's move since posting, and copy buttons that
 * open the desk to review and sign. It reads only what's on screen; no X API, no cookies.
 */

const handled = new WeakMap<HTMLElement, string>();

function readPost(article: HTMLElement) {
  const link = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].find((a) => a.querySelector("time"));
  const id = link ? identityFromHref(link.getAttribute("href") ?? "") : null;
  const textNode = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const text = textNode?.innerText.trim();
  if (!id || !textNode || !text || text.length > 2000) return null;
  return { ...id, text, textNode };
}

async function decorate(article: HTMLElement) {
  const post = readPost(article);
  if (!post) return;
  const key = `${post.handle}:${post.postId}`;
  if (handled.get(article) === key) return;
  handled.set(article, key);
  article.querySelector(".aftermarkets-host")?.remove();
  void addFollowBadge(article, post.handle);

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
  const actions = copyActions(asset, post);
  let live: LivePrice | null = null;
  const check = h("button", { type: "button" }, "Call check");
  check.addEventListener("click", () => openDrawer({ post, answer, live }));
  actions.append(check);
  card.append(
    h("div", { class: "top" }, h("span", { class: "brand" }, "AfterMarkets"), h("span", { class: "muted" }, "priced at posting · not advice")),
    body,
    actions,
  );
  body.append(recordPanel(post.handle, answer.calls ?? []), callLine(answer.call, asset));
  void livePrice(article, asset, ALIASES[asset as keyof typeof ALIASES] ?? []).then((value) => {
    live = value;
    body.append(priceLine(asset, value));
  });
  article.querySelector(".aftermarkets-host")?.remove();
  post.textNode.after(host);
}

const articles = () => document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');

function scan() {
  articles().forEach((a) => void decorate(a));
  void scanProfile();
}

// Following someone (here or in another tab) updates every byline chip on the page.
onFollowsChanged(() => {
  for (const article of articles()) {
    const post = readPost(article);
    if (post) void addFollowBadge(article, post.handle);
  }
});

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
