import { appOrigin } from "./config";

/**
 * Toolbar popup, laid out like Xtrading's: which app this build talks to and what's live. Prices
 * come from Chainlink on Base through the app; orders go to Definitive Flash on Base mainnet and
 * are signed by the user's own wallet. Nothing here holds keys or signs.
 */

export type StatusTone = "ok" | "off";
export type StatusRow = { label: string; value: string; tone: StatusTone };

export const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(appOrigin);

export function buildLabel(reachable: boolean) {
  if (!reachable) return localOrigin ? "Local build · app not reachable" : "App not reachable";
  return localOrigin ? "Local build · Base mainnet" : "Base mainnet";
}

export function statusRows(input: { prices: string[] | null; following: number; mirror: boolean }): StatusRow[] {
  if (!input.prices)
    return [{ label: "App", value: localOrigin ? "Not reachable. Start the local app." : "Not reachable", tone: "off" }];
  return [
    { label: "App", value: "Connected", tone: "ok" },
    {
      label: "Prices",
      value: input.prices.length ? `Chainlink · ${input.prices.join(", ")}` : "Unavailable",
      tone: input.prices.length ? "ok" : "off",
    },
    { label: "Orders", value: "Definitive Flash · Base", tone: "ok" },
    { label: "Following", value: String(input.following), tone: "ok" },
    { label: "Follow on X", value: input.mirror ? "On" : "Off · turn on in the desk", tone: input.mirror ? "ok" : "off" },
  ];
}

if (typeof document !== "undefined" && document.querySelector("#status")) {
  const desk = document.querySelector<HTMLAnchorElement>("#open-app");
  if (desk) desk.href = `${appOrigin}/app`;
  const list = document.querySelector<HTMLUListElement>("#status");
  const headline = document.querySelector<HTMLElement>("#build-label");
  const item = (row: StatusRow) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = row.label;
    const state = document.createElement("b");
    state.className = row.tone;
    state.textContent = row.value;
    li.append(name, state);
    return li;
  };

  const prices = fetch(`${appOrigin}/api/prices`, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("down"))))
    .then((v: { prices?: Array<{ asset?: unknown }> }) => (v.prices ?? []).map((p) => String(p.asset)))
    .catch(() => null);
  const stored = chrome.storage.local.get(["aftermarkets.watchlist.v1", "aftermarkets.mirror-x.v1"]);

  void Promise.all([prices, stored]).then(([assets, values]) => {
    const following = (values["aftermarkets.watchlist.v1"] as { entries?: unknown[] } | undefined)?.entries?.length ?? 0;
    const mirror = (values["aftermarkets.mirror-x.v1"] as { enabled?: unknown } | undefined)?.enabled === true;
    if (headline) headline.textContent = buildLabel(assets !== null);
    list?.replaceChildren(...statusRows({ prices: assets, following, mirror }).map(item));
  });
}
