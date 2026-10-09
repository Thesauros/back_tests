/**
 * Integer-percent allocation for flat rates (no impact model), with the
 * entry/exit asymmetry.
 *
 * Each provider is two segments: what it holds, up to the cap, valued at spot,
 * and the rest of its cap valued at the signal. Segments are filled by rate,
 * highest first (ties: held segment first, then lower provider index), to 100%.
 * A held position whose spot spikes is kept; a candidate whose spot spikes is
 * not entered until its EWMA follows; a held position whose spot collapses is
 * left at once.
 *
 * With signal == spot and nothing held this is exactly solveLinearAllocation,
 * which it replaces. Like that solver, a zero-rate segment is still filled when
 * every positive one is full, and a remainder left by caps that cannot reach
 * 100% parks on the best segment's provider.
 */
export function solveSegmentGreedy(
  providers: readonly { spot: bigint; signal: bigint; heldPercent: number }[],
  maxAllocationPercent: number
): number[] {
  const cap = Math.max(1, Math.min(100, Math.floor(maxAllocationPercent)));
  const segments = providers.flatMap(({ spot, signal, heldPercent }, index) => {
    const held = Math.min(cap, Math.max(0, Math.floor(heldPercent)));
    return [
      { index, held: true, rate: spot, size: held },
      { index, held: false, rate: signal < spot ? signal : spot, size: cap - held },
    ];
  });
  segments.sort((a, b) => {
    if (a.rate !== b.rate) return b.rate > a.rate ? 1 : -1;
    if (a.held !== b.held) return a.held ? -1 : 1;
    return a.index - b.index;
  });

  const distribution = providers.map(() => 0);
  let remaining = 100;
  for (const { index, size } of segments) {
    if (remaining <= 0) break;
    const share = Math.min(size, remaining);
    distribution[index] += share;
    remaining -= share;
  }
  if (remaining > 0) {
    // An empty held segment (nothing held) is no reason to park new money there.
    distribution[segments.find(({ size }) => size > 0).index] += remaining;
  }
  return distribution;
}
