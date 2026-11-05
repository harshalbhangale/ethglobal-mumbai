import { byAssetDirection, caveats, formatBps, type SeenCall, statTiles, worstCall } from "./card-metrics";
import { el } from "./dom";

/**
 * The caller's record on the card: one summary line, stat tiles, honest caveats, and a disclosure
 * with the breakdown by asset and direction. Covers only calls this browser has seen.
 */
export function recordPanel(handle: string, calls: SeenCall[]) {
  const root = el("div", { class: "record" });
  const tiles = statTiles(calls);
  const open = calls.filter((c) => c.status === "open").length;

  if (!tiles.length) {
    root.append(
      el("div", { class: "line muted" }, `@${handle}: no scored calls seen yet${open ? ` · ${open} open` : ""}`),
    );
    return root;
  }

  root.append(
    el("div", { class: "line" }, `@${handle}'s record`, open ? el("span", { class: "muted" }, ` · ${open} open`) : null),
    el(
      "div",
      { class: "tiles" },
      ...tiles.map((t) =>
        el(
          "div",
          { class: `tile${t.tone ? ` ${t.tone}` : ""}` },
          el("span", { class: "tile-value" }, t.value),
          el("span", { class: "tile-label" }, t.label),
        ),
      ),
    ),
  );

  const notes = caveats(calls);
  if (notes.length) root.append(el("div", { class: "chips" }, ...notes.map((n) => el("span", { class: "chip" }, n))));

  const groups = byAssetDirection(calls);
  const worst = worstCall(calls);
  if (groups.length) {
    root.append(
      el(
        "details",
        { class: "breakdown" },
        el("summary", {}, "By asset"),
        ...groups.map((g) =>
          el(
            "div",
            { class: "breakdown-row" },
            el("span", {}, `$${g.asset} ${g.direction}`),
            el(
              "span",
              {},
              `${g.hits}/${g.scored} hit · median `,
              el("span", { class: g.medianBps >= 0 ? "up" : "down" }, formatBps(g.medianBps)),
            ),
          ),
        ),
        worst
          ? el(
              "div",
              { class: "breakdown-row" },
              el("span", {}, "Worst call"),
              el("span", { class: "down" }, `${formatBps(worst.returnBps)} on $${worst.asset}`),
            )
          : null,
        el("p", { class: "muted small" }, "Calls this browser has seen, priced at posting. Not wallet returns."),
      ),
    );
  }
  return root;
}
