/**
 * Splits [from, to] into block windows of at most `span` blocks, newest first. Public RPCs cap one
 * eth_getLogs call (publicnode: 50,000 blocks), so a search over a contract's whole life goes in pieces.
 */
export function logWindows(from: bigint, to: bigint, span: bigint, max = 40): Array<{ fromBlock: bigint; toBlock: bigint }> {
  if (span <= 0n || to < from) return [];
  const out: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let hi = to; hi >= from && out.length < max; hi -= span) {
    const lo = hi - span + 1n > from ? hi - span + 1n : from;
    out.push({ fromBlock: lo, toBlock: hi });
    if (lo === from) break;
  }
  return out;
}
