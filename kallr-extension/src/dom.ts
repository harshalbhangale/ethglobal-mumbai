import { css } from "./styles";
import { KALLR_MARK } from "./token-logos";

type Child = Node | string | null | undefined | false;

/** Build DOM without innerHTML; every string becomes a text node, so post text can't inject markup. */
export function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) if (child) node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

export function svg(tag: string, attrs: Record<string, string> = {}, ...children: Node[]) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

const assetUrls = new Map<string, string>();

/** Packaged image URL. Old content scripts can outlive an extension reload; getURL then throws. */
export function assetUrl(path: string) {
  try {
    const url = globalThis.chrome?.runtime?.getURL?.(path);
    if (url) {
      assetUrls.set(path, url);
      return url;
    }
    return path;
  } catch {
    // Keep previously resolved assets; never request an extension path from X.
    return assetUrls.get(path) ?? "";
  }
}

/**
 * The Kallr mark. The packaged PNG is used as a mask and filled with currentColor, so the
 * mark is white on X's dark theme and ink on light without separate assets.
 */
export function brandMark(size = 16) {
  // Inlined, so the mark survives extension reloads (file URLs from an old install break).
  return el("span", {
    class: "brand-mark-glyph",
    "aria-hidden": "true",
    style: `width:${size}px;height:${size}px;-webkit-mask-image:url("${KALLR_MARK}");mask-image:url("${KALLR_MARK}")`,
  });
}

/** The Kallr lockup: mark + name. */
export function wordmark(size = 16) {
  return el("span", { class: "wordmark" }, brandMark(size), el("span", {}, "Kallr"));
}

/** "Powered by Kallr" line under brand surfaces. */
export function poweredBy() {
  return el("p", { class: "powered" }, "Powered by ", wordmark());
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

/** The desk in a compact window next to X, where the user reviews the order and signs. */
export function openDesk(url: string) {
  window.open(url, "kallr", "popup,width=480,height=820");
}

/**
 * Message the service worker. After the extension reloads, the old content script keeps running in
 * open tabs and `chrome.runtime.sendMessage` throws "Extension context invalidated" synchronously,
 * so a promise `.catch` alone is not enough: a dead context, a failed call or an `{ error }` answer
 * all come back as null.
 */
export function send<T>(message: Record<string, unknown>): Promise<T | null> {
  try {
    if (!globalThis.chrome?.runtime?.id) {
      showReloadNotice();
      return Promise.resolve(null);
    }
    return chrome.runtime
      .sendMessage(message)
      .then((value: unknown) => (value && typeof value === "object" && "error" in value ? null : (value as T)))
      .catch((err: unknown) => {
        if (/context invalidated/i.test(String((err as Error)?.message ?? err))) showReloadNotice();
        return null;
      });
  } catch {
    showReloadNotice();
    return Promise.resolve(null);
  }
}

let reloadNoticeShown = false;

/**
 * After the extension is updated or reloaded, this tab's old script can't reach Kallr any more.
 * Say so once, with a Reload button, instead of cards silently not appearing.
 */
function showReloadNotice() {
  if (reloadNoticeShown || typeof document === "undefined" || !document.body) return;
  reloadNoticeShown = true;
  const bar = document.createElement("div");
  bar.setAttribute("role", "status");
  bar.style.cssText =
    "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:12px;" +
    "padding:10px 12px 10px 16px;border-radius:999px;background:#14213d;color:#fff;font:500 14px/1.3 system-ui,sans-serif;" +
    "box-shadow:0 12px 32px rgba(20,33,61,.35)";
  const text = document.createElement("span");
  text.textContent = "Kallr was updated. Reload this tab to keep using it.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reload";
  button.style.cssText = "border:0;border-radius:999px;padding:6px 14px;background:#2f6bff;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer";
  button.addEventListener("click", () => location.reload());
  bar.append(text, button);
  document.body.append(bar);
}

export type Metric = {
  label: string;
  /** null = no data; it moves into the collapsed "No data" dropdown with `reason`. */
  value: string | Node | null;
  reason?: string;
  /** stat = big number tile, chip = compact box (default), row = label and value line. */
  kind?: "stat" | "chip" | "row";
  tone?: "bad" | "good";
  group?: string;
};

/** Compact metrics: stat tiles, boxes and rows. Empty ones collapse into one dropdown. */
export function metricPanel() {
  const root = el("div", { class: "metrics" });
  const entries = new Map<string, Metric>();
  let openState = false;
  const render = () => {
    const all = [...entries.values()];
    const missing = all.filter((m) => m.value === null);
    const groups = new Map<string, Metric[]>();
    for (const metric of all.filter((m) => m.value !== null))
      groups.set(metric.group ?? "", [...(groups.get(metric.group ?? "") ?? []), metric]);
    root.replaceChildren();
    for (const [group, items] of groups) {
      const of = (kind: string) => items.filter((m) => (m.kind ?? "chip") === kind);
      const stats = of("stat");
      const chips = of("chip");
      const rows = of("row");
      if (group) root.append(el("div", { class: "metric-group" }, group));
      if (stats.length)
        root.append(
          el(
            "div",
            { class: "stat-grid" },
            ...stats.map((m) =>
              el(
                "div",
                { class: `stat-tile${m.tone ? ` ${m.tone}` : ""}` },
                el("span", { class: "stat-value" }, m.value),
                el("span", { class: "stat-label" }, m.label),
              ),
            ),
          ),
        );
      if (chips.length)
        root.append(
          el(
            "div",
            { class: "box-grid" },
            ...chips.map((m) => {
              const long = typeof m.value !== "string" || m.value.length > 20;
              return el(
                "div",
                { class: `metric-box${m.tone ? ` ${m.tone}` : ""}${long ? " wide" : ""}` },
                el("span", { class: "metric-label" }, m.label),
                el("span", { class: "metric-value" }, m.value),
              );
            }),
          ),
        );
      for (const m of rows)
        root.append(el("div", { class: "metric-row" }, el("span", { class: "metric-row-label" }, m.label), el("span", {}, m.value)));
    }
    if (missing.length) {
      const details = el(
        "details",
        { class: "unavailable" },
        el("summary", {}, `No data · ${missing.length}`),
        ...missing.map((m) => el("div", { class: "unavailable-row" }, el("span", {}, m.label), el("span", {}, m.reason ?? "—"))),
      ) as HTMLDetailsElement;
      details.open = openState;
      details.addEventListener("toggle", () => {
        openState = details.open;
      });
      root.append(details);
    }
  };
  return {
    root,
    set(id: string, metric: Metric) {
      entries.set(id, metric);
      render();
    },
    remove(id: string) {
      entries.delete(id);
      render();
    },
  };
}
