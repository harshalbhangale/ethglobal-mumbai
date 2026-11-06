import { el, safeLink, svg } from "./dom";

/**
 * The "trade placed" moment: a lime ring draws itself, fills with a springy pop, a check strokes in
 * and a ring of confetti fires, then the summary slides up. About 1.3s, all CSS keyframes on an
 * inline SVG (styles in styles.ts under "Success burst"). Shown only once Flash returns an order ID;
 * with prefers-reduced-motion the finished check and summary show at once.
 */

export type SuccessSummary = {
  /** "Bought ETH" / "Sold DEGEN". */
  title: string;
  /** What was spent: "$25.00" or "0.01 ETH". */
  spent: string;
  /** Take-profit and stop-loss, when the order has them. */
  exits?: { tpPct: number; slPct: number; tpPrice: string; slPrice: string } | null;
};

/** Confetti: angle (deg), distance (px), size (px), color, shape. Fixed, so the burst looks the same every time. */
const PIECES: Array<[number, number, number, string, "dot" | "bar"]> = [
  [-90, 72, 7, "var(--sb-lime)", "bar"],
  [-62, 64, 5, "var(--sb-bone)", "dot"],
  [-35, 76, 6, "var(--sb-lime-2)", "bar"],
  [-8, 68, 5, "var(--sb-lime)", "dot"],
  [18, 78, 7, "var(--sb-bone)", "bar"],
  [44, 66, 5, "var(--sb-lime-2)", "dot"],
  [70, 74, 6, "var(--sb-lime)", "bar"],
  [96, 64, 5, "var(--sb-bone)", "dot"],
  [122, 76, 7, "var(--sb-lime-2)", "bar"],
  [148, 66, 5, "var(--sb-lime)", "dot"],
  [174, 74, 6, "var(--sb-bone)", "bar"],
  [200, 68, 5, "var(--sb-lime-2)", "dot"],
  [226, 78, 7, "var(--sb-lime)", "bar"],
  [252, 64, 5, "var(--sb-bone)", "dot"],
];

export function successBurst(s: SuccessSummary) {
  const mark = el(
    "div",
    { class: "sb-mark", "aria-hidden": "true" },
    el("span", { class: "sb-wave" }),
    ...PIECES.map(([angle, dist, size, color, shape], i) => {
      const rad = (angle * Math.PI) / 180;
      const piece = el("i", { class: `sb-piece sb-${shape}` });
      // CSSOM, not a style attribute: X's page CSP can block inline style attributes.
      const vars: Record<string, string> = {
        "--x": `${(Math.cos(rad) * dist).toFixed(1)}px`,
        "--y": `${(Math.sin(rad) * dist).toFixed(1)}px`,
        "--r": `${angle + 90 + (i % 2 ? 160 : -140)}deg`,
        "--s": `${size}px`,
        "--c": color,
        "--d": `${(i % 3) * 18}ms`,
      };
      for (const [k, v] of Object.entries(vars)) piece.style.setProperty(k, v);
      return piece;
    }),
    svg(
      "svg",
      { viewBox: "0 0 64 64", class: "sb-svg" },
      svg("circle", { class: "sb-disc", cx: "32", cy: "32", r: "26" }),
      svg("circle", { class: "sb-ring", cx: "32", cy: "32", r: "26", pathLength: "1" }),
      svg("path", { class: "sb-tick", d: "M20.5 33.5 L28.5 41.5 L44 25", pathLength: "1" }),
    ),
  );

  const link = el("span", { class: "sb-link sb-pending" }, "Basescan link once Definitive fills…");
  const lines = [
    el("strong", { class: "sb-title" }, "Order placed"),
    el("p", { class: "sb-amount" }, el("b", {}, s.spent), ` · ${s.title}`),
    s.exits
      ? el(
          "p",
          { class: "sb-exits" },
          el("span", { class: "sb-tp" }, `TP +${s.exits.tpPct}% · ${s.exits.tpPrice}`),
          el("span", { class: "sb-sl" }, `SL −${s.exits.slPct}% · ${s.exits.slPrice}`),
        )
      : null,
    link,
  ];
  lines.forEach((line, i) => line?.style.setProperty("--i", String(i)));

  const root = el("div", { class: "sb", role: "status", "aria-live": "polite" }, mark, el("div", { class: "sb-text" }, ...lines));
  return {
    root,
    /** Point the summary at the swap on Basescan once Definitive fills it (or at the wallet if it never shows). */
    setLink(href: string, label: string) {
      link.classList.remove("sb-pending");
      link.replaceChildren(safeLink(href, label));
    },
  };
}
