/** Pure verdict logic shared by the workflows and their tests. No SDK imports. */

export const VERDICT = { unknown: 0, real: 1, mismatch: 2, impostor: 3, noToken: 4 } as const;
export const VERDICT_LABEL = ["unknown", "real", "fake: wrong symbol", "fake: impostor", "fake: no token"] as const;

/**
 * - no symbol: the address isn't a token at all
 * - symbol differs from the ticker the post names: wrong coin
 * - same symbol, but the real (most liquid) coin with that ticker lives elsewhere: impostor
 */
export function decide(token: string, claimed: string, symbol: string, canonical: string): number {
  if (!symbol) return VERDICT.noToken;
  if (symbol.toUpperCase() !== claimed.toUpperCase()) return VERDICT.mismatch;
  if (!canonical) return VERDICT.unknown;
  return canonical.toLowerCase() === token.toLowerCase() ? VERDICT.real : VERDICT.impostor;
}

export const STATUS = { open: 0, hit: 1, miss: 2, flat: 3 } as const;

/** Return in basis points for a call, and its status. Prices are integers with the same decimals. */
export function score(up: boolean, entry: bigint, exit: bigint): { returnBps: number; status: number } {
  if (entry <= 0n) return { returnBps: 0, status: STATUS.open };
  const move = up ? exit - entry : entry - exit;
  const returnBps = Number((move * 10_000n) / entry);
  return { returnBps, status: returnBps > 0 ? STATUS.hit : returnBps < 0 ? STATUS.miss : STATUS.flat };
}
