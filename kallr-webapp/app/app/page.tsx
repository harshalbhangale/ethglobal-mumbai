"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OPEN_STATUSES } from "@kallr/integrations/definitive";
import { Logo, LogoMark } from "@/components/logo";
import { SignInButton, WithSession, type Session } from "@/components/auth";
import { InstallButton } from "@/components/install-button";
import { CallsBoard } from "@/components/calls-board";
import { Following } from "@/components/following";
import { useKallrData } from "@/lib/feed";
import { WalletPanel } from "@/components/wallet-panel";
import { useWallets } from "@privy-io/react-auth";
import { OpenOrders, useFlashOrders } from "@/components/order-desk";
import { TradeTicket } from "@/components/trade-ticket";

const nav = [
  { id: "following", label: "Following" },
  { id: "desk", label: "Trade" },
  { id: "orders", label: "Orders" },
  { id: "wallet", label: "Wallet" },
];

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

  if (!session.authenticated) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center">
            <LogoMark size={48} />
          </div>
          <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">Sign in to trade calls</h1>
          <p className="mt-3 text-slate">
            Sign in with X to get your Kallr wallet on Base. You approve every order; the key stays with Privy.
          </p>
          <div className="mt-8 flex justify-center">
            <SignInButton />
          </div>
          <p className="mt-6 text-sm text-slate">
            <a href="/kol" className="border-b border-rule-strong pb-0.5 hover:border-ink">
              Browse live calls first ↗
            </a>
          </p>
        </div>
      </div>
    );
  }

  return <Desk session={session} />;
}

type Tab = (typeof nav)[number]["id"];
const isTab = (v: string): v is Tab => nav.some((n) => n.id === v);

/** One view at a time, kept in the URL hash so links and the back button work; never a jump down a long page. */
function useTab(): [Tab, (t: Tab) => void] {
  const [tab, setTabState] = useState<Tab>("following");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      const fallback: Tab = new URLSearchParams(window.location.search).has("order") ? "desk" : "following";
      setTabState(isTab(h) ? h : fallback);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const setTab = (t: Tab) => {
    if (t !== tab) history.pushState(null, "", `${window.location.pathname}${window.location.search}#${t}`);
    setTabState(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return [tab, setTab];
}

const icons: Record<Tab, React.ReactNode> = {
  desk: <path d="M4 17l6-6 4 4 6-8" />,
  orders: <path d="M5 6h14M5 12h14M5 18h9" />,
  wallet: <path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0V6a2 2 0 0 1 2-2h11M16 13h2" />,
  following: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 8v6M23 11h-6" />,
};

const Icon = ({ tab }: { tab: Tab }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {icons[tab]}
  </svg>
);

const titles: Record<Tab, { title: (handle: string | null) => string; sub: string }> = {
  desk: { title: () => "Trade", sub: "Copy a call, set your exits, and let Kallr watch it for you." },
  orders: { title: () => "Orders", sub: "Live from Definitive Flash. Exits arm when an entry first fills." },
  wallet: { title: () => "Wallet", sub: "Which wallet Kallr trades from, and what's in it on Base." },
  following: { title: (h) => (h ? `Hi, @${h}` : "Following"), sub: "Calls from the callers you follow, read from Arkiv. Star the ones you care about." },
};

function Desk({ session }: { session: Session }) {
  const [tab, setTab] = useTab();
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.address.toLowerCase() === session.address?.toLowerCase()) ?? null;
  const flashOrders = useFlashOrders(session.address);
  const arkiv = useKallrData(session.address);
  const openCount = flashOrders.orders?.filter((o) => OPEN_STATUSES.includes(o.status)).length ?? 0;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-rule bg-card px-5 py-6 lg:flex">
        <Logo href="/app" />
        <nav className="mt-10 flex flex-col gap-1" aria-label="App">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] transition-colors ${
                tab === item.id ? "bg-paper font-semibold text-ink" : "text-slate hover:bg-paper/60 hover:text-ink"
              }`}
            >
              <Icon tab={item.id} />
              <span className="flex-1">{item.label}</span>
              {item.id === "orders" && openCount > 0 && (
                <span className="rounded-full bg-lime px-2 py-0.5 text-xs font-semibold text-on-lime tabular-nums">{openCount}</span>
              )}
            </button>
          ))}
          <div className="my-2 border-t border-rule" />
          <Link href="/kol" className="rounded-lg px-3 py-2 text-[15px] text-slate hover:text-ink">
            All callers
          </Link>
        </nav>
        <div className="mt-auto space-y-3">
          <InstallButton />
          <div className="rounded-xl bg-paper p-3 text-sm">
            <div className="font-semibold">{session.handle ? `@${session.handle}` : "Signed in"}</div>
            <button type="button" onClick={() => session.logout()} className="mt-1 text-slate hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-rule bg-card px-6 py-4 lg:hidden">
          <Logo href="/app" />
          <button type="button" onClick={() => session.logout()} className="text-sm text-slate hover:text-ink">
            Sign out
          </button>
        </header>

        <main className="mx-auto max-w-6xl px-5 pt-8 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          <div className="mb-7">
            <h1 className="font-display text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{titles[tab].title(session.handle)}</h1>
            <p className="mt-2 text-slate">{titles[tab].sub}</p>
          </div>

          {/* Every view stays mounted so typed input and live data survive switching tabs. */}
          <div hidden={tab !== "desk"}>
            <TradeTicket wallet={wallet} onPlaced={flashOrders.refresh} onViewOrders={() => setTab("orders")} />
          </div>
          <div hidden={tab !== "orders"}>
            <OpenOrders
              orders={flashOrders.orders}
              error={flashOrders.error}
              history={{ trades: arkiv.trades, explorer: arkiv.explorer, loading: arkiv.loading }}
            />
          </div>
          <div hidden={tab !== "wallet"} className="max-w-xl">
            <WalletPanel session={session} />
          </div>
          <div hidden={tab !== "following"} className="grid max-w-5xl gap-4 lg:grid-cols-[1fr_300px]">
            <CallsBoard />
            <Following />
          </div>
        </main>
      </div>

      {/* Mobile: tabs at the bottom, within thumb reach. */}
      <nav
        aria-label="App"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-rule bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={`relative flex flex-col items-center gap-1 py-2.5 text-xs font-semibold ${tab === item.id ? "text-ink" : "text-slate"}`}
          >
            <Icon tab={item.id} />
            {item.label}
            {item.id === "orders" && openCount > 0 && (
              <span className="absolute top-1.5 right-[calc(50%-20px)] grid size-4 place-items-center rounded-full bg-lime text-[10px] text-on-lime">{openCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
