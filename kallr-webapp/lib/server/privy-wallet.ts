import "server-only";
import { createPrivateKey, createPublicKey, type JsonWebKey, sign, verify } from "node:crypto";
import type { Hex } from "viem";
import type { ServerSigner } from "./flash-place";

/**
 * The server side of the Kall wallet: Privy's embedded wallet, signing on the server after the user
 * added Kall's signer to it (the Wallet tab's "Trade from X"). Requests to Privy's wallet API carry
 * the app secret and an authorization signature made with the signer's private key.
 *
 * Setup, from dashboard.privy.io: Wallet infrastructure → Authorization keys → new key. Its ID goes in
 * NEXT_PUBLIC_PRIVY_SIGNER_ID, its private key ("wallet-auth:…") in PRIVY_AUTHORIZATION_KEY.
 */

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? "";
const AUTH_KEY = process.env.PRIVY_AUTHORIZATION_KEY ?? "";
const API = "https://api.privy.io/v1";

export const serverSigningReady = Boolean(APP_ID && APP_SECRET && AUTH_KEY && process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID);

/** RFC 8785 JSON: keys sorted at every level, no whitespace. What Privy signs over. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** The privy-authorization-signature header: ECDSA P-256 over the canonical request. */
export function authorizationSignature(url: string, body: unknown, key = AUTH_KEY, appId = APP_ID): string {
  const der = Buffer.from(key.replace(/^wallet-auth:/, ""), "base64");
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const payload = canonicalize({ version: 1, method: "POST", url, body, headers: { "privy-app-id": appId } });
  return sign("sha256", Buffer.from(payload), privateKey).toString("base64");
}

const basicAuth = () => `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64")}`;

async function privy<T>(path: string, body?: unknown): Promise<T> {
  const url = `${API}${path}`;
  const headers: Record<string, string> = { authorization: basicAuth(), "privy-app-id": APP_ID };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers["privy-authorization-signature"] = authorizationSignature(url, body);
  }
  const res = await fetch(url, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(json.error ?? json.message ?? `Privy answered ${res.status}.`);
  return json;
}

// --- Who is signed in: Privy access tokens are ES256 JWTs, checked against the app's public keys ---

let jwks: { at: number; keys: Array<JsonWebKey & { kid?: string }> } | null = null;

async function publicKeys() {
  if (jwks && Date.now() - jwks.at < 3_600_000) return jwks.keys;
  const res = await fetch(`https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`);
  if (!res.ok) throw new Error("Couldn't read Privy's signing keys.");
  jwks = { at: Date.now(), keys: ((await res.json()) as { keys: Array<JsonWebKey & { kid?: string }> }).keys };
  return jwks.keys;
}

/** The Privy user ID (did:privy:…) behind an access token, or null when it isn't a valid one for this app. */
export async function privyUserFromToken(token: string): Promise<string | null> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: string; kid?: string };
    if (header.alg !== "ES256") return null;
    const keys = await publicKeys();
    const jwk = keys.find((k) => !header.kid || k.kid === header.kid);
    if (!jwk) return null;
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    if (!ok) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as { iss?: string; aud?: string | string[]; sub?: string; exp?: number };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== "privy.io" || !aud.includes(APP_ID) || !claims.sub || !claims.exp || claims.exp * 1000 < Date.now()) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

type LinkedWallet = { type: string; wallet_client_type?: string; chain_type?: string; address?: string; id?: string | null };

/** The user's Kall wallet: the Ethereum wallet Privy embedded for them. */
export async function kallWalletOf(userId: string): Promise<{ id: string; address: Hex } | null> {
  const user = await privy<{ linked_accounts?: LinkedWallet[] }>(`/users/${encodeURIComponent(userId)}`);
  const w = user.linked_accounts?.find((a) => a.type === "wallet" && a.wallet_client_type === "privy" && a.chain_type === "ethereum" && a.id && a.address);
  return w?.id && w.address ? { id: w.id, address: w.address as Hex } : null;
}

/** Signs and sends from a user's Kall wallet through Privy's wallet API, on Base. */
export function privySigner(walletId: string, address: Hex): ServerSigner {
  const rpc = <T>(body: Record<string, unknown>) => privy<{ data: T }>(`/wallets/${encodeURIComponent(walletId)}/rpc`, body).then((r) => r.data);
  return {
    address,
    async signTypedData(json) {
      const t = JSON.parse(json) as { domain: Record<string, unknown>; types: unknown; primaryType: string; message: unknown };
      const domain = { ...t.domain, ...(t.domain.chainId !== undefined ? { chainId: Number(t.domain.chainId) } : {}) };
      const { signature } = await rpc<{ signature: Hex }>({
        method: "eth_signTypedData_v4",
        params: { typed_data: { domain, types: t.types, message: t.message, primary_type: t.primaryType } },
      });
      return signature;
    },
    async sendTransaction(tx) {
      const { hash } = await rpc<{ hash: Hex }>({
        method: "eth_sendTransaction",
        caip2: "eip155:8453",
        params: { transaction: { to: tx.to, data: tx.data, ...(tx.value && tx.value !== "0" ? { value: `0x${BigInt(tx.value).toString(16)}` } : {}) } },
      });
      return hash;
    },
  };
}
