import { dueCallsForCre } from "@/lib/server/arkiv";

export const dynamic = "force-dynamic";

/** Calls whose time is up, for the Chainlink CRE scorer (kall-cre/score-calls). Public, read-only. */
export async function GET() {
  const due = await dueCallsForCre(Math.floor(Date.now() / 1000)).catch(() => []);
  return Response.json(due);
}
