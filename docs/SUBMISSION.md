# Kall Markets

**Don’t trust. Check the caller. Trade it.**

## The problem

Crypto runs on calls. Someone posts “$ETH, bounce, be more bullish” to 300,000 followers, and money moves.
If the call works, it becomes a screenshot and an ad for a paid group. If it fails, the post quietly disappears.
Followers only ever see the wins. And in the comments, a “contract address” for the coin is waiting: one wrong
paste and the money is gone.

## How we got here

We had already built an extension that let you trade straight from a post on X. It worked. Then we watched
people use it, and the trade turned out to be the easy part. The question everyone asked first was: is this
person ever right? Nobody could answer it, because nobody keeps score, and the record lives on the caller's own
timeline, where they control what survives.

So we flipped it. Before you can trade a call, you see its receipt. Every call gets priced the minute it is
posted, scored when its time is up, and written somewhere the caller can’t edit or delete.

## What it is

Kall Markets is one product in three places, wherever calls actually show up:

- **Kall Extension** (Chrome, on X): a card under every call with the caller’s record, and a trade you sign
  without leaving the post.
- **Kall Keyboard** (iPhone and Android): copy a call in Telegram, X or WhatsApp, and the keyboard reads it,
  checks the caller and trades it in the chat.
- **Kall Web App**: the real posts from callers you follow, their verdicts, your orders and every proof.

## How it works

- **Read the call.** An AI reader decides if a post is a real call and which way it points; sarcasm, questions
  and commentary don’t count.
- **Price it.** The entry is the Chainlink price on Base at the minute the post went up.
- **Score it.** When the call’s timeframe ends, it is settled as a hit or a miss with its real return.
- **Keep the receipt.** Calls, results and trades are written to Arkiv as read-only entities, and each post is
  snapshotted to Swarm, so a deleted tweet still has a record.
- **Catch fakes.** A post that names a coin next to a contract that isn’t that coin gets a red “Call check
  failed”, and no trade is offered.
- **Trade it.** One tap builds a Definitive Flash order on Base: quote, price impact and fee up front, signed in
  your own wallet (MetaMask or a Privy wallet from signing in with X).
- **Prove the price.** Every Flash quote is set beside Uniswap’s for the same swap, so you see the best price
  before you sign.
- **Get a receipt.** After the fill you get the Basescan transaction and the route Definitive took.

## Built with

Definitive Flash (every order) · Arkiv (calls, results, trades) · Uniswap Trading API (price benchmark) ·
Chainlink price feeds on Base · Swarm (post snapshots) · Privy (sign in with X, embedded wallet).

Live: [kall-markets.vercel.app](https://kall-markets.vercel.app)
