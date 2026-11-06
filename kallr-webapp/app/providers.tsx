"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { base } from "viem/chains";
import type { ReactNode } from "react";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

export function Providers({ children }: { children: ReactNode }) {
  if (!PRIVY_ENABLED) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Sign in with X (or email). No browser wallets: every trade uses the embedded wallet Privy makes.
        loginMethods: ["twitter", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#C6F25A",
          logo: "/icons/icon-192.png",
          walletChainType: "ethereum-only",
          landingHeader: "Sign in to Kall Markets",
          loginMessage: "Sign in with X to get your Kall wallet on Base.",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          // Kall shows the whole order before you place it; the wallet signs without its own pop-ups.
          showWalletUIs: false,
        },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
