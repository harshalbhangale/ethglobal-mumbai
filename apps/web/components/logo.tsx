import Link from "next/link";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#14213D" />
      <path
        d="M136 340 L216 260 L280 304 L376 188"
        stroke="#F2A93B"
        strokeWidth="44"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="376" cy="188" r="30" fill="#F2A93B" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="AfterMarkets home">
      <LogoMark />
      <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">AfterMarkets</span>
    </Link>
  );
}
