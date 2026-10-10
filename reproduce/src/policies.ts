import { Decimal } from 'decimal.js';
import {
  INTRA_CHAIN_SIGNAL_WINDOW,
  RateCurve,
  RateHistory,
  allocationGain,
  rateSignal,
  solveSegmentGreedy,
  solveWaterFilling,
} from '@backend-ts/library';

/**
 * The allocation decisions the replay compares, without I/O. One call is one cron run of one vault.
 *
 * NEW is a port of the live public-vault path on origin/master: RebalanceService.calculateRun with
 * planAllocation (#53/#55/#60: enter on min(spot, 12 h EWMA), keep or exit on spot, gain-based
 * threshold, re-cap after the anomalous exclusion). It calls the library functions planAllocation
 * calls (rateSignal, solveSegmentGreedy, allocationGain) and repeats the RiskGuardService steps
 * and buildMoveInstructions in its own code; the rebalancer does not call it. A rate recorded
 * exactly smaWindowSeconds before the run is inside the anomaly window, as it is there
 * (RateHistoryService.getHistory reads ZRANGEBYSCORE, inclusive).
 * OLD is that path as origin/master had it before those changes (GreedyLinear on spot rates, no
 * longer in apps/rebalancer/src), ported rule by rule from REBALANCE_ALGORITHM.md Part I; each
 * step carries its S-number. WATERFILL is the cross-chain allocator's rule inside one network
 * (#68), applied to the public vault's providers.
 */

/** Live parameters, REBALANCE_ALGORITHM.md section 3 (the code defaults). */
export interface PathConfig {
  /** MAX_PROVIDER_ALLOCATION_PERCENT */
  readonly capPercent: number;
  /** MIN_ACTIVE_PROVIDERS */
  readonly minActive: number;
  /** RATE_MAX_DEVIATION_PERCENT */
  readonly maxDeviationPercent: number;
  /** RATE_MIN_SAMPLES */
  readonly minSamples: number;
  /** RATE_HISTORY_WINDOW_HOURS, in seconds */
  readonly smaWindowSeconds: number;
  /** REBALANCE_COOLDOWN_MINUTES, in seconds */
  readonly cooldownSeconds: number;
  /** APR_IMPROVEMENT_THRESHOLD, bps of the vault a year */
  readonly thresholdBps: number;
  /** MIN_TARGET_AMOUNT, asset units */
  readonly minTarget: bigint;
}

export const LIVE: PathConfig = {
  capPercent: 60,
  minActive: 2,
  maxDeviationPercent: 100,
  minSamples: 3,
  smaWindowSeconds: 24 * 3600,
  cooldownSeconds: 30 * 60,
  thresholdBps: 25,
  minTarget: 100_000n,
};

export interface Leg {
  readonly from: number;
  readonly to: number;
  readonly amount: bigint;
}

export interface RunInput {
  /** Run time, unix seconds. */
  readonly t: number;
  /** getDepositRate(vault) per provider, ray: the rate at what we hold. */
  readonly spots: readonly bigint[];
  /** What the vault holds in each provider, asset units. */
  readonly balances: readonly bigint[];
  /** Rates recorded by earlier runs (the Redis ZSET of S3), any order. */
  readonly recorded: readonly { readonly t: number; readonly rates: readonly bigint[] }[];
  /** Run time of the last executed rebalance, null when none. */
  readonly lastMoveAt: number | null;
}

export interface Decision {
  /** Why nothing moves; null when `legs` are executed. */
  readonly stop: string | null;
  readonly anomalous: readonly boolean[];
  readonly distribution?: readonly number[];
  /** The figure S9 compares against the threshold, percentage points of the vault a year. */
  readonly deltaPercent?: number;
  readonly signals?: readonly bigint[];
  readonly legs: readonly Leg[];
}

const RAY_DECIMAL = new Decimal(10).pow(27);

/**
 * S3 (RiskGuard.evaluatePreOptimization): SMA of the rates recorded in the last 24 h, n >= 3, and
 * |rate - avg| / avg > 100% flags the provider. avg == 0 gives deviation 0, so only spikes up are
 * caught (a drop reaches 100% at most and the test is strict).
 */
export function anomalyGate(input: RunInput, config: PathConfig): boolean[] {
  const window = input.recorded.filter(({ t }) => t < input.t && t >= input.t - config.smaWindowSeconds);
  return input.spots.map((rate, i) => {
    if (window.length < config.minSamples) return false;
    const average = window.reduce((sum, { rates }) => sum + rates[i], 0n) / BigInt(window.length);
    if (average === 0n) return false;
    const diff = rate > average ? rate - average : average - rate;
    return Number((diff * 10_000n) / average) / 100 > config.maxDeviationPercent;
  });
}

/**
 * S4 cooldown. The key is written after the receipt, seconds after the run that moved started, so
 * the run one cooldown later still finds it fresh: `<=`, not `<`. The circuit breaker is left out:
 * a replayed position changes only by its interest, far below 20% an hour.
 */
const coolingDown = (input: RunInput, config: PathConfig) =>
  input.lastMoveAt !== null && input.t - input.lastMoveAt <= config.cooldownSeconds;

/** S6 OptimizerService.solveLinearAllocation: by rate, highest first (ties: lower index), `cap` each. */
export function solveLinearAllocation(rates: readonly bigint[], capPercent: number): number[] {
  const cap = Math.max(1, Math.min(100, Math.floor(capPercent)));
  const order = rates
    .map((rate, index) => ({ rate, index }))
    .sort((a, b) => (b.rate > a.rate ? 1 : b.rate < a.rate ? -1 : 0));
  const distribution = rates.map(() => 0);
  let remaining = 100;
  for (const { index } of order) {
    if (remaining <= 0) break;
    const share = Math.min(cap, remaining);
    distribution[index] = share;
    remaining -= share;
  }
  if (remaining > 0) distribution[order[0].index] += remaining;
  return distribution;
}

/** RiskGuardService.applyMaxProviderAllocationCap, as is. */
function applyCap(distribution: readonly number[], maxPercent: number): number[] {
  const safeMax = Math.max(1, Math.min(100, Math.floor(maxPercent)));
  if (safeMax >= 100) return [...distribution];
  const capped = [...distribution];
  let excess = 0;
  for (let i = 0; i < capped.length; i++) {
    if (capped[i] > safeMax) {
      excess += capped[i] - safeMax;
      capped[i] = safeMax;
    }
  }
  while (excess > 0) {
    const candidates = capped
      .map((value, index) => ({ index, capacity: safeMax - value }))
      .filter((item) => item.capacity > 0);
    if (candidates.length === 0) break;
    let distributed = 0;
    for (const candidate of candidates) {
      if (excess <= 0) break;
      const add = Math.min(candidate.capacity, Math.max(1, Math.floor(excess / candidates.length)));
      capped[candidate.index] += add;
      excess -= add;
      distributed += add;
    }
    if (distributed === 0) break;
  }
  const sum = capped.reduce((acc, value) => acc + value, 0);
  if (sum !== 100) {
    const target = capped.findIndex((value) => value < safeMax);
    capped[target >= 0 ? target : 0] += 100 - sum;
  }
  return capped;
}

/** RiskGuardService.ensureMinActiveProviders, as is. */
function ensureMinActive(distribution: readonly number[], minActive: number): number[] {
  const normalizedMin = Math.max(1, Math.min(distribution.length, Math.floor(minActive)));
  if (distribution.filter((v) => v > 0).length >= normalizedMin) return [...distribution];
  const sorted = distribution
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .map((item) => item.index);
  const adjusted = [...distribution];
  let donor = 0;
  for (let i = 0; i < normalizedMin - distribution.filter((v) => v > 0).length; i++) {
    const target = sorted.find((idx) => adjusted[idx] === 0);
    if (target === undefined) break;
    while (donor < sorted.length && adjusted[sorted[donor]] <= 1) donor += 1;
    if (donor >= sorted.length) break;
    adjusted[sorted[donor]] -= 1;
    adjusted[target] += 1;
  }
  return adjusted;
}

/** S7 applyPostOptimization: cap, then the min-active rule. */
const postOptimization = (distribution: readonly number[], config: PathConfig) =>
  ensureMinActive(applyCap(distribution, config.capPercent), config.minActive);

/**
 * S8 excludeAnomalousProviders: the anomalous share is zeroed and handed to the others in
 * proportion (equal split when they all sit at 0), the last one taking the rounding. OLD stops
 * there (D5: one remaining provider can end at 100%); NEW (#53) re-applies cap and min-active
 * over the remaining providers and skips the run when they cannot hold the money within them.
 */
function excludeAnomalous(
  distribution: readonly number[],
  anomalous: readonly boolean[],
  config: PathConfig,
  reapply: boolean
): { distribution: number[]; withinLimits: boolean } {
  const adjusted = distribution.map((percent, i) => (anomalous[i] ? 0 : percent));
  const excess = distribution.reduce((sum, percent, i) => (anomalous[i] ? sum + percent : sum), 0);
  if (excess === 0) return { distribution: adjusted, withinLimits: true };
  const remaining = adjusted.map((_, i) => i).filter((i) => !anomalous[i]);
  if (remaining.length === 0) return { distribution: adjusted, withinLimits: false };
  const remainingTotal = remaining.reduce((sum, i) => sum + adjusted[i], 0);
  if (remainingTotal === 0) {
    const base = Math.floor(100 / remaining.length);
    let remainder = 100 - base * remaining.length;
    for (const i of remaining) {
      adjusted[i] = base + (remainder > 0 ? 1 : 0);
      remainder = remainder > 0 ? remainder - 1 : 0;
    }
  } else {
    let given = 0;
    remaining.forEach((index, k) => {
      if (k === remaining.length - 1) {
        adjusted[index] += excess - given;
        return;
      }
      const share = Math.floor((adjusted[index] / remainingTotal) * excess);
      adjusted[index] += share;
      given += share;
    });
  }
  if (!reapply) return { distribution: adjusted, withinLimits: true };
  const limited = postOptimization(
    remaining.map((i) => adjusted[i]),
    config
  );
  remaining.forEach((index, k) => (adjusted[index] = limited[k]));
  const withinLimits =
    adjusted.every((percent) => percent <= config.capPercent) &&
    adjusted.filter((percent) => percent > 0).length >= Math.min(config.minActive, adjusted.length);
  return { distribution: adjusted, withinLimits };
}

/**
 * S10 targets: floor(total * pct / 100) of the fresh balances, a zero target replaced by
 * MIN_TARGET_AMOUNT. S11 buildMoveInstructions: senders and receivers in index order, two pointers,
 * SAFETY_BUFFER = 10 x MIN_TARGET_AMOUNT kept at the sender, legs <= MIN_TARGET_AMOUNT skipped.
 */
export function buildMoveInstructions(
  balances: readonly bigint[],
  distribution: readonly number[],
  config: PathConfig
): Leg[] {
  const total = balances.reduce((sum, b) => sum + b, 0n);
  const targets = distribution.map((percent) => {
    const target = BigInt(new Decimal(total.toString()).mul(percent).div(100).floor().toFixed(0));
    return target === 0n ? config.minTarget : target;
  });
  const buffer = config.minTarget * 10n;
  const available = balances.map((b) => (b > buffer ? b - buffer : 0n));
  const senders: { index: number; excess: bigint }[] = [];
  const receivers: { index: number; deficit: bigint }[] = [];
  balances.forEach((current, i) => {
    if (current > targets[i]) {
      const raw = current - targets[i];
      senders.push({ index: i, excess: raw < available[i] ? raw : available[i] });
    } else if (current < targets[i]) {
      receivers.push({ index: i, deficit: targets[i] - current });
    }
  });
  const legs: Leg[] = [];
  let s = 0;
  let r = 0;
  while (s < senders.length && r < receivers.length) {
    const sender = senders[s];
    const receiver = receivers[r];
    const amount = sender.excess < receiver.deficit ? sender.excess : receiver.deficit;
    if (amount <= config.minTarget) {
      if (sender.excess <= config.minTarget) s++;
      else r++;
      continue;
    }
    if (amount > available[sender.index]) {
      s++;
      continue;
    }
    legs.push({ from: sender.index, to: receiver.index, amount });
    available[sender.index] -= amount;
    sender.excess -= amount;
    receiver.deficit -= amount;
    if (sender.excess === 0n) s++;
    if (receiver.deficit === 0n) r++;
  }
  return legs;
}

/** OLD, GreedyLinear as origin/master ran it before #53/#55/#60: S3-S11 on spot rates. */
export function decideOld(input: RunInput, config: PathConfig = LIVE): Decision {
  const anomalous = anomalyGate(input, config);
  if (anomalous.every(Boolean)) return { stop: 'all anomalous', anomalous, legs: [] };
  if (coolingDown(input, config)) return { stop: 'cooldown', anomalous, legs: [] };
  // S5: an anomalous provider ranks at 0.
  const allocatable = input.spots.map((rate, i) => (anomalous[i] ? 0n : rate));
  const distribution = excludeAnomalous(
    postOptimization(solveLinearAllocation(allocatable, config.capPercent), config),
    anomalous,
    config,
    false
  ).distribution;
  // S9: current APR on the balances (anomalous rates included) vs sum(rate x pct) of the target.
  const balances = input.balances.map((b) => new Decimal(b.toString()));
  const rates = input.spots.map((r) => new Decimal(r.toString()));
  const total = balances.reduce((sum, b) => sum.plus(b), new Decimal(0));
  const current = total.eq(0)
    ? new Decimal(0)
    : balances.reduce((sum, b, i) => sum.plus(b.mul(rates[i])), new Decimal(0)).div(total);
  const optimized = distribution.reduce((sum, percent, i) => sum.plus(rates[i].mul(percent).div(100)), new Decimal(0));
  const delta = optimized.div(RAY_DECIMAL).mul(100).minus(current.div(RAY_DECIMAL).mul(100));
  const deltaPercent = delta.toNumber();
  if (delta.lt(new Decimal(config.thresholdBps).div(100))) {
    return { stop: 'below threshold', anomalous, distribution, deltaPercent, legs: [] };
  }
  const legs = buildMoveInstructions(input.balances, distribution, config);
  return { stop: legs.length === 0 ? 'no legs' : null, anomalous, distribution, deltaPercent, legs };
}

/**
 * NEW, #53 on master's stack (planAllocation of #55/#60): the same gate and cooldown; signal =
 * min(spot, 12 h EWMA, half-life 6 h), 0 for an anomalous provider or one without history;
 * segment greedy (held % at spot, the rest of the cap at the signal); cap and min-active after the
 * exclusion; move when allocationGain / vault >= threshold. #60's entry sweep acts below the
 * threshold on deposits that landed in the entry provider since the last settlement; a replayed
 * position takes no deposits, so it never fires here.
 */
export function decideNew(
  input: RunInput & { readonly histories: readonly RateHistory[] },
  config: PathConfig = LIVE
): Decision {
  const anomalous = anomalyGate(input, config);
  if (anomalous.every(Boolean)) return { stop: 'all anomalous', anomalous, legs: [] };
  if (coolingDown(input, config)) return { stop: 'cooldown', anomalous, legs: [] };
  const signals = input.spots.map((spot, i) =>
    anomalous[i] ? 0n : rateSignal(spot, input.histories[i], INTRA_CHAIN_SIGNAL_WINDOW.windowSeconds / 2)
  );
  const totalHeld = input.balances.reduce((sum, b) => sum + b, 0n);
  const raw = solveSegmentGreedy(
    input.spots.map((spot, i) => ({
      spot: anomalous[i] ? 0n : spot,
      signal: signals[i],
      heldPercent: totalHeld === 0n ? 0 : Number((input.balances[i] * 100n) / totalHeld),
    })),
    config.capPercent
  );
  const exclusion = excludeAnomalous(postOptimization(raw, config), anomalous, config, true);
  if (!exclusion.withinLimits) return { stop: 'exclusion outside limits', anomalous, signals, legs: [] };
  const distribution = exclusion.distribution;
  const gain = allocationGain(
    input.spots.map((spot, i) => ({ spot, signal: signals[i], held: input.balances[i] })),
    distribution.map((percent) => (totalHeld * BigInt(percent)) / 100n),
    input.balances
  );
  const delta = totalHeld === 0n ? new Decimal(0) : new Decimal(gain).div(totalHeld.toString()).mul(100);
  const deltaPercent = delta.toNumber();
  if (delta.lt(new Decimal(config.thresholdBps).div(100))) {
    return { stop: 'below threshold', anomalous, distribution, deltaPercent, signals, legs: [] };
  }
  const legs = buildMoveInstructions(input.balances, distribution, config);
  return { stop: legs.length === 0 ? 'no legs' : null, anomalous, distribution, deltaPercent, signals, legs };
}

/** The cross-chain allocator's intra-network settings (#68 defaults) on a 60% provider cap. */
export interface WaterFillConfig {
  readonly capBps: number;
  readonly maxShareOfMarketBps: number;
  readonly intraMinGainBps: number;
  readonly horizonDays: number;
  readonly hysteresisK: number;
  /** One transaction, asset units. */
  readonly gasCost: bigint;
  /** Asset units. */
  readonly minMove: bigint;
  readonly persistenceRuns: number;
}

export const XC: WaterFillConfig = {
  capBps: 6_000,
  maxShareOfMarketBps: 1_000,
  intraMinGainBps: 5,
  horizonDays: 7,
  hysteresisK: 2,
  gasCost: 100_000n,
  minMove: 1_000_000_000n,
  persistenceRuns: 2,
};

export interface WaterFillInput {
  readonly spots: readonly bigint[];
  /** min(spot, 12 h EWMA), ray. */
  readonly signals: readonly bigint[];
  readonly balances: readonly bigint[];
  readonly alphas: readonly number[];
  /** Market size, our position included, asset units. */
  readonly marketSizes: readonly bigint[];
  /** Uncapped provider the water-filling parks the rest on. */
  readonly entry: number;
  readonly previous: { readonly fingerprint: string; readonly count: number } | null;
}

/** PlannerService's LEG_DUST: the smallest leg worth its gas, asset units ($10). */
const LEG_DUST = 10_000_000n;

/**
 * WATERFILL, PlannerService.intraChainRebalance of origin/master 580d1e9 with nothing incoming:
 * water-filling with impact under min(cap x total, 10% of the market), legs largest first, legs
 * under $10 dropped; the move must clear $1k, gain >= 0.05 pp of the vault a year and
 * gain x 7 d > 2 x gas, and the same providers must be filled and drained on `persistenceRuns` runs
 * in a row. A provider above its cap goes back one basis point under it whatever the move earns
 * and however often it was proposed (`restore`); the entry provider has no cap. The planner's
 * persistenceMinSeconds (14 minutes by default) is left out: replayed runs are hours apart.
 */
export function decideWaterFill(
  input: WaterFillInput,
  config: WaterFillConfig = XC
): {
  legs: Leg[];
  previous: WaterFillInput['previous'];
  deltaPercent: number | null;
  stop: string | null;
  restore?: boolean;
} {
  const total = input.balances.reduce((sum, b) => sum + b, 0n);
  const curves: (RateCurve & { cap: bigint })[] = input.spots.map((spot, i) => {
    const byBps = (total * BigInt(config.capBps - 1)) / 10_000n;
    const byMarket = (input.marketSizes[i] * BigInt(config.maxShareOfMarketBps)) / 10_000n;
    return {
      spot,
      signal: input.signals[i],
      held: input.balances[i],
      alpha: input.alphas[i],
      marketSize: input.marketSizes[i],
      cap: byBps < byMarket ? byBps : byMarket,
    };
  });
  const targets = total > 0n ? solveWaterFilling(curves, input.entry, total).amounts : input.balances.map(() => 0n);
  const senders = input.balances
    .map((b, index) => ({ index, excess: b - targets[index] }))
    .filter((e) => e.excess > 0n)
    .sort((a, b) => (b.excess > a.excess ? 1 : b.excess < a.excess ? -1 : 0));
  const receivers = input.balances
    .map((b, index) => ({ index, deficit: targets[index] - b }))
    .filter((e) => e.deficit > 0n)
    .sort((a, b) => (b.deficit > a.deficit ? 1 : b.deficit < a.deficit ? -1 : 0));
  const built: Leg[] = [];
  for (let s = 0, r = 0; s < senders.length && r < receivers.length; ) {
    const amount = senders[s].excess < receivers[r].deficit ? senders[s].excess : receivers[r].deficit;
    if (amount > 0n) built.push({ from: senders[s].index, to: receivers[r].index, amount });
    senders[s].excess -= amount;
    receivers[r].deficit -= amount;
    if (senders[s].excess <= 0n) s++;
    if (receivers[r].deficit <= 0n) r++;
  }
  const value = (legs: Leg[]) => {
    const after = [...input.balances];
    for (const leg of legs) {
      after[leg.from] -= leg.amount;
      after[leg.to] += leg.amount;
    }
    const gain = allocationGain(curves, after, input.balances);
    return { after, gain, deltaPercent: total === 0n ? 0 : (gain / Number(total)) * 100 };
  };
  const legs = built.filter((leg) => leg.amount >= LEG_DUST);
  const moved = legs.reduce((sum, leg) => sum + leg.amount, 0n);
  const { after, gain, deltaPercent } = value(legs);
  const ranked =
    moved > 0n &&
    moved >= config.minMove &&
    gain >= (Number(total) * config.intraMinGainBps) / 10_000 &&
    (gain * config.horizonDays) / 365 > Number(config.gasCost) * config.hysteresisK;
  let previous: WaterFillInput['previous'] = null;
  if (ranked) {
    const side = (sign: bigint) =>
      after
        .map((amount, i) => ((amount - input.balances[i]) * sign >= config.minMove ? i : -1))
        .filter((i) => i >= 0)
        .join(',');
    const fingerprint = `in:${side(1n)}|out:${side(-1n)}`;
    previous = { fingerprint, count: input.previous?.fingerprint === fingerprint ? input.previous.count + 1 : 1 };
    if (previous.count >= config.persistenceRuns) return { legs, previous, deltaPercent, stop: null };
  }
  // Only the excess leaves a provider above its cap, in the order of the full move's legs, dust kept.
  const left = new Map<number, bigint>();
  input.balances.forEach((balance, i) => {
    if (i !== input.entry && balance * 10_000n > total * BigInt(config.capBps))
      left.set(i, balance - (total * BigInt(config.capBps - 1)) / 10_000n);
  });
  const restore: Leg[] = [];
  for (const leg of built) {
    const room = left.get(leg.from) ?? 0n;
    const amount = leg.amount < room ? leg.amount : room;
    if (amount <= 0n) continue;
    left.set(leg.from, room - amount);
    restore.push({ ...leg, amount });
  }
  if (restore.length > 0)
    return { legs: restore, previous, deltaPercent: value(restore).deltaPercent, stop: null, restore: true };
  return {
    legs: [],
    previous,
    deltaPercent,
    stop: previous ? `run ${previous.count} of ${config.persistenceRuns}` : 'below threshold',
  };
}
