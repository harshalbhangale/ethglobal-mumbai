import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hex } from "viem";

/**
 * The X key: what the extension sends to place orders from the user's Kall wallet. Issued after a
 * Privy sign-in check, it names one wallet and expires; it can't move funds, only place capped Flash
 * orders that pay back into that same wallet. Signed with a key derived from the Privy app secret.
 */

export type XKey = { user: string; walletId: string; address: Hex; expires: number };

const DAYS = 30;
const secret = () => createHmac("sha256", process.env.PRIVY_APP_SECRET ?? "").update("kall-x-key-v1").digest();
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueXKey(k: Omit<XKey, "expires">, now = Date.now()): { key: string; expires: number } {
  const expires = now + DAYS * 86_400_000;
  const payload = Buffer.from(JSON.stringify({ u: k.user, w: k.walletId, a: k.address, e: expires })).toString("base64url");
  return { key: `${payload}.${mac(payload)}`, expires };
}

export function readXKey(key: string, now = Date.now()): XKey | null {
  const [payload, sig] = key.split(".");
  if (!payload || !sig || !process.env.PRIVY_APP_SECRET) return null;
  const want = Buffer.from(mac(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: string; w?: string; a?: string; e?: number };
    if (!p.u || !p.w || !p.a || !/^0x[0-9a-fA-F]{40}$/.test(p.a) || !p.e || p.e < now) return null;
    return { user: p.u, walletId: p.w, address: p.a as Hex, expires: p.e };
  } catch {
    return null;
  }
}

export const bearer = (req: Request) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
