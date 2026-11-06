"use client";

import { useConnectWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { type ReactNode, useSyncExternalStore } from "react";
import { PRIVY_ENABLED } from "@/app/providers";

/** Which wallet signs trades: the Kall wallet unless you switch to MetaMask in Wallet. */
export type SigningWallet = "kall" | "metamask";

export type Session = {
  ready: boolean;
  authenticated: boolean;
  handle: string | null;
  /** The wallet that trades: your Kall wallet, or MetaMask when you chose it. */
  address: Address | null;
  signing: SigningWallet;
  /** Your Kall wallet: the embedded wallet Privy made when you signed in. */
  kallAddress: Address | null;
  /** Connect MetaMask (if needed) and sign with it from now on. */
  signWithMetaMask: () => void;
  /** Back to the Kall wallet. */
  signWithKall: () => void;
  login: () => void;
  logout: () => Promise<void>;
};

// The choice is per browser; the Kall wallet is the default.
const CHOICE_KEY = "kallr.signing";
const CHOICE_EVENT = "kallr-signing";
const readChoice = (): SigningWallet => {
  try {
    return localStorage.getItem(CHOICE_KEY) === "metamask" ? "metamask" : "kall";
  } catch {
    return "kall";
  }
};
function saveChoice(choice: SigningWallet) {
  try {
    if (choice === "kall") localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, choice);
  } catch {}
  window.dispatchEvent(new Event(CHOICE_EVENT));
}
function subscribe(onChange: () => void) {
  window.addEventListener(CHOICE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHOICE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The wallet that signs trades, and which one it is. MetaMask only when you chose it and it's
 * connected; otherwise the Kall wallet, which signs without pop-ups.
 */
export function useTradingWallet() {
  const { wallets } = useWallets();
  const choice = useSyncExternalStore(subscribe, readChoice, () => "kall" as const);
  const kall = wallets.find((w) => w.walletClientType === "privy") ?? null;
  const metamask = wallets.find((w) => w.walletClientType === "metamask") ?? null;
  return choice === "metamask" && metamask ? { wallet: metamask, signing: "metamask" as const, kall } : { wallet: kall, signing: "kall" as const, kall };
}

/** Reads the Privy session. Only call inside components rendered when PRIVY_ENABLED is true. */
export function usePrivySession(): Session {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { wallet, signing, kall } = useTradingWallet();
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet: connected }) => {
      if (connected.walletClientType === "metamask") saveChoice("metamask");
    },
  });
  const kallAddress = (kall?.address ?? user?.wallet?.address ?? null) as Address | null;
  return {
    ready,
    authenticated,
    handle: user?.twitter?.username ?? user?.email?.address ?? null,
    address: (wallet?.address as Address | undefined) ?? kallAddress,
    signing,
    kallAddress,
    signWithMetaMask: () => {
      if (wallets.some((w) => w.walletClientType === "metamask")) saveChoice("metamask");
      else connectWallet({ walletList: ["metamask"] });
    },
    signWithKall: () => saveChoice("kall"),
    login,
    logout: async () => {
      saveChoice("kall");
      await logout();
    },
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
