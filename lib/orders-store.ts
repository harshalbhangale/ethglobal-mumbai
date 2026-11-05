"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExitPrices, ParsedOrder } from "./order";

export type OrderStatus = "awaiting-flash" | "cancelled";

export type StoredOrder = {
  id: string;
  createdAt: number;
  text: string;
  order: ParsedOrder;
  exits: ExitPrices;
  status: OrderStatus;
};

const KEY = "aftermarkets.orders.v1";

function load(): StoredOrder[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as StoredOrder[];
  } catch {
    return [];
  }
}

function save(orders: StoredOrder[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    // Storage blocked (private window): orders still live for this session.
  }
}

/**
 * Orders queued on this device until the Flash integration submits them on-chain.
 * Kept in localStorage so the desk survives a reload during the demo.
 */
export function useOrders() {
  const [orders, setOrders] = useState<StoredOrder[]>([]);

  useEffect(() => setOrders(load()), []);

  const update = useCallback((fn: (prev: StoredOrder[]) => StoredOrder[]) => {
    setOrders((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const add = useCallback(
    (o: Omit<StoredOrder, "id" | "createdAt" | "status">) =>
      update((prev) => [{ ...o, id: crypto.randomUUID(), createdAt: Date.now(), status: "awaiting-flash" }, ...prev]),
    [update],
  );

  const cancel = useCallback(
    (id: string) => update((prev) => prev.map((o) => (o.id === id ? { ...o, status: "cancelled" } : o))),
    [update],
  );

  return { orders, add, cancel };
}
