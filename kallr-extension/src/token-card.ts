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

export const TOKEN_CARD_CSS = `
.token-card { margin-top: 10px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--line, #d9dfe8);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: inherit; }
.token-card .tc-head { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; font-size: 13px; }
.token-card .tc-muted { opacity: 0.7; font-size: 13px; font-weight: 400; }
.token-card .tc-line { margin-top: 6px; }
.token-card .tc-danger { color: #d93f45; } .token-card .tc-warning { color: #c77700; } .token-card .tc-ok { color: #12935f; }
.token-card a { color: inherit; }
`;

/**
 * Card for a post that shares a contract address. It shows the token's safety findings and
 * deliberately offers no trade: a ticker copy next to a contract could be a scam's bait.
 * A source that failed is said, never shown as clean.
 */
export function tokenCheckCard(t: TokenCheck) {
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
    el("div", { class: "tc-head" }, `Kallr Markets · token check ${name}`, el("span", { class: "tc-muted" }, "not advice")),
    verdict,
    info.length ? el("div", { class: "tc-line tc-muted" }, info.join(" · ")) : null,
    el("div", { class: "tc-line tc-muted" }, "Shares a contract address, so no copy is offered."),
  );
}
