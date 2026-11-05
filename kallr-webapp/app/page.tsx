import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThreadDemo } from "@/components/thread-demo";

const steps = [
  {
    title: "Ask under any call",
    body: "Tag @Kallr under a crypto call. It replies with the caller’s record, what the price did since they posted, and whether their wallet agrees.",
  },
  {
    title: "Copy it with one reply",
    body: "Reply “copy $2, TP 10%, SL 5%”. It buys on Base through Definitive Flash with the take-profit and stop-loss attached. Funds stay in your own wallet.",
  },
  {
    title: "Get a call back",
    body: "When an exit fires, Kallr phones you and posts the result in the original thread, so everyone can see how the call ended.",
  },
];

const desk = [
  ["Orders in plain words", "Type “buy $5 of ETH if it dips to 2,900” and it becomes a resting order."],
  ["Every tailed call in one place", "Live P&L, exits, and one-click edit or cancel."],
  ["Installs like an app", "Pin it to your dock and keep it open next to X."],
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-6 text-sm">
          <a href="#how" className="hidden text-slate hover:text-ink sm:inline">
            How it works
          </a>
          <Link
            href="/app"
            className="rounded-full bg-ink px-5 py-2.5 font-semibold text-white transition-colors hover:bg-ink-soft"
          >
            Open the app
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-16 px-6 pt-10 pb-24 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div>
            <h1 className="font-display text-[clamp(44px,6.4vw,84px)] leading-[0.95] font-semibold tracking-[-0.035em]">
              Every call on X has an after market.
            </h1>
            <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-ink-soft">
              Tag @Kallr under any crypto call to see how the caller’s past calls played out. Reply “copy $2”
              and it places the trade with exits attached, then calls you when one of them hits.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/app"
                className="rounded-full bg-ink px-6 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-ink-soft"
              >
                Open the app
              </Link>
              <a href="#how" className="px-2 py-3.5 text-[15px] font-medium text-ink underline-offset-4 hover:underline">
                See how it works
              </a>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <ThreadDemo />
          </div>
        </section>

        <section id="how" className="border-t border-rule bg-card">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="font-display max-w-xl text-4xl font-semibold tracking-[-0.025em]">
              From a post to a position in three replies.
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step.title}>
                  <span className="font-display grid size-9 place-items-center rounded-full bg-amber text-base font-semibold">
                    {i + 1}
                  </span>
                  <h3 className="font-display mt-5 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-2 max-w-sm leading-relaxed text-slate">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="font-display text-4xl font-semibold tracking-[-0.025em]">The desk, on your laptop.</h2>
            <p className="mt-4 max-w-md leading-relaxed text-slate">
              The bot lives in your replies. The desk is where you set conditions, watch what you’ve copied, and
              change your mind.
            </p>
          </div>
          <dl className="divide-y divide-rule border-y border-rule">
            {desk.map(([term, detail]) => (
              <div key={term} className="grid gap-1 py-5 sm:grid-cols-[14rem_1fr] sm:gap-6">
                <dt className="font-semibold">{term}</dt>
                <dd className="text-slate">{detail}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-slate">
          <span>Built at ETHGlobal Mumbai 2026.</span>
          <span>Trades settle on Base. Not financial advice.</span>
        </div>
      </footer>
    </div>
  );
}
