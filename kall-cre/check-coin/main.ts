/**
 * check-coin: is the contract a post points at really the coin it names?
 *
 * Every CRE node reads the contract's symbol on Base and asks Dexscreener which Base token is the real one
 * for that ticker (the most liquid pair). They must agree, then the verdict is signed and written to
 * KallVerdicts on Base Sepolia, where Kall's apps read it before they let anyone trade.
 */
import {
  consensusIdenticalAggregation,
  decodeJson,
  handler,
  HTTPCapability,
  HTTPClient,
  type HTTPPayload,
  type NodeRuntime,
  Runner,
  type Runtime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, getAddress, isAddress, parseAbiParameters, zeroAddress } from "viem";
import { decide, VERDICT_LABEL } from "../shared/verdicts";
import { readSymbol, writeVerdict, type ChainConfig } from "../shared/chain";

type Config = ChainConfig;
type Ask = { token: string; claimed: string };
type Pair = { chainId?: string; baseToken?: { address?: string; symbol?: string }; liquidity?: { usd?: number } };

/** The real Base contract for a ticker: the most liquid Base pair whose base token has that symbol. */
const canonicalFor =
  (claimed: string) =>
  (node: NodeRuntime<Config>): string => {
    const res = new HTTPClient()
      .sendRequest(node, { url: `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(claimed)}`, method: "GET" })
      .result();
    if (res.statusCode !== 200) return "";
    const pairs = (JSON.parse(new TextDecoder().decode(res.body)) as { pairs?: Pair[] }).pairs ?? [];
    let best = "";
    let bestLiq = 0;
    for (const p of pairs) {
      const addr = p.baseToken?.address ?? "";
      if (p.chainId !== "base" || (p.baseToken?.symbol ?? "").toUpperCase() !== claimed || !isAddress(addr)) continue;
      const liq = p.liquidity?.usd ?? 0;
      if (liq > bestLiq) {
        best = getAddress(addr);
        bestLiq = liq;
      }
    }
    return bestLiq >= 50_000 ? best : ""; // under $50k of liquidity nothing counts as "the real one"
  };

const onCheck = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const ask = decodeJson(payload.input) as Ask;
  if (!isAddress(ask.token)) throw new Error("token must be an address");
  const token = getAddress(ask.token);
  const claimed = ask.claimed.replace(/^\$/, "").toUpperCase().slice(0, 12);

  const symbol = readSymbol(runtime, token);
  runtime.log(`Contract ${token} says it is ${symbol ? `$${symbol}` : "not a token"}`);
  const canonical = runtime.runInNodeMode(canonicalFor(claimed), consensusIdenticalAggregation<string>())().result();
  runtime.log(canonical ? `The real $${claimed} on Base is ${canonical}` : `No liquid $${claimed} on Base`);

  const verdict = decide(token, claimed, symbol, canonical);
  runtime.log(`Verdict for $${claimed} at ${token}: ${VERDICT_LABEL[verdict]}`);

  const body = encodeAbiParameters(
    parseAbiParameters("(address token, string claimed, string symbol, address canonical, uint8 verdict, uint64 checkedAt)"),
    [
      {
        token,
        claimed,
        symbol,
        canonical: (canonical || zeroAddress) as `0x${string}`,
        verdict,
        checkedAt: BigInt(Math.floor(runtime.now().getTime() / 1000)),
      },
    ],
  );
  const txHash = writeVerdict(runtime, 0, body);
  return JSON.stringify({ token, claimed, symbol, canonical, verdict, label: VERDICT_LABEL[verdict], txHash });
};

const initWorkflow = () => [handler(new HTTPCapability().trigger({}), onCheck)];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
