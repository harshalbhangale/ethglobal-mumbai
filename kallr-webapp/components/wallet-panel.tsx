"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import type { Session } from "@/components/auth";
import { formatAmount, getBalances, shortAddress, type Balances } from "@/lib/chain";

const BASESCAN = "https://basescan.org/address/";

/**
 * Your Kall wallet: the embedded wallet Privy made when you signed in, its balances on Base, and
 * how to fund it.
 */
export function WalletPanel({ session }: { session: Session }) {
  if (!session.address) return <p className="p-6 text-sm text-slate">Setting up your wallet…</p>;
  return (
    <section aria-labelledby="wallet-heading" className="rounded-lg border border-rule bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wallet-heading" className="font-display text-xl font-semibold">
          Your Kall wallet
        </h2>
        <CopyAddress address={session.address} />
      </div>
      <p className="mt-1 text-sm text-slate">Made when you signed in with X. It signs your orders on Base, and only you can use it.</p>
      <Balances address={session.address} />
      <Deposit address={session.address} />
    </section>
  );
}

function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="rounded-md border border-rule px-3 py-1.5 text-sm hover:border-rule-strong"
        title={address}
      >
        {copied ? "Copied" : shortAddress(address)}
      </button>
      <a href={`${BASESCAN}${address}`} target="_blank" rel="noreferrer" className="text-sm text-slate hover:text-ink">
        Basescan ↗
      </a>
    </span>
  );
}

function Balances({ address }: { address: Address }) {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setBalances(await getBalances(address));
    } catch {
      setError("Couldn’t read balances from Base. Try again in a moment.");
    }
  }, [address]);

  useEffect(() => {
    setBalances(null);
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const empty = balances !== null && Number(balances.usdc) === 0 && Number(balances.eth) === 0;
  const lowGas = balances !== null && Number(balances.eth) < 0.0001;

  return (
    <>
      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-rule">
        <div className="bg-card p-4">
          <dt className="text-sm text-slate">USDC</dt>
          <dd className="font-display mt-1 text-3xl font-semibold tracking-tight tabular-nums">{balances ? `$${formatAmount(balances.usdc)}` : "…"}</dd>
        </div>
        <div className="bg-card p-4">
          <dt className="text-sm text-slate">ETH</dt>
          <dd className="font-display mt-1 text-3xl font-semibold tracking-tight tabular-nums">{balances ? formatAmount(balances.eth, 5) : "…"}</dd>
        </div>
      </dl>
      {error ? (
        <p className="mt-3 text-sm text-down">{error}</p>
      ) : empty ? (
        <p className="mt-3 text-sm text-slate">Empty on Base. Deposit below to start.</p>
      ) : lowGas ? (
        <p className="mt-3 text-sm text-slate">Add about $1 of ETH on Base for gas.</p>
      ) : null}
    </>
  );
}

/** Add funds: the address on Base, and the one rule that matters. */
function Deposit({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <h3 className="font-semibold">Deposit</h3>
      <p className="mt-1 text-sm text-slate">Send USDC to trade and about $1 of ETH for gas, on Base only.</p>
      <p className="mt-3 font-mono text-sm break-all text-ink">{address}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="rounded-md bg-lime px-4 py-2 text-sm font-semibold text-on-lime hover:bg-lime-strong">
          {copied ? "Copied" : "Copy address"}
        </button>
        <a href={`${BASESCAN}${address}`} target="_blank" rel="noreferrer" className="rounded-md px-4 py-2 text-sm font-semibold text-slate hover:text-ink">
          Basescan ↗
        </a>
      </div>
    </div>
  );
}
