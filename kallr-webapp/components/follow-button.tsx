"use client";

import type { useFollows } from "@/lib/feed";

export function FollowButton({ handle, follows, small, icon }: { handle: string; follows: ReturnType<typeof useFollows>; small?: boolean; icon?: boolean }) {
  const on = follows.handles.has(handle.toLowerCase());
  if (icon)
    return (
      <button
        type="button"
        onClick={() => follows.toggle(handle)}
        aria-pressed={on}
        aria-label={on ? `Unfollow @${handle}` : `Follow @${handle}`}
        title={on ? "Unfollow" : "Follow"}
        className={`grid size-7 shrink-0 place-items-center rounded-md border text-sm font-bold transition-colors ${
          on ? "border-lime/40 bg-lime/10 text-lime hover:border-down/40 hover:bg-transparent hover:text-down" : "border-rule text-slate hover:border-lime hover:text-lime"
        }`}
      >
        {on ? "✓" : "+"}
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => follows.toggle(handle)}
      className={`group shrink-0 rounded-md font-semibold transition-colors ${small ? "px-3.5 py-1.5 text-sm" : "px-5 py-2"} ${
        on ? "border border-rule bg-card text-slate hover:border-down/40 hover:text-down" : "border border-rule-strong text-ink hover:border-lime hover:text-lime"
      }`}
    >
      {on ? (
        <>
          <span className="group-hover:hidden">Following</span>
          <span className="hidden group-hover:inline">Unfollow</span>
        </>
      ) : (
        "Follow"
      )}
    </button>
  );
}
