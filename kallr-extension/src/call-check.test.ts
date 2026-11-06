// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { callCheck, claimedTicker, tokenCheckCard } from "./token-card";

// What /api/after-market returned for "$PEPE … CA: 0x7a1b…4567", an address with no token.
const fake = {
  address: "0x7a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
  name: null,
  symbol: null,
  flags: [
    { kind: "thin-liquidity", severity: "danger", text: "Only $0 liquidity" },
    { kind: "no-market", severity: "danger", text: "No trading pair on Base" },
  ],
  holders: null,
  liquidityUsd: 0,
  volume24hUsd: 0,
  ageDays: null,
  pairUrl: null,
  sources: { goplus: "unavailable", dexscreener: "ok" },
} as unknown as Parameters<typeof callCheck>[0];

describe("call check", () => {
  it("reads the coin a post names, not dollar amounts", () => {
    expect(claimedTicker("$PEPE is sending 🚀 CA: 0x7a1b2c3d4e5f60718293a4b5c6d7e8f901234567")).toBe("PEPE");
    expect(claimedTicker("Put $100 into $pepe now")).toBe("PEPE");
    expect(claimedTicker("no ticker 0xabc")).toBeNull();
  });

  it("fails a $PEPE post whose address holds no token, and offers no trade", () => {
    expect(callCheck(fake, "PEPE")).toMatch(/no \$PEPE at 0x7a1b…4567/);
    const card = tokenCheckCard(fake, "PEPE");
    expect(card.textContent).toContain("✕ Call check failed");
    expect(card.textContent).toContain("Trading is off for this post");
    expect(card.querySelector("button")).toBeNull();
  });

  it("fails when the contract is a different coin than the post names", () => {
    const other = { ...fake, symbol: "PEEPEE", liquidityUsd: 5000, flags: [] } as typeof fake;
    expect(callCheck(other, "PEPE")).toBe("This contract is $PEEPEE, not $PEPE. The post's address doesn't match the coin it names.");
  });

  it("passes when the contract is the coin the post names", () => {
    const real = { ...fake, symbol: "PEPE", liquidityUsd: 2_000_000, flags: [] } as typeof fake;
    expect(callCheck(real, "PEPE")).toBeNull();
    expect(tokenCheckCard(real, "PEPE").textContent).not.toContain("Call check failed");
  });
});
