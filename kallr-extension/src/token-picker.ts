import { el, send } from "./dom";
import { tokenIcon } from "./logos";

/**
 * Token picker for the card, Uniswap-style: ETH and BTC up top, then live search by symbol, name or
 * pasted contract address (Base only, through the app's /api/tokens/search). Symbols aren't unique,
 * so each row shows the contract and liquidity; tokens Definitive flags as risky can't be picked.
 */

export type TokenInfo = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: string | null;
  liquidity: string | null;
  change24h: string | null;
  imageUrl: string | null;
  riskFlagged: boolean;
};

/** Built-in choices: these use Chainlink prices and the ETH/BTC shortcuts. */
export const KNOWN = [
  { key: "ETH", symbol: "ETH", name: "Ethereum" },
  { key: "BTC", symbol: "BTC", name: "Bitcoin (cbBTC)" },
] as const;

export type Choice = { kind: "known"; key: "ETH" | "BTC" } | { kind: "token"; token: TokenInfo };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function parseTokens(raw: unknown): TokenInfo[] {
  const list = (raw as { tokens?: unknown } | null)?.tokens;
  if (!Array.isArray(list)) return [];
  return list.flatMap((t) => {
    const x = t as Partial<TokenInfo>;
    return typeof x.address === "string" && ADDRESS.test(x.address) && typeof x.symbol === "string" && typeof x.decimals === "number"
      ? [{
          address: x.address,
          symbol: x.symbol.slice(0, 16),
          name: (typeof x.name === "string" ? x.name : x.symbol).slice(0, 48),
          decimals: x.decimals,
          price: typeof x.price === "string" ? x.price : null,
          liquidity: typeof x.liquidity === "string" ? x.liquidity : null,
          change24h: typeof x.change24h === "string" ? x.change24h : null,
          imageUrl: typeof x.imageUrl === "string" && x.imageUrl.startsWith("https://") ? x.imageUrl : null,
          riskFlagged: x.riskFlagged === true,
        }]
      : [];
  });
}

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  return parseTokens(await send<unknown>({ type: "token-search", query }));
}

/** "$1.2M", "$231K", "$3" */
export function compactUsd(v: string | null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
}

/** Plain-decimal price, also for tiny prices Flash sends as 8.1e-4. */
export function plainPrice(v: string | number | null): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1 ? n.toFixed(4) : n.toFixed(Math.min(18, Math.max(6, -Math.floor(Math.log10(n)) + 4)));
}

/** Coin logo: Flash's image when it loads, else our built-in or a coloured initial. */
export function choiceIcon(choice: Choice, size: number) {
  if (choice.kind === "known") return tokenIcon(choice.key, size);
  const fallback = tokenIcon(choice.token.symbol, size);
  if (!choice.token.imageUrl) return fallback;
  const img = el("img", {
    class: "swap-icon",
    src: choice.token.imageUrl,
    alt: "",
    width: String(size),
    height: String(size),
    referrerpolicy: "no-referrer",
    style: `width:${size}px;height:${size}px;border-radius:50%`,
  });
  img.addEventListener("error", () => img.replaceWith(fallback));
  return img;
}

export function tokenPicker(onPick: (choice: Choice) => void, onClose: () => void, initialQuery = "") {
  const input = el("input", {
    class: "picker-search",
    placeholder: "Search a name or paste a contract address",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Search tokens on Base",
  }) as HTMLInputElement;
  const list = el("div", { class: "picker-list", role: "listbox" });
  const note = el("p", { class: "picker-note", "aria-live": "polite" });
  const close = el("button", { type: "button", class: "picker-close", "aria-label": "Close" }, "✕");
  close.addEventListener("click", onClose);

  const row = (choice: Choice, sub: string, right: Node | string, disabled = false) => {
    const label = choice.kind === "known" ? choice.key : choice.token.symbol;
    const name = choice.kind === "known" ? KNOWN.find((k) => k.key === choice.key)?.name ?? label : choice.token.name;
    const b = el(
      "button",
      { type: "button", class: `picker-row${disabled ? " risky" : ""}`, role: "option", ...(disabled ? { disabled: "" } : {}) },
      choiceIcon(choice, 32),
      el("span", { class: "picker-id" }, el("b", {}, label), el("small", {}, `${name} · ${sub}`)),
      el("span", { class: "picker-right" }, right),
    );
    if (!disabled) b.addEventListener("click", () => onPick(choice));
    return b;
  };

  const showKnown = () =>
    list.replaceChildren(...KNOWN.map((k) => row({ kind: "known", key: k.key }, "Chainlink price", "Built in")));

  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      note.textContent = "";
      return showKnown();
    }
    note.textContent = "Searching Base…";
    const id = ++seq;
    timer = setTimeout(async () => {
      const tokens = await searchTokens(q);
      if (id !== seq) return;
      note.textContent = tokens.length
        ? "Symbols aren't unique: check the contract and liquidity. Flagged tokens can't be bought."
        : ADDRESS.test(q)
          ? "No tradable token at that address on Base."
          : "Nothing on Base matches. Try the symbol or paste the contract address.";
      list.replaceChildren(
        ...tokens.map((t) =>
          row(
            { kind: "token", token: t },
            `${t.address.slice(0, 6)}…${t.address.slice(-4)}`,
            t.riskFlagged ? el("span", { class: "risk-badge" }, "Flagged") : el("span", {}, compactUsd(t.liquidity), el("small", {}, " liq")),
            t.riskFlagged,
          ),
        ),
      );
    }, 250);
  });

  showKnown();
  if (initialQuery) {
    input.value = initialQuery;
    input.dispatchEvent(new Event("input"));
  }
  const root = el(
    "div",
    { class: "picker", role: "dialog", "aria-label": "Choose a token" },
    el("div", { class: "picker-head" }, el("b", {}, "Choose a token on Base"), close),
    input,
    list,
    note,
  );
  root.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  });
  return { root, focus: () => input.focus({ preventScroll: true }) };
}
