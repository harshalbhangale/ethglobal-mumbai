"use client";

import { useEffect, useState } from "react";
import { OPEN_STATUSES } from "@kallr/integrations/definitive";
import { useWallets } from "@privy-io/react-auth";
import { Logo, LogoMark } from "@/components/logo";
import { SignInButton, WithSession, type Session } from "@/components/auth";
import { InstallButton } from "@/components/install-button";
import { CallsBoard, type Row, type Scope } from "@/components/calls-board";
import { KolAvatar } from "@/components/kol-avatar";
import { WalletPanel } from "@/components/wallet-panel";
import { OpenOrders, useFlashOrders } from "@/components/order-desk";
import { type TicketPrefill, TradeTicket } from "@/components/trade-ticket";
import { callerStats, copyCall, useFollows, useKallrData } from "@/lib/feed";

/**
 * Kallr in one screen: callers on the left, their real posts in the middle with Kallr's verdict, and
 * the trade ticket always on the right. Orders and Wallet swap the middle. On a phone the ticket is
 * its own tab, and Copy call jumps to it.
 */

const views = [
  { id: "feed", label: "Feed" },
  { id: "orders", label: "Orders" },
  { id: "wallet", label: "Wallet" },
] as const;
type View = (typeof views)[number]["id"] | "trade";

export default function AppPage() {
  return <WithSession>{(session) => <AppShell session={session} />}</WithSession>;
}

function AppShell({ session }: { session: Session }) {
  if (!session.ready) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }
  return <Terminal session={session} />;
}

/** The view in the URL hash, so links and the back button work. Old #following / #desk links still land. */
function useView(): [View, (v: View) => void] {
  const [view, setViewState] = useState<View>("feed");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      const fromLink = new URLSearchParams(window.location.search).has("order");
      setViewState(h === "orders" || h === "wallet" ? h : h === "trade" || h === "desk" || fromLink ? "trade" : "feed");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const setView = (v: View) => {
    if (v !== view) history.pushState(null, "", `${window.location.pathname}${window.location.search}#${v}`);
    setViewState(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return [view, setView];
}

const icons: Record<View, React.ReactNode> = {
  feed: <path d="M4 5h16M4 12h16M4 19h10" />,
  trade: <path d="M4 17l6-6 4 4 6-8" />,
  orders: <path d="M5 6h14M5 12h14M5 18h9" />,
  wallet: <path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0V6a2 2 0 0 1 2-2h11M16 13h2" />,
};
const Icon = ({ view }: { view: View }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {icons[view]}
  </svg>
);

function SignInCard({ what }: { what: string }) {
  return (
    <section className="rounded-lg border border-rule bg-card p-6 text-center">
      <p className="font-semibold">Sign in to {what}</p>
      <p className="mt-1 text-sm text-slate">Sign in with X. You get a Kallr wallet on Base, or connect MetaMask.</p>
      <div className="mt-4 flex justify-center">
        <SignInButton />
      </div>
    </section>
  );
}

function Terminal({ session }: { session: Session }) {
  const [view, setView] = useView();
  const signedIn = session.authenticated;
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.address.toLowerCase() === session.address?.toLowerCase()) ?? null;
  const flashOrders = useFlashOrders(signedIn ? session.address : null);
  const data = useKallrData(signedIn ? session.address : null);
  const follows = useFollows();
  const openCount = flashOrders.orders?.filter((o) => OPEN_STATUSES.includes(o.status)).length ?? 0;

  const [scope, setScope] = useState<Scope>("following");
  const [caller, setCallerState] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<TicketPrefill | null>(null);

  // /app?caller=handle (old /kol/handle links) opens that caller; nobody followed yet → start on Explore.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("caller");
    if (c && /^[A-Za-z0-9_]{1,15}$/.test(c) && !new URLSearchParams(window.location.search).has("order")) setCallerState(c.toLowerCase());
  }, []);
  useEffect(() => {
    if (follows.entries.length === 0) setScope("explore");
  }, [follows.entries.length]);

  const setCaller = (h: string | null) => {
    setCallerState(h);
    if (view !== "feed") setView("feed");
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const onCopy = (row: Row) => {
    const r = copyCall(row);
    if (!("href" in r)) return;
    const order = new URL(r.href, window.location.origin).searchParams.get("order") ?? "";
    setPrefill({ order, postId: row.postId, caller: row.caller, nonce: Date.now() });
    // Desktop: the ticket is already on screen. Phone: jump to it.
    if (window.matchMedia("(max-width: 1279px)").matches) setView("trade");
  };

  const followed = follows.entries.map((e) => e.handle);
  const ticket = signedIn ? (
    <TradeTicket wallet={wallet} onPlaced={flashOrders.refresh} onViewOrders={() => setView("orders")} prefill={prefill} />
  ) : (
    <SignInCard what="trade" />
  );

  return (
    <div className="min-h-dvh xl:grid xl:grid-cols-[240px_minmax(0,1fr)_400px]">
      {/* Left: navigation and your callers. */}
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-rule bg-card px-4 py-6 xl:flex">
        <Logo href="/app" />
        <nav className="mt-8 flex flex-col gap-1" aria-label="App">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => (v.id === "feed" ? setCaller(null) : setView(v.id))}
              aria-current={view === v.id ? "page" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-[15px] ${view === v.id ? "bg-paper font-semibold text-ink" : "text-slate hover:bg-paper/60 hover:text-ink"}`}
            >
              <Icon view={v.id} />
              <span className="flex-1">{v.label}</span>
              {v.id === "orders" && openCount > 0 && (
                <span className="rounded-md bg-lime px-1.5 py-0.5 text-xs font-semibold text-on-lime tabular-nums">{openCount}</span>
              )}
            </button>
          ))}
        </nav>

        <p className="mt-8 px-3 text-xs font-semibold uppercase tracking-wider text-slate">Following</p>
        <ul className="mt-2 space-y-0.5">
          {followed.map((h) => {
            const s = callerStats(
              data.results.filter((r) => r.caller === h),
              data.calls.filter((c) => c.caller === h),
            );
            return (
              <li key={h}>
                <button
                  type="button"
                  onClick={() => setCaller(h)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left ${caller === h ? "bg-paper" : "hover:bg-paper/60"}`}
                >
                  <KolAvatar handle={h} size={26} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">@{h}</span>
                  <span className="text-xs text-slate tabular-nums">{s.hitRate === null ? (s.open ? `${s.open} open` : "") : `${Math.round(s.hitRate * 100)}%`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => {
            setCaller(null);
            setScope("explore");
          }}
          className="mt-1 rounded-md px-3 py-1.5 text-left text-sm font-semibold text-slate hover:text-ink"
        >
          + Explore callers
        </button>

        <div className="mt-auto space-y-3 pt-6">
          <InstallButton />
          {signedIn ? (
            <div className="rounded-md bg-paper p-3 text-sm">
              <div className="font-semibold">{session.handle ? `@${session.handle}` : "Signed in"}</div>
              <div className="text-xs text-slate">{session.walletName}</div>
              <button type="button" onClick={() => session.logout()} className="mt-1 text-slate hover:text-ink">
                Sign out
              </button>
            </div>
          ) : (
            <SignInButton />
          )}
        </div>
      </aside>

      {/* Middle: the feed, or Orders / Wallet. */}
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-rule bg-card px-5 py-3 xl:hidden">
          <Logo href="/app" />
          {signedIn ? (
            <button type="button" onClick={() => session.logout()} className="text-sm text-slate hover:text-ink">
              Sign out
            </button>
          ) : (
            <SignInButton />
          )}
        </header>
        <main className="mx-auto max-w-2xl px-4 pt-6 pb-28 sm:px-6 xl:pb-12">
          <div hidden={view !== "feed"}>
            <CallsBoard data={data} follows={follows} scope={scope} setScope={setScope} caller={caller} setCaller={setCaller} onCopy={onCopy} />
          </div>
          <div hidden={view !== "orders"}>
            <h1 className="font-display mb-4 text-2xl font-semibold">Orders</h1>
            {signedIn ? (
              <OpenOrders orders={flashOrders.orders} error={flashOrders.error} history={{ trades: data.trades, explorer: data.explorer, loading: data.loading }} />
            ) : (
              <SignInCard what="see your orders" />
            )}
          </div>
          <div hidden={view !== "wallet"}>
            <h1 className="font-display mb-4 text-2xl font-semibold">Wallet</h1>
            {signedIn ? <WalletPanel session={session} /> : <SignInCard what="see your wallet" />}
          </div>
          {/* Phone only: the ticket as its own view. */}
          <div hidden={view !== "trade"} className="xl:hidden">
            {ticket}
          </div>
        </main>
      </div>

      {/* Right: the trade ticket, always on screen. */}
      <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-l border-rule bg-card p-5 xl:block">{ticket}</aside>

      {/* Phone: views at the bottom, within thumb reach. */}
      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-rule bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden">
        {(["feed", "trade", "orders", "wallet"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-current={view === v ? "page" : undefined}
            className={`relative flex flex-col items-center gap-1 py-2.5 text-xs font-semibold capitalize ${view === v ? "text-ink" : "text-slate"}`}
          >
            <Icon view={v} />
            {v}
            {v === "orders" && openCount > 0 && (
              <span className="absolute top-1.5 right-[calc(50%-20px)] grid size-4 place-items-center rounded-full bg-lime text-[10px] text-on-lime">{openCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
