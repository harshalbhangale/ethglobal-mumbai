"use client";

/**
 * A key for the user's Kall wallet, for apps that trade from it without a wallet pop-up (the X
 * extension, the Kall Keyboard). Adds Kall's signer to the wallet on Privy (once), then asks the server
 * for a key naming that one wallet. Orders made with it are capped, and pay from and back to it.
 */

export const SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID ?? "";

export type KallKey = { key: string; address: string; expires: number };

export async function issueKallKey(opts: {
  address: string;
  addSigners: (args: { address: string; signers: Array<{ signerId: string }> }) => Promise<unknown>;
  getAccessToken: () => Promise<string | null>;
}): Promise<KallKey> {
  if (!SIGNER_ID) throw new Error("Kall wallet signing isn't set up on this server yet.");
  await opts.addSigners({ address: opts.address, signers: [{ signerId: SIGNER_ID }] }).catch((e: unknown) => {
    // Already added on an earlier visit: carry on.
    if (!/already/i.test(e instanceof Error ? e.message : "")) throw e;
  });
  const res = await fetch("/api/x/key", { method: "POST", headers: { authorization: `Bearer ${await opts.getAccessToken()}` } });
  const body = (await res.json().catch(() => ({}))) as Partial<KallKey> & { error?: string };
  if (!res.ok || !body.key || !body.address || !body.expires) throw new Error(body.error ?? "Couldn't link your Kall wallet. Try again.");
  return { key: body.key, address: body.address, expires: body.expires };
}
