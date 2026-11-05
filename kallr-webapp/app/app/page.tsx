"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo, LogoMark } from "@/components/logo";
import { SignInButton, WithSession, type Session } from "@/components/auth";
import { InstallButton } from "@/components/install-button";
import { Following } from "@/components/following";
import { WalletPanel } from "@/components/wallet-panel";
import { useWallets } from "@privy-io/react-auth";
import { OpenOrders, OrderComposer, useFlashOrders } from "@/components/order-desk";

const nav = [
  { id: "desk", label: "Desk" },
  { id: "orders", label: "Orders" },
  { id: "wallet", label: "Wallet" },
  { id: "following", label: "Following" },
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
            Sign in with X so your replies to @Kallr link to your wallet. You get a wallet on Base if you
            don’t have one.
          </p>
          <div className="mt-8 flex justify-center">
            <SignInButton />
          </div>
        </div>
      </div>
    );
  }

  return <Desk session={session} />;
}

function Desk({ session }: { session: Session }) {
  const [active, setActive] = useState("desk");
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.address.toLowerCase() === session.address?.toLowerCase()) ?? null;
  const flashOrders = useFlashOrders(session.address);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[248px_1fr]">
      <aside className="hidden flex-col border-r border-rule bg-card px-5 py-6 lg:flex">
        <Logo href="/app" />
        <nav className="mt-10 flex flex-col gap-1" aria-label="App">
          {nav.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => setActive(item.id)}
              aria-current={active === item.id ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-[15px] ${
                active === item.id ? "bg-paper font-semibold" : "text-slate hover:text-ink"
              }`}
            >
              {item.label}
            </a>
          ))}
          <div className="my-2 border-t border-rule" />
          <Link href="/dashboard" className="rounded-lg px-3 py-2 text-[15px] text-slate hover:text-ink">
            Dashboard
          </Link>
          <Link href="/trades" className="rounded-lg px-3 py-2 text-[15px] text-slate hover:text-ink">
            Trade history
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

        <main className="mx-auto max-w-5xl space-y-8 px-6 py-10 lg:px-10">
          <div id="desk">
            <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">
              {session.handle ? `Hi, @${session.handle}` : "Your desk"}
            </h1>
            <p className="mt-2 text-slate">Copy a call, set your exits, and let Kallr watch it for you.</p>
          </div>

          <OrderComposer wallet={wallet} onPlaced={flashOrders.refresh} />

          <div className="grid gap-8 xl:grid-cols-[1.3fr_1fr]">
            <OpenOrders orders={flashOrders.orders} error={flashOrders.error} />

            <div id="wallet">
              {session.address ? (
                <WalletPanel address={session.address} embedded={session.embedded} />
              ) : (
                <section className="rounded-2xl border border-rule bg-card p-6 text-sm text-slate">
                  Setting up your wallet…
                </section>
              )}
            </div>
          </div>

          <Following />
        </main>
      </div>
    </div>
  );
}
