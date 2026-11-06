"use client";

import type { WatchlistEntry } from "@kallr/domain";
import { arkivPublic, readOpenCalls, readResults, readTrackedCallers, readTrades } from "@kallr/integrations/arkiv";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { extensionFollows, extensionInstalled, readLocal, updateLocal } from "./follows";

/**
 * Everything the feed and caller profiles show, read straight from Arkiv: open calls, settled
 * results, and the signed-in wallet's trades (tagged with the surface that placed them).
 * Plus the roster of callers Kallr follows (kallr.tracked-callers). Nothing here is made up.
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

/** Calls are stored as up/down (see callValues); older or hand-written entities may say short. */
export const toDirection = (v: unknown): Direction => (v === "down" || v === "short" ? "short" : "long");

/**
 * Copying a call opens the real desk, prefilled with $1 and exits, where the user reviews and signs.
 * Only long ETH/BTC calls can be copied: the desk buys on Base, and a short would mean selling what you hold.
 */
export function copyCall(c: { caller: string; postId: string; asset: string; direction: Direction }): { href: string } | { reason: string } {
  if (c.direction !== "long") return { reason: "Short call · can't copy shorts yet" };
  if (c.asset !== "ETH" && c.asset !== "BTC") return { reason: `$${c.asset} isn't tradable on Base yet` };
  const q = new URLSearchParams({ order: `copy $1 of ${c.asset} tp 10% sl 5%`, post: c.postId, caller: c.caller });
  return { href: `/app?${q}` };
}

export type TrackedCaller = { handle: string; focus: string };

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

export function useKallrData(address: Address | null) {
  const [config, setConfig] = useState<Config | null>(null);
  const [calls, setCalls] = useState<CallItem[] | null>(null);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [trades, setTrades] = useState<TradeItem[] | null>(null);
  const [tracked, setTracked] = useState<TrackedCaller[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/arkiv")
      .then((r) => r.json() as Promise<Config>)
      .then(setConfig, () => setError("Couldn’t reach the Kall Markets server."));
  }, []);

  const client = useMemo(() => (config ? arkivPublic(config.accessKey) : null), [config]);

  const load = useCallback(async () => {
    if (!config || !client) return;
    if (!config.writer) {
      setCalls([]);
      setResults([]);
      setTrades([]);
      setTracked([]);
      return;
    }
    const writer = config.writer;
    const now = Math.floor(Date.now() / 1000);
    const [c, r, t, k] = await Promise.allSettled([
      readOpenCalls(client, writer, now),
      readResults(client, writer),
      address ? readTrades(client, writer, address) : Promise.resolve([]),
      readTrackedCallers(client, writer),
    ]);
    if (c.status === "fulfilled")
      setCalls(
        c.value.map((e) => ({
          kind: "call",
          id: e.$key,
          postId: String(e.postId.value),
          caller: String(e.caller.value),
          asset: String(e.asset.value),
          direction: toDirection(e.direction.value),
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
          direction: toDirection(e.direction.value),
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
    if (k.status === "fulfilled")
      setTracked(k.value.map((e) => ({ handle: String(e.handle.value).toLowerCase(), focus: String(e.focus.value) })));
    // A failed read shows as empty plus an error, never an endless skeleton.
    if (c.status === "rejected") setCalls((v) => v ?? []);
    if (r.status === "rejected") setResults((v) => v ?? []);
    if (t.status === "rejected") setTrades((v) => v ?? []);
    if (k.status === "rejected") setTracked((v) => v ?? []);
    const failed = [c, r, t, k].find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed ? `Arkiv: ${failed.reason instanceof Error ? failed.reason.message.split("\n")[0] : "read failed"}` : null);
  }, [client, config, address]);

  useEffect(() => {
    load();
    const id = setInterval(load, 25_000);
    return () => clearInterval(id);
  }, [load]);

  const loading = calls === null || results === null || trades === null;

  return {
    loading,
    error,
    explorer: config?.explorer ?? "https://rabdi.explorer.arkiv.network",
    writer: config?.writer ?? null,
    calls: calls ?? [],
    results: results ?? [],
    trades: trades ?? [],
    /** Callers Kallr follows, from Arkiv's kallr.tracked-callers. */
    tracked: tracked ?? [],
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

