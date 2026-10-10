/**
 * The tables of the pack's readme, as markdown, from the run folders and the data files alone.
 * Nothing is simulated here: it is arithmetic on the CSVs simulate.ts wrote, on raw.jsonl and on
 * the venue rule's monthly table. In the pack this file runs as reproduce/figures.js, so the text
 * it prints names the files as the pack has them.
 *
 * Reads, for each config given: the config; tangem-simulation-daily.csv,
 * tangem-simulation-rebalances.csv and tangem-stress-tests.csv of data/tangem/<network>/<output>/;
 * data/tangem/<network>/raw.jsonl and data/tangem/<network>/venue-eligibility.csv. Paths are taken
 * from the working directory, as simulate.ts takes them.
 *
 * Run:
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/pack-figures.ts \
 *     [out=<file>] scripts/tangem/config.base.deployed.json scripts/tangem/config.base.wide.json ... \
 *     [check=<config>]
 *
 * Prints the tables, one column per run in the order given, and writes them to
 * data/tangem/figures.md, or to the file `out=` names. `check=` names a run made at another fee:
 * it is no column, and the fee table sets it against the column whose config it repeats. Each
 * definition is printed under its table. The script stops when a cell cannot be filled, when
 * two files it reads do not agree, or when a file holds what a definition says it cannot: a
 * `reason` simulate.ts does not write, a transaction of two decisions.
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
// By path and not as @backend-ts/networks: client-pack.ts bundles this file without the path map.
import { deployments, NetworkDeployment, ProviderKindEnum, VaultDeployment } from '../../libs/networks/src';

interface Config {
  network: string;
  token: string;
  initial_deposit: number;
  start_date: string;
  end_date: string;
  rate_impact_enabled: boolean;
  performance_fee_percent: number;
  entry_provider: string;
  providers: string[];
  max_share_of_venue_percent?: number;
  eligible_periods?: Record<string, [string, string][]>;
  /** As simulate.ts reads them: absent is the public vault's rules, production's constants, no liquidity rule. */
  policy?: 'public_vault' | 'water_filling';
  impact_exponent?: 'production' | 'measured';
  liquidity_rule?: boolean;
  /** RiskGuard's cap on a venue is `provider_cap_percent`, the live 60 when absent, and no cap with RiskGuard off. */
  risk_guard_enabled: boolean;
  provider_cap_percent?: number;
  output?: string;
  labels: Record<string, string>;
  /** `provider`: a venue, or "largest", or "largest_morpho" for the largest in a curated Morpho vault. */
  stress: {
    depeg: { price: number; days: number };
    curator_bad_debt: { provider: string; loss_percent: number };
    protocol_hack: { provider: string; loss_percent: number };
    withdrawal_freeze: { provider: string; days: number };
  };
}
type Row = Record<string, string>;
interface Reading {
  t: number;
  values: Record<string, string | null>;
}
interface Network {
  name: string;
  readings: Reading[];
  byDay: Map<string, Reading[]>;
  /** venue-eligibility.csv: one row per candidate and month. */
  rule: Row[];
  months: string[];
  /** Public names of the venues of the runs given. */
  labels: Record<string, string>;
}
interface Run {
  name: string;
  path: string;
  config: Config;
  network: Network;
  /** Strategy -> its days. */
  daily: Record<string, Row[]>;
  /** The movements of thesauros_simple. */
  moves: Row[];
  /** Strategy -> its movements: a strategy that never moves has none. */
  movesOf: Record<string, Row[]>;
  stress: Row[];
}
interface Tx {
  t: number;
  /** The vault's rate with our positions in place was lower after the rebalance than before it. */
  lower: boolean;
  /** `expected_gain_pp`: null for a rebalance no decision priced. */
  expected: number | null;
  /** The allocator's move back under the provider cap: it has an `expected_gain_pp` and no gain decided it. */
  restore: boolean;
  /** The transaction of a forced exit: no movement of it has an `expected_gain_pp`. */
  forced: boolean;
  /** `realized_change_pp`. */
  realized: number;
  legs: { from: string; to: string; amount: number }[];
}

const DAY = 86400;
const YEAR = 365 * DAY;
const STRATEGIES = ['thesauros_simple', 'first_split_held', 'eligible_equal_weight', 'just_aave', 'just_best_vault'];
/** Morpho Blue, the same address on Ethereum and Base. */
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
/**
 * A rebalance evens out positions by a few dollars next to its main movements. Such a remainder
 * running the other way is not money sent back, so a reversal is looked for among the movements
 * of at least this much, USD.
 */
const DUST = 10_000;
/** The whole balance counts as withdrawable from this share of it. */
const WHOLE = 0.9999;
/** A movement under this much is a remainder sent next to the main movements, USD. */
const REMAINDER = 1_000;
/**
 * The gain a decision has to expect, percentage points a year, by the `policy` of the config:
 * simulate.ts writes it into `reason`.
 */
const THRESHOLD_PP = { public_vault: 0.25, water_filling: 0.05 };
/**
 * The allocator's settings the definitions name, as simulate.ts takes them from the planner's
 * defaults: a plan is made when it fills and drains the same venues at this many readings in a
 * row, moves at least `move` in all and has no movement under `leg`, USD. The first is in every
 * `reason` of a plan a gain decided, and the other two are checked on every such plan.
 */
const ALLOCATOR = { readings: 2, move: 1_000, leg: 10 };
/** RiskGuard's cap on a venue where the config names none, percent of the vault: the live value. */
const LIVE_CAP = 60;
/**
 * The impact exponent production has for a venue, by `kind` of venue-eligibility.csv: one for
 * Aave V3, Compound V3 and Morpho (getImpactAlpha of crosschain.config.ts). simulate.ts gives a
 * venue of another kind ASSUMED_EXPONENT.
 */
const PRODUCTION_EXPONENT: Record<string, number> = {
  aave: 2,
  compound: 2,
  morpho: 1.75,
  'morpho-v2': 1.75,
  'morpho-market': 1.75,
};
const ASSUMED_EXPONENT = 1.75;
/** What simulate.ts writes into `reason` of a movement out of a venue the decision read as paying nothing. */
const FORCED = [
  'forced exit: the venue has no reading',
  'forced exit: the venue is not in the set',
  'forced exit: the venue is too small for a full position',
];
/** The stress scenarios that hit a venue. */
const HIT = ['curator_bad_debt', 'protocol_hack', 'withdrawal_freeze'] as const;
const WITH_FORCED = 'moved in the transaction of a forced exit';
const EQUAL_PARTS = 'equal parts over the venues that take money';
/** The fees the fee table is worked out at, percent, next to the fee each run was made at. */
const FEES = [0, 10, 15];
/** A venue is counted as held from this share of the vault at the day's close, percent. */
const HELD_FROM = 1;
/**
 * The run folders of the pack by the end of a config's name, as client-pack.ts is given them. A
 * config with another ending has no folder there: simulate.js writes its files and the pack has no copy.
 */
const PACK_FOLDER: Record<string, string> = {
  'alloc-a': 'allocator-set-a',
  'alloc-a.measured': 'allocator-set-a-measured',
  'alloc-strict': 'allocator-strict-set',
  'alloc-b': 'allocator-set-b',
  'alloc-b.measured': 'allocator-set-b-measured',
  'public-a': 'public-rules-set-a',
  deployed: 'vault-as-deployed',
};
/** The columns of venue-eligibility.csv a run's venues may follow, as PROGRAMME.md names the sets. */
const SETS: Record<string, string> = { in_set: 'the strict set', in_set_vaults_kept: 'set A', in_set_broad: 'set B' };
/** The two sets of the first programme, as its tables 4 and 5 named them. It had no set B. */
const FIRST_SETS: Record<string, string> = { in_set: 'the set', in_set_vaults_kept: 'the set with the vaults kept' };
/** How far a position rebuilt from the day's close and its movements may be from the close before, as a share of the balance. */
const REBUILT_WITHIN = 0.001;
/** Venue kinds of venue-eligibility.csv that no Thesauros provider contract reads. */
const NO_ADAPTER: Record<string, string> = {
  'morpho-v2': 'Morpho Vault V2',
  'morpho-market': 'single Morpho Blue market',
  fluid: 'Fluid',
  susdc: 'Spark sUSDC',
};

// ---------------------------------------------------------------------------------------------
// Files

/** The cells of a CSV line. A cell in double quotes may hold commas (riskguard_response). */
function cellsOf(line: string): string[] {
  const cells = [''];
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) cells.push('');
    else cells[cells.length - 1] += char;
  }
  return cells;
}

/**
 * A CSV by its header. A line with more or fewer cells than the header stops the script: a comma
 * inside a cell would otherwise move every later column by one without a word.
 */
function csv(path: string): Row[] {
  const [header, ...rows] = readFileSync(path, 'utf8').trim().split('\n').map(cellsOf);
  if (new Set(header).size !== header.length) throw new Error(`${path}: two columns have one name`);
  return rows.map((cells, index) => {
    if (cells.length !== header.length)
      throw new Error(`${path}: line ${index + 2} has ${cells.length} cells, the header has ${header.length}`);
    return Object.fromEntries(header.map((name, column) => [name, cells[column]]));
  });
}

function num(row: Row, column: string): number {
  const value = Number(row[column]);
  if (row[column] === undefined || row[column] === '' || !Number.isFinite(value))
    throw new Error(`No number in ${column}: ${JSON.stringify(row)}`);
  return value;
}

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const networks = new Map<string, Network>();

function loadNetwork(config: Config): Network {
  const known = networks.get(config.network);
  if (known) return known;
  const dir = join(process.cwd(), 'data/tangem', config.network.toLowerCase());
  const from = Date.parse(config.start_date) / 1000;
  const to = Date.parse(config.end_date) / 1000;
  // The readings simulate.ts runs on: loadSamples() takes the same ones.
  const readings = readFileSync(join(dir, 'raw.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { block: number; values: Reading['values'] })
    .sort((a, b) => a.block - b.block)
    .map(({ values }) => ({ t: Number(values.timestamp), values }))
    .filter(({ t }) => t >= from && t <= to + 4 * 3600);
  const byDay = new Map<string, Reading[]>();
  for (const reading of readings) byDay.set(dayOf(reading.t), [...(byDay.get(dayOf(reading.t)) ?? []), reading]);
  const rule = csv(join(dir, 'venue-eligibility.csv'));
  const network: Network = {
    name: config.network,
    readings,
    byDay,
    rule,
    months: [...new Set(rule.map((row) => row.month))].sort(),
    labels: {},
  };
  networks.set(config.network, network);
  return network;
}

function loadRun(path: string): Run {
  const config: Config = JSON.parse(readFileSync(path, 'utf8'));
  const network = loadNetwork(config);
  Object.assign(network.labels, config.labels);
  const dir = join(process.cwd(), 'data/tangem', config.network.toLowerCase(), config.output ?? 'simulation');
  const days = csv(join(dir, 'tangem-simulation-daily.csv'));
  const moved = csv(join(dir, 'tangem-simulation-rebalances.csv'));
  const name = basename(path)
    .replace(/^config\./, '')
    .replace(/\.json$/, '');
  const of = (rows: Row[]) =>
    Object.fromEntries(STRATEGIES.map((strategy) => [strategy, rows.filter((row) => row.strategy === strategy)]));
  const run: Run = {
    name,
    path,
    config,
    network,
    daily: of(days),
    moves: moved.filter((row) => row.strategy === 'thesauros_simple'),
    movesOf: of(moved),
    stress: csv(join(dir, 'tangem-stress-tests.csv')),
  };
  // Every `reason` is a text simulate.ts writes for this config: a run made on other settings has
  // another, and stops the script here.
  moved.forEach((move) => kindOf(run, move));
  if (moved.some((move) => !STRATEGIES.includes(move.strategy)))
    throw new Error(`${name}: the rebalance file has a strategy the script does not know`);
  // The files of a run must describe the same year.
  for (const strategy of STRATEGIES) {
    const rows = run.daily[strategy];
    if (rows.length === 0 || rows.length !== run.daily.thesauros_simple.length || rows[0].date !== config.start_date)
      throw new Error(`${name}: ${strategy} has ${rows.length} days from ${rows[0]?.date}`);
    const last = rows[rows.length - 1];
    if (Math.abs(num(last, 'total_assets') - config.initial_deposit - num(last, 'cumulative_yield')) > 0.011)
      throw new Error(`${name}: ${strategy} ends on a balance that is not the deposit plus its yield`);
  }
  const counted = run.daily.thesauros_simple.reduce((sum, row) => sum + num(row, 'rebalance_count'), 0);
  if (counted !== run.moves.length)
    throw new Error(`${name}: ${run.moves.length} movements in the rebalance file, ${counted} in the daily file`);
  return run;
}

// ---------------------------------------------------------------------------------------------
// Output

const out: string[] = [];
const tables: string[][][] = [];
const say = (...lines: string[]) => out.push(...lines, '');
function table(header: string[], rows: string[][]): void {
  tables.push([header, ...rows]);
  say(
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  );
}
/** A table with one column per run. */
function perRun(runs: Run[], rows: [string, (run: Run) => string][]): void {
  table(
    ['', ...runs.map((run) => `\`${run.name}\``)],
    rows.map(([title, cell]) => [title, ...runs.map(cell)])
  );
}

const thousands = (value: number) =>
  Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const usd = (value: number) => `${value < 0 ? '−' : ''}$${thousands(Math.abs(value))}`;
const signed = (value: number, text: string) => (value < 0 ? text : `+${text}`);
const percent = (value: number, digits = 2) => `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%`;
/** A venue's size: $1.8B, $169M, $0.7M, and dollars under $100,000. */
const size = (value: number) =>
  value >= 1e9
    ? `$${(value / 1e9).toFixed(1)}B`
    : value >= 1e7
    ? `$${(value / 1e6).toFixed(0)}M`
    : value >= 1e5
    ? `$${(value / 1e6).toFixed(1)}M`
    : usd(value);
const column = (run: Run, provider: string, prefix = 'pct') =>
  `${prefix}_${run.config.labels[provider].toLowerCase().replace(/ /g, '_')}`;
/** The run folder of the pack the config's files are shipped in. */
function packFolder(run: Run): string {
  const [network, ...rest] = run.name.split('.');
  const folder = PACK_FOLDER[rest.join('.')];
  return folder ? `\`${network}-${folder}/simulation\`` : 'none';
}
const inSet = (config: Config, provider: string, date: string) =>
  config.eligible_periods === undefined ||
  (config.eligible_periods[provider] ?? []).some(([from, to]) => date >= from && date < to);
/** Whether the run decides by the water-filling allocator and not by the public vault's rules. */
const allocator = (run: Run) => run.config.policy === 'water_filling';
const threshold = (run: Run) => THRESHOLD_PP[run.config.policy ?? 'public_vault'];
const free = (reading: Reading, provider: string) => Number(reading.values[`${provider}.liquidity`] ?? 0) / 1e6;
/** The most of the vault a venue may hold, percent, as simulate.ts takes it: a full position is this much. */
const cap = (run: Run) => (run.config.risk_guard_enabled ? run.config.provider_cap_percent ?? LIVE_CAP : 100);
/**
 * A position under this, USD, is not weighed against a venue's size or its free liquidity: the
 * venue columns of the daily file show 0.01% of the balance, and less than that is their rounding.
 */
const rounding = (run: Run) => run.config.initial_deposit / 1e4;
/** The usual time between two readings of raw.jsonl, in hours. */
function hoursApart(network: Network): number {
  const gaps = network.readings.slice(1).map((reading, i) => reading.t - network.readings[i].t);
  return Math.round(gaps.sort((a, b) => a - b)[gaps.length >> 1] / 3600);
}

/**
 * Tables 4 and 5 name the sets as PROGRAMME.md does, and show set B, when a run of the allocator
 * is among the columns. Without one they are the tables of the first programme, which had two
 * sets and its own names for them.
 */
let reworked = false;
const setsShown = () => Object.keys(reworked ? SETS : FIRST_SETS);
const setName = (set: string) => (reworked ? SETS : FIRST_SETS)[set];

type Kind = 'priced' | 'restore' | 'forced' | 'with_forced' | 'equal_parts';
/**
 * What decided a movement, by its `reason`, which must be one of the texts simulate.ts writes
 * for the config of the run: the threshold of its policy, the readings in a row and the provider
 * cap are in them, so a run made on other settings stops the script here.
 */
function kindOf(run: Run, move: Row): Kind {
  const { reason } = move;
  const priced = allocator(run)
    ? `expected gain with the vault's own deposit priced at least ${threshold(run)} pp a year at ${
        ALLOCATOR.readings
      } readings in a row`
    : `expected gain on the rates before the move at least ${threshold(run)} pp a year`;
  if (FORCED.includes(reason)) return 'forced';
  if (reason === EQUAL_PARTS && move.strategy === 'eligible_equal_weight') return 'equal_parts';
  if (move.strategy !== 'eligible_equal_weight') {
    if (reason === WITH_FORCED) return 'with_forced';
    if (reason === priced) return 'priced';
    // Only the allocator has the move: the public vault's rules apply the cap inside every rebalance.
    if (allocator(run) && reason === `back under the provider cap of ${cap(run)}% whatever the move earns`)
      return 'restore';
  }
  throw new Error(`${run.name}: a movement of ${move.strategy} at ${move.datetime_utc} has the reason "${reason}"`);
}

/**
 * The column of the rule's table the run's eligible_periods are. The test is made on every day
 * of the run and not on the first day of a month only, so a period that starts or ends inside a
 * month does not pass: on each day a venue of the run is inside a period exactly when its row
 * for the month the day falls in has the column at 1. A run may leave venues of the set out (a
 * config made to show the result without them, or a venue of set B the collector cannot read),
 * and they are named. None of the columns stops the script. Where the venues of a run follow two
 * columns alike, the earlier of SETS names it: set A before set B.
 */
function ruleOf(run: Run): string {
  const { config, network } = run;
  if (!config.eligible_periods) return 'none';
  const days = run.daily.thesauros_simple.map((day) => day.date);
  const monthOf = (date: string) => network.months.filter((month) => month <= date).pop();
  if (!days.every(monthOf)) throw new Error(`${run.name}: a day is before the first month of venue-eligibility.csv`);
  // Every venue of the run has a row for every month, or the test below would pass it unseen.
  config.providers.forEach((provider) => ruleRows(network, provider));
  const follows = (set: string) =>
    network.rule
      .filter((row) => config.providers.includes(row.provider))
      .every((row) =>
        days
          .filter((date) => monthOf(date) === row.month)
          .every((date) => inSet(config, row.provider, date) === (row[set] === '1'))
      );
  const leftOut = (set: string) => [
    ...new Set(
      network.rule
        .filter((row) => row[set] === '1' && !config.providers.includes(row.provider))
        .map((row) => network.labels[row.provider] ?? row.venue)
    ),
  ];
  // The set the run leaves the fewest venues out of: none, for a run on a whole set.
  const [followed] = Object.keys(SETS)
    .filter(follows)
    .sort((a, b) => leftOut(a).length - leftOut(b).length);
  if (!followed) throw new Error(`${run.name}: eligible_periods are no set of venue-eligibility.csv`);
  const without = leftOut(followed);
  return `\`${followed}\` of \`venue-eligibility.csv\`` + (without.length ? ` without ${without.join(' and ')}` : '');
}

// ---------------------------------------------------------------------------------------------
// 1. Result

const lastDay = (run: Run, strategy: string) => run.daily[strategy][run.daily[strategy].length - 1];
const earned = (run: Run, strategy: string) => num(lastDay(run, strategy), 'total_assets') - run.config.initial_deposit;
const fees = (run: Run) => run.daily.thesauros_simple.reduce((sum, row) => sum + num(row, 'fees_paid'), 0);
const beforeFee = (run: Run) => earned(run, 'thesauros_simple') + fees(run);
const ofDeposit = (run: Run, value: number) => (value / run.config.initial_deposit) * 100;
const yielded = (run: Run, value: number) => `${usd(value)} (${percent(ofDeposit(run, value))})`;
const difference = (run: Run, value: number) =>
  `${signed(value, usd(value))} (${signed(value, percent(ofDeposit(run, value)).replace('%', ' pp'))})`;

function bestVault(run: Run): string {
  const picked = run.config.providers.filter(
    (provider) => num(run.daily.just_best_vault[0], column(run, provider)) === 100
  );
  if (picked.length !== 1)
    throw new Error(`${run.name}: just_best_vault holds ${picked.length} venues at 100% on day one`);
  return run.config.labels[picked[0]];
}

function breakEvenFee(run: Run): string {
  const aave = earned(run, 'just_aave');
  return beforeFee(run) > aave
    ? `about ${percent(((beforeFee(run) - aave) / beforeFee(run)) * 100, 0)}`
    : 'none: below Just Aave before any fee';
}

/**
 * In how many months Thesauros Simple before its fee earned more than the equal-weight control.
 * `monthOf` names the month a date belongs to.
 */
function monthsAhead(run: Run, monthOf: (date: string) => string): string {
  const lead = new Map<string, number>();
  run.daily.thesauros_simple.forEach((day, d) => {
    const control = run.daily.eligible_equal_weight[d];
    if (control.date !== day.date) throw new Error(`${run.name}: the strategies do not share their days`);
    const ahead = num(day, 'daily_yield') + num(day, 'fees_paid') - num(control, 'daily_yield');
    lead.set(monthOf(day.date), (lead.get(monthOf(day.date)) ?? 0) + ahead);
  });
  return `${[...lead.values()].filter((value) => value > 0).length} of ${lead.size}`;
}
/** The month of the venue rule a date is in: it runs from the day of the month the run starts on. */
const ruleMonth = (run: Run) => (date: string) =>
  new Date(Date.parse(date) - (Number(run.config.start_date.slice(8)) - 1) * DAY * 1000).toISOString().slice(0, 7);

/**
 * The venues of an allocator run production has no impact exponent for: simulate.ts prices them
 * with ASSUMED_EXPONENT, all year with production's constants and until a reading measures one
 * with measured exponents.
 */
const assumed = (run: Run) =>
  allocator(run)
    ? run.config.providers
        .filter((provider) => PRODUCTION_EXPONENT[ruleRows(run.network, provider)[0].kind] === undefined)
        .map((provider) => run.config.labels[provider])
    : [];

/**
 * The runs whose thesauros_simple is the same run: the same balance and fee on every day and the
 * same movements. A venue one config has and the other lacks then held nothing all year, which
 * is checked, and the controls that end on another balance are named.
 */
function sameRuns(runs: Run[]): string[] {
  const days = (run: Run) =>
    run.daily.thesauros_simple.map((day) => `${day.date} ${day.total_assets} ${day.fees_paid}`);
  const moves = (run: Run) => run.moves.map((move) => `${move.datetime_utc} ${move.from} ${move.to} ${move.amount}`);
  const print = (run: Run) => JSON.stringify([run.config.network, days(run), moves(run)]);
  return runs.flatMap((run, i) =>
    runs
      .slice(i + 1)
      .filter((other) => print(other) === print(run))
      .map((other) => {
        const only = [
          [other, run],
          [run, other],
        ].flatMap(([a, b]) =>
          a.config.providers
            .filter((provider) => !b.config.providers.includes(provider))
            .map((provider) => {
              if (a.daily.thesauros_simple.some((day) => num(day, column(a, provider)) !== 0))
                throw new Error(`${a.name}: ${provider} holds money, and ${b.name} is the same run without it`);
              return `${a.config.labels[provider]} of \`${a.name}\``;
            })
        );
        const differ = STRATEGIES.slice(1).filter(
          (strategy) => lastDay(run, strategy).total_assets !== lastDay(other, strategy).total_assets
        );
        return `- \`${other.name}\` and \`${
          run.name
        }\` are one run of \`thesauros_simple\`: the same \`total_assets\` and \`fees_paid\` on every day and the same movements.${
          only.length === 0
            ? ''
            : ` The venues only one of them has are at 0.00% of the vault on every day: ${only.join(', ')}.`
        } ${
          differ.length === 0
            ? 'Their controls end on the same balances too.'
            : `Of their controls, ${differ.map((strategy) => `\`${strategy}\``).join(' and ')} ends on another balance.`
        }`;
      })
  );
}

function result(runs: Run[]): void {
  if (runs.some((run) => run.config.start_date.slice(8) !== '07'))
    throw new Error('The rows of table 1 are worded for a year that starts on the 7th');
  const withAllocator = runs.some(allocator);
  const noExponent = [...new Set(runs.flatMap(assumed))];
  say('## 1. Result', 'Yield for the year on the deposit, in USD and in percent of the deposit.');
  perRun(runs, [
    [
      'Decision of Thesauros Simple',
      (run) =>
        !allocator(run)
          ? "public vault's rules"
          : run.config.impact_exponent === 'measured'
          ? 'allocator, measured exponents'
          : `allocator, production's constants${
              assumed(run).length ? ` (${ASSUMED_EXPONENT} assumed for ${assumed(run).join(' and ')})` : ''
            }`,
    ],
    [
      'Venue set',
      (run) => {
        const set = Object.keys(SETS).find((name) => ruleOf(run).startsWith(`\`${name}\``));
        return set ? `${SETS[set]}: ${ruleOf(run)}` : 'no rule: the venues of the config, all year';
      },
    ],
    ['Liquidity rule', (run) => (run.config.liquidity_rule ? 'on' : 'off')],
    ['Just Aave: all in Aave V3, never moved', (run) => yielded(run, earned(run, 'just_aave'))],
    [
      'First split held: the first allocation, never rebalanced, no fee',
      (run) => yielded(run, earned(run, 'first_split_held')),
    ],
    [
      'Eligible equal weight: equal parts over the venues allowed, no fee',
      (run) => yielded(run, earned(run, 'eligible_equal_weight')),
    ],
    ['Thesauros Simple before its fee', (run) => yielded(run, beforeFee(run))],
    [
      'Choosing by rate added, against first split held',
      (run) => difference(run, beforeFee(run) - earned(run, 'first_split_held')),
    ],
    [
      'Choosing by rate added, against eligible equal weight',
      (run) => difference(run, beforeFee(run) - earned(run, 'eligible_equal_weight')),
    ],
    [
      'Months ahead of eligible equal weight, before the fee: months from the 7th to the 6th',
      (run) => monthsAhead(run, ruleMonth(run)),
    ],
    [
      'Months ahead of eligible equal weight, before the fee: calendar months',
      (run) => monthsAhead(run, (date) => date.slice(0, 7)),
    ],
    ['Performance fee', (run) => `${usd(fees(run))} (${run.config.performance_fee_percent}% of each positive day)`],
    ['Thesauros Simple after its fee', (run) => yielded(run, earned(run, 'thesauros_simple'))],
    [
      'Just Best Vault: all in the venue with the highest rate on day one',
      (run) => yielded(run, earned(run, 'just_best_vault')),
    ],
    ['The venue Just Best Vault picked', bestVault],
    [
      'Thesauros Simple after its fee, against Just Aave',
      (run) => difference(run, earned(run, 'thesauros_simple') - earned(run, 'just_aave')),
    ],
    [
      'After its fee, against first split held',
      (run) => difference(run, earned(run, 'thesauros_simple') - earned(run, 'first_split_held')),
    ],
    [
      'After its fee, against eligible equal weight',
      (run) => difference(run, earned(run, 'thesauros_simple') - earned(run, 'eligible_equal_weight')),
    ],
    ['Break-even fee: the fee at which Thesauros Simple equals Just Aave', breakEvenFee],
  ]);
  say(
    '- A yield is `total_assets` of the last day of `tangem-simulation-daily.csv` minus the deposit.',
    '- Before its fee: the yield of `thesauros_simple` plus the sum of its `fees_paid`. The fee is that sum.',
    '- Choosing by rate added: the yield before the fee minus the yield of the control. `first_split_held` keeps a venue that later leaves the set, so under a venue rule its difference also carries what the rule costs; `eligible_equal_weight` follows the rule.',
    '- Months ahead: a month counts when the sum of `daily_yield` and `fees_paid` of `thesauros_simple` over its days is above the sum of `daily_yield` of `eligible_equal_weight`. It is counted two ways, and each cell says of how many: by the months of the venue rule, which run from the 7th to the 6th, and by the calendar months the year touches, of which the first and the last are touched in part.',
    '- After its fee, against a control: the yield of `thesauros_simple` minus the yield of the control, which pays no Thesauros fee.',
    '- The venue of Just Best Vault is the venue column that is 100 on its first day.',
    '- Break-even fee: (yield before the fee − yield of Just Aave) / yield before the fee, to the whole percent. It is an approximation: the fee is charged on each positive day and the balance compounds, which the formula leaves out.',
    `- Decision: \`policy\` and \`impact_exponent\` of the config. The public vault's rules are the decision of the vault as deployed, with RiskGuard's rules around it: at most ${cap(
      runs[0]
    )}% of the vault in a venue, at least two venues, the circuit breaker, the anomaly gate and the cooldown.${
      withAllocator
        ? ` The allocator is the water-filling step of the Thesauros cross-chain planner, which is not live for the public vaults. It prices the vault's own deposit in each venue with the exponent production has for the venue's protocol: 2 for Aave V3 and Compound V3, 1.75 for Morpho, which a Morpho Vault V2 and a single Morpho Blue market also take.${
            noExponent.length === 0
              ? ''
              : ` Production has no exponent for ${noExponent.join(
                  ' and '
                )}: where a run takes production's exponent it gives them ${ASSUMED_EXPONENT}, an assumption.`
          } With measured exponents it is the exponent that reproduces the $10M deposit probe of the reading; a reading that measures none leaves the venue's last one, and the constant before the first. Of RiskGuard's rules the allocator runs keep one, by choice: at most ${cap(
            runs[0]
          )}% of the vault in a venue, the entry provider excepted, which has no limit. They apply no minimum of two venues, no circuit breaker, no anomaly gate and no cooldown: the planner's step has none of them.`
        : ''
    }`,
    `- Venue set: the column of \`venue-eligibility.csv\` the \`eligible_periods\` of the config are, as in the table of the runs. ${Object.entries(
      SETS
    )
      .map(([name, set]) => `\`${name}\` is ${set}`)
      .join(', ')} of \`PROGRAMME.md\`.`,
    `- Liquidity rule: \`liquidity_rule\` of the config. On: a venue whose own free liquidity at a reading is below a full position of the vault, ${cap(
      runs[0]
    )}% of the vault at that reading, takes no new money at that reading.`,
    '- Just Best Vault takes the venue with the highest `rate` at the first reading among the venues that are in the set that day and accept the whole deposit. The liquidity rule and the limit on our share of a venue do not bind it, nor Just Aave: they bind `thesauros_simple`, `first_split_held` up to its first rebalance and `eligible_equal_weight`.',
    ...sameRuns(runs)
  );
}

// ---------------------------------------------------------------------------------------------
// 2. What the vault did

const transacted = new Map<Run, Tx[]>();
/**
 * The transactions of thesauros_simple. One decision makes a transaction, and every movement of
 * it must say so: all of them a gain decided, with one `expected_gain_pp`; all of them the
 * allocator's move back under the cap, with one; or a forced exit and what was sent with it, with
 * none. Anything else stops the script.
 */
function transactions(run: Run): Tx[] {
  const known = transacted.get(run);
  if (known) return known;
  const sent: Row[][] = [];
  for (const move of run.moves) {
    if (sent.length === 0 || sent[sent.length - 1][0].tx !== move.tx) sent.push([]);
    sent[sent.length - 1].push(move);
  }
  if (sent.length !== new Set(run.moves.map((move) => move.tx)).size)
    throw new Error(`${run.name}: the movements of a transaction are not consecutive in the rebalance file`);
  const txs = sent.map((moves): Tx => {
    const [first] = moves;
    const kinds = new Set(moves.map((move) => kindOf(run, move)));
    const gains = new Set(moves.map((move) => move.expected_gain_pp));
    const forced = kinds.has('forced');
    const legs = moves.map((move) => ({ from: move.from, to: move.to, amount: num(move, 'amount') }));
    const sound = forced
      ? [...kinds].every((kind) => kind === 'forced' || kind === 'with_forced') && gains.size === 1 && gains.has('')
      : kinds.size === 1 && (kinds.has('priced') || kinds.has('restore')) && gains.size === 1 && !gains.has('');
    if (!sound || new Set(moves.map((move) => `${move.datetime_utc} ${move.realized_change_pp}`)).size !== 1)
      throw new Error(`${run.name}: the movements of transaction ${first.tx} are not of one decision`);
    // The planner's own floors, which the definitions of table 2 state for a plan a gain decided.
    if (
      allocator(run) &&
      kinds.has('priced') &&
      (legs.some((leg) => leg.amount < ALLOCATOR.leg) ||
        legs.reduce((sum, leg) => sum + leg.amount, 0) < ALLOCATOR.move)
    )
      throw new Error(`${run.name}: transaction ${first.tx} is a plan under the allocator's least move or leg`);
    return {
      t: Date.parse(first.datetime_utc) / 1000,
      lower: num(first, 'realized_change_pp') < 0,
      expected: kinds.has('priced') ? num(first, 'expected_gain_pp') : null,
      restore: kinds.has('restore'),
      forced,
      realized: num(first, 'realized_change_pp'),
      legs,
    };
  });
  transacted.set(run, txs);
  return txs;
}

/**
 * The transactions that send money back along a path the transaction before them used, at most
 * 24 hours earlier: for each, the share of what that one moved that comes back. A movement comes
 * back up to what the one before sent along its path the other way.
 */
const reversals = (txs: Tx[], least: number): number[] =>
  txs.flatMap((tx, i) => {
    if (i === 0 || tx.t - txs[i - 1].t > DAY) return [];
    const before = txs[i - 1].legs;
    const sent = (leg: Tx['legs'][0]) =>
      before
        .filter((other) => other.amount >= least && other.from === leg.to && other.to === leg.from)
        .reduce((sum, other) => sum + other.amount, 0);
    const back = tx.legs.filter((leg) => leg.amount >= least && sent(leg) > 0);
    return back.length === 0
      ? []
      : [
          back.reduce((sum, leg) => sum + Math.min(leg.amount, sent(leg)), 0) /
            before.reduce((sum, other) => sum + other.amount, 0),
        ];
  });

/**
 * The rebalances a decision priced: a forced exit and what was sent with it have no expected
 * gain, and no gain decided the allocator's move back under the provider cap.
 */
const priced = (run: Run) => transactions(run).filter((tx): tx is Tx & { expected: number } => tx.expected !== null);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const points = (values: number[]) => (values.length === 0 ? 'none priced' : `${mean(values).toFixed(2)} pp`);

/** The movements that took out more than the source venue had free with none of our deposit counted as liquid. */
const aboveFree = (run: Run) => run.moves.filter((move) => num(move, 'amount') > num(move, 'source_free_liquidity'));
const dollars = (spent: number) => (spent < 100 ? `$${spent.toFixed(2)}` : usd(spent));
function gas(run: Run): string {
  return dollars(run.moves.reduce((sum, move) => sum + num(move, 'gas_cost_usd'), 0));
}
/** The same year's gas from the daily file, which rounds each day to the cent. */
function gasByDay(run: Run): string {
  const days = run.daily.thesauros_simple;
  const byDay = days.reduce((sum, day) => sum + num(day, 'gas_spent_usd'), 0);
  const byMove = run.moves.reduce((sum, move) => sum + num(move, 'gas_cost_usd'), 0);
  const moved = days.filter((day) => num(day, 'rebalance_count') > 0).length;
  // Half a cent a day with a movement, and half of the fourth decimal a movement.
  if (Math.abs(byDay - byMove) > moved * 0.005 + run.moves.length * 0.00005 + 1e-9)
    throw new Error(`${run.name}: gas is ${byDay} in the daily file and ${byMove} in the rebalance file`);
  return dollars(byDay);
}

function withdrawable(run: Run, test: (available: number, assets: number) => boolean): string {
  const days = run.daily.thesauros_simple;
  const count = days.filter((day) => test(num(day, 'available_liquidity'), num(day, 'total_assets'))).length;
  return `${count} of ${days.length}`;
}

/** What the vault held in each venue, by the venue's name, USD. */
type Held = Record<string, number>;
interface HeldAt {
  reading: Reading;
  /** The day of the daily file the reading belongs to. */
  date: string;
  /** As the reading is taken, and once the reading's movements are made. */
  before: Held;
  after: Held;
}
const walks = new Map<string, { at: HeldAt[]; close: Map<string, Held> }>();

/**
 * A strategy's positions at every reading of the year, the days in order and the readings of a
 * day from the last to the first, and at every day's close. The position after a reading is the
 * day's closing position less what the later movements of the day brought in; with all of the
 * day's movements taken back it must be the close of the day before, which is checked. Interest
 * of the hours between is left out; a fall of a venue's index, which is in the close and in no
 * movement, is added back for the check.
 */
function walk(run: Run, strategy = 'thesauros_simple'): { at: HeldAt[]; close: Map<string, Held> } {
  const known = walks.get(`${run.name} ${strategy}`);
  if (known) return known;
  const days = run.daily[strategy];
  const moved = new Map<number, Row[]>();
  for (const move of run.movesOf[strategy]) {
    const t = Date.parse(move.datetime_utc) / 1000;
    moved.set(t, [...(moved.get(t) ?? []), move]);
  }
  const at: HeldAt[] = [];
  const close = new Map<string, Held>();
  let before: Held = {};
  for (const day of days) {
    const held: Held = {};
    for (const provider of run.config.providers)
      held[run.config.labels[provider]] = (num(day, column(run, provider)) / 100) * num(day, 'total_assets');
    close.set(day.date, { ...held });
    const readings = run.network.byDay.get(day.date);
    if (!readings) throw new Error(`${run.name}: no reading on ${day.date}`);
    for (const reading of [...readings].reverse()) {
      const after = { ...held };
      for (const move of moved.get(reading.t) ?? []) {
        held[move.from] += num(move, 'amount');
        held[move.to] -= num(move, 'amount');
      }
      moved.delete(reading.t);
      at.push({ reading, date: day.date, before: { ...held }, after });
    }
    const drift = run.config.providers.map((provider) => {
      const venue = run.config.labels[provider];
      const fall = Math.min(0, num(day, column(run, provider, 'interest')));
      return before[venue] === undefined ? 0 : Math.abs(held[venue] - fall - before[venue]);
    });
    if (Math.max(0, ...drift) > num(day, 'total_assets') * REBUILT_WITHIN)
      throw new Error(
        `${run.name}: the positions of ${strategy} on ${day.date} less its movements are not the close of the day before`
      );
    before = close.get(day.date)!;
  }
  if (moved.size > 0) throw new Error(`${run.name}: ${moved.size} rebalances are at no reading of raw.jsonl`);
  walks.set(`${run.name} ${strategy}`, { at, close });
  return { at, close };
}

const looked = new Map<string, Map<string, [Reading, Held][]>>();
/**
 * Where a strategy's positions are set against the venues' free liquidity, by day, as simulate.ts
 * takes a day's `available_liquidity`: the positions once the movements of a reading are made
 * against the free liquidity of that reading, for every reading of the day, and the day's close
 * against the first reading after it. The lowest share of the balance so payable must be the
 * share of the daily file, on every day, which is checked.
 */
function looks(run: Run, strategy = 'thesauros_simple'): Map<string, [Reading, Held][]> {
  const known = looked.get(`${run.name} ${strategy}`);
  if (known) return known;
  const days = run.daily[strategy];
  const { providers, labels } = run.config;
  const { readings } = run.network;
  const { at, close } = walk(run, strategy);
  const found = new Map<string, [Reading, Held][]>(days.map((day) => [day.date, []]));
  for (const { reading, date, after } of at) found.get(date)!.push([reading, after]);
  const payable = (reading: Reading, held: Held) =>
    providers.reduce((sum, provider) => sum + Math.min(held[labels[provider]], free(reading, provider)), 0) /
    providers.reduce((sum, provider) => sum + held[labels[provider]], 0);
  for (const day of days) {
    const next = readings[readings.indexOf(found.get(day.date)![0][0]) + 1];
    if (!next) throw new Error(`${run.name}: no reading after the close of ${day.date}`);
    found.get(day.date)!.push([next, close.get(day.date)!]);
    const filed = num(day, 'available_liquidity') / num(day, 'total_assets');
    const lowest = Math.min(...found.get(day.date)!.map(([reading, held]) => payable(reading, held)));
    if (Math.abs(lowest - filed) > REBUILT_WITHIN)
      throw new Error(
        `${run.name}: ${strategy} on ${day.date} has ${percent(
          filed * 100
        )} withdrawable in the daily file and ${percent(lowest * 100)} by its positions and the readings`
      );
  }
  looked.set(`${run.name} ${strategy}`, found);
  return found;
}

/**
 * The largest share of a venue the vault would have been, over every reading of the year. At a
 * reading the vault holds one position as the reading is taken and another once the reading's
 * movements are made; each is set against the venue's supply at that reading plus the position.
 */
function largestShare(run: Run): string {
  const days = run.daily.thesauros_simple;
  let top = { share: 0, venue: '', date: '' };
  const weigh = (held: Held, reading: Reading) => {
    for (const provider of run.config.providers) {
      const position = held[run.config.labels[provider]];
      if (position < rounding(run)) continue;
      const share = position / (Number(reading.values[`${provider}.supplied`] ?? 0) / 1e6 + position);
      if (share > top.share) top = { share, venue: run.config.labels[provider], date: dayOf(reading.t) };
    }
  };
  const { at, close } = walk(run);
  for (const { reading, before, after } of at) {
    weigh(after, reading);
    weigh(before, reading);
  }
  // The last close is still held at the reading that ends the year.
  const end = days[days.length - 1].date;
  for (const reading of run.network.readings.filter((item) => dayOf(item.t) > end)) weigh(close.get(end)!, reading);
  return `${percent(top.share * 100, 1)} of ${top.venue} on ${top.date}`;
}

function averageShares(run: Run): string {
  const days = run.daily.thesauros_simple;
  return run.config.providers
    .map((provider): [string, number] => [
      run.config.labels[provider],
      days.reduce((sum, day) => sum + num(day, column(run, provider)), 0) / days.length,
    ])
    .sort((a, b) => b[1] - a[1])
    .map(([venue, share]) => `${venue} ${percent(share, 1)}`)
    .join(', ');
}

function outsideSet(run: Run, strategy: string): string {
  if (!run.config.eligible_periods) return 'no rule in this run';
  const days = run.daily[strategy];
  const venueDays = days.reduce(
    (sum, day) =>
      sum + run.config.providers.filter((p) => num(day, column(run, p)) > 0 && !inSet(run.config, p, day.date)).length,
    0
  );
  const flagged = days.filter((day) => num(day, 'outside_set_percent') > 0);
  if (venueDays === 0 && flagged.length === 0) return '0';
  const most = Math.max(...flagged.map((day) => num(day, 'outside_set_percent')));
  return `${venueDays} venue-days on ${flagged.length} days, up to ${percent(most)} of the balance`;
}

function behaviour(runs: Run[]): void {
  // What holds for the allocator only is said when a run of it is among the columns, and what
  // was written of every rebalance is then said of the public vault's rules.
  const withAllocator = runs.some(allocator);
  const ofRules = withAllocator ? " of the public vault's rules" : '';
  const least = [...new Set(runs.map(threshold))];
  const fell = runs.some((run) =>
    run.daily.thesauros_simple.some((day) =>
      run.config.providers.some((provider) => num(day, column(run, provider, 'interest')) < 0)
    )
  );
  // Where the allocator's movements under REMAINDER are, by what decided their transaction.
  const small = runs
    .filter(allocator)
    .flatMap(transactions)
    .filter((tx) => tx.legs.some((leg) => leg.amount < REMAINDER));
  const apart = [...new Set(runs.filter(allocator).map((run) => hoursApart(run.network)))];
  say(
    '## 2. What the vault did',
    withAllocator
      ? '`thesauros_simple` only, except the last four rows: the last five are one a strategy.'
      : '`thesauros_simple` only, except the last five rows.'
  );
  perRun(runs, [
    ['Rebalances (transactions)', (run) => String(transactions(run).length)],
    ['Movements of funds', (run) => String(run.moves.length)],
    [
      'Movements a rebalance, mean',
      (run) => (run.moves.length === 0 ? '—' : (run.moves.length / transactions(run).length).toFixed(2)),
    ],
    [
      'Rebalances that reverse the previous one within 24 hours',
      (run) => String(reversals(transactions(run), DUST).length),
    ],
    ['The same, counting movements of any size', (run) => String(reversals(transactions(run), 0).length)],
    [
      `Of the rebalances that reverse the previous one, counting movements of at least ${usd(
        DUST
      )}: those that send back under half of what it moved`,
      (run) => String(reversals(transactions(run), DUST).filter((share) => share < 0.5).length),
    ],
    [
      "Rebalances after which the vault's rate was lower than before",
      (run) => String(transactions(run).filter((tx) => tx.lower).length),
    ],
    ['Rebalances a decision priced', (run) => String(priced(run).length)],
    [
      "Of them, the vault's rate was lower after the move",
      (run) => String(priced(run).filter((tx) => tx.lower).length),
    ],
    [
      least.length === 1
        ? `Of them, the realized change was under the ${least[0]} pp the move had to expect`
        : `Of them, the realized change was under the gain the move had to expect: ${THRESHOLD_PP.public_vault} pp under the public vault's rules, ${THRESHOLD_PP.water_filling} pp for the allocator`,
      (run) => String(priced(run).filter((tx) => tx.realized < threshold(run)).length),
    ],
    [
      'Of them, the realized change was under the expected gain',
      (run) => String(priced(run).filter((tx) => tx.realized < tx.expected).length),
    ],
    ['Mean expected gain of the priced rebalances', (run) => points(priced(run).map((tx) => tx.expected))],
    ['Mean realized change of the priced rebalances', (run) => points(priced(run).map((tx) => tx.realized))],
    [
      'Rebalances that take a venue back under the provider cap, which no gain decided',
      (run) => String(transactions(run).filter((tx) => tx.restore).length),
    ],
    [
      'Movements that are forced exits',
      (run) => String(run.moves.filter((move) => move.reason.startsWith('forced exit')).length),
    ],
    [
      'Movements sent in the transaction of a forced exit',
      (run) => String(run.moves.filter((move) => move.reason === 'moved in the transaction of a forced exit').length),
    ],
    ['Movements that took out more than the source venue had free without us', (run) => String(aboveFree(run).length)],
    [
      `Movements under ${usd(REMAINDER)}`,
      (run) => String(run.moves.filter((move) => num(move, 'amount') < REMAINDER).length),
    ],
    [
      'Movements whose gas cost was above the amount moved',
      (run) => String(run.moves.filter((move) => num(move, 'gas_cost_usd') > num(move, 'amount')).length),
    ],
    [
      'Legs refused',
      (run) => String(run.daily.thesauros_simple.reduce((sum, day) => sum + num(day, 'rebalances_refused'), 0)),
    ],
    ['Gas for the year', gas],
    ['Gas for the year, as the daily file has it', gasByDay],
    [
      'Days on which the whole balance could be withdrawn, to the cent',
      (run) => withdrawable(run, (available, assets) => available >= assets),
    ],
    [
      `Days on which the whole balance could be withdrawn, within ${percent((1 - WHOLE) * 100)} of the balance`,
      (run) => withdrawable(run, (available, assets) => available >= assets * WHOLE),
    ],
    [
      'Days on which less than half could be withdrawn',
      (run) => withdrawable(run, (available, assets) => available < assets / 2),
    ],
    ['Largest share of a venue we would have been', largestShare],
    ['Average share of the vault per venue', averageShares],
    ...STRATEGIES.map((strategy): [string, (run: Run) => string] => [
      `Outside the set: \`${strategy}\``,
      (run) => outsideSet(run, strategy),
    ]),
  ]);
  const unpriced = [
    ...new Set(
      runs.flatMap((run) => run.moves.filter((move) => move.expected_gain_pp === '').map((move) => move.reason))
    ),
  ].sort();
  say(
    '- Rebalances: distinct `tx` of `tangem-simulation-rebalances.csv`; movements: its rows.',
    `- Reverses the previous one: the rebalance comes at most 24 hours after the one before it and has a movement of at least ${usd(
      DUST
    )} from B to A where the one before had a movement of at least ${usd(
      DUST
    )} from A to B. Smaller movements are left out: a rebalance${ofRules} evens out positions by a few dollars next to its main movements, and such a remainder running the other way is not money sent back. The next row counts them too.`,
    `- Under half of what it moved: one movement running back is enough for a rebalance to count as reversing the previous one, so it need not undo it. What a rebalance sends back is its movements of at least ${usd(
      DUST
    )} along a path the previous one used the other way with a movement of at least ${usd(
      DUST
    )}, each up to what the previous one sent along that path. The row counts the rebalances of the first of the two rows above that send back under half of all the previous one moved.`,
    '- Rate lower than before: `realized_change_pp` below zero, counted once a transaction.',
    `- A decision priced: the rebalance has an \`expected_gain_pp\`${
      withAllocator ? ' and is no move back under the provider cap' : ''
    }. ${
      withAllocator
        ? `Under the public vault's rules the decision compared the rates as they stood before the move and expected at least ${
            THRESHOLD_PP.public_vault
          } pp a year. The allocator priced the vault's own deposit in each venue and expected at least ${
            THRESHOLD_PP.water_filling
          } pp of the vault a year, from a plan that fills the same venues and drains the same venues, by at least ${usd(
            ALLOCATOR.move
          )} each, at ${ALLOCATOR.readings} readings in a row${
            apart.length === 1 ? `, which are ${apart[0]} hours apart in this history` : ''
          }; the amounts may differ between the readings. In both`
        : `The decision compared the rates as they stood before the move and expected at least ${least[0]} pp a year;`
    } \`realized_change_pp\` is the vault's rate with our positions in place after the move less the same before it. No decision priced a rebalance without an \`expected_gain_pp\`: ${
      unpriced.length === 0
        ? 'these runs have none'
        : `in these runs the \`reason\` of its movements is ${unpriced.map((reason) => `"${reason}"`).join(' or ')}`
    }. The five rows that follow count the priced ones only, one value a transaction; the means are over them.`,
    '- Back under the provider cap: rebalances whose `reason` begins with "back under the provider cap". Only the allocator makes them: a venue other than its entry provider that has grown above the cap gives up the excess whatever the move earns. Such a rebalance has an `expected_gain_pp`: what the allocator expects the move to change, which may be a loss, and not a gain it had to reach. So it is not counted as priced. The public vault\'s rules apply the cap inside every rebalance and have no such move.',
    '- Forced exits: movements whose `reason` begins with "forced exit": they leave a venue the decision read as paying nothing, and the `reason` says why. Sent in the transaction of a forced exit: the other movements of that transaction, by their `reason`. Movements a rebalance: the movements over the rebalances.',
    '- More than the source had free: rows with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid.',
    `- Movements under ${usd(
      REMAINDER
    )}: rows with \`amount\` below it. A rebalance${ofRules} evens out positions by such remainders next to its main movements.${
      withAllocator
        ? ` A plan of the allocator that a gain decided has no movement under ${usd(
            ALLOCATOR.leg
          )} and moves at least ${usd(
            ALLOCATOR.move
          )} in all, and the script stops on one that does not: the allocator's movements under ${usd(
            REMAINDER
          )} are parts of such a plan${
            small.some((tx) => tx.forced) ? ', or of the transaction of a forced exit' : ''
          }${small.some((tx) => tx.restore) ? ', or of a move back under the provider cap' : ''}.`
        : ''
    } Gas above the amount: rows with \`gas_cost_usd\` above \`amount\`.`,
    '- Legs refused: the sum of `rebalances_refused` of the daily file.',
    '- A plan with a leg that cannot execute is refused whole, and every leg of it is counted, at each reading at which it is refused: the vault sends the legs of a rebalance in one transaction, which reverts when one of them does.',
    '- Gas for the year: the sum of `gas_cost_usd` of the movements in `tangem-simulation-rebalances.csv`, which has four decimals. As the daily file has it: the sum of `gas_spent_usd` of `thesauros_simple` in `tangem-simulation-daily.csv`, which is rounded to the cent each day. The two differ by the rounding of the two columns and by nothing else: the script stops if they are further apart than that rounding allows.',
    `- Whole balance, to the cent: days with \`available_liquidity\` at least \`total_assets\`. Within ${percent(
      (1 - WHOLE) * 100
    )}: at least ${percent(
      WHOLE * 100
    )} of \`total_assets\`. Less than half: \`available_liquidity\` below half of \`total_assets\`.`,
    `- Largest share of a venue: at every reading of \`raw.jsonl\` the vault holds one position as the reading is taken and another once the movements of that reading are made. Each is divided by the venue's \`supplied\` at that reading plus the position, and the largest of all is shown. A position is the venue's share of \`total_assets\` at the day's close less what the later movements of that day brought into it. Interest of the hours between is left out; the script stops unless the positions so rebuilt for the start of a day are within ${percent(
      REBUILT_WITHIN * 100,
      1
    )} of the balance of the close before.${
      fell
        ? " A fall of a venue's index is in the close and in no movement, so for that check it is added back to the venue: the daily file has it as the venue's negative interest of the day."
        : ''
    }`,
    `- A position under 0.01% of the deposit, ${usd(
      rounding(runs[0])
    )}, is not weighed in the largest share, nor in tables 8 and 11: the venue columns of the daily file have two decimals, and less than that is their rounding.`,
    '- Average share: the mean of the venue column over the days.',
    "- Outside the set: a venue-day is a day on which a venue's column is above zero outside its `eligible_periods` in the config; the days are those with `outside_set_percent` above zero. The columns have two decimals, so a position under 0.005% of the balance does not show."
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Stress

function stress(runs: Run[]): void {
  const scenarios = runs[0].stress.map((row) => row.scenario);
  const of = (run: Run, scenario: string) => {
    const row = run.stress.find((item) => item.scenario === scenario);
    if (!row) throw new Error(`${run.name}: no ${scenario} in the stress file`);
    return row;
  };
  // The definitions state one size a scenario.
  const { stress: sizes } = runs[0].config;
  const sized = ({ config: { stress: s } }: Run) =>
    [
      s.depeg.price,
      s.depeg.days,
      s.curator_bad_debt.loss_percent,
      s.protocol_hack.loss_percent,
      s.withdrawal_freeze.days,
    ].join();
  if (new Set(runs.map(sized)).size !== 1) throw new Error('Table 3 is worded for scenarios of one size in every run');
  // A curated Morpho vault as simulate.ts tells one: "Morpho" and no "Market" in the provider's name.
  const uncurated = runs.flatMap((run) => {
    const hit = of(run, 'curator_bad_debt').provider_hit;
    const provider = run.config.providers.find((name) => run.config.labels[name] === hit);
    if (!provider) throw new Error(`${run.name}: curator_bad_debt hit ${hit}, which is no venue of the run`);
    return provider.includes('Morpho') && !provider.includes('Market') ? [] : [`\`${run.name}\` (${hit})`];
  });
  say('## 3. Stress', 'Straight from `tangem-stress-tests.csv`.');
  perRun(runs, [
    ['First day of every scenario', (run) => `${run.stress[0].trigger_date}, day ${run.stress[0].trigger_day}`],
    ...scenarios.flatMap((scenario): [string, (run: Run) => string][] => [
      [`\`${scenario}\`: venue hit`, (run) => of(run, scenario).provider_hit || '—'],
      [
        `\`${scenario}\`: largest loss`,
        (run) =>
          `${usd(num(of(run, scenario), 'max_loss_usd'))} (${percent(num(of(run, scenario), 'max_loss_percent'))})`,
      ],
      [`\`${scenario}\`: days until everything can be withdrawn`, (run) => of(run, scenario).time_to_exit_days],
      [`\`${scenario}\`: balance at year end`, (run) => usd(num(of(run, scenario), 'final_balance_usd'))],
      ...(scenario === 'no_stress'
        ? []
        : [
            [
              `\`${scenario}\`: balance at year end, against \`no_stress\``,
              (run: Run) => {
                const value = num(of(run, scenario), 'final_balance_vs_no_stress_usd');
                return Math.round(value) === 0 ? usd(0) : signed(value, usd(value));
              },
            ] as [string, (run: Run) => string],
          ]),
    ]),
  ]);
  say(
    '- Columns `provider_hit`, `max_loss_usd` and `max_loss_percent` (against the value on the day before the event), `time_to_exit_days`, `final_balance_usd`, `final_balance_vs_no_stress_usd`. The depeg loss and balance are in USD value; the others in USDC.',
    '- Against `no_stress`: `final_balance_vs_no_stress_usd`, the balance at year end less the balance of the run without the event.',
    `- The scenarios, by \`stress\` of the config: \`depeg\` values a USDC at $${sizes.depeg.price.toFixed(2)} for ${
      sizes.depeg.days
    } days and hits no venue (—); \`curator_bad_debt\` takes ${
      sizes.curator_bad_debt.loss_percent
    }% of the position in the venue hit; \`protocol_hack\` takes ${
      sizes.protocol_hack.loss_percent
    }% of it, and the venue pays nothing afterwards; \`withdrawal_freeze\` lets nothing out of the venue hit for ${
      sizes.withdrawal_freeze.days
    } days.`,
    `- Venue hit: \`provider_hit\`, the venue \`provider\` of the scenario names in the config, taken on the first day: \`largest\` is the venue with the vault's largest position that day, \`largest_morpho\` the largest among the curated Morpho vaults. ${HIT.map(
      (scenario) =>
        `\`${scenario}\` takes ${[...new Set(runs.map((run) => run.config.stress[scenario].provider))]
          .map((choice) => {
            const chosen = runs.filter((run) => run.config.stress[scenario].provider === choice);
            return `\`${choice}\` in ${
              chosen.length === runs.length ? 'every run' : chosen.map((run) => `\`${run.name}\``).join(', ')
            }`;
          })
          .join(' and ')}`
    ).join('; ')}.`,
    ...(uncurated.length === 0
      ? []
      : [
          `- \`curator_bad_debt\` hits a venue that has no curator in ${uncurated.join(
            ', '
          )}: there it is the loss of ${
            sizes.curator_bad_debt.loss_percent
          }% of the vault's largest position, whatever the venue is.`,
        ])
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Venues

/** The rows of the rule's table for a provider, one per month. */
function ruleRows(network: Network, provider: string): Row[] {
  const rows = network.rule.filter((row) => row.provider === provider);
  if (rows.length !== network.months.length)
    throw new Error(`${network.name}: ${provider} has ${rows.length} months in venue-eligibility.csv`);
  return rows;
}
const monthsIn = (rows: Row[], set: string) => rows.filter((row) => row[set] === '1').length;

/** The venue's contract, as client-pack.ts gives it, and whether a Thesauros provider contract reads it. */
function contractOf(network: Network, token: string, provider: string): [string, string] {
  const [{ kind, address }] = ruleRows(network, provider);
  const deployment = (deployments as Record<string, NetworkDeployment | undefined>)[network.name];
  const vault = (deployment?.vaults as Record<string, VaultDeployment | undefined> | undefined)?.[token];
  if (!deployment || !vault) throw new Error(`${network.name}: no ${token} vault in the networks library`);
  const live = vault.providers.find((entry) => entry.name === provider);
  if (live) {
    const market = live.kind === ProviderKindEnum.AaveV3 ? deployment.external.aaveV3.pool : live.market;
    if (market.toLowerCase() !== address.toLowerCase())
      throw new Error(`${provider}: ${market} in the networks library, ${address} in venue-eligibility.csv`);
    return [`\`${market}\``, 'yes: a provider of the live vault'];
  }
  if (kind === 'morpho-market')
    return [`\`${MORPHO}\`, market \`${address}\``, `no: needs a new adapter (${NO_ADAPTER[kind]})`];
  if (kind === 'morpho')
    return [
      `\`${address}\``,
      'yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it',
    ];
  if (!NO_ADAPTER[kind]) throw new Error(`${provider}: whether a ${kind} venue has an adapter is not known here`);
  return [`\`${address}\``, `no: needs a new adapter (${NO_ADAPTER[kind]})`];
}

function venues(network: Network, runs: Run[]): string[] {
  const providers = [...new Set(runs.flatMap((run) => run.config.providers))];
  say(`${network.name}, over the ${network.readings.length} readings of \`raw.jsonl\`:`);
  table(
    [
      'Venue',
      'Contract',
      'Index growth over the year',
      'Average rate',
      'With $6M of ours',
      'With $10M of ours',
      'Size',
      'Lowest free liquidity',
      ...setsShown().map((set) => `Months in ${setName(set)}`),
      'Thesauros adapter',
    ],
    providers.map((provider) => {
      const value = (reading: Reading, field: string) => reading.values[`${provider}.${field}`];
      // A venue with no index does not exist yet, as simulate.ts reads it.
      const read = network.readings.filter((reading) => Number(value(reading, 'index') ?? 0) > 0);
      if (read.length === 0) throw new Error(`${network.name}: ${provider} has no reading`);
      const [first, last] = [read[0], read[read.length - 1]];
      const growth = Number(value(last, 'index')) / Number(value(first, 'index'));
      const allYear = first === network.readings[0] && last === network.readings[network.readings.length - 1];
      const after = (probe: string) => {
        const taken = read.filter((reading) => value(reading, probe) != null);
        if (taken.length === 0) return 'refused at every reading';
        const refused = read.length - taken.length;
        return (
          percent(mean(taken.map((reading) => Number(value(reading, probe)) / 1e25))) +
          (refused ? ` (deposit refused at ${refused} readings)` : '')
        );
      };
      const supplied = read.map((reading) => Number(value(reading, 'supplied')) / 1e6);
      const rows = ruleRows(network, provider);
      return [
        network.labels[provider],
        contractOf(network, runs[0].config.token, provider)[0],
        percent((growth ** (YEAR / (last.t - first.t)) - 1) * 100) +
          (allYear
            ? ''
            : ` a year; ${percent((growth - 1) * 100)} from ${dayOf(first.t)} to ${dayOf(
                last.t
              )}: the venue has no reading before`),
        percent(mean(read.map((reading) => Number(value(reading, 'rate')) / 1e25))),
        after('rateAfter6'),
        after('rateAfter10'),
        `${size(Math.min(...supplied))} to ${size(Math.max(...supplied))}`,
        size(Math.min(...read.map((reading) => Number(value(reading, 'liquidity')) / 1e6))),
        ...setsShown().map((set) => `${monthsIn(rows, set)} of ${rows.length}`),
        contractOf(network, runs[0].config.token, provider)[1],
      ];
    })
  );
  // Spark sUSDC pays out of the Sky LitePSM it redeems through (TangemLensWide.sol): its
  // `liquidity` is no part of its `supplied`.
  return providers
    .filter((provider) => ruleRows(network, provider)[0].kind === 'susdc')
    .map((provider) => {
      const read = network.readings.filter((reading) => Number(reading.values[`${provider}.index`] ?? 0) > 0);
      const above = read.filter(
        (reading) => free(reading, provider) > Number(reading.values[`${provider}.supplied`]) / 1e6
      );
      return `- ${
        network.labels[provider]
      }: its free liquidity is the USDC of the Sky PSM the vault redeems through, which is no part of its size. It is above the size at ${thousands(
        above.length
      )} of its ${thousands(read.length)} readings.`;
    });
}

// ---------------------------------------------------------------------------------------------
// 5. The rule

function rule(network: Network): void {
  const names = [...new Set(network.rule.map((row) => row.venue))];
  const of = (venue: string) => network.rule.filter((row) => row.venue === venue);
  const label = (venue: string) => network.labels[of(venue)[0].provider] ?? venue;
  const marks = (rows: Row[], mark: (row: Row) => boolean) =>
    `\`${network.months.map((month) => (rows.some((row) => row.month === month && mark(row)) ? 'x' : '.')).join('')}\``;
  const [from, to] = [network.months[0], network.months[network.months.length - 1]];
  say(`${network.name}, the set by month, from the month that starts on ${from} to the one that starts on ${to}:`);
  table(
    ['Venue', ...setsShown().flatMap((set) => [`In ${setName(set)}`, 'Months'])],
    names
      .filter((venue) => setsShown().some((set) => monthsIn(of(venue), set) > 0))
      .map((venue) => [
        label(venue),
        ...setsShown().flatMap((set) => [
          marks(of(venue), (row) => row[set] === '1'),
          String(monthsIn(of(venue), set)),
        ]),
      ])
  );
  const large = (row: Row) => row.size_usd !== '' && num(row, 'size_usd') >= 100e6;
  if (reworked) {
    // A venue of set B the collector has no reader for: it has no provider, and no run holds it.
    const unread = names.filter((venue) => of(venue)[0].provider === '' && monthsIn(of(venue), 'in_set_broad') > 0);
    say(
      `${
        network.name
      }, the venues that are in set B in some month and have no \`provider\` in \`venue-eligibility.csv\`, so that no run holds them: ${
        unread.length === 0
          ? 'none'
          : unread
              .map(
                (venue) =>
                  `${venue} ${marks(of(venue), (row) => row.in_set_broad === '1')} (${monthsIn(
                    of(venue),
                    'in_set_broad'
                  )} months)`
              )
              .join(', ')
      }.`
    );
    // Set B asks for `pass` on tests 1 to 3: a test that could not be read keeps a candidate out
    // as a failed one does. The months at $100M or more in which that alone did so.
    const tests = (row: Row) => [row.test_1, row.test_2, row.test_3];
    const notRead = (row: Row) =>
      large(row) && row.in_set_broad !== '1' && !tests(row).includes('fail') && tests(row).includes('unverified');
    const unverified = names.filter((venue) => of(venue).some(notRead));
    say(
      `${
        network.name
      }, the candidates at $100M or more that are outside set B in months in which none of tests 1 to 3 failed and one could not be read (\`unverified\`), which counts as not passed: ${
        unverified.length === 0
          ? 'none'
          : unverified
              .map((venue) => {
                const months = of(venue).filter(notRead);
                const which = [1, 2, 3].filter((test) => months.some((row) => row[`test_${test}`] === 'unverified'));
                // A wrapper holds more than half of its assets through another venue.
                const through = [
                  ...new Set(
                    months
                      .filter((row) => row.held_through !== '' && num(row, 'held_through_percent') > 50)
                      .map((row) => row.held_through)
                  ),
                ];
                return `${label(venue)} ${marks(of(venue), notRead)} (${months.length} months; test${
                  which.length === 1 ? '' : 's'
                } ${which.join(' and ')} not read${
                  of(venue)[0].provider === '' ? '; no `provider`, so no run holds it' : ''
                }${through.length === 0 ? '' : `; held through ${through.join(' and ')}, so a wrapper too`})`;
              })
              .join(', ')
      }.`
    );
  }
  // The percent in a reason changes from month to month, so reasons are counted with the figures taken out.
  const shape = (row: Row) => row.reason.replace(/[\d.]+%/g, '%');
  say(
    `${network.name}, the candidates that held $100M or more in at least one month and were never in ${setName(
      'in_set'
    )}:`
  );
  table(
    [
      'Candidate',
      'Kind',
      'Months at $100M or more',
      'Which',
      ...setsShown()
        .slice(1)
        .map((set) => `Months in ${setName(set)}`),
      'Why it was out in those months',
    ],
    names
      .filter((venue) => of(venue).some(large) && monthsIn(of(venue), 'in_set') === 0)
      .map((venue) => {
        const months = of(venue).filter(large);
        const times = (row: Row) => months.filter((other) => shape(other) === shape(row)).length;
        const most = months.reduce((top, row) => (times(row) > times(top) ? row : top));
        // The first percent of a reason is the share it turns on. Where it differs between the
        // months that share the reason, one month's figure would stand for all: the range is shown.
        const shares = months
          .filter((row) => shape(row) === shape(most))
          .map((row) => /[\d.]+(?=%)/.exec(row.reason)?.[0])
          .filter((share): share is string => share !== undefined)
          .sort((a, b) => Number(a) - Number(b));
        const [low, high] = [shares[0], shares[shares.length - 1]];
        return [
          label(venue),
          most.kind,
          String(months.length),
          marks(of(venue), large),
          ...setsShown()
            .slice(1)
            .map((set) => String(monthsIn(of(venue), set))),
          low === high
            ? `${most.reason} (the reason of ${times(most)} of the ${months.length}, as written for ${most.month})`
            : `${most.reason.replace(/[\d.]+%/, `${low}% to ${high}%`)} (the reason of ${times(most)} of the ${
                months.length
              }, with the lowest and the highest figure of those months)`,
        ];
      })
  );
  // A curated vault is the kind the fourth test was written for, and the kind the same-book and
  // wrapper clauses leave out.
  const passing = network.rule.filter(
    (row) =>
      (row.kind === 'morpho' || row.kind === 'morpho-v2') &&
      ['test_1', 'test_2', 'test_3', 'test_4'].every((test) => row[test] === 'pass')
  );
  const sameBook = passing.filter((row) => row.in_set !== '1' && row.reason.startsWith('same book'));
  const wrapper = passing.filter((row) => row.in_set !== '1' && row.reason.startsWith('wrapper'));
  const inside = passing.filter((row) => row.in_set === '1');
  if (sameBook.length + wrapper.length + inside.length !== passing.length)
    throw new Error(`${network.name}: a vault-month passes the four tests and is out for another reason`);
  const inMarket = sameBook.map((row) => num(row, 'largest_set_market_percent'));
  say(
    `${network.name}, the months of the Morpho vaults (kinds \`morpho\` and \`morpho-v2\`) that pass the four tests:`
  );
  table(
    [
      'Vault-months that pass the four tests',
      `In ${setName('in_set')}`,
      'Left out as the same book',
      'Their share in that one market',
      'Left out as a wrapper',
      `In ${setName('in_set_vaults_kept')}`,
    ],
    [
      [
        String(passing.length),
        String(inside.length),
        String(sameBook.length),
        sameBook.length ? `${percent(Math.min(...inMarket))} to ${percent(Math.max(...inMarket))}` : '—',
        String(wrapper.length),
        String(monthsIn(passing, 'in_set_vaults_kept')),
      ],
    ]
  );
}

// ---------------------------------------------------------------------------------------------
// 6. Shared exposure

function sharedExposure(runs: Run[]): void {
  const rows: string[][] = [];
  /** Markets of the runs that never pass the four tests: no row of the rule looks through to them. */
  const unseen = new Set<string>();
  for (const run of runs) {
    const { network, config } = run;
    const monthly = new Map(config.providers.map((provider) => [provider, ruleRows(network, provider)]));
    for (const market of config.providers.filter((provider) => monthly.get(provider)![0].kind === 'morpho-market')) {
      const days = run.daily.thesauros_simple;
      if (monthsIn(monthly.get(market)!, 'in_set') === 0) unseen.add(config.labels[market]);
      let [direct, through, most, when] = [0, 0, 0, ''];
      for (const day of days) {
        const month = network.months.filter((item) => item <= day.date).pop();
        const own = num(day, column(run, market));
        // What the vaults held that day, at the share each had in this market at the month's reading.
        const via = config.providers.reduce((sum, provider) => {
          const row = monthly.get(provider)!.find((item) => item.month === month);
          if (!row) throw new Error(`${run.name}: ${provider} has no row of the rule for ${day.date}`);
          return provider !== market && row.largest_set_market === monthly.get(market)![0].venue
            ? sum + (num(day, column(run, provider)) * num(row, 'largest_set_market_percent')) / 100
            : sum;
        }, 0);
        direct += own / days.length;
        through += via / days.length;
        if (own + via > most) [most, when] = [own + via, day.date];
      }
      rows.push([
        `\`${run.name}\``,
        config.labels[market],
        percent(direct + through, 1),
        percent(direct, 1),
        percent(through, 1),
        // A market the vault never held, itself or through a vault, has no highest day.
        when === '' ? '—' : `${percent(most, 1)} on ${when}`,
      ]);
    }
  }
  if (rows.length === 0) return;
  say(
    '## 6. Shared exposure',
    'The share of the vault that sat in a single Morpho Blue market, directly and through the vaults that lend into it.'
  );
  table(['Run', 'Market', 'Average', 'Of it held directly', 'Of it through vaults', 'Highest day'], rows);
  say(
    "- Directly: the market's own column of the daily file. Through vaults: each other venue's column times `largest_set_market_percent` of its row in `venue-eligibility.csv` for the month the day falls in, where `largest_set_market` is this market.",
    "- Highest day: the largest sum of the two parts at one day's close, and that day. It is a single close, not a period: the average says how the year went.",
    '- It is an approximation: the look-through is read once a month, at the first reading of the month, and applied to every day of it.',
    "- It is a lower bound where a vault lends into two markets of the set: the table has a vault's share in the one market of the set where it has the most, and only for a market that passes the rule that month.",
    ...(unseen.size === 0
      ? []
      : [
          `- No look-through is read for a market that passes the four tests in no month (${[...unseen].join(
            ', '
          )}): its figure is what the vault held in it directly, and what the vaults of the run lend into it is not counted.`,
        ]),
    ...(rows.some((row) => row[5] === '—')
      ? ['- — in the highest day: the vault held nothing in the market on any day, itself or through a vault.']
      : [])
  );
}

// ---------------------------------------------------------------------------------------------
// 7. Interest by venue

function interestByVenue(runs: Run[]): void {
  const rows: string[][] = [];
  let falls = 0;
  /** The venues that paid less than nothing over the year. */
  const lost: string[] = [];
  for (const run of runs) {
    const days = run.daily.thesauros_simple;
    const { providers, labels } = run.config;
    for (const day of days) {
      const paid = providers.map((provider) => num(day, column(run, provider, 'interest')));
      falls += paid.filter((value) => value < 0).length;
      const left = paid.reduce((sum, value) => sum + value, 0) - num(day, 'gas_spent_usd') - num(day, 'fees_paid');
      // Every figure of the line is rounded to the cent.
      if (Math.abs(left - num(day, 'daily_yield')) > (providers.length + 3) * 0.005 + 1e-9)
        throw new Error(`${run.name}: interest less gas and fees is not the yield of ${day.date}`);
    }
    const year = providers
      .map((provider): [string, number] => [
        labels[provider],
        days.reduce((sum, day) => sum + num(day, column(run, provider, 'interest')), 0),
      ])
      .sort((a, b) => b[1] - a[1]);
    const all = year.reduce((sum, [, value]) => sum + value, 0);
    lost.push(...year.filter(([, value]) => value < 0).map(([venue]) => `${venue} in \`${run.name}\``));
    for (const [venue, value] of year)
      rows.push([`\`${run.name}\``, venue, usd(value), percent((value / all) * 100, 1)]);
    rows.push([`\`${run.name}\``, 'All venues', usd(all), percent(100, 1)]);
  }
  say(
    '## 7. Interest by venue',
    'What `thesauros_simple` earned in each venue over the year, before gas and before its fee.'
  );
  table(['Run', 'Venue', 'Interest for the year', "Share of the run's interest"], rows);
  say(
    "- Interest: the sum over the year of the venue's `interest_` column of `thesauros_simple` in `tangem-simulation-daily.csv`: what the venue paid on the position that day, before gas and before the fee. It is the growth of the venue's index between two readings, scaled by the measured ratio of its rate with our deposit to its rate without it and never above that growth. A fall of the index is a negative figure. " +
      (falls === 0 ? 'No venue has one on any day of these runs.' : `${falls} venue-days of these runs have one.`),
    '- All venues: their sum. Less the gas of the year it is the yield before the fee of table 1.',
    '- The script stops unless, on every day, the interest of the venues less `gas_spent_usd` and `fees_paid` is `daily_yield`, within the rounding of those columns to the cent.',
    ...(lost.length === 0
      ? []
      : [
          `- A venue that lost over the year has a share below zero (${lost.join(
            ', '
          )}), and the shares of the other venues of that run then add to more than 100%.`,
        ])
  );
}

// ---------------------------------------------------------------------------------------------
// 8. Liquidity episodes

function episodes(runs: Run[]): void {
  const rows: string[][] = [];
  const minute = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const fine = (value: number) => (value >= 1e5 ? `$${(value / 1e6).toFixed(2)}M` : usd(value));
  for (const run of runs) {
    const days = run.daily.thesauros_simple;
    const { providers, labels } = run.config;
    const seenOn = looks(run);
    const filed = (day: Row) => num(day, 'available_liquidity') / num(day, 'total_assets');
    const short = (day: Row | undefined) =>
      day !== undefined && num(day, 'available_liquidity') < num(day, 'total_assets');
    for (let first = 0; first < days.length; first++) {
      if (!short(days[first])) continue;
      let last = first;
      while (short(days[last + 1])) last++;
      const span = days.slice(first, last + 1);
      const low = span.reduce((a, b) => (filed(b) < filed(a) ? b : a));
      const seen = span.flatMap((day) => seenOn.get(day.date)!);
      const venues = providers.flatMap((provider) => {
        const hits = seen.filter(
          ([reading, held]) =>
            held[labels[provider]] >= rounding(run) && held[labels[provider]] > free(reading, provider)
        );
        if (hits.length === 0) return [];
        const [reading, held] = hits.reduce((a, b) => (free(b[0], provider) < free(a[0], provider) ? b : a));
        const count = new Set(hits.map(([hit]) => hit.t)).size;
        return [
          `${labels[provider]}: at ${count} reading${count === 1 ? '' : 's'}, the lowest ${fine(
            free(reading, provider)
          )} free at ${minute(reading.t)} UTC against ${fine(held[labels[provider]])} held`,
        ];
      });
      if (venues.length === 0) throw new Error(`${run.name}: no venue explains the days from ${span[0].date}`);
      rows.push([
        `\`${run.name}\``,
        span[0].date,
        span[span.length - 1].date,
        String(span.length),
        String(span.filter((day) => filed(day) < 0.5).length),
        `${percent(filed(low) * 100)} on ${low.date}`,
        venues.join('; '),
      ]);
      first = last;
    }
  }
  if (rows.length === 0) return;
  say(
    '## 8. Liquidity episodes',
    'The days of `thesauros_simple` on which less than the whole balance could be withdrawn, consecutive days as one episode.'
  );
  table(
    [
      'Run',
      'From',
      'To',
      'Days',
      'Of them under half',
      'Lowest share that could be withdrawn',
      'Venues that held more than they had free',
    ],
    rows
  );
  say(
    '- A day counts when `available_liquidity` is under `total_assets` in `tangem-simulation-daily.csv`; the share is one over the other. The days of this table are the days table 2 does not count as whole to the cent.',
    "- Venues: at each reading of `raw.jsonl` on those days the vault's position in a venue, once the movements of that reading are made, is set against the venue's `liquidity` at that reading, and each day's closing position against the first reading after it; that is how `available_liquidity` is taken. A venue is named when its position was above its free liquidity at one of them, with the number of such readings and the one at which it had the least free. Positions are rebuilt as for the largest share in table 2.",
    `- The script stops unless the lowest share so rebuilt for a day, of every day of the year, is within ${percent(
      REBUILT_WITHIN * 100,
      1
    )} of the balance of the share in the daily file.`
  );
}

// ---------------------------------------------------------------------------------------------
// 9. Fee

/**
 * The balance of thesauros_simple at the end of the year had the fee been `fee` percent of each
 * positive day, from the run's own daily file (PROGRAMME.md, point 12). A day's return before
 * the fee is the interest of the venues less the gas, over the balance at the close of the day
 * before (the deposit for the first day); the fee takes its share of a positive one.
 */
function balanceAt(run: Run, fee: number): number {
  const days = run.daily.thesauros_simple;
  return days.reduce((balance, day, d) => {
    const paid = run.config.providers.reduce((sum, provider) => sum + num(day, column(run, provider, 'interest')), 0);
    const before = d === 0 ? run.config.initial_deposit : num(days[d - 1], 'total_assets');
    const gross = (paid - num(day, 'gas_spent_usd')) / before;
    return balance * (1 + gross - (fee / 100) * Math.max(0, gross));
  }, run.config.initial_deposit);
}

/** The fee at which balanceAt is the balance of Just Aave. The balance falls as the fee rises, so halving finds it. */
function breakEvenByDay(run: Run): string {
  const aave = run.config.initial_deposit + earned(run, 'just_aave');
  if (balanceAt(run, 0) <= aave) return 'none: below Just Aave before any fee';
  if (balanceAt(run, 100) > aave) throw new Error(`${run.name}: above Just Aave at a fee of 100%`);
  let [low, high] = [0, 100];
  while (high - low > 0.001) {
    const middle = (low + high) / 2;
    if (balanceAt(run, middle) > aave) low = middle;
    else high = middle;
  }
  return percent(low, 1);
}

function feeTable(runs: Run[], checks: Run[]): void {
  const own = (run: Run) => run.config.performance_fee_percent;
  const filed = (run: Run) => num(lastDay(run, 'thesauros_simple'), 'total_assets');
  // The files are in cents: at its own fee a run must come back to its own balance.
  const gap = (run: Run) => {
    const value = balanceAt(run, own(run)) - filed(run);
    if (!(Math.abs(value) <= 1))
      throw new Error(`${run.name}: its daily returns at its own fee end $${value.toFixed(2)} from its balance`);
    return value;
  };
  const at = (title: string, balanceOf: (run: Run) => number): [string, (run: Run) => string][] => [
    [
      `${title}: balance at the end of the year, and yield`,
      (run) => `${usd(balanceOf(run))} (${percent(ofDeposit(run, balanceOf(run) - run.config.initial_deposit))})`,
    ],
    [
      `${title}: against Just Aave`,
      (run) => difference(run, balanceOf(run) - run.config.initial_deposit - earned(run, 'just_aave')),
    ],
  ];
  say(
    '## 9. Fee',
    'What `thesauros_simple` would hold at another performance fee, worked out from the daily file of the run.'
  );
  perRun(runs, [
    ...FEES.flatMap((percentage) => at(`At a fee of ${percentage}%`, (run) => balanceAt(run, percentage))),
    ['The fee the run was made at', (run) => `${own(run)}%`],
    ...at('At that fee, the run itself', filed),
    [
      'At that fee: the balance worked out less the balance of the run',
      (run) => {
        const value = gap(run);
        return Math.abs(value) < 0.005 ? '$0.00' : `${value < 0 ? '−' : '+'}$${Math.abs(value).toFixed(2)}`;
      },
    ],
    ['The fee at which the balance worked out is that of Just Aave', breakEvenByDay],
  ]);
  // A check run is the config of a column but for its fee and its output folder.
  const sameBut = ({ config }: Run) => JSON.stringify({ ...config, performance_fee_percent: 0, output: '' });
  const made = checks.flatMap((check) => {
    const columns = runs.filter((run) => sameBut(run) === sameBut(check));
    if (columns.length === 0) throw new Error(`${check.name}: no run given has this config at another fee`);
    return columns.map((run) => {
      const over = balanceAt(run, own(check)) - filed(check);
      return `- \`${check.name}\` is \`${run.name}\` made at a fee of ${own(check)}%, in the output folder \`${
        check.config.output ?? 'simulation'
      }\`${
        packFolder(check) === 'none'
          ? '; the pack has its config and no copy of its files'
          : `; its files are in ${packFolder(check)} of the pack`
      }. The balance of \`${run.name}\` worked out at ${own(check)}%: ${usd(
        balanceAt(run, own(check))
      )}. The balance of the run made at ${own(check)}%: ${usd(filed(check))}. Worked out less made: ${
        Math.round(over) === 0 ? usd(0) : signed(over, usd(over))
      }.`;
    });
  });
  say(
    "- A day's return before the fee: the sum of the `interest_` columns of the day less `gas_spent_usd`, over `total_assets` of the day before, the deposit for the first day. At a fee the balance of a day is the balance of the day before times one plus the return, less the fee's share of the return when it is positive. The year starts on the deposit.",
    '- Yield: the balance less the deposit, in percent of the deposit. Against Just Aave: the same less the yield of Just Aave of table 1.',
    '- At the fee the run was made at the arithmetic is the run itself, so those two rows show `total_assets` of the last day, as table 1 does. The script stops unless the balance worked out at that fee is within $1 of it: the files are in cents, and the row after shows what the rounding leaves.',
    '- At 0% the yield is above the yield before the fee of table 1: that one adds the fees of the year to the yield, without what they would have earned had they stayed in the vault.',
    '- The fee at which the balance is that of Just Aave: found by halving between 0% and 100% on the same arithmetic. The break-even fee of table 1 is its approximation in one line.',
    '- The arithmetic keeps the returns of the run as they are. A run made at another fee differs: with a lower fee the vault is larger, so each venue pays a little less on a larger position and a move is decided on other amounts.' +
      (made.length === 0 ? '' : ' The runs below were made at another fee to measure it.'),
    ...made
  );
}

// ---------------------------------------------------------------------------------------------
// 10. Venues held

function venuesHeld(runs: Run[]): void {
  /** For each day of thesauros_simple, the venues that hold HELD_FROM percent of the vault or more at its close. */
  const held = (run: Run) =>
    run.daily.thesauros_simple.map(
      (day) => run.config.providers.filter((provider) => num(day, column(run, provider)) >= HELD_FROM).length
    );
  if (runs.some((run) => held(run).includes(0)))
    throw new Error('A day has no venue at the share a venue is held from');
  const most = Math.max(...runs.flatMap(held));
  // The venues an allocator run held alone on a day, and whether each is the run's entry provider.
  const lone = runs.filter(allocator).flatMap((run) =>
    run.daily.thesauros_simple.flatMap((day) => {
      const venues = run.config.providers.filter((provider) => num(day, column(run, provider)) >= HELD_FROM);
      return venues.length === 1
        ? [{ venue: run.config.labels[venues[0]], entry: venues[0] === run.config.entry_provider }]
        : [];
    })
  );
  const alone = new Set(lone.map(({ venue }) => venue));
  const entryOnly = lone.every(({ entry }) => entry);
  /** The largest venue column of the year, of every venue or of one, with its venue and the first day it is reached. */
  const top = (run: Run, providers = run.config.providers) => {
    let best = { share: -1, venue: '', date: '' };
    for (const day of run.daily.thesauros_simple)
      for (const provider of providers) {
        const share = num(day, column(run, provider));
        if (share > best.share) best = { share, venue: run.config.labels[provider], date: day.date };
      }
    return `${percent(best.share)} in ${best.venue} on ${best.date}`;
  };
  say('## 10. Venues held', "`thesauros_simple`, at each day's close.");
  perRun(runs, [
    ...Array.from({ length: most }, (_unused, n): [string, (run: Run) => string] => [
      `Days with ${n + 1} venue${n === 0 ? '' : 's'}`,
      (run) => String(held(run).filter((count) => count === n + 1).length),
    ]),
    ['Venues held, mean over the days', (run) => mean(held(run)).toFixed(2)],
    ['Largest share of the vault in one venue', (run) => top(run)],
    ['The most the entry provider held', (run) => top(run, [run.config.entry_provider])],
  ]);
  say(
    `- A venue is held on a day when its column of \`tangem-simulation-daily.csv\` is ${HELD_FROM}% of the vault or more at that day's close. The rows go up to the most venues any run held on one day.`,
    "- Largest share: the highest venue column of the year, with its venue and the first day it is reached. The entry provider is `entry_provider` of the config, where a deposit lands. The allocator does not cap it, so it can hold the whole vault; under the public vault's rules a rebalance caps it as it caps every venue.",
    `- The cap of ${cap(
      runs[0]
    )}% of the vault acts when a rebalance executes: between two rebalances a venue that earns more than the others stands a little above it.`,
    ...(alone.size === 0
      ? []
      : [
          `- The allocator has no minimum of two venues. On the days of an allocator run with one venue, that venue is ${[
            ...alone,
          ].join(' or ')}${entryOnly ? ', the entry provider, which it does not cap' : ''}.`,
        ])
  );
}

// ---------------------------------------------------------------------------------------------
// 11. Movements against the source's own free liquidity and interest that could not be withdrawn

/**
 * The interest a strategy was credited on the days a venue could not have paid its position out
 * (PROGRAMME.md, point 11), all the interest it was credited, and those days by venue. A day
 * counts for a venue when the position in it was above its free liquidity where looks() sets one
 * against the other: at a reading of the day once its movements are made, or at the first
 * reading after the day's close. That is how table 8 and `available_liquidity` take a day, so a
 * venue the vault held while it was short counts whether or not it was still held at the close.
 */
const credited = new Map<string, { interest: number; all: number; days: Map<string, number> }>();
function unpayable(run: Run, strategy: string): { interest: number; all: number; days: Map<string, number> } {
  const known = credited.get(`${run.name} ${strategy}`);
  if (known) return known;
  const days = new Map<string, number>();
  let [interest, all] = [0, 0];
  const seenOn = looks(run, strategy);
  for (const day of run.daily[strategy]) {
    for (const provider of run.config.providers) {
      const venue = run.config.labels[provider];
      const paid = num(day, column(run, provider, 'interest'));
      all += paid;
      if (
        seenOn
          .get(day.date)!
          .some(([reading, held]) => held[venue] >= rounding(run) && held[venue] > free(reading, provider))
      ) {
        interest += paid;
        days.set(venue, (days.get(venue) ?? 0) + 1);
      }
    }
  }
  credited.set(`${run.name} ${strategy}`, { interest, all, days });
  return { interest, all, days };
}

function notWithdrawable(runs: Run[]): void {
  const tally = (counts: Map<string, number>) =>
    [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([venue, count]) => `${venue} ${count}`)
      .join(', ') || '—';
  const rowsOf = (strategy: string): [string, (run: Run) => string][] => [
    [
      `\`${strategy}\`: interest credited on venue-days short of liquidity`,
      (run) => usd(unpayable(run, strategy).interest),
    ],
    [
      `\`${strategy}\`: its share of the interest of the year`,
      (run) => percent((unpayable(run, strategy).interest / unpayable(run, strategy).all) * 100, 1),
    ],
    [
      `\`${strategy}\`: such venue-days`,
      (run) => String([...unpayable(run, strategy).days.values()].reduce((sum, count) => sum + count, 0)),
    ],
    [`\`${strategy}\`: their venues, with the days of each`, (run) => tally(unpayable(run, strategy).days)],
  ];
  say(
    "## 11. Movements against the source's own free liquidity and interest that could not be withdrawn",
    "What `thesauros_simple` took out of a venue beyond the venue's own free liquidity, and the interest it was credited in a venue on days the venue could not have paid its position out."
  );
  perRun(runs, [
    ['Movements that took out more than the source venue had free without us', (run) => String(aboveFree(run).length)],
    ['Their amount', (run) => usd(aboveFree(run).reduce((sum, move) => sum + num(move, 'amount'), 0))],
    [
      'Their sources, with the movements of each',
      (run) =>
        tally(
          aboveFree(run).reduce(
            (counts, move) => counts.set(move.from, (counts.get(move.from) ?? 0) + 1),
            new Map<string, number>()
          )
        ),
    ],
    ...rowsOf('thesauros_simple'),
  ]);
  say('The same interest for the four controls, which sit in venues through such days too:');
  perRun(runs, STRATEGIES.slice(1).flatMap(rowsOf));
  say(
    '- More than the source had free: the movements of table 2, rows of `tangem-simulation-rebalances.csv` with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid. The run lets such a movement execute: it takes our own deposit to be payable next to that liquidity, in whole with rate impact on and in the liquid share of the venue with it off. Whether the venue would have paid it on chain is not in the history.',
    "- Interest on venue-days short of liquidity: the simulator credits the growth of a venue's index whether or not the venue could have paid the vault out. A venue-day counts when the position in the venue is above the venue's `liquidity` at a reading of `raw.jsonl` on that day, once the movements of that reading are made, or when the day's closing position is above its `liquidity` at the first reading after the close. That is how table 8 names its venues and how `available_liquidity` is taken, so a venue that was short while the vault held it counts whether or not it was still held at the close. The figure is the sum of the venue's `interest_` column over such days. It is the interest of the whole day, the finest the daily file has: the most that was credited while the venue was short, with the hours of such a day on which the venue could have paid in it.",
    '- Share: of the sum of every `interest_` column of the strategy over the year, in which a fall of an index is the negative figure it is. Positions are rebuilt as for the largest share in table 2, and a position under 0.01% of the deposit is not weighed.',
    `- A control is credited the same way, so its yield in table 1 has this interest in it. Its positions are rebuilt from its own days and its own movements in \`tangem-simulation-rebalances.csv\`; \`just_aave\` and \`just_best_vault\` have none. For every strategy the script stops unless the lowest share of the balance so payable on a day is within ${percent(
      REBUILT_WITHIN * 100,
      1
    )} of the balance of \`available_liquidity\` over \`total_assets\` in the daily file.`,
    '- —: no such movement, or no such venue-day.'
  );
}

// ---------------------------------------------------------------------------------------------

function main(): void {
  const given = process.argv.slice(2);
  const named = (key: string) =>
    given.filter((arg) => arg.startsWith(`${key}=`)).map((arg) => arg.slice(key.length + 1));
  const paths = given.filter((arg) => !/^(out|check)=/.test(arg));
  if (paths.length === 0) throw new Error('Usage: pack-figures.ts [out=<file>] <config>... [check=<config>]...');
  const runs = paths.map(loadRun);
  const checks = named('check').map(loadRun);
  reworked = runs.some(allocator);
  if (
    new Set(runs.map((run) => `${cap(run)} ${run.config.initial_deposit}`)).size !== 1 ||
    runs.some((run) => !run.config.risk_guard_enabled)
  )
    throw new Error('The definitions are worded for runs with RiskGuard on, one provider cap and one deposit');
  say(
    '# Figures of the Tangem pack',
    'Written by `reproduce/figures.js` (its source is `reproduce/src/pack-figures.ts`) from the files `reproduce/simulate.js` writes and from `raw.jsonl` and `venue-eligibility.csv` under `reproduce/data/tangem/<network>/`. Do not edit: run the script again.',
    'A run is named by its config: `base.deployed` is `config.base.deployed.json`. `simulate.js` writes the files of a run to the output folder of the table, under `reproduce/data/tangem/<network>/`. The pack has the same files, byte for byte, in the run folder of the table; a run without one is in the pack as its config only.'
  );
  table(
    [
      'Run',
      'Config',
      'Network',
      'Output folder of `simulate.js`',
      'Run folder of the pack',
      'Venues',
      'Fee',
      'Rate impact',
      'Limit on our share of a venue',
      'Venue rule',
    ],
    runs.map((run) => [
      `\`${run.name}\``,
      `\`${basename(run.path)}\``,
      run.config.network,
      `\`${run.config.output ?? 'simulation'}\``,
      packFolder(run),
      run.config.providers.map((provider) => run.config.labels[provider]).join(', '),
      `${run.config.performance_fee_percent}%`,
      run.config.rate_impact_enabled ? 'on' : 'off',
      run.config.max_share_of_venue_percent === undefined ? 'none' : `${run.config.max_share_of_venue_percent}%`,
      ruleOf(run),
    ])
  );
  say(
    '- Rate impact: `rate_impact_enabled` of the config. On: a position earns the rate the deposit probes measured with it in the venue, and the venue can pay it out next to its own liquidity. Off: the deposit moves no rate, and the venue pays its liquid share of itself with the position in it.',
    `- Limit on our share of a venue: \`max_share_of_venue_percent\` of the config. A venue takes no new money while a full position, ${cap(
      runs[0]
    )}% of the vault, would be more than that share of the venue with the position in it, and what the vault holds there leaves when the decision moves it and the move can execute.${
      reworked
        ? ' The allocator also keeps what it aims to hold in a venue within that share of it, the entry provider excepted.'
        : ''
    } The limit is tested when a move is decided: a venue that shrinks under a position the vault cannot take out leaves the vault above it, and the largest share of table 2 is the share the vault reached.`
  );
  result(runs);
  behaviour(runs);
  stress(runs);
  say('## 4. Venues', 'Every venue of the runs given.');
  const notes = [...networks.values()].flatMap((network) =>
    venues(
      network,
      runs.filter((run) => run.network === network)
    )
  );
  say(
    '- Contract: the Aave pool, the Comet, the vault or the token; for a single Morpho Blue market, Morpho Blue and the market id.',
    '- Index growth: the last `index` over the first, minus one, raised to a year by the seconds between the two readings. It is what a deposit in the venue earned, a fall of the index included. For a venue whose first reading is later than the first of the window both figures are shown: the growth raised to a year, and the growth between its two readings, which is all a deposit could have earned there.',
    '- Average rate: the mean of `rate` over the readings. With $6M and $10M of ours: the mean of `rateAfter6` and `rateAfter10`, the rate read back after that deposit, over the readings at which the venue took it.',
    '- Size: the lowest and the highest `supplied`. Lowest free liquidity: the lowest `liquidity`.',
    reworked
      ? `- Months in a set: rows of \`venue-eligibility.csv\` with the column of the set equal to 1: ${Object.entries(
          SETS
        )
          .map(([name, set]) => `\`${name}\` for ${set}`)
          .join(', ')}.`
      : '- Months in the set: rows of `venue-eligibility.csv` with `in_set` and with `in_set_vaults_kept` equal to 1.',
    '- Thesauros adapter: yes for a provider of the live vault of the network in the networks library and for a MetaMorpho V1 vault, which the MorphoProvider contract of the live vaults reads; no for a Morpho Vault V2, a single Morpho Blue market, Fluid and Spark sUSDC.',
    ...notes
  );
  say(
    '## 5. The rule',
    `From \`venue-eligibility.csv\`, which has one row for every candidate and month. A mark is a month: \`x\` in the set${
      reworked ? ' the column names' : ''
    }, \`.\` not.`
  );
  for (const network of networks.values()) rule(network);
  say(
    `- $100M or more: \`size_usd\` of the month's row. Never in ${setName(
      'in_set'
    )}: no row with \`in_set\` equal to 1.${
      reworked ? ' Such a candidate may be in set A or in set B in some months: the two columns of months say so.' : ''
    }`,
    "- Why: the `reason` column of the reason met most often among the months at $100M or more. Reasons that differ only in a percent are counted as one. Where the percent is the same in all of them the earliest month's wording is shown verbatim; where it differs, its lowest and its highest among those months stand in its place.",
    `- Vault-months: rows of kind \`morpho\` or \`morpho-v2\` with \`test_1\` to \`test_4\` all \`pass\`. In ${setName(
      'in_set'
    )}: \`in_set\` is 1. Same book and wrapper: \`in_set\` is 0 and \`reason\` begins with that word; the share is \`largest_set_market_percent\`. ${
      reworked ? 'In set A' : 'With the vaults kept'
    }: \`in_set_vaults_kept\` is 1.`,
    '- A venue of the runs is named as the runs name it; the other candidates as `venue-eligibility.csv` names them.',
    ...(reworked
      ? [
          '- In set B: `in_set_broad` is 1. Set B is tests 1 to 3 of the rule whatever the collateral, without a venue that holds more than half of its assets through another venue of set B. Each of the three tests has to be `pass`: one that could not be read (`unverified`) keeps a candidate out as a failed one does, and the candidates it alone keeps out are named above. A venue of set B with an empty `provider` passes those tests and is not simulated: the collector has no reader for it.',
        ]
      : [])
  );
  sharedExposure(runs);
  interestByVenue(runs);
  episodes(runs);
  feeTable(runs, checks);
  venuesHeld(runs);
  notWithdrawable(runs);

  // Self-check: a table that could not be filled stops the script, and nothing is written.
  for (const [header, ...rows] of tables) {
    for (const row of rows) {
      const empty =
        row.length !== header.length ||
        row.some((cell) => cell === '' || /\b(NaN|undefined|Infinity|null)\b/.test(cell));
      if (empty) throw new Error(`A table has a cell that could not be filled: ${row.join(' | ')}`);
    }
    if (rows.length === 0) throw new Error(`A table has no rows: ${header.join(' | ')}`);
  }
  const text = out.join('\n');
  writeFileSync(resolve(named('out')[0] ?? 'data/tangem/figures.md'), text);
  process.stdout.write(text);
}

main();
