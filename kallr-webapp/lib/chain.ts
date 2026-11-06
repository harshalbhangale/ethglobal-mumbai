import { createPublicClient, erc20Abi, fallback, formatUnits, http, type Address } from "viem";
import { base } from "viem/chains";

export const CHAIN = base;

// Native USDC on Base mainnet.
export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

/**
 * Base RPC. On the server, Ankr first (ANKR_API_KEY, never sent to the browser) with Base's public RPC as an
 * instant fallback; in the browser, the public RPC only.
 */
export function baseTransport() {
  const ankrKey = typeof window === "undefined" ? process.env.ANKR_API_KEY : undefined;
  const pub = http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined, { timeout: 4_000 });
  return ankrKey ? fallback([http(`https://rpc.ankr.com/base/${ankrKey}`, { timeout: 2_500, retryCount: 0 }), pub]) : pub;
}

export const publicClient = createPublicClient({ chain: base, transport: baseTransport() });

export type Balances = { eth: string; usdc: string };

export async function getBalances(address: Address): Promise<Balances> {
  const [eth, usdc] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: USDC_BASE,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);
  return {
    eth: formatUnits(eth, 18),
    usdc: formatUnits(usdc, USDC_DECIMALS),
  };
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAmount(value: string, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Chainlink ETH/USD price feed on Base mainnet (8 decimals).
export const ETH_USD_FEED: Address = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** Chainlink USD feeds on Base (8 decimals) for every asset the desk can trade. */
export const USD_FEEDS = {
  ETH: ETH_USD_FEED,
  BTC: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
} as const satisfies Record<string, Address>;
export type PricedAsset = keyof typeof USD_FEEDS;

export function hasUsdFeed(asset: string): asset is PricedAsset {
  return asset in USD_FEEDS;
}

export async function getUsdPrice(asset: PricedAsset): Promise<number> {
  const [, answer] = await publicClient.readContract({
    address: USD_FEEDS[asset],
    abi: aggregatorAbi,
    functionName: "latestRoundData",
  });
  return Number(answer) / 1e8;
}

export const getEthUsd = () => getUsdPrice("ETH");

/** Latest Chainlink answer as an exact decimal string, with when the feed last updated. */
export async function getUsdPriceDecimal(asset: PricedAsset): Promise<{ price: string; updatedAt: number }> {
  const [, answer, , updatedAt] = await publicClient.readContract({
    address: USD_FEEDS[asset],
    abi: aggregatorAbi,
    functionName: "latestRoundData",
  });
  return { price: formatUnits(answer, 8), updatedAt: Number(updatedAt) };
}
