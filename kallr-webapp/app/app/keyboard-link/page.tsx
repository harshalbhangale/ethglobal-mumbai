"use client";

import { usePrivy, useSigners } from "@privy-io/react-auth";
import { useState } from "react";
import { type Session, SignInButton, WithSession } from "@/components/auth";
import { Logo } from "@/components/logo";
import { shortAddress } from "@/lib/chain";
import { issueKallKey } from "@/lib/kall-key";

/**
 * Links the Kall Keyboard to your Kall wallet, the one you got signing in with X: sign in, allow Kall's
 * signer once, and the Kall app opens with a key for that wallet. The keyboard then trades from it with
 * no pop-up, the same way trades from X do.
 */
export default function KeyboardLinkPage() {
  return <WithSession>{(session) => <LinkKeyboard session={session} />}</WithSession>;
}

/** The Kall app's link handler on iPhone. */
const APP_LINK = "kallmarkets://link";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; url: string } | { kind: "failed"; message: string };

function LinkKeyboard({ session }: { session: Session }) {
  const { getAccessToken } = usePrivy();
  const { addSigners } = useSigners();
  const [state, setState] = useState<State>({ kind: "idle" });

  const link = async () => {
    if (!session.kallAddress) return;
    setState({ kind: "busy" });
    try {
      const k = await issueKallKey({ address: session.kallAddress, addSigners, getAccessToken });
      const url = `${APP_LINK}?${new URLSearchParams({ key: k.key, address: k.address, expires: String(k.expires) })}`;
      setState({ kind: "done", url });
      window.location.href = url;
    } catch (e) {
      setState({ kind: "failed", message: e instanceof Error ? e.message : "Couldn't link. Try again." });
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Logo href="/app" />
      <h1 className="font-display mt-10 text-3xl font-semibold tracking-tight">Link the Kall Keyboard</h1>
      <p className="mt-2 leading-relaxed text-slate">
        Trade from the keyboard with your Kall wallet, the same one as the web app and X. No pop-ups, up to $25 an order, on Base.
      </p>

      <div className="mt-8">
        {!session.ready ? (
          <p className="text-sm text-slate">Loading…</p>
        ) : !session.authenticated ? (
          <SignInButton label="Sign in with X" />
        ) : !session.kallAddress ? (
          <p className="text-sm text-slate">Setting up your Kall wallet…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-rule bg-card px-4 py-3">
              <span className="text-sm text-slate">Kall wallet</span>
              <span className="font-mono text-sm">{shortAddress(session.kallAddress)}</span>
            </div>
            {state.kind === "done" ? (
              <div className="space-y-3">
                <p className="text-sm">Opening the Kall app…</p>
                <a href={state.url} className="block w-full rounded-lg bg-lime py-3 text-center font-semibold text-on-lime hover:bg-lime-strong">
                  Open the Kall app
                </a>
              </div>
            ) : (
              <button
                type="button"
                onClick={link}
                disabled={state.kind === "busy"}
                className="w-full rounded-lg bg-lime py-3 font-semibold text-on-lime hover:bg-lime-strong disabled:opacity-60"
              >
                {state.kind === "busy" ? "Linking…" : "Link Kall Keyboard"}
              </button>
            )}
            {state.kind === "failed" && <p className="text-sm text-down">{state.message}</p>}
          </div>
        )}
      </div>

      <p className="mt-10 text-xs leading-relaxed text-slate">
        To unlink, open Kall Markets › Wallet › Trade from X › Turn off. That removes Kall's signer from your wallet.
      </p>
    </main>
  );
}
