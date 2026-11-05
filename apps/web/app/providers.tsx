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
        loginMethods: ["twitter", "email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#14213D",
          logo: "/icons/icon-192.png",
          walletChainType: "ethereum-only",
          landingHeader: "Sign in to AfterMarkets",
          loginMessage: "Use your X account so your replies to @AfterMarkets link to your wallet.",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
