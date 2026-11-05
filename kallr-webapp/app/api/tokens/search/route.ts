import { FLASH_PUBLIC_DEV_KEY, flashClient } from "@kallr/integrations/definitive";
import { errorResponse, flash } from "@/lib/server/flash";

/** Some integrator keys aren't enabled for search (403 SEARCH_NOT_ELIGIBLE); the public key is. */
const publicFlash = flashClient({ apiKey: FLASH_PUBLIC_DEV_KEY });
async function search(q: string) {
  try {
    return await flash.search(q, 8);
  } catch (err) {
    if ((err as { status?: number }).status === 403 || /NOT_ELIGIBLE/i.test(String((err as Error).message))) return publicFlash.search(q, 8);
    throw err;
  }
}

/**
 * Token search for the extension's token picker and the desk: symbol, name or a pasted contract
 * address, Base only, through Definitive Flash (the API key stays on the server). Answers are kept
 * for 60s per query so typing doesn't hammer Flash.
 */
export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; tokens: unknown }>();

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 64 || !/^[\w .$-]+$/.test(q)) return Response.json({ tokens: [] });
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json({ tokens: hit.tokens });
  try {
    const tokens = (await search(q)).map((t) => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name ?? t.symbol,
      decimals: t.decimals,
      price: t.price ?? null,
      liquidity: t.liquidity ?? null,
      change24h: t.priceChange24h ?? null,
      imageUrl: t.imageUrl ?? null,
      riskFlagged: t.riskFlagged === true,
    }));
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), tokens });
    return Response.json({ tokens }, { headers: { "cache-control": "public, max-age=60" } });
  } catch (err) {
    return errorResponse(err);
  }
}
