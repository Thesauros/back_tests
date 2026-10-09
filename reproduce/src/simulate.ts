/**
 * Tangem simulation: one deposit held for a year in a Thesauros vault, in the same venues
 * without rebalancing and in two passive baselines, on the history collect-history.ts
 * gathered, then four stress scenarios (TS-392 to TS-397).
 *
 * The Thesauros path calls the live decision function of the public vault (decideNew of the
 * replay harness: anomaly gate, cooldown, smoothed signal, 60% cap, gain threshold) at every
 * sample. Interest is the venue's realized index growth, scaled by the measured ratio of the
 * rate after our deposit to the rate before it; an index that falls is a loss and is taken
 * in full.
 *
 * Run:
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/simulate.ts scripts/tangem/config.base.json
 *
 * Writes data/tangem/<network>/simulation/*.csv and checks them against the TS-397 criteria.
 */
import '../../apps/rebalancer/fork/replay/env';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RateHistory } from '@backend-ts/library';
import { LIVE, PathConfig, decideNew } from '../../apps/rebalancer/fork/replay/policies';

interface StressConfig {
  /** First day of every scenario. */
  trigger_date: string;
  depeg: { price: number; days: number };
  /** `provider`: a name, or "largest_morpho" / "largest" for the biggest position on the trigger day. */
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
  /** false is the v1 assumption of TS-392: the deposit does not move rates. */
  rate_impact_enabled: boolean;
  performance_fee_percent: number;
  /** Percent of assets a year. */
  management_fee_percent: number;
  /** false charges every positive day, as the deployed contract does; true charges above the previous peak only. */
  high_water_mark: boolean;
  /** Where a deposit lands before the first rebalance. */
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
/** Gas of a one-leg rebalance, see rebalance-gas.csv. */
const REBALANCE_GAS_PER_LEG = 982930;

// ---------------------------------------------------------------------------------------------
// History

interface Venue {
  /** getDepositRate with nothing of ours in the venue, a fraction per year. */
  rate: number;
  /** [our position in USDC, rate at it], ascending, starting at [0, rate]. */
  curve: [number, number][];
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
          const rate = number(`${name}.rate`) / RAY;
          const curve: [number, number][] = [[0, rate]];
          for (const millions of [4, 6, 10]) {
            const after = values[`${name}.rateAfter${millions}`];
            if (after != null) curve.push([millions * 1e6, Number(after) / RAY]);
          }
          return {
            rate,
            curve,
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

// ---------------------------------------------------------------------------------------------
// Scenarios

type ScenarioKind = 'depeg' | 'curator_bad_debt' | 'protocol_hack' | 'withdrawal_freeze';
interface Scenario {
  kind: ScenarioKind;
  /** Provider index, resolved on the trigger day. */
  target?: number;
  /** What RiskGuard and the vault did about it, as the run met it. */
  events: { rule: 'circuit_breaker' | 'anomaly_gate' | 'frozen_move'; date: string; change?: number }[];
}

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const label = (provider: string) => config.labels[provider] ?? provider;
const trigger = Date.parse(config.stress.trigger_date) / 1000;

function largest(positions: number[], only?: (name: string) => boolean): number {
  let best = -1;
  positions.forEach((position, i) => {
    if (only && !only(config.providers[i])) return;
    if (best < 0 || position > positions[best]) best = i;
  });
  return best;
}

function resolveTarget(provider: string, positions: number[]): number {
  if (provider === 'largest') return largest(positions);
  if (provider === 'largest_morpho') return largest(positions, (name) => name.includes('Morpho'));
  const index = config.providers.indexOf(provider);
  if (index < 0) throw new Error(`Stress provider ${provider} is not among the simulated providers`);
  return index;
}

// ---------------------------------------------------------------------------------------------
// One run

/**
 * `first_split_held` is the control for what rebalancing adds: the Thesauros run up to its
 * first rebalance, then nothing moves, and no Thesauros fee is taken.
 */
type Strategy = 'thesauros_simple' | 'first_split_held' | 'just_aave' | 'just_best_vault';
interface DayRow {
  date: string;
  /** USDC, after gas and fees. */
  assets: number;
  /** USD a USDC is worth: 1 outside the depeg scenario. */
  price: number;
  rebalances: number;
  gasWei: number;
  gasUsd: number;
  fees: number;
  liquidity: number;
  positions: number[];
  /** What each venue could pay out, for the time-to-exit walk. */
  venueLiquidity: number[];
}
interface Move {
  t: number;
  tx: number;
  from: number;
  to: number;
  amount: number;
  gasUsed: number;
  gasWei: number;
  gasUsd: number;
  aprBefore: number;
  aprAfter: number;
  /** What the decision expected to gain, on the rates before the move, percentage points a year. */
  expectedGain: number;
}
interface Run {
  days: DayRow[];
  moves: Move[];
  bestVault?: string;
}

const pathConfig: PathConfig = config.risk_guard_enabled
  ? {
      ...LIVE,
      capPercent: config.provider_cap_percent ?? LIVE.capPercent,
      minActive: config.min_active_providers ?? LIVE.minActive,
    }
  : { ...LIVE, capPercent: 100, minActive: 1, maxDeviationPercent: Infinity, cooldownSeconds: 0 };

function simulate(samples: Sample[], strategy: Strategy, scenario?: Scenario): Run {
  const n = config.providers.length;
  const positions: number[] = new Array(n).fill(0);
  let bestVault: string | undefined;
  if (strategy === 'thesauros_simple' || strategy === 'first_split_held') {
    positions[config.providers.indexOf(config.entry_provider)] = config.initial_deposit;
  } else if (strategy === 'just_aave') {
    positions[config.providers.indexOf(config.aave_provider)] = config.initial_deposit;
  } else {
    // The provider with the highest displayed rate on the first day, all in, never moved.
    const best = samples[0].venues.reduce((top, venue, i, all) => (venue.rate > all[top].rate ? i : top), 0);
    positions[best] = config.initial_deposit;
    bestVault = label(config.providers[best]);
  }

  const total = () => positions.reduce((sum, position) => sum + position, 0);
  const apr = (sample: Sample) => {
    const sum = total();
    return sum === 0 ? 0 : positions.reduce((acc, p, i) => acc + p * rateAt(sample.venues[i], p), 0) / sum;
  };
  /** Observed rates of earlier samples, newest last: what the rate history and the anomaly gate read. */
  const seen: { t: number; rates: bigint[] }[] = [];
  const days: DayRow[] = [];
  const moves: Move[] = [];
  let lastMoveAt: number | null = null;
  let previousTotal = total();
  let peak = total();
  let dayStart = total();
  let day = { rebalances: 0, gasWei: 0, gasUsd: 0 };
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
      }
    }
    const frozen = scenario?.kind === 'withdrawal_freeze' && fired && sample.t < frozenUntil ? scenario.target! : -1;
    // A venue too small for a full position is read as paying nothing: no money enters it and
    // what it holds leaves. The rate history keeps the true rate.
    const fullPosition = (total() * pathConfig.capPercent) / 100;
    const tooSmall = (venue: Venue) =>
      config.max_share_of_venue_percent !== undefined &&
      fullPosition > ((venue.supplied + fullPosition) * config.max_share_of_venue_percent) / 100;

    const spots = sample.venues.map((venue, i) =>
      i === dead ? 0n : BigInt(Math.round(rateAt(venue, positions[i]) * RAY))
    );
    if (strategy === 'thesauros_simple' || (strategy === 'first_split_held' && lastMoveAt === null)) {
      // RiskGuard.checkCircuitBreaker: the vault's assets against the previous reading.
      const change = previousTotal === 0 ? 0 : (Math.abs(total() - previousTotal) / previousTotal) * 100;
      const tripped = config.risk_guard_enabled && change > config.circuit_breaker_percent;
      if (tripped) {
        scenario?.events.push({ rule: 'circuit_breaker', date: dayOf(sample.t), change });
      } else {
        // The live sampler reads twelve hourly points. The readings here are four hours apart, so
        // the hours between them are filled in on a straight line: three raw points would give a
        // fresh spike 44% of the average instead of the 13% it has in production. With no reading
        // twelve hours old the history is unavailable, the signal is zero and nothing enters.
        const histories: RateHistory[] = spots.map((_, i) =>
          seen.length === 0 || seen[0].t > sample.t - 12 * 3600 + 600
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
        const decision = decideNew(
          {
            t: sample.t,
            spots: spots.map((spot, i) => (tooSmall(sample.venues[i]) ? 0n : spot)),
            balances: positions.map((position) => BigInt(Math.floor(position * USDC))),
            recorded: seen,
            lastMoveAt,
            histories,
          },
          pathConfig
        );
        // A flag in the week after the event is a response to it; a later one is the market.
        if (scenario?.target !== undefined && sample.t < trigger + 7 * DAY && decision.anomalous[scenario.target]) {
          scenario.events.push({ rule: 'anomaly_gate', date: dayOf(sample.t) });
        }
        const legs = decision.legs.filter((leg) => {
          if (leg.from !== frozen) return true;
          scenario!.events.push({ rule: 'frozen_move', date: dayOf(sample.t) });
          return false;
        });
        if (decision.stop === null && legs.length > 0) {
          const aprBefore = apr(sample);
          const gasWei = config.gas_modeling_enabled ? sample.legGas[0] * legs.length + sample.l1Fee[0] : 0;
          const gasUsd = config.gas_modeling_enabled ? sample.legGas[1] * legs.length + sample.l1Fee[1] : 0;
          for (const leg of legs) {
            const amount = Number(leg.amount) / USDC;
            positions[leg.from] -= amount;
            positions[leg.to] += amount;
          }
          // Gas leaves the vault in proportion; in production the operator pays it, so this is conservative.
          const kept = 1 - gasUsd / total();
          positions.forEach((_, i) => (positions[i] *= kept));
          const aprAfter = apr(sample);
          tx++;
          for (const leg of legs) {
            moves.push({
              t: sample.t,
              tx,
              from: leg.from,
              to: leg.to,
              amount: Number(leg.amount) / USDC,
              gasUsed: REBALANCE_GAS_PER_LEG,
              gasWei: gasWei / legs.length,
              gasUsd: gasUsd / legs.length,
              aprBefore,
              aprAfter,
              expectedGain: decision.deltaPercent!,
            });
          }
          day.rebalances += legs.length;
          day.gasWei += gasWei;
          day.gasUsd += gasUsd;
          lastMoveAt = sample.t;
        }
      }
    }
    previousTotal = total();
    const payable = (reading: Sample) =>
      positions.reduce(
        (sum, position, i) => sum + (i === frozen ? 0 : Math.min(position, reading.venues[i].liquidity)),
        0
      ) / total();
    lowestPayable = Math.min(lowestPayable, payable(sample));
    seen.push({ t: sample.t, rates: spots });
    while (seen[0].t < sample.t - 2 * DAY) seen.shift();

    // Interest to the next sample.
    const next = samples[k + 1];
    positions.forEach((position, i) => {
      if (position === 0 || i === dead) return;
      const venue = sample.venues[i];
      const growth = next.venues[i].index / venue.index - 1;
      const diluted = growth > 0 && venue.rate > 0 ? growth * (rateAt(venue, position) / venue.rate) : growth;
      positions[i] = position * (1 + diluted);
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
      positions.forEach((_, i) => (positions[i] *= 1 - fees / gross));
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
    day = { rebalances: 0, gasWei: 0, gasUsd: 0 };
    lowestPayable = 1;
  }
  return { days, moves, bestVault };
}

// ---------------------------------------------------------------------------------------------
// Output

const money = (value: number) => value.toFixed(2);
const percent = (fraction: number) => (fraction * 100).toFixed(4);

function writeCsv(file: string, header: string[], rows: (string | number)[][]): void {
  writeFileSync(join(OUT, file), [header, ...rows].map((row) => row.join(',')).join('\n') + '\n');
  console.log(`${file}: ${rows.length} rows`);
}

function dailyRows(strategy: string, run: Run): (string | number)[][] {
  return run.days.map((row, d) => {
    const before = d === 0 ? config.initial_deposit : run.days[d - 1].assets;
    const monthAgo = d >= 30 ? run.days[d - 30].assets : null;
    return [
      row.date,
      strategy,
      money(row.assets),
      money(row.assets - before),
      money(row.assets - config.initial_deposit),
      monthAgo === null ? '' : percent((row.assets / monthAgo) ** (365 / 30) - 1),
      row.rebalances,
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
      ...row.positions.map((position) => ((position / row.assets) * 100).toFixed(2)),
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

/** What protected the deposit in a scenario, in the terms of the rules that did or did not act. */
function describeResponse(scenario: Scenario, run: Run, triggerDay: number, loss: number): string {
  const dayBefore = run.days[triggerDay - 1];
  const share = scenario.target === undefined ? 0 : (dayBefore.positions[scenario.target] / dayBefore.assets) * 100;
  const cap = pathConfig.capPercent < 100 ? ` (provider cap ${pathConfig.capPercent}%)` : '';
  const limit = config.circuit_breaker_percent;
  const breaker = scenario.events.find((event) => event.rule === 'circuit_breaker');
  const anomaly = scenario.events.find((event) => event.rule === 'anomaly_gate');
  const excluded = anomaly ? ` Anomaly gate excluded the provider on ${anomaly.date}.` : '';
  switch (scenario.kind) {
    case 'depeg':
      return 'Nothing in the vault reacts: it is denominated in USDC and no rule reads the dollar price. The USDC balance is unaffected; the scenario changes the USD valuation only.';
    case 'curator_bad_debt':
      return (
        `The position was ${share.toFixed(0)}% of the vault${cap}, so the loss stopped at ${(loss * 100).toFixed(
          2
        )}% of the vault's assets. ` +
        `Circuit breaker not triggered: assets moved ${(loss * 100).toFixed(
          1
        )}% against a ${limit}% threshold. There is no exit rule: the rebalancer keeps the position.` +
        (config.high_water_mark
          ? ' No performance fee is charged until the previous high is regained.'
          : ' The performance fee is charged again from the first positive day: the contract has no high-water mark.') +
        excluded
      );
    case 'protocol_hack':
      return (
        (breaker
          ? `Circuit breaker triggered on ${breaker.date} (assets moved ${breaker.change!.toFixed(
              1
            )}% against a ${limit}% threshold) and halted rebalancing for that run. `
          : '') +
        `The position was ${share.toFixed(0)}% of the vault${cap}, so the loss stopped at ${(loss * 100).toFixed(
          1
        )}% of the vault's assets. ` +
        'The remaining funds stayed allocated across the other providers.'
      );
    case 'withdrawal_freeze': {
      const first = run.days[triggerDay];
      const blocked = new Set(
        scenario.events.filter((event) => event.rule === 'frozen_move').map((event) => event.date)
      ).size;
      return (
        `No loss. ${((first.liquidity / first.assets) * 100).toFixed(
          0
        )}% of the vault's assets stayed withdrawable from the first day ` +
        `and all of it after ${config.stress.withdrawal_freeze.days} days. No rule detects a freeze. ` +
        `Rebalances out of the frozen provider that would have reverted: ${blocked}.` +
        excluded
      );
    }
  }
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const samples = loadSamples();
  const strategies: Strategy[] = ['thesauros_simple', 'first_split_held', 'just_aave', 'just_best_vault'];
  const venueColumns = config.providers.map((name) => `pct_${label(name).toLowerCase().replace(/ /g, '_')}`);
  const runs = strategies.map((strategy) => simulate(samples, strategy));
  const [thesauros] = runs;

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
      'gas_spent_wei',
      'gas_spent_usd',
      'fees_paid',
      'fee_basis',
      'available_liquidity',
      ...venueColumns,
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
      'gas_used',
      'gas_cost_wei',
      'gas_cost_usd',
      'apr_before_percent',
      'apr_after_percent',
      'expected_gain_pp',
      'realized_change_pp',
      'reason',
    ],
    thesauros.moves.map((move) => [
      new Date(move.t * 1000).toISOString().replace('.000Z', 'Z'),
      dayOf(move.t),
      'thesauros_simple',
      move.tx,
      label(config.providers[move.from]),
      label(config.providers[move.to]),
      money(move.amount),
      move.gasUsed,
      Math.round(move.gasWei),
      move.gasUsd.toFixed(4),
      percent(move.aprBefore),
      percent(move.aprAfter),
      move.expectedGain.toFixed(4),
      ((move.aprAfter - move.aprBefore) * 100).toFixed(4),
      // The decision compares rates as they stand before the move; what the vault earns after it is the next column.
      `expected gain on the rates before the move at least ${LIVE.thresholdBps / 100} pp a year`,
    ])
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
        ...row.positions.map((position) => ((position / row.assets) * 100).toFixed(2)),
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
  runs.forEach((run, i) => {
    const last = run.days[run.days.length - 1];
    const yields = run.days.reduce(
      (sum, row, d) => sum + row.assets - (d ? run.days[d - 1].assets : config.initial_deposit),
      0
    );
    if (Math.abs(yields - (last.assets - config.initial_deposit)) > 0.01)
      throw new Error(`${strategies[i]}: daily yields do not add up`);
    const years = (run.days.length * DAY) / YEAR;
    console.log(
      `${strategies[i].padEnd(17)} ${run.days[0].date}..${last.date} (${run.days.length} days)  final $${money(
        last.assets
      )}  ` +
        `net APY ${percent((last.assets / config.initial_deposit) ** (1 / years) - 1)}%  rebalances ${
          run.moves.length
        }  ` +
        `gas $${money(run.days.reduce((s, r) => s + r.gasUsd, 0))}  fees $${money(
          run.days.reduce((s, r) => s + r.fees, 0)
        )}` +
        (run.bestVault ? `  (${run.bestVault})` : '')
    );
  });
  const counted = thesauros.days.reduce((sum, row) => sum + row.rebalances, 0);
  if (counted !== thesauros.moves.length)
    throw new Error(`rebalance rows ${thesauros.moves.length} != daily count ${counted}`);
  if (thesauros.days[0].date !== config.start_date) throw new Error(`the series starts on ${thesauros.days[0].date}`);
  stressRows.forEach((row) => console.log(row.join(' | ')));
  console.log('Checks passed: daily yields add up to the final balance, rebalance rows match the daily counts');
}

main();
