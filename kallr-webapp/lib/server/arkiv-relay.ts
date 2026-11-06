/** What the Arkiv relay (app/api/arkiv/rpc) forwards: Arkiv's read methods and a few chain reads. */

export const ARKIV_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network";

const ALLOWED = new Set(["arkiv_query", "arkiv_getEntity", "arkiv_getBlockTiming", "eth_chainId", "eth_blockNumber", "net_version"]);
const MAX_BATCH = 20;

/** True for one JSON-RPC call, or a batch of up to 20, using only read methods. */
export function relayable(body: unknown): boolean {
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return false;
  return calls.every((c) => {
    const method = c && typeof c === "object" ? (c as { method?: unknown }).method : undefined;
    return typeof method === "string" && ALLOWED.has(method);
  });
}
