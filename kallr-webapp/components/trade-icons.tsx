/**
 * Icons for the trade history: where an order came from (desk, extension on X, keyboard)
 * and what it traded. Inline SVG so they render without network requests and in the PWA offline.
 */

export type Source = "desk" | "extension" | "keyboard";

export const SOURCE_STYLE: Record<Source, { label: string; short: string; bg: string; fg: string; tint: string }> = {
  extension: { label: "Extension on X", short: "X", bg: "#e6ebe3", fg: "#050605", tint: "#e6ebe314" },
  keyboard: { label: "Keyboard", short: "Keyboard", bg: "#c6f25a", fg: "#0e1407", tint: "#c6f25a1a" },
  desk: { label: "Desk", short: "Desk", bg: "#2c3830", fg: "#e6ebe3", tint: "#2c383040" },
};

const isSource = (s: string): s is Source => s in SOURCE_STYLE;

function SourceGlyph({ source, size }: { source: Source; size: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (source === "extension") {
    return (
      <svg {...common} fill="currentColor">
        <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z" />
      </svg>
    );
  }
  if (source === "keyboard") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2.5" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4M7 12l3-3 2 2 4-4" />
    </svg>
  );
}

/** Round colored badge for a trade's source. */
export function SourceIcon({ source, size = 28 }: { source: string; size?: number }) {
  if (!isSource(source)) return <span className="inline-block rounded-full bg-rule" style={{ width: size, height: size }} />;
  const s = SOURCE_STYLE[source];
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: s.bg, color: s.fg }}
      title={s.label}
    >
      <SourceGlyph source={source} size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Pill with the source icon and its name, for trade rows. */
export function SourceChip({ source }: { source: string }) {
  if (!isSource(source)) return <span className="text-slate">{source}</span>;
  const s = SOURCE_STYLE[source];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-ink"
      style={{ background: s.tint }}
    >
      <SourceIcon source={source} size={18} />
      {s.label}
    </span>
  );
}

const ASSETS: Record<string, { bg: string; glyph: "eth" | "btc" | "usdc" }> = {
  ETH: { bg: "#627eea", glyph: "eth" },
  WETH: { bg: "#627eea", glyph: "eth" },
  BTC: { bg: "#f7931a", glyph: "btc" },
  CBBTC: { bg: "#f7931a", glyph: "btc" },
  USDC: { bg: "#2775ca", glyph: "usdc" },
};

/** Token logo: ETH, BTC and USDC drawn; anything else gets a colored letter. */
export function AssetIcon({ asset, size = 40 }: { asset: string; size?: number }) {
  const known = ASSETS[asset.toUpperCase()];
  const g = Math.round(size * 0.6);
  if (!known) {
    const hue = [...asset].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    return (
      <span
        className="inline-grid shrink-0 place-items-center rounded-full font-display font-semibold text-white"
        style={{ width: size, height: size, background: `hsl(${hue} 65% 45%)`, fontSize: size * 0.4 }}
        title={asset}
      >
        {asset.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full text-white" style={{ width: size, height: size, background: known.bg }} title={asset}>
      {known.glyph === "eth" && (
        <svg width={g} height={g} viewBox="0 0 24 24" aria-hidden fill="currentColor">
          <path d="M12 2 5.5 12.3 12 16l6.5-3.7L12 2Z" opacity=".9" />
          <path d="m12 17.3-6.5-3.8L12 22l6.5-8.5-6.5 3.8Z" opacity=".7" />
        </svg>
      )}
      {known.glyph === "btc" && (
        <svg width={g} height={g} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 5h6a3 3 0 0 1 0 6H8V5Zm0 6h7a3.5 3.5 0 0 1 0 7H8v-7ZM10 3v2M13 3v2M10 18v2M13 18v2M6 5h2M6 18h2" />
        </svg>
      )}
      {known.glyph === "usdc" && (
        <svg width={g} height={g} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M15 9.5c-.4-1-1.5-1.7-3-1.7-1.8 0-3 .9-3 2.1 0 2.9 6 1.4 6 4.3 0 1.2-1.2 2.1-3 2.1-1.5 0-2.6-.7-3-1.7M12 6v1.8M12 16.3V18" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      )}
    </span>
  );
}

/** Asset logo with the source badge tucked in the corner, like a wallet activity row. */
export function TradeAvatar({ asset, source }: { asset: string; source: string }) {
  return (
    <span className="relative inline-block shrink-0">
      <AssetIcon asset={asset} size={40} />
      <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-card">
        <SourceIcon source={source} size={20} />
      </span>
    </span>
  );
}
