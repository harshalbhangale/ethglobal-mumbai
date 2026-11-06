import { type Address, encodeFunctionData, erc20Abi, formatUnits, getAddress, type Hex, isAddress, parseUnits, toHex, zeroAddress } from "viem";
import { USDC_BASE } from "./chain";

/** Money in and out of the wallet on Base: what it holds, deposit links and withdrawal checks. Pure, so tested. */

/** One coin in the wallet. `address` is null for ETH itself (Base's gas coin). */
export type Holding = {
  symbol: string;
  name: string | null;
  address: Address | null;
  decimals: number;
  /** Decimal string, as held. */
  balance: string;
  priceUsd: number | null;
  valueUsd: number | null;
  icon: string | null;
};

export type WalletView = { address: Address; totalUsd: number; holdings: Holding[] };

/** ETH kept back when withdrawing ETH, so the wallet can still pay for gas. About $0.07 on Base. */
export const GAS_RESERVE_ETH = "0.00003";
/** Below this much ETH, a token withdrawal can't pay its own gas. */
const MIN_GAS_ETH = "0.000002";

/**
 * An EIP-681 payment request: Rainbow, MetaMask, Coinbase Wallet and others open it as a prefilled send
 * to this wallet on Base (chain 8453). USDC requests a token transfer; ETH a plain send.
 */
export function paymentUri(coin: "USDC" | "ETH", to: Address): string {
  return coin === "USDC" ? `ethereum:${USDC_BASE}@8453/transfer?address=${to}` : `ethereum:${to}@8453`;
}

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** An amount for people: 3.1289, 1,226.5, or 0.00000325 (small ones keep their significant digits). */
export function formatCoin(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "0";
  return n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

/** Truncates a decimal string to `dp` places (never rounds up), without trailing zeros. */
function truncate(s: string, dp: number) {
  const [whole, frac = ""] = s.split(".");
  const kept = frac.slice(0, dp).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole!;
}

/** The most you can send: all of a token, or your ETH less the gas reserve. */
export function maxWithdraw(asset: Holding): string {
  if (asset.address !== null) return asset.balance;
  const left = parseUnits(asset.balance, 18) - parseUnits(GAS_RESERVE_ETH, 18);
  return left <= 0n ? "0" : truncate(formatUnits(left, 18), 8);
}

export type WithdrawPlan =
  | { ok: true; asset: Holding; amount: string; to: Address; tx: { to: Address; data?: Hex; value?: Hex } }
  | { ok: false; error: string | null };

/**
 * Checks a withdrawal and builds its transaction. `ethBalance` is the wallet's ETH, for gas.
 * `error: null` means nothing has been entered yet.
 */
export function planWithdraw(input: { asset: Holding; amount: string; to: string; from: string; ethBalance: string }): WithdrawPlan {
  const { asset, from } = input;
  const amount = input.amount.trim();
  const to = input.to.trim();
  if (!amount && !to) return { ok: false, error: null };
  if (!amount) return { ok: false, error: "Enter an amount." };
  if (!DECIMAL.test(amount)) return { ok: false, error: "Enter a number, like 10 or 0.5." };
  const [, frac = ""] = amount.split(".");
  if (frac.length > asset.decimals) return { ok: false, error: `${asset.symbol} has at most ${asset.decimals} decimals.` };
  const value = parseUnits(amount, asset.decimals);
  if (value <= 0n) return { ok: false, error: "Enter an amount above zero." };
  if (value > parseUnits(maxWithdraw(asset), asset.decimals))
    return {
      ok: false,
      error: asset.address === null ? `That's more than you have, keeping ${GAS_RESERVE_ETH} ETH for gas.` : `That's more ${asset.symbol} than you have.`,
    };
  if (asset.address !== null && parseUnits(input.ethBalance, 18) < parseUnits(MIN_GAS_ETH, 18))
    return { ok: false, error: `Add a little ETH on Base first: sending ${asset.symbol} needs gas.` };
  if (!to) return { ok: false, error: "Enter the address to send to." };
  if (!isAddress(to, { strict: false })) return { ok: false, error: "That isn't a valid address." };
  const recipient = getAddress(to);
  if (recipient === zeroAddress) return { ok: false, error: "That address burns funds. Use a real wallet." };
  if (recipient.toLowerCase() === from.toLowerCase()) return { ok: false, error: "That's this wallet. Send to another address." };
  if (asset.address !== null && recipient.toLowerCase() === asset.address.toLowerCase())
    return { ok: false, error: `That's the ${asset.symbol} contract, not a wallet.` };

  const tx =
    asset.address === null
      ? { to: recipient, value: toHex(value) }
      : { to: asset.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, value] }) };
  return { ok: true, asset, amount, to: recipient, tx };
}
