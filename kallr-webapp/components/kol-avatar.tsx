"use client";

import { useState } from "react";
import { SAMPLE_HANDLES } from "@/lib/feed";

/** Two-stop gradient picked from the handle, so a caller keeps the same colors everywhere. */
export function handleHue(handle: string) {
  return [...handle].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);
}
export function handleGradient(handle: string, angle = 135) {
  const a = handleHue(handle);
  return `linear-gradient(${angle}deg, hsl(${a} 85% 58%), hsl(${(a + 70) % 360} 80% 52%), hsl(${(a + 150) % 360} 75% 45%))`;
}

/** The caller's X avatar through unavatar, falling back to a colored initial. */
export function KolAvatar({ handle, size = 44, ring = false }: { handle: string; size?: number; ring?: boolean }) {
  // Sample callers are made up and "you" is a placeholder: never fetch a real X photo for them.
  const [failed, setFailed] = useState(handle === "you" || SAMPLE_HANDLES.includes(handle));
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-display font-semibold text-white ${ring ? "ring-4 ring-card" : ""}`}
      style={{ width: size, height: size, background: handleGradient(handle), fontSize: size * 0.42 }}
      title={`@${handle}`}
    >
      {handle.slice(0, 1).toUpperCase()}
      {!failed && (
        <img
          src={`https://unavatar.io/x/${handle}?fallback=false`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}
