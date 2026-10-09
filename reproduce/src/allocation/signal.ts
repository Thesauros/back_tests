/**
 * The rate new money is judged by: min(spot, EWMA). A spike earns new money
 * only once it has held long enough to lift its average; a drop counts at once.
 */

export interface SignalWindow {
  /** How far back the EWMA looks, seconds. */
  readonly windowSeconds: number;
  /** Spacing of the on-chain samples, seconds. */
  readonly stepSeconds: number;
}

const HOUR = 3600;

/** Inside one network, and the public-vault path. */
export const INTRA_CHAIN_SIGNAL_WINDOW: SignalWindow = { windowSeconds: 12 * HOUR, stepSeconds: HOUR };

/** Between networks: a move is slow and costly, so the spread has to hold for days. */
export const CROSS_CHAIN_SIGNAL_WINDOW: SignalWindow = { windowSeconds: 7 * 24 * HOUR, stepSeconds: 12 * HOUR };

export interface RateSample {
  /** Seconds before the decision time. */
  readonly ageSeconds: number;
  /** getDepositRate, ray (1e27 = 100% APR). */
  readonly rate: bigint;
}

/** Past samples of one provider, or 'unavailable' when any of them could not be read. */
export type RateHistory = readonly RateSample[] | 'unavailable';

/** Integer weights: a flat history then averages to exactly its rate. */
const WEIGHT_SCALE = 1e18;

/** Mean weighted by 2^(-age / halfLife). */
export function ewma(samples: readonly RateSample[], halfLifeSeconds: number): bigint {
  let weighted = 0n;
  let weights = 0n;
  for (const { ageSeconds, rate } of samples) {
    const weight = BigInt(Math.round(WEIGHT_SCALE * 2 ** (-ageSeconds / halfLifeSeconds)));
    weighted += weight * rate;
    weights += weight;
  }
  return weights === 0n ? 0n : weighted / weights;
}

/**
 * min(spot, EWMA of the spot sample and the history). Call sites pass half the
 * window as the half-life: shorter ones made more cross-chain transfers in the
 * PR-4 replay.
 *
 * Fail-safe: no history, or a history of zeros (a market that sat at 0% and
 * jumps, SEC-07), gives 0. The provider can keep what it holds — held money is
 * valued at spot — but receives no new money.
 */
export function rateSignal(spot: bigint, history: RateHistory, halfLifeSeconds: number): bigint {
  if (history === 'unavailable' || history.every(({ rate }) => rate === 0n)) return 0n;
  const average = ewma([{ ageSeconds: 0, rate: spot }, ...history], halfLifeSeconds);
  return average < spot ? average : spot;
}
