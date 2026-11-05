import { watchlistCommandSchema } from "@kallr/domain";
import { appOrigin } from "./config";
import { send } from "./dom";

/**
 * App-only bridge: lets the Kallr web app read and change who this browser follows, kept by
 * the extension. Runs only on the app's own origin, answers only same-window messages from that
 * origin with a fresh nonce, and carries follow commands only. No Privy tokens, X cookies or keys.
 */

export const REQUEST = "kallr-follows-request";
export const RESPONSE = "kallr-follows-response";
const NONCE = /^[a-zA-Z0-9-]{16,100}$/;

export function handleBridgeMessage(event: MessageEvent) {
  if (event.source !== window || event.origin !== appOrigin || location.origin !== appOrigin) return;
  const message = event.data;
  if (!message || typeof message !== "object" || message.type !== REQUEST) return;
  if (typeof message.nonce !== "string" || !NONCE.test(message.nonce)) return;
  const reply = (value: unknown) => window.postMessage({ type: RESPONSE, nonce: message.nonce, value }, appOrigin);
  // "Follow here when I follow on X" setting.
  if (message.action === "mirror-read") return void send<unknown>({ type: "mirror" }).then(reply);
  if (message.action === "mirror-set") {
    if (typeof message.enabled !== "boolean") return;
    return void send<unknown>({ type: "mirror", enabled: message.enabled }).then(reply);
  }
  const command = watchlistCommandSchema.safeParse(
    message.action === "read" ? { action: "read" } : { action: message.action, handle: message.handle },
  );
  if (!command.success) return;
  void send<unknown>({ type: "watchlist", command: command.data }).then(reply);
}

window.addEventListener("message", handleBridgeMessage);
// Lets the page know the extension is installed before it asks.
document.documentElement.dataset.kallrExtension = "1";
