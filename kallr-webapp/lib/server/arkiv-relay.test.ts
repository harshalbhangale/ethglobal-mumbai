import { describe, expect, it } from "vitest";
import { relayable } from "./arkiv-relay";

const call = (method: string) => ({ jsonrpc: "2.0", id: 1, method, params: [] });

describe("Arkiv relay allow-list", () => {
  it("passes Arkiv reads, single or batched", () => {
    expect(relayable(call("arkiv_query"))).toBe(true);
    expect(relayable([call("arkiv_query"), call("eth_blockNumber"), call("arkiv_getEntity")])).toBe(true);
  });

  it("refuses writes and anything else", () => {
    expect(relayable(call("eth_sendRawTransaction"))).toBe(false);
    expect(relayable([call("arkiv_query"), call("eth_call")])).toBe(false);
    expect(relayable({ id: 1 })).toBe(false);
    expect(relayable("arkiv_query")).toBe(false);
  });

  it("refuses empty or oversized batches", () => {
    expect(relayable([])).toBe(false);
    expect(relayable(Array.from({ length: 21 }, () => call("arkiv_query")))).toBe(false);
  });
});
