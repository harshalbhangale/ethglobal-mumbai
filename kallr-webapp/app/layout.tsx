import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { Providers } from "./providers";
import { ServiceWorkerRegister } from "@/components/sw-register";

export const metadata: Metadata = {
  title: "Kallr",
  description:
    "Tag @Kallr under any crypto call on X to see how it played out, copy it with one reply, and get a call back when your exits hit.",
  applicationName: "Kallr",
  // Absolute URLs for share cards. Set NEXT_PUBLIC_SITE_URL to the deployed origin.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  openGraph: {
    type: "website",
    siteName: "Kallr",
    title: "Kallr: every call on X has an after market",
    description: "Priced at posting. Copy it with take-profit and stop-loss on Base.",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "Kallr" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kallr: every call on X has an after market",
    description: "Priced at posting. Copy it with take-profit and stop-loss on Base.",
    images: ["/brand/og.png"],
  },
  appleWebApp: { capable: true, title: "Kallr", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#F3F5F8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
