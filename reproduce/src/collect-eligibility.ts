/**
 * The venue selection rule (client/VENUE_RULE.md) applied to every candidate of candidates.ts,
 * month by month, from the chain.
 *
 * A month is decided at the history's first reading at or after 00:00 UTC of its 7th; the block
 * is taken from data/tangem/<network>/raw.jsonl, which this script only reads. At that block
 * every candidate is read through Multicall3:
 *   - its size in USDC, by the view its kind has;
 *   - for a Morpho vault, the Morpho Blue markets behind it and the collateral token of each:
 *     a first-generation vault through its withdraw queue, a Vault V2 through its adapters (a
 *     market adapter by its markets, an adapter onto a first-generation vault by that vault's
 *     markets pro rata), a single market by its one collateral;
 *   - for a pool lent against several collaterals with no split to read (Euler, Dolomite), the
 *     collateral it accepts;
 *   - for a wrapper, what it holds through another venue.
 * Then the rule: tests 1 and 2 by the venue's terms (candidates.ts) and by what the reading
 * shows (asset(), gates, hooks), test 3 by the size, test 4 by the share of assets that is idle
 * USDC or lent against the listed collateral, matched by token address. A venue that holds more
 * than half of its assets through a venue that is in the set that month is left out (rule
 * application point 3): a Vault V2 on an adapter onto a first-generation vault, the wrapper of the
 * Aave pool, and a vault with more than half of its assets in one single market of the set, which
 * is the same USDC as that market.
 *
 * Every row carries the single market of the set in which the venue has the most
 * (largest_set_market) and the percent of its assets there. in_set_vaults_kept is the set without
 * that last case: set A of client/PROGRAMME.md. in_set_broad is its set B: tests 1 to 3 whatever
 * the collateral, without a venue that holds more than half of its assets through another venue
 * of set B.
 *
 * A position in a market is valued at the market's stored totals, so interest since the
 * market's last update is not in it; what totalAssets() counts beyond the positions is written
 * as `unattributed` and is not listed collateral.
 *
 * Test columns: pass, fail, waived (test 4, for the governance-run venues the rule names),
 * unverified (the test was not read for the venue: candidates.ts says what was not) and n/a (the
 * venue did not exist at the reading, or a vault held nothing to look through). A pass of test 1
 * or 2 has its terms in candidates.ts. No venue is left out of in_set or in_set_vaults_kept on
 * unverified or n/a alone: the script stops if one would be. in_set_broad asks for a pass of
 * tests 1 to 3, so a venue whose test 1 or 2 was not read is out of it, and the script prints
 * each such venue that is at $100M. Percents are cut to the digits printed, not rounded.
 *
 * Run:
 *   set -a && source apps/rebalancer/.env && set +a
 *   yarn ts-node --compiler-options '{"module":"commonjs","target":"es2021"}' \
 *     -r tsconfig-paths/register --project tsconfig.base.json scripts/tangem/collect-eligibility.ts Base [periods.json] [periods-vaults-kept.json] [periods-broad.json]
 *
 * Writes data/tangem/<network>/venue-eligibility.csv and venue-collateral-monthly.csv, and
 * prints, for every venue the history collects, the periods it is in the set; the optional
 * arguments are files to write those periods to: the set, the set with those vaults kept, and set B.
 * Nothing is written if a read fails.
 * RPC: as collect-history.ts.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Interface, JsonRpcProvider, Result, ZeroAddress, getAddress, toQuantity } from 'ethers';
import { TokenEnum } from '@backend-ts/enums';
import { chains, deployments, ProviderKindEnum } from '@backend-ts/networks';
import { Candidate, CANDIDATES, FOUND_NOT_READ, LISTED_COLLATERAL, NOT_READ, TERMS, Verdict } from './candidates';
import { TARGETS } from './targets';

const target = TARGETS[process.argv[2]];
if (!target) throw new Error(`Usage: collect-eligibility.ts ${Object.keys(TARGETS).join('|')} [periods.json]`);

/** The 7th of the twelve rule months, and of the month after them, where the last period ends. */
const MONTHS = Array.from({ length: 13 }, (_, index) =>
  new Date(Date.UTC(2025, 9 + index, 7)).toISOString().slice(0, 10)
);
const OUT_DIR = join(process.cwd(), 'data/tangem', target.network.toLowerCase());
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
/** Test 3, in USDC base units. */
const MIN_SIZE = 100_000_000n * 10n ** 6n;
/** Test 4, percent of assets. */
const MIN_LISTED = 90n;
/** Calls in one Multicall3 request. */
const BATCH = 150;
/**
 * Morpho's Vault V2 adapter factories (docs.morpho.org/get-started/resources/addresses). Each
 * answers whether an adapter is its own, which is how the kind of an adapter is told.
 */
const ADAPTER_FACTORIES: Record<string, { vaultV1: string; marketV1: string }> = {
  Ethereum: {
    vaultV1: '0xD1B8E2dee25c2b89DCD2f98448a7ce87d6F63394',
    marketV1: '0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1',
  },
  Base: {
    vaultV1: '0xF42D9c36b34c9c2CF3Bc30eD2a52a90eEB604642',
    marketV1: '0x9a1B378C43BA535cDB89934230F0D3890c51C0EB',
  },
};
/** A Vault V2 with any of these set can refuse an address it has not onboarded. */
const GATES = ['receiveSharesGate', 'sendSharesGate', 'receiveAssetsGate', 'sendAssetsGate'];

const network = deployments[target.network]!;
const vault = network.vaults[TokenEnum.USDC]!;
const USDC = vault.asset;
const candidates = CANDIDATES[target.network];
const listed = new Map(LISTED_COLLATERAL[target.network].map((token) => [token.address.toLowerCase(), token]));

const abi = new Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function getCurrentBlockTimestamp() view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function asset() view returns (address)',
  // Aave V3 keeps this fifteen-word layout across versions (ReserveDataLegacy).
  'function getReserveData(address) view returns (uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address aToken, address, address, address, uint128, uint128, uint128)',
  'function aToken() view returns (address)',
  // Morpho Blue and the vaults over it.
  'function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function withdrawQueueLength() view returns (uint256)',
  'function withdrawQueue(uint256) view returns (bytes32)',
  'function adaptersLength() view returns (uint256)',
  'function adapters(uint256) view returns (address)',
  ...GATES.map((gate) => `function ${gate}() view returns (address)`),
  'function realAssets() view returns (uint256)',
  'function morphoVaultV1() view returns (address)',
  'function marketIdsLength() view returns (uint256)',
  'function marketIds(uint256) view returns (bytes32)',
  'function isMorphoVaultV1Adapter(address) view returns (bool)',
  'function isMorphoMarketV1AdapterV2(address) view returns (bool)',
  // Euler.
  'function cash() view returns (uint256)',
  'function LTVList() view returns (address[])',
  'function LTVBorrow(address) view returns (uint16)',
  'function hookConfig() view returns (address hookTarget, uint32 hookedOps)',
  // Moonwell.
  'function getCash() view returns (uint256)',
  'function totalBorrows() view returns (uint256)',
  'function totalReserves() view returns (uint256)',
  // DolomiteMargin.
  'function getNumMarkets() view returns (uint256)',
  'function getMarketTokenAddress(uint256) view returns (address)',
  'function getMarketTotalPar(uint256) view returns ((uint256 borrow, uint256 supply))',
  'function getMarketCurrentIndex(uint256) view returns ((uint256 borrow, uint256 supply, uint256 lastUpdate))',
  // Venues of kind `view` and Stream.
  'function getContractValue() view returns (uint256)',
  'function getDataInBase18() view returns (uint256)',
  'function getSharePrice() view returns (uint256)',
  'function mintedAvalonVault() view returns (uint256)',
  'function round() view returns (uint256)',
  'function roundPricePerShare(uint256) view returns (uint256)',
]);

let rpc: JsonRpcProvider;

async function retry<T>(label: string, action: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      // The RPC URL carries the key; keep it out of every message.
      const message = (error as Error).message.replace(/\/v2\/[\w-]+/g, '/v2/<redacted>');
      if (attempt === 6) throw new Error(`${label}: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

interface Call {
  target: string;
  fn: string;
  args: unknown[];
  optional: boolean;
  resolve: (result: Result | null) => void;
  reject: (error: Error) => void;
}
const queues = new Map<number, Call[]>();
const asked = new Map<string, Promise<Result | null>>();

/** Sends every read asked of a block since the last tick as Multicall3 requests, one at a time. */
async function flush(block: number): Promise<void> {
  const calls = queues.get(block)!;
  queues.delete(block);
  try {
    const results: { success: boolean; returnData: string }[] = [];
    for (let offset = 0; offset < calls.length; offset += BATCH) {
      const batch = calls.slice(offset, offset + BATCH).map((call) => ({
        target: call.target,
        allowFailure: true,
        callData: abi.encodeFunctionData(call.fn, call.args),
      }));
      const data = abi.encodeFunctionData('aggregate3', [batch]);
      const raw: string = await retry(`eth_call ${block}`, () =>
        rpc.send('eth_call', [{ to: MULTICALL3, data }, toQuantity(block)])
      );
      results.push(...abi.decodeFunctionResult('aggregate3', raw)[0]);
    }
    calls.forEach((call, index) => {
      const { success, returnData } = results[index];
      try {
        if (!success) throw new Error('reverted');
        // A call to an address with no code yet succeeds with empty data.
        call.resolve(returnData === '0x' ? null : abi.decodeFunctionResult(call.fn, returnData));
      } catch (error) {
        if (call.optional) call.resolve(null);
        else call.reject(new Error(`${call.fn} at ${call.target}, block ${block}: ${(error as Error).message}`));
      }
    });
  } catch (error) {
    calls.forEach((call) => call.reject(error as Error));
  }
}

/**
 * One view at one block; null where the target has no code. A revert is an error, not a
 * missing value, unless the read is optional. Reads asked in the same tick share a request,
 * and the same read is sent once.
 */
function read(block: number, to: string, fn: string, args: unknown[] = [], optional = false): Promise<Result | null> {
  const key = [block, to, fn, optional, ...args].join('|');
  if (!asked.has(key)) {
    asked.set(
      key,
      new Promise((resolve, reject) => {
        if (!queues.has(block)) {
          queues.set(block, []);
          setImmediate(() => flush(block));
        }
        queues.get(block)!.push({ target: to, fn, args, optional, resolve, reject });
      })
    );
  }
  return asked.get(key)!;
}

/** The first value a view returns. */
async function value<T = bigint>(block: number, to: string, fn: string, args: unknown[] = []): Promise<T | null> {
  const result = await read(block, to, fn, args);
  return result === null ? null : (result[0] as T);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const range = (length: bigint) => Array.from({ length: Number(length) }, (_, index) => index);
const sum = (values: Iterable<bigint>) => [...values].reduce((total, item) => total + item, 0n);
const add = (map: Map<string, bigint>, key: string, amount: bigint) =>
  map.set(key.toLowerCase(), (map.get(key.toLowerCase()) ?? 0n) + amount);
const iso = (timestamp: number) => new Date(timestamp * 1000).toISOString().replace('.000Z', 'Z');

function fixed(numerator: bigint, denominator: bigint, digits: number): string {
  const scaled = (numerator * 10n ** BigInt(digits)) / denominator;
  const text = scaled.toString().padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
const usd = (units: bigint) => fixed(units, 10n ** 6n, 6);

interface Reading {
  /** USDC base units; null where the venue is not deployed at the block. */
  size: bigint | null;
  source: string;
  /** Why test 1 fails at this reading, where the reading shows it. */
  test1?: string;
  /** USDC supplied, by collateral token; the zero address is idle USDC. */
  collateral?: Map<string, bigint>;
  /** The same USDC by Morpho Blue market id. */
  markets?: Map<string, bigint>;
  /** The collateral tokens a pool accepts, where its split cannot be read. */
  accepted?: string[];
  /** The other venue the largest part of the assets is held through. */
  through?: { venue: string; assets: bigint };
}

type Supplied = Map<string, bigint>;

/**
 * What a holder has supplied to Morpho Blue markets, by collateral token and by market id; a
 * market with no collateral token is idle cash. Shares are valued at the market's stored totals.
 */
async function positions(block: number, holder: string, ids: string[]): Promise<[Supplied, Supplied]> {
  const byToken: Supplied = new Map();
  const byMarket: Supplied = new Map();
  await Promise.all(
    ids.map(async (id) => {
      const [params, market, position] = await Promise.all([
        read(block, MORPHO, 'idToMarketParams', [id]),
        read(block, MORPHO, 'market', [id]),
        read(block, MORPHO, 'position', [id, holder]),
      ]);
      const [shares, totalAssets, totalShares]: bigint[] = [
        position!.supplyShares,
        market!.totalSupplyAssets,
        market!.totalSupplyShares,
      ];
      // SharesMathLib.toAssetsDown, with Morpho's virtual assets and shares.
      const assets = (shares * (totalAssets + 1n)) / (totalShares + 10n ** 6n);
      add(byToken, params!.collateralToken, assets);
      add(byMarket, id, assets);
    })
  );
  return [byToken, byMarket];
}

async function metaMorpho(block: number, address: string): Promise<[Supplied, Supplied]> {
  const length = await value(block, address, 'withdrawQueueLength');
  const ids = await Promise.all(range(length!).map((index) => value<string>(block, address, 'withdrawQueue', [index])));
  return positions(block, address, ids as string[]);
}

/** A Vault V2: idle USDC and what each adapter holds. */
async function vaultV2(block: number, address: string): Promise<Partial<Reading>> {
  const factories = ADAPTER_FACTORIES[target.network];
  const [idle, count, ...gates] = await Promise.all([
    value(block, USDC, 'balanceOf', [address]),
    value(block, address, 'adaptersLength'),
    ...GATES.map((gate) => value<string>(block, address, gate)),
  ]);
  const collateral = new Map([[ZeroAddress, idle as bigint]]);
  const markets: Supplied = new Map();
  const inner = new Map<string, bigint>();
  await Promise.all(
    range(count as bigint).map(async (index) => {
      const adapter = (await value<string>(block, address, 'adapters', [index]))!;
      const [held, ofVault, ofMarket] = await Promise.all([
        value(block, adapter, 'realAssets'),
        value<boolean>(block, factories.vaultV1, 'isMorphoVaultV1Adapter', [adapter]),
        value<boolean>(block, factories.marketV1, 'isMorphoMarketV1AdapterV2', [adapter]),
      ]);
      if (ofVault) {
        const v1 = (await value<string>(block, adapter, 'morphoVaultV1'))!;
        const [split, v1Size] = await Promise.all([metaMorpho(block, v1), value(block, v1, 'totalAssets')]);
        if (v1Size! >= MIN_SIZE && !candidates.some((candidate) => same(candidate.address, v1))) {
          throw new Error(`${address} holds assets through ${v1}, which is at or above $100M and not a candidate`);
        }
        // The adapter's part of each market of the first-generation vault, pro rata.
        const total = sum(split[0].values());
        [collateral, markets].forEach((map, index) => {
          if (total > 0n) for (const [key, assets] of split[index]) add(map, key, (assets * held!) / total);
        });
        if (held! > 0n) add(inner, v1, held!);
      } else if (ofMarket) {
        const length = await value(block, adapter, 'marketIdsLength');
        const ids = await Promise.all(range(length!).map((id) => value<string>(block, adapter, 'marketIds', [id])));
        const split = await positions(block, adapter, ids as string[]);
        [collateral, markets].forEach((map, index) => {
          for (const [key, assets] of split[index]) add(map, key, assets);
        });
      } else if (held! > 0n) {
        throw new Error(`Adapter ${adapter} of ${address} at block ${block} is of no known kind and holds ${held}`);
      }
    })
  );
  const [largest] = [...inner].sort((a, b) => (a[1] < b[1] ? 1 : -1));
  return {
    collateral,
    markets,
    through: largest && { venue: largest[0], assets: largest[1] },
    test1: gates.some((gate) => gate !== ZeroAddress) ? 'a deposit or withdrawal gate is set' : undefined,
  };
}

async function readVenue(block: number, candidate: Candidate): Promise<Reading> {
  const { kind, address } = candidate;
  const get = <T = bigint>(fn: string, args: unknown[] = []) => value<T>(block, address, fn, args);

  if (kind === 'aave') {
    const reserve = await read(block, address, 'getReserveData', [USDC]);
    return { size: reserve && (await value(block, reserve.aToken, 'totalSupply')), source: 'aToken.totalSupply()' };
  }
  if (kind === 'compound') return { size: await get('totalSupply'), source: 'Comet.totalSupply()' };
  if (kind === 'moonwell') {
    const [cash, borrows, reserves] = await Promise.all([get('getCash'), get('totalBorrows'), get('totalReserves')]);
    const source = 'getCash() + totalBorrows() - totalReserves()';
    return { size: cash === null ? null : cash + borrows! - reserves!, source };
  }
  if (kind === 'dolomite') {
    const source = 'getMarketTotalPar(USDC).supply x getMarketCurrentIndex(USDC).supply';
    const count = await get('getNumMarkets');
    if (count === null) return { size: null, source };
    const tokens = await Promise.all(range(count).map((id) => get<string>('getMarketTokenAddress', [id])));
    const id = tokens.findIndex((token) => same(token!, USDC));
    if (id < 0) return { size: null, source };
    const [par, index] = await Promise.all([
      get<Result>('getMarketTotalPar', [id]),
      get<Result>('getMarketCurrentIndex', [id]),
    ]);
    // One cross-margin pool: any of its market tokens can stand behind a USDC borrow.
    const accepted = (tokens as string[]).filter((token) => !same(token, USDC));
    return { size: ((par!.supply as bigint) * (index!.supply as bigint)) / 10n ** 18n, source, accepted };
  }
  if (kind === 'view') {
    const { fn, decimals, price, label } = candidate.size!;
    const [amount, unit] = await Promise.all([get(fn), price ? value(block, price.target, price.fn) : 10n ** 18n]);
    if (amount === null) return { size: null, source: label };
    if (unit === null) throw new Error(`${candidate.name}: no price at ${price!.target}, block ${block}`);
    return { size: (amount * unit) / 10n ** 18n / 10n ** BigInt(decimals - 6), source: label };
  }
  if (kind === 'stream') {
    const source = 'totalSupply() x roundPricePerShare(round() - 1)';
    const [supply, round] = await Promise.all([get('totalSupply'), get('round')]);
    if (supply === null) return { size: null, source };
    return { size: (supply * (await get('roundPricePerShare', [round! - 1n]))!) / 10n ** 6n, source };
  }
  if (kind === 'morpho-market') {
    const source = 'Morpho.market(id).totalSupplyAssets';
    const [params, market] = await Promise.all([
      read(block, MORPHO, 'idToMarketParams', [address]),
      read(block, MORPHO, 'market', [address]),
    ]);
    // A market that is not created yet has no last update.
    if (!market || market.lastUpdate === 0n) return { size: null, source };
    const test1 = same(params!.loanToken, USDC) ? undefined : 'the loan token is not USDC';
    return {
      size: market.totalSupplyAssets,
      source,
      test1,
      collateral: new Map([[params!.collateralToken.toLowerCase(), market.totalSupplyAssets]]),
    };
  }

  // The ERC-4626 kinds.
  const [size, asset] = await Promise.all([get('totalAssets'), get<string>('asset')]);
  const reading: Reading = { size, source: 'totalAssets()' };
  if (size === null) return reading;
  if (kind === 'morpho') [reading.collateral, reading.markets] = await metaMorpho(block, address);
  if (kind === 'morpho-v2') Object.assign(reading, await vaultV2(block, address));
  if (kind === 'euler') {
    const [cash, vaults, hook] = await Promise.all([
      get('cash'),
      get<string[]>('LTVList'),
      read(block, address, 'hookConfig'),
    ]);
    // Euler Vault Kit Constants.sol: OP_DEPOSIT, OP_MINT, OP_WITHDRAW and OP_REDEEM are the four lowest bits.
    if (hook!.hookedOps & 15n) reading.test1 = 'a deposit or withdrawal operation is hooked';
    const ltvs = await Promise.all([...vaults!].map((collateral) => get('LTVBorrow', [collateral])));
    const lentAgainst = [...vaults!].filter((_, index) => ltvs[index]! > 0n);
    reading.accepted = (await Promise.all(
      lentAgainst.map((collateral) => value<string>(block, collateral, 'asset'))
    )) as string[];
    reading.collateral = new Map([[ZeroAddress, cash!]]);
  }
  if (kind === 'stata') {
    const [aToken, reserve] = await Promise.all([
      get<string>('aToken'),
      read(block, candidate.through!, 'getReserveData', [USDC]),
    ]);
    if (!same(aToken!, reserve!.aToken))
      throw new Error(`${candidate.name} does not wrap the USDC aToken of ${candidate.through}`);
    reading.through = { venue: candidate.through!, assets: (await value(block, aToken!, 'balanceOf', [address]))! };
  }
  if (!same(asset!, USDC)) reading.test1 = 'asset() is not USDC at the reading';
  return reading;
}

type Test = 'pass' | 'fail' | 'waived' | 'unverified' | 'n/a';
interface Row {
  candidate: Candidate;
  month: string;
  block: number;
  timestamp: number;
  reading: Reading;
  tests: Test[];
  reasons: string[];
  /** Idle USDC and USDC lent against the listed collateral, where the reading has a split. */
  listed?: bigint;
  /** The single market of the set that month in which the venue has the most. */
  market?: { venue: string; assets: bigint };
  passes: boolean;
  wrapper: boolean;
  /** In the set when a vault that is mostly one single market of the set is not left out. */
  vaultsKept: boolean;
  inSet: boolean;
  /** Set B of client/PROGRAMME.md: tests 1 to 3, whatever the collateral, a wrapper left out. */
  broad: boolean;
}

/** Tests 1 to 4 for one venue at one reading. */
function decide(
  candidate: Candidate,
  reading: Reading,
  symbols: Map<string, string>
): Pick<Row, 'tests' | 'reasons' | 'listed'> {
  const { size, collateral, accepted } = reading;
  if (size === null) return { tests: ['n/a', 'n/a', 'n/a', 'n/a'], reasons: ['did not exist at the reading'] };
  const reasons: string[] = [];
  const settle = (failure?: string, verdict?: Verdict): Test => {
    if (failure) reasons.push(failure);
    else if (verdict?.result === 'fail') reasons.push(verdict.reason);
    return failure ? 'fail' : verdict?.result ?? 'pass';
  };
  // Tests 1 and 2 go by terms: the venue's own, else those of its kind; with neither they were not read.
  const terms = (test: 'test1' | 'test2') =>
    candidate[test] ?? TERMS[candidate.kind]?.[test] ?? NOT_READ('the terms of the venue');
  const windowEnd = candidate.windowEndOnly ? ' at every rule reading: at or above it only at the window end' : '';
  const tests = [
    settle(reading.test1, terms('test1')),
    settle(undefined, terms('test2')),
    settle(size < MIN_SIZE ? `below $100M${windowEnd}` : undefined),
  ];
  const listedAssets =
    collateral &&
    sum([...collateral].filter(([token]) => token === ZeroAddress || listed.has(token)).map(([, assets]) => assets));
  if (candidate.ruleClass === 'named governance venue') tests.push('waived');
  else if (accepted) {
    const outside = [...new Set(accepted.map((token) => token.toLowerCase()))].filter((token) => !listed.has(token));
    const names = outside.slice(0, 4).map((token) => symbols.get(token));
    const more = outside.length > 4 ? ` and ${outside.length - 4} more` : '';
    tests.push(settle(outside.length ? `accepts collateral outside the list: ${names.join(' ')}${more}` : undefined));
  } else if (collateral && size > 0n) {
    const short = listedAssets! * 100n < size * MIN_LISTED;
    tests.push(settle(short ? `listed collateral ${fixed(listedAssets! * 100n, size, 4)}% of assets` : undefined));
  } else tests.push(collateral ? 'n/a' : settle(undefined, candidate.test4 ?? NOT_READ('the collateral')));
  return { tests, reasons, listed: accepted ? undefined : listedAssets };
}

/** The history's first reading at or after 00:00 UTC of each month's 7th, with what the history holds at it. */
function monthReadings(): { month: string; block: number; timestamp: number; values: Record<string, string | null> }[] {
  const samples: { block: number; values: Record<string, string | null> }[] = readFileSync(
    join(OUT_DIR, 'raw.jsonl'),
    'utf8'
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  samples.sort((a, b) => a.block - b.block);
  return MONTHS.slice(0, 12).map((month) => {
    const midnight = Date.parse(month) / 1000;
    const first = samples.find((sample) => Number(sample.values.timestamp) >= midnight);
    // The history has a reading about every four hours; a later one would mean a gap.
    if (!first || Number(first.values.timestamp) - midnight >= 4 * 3600) {
      throw new Error(`raw.jsonl has no reading within four hours after ${month} 00:00 UTC`);
    }
    return { month, block: first.block, timestamp: Number(first.values.timestamp), values: first.values };
  });
}

/**
 * Every venue of the history is a candidate under the same name and contract, and no candidate
 * carries a name the history does not have.
 */
function checkHistoryVenues(): void {
  const collected = [
    ...vault.providers.map((provider) => ({
      name: provider.name,
      // The registry keeps the Aave PoolAddressesProvider as the market; the reads need the pool.
      market: provider.kind === ProviderKindEnum.AaveV3 ? network.external.aaveV3.pool : provider.market,
    })),
    ...target.extraVenues,
  ];
  const named = candidates.filter((candidate) => candidate.provider);
  const matches = (candidate: Candidate, venue: { name: string; market: string }) =>
    candidate.provider === venue.name && same(candidate.address, venue.market);
  for (const venue of collected) {
    if (!named.some((candidate) => matches(candidate, venue)))
      throw new Error(`${venue.name} of the history is not a candidate`);
  }
  for (const candidate of named) {
    if (!collected.some((venue) => matches(candidate, venue)))
      throw new Error(`${candidate.provider} is not a venue of the history`);
  }
}

/** The listed collateral is matched by address; each address must be the token the table says. */
async function checkListedTokens(block: number): Promise<void> {
  await Promise.all(
    [...listed.values()].map(async (token) => {
      const [symbol, decimals] = await Promise.all([
        value<string>(block, token.address, 'symbol'),
        value(block, token.address, 'decimals'),
      ]);
      if (symbol !== token.symbol || decimals !== BigInt(token.decimals)) {
        throw new Error(
          `${token.address} is ${symbol} with ${decimals} decimals, not ${token.symbol} with ${token.decimals}`
        );
      }
    })
  );
}

function writeCsv(file: string, header: string[], rows: (string | number)[][]): void {
  const lines = [header, ...rows].map((row) => {
    if (row.some((cell) => /[,\n"]/.test(String(cell))))
      throw new Error(`${file}: a cell needs quoting: ${row.join(' | ')}`);
    return row.join(',');
  });
  writeFileSync(join(OUT_DIR, file), lines.join('\n') + '\n');
  console.log(`${file}: ${rows.length} rows`);
}

async function main(): Promise<void> {
  const chain = chains[target.network]!;
  const url =
    process.env[chain.rpcEnvKey] ||
    (process.env.ALCHEMY_API_KEY && `https://${target.alchemy}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);
  if (!url) throw new Error(`Set ${chain.rpcEnvKey} (archive) or ALCHEMY_API_KEY`);
  rpc = new JsonRpcProvider(url, chain.chainId, { staticNetwork: true, batchMaxCount: 1 });

  checkHistoryVenues();
  const readings = monthReadings();
  await checkListedTokens(readings[11].block);

  const table: Row[] = [];
  const collateralRows: (string | number)[][] = [];
  const history = { equal: 0, different: 0 };
  for (const { month, block, timestamp, values } of readings) {
    const onChain = value(block, MULTICALL3, 'getCurrentBlockTimestamp');
    const venues = await Promise.all(candidates.map((candidate) => readVenue(block, candidate)));
    if (Number(await onChain) !== timestamp)
      throw new Error(`Block ${block} is not at ${timestamp}, as raw.jsonl has it`);

    // Symbols are labels only; a token without a readable one is shown by its address.
    const tokens = [
      ...new Set(venues.flatMap((reading) => [...(reading.collateral?.keys() ?? []), ...(reading.accepted ?? [])])),
    ];
    const symbols = new Map<string, string>();
    await Promise.all(
      tokens.map(async (token) => {
        const symbol = token === ZeroAddress ? null : await read(block, token, 'symbol', [], true);
        symbols.set(token.toLowerCase(), symbol ? String(symbol[0]).replace(/[^\w.+-]/g, '') : token);
      })
    );

    const rows: Row[] = candidates.map((candidate, index) => {
      const decided = decide(candidate, venues[index], symbols);
      const passes =
        decided.tests.slice(0, 3).every((test) => test === 'pass') && ['pass', 'waived'].includes(decided.tests[3]);
      return {
        candidate,
        month,
        block,
        timestamp,
        reading: venues[index],
        ...decided,
        passes,
        wrapper: false,
        vaultsKept: passes,
        inSet: passes,
        broad: decided.tests.slice(0, 3).every((test) => test === 'pass'),
      };
    });
    // The overlap with the single markets of the set: where a venue has the most in one of them.
    for (const row of rows) {
      for (const [id, assets] of row.reading.markets ?? []) {
        const market = rows.find((other) => other.passes && same(other.candidate.address, id));
        if (market && assets > (row.market?.assets ?? 0n)) row.market = { venue: market.candidate.name, assets };
      }
    }
    // A wrapper is not a second venue: most of its assets are held through a venue that passes the tests itself.
    for (const row of rows) {
      const { size, through } = row.reading;
      const inner = through && rows.find((other) => same(other.candidate.address, through.venue));
      if (inner?.reading.through)
        throw new Error(`${row.candidate.name} is held through ${inner.candidate.name}, itself held through a venue`);
      if (!size || !inner || through!.assets * 2n <= size) continue;
      // Set B asks the venue behind it for tests 1 to 3 only.
      if (inner.broad && row.broad) {
        row.broad = false;
        if (!inner.passes) {
          row.reasons.push(
            `wrapper: ${fixed(through!.assets * 100n, size, 2)}% of assets held through ${
              inner.candidate.name
            } which passes tests 1 to 3`
          );
        }
      }
      if (!inner.passes) continue;
      row.wrapper = true;
      row.vaultsKept = false;
      row.inSet = false;
      row.reasons.push(
        `wrapper: ${fixed(through!.assets * 100n, size, 2)}% of assets held through ${
          inner.candidate.name
        } which passes the tests`
      );
    }
    // Nor is a vault that has most of its assets in one single market of the set.
    for (const row of rows) {
      const { market, reading } = row;
      if (!row.inSet || !market || market.assets * 2n <= reading.size!) continue;
      row.inSet = false;
      row.reasons.push(
        `same book: ${fixed(market.assets * 100n, reading.size!, 2)}% of assets in ${market.venue} which is in the set`
      );
    }
    for (const row of rows) {
      if (!row.inSet && !row.reasons.length)
        throw new Error(`${row.candidate.name} is out of the set at ${month} with no test failed`);
      // The same contract at the same block: where the history holds a size, it is compared with this one.
      const inHistory = row.candidate.provider && values[`${row.candidate.provider}.supplied`];
      if (!inHistory || row.reading.size === null) continue;
      if (BigInt(inHistory) === row.reading.size) history.equal++;
      else
        console.log(
          `${++history.different}. ${row.candidate.provider} at ${block}: ${
            row.reading.size
          } here, ${inHistory} in raw.jsonl`
        );
    }
    if (rows.filter((row) => row.inSet).length < 2) throw new Error(`Fewer than two venues are in the set at ${month}`);
    table.push(...rows);

    for (const { candidate, reading } of rows) {
      const { size, collateral, accepted } = reading;
      if (size === null) continue;
      const line = (asset: string, token: string, isListed: boolean, assets: bigint | null) =>
        collateralRows.push([
          target.network,
          candidate.name,
          candidate.address,
          month,
          block,
          asset,
          token && getAddress(token),
          isListed ? 1 : 0,
          assets === null ? '' : usd(assets),
          assets === null || !size ? '' : fixed(assets * 100n, size, 4),
        ]);
      const split = [...(collateral ?? [])].filter(([, assets]) => assets > 0n).sort((a, b) => (a[1] < b[1] ? 1 : -1));
      for (const [token, assets] of split) {
        if (token === ZeroAddress) line('idle', '', true, assets);
        else line(symbols.get(token)!, token, listed.has(token), assets);
      }
      // What totalAssets() counts beyond the positions.
      const unattributed = collateral && !accepted ? size - sum(collateral.values()) : 0n;
      if (unattributed > 0n) line('unattributed', '', false, unattributed);
      // A pool with no split to read: the collateral it accepts, without amounts.
      for (const token of new Set((accepted ?? []).map((item) => item.toLowerCase()))) {
        line(symbols.get(token)!, token, listed.has(token), null);
      }
    }
    console.log(`${month} block ${block}: ${rows.filter((row) => row.inSet).length} of ${rows.length} in the set`);
  }

  writeCsv(
    'venue-eligibility.csv',
    [
      'network',
      'venue',
      'provider',
      'kind',
      'address',
      'month',
      'block_number',
      'datetime_utc',
      'size_usd',
      'size_source',
      'test_1',
      'test_2',
      'test_3',
      'test_4',
      'listed_collateral_percent',
      'held_through',
      'held_through_percent',
      'largest_set_market',
      'largest_set_market_percent',
      'in_set',
      'in_set_vaults_kept',
      'in_set_broad',
      'reason',
    ],
    table.map(
      ({ candidate, month, block, timestamp, reading, tests, reasons, listed: listedAssets, market, ...row }) => {
        const { inSet } = row;
        const { size, through } = reading;
        const inner = through && candidates.find((other) => same(other.address, through.venue));
        return [
          target.network,
          candidate.name,
          candidate.provider ?? '',
          candidate.kind,
          candidate.address,
          month,
          block,
          iso(timestamp),
          size === null ? '' : usd(size),
          reading.source + (candidate.sizeNote ? ` (${candidate.sizeNote})` : ''),
          ...tests,
          listedAssets === undefined || !size ? '' : fixed(listedAssets * 100n, size, 4),
          through ? inner?.name ?? through.venue : '',
          through && size ? fixed(through.assets * 100n, size, 2) : '',
          market?.venue ?? '',
          market && size ? fixed(market.assets * 100n, size, 2) : '',
          inSet ? 1 : 0,
          row.vaultsKept ? 1 : 0,
          row.broad ? 1 : 0,
          inSet ? '' : reasons.join('; '),
        ];
      }
    )
  );
  writeCsv(
    'venue-collateral-monthly.csv',
    [
      'network',
      'venue',
      'address',
      'month',
      'block_number',
      'collateral_asset',
      'collateral_token',
      'listed',
      'supplied_usd',
      'share_percent',
    ],
    collateralRows
  );
  console.log(`Sizes against raw.jsonl at the same block: ${history.equal} equal, ${history.different} different`);
  const vaults = table.filter((row) => row.vaultsKept && row.reading.markets);
  console.log(
    `Same book: ${vaults.filter((row) => !row.inSet).length} of the ${
      vaults.length
    } vault-months that pass the tests hold more than half of their assets in one single market of the set and are left out`
  );
  for (const found of FOUND_NOT_READ.filter((item) => item.network === target.network)) {
    const most = Math.max(...found.readings.slice(0, 12));
    console.log(
      `Not in the table, a DefiLlama figure not read on-chain: ${found.name}, ${most}M at most: ${found.why}`
    );
  }

  // Half-open UTC periods, consecutive months merged; September's ends on 7 October.
  const periodsOf = (pick: (row: Row) => boolean): string => {
    const lines = candidates
      .filter((item) => item.provider)
      .map((candidate) => {
        const list: string[][] = [];
        table
          .filter((row) => row.candidate === candidate && pick(row))
          .forEach(({ month }) => {
            const next = MONTHS[MONTHS.indexOf(month) + 1];
            if (list.length && list[list.length - 1][1] === month) list[list.length - 1][1] = next;
            else list.push([month, next]);
          });
        return `  ${JSON.stringify(candidate.provider)}: ${JSON.stringify(list)}`;
      });
    return `{\n${lines.join(',\n')}\n}\n`;
  };
  for (const candidate of candidates) {
    const marks = table.filter((row) => row.candidate === candidate).map((row) => (row.inSet ? 'x' : '.'));
    console.log(`${marks.join('')}  ${candidate.name}`);
  }
  const json = periodsOf((row) => row.inSet);
  const vaultsKept = periodsOf((row) => row.vaultsKept);
  const broad = periodsOf((row) => row.broad);
  console.log(json);
  console.log(`With the vaults that are mostly one single market of the set kept:\n${vaultsKept}`);
  console.log(`Set B, tests 1 to 3 whatever the collateral, wrappers left out:\n${broad}`);
  // Set B has what the history can simulate. What it cannot: a venue of set B the collector does
  // not read, and a venue whose test 1 or 2 was not read and so is neither passed nor failed.
  const months = (pick: (row: Row) => boolean, candidate: Candidate) =>
    table
      .filter((row) => row.candidate === candidate && pick(row))
      .map((row) => row.month.slice(0, 7))
      .join(' ');
  for (const candidate of candidates) {
    const unread = months((row) => row.broad, candidate);
    if (unread && !candidate.provider) console.log(`In set B and not in the history: ${candidate.name}: ${unread}`);
    const open = months(
      (row) =>
        row.tests[2] === 'pass' &&
        !row.tests.slice(0, 2).includes('fail') &&
        row.tests.slice(0, 2).some((test) => test !== 'pass'),
      candidate
    );
    if (open) console.log(`At $100M and not in set B, test 1 or 2 not read: ${candidate.name}: ${open}`);
  }
  if (process.argv[3]) writeFileSync(process.argv[3], json);
  if (process.argv[4]) writeFileSync(process.argv[4], vaultsKept);
  if (process.argv[5]) writeFileSync(process.argv[5], broad);
}

main().catch((error) => {
  // The RPC URL carries the key; keep it out of the log.
  console.error(String(error.message ?? error).replace(/\/v2\/[\w-]+/g, '/v2/<redacted>'));
  process.exit(1);
});
