"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { base } from "viem/chains";
import { type AnonRead, anonRpcBatch, anonRpcRead, getAnonRpcStatus, serverAnonRpcStatus, subscribeAnonRpc, warmAnonRpc } from "@/lib/anon-rpc";

/** Base mainnet's RPC, the same one the web app's reads use. */
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || base.rpcUrls.default.http[0];

type KallMessage = Record<string, unknown>;

declare global {
  interface Window {
    /** Called by the Kall Keyboard on iPhone: one Base JSON-RPC read, through Anon-RPC when it can be. */
    kallRead?: (method: string, params: unknown[], waitMs?: number) => Promise<AnonRead>;
    /** Several reads in one round trip through the mixnet. */
    kallReadBatch?: (calls: Array<{ method: string; params: unknown[] }>, waitMs?: number) => Promise<AnonRead[]>;
    webkit?: { messageHandlers?: { kall?: { postMessage(message: KallMessage): void } } };
  }
}

/** To the iOS keyboard hosting this page (WKScriptMessageHandler "kall"); nothing elsewhere. */
function post(message: KallMessage) {
  try {
    window.webkit?.messageHandlers?.kall?.postMessage(message);
  } catch {}
}

/**
 * The Kall Keyboard's Anon-RPC: the keyboard on iPhone loads this page in a hidden web view, which
 * boots the same hash-pinned anon-rpc worker as the web app (Nym by default). The keyboard's Base reads
 * (balances, allowance, the ETH price, receipts) come through `window.kallRead`, and the page reports
 * the worker's state so the keyboard can show a live log.
 */
export function AnonBridge() {
  const status = useSyncExternalStore(subscribeAnonRpc, getAnonRpcStatus, () => serverAnonRpcStatus);

  // The harness's warnings and errors, on the page and to the keyboard, so a stalled boot can be read.
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    const original = { warn: console.warn, error: console.error };
    const keep = (level: "warn" | "error") =>
      (...args: unknown[]) => {
        original[level](...args);
        const text = `${level}: ${args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`.slice(0, 240);
        setNotes((n) => [...n.slice(-7), text]);
        post({ type: "log", text });
      };
    console.warn = keep("warn");
    console.error = keep("error");
    const onError = (e: ErrorEvent) => keep("error")(e.message);
    const onRejection = (e: PromiseRejectionEvent) => keep("error")(e.reason instanceof Error ? e.reason.message : String(e.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      console.warn = original.warn;
      console.error = original.error;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    window.kallRead = (method, params, waitMs) => anonRpcRead(BASE_RPC, method, params, waitMs);
    window.kallReadBatch = (calls, waitMs) => anonRpcBatch(BASE_RPC, calls, waitMs);
    warmAnonRpc();
    post({ type: "loaded" });
    return () => {
      delete window.kallRead;
      delete window.kallReadBatch;
    };
  }, []);

  useEffect(() => {
    post({
      type: "status",
      state: status.state,
      network: status.network,
      bootMs: status.bootMs,
      error: status.error,
      anonymized: status.anonymized,
      direct: status.direct,
    });
  }, [status]);

  return (
    <main style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 16, color: "#e8e8e0", background: "#050605", minHeight: "100vh" }}>
      <p>Kall Keyboard · Anon-RPC</p>
      <p>
        {status.network}: {status.state}
        {status.bootMs !== null ? ` in ${(status.bootMs / 1000).toFixed(1)}s` : ""}
      </p>
      <p>
        {status.anonymized} private · {status.direct} direct
      </p>
      {status.error ? <p>{status.error}</p> : null}
      {notes.map((n, i) => (
        <p key={i} style={{ color: "#ff8a7a", wordBreak: "break-word" }}>
          {n}
        </p>
      ))}
    </main>
  );
}
