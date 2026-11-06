import { kallWalletOf, privyUserFromToken, serverSigningReady } from "@/lib/server/privy-wallet";
import { bearer, issueXKey, readXKey } from "@/lib/server/x-key";

/**
 * The extension's key for trading from X with the Kall wallet.
 *
 *   POST (Bearer: Privy access token) → { key, address, expires }, after the user added Kall's signer
 *   GET  (Bearer: X key)              → { address, expires } while the key is valid
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!serverSigningReady) return Response.json({ error: "Trading from X isn't set up on this server yet." }, { status: 503 });
  const user = await privyUserFromToken(bearer(req));
  if (!user) return Response.json({ error: "Sign in again, then try once more." }, { status: 401 });
  try {
    const wallet = await kallWalletOf(user);
    if (!wallet) return Response.json({ error: "Your Kall wallet isn't ready yet. Reload and try again." }, { status: 404 });
    const { key, expires } = issueXKey({ user, walletId: wallet.id, address: wallet.address });
    return Response.json({ key, address: wallet.address, expires });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't reach Privy." }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const key = readXKey(bearer(req));
  if (!key) return Response.json({ error: "Turn on trading from X in Kall Markets › Wallet." }, { status: 401 });
  return Response.json({ address: key.address, expires: key.expires });
}
