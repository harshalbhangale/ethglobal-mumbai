import { css } from "./styles";

type Child = Node | string | null | undefined | false;

/** Build DOM without innerHTML; every string becomes a text node, so post text can't inject markup. */
export function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) if (child) node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

/** True when X is showing a dark theme, read from the page background (falls back to the OS setting). */
export function isDarkPage() {
  const channels = getComputedStyle(document.body).backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!channels) return matchMedia("(prefers-color-scheme: dark)").matches;
  return Number(channels[1]) * 0.2126 + Number(channels[2]) * 0.7152 + Number(channels[3]) * 0.0722 < 128;
}

/** A host element with an open shadow root carrying our styles and X's current theme. */
export function shadowHost(className: string) {
  const host = el("div", { class: className });
  host.dataset.theme = isDarkPage() ? "dark" : "light";
  // Clicks inside our UI must not open the post underneath.
  host.addEventListener("click", (e) => e.stopPropagation());
  const root = host.attachShadow({ mode: "open" });
  root.append(el("style", {}, css));
  return { host, root };
}

/** An external link that only ever points at http(s). */
export function safeLink(href: string, label: string, className = "") {
  const url = new URL(href);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid link");
  return el("a", { href: url.href, target: "_blank", rel: "noopener noreferrer", class: className }, label);
}

/**
 * Message the service worker. After the extension reloads, the old content script keeps running in
 * open tabs and `chrome.runtime.sendMessage` throws "Extension context invalidated" synchronously,
 * so a promise `.catch` alone is not enough: a dead context, a failed call or an `{ error }` answer
 * all come back as null.
 */
export function send<T>(message: Record<string, unknown>): Promise<T | null> {
  try {
    if (!globalThis.chrome?.runtime?.id) return Promise.resolve(null);
    return chrome.runtime
      .sendMessage(message)
      .then((value: unknown) => (value && typeof value === "object" && "error" in value ? null : (value as T)))
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}
