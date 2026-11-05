/**
 * Runs in X's page (main world), where MetaMask / Rabby inject window.ethereum. Relays a fixed set
 * of EIP-1193 calls from the AfterMarkets content script. Every transaction and signature still
 * needs the user's confirmation in their own wallet; this adds no capability the page lacks.
 * Includes eth_signTypedData_v4 for Flash's EIP-712 order payloads.
 */
type Ethereum = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export const ALLOWED = new Set([
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "eth_sendTransaction",
  "eth_getTransactionReceipt",
  "eth_signTypedData_v4",
]);

export async function handleWalletMessage(event: MessageEvent) {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as { type?: string; id?: string; method?: string; params?: unknown[] };
  if (data?.type !== "aftermarkets-wallet-request" || typeof data.id !== "string") return;
  const ethereum = (window as unknown as { ethereum?: Ethereum }).ethereum;
  const respond = (body: Record<string, unknown>) =>
    window.postMessage({ type: "aftermarkets-wallet-response", id: data.id, ...body }, location.origin);
  if (data.method === "aftermarkets_ping") return respond({ result: Boolean(ethereum) });
  if (!ethereum) return respond({ error: { code: 4900, message: "No browser wallet found." } });
  if (!data.method || !ALLOWED.has(data.method)) return respond({ error: { code: 4200, message: "Method not allowed." } });
  try {
    const result = await ethereum.request({ method: data.method, params: Array.isArray(data.params) ? data.params : [] });
    respond({ result: JSON.parse(JSON.stringify(result ?? null)) });
  } catch (error) {
    const e = error as { code?: number; message?: string };
    respond({ error: { code: e.code ?? -1, message: e.message ?? "Wallet error" } });
  }
}

window.addEventListener("message", (event) => void handleWalletMessage(event));
