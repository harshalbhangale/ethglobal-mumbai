"use client";

/**
 * Talking to the Kall extension from its own web app: one request at a time through the extension's
 * app bridge (a content script that only answers this origin). Follows, and the key for trading
 * from X with the Kall wallet.
 */

const REQUEST = "kallr-follows-request";
const RESPONSE = "kallr-follows-response";
const TIMEOUT_MS = 2500;

export function extensionInstalled() {
  return typeof document !== "undefined" && document.documentElement.dataset.kallrExtension === "1";
}

/** One request through the extension's app bridge. Rejects when it isn't installed or doesn't answer. */
export function bridge(payload: Record<string, unknown>): Promise<unknown> {
  const nonce = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window) return;
      if (event.data?.type !== RESPONSE || event.data.nonce !== nonce) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data.value);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Extension not connected"));
    }, TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.postMessage({ type: REQUEST, nonce, ...payload }, location.origin);
  });
}

/** Trading from X: which Kall wallet the extension holds a key for, if any. */
export type XTrading = { address: string; expires: number } | null;

const xTrading = (value: unknown): XTrading => {
  const v = value as { address?: unknown; expires?: unknown } | null;
  return typeof v?.address === "string" && typeof v.expires === "number" ? { address: v.address, expires: v.expires } : null;
};

export async function readXTrading(): Promise<XTrading> {
  return xTrading(await bridge({ action: "x-key-read" }));
}

export async function setXTrading(key: string, address: string, expires: number): Promise<XTrading> {
  return xTrading(await bridge({ action: "x-key-set", key, address, expires }));
}

export async function clearXTrading(): Promise<void> {
  await bridge({ action: "x-key-clear" });
}
