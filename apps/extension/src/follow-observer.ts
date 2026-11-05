import { send } from "./dom";

/**
 * Reads, from what X shows on screen, whether the viewer follows the profile they're on or each
 * account on their own Following page. Ported from Xtrading. X marks its follow buttons with
 * data-testid "<id>-follow" / "<id>-unfollow"; buttons inside posts are ignored.
 */

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const PROFILE_TABS = ["with_replies", "media", "likes", "highlights", "articles"];

function handleFromLink(link: HTMLAnchorElement | null) {
  if (!link) return null;
  let url: URL;
  try {
    // X's links are relative ("/kol"); resolve against x.com, not whatever page we're on.
    url = new URL(link.getAttribute("href") ?? "", "https://x.com");
  } catch {
    return null;
  }
  if (!["x.com", "twitter.com"].includes(url.hostname)) return null;
  const match = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(url.pathname);
  return match?.[1] ? match[1].toLowerCase() : null;
}

function followState(container: Element, profile = false): boolean | null {
  const pick = (suffix: string) =>
    [...container.querySelectorAll(`[data-testid$="-${suffix}"]`)].find(
      (node) => !node.closest('article[data-testid="tweet"]') && (!profile || !node.closest('[data-testid="UserCell"]')),
    );
  if (pick("unfollow")) return true;
  return pick("follow") ? false : null;
}

export function followObservations(pathname = location.pathname) {
  const viewer = handleFromLink(document.querySelector<HTMLAnchorElement>('a[data-testid="AppTabBar_Profile_Link"]'));
  if (!viewer) return null;
  const [name, section, extra] = pathname.split("/").filter(Boolean);
  const owner = name && HANDLE.test(name) ? name.toLowerCase() : null;
  const observations: Array<{ handle: string; following: boolean }> = [];
  if (owner === viewer && section === "following" && !extra) {
    for (const cell of document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]')) {
      const following = followState(cell);
      const handle = [...cell.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((link) => handleFromLink(link))
        .find((value) => value && value !== viewer);
      if (handle && following !== null) observations.push({ handle, following });
    }
  } else if (owner && owner !== viewer && (!section || PROFILE_TABS.includes(section))) {
    const column = document.querySelector('[data-testid="primaryColumn"]');
    if (column?.querySelector('[data-testid="UserName"]')) {
      const following = followState(column, true);
      if (following !== null) observations.push({ handle: owner, following });
    }
  }
  return { viewer, observations: observations.slice(0, 100) };
}

let lastScan = 0;
let lastSent = "";
let trailing: ReturnType<typeof setTimeout> | undefined;
/**
 * Throttled to every 1.5s, with a trailing run so a Follow click is caught even when X goes quiet
 * afterwards. Sends only when what's on screen changed.
 */
export function observeFollowing() {
  const wait = 1500 - (Date.now() - lastScan);
  if (wait > 0) {
    trailing ??= setTimeout(() => {
      trailing = undefined;
      observeFollowing();
    }, wait);
    return;
  }
  lastScan = Date.now();
  const snapshot = followObservations();
  if (!snapshot?.observations.length) return;
  const key = JSON.stringify(snapshot);
  if (key === lastSent) return;
  lastSent = key;
  void send({ type: "observe-follows", ...snapshot });
}
