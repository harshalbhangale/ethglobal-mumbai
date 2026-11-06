"use client";

import { usePrivy, useSigners } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { type Session, useTradingWallet } from "@/components/auth";
import { CoinIcon, Receive, Send } from "@/components/move-funds";
import { shortAddress } from "@/lib/chain";
import { clearXTrading, extensionInstalled, readXTrading, setXTrading } from "@/lib/extension";
import { formatCoin, type Holding, type WalletView } from "@/lib/transfer";

const BASESCAN = "https://basescan.org/address/";

/** Kall's signer on Privy: lets the server sign trades from X with your Kall wallet once you allow it. */
const SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID ?? "";

/** Everything the wallet holds on Base, from /api/wallet, refreshed every 20s and after a send. */
function useWalletView(address: Address) {
  const [view, setView] = useState<WalletView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/wallet?address=${address}`);
      const body = (await res.json()) as WalletView & { error?: string };
      if (!res.ok) throw new Error(body.error);
      setView(body);
      setError(null);
    } catch {
      setError("Couldn't read your balances on Base. Retrying…");
    }
  }, [address]);
  useEffect(() => {
    setView(null);
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);
  return { view, error, refresh };
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The wallet you trade from: your Kall wallet (Privy's embedded wallet, the default) or MetaMask if
 * you switched. What it's worth, Receive and Send, every coin it holds, and trading from X.
 */
export function WalletPanel({ session }: { session: Session }) {
  const { wallet } = useTradingWallet();
  if (!session.address) return <p className="p-6 text-sm text-slate">Setting up your wallet…</p>;
  return <WalletBody session={session} address={session.address} wallet={wallet} />;
}

function WalletBody({ session, address, wallet }: { session: Session; address: Address; wallet: ReturnType<typeof useTradingWallet>["wallet"] }) {
  const { view, error, refresh } = useWalletView(address);
  const [action, setAction] = useState<"receive" | "send" | null>(null);
  const metamask = session.signing === "metamask";
  const toggle = (a: "receive" | "send") => setAction((now) => (now === a ? null : a));
  const button = (a: "receive" | "send") =>
    `flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-6 ${
      action === a ? "bg-lime text-on-lime" : "border border-rule bg-paper hover:border-rule-strong"
    }`;

  return (
    <section aria-labelledby="wallet-heading" className="rounded-lg border border-rule bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wallet-heading" className="font-display text-xl font-semibold">
          {metamask ? "MetaMask" : "Your Kall wallet"}
        </h2>
        <CopyAddress address={address} />
      </div>
      <p className="mt-1 text-sm text-slate">
        {metamask ? "Your own wallet. MetaMask asks you to confirm each order." : "Made when you signed in with X. It signs your orders on Base with no pop-ups."}
      </p>

      <p className="mt-6 text-sm text-slate">Total balance</p>
      <p className="font-display mt-1 text-4xl font-semibold tracking-tight tabular-nums">{view ? usd(view.totalUsd) : "…"}</p>
      {error && <p className="mt-1 text-sm text-down">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button type="button" aria-expanded={action === "receive"} onClick={() => toggle("receive")} className={button("receive")}>
          <span aria-hidden="true">↓</span> Receive
        </button>
        <button type="button" aria-expanded={action === "send"} onClick={() => toggle("send")} className={button("send")}>
          <span aria-hidden="true">↑</span> Send
        </button>
      </div>
      {action === "receive" && <Receive address={address} onClose={() => setAction(null)} />}
      {action === "send" && <Send wallet={wallet} view={view} onSent={refresh} onClose={() => setAction(null)} />}

      <Assets view={view} onReceive={() => setAction("receive")} />
      <Signing session={session} />
      {session.kallAddress && <TradeFromX kallAddress={session.kallAddress} />}
    </section>
  );
}

/** Every coin the wallet holds: logo, name, amount and value. */
function Assets({ view, onReceive }: { view: WalletView | null; onReceive: () => void }) {
  if (!view) return <div className="mt-6 h-24 animate-pulse rounded-lg bg-paper" />;
  const shown = view.holdings.filter((h) => Number(h.balance) > 0 || h.address === null || h.symbol === "USDC");
  const eth = view.holdings.find((h) => h.address === null);
  const lowGas = eth !== undefined && Number(eth.balance) < 0.0001;
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <h3 className="text-sm font-semibold text-slate">Assets</h3>
      <ul className="mt-2 divide-y divide-rule">
        {shown.map((h) => (
          <AssetRow key={h.address ?? "eth"} h={h} />
        ))}
      </ul>
      {view.totalUsd === 0 ? (
        <p className="mt-3 text-sm text-slate">
          Empty on Base.{" "}
          <button type="button" onClick={onReceive} className="font-semibold text-ink underline underline-offset-4">
            Receive
          </button>{" "}
          USDC to trade and about $1 of ETH for gas.
        </p>
      ) : lowGas ? (
        <p className="mt-3 text-sm text-slate">Add about $1 of ETH on Base for gas.</p>
      ) : null}
    </div>
  );
}

function AssetRow({ h }: { h: Holding }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <CoinIcon holding={h} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{h.symbol}</span>
        <span className="block truncate text-xs text-slate">{h.name ?? h.symbol}</span>
      </span>
      <span className="text-right">
        <span className="block font-semibold tabular-nums">{h.valueUsd === null ? "—" : usd(h.valueUsd)}</span>
        <span className="block text-xs text-slate tabular-nums">
          {formatCoin(h.balance)} {h.symbol}
        </span>
      </span>
    </li>
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
      await addSigners({ address: kallAddress, signers: [{ signerId: SIGNER_ID }] }).catch((e: unknown) => {
        // Already added on an earlier visit: carry on.
        if (!/already/i.test(e instanceof Error ? e.message : "")) throw e;
      });
      const res = await fetch("/api/x/key", { method: "POST", headers: { authorization: `Bearer ${await getAccessToken()}` } });
      const body = (await res.json().catch(() => ({}))) as { key?: string; address?: string; expires?: number; error?: string };
      if (!res.ok || !body.key || !body.address || !body.expires) throw new Error(body.error ?? "Couldn't turn it on. Try again.");
      await setXTrading(body.key, body.address, body.expires);
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
