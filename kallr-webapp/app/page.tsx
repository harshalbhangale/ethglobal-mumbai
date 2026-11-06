import Link from "next/link";
import { DownloadApp } from "@/components/download-app";
import { LogoMark } from "@/components/logo";
import { HeroStory } from "@/components/hero-story";
import { SignalField } from "@/components/signal-field";

/** Real calls Kall Markets priced and wrote to Arkiv, for the ticker under the hero. */
const tape = [
  { who: "@CryptoKaleo", call: "LONG $ETH", note: "open · entry $2,301", tone: "text-lime" },
  { who: "@AltcoinSherpa", call: "LONG $SOL", note: "HIT +1.20%", tone: "text-up" },
  { who: "@inmortalcrypto", call: "LONG $BTC", note: "HIT +1.23%", tone: "text-up" },
  { who: "@CryptoKaleo", call: "LONG $BTC", note: "MISS −5.11%", tone: "text-down" },
  { who: "@AltcoinSherpa", call: "LONG $BTC", note: "open · bounce area", tone: "text-lime" },
  { who: "@inmortalcrypto", call: "LONG $ETH", note: "MISS −5.49%", tone: "text-down" },
  { who: "spare_acct", call: "$PEPE 0x7a1b…4567", note: "CALL CHECK FAILED", tone: "text-down" },
];

const products = [
  {
    tag: "On X",
    name: "Kall Extension",
    lines: ["Open any call on X: the caller's record is on their profile.", "Fake contract? A red Call check failed, and no trade.", "Buy from the post: Flash quote, sign in MetaMask, Basescan receipt."],
    cta: { label: "Load the extension", href: "https://github.com/harshalbhangale/ethglobal-mumbai#kall-extension" },
  },
  {
    tag: "Android & iOS",
    name: "Kall Keyboard",
    lines: ["Install it on Android or iPhone, in any chat.", "Copy a call from Telegram, X or WhatsApp: it reads it and checks the caller.", "Tap Trade: swap without leaving the chat."],
    cta: { label: "Get the keyboard", href: "https://github.com/harshalbhangale/ethglobal-mumbai#kall-keyboard" },
  },
  {
    tag: "On the web",
    name: "Kall Web App",
    lines: ["The real posts from callers you follow, with their verdicts.", "Copy call fills the ticket. MetaMask or your Privy wallet.", "Orders, history and every proof on Arkiv."],
    cta: { label: "Open the app", href: "/app" },
  },
];

const sponsors = [
  { name: "Arkiv", logo: "/sponsors/arkiv.png", href: "https://arkiv.network", role: "Every call, result and trade is written to Arkiv." },
  { name: "Swarm", logo: "/sponsors/swarm.svg", href: "https://www.ethswarm.org", role: "Each call’s post is snapshotted to Swarm." },
  { name: "Chainlink", logo: "/sponsors/chainlink.svg", href: "https://chain.link", role: "Calls are priced and settled on Chainlink feeds." },
];

/** Kall Markets, on Definitive Flash: the lockup in the header. */
function Lockup() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="Kall Markets, on Definitive Flash">
      <LogoMark size={34} />
      <span className="leading-none">
        <span className="font-display block text-[19px] font-semibold tracking-[-0.02em]">Kall Markets</span>
        <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-slate">
          ON <img src="/sponsors/definitive.svg" alt="Definitive" className="h-[9px] w-auto opacity-90" /> FLASH
        </span>
      </span>
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="landing min-h-dvh overflow-x-clip">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between px-6 py-6 lg:px-10">
          <Lockup />
          <nav className="flex items-center gap-6 text-sm">
            <a href="#products" className="hidden text-slate hover:text-ink sm:inline">
              Products
            </a>
            <Link href="/app#feed" className="hidden text-slate hover:text-ink sm:inline">
              Callers
            </Link>
            <span className="hidden md:inline-block">
              <DownloadApp label="Get the app" />
            </span>
            <Link href="/app" className="shrink-0 rounded-md bg-lime px-4 py-2.5 font-semibold whitespace-nowrap text-on-lime transition-colors hover:bg-lime-strong">
              <span className="hidden sm:inline">Open Kall Markets</span>
              <span className="sm:hidden">Open app</span> <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: the line, and the three products on screen. */}
        <section className="relative overflow-hidden border-b border-rule">
          <SignalField />
          <div className="hero-glow" aria-hidden="true" />
          <div className="relative z-10 mx-auto grid max-w-[1360px] items-center gap-10 px-6 pt-32 pb-16 lg:grid-cols-[1fr_1.2fr] lg:px-10 lg:pt-36 lg:pb-24">
            <div>
              <p className="lp-rise font-mono text-xs tracking-[0.16em] text-lime" style={{ ["--d" as string]: "0ms" }}>
                CALLS FROM X · TRADES ON BASE
                <span className="terminal-cursor" aria-hidden="true">
                  _
                </span>
              </p>
              <h1 className="font-display mt-6 text-[clamp(44px,4.9vw,78px)] leading-[0.95] font-extrabold tracking-[-0.045em] uppercase">
                <span className="lp-rise block text-ink" style={{ ["--d" as string]: "120ms" }}>
                  Don’t trust.
                </span>
                <span className="lp-rise block text-ink" style={{ ["--d" as string]: "260ms" }}>
                  Check the caller.
                </span>
                <span className="lp-rise block" style={{ ["--d" as string]: "400ms" }}>
                  <span className="lp-shine">Trade it.</span>
                  <span className="type-caret" aria-hidden="true" />
                </span>
              </h1>
              <p className="lp-rise mt-7 max-w-[34rem] text-lg leading-[1.6] text-ink-soft" style={{ ["--d" as string]: "560ms" }}>
                Every call on X is priced the minute it’s posted and scored when it ends, on Arkiv for anyone to check. Fake
                contracts get flagged. The real calls are one tap from a trade.
              </p>
              <div className="lp-rise relative z-30 mt-9 flex flex-wrap items-center gap-x-7 gap-y-4" style={{ ["--d" as string]: "700ms" }}>
                <Link href="/app" className="cta-pulse inline-flex items-center gap-3 rounded-md bg-lime px-6 py-3.5 font-semibold text-on-lime transition-colors hover:bg-lime-strong">
                  See live calls <span aria-hidden="true">↗</span>
                </Link>
<DownloadApp align="left" label="Download our mobile app" />
                <a href="#products" className="border-b border-rule-strong py-2 font-medium hover:border-ink">
                  Extension · Keyboard · Web app <span aria-hidden="true">↓</span>
                </a>
              </div>
              <div className="lp-rise mt-10 flex items-center gap-3 font-mono text-[11px] tracking-[0.12em] text-slate" style={{ ["--d" as string]: "840ms" }}>
                EVERY ORDER RUNS ON
                <img src="/sponsors/definitive.svg" alt="Definitive" className="h-4 w-auto" />
                <span className="text-ink">FLASH</span>
              </div>
            </div>
            <div className="devices relative" aria-label="Kall Markets on a laptop, on X and on a phone">
              <img src="/brand/hero-devices.webp" alt="The Kall Web App on a laptop, the Kall Extension's trade card on X, and the Kall Keyboard on an iPhone" width={1600} height={1200} className="relative z-10 w-full" />
              <div className="scan" aria-hidden="true" />
            </div>
          </div>

          {/* Real calls, scrolling by. */}
          <div className="relative z-10 border-t border-rule bg-paper/70 backdrop-blur" aria-label="Recent calls on Kall Markets">
            <div className="tape flex w-max gap-10 py-3.5 font-mono text-[12px] tracking-[0.06em] whitespace-nowrap">
              {[...tape, ...tape].map((t, i) => (
                <span key={i} className="flex items-center gap-3" aria-hidden={i >= tape.length}>
                  <span className="text-slate">{t.who}</span>
                  <span className="text-ink">{t.call}</span>
                  <span className={t.tone}>{t.note}</span>
                  <span className="text-rule-strong">/</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* The flow, played one step at a time. */}
        <section id="how" className="border-b border-rule">
          <div className="mx-auto grid max-w-[1360px] items-center gap-12 px-6 py-24 lg:grid-cols-[0.8fr_1.2fr] lg:px-10">
            <div className="reveal">
              <p className="font-mono text-xs tracking-[0.16em] text-lime">HOW IT WORKS</p>
              <h2 className="font-display mt-4 text-[clamp(34px,4.4vw,58px)] leading-[1.0] font-bold tracking-[-0.035em]">
                From a post to a position.
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-slate">Spot the call on X, follow the caller, trade it from any chat.</p>
            </div>
            <HeroStory />
          </div>
        </section>

        {/* The three products and how to use each. */}
        <section id="products" className="border-b border-rule">
          <div className="mx-auto max-w-[1360px] px-6 py-24 lg:px-10">
            <p className="font-mono text-xs tracking-[0.16em] text-lime">ONE PRODUCT · THREE PLACES</p>
            <h2 className="font-display mt-4 max-w-3xl text-[clamp(34px,4.4vw,58px)] leading-[1.0] font-bold tracking-[-0.035em]">
              Wherever the call is, the check and the trade are right there.
            </h2>
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {products.map((p, i) => (
                <article key={p.name} className="reveal card-glow group relative flex flex-col rounded-xl border border-rule bg-card p-7" style={{ ["--d" as string]: `${i * 120}ms` }}>
                  <p className="font-mono text-[11px] tracking-[0.12em] text-lime uppercase">{p.tag}</p>
                  <h3 className="font-display mt-3 text-2xl font-semibold tracking-[-0.02em]">{p.name}</h3>
                  <ol className="mt-6 flex-1 space-y-4">
                    {p.lines.map((line, n) => (
                      <li key={line} className="flex gap-3 text-[15px] leading-relaxed text-ink-soft">
                        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-rule-strong font-mono text-[11px] text-lime">{n + 1}</span>
                        {line}
                      </li>
                    ))}
                  </ol>
                  <Link href={p.cta.href} className="mt-8 inline-flex w-fit items-center gap-2 rounded-md border border-rule-strong px-4 py-2.5 text-sm font-semibold transition-colors group-hover:border-lime group-hover:bg-lime group-hover:text-on-lime">
                    {p.cta.label} <span aria-hidden="true">↗</span>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Built on. */}
        <section aria-label="Built with" className="border-b border-rule">
          <div className="mx-auto max-w-[1360px] px-6 py-20 lg:px-10">
            <div className="reveal grid items-center gap-8 md:grid-cols-[1.1fr_1fr]">
              <div>
                <p className="font-mono text-xs tracking-[0.16em] text-slate">EVERY ORDER RUNS ON</p>
                <a href="https://www.definitive.fi" target="_blank" rel="noreferrer" className="mt-5 block w-fit opacity-95 transition-opacity hover:opacity-100">
                  <img src="/sponsors/definitive.svg" alt="Definitive" className="h-10 w-auto sm:h-12" />
                </a>
              </div>
              <p className="max-w-md leading-relaxed text-slate">
                Kall Markets is built entirely on <span className="text-ink">Definitive Flash</span>. Every buy, sell, limit and TWAP
                order, from X, the keyboard or the web, is a Flash order on Base: quote, price impact and fee up front, signed by
                your own wallet.
              </p>
            </div>
            <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-3">
              {sponsors.map((s, i) => (
                <li key={s.name} className="reveal bg-paper" style={{ ["--d" as string]: `${i * 100}ms` }}>
                  <a href={s.href} target="_blank" rel="noreferrer" className="group flex h-full flex-col gap-4 p-6">
                    <img src={s.logo} alt={s.name} className="h-6 w-auto self-start opacity-70 transition-opacity group-hover:opacity-100" />
                    <span className="text-sm text-slate">{s.role}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Closing line. */}
        <section className="relative overflow-hidden border-b border-rule">
          <div className="hero-glow hero-glow-low" aria-hidden="true" />
          <div className="reveal relative mx-auto max-w-[1360px] px-6 py-24 text-center lg:px-10">
            <h2 className="font-display text-[clamp(40px,6vw,88px)] leading-[0.95] font-extrabold tracking-[-0.045em] uppercase">
              Check first. <span className="lp-shine">Then trade.</span>
            </h2>
            <Link href="/app" className="cta-pulse mt-10 inline-flex items-center gap-3 rounded-md bg-lime px-7 py-4 text-lg font-semibold text-on-lime hover:bg-lime-strong">
              Open Kall Markets <span aria-hidden="true">↗</span>
            </Link>
            <div className="mt-5">
              <DownloadApp align="left" label="Download our mobile app" />
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-4 px-6 py-8 font-mono text-xs tracking-[0.04em] text-slate lg:px-10">
          <span>BUILT AT ETHGLOBAL MUMBAI 2026 · DEFINITIVE FLASH · ARKIV · SWARM</span>
          <span>Trades settle on Base. Not financial advice.</span>
        </div>
      </footer>
    </div>
  );
}
