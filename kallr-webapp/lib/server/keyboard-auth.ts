import "server-only";
import { flashCancelMessage, type FlashOrderInput } from "@kallr/integrations/definitive";
import type { Hex } from "viem";
import { flash } from "./flash";
import { placeWithSigner } from "./flash-place";
import { authorized, cancelFromKeyboardWallet, keyboardWalletAddress, MAX_ORDER_USD, placeFromKeyboardWallet } from "./keyboard-wallet";
import { privySigner, serverSigningReady } from "./privy-wallet";
import { bearer, readXKey } from "./x-key";

/**
 * Which wallet a Kall Keyboard request trades from.
 *
 * - "kall": the user's own Kall wallet (Privy's embedded wallet, the same one as the web app and X),
 *   when the app sends the key the web app gave it at linking. Signed on the server through Kall's
 *   Privy signer, capped per order like trades from X.
 * - "shared": the old server-held keyboard wallet, for builds that still send the build token. Kept
 *   only while its funds move to the user's Kall wallet.
 */
type Placement = Awaited<ReturnType<typeof placeFromKeyboardWallet>>;

export type KeyboardWallet = {
  kind: "kall" | "shared";
  address: Hex;
  maxUsd: number;
  place: (input: FlashOrderInput, dryRun: boolean) => Promise<Placement>;
  cancel: (orderId: string) => Promise<unknown>;
};

const MAX_KALL_USD = Number(process.env.KALL_X_MAX_USD ?? "25");

// One order per Kall wallet at a time, so approvals never race the wallet's nonce.
const queues = new Map<string, Promise<unknown>>();

export function keyboardWallet(req: Request): KeyboardWallet | { error: string; status: number } {
  const key = readXKey(bearer(req));
  if (key) {
    if (!serverSigningReady) return { error: "Kall wallet signing isn't set up on this server yet.", status: 503 };
    const signer = privySigner(key.walletId, key.address);
    return {
      kind: "kall",
      address: key.address,
      maxUsd: MAX_KALL_USD,
      place: (input, dryRun) => {
        const run = (queues.get(key.walletId) ?? Promise.resolve()).then(() => placeWithSigner(input, signer, { dryRun }));
        queues.set(key.walletId, run.catch(() => undefined));
        return run;
      },
      cancel: async (orderId) => flash.cancel(orderId, await signer.signMessage(flashCancelMessage(orderId))),
    };
  }
  if (authorized(req) && keyboardWalletAddress)
    return { kind: "shared", address: keyboardWalletAddress, maxUsd: MAX_ORDER_USD, place: placeFromKeyboardWallet, cancel: cancelFromKeyboardWallet };
  return { error: "Link your Kall wallet in the Kall app first.", status: 401 };
}

/** The wallet a read-only keyboard request is about: the linked Kall wallet, else the shared one. */
export function keyboardWalletAddressFor(req: Request): Hex | null {
  return readXKey(bearer(req))?.address ?? keyboardWalletAddress;
}
