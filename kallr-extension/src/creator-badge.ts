import { el, shadowHost } from "./dom";
import { isFollowing } from "./follows";

/**
 * A quiet "Following" chip beside the author's name on posts by callers you follow on Kallr.
 * It says you follow them, nothing about whether their calls are good. A wallet-linked badge joins
 * it once the identity binding is served by the API.
 */

/** True when `node` sits in a left-to-right flow, so a following sibling stays on its line. */
function flowsHorizontally(node: HTMLElement) {
  const parent = node.parentElement;
  if (!parent) return false;
  const style = getComputedStyle(parent);
  if (style.display.includes("flex")) return !style.flexDirection.startsWith("column");
  if (style.display.includes("grid")) return false;
  return getComputedStyle(node).display.startsWith("inline");
}

/**
 * Place the chip on the display name's line, as high in the tree as its siblings still share the
 * line. Inside X's truncation box it would be clipped; too high and it lands under the @handle.
 */
function insertAfterName(container: HTMLElement, host: HTMLElement) {
  const text = [...container.querySelectorAll<HTMLElement>("span")].find(
    (span) => span.childElementCount === 0 && span.textContent?.trim(),
  );
  if (!text) return void container.append(host);
  const chain: HTMLElement[] = [];
  for (let node: HTMLElement | null = text; node && node !== container; node = node.parentElement) chain.push(node);
  ([...chain].reverse().find(flowsHorizontally) ?? text).after(host);
}

const CLASS = "kallr-badge-host";

export async function addFollowBadge(article: HTMLElement, handle: string) {
  const name = article.querySelector<HTMLElement>('[data-testid="User-Name"]');
  if (!name) return;
  const existing = name.querySelector<HTMLElement>(`.${CLASS}`);
  const on = await isFollowing(handle);
  if (!name.isConnected) return;
  if (!on) return existing?.remove();
  if (existing?.dataset.handle === handle) return;
  existing?.remove();
  const { host, root } = shadowHost(CLASS);
  host.dataset.handle = handle;
  Object.assign(host.style, { display: "inline-flex", margin: "0 0 0 4px", verticalAlign: "middle" });
  root.append(el("span", { class: "chip following", title: "You follow this caller on Kall Markets" }, "Following"));
  insertAfterName(name, host);
}
