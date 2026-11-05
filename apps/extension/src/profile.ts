import { recentCalls } from "./call-insights";
import type { SeenCall } from "./card-metrics";
import { appOrigin } from "./config";
import { el, poweredBy, safeLink, send, shadowHost } from "./dom";
import { followButton } from "./follows";
import { breakdown, recordPanel } from "./record-panel";

/** First path segments on x.com that are app pages, not profiles. */
const RESERVED = new Set([
  "home", "explore", "notifications", "messages", "i", "settings", "search", "compose",
  "jobs", "lists", "communities", "premium", "tos", "privacy", "hashtag", "intent", "share",
]);
const PROFILE_TABS = new Set(["with_replies", "media", "likes", "highlights", "articles", "superfollows"]);

/** The handle of the profile on screen, lowercased, or null on any other page. */
export function profileHandle(pathname = location.pathname): string | null {
  const [first, ...rest] = pathname.split("/").filter(Boolean);
  if (!first || RESERVED.has(first.toLowerCase()) || rest.length > 1) return null;
  if (rest.length && !PROFILE_TABS.has(rest[0] ?? "")) return null;
  return /^[A-Za-z0-9_]{1,15}$/.test(first) ? first.toLowerCase() : null;
}

/** Below the bio and follower row, above the Posts tabs. Falls back to under the name. */
function mount(anchor: HTMLElement, host: HTMLElement) {
  const column = anchor.closest<HTMLElement>('[data-testid="primaryColumn"]') ?? anchor.parentElement ?? document.body;
  const tabs = column.querySelector<HTMLElement>('[role="tablist"]');
  if (tabs) return tabs.before(host);
  const meta =
    column.querySelector<HTMLElement>('[data-testid="UserProfileHeader_Items"]') ??
    column.querySelector<HTMLElement>('[data-testid="UserDescription"]');
  if (meta) return meta.after(host);
  anchor.after(host);
}

type RecordAnswer = { calls?: SeenCall[]; seen?: number };

/**
 * The AfterMarkets card on an X profile: the caller's record as metric
 * tiles, recent calls, and Open desk / Show details / Follow. From the posts this browser has seen.
 * Refreshes at most once a minute per profile.
 */
export async function scanProfile() {
  const handle = profileHandle();
  let existing = document.querySelector<HTMLElement>(".aftermarkets-profile-host");
  if (existing && existing.dataset.handle !== handle) {
    existing.remove();
    existing = null;
  }
  if (!handle) return;
  const anchor = document.querySelector<HTMLElement>('[data-testid="primaryColumn"] [data-testid="UserName"]');
  if (!anchor) return;
  if (existing && Number(existing.dataset.refreshAt) > Date.now()) return;
  const expanded = existing?.dataset.expanded === "true";
  existing?.remove();

  const { host, root } = shadowHost("aftermarkets-profile-host");
  host.dataset.handle = handle;
  host.dataset.refreshAt = String(Date.now() + 60_000);
  const details = el("div", {}, el("p", { class: "note" }, "Loading the calls this browser has seen…"));
  const toggle = el("button", { type: "button", class: "card-toggle", "aria-expanded": "false" }, "Show details");
  const overview = el("div", { class: "card-overview", hidden: "" });
  const follow = followButton(handle, (label) => el("button", { type: "button", class: "card-follow" }, label) as HTMLButtonElement);
  let calls: SeenCall[] = [];
  const setOpen = (open: boolean) => {
    overview.hidden = !open;
    host.dataset.expanded = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide details" : "Show details";
    if (open) overview.replaceChildren(breakdown(calls));
  };
  toggle.addEventListener("click", () => setOpen(overview.hidden));
  root.append(
    el(
      "div",
      { class: "card" },
      el("div", { class: "title" }, "AfterMarkets"),
      details,
      el(
        "div",
        { class: "card-actions" },
        safeLink(new URL("/app", appOrigin).href, "Open desk ↗", "cta"),
        toggle,
        follow,
      ),
      overview,
      poweredBy(),
    ),
  );
  mount(anchor, host);

  const answer = await send<RecordAnswer>({ type: "caller-record", handle });
  if (!host.isConnected || profileHandle() !== handle) return;
  calls = answer?.calls ?? [];
  details.replaceChildren(
    ...(answer
      ? [recordPanel(calls)]
      : [el("p", { class: "note" }, "Couldn't load the record. Try again in a minute.")]),
    el(
      "p",
      { class: "note" },
      answer?.seen
        ? `Detected from ${answer.seen} post${answer.seen === 1 ? "" : "s"} by @${handle} this browser has seen. Priced at posting; not wallet returns.`
        : `No posts by @${handle} seen yet. Scroll their posts and calls get priced as they appear.`,
    ),
    ...(calls.length ? [recentCalls(handle, calls, 3) as HTMLElement] : []),
  );
  if (expanded) setOpen(true);
}
