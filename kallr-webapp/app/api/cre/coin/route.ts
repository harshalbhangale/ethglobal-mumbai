import { getAddress } from "viem";
import { z } from "zod";
import { creLocal, readCoinVerdict, runCoinCheck, VERDICTS } from "@/lib/server/cre";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

const ask = z.object({
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  claimed: z.string().regex(/^\$?[A-Za-z][A-Za-z0-9]{0,11}$/),
});

/**
 * GET ?token=&claimed= → the Chainlink CRE verdict for a coin named in a post: real, fake or unknown,
 * with the Base Sepolia transaction CRE signed. `checked: false` when CRE hasn't looked at it yet.
 */
export async function GET(req: Request) {
  const q = ask.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json({ error: "token and claimed are required" }, { status: 400 });
  if (!VERDICTS) return Response.json({ checked: false, configured: false });
  const v = await readCoinVerdict(getAddress(q.data.token), q.data.claimed).catch(() => null);
  return Response.json(v ? { checked: true, ...v } : { checked: false, configured: true, canRun: creLocal });
}

/** POST { token, claimed } → asks CRE to check it now (local demo mode), then returns the verdict. */
export async function POST(req: Request) {
  const q = ask.safeParse(await req.json().catch(() => null));
  if (!q.success) return Response.json({ error: "token and claimed are required" }, { status: 400 });
  if (!VERDICTS || !creLocal) return Response.json({ checked: false, canRun: false }, { status: 409 });
  const token = getAddress(q.data.token);
  try {
    await runCoinCheck(token, q.data.claimed);
  } catch (e) {
    return Response.json({ checked: false, error: e instanceof Error ? e.message.slice(0, 300) : "CRE run failed" }, { status: 502 });
  }
  const v = await readCoinVerdict(token, q.data.claimed);
  return Response.json(v ? { checked: true, ...v } : { checked: false });
}
