import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";

/**
 * Anon-RPC: the web app's chain reads (balances, Chainlink prices, receipts on Base, and the Arkiv feed)
 * go through one hash-pinned anon-rpc worker, so the RPC provider can't tie them to the user's IP.
 *
 * - One worker per page, started on the first read. Calls made before it is ready are buffered by the
 *   harness, in order.
 * - The network is Nym by default (no config, mainnet specifier). NEXT_PUBLIC_ANON_RPC picks another:
 *   "tor" (demo gateway), "passthrough" (sandbox only, no privacy) or "off".
 * - If the worker can't start or a read times out, that read goes direct and the badge says so: a
 *   read is never silently de-anonymized.
 * - Signing and sending transactions stay in the user's wallet; Kall's server and the keyboards aren't
 *   covered (no browser there).
 */

type NetworkId = "nym" | "tor" | "passthrough";
const NETWORKS: Record<NetworkId, { label: string; address: string; config?: Record<string, unknown> }> = {
  nym: { label: "Nym mixnet", address: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0" },
  tor: {
    label: "Tor",
    address: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e",
    config: { gateways: ["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"] },
  },
  passthrough: { label: "Passthrough (no privacy)", address: "0x4fd77be300f31c5fe6ab266d35d27750a3478d27" },
};

const choice = (process.env.NEXT_PUBLIC_ANON_RPC ?? "nym").toLowerCase();
const ENABLED = choice !== "off";
const NETWORK: NetworkId = choice in NETWORKS ? (choice as NetworkId) : "nym";

/** How long one read may wait on the worker (including its boot) before it goes direct. */
const READ_TIMEOUT_MS = 45_000;

export type AnonStatus = {
  enabled: boolean;
  network: string;
  state: "idle" | "starting" | "ready" | "failed";
  /** Reads answered through the anon-rpc worker. */
  anonymized: number;
  /** Reads that went direct because the worker was unavailable. */
  direct: number;
  /** Time the worker took to become ready. */
  bootMs: number | null;
  error: string | null;
  /** Why the most recent read went direct. */
  lastDirect: string | null;
  /** Average time of a read through the worker (from when it was handed over). */
  avgMs: number | null;
};

let status: AnonStatus = {
  enabled: ENABLED,
  network: NETWORKS[NETWORK].label,
  state: "idle",
  anonymized: 0,
  direct: 0,
  bootMs: null,
  error: null,
  lastDirect: null,
  avgMs: null,
};
const trace: Array<{ url: string; status: number; ms: number; bytes: number }> = [];
// Inspect from the console: window.__anonRpc, window.__anonRpcTrace
if (typeof window !== "undefined") Object.defineProperty(window, "__anonRpcTrace", { get: () => trace, configurable: true });
if (typeof window !== "undefined") Object.defineProperty(window, "__anonRpc", { get: () => status, configurable: true });
const listeners = new Set<() => void>();
function set(patch: Partial<AnonStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

type Worker = { ready: Promise<void>; fetch: typeof fetch; close(): void };
let worker: Promise<Worker | null> | null = null;

/**
 * The bootstrap read: the harness reads the specifier contract once on Ethereum mainnet to learn the
 * worker's hash. This is the one read that doesn't go through anon-rpc, and it carries nothing about
 * the user.
 */
const BOOTSTRAP_RPCS = [
  process.env.NEXT_PUBLIC_ETH_RPC_URL,
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
].filter((u): u is string => Boolean(u));
const bootstrap = createPublicClient({ chain: mainnet, transport: fallback(BOOTSTRAP_RPCS.map((u) => http(u, { timeout: 8_000, retryCount: 0 }))) });

/** Nym picks a random gateway; some can't serve browsers. A fresh worker picks another. */
const MAX_ATTEMPTS = 3;
const BOOT_TIMEOUT_MS = 40_000;
let attempt = 0;

function start(): Promise<Worker | null> {
  if (worker) return worker;
  attempt += 1;
  const mine = attempt;
  worker = (async () => {
    const began = performance.now();
    set({ state: "starting", error: null });
    try {
      const { AnonRpcWorker } = await import("@anon-rpc/browser-harness");
      const n = NETWORKS[NETWORK];
      const w = new AnonRpcWorker({
        address: n.address,
        config: n.config as never,
        preExisting: {
          rpcProvider: { request: ({ method, params }) => bootstrap.request({ method, params } as never) },
        },
      }) as unknown as Worker;
      const bootTimer = setTimeout(() => restart(w, "didn't connect in 40s"), BOOT_TIMEOUT_MS);
      w.ready.then(
        () => {
          clearTimeout(bootTimer);
          if (mine === attempt) set({ state: "ready", bootMs: Math.round(performance.now() - began), error: null });
        },
        (e: unknown) => {
          clearTimeout(bootTimer);
          restart(w, e instanceof Error ? e.message : String(e));
        },
      );
      return w;
    } catch (e) {
      set({ state: "failed", error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  })();
  return worker;
}

/** Drop a worker that can't serve and start another, until MAX_ATTEMPTS; then reads go direct. */
function restart(w: Worker, why: string) {
  void worker?.then((current) => {
    if (current !== w) return; // already replaced
    try {
      w.close();
    } catch {}
    worker = null;
    if (attempt >= MAX_ATTEMPTS) {
      set({ state: "failed", error: why });
      return;
    }
    set({ error: why });
    void start();
  });
}

const looksLikeTransportFailure = (e: unknown) => /gateway|tunnel|mixnet|connection|closed/i.test(e instanceof Error ? e.message : String(e));

function directFetch(input: RequestInfo | URL, init?: RequestInit, why?: string) {
  set({ direct: status.direct + 1, ...(why ? { lastDirect: why } : {}) });
  return fetch(input, init);
}

/**
 * A drop-in `fetch` for RPC reads: through the anon-rpc worker when it can serve, direct otherwise.
 * Server-side (no window) it is plain fetch.
 */
export async function anonFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof window === "undefined" || !ENABLED) return fetch(input, init);
  const w = await start();
  if (!w || status.state === "failed") return directFetch(input, init);

  // The caller's own abort (viem's timeout) still applies; ours bounds a worker that never boots.
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const t0 = performance.now();
    const res = await w.fetch(input, { ...init, signal });
    const ms = performance.now() - t0;
    trace.push({ url: input instanceof Request ? input.url : String(input), status: res.status, ms: Math.round(ms), bytes: Number(res.headers.get("content-length") ?? -1) });
    if (trace.length > 20) trace.shift();
    const n = status.anonymized;
    set({ anonymized: n + 1, avgMs: Math.round(((status.avgMs ?? ms) * n + ms) / (n + 1)) });
    return res;
  } catch (e) {
    // The caller gave up: don't retry behind their back.
    if (init?.signal?.aborted) throw e;
    // A dead gateway or tunnel: replace the worker so later reads get a working one.
    if (looksLikeTransportFailure(e)) restart(w, e instanceof Error ? e.message : String(e));
    const host = (() => {
      try {
        return new URL(input instanceof Request ? input.url : String(input)).host;
      } catch {
        return "?";
      }
    })();
    return directFetch(input, init, `${host}: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`);
  }
}

/**
 * Where the browser sends Arkiv reads: Kall's relay (app/api/arkiv/rpc), reached through the mixnet.
 * The mixnet exit can't reach localhost, so local dev uses the deployed relay. Undefined (Arkiv's own
 * RPC, direct) when Anon-RPC is off.
 */
export function arkivRelayUrl(): string | undefined {
  if (typeof window === "undefined" || !ENABLED) return undefined;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const origin = local ? (process.env.NEXT_PUBLIC_RELAY_ORIGIN ?? "https://kall-markets.vercel.app") : window.location.origin;
  return `${origin}/api/arkiv/rpc`;
}

/** Start the worker early (on page load) so the first read doesn't pay for the boot. */
export function warmAnonRpc() {
  if (typeof window !== "undefined" && ENABLED) void start();
}

/** For the UI: subscribe to status changes, and read the current status. */
export function subscribeAnonRpc(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const getAnonRpcStatus = () => status;
export const serverAnonRpcStatus: AnonStatus = { ...status };
