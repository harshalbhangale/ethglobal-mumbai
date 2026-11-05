"use client";

import type { WatchlistEntry } from "@kallr/domain";
import { useEffect, useState } from "react";
import {
  extensionFollows,
  extensionInstalled,
  extensionMirror,
  type FollowCommand,
  type FollowSource,
  normalize,
  readLocal,
  updateLocal,
} from "@/lib/follows";

/**
 * The callers you follow. With the extension, this is the same list as the Follow buttons on X
 * profiles; without it, a list kept in this browser.
 */
export function Following() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [source, setSource] = useState<FollowSource | null>(null);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [mirror, setMirror] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fallback = () => {
      if (cancelled) return;
      setEntries(readLocal());
      setSource("browser");
    };
    // The bridge marks the page once it loads; give it a moment on first paint.
    const start = () =>
      extensionFollows({ action: "read" })
        .then((list) => {
          if (cancelled) return;
          setEntries(list);
          setSource("extension");
          extensionMirror()
            .then((on) => !cancelled && setMirror(on))
            .catch(() => {});
        })
        .catch(fallback);
    if (extensionInstalled()) start();
    else {
      const t = setTimeout(() => (extensionInstalled() ? start() : fallback()), 300);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(command: Exclude<FollowCommand, { action: "read" }>) {
    setMessage(null);
    try {
      const next = source === "extension" ? await extensionFollows(command) : updateLocal(command);
      setEntries(next);
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't update the list.");
      return false;
    }
  }

  return (
    <section id="following" aria-labelledby="following-heading" className="rounded-2xl border border-rule bg-card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="following-heading" className="font-display text-lg font-semibold">
          Following
        </h2>
        {source && (
          <span className="text-sm text-slate">
            {source === "extension" ? "Synced with the extension" : "This browser only"}
          </span>
        )}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const handle = normalize(input);
          if (!handle) return setMessage("Enter an X handle, like @cryptorover.");
          if (await run({ action: "add", handle })) setInput("");
        }}
      >
        <label htmlFor="follow-handle" className="sr-only">
          X handle to follow
        </label>
        <input
          id="follow-handle"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="@handle or profile link"
          className="min-w-0 flex-1 rounded-full border border-rule bg-paper px-4 py-2.5 text-[15px] placeholder:text-slate/80 focus:border-ink focus:outline-none"
        />
        <button type="submit" disabled={!source} className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          Follow
        </button>
      </form>
      {message && <p className="mt-3 text-sm text-down">{message}</p>}

      {source === "extension" && mirror !== null && (
        <label className="mt-4 flex items-start gap-3 rounded-xl bg-paper p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-ink"
            checked={mirror}
            onChange={async (e) => {
              const next = e.target.checked;
              setMessage(null);
              try {
                setMirror(await extensionMirror(next));
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Couldn't change the setting.");
              }
            }}
          />
          <span>
            <span className="font-semibold">Follow here when I follow on X</span>
            <span className="block text-slate">
              Pressing Follow on X adds the caller here. Unfollowing on X removes only callers X added; ones you
              followed here stay. Read from X&rsquo;s buttons on screen; no X login or API.
            </span>
          </span>
        </label>
      )}

      {source && entries.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-rule px-6 py-8 text-center">
          <p className="font-semibold">Not following anyone yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate">
            {source === "extension"
              ? "Press Follow on a caller's X profile, or add a handle above. Their posts get a Following chip on X."
              : "Add a handle above. Install the Kallr extension to follow straight from X profiles."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-rule">
          {entries.map((e) => (
            <li key={e.handle} className="flex items-center justify-between gap-4 py-3">
              <a
                href={`https://x.com/${e.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate font-semibold hover:underline"
              >
                @{e.handle}
              </a>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-sm text-slate tabular-nums">
                  since {new Date(e.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <button
                  type="button"
                  onClick={() => run({ action: "remove", handle: e.handle })}
                  className="rounded-full border border-rule px-3 py-1.5 text-sm text-slate hover:border-ink hover:text-ink"
                >
                  Unfollow
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
