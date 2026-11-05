import type { Answer } from "./call-view";
import { addFollowBadge } from "./creator-badge";
import { el, send, shadowHost } from "./dom";
import { flashCard } from "./flash-card";
import { identityFromHref, mightBeCall } from "./post";
import { TOKEN_CARD_CSS, tokenCheckCard } from "./token-card";
import { findXTicker, mountTickerButton } from "./x-ticker";

/**
 * One card per post: a classified call gets the full card under the post text; a
 * post that only shows X's ticker card gets a "⇄ Buy" button in that card, opening our card
 * attached beneath it. When both apply, the button opens the call's card.
 */

const handled = new WeakMap<HTMLElement, string>();

export function readPost(article: HTMLElement) {
  const link = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].find((a) => a.querySelector("time"));
  const id = link ? identityFromHref(link.getAttribute("href") ?? "") : null;
  const textNode = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const text = textNode?.innerText.trim();
  if (!id || !textNode || !text || text.length > 2000) return null;
  return { ...id, text, textNode };
}

export async function decorate(article: HTMLElement) {
  const post = readPost(article);
  if (!post) return;
  const key = `${post.handle}:${post.postId}`;
  if (handled.get(article) === key) {
    // X re-renders its ticker card's contents; put the button back if it was dropped.
    const ticker = findXTicker(article);
    const open = openers.get(article);
    if (ticker && open) mountTickerButton(ticker, open);
    return;
  }
  handled.set(article, key);
  openers.delete(article);
  article.querySelector(".kallr-host")?.remove();
  void addFollowBadge(article, post.handle);

  const ticker = findXTicker(article);
  if (!ticker && !mightBeCall(post.text)) return;
  // The API classifies the post; only real, priceable calls get the full card.
  const answer = mightBeCall(post.text)
    ? await send<Answer>({ type: "after-market", handle: post.handle, post: { postId: post.postId, text: post.text } })
    : null;
  if (!article.isConnected || handled.get(article) !== key) return;

  // A post that shares a contract is about that contract: show its safety checks and no trade
  // card, so a ticker copy is never offered next to a possibly fake token.
  const tokenCheck = answer?.checks?.token ?? null;
  if (tokenCheck) {
    const { host, root } = shadowHost("kallr-host");
    host.dataset.postId = post.postId;
    root.append(el("style", {}, TOKEN_CARD_CSS), tokenCheckCard(tokenCheck));
    article.querySelector(".kallr-host")?.remove();
    post.textNode.after(host);
    return;
  }

  const asset = answer?.call?.asset ?? ticker?.asset;
  if (!asset) return;

  const attached = !answer?.call && Boolean(ticker);
  const { card, open } = flashCard({
    post: { handle: post.handle, postId: post.postId, text: post.text },
    asset,
    article,
    answer: answer?.call ? answer : null,
    attached,
  });
  const { host, root } = shadowHost("kallr-host");
  host.dataset.postId = post.postId;
  root.append(card);
  card.dataset.mounted = "true";
  article.querySelector(".kallr-host")?.remove();
  if (attached && ticker) ticker.container.after(host);
  else post.textNode.after(host);

  if (ticker && ticker.asset === asset) {
    const opener = () => {
      open();
      host.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    openers.set(article, opener);
    mountTickerButton(ticker, opener);
  }
}

const openers = new WeakMap<HTMLElement, () => void>();
