"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { publicClient, shortAddress } from "@/lib/chain";
import { formatCoin, type Holding, maxWithdraw, paymentUri, planWithdraw, type WalletView } from "@/lib/transfer";

/** Receive (QR, or straight from a wallet app) and Send (any coin, to any address on Base). */

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg border border-rule bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors ${value === o.id ? "bg-card text-ink shadow-sm" : "text-slate hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CoinIcon({ holding, size = 28 }: { holding: Pick<Holding, "symbol" | "icon">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (holding.icon && !broken)
    return (
      // biome-ignore lint/performance/noImgElement: token logos from many hosts; next/image would need each one allow-listed.
      <img src={holding.icon} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-full bg-paper" style={{ width: size, height: size }} />
    );
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-paper text-xs font-bold text-slate" style={{ width: size, height: size }}>
      {holding.symbol.slice(0, 1)}
    </span>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-rule bg-paper/60 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className="grid size-7 place-items-center rounded-md text-slate hover:bg-card hover:text-ink">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

export function Receive({ address, onClose }: { address: Address; onClose: () => void }) {
  const [coin, setCoin] = useState<"USDC" | "ETH">("USDC");
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const uri = paymentUri(coin, address);

  useEffect(() => {
    let alive = true;
    QRCode.toString(uri, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b0d0c", light: "#ffffff" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [uri]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <Panel title="Receive" onClose={onClose}>
      <div className="mt-4 grid gap-6 sm:grid-cols-[176px_minmax(0,1fr)] sm:items-center">
        <div className="mx-auto rounded-2xl bg-white p-3.5 shadow-sm">
          {svg ? (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG made locally by qrcode from our own payment link.
            <div role="img" aria-label={`QR code to send ${coin} to this wallet on Base`} className="size-[148px] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="size-[148px] animate-pulse rounded-md bg-slate/10" />
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <Segmented
            label="Coin"
            value={coin}
            options={[
              { id: "USDC", label: "USDC" },
              { id: "ETH", label: "ETH" },
            ]}
            onChange={setCoin}
          />
          <p className="text-sm leading-relaxed text-slate">
            Scan with Rainbow, MetaMask, Coinbase Wallet or any wallet to send {coin}. <span className="font-semibold text-ink">Base network only.</span>
          </p>
          <p className="rounded-md border border-rule bg-card px-3 py-2 font-mono text-xs break-all text-ink">{address}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="rounded-md bg-lime px-4 py-2 text-sm font-semibold text-on-lime hover:bg-lime-strong">
              {copied ? "Copied" : "Copy address"}
            </button>
            <a href={uri} className="rounded-md border border-rule bg-card px-4 py-2 text-sm font-semibold hover:border-rule-strong">
              Open in wallet app
            </a>
          </div>
        </div>
      </div>
    </Panel>
  );
}

type Stage = { kind: "edit" } | { kind: "review" } | { kind: "sending"; note: string } | { kind: "sent"; hash: Hex } | { kind: "failed"; message: string };

export function Send({ wallet, view, onSent, onClose }: { wallet: ConnectedWallet | null; view: WalletView | null; onSent: () => void; onClose: () => void }) {
  const [symbol, setSymbol] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "edit" });

  if (!wallet || !view)
    return (
      <Panel title="Send" onClose={onClose}>
        <p className="mt-3 text-sm text-slate">Loading your wallet…</p>
      </Panel>
    );

  // Coins you hold; ETH and USDC are always there to pick.
  const coins = view.holdings.filter((h) => Number(h.balance) > 0 || h.address === null || h.symbol === "USDC");
  const asset = coins.find((h) => h.symbol === symbol) ?? coins[0]!;
  const ethBalance = view.holdings.find((h) => h.address === null)?.balance ?? "0";
  const plan = planWithdraw({ asset, amount, to, from: wallet.address, ethBalance });
  const editing = stage.kind === "edit" || stage.kind === "failed";
  const edit = () => stage.kind !== "edit" && setStage({ kind: "edit" });

  const send = async () => {
    if (!plan.ok) return;
    setStage({ kind: "sending", note: "Sending…" });
    try {
      await wallet.switchChain(8453);
      const provider = await wallet.getEthereumProvider();
      const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, ...plan.tx }] })) as Hex;
      setStage({ kind: "sending", note: "Confirming on Base…" });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") throw new Error("The transfer failed on Base. Nothing was sent.");
      setStage({ kind: "sent", hash });
      setAmount("");
      setTo("");
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStage({ kind: "failed", message: /reject|denied|cancel/i.test(msg) ? "Cancelled. Nothing was sent." : msg });
    }
  };

  if (stage.kind === "sent")
    return (
      <Panel title="Send" onClose={onClose}>
        <p className="mt-4 flex items-center gap-2 font-semibold">
          <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-lime text-xs text-on-lime">
            ✓
          </span>
          Sent on Base
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`https://basescan.org/tx/${stage.hash}`} target="_blank" rel="noreferrer" className="rounded-md border border-rule bg-card px-3 py-1.5 text-sm font-semibold hover:border-lime hover:text-lime">
            View on Basescan ↗
          </a>
          <button type="button" onClick={() => setStage({ kind: "edit" })} className="rounded-md px-3 py-1.5 text-sm font-semibold text-slate hover:text-ink">
            Send more
          </button>
        </div>
      </Panel>
    );

  return (
    <Panel title="Send" onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (plan.ok && editing) setStage({ kind: "review" });
        }}
      >
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Coin to send">
          {coins.map((h) => (
            <button
              key={h.address ?? "eth"}
              type="button"
              role="radio"
              aria-checked={h.symbol === asset.symbol}
              disabled={!editing}
              onClick={() => {
                setSymbol(h.symbol);
                setAmount("");
                edit();
              }}
              className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-semibold ${h.symbol === asset.symbol ? "border-lime bg-lime/10" : "border-rule bg-card hover:border-rule-strong"}`}
            >
              <CoinIcon holding={h} size={22} />
              {h.symbol}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">Amount</span>
            <span className="text-xs text-slate">
              {formatCoin(asset.balance)} {asset.symbol} available
            </span>
          </span>
          <span className="mt-1.5 flex items-center rounded-md border border-rule bg-card focus-within:border-lime">
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              disabled={!editing}
              onChange={(e) => {
                setAmount(e.target.value.replace(",", "."));
                edit();
              }}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-lg font-semibold tabular-nums outline-none placeholder:text-slate/50"
            />
            <span className="px-2 text-sm font-semibold text-slate">{asset.symbol}</span>
            <button
              type="button"
              disabled={!editing}
              onClick={() => {
                setAmount(maxWithdraw(asset));
                edit();
              }}
              className="mr-1.5 rounded px-2 py-1 text-xs font-bold text-lime hover:bg-lime/10"
            >
              MAX
            </button>
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-semibold">To address on Base</span>
          <input
            spellCheck={false}
            autoComplete="off"
            placeholder="0x…"
            value={to}
            disabled={!editing}
            onChange={(e) => {
              setTo(e.target.value);
              edit();
            }}
            className="mt-1.5 w-full rounded-md border border-rule bg-card px-3 py-2.5 font-mono text-sm outline-none placeholder:text-slate/50 focus:border-lime"
          />
        </label>

        {!plan.ok && plan.error && <p className="text-sm text-down">{plan.error}</p>}
        {stage.kind === "failed" && <p className="text-sm text-down">{stage.message}</p>}

        {editing ? (
          <button type="submit" disabled={!plan.ok} className="w-full rounded-md bg-lime py-2.5 text-sm font-semibold text-on-lime hover:bg-lime-strong disabled:opacity-40">
            Review
          </button>
        ) : (
          plan.ok && (
            <div className="rounded-lg border border-rule bg-card p-4">
              <p className="text-sm text-slate">You send</p>
              <p className="font-display mt-0.5 text-2xl font-semibold tabular-nums">
                {plan.amount} {plan.asset.symbol}
              </p>
              <p className="mt-2 text-sm">
                to <span className="font-mono">{shortAddress(plan.to)}</span> <span className="text-slate">on Base</span>
              </p>
              <p className="mt-1 font-mono text-xs break-all text-slate">{plan.to}</p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={send} disabled={stage.kind === "sending"} className="flex-1 rounded-md bg-lime py-2.5 text-sm font-semibold text-on-lime hover:bg-lime-strong disabled:opacity-60">
                  {stage.kind === "sending" ? stage.note : "Confirm and send"}
                </button>
                {stage.kind === "review" && (
                  <button type="button" onClick={() => setStage({ kind: "edit" })} className="rounded-md px-4 py-2.5 text-sm font-semibold text-slate hover:text-ink">
                    Back
                  </button>
                )}
              </div>
              <p className="mt-3 text-xs text-slate">Transfers on Base are final. Check the address.</p>
            </div>
          )
        )}
      </form>
    </Panel>
  );
}
