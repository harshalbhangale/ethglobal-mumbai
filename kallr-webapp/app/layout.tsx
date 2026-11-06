import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { Providers } from "./providers";
import { ServiceWorkerRegister } from "@/components/sw-register";

export const metadata: Metadata = {
  title: "Kall Markets",
  description:
    "See how a crypto caller’s past calls played out, then copy the call on Base with exits attached: from X with the extension, or from any chat with the Kall Markets keyboard.",
  applicationName: "Kall Markets",
  // Absolute URLs for share cards. Set NEXT_PUBLIC_SITE_URL to the deployed origin.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  openGraph: {
    type: "website",
    siteName: "Kall Markets",
    title: "Kall Markets: Don’t trust. Check the caller. Trade it.",
    description: "Every crypto call priced, scored and kept on Arkiv, then traded in one tap on Definitive Flash.",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "Kall Markets" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kall Markets: Don’t trust. Check the caller. Trade it.",
    description: "Every crypto call priced, scored and kept on Arkiv, then traded in one tap on Definitive Flash.",
    images: ["/brand/og.png"],
  },
  appleWebApp: { capable: true, title: "Kall Markets", statusBarStyle: "default" },
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
  themeColor: "#050605",
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
