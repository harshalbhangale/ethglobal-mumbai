"use client";

import { useEffect, useState } from "react";
import { FollowButton } from "@/components/follow-button";
import { shortAddress } from "@/lib/chain";
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
      <p className="mt-1 text-sm text-slate">Sign in with X. You get a Kall Markets wallet on Base, or connect MetaMask.</p>
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

  const [scope, setScope] = useState<Scope>("explore");
  const [caller, setCallerState] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<TicketPrefill | null>(null);

  // /app?caller=handle (old /kol/handle links) opens that caller; nobody followed yet → start on Explore.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("caller");
    if (c && /^[A-Za-z0-9_]{1,15}$/.test(c) && !new URLSearchParams(window.location.search).has("order")) setCallerState(c.toLowerCase());
  }, []);

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

  // Followed callers first, then everyone else Kallr tracks or has calls from.
  const callerHandles = [
    ...new Set([...follows.entries.map((e) => e.handle), ...data.tracked.map((t) => t.handle), ...data.calls.map((c) => c.caller), ...data.results.map((r) => r.caller)]),
  ];
  const ticket = (
    <TradeTicket
      wallet={wallet}
      onPlaced={flashOrders.refresh}
      onViewOrders={() => setView("orders")}
      prefill={prefill}
      signIn={signedIn ? undefined : <SignInButton label="Sign in to trade" />}
    />
  );

  return (
    <div className="min-h-dvh xl:grid xl:grid-cols-[264px_minmax(0,1fr)_380px]">
      {/* Left: navigation and your callers. */}
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-rule bg-card px-3 py-5 xl:flex">
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

        <CallerList
          handles={callerHandles}
          follows={follows}
          data={data}
          active={caller}
          onOpen={setCaller}
        />

        <div className="shrink-0 space-y-3 border-t border-rule pt-4">
          <InstallButton />
          {signedIn ? (
            <AccountCard session={session} onWallet={() => setView("wallet")} />
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
            <h1 className="font-display text-2xl font-semibold">Orders</h1>
            <p className="mb-4 text-sm text-slate">Every order is a Definitive Flash order on Base; every trade is recorded on Arkiv.</p>
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
      <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-l border-rule bg-paper p-4 xl:block">{ticket}</aside>

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

/** Every caller in one list: the ones you follow first, each with its hit rate and a follow toggle. */
function CallerList({
  handles,
  follows,
  data,
  active,
  onOpen,
}: {
  handles: string[];
  follows: ReturnType<typeof useFollows>;
  data: ReturnType<typeof useKallrData>;
  active: string | null;
  onOpen: (h: string) => void;
}) {
  const followed = handles.filter((h) => follows.handles.has(h));
  const others = handles.filter((h) => !follows.handles.has(h));
  const row = (h: string) => {
    const s = callerStats(
      data.results.filter((r) => r.caller === h),
      data.calls.filter((c) => c.caller === h),
    );
    return (
      <li key={h} className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${active === h ? "bg-paper" : "hover:bg-paper/60"}`}>
        <button type="button" onClick={() => onOpen(h)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <KolAvatar handle={h} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">@{h}</span>
            <span className="block text-xs text-slate tabular-nums">
              {s.hitRate === null ? (s.open ? `${s.open} live` : "No record yet") : `${Math.round(s.hitRate * 100)}% hit · ${s.settled}`}
            </span>
          </span>
        </button>
        <FollowButton handle={h} follows={follows} icon />
      </li>
    );
  };
  return (
    <div className="-mx-1 mt-6 mb-4 min-h-0 flex-1 overflow-y-auto px-1">
      {followed.length > 0 && (
        <>
          <p className="px-2 text-xs font-semibold uppercase tracking-wider text-slate">Following · {followed.length}</p>
          <ul className="mt-1.5 space-y-0.5">{followed.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <p className={`${followed.length ? "mt-5" : ""} px-2 text-xs font-semibold uppercase tracking-wider text-slate`}>{followed.length ? "More callers" : "Callers"}</p>
          <ul className="mt-1.5 space-y-0.5">{others.map(row)}</ul>
        </>
      )}
    </div>
  );
}

/** Who is signed in, which wallet trades, and sign out. */
function AccountCard({ session, onWallet }: { session: Session; onWallet: () => void }) {
  return (
    <div className="rounded-lg border border-rule bg-paper p-3">
      <div className="flex items-center gap-2.5">
        <KolAvatar handle={session.handle ?? "you"} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{session.handle ? `@${session.handle}` : "Signed in"}</p>
          <button type="button" onClick={onWallet} className="block truncate text-xs text-slate hover:text-ink">
            {session.address ? shortAddress(session.address) : session.walletName} · Base
          </button>
        </div>
      </div>
      <div className="mt-3 flex gap-2 text-xs">
        <button type="button" onClick={onWallet} className="flex-1 rounded-md border border-rule py-1.5 font-semibold hover:border-lime hover:text-lime">
          Deposit
        </button>
        <button type="button" onClick={() => session.logout()} className="flex-1 rounded-md border border-rule py-1.5 font-semibold text-slate hover:text-ink">
          Sign out
        </button>
      </div>
    </div>
  );
}
