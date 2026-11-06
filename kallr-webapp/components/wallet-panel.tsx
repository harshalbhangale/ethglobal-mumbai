"use client";

import { usePrivy, useSigners } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import type { Session } from "@/components/auth";
import { formatAmount, getBalances, shortAddress, type Balances } from "@/lib/chain";
import { clearXTrading, extensionInstalled, readXTrading, setXTrading } from "@/lib/extension";
import { issueKallKey, SIGNER_ID } from "@/lib/kall-key";

const BASESCAN = "https://basescan.org/address/";


/**
 * The wallet you trade from: your Kall wallet (Privy's embedded wallet, the default) or MetaMask if
 * you switched. Its balances on Base, how to fund it, and trading from X.
 */
export function WalletPanel({ session }: { session: Session }) {
  if (!session.address) return <p className="p-6 text-sm text-slate">Setting up your wallet…</p>;
  const metamask = session.signing === "metamask";
  return (
    <section aria-labelledby="wallet-heading" className="rounded-lg border border-rule bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wallet-heading" className="font-display text-xl font-semibold">
          {metamask ? "MetaMask" : "Your Kall wallet"}
        </h2>
        <CopyAddress address={session.address} />
      </div>
      <p className="mt-1 text-sm text-slate">
        {metamask
          ? "Your own wallet. MetaMask asks you to confirm each order."
          : "Made when you signed in with X. It signs your orders on Base with no pop-ups."}
      </p>
      <Balances address={session.address} />
      <Deposit address={session.address} />
      <Signing session={session} />
      {session.kallAddress && <TradeFromX kallAddress={session.kallAddress} />}
    </section>
  );
}

/** Which wallet signs: the Kall wallet by default, MetaMask if you prefer your own. */
function Signing({ session }: { session: Session }) {
  const metamask = session.signing === "metamask";
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
      <div className="min-w-0">
        <h3 className="font-semibold">Signing</h3>
        <p className="mt-1 text-sm text-slate">
          {metamask ? "MetaMask signs your trades. Your Kall wallet is still there." : "Your Kall wallet signs by default. Prefer your own wallet?"}
        </p>
      </div>
      <button
        type="button"
        onClick={metamask ? session.signWithKall : session.signWithMetaMask}
        className="rounded-md border border-rule px-3 py-1.5 text-sm font-semibold hover:border-rule-strong"
      >
        {metamask ? "Use Kall wallet" : "Use MetaMask"}
      </button>
    </div>
  );
}

type XState = "checking" | "no-extension" | "off" | "busy" | "on";

/**
 * Trade from X with the Kall wallet: adds Kall's signer to the wallet on Privy and hands the extension
 * a key for it, so a trade on the X card signs on the server with no pop-up. Off removes both.
 */
function TradeFromX({ kallAddress }: { kallAddress: Address }) {
  const { getAccessToken } = usePrivy();
  const { addSigners, removeSigners } = useSigners();
  const [state, setState] = useState<XState>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // The extension marks the page once its bridge loads.
    const t = setTimeout(() => {
      if (!extensionInstalled()) return setState("no-extension");
      readXTrading()
        .then((x) => alive && setState(x && x.address.toLowerCase() === kallAddress.toLowerCase() ? "on" : "off"))
        .catch(() => alive && setState("no-extension"));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kallAddress]);

  const turnOn = async () => {
    setState("busy");
    setError(null);
    try {
      const k = await issueKallKey({ address: kallAddress, addSigners, getAccessToken });
      await setXTrading(k.key, k.address, k.expires);
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn it on. Try again.");
      setState("off");
    }
  };

  const turnOff = async () => {
    setState("busy");
    setError(null);
    try {
      await clearXTrading();
      await removeSigners({ address: kallAddress });
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn it off. Try again.");
      setState("on");
    }
  };

  const text: Record<XState, string> = {
    checking: "Checking the extension…",
    "no-extension": "Add the Kall extension to Chrome to trade right under a call on X.",
    off: "Trade right under a call on X: your Kall wallet signs on Kall's server, no pop-ups. Small orders only, and you can turn it off any time.",
    busy: "One moment…",
    on: "On. Trades from the X card sign with your Kall wallet.",
  };
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">Trade from X</h3>
          <p className="mt-1 text-sm text-slate">{SIGNER_ID ? text[state] : "Not set up on this server yet."}</p>
        </div>
        {SIGNER_ID && (state === "off" || state === "on" || state === "busy") && (
          <button
            type="button"
            disabled={state === "busy"}
            onClick={state === "on" ? turnOff : turnOn}
            className={
              state === "on"
                ? "rounded-md border border-rule px-3 py-1.5 text-sm font-semibold text-slate hover:text-ink disabled:opacity-50"
                : "rounded-md bg-lime px-3 py-1.5 text-sm font-semibold text-on-lime hover:bg-lime-strong disabled:opacity-50"
            }
          >
            {state === "on" ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-down">{error}</p>}
    </div>
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
