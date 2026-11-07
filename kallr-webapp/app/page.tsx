import Link from "next/link";
import { DownloadApp } from "@/components/download-app";
import { LogoMark } from "@/components/logo";
import { Hero3D } from "@/components/hero-3d";
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
    lines: ["Open any call on X: the caller's record is on their profile.", "Fake contract? A red Call check failed, and no trade.", "Buy from the post with your Kall wallet, and get a Basescan receipt."],
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
    lines: ["The real posts from callers you follow, with their verdicts.", "Copy a call: the ticket fills in, and your Kall wallet signs it.", "Orders, history and every proof on Arkiv."],
    cta: { label: "Open the app", href: "/app" },
  },
];

/** The three rails, each with a real transaction anyone can open. */
const spotlight = [
  {
    name: "Definitive",
    logo: "/sponsors/definitive.svg",
    tag: "Every trade",
    line: "Every buy and sell, from X, the keyboard or the web, is a Definitive Flash order on Base: best route, MEV protected.",
    proof: { label: "Keyboard fill on Basescan", href: "https://basescan.org/tx/0x89b678a1f56a290db3976813b14d83c9799ee3ad5a6fc63e17287e6c35a8a0f1" },
  },
  {
    name: "Chainlink",
    logo: "/sponsors/chainlink.svg",
    tag: "Chainlink CRE · the checks",
    line: "Chainlink nodes check the coin in a post is the real one and score every call, signing the verdict on chain.",
    proof: { label: "Impostor $TOSHI, blocked", href: "https://sepolia.basescan.org/tx/0x07091f3be329eae796dd14d9319b42aeeabd8394594b550590492b96e73d3002" },
  },
  {
    name: "Arkiv",
    logo: "/sponsors/arkiv.png",
    tag: "The receipts",
    line: "Every call, result and trade is a read-only record on Arkiv’s Rabdi testnet. Nobody can edit a miss.",
    proof: { label: "$SOL call, HIT +1.20%", href: "https://rabdi.explorer.arkiv.network/tx/0x4b9dcd3bce0f23436abd1de694048e7beb93a848718be564c481ca7760b40ed1" },
  },
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

        {/* How it works, in 3D: particles become a price chart, a globe, then the Kall logo. */}
        <section className="relative border-b border-rule">
          <Hero3D from={1}>
            <div className="hero3d-step mx-auto flex max-w-[1360px] flex-col items-end justify-center px-6 text-right lg:px-10">
              <p className="font-mono text-xs tracking-[0.16em] text-lime">01 · PRICED AT THE POST</p>
              <h2 className="hero3d-text font-display mt-4 max-w-[13ch] text-[clamp(38px,5.2vw,80px)] leading-[0.95] font-bold tracking-[-0.04em]">
                Every call has a price tag. And a verdict.
              </h2>
              <p className="hero3d-text mt-6 max-w-[28rem] text-lg leading-[1.6] text-ink-soft">
                Chainlink prices the entry the minute it’s posted. Chainlink CRE scores it when time’s up. Hit or miss, forever on Arkiv.
              </p>
              <div className="hero3d-text mt-7 flex gap-8 font-mono text-sm text-slate">
                <span>
                  <b className="font-display block text-3xl text-up">HIT +1.20%</b>$SOL · AltcoinSherpa
                </span>
                <span>
                  <b className="font-display block text-3xl text-down">MISS −6.47%</b>$ETH · CryptoKaleo
                </span>
              </div>
            </div>

            <div className="hero3d-step mx-auto flex max-w-[1360px] flex-col justify-center px-6 lg:px-10">
              <p className="font-mono text-xs tracking-[0.16em] text-lime">02 · WHEREVER THE CALL IS</p>
              <h2 className="hero3d-text font-display mt-4 max-w-[12ch] text-[clamp(38px,5.2vw,80px)] leading-[0.95] font-bold tracking-[-0.04em]">
                X, Telegram, any chat. Phone or laptop.
              </h2>
              <p className="hero3d-text mt-6 max-w-[28rem] text-lg leading-[1.6] text-ink-soft">
                The extension trades under the tweet. The keyboard trades inside the group chat. One tap, and it settles on Base.
              </p>
            </div>

            <div className="hero3d-step mx-auto flex max-w-[1360px] flex-col items-center justify-center px-6 text-center lg:px-10">
              <p className="font-mono text-xs tracking-[0.16em] text-lime">03 · BUILT ON</p>
              <h2 className="hero3d-text font-display mt-4 text-[clamp(40px,5.6vw,88px)] leading-[0.95] font-bold tracking-[-0.045em]">
                Trading just got faster.
              </h2>
              <ul className="mt-10 grid w-full max-w-5xl gap-4 text-left md:grid-cols-3">
                {spotlight.map((s) => (
                  <li key={s.name} className="spot rounded-xl border border-rule-strong bg-paper/75 p-6 backdrop-blur-md">
                    <img src={s.logo} alt={s.name} className="h-7 w-auto" />
                    <p className="mt-2 font-mono text-[11px] tracking-[0.14em] text-lime uppercase">{s.tag}</p>
                    <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{s.line}</p>
                    <a href={s.proof.href} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 font-mono text-xs text-slate hover:text-lime">
                      {s.proof.label} <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <Link href="/app" className="cta-pulse inline-flex items-center gap-3 rounded-md bg-lime px-7 py-4 text-lg font-semibold text-on-lime hover:bg-lime-strong">
                  Open Kall Markets <span aria-hidden="true">↗</span>
                </Link>
                <DownloadApp align="left" label="Download our mobile app" />
              </div>
            </div>
          </Hero3D>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-4 px-6 py-8 font-mono text-xs tracking-[0.04em] text-slate lg:px-10">
          <span>BUILT AT ETHGLOBAL MUMBAI 2026 · DEFINITIVE FLASH · CHAINLINK CRE · ARKIV · SWARM</span>
          <span>Trades settle on Base. Not financial advice.</span>
        </div>
      </footer>
    </div>
  );
}
