import "server-only";

/**
 * Swarm storage for call snapshots. Uploads go through the Swarm Foundation's public gateway, which
 * stamps them with its own postage batch, unless SWARM_API_URL points at our own Bee node and
 * SWARM_POSTAGE_BATCH_ID names our batch. Snapshots are public post text, so they're uploaded
 * unencrypted and the plain reference is safe to keep in a public Arkiv entity.
 */

export const SWARM_API_URL = (process.env.SWARM_API_URL ?? "https://api.gateway.ethswarm.org").replace(/\/$/, "");
const BATCH_ID = process.env.SWARM_POSTAGE_BATCH_ID;

/** Where anyone can read a reference. */
export function swarmUrl(reference: string) {
  return `${SWARM_API_URL}/bzz/${reference}/`;
}

/** Uploads a JSON document and returns its 64-hex Swarm reference. */
export async function uploadJson(name: string, value: unknown): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (BATCH_ID) headers["swarm-postage-batch-id"] = BATCH_ID;
  const res = await fetch(`${SWARM_API_URL}/bzz?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Swarm upload failed (${res.status})`);
  const { reference } = (await res.json()) as { reference?: string };
  if (!reference || !/^[0-9a-f]{64}$/.test(reference)) throw new Error("Swarm returned no reference");
  return reference;
}
