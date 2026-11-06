import { appOrigin } from "./config";

/**
 * Who signs a trade on the X card. By default your Kall wallet, on Kall's server with no pop-up,
 * once you turn on "Trade from X" in Kall Markets › Wallet (that hands this extension a key for
 * it). MetaMask on the page if you'd rather sign each step yourself. Kept in chrome.storage.local.
 */

export type Signer = "kall" | "metamask";
type XKey = { key: string; address: string; expires: number };
/** What the card and the app may see: the wallet and when the key expires, never the key. */
export type XStatus = { kall: { address: string; expires: number } | null; signer: Signer };

const KEY = "kallr.xkey";
const SIGNER = "kallr.signer";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,1500}\.[A-Za-z0-9_-]{20,100}$/;

async function readKey(): Promise<XKey | null> {
  const v = (await chrome.storage.local.get(KEY))[KEY] as Partial<XKey> | undefined;
  if (typeof v?.key !== "string" || typeof v.address !== "string" || typeof v.expires !== "number" || v.expires < Date.now()) return null;
  return { key: v.key, address: v.address, expires: v.expires };
}

export async function xStatus(): Promise<XStatus> {
  const [key, stored] = await Promise.all([readKey(), chrome.storage.local.get(SIGNER)]);
  return { kall: key && { address: key.address, expires: key.expires }, signer: stored[SIGNER] === "metamask" ? "metamask" : "kall" };
}

export async function setSigner(signer: unknown): Promise<XStatus> {
  if (signer === "metamask") await chrome.storage.local.set({ [SIGNER]: "metamask" });
  else if (signer === "kall") await chrome.storage.local.remove(SIGNER);
  return xStatus();
}

/** From Kall Markets' bridge: store, read or forget the key. Answers with the public part only. */
export async function xKey(message: { op?: unknown; key?: unknown; address?: unknown; expires?: unknown }) {
  if (message.op === "set") {
    const { key, address, expires } = message;
    if (typeof key !== "string" || !TOKEN.test(key) || typeof address !== "string" || !ADDRESS.test(address) || typeof expires !== "number") return null;
    await chrome.storage.local.set({ [KEY]: { key, address, expires } });
  } else if (message.op === "clear") {
    await chrome.storage.local.remove(KEY);
  }
  return (await xStatus()).kall;
}

/** Places a card order from the Kall wallet on Kall's server. Errors come back as { failed }. */
export async function placeWithKall(order: unknown, caller: unknown) {
  const key = await readKey();
  if (!key) return { failed: "Turn on trading from X in Kall Markets › Wallet first." };
  const res = await fetch(`${appOrigin}/api/x/order`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` },
    body: JSON.stringify({ order, caller }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  // The key expired or was revoked: forget it so the card stops offering it.
  if (res.status === 401) await chrome.storage.local.remove(KEY);
  return res.ok ? json : { failed: json.error ?? `Kall Markets answered ${res.status}.` };
}
