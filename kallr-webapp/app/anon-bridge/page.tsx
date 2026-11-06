import type { Metadata } from "next";
import { AnonBridge } from "./bridge";

export const metadata: Metadata = {
  title: "Kall Keyboard · Anon-RPC",
  robots: { index: false, follow: false },
};

/** Loaded by the Kall Keyboard on iPhone in a hidden web view: see bridge.tsx. */
export default function AnonBridgePage() {
  return <AnonBridge />;
}
