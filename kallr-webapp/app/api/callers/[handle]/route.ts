import { checkPostAvailability } from "@kallr/integrations/calls";
import { callerRecordFromArkiv } from "@/lib/server/arkiv";

export const dynamic = "force-dynamic";

/**
 * A caller's record from Arkiv (settled and open calls), for the Kall Extension's profile card, plus how
 * many of those posts are no longer public on X (deleted, or the account went private). Arkiv keeps the
 * call either way. Cached for 60s per handle; each post's X status for 30 minutes.
 */
const cache = new Map<string, { at: number; body: unknown }>();
const seen = new Map<string, { at: number; gone: boolean | null }>();
const MAX_CHECKED = 25;

async function isGone(postId: string): Promise<boolean | null> {
  const hit = seen.get(postId);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.gone;
  const { status } = await checkPostAvailability(postId).catch(() => ({ status: "unavailable" as const }));
  const gone = status === "not-publicly-available" ? true : status === "available" ? false : null;
  if (seen.size > 20_000) seen.clear();
  seen.set(postId, { at: Date.now(), gone });
  return gone;
}

export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return Response.json({ error: "handle must be an X handle" }, { status: 400 });
  const key = handle.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.body);
  try {
    const record = await callerRecordFromArkiv(key);
    const base = record ?? { calls: [], writer: null };
    const checked = base.calls.slice(0, MAX_CHECKED);
    const status = await Promise.all(checked.map((c) => isGone(c.postId)));
    const calls = base.calls.map((c, i) => (status[i] === true ? { ...c, gone: true } : c));
    const body = {
      ...base,
      calls,
      // Posts no longer public on X: counted only where X answered, so a failed check never counts.
      deleted: status.filter((s) => s === true).length,
      deletedChecked: status.filter((s) => s !== null).length,
    };
    if (cache.size > 1000) cache.clear();
    cache.set(key, { at: Date.now(), body });
    return Response.json(body, { headers: { "cache-control": "public, max-age=60" } });
  } catch {
    return Response.json({ error: "Couldn't read Arkiv right now" }, { status: 502 });
  }
}
