"use client";

import {
  advanceReceipt,
  type FlashReceipt,
  type ReceiptEvent,
  type ReceiptRowState,
  receiptRows,
  startReceipt,
} from "@kallr/domain/flash-receipt";
import { useCallback, useEffect, useRef, useState } from "react";
import { watchFill } from "@/lib/flash-client";

/**
 * The Definitive Flash receipt: quote, signature, order ID and fill, each row filled in as it
 * happens. It stays after the trade, so a Kall-wallet trade (no wallet pop-up) still shows every
 * step Definitive took.
 */

/** Receipt state plus `emit` for its events. `reset` starts a fresh receipt for the next order. */
export function useFlashReceipt(signer: string) {
  const [receipt, setReceipt] = useState<FlashReceipt | null>(null);
  const emit = useCallback((...events: ReceiptEvent[]) => {
    setReceipt((r) => events.reduce(advanceReceipt, r ?? startReceipt(signer)));
  }, [signer]);
  const begin = useCallback(() => setReceipt(startReceipt(signer)), [signer]);
  const reset = useCallback(() => setReceipt(null), []);
  return { receipt, emit, begin, reset };
}

/** Polls Flash for the fill once the order is sent, until the receipt shows it (or the component goes). */
export function useFillWatch(
  receipt: FlashReceipt | null,
  emit: (e: ReceiptEvent) => void,
  order: { funder: string; side: "buy" | "sell"; symbol: string } | null,
) {
  const orderId = receipt?.orderId ?? null;
  const resting = receipt?.resting ?? false;
  const watching = useRef<string | null>(null);
  useEffect(() => {
    if (!orderId || !order || watching.current === orderId) return;
    watching.current = orderId;
    let alive = true;
    void watchFill({ orderId, funder: order.funder, side: order.side, symbol: order.symbol, resting }, emit, () => alive);
    return () => {
      alive = false;
      watching.current = null;
    };
    // `order` is read once per order ID: the watch belongs to that order.
  }, [orderId]);
}

const DOT: Record<ReceiptRowState, string> = {
  pending: "border-rule",
  live: "animate-spin border-lime border-t-transparent",
  done: "border-lime bg-lime text-on-lime",
  failed: "border-down bg-down text-paper",
};

export function FlashReceiptView({ receipt, className = "" }: { receipt: FlashReceipt; className?: string }) {
  const rows = receiptRows(receipt);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <section aria-label="Definitive Flash receipt" className={`rounded-lg border border-rule bg-paper p-3 ${className}`}>
      <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate">
        <span>Definitive Flash receipt</span>
        <span className="normal-case tracking-normal">Base</span>
      </p>
      <ol className="space-y-2.5" aria-live="polite">
        {rows.map((row, i) => (
          <li key={row.key} data-state={row.state} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold ${DOT[row.state]}`}
            >
              {row.state === "done" ? "✓" : row.state === "failed" ? "!" : row.state === "pending" ? <span className="text-[10px] text-slate">{i + 1}</span> : ""}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${row.state === "pending" ? "text-slate" : row.state === "failed" ? "text-down" : "text-ink"}`}>
                {row.title}
              </p>
              {/* Always one line tall, so rows never jump as details arrive. */}
              <p className={`flex min-h-4 flex-wrap items-center gap-x-2 text-xs leading-4 tabular-nums ${row.state === "failed" ? "text-down" : row.state === "live" ? "text-ink-soft" : "text-slate"}`}>
                <span className={row.key === "signed" || row.key === "sent" ? "font-mono" : ""}>{row.detail}</span>
                {row.copy && (
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(row.copy as string).then(() => setCopied(true), () => {})}
                    title={`Copy the Flash order ID: ${row.copy}`}
                    className="rounded border border-rule px-1.5 font-sans text-[11px] font-semibold text-slate hover:border-lime hover:text-lime"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
                {row.link && (
                  <a href={row.link.href} target="_blank" rel="noreferrer" className="font-semibold text-lime underline decoration-lime/40 underline-offset-2 hover:decoration-lime">
                    {row.link.label}
                  </a>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
