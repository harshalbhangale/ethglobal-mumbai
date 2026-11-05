import { appOrigin } from "./config";

/**
 * Toolbar popup: which app this build talks to and what's live. Prices
 * come from Chainlink on Base through the app; orders go to Definitive Flash on Base mainnet and
 * are signed by the user's own wallet. Nothing here holds keys or signs.
 *
 * Each row fills in on its own: the app check is instant (/api/health) and the follow rows come
 * from local storage, so a slow price read never leaves the popup on "Checking…" or makes a
 * running app look down.
 */

export type StatusTone = "ok" | "off" | "pending";
export type StatusRow = { label: string; value: string; tone: StatusTone };

export type PopupState = {
  app: "checking" | "up" | "down";
  prices: "loading" | "slow" | "unavailable" | string[];
  following: number | null;
  mirror: boolean | null;
};

export const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(appOrigin);

export function buildLabel(app: PopupState["app"]) {
  if (app === "checking") return "Checking…";
  if (app === "down") return localOrigin ? "Local build · app not reachable" : "App not reachable";
  return localOrigin ? "Local build · Base mainnet" : "Base mainnet";
}

export function statusRows(s: PopupState): StatusRow[] {
  const app: StatusRow =
    s.app === "checking"
      ? { label: "App", value: "Checking…", tone: "pending" }
      : s.app === "up"
        ? { label: "App", value: "Connected", tone: "ok" }
        : { label: "App", value: localOrigin ? "Not reachable. Start the local app." : "Not reachable", tone: "off" };
  const prices: StatusRow =
    s.app === "down"
      ? { label: "Prices", value: "—", tone: "off" }
      : Array.isArray(s.prices)
        ? { label: "Prices", value: s.prices.length ? `Chainlink · ${s.prices.join(", ")}` : "Unavailable", tone: s.prices.length ? "ok" : "off" }
        : s.prices === "loading"
          ? { label: "Prices", value: "Loading…", tone: "pending" }
          : s.prices === "slow"
            ? { label: "Prices", value: "Slow to load · reopen to retry", tone: "off" }
            : { label: "Prices", value: "Unavailable", tone: "off" };
  return [
    app,
    prices,
    { label: "Orders", value: "Definitive Flash · Base", tone: s.app === "down" ? "off" : "ok" },
    { label: "Following", value: s.following === null ? "…" : String(s.following), tone: s.following === null ? "pending" : "ok" },
    {
      label: "Follow on X",
      value: s.mirror === null ? "…" : s.mirror ? "On" : "Off · turn on in the desk",
      tone: s.mirror === null ? "pending" : s.mirror ? "ok" : "off",
    },
  ];
}

const getJson = (path: string, timeoutMs: number) =>
  fetch(`${appOrigin}${path}`, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(timeoutMs) }).then((r) =>
    r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error(`HTTP ${r.status}`)),
  );

/** Runs the checks, calling `render` after each answer. Exported for tests. */
export function runChecks(render: (s: PopupState) => void, storage: Pick<typeof chrome.storage.local, "get"> = chrome.storage.local) {
  const state: PopupState = { app: "checking", prices: "loading", following: null, mirror: null };
  const update = (patch: Partial<PopupState>) => {
    Object.assign(state, patch);
    render({ ...state });
  };
  update({});

  const health = getJson("/api/health", 5000).then(
    () => update({ app: "up" }),
    () => update({ app: "down" }),
  );
  const prices = getJson("/api/prices", 20_000).then(
    (v) => update({ prices: ((v as { prices?: Array<{ asset?: unknown }> }).prices ?? []).map((p) => String(p.asset)) }),
    (err: unknown) => update({ prices: (err as Error)?.name === "TimeoutError" ? "slow" : "unavailable" }),
  );
  const stored = Promise.resolve()
    .then(() => storage.get(["kallr.watchlist.v1", "kallr.mirror-x.v1"]))
    .then(
      (values) =>
        update({
          following: (values["kallr.watchlist.v1"] as { entries?: unknown[] } | undefined)?.entries?.length ?? 0,
          mirror: (values["kallr.mirror-x.v1"] as { enabled?: unknown } | undefined)?.enabled === true,
        }),
      () => update({ following: 0, mirror: false }),
    );
  return Promise.all([health, prices, stored]).then(() => ({ ...state }));
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
  void runChecks((s) => {
    if (headline) headline.textContent = buildLabel(s.app);
    list?.replaceChildren(...statusRows(s).map(item));
  });
}
