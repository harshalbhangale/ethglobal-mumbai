"use client";

import { type CSSProperties, useEffect, useState } from "react";

/**
 * The landing hero as a short story: a call on X with the Kall Extension under it, then the same caller
 * in the Kall Web App, then the call in a Telegram chat with the Kall Keyboard. Plays one scene at a
 * time and loops; the tabs jump to a scene. Each scene restarts its own steps when it comes back.
 */

const SCENES = [
  { id: "x", label: "Spot it on X", tag: "KALL EXTENSION" },
  { id: "web", label: "Follow the caller", tag: "KALL WEB APP" },
  { id: "phone", label: "Trade from any chat", tag: "KALL KEYBOARD" },
] as const;
const SCENE_MS = 5600;

const at = (ms: number) => ({ ["--d" as string]: `${ms}ms` }) as CSSProperties;

function Def({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return <img src={dark ? "/brand/definitive-icon-dark.svg" : "/sponsors/definitive.svg"} alt="Definitive" className={`inline-block w-auto ${className}`} />;
}

function Tweet() {
  return (
    <div className="hs-in rounded-xl border border-[#2f3336] bg-black p-4" style={at(0)}>
      <div className="flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#2f3a2a] to-[#141a12] text-sm font-extrabold text-lime">K</div>
        <div className="leading-tight">
          <b className="text-[14px] tracking-[0.18em]">KALEO</b>
          <div className="text-[12px] text-[#71767b]">@CryptoKaleo · 2m</div>
        </div>
        <span className="ml-auto text-lg font-black">𝕏</span>
      </div>
      <p className="mt-3 text-[15px] leading-snug">
        <span className="text-[#1d9bf0]">#Ethereum</span> / <span className="text-[#1d9bf0]">$ETH</span>
        <br />
        <br />
        BOUNCE
        <br />
        BE MORE BULLISH 🚀
      </p>
    </div>
  );
}

function SceneX() {
  return (
    <div className="space-y-3">
      <Tweet />
      <div className="hs-up relative rounded-2xl border border-[#2f3336] bg-black p-4 shadow-2xl" style={at(900)}>
        <span className="absolute -top-3 left-4 rounded-md bg-lime px-2 py-0.5 text-[10px] font-extrabold tracking-[0.08em] text-on-lime">KALL EXTENSION · ON X</span>
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#8a92b2] to-[#454a75] font-black">Ξ</div>
          <div className="leading-tight">
            <b className="text-[14px]">Ethereum</b>
            <div className="text-[11px] text-[#71767b]">$ETH · WETH on Base</div>
          </div>
          <div className="ml-auto text-right leading-tight">
            <b className="text-[15px]">$2,245</b>
            <div className="text-[11px] font-bold text-up">+1.8%</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#16181c] px-3 py-2 text-[12.5px]">
          <span className="font-bold text-[#1d9bf0]">@CryptoKaleo</span>
          <span className="font-bold text-up">Long $ETH</span>
          <span className="hs-follow ml-auto rounded-full px-3 py-1 text-[11px] font-extrabold" style={at(1700)} />
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-[11px]">
          {[
            ["You get", "0.0022 ETH"],
            ["Price impact", "0.03%"],
            ["Flash fee", "Free"],
          ].map(([k, v], i) => (
            <div key={k} className="hs-in rounded-lg bg-[#16181c] px-2.5 py-2" style={at(2200 + i * 160)}>
              <div className="text-[#71767b]">{k}</div>
              <b className="text-[13px]">{v}</b>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="hs-press flex flex-1 items-center justify-center gap-2 rounded-xl bg-lime py-2.5 text-[13px] font-extrabold text-on-lime" style={at(3200)}>
            Buy ETH · $5 <Def dark className="h-3" />
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-[#0052ff] px-2.5 py-1.5 text-[11px] font-extrabold">
            <i className="size-1.5 rounded-full bg-white" /> Base
          </span>
        </div>
        <div className="mt-2.5 flex items-center justify-end gap-1.5 text-[10.5px] text-[#71767b]">
          Powered by <Def className="h-2.5" />
        </div>
      </div>
    </div>
  );
}

function SceneWeb() {
  return (
    <div className="hs-in overflow-hidden rounded-xl border border-rule-strong bg-paper shadow-2xl" style={at(0)}>
      <div className="flex items-center gap-1.5 border-b border-rule bg-[#111511] px-3 py-2">
        <i className="size-2 rounded-full bg-rule-strong" />
        <i className="size-2 rounded-full bg-rule-strong" />
        <i className="size-2 rounded-full bg-rule-strong" />
        <span className="ml-3 flex-1 rounded bg-[#0a0d0b] px-2 py-0.5 text-[10px] text-slate">kallr.vercel.app/app</span>
      </div>
      <div className="grid grid-cols-[120px_1fr] text-[11.5px]">
        <aside className="border-r border-rule bg-card p-3">
          <div className="font-semibold">Feed</div>
          <div className="mt-1 text-slate">Orders</div>
          <div className="mt-1 text-slate">Wallet</div>
          <div className="mt-3 text-[9px] tracking-[0.12em] text-slate">FOLLOWING</div>
          <div className="mt-1.5 text-slate">@altcoinsherpa</div>
          <div className="hs-slide mt-1 rounded bg-lime/15 px-1 font-semibold text-lime" style={at(700)}>
            + @cryptokaleo
          </div>
          <div className="mt-1 text-slate">@inmortalcrypto</div>
        </aside>
        <main className="p-3">
          <div className="flex gap-4 border-b border-rule pb-1.5 font-semibold">
            <span className="border-b-2 border-lime">Following</span>
            <span className="text-slate">Explore</span>
          </div>
          <div className="hs-up mt-2.5 overflow-hidden rounded-lg border border-rule bg-card" style={at(1300)}>
            <div className="m-2 rounded-md border border-[#2a332c] bg-black p-2.5">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-[#1f2a19] text-[10px] font-extrabold text-lime">K</span>
                <b>KALEO</b>
                <span className="text-slate">@CryptoKaleo · 2m</span>
              </div>
              <p className="mt-1.5 text-[12px]">
                <span className="text-[#1d9bf0]">$ETH</span> BOUNCE. BE MORE BULLISH 🚀
              </p>
            </div>
            <div className="flex items-center gap-2.5 border-t border-rule px-2.5 py-2">
              <b>
                <span className="text-up">LONG</span> $ETH
              </b>
              <span className="text-slate">Entry $2,301</span>
              <span className="hs-tick font-semibold text-up" style={at(2300)}>
                +2.4% since the call
              </span>
              <span className="hs-press ml-auto rounded bg-lime px-2 py-1 font-bold text-on-lime" style={at(3000)}>
                Copy call
              </span>
            </div>
          </div>
          <div className="hs-up mt-2.5 rounded-lg border border-lime/40 bg-card p-2.5" style={at(3600)}>
            <div className="flex items-center justify-between">
              <b>Buy ETH</b>
              <span className="text-slate">copying @cryptokaleo</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between rounded border border-rule px-2 py-1.5">
              <span className="text-slate">You pay</span>
              <b className="text-[14px]">$5.00</b>
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 rounded bg-lime py-1.5 font-extrabold text-on-lime">
              Place on Base <Def dark className="h-2.5" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ScenePhone() {
  return (
    <div className="hs-in mx-auto w-[300px] rounded-[44px] border border-[#3a433b] bg-gradient-to-br from-[#2b312a] to-[#0f120f] p-2.5 shadow-2xl" style={at(0)}>
      <div className="relative flex h-[540px] flex-col overflow-hidden rounded-[36px] bg-black">
        <div className="absolute top-2.5 left-1/2 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
        <div className="flex justify-between px-6 pt-3 text-[11px] font-bold">
          <span>9:41</span>
          <span>●●▮</span>
        </div>
        <div className="mt-3 flex items-center gap-2 border-b border-[#1b1f1c] px-3 pb-2">
          <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-[#2aabee] to-[#1e88c9] text-xs font-extrabold">α</span>
          <div className="leading-tight">
            <b className="text-[12px]">Alpha Calls</b>
            <div className="text-[10px] text-slate">Telegram · 1,284 members</div>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 bg-gradient-to-b from-[#0b0f0c] to-[#060806] p-3 text-[12px]">
          <div className="hs-in max-w-[85%] rounded-2xl bg-[#1b211c] px-3 py-2" style={at(500)}>
            <div className="text-[10px] font-bold text-slate">@CryptoKaleo</div>$ETH bounce. Be more bullish 🚀
          </div>
          <div className="hs-in w-fit rounded-xl border border-lime/40 bg-lime/10 px-2.5 py-1.5 text-[11px] font-bold text-lime" style={at(2000)}>
            ✓ Kall read: LONG $ETH · caller 2 open
          </div>
          <div className="hs-pop mt-auto self-center rounded-xl bg-lime px-3 py-2 text-[12px] font-extrabold text-on-lime" style={at(4000)}>
            Trade placed ✓ $25 of ETH
          </div>
        </div>
        <div className="hs-kb" style={at(1200)}>
          <img src="/brand/keyboard-panel.png" alt="The Kall Keyboard trade panel" className="block w-full" />
        </div>
      </div>
    </div>
  );
}

export function HeroStory() {
  const [step, setStep] = useState(0);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      setStep((s) => (s + 1) % SCENES.length);
      setRound((r) => r + 1);
    }, SCENE_MS);
    return () => clearTimeout(id);
  }, [step, round]);

  const go = (i: number) => {
    setStep(i);
    setRound((r) => r + 1);
  };

  return (
    <div className="relative">
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="How Kall Markets works">
        {SCENES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={step === i}
            onClick={() => go(i)}
            className={`relative overflow-hidden rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors ${step === i ? "border-lime text-ink" : "border-rule-strong text-slate hover:text-ink"}`}
          >
            <span className="font-mono text-[10px] tracking-[0.1em] text-lime">0{i + 1} · {s.tag}</span>
            <span className="block">{s.label}</span>
            {step === i && <span key={round} className="hs-progress absolute bottom-0 left-0 h-[2px] bg-lime" style={{ ["--ms" as string]: `${SCENE_MS}ms` }} />}
          </button>
        ))}
      </div>
      <div className="relative min-h-[560px]">
        <div key={`${step}-${round}`} className="hs-scene">
          {step === 0 && <SceneX />}
          {step === 1 && <SceneWeb />}
          {step === 2 && <ScenePhone />}
        </div>
      </div>
    </div>
  );
}
