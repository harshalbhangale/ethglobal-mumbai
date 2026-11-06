"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { base } from "viem/chains";
import type { ReactNode } from "react";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

export function Providers({ children }: { children: ReactNode }) {
  // The keyboard's hidden Anon-RPC page signs nobody in: keep it light.
  const path = usePathname();
  if (!PRIVY_ENABLED || path?.startsWith("/anon-bridge")) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter", "email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#C6F25A",
          logo: "/icons/icon-192.png",
          walletChainType: "ethereum-only",
          landingHeader: "Sign in to Kall Markets",
          loginMessage: "Sign in with X to get your Kall Markets wallet on Base.",
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
