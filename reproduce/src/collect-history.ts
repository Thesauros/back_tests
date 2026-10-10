/**
 * Tangem data pack: one year of a network's USDC venues, every ~4 hours and at the year's
 * last block. Rates, sizes, withdrawable liquidity, growth indices and the rate after our own
 * deposit (TS-389, TS-393), gas (TS-390) and vault share price (TS-391).
 *
 * Every sample is one archive eth_call to Multicall3 plus one eth_feeHistory. Morpho rates
 * come from the production MorphoProvider bytecode, re-pointed at each MetaMorpho vault and
 * injected with a state override, so the series holds the number the engine itself reads,
 * including for the months before our providers were deployed. The same override gives the
 * lens a USDC balance; it deposits into each venue through the venue's own code, reads the
 * rate and rolls the deposit back. Before collecting, the script checks its reads against
 * the live providers at the end block and stops on any difference.
 *
 * Venues Thesauros has no provider adapter for (a Morpho Vault V2, a single Morpho Blue
 * market, Fluid, Spark sUSDC) are read through a second lens, TangemLensWide, in the same
 * call: the rate is the one an adapter of that family would report. They have no provider
 * to check against, so each is checked against plain reads of the venue itself.
 *
 * Run (appends to data/tangem/<network>/raw.jsonl):
 *   set -a && source apps/rebalancer/.env && set +a
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/collect-history.ts Base
 * An interrupted run resumes its own file only: every sample carries a fingerprint of the
 * reads that made it (venues, probes, both lenses), and the run stops on a file with another
 * fingerprint or with none, as a raw.jsonl collected before the venues without an adapter were
 * added has. Collect into an empty TANGEM_OUT then and put the result in the old file's place.
 *
 * TANGEM_OUT=<directory> writes there instead of data/tangem/<network>; TANGEM_BLOCKS=1,2,3
 * collects those blocks instead of the year's grid, for tests, and only into a TANGEM_OUT;
 * TANGEM_CONCURRENCY sets the workers.
 * RPC: the network's own variable (BASE_RPC_URL, ETHEREUM_RPC_URL; archive), else Alchemy
 * from ALCHEMY_API_KEY.
 * Lens: after editing TangemLens.sol, `forge build` it with solc 0.8.33, 200 optimizer runs,
 * and copy deployedBytecode.object into lens.bytecode.json. TangemLensWide.sol carries its
 * own build settings in its header and goes into lens-wide.bytecode.json.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  AbiCoder,
  Interface,
  JsonRpcProvider,
  Result,
  Transaction,
  ZeroAddress,
  id,
  keccak256,
  toBeHex,
  toQuantity,
  zeroPadValue,
} from 'ethers';
import { TokenEnum } from '@backend-ts/enums';
import { chains, deployments, ProviderKindEnum } from '@backend-ts/networks';
import { Kind, LENS_KIND, TARGETS, Venue } from './targets';

const target = TARGETS[process.argv[2]];
if (!target) throw new Error(`Usage: collect-history.ts ${Object.keys(TARGETS).join('|')}`);

const FROM_TIMESTAMP = Date.UTC(2025, 9, 7) / 1000;
const TO_TIMESTAMP = Date.UTC(2026, 9, 7) / 1000;
/** The fees of a sample are taken over the blocks that end at it: an hour on Ethereum, ten minutes on Base. */
const FEE_WINDOW_BLOCKS = 300;
/**
 * Each worker keeps two requests in flight. A sample is one eth_call of 18M to 37M gas, of the
 * 550M the node gives a call, answered in 0.2 s (measured 2026-10-09, both networks).
 */
const CONCURRENCY = Number(process.env.TANGEM_CONCURRENCY || 8);
if (!(Number.isInteger(CONCURRENCY) && CONCURRENCY > 0)) {
  throw new Error('TANGEM_CONCURRENCY takes a whole number of workers, 1 or more');
}
if (process.env.TANGEM_BLOCKS && !process.env.TANGEM_OUT) {
  throw new Error('TANGEM_BLOCKS is for tests: set TANGEM_OUT, so that they stay out of data/tangem');
}
const OUT_DIR = process.env.TANGEM_OUT || join(process.cwd(), 'data/tangem', target.network.toLowerCase());
const RAW_PATH = join(OUT_DIR, 'raw.jsonl');

const chain = chains[target.network]!;
/** A loader that does not parse an .env file's quotes leaves them on the value, and in the URL. */
const env = (name: string) => process.env[name]?.trim().replace(/^['"]|['"]$/g, '');
const RPC_KEY = env('ALCHEMY_API_KEY');
const RPC_URL = env(chain.rpcEnvKey) || (RPC_KEY && `https://${target.alchemy}.g.alchemy.com/v2/${RPC_KEY}`);
/** The RPC URL carries the key: neither reaches the log, whatever characters they hold. */
function redact(text: string): string {
  return [RPC_URL, RPC_KEY]
    .filter((secret): secret is string => !!secret)
    .reduce((out, secret) => out.split(secret).join('<redacted>'), text)
    .replace(/\/v2\/[^\s"\\]+/g, '/v2/<redacted>');
}

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const L1_FEE_ORACLE = '0x420000000000000000000000000000000000000F';
const LENS = '0x7a9e000000000000000000000000000000000001';
/** TangemLensWide: the venue kinds Thesauros has no provider adapter for. */
const LENS_WIDE = '0x7a9e000000000000000000000000000000000002';
/** Morpho Blue, the same address on Ethereum and Base. */
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
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
const lensWide: { deployedBytecode: string } = JSON.parse(
  readFileSync(join(__dirname, 'lens-wide.bytecode.json'), 'utf8')
);

const network = deployments[target.network]!;
const vault = network.vaults[TokenEnum.USDC]!;
const USDC = vault.asset;

const KINDS: Record<ProviderKindEnum, Kind> = {
  [ProviderKindEnum.AaveV3]: 'aave',
  [ProviderKindEnum.CompoundV3]: 'compound',
  [ProviderKindEnum.Morpho]: 'morpho',
};

const liveVenues: Venue[] = vault.providers.map((provider) => {
  const kind = KINDS[provider.kind];
  // The registry keeps the Aave PoolAddressesProvider as the market; the reads need the pool.
  const market = kind === 'aave' ? network.external!.aaveV3!.pool : provider.market;
  return { name: provider.name, kind, market, provider: provider.address };
});
const venues = [...liveVenues, ...target.extraVenues];
// A reading is keyed by the venue's name.
venues.forEach((venue, index) => {
  if (venues.findIndex((other) => other.name === venue.name) !== index) throw new Error(`Two venues are ${venue.name}`);
});
/** TangemLens treats a kind it does not know as a MetaMorpho vault: only its own three may reach it. */
const isWide = (venue: Venue) => LENS_KIND[venue.kind] > 2;
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
  // TangemLensWide.
  'function rate(uint8, address, bytes32) view returns (uint256)',
  'function withdrawable(uint8, address, bytes32) view returns (uint256)',
  'function blueMarket(bytes32, uint256) view returns (uint256 rate, uint256 index, uint256 supplied, uint256 liquidity)',
  'function rateAfter(uint8, address, bytes32, uint256) returns (uint256)',
  'function v1Rate(address) view returns (uint256)',
  // Plain reads of the self-check.
  'function maxWithdraw(address) view returns (uint256)',
  'function ssr() view returns (uint256)',
  'function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function borrowRateView((address, address, address, address, uint256), (uint128, uint128, uint128, uint128, uint128, uint128)) view returns (uint256)',
]);

interface Read {
  key: string;
  target: string;
  fn: string;
  args: unknown[];
  /** Index of the returned value to keep. */
  pick?: number;
}

/**
 * Twelve digits of share price: MetaMorpho and Vault V2 USDC shares carry 18 decimals against 6.
 * As many supply shares of a Morpho Blue market give eighteen digits; an fToken keeps its price
 * to twelve decimals whatever the probe.
 */
const SHARE_PROBE = 10n ** 24n;
/** UsdcVault divides the USDS value of the shares by 1e12: nineteen digits. */
const SUSDC_SHARE_PROBE = 10n ** 30n;
const REFUSED = (2n ** 256n - 1n).toString();
/** TangemLensWide's RATE_UNREAD: the venue took the deposit and the lens could not read the rate after it. */
const RATE_UNREAD = (2n ** 256n - 2n).toString();

function cloneAddress(index: number): string {
  return '0x7a9e' + (0x100 + index).toString(16).padStart(36, '0');
}

function buildReads(aTokens: Record<string, string>, l1FeeSample?: string): Read[] {
  const reads: Read[] = [
    { key: 'timestamp', target: MULTICALL3, fn: 'getCurrentBlockTimestamp', args: [] },
    { key: 'ethUsd', target: target.ethUsdFeed, fn: 'latestAnswer', args: [] },
    { key: 'lensFunds', target: USDC, fn: 'balanceOf', args: [LENS] },
    { key: 'lensWideFunds', target: USDC, fn: 'balanceOf', args: [LENS_WIDE] },
  ];
  if (l1FeeSample) reads.push({ key: 'gas.l1Fee', target: L1_FEE_ORACLE, fn: 'getL1Fee', args: [l1FeeSample] });
  venues.forEach((venue, index) => {
    const key = (field: string) => `${venue.name}.${field}`;
    // What TangemLensWide takes: the kind, the asset, and the venue's address or market id in a word.
    const wide = [LENS_KIND[venue.kind], USDC, zeroPadValue(venue.market, 32)];
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
    } else if (venue.kind === 'morpho') {
      reads.push(
        { key: key('rate'), target: cloneAddress(index), fn: 'getDepositRate', args: [ZeroAddress] },
        { key: key('index'), target: venue.market, fn: 'convertToAssets', args: [SHARE_PROBE] },
        { key: key('supplied'), target: venue.market, fn: 'totalAssets', args: [] },
        { key: key('liquidity'), target: LENS, fn: 'morphoWithdrawable', args: [venue.market] }
      );
    } else if (venue.kind === 'morpho-market') {
      // Morpho keeps no accrued view of a market: all four come from the lens.
      ['rate', 'index', 'supplied', 'liquidity'].forEach((field, pick) =>
        reads.push({ key: key(field), target: LENS_WIDE, fn: 'blueMarket', args: [venue.market, SHARE_PROBE], pick })
      );
    } else if (venue.kind === 'morpho-v2' || venue.kind === 'fluid' || venue.kind === 'susdc') {
      const probe = venue.kind === 'susdc' ? SUSDC_SHARE_PROBE : SHARE_PROBE;
      reads.push(
        { key: key('rate'), target: LENS_WIDE, fn: 'rate', args: wide },
        { key: key('index'), target: venue.market, fn: 'convertToAssets', args: [probe] },
        { key: key('supplied'), target: venue.market, fn: 'totalAssets', args: [] },
        { key: key('liquidity'), target: LENS_WIDE, fn: 'withdrawable', args: wide }
      );
    } else {
      throw new Error(`${venue.name}: no reads for venue kind ${venue.kind}`);
    }
    for (const millions of PROBE_MILLIONS) {
      const amount = BigInt(millions) * MILLION;
      reads.push(
        isWide(venue)
          ? { key: key(`rateAfter${millions}`), target: LENS_WIDE, fn: 'rateAfter', args: [...wide, amount] }
          : {
              key: key(`rateAfter${millions}`),
              target: LENS,
              fn: 'rateAfterDeposit',
              args: [LENS_KIND[venue.kind], USDC, venue.market, cloneAddress(index), amount],
            }
      );
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
    // A failure of the lens is not a refusal by the venue: no reading rather than a null.
    if (value === RATE_UNREAD) throw new Error(`${read.key}: the deposit went through and the lens read no rate`);
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
  // Some of the provider's nodes answer with every reward at zero. That is true only of a
  // window of empty blocks, as on Base around 2026-06-25 16:00 UTC.
  const used = history.gasUsedRatio.reduce((sum: number, ratio: number) => sum + ratio, 0) / tips.length;
  if (used > 0.01 && tips.every((tip) => tip === 0n)) throw new Error('no rewards for blocks that are not empty');
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
  if (values.lensFunds !== LENS_FUNDS.toString() || values.lensWideFunds !== LENS_FUNDS.toString()) {
    throw new Error(
      `Self-check failed: the USDC override left the lenses with ${values.lensFunds} and ${values.lensWideFunds}`
    );
  }
  console.log(`Self-check passed at block ${block}: ${liveVenues.length} live providers match to the wei`);
  await selfCheckWide(rpc, values, overrides, block);
}

async function call(
  rpc: JsonRpcProvider,
  block: number,
  to: string,
  fn: string,
  args: unknown[],
  overrides?: object
): Promise<Result> {
  const params = [{ to, data: abi.encodeFunctionData(fn, args) }, toQuantity(block)];
  return abi.decodeFunctionResult(fn, await rpc.send('eth_call', overrides ? [...params, overrides] : params));
}

const WAD = 10n ** 18n;

/** MathLib.wTaylorCompounded: three terms of e^(x n) - 1. */
function taylor(x: bigint, n: bigint): bigint {
  const first = x * n;
  const second = (first * first) / (2n * WAD);
  return first + second + (second * first) / (3n * WAD);
}

/**
 * A Morpho Blue market accrued to `timestamp` from plain reads of Morpho and its IRM, in this
 * file's arithmetic: totals as MorphoBalancesLib.expectedMarketBalances accrues them, the rate
 * as MorphoProvider._getMarketRate computes it for one market, in ray.
 */
async function expectedMarket(rpc: JsonRpcProvider, block: number, id: string, timestamp: bigint) {
  const params = await call(rpc, block, MORPHO, 'idToMarketParams', [id]);
  const market = await call(rpc, block, MORPHO, 'market', [id]);
  let { totalSupplyAssets: supply, totalSupplyShares: shares, totalBorrowAssets: borrow } = market;
  let rate = 0n;
  if (params.irm !== ZeroAddress) {
    const [borrowRate] = await call(rpc, block, params.irm, 'borrowRateView', [[...params], [...market]]);
    const elapsed = timestamp - market.lastUpdate;
    if (elapsed !== 0n && borrow !== 0n) {
      const interest = (borrow * taylor(borrowRate, elapsed)) / WAD;
      borrow += interest;
      supply += interest;
      const fee = (interest * market.fee) / WAD;
      // SharesMathLib.toSharesDown: one virtual asset, 1e6 virtual shares.
      shares += (fee * (shares + 10n ** 6n)) / (supply - fee + 1n);
    }
    const utilization = borrow === 0n ? 0n : (borrow * WAD + supply - 1n) / supply;
    rate = (((taylor(borrowRate, SECONDS_PER_YEAR) * (WAD - market.fee)) / WAD) * utilization) / WAD;
  }
  return {
    rate: rate * 10n ** 9n,
    index: (SHARE_PROBE * (supply + 1n)) / (shares + 10n ** 6n),
    supplied: supply,
    liquidity: supply - borrow,
  };
}

/** Where each venue keeps its share balances: the fToken's ERC-20 mapping, UsdcVault.balanceOf. */
const SHARES_SLOT: Partial<Record<Kind, number>> = { fluid: 0, susdc: 2 };

/**
 * The venues without a Thesauros adapter have no provider to compare with. Each figure the
 * venue or Morpho states itself is compared with a plain read of it outside the Multicall3
 * call, with no lens: the index and the size of a vault, the Sky rate, a market's totals
 * recomputed here, and the venue's own maxWithdraw for a holder of more shares than exist.
 * The rate of a Vault V2 and of Fluid has no such read; the Morpho arithmetic they share with
 * the lens's v1Rate is compared with the deployed providers.
 */
async function selfCheckWide(rpc: JsonRpcProvider, values: Values, overrides: object, block: number): Promise<void> {
  const expect = (venue: Venue, field: string, plain: bigint) => {
    const read = values[`${venue.name}.${field}`];
    if (read !== plain.toString()) {
      throw new Error(
        `Self-check failed for ${venue.name}.${field} at ${block}: read ${read}, the venue says ${plain}`
      );
    }
  };
  // The lens's Morpho arithmetic against the deployed providers, on their own vaults.
  const morphoVenues = liveVenues.filter((venue) => venue.kind === 'morpho');
  for (const venue of morphoVenues) {
    const [rate] = await call(rpc, block, LENS_WIDE, 'v1Rate', [venue.market], overrides);
    expect(venue, 'rate', rate * 10n ** 9n);
  }
  let checked = morphoVenues.length;
  for (const venue of venues.filter(isWide)) {
    for (const field of ['rate', 'index', 'supplied', 'liquidity']) {
      if (values[`${venue.name}.${field}`] === null) {
        throw new Error(`Self-check failed: no ${venue.name}.${field} at ${block}`);
      }
    }
    if (venue.kind === 'morpho-market') {
      const market = await expectedMarket(rpc, block, venue.market, BigInt(values.timestamp!));
      Object.entries(market).forEach(([field, plain]) => expect(venue, field, plain));
      checked += 4;
      continue;
    }
    const probe = venue.kind === 'susdc' ? SUSDC_SHARE_PROBE : SHARE_PROBE;
    expect(venue, 'index', (await call(rpc, block, venue.market, 'convertToAssets', [probe]))[0]);
    expect(venue, 'supplied', (await call(rpc, block, venue.market, 'totalAssets', []))[0]);
    checked += 2;
    if (venue.kind === 'susdc') {
      const [ssr] = await call(rpc, block, venue.market, 'ssr', []);
      expect(venue, 'rate', (ssr - 10n ** 27n) * SECONDS_PER_YEAR);
      checked++;
    }
    const slot = SHARES_SLOT[venue.kind];
    if (slot !== undefined) {
      const holder = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [LENS_WIDE, slot]));
      const rich = { [venue.market]: { stateDiff: { [holder]: toBeHex(10n ** 30n, 32) } } };
      expect(venue, 'liquidity', (await call(rpc, block, venue.market, 'maxWithdraw', [LENS_WIDE], rich))[0]);
      checked++;
    }
  }
  console.log(`Self-check passed at block ${block}: ${checked} readings of TangemLensWide match plain reads`);
}

interface Sample {
  block: number;
  /** Of the reads that made the sample; absent in a file older than the fingerprint. */
  fingerprint?: string;
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
  if (!RPC_URL) throw new Error(`Set ${chain.rpcEnvKey} (archive) or ALCHEMY_API_KEY`);
  const rpc = new JsonRpcProvider(RPC_URL, chain.chainId, { staticNetwork: true, batchMaxCount: 1 });
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
  const balanceSlot = (holder: string) =>
    keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [holder, USDC_BALANCE_SLOT]));
  const overrides: Record<string, object> = {
    [LENS]: { code: lens.deployedBytecode },
    [LENS_WIDE]: { code: lensWide.deployedBytecode },
    [USDC]: {
      stateDiff: {
        [balanceSlot(LENS)]: toBeHex(LENS_FUNDS, 32),
        [balanceSlot(LENS_WIDE)]: toBeHex(LENS_FUNDS, 32),
      },
    },
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

  // Everything a sample is made with: each read's venue address, probe and key, both lenses'
  // code, the cloned providers, the fee window.
  const fingerprint = id(
    JSON.stringify([reads, overrides, FEE_WINDOW_BLOCKS], (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
  const samples = loadSamples();
  // Resuming skips a block that is already there, so a file made by other reads would keep
  // its readings under this run's names: another vault, another lens, no reading at all.
  const foreign = samples.find((sample) => sample.fingerprint !== fingerprint);
  if (foreign) {
    throw new Error(
      `${RAW_PATH} was collected with other venues, lenses or probes (block ${foreign.block}). Collect into an empty TANGEM_OUT.`
    );
  }
  const done = new Set(samples.map((sample) => sample.block));
  if (done.size !== samples.length) throw new Error(`${RAW_PATH} holds a block twice`);
  // The grid, then the window's end block. The first reading is the first block at or after
  // the window's start and this one the first at or after its end, so the series spans the
  // year whether or not the grid lands on the end block; on Ethereum it does not.
  const grid: number[] = [];
  for (let block = fromBlock; block < toBlock; block += target.stepBlocks) grid.push(block);
  grid.push(toBlock);
  const wanted = process.env.TANGEM_BLOCKS ? [...new Set(process.env.TANGEM_BLOCKS.split(',').map(Number))] : grid;
  if (!wanted.every((block) => block > 0 && Number.isInteger(block))) {
    throw new Error('TANGEM_BLOCKS takes block numbers separated by commas');
  }
  const queue = wanted.filter((block) => !done.has(block));
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
      const sample = { block: current, fingerprint, values: { ...values, ...fees } };
      samples.push(sample);
      appendFileSync(RAW_PATH, JSON.stringify(sample) + '\n');
      if (++finished % 100 === 0) console.log(`${finished}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // The CSVs are the artifact: none from a part of the blocks.
  if (queue.length > 0) throw new Error(`${queue.length} blocks are not collected`);

  exportCsv(samples);
}

main().catch((error) => {
  console.error(redact(String(error.message ?? error)));
  process.exit(1);
});
