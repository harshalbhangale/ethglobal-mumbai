import { describe, expect, it, vi } from "vitest";
import { comparePrices, toBaseUnits, UNISWAP_API_URL, uniswapQuote } from "./uniswap";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const swapper = "0x94d3d3466ED0a6299D9384190eF461bb171e140D";
const ask = { tokenIn: USDC, tokenOut: WETH, amountIn: 1_000_000n, swapper };

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe("toBaseUnits", () => {
  it("converts decimals without floating point", () => {
    expect(toBaseUnits("1", 6)).toBe(1_000_000n);
    expect(toBaseUnits("0.0003", 18)).toBe(300_000_000_000_000n);
    expect(toBaseUnits("1.23456789", 6)).toBe(1_234_567n);
    expect(toBaseUnits("abc", 6)).toBe(0n);
  });
});

describe("uniswapQuote", () => {
  it("asks Uniswap's pools for an exact-input swap on Base, with the key", async () => {
    const fetcher = reply({ routing: "CLASSIC", quote: { output: { amount: "445000000000000" }, priceImpact: 0.02 } });
    const q = await uniswapQuote(ask, "key-123", 2500, fetcher as unknown as typeof fetch);
    expect(q).toEqual({ amountOut: 445_000_000_000_000n, routing: "CLASSIC", priceImpact: 0.02 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${UNISWAP_API_URL}/quote`);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key-123");
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: "EXACT_INPUT",
      amount: "1000000",
      tokenInChainId: 8453,
      tokenOutChainId: 8453,
      tokenIn: USDC,
      tokenOut: WETH,
      swapper,
      protocols: ["V2", "V3", "V4"],
    });
  });

  it("reads a UniswapX-shaped answer too", async () => {
    const fetcher = reply({ routing: "DUTCH_V2", quote: { orderInfo: { outputs: [{ startAmount: "444" }] } } });
    expect((await uniswapQuote(ask, "k", 2500, fetcher as unknown as typeof fetch))?.amountOut).toBe(444n);
  });

  it("gives null, never an error, without a key, on a bad status, bad JSON or a network failure", async () => {
    expect(await uniswapQuote(ask, "")).toBeNull();
    expect(await uniswapQuote(ask, "k", 2500, reply({ errorCode: "x" }, false) as unknown as typeof fetch)).toBeNull();
    expect(await uniswapQuote(ask, "k", 2500, reply({ nope: 1 }) as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(await uniswapQuote(ask, "k", 2500, boom as unknown as typeof fetch)).toBeNull();
  });
});

describe("comparePrices", () => {
  it("says how much more Flash gives, in the output token's decimals", () => {
    // Flash: 0.000447 WETH, Uniswap: 0.000445 WETH → Flash +0.45%.
    const c = comparePrices("0.000447", 445_000_000_000_000n, 18);
    expect(c?.winner).toBe("flash");
    expect(c?.edgePct).toBeCloseTo(0.4494, 3);
    expect(c?.uniswapOut).toBe("0.000445");
  });

  it("is honest when Uniswap gives more, and calls tiny gaps a tie", () => {
    expect(comparePrices("0.99", 1_000_000n, 6)?.winner).toBe("uniswap");
    expect(comparePrices("0.99", 1_000_000n, 6)?.edgePct).toBeCloseTo(-1, 5);
    expect(comparePrices("1.00005", 1_000_000n, 6)?.winner).toBe("tie");
    expect(comparePrices("0", 1_000_000n, 6)).toBeNull();
  });
});
