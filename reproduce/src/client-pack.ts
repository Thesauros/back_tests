/**
 * Builds the pack that goes to the partner: one folder per simulation run with its result
 * files and the market data of its venues, the venue rule and its monthly tables of each
 * network, the tables the readme quotes (figures-*.md), the programme of the runs, the check of
 * the allocator against production, and a `reproduce` folder with the simulator and the figures
 * script as single runnable files, the script that runs them all and compares, their sources,
 * the on-chain readings they run on and the transactions the gas of a movement is the median
 * of. Figures are copied, never recomputed.
 *
 * Run:
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/client-pack.ts <out dir> \
 *     base-vault-as-deployed=scripts/tangem/config.base.deployed.json ... \
 *     config=scripts/tangem/config.base.wide.no-rate-impact.json ...
 *
 * `config=<path>` ships a config for reproduction without a run folder.
 */
import { execFileSync } from 'child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { buildSync } from 'esbuild';
import { NetworkEnum, TokenEnum } from '@backend-ts/enums';
import { deployments, ProviderKindEnum } from '@backend-ts/networks';
import { TARGETS } from './targets';

interface Config {
  network: NetworkEnum;
  providers: string[];
  output: string;
  labels: Record<string, string>;
}
const [ROOT, ...args] = process.argv.slice(2);
const pairs = args.map((arg) => arg.split('='));
const runs = pairs.filter(([folder]) => folder !== 'config');
if (!ROOT || runs.length === 0) {
  throw new Error('Usage: client-pack.ts <out dir> <folder>=<config>... [config=<config>...]');
}

/** Morpho Blue, the same address on Ethereum and Base. */
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

/** The venue's contract and, for a single Morpho Blue market, its id in that contract. */
function addressOf(config: Config, provider: string): [string, string] {
  const network = deployments[config.network]!;
  const live = network.vaults[TokenEnum.USDC]!.providers.find((entry) => entry.name === provider);
  if (live) return [live.kind === ProviderKindEnum.AaveV3 ? network.external!.aaveV3!.pool : live.market, ''];
  const venue = TARGETS[config.network].extraVenues.find((entry) => entry.name === provider)!;
  return venue.kind === 'morpho-market' ? [MORPHO, venue.market] : [venue.market, ''];
}

const read = (path: string) =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(','));
const write = (path: string, rows: string[][]) =>
  writeFileSync(path, rows.map((row) => row.join(',')).join('\n') + '\n');
/** As the collectors print a figure: cut to the digits, not rounded, in integers. */
function fixed(numerator: bigint, denominator: bigint, digits: number): string {
  const scaled = (numerator * 10n ** BigInt(digits)) / denominator;
  const text = scaled.toString().padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
const usd = (baseUnits: string) => (baseUnits === '' ? '' : fixed(BigInt(baseUnits), 10n ** 6n, 2));
const percentOfRay = (ray: string) => (ray === '' ? '' : fixed(BigInt(ray), 10n ** 25n, 6));

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
copyFileSync(join(__dirname, 'client', 'README.md'), join(ROOT, 'README.md'));

const REPRODUCE = join(ROOT, 'reproduce');
const simulationFiles = ['tangem-simulation-daily.csv', 'tangem-simulation-rebalances.csv', 'tangem-stress-tests.csv'];

for (const [folder, configPath] of runs) {
  const config: Config = JSON.parse(readFileSync(configPath, 'utf8'));
  const OUT = join(ROOT, folder);
  const network = config.network.toLowerCase();
  const DATA = join(process.cwd(), 'data/tangem', network);
  const label = (provider: string) => config.labels[provider];

  mkdirSync(join(OUT, 'simulation'), { recursive: true });
  mkdirSync(join(OUT, 'market-data'), { recursive: true });
  for (const file of [...simulationFiles, 'tangem-stress-timelines.csv']) {
    copyFileSync(join(DATA, config.output, file), join(OUT, 'simulation', file));
  }
  execFileSync('zip', [
    '-q',
    '-j',
    join(OUT, 'tangem-simulation.zip'),
    ...simulationFiles.map((file) => join(OUT, 'simulation', file)),
  ]);

  const [ratesHeader, ...rates] = read(join(DATA, 'provider-rates.csv'));
  const at = (name: string) => ratesHeader.indexOf(name);
  write(join(OUT, 'market-data/venue-rates.csv'), [
    [
      'network',
      'venue',
      'venue_address',
      'market_id',
      'block_number',
      'timestamp',
      'datetime_utc',
      'deposit_rate_ray',
      'deposit_rate_percent',
      'deposit_rate_after_4m_percent',
      'deposit_rate_after_6m_percent',
      'deposit_rate_after_10m_percent',
      'total_supplied_usd',
      'available_liquidity_usd',
      'supply_index',
    ],
    ...rates
      .filter((row) => config.providers.includes(row[at('provider')]))
      .map((row) => [
        row[at('network')],
        label(row[at('provider')]),
        ...addressOf(config, row[at('provider')]),
        row[at('block_number')],
        row[at('timestamp')],
        row[at('datetime_utc')],
        row[at('deposit_rate')],
        row[at('deposit_rate_percent')],
        percentOfRay(row[at('deposit_rate_after_4m')]),
        percentOfRay(row[at('deposit_rate_after_6m')]),
        percentOfRay(row[at('deposit_rate_after_10m')]),
        usd(row[at('total_supplied')]),
        usd(row[at('available_liquidity')]),
        row[at('supply_index')],
      ]),
  ]);
  copyFileSync(join(DATA, 'gas.csv'), join(OUT, 'market-data/gas.csv'));
}
// The tables the readme quotes, a file a network and one for the first programme, the programme
// the runs were made under, and what check-allocator.ts printed for them.
for (const file of readdirSync(join(process.cwd(), 'data/tangem')).filter((name) => /^figures-.*\.md$/.test(name))) {
  copyFileSync(join(process.cwd(), 'data/tangem', file), join(ROOT, file));
}
copyFileSync(join(process.cwd(), 'data/tangem/allocator-check.txt'), join(ROOT, 'allocator-check.txt'));
copyFileSync(join(__dirname, 'client', 'PROGRAMME.md'), join(ROOT, 'PROGRAMME.md'));

// What the simulator and the figures script need to run again from the pack alone, and the venue
// rule month by month, every candidate of the network: the evidence for the sets of the runs.
for (const [, configPath] of pairs) {
  const network = (JSON.parse(readFileSync(configPath, 'utf8')) as Config).network.toLowerCase();
  const DATA = join(process.cwd(), 'data/tangem', network);
  mkdirSync(join(REPRODUCE, 'data/tangem', network), { recursive: true });
  mkdirSync(join(ROOT, 'venue-rule', network), { recursive: true });
  copyFileSync(join(DATA, 'raw.jsonl'), join(REPRODUCE, 'data/tangem', network, 'raw.jsonl'));
  for (const file of ['venue-eligibility.csv', 'venue-collateral-monthly.csv']) {
    copyFileSync(join(DATA, file), join(ROOT, 'venue-rule', network, file));
  }
  copyFileSync(join(DATA, 'venue-eligibility.csv'), join(REPRODUCE, 'data/tangem', network, 'venue-eligibility.csv'));
  copyFileSync(configPath, join(REPRODUCE, basename(configPath)));
}
// The rule as written, which the monthly tables and the sources cite, and the real rebalances
// whose median is the gas of one movement in simulate.ts.
copyFileSync(join(__dirname, 'client', 'VENUE_RULE.md'), join(ROOT, 'venue-rule', 'VENUE_RULE.md'));
copyFileSync(join(process.cwd(), 'data/tangem/rebalance-gas.csv'), join(REPRODUCE, 'data/tangem/rebalance-gas.csv'));

// The decision rules live in the allocation library; the rest of that package talks to
// databases and nodes and is left out of the bundle.
const bundle = (entry: string, outfile: string) =>
  buildSync({
    entryPoints: [join(__dirname, entry)],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: join(REPRODUCE, outfile),
    alias: { '@backend-ts/library': join(process.cwd(), 'libs/library/src/allocation/index.ts') },
    // A linked node_modules would put the path of its real folder into the bundle's comments.
    preserveSymlinks: true,
    logLevel: 'error',
  });
bundle('simulate.ts', 'simulate.js');
bundle('pack-figures.ts', 'figures.js');
copyFileSync(join(__dirname, 'client', 'reproduce.sh'), join(REPRODUCE, 'reproduce.sh'));
chmodSync(join(REPRODUCE, 'reproduce.sh'), 0o755);
const SRC = join(REPRODUCE, 'src');
mkdirSync(join(SRC, 'allocation'), { recursive: true });
for (const file of [
  'simulate.ts',
  'collect-history.ts',
  'collect-eligibility.ts',
  'candidates.ts',
  'targets.ts',
  'verify-on-fork.ts',
  'check-allocator.ts',
  'client-pack.ts',
  'pack-figures.ts',
  'TangemLens.sol',
  'lens.bytecode.json',
  'TangemLensWide.sol',
  'lens-wide.bytecode.json',
]) {
  copyFileSync(join(__dirname, file), join(SRC, file));
}
copyFileSync(join(process.cwd(), 'apps/rebalancer/fork/replay/policies.ts'), join(SRC, 'policies.ts'));
cpSync(join(process.cwd(), 'libs/library/src/allocation'), join(SRC, 'allocation'), {
  recursive: true,
  filter: (path) => !path.endsWith('.spec.ts'),
});
console.log(`Pack written to ${ROOT}`);
