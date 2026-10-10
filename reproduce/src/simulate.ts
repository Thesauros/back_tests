/**
 * Tangem simulation: one deposit held for a year in a Thesauros vault, in two controls that
 * do not rebalance by rate (the vault's first split held, and equal parts over the venues the
 * vault may use) and in two passive baselines, on the history collect-history.ts gathered,
 * then four stress scenarios (TS-392 to TS-397).
 *
 * The Thesauros path calls decideNew of the replay harness at every sample: the port of the
 * public vault's decision path, which runs the production allocation library (smoothed signal,
 * segment-greedy split, gain) and repeats the rebalancer's steps around it (anomaly gate,
 * cooldown, 60% cap, gain threshold). With `policy` "water_filling" it calls decideWaterFill
 * instead: the port of the intra-network step of the cross-chain planner, which spreads the
 * vault over the venues until the last dollar earns the same in each, the vault's own deposit
 * priced (client/PROGRAMME.md). Interest is the venue's realized index growth, scaled by
 * the measured ratio of the rate after our deposit to the rate before it and never above that
 * growth; an index that falls is a loss and is taken in full.
 *
 * A move happens only if it could: a leg takes out of a venue no more than the venue could
 * pay and enters no venue that refused the deposit probe. The vault sends all legs in one
 * transaction and does not send it when its simulation reverts, so one such leg refuses the
 * whole rebalance; the equal-weight control moves venue by venue and tries a refused leg again
 * at the next reading.
 *
 * One assumption about the others in a venue serves the rate and the exit. With
 * rate_impact_enabled nobody reacts to our deposit: the rate is the diluted one the probes
 * measured, and the venue can pay its own liquidity and our position on top of it, so only a
 * frozen or a hacked venue and a refused deposit stop a move. Without it our deposit moves no
 * rate, the venue is as utilized with us as without, and it pays its liquid share of itself
 * with us in it. `available_liquidity` follows neither: it is the lower bound of both, what the
 * venues could pay as they stood with none of our deposit counted as liquid, and
 * `time_to_exit_days` takes that much out day after day.
 *
 * The venue rule (eligible_periods) binds the Thesauros run and the equal-weight control at
 * every reading. `just_best_vault` never moves and `first_split_held` does not move after the
 * Thesauros run's first rebalance (the first or the second day), so the rule binds them then
 * only, and `just_aave` is Aave whatever the rule says;
 * `outside_set_percent` of the daily file is what each strategy holds outside the set.
 *
 * Run:
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/simulate.ts scripts/tangem/config.base.wide.json
 *
 * Writes data/tangem/<network>/<output>/*.csv, <output> as the config names it, and checks them
 * against the TS-397 criteria.
 */
import '../../apps/rebalancer/fork/replay/env';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INTRA_CHAIN_SIGNAL_WINDOW, RateHistory, rateSignal } from '@backend-ts/library';
import {
  LIVE,
  PathConfig,
  WaterFillConfig,
  WaterFillInput,
  XC,
  decideNew,
  decideWaterFill,
} from '../../apps/rebalancer/fork/replay/policies';

interface StressConfig {
  /** First day of every scenario. */
  trigger_date: string;
  depeg: { price: number; days: number };
  /**
   * `provider`: a name, or "largest" for the biggest position on the trigger day, or
   * "largest_morpho" for the biggest in a curated Morpho vault (a provider with "Morpho" and
   * without "Market" in its name: a single Morpho Blue market has no curator). The run stops
   * when the venue holds nothing that day: the scenario would test nothing.
   */
  curator_bad_debt: { provider: string; loss_percent: number };
  protocol_hack: { provider: string; loss_percent: number };
  withdrawal_freeze: { provider: string; days: number };
}

interface Config {
  network: string;
  token: string;
  initial_deposit: number;
  start_date: string;
  end_date: string;
  risk_guard_enabled: boolean;
  gas_modeling_enabled: boolean;
  /**
   * true: nobody reacts to our deposit, so it earns the rate measured with it in the venue and
   * stays payable on top of the venue's own liquidity. false is the v1 assumption of TS-392: the
   * deposit does not move rates, so the venue stays as utilized as it was and pays its liquid
   * share of itself with us in it.
   */
  rate_impact_enabled: boolean;
  performance_fee_percent: number;
  /** Percent of assets a year. */
  management_fee_percent: number;
  /** false charges every positive day, as the deployed contract does; true charges above the previous peak only. */
  high_water_mark: boolean;
  /** Where a deposit lands before the first rebalance. It must take money at the first reading. */
  entry_provider: string;
  /** The vault's providers, in on-chain order. */
  providers: string[];
  aave_provider: string;
  circuit_breaker_percent: number;
  /**
   * A venue takes money only while a full position (the provider cap) would be at most this
   * share of it. Absent: no limit, as the public vault runs today. The cross-chain allocator
   * has the same idea as maxShareOfMarketBps.
   */
  max_share_of_venue_percent?: number;
  /**
   * The venue rule (client/VENUE_RULE.md): provider -> the periods [from, to), UTC dates, in which
   * the venue is in the set. Outside them it is read as paying nothing, as a venue too small is:
   * no money enters it, and what it holds leaves when the decision function moves it and the
   * move can execute. That is the first reading of the period's end unless the vault's own
   * rules hold it: the provider cap keeps a part in the venue while fewer than two others are
   * open, and a plan the anomaly gate spread out may stay under the gain threshold. A venue
   * takes money from the first reading of its period, on the rates recorded before it: the run
   * assumes its provider is registered and sampled by then. When the field is present, a
   * provider without an entry is never in the set. Absent: no rule, every provider is in the set
   * all year. The equal-weight control splits again at the first reading of every date that
   * starts or ends a period.
   */
  eligible_periods?: Record<string, [string, string][]>;
  /**
   * The decision of the Thesauros run (client/PROGRAMME.md). Absent or "public_vault": decideNew,
   * the port of the public vault's path. "water_filling": decideWaterFill, the port of the
   * intra-network step of the cross-chain planner, which is not live for the public vaults. Its
   * limit per venue is the config's: at most provider_cap_percent of the vault in a venue other
   * than the entry provider (the planner has no default of its own: it reads each venue's limit
   * from the strategy contract). The rest are the planner's defaults: max_share_of_venue_percent
   * of a venue, the entry provider again apart, legs from $10, a move from $1,000 that gains at
   * least 0.05 pp of the vault a year and more than twice a flat $0.10 of gas over seven days,
   * with the same venues filled and drained at two readings in a row. RiskGuard's circuit
   * breaker, anomaly gate, cooldown and minimum of active providers are not on that path and are
   * not applied. risk_guard_enabled must be true: the cap is read through it.
   */
  policy?: 'public_vault' | 'water_filling';
  /**
   * water_filling: the exponent of r(x) = r0 (T / (T + x))^alpha the allocator prices the vault's
   * own deposit with. Absent or "production": the planner's constant of the venue's protocol.
   * "measured": the exponent that reproduces the reading's $10M deposit probe.
   */
  impact_exponent?: 'production' | 'measured';
  /**
   * PROGRAMME.md 3: a venue whose own free liquidity at the reading is below a full position
   * (the provider cap of the vault) takes no new money. In the Thesauros run its signal is zero
   * and what it holds is still judged at its rate; the equal-weight control leaves it out of a
   * split. Absent: no such rule.
   */
  liquidity_rule?: boolean;
  /** MAX_PROVIDER_ALLOCATION_PERCENT and MIN_ACTIVE_PROVIDERS of RiskGuard; the live 60 and 2 when absent. */
  provider_cap_percent?: number;
  min_active_providers?: number;
  /** Folder under data/tangem/<network>/ for the result; "simulation" when absent. */
  output?: string;
  /** Public names of the venues behind the providers, used in every output file. */
  labels: Record<string, string>;
  stress: StressConfig;
}

const config: Config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const DIR = join(process.cwd(), 'data/tangem', config.network.toLowerCase());
const OUT = join(DIR, config.output ?? 'simulation');
const USDC = 1e6;
const RAY = 1e27;
const DAY = 86400;
const YEAR = 365 * DAY;
/**
 * Gas of a one-leg rebalance: the median `gas_used` of the nine real ones of the current Base
 * vault in rebalance-gas.csv (its rows with `vault_generation` current and `legs` 1), used for
 * every venue on both networks, a venue with no adapter included.
 */
const REBALANCE_GAS_PER_LEG = 982930;
/** The deposits collect-history.ts tries in every venue at every reading, USDC. */
const PROBES = [4e6, 6e6, 10e6];

// ---------------------------------------------------------------------------------------------
// History

interface Venue {
  /** getDepositRate with nothing of ours in the venue, a fraction per year. */
  rate: number;
  /** [our position in USDC, rate at it], ascending, starting at [0, rate]. */
  curve: [number, number][];
  /** The probes the venue refused, USDC: all of them while it has no reading. */
  refused: number[];
  index: number;
  /** USDC the venue could pay out at the sample. */
  liquidity: number;
  /** USDC supplied to the venue, without us. */
  supplied: number;
}
interface Sample {
  t: number;
  venues: Venue[];
  /** One-leg rebalance: [wei, USD]. */
  legGas: [number, number];
  /** L1 data fee of one transaction: [wei, USD]. */
  l1Fee: [number, number];
}

function loadSamples(): Sample[] {
  const from = Date.parse(config.start_date) / 1000;
  const to = Date.parse(config.end_date) / 1000;
  return readFileSync(join(DIR, 'raw.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { block: number; values: Record<string, string | null> })
    .sort((a, b) => a.block - b.block)
    .map(({ values }) => {
      const number = (key: string) => Number(values[key] ?? 0);
      const ethUsd = number('ethUsd') / 1e8;
      const price = number('gas.baseFeeMedian') + number('gas.priorityFeeMedian');
      const usd = (wei: number): [number, number] => [wei, (wei / 1e18) * ethUsd];
      return {
        t: number('timestamp'),
        venues: config.providers.map((name) => {
          // A venue with no index does not exist yet and reads as zeros. One with an index and
          // without another reading is a failed read, and a zero in its place would be a guess.
          for (const field of ['rate', 'supplied', 'liquidity']) {
            if (number(`${name}.index`) > 0 && values[`${name}.${field}`] == null)
              throw new Error(`${name}.${field} has no reading on ${dayOf(number('timestamp'))}`);
          }
          const rate = number(`${name}.rate`) / RAY;
          const curve: [number, number][] = [[0, rate]];
          const refused: number[] = [];
          for (const size of PROBES) {
            const after = values[`${name}.rateAfter${size / 1e6}`];
            if (after != null) curve.push([size, Number(after) / RAY]);
            else refused.push(size);
          }
          return {
            rate,
            curve,
            refused,
            index: number(`${name}.index`),
            liquidity: number(`${name}.liquidity`) / USDC,
            supplied: number(`${name}.supplied`) / USDC,
          };
        }),
        legGas: usd(REBALANCE_GAS_PER_LEG * price),
        l1Fee: usd(number('gas.l1Fee')),
      };
    })
    .filter((sample) => sample.t >= from && sample.t <= to + 4 * 3600);
}

/** The rate the venue reports with `position` of ours in it: the measured points, joined by straight lines. */
function rateAt(venue: Venue, position: number): number {
  if (!config.rate_impact_enabled || position <= 0 || venue.curve.length === 1) return venue.rate;
  const { curve } = venue;
  let k = 1;
  while (k < curve.length - 1 && curve[k][0] < position) k++;
  const [x0, r0] = curve[k - 1];
  const [x1, r1] = curve[k];
  return Math.max(0, r0 + ((r1 - r0) * (position - x0)) / (x1 - x0));
}

/**
 * Whether the venue refuses a deposit that brings our position in it to `position`: the
 * smallest probe at or above that size was refused (the largest probe for a position above
 * them all). The readings are taken without us, so what counts is the whole position, not the
 * part added. A position a little above a probe is judged by the next one: a full position of
 * 60% of a vault that has grown past $10M answers to the $10M probe, which is the stricter
 * reading. A venue with no reading refuses.
 */
function refusesDeposit(venue: Venue, position: number): boolean {
  const probe = PROBES.find((size) => size >= position) ?? PROBES[PROBES.length - 1];
  return venue.index === 0 || venue.refused.includes(probe);
}

/**
 * The planner's impact exponent of the venue's protocol (getImpactAlpha of crosschain.config.ts):
 * 2 for Aave V3 and Compound V3, 1.75 for a Morpho vault. Every other venue is given 1.75, which
 * is what the planner gives an adapter it does not know, and is an assumption: production has
 * no adapter for a Morpho Vault V2, a single Morpho Blue market, Fluid, Spark Savings or
 * SparkLend.
 */
const productionExponent = (provider: string): number =>
  ['AaveV3Provider', 'CompoundV3Provider'].includes(provider) ? 2 : 1.75;

/**
 * The exponent of r(x) = r0 (T / (T + x))^alpha that reproduces the reading's $10M probe, within
 * the 0 to 10 the planner's config accepts; null when the reading measures none (no rate, nothing
 * supplied, the probe refused).
 */
function measuredExponent(venue: Venue): number | null {
  const size = PROBES[PROBES.length - 1];
  const probe = venue.curve.find(([position]) => position === size);
  if (!probe || !(venue.rate > 0) || !(venue.supplied > 0)) return null;
  if (probe[1] >= venue.rate) return 0;
  if (probe[1] <= 0) return 10;
  return Math.min(10, Math.log(venue.rate / probe[1]) / Math.log((venue.supplied + size) / venue.supplied));
}

// ---------------------------------------------------------------------------------------------
// Scenarios

type ScenarioKind = 'depeg' | 'curator_bad_debt' | 'protocol_hack' | 'withdrawal_freeze';
interface Scenario {
  kind: ScenarioKind;
  /** Provider index, resolved on the trigger day. */
  target?: number;
  /** withdrawal_freeze: the first frozen reading and the time the freeze ends, as the run met them. */
  frozen?: [number, number];
  /** What RiskGuard and the vault did about it, as the run met it. */
  events: { rule: 'circuit_breaker' | 'anomaly_gate' | 'frozen_move'; date: string; change?: number }[];
}

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const label = (provider: string) => config.labels[provider] ?? provider;
/** Whether the venue rule has the provider in the set on the day of `t`. */
const inSet = (provider: string, t: number) =>
  config.eligible_periods === undefined ||
  (config.eligible_periods[provider] ?? []).some(([from, to]) => dayOf(t) >= from && dayOf(t) < to);
/** The dates on which the set can change: every start and end of a period. */
const boundaries = [...new Set(Object.values(config.eligible_periods ?? {}).flat(2))];
const trigger = Date.parse(config.stress.trigger_date) / 1000;

/** Why a venue takes no money, as the rebalance file words it for a position that leaves for it. */
const BARRED = {
  no_reading: 'forced exit: the venue has no reading',
  outside_set: 'forced exit: the venue is not in the set',
  too_small: 'forced exit: the venue is too small for a full position',
};
/** liquidity_rule: the venue's own free liquidity is below a full position, so it takes no new money. */
const shutAt = (sample: Sample, i: number, fullPosition: number) =>
  config.liquidity_rule === true && sample.venues[i].liquidity < fullPosition;
type Barred = keyof typeof BARRED;
/**
 * Why a venue takes no money at a reading, null when it does: it has no reading (it does not
 * exist yet), the venue rule has it outside the set, or a full position (`fullPosition`, the
 * provider cap of the vault in USDC) would be more than max_share_of_venue_percent of it.
 */
function barredAt(sample: Sample, i: number, fullPosition: number): Barred | null {
  const venue = sample.venues[i];
  if (venue.index === 0) return 'no_reading';
  if (!inSet(config.providers[i], sample.t)) return 'outside_set';
  const tooSmall =
    config.max_share_of_venue_percent !== undefined &&
    fullPosition > ((venue.supplied + fullPosition) * config.max_share_of_venue_percent) / 100;
  return tooSmall ? 'too_small' : null;
}

function largest(positions: number[], only?: (name: string) => boolean): number {
  let best = -1;
  positions.forEach((position, i) => {
    if (only && !only(config.providers[i])) return;
    if (best < 0 || position > positions[best]) best = i;
  });
  return best;
}

function resolveTarget(provider: string, positions: number[]): number {
  const index =
    provider === 'largest'
      ? largest(positions)
      : provider === 'largest_morpho'
      ? largest(positions, (name) => name.includes('Morpho') && !name.includes('Market'))
      : config.providers.indexOf(provider);
  if (index < 0) throw new Error(`Stress provider ${provider} is not among the simulated providers`);
  // $2 is above the $1 a sender keeps (SAFETY_BUFFER of buildMoveInstructions).
  if (!(positions[index] > 2))
    throw new Error(`Stress provider ${provider}: the vault holds nothing in ${config.providers[index]} that day`);
  return index;
}

// ---------------------------------------------------------------------------------------------
// One run

/**
 * `first_split_held` is the control for what rebalancing adds: the Thesauros run up to its
 * first rebalance, then nothing moves, and no Thesauros fee is taken. A venue of that split
 * that leaves the set later stays held, so under eligible_periods the difference from the
 * Thesauros run also carries what the venue rule costs; `eligible_equal_weight` does not.
 *
 * `eligible_equal_weight` is the control for what choosing by rate adds over holding the
 * allowed venues: equal parts over the venues that take money at the first reading (in the set
 * and not too small), split again at the first reading of every date that starts or ends a
 * period of eligible_periods, held in between. A leg of a split that cannot execute is tried
 * again at every reading until it does. It reads no rate and pays no Thesauros fee.
 */
type Strategy = 'thesauros_simple' | 'first_split_held' | 'eligible_equal_weight' | 'just_aave' | 'just_best_vault';
interface Leg {
  from: number;
  to: number;
  /** USDC. */
  amount: number;
  /** Set on a leg out of a venue the decision read as paying nothing: why it was. */
  forced?: Barred;
}
interface DayRow {
  date: string;
  /** USDC, after gas and fees. */
  assets: number;
  /** USD a USDC is worth: 1 outside the depeg scenario. */
  price: number;
  rebalances: number;
  /**
   * Legs planned and not executed: the venue could not pay or would not take the money. A plan
   * refused at one reading and made again at the next is counted at both.
   */
  refused: number;
  gasWei: number;
  gasUsd: number;
  fees: number;
  /** What each venue earned that day before gas and the fee, USDC: a fall of the index is negative. */
  interest: number[];
  liquidity: number;
  positions: number[];
  /** What each venue could pay out, for the time-to-exit walk. */
  venueLiquidity: number[];
}
interface Move extends Leg {
  t: number;
  tx: number;
  /** What the source venue could pay at the reading with none of our deposit counted as liquid, USDC. */
  sourceLiquidity: number;
  gasUsed: number;
  gasWei: number;
  gasUsd: number;
  aprBefore: number;
  aprAfter: number;
  /**
   * What the decision expected to gain, on the rates before the move, percentage points a year.
   * Null where that is not what its figure means: a transaction with a forced exit, whose
   * leaving position the decision values at zero, and a move no decision made.
   */
  expectedGain: number | null;
  /** water_filling: the move takes a venue back under the provider cap, whatever it earns. */
  restore?: boolean;
}
interface Run {
  days: DayRow[];
  moves: Move[];
  bestVault?: string;
  /** water_filling: every decision of the run, its input and its result, for check-allocator.ts. */
  decisions: string[];
}

const pathConfig: PathConfig = config.risk_guard_enabled
  ? {
      ...LIVE,
      capPercent: config.provider_cap_percent ?? LIVE.capPercent,
      minActive: config.min_active_providers ?? LIVE.minActive,
    }
  : { ...LIVE, capPercent: 100, minActive: 1, maxDeviationPercent: Infinity, cooldownSeconds: 0 };
/** The planner's defaults, with the cap and the share of a venue the config names. */
const waterFill: WaterFillConfig = {
  ...XC,
  capBps: pathConfig.capPercent * 100,
  maxShareOfMarketBps:
    config.max_share_of_venue_percent === undefined ? XC.maxShareOfMarketBps : config.max_share_of_venue_percent * 100,
};

/**
 * The legs that take `positions` to `targets`: senders and receivers paired in index order, as
 * buildMoveInstructions pairs them, without a leg of MIN_TARGET_AMOUNT or less.
 */
function legsTo(positions: number[], targets: number[]): Leg[] {
  const least = Number(pathConfig.minTarget) / USDC;
  const excess = positions.map((position, i) => position - targets[i]);
  const legs: Leg[] = [];
  for (let from = 0, to = 0; ; ) {
    while (from < excess.length && excess[from] <= least) from++;
    while (to < excess.length && excess[to] >= -least) to++;
    if (from === excess.length || to === excess.length) return legs;
    const amount = Math.min(excess[from], -excess[to]);
    legs.push({ from, to, amount });
    excess[from] -= amount;
    excess[to] += amount;
  }
}

function simulate(samples: Sample[], strategy: Strategy, scenario?: Scenario): Run {
  const n = config.providers.length;
  const everyVenue = config.providers.map((_, i) => i);
  const positions: number[] = new Array(n).fill(0);
  const takes = (i: number, deposit: number) => !refusesDeposit(samples[0].venues[i], deposit);
  let bestVault: string | undefined;
  if (strategy === 'thesauros_simple' || strategy === 'first_split_held') {
    // The deposit is money entering a venue too.
    const entry = config.providers.indexOf(config.entry_provider);
    const why = barredAt(samples[0], entry, (config.initial_deposit * pathConfig.capPercent) / 100);
    if (why) throw new Error(`entry_provider ${config.entry_provider} takes no money at the first reading: ${why}`);
    if (shutAt(samples[0], entry, (config.initial_deposit * pathConfig.capPercent) / 100))
      throw new Error(
        `entry_provider ${config.entry_provider} has less free liquidity than a full position at the first reading`
      );
    positions[entry] = config.initial_deposit;
  } else if (strategy === 'just_aave') {
    positions[config.providers.indexOf(config.aave_provider)] = config.initial_deposit;
  } else if (strategy === 'eligible_equal_weight') {
    // Equal parts over the venues that take money at the first reading and accept their part.
    const fullPosition = (config.initial_deposit * pathConfig.capPercent) / 100;
    let open = positions
      .map((_, i) => i)
      .filter((i) => !barredAt(samples[0], i, fullPosition) && !shutAt(samples[0], i, fullPosition));
    while (open.some((i) => !takes(i, config.initial_deposit / open.length))) {
      open = open.filter((i) => takes(i, config.initial_deposit / open.length));
    }
    if (open.length === 0) throw new Error('eligible_equal_weight: no provider takes money at the first reading');
    open.forEach((i) => (positions[i] = config.initial_deposit / open.length));
  } else {
    // The provider with the highest displayed rate on the first day among those in the set that
    // accept the deposit, all in, never moved.
    const rate = (i: number) =>
      inSet(config.providers[i], samples[0].t) && takes(i, config.initial_deposit) ? samples[0].venues[i].rate : -1;
    const best = samples[0].venues.reduce((top, _venue, i) => (rate(i) > rate(top) ? i : top), 0);
    if (rate(best) < 0) throw new Error('just_best_vault: no provider in the set takes the deposit on the first day');
    positions[best] = config.initial_deposit;
    bestVault = label(config.providers[best]);
  }
  // The deposit lands only where the venue takes it; one with no reading does not exist yet.
  positions.forEach((position, i) => {
    if (position > 0 && !takes(i, position))
      throw new Error(`${strategy}: ${config.providers[i]} does not take the deposit at the first reading`);
  });

  const total = () => positions.reduce((sum, position) => sum + position, 0);
  const apr = (sample: Sample) => {
    const sum = total();
    return sum === 0 ? 0 : positions.reduce((acc, p, i) => acc + p * rateAt(sample.venues[i], p), 0) / sum;
  };
  /** Observed rates of earlier samples, newest last: what the rate history and the anomaly gate read. */
  const seen: { t: number; rates: bigint[] }[] = [];
  /** Since when each venue has had a reading at every sample; Infinity while it has none. */
  const readSince: number[] = new Array(n).fill(Infinity);
  /** Each venue's rate with our position in it over its rate without us, as last measured. */
  const dilution: number[] = new Array(n).fill(1);
  /**
   * eligible_equal_weight, while a split has legs left: the venues it splits over, and the
   * venues its refused legs touch.
   */
  let split: { open: number[]; late: number[] } | null = null;
  /** water_filling: the impact exponent of each venue, and the plan of the reading before. */
  const exponents = config.providers.map(productionExponent);
  let proposed: WaterFillInput['previous'] = null;
  const decisions: string[] = [];
  const days: DayRow[] = [];
  const moves: Move[] = [];
  let lastMoveAt: number | null = null;
  let previousTotal = total();
  let peak = total();
  let dayStart = total();
  const newDay = () => ({ rebalances: 0, refused: 0, gasWei: 0, gasUsd: 0, interest: new Array<number>(n).fill(0) });
  let day = newDay();
  /** The smallest share of the vault the venues could pay out at any reading of the day. */
  let lowestPayable = 1;
  let dead = -1;
  let frozenUntil = 0;
  let fired = false;
  let tx = 0;

  for (let k = 0; k < samples.length - 1; k++) {
    const sample = samples[k];

    if (scenario && !fired && sample.t >= trigger) {
      fired = true;
      const stress = config.stress;
      if (scenario.kind === 'curator_bad_debt') {
        scenario.target = resolveTarget(stress.curator_bad_debt.provider, positions);
        positions[scenario.target] *= 1 - stress.curator_bad_debt.loss_percent / 100;
      } else if (scenario.kind === 'protocol_hack') {
        scenario.target = resolveTarget(stress.protocol_hack.provider, positions);
        positions[scenario.target] *= 1 - stress.protocol_hack.loss_percent / 100;
        dead = scenario.target;
      } else if (scenario.kind === 'withdrawal_freeze') {
        scenario.target = resolveTarget(stress.withdrawal_freeze.provider, positions);
        frozenUntil = sample.t + stress.withdrawal_freeze.days * DAY;
        scenario.frozen = [sample.t, frozenUntil];
      }
    }
    const frozen = scenario?.kind === 'withdrawal_freeze' && fired && sample.t < frozenUntil ? scenario.target! : -1;
    // A venue too small for a full position, outside the set by the venue rule or with no
    // reading is read as paying nothing: no money enters it and what it holds leaves. The rate
    // history keeps the true rate.
    const fullPosition = (total() * pathConfig.capPercent) / 100;
    const barred = (i: number) => barredAt(sample, i, fullPosition);
    const shut = (i: number) => shutAt(sample, i, fullPosition);
    sample.venues.forEach((venue, i) => (readSince[i] = venue.index > 0 ? Math.min(readSince[i], sample.t) : Infinity));

    // What a venue could pay out with our money in it, on the assumption the rate is credited
    // on. With rate impact nobody reacts to our deposit: it earns the diluted rate and lies on
    // top of the venue's own liquidity. Without it the rate is the venue's as it stood, so the
    // venue is as utilized with us as without: its liquid share applied to the venue with our
    // position, nothing from a venue with nothing supplied to read. A frozen and a hacked venue
    // pay nothing.
    const payableBy = (i: number) => {
      const { liquidity, supplied } = sample.venues[i];
      if (i === frozen || i === dead) return 0;
      if (config.rate_impact_enabled) return liquidity + positions[i];
      return supplied === 0 ? 0 : liquidity * (1 + positions[i] / supplied);
    };
    /** The legs that can execute at this reading, taken in order as the vault's rebalance() takes them. */
    const executable = (legs: Leg[]) => {
      const out: number[] = new Array(n).fill(0);
      const into: number[] = new Array(n).fill(0);
      return legs.filter(({ from, to, amount }) => {
        const can =
          out[from] + amount <= payableBy(from) &&
          !refusesDeposit(sample.venues[to], positions[to] + into[to] + amount);
        if (can) {
          out[from] += amount;
          into[to] += amount;
        }
        return can;
      });
    };
    /** Moves the legs in `transactions` transactions and books them. */
    const execute = (legs: Leg[], transactions: number, expectedGain: number | null, restore?: boolean) => {
      const aprBefore = apr(sample);
      const gasWei = config.gas_modeling_enabled ? sample.legGas[0] * legs.length + sample.l1Fee[0] * transactions : 0;
      const gasUsd = config.gas_modeling_enabled ? sample.legGas[1] * legs.length + sample.l1Fee[1] * transactions : 0;
      for (const leg of legs) {
        if (barred(leg.to) || shut(leg.to))
          throw new Error(`a leg enters ${config.providers[leg.to]}, which takes no money`);
        positions[leg.from] -= leg.amount;
        positions[leg.to] += leg.amount;
        // The planner's legs empty a venue to the unit, and two of them out of one venue can leave
        // the float a hair under zero: that is rounding, anything more is a fault.
        if (positions[leg.from] < 0 && positions[leg.from] > -1e-6) positions[leg.from] = 0;
      }
      // Gas leaves the vault in proportion; in production the operator pays it, so this is conservative.
      const kept = 1 - gasUsd / total();
      positions.forEach((_, i) => (positions[i] *= kept));
      const aprAfter = apr(sample);
      for (const leg of legs) {
        // A number a transaction: the legs of a rebalance share one, a leg sent alone has its own.
        if (transactions > 1 || leg === legs[0]) tx++;
        moves.push({
          t: sample.t,
          tx,
          ...leg,
          sourceLiquidity: sample.venues[leg.from].liquidity,
          gasUsed: REBALANCE_GAS_PER_LEG,
          gasWei: gasWei / legs.length,
          gasUsd: gasUsd / legs.length,
          aprBefore,
          aprAfter,
          expectedGain,
          restore,
        });
      }
      day.rebalances += legs.length;
      day.gasWei += gasWei;
      day.gasUsd += gasUsd;
      lastMoveAt = sample.t;
    };

    const spots = sample.venues.map((venue, i) =>
      i === dead ? 0n : BigInt(Math.round(rateAt(venue, positions[i]) * RAY))
    );
    if (
      strategy === 'eligible_equal_weight' &&
      k > 0 &&
      boundaries.some((date) => dayOf(sample.t) >= date && dayOf(samples[k - 1].t) < date)
    ) {
      split = { open: everyVenue.filter((i) => !barred(i) && !shut(i)), late: everyVenue };
    }
    if (split) {
      // A passive holder moves venue by venue, a transaction a leg: a leg that cannot execute
      // waits and the others go through. At the next reading the venues the refused legs touch
      // share what they hold between them, which is their parts of the split; the others are
      // held, so that their interest since is not moved about. A venue that stopped taking money
      // meanwhile is left out; when none of the waiting ones takes any, the whole split is made
      // again. With no venue open nothing moves: senders find no receiver.
      const open = split.open.filter((i) => !barred(i) && !shut(i));
      const late = split.late.some((i) => open.includes(i)) ? split.late : everyVenue;
      const takers = late.filter((i) => open.includes(i));
      const rest = late.reduce((sum, i) => sum + positions[i], 0);
      const legs: Leg[] = legsTo(
        positions,
        positions.map((position, i) => (!late.includes(i) ? position : takers.includes(i) ? rest / takers.length : 0))
      ).map((leg) => ({ ...leg, forced: barred(leg.from) ?? undefined }));
      const can = executable(legs);
      const waiting = legs.filter((leg) => !can.includes(leg));
      day.refused += waiting.length;
      if (can.length > 0) execute(can, can.length, null);
      split = waiting.length > 0 ? { open, late: [...new Set(waiting.flatMap((leg) => [leg.from, leg.to]))] } : null;
    }
    if (strategy === 'thesauros_simple' || (strategy === 'first_split_held' && lastMoveAt === null)) {
      // RiskGuard.checkCircuitBreaker: the vault's assets against the previous reading. RiskGuard
      // is the public vault's: the planner's step has no such rule.
      const change = previousTotal === 0 ? 0 : (Math.abs(total() - previousTotal) / previousTotal) * 100;
      const tripped =
        config.policy !== 'water_filling' && config.risk_guard_enabled && change > config.circuit_breaker_percent;
      if (tripped) {
        scenario?.events.push({ rule: 'circuit_breaker', date: dayOf(sample.t), change });
      } else {
        // The live sampler reads the rate at the hour marks of the last twelve hours, eleven or
        // twelve points. The readings here are four hours apart, so twelve hourly points are
        // filled in on a straight line between them. A jump first seen at a reading is then 31%
        // of the average, where three raw points would make it 44%; in production it is 14% while
        // under an hour old and 31% on average over the four hours it may have happened in. A
        // venue with no reading twelve hours old, or one that missed a reading since, has no
        // history: its signal is zero and nothing enters it, as for a provider production cannot
        // sample. Under liquidity_rule a venue short of free liquidity has no history at that
        // reading only: the rates of its short readings stay in the average of the next ones.
        const histories: RateHistory[] = spots.map((_, i) =>
          readSince[i] > sample.t - 12 * 3600 + 600 || shut(i)
            ? 'unavailable'
            : Array.from({ length: 12 }, (_unused, hour) => {
                const at = sample.t - (hour + 1) * 3600;
                const after = seen.findIndex((entry) => entry.t >= at);
                const right = after < 0 ? { t: sample.t, rates: spots } : seen[after];
                const left = seen[Math.max(0, (after < 0 ? seen.length : after) - 1)];
                const share = right.t === left.t ? 0 : Math.max(0, at - left.t) / (right.t - left.t);
                const rate = Number(left.rates[i]) + (Number(right.rates[i]) - Number(left.rates[i])) * share;
                return { ageSeconds: (hour + 1) * 3600, rate: BigInt(Math.round(rate)) };
              })
        );
        const balances = positions.map((position) => BigInt(Math.floor(position * USDC)));
        // A barred venue is read as paying nothing, by either decision.
        const read = spots.map((spot, i) => (barred(i) ? 0n : spot));
        let decided: { stop: string | null; legs: readonly { from: number; to: number; amount: bigint }[] };
        let gain: number | null;
        let restore: boolean | undefined;
        if (config.policy === 'water_filling') {
          if (config.impact_exponent === 'measured') {
            // A reading that measures no exponent leaves the venue's last one, the planner's constant at first.
            sample.venues.forEach((venue, i) => (exponents[i] = measuredExponent(venue) ?? exponents[i]));
          }
          const input: WaterFillInput = {
            spots: read,
            signals: read.map((spot, i) => rateSignal(spot, histories[i], INTRA_CHAIN_SIGNAL_WINDOW.windowSeconds / 2)),
            balances,
            alphas: [...exponents],
            // The planner's market size has the vault's own position in it.
            marketSizes: sample.venues.map((venue, i) => BigInt(Math.floor(venue.supplied * USDC)) + balances[i]),
            entry: config.providers.indexOf(config.entry_provider),
            previous: proposed,
          };
          const decision = decideWaterFill(input, waterFill);
          proposed = decision.previous;
          if (strategy === 'thesauros_simple' && !scenario) {
            decisions.push(
              JSON.stringify({ t: sample.t, input, config: waterFill, decision }, (_key, value) =>
                typeof value === 'bigint' ? value.toString() : value
              )
            );
          }
          decided = decision;
          gain = decision.deltaPercent;
          restore = decision.restore;
        } else {
          const decision = decideNew(
            { t: sample.t, spots: read, balances, recorded: seen, lastMoveAt, histories },
            pathConfig
          );
          // A flag in the week after the event is a response to it; a later one is the market.
          if (scenario?.target !== undefined && sample.t < trigger + 7 * DAY && decision.anomalous[scenario.target]) {
            scenario.events.push({ rule: 'anomaly_gate', date: dayOf(sample.t) });
          }
          decided = decision;
          gain = decision.deltaPercent ?? null;
        }
        // No money enters a venue that takes none. The zero rate or signal keeps the ranking from
        // sending any; the filter drops the legs of the steps that place a share without reading
        // rates (the anomalous exclusion and its re-cap of the public vault, the rest the planner
        // parks on its entry provider). What is left of such a plan moves on a gain that was
        // worked out for all of it.
        const legs: Leg[] = decided.legs
          .filter((leg) => !barred(leg.to) && !shut(leg.to) && leg.to !== dead)
          .map((leg) => ({
            from: leg.from,
            to: leg.to,
            amount: Number(leg.amount) / USDC,
            forced: barred(leg.from) ?? undefined,
          }));
        if (decided.stop === null && legs.length > 0) {
          if (legs.some((leg) => leg.from === frozen)) {
            scenario!.events.push({ rule: 'frozen_move', date: dayOf(sample.t) });
          }
          // The vault's rebalance(amounts, sources, destinations) runs every leg in one transaction
          // and reverts as a whole when one leg does; ApproveService simulates that call and does not
          // send a transaction whose simulation reverts (apps/rebalancer/src/approve/approve.service.ts:178-207).
          // So one leg that cannot execute refuses them all: nothing moves, no gas is spent, and the
          // next reading decides again.
          if (executable(legs).length < legs.length) {
            day.refused += legs.length;
          } else {
            // With a forced exit in it the decision's figure is not a gain on rates: it values the
            // leaving position at zero.
            execute(legs, 1, legs.some((leg) => leg.forced) ? null : gain, restore);
          }
        }
      }
    }
    previousTotal = total();
    // The share of the vault a depositor could withdraw, as a lower bound: what the venues could
    // pay as they stood, our own deposit not counted as liquid. `|| 1`: a vault that lost
    // everything has nothing to pay, not 0 / 0.
    const payable = (reading: Sample) =>
      positions.reduce(
        (sum, position, i) => sum + (i === frozen || i === dead ? 0 : Math.min(position, reading.venues[i].liquidity)),
        0
      ) / (total() || 1);
    lowestPayable = Math.min(lowestPayable, payable(sample));
    seen.push({ t: sample.t, rates: spots });
    while (seen[0].t < sample.t - 2 * DAY) seen.shift();

    // Interest to the next sample.
    const next = samples[k + 1];
    positions.forEach((position, i) => {
      if (position === 0 || i === dead) return;
      const venue = sample.venues[i];
      // A missing reading is not a loss: stop, instead of turning it into one (index 0) or into NaN.
      if (!(venue.index > 0 && next.venues[i].index > 0))
        throw new Error(`${config.providers[i]} holds ${position} with no index reading after ${dayOf(sample.t)}`);
      const growth = next.venues[i].index / venue.index - 1;
      // Never more than the venue paid: a deposit that raises a vault's rate is not credited for
      // it. A reading with a zero rate or with every probe refused measures no ratio, and the
      // plain rate is the most the position could earn there, so the venue's last ratio stands.
      if (venue.rate > 0 && venue.curve.length > 1) dilution[i] = Math.min(1, rateAt(venue, position) / venue.rate);
      positions[i] = position * (1 + (growth > 0 ? growth * dilution[i] : growth));
      day.interest[i] += positions[i] - position;
    });

    if (dayOf(next.t) === dayOf(sample.t) && k < samples.length - 2) continue;
    // Day close: the performance fee leaves the vault, then the row is written.
    let fees = 0;
    if (strategy === 'thesauros_simple') {
      const gross = total();
      const base = config.high_water_mark ? peak : dayStart;
      fees =
        (Math.max(0, gross - base) * config.performance_fee_percent) / 100 +
        (gross * config.management_fee_percent) / 100 / 365;
      if (fees > 0) positions.forEach((_, i) => (positions[i] *= 1 - fees / gross));
      peak = Math.max(peak, total());
    }
    const depegged =
      scenario?.kind === 'depeg' && sample.t >= trigger && sample.t < trigger + config.stress.depeg.days * DAY;
    days.push({
      date: dayOf(sample.t),
      assets: total(),
      price: depegged ? config.stress.depeg.price : 1,
      ...day,
      fees,
      liquidity: Math.min(lowestPayable, payable(next)) * total(),
      positions: [...positions],
      venueLiquidity: next.venues.map((venue, i) => (i === frozen || i === dead ? 0 : venue.liquidity)),
    });
    dayStart = total();
    day = newDay();
    lowestPayable = 1;
  }
  return { days, moves, bestVault, decisions };
}

// ---------------------------------------------------------------------------------------------
// Output

const money = (value: number) => value.toFixed(2);
const percent = (fraction: number) => (fraction * 100).toFixed(4);
/** A venue's share of the vault, percent; 0 everywhere in a vault that lost everything. */
const share = (position: number, assets: number) => (assets === 0 ? 0 : (position / assets) * 100).toFixed(2);

function writeCsv(file: string, header: string[], rows: (string | number)[][]): void {
  writeFileSync(join(OUT, file), [header, ...rows].map((row) => row.join(',')).join('\n') + '\n');
  console.log(`${file}: ${rows.length} rows`);
}

function dailyRows(strategy: string, run: Run): (string | number)[][] {
  return run.days.map((row, d) => {
    const before = d === 0 ? config.initial_deposit : run.days[d - 1].assets;
    const monthAgo = d >= 30 ? run.days[d - 30].assets : null;
    const t = Date.parse(row.date) / 1000;
    return [
      row.date,
      strategy,
      money(row.assets),
      money(row.assets - before),
      money(row.assets - config.initial_deposit),
      monthAgo === null ? '' : percent((row.assets / monthAgo) ** (365 / 30) - 1),
      row.rebalances,
      row.refused,
      Math.round(row.gasWei),
      money(row.gasUsd),
      money(row.fees),
      // TS-394: the baselines carry no Thesauros fee; what a protocol or a curator takes is already in its rate.
      strategy === 'thesauros_simple'
        ? `performance ${config.performance_fee_percent}% of ${
            config.high_water_mark ? 'gains above the high-water mark' : "each day's gain"
          }`
        : 'none (native protocol fees are inside the rates)',
      money(row.liquidity),
      share(
        row.positions.reduce((sum, position, i) => (inSet(config.providers[i], t) ? sum : sum + position), 0),
        row.assets
      ),
      ...row.positions.map((position) => share(position, row.assets)),
      // Half a cent of a fall is no fall: not "-0.00".
      ...row.interest.map((earned) => money(earned).replace(/^-0\.00$/, '0.00')),
    ];
  });
}

/** Days from `from` until the whole position has left, taking each day what the venues can pay. */
function daysToExit(run: Run, from: number): number | null {
  const left = [...run.days[from].positions];
  for (let d = from; d < run.days.length; d++) {
    left.forEach((amount, i) => (left[i] = amount - Math.min(amount, run.days[d].venueLiquidity[i])));
    if (left.every((amount) => amount < 1)) return d - from;
  }
  return null;
}

/**
 * What the rules did and did not do in a scenario, as the run met it. The shares and the days of
 * the movements can be read in tangem-stress-timelines.csv: its venue columns, to their two
 * decimals, its available_liquidity and its rebalance_count. The readings at which a rebalance
 * would have reverted are counted here and are in no file.
 */
function describeResponse(scenario: Scenario, run: Run, triggerDay: number, loss: number): string {
  const dayBefore = run.days[triggerDay - 1];
  const share = scenario.target === undefined ? 0 : (dayBefore.positions[scenario.target] / dayBefore.assets) * 100;
  // The cap is applied when a rebalance executes: a position that earns more than the others,
  // and a vault that could not move, sit above it.
  const planner = config.policy === 'water_filling';
  const cap =
    pathConfig.capPercent >= 100
      ? ''
      : planner && config.providers[scenario.target ?? -1] === config.entry_provider
      ? ' (the entry provider, which the allocator does not cap)'
      : planner && Number(share.toFixed(2)) > pathConfig.capPercent
      ? ` (above the provider cap of ${pathConfig.capPercent}%: the allocator takes the excess out at the next reading at which the move can execute)`
      : Number(share.toFixed(2)) > pathConfig.capPercent
      ? ` (above the provider cap of ${pathConfig.capPercent}%, which acts only when a rebalance executes)`
      : ` (provider cap ${pathConfig.capPercent}%)`;
  const limit = config.circuit_breaker_percent;
  const breaker = scenario.events.find((event) => event.rule === 'circuit_breaker');
  const anomaly = scenario.events.find((event) => event.rule === 'anomaly_gate');
  const excluded = anomaly ? ` Anomaly gate excluded the provider on ${anomaly.date}.` : '';
  // The breaker stops the reading it trips at and no other; whether the vault moved afterwards is read from the run.
  const tripped = planner
    ? "RiskGuard's circuit breaker and anomaly gate are the public vault's and are not on the allocator's path: no rule of the allocator reads a loss."
    : breaker
    ? `Circuit breaker triggered on ${breaker.date} (assets moved ${breaker.change!.toFixed(
        1
      )}% against a ${limit}% threshold): no rebalance was decided at that reading, and the breaker acts at that reading only.`
    : `Circuit breaker not triggered: assets moved ${(loss * 100).toFixed(1)}% against a ${limit}% threshold.`;
  const next = run.days.slice(triggerDay).find((row) => row.rebalances > 0);
  const moved = next
    ? `The vault's first movement after the event is on ${next.date}.`
    : 'The vault makes no movement in the rest of the year.';
  const lost = `${(loss * 100).toFixed(2)}% of the vault's assets at the lowest daily close`;
  switch (scenario.kind) {
    case 'depeg':
      return 'Nothing in the vault reacts: it is denominated in USDC and no rule reads the dollar price. The USDC balance is unaffected; the scenario changes the USD valuation only.';
    case 'curator_bad_debt':
      return (
        `The position was ${share.toFixed(2)}% of the vault${cap}, so the loss is ${lost}. ` +
        `${tripped} There is no exit rule: the position stays until a rebalance by rate moves it. ${moved}` +
        (config.high_water_mark
          ? ' No performance fee is charged until the previous high is regained.'
          : ' The performance fee is charged again from the first positive day: the contract has no high-water mark.') +
        excluded
      );
    case 'protocol_hack': {
      const after = run.days[triggerDay];
      const top = largest(after.positions);
      return (
        `${tripped} ${moved} ` +
        `The position was ${share.toFixed(2)}% of the vault${cap}, so the loss is ${lost}. ` +
        (Math.round(share) >= 100
          ? 'Nothing was held in another provider.'
          : `${
              after.rebalances === 0 ? 'What was left stayed where it was' : 'What was left was rebalanced that day'
            }: ${((after.positions[top] / after.assets) * 100).toFixed(2)}% of it in ${label(
              config.providers[top]
            )} at the close of that day.`) +
        (config.stress.protocol_hack.loss_percent < 100
          ? ' What the venue kept cannot be withdrawn, so no later rebalance that moves it can execute.'
          : '')
      );
    }
    case 'withdrawal_freeze': {
      const frozenDays = run.days.slice(triggerDay, triggerDay + config.stress.withdrawal_freeze.days);
      const payable = (row: DayRow) => (row.liquidity / row.assets) * 100;
      const lowest = frozenDays.reduce((low, row) => (payable(row) < payable(low) ? row : low));
      // A reading at which the plan had a movement out of the frozen venue: the vault's rebalance
      // reverts as a whole, and the next reading plans again. Several readings fall on one day.
      const reverted = scenario.events.filter((event) => event.rule === 'frozen_move');
      const [from, until] = scenario.frozen!;
      const made = run.moves.filter((move) => move.t >= from && move.t < until).length;
      return (
        `No loss. ${payable(frozenDays[0]).toFixed(2)}% of the vault's assets could be withdrawn on the first day ` +
        `and ${payable(lowest).toFixed(2)}% at the lowest, on ${lowest.date}; the frozen position returns after ${
          config.stress.withdrawal_freeze.days
        } days. No rule detects a freeze. ` +
        `Days on which a rebalance with a movement out of the frozen venue would have reverted as a whole: ${
          new Set(reverted.map((event) => event.date)).size
        }, at ${reverted.length} readings. ` +
        (made === 0
          ? 'The vault made no movement while the venue was frozen.'
          : `The vault made ${made} movements while the venue was frozen, none of them out of it.`) +
        excluded
      );
    }
  }
}

function main(): void {
  for (const name of [config.entry_provider, config.aave_provider, ...Object.keys(config.eligible_periods ?? {})]) {
    if (!config.providers.includes(name)) throw new Error(`${name} is not among the simulated providers`);
  }
  for (const [from, to] of Object.values(config.eligible_periods ?? {}).flat()) {
    if (!([from, to].every((date) => /^\d{4}-\d\d-\d\d$/.test(date)) && from < to))
      throw new Error(`eligible_periods: [${from}, ${to}) is not a period of UTC dates`);
  }
  if (config.policy === 'water_filling' && !config.risk_guard_enabled)
    throw new Error('policy water_filling reads its cap through risk_guard_enabled: set it to true');
  mkdirSync(OUT, { recursive: true });
  const samples = loadSamples();
  const strategies: Strategy[] = [
    'thesauros_simple',
    'first_split_held',
    'eligible_equal_weight',
    'just_aave',
    'just_best_vault',
  ];
  const columns = (prefix: string) =>
    config.providers.map((name) => `${prefix}_${label(name).toLowerCase().replace(/ /g, '_')}`);
  const venueColumns = columns('pct');
  const runs = strategies.map((strategy) => simulate(samples, strategy));
  const [thesauros] = runs;
  // Every decision of the Thesauros run, for check-allocator.ts to put to the production planner.
  if (process.env.TANGEM_DECISIONS) writeFileSync(process.env.TANGEM_DECISIONS, thesauros.decisions.join('\n') + '\n');

  writeCsv(
    'tangem-simulation-daily.csv',
    [
      'date',
      'strategy',
      'total_assets',
      'daily_yield',
      'cumulative_yield',
      'apy_trailing_30d',
      'rebalance_count',
      'rebalances_refused',
      'gas_spent_wei',
      'gas_spent_usd',
      'fees_paid',
      'fee_basis',
      'available_liquidity',
      'outside_set_percent',
      ...venueColumns,
      ...columns('interest'),
    ],
    runs.flatMap((run, i) => dailyRows(strategies[i], run))
  );
  writeCsv(
    'tangem-simulation-rebalances.csv',
    [
      'datetime_utc',
      'date',
      'strategy',
      'tx',
      'from',
      'to',
      'amount',
      'source_free_liquidity',
      'gas_used',
      'gas_cost_wei',
      'gas_cost_usd',
      'apr_before_percent',
      'apr_after_percent',
      'expected_gain_pp',
      'realized_change_pp',
      'reason',
    ],
    runs.flatMap((run, i) =>
      run.moves.map((move) => [
        new Date(move.t * 1000).toISOString().replace('.000Z', 'Z'),
        dayOf(move.t),
        strategies[i],
        move.tx,
        label(config.providers[move.from]),
        label(config.providers[move.to]),
        money(move.amount),
        money(move.sourceLiquidity),
        move.gasUsed,
        Math.round(move.gasWei),
        move.gasUsd.toFixed(4),
        percent(move.aprBefore),
        percent(move.aprAfter),
        move.expectedGain === null ? '' : move.expectedGain.toFixed(4),
        ((move.aprAfter - move.aprBefore) * 100).toFixed(4),
        // The decision compares rates as they stand before the move; what the vault earns after it is
        // the column before. A forced exit is no such comparison: the venue was read as paying nothing.
        move.forced
          ? BARRED[move.forced]
          : strategies[i] === 'eligible_equal_weight'
          ? 'equal parts over the venues that take money'
          : move.restore
          ? `back under the provider cap of ${pathConfig.capPercent}% whatever the move earns`
          : move.expectedGain === null
          ? 'moved in the transaction of a forced exit'
          : config.policy === 'water_filling'
          ? `expected gain with the vault's own deposit priced at least ${
              waterFill.intraMinGainBps / 100
            } pp a year at ${waterFill.persistenceRuns} readings in a row`
          : `expected gain on the rates before the move at least ${LIVE.thresholdBps / 100} pp a year`,
      ])
    )
  );

  const kinds: ScenarioKind[] = ['depeg', 'curator_bad_debt', 'protocol_hack', 'withdrawal_freeze'];
  const stressRows: (string | number)[][] = [];
  const timelines: (string | number)[][] = [];
  const triggerDay = thesauros.days.findIndex((row) => row.date >= config.stress.trigger_date);
  const unstressed = thesauros.days[thesauros.days.length - 1].assets;
  stressRows.push([
    'no_stress',
    '',
    config.stress.trigger_date,
    triggerDay + 1,
    money(0),
    percent(0),
    daysToExit(thesauros, triggerDay) ?? 'not within the period',
    money(unstressed),
    money(0),
    '"reference run"',
  ]);
  for (const kind of kinds) {
    const scenario: Scenario = { kind, events: [] };
    const run = simulate(samples, 'thesauros_simple', scenario);
    const value = (row: DayRow) => row.assets * row.price;
    const before = value(run.days[triggerDay - 1]);
    const worst = Math.min(...run.days.slice(triggerDay).map(value));
    const last = run.days[run.days.length - 1];
    const exit = daysToExit(run, triggerDay);
    const response = describeResponse(scenario, run, triggerDay, Math.max(0, before - worst) / before);
    stressRows.push([
      kind,
      kind === 'depeg' ? '' : label(config.providers[scenario.target!]),
      config.stress.trigger_date,
      triggerDay + 1,
      money(Math.max(0, before - worst)),
      percent(Math.max(0, before - worst) / before),
      exit === null ? 'not within the period' : exit,
      money(value(last)),
      money(value(last) - unstressed),
      `"${response}"`,
    ]);
    run.days.forEach((row) =>
      timelines.push([
        kind,
        row.date,
        money(row.assets),
        row.price,
        money(value(row)),
        money(row.liquidity),
        row.rebalances,
        ...row.positions.map((position) => share(position, row.assets)),
      ])
    );
  }
  writeCsv(
    'tangem-stress-tests.csv',
    [
      'scenario',
      'provider_hit',
      'trigger_date',
      'trigger_day',
      'max_loss_usd',
      'max_loss_percent',
      'time_to_exit_days',
      'final_balance_usd',
      'final_balance_vs_no_stress_usd',
      'riskguard_response',
    ],
    stressRows
  );
  writeCsv(
    'tangem-stress-timelines.csv',
    [
      'scenario',
      'date',
      'total_assets_usdc',
      'usdc_price',
      'total_value_usd',
      'available_liquidity',
      'rebalance_count',
      ...venueColumns,
    ],
    timelines
  );

  // TS-397: the files must agree with each other.
  const years = (samples[samples.length - 1].t - samples[0].t) / YEAR;
  runs.forEach((run, i) => {
    const last = run.days[run.days.length - 1];
    const yields = run.days.reduce(
      (sum, row, d) => sum + row.assets - (d ? run.days[d - 1].assets : config.initial_deposit),
      0
    );
    // Written so that a NaN fails it.
    if (!(Math.abs(yields - (last.assets - config.initial_deposit)) <= 0.01))
      throw new Error(`${strategies[i]}: daily yields do not add up`);
    // What the venues paid, less gas and the fee, is the day's change of the balance.
    run.days.forEach((row, d) => {
      const change = row.assets - (d ? run.days[d - 1].assets : config.initial_deposit);
      const paid = row.interest.reduce((sum, earned) => sum + earned, 0) - row.gasUsd - row.fees;
      if (!(Math.abs(paid - change) <= 0.01))
        throw new Error(`${strategies[i]}: interest less gas and fees is not the change of the balance on ${row.date}`);
    });
    if (run.days.some((row) => row.positions.some((position) => !(position >= 0))))
      throw new Error(`${strategies[i]}: a position is negative or not a number`);
    const counted = run.days.reduce((sum, row) => sum + row.rebalances, 0);
    if (counted !== run.moves.length)
      throw new Error(`${strategies[i]}: rebalance rows ${run.moves.length} != daily count ${counted}`);
    // The venue rule: a position leaves only when a move takes it out, so what stayed is counted,
    // not assumed. $2 is above the $1 a sender keeps (SAFETY_BUFFER of buildMoveInstructions).
    const outside = run.days.flatMap((row) =>
      config.providers
        .filter((name, p) => row.positions[p] > 2 && !inSet(name, Date.parse(row.date) / 1000))
        .map((name) => `${row.date} ${label(name)}`)
    );
    console.log(
      `${strategies[i].padEnd(21)} ${run.days[0].date}..${last.date} (${run.days.length} days)  final $${money(
        last.assets
      )}  ` +
        `net APY ${percent((last.assets / config.initial_deposit) ** (1 / years) - 1)}%  rebalances ${
          run.moves.length
        }  refused ${run.days.reduce((s, r) => s + r.refused, 0)}  ` +
        `gas $${money(run.days.reduce((s, r) => s + r.gasUsd, 0))}  fees $${money(
          run.days.reduce((s, r) => s + r.fees, 0)
        )}` +
        (config.eligible_periods
          ? `  outside the set ${outside.length} venue-days${outside.length ? ', first ' + outside[0] : ''}`
          : '') +
        (run.bestVault ? `  (${run.bestVault})` : '')
    );
  });
  if (thesauros.days[0].date !== config.start_date) throw new Error(`the series starts on ${thesauros.days[0].date}`);
  stressRows.forEach((row) => console.log(row.join(' | ')));
  console.log(
    'Checks passed: daily yields add up to the final balance, interest less gas and fees is the change of the ' +
      'balance on every day, no position is negative or not a number, rebalance rows match the daily counts'
  );
}

main();
