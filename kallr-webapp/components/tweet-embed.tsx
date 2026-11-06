"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The real post, embedded with X's public widgets.js (no API key). It loads when the card scrolls
 * into view; a deleted or private post says so instead of leaving a blank box.
 */

type Twttr = { widgets: { createTweet: (id: string, el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLElement | undefined> } };
declare global {
  interface Window {
    twttr?: Twttr;
  }
}

let loader: Promise<Twttr | null> | null = null;
function loadWidgets(): Promise<Twttr | null> {
  if (window.twttr?.widgets) return Promise.resolve(window.twttr);
  loader ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js";
    s.async = true;
    s.onload = () => resolve(window.twttr ?? null);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
  return loader;
}

export function TweetEmbed({ postId, handle }: { postId: string; handle: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"waiting" | "loading" | "shown" | "gone">("waiting");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setState("loading");
        void loadWidgets().then(async (tw) => {
          if (cancelled) return;
          if (!tw) return setState("gone");
          const dark = document.documentElement.dataset.theme !== "light";
          const made = await tw.widgets
            .createTweet(postId, el, { theme: dark ? "dark" : "light", dnt: true, conversation: "none", align: "center" })
            .catch(() => undefined);
          if (!cancelled) setState(made ? "shown" : "gone");
        });
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [postId]);

  return (
    <div className="tweet-embed">
      <div ref={box} className="[&_.twitter-tweet]:!my-0" />
      {(state === "waiting" || state === "loading") && <div className="h-28 animate-pulse rounded-md bg-raised" aria-label="Loading post" />}
      {state === "gone" && (
        <p className="rounded-md border border-dashed border-rule px-4 py-3 text-sm text-slate">
          This post isn’t available on X any more.{" "}
          <a href={`https://x.com/${handle}/status/${postId}`} target="_blank" rel="noreferrer" className="underline">
            Try opening it ↗
          </a>
        </p>
      )}
    </div>
  );
}
