import Link from "next/link";

/**
 * The Kallr mark on a black tile with a hairline, the same tile as the app and extension icons.
 * The mark PNG is generated from docs/brand/logo-source.png.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  const mark = Math.round(size * 0.7);
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center border border-rule-strong bg-[#0b0d0c]"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
    >
      <img src="/brand/mark.png" alt="" width={mark} height={mark} draggable={false} />
    </span>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Kallr Markets home">
      <LogoMark size={30} />
      <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">Kallr Markets</span>
    </Link>
  );
}
