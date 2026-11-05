import { settleDueCalls } from "@/lib/server/arkiv";

/**
 * Settles calls on Arkiv whose deadline has passed: prices the exit from Chainlink on Base and
 * writes a read-only result. Idempotent. Run it on a schedule (Vercel cron, or curl every few
 * minutes); with CRON_SECRET set it needs `Authorization: Bearer <secret>`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await settleDueCalls(Math.floor(Date.now() / 1000)));
}
