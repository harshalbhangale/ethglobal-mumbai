import type { SeenCall } from "./card-metrics";
import { el, send, shadowHost } from "./dom";
import { recentCalls } from "./drawer";
import { followButton } from "./follows";
import { recordPanel } from "./record-panel";

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
 * The AfterMarkets card on an X profile: Follow, the caller's record and their recent calls, from
 * the posts this browser has seen. Refreshes at most once a minute per profile.
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
  existing?.remove();

  const { host, root } = shadowHost("aftermarkets-profile-host");
  host.dataset.handle = handle;
  host.dataset.refreshAt = String(Date.now() + 60_000);
  host.style.margin = "12px 16px";
  const body = el("div", {}, el("p", { class: "note" }, "Loading the calls this browser has seen…"));
  const follow = followButton(handle, (label) => el("button", { type: "button" }, label) as HTMLButtonElement);
  const card = el(
    "div",
    { class: "card" },
    el("div", { class: "top" }, el("span", { class: "brand" }, "AfterMarkets"), follow),
    body,
  );
  root.append(card);
  mount(anchor, host);

  const answer = await send<RecordAnswer>({ type: "caller-record", handle });
  if (!host.isConnected || profileHandle() !== handle) return;
  const calls = answer?.calls ?? [];
  body.replaceChildren(
    ...(answer
      ? [recordPanel(handle, calls), ...(calls.length ? [recentCalls(handle, calls, 5)] : [])]
      : [el("p", { class: "note" }, "Couldn't load the record. Try again in a minute.")]),
    el(
      "p",
      { class: "note" },
      answer?.seen
        ? `From ${answer.seen} post${answer.seen === 1 ? "" : "s"} by @${handle} this browser has seen, priced at posting. Not wallet returns.`
        : `No posts by @${handle} seen yet. Scroll their posts and calls get priced as they appear.`,
    ),
  );
}
