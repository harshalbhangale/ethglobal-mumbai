import { el } from "./dom";
import { usd } from "./post";

/** What /api/after-market returns under checks.token (GoPlus + Dexscreener). */
export type TokenCheck = {
  address: string;
  symbol: string | null;
  flags: { kind: string; severity: "danger" | "warning" | "info"; text: string }[];
  liquidityUsd: number | null;
  pairUrl: string | null;
  sources: { goplus: string; dexscreener: string };
};

/** What /api/cre/coin returns: Chainlink CRE's signed verdict for (contract, ticker), stored on Base Sepolia. */
export type CreVerdict =
  | { checked: true; verdict: "real" | "fake" | "unknown"; reason: string; symbol: string; claimed: string; txHash: string | null }
  | { checked: false };

/** "pending" while CRE is still checking; null when the post names no ticker or CRE is unavailable. */
export type CreState = CreVerdict | "pending" | null;

const SEPOLIA_TX = "https://sepolia.basescan.org/tx/";

function creLine(cre: CreState) {
  if (cre === "pending") return el("div", { class: "tc-line tc-muted tc-cre" }, "Checking with Chainlink CRE…");
  if (!cre || !cre.checked || cre.verdict === "fake") return null;
  const proof = cre.txHash ? el("a", { href: SEPOLIA_TX + cre.txHash, target: "_blank", rel: "noreferrer" }, "verdict ↗") : null;
  return cre.verdict === "real"
    ? el("div", { class: "tc-line tc-ok tc-cre" }, `✓ Real $${cre.claimed} · checked by Chainlink CRE `, proof)
    : el("div", { class: "tc-line tc-muted tc-cre" }, `${cre.reason} · Chainlink CRE `, proof);
}

export const TOKEN_CARD_CSS = `
.token-card { margin-top: 10px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--line, #d9dfe8);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: inherit; }
.token-card .tc-head { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; font-size: 13px; }
.token-card .tc-muted { opacity: 0.7; font-size: 13px; font-weight: 400; }
.token-card .tc-line { margin-top: 6px; }
.token-card .tc-danger { color: #d93f45; } .token-card .tc-warning { color: #c77700; } .token-card .tc-ok { color: #12935f; }
.token-card a { color: inherit; }
.token-card.tc-failed { border-color: #d93f45; background: rgba(217, 63, 69, 0.08); }
.token-card .tc-verdict { font-weight: 800; font-size: 16px; }
.token-card .tc-cre a { font-weight: 600; }
`;

/**
 * Card for a post that shares a contract address. It shows the token's safety findings and
 * deliberately offers no trade: a ticker copy next to a contract could be a scam's bait.
 * A source that failed is said, never shown as clean.
 */
/**
 * Does the contract match the coin the post names? A post saying $PEPE next to an address that holds
 * no token, or a different one, fails the call check: the classic fake-contract shill.
 */
export function callCheck(t: TokenCheck, claimed: string | null): string | null {
  const noToken = !t.symbol && (t.liquidityUsd ?? 0) === 0;
  const short = `${t.address.slice(0, 6)}…${t.address.slice(-4)}`;
  if (claimed && noToken) return `There's no $${claimed} at ${short}: no token trades at this address on Base.`;
  if (claimed && t.symbol && t.symbol.toUpperCase() !== claimed.toUpperCase())
    return `This contract is $${t.symbol}, not $${claimed}. The post's address doesn't match the coin it names.`;
  if (!claimed && noToken) return `No token trades at ${short} on Base.`;
  return null;
}

/** The first $TICKER a post names, ignoring $ amounts like $5 or $100K. */
export function claimedTicker(text: string): string | null {
  return text.match(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/)?.[1]?.toUpperCase() ?? null;
}

export function tokenCheckCard(t: TokenCheck, claimed: string | null = null, cre: CreState = null) {
  if (cre && cre !== "pending" && cre.checked && cre.verdict === "fake")
    return el(
      "section",
      { class: "token-card tc-failed", "aria-label": "Fake token" },
      el("div", { class: "tc-head" }, `Kall Markets · call check $${cre.claimed}`, el("span", { class: "tc-muted" }, "not advice")),
      el("div", { class: "tc-line tc-danger tc-verdict" }, "✕ Fake token · checked by Chainlink CRE"),
      el("div", { class: "tc-line" }, cre.reason),
      cre.txHash
        ? el("div", { class: "tc-line tc-cre" }, el("a", { href: SEPOLIA_TX + cre.txHash, target: "_blank", rel: "noreferrer" }, "See the signed verdict on Basescan ↗"))
        : null,
      el("div", { class: "tc-line tc-muted" }, "Trading is off for this post."),
    );
  const failed = callCheck(t, claimed);
  if (failed)
    return el(
      "section",
      { class: "token-card tc-failed", "aria-label": "Call check failed" },
      el("div", { class: "tc-head" }, `Kall Markets · call check${claimed ? ` $${claimed}` : ""}`, el("span", { class: "tc-muted" }, "not advice")),
      el("div", { class: "tc-line tc-danger tc-verdict" }, "✕ Call check failed"),
      el("div", { class: "tc-line" }, failed),
      el("div", { class: "tc-line tc-muted" }, "Trading is off for this post. Never buy from a contract address in a post without checking it."),
      creLine(cre),
    );
  const name = t.symbol ? `$${t.symbol}` : `${t.address.slice(0, 6)}…${t.address.slice(-4)}`;
  const serious = t.flags.filter((f) => f.severity !== "info");
  const verdict = serious.length
    ? el(
        "div",
        { class: `tc-line ${serious.some((f) => f.severity === "danger") ? "tc-danger" : "tc-warning"}` },
        `⚠ ${serious.map((f) => f.text).join(" · ")}`,
      )
    : t.sources.goplus === "ok" && t.sources.dexscreener === "ok"
      ? el("div", { class: "tc-line tc-ok" }, "✓ No red flags in GoPlus or Dexscreener")
      : el("div", { class: "tc-line tc-muted" }, "Safety checks unavailable right now");
  const info = [
    t.liquidityUsd !== null ? `${usd(t.liquidityUsd)} liquidity on Base` : null,
    ...t.flags.filter((f) => f.severity === "info").map((f) => f.text),
  ].filter((x): x is string => Boolean(x));
  return el(
    "section",
    { class: "token-card", "aria-label": `Token check for ${name}` },
    el("div", { class: "tc-head" }, `Kall Markets · token check ${name}`, el("span", { class: "tc-muted" }, "not advice")),
    verdict,
    creLine(cre),
    info.length ? el("div", { class: "tc-line tc-muted" }, info.join(" · ")) : null,
    el("div", { class: "tc-line tc-muted" }, "Shares a contract address, so no copy is offered."),
  );
}
