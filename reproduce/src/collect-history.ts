/**
 * Tangem data pack: one year of a network's USDC venues, every ~4 hours. Rates, sizes,
 * withdrawable liquidity, growth indices and the rate after our own deposit (TS-389, TS-393),
 * gas (TS-390) and vault share price (TS-391).
 *
 * Every sample is one archive eth_call to Multicall3 plus one eth_feeHistory. Morpho rates
 * come from the production MorphoProvider bytecode, re-pointed at each MetaMorpho vault and
 * injected with a state override, so the series holds the number the engine itself reads,
 * including for the months before our providers were deployed. The same override gives the
 * lens a USDC balance; it deposits into each venue through the venue's own code, reads the
 * rate and rolls the deposit back. Before collecting, the script checks its reads against
 * the live providers at the end block and stops on any difference.
 *
 * Run (resumable, appends to data/tangem/<network>/raw.jsonl):
 *   set -a && source apps/rebalancer/.env && set +a
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/collect-history.ts Base
 *
 * RPC: the network's own variable (BASE_RPC_URL, ETHEREUM_RPC_URL; archive), else Alchemy
 * from ALCHEMY_API_KEY.
 * Lens: after editing TangemLens.sol, `forge build` it with solc 0.8.33, 200 optimizer runs,
 * and copy deployedBytecode.object into lens.bytecode.json.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AbiCoder, Interface, JsonRpcProvider, Transaction, ZeroAddress, keccak256, toBeHex, toQuantity } from 'ethers';
import { TokenEnum } from '@backend-ts/enums';
import { chains, deployments, ProviderKindEnum } from '@backend-ts/networks';
import { Kind, TARGETS, Venue } from './targets';

const target = TARGETS[process.argv[2]];
if (!target) throw new Error(`Usage: collect-history.ts ${Object.keys(TARGETS).join('|')}`);

const FROM_TIMESTAMP = Date.UTC(2025, 9, 7) / 1000;
const TO_TIMESTAMP = Date.UTC(2026, 9, 7) / 1000;
/** The fees of a sample are taken over the blocks that end at it: an hour on Ethereum, ten minutes on Base. */
const FEE_WINDOW_BLOCKS = 300;
const CONCURRENCY = 8;
const OUT_DIR = join(process.cwd(), 'data/tangem', target.network.toLowerCase());
const RAW_PATH = join(OUT_DIR, 'raw.jsonl');

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const L1_FEE_ORACLE = '0x420000000000000000000000000000000000000F';
const LENS = '0x7a9e000000000000000000000000000000000001';
const SECONDS_PER_YEAR = 31536000n;
const MILLION = 10n ** 12n;
/** Positions the rate is measured at: the live 60 / 40 split of $10M, and all of it in one venue. */
const PROBE_MILLIONS = [4, 6, 10];
/** What the override puts on the lens; any figure above the largest probe. */
const LENS_FUNDS = 100n * MILLION;
/** FiatToken keeps balances in the mapping at slot 9, on Ethereum and on Base alike. */
const USDC_BALANCE_SLOT = 9;
/**
 * Gas of a one-leg rebalance: the median of the nine real one-leg rebalances of the current
 * Base vault, listed in rebalance-gas.csv. The Ethereum vault has not rebalanced yet; its
 * eth_estimateGas figures in the same file run from 0.38M to 1.33M.
 */
const REBALANCE_GAS_PER_LEG = 982930;
const lens: { deployedBytecode: string } = JSON.parse(readFileSync(join(__dirname, 'lens.bytecode.json'), 'utf8'));

const network = deployments[target.network]!;
const vault = network.vaults[TokenEnum.USDC]!;
const USDC = vault.asset;

const KINDS: Record<ProviderKindEnum, Kind> = {
  [ProviderKindEnum.AaveV3]: 'aave',
  [ProviderKindEnum.CompoundV3]: 'compound',
  [ProviderKindEnum.Morpho]: 'morpho',
};
/** As TangemLens numbers them. */
const LENS_KIND: Record<Kind, number> = { aave: 0, compound: 1, morpho: 2 };

const liveVenues: Venue[] = vault.providers.map((provider) => {
  const kind = KINDS[provider.kind];
  // The registry keeps the Aave PoolAddressesProvider as the market; the reads need the pool.
  const market = kind === 'aave' ? network.external!.aaveV3!.pool : provider.market;
  return { name: provider.name, kind, market, provider: provider.address };
});
const venues = [...liveVenues, ...target.extraVenues];
const vaults: [string, string][] = [
  ['live', vault.proxy],
  ['previous', target.previousVault],
];

const abi = new Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function getCurrentBlockTimestamp() view returns (uint256)',
  // Aave V3 keeps this fifteen-word layout across versions (ReserveDataLegacy).
  'function getReserveData(address) view returns (uint256, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128, uint128, uint128, uint40, uint16, address aToken, address, address, address, uint128, uint128, uint128)',
  'function getReserveNormalizedIncome(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalBorrow() view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function comet(address) view returns (uint256 ratePerSecond, uint256 supplyIndex)',
  'function morphoWithdrawable(address) view returns (uint256)',
  'function rateAfterDeposit(uint8, address, address, address, uint256) returns (uint256)',
  'function getDepositRate(address) view returns (uint256)',
  'function getDepositBalance(address, address) view returns (uint256)',
  'function latestAnswer() view returns (int256)',
  'function getL1Fee(bytes) view returns (uint256)',
]);

interface Read {
  key: string;
  target: string;
  fn: string;
  args: unknown[];
  /** Index of the returned value to keep. */
  pick?: number;
}

/** Twelve digits of share price: MetaMorpho USDC shares carry 18 decimals against 6. */
const SHARE_PROBE = 10n ** 24n;
const REFUSED = (2n ** 256n - 1n).toString();

function cloneAddress(index: number): string {
  return '0x7a9e' + (0x100 + index).toString(16).padStart(36, '0');
}

function buildReads(aTokens: Record<string, string>, l1FeeSample?: string): Read[] {
  const reads: Read[] = [
    { key: 'timestamp', target: MULTICALL3, fn: 'getCurrentBlockTimestamp', args: [] },
    { key: 'ethUsd', target: target.ethUsdFeed, fn: 'latestAnswer', args: [] },
    { key: 'lensFunds', target: USDC, fn: 'balanceOf', args: [LENS] },
  ];
  if (l1FeeSample) reads.push({ key: 'gas.l1Fee', target: L1_FEE_ORACLE, fn: 'getL1Fee', args: [l1FeeSample] });
  venues.forEach((venue, index) => {
    const key = (field: string) => `${venue.name}.${field}`;
    if (venue.kind === 'aave') {
      const aToken = aTokens[venue.name];
      reads.push(
        { key: key('rate'), target: venue.market, fn: 'getReserveData', args: [USDC], pick: 2 },
        { key: key('index'), target: venue.market, fn: 'getReserveNormalizedIncome', args: [USDC] },
        { key: key('supplied'), target: aToken, fn: 'totalSupply', args: [] },
        { key: key('liquidity'), target: USDC, fn: 'balanceOf', args: [aToken] }
      );
    } else if (venue.kind === 'compound') {
      reads.push(
        { key: key('ratePerSecond'), target: LENS, fn: 'comet', args: [venue.market], pick: 0 },
        { key: key('index'), target: LENS, fn: 'comet', args: [venue.market], pick: 1 },
        { key: key('supplied'), target: venue.market, fn: 'totalSupply', args: [] },
        { key: key('borrowed'), target: venue.market, fn: 'totalBorrow', args: [] }
      );
    } else {
      reads.push(
        { key: key('rate'), target: cloneAddress(index), fn: 'getDepositRate', args: [ZeroAddress] },
        { key: key('index'), target: venue.market, fn: 'convertToAssets', args: [SHARE_PROBE] },
        { key: key('supplied'), target: venue.market, fn: 'totalAssets', args: [] },
        { key: key('liquidity'), target: LENS, fn: 'morphoWithdrawable', args: [venue.market] }
      );
    }
    for (const millions of PROBE_MILLIONS) {
      reads.push({
        key: key(`rateAfter${millions}`),
        target: LENS,
        fn: 'rateAfterDeposit',
        args: [LENS_KIND[venue.kind], USDC, venue.market, cloneAddress(index), BigInt(millions) * MILLION],
      });
    }
    if (venue.provider) {
      reads.push({
        key: key('balance'),
        target: venue.provider,
        fn: 'getDepositBalance',
        args: [vault.proxy, vault.proxy],
      });
    }
  });
  for (const [label, address] of vaults) {
    reads.push(
      { key: `vault.${label}.assets`, target: address, fn: 'totalAssets', args: [] },
      { key: `vault.${label}.supply`, target: address, fn: 'totalSupply', args: [] }
    );
  }
  return reads;
}

type Values = Record<string, string | null>;

async function retry<T>(label: string, action: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt === 6) throw new Error(`${label}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

async function readBlock(rpc: JsonRpcProvider, reads: Read[], overrides: object, block: number): Promise<Values> {
  const calls = reads.map((read) => ({
    target: read.target,
    allowFailure: true,
    callData: abi.encodeFunctionData(read.fn, read.args),
  }));
  const data = abi.encodeFunctionData('aggregate3', [calls]);
  const raw: string = await rpc.send('eth_call', [{ to: MULTICALL3, data }, toQuantity(block), overrides]);
  const [results] = abi.decodeFunctionResult('aggregate3', raw);
  const values: Values = {};
  reads.forEach((read, index) => {
    const { success, returnData } = results[index];
    // A call to an address with no code yet succeeds with empty data.
    const value =
      success && returnData !== '0x' ? abi.decodeFunctionResult(read.fn, returnData)[read.pick ?? 0].toString() : null;
    values[read.key] = value === REFUSED ? null : value;
  });
  // The engine's ray rate for Compound, as CompoundV3Provider scales it.
  for (const venue of venues.filter((v) => v.kind === 'compound')) {
    const perSecond = values[`${venue.name}.ratePerSecond`];
    values[`${venue.name}.rate`] =
      perSecond === null ? null : (BigInt(perSecond) * 10n ** 9n * SECONDS_PER_YEAR).toString();
    const supplied = values[`${venue.name}.supplied`];
    const borrowed = values[`${venue.name}.borrowed`];
    values[`${venue.name}.liquidity`] =
      supplied === null || borrowed === null ? null : (BigInt(supplied) - BigInt(borrowed)).toString();
  }
  return values;
}

function percentile(sorted: bigint[], fraction: number): bigint {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function readFees(rpc: JsonRpcProvider, block: number): Promise<Values> {
  const history = await rpc.send('eth_feeHistory', [toQuantity(FEE_WINDOW_BLOCKS), toQuantity(block), [50]]);
  // baseFeePerGas has one extra trailing entry, the fee of the block after the sample.
  const baseFees: bigint[] = history.baseFeePerGas.slice(0, -1).map(BigInt);
  const tips: bigint[] = history.reward.map((reward: string[]) => BigInt(reward[0]));
  const ascending = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
  const sortedBase = [...baseFees].sort(ascending);
  const sortedTips = [...tips].sort(ascending);
  return {
    'gas.baseFee': baseFees[baseFees.length - 1].toString(),
    'gas.priorityFee': tips[tips.length - 1].toString(),
    'gas.baseFeeMedian': percentile(sortedBase, 0.5).toString(),
    'gas.baseFeeP90': percentile(sortedBase, 0.9).toString(),
    'gas.priorityFeeMedian': percentile(sortedTips, 0.5).toString(),
  };
}

async function blockAtOrAfter(rpc: JsonRpcProvider, timestamp: number): Promise<number> {
  let low = 0;
  let high = await rpc.getBlockNumber();
  while (low < high) {
    const middle = (low + high) >> 1;
    const block = await rpc.getBlock(middle);
    if (block!.timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The reads must reproduce what the deployed providers report, to the wei, and the lens must be funded. */
async function selfCheck(rpc: JsonRpcProvider, reads: Read[], overrides: object, block: number): Promise<void> {
  const values = await readBlock(rpc, reads, overrides, block);
  for (const venue of liveVenues) {
    const data = abi.encodeFunctionData('getDepositRate', [vault.proxy]);
    const raw = await rpc.send('eth_call', [{ to: venue.provider, data }, toQuantity(block)]);
    const onChain = abi.decodeFunctionResult('getDepositRate', raw)[0].toString();
    if (values[`${venue.name}.rate`] !== onChain) {
      throw new Error(
        `Self-check failed for ${venue.name} at ${block}: read ${
          values[`${venue.name}.rate`]
        }, provider says ${onChain}`
      );
    }
  }
  if (values.lensFunds !== LENS_FUNDS.toString()) {
    throw new Error(`Self-check failed: the USDC override left the lens with ${values.lensFunds}`);
  }
  console.log(`Self-check passed at block ${block}: ${liveVenues.length} live providers match to the wei`);
}

interface Sample {
  block: number;
  values: Values;
}

function loadSamples(): Sample[] {
  if (!existsSync(RAW_PATH)) return [];
  return readFileSync(RAW_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const iso = (timestamp: string) => new Date(Number(timestamp) * 1000).toISOString().replace('.000Z', 'Z');

function fixed(numerator: bigint, denominator: bigint, digits: number): string {
  const scaled = (numerator * 10n ** BigInt(digits)) / denominator;
  const text = scaled.toString().padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

function writeCsv(file: string, header: string[], rows: (string | number | null)[][]): void {
  const lines = [header, ...rows].map((row) => row.map((cell) => cell ?? '').join(','));
  writeFileSync(join(OUT_DIR, file), lines.join('\n') + '\n');
  console.log(`${file}: ${rows.length} rows`);
}

function exportCsv(samples: Sample[]): void {
  samples.sort((a, b) => a.block - b.block);
  const live = new Set(liveVenues.map((venue) => venue.name));

  const rates: (string | number | null)[][] = [];
  for (const { block, values } of samples) {
    for (const venue of venues) {
      const get = (field: string) => values[`${venue.name}.${field}`];
      const rate = get('rate');
      rates.push([
        target.network,
        venue.name,
        live.has(venue.name) ? 1 : 0,
        block,
        values.timestamp,
        iso(values.timestamp!),
        rate,
        rate === null ? null : fixed(BigInt(rate), 10n ** 25n, 6),
        get('supplied'),
        get('liquidity'),
        get('index'),
        get('balance') ?? null,
        ...PROBE_MILLIONS.map((millions) => get(`rateAfter${millions}`)),
      ]);
    }
  }
  writeCsv(
    'provider-rates.csv',
    [
      'network',
      'provider',
      'in_live_vault',
      'block_number',
      'timestamp',
      'datetime_utc',
      'deposit_rate',
      'deposit_rate_percent',
      'total_supplied',
      'available_liquidity',
      'supply_index',
      'deposit_balance',
      ...PROBE_MILLIONS.map((millions) => `deposit_rate_after_${millions}m`),
    ],
    rates
  );

  writeCsv(
    'gas.csv',
    [
      'network',
      'block_number',
      'timestamp',
      'datetime_utc',
      'base_fee_wei',
      'priority_fee_wei',
      'base_fee_median_window_wei',
      'base_fee_p90_window_wei',
      'priority_fee_median_window_wei',
      'l1_fee_wei',
      'gas_used_rebalance',
      'eth_usd',
    ],
    samples.map(({ block, values }) => [
      target.network,
      block,
      values.timestamp,
      iso(values.timestamp!),
      values['gas.baseFee'],
      values['gas.priorityFee'],
      values['gas.baseFeeMedian'],
      values['gas.baseFeeP90'],
      values['gas.priorityFeeMedian'],
      values['gas.l1Fee'] ?? 0,
      REBALANCE_GAS_PER_LEG,
      fixed(BigInt(values.ethUsd!), 10n ** 8n, 2),
    ])
  );

  const shares: (string | number | null)[][] = [];
  for (const [label, address] of vaults) {
    for (const { block, values } of samples) {
      const assets = values[`vault.${label}.assets`];
      const supply = values[`vault.${label}.supply`];
      if (assets === null || supply === null || supply === '0') continue;
      shares.push([
        target.network,
        label,
        address,
        block,
        values.timestamp,
        iso(values.timestamp!),
        assets,
        supply,
        fixed(BigInt(assets), BigInt(supply), 12),
      ]);
    }
  }
  writeCsv(
    'vault-share-price.csv',
    [
      'network',
      'vault',
      'vault_address',
      'block_number',
      'timestamp',
      'datetime_utc',
      'total_assets',
      'total_supply',
      'share_price',
    ],
    shares
  );
}

async function main(): Promise<void> {
  const chain = chains[target.network]!;
  const url =
    process.env[chain.rpcEnvKey] ||
    (process.env.ALCHEMY_API_KEY && `https://${target.alchemy}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);
  if (!url) throw new Error(`Set ${chain.rpcEnvKey} (archive) or ALCHEMY_API_KEY`);
  const rpc = new JsonRpcProvider(url, chain.chainId, { staticNetwork: true, batchMaxCount: 1 });
  mkdirSync(OUT_DIR, { recursive: true });

  const [fromBlock, toBlock] = await Promise.all([
    blockAtOrAfter(rpc, FROM_TIMESTAMP),
    blockAtOrAfter(rpc, TO_TIMESTAMP),
  ]);

  // aToken addresses never change; one read at the end block serves the whole year.
  const aTokens: Record<string, string> = {};
  for (const venue of venues.filter((v) => v.kind === 'aave')) {
    const data = abi.encodeFunctionData('getReserveData', [USDC]);
    const raw = await rpc.send('eth_call', [{ to: venue.market, data }, toQuantity(toBlock)]);
    aTokens[venue.name] = abi.decodeFunctionResult('getReserveData', raw).aToken;
  }

  // MorphoProvider keeps its MetaMorpho vault as an immutable, so a provider for any vault
  // is the deployed runtime code with those twenty bytes replaced.
  const donor = liveVenues.find((venue) => venue.kind === 'morpho')!;
  const donorCode = (await rpc.getCode(donor.provider!, toBlock)).toLowerCase();
  const donorMarket = donor.market.slice(2).toLowerCase();
  if (!donorCode.includes(donorMarket)) throw new Error(`${donor.name} bytecode does not embed ${donor.market}`);
  const lensBalanceSlot = keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [LENS, USDC_BALANCE_SLOT])
  );
  const overrides: Record<string, object> = {
    [LENS]: { code: lens.deployedBytecode },
    [USDC]: { stateDiff: { [lensBalanceSlot]: toBeHex(LENS_FUNDS, 32) } },
  };
  venues.forEach((venue, index) => {
    if (venue.kind !== 'morpho') return;
    overrides[cloneAddress(index)] = { code: donorCode.split(donorMarket).join(venue.market.slice(2).toLowerCase()) };
  });

  const l1FeeSample = target.l1FeeSampleTx
    ? Transaction.from((await rpc.getTransaction(target.l1FeeSampleTx))!).serialized
    : undefined;
  const reads = buildReads(aTokens, l1FeeSample);
  await selfCheck(rpc, reads, overrides, toBlock);

  const samples = loadSamples();
  const done = new Set(samples.map((sample) => sample.block));
  const queue: number[] = [];
  for (let block = fromBlock; block <= toBlock; block += target.stepBlocks) if (!done.has(block)) queue.push(block);
  console.log(
    `Blocks ${fromBlock}..${toBlock} step ${target.stepBlocks}: ${done.size} collected, ${queue.length} to go`
  );

  let finished = 0;
  const total = queue.length;
  const worker = async () => {
    for (let block = queue.shift(); block !== undefined; block = queue.shift()) {
      const current = block;
      const [values, fees] = await Promise.all([
        retry(`eth_call ${current}`, () => readBlock(rpc, reads, overrides, current)),
        retry(`eth_feeHistory ${current}`, () => readFees(rpc, current)),
      ]);
      const sample = { block: current, values: { ...values, ...fees } };
      samples.push(sample);
      appendFileSync(RAW_PATH, JSON.stringify(sample) + '\n');
      if (++finished % 100 === 0) console.log(`${finished}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  exportCsv(samples);
}

main().catch((error) => {
  // The RPC URL carries the key; keep it out of the log.
  console.error(String(error.message ?? error).replace(/\/v2\/[\w-]+/g, '/v2/<redacted>'));
  process.exit(1);
});
