import { describe, expect, it } from "vitest";
import { migrateStorage } from "./migrate-storage";

function store(initial: Record<string, unknown>) {
  const data = { ...initial };
  return {
    data,
    get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (v: Record<string, unknown>) => void Object.assign(data, v),
    remove: async (keys: string[]) => void keys.forEach((k) => delete data[k]),
  };
}

describe("migrateStorage", () => {
  it("moves follows and settings from the old keys, once", async () => {
    const s = store({ "aftermarkets.watchlist.v1": { entries: [{ handle: "kol" }] }, "aftermarkets.mirror-x.v1": { enabled: true }, "seen:kol": [] });
    expect((await migrateStorage(s as never)).sort()).toEqual(["kallr.mirror-x.v1", "kallr.watchlist.v1"]);
    expect(s.data).toEqual({ "kallr.watchlist.v1": { entries: [{ handle: "kol" }] }, "kallr.mirror-x.v1": { enabled: true }, "seen:kol": [] });
    expect(await migrateStorage(s as never)).toEqual([]);
  });
  it("never overwrites data already saved under the new keys", async () => {
    const s = store({ "aftermarkets.watchlist.v1": { entries: [{ handle: "old" }] }, "kallr.watchlist.v1": { entries: [{ handle: "new" }] } });
    await migrateStorage(s as never);
    expect(s.data).toEqual({ "kallr.watchlist.v1": { entries: [{ handle: "new" }] } });
  });
});
