import { describe, expect, it } from "vitest";
import { parseTypedData } from "./typed-data";

describe("parseTypedData", () => {
  const json = JSON.stringify({
    domain: { name: "Flash", version: "1", chainId: "8453", verifyingContract: "0x1111111111111111111111111111111111111111" },
    primaryType: "Order",
    types: {
      EIP712Domain: [{ name: "name", type: "string" }],
      Order: [
        { name: "maker", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "legs", type: "Leg[]" },
      ],
      Leg: [{ name: "price", type: "int128" }],
    },
    message: { maker: "0x2222222222222222222222222222222222222222", amount: "1000000", legs: [{ price: "-5" }] },
  });

  it("turns string numbers into bigints through nested structs and arrays, and drops EIP712Domain", () => {
    const t = parseTypedData(json);
    expect(t.domain.chainId).toBe(8453);
    expect(t.types).not.toHaveProperty("EIP712Domain");
    expect(t.message).toEqual({ maker: "0x2222222222222222222222222222222222222222", amount: 1000000n, legs: [{ price: -5n }] });
  });
});
