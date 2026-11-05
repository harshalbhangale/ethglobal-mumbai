"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { formatAmount, getBalances, shortAddress, type Balances } from "@/lib/chain";

export function WalletPanel({ address, embedded }: { address: Address; embedded: boolean }) {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setBalances(await getBalances(address));
    } catch {
      setError("Couldn’t read balances from Base. Check NEXT_PUBLIC_BASE_RPC_URL or try again.");
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const lowGas = balances !== null && Number(balances.eth) < 0.0001;

  return (
    <section aria-labelledby="wallet-heading" className="rounded-2xl border border-rule bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="wallet-heading" className="font-display text-lg font-semibold">
            Trading wallet
          </h2>
          <p className="mt-1 text-sm text-slate">
            {embedded ? "Your embedded wallet on Base." : "Your connected wallet on Base."} Funds stay here until a
            trade fills.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 rounded-full border border-rule px-3 py-1.5 text-sm hover:border-ink"
          title={address}
        >
          {copied ? "Copied" : shortAddress(address)}
        </button>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-rule">
        <div className="bg-card p-4">
          <dt className="text-sm text-slate">USDC</dt>
          <dd className="font-display mt-1 text-3xl font-semibold tracking-tight tabular-nums">
            {balances ? `$${formatAmount(balances.usdc)}` : "…"}
          </dd>
        </div>
        <div className="bg-card p-4">
          <dt className="text-sm text-slate">ETH for gas</dt>
          <dd className="font-display mt-1 text-3xl font-semibold tracking-tight tabular-nums">
            {balances ? formatAmount(balances.eth, 5) : "…"}
          </dd>
        </div>
      </dl>

      {error ? (
        <p className="mt-4 text-sm text-down">{error}</p>
      ) : (
        <p className="mt-4 text-sm text-slate">
          Send USDC on Base to this address to start.
          {lowGas && " Add a little ETH on Base too: your first trade needs one approval transaction."}
        </p>
      )}
    </section>
  );
}
