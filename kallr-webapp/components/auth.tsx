"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { type ReactNode, useEffect, useState } from "react";
import { PRIVY_ENABLED } from "@/app/providers";

/** A wallet the user can trade from: Privy's embedded one, or one they connected (MetaMask, Rabby…). */
export type SessionWallet = { address: Address; embedded: boolean; name: string };

export type Session = {
  ready: boolean;
  authenticated: boolean;
  handle: string | null;
  /** The wallet trades, orders and balances use. */
  address: Address | null;
  embedded: boolean;
  walletName: string | null;
  wallets: SessionWallet[];
  selectWallet: (address: Address) => void;
  connectWallet: () => void;
  login: () => void;
  logout: () => Promise<void>;
};

const ACTIVE_KEY = "kallr.activeWallet";
const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

/** "metamask" → "MetaMask", "rabby_wallet" → "Rabby Wallet". */
export function walletLabel(clientType: string) {
  if (clientType === "privy") return "Kall Markets wallet (Privy)";
  if (clientType === "metamask") return "MetaMask";
  if (clientType === "coinbase_wallet") return "Coinbase Wallet";
  return clientType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Reads the Privy session. Only call inside components rendered when PRIVY_ENABLED is true. */
export function usePrivySession(): Session {
  const { ready, authenticated, user, login, logout, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => setActive(readActive()), []);

  const list: SessionWallet[] = wallets.map((w) => ({
    address: w.address as Address,
    embedded: w.walletClientType === "privy",
    name: walletLabel(w.walletClientType),
  }));
  // The one you picked; else a wallet you connected yourself (it's the one with funds); else the embedded one.
  const chosen =
    list.find((w) => w.address.toLowerCase() === active?.toLowerCase()) ?? list.find((w) => !w.embedded) ?? list.find((w) => w.embedded) ?? null;
  const address = (chosen?.address ?? user?.wallet?.address ?? null) as Address | null;

  return {
    ready,
    authenticated,
    handle: user?.twitter?.username ?? user?.email?.address ?? null,
    address,
    embedded: chosen?.embedded ?? true,
    walletName: chosen?.name ?? (address ? "Kall Markets wallet (Privy)" : null),
    wallets: list,
    selectWallet: (a) => {
      try {
        localStorage.setItem(ACTIVE_KEY, a);
      } catch {}
      setActive(a);
    },
    connectWallet: () => connectWallet(),
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
