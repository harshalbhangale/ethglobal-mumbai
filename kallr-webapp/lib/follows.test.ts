// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { normalize, readLocal, updateLocal } from "./follows";

afterEach(() => localStorage.clear());

describe("normalize", () => {
  it("accepts handles and profile links, lowercased", () => {
    expect(normalize("@CryptoRover")).toBe("cryptorover");
    expect(normalize("https://x.com/kol/status/123")).toBe("kol");
    expect(normalize(" twitter.com/kol ")).toBeNull();
    expect(normalize("https://twitter.com/Kol_1?s=20")).toBe("kol_1");
    expect(normalize("not a handle!")).toBeNull();
    expect(normalize("waytoolonghandle123")).toBeNull();
  });
});

describe("local follows", () => {
  it("adds newest first, dedupes, removes, and caps at 50", () => {
    updateLocal({ action: "add", handle: "a" });
    updateLocal({ action: "add", handle: "b" });
    updateLocal({ action: "add", handle: "a" });
    expect(readLocal().map((e) => e.handle)).toEqual(["b", "a"]);
    updateLocal({ action: "remove", handle: "b" });
    expect(readLocal().map((e) => e.handle)).toEqual(["a"]);
    for (let i = 0; i < 49; i++) updateLocal({ action: "add", handle: `h${i}` });
    expect(() => updateLocal({ action: "add", handle: "one_more" })).toThrow("up to 50");
  });
  it("treats corrupted storage as empty", () => {
    localStorage.setItem("kallr.follows.v1", "{not json");
    expect(readLocal()).toEqual([]);
  });
});
