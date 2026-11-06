import type { SeenCall } from "./card-metrics";
import { appOrigin } from "./config";
import { el, send } from "./dom";
import { followButton } from "./follows";
import { type CopiedTrade, callerCard, PROFILE_CARD_CSS } from "./profile-card";

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

type RecordAnswer = { calls?: SeenCall[]; trades?: CopiedTrade[]; writer?: string | null; deleted?: number; deletedChecked?: number };

const isDark = () => {
  const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
  return (bg[0] ?? 255) + (bg[1] ?? 255) + (bg[2] ?? 255) < 200;
};

/**
 * The Kall card on an X profile: the caller's record from Arkiv, small. Calls, hit rate, average return,
 * open calls, the last three calls, and where it's stored. Refreshes at most once a minute per profile.
 */
export async function scanProfile() {
  const handle = profileHandle();
  let existing = document.querySelector<HTMLElement>(".kallr-profile-host");
  if (existing && existing.dataset.handle !== handle) {
    existing.remove();
    existing = null;
  }
  if (!handle) return;
  const anchor = document.querySelector<HTMLElement>('[data-testid="primaryColumn"] [data-testid="UserName"]');
  if (!anchor) return;
  if (existing && Number(existing.dataset.refreshAt) > Date.now()) return;
  existing?.remove();

  const host = el("div", { class: "kallr-profile-host" });
  host.dataset.handle = handle;
  host.dataset.refreshAt = String(Date.now() + 60_000);
  host.dataset.theme = isDark() ? "dark" : "light";
  host.addEventListener("click", (e) => e.stopPropagation());
  const root = host.attachShadow({ mode: "open" });
  const follow = followButton(handle, (label) => el("button", { type: "button", class: "pc-follow" }, label) as HTMLButtonElement);
  const deskUrl = new URL(`/app?caller=${handle}`, appOrigin).href;
  let card = callerCard({ handle, calls: null, follow, deskUrl });
  root.append(el("style", {}, PROFILE_CARD_CSS), card);
  mount(anchor, host);

  const answer = await send<RecordAnswer>({ type: "caller-record", handle });
  if (!host.isConnected || profileHandle() !== handle) return;
  const next = answer
    ? callerCard({
        handle,
        calls: answer.calls ?? [],
        trades: answer.trades ?? [],
        writer: answer.writer,
        deleted: typeof answer.deleted === "number" ? { count: answer.deleted, checked: answer.deletedChecked ?? 0 } : null,
        follow,
        deskUrl,
      })
    : el("div", { class: "pc" }, el("p", { class: "pc-empty" }, "Couldn't load the record. Try again in a minute."));
  card.replaceWith(next);
  card = next;
}
