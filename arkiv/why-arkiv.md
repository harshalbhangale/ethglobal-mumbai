# Why Arkiv

A caller's record decides whether people put real money behind their next post. If it lived in our Postgres,
you'd be trusting us instead of the caller. If we swapped Arkiv out, users would lose:

- **Checking without asking us.** Anyone can query a caller's record from a public node. Our `/trades` page does it
  from the browser with no Kall server in between. Try the query in [schema.md](schema.md).
- **Records nobody can quietly edit.** Results are read-only. A miss stays a miss, and we can't fix it from a
  database console either. (We deleted one wrong record in public: see the end of the README.)
- **Owning their trades.** Each trade is handed to the wallet that placed it. In Postgres it would be a row that
  disappears with us.
- **Other apps reading it.** A wallet, a Telegram bot or a rival dashboard can show the same records without an API
  key from us.
- **Expiry for free.** An open call drops off at its deadline, with no cron job.

**What we kept off Arkiv, and why:** order books, quotes and balances (they live on Definitive Flash and Base),
the post's text (it's on Swarm; Arkiv holds only the reference), and the caller-follow lists (they stay on each
user's device).
