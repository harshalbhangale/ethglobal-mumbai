import Link from "next/link";
import { Logo } from "@/components/logo";
import { SignalField } from "@/components/signal-field";

const steps = [
  {
    title: "Spot a call",
    body: "On X, the Kallr extension marks every post that calls a coin. In Telegram or any other app, copy the message and the Kallr keyboard reads it.",
  },
  {
    title: "See the record",
    body: "How that caller’s past calls actually played out, priced on Chainlink the minute each was posted. Fake contracts get flagged before you can buy them.",
  },
  {
    title: "Copy it, with exits",
    body: "Buy on Base through Definitive Flash with a take-profit and stop-loss attached. Every order is signed by your own wallet.",
  },
];

const surfaces = [
  {
    name: "Chrome extension",
    where: "On X",
    lines: ["The caller’s record under every call", "Copy with one click, exits attached", "Market orders on Base, from your wallet"],
  },
  {
    name: "Android keyboard",
    where: "In any app",
    lines: ["Reads calls you copy from Telegram or X", "Type or say an order: “buy $20 of degen if it dips 10%”", "Swap, limit or TWAP without leaving the chat"],
  },
];

const sponsors = [
  { name: "Arkiv", logo: "/sponsors/arkiv.png", href: "https://arkiv.network", role: "Every call, result and trade is written to Arkiv." },
  { name: "Swarm", logo: "/sponsors/swarm.svg", href: "https://www.ethswarm.org", role: "Each call’s post is snapshotted to Swarm." },
  { name: "Chainlink", logo: "/sponsors/chainlink.svg", href: "https://chain.link", role: "Calls are priced and settled on Chainlink feeds." },
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-6 lg:px-[7%]">
          <Logo />
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/app#feed" className="hidden text-slate hover:text-ink sm:inline">
              Callers
            </Link>
            <a href="#how" className="hidden text-slate hover:text-ink sm:inline">
              How it works
            </a>
            <Link href="/app" className="rounded-md bg-lime px-4 py-2.5 font-semibold text-on-lime transition-colors hover:bg-lime-strong">
              Open Kallr <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative flex min-h-[min(860px,96vh)] items-center overflow-hidden border-b border-rule">
          <SignalField />
          <div className="relative z-10 mx-auto w-full max-w-[1280px] px-6 pt-28 pb-20 lg:px-[7%]">
            <p className="font-mono text-xs tracking-[0.08em] text-slate">
              <span className="text-[15px] text-lime">KALLR</span> / CALLS FROM X. TRADES ON BASE.
              <span className="terminal-cursor" aria-hidden="true">
                _
              </span>
            </p>
            <h1 className="font-display mt-7 text-[clamp(50px,7.4vw,112px)] leading-[0.98] font-extrabold tracking-[-0.045em] uppercase">
              <span className="block text-ink">See the call.</span>
              <span className="block text-ink">Check the caller.</span>
              <span className="block text-lime">
                Trade it.
                <span className="type-caret" aria-hidden="true" />
              </span>
            </h1>
            <p className="mt-8 max-w-[38rem] text-base leading-[1.65] whitespace-pre-line text-slate">
              {
                "Every call on X gets a record: how the caller’s past calls actually played out.\nCopy it from the post with the extension, or from any chat with the Kallr keyboard.\nYour wallet. Your approval. Orders on Base through Definitive Flash."
              }
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Link
                href="/app"
                className="inline-flex items-center gap-4 rounded-md bg-lime px-5 py-3.5 font-semibold text-on-lime transition-colors hover:bg-lime-strong"
              >
                See live calls <span aria-hidden="true">↗</span>
              </Link>
              <a href="#how" className="border-b border-rule-strong py-2 font-medium hover:border-ink">
                How it works <span aria-hidden="true">↓</span>
              </a>
              <Link href="/app#orders" className="border-b border-rule-strong py-2 font-medium hover:border-ink">
                Every trade, on Arkiv <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
          <span className="absolute bottom-6 left-6 z-10 hidden font-mono text-[11px] tracking-[0.08em] text-slate sm:block lg:left-[7%]">
            FROM POST TO POSITION <span aria-hidden="true">↓</span>
          </span>
        </section>

        <section aria-label="Built with" className="border-b border-rule">
          <div className="mx-auto max-w-[1280px] px-6 py-16 lg:px-[7%]">
            <div className="grid items-center gap-8 md:grid-cols-[1.1fr_1fr]">
              <div>
                <p className="font-mono text-xs tracking-[0.08em] text-slate">EVERY ORDER RUNS ON</p>
                <a href="https://www.definitive.fi" target="_blank" rel="noreferrer" className="mt-5 block w-fit opacity-95 transition-opacity hover:opacity-100">
                  <img src="/sponsors/definitive.svg" alt="Definitive" className="h-9 w-auto sm:h-11" />
                </a>
              </div>
              <p className="max-w-md leading-relaxed text-slate">
                Kallr is built entirely on <span className="text-ink">Definitive Flash</span>. Every buy, sell, limit and
                TWAP order, from X or the keyboard, is a Flash order on Base: quote, price impact and fee up front, signed by
                your own wallet.
              </p>
            </div>
            <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-3">
              {sponsors.map((s) => (
                <li key={s.name} className="bg-paper">
                  <a href={s.href} target="_blank" rel="noreferrer" className="group flex h-full flex-col gap-4 p-6">
                    <img src={s.logo} alt={s.name} className="h-6 w-auto self-start opacity-70 transition-opacity group-hover:opacity-100" />
                    <span className="text-sm text-slate">{s.role}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="border-b border-rule">
          <div className="mx-auto max-w-[1280px] px-6 py-24 lg:px-[7%]">
            <p className="font-mono text-xs tracking-[0.08em] text-slate">HOW IT WORKS</p>
            <h2 className="font-display mt-4 max-w-2xl text-[clamp(32px,4vw,52px)] leading-[1.02] font-bold tracking-[-0.035em]">
              From a post to a position, without leaving the chat.
            </h2>
            <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-rule bg-rule md:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step.title} className="bg-paper p-7">
                  <span className="font-mono text-sm text-lime">0{i + 1}</span>
                  <h3 className="font-display mt-6 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-slate">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-b border-rule">
          <div className="mx-auto grid max-w-[1280px] gap-10 px-6 py-24 md:grid-cols-[1fr_1.4fr] lg:px-[7%]">
            <div>
              <p className="font-mono text-xs tracking-[0.08em] text-slate">TWO WAYS IN</p>
              <h2 className="font-display mt-4 text-[clamp(32px,4vw,52px)] leading-[1.02] font-bold tracking-[-0.035em]">
                Where the calls are.
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-slate">
                The same wallet and the same records on your laptop and your phone. Every trade and every call result is
                written to Arkiv, and each post is kept on Swarm, so the record can’t be quietly edited.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {surfaces.map((s) => (
                <div key={s.name} className="rounded-xl border border-rule bg-card p-6">
                  <p className="font-mono text-[11px] tracking-[0.08em] text-lime uppercase">{s.where}</p>
                  <h3 className="font-display mt-3 text-xl font-semibold">{s.name}</h3>
                  <ul className="mt-4 space-y-2.5 text-sm text-ink-soft">
                    {s.lines.map((line) => (
                      <li key={line} className="flex gap-2.5">
                        <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-lime" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-8 font-mono text-xs tracking-[0.04em] text-slate lg:px-[7%]">
          <span>BUILT AT ETHGLOBAL MUMBAI 2026 · DEFINITIVE FLASH · ARKIV · SWARM</span>
          <span>Trades settle on Base. Not financial advice.</span>
        </div>
      </footer>
    </div>
  );
}
