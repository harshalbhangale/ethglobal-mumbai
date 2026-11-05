import { watchlistCommandSchema } from "@aftermarkets/domain";
import { appOrigin } from "./config";
import { send } from "./dom";

/**
 * App-only bridge: lets the AfterMarkets web app read and change who this browser follows, kept by
 * the extension. Runs only on the app's own origin, answers only same-window messages from that
 * origin with a fresh nonce, and carries follow commands only. No Privy tokens, X cookies or keys.
 */

export const REQUEST = "aftermarkets-follows-request";
export const RESPONSE = "aftermarkets-follows-response";
const NONCE = /^[a-zA-Z0-9-]{16,100}$/;

export function handleBridgeMessage(event: MessageEvent) {
  if (event.source !== window || event.origin !== appOrigin || location.origin !== appOrigin) return;
  const message = event.data;
  if (!message || typeof message !== "object" || message.type !== REQUEST) return;
  if (typeof message.nonce !== "string" || !NONCE.test(message.nonce)) return;
  const command = watchlistCommandSchema.safeParse(
    message.action === "read" ? { action: "read" } : { action: message.action, handle: message.handle },
  );
  if (!command.success) return;
  void send<unknown>({ type: "watchlist", command: command.data }).then((value) =>
    window.postMessage({ type: RESPONSE, nonce: message.nonce, value }, appOrigin),
  );
}

window.addEventListener("message", handleBridgeMessage);
// Lets the page know the extension is installed before it asks.
document.documentElement.dataset.aftermarketsExtension = "1";
