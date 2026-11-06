import { generateKeyPairSync } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Throwaway keys and tokens made for this test, never real ones.
const shared = generatePrivateKey();
const BUILD_TOKEN = "test-build-token";
const KALL = "0x00000000000000000000000000000000000000c4";

beforeAll(() => {
  process.env.KALL_EXEC_PRIVATE_KEY = shared;
  process.env.KALL_EXEC_TOKEN = BUILD_TOKEN;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-app";
  process.env.PRIVY_APP_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID = "test-signer";
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  process.env.PRIVY_AUTHORIZATION_KEY = `wallet-auth:${key}`;
});

const req = (auth?: string) => new Request("https://kall.test/api/keyboard/execute", { headers: auth ? { authorization: `Bearer ${auth}` } : {} });

describe("which wallet the keyboard trades from", () => {
  it("is the user's own Kall wallet when the app sends its linking key", async () => {
    const { issueXKey } = await import("./x-key");
    const { keyboardWallet, keyboardWalletAddressFor } = await import("./keyboard-auth");
    const { key } = issueXKey({ user: "did:privy:abc", walletId: "w1", address: KALL });
    const wallet = keyboardWallet(req(key));
    expect("error" in wallet).toBe(false);
    if ("error" in wallet) return;
    expect(wallet.kind).toBe("kall");
    expect(wallet.address).toBe(KALL);
    expect(wallet.maxUsd).toBe(25);
    expect(keyboardWalletAddressFor(req(key))).toBe(KALL);
  });

  it("falls back to the shared keyboard wallet for builds with the old token, while funds move", async () => {
    const { keyboardWallet } = await import("./keyboard-auth");
    const wallet = keyboardWallet(req(BUILD_TOKEN));
    expect("error" in wallet ? null : wallet.kind).toBe("shared");
    expect("error" in wallet ? null : wallet.address).toBe(privateKeyToAccount(shared).address);
  });

  it("refuses anything else", async () => {
    const { keyboardWallet } = await import("./keyboard-auth");
    expect(keyboardWallet(req())).toEqual({ error: "Link your Kall wallet in the Kall app first.", status: 401 });
    expect(keyboardWallet(req("not-a-key"))).toEqual({ error: "Link your Kall wallet in the Kall app first.", status: 401 });
  });
});
