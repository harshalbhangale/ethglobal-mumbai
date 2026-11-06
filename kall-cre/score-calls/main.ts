/**
 * score-calls: did the calls whose time is up hit or miss?
 *
 * On a schedule, the CRE nodes ask Kall which calls are due, then each node fetches the price at the minute
 * the call was posted and at the minute it expired (the same one-minute candles Kall's own scoring uses).
 * The nodes take the median, work out the return, sign the verdicts together and write them to
 * KallVerdicts on Base Sepolia. Kall then shows "Scored by Chainlink CRE" with that transaction.
 */
import {
  consensusIdenticalAggregation,
  consensusMedianAggregation,
  CronCapability,
  handler,
  HTTPClient,
  type NodeRuntime,
  Runner,
  type Runtime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { writeVerdict, type ChainConfig } from "../shared/chain";
import { score, STATUS } from "../shared/verdicts";

type Config = ChainConfig & { schedule: string; kallApi: string; maxPerRun: number };

type DueCall = { postId: string; handle: string; asset: string; direction: "up" | "down"; postedAt: number; expiresAt: number };

const SYMBOLS: Record<string, string> = { ETH: "ETHUSDT", BTC: "BTCUSDT" };

/** Kall's list of calls whose deadline has passed and that CRE hasn't scored yet. */
const fetchDue = (node: NodeRuntime<Config>): string => {
  const res = new HTTPClient().sendRequest(node, { url: `${node.config.kallApi}/api/cre/due`, method: "GET" }).result();
  if (res.statusCode !== 200) return "[]";
  return new TextDecoder().decode(res.body);
};

/** Open price (8 decimals) of the one-minute candle that starts at `at`, or 0 when unavailable. */
const priceAt =
  (symbol: string, at: number) =>
  (node: NodeRuntime<Config>): bigint => {
    const res = new HTTPClient()
      .sendRequest(node, {
        url: `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${at * 1000}&limit=1`,
        method: "GET",
      })
      .result();
    if (res.statusCode !== 200) return 0n;
    const rows = JSON.parse(new TextDecoder().decode(res.body)) as [number, string][];
    const open = rows[0]?.[1];
    if (!open) return 0n;
    const [whole, frac = ""] = open.split(".");
    return BigInt(whole + (frac + "00000000").slice(0, 8));
  };

const onSchedule = (runtime: Runtime<Config>): string => {
  const due = (JSON.parse(runtime.runInNodeMode(fetchDue, consensusIdenticalAggregation<string>())().result()) as DueCall[])
    .filter((c) => SYMBOLS[c.asset])
    .slice(0, runtime.config.maxPerRun);
  runtime.log(`${due.length} call(s) due for scoring`);
  if (!due.length) return "nothing due";

  const scored = due.map((c) => {
    const symbol = SYMBOLS[c.asset] as string;
    const entry = runtime.runInNodeMode(priceAt(symbol, c.postedAt), consensusMedianAggregation<bigint>())().result();
    const exit = runtime.runInNodeMode(priceAt(symbol, c.expiresAt), consensusMedianAggregation<bigint>())().result();
    const up = c.direction === "up";
    const { returnBps, status } = score(up, entry, exit);
    const word = status === STATUS.hit ? "HIT" : status === STATUS.miss ? "MISS" : status === STATUS.flat ? "FLAT" : "UNPRICED";
    runtime.log(`@${c.handle} ${up ? "long" : "short"} ${c.asset}: ${entry} → ${exit} = ${returnBps} bps, ${word}`);
    return {
      postId: c.postId,
      handle: c.handle,
      asset: c.asset,
      up,
      postedAt: BigInt(c.postedAt),
      expiresAt: BigInt(c.expiresAt),
      entry,
      exit,
      returnBps,
      status,
    };
  });

  const priced = scored.filter((s) => s.status !== STATUS.open);
  if (!priced.length) return "no prices";
  const body = encodeAbiParameters(
    parseAbiParameters(
      "(string postId, string handle, string asset, bool up, uint64 postedAt, uint64 expiresAt, uint256 entry, uint256 exit, int32 returnBps, uint8 status)[]",
    ),
    [priced],
  );
  const txHash = writeVerdict(runtime, 1, body);
  return JSON.stringify({ scored: priced.length, txHash });
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onSchedule)];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
