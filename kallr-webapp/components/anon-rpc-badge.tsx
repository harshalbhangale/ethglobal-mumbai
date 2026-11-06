"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { type AnonStatus, getAnonRpcStatus, serverAnonRpcStatus, subscribeAnonRpc, warmAnonRpc } from "@/lib/anon-rpc";

/** Live Anon-RPC status. */
function useAnonRpc(): AnonStatus {
  return useSyncExternalStore(subscribeAnonRpc, getAnonRpcStatus, () => serverAnonRpcStatus);
}

/**
 * Shows where the app's chain reads go: through Anon-RPC (and which network), how many so far, and
 * plainly when any went direct. Opens a short explanation.
 */
export function AnonRpcBadge({ compact = false }: { compact?: boolean }) {
  const s = useAnonRpc();
  const [open, setOpen] = useState(false);
  useEffect(() => warmAnonRpc(), []);

  if (!s.enabled) return null;
  const tone =
    s.state === "ready" ? "bg-up" : s.state === "failed" ? "bg-down" : "animate-pulse bg-amber";
  const label =
    s.state === "ready" ? "Private reads" : s.state === "failed" ? "Direct reads" : "Connecting privately…";
  const total = s.anonymized + s.direct;

  if (compact)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2 py-1 text-xs font-semibold" title={`${label} · ${s.network}`}>
        <span className={`size-1.5 rounded-full ${tone}`} aria-hidden="true" />
        {s.state === "ready" ? `Private · ${s.anonymized}` : s.state === "failed" ? "Direct" : "Private…"}
      </span>
    );

  return (
    <div className="rounded-lg border border-rule bg-paper">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{label}</span>
          <span className="block truncate text-xs text-slate tabular-nums">
            {s.network} · {s.anonymized} anonymized{s.direct ? ` · ${s.direct} direct` : ""}
          </span>
        </span>
        <span aria-hidden="true" className={`text-xs text-slate transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-rule px-3 py-2.5 text-xs leading-relaxed text-slate">
          <p>
            Your balances, prices, receipts and the Arkiv feed are read through{" "}
            <a href="https://ethereum.github.io/anon-rpc/" target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-2">
              Anon-RPC
            </a>{" "}
            over the {s.network}, so the RPC provider can’t tie them to you.
          </p>
          <p>
            {s.state === "ready" && s.bootMs !== null && <>Connected in {(s.bootMs / 1000).toFixed(1)}s. </>}
            {total > 0 && <>{Math.round((s.anonymized / total) * 100)}% of reads went private. </>}
            {s.state === "failed" && <span className="text-down">The network didn’t start ({s.error}); reads go direct for now. </span>}
            Signing stays in your wallet.
          </p>
        </div>
      )}
    </div>
  );
}
