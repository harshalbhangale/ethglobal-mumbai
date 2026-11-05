import { describe, expect, it } from "vitest";
import { checkCallerWallet, checkToken, goplusFlags, marketFlags, walletFindings } from "./safety-checks";

const TOKEN = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const NOW = Date.UTC(2026, 10, 5);

function fakeFetch(routes: Record<string, unknown | number>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    const value = key ? routes[key] : 404;
    return typeof value === "number" ? new Response("", { status: value }) : Response.json(value);
  }) as unknown as typeof fetch;
}

describe("goplusFlags", () => {
  it("flags honeypots, owner powers and high taxes, worst first", () => {
    const flags = goplusFlags({ is_honeypot: "1", hidden_owner: "1", sell_tax: "0.35", is_mintable: "1", is_open_source: "0" });
    expect(flags.map((f) => f.kind)).toEqual(["honeypot", "hidden-owner", "mintable", "closed-source", "tax"]);
    expect(flags.find((f) => f.kind === "tax")).toMatchObject({ severity: "danger", text: "35% trading tax" });
  });
  it("a clean token gets no flags", () => {
    expect(goplusFlags({ is_honeypot: "0", is_open_source: "1", buy_tax: "0", sell_tax: "0" })).toEqual([]);
  });
});

describe("marketFlags", () => {
  it("flags thin liquidity and brand-new tokens", () => {
    expect(marketFlags(800, 0.5).map((f) => [f.kind, f.severity])).toEqual([
      ["thin-liquidity", "danger"],
      ["new-token", "warning"],
    ]);
    expect(marketFlags(250_000, 600)).toEqual([]);
  });
});

describe("checkToken", () => {
  it("combines GoPlus and Dexscreener", async () => {
    const result = await checkToken(TOKEN, {
      now: NOW,
      fetcher: fakeFetch({
        gopluslabs: { result: { [TOKEN]: { token_name: "Degen", token_symbol: "DEGEN", is_honeypot: "0", is_mintable: "1", holder_count: "1182860" } } },
        dexscreener: [
          { chainId: "base", url: "https://dexscreener.com/base/a", liquidity: { usd: 249003 }, volume: { h24: 91086 }, pairCreatedAt: NOW - 600 * 86_400_000 },
          { chainId: "base", liquidity: { usd: 1000 }, volume: { h24: 10 }, pairCreatedAt: NOW - 10 * 86_400_000 },
        ],
      }),
    });
    expect(result).toMatchObject({ symbol: "DEGEN", holders: 1182860, liquidityUsd: 250003, pairUrl: "https://dexscreener.com/base/a", sources: { goplus: "ok", dexscreener: "ok" } });
    expect(result.flags.map((f) => f.kind)).toEqual(["mintable"]);
    expect(Math.round(result.ageDays!)).toBe(600);
  });

  it("reports sources as unavailable instead of clean", async () => {
    const result = await checkToken(TOKEN, { fetcher: fakeFetch({ gopluslabs: 500, dexscreener: 500 }) });
    expect(result.sources).toEqual({ goplus: "unavailable", dexscreener: "unavailable" });
    expect(result.flags).toEqual([]);
    expect(result.liquidityUsd).toBeNull();
  });

  it("flags tokens with no Base market", async () => {
    const result = await checkToken(TOKEN, { fetcher: fakeFetch({ gopluslabs: { result: {} }, dexscreener: [] }) });
    expect(result.flags.map((f) => f.kind)).toContain("no-market");
  });
});

describe("walletFindings", () => {
  const posted = 1_790_000_000;
  const tx = (from: string, to: string, minutes: number, value = "2000000000000000000") => ({
    timeStamp: String(posted + minutes * 60),
    from,
    to,
    value,
    tokenDecimal: "18",
    tokenSymbol: "DEGEN",
    hash: `0x${minutes}`,
  });

  it("flags a front-run: bought before a bullish call, sold right after", () => {
    const { flags, findings } = walletFindings(WALLET, [tx(OTHER, WALLET, -120), tx(WALLET, OTHER, 40), tx(OTHER, WALLET, -60 * 48)], posted, "up");
    expect(findings).toHaveLength(2); // the 48h-old buy is outside the window
    expect(flags[0]).toMatchObject({ kind: "front-run", severity: "danger", text: "Bought before posting, sold 40 min after" });
  });

  it("notes skin in the game when they traded with the call", () => {
    expect(walletFindings(WALLET, [tx(OTHER, WALLET, -30)], posted, "up").flags[0]?.kind).toBe("skin-in-game");
  });
});

describe("checkCallerWallet", () => {
  it("is unavailable without a key", async () => {
    expect(await checkCallerWallet({ wallet: WALLET, token: TOKEN, postedAt: 0, direction: "up" })).toMatchObject({ status: "unavailable" });
  });
  it("reads Etherscan V2 on Base", async () => {
    let called = "";
    const fetcher = (async (url: string) => {
      called = url;
      return Response.json({ status: "0", message: "No transactions found", result: [] });
    }) as unknown as typeof fetch;
    const r = await checkCallerWallet({ wallet: WALLET, token: TOKEN, postedAt: 0, direction: "up" }, { apiKey: "k", fetcher });
    expect(called).toContain("api.etherscan.io/v2/api?chainid=8453");
    expect(r).toMatchObject({ status: "ok", findings: [], flags: [] });
  });
});
