import { decodeFunctionData, erc20Abi, hexToBigInt } from "viem";
import { describe, expect, it } from "vitest";
import { USDC_BASE } from "./chain";
import { type Holding, maxWithdraw, paymentUri, planWithdraw } from "./transfer";

const ME = "0x00000000000000000000000000000000000000c4";
const FRIEND = "0x1111111111111111111111111111111111111111";
const DEGEN_ADDR = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const coin = (h: Partial<Holding> & Pick<Holding, "symbol" | "address" | "decimals" | "balance">): Holding => ({
  name: null,
  priceUsd: null,
  valueUsd: null,
  icon: null,
  ...h,
});
const USDC = coin({ symbol: "USDC", address: USDC_BASE, decimals: 6, balance: "12.5" });
const ETH = coin({ symbol: "ETH", address: null, decimals: 18, balance: "0.001" });
const DEGEN = coin({ symbol: "DEGEN", address: DEGEN_ADDR, decimals: 18, balance: "1226.5" });
const plan = (asset: Holding, amount: string, to = FRIEND, ethBalance = ETH.balance) => planWithdraw({ asset, amount, to, from: ME, ethBalance });

describe("deposit links", () => {
  it("asks for USDC as a token transfer and ETH as a plain send, both on Base", () => {
    expect(paymentUri("USDC", ME)).toBe(`ethereum:${USDC_BASE}@8453/transfer?address=${ME}`);
    expect(paymentUri("ETH", ME)).toBe(`ethereum:${ME}@8453`);
  });
});

describe("withdrawals", () => {
  it("builds a token transfer to the address, in the token's own decimals", () => {
    const usdc = plan(USDC, "10.25");
    expect(usdc.ok && usdc.tx.to).toBe(USDC_BASE);
    expect(usdc.ok && decodeFunctionData({ abi: erc20Abi, data: usdc.tx.data! }).args).toEqual([FRIEND, 10_250_000n]);
    // Any coin the wallet holds, not just USDC.
    const degen = plan(DEGEN, "1000");
    expect(degen.ok && degen.tx.to).toBe(DEGEN_ADDR);
    expect(degen.ok && decodeFunctionData({ abi: erc20Abi, data: degen.tx.data! }).args).toEqual([FRIEND, 1000n * 10n ** 18n]);
  });

  it("sends ETH directly, keeping some back for gas", () => {
    expect(maxWithdraw(ETH)).toBe("0.00097");
    expect(maxWithdraw(USDC)).toBe("12.5");
    const p = plan(ETH, "0.0005");
    expect(p.ok && hexToBigInt(p.tx.value!)).toBe(500_000_000_000_000n);
    expect(plan(ETH, "0.001")).toEqual({ ok: false, error: "That's more than you have, keeping 0.00003 ETH for gas." });
  });

  it("says plainly what's wrong", () => {
    expect(plan(USDC, "")).toEqual({ ok: false, error: "Enter an amount." });
    expect(planWithdraw({ asset: USDC, amount: "", to: "", from: ME, ethBalance: "1" })).toEqual({ ok: false, error: null });
    expect(plan(USDC, "12.6")).toEqual({ ok: false, error: "That's more USDC than you have." });
    expect(plan(USDC, "1.0000001")).toEqual({ ok: false, error: "USDC has at most 6 decimals." });
    expect(plan(USDC, "1e3")).toEqual({ ok: false, error: "Enter a number, like 10 or 0.5." });
    expect(plan(USDC, "1", "0x123")).toEqual({ ok: false, error: "That isn't a valid address." });
    expect(plan(USDC, "1", ME)).toEqual({ ok: false, error: "That's this wallet. Send to another address." });
    expect(plan(USDC, "1", USDC_BASE)).toEqual({ ok: false, error: "That's the USDC contract, not a wallet." });
    expect(plan(USDC, "1", "0x0000000000000000000000000000000000000000")).toEqual({ ok: false, error: "That address burns funds. Use a real wallet." });
    expect(plan(DEGEN, "1", FRIEND, "0")).toEqual({ ok: false, error: "Add a little ETH on Base first: sending DEGEN needs gas." });
  });
});
