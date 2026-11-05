import { el, svg } from "./dom";
import { TOKEN_ALIASES, TOKEN_LOGOS } from "./token-logos";

/**
 * Logos drawn without extension file URLs: token coins are inlined data URIs (the Kallr mark too, in dom.ts),
 * the Definitive lockup is an inline SVG. They render even after the extension is reloaded or moved.
 */

/** A coin logo, or a coloured initial for assets we have no logo for. */
export function tokenIcon(asset: string, size = 40) {
  const key = TOKEN_ALIASES[asset] ?? TOKEN_ALIASES[asset.toUpperCase()] ?? asset.toUpperCase();
  const src = TOKEN_LOGOS[key];
  if (src)
    return el("img", {
      class: "swap-icon",
      src,
      width: String(size),
      height: String(size),
      alt: "",
      style: `width:${size}px;height:${size}px;border-radius:50%`,
    });
  const colors: Record<string, string> = { ETH: "#627EEA", BTC: "#F7931A", USDC: "#2775CA", SOL: "#9945FF" };
  return el(
    "span",
    {
      class: "swap-icon",
      style: `width:${size}px;height:${size}px;background:${colors[key] ?? "#536471"};font-size:${Math.round(size * 0.48)}px`,
      "aria-hidden": "true",
    },
    asset.slice(0, 1),
  );
}

/**
 * Definitive's lockup (triangle mark + DEFINITIVE), drawn in the current text colour.
 * Used only as "Powered by" attribution for orders routed through Definitive Flash.
 */
export function definitiveLogo(height = 12) {
  const mark = svg("path", {
    d: "M12 1.5 L23 21 H1 Z M12 9.2 L7.4 17.4 H16.6 Z",
    "fill-rule": "evenodd",
    fill: "currentColor",
  });
  const word = svg("text", {
    x: "31",
    y: "19.6",
    fill: "currentColor",
    "font-family": "Inter, 'Helvetica Neue', Arial, sans-serif",
    "font-size": "20",
    "font-weight": "900",
    "letter-spacing": "0.6",
  });
  word.textContent = "DEFINITIVE";
  const logo = svg("svg", {
    class: "definitive-logo",
    viewBox: "0 0 168 22",
    height: String(height),
    width: String(Math.round((168 / 22) * height)),
    role: "img",
    "aria-label": "Definitive",
  }, mark, word);
  return logo;
}
