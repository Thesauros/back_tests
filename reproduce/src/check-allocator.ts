/**
 * Two checks of the water-filling policy of simulate.ts. It needs the rebalancer's sources and
 * runs in the Thesauros repository only, not from the pack.
 *
 * 1. The decisions of a run against production. simulate.ts, run with TANGEM_DECISIONS=<file>,
 *    writes the input and the result of each decideWaterFill call of its Thesauros run without
 *    stress; the decisions of the four stress scenarios are not written. Each input is put here
 *    to PlannerService.intraChainRebalance, the production code, called as it is and offline,
 *    with its own state carried from reading to reading, and the two results are compared:
 *    whether a move is made, its legs to the unit, the plan's fingerprint and its count.
 *    Production is given the run's limit per venue (none for the entry provider) and the run's
 *    share of a venue; the rest must be the planner's defaults, and the script stops if the run
 *    used others. What this proves is that the port decides as production does on the inputs
 *    simulate.ts built. How simulate.ts builds them (signal, exponent, market size) it does not
 *    prove.
 * 2. The liquidity rule on constructed inputs. simulate.ts gives a venue short of free liquidity
 *    a zero signal and drops any leg of the plan that would still enter it. Five cases show
 *    what the zero signal does in the allocator: a venue with one takes nothing whatever it
 *    pays, keeps what it holds while its rate is the best, and is left when its rate is the
 *    worst; a venue read as paying nothing is emptied. Then random inputs, with the venue never
 *    the entry provider and every market at least $1M beyond the vault's position in it: no leg
 *    enters such a venue. Outside those bounds a leg can (an entry provider in a market too
 *    small to hold the rest, or the entry provider itself short of liquidity), which is why
 *    simulate.ts also drops the leg.
 *
 * Run:
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/check-allocator.ts [decisions.jsonl]...
 */
import '../../apps/rebalancer/fork/replay/env';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { NetworkEnum } from '@backend-ts/enums';
import { getCrossChainConfig } from '../../apps/rebalancer/src/crosschain/crosschain.config';
import { PlannerService } from '../../apps/rebalancer/src/crosschain/planner.service';
import { ChainState, IntraChainDecision } from '../../apps/rebalancer/src/crosschain/crosschain.types';
import { Leg, WaterFillConfig, WaterFillInput, XC, decideWaterFill } from '../../apps/rebalancer/fork/replay/policies';

const planner = new PlannerService();
const defaults = getCrossChainConfig();
const USDC = 1_000_000n;
const RAY = 10n ** 27n;
const address = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;
const indexOf = (text: string) => parseInt(text.slice(2), 16) - 1;

interface Outcome {
  moves: boolean;
  legs: Leg[];
  fingerprint: string | null;
  count: number | null;
}

/** Production, as it is. A provider's kind is only the key of its exponent in the config. */
function production(
  input: WaterFillInput,
  config: WaterFillConfig,
  previous: IntraChainDecision | null,
  at: number
): { outcome: Outcome; decision: IntraChainDecision | null } {
  const total = input.balances.reduce((sum, balance) => sum + balance, 0n);
  const chain: ChainState = {
    network: NetworkEnum.Base,
    role: 'hub',
    idle: 0n,
    strategyShares: total,
    strategyValue: total,
    strategyHealthy: true,
    strategyTotalAssets: total,
    minAssets: 0n,
    entryProvider: address(input.entry),
    entryCapBps: 0,
    providers: input.spots.map((spot, i) => ({
      address: address(i),
      name: `p${i}`,
      kind: `k${i}` as never,
      balance: input.balances[i],
      strategyBalance: input.balances[i],
      rateRay: spot,
      intraChainSignalRay: input.signals[i],
      crossChainSignalRay: input.signals[i],
      capBps: i === input.entry ? 0 : config.capBps,
      healthy: true,
      marketLiquidity: 10n ** 18n,
      marketSize: input.marketSizes[i],
    })),
    pausedAllocate: false,
    pausedBridgeOut: false,
  };
  const { step, decision } = planner.intraChainRebalance(
    chain,
    0n,
    {
      ...defaults,
      maxShareOfMarketBps: config.maxShareOfMarketBps,
      impactAlpha: Object.fromEntries(input.alphas.map((alpha, i) => [`k${i}`, alpha])) as never,
    },
    previous,
    at
  );
  const side = (part: string) => part.split(',').filter(Boolean).map(indexOf).join(',');
  return {
    outcome: {
      moves: step !== null,
      legs: step?.rebalance
        ? step.rebalance.amounts.map((amount, j) => ({
            from: indexOf(step.rebalance!.sources[j]),
            to: indexOf(step.rebalance!.destinations[j]),
            amount,
          }))
        : [],
      fingerprint: decision
        ? decision.fingerprint.replace(/^in:(.*)\|out:(.*)$/, (_all, a, b) => `in:${side(a)}|out:${side(b)}`)
        : null,
      count: decision?.count ?? null,
    },
    decision,
  };
}

const sameLegs = (a: Leg[], b: Leg[]) =>
  a.length === b.length &&
  a.every((leg, i) => leg.from === b[i].from && leg.to === b[i].to && leg.amount === b[i].amount);

// ---------------------------------------------------------------------------------------------
// 1. The decisions of a run

/** Beside its limit per venue and its share of a venue, a run must have used the planner's defaults. */
function checkDefaults(config: WaterFillConfig): void {
  const same =
    defaults.mode !== 'stand' &&
    config.capBps === XC.capBps &&
    config.maxShareOfMarketBps === defaults.maxShareOfMarketBps &&
    config.intraMinGainBps === defaults.intraMinGainBps &&
    config.horizonDays === defaults.horizonDays &&
    config.hysteresisK === defaults.hysteresisK &&
    Number(config.gasCost) === defaults.gasCostUsd * 1e6 &&
    Number(config.minMove) === defaults.minMoveUsd * 1e6 &&
    config.persistenceRuns === defaults.persistenceRuns &&
    defaults.persistenceMinSeconds < 4 * 3600;
  if (!same) throw new Error(`the run's settings are not the planner's defaults: ${JSON.stringify(config)}`);
}

const revive = (_key: string, value: unknown) =>
  typeof value === 'string' && /^-?\d+$/.test(value) ? BigInt(value) : value;
let failed = false;
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let previous: IntraChainDecision | null = null;
  let different = 0;
  let moved = 0;
  let restored = 0;
  lines.forEach((line, k) => {
    const { t, input, config, decision } = JSON.parse(line, revive) as {
      t: bigint;
      input: WaterFillInput;
      config: WaterFillConfig;
      decision: ReturnType<typeof decideWaterFill>;
    };
    if (k === 0) checkDefaults(config);
    const { outcome, decision: next } = production(input, config, previous, Number(t));
    previous = next;
    const same =
      outcome.moves === (decision.stop === null) &&
      sameLegs(outcome.legs, decision.legs) &&
      outcome.fingerprint === (decision.previous?.fingerprint ?? null) &&
      outcome.count === (decision.previous?.count ?? null);
    if (decision.stop === null) moved++;
    if (decision.restore) restored++;
    if (!same && ++different <= 3)
      console.log(
        `  differs at ${t}: production ${JSON.stringify(outcome, (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v
        )}, simulate ${line.slice(0, 600)}`
      );
  });
  console.log(
    `${basename(file, '.jsonl')}: ${
      lines.length
    } decisions, ${moved} of them a move (${restored} back under the cap), ${different} differ from production`
  );
  failed ||= different > 0;
}

// ---------------------------------------------------------------------------------------------
// 2. The liquidity rule

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`liquidity rule: ${message}`);
}
/** The decision at the second run in a row, when a plan that repeats moves. */
function twice(input: WaterFillInput): ReturnType<typeof decideWaterFill> {
  const first = decideWaterFill(input);
  return first.stop === null ? first : decideWaterFill({ ...input, previous: first.previous });
}
const ray = (percent: number) => (BigInt(Math.round(percent * 1e6)) * RAY) / 100_000_000n;
const usd = (millions: number) => BigInt(Math.round(millions * 1e6)) * USDC;
/** Three venues of $500M: the entry at 3.5%, a venue at 4% and the venue under test. */
const constructed = (spot: number, signal: number, held: number): WaterFillInput => ({
  spots: [ray(3.5), ray(4), ray(spot)],
  signals: [ray(3.5), ray(4), ray(signal)],
  balances: [usd(10 - held - 2), usd(2), usd(held)],
  alphas: [2, 1.75, 1.75],
  marketSizes: [usd(500), usd(500), usd(500)],
  entry: 0,
  previous: null,
});
const into = (legs: Leg[], i: number) => legs.filter((leg) => leg.to === i).reduce((sum, leg) => sum + leg.amount, 0n);
const outOf = (legs: Leg[], i: number) =>
  legs.filter((leg) => leg.from === i).reduce((sum, leg) => sum + leg.amount, 0n);

// Shut and the best rate of the three: nothing enters it and nothing leaves it.
const best = twice(constructed(9, 0, 3));
assert(
  into(best.legs, 2) === 0n && outOf(best.legs, 2) === 0n,
  'a shut venue with the best rate did not keep its position'
);
// The same venue open: money enters it, so it was the zero signal that kept it out.
assert(into(twice(constructed(9, 9, 3)).legs, 2) > 0n, 'the open venue with the best rate took no money');
// Shut and the worst rate: it may be left, a decision by rate, and still nothing enters it.
const worst = twice(constructed(1, 0, 3));
assert(into(worst.legs, 2) === 0n && outOf(worst.legs, 2) > 0n, 'a shut venue with the worst rate was not left');
// Shut and holding nothing: nothing enters it whatever it pays.
assert(into(twice(constructed(50, 0, 0)).legs, 2) === 0n, 'a shut venue that holds nothing took money');
// Read as paying nothing (outside the set, too small, no reading): what it holds leaves.
const barred = twice(constructed(0, 0, 3));
assert(
  outOf(barred.legs, 2) > usd(2.99) && into(barred.legs, 2) === 0n,
  'a venue read as paying nothing kept its position'
);

// Random inputs: a venue with a zero signal that is not the entry never receives.
let seed = 20261010;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let tried = 0;
let movedWithShut = 0;
for (let k = 0; k < 20_000; k++) {
  const n = 2 + Math.floor(random() * 9);
  const entry = Math.floor(random() * n);
  const balances = Array.from({ length: n }, () => (random() < 0.3 ? 0n : usd(Math.floor(random() * 600) / 100)));
  const spots = Array.from({ length: n }, () => (random() < 0.05 ? 0n : ray(Math.floor(random() * 1500) / 100)));
  const shut = spots.map((_, i) => i !== entry && random() < 0.3);
  const input: WaterFillInput = {
    spots,
    signals: spots.map((spot, i) =>
      shut[i] ? 0n : random() < 0.5 ? spot : (spot * BigInt(Math.floor(random() * 1000))) / 1000n
    ),
    balances,
    alphas: Array.from({ length: n }, () => [0, 1, 1.75, 2, random() * 5][Math.floor(random() * 5)]),
    marketSizes: balances.map((balance) => balance + usd(1 + Math.floor(random() * 2000))),
    entry,
    previous: null,
  };
  if (!shut.some(Boolean) || balances.every((balance) => balance === 0n)) continue;
  tried++;
  const { legs } = twice(input);
  if (legs.length > 0) movedWithShut++;
  shut.forEach((isShut, i) =>
    assert(
      !isShut || into(legs, i) === 0n,
      `a leg entered a venue with a zero signal: ${JSON.stringify(input, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      )}`
    )
  );
}
console.log(
  `liquidity rule: five constructed cases hold; on ${tried} random inputs with a venue of zero signal (${movedWithShut} of them a move) no leg entered one`
);
if (failed) process.exit(1);
