import { addFollowBadge } from "./creator-badge";
import { onFollowsChanged } from "./follows";
import { decorate, readPost } from "./post-card";
import { scanProfile } from "./profile";

/**
 * Content script on x.com. Draws the AfterMarkets card under crypto calls (and a Buy button in X's
 * own ticker cards), the profile card on X profiles, and Following chips on bylines. It reads only
 * what's on screen; no X API, no cookies. Trades are signed in the AfterMarkets desk, never here.
 */

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
