import { createPublicClient, erc20Abi, formatUnits, http, type Address } from "viem";
import { base } from "viem/chains";

export const CHAIN = base;

// Native USDC on Base mainnet.
export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

export const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined),
});

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

export async function getEthUsd(): Promise<number> {
  const [, answer] = await publicClient.readContract({
    address: ETH_USD_FEED,
    abi: aggregatorAbi,
    functionName: "latestRoundData",
  });
  return Number(answer) / 1e8;
}
