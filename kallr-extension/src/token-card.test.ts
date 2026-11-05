// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type TokenCheck, tokenCheckCard } from "./token-card";

const base: TokenCheck = {
  address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
  symbol: "DEGEN",
  flags: [],
  liquidityUsd: 249003,
  pairUrl: null,
  sources: { goplus: "ok", dexscreener: "ok" },
};

describe("tokenCheckCard", () => {
  it("shows serious flags as a warning and never a trade button", () => {
    const card = tokenCheckCard({
      ...base,
      flags: [
        { kind: "honeypot", severity: "danger", text: "Honeypot: you may not be able to sell" },
        { kind: "mintable", severity: "info", text: "Supply can be minted" },
      ],
    });
    expect(card.textContent).toContain("⚠ Honeypot: you may not be able to sell");
    expect(card.querySelector(".tc-danger")).not.toBeNull();
    expect(card.textContent).toContain("Supply can be minted");
    expect(card.textContent).toContain("no copy is offered");
    expect(card.querySelector("button")).toBeNull();
  });

  it("says clean only when both sources answered", () => {
    expect(tokenCheckCard(base).textContent).toContain("✓ No red flags");
    const down = tokenCheckCard({ ...base, sources: { goplus: "unavailable", dexscreener: "ok" } });
    expect(down.textContent).toContain("Safety checks unavailable");
    expect(down.textContent).not.toContain("No red flags");
  });

  it("falls back to a short address when the symbol is unknown", () => {
    expect(tokenCheckCard({ ...base, symbol: null }).textContent).toContain("0x4ed4…efed");
  });
});
