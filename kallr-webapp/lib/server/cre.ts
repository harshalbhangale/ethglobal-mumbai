import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";
import { createPublicClient, getAddress, http, isAddress, keccak256, parseAbi, parseAbiItem, toBytes, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { logWindows } from "@/lib/log-windows";

/**
 * Chainlink CRE verdicts. The workflows in kall-cre/ decide (coin real or fake, call hit or miss) on
 * Chainlink's nodes and write the signed result to KallVerdicts on Base Sepolia. This module only reads
 * that contract, and in local demo mode (CRE_LOCAL=1, with the cre CLI installed) asks CRE for a new check.
 */

export const VERDICTS: Address | null = isAddress(process.env.KALL_VERDICTS_ADDRESS ?? "") ? getAddress(process.env.KALL_VERDICTS_ADDRESS as string) : null;
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://base-sepolia-rpc.publicnode.com") });

const abi = parseAbi([
  "struct CoinCheck { address token; string claimed; string symbol; address canonical; uint8 verdict; uint64 checkedAt; }",
  "struct CallScore { string postId; string handle; string asset; bool up; uint64 postedAt; uint64 expiresAt; uint256 entry; uint256 exit; int32 returnBps; uint8 status; }",
  "function coinCheck(address token, string claimed) view returns (CoinCheck)",
  "function callScore(string postId) view returns (CallScore)",
]);
const coinChecked = parseAbiItem("event CoinChecked(address indexed token, string claimed, uint8 verdict, string symbol, address canonical)");
const callScored = parseAbiItem("event CallScored(bytes32 indexed postKey, string postId, string handle, uint8 status, int32 returnBps)");

export const VERDICT_WORDS = ["unknown", "real", "fake", "fake", "fake"] as const;
const REASONS = [
  "Chainlink CRE couldn't find a liquid coin with this ticker to compare against.",
  "This is the real coin.",
  "This contract is a different coin than the post names.",
  "Same name, wrong contract: the real coin lives at another address.",
  "There's no token at this address.",
];

export type CoinVerdict = {
  token: Address;
  claimed: string;
  verdict: "unknown" | "real" | "fake";
  reason: string;
  symbol: string;
  canonical: Address | null;
  checkedAt: number;
  txHash: `0x${string}` | null;
  contract: Address;
};

/** The block KallVerdicts was deployed in; log searches start there. */
const FROM_BLOCK = BigInt(process.env.KALL_VERDICTS_FROM_BLOCK ?? "55315000");
/**
 * Log searches get their own RPC: sepolia.base.org allows only 200 blocks per eth_getLogs, publicnode
 * 50,000. The contract is older than one window, so the search walks back in windows from the newest.
 */
const logs = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_LOGS_RPC_URL || "https://base-sepolia-rpc.publicnode.com"),
});
const LOG_SPAN = BigInt(process.env.BASE_SEPOLIA_LOG_SPAN ?? "50000");
/** A verdict's transaction never changes once found. */
const txCache = new Map<string, `0x${string}`>();

/** The transaction that wrote the newest matching event, or null. */
const txOf = async (event: typeof coinChecked | typeof callScored, args: Record<string, unknown>, cacheKey: string) => {
  if (!VERDICTS) return null;
  const known = txCache.get(cacheKey);
  if (known) return known;
  const latest = await logs.getBlockNumber().catch(() => null);
  if (latest === null) return null;
  for (const window of logWindows(FROM_BLOCK, latest, LOG_SPAN)) {
    const found = await logs
      .getLogs({ address: VERDICTS, event: event as typeof coinChecked, args, ...window })
      .catch(() => []);
    const hash = found.at(-1)?.transactionHash;
    if (hash) {
      txCache.set(cacheKey, hash);
      return hash;
    }
  }
  return null;
};

/** The CRE verdict for (token, ticker), or null when CRE hasn't checked it. */
export async function readCoinVerdict(token: Address, claimed: string): Promise<CoinVerdict | null> {
  if (!VERDICTS) return null;
  const ticker = claimed.replace(/^\$/, "").toUpperCase();
  const c = await client.readContract({ address: VERDICTS, abi, functionName: "coinCheck", args: [token, ticker] });
  if (!c.checkedAt) return null;
  return {
    token,
    claimed: ticker,
    verdict: VERDICT_WORDS[c.verdict] ?? "unknown",
    reason: REASONS[c.verdict] ?? REASONS[0],
    symbol: c.symbol,
    canonical: c.canonical === "0x0000000000000000000000000000000000000000" ? null : c.canonical,
    checkedAt: Number(c.checkedAt),
    txHash: await txOf(coinChecked, { token }, `coin:${token}:${ticker}`),
    contract: VERDICTS,
  };
}

/** The CRE score for a call, or null when CRE hasn't scored it. */
export async function readCallScore(postId: string) {
  if (!VERDICTS) return null;
  const s = await client.readContract({ address: VERDICTS, abi, functionName: "callScore", args: [postId] });
  if (!s.expiresAt) return null;
  return {
    postId,
    status: (["open", "hit", "miss", "flat"] as const)[s.status] ?? "open",
    returnBps: s.returnBps,
    entry: Number(s.entry) / 1e8,
    exit: Number(s.exit) / 1e8,
    // CallScored is indexed by keccak256(postId): this finds this call's score, not just the newest one.
    txHash: await txOf(callScored, { postKey: keccak256(toBytes(postId)) }, `call:${postId}`),
    contract: VERDICTS,
  };
}

/** True when this server can ask CRE for a fresh check: local demo mode with the cre CLI. */
export const creLocal = process.env.CRE_LOCAL === "1";

/**
 * Runs the check-coin workflow in the CRE simulator, which writes its signed verdict to Base Sepolia
 * (--broadcast). Local demo mode only: a deployed workflow is triggered over HTTP instead.
 */
export function runCoinCheck(token: Address, claimed: string): Promise<void> {
  const dir = path.resolve(process.cwd(), "..", "kall-cre");
  const payload = JSON.stringify({ token, claimed: claimed.replace(/^\$/, "").toUpperCase() });
  return new Promise((resolve, reject) =>
    execFile(
      "cre",
      ["workflow", "simulate", "check-coin", "--non-interactive", "--trigger-index", "0", "--http-payload", payload, "--broadcast", "--target", "staging-settings"],
      { cwd: dir, timeout: 180_000 },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}
