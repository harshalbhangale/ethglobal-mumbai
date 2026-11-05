"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { PRIVY_ENABLED } from "@/app/providers";

export type Session = {
  ready: boolean;
  authenticated: boolean;
  handle: string | null;
  address: Address | null;
  embedded: boolean;
  login: () => void;
  logout: () => Promise<void>;
};

/** Reads the Privy session. Only call inside components rendered when PRIVY_ENABLED is true. */
export function usePrivySession(): Session {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const wallet = embeddedWallet ?? wallets[0];
  const address = (wallet?.address ?? user?.wallet?.address ?? null) as Address | null;

  return {
    ready,
    authenticated,
    handle: user?.twitter?.username ?? user?.email?.address ?? null,
    address,
    embedded: Boolean(embeddedWallet),
    login,
    logout,
  };
}

const buttonClass =
  "rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink-soft disabled:opacity-50";

function PrivySignInButton({ label }: { label: string }) {
  const { ready, authenticated, login } = usePrivy();
  if (ready && authenticated) return null;
  return (
    <button type="button" className={buttonClass} disabled={!ready} onClick={() => login()}>
      {label}
    </button>
  );
}

export function SignInButton({ label = "Sign in with X" }: { label?: string }) {
  if (!PRIVY_ENABLED) return <SetupNotice />;
  return <PrivySignInButton label={label} />;
}

export function SetupNotice() {
  return (
    <p className="rounded-xl border border-amber/60 bg-amber/10 px-4 py-3 text-sm text-ink">
      Sign-in is off. Add <code className="font-semibold">NEXT_PUBLIC_PRIVY_APP_ID</code> to{" "}
      <code className="font-semibold">.env.local</code> and restart the dev server.
    </p>
  );
}

/** Renders children with the session once Privy is configured; otherwise shows the setup notice. */
export function WithSession({ children }: { children: (session: Session) => ReactNode }) {
  if (!PRIVY_ENABLED) {
    return (
      <div className="mx-auto max-w-md py-24">
        <SetupNotice />
      </div>
    );
  }
  return <SessionReader>{children}</SessionReader>;
}

function SessionReader({ children }: { children: (session: Session) => ReactNode }) {
  const session = usePrivySession();
  return <>{children(session)}</>;
}
