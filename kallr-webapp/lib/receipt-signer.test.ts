import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { signer } from "./flash-client";
import { parseTypedData } from "./typed-data";

// Shaped like Flash's orderTypedData: JSON, with numbers as strings.
const order = (amount: string) =>
  JSON.stringify({
    domain: { name: "Flash", version: "1", chainId: "8453", verifyingContract: "0x1111111111111111111111111111111111111111" },
    primaryType: "FlashOrder",
    types: {
      EIP712Domain: [{ name: "name", type: "string" }],
      FlashOrder: [
        { name: "funder", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    message: { funder: "0x2222222222222222222222222222222222222222", amount },
  });

describe("receipt signature check", () => {
  // A throwaway key made for this test, never a real wallet.
  const account = privateKeyToAccount(generatePrivateKey());

  it("recovers the wallet that signed the order", async () => {
    const json = order("1000000");
    const signature = await account.signTypedData(parseTypedData(json) as never);
    expect(await signer(json, signature)).toBe(account.address);
  });

  it("recovers someone else when the order was changed after signing", async () => {
    const signature = await account.signTypedData(parseTypedData(order("1000000")) as never);
    expect(await signer(order("9000000"), signature)).not.toBe(account.address);
  });

  it("is null when the typed data can't be read", async () => {
    expect(await signer("not json", "0x00")).toBeNull();
  });
});
