"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import type { Session, SessionWallet } from "@/components/auth";
import { formatAmount, getBalances, shortAddress, type Balances } from "@/lib/chain";

const BASESCAN = "https://basescan.org/address/";

/**
 * Which wallet Kallr trades from, said plainly (MetaMask or the Kallr wallet Privy made for you), its
 * balances on Base, and a switch to any other connected wallet.
 */
export function WalletPanel({ session }: { session: Session }) {
  const active = session.wallets.find((w) => w.address.toLowerCase() === session.address?.toLowerCase()) ?? null;
  const others = session.wallets.filter((w) => w !== active);

  if (!session.address) {
    return <section className="rounded-lg border border-rule bg-card p-6 text-sm text-slate">Setting up your wallet…</section>;
  }

  return (
    <div className="space-y-4">
      <section aria-labelledby="wallet-heading" className="rounded-lg border border-rule bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate">Trading from</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 id="wallet-heading" className="font-display flex items-center gap-2 text-xl font-semibold">
            <WalletKind wallet={active} />
            {active?.name ?? session.walletName}
          </h2>
          <CopyAddress address={session.address} />
        </div>
        <p className="mt-1 text-sm text-slate">
          {active?.embedded
            ? "The wallet Privy made for you when you signed in with X. Only you can sign from it."
            : "Your own wallet. Kallr asks it to sign every order; funds never leave it until a trade fills."}{" "}
          Network: <span className="font-semibold text-ink">Base</span>.
        </p>
        <Balances address={session.address} />
      </section>

      <section className="rounded-lg border border-rule bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Your wallets</h3>
          <button
            type="button"
            onClick={session.connectWallet}
            className="rounded-md border border-rule-strong px-3 py-1.5 text-sm font-semibold hover:border-lime hover:bg-lime hover:text-on-lime"
          >
            Connect a wallet
          </button>
        </div>
        <ul className="mt-3 divide-y divide-rule">
          {active && <WalletRow wallet={active} current />}
          {others.map((w) => (
            <WalletRow key={w.address} wallet={w} onUse={() => session.selectWallet(w.address)} />
          ))}
        </ul>
        {others.length === 0 && (
          <p className="mt-3 text-sm text-slate">
            {active?.embedded
              ? "Have funds in MetaMask? Connect it and trade from it directly."
              : "Your Kallr (Privy) wallet appears here too once it's created."}
          </p>
        )}
      </section>
    </div>
  );
}

function WalletKind({ wallet }: { wallet: SessionWallet | null }) {
  const embedded = wallet?.embedded ?? true;
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${embedded ? "bg-raised text-ink" : "bg-lime text-on-lime"}`}
      title={embedded ? "Embedded wallet made by Privy" : "A wallet you connected"}
    >
      {embedded ? "Embedded" : "Connected"}
    </span>
  );
}

function WalletRow({ wallet, current, onUse }: { wallet: SessionWallet; current?: boolean; onUse?: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold">
          <WalletKind wallet={wallet} />
          {wallet.name}
        </p>
        <a href={`${BASESCAN}${wallet.address}`} target="_blank" rel="noreferrer" className="text-sm text-slate hover:text-ink">
          {shortAddress(wallet.address)} on Basescan ↗
        </a>
      </div>
      {current ? (
        <span className="text-sm font-semibold text-up">Trading from this</span>
      ) : (
        <button type="button" onClick={onUse} className="rounded-md border border-rule-strong px-3 py-1.5 text-sm font-semibold hover:border-lime hover:bg-lime hover:text-on-lime">
          Use this
        </button>
      )}
    </li>
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
        <p className="mt-3 text-sm text-slate">This wallet is empty on Base. Send it USDC or ETH on Base, or switch to a wallet that has funds.</p>
      ) : lowGas ? (
        <p className="mt-3 text-sm text-slate">Add a few cents of ETH on Base for gas: the first trade needs one approval.</p>
      ) : null}
    </>
  );
}
