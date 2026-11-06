"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { PRIVY_ENABLED } from "@/app/providers";

export type Session = {
  ready: boolean;
  authenticated: boolean;
  handle: string | null;
  /** Your Kall wallet on Base: the embedded wallet Privy made when you signed in. */
  address: Address | null;
  login: () => void;
  logout: () => Promise<void>;
};

/** The embedded wallet, the only one Kall Markets trades from. */
export function useKallWallet() {
  const { wallets } = useWallets();
  return wallets.find((w) => w.walletClientType === "privy") ?? null;
}

/** Reads the Privy session. Only call inside components rendered when PRIVY_ENABLED is true. */
export function usePrivySession(): Session {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const wallet = useKallWallet();
  const address = (wallet?.address ?? user?.wallet?.address ?? null) as Address | null;
  return {
    ready,
    authenticated,
    handle: user?.twitter?.username ?? user?.email?.address ?? null,
    address,
    login,
    logout,
  };
}

const buttonClass =
  "rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-on-lime transition-colors hover:bg-lime-strong disabled:opacity-50";

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
