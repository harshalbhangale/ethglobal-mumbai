import { formatBps, type SeenCall } from "./card-metrics";
import { type Answer, ago, outcome, type PostRef, postUrl, type ScoredCall } from "./call-view";
import { el, safeLink } from "./dom";
import { usd } from "./post";
import { recordPanel } from "./record-panel";
import { formatPrice, type LivePrice } from "./ticker-price";

/**
 * The Call check strip on a post card, as in Xtrading: a summary line with chips, opening to what
 * the post says, how this call has moved, the creator's record and their recent calls. It renders
 * from data the card already has, so opening it makes no request.
 */

const row = (label: string, value: Node | string) => el("div", { class: "row" }, el("span", {}, label), el("span", {}, value));
const section = (title: string, ...children: Array<Node | null | false>) =>
  el("div", { class: "section" }, el("h3", {}, title), ...children);

export function horizonLabel(call: Pick<ScoredCall, "postedAt" | "expiresAt" | "horizonStated">) {
  if (call.postedAt === undefined) return "—";
  const hours = Math.round((call.expiresAt - call.postedAt) / 3600);
  const text = hours >= 48 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
  return call.horizonStated ? `${text} (stated)` : `${text} (default; none stated)`;
}

const bullish = (d: "up" | "down") => (d === "up" ? "bullish" : "bearish");

/** "ETH · bullish · 3h ago view ↗", newest first. */
export function recentCalls(handle: string, calls: SeenCall[], limit = 5) {
  if (!calls.length) return null;
  const list = el("ul", {});
  for (const c of calls.slice(0, limit)) {
    const move =
      c.returnBps === null ? null : el("span", { class: c.returnBps >= 0 ? "up" : "down" }, ` ${formatBps(c.returnBps)}`);
    list.append(
      el(
        "li",
        {},
        `${c.asset} · ${bullish(c.direction)} · ${ago(c.postedAt)}`,
        move,
        ` · ${outcome(c.status, c.expiresAt)} `,
        safeLink(postUrl({ handle, postId: c.postId }), "view ↗"),
      ),
    );
  }
  return el("div", { class: "recent-calls" }, list);
}

function thisCall(call: ScoredCall, live: () => LivePrice | null) {
  const now = live();
  return section(
    "This call",
    row("Price at posting", call.entry === null ? "Unavailable" : usd(call.entry)),
    row(call.status === "open" ? "Price now" : "Price at expiry", call.last === null ? "Unavailable" : usd(call.last)),
    row(
      "Move in the called direction",
      call.returnBps === null ? "—" : el("span", { class: call.returnBps >= 0 ? "up" : "down" }, formatBps(call.returnBps)),
    ),
    row("Status", outcome(call.status, call.expiresAt)),
    now ? row("Live", `${formatPrice(now.price)} · ${now.source === "x" ? "X" : "Chainlink on Base"}`) : null,
  );
}

export function callInsights(input: { post: PostRef & { text: string }; answer: Answer; live: () => LivePrice | null }) {
  const { post, answer } = input;
  const call = answer.call;
  const body = el("div", { class: "call-insights-body" });
  const details = el(
    "details",
    { class: "call-insights" },
    el(
      "summary",
      {},
      el("span", { class: "ci-title" }, "Call check"),
      call
        ? el(
            "span",
            { class: `ci-chip ${call.direction}` },
            `${call.direction === "up" ? "Bullish" : "Bearish"} ${call.asset}`,
          )
        : null,
      el("span", { class: "ci-chip" }, "Creator record"),
      el("span", { class: "ci-chip" }, "After market"),
    ),
    body,
  ) as HTMLDetailsElement;

  const render = () => {
    const calls = answer.calls ?? [];
    const parts: Array<Node | null> = [
      section(
        "What the post says",
        el("blockquote", {}, post.text),
        call
          ? row("Call", el("span", { class: `dir-${call.direction}` }, `${call.asset} · ${bullish(call.direction)} · spot`))
          : null,
        call ? row("Horizon", horizonLabel(call)) : null,
        row("Extracted by", "Rules · directional-return-v1"),
        safeLink(postUrl(post), "View post ↗"),
      ),
      call ? thisCall(call, input.live) : null,
      section(
        "Creator record",
        recordPanel(calls),
        recentCalls(post.handle, calls),
        el("p", { class: "note" }, "Calls this browser has seen, priced at posting. Not wallet returns; deleted posts are missing."),
      ),
    ];
    body.replaceChildren(...parts.filter((p): p is Node => p !== null));
  };
  details.addEventListener("toggle", () => {
    if (details.open) render();
  });
  // Keep X from opening the post when the strip is used.
  details.addEventListener("click", (event) => event.stopPropagation());
  return details;
}
