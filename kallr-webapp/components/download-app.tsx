"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Get the mobile app": a button that opens a small menu with Android and iPhone. Each one downloads
 * the Kall Keyboard build directly from its URL (set at build time); a platform without one yet says so.
 */
const ANDROID_URL = process.env.NEXT_PUBLIC_ANDROID_APK_URL || "";
const IOS_URL = process.env.NEXT_PUBLIC_IOS_APP_URL || "";
const ANDROID_SIZE = process.env.NEXT_PUBLIC_ANDROID_APK_SIZE || "";

function AndroidIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.48 19.44 6.3a.38.38 0 0 0-.66-.38l-1.86 3.22a11.5 11.5 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52ZM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.27-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 2.99.72 1.24-.02 2.02-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.65l.03-.03ZM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.67 1.37-.58.67-1.09 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28Z" />
    </svg>
  );
}

function Item({ href, icon, title, detail }: { href: string; icon: React.ReactNode; title: string; detail: string }) {
  const body = (
    <>
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${href ? "bg-lime/15 text-lime" : "bg-raised text-slate"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-slate">{detail}</span>
      </span>
      {href ? (
        <span className="text-lime" aria-hidden="true">
          ↓
        </span>
      ) : (
        <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate uppercase">Soon</span>
      )}
    </>
  );
  return href ? (
    <a href={href} download role="menuitem" className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-raised">
      {body}
    </a>
  ) : (
    <div role="menuitem" aria-disabled="true" className="flex cursor-default items-center gap-3 rounded-lg p-2.5 opacity-70">
      {body}
    </div>
  );
}

export function DownloadApp({ align = "right", full = false, label = "Get the mobile app" }: { align?: "left" | "right"; full?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className={`relative ${full ? "w-full" : "inline-block"}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-center gap-2 rounded-md border border-rule bg-card px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-ink transition-colors hover:border-ink ${full ? "w-full" : ""}`}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M11 18h2" strokeLinecap="round" />
        </svg>
        {label}
        <span className={`text-xs text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-50 rounded-xl border border-rule bg-card p-1.5 shadow-2xl shadow-black/50 ${align === "right" ? "right-0" : "left-0"} ${full ? "bottom-full mb-2 w-full" : "top-full mt-2 w-[min(18rem,calc(100vw-2rem))]"}`}
        >
          <p className="px-2.5 pt-1.5 pb-2 text-xs text-slate">Kall Keyboard: trade calls from any chat.</p>
          <Item
            href={ANDROID_URL}
            icon={<AndroidIcon />}
            title="Android"
            detail={ANDROID_URL ? `Download the APK${ANDROID_SIZE ? ` · ${ANDROID_SIZE}` : ""}` : "APK coming soon"}
          />
          <Item href={IOS_URL} icon={<AppleIcon />} title="iPhone" detail={IOS_URL ? "Download for iOS" : "TestFlight coming soon"} />
          {ANDROID_URL && (
            <p className="px-2.5 pt-2 pb-1.5 text-[11px] leading-snug text-slate">
              On Android, allow installs from your browser, then turn on Kall Keyboard in Settings → Keyboards.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
