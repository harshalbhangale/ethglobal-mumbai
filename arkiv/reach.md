# Reach

## Who is it for, and would they use it?

- **People who copy crypto calls.** On X and in Telegram groups, people buy what an account they follow posts. Today
  they can't see the caller's record, and copying means leaving the app. AfterMarkets shows the record where the call
  is (the extension on x.com, the keyboard in any Android app) and turns "copy $5 tp 10% sl 5%" into a Flash order on
  Base with take-profit and stop-loss.
- **Callers with a good record.** A record that is read-only and public is something they can point to.
- **Other apps.** Anything that wants caller records or trade history can read the same entities.

TODO(team): numbers, e.g. how many people used Xtrading before the event, waitlist or demo users, the accounts we tested with.

## Can they try it today?

- `/trades`: TODO(team): deployed URL. Locally: `npm run dev`, then http://localhost:3000/trades.
- Chrome extension: `npm run build -w @aftermarkets/extension`, then load `apps/extension/dist` unpacked.
- Android keyboard: the debug APK from `apps/keyboard` (see [AFTERMARKETS.md](../apps/keyboard/AFTERMARKETS.md)).
- Trades and calls on Arkiv: query the writer's entities (see [schema.md](schema.md)).

## Will we keep building after Mumbai?

TODO(team): your plan, e.g. Play Store keyboard, follows on Arkiv, Telegram.
