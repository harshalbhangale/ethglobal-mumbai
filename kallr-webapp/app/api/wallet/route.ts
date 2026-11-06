import { FLASH_BASE_ASSETS, type FlashToken, NATIVE_ASSET } from "@kallr/integrations/definitive";
import { type Address, erc20Abi, formatUnits, getAddress, isAddress } from "viem";
import { getUsdPrice, USDC_BASE } from "@/lib/chain";
import { flash } from "@/lib/server/flash";
import { baseClient } from "@/lib/server/flash-place";
import type { Holding } from "@/lib/transfer";

/**
 * A wallet's coins on Base and what they're worth: ETH, USDC, WETH, cbBTC and every token it has traded
 * through Kall (from its Flash orders). Balances are read on Base in one multicall. ETH, WETH and cbBTC
 * are priced by Chainlink on Base, USDC at $1, anything else by Definitive (with its symbol, decimals
 * and logo). `GET /api/wallet?address=0x…` → { totalUsd, holdings }.
 */
export const dynamic = "force-dynamic";

const ICONS: Record<string, string> = {
  native: "/brand/tokens/eth.png",
  [USDC_BASE.toLowerCase()]: "/brand/tokens/usdc.png",
  [FLASH_BASE_ASSETS.ETH.address.toLowerCase()]: "/brand/tokens/eth.png",
  [FLASH_BASE_ASSETS.BTC.address.toLowerCase()]: "/brand/tokens/btc.png",
};
const BASICS = [USDC_BASE, FLASH_BASE_ASSETS.ETH.address, FLASH_BASE_ASSETS.BTC.address].map((a) => a.toLowerCase());
const NAMES: Record<string, string> = {
  [USDC_BASE.toLowerCase()]: "USD Coin",
  [FLASH_BASE_ASSETS.ETH.address.toLowerCase()]: "Wrapped Ether",
  [FLASH_BASE_ASSETS.BTC.address.toLowerCase()]: "Coinbase Wrapped BTC",
};

const walletCache = new Map<string, { at: number; body: unknown }>();
const tokenCache = new Map<string, { at: number; token: FlashToken | null }>();

/** Definitive's view of a token (symbol, decimals, price, logo), kept a minute. */
async function tokenInfo(address: string): Promise<FlashToken | null> {
  const hit = tokenCache.get(address);
  if (hit && Date.now() - hit.at < 60_000) return hit.token;
  const token = (await flash.search(address, 3).catch(() => [])).find((t) => t.address.toLowerCase() === address) ?? null;
  tokenCache.set(address, { at: Date.now(), token });
  return token;
}

const num = (s: string | null | undefined) => (s != null && Number.isFinite(Number(s)) ? Number(s) : null);

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(raw, { strict: false })) return Response.json({ error: "address must be a 0x address" }, { status: 400 });
  const owner = getAddress(raw);
  const hit = walletCache.get(owner);
  if (hit && Date.now() - hit.at < 15_000) return Response.json(hit.body);

  try {
    // The basics, plus every token this wallet has bought or sold through Kall.
    const orders = await flash.listOrders(owner, 50).catch(() => []);
    const traded = orders.flatMap((o) => [o.targetAsset, o.contraAsset]).map((a) => a.toLowerCase());
    const tokens = [...new Set([...BASICS, ...traded])].filter((a) => isAddress(a, { strict: false }) && a !== NATIVE_ASSET);

    const [eth, balances] = await Promise.all([
      baseClient.getBalance({ address: owner }),
      baseClient.multicall({
        contracts: tokens.map((t) => ({ address: t as Address, abi: erc20Abi, functionName: "balanceOf" as const, args: [owner] as const })),
        allowFailure: true,
      }),
    ]);
    const held = tokens
      .map((t, i) => ({ address: t, raw: balances[i]?.status === "success" ? (balances[i]?.result as bigint) : 0n }))
      .filter((t) => t.raw > 0n || t.address === USDC_BASE.toLowerCase());

    // Chainlink on Base for the big two; null if a feed can't be read.
    const [ethUsd, btcUsd] = await Promise.all([getUsdPrice("ETH").catch(() => null), getUsdPrice("BTC").catch(() => null)]);
    const chainlink: Record<string, number | null> = {
      [USDC_BASE.toLowerCase()]: 1,
      [FLASH_BASE_ASSETS.ETH.address.toLowerCase()]: ethUsd,
      [FLASH_BASE_ASSETS.BTC.address.toLowerCase()]: btcUsd,
    };
    const holdings: Holding[] = await Promise.all(
      held.map(async (t): Promise<Holding> => {
        const info = await tokenInfo(t.address);
        const decimals = info?.decimals ?? (await baseClient.readContract({ address: t.address as Address, abi: erc20Abi, functionName: "decimals" }).catch(() => 18));
        const symbol = info?.symbol ?? (await baseClient.readContract({ address: t.address as Address, abi: erc20Abi, functionName: "symbol" }).catch(() => "TOKEN"));
        const balance = formatUnits(t.raw, decimals);
        const priceUsd = t.address in chainlink ? chainlink[t.address]! : num(info?.price);
        return {
          symbol,
          name: NAMES[t.address] ?? info?.name ?? null,
          address: getAddress(t.address),
          decimals,
          balance,
          priceUsd,
          valueUsd: priceUsd === null ? null : Number(balance) * priceUsd,
          icon: ICONS[t.address] ?? info?.imageUrl ?? null,
        };
      }),
    );
    const ethPrice = ethUsd;
    const ethBalance = formatUnits(eth, 18);
    holdings.push({
      symbol: "ETH",
      name: "Ether",
      address: null,
      decimals: 18,
      balance: ethBalance,
      priceUsd: ethPrice,
      valueUsd: ethPrice === null ? null : Number(ethBalance) * ethPrice,
      icon: ICONS.native ?? null,
    });

    // ETH and USDC first, then the rest by what they're worth.
    const rank = (h: Holding) => (h.address === null ? 0 : h.address.toLowerCase() === USDC_BASE.toLowerCase() ? 1 : 2);
    holdings.sort((a, b) => rank(a) - rank(b) || (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    const body = { address: owner, totalUsd: holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0), holdings };
    walletCache.set(owner, { at: Date.now(), body });
    return Response.json(body);
  } catch {
    return Response.json({ error: "Couldn't read this wallet on Base right now." }, { status: 502 });
  }
}
