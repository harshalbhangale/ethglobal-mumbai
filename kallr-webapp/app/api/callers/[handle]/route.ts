import { callerRecordFromArkiv } from "@/lib/server/arkiv";

export const dynamic = "force-dynamic";

/**
 * A caller's record from Arkiv (settled and open calls), for the Kall Extension's profile card.
 * Cached for 60s per handle so busy profiles don't hammer the Arkiv RPC.
 */
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return Response.json({ error: "handle must be an X handle" }, { status: 400 });
  const key = handle.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.body);
  try {
    const record = await callerRecordFromArkiv(key);
    const body = record ?? { calls: [], writer: null };
    if (cache.size > 1000) cache.clear();
    cache.set(key, { at: Date.now(), body });
    return Response.json(body, { headers: { "cache-control": "public, max-age=60" } });
  } catch {
    return Response.json({ error: "Couldn't read Arkiv right now" }, { status: 502 });
  }
}
