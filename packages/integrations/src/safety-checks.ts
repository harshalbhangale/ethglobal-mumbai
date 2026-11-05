import { z } from "zod";

/**
 * Lightweight safety checks from free public sources:
 *  - token: GoPlus Security (honeypot, mint, taxes, owner powers) + Dexscreener (liquidity, age)
 *  - caller: Etherscan API V2 on Base (did the caller's wallet sell what they called?)
 *
 * These are observations, never verdicts. A missing or failed check is reported as
 * unavailable, never as clean.
 */

export const BASE_CHAIN_ID = 8453;

type Fetcher = typeof fetch;
const TIMEOUT = 10_000;

export type Severity = "danger" | "warning" | "info";
export type Flag = { kind: string; severity: Severity; text: string };

// ---------- Token ----------

const flagBit = z.enum(["0", "1"]).optional();
const goplusTokenSchema = z
  .object({
    token_name: z.string().optional(),
    token_symbol: z.string().optional(),
    is_honeypot: flagBit,
    is_mintable: flagBit,
    hidden_owner: flagBit,
    can_take_back_ownership: flagBit,
    owner_change_balance: flagBit,
    cannot_sell_all: flagBit,
    transfer_pausable: flagBit,
    is_blacklisted: flagBit,
    slippage_modifiable: flagBit,
    is_open_source: flagBit,
    buy_tax: z.string().optional(),
    sell_tax: z.string().optional(),
    holder_count: z.string().optional(),
  })
  .passthrough();
type GoPlusToken = z.infer<typeof goplusTokenSchema>;

const dexPairSchema = z
  .object({
    chainId: z.string(),
    dexId: z.string().optional(),
    url: z.string().optional(),
    liquidity: z.object({ usd: z.number().optional() }).optional(),
    volume: z.object({ h24: z.number().optional() }).optional(),
    pairCreatedAt: z.number().optional(),
    baseToken: z.object({ name: z.string().optional(), symbol: z.string().optional() }).optional(),
  })
  .passthrough();

export type TokenCheck = {
  address: string;
  name: string | null;
  symbol: string | null;
  flags: Flag[];
  holders: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  ageDays: number | null;
  pairUrl: string | null;
  sources: { goplus: "ok" | "unavailable"; dexscreener: "ok" | "unavailable" };
};

const pctTax = (v: string | undefined) => (v && v !== "" ? Number(v) : null);

/** Pure: turn GoPlus fields into human flags. */
export function goplusFlags(t: GoPlusToken): Flag[] {
  const flags: Flag[] = [];
  const on = (v: string | undefined) => v === "1";
  if (on(t.is_honeypot)) flags.push({ kind: "honeypot", severity: "danger", text: "Honeypot: you may not be able to sell" });
  if (on(t.cannot_sell_all)) flags.push({ kind: "cannot-sell-all", severity: "danger", text: "Holders can't sell their whole balance" });
  if (on(t.owner_change_balance)) flags.push({ kind: "owner-balance", severity: "danger", text: "Owner can change balances" });
  if (on(t.hidden_owner)) flags.push({ kind: "hidden-owner", severity: "danger", text: "Hidden owner" });
  if (on(t.can_take_back_ownership)) flags.push({ kind: "reclaim-ownership", severity: "warning", text: "Owner can reclaim ownership" });
  if (on(t.transfer_pausable)) flags.push({ kind: "pausable", severity: "warning", text: "Transfers can be paused" });
  if (on(t.is_blacklisted)) flags.push({ kind: "blacklist", severity: "warning", text: "Has a blacklist" });
  if (on(t.slippage_modifiable)) flags.push({ kind: "tax-modifiable", severity: "warning", text: "Owner can change taxes" });
  if (on(t.is_mintable)) flags.push({ kind: "mintable", severity: "info", text: "Supply can be minted" });
  if (t.is_open_source === "0") flags.push({ kind: "closed-source", severity: "warning", text: "Contract source not verified" });
  const buy = pctTax(t.buy_tax);
  const sell = pctTax(t.sell_tax);
  const worst = Math.max(buy ?? 0, sell ?? 0);
  if (worst >= 0.1) flags.push({ kind: "tax", severity: worst >= 0.3 ? "danger" : "warning", text: `${Math.round(worst * 100)}% trading tax` });
  return flags;
}

/** Pure: liquidity and age flags from the deepest Dexscreener pair. */
export function marketFlags(liquidityUsd: number | null, ageDays: number | null): Flag[] {
  const flags: Flag[] = [];
  if (liquidityUsd !== null && liquidityUsd < 10_000)
    flags.push({ kind: "thin-liquidity", severity: liquidityUsd < 1_000 ? "danger" : "warning", text: `Only $${Math.round(liquidityUsd).toLocaleString("en-US")} liquidity` });
  if (ageDays !== null && ageDays < 3)
    flags.push({ kind: "new-token", severity: "warning", text: ageDays < 1 ? "Token is less than a day old" : `Token is ${Math.floor(ageDays)} days old` });
  return flags;
}

export async function checkToken(address: string, options: { fetcher?: Fetcher; now?: number } = {}): Promise<TokenCheck> {
  const fetcher = options.fetcher ?? fetch;
  const addr = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new Error("Invalid token address");

  const [goplus, dex] = await Promise.all([
    fetcher(`https://api.gopluslabs.io/api/v1/token_security/${BASE_CHAIN_ID}?contract_addresses=${addr}`, { signal: AbortSignal.timeout(TIMEOUT) })
      .then(async (r) => {
        if (!r.ok) return null;
        const body = z.object({ result: z.record(z.string(), goplusTokenSchema).optional() }).parse(await r.json());
        return body.result?.[addr] ?? null;
      })
      .catch(() => null),
    fetcher(`https://api.dexscreener.com/tokens/v1/base/${addr}`, { signal: AbortSignal.timeout(TIMEOUT) })
      .then(async (r) => (r.ok ? z.array(dexPairSchema).parse(await r.json()) : null))
      .catch(() => null),
  ]);

  const pairs = (dex ?? []).filter((p) => p.chainId === "base");
  const deepest = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
  const liquidityUsd = dex === null ? null : pairs.reduce((sum, p) => sum + (p.liquidity?.usd ?? 0), 0);
  const created = pairs.map((p) => p.pairCreatedAt).filter((t): t is number => typeof t === "number");
  const now = options.now ?? Date.now();
  const ageDays = created.length ? (now - Math.min(...created)) / 86_400_000 : null;

  const flags = [...(goplus ? goplusFlags(goplus) : []), ...marketFlags(liquidityUsd, ageDays)];
  if (dex !== null && pairs.length === 0) flags.push({ kind: "no-market", severity: "danger", text: "No trading pair on Base" });
  return {
    address: addr,
    name: goplus?.token_name ?? deepest?.baseToken?.name ?? null,
    symbol: goplus?.token_symbol ?? null,
    flags,
    holders: goplus?.holder_count ? Number(goplus.holder_count) : null,
    liquidityUsd,
    volume24hUsd: dex === null ? null : pairs.reduce((sum, p) => sum + (p.volume?.h24 ?? 0), 0),
    ageDays,
    pairUrl: deepest?.url ?? null,
    sources: { goplus: goplus ? "ok" : "unavailable", dexscreener: dex === null ? "unavailable" : "ok" },
  };
}

// ---------- Caller wallet ----------

const transferSchema = z.object({
  timeStamp: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  tokenDecimal: z.string(),
  tokenSymbol: z.string(),
  hash: z.string(),
});
export type Transfer = z.infer<typeof transferSchema>;

export type WalletFinding = {
  kind: "bought-before" | "sold-after" | "bought-after" | "sold-before";
  /** Whether the trade went with or against the direction the caller posted. */
  stance: "with" | "against";
  amount: number;
  symbol: string;
  minutesFromPost: number;
  hash: string;
};

export type CallerCheck =
  | { status: "ok"; wallet: string; findings: WalletFinding[]; flags: Flag[] }
  | { status: "unavailable"; reason: string };

/** Pure: classify the caller's transfers of `token` in a window around the post. */
export function walletFindings(
  wallet: string,
  transfers: Transfer[],
  postedAt: number,
  direction: "up" | "down",
  windowHours = { before: 24, after: 72 },
): { findings: WalletFinding[]; flags: Flag[] } {
  const me = wallet.toLowerCase();
  const findings: WalletFinding[] = [];
  for (const t of transfers) {
    const at = Number(t.timeStamp);
    const minutes = Math.round((at - postedAt) / 60);
    if (minutes < -windowHours.before * 60 || minutes > windowHours.after * 60) continue;
    const incoming = t.to.toLowerCase() === me;
    const outgoing = t.from.toLowerCase() === me;
    if (incoming === outgoing) continue;
    const before = minutes < 0;
    const kind = incoming ? (before ? "bought-before" : "bought-after") : before ? "sold-before" : "sold-after";
    const stance = (incoming ? "up" : "down") === direction ? "with" : "against";
    const amount = Number(t.value) / 10 ** Number(t.tokenDecimal);
    findings.push({ kind, stance, amount, symbol: t.tokenSymbol, minutesFromPost: minutes, hash: t.hash });
  }
  const flags: Flag[] = [];
  const boughtBefore = findings.some((f) => f.kind === "bought-before" && f.stance === "with");
  const exitedAfter = findings.find((f) => f.kind === "sold-after" && f.stance === "against");
  if (boughtBefore && exitedAfter)
    flags.push({ kind: "front-run", severity: "danger", text: `Bought before posting, sold ${exitedAfter.minutesFromPost} min after` });
  else if (exitedAfter)
    flags.push({ kind: "sold-after-call", severity: "warning", text: `Sold ${exitedAfter.symbol} ${exitedAfter.minutesFromPost} min after calling it` });
  else if (findings.some((f) => f.stance === "with"))
    flags.push({ kind: "skin-in-game", severity: "info", text: "Traded in the direction of the call" });
  return { findings, flags };
}

export async function checkCallerWallet(
  input: { wallet: string; token: string; postedAt: number; direction: "up" | "down" },
  options: { apiKey?: string; fetcher?: Fetcher } = {},
): Promise<CallerCheck> {
  if (!options.apiKey) return { status: "unavailable", reason: "Wallet check needs ETHERSCAN_API_KEY" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.wallet)) return { status: "unavailable", reason: "No valid wallet linked" };
  const q = new URLSearchParams({
    chainid: String(BASE_CHAIN_ID),
    module: "account",
    action: "tokentx",
    address: input.wallet,
    contractaddress: input.token,
    startblock: "0",
    endblock: "99999999",
    sort: "asc",
    apikey: options.apiKey,
  });
  try {
    const res = await (options.fetcher ?? fetch)(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return { status: "unavailable", reason: `Etherscan ${res.status}` };
    const body = z.object({ status: z.string(), message: z.string(), result: z.unknown() }).parse(await res.json());
    // "No transactions found" comes back as status 0 with an empty array.
    const list = Array.isArray(body.result) ? z.array(transferSchema).parse(body.result) : null;
    if (!list) return { status: "unavailable", reason: String(body.result ?? body.message).slice(0, 120) };
    return { status: "ok", wallet: input.wallet.toLowerCase(), ...walletFindings(input.wallet, list, input.postedAt, input.direction) };
  } catch {
    return { status: "unavailable", reason: "Etherscan request failed" };
  }
}
