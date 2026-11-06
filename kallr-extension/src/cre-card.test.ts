// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type TokenCheck, tokenCheckCard } from "./token-card";

// A $TOSHI copy: it really calls itself TOSHI, trades, and GoPlus/Dexscreener see nothing wrong.
const lookalike: TokenCheck = {
  address: "0x8544FE9D190fD7EC52860abBf45088E81Ee24a8c",
  symbol: "TOSHI",
  flags: [],
  liquidityUsd: 104,
  pairUrl: null,
  sources: { goplus: "ok", dexscreener: "ok" },
};
const tx = "0x07091f3be329eae796dd14d9319b42aeeabd8394594b550590492b96e73d3002";

describe("token card with Chainlink CRE", () => {
  it("says it's checking while CRE runs", () => {
    expect(tokenCheckCard(lookalike, "TOSHI", "pending").textContent).toContain("Checking with Chainlink CRE");
  });

  it("blocks an impostor CRE caught, with the signed verdict", () => {
    const card = tokenCheckCard(lookalike, "TOSHI", {
      checked: true,
      verdict: "fake",
      reason: "Same name, wrong contract: the real coin lives at another address.",
      symbol: "TOSHI",
      claimed: "TOSHI",
      txHash: tx,
    });
    expect(card.classList.contains("tc-failed")).toBe(true);
    expect(card.textContent).toContain("✕ Fake token · checked by Chainlink CRE");
    expect(card.textContent).toContain("Trading is off");
    expect(card.querySelector("a")?.getAttribute("href")).toBe(`https://sepolia.basescan.org/tx/${tx}`);
  });

  it("marks the real coin, and stays quiet when CRE has nothing", () => {
    const real = tokenCheckCard({ ...lookalike, liquidityUsd: 994_932 }, "TOSHI", {
      checked: true,
      verdict: "real",
      reason: "This is the real coin.",
      symbol: "TOSHI",
      claimed: "TOSHI",
      txHash: tx,
    });
    expect(real.textContent).toContain("✓ Real $TOSHI · checked by Chainlink CRE");
    expect(tokenCheckCard(lookalike, "TOSHI", null).textContent).not.toContain("Chainlink CRE");
  });
});
