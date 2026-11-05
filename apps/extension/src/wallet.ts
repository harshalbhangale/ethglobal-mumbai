/**
 * Content-script side of the wallet bridge: asks the user's browser wallet (MetaMask, Rabby) to do
 * one thing at a time. Nothing here holds a key; each request is a prompt the user can reject.
 */

export class WalletError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

export const BASE_CHAIN_ID = "0x2105"; // 8453
const BASE_PARAMS = {
  chainId: BASE_CHAIN_ID,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

/** One wallet call through the bridge. Wallet prompts can take a while; reads time out sooner. */
export function walletRequest<T = unknown>(method: string, params: unknown[] = [], timeoutMs = 300_000): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as { type?: string; id?: string; result?: unknown; error?: { code: number; message: string } };
      if (data?.type !== "aftermarkets-wallet-response" || data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.error) reject(new WalletError(data.error.code, data.error.message));
      else resolve(data.result as T);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new WalletError(-1, "The wallet didn't answer."));
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "aftermarkets-wallet-request", id, method, params }, location.origin);
  });
}

let present: Promise<boolean> | null = null;
/** True when MetaMask / Rabby (any injected EIP-1193 wallet) is on the page. */
export function hasBrowserWallet() {
  present ??= walletRequest<boolean>("aftermarkets_ping", [], 1500).catch(() => false);
  return present;
}

export async function connect(): Promise<`0x${string}`> {
  const accounts = await walletRequest<string[]>("eth_requestAccounts");
  const from = accounts?.[0];
  if (!from || !/^0x[0-9a-fA-F]{40}$/.test(from)) throw new WalletError(4100, "No account connected.");
  return from as `0x${string}`;
}

/** Puts the wallet on Base mainnet, adding the network if the wallet doesn't know it. */
export async function ensureBase() {
  const chainId = await walletRequest<string>("eth_chainId", [], 10_000);
  if (chainId?.toLowerCase() === BASE_CHAIN_ID) return;
  try {
    await walletRequest("wallet_switchEthereumChain", [{ chainId: BASE_CHAIN_ID }]);
  } catch (error) {
    if ((error as WalletError).code !== 4902) throw error;
    await walletRequest("wallet_addEthereumChain", [BASE_PARAMS]);
  }
}

/** Sends a transaction and waits for it to land, polling the wallet's own RPC. */
export async function sendAndWait(from: string, tx: { to: string; data: string }, pollMs = 2000, maxMs = 180_000) {
  const hash = await walletRequest<string>("eth_sendTransaction", [{ from, to: tx.to, data: tx.data, value: "0x0" }]);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const receipt = await walletRequest<{ status?: string } | null>("eth_getTransactionReceipt", [hash], 15_000).catch(() => null);
    if (receipt) {
      if (receipt.status !== "0x1") throw new WalletError(-1, "The approval transaction failed on Base.");
      return hash;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new WalletError(-1, "The approval is taking long to confirm. Check your wallet, then try again.");
}

export const signTypedData = (from: string, typedDataJson: string) =>
  walletRequest<`0x${string}`>("eth_signTypedData_v4", [from, typedDataJson]);

export const rejected = (error: unknown) => /reject|denied|cancel/i.test(String((error as Error)?.message)) || (error as WalletError)?.code === 4001;
