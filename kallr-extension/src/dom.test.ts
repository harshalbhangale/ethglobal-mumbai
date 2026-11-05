// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { el, safeLink, send, shadowHost } from "./dom";

afterEach(() => vi.unstubAllGlobals());

describe("el", () => {
  it("renders strings as text, never markup", () => {
    const node = el("p", { class: "x" }, "<img src=x onerror=alert(1)>", null, false);
    expect(node.className).toBe("x");
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("shadowHost", () => {
  it("carries styles and X's theme, and keeps clicks from reaching the post", () => {
    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    const { host, root } = shadowHost("kallr-host");
    expect(host.dataset.theme).toBe("dark");
    expect(root.querySelector("style")?.textContent).toContain("--surface");
    const outer = vi.fn();
    const parent = el("div");
    parent.addEventListener("click", outer);
    parent.append(host);
    host.click();
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("safeLink", () => {
  it("allows http(s) only", () => {
    expect(safeLink("https://x.com/kol", "kol").getAttribute("rel")).toBe("noopener noreferrer");
    expect(() => safeLink("javascript:alert(1)", "bad")).toThrow();
  });
});

describe("send", () => {
  it("returns null when the extension context is gone", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "x",
        sendMessage: () => {
          throw new Error("Extension context invalidated.");
        },
      },
    });
    await expect(send({ type: "ping" })).resolves.toBeNull();
  });
  it("turns an { error } answer into null and passes real answers through", async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ error: "API 500" }).mockResolvedValueOnce({ ok: 1 });
    vi.stubGlobal("chrome", { runtime: { id: "x", sendMessage } });
    await expect(send({ type: "a" })).resolves.toBeNull();
    await expect(send({ type: "a" })).resolves.toEqual({ ok: 1 });
  });
});
