import type { Address } from "viem";
import { getBalances } from "@/lib/chain";

/** The keyboard's wallet header: ETH (gas) and USDC (to spend) on Base for the embedded wallet. Read-only. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "Invalid address" }, { status: 400 });
  try {
    const { eth, usdc } = await getBalances(address as Address);
    return Response.json({ address, eth, usdc, chain: "base" });
  } catch {
    return Response.json({ error: "Couldn't read balances on Base" }, { status: 502 });
  }
}
