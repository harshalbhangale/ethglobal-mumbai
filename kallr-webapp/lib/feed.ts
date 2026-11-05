"use client";

import type { WatchlistEntry } from "@kallr/domain";
import { arkivPublic, readOpenCalls, readResults, readTrades } from "@kallr/integrations/arkiv";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { extensionFollows, extensionInstalled, readLocal, updateLocal } from "@/lib/follows";

/**
 * Everything the feed and caller profiles show, read straight from Arkiv: open calls, settled
 * results, and the signed-in wallet's trades (tagged with the surface that placed them).
 * When Arkiv has nothing yet, a clearly labelled sample set fills the screen for demos.
 */

export type Direction = "long" | "short";
export type Source = "desk" | "extension" | "keyboard";

export type CallItem = {
  kind: "call";
  id: string;
  postId: string;
  caller: string;
  asset: string;
  direction: Direction;
  postedAt: number;
  deadline: number;
  entry: number | null;
  sample?: boolean;
};
export type ResultItem = {
  kind: "result";
  id: string;
  postId: string;
  caller: string;
  asset: string;
  direction: Direction;
  status: "hit" | "miss" | "flat";
  returnBps: number;
  entry: number;
  exit: number;
  postedAt: number;
  deadline: number;
  sample?: boolean;
};
export type TradeItem = {
  kind: "trade";
  id: string;
  source: Source;
  asset: string;
  side: "buy" | "sell";
  qty: string;
  caller: string | null;
  postId: string | null;
  takeProfit: number | null;
  stopLoss: number | null;
  placedAt: number;
  flashOrderId: string;
  sample?: boolean;
};
export type FeedItem = CallItem | ResultItem | TradeItem;

export const itemTime = (i: FeedItem) => (i.kind === "trade" ? i.placedAt : i.kind === "result" ? i.deadline : i.postedAt);

type Config = { writer: Hex | null; accessKey: string; explorer?: string };

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

export function useKallrData(address: Address | null) {
  const [config, setConfig] = useState<Config | null>(null);
  const [calls, setCalls] = useState<CallItem[] | null>(null);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [trades, setTrades] = useState<TradeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/arkiv")
      .then((r) => r.json() as Promise<Config>)
      .then(setConfig, () => setError("Couldn’t reach the Kallr server."));
  }, []);

  const client = useMemo(() => (config ? arkivPublic(config.accessKey) : null), [config]);

  const load = useCallback(async () => {
    if (!config || !client) return;
    if (!config.writer) {
      setCalls([]);
      setResults([]);
      setTrades([]);
      return;
    }
    const writer = config.writer;
    const now = Math.floor(Date.now() / 1000);
    const [c, r, t] = await Promise.allSettled([
      readOpenCalls(client, writer, now),
      readResults(client, writer),
      address ? readTrades(client, writer, address) : Promise.resolve([]),
    ]);
    if (c.status === "fulfilled")
      setCalls(
        c.value.map((e) => ({
          kind: "call",
          id: e.$key,
          postId: String(e.postId.value),
          caller: String(e.caller.value),
          asset: String(e.asset.value),
          direction: e.direction.value === "short" ? "short" : "long",
          postedAt: Number(e.postedAt.value),
          deadline: Number(e.deadline.value),
          entry: num(e.entry?.value),
        })),
      );
    if (r.status === "fulfilled")
      setResults(
        r.value.map((e) => ({
          kind: "result",
          id: e.$key,
          postId: String(e.postId.value),
          caller: String(e.caller.value),
          asset: String(e.asset.value),
          direction: e.direction.value === "short" ? "short" : "long",
          status: e.status.value === "hit" ? "hit" : e.status.value === "miss" ? "miss" : "flat",
          returnBps: Number(e.returnBps.value),
          entry: Number(e.entry.value),
          exit: Number(e.exit.value),
          postedAt: Number(e.postedAt.value),
          deadline: Number(e.deadline.value),
        })),
      );
    if (t.status === "fulfilled")
      setTrades(
        t.value.map((e) => ({
          kind: "trade",
          id: e.$key,
          source: (["desk", "extension", "keyboard"].includes(String(e.source.value)) ? e.source.value : "desk") as Source,
          asset: String(e.asset.value),
          side: e.side.value === "sell" ? "sell" : "buy",
          qty: String(e.qty.value),
          caller: e.caller?.value ? String(e.caller.value) : null,
          postId: e.postId?.value ? String(e.postId.value) : null,
          takeProfit: num(e.takeProfit?.value),
          stopLoss: num(e.stopLoss?.value),
          placedAt: Number(e.placedAt.value),
          flashOrderId: String(e.flashOrderId.value),
        })),
      );
    const failed = [c, r, t].find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed ? `Arkiv: ${failed.reason instanceof Error ? failed.reason.message : "read failed"}` : null);
  }, [client, config, address]);

  useEffect(() => {
    load();
    const id = setInterval(load, 25_000);
    return () => clearInterval(id);
  }, [load]);

  const loading = calls === null || results === null || trades === null;
  const empty = !loading && calls.length + results.length + trades.length === 0;
  const sample = empty ? SAMPLE : null;

  return {
    loading,
    error,
    explorer: config?.explorer ?? "https://rabdi.explorer.arkiv.network",
    calls: sample?.calls ?? calls ?? [],
    results: sample?.results ?? results ?? [],
    trades: sample?.trades ?? trades ?? [],
    usingSample: Boolean(sample),
  };
}

/** Followed callers: the extension's list when it is installed, otherwise this browser's. */
export function useFollows() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [viaExtension, setViaExtension] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = () =>
      extensionFollows({ action: "read" })
        .then((list) => !cancelled && (setEntries(list), setViaExtension(true)))
        .catch(() => !cancelled && setEntries(readLocal()));
    const t = setTimeout(() => (extensionInstalled() ? start() : setEntries(readLocal())), 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const toggle = useCallback(
    async (handle: string) => {
      const h = handle.toLowerCase();
      const following = entries.some((e) => e.handle === h);
      const command = { action: following ? "remove" : "add", handle: h } as const;
      try {
        setEntries(viaExtension ? await extensionFollows(command) : updateLocal(command));
      } catch {
        // List full or extension gone: leave it as it was.
      }
    },
    [entries, viaExtension],
  );

  const handles = useMemo(() => new Set(entries.map((e) => e.handle)), [entries]);
  return { entries, handles, toggle, viaExtension };
}

/** Hit rate, median return and counts for one caller from settled results. */
export function callerStats(results: ResultItem[], open: CallItem[]) {
  const hits = results.filter((r) => r.status === "hit").length;
  const sorted = results.map((r) => r.returnBps).sort((a, b) => a - b);
  const mid = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2) : null;
  return {
    settled: results.length,
    open: open.length,
    hitRate: results.length ? hits / results.length : null,
    medianBps: mid,
    best: sorted.length ? sorted[sorted.length - 1]! : null,
  };
}

// ---------- Sample data, only shown while Arkiv is empty ----------

const now = Math.floor(Date.now() / 1000);
const h = 3600;
const SAMPLE_CALLERS = ["alpha_owl", "chart_kite", "quiet_bull", "base_maxi", "moon_ledger"];

const SAMPLE: { calls: CallItem[]; results: ResultItem[]; trades: TradeItem[] } = {
  calls: [
    { kind: "call", id: "s-c1", postId: "1", caller: "alpha_owl", asset: "ETH", direction: "long", postedAt: now - 0.4 * h, deadline: now + 47 * h, entry: 2196.4, sample: true },
    { kind: "call", id: "s-c2", postId: "2", caller: "chart_kite", asset: "BTC", direction: "long", postedAt: now - 1.6 * h, deadline: now + 70 * h, entry: 74120, sample: true },
    { kind: "call", id: "s-c3", postId: "3", caller: "base_maxi", asset: "ETH", direction: "short", postedAt: now - 3.2 * h, deadline: now + 20 * h, entry: 2301.7, sample: true },
    { kind: "call", id: "s-c4", postId: "4", caller: "moon_ledger", asset: "BTC", direction: "short", postedAt: now - 7 * h, deadline: now + 17 * h, entry: 76980, sample: true },
  ],
  results: [
    { kind: "result", id: "s-r1", postId: "5", caller: "quiet_bull", asset: "ETH", direction: "long", status: "hit", returnBps: 812, entry: 2050, exit: 2216.5, postedAt: now - 60 * h, deadline: now - 12 * h, sample: true },
    { kind: "result", id: "s-r2", postId: "6", caller: "alpha_owl", asset: "BTC", direction: "long", status: "hit", returnBps: 365, entry: 71200, exit: 73799, postedAt: now - 80 * h, deadline: now - 8 * h, sample: true },
    { kind: "result", id: "s-r3", postId: "7", caller: "chart_kite", asset: "ETH", direction: "short", status: "miss", returnBps: -420, entry: 2150, exit: 2240.3, postedAt: now - 96 * h, deadline: now - 24 * h, sample: true },
    { kind: "result", id: "s-r4", postId: "8", caller: "base_maxi", asset: "BTC", direction: "long", status: "hit", returnBps: 1190, entry: 66300, exit: 74190, postedAt: now - 200 * h, deadline: now - 30 * h, sample: true },
    { kind: "result", id: "s-r5", postId: "9", caller: "moon_ledger", asset: "ETH", direction: "long", status: "flat", returnBps: 18, entry: 2210, exit: 2214, postedAt: now - 120 * h, deadline: now - 40 * h, sample: true },
    { kind: "result", id: "s-r6", postId: "10", caller: "alpha_owl", asset: "ETH", direction: "long", status: "hit", returnBps: 540, entry: 2080, exit: 2192.3, postedAt: now - 150 * h, deadline: now - 60 * h, sample: true },
  ],
  trades: [
    { kind: "trade", id: "s-t1", source: "extension", asset: "ETH", side: "buy", qty: "50", caller: "alpha_owl", postId: "1", takeProfit: 2420, stopLoss: 2090, placedAt: now - 0.3 * h, flashOrderId: "sample", sample: true },
    { kind: "trade", id: "s-t2", source: "keyboard", asset: "BTC", side: "buy", qty: "25", caller: "chart_kite", postId: "2", takeProfit: 81500, stopLoss: 70400, placedAt: now - 1.5 * h, flashOrderId: "sample", sample: true },
    { kind: "trade", id: "s-t3", source: "keyboard", asset: "ETH", side: "sell", qty: "0.01", caller: "base_maxi", postId: "3", takeProfit: null, stopLoss: null, placedAt: now - 3 * h, flashOrderId: "sample", sample: true },
    { kind: "trade", id: "s-t4", source: "desk", asset: "ETH", side: "buy", qty: "100", caller: null, postId: null, takeProfit: 2500, stopLoss: null, placedAt: now - 20 * h, flashOrderId: "sample", sample: true },
  ],
};

export const SAMPLE_HANDLES = SAMPLE_CALLERS;
