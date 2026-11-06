import { generateKeyPairSync, sign, verify } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Throwaway keys and IDs made for these tests, never real ones.
const APP_ID = "test-app";
const signerKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const loginKey = generateKeyPairSync("ec", { namedCurve: "P-256" });

beforeAll(() => {
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = APP_ID;
  process.env.PRIVY_APP_SECRET = "test-secret";
  process.env.PRIVY_AUTHORIZATION_KEY = `wallet-auth:${signerKey.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}`;
  process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID = "test-signer";
});
afterEach(() => vi.unstubAllGlobals());

const WALLET = "0x2222222222222222222222222222222222222222";

describe("X key", () => {
  it("round-trips the wallet it was issued for", async () => {
    const { issueXKey, readXKey } = await import("./x-key");
    const { key } = issueXKey({ user: "did:privy:abc", walletId: "w1", address: WALLET }, 1_000);
    expect(readXKey(key, 2_000)).toMatchObject({ user: "did:privy:abc", walletId: "w1", address: WALLET });
  });

  it("rejects an edited key and an expired one", async () => {
    const { issueXKey, readXKey } = await import("./x-key");
    const { key, expires } = issueXKey({ user: "did:privy:abc", walletId: "w1", address: WALLET }, 1_000);
    const [payload, sig] = key.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), w: "someone-else" })).toString("base64url");
    expect(readXKey(`${forged}.${sig}`, 2_000)).toBeNull();
    expect(readXKey(key, expires + 1)).toBeNull();
  });
});

describe("Privy requests", () => {
  it("canonicalizes with sorted keys and no spaces", async () => {
    const { canonicalize } = await import("./privy-wallet");
    expect(canonicalize({ b: [2, { d: 1, c: "x" }], a: null, skip: undefined })).toBe('{"a":null,"b":[2,{"c":"x","d":1}]}');
  });

  it("signs the canonical request with the authorization key", async () => {
    const { authorizationSignature, canonicalize } = await import("./privy-wallet");
    const url = "https://api.privy.io/v1/wallets/w1/rpc";
    const body = { method: "eth_signTypedData_v4", params: { typed_data: { primary_type: "FlashOrder" } } };
    const signature = authorizationSignature(url, body);
    const payload = canonicalize({ version: 1, method: "POST", url, body, headers: { "privy-app-id": APP_ID } });
    expect(verify("sha256", Buffer.from(payload), signerKey.publicKey, Buffer.from(signature, "base64"))).toBe(true);
  });
});

describe("Privy sign-in check", () => {
  const jwt = (claims: Record<string, unknown>, key = loginKey.privateKey) => {
    const h = Buffer.from(JSON.stringify({ alg: "ES256", kid: "k1" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const s = sign("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return `${h}.${p}.${s}`;
  };
  const jwks = () =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ keys: [{ ...loginKey.publicKey.export({ format: "jwk" }), kid: "k1" }] })));
  const exp = () => Math.floor(Date.now() / 1000) + 600;

  it("returns the user for a valid access token", async () => {
    jwks();
    const { privyUserFromToken } = await import("./privy-wallet");
    expect(await privyUserFromToken(jwt({ iss: "privy.io", aud: APP_ID, sub: "did:privy:abc", exp: exp() }))).toBe("did:privy:abc");
  });

  it("refuses another app's token, an expired one and a wrong signature", async () => {
    jwks();
    const { privyUserFromToken } = await import("./privy-wallet");
    expect(await privyUserFromToken(jwt({ iss: "privy.io", aud: "other-app", sub: "did:privy:abc", exp: exp() }))).toBeNull();
    expect(await privyUserFromToken(jwt({ iss: "privy.io", aud: APP_ID, sub: "did:privy:abc", exp: 1 }))).toBeNull();
    const stranger = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect(await privyUserFromToken(jwt({ iss: "privy.io", aud: APP_ID, sub: "did:privy:abc", exp: exp() }, stranger))).toBeNull();
  });
});
