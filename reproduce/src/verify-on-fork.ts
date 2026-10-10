/**
 * Checks the collector's "rate after our deposit" against real transactions on a Hardhat fork.
 *
 * collect-history.ts measures that rate inside one eth_call. Here an account on a fork of the
 * same block approves and deposits the same amount through the venue's public entry point,
 * and the rate is read back the way the engine reads it. The two must agree up to the second
 * or two of interest the fork's extra blocks accrue. Where the eth_call was refused, the
 * transaction must fail too.
 *
 * A venue Thesauros has no adapter for is read back by TangemLensWide's own view, as the
 * collector reads it. For such a venue the check shows that the deposit inside the eth_call
 * leaves the venue where a real transaction leaves it, not that the lens computes the rate
 * right: that is for the self-check of collect-history.ts, as far as plain reads go (a Vault
 * V2 and Fluid state no rate of their own to compare with).
 *
 * Run, with a fork node up (any block; the script resets it):
 *   HH_CHAIN_ID=8453 HH_FORK_URL=<archive RPC> npx hardhat node --config apps/rebalancer/fork/hardhat.fork.config.js --port 8599
 *   FORK_URL=<the same archive RPC> yarn ts-node ... scripts/tangem/verify-on-fork.ts scripts/tangem/config.base.deployed.json
 *
 * TANGEM_OUT=<directory> reads raw.jsonl from there instead of data/tangem/<network>;
 * TANGEM_BLOCKS=1,2,3 checks those blocks instead of three spread over the year.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { AbiCoder, Contract, JsonRpcProvider, ZeroAddress, keccak256, toBeHex, zeroPadValue } from 'ethers';
import { NetworkEnum, TokenEnum } from '@backend-ts/enums';
import { deployments, ProviderKindEnum } from '@backend-ts/networks';
import { Kind, LENS_KIND, TARGETS } from './targets';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { network: NetworkEnum; providers: string[] };
const network = deployments[config.network]!;
const vault = network.vaults[TokenEnum.USDC]!;
const USDC = vault.asset;
/** The collector's probes. */
const MILLIONS = [4, 6, 10];
const CHECKS = 3;
/** The fork mines a block a second after the sample, so a deposit sees a few seconds more interest. */
const TOLERANCE = 1e-4;

/** As in collect-history.ts. */
const LENS_WIDE = '0x7a9e000000000000000000000000000000000002';
/** A loader that does not parse an .env file's quotes leaves them on the value, and in the URL. */
const env = (name: string) => process.env[name]?.trim().replace(/^['"]|['"]$/g, '');
const FORK_URL = env('FORK_URL');
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
const lensWide: { deployedBytecode: string } = JSON.parse(
  readFileSync(join(__dirname, 'lens-wide.bytecode.json'), 'utf8')
);

const DIR = process.env.TANGEM_OUT || join(process.cwd(), 'data/tangem', config.network.toLowerCase());
const raw = readFileSync(join(DIR, 'raw.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { block: number; values: Record<string, string | null> })
  .sort((a, b) => a.block - b.block);

const LIVE_KIND: Record<ProviderKindEnum, Kind> = {
  [ProviderKindEnum.AaveV3]: 'aave',
  [ProviderKindEnum.CompoundV3]: 'compound',
  [ProviderKindEnum.Morpho]: 'morpho',
};

/** A provider's venue: the live vault's registry entry, or one of the venues collected beyond it. */
function venueOf(name: string): { kind: Kind; market: string } {
  const live = vault.providers.find((provider) => provider.name === name);
  if (live) {
    const kind = LIVE_KIND[live.kind];
    return { kind, market: kind === 'aave' ? network.external!.aaveV3!.pool : live.market };
  }
  const extra = TARGETS[config.network].extraVenues.find((venue) => venue.name === name);
  if (!extra) throw new Error(`Unknown provider ${name}`);
  return extra;
}

async function main(): Promise<void> {
  if (!FORK_URL) throw new Error('Set FORK_URL to the archive RPC the fork node runs on');
  const fork = new JsonRpcProvider(process.env.FORK_NODE ?? 'http://127.0.0.1:8599', undefined, { batchMaxCount: 1 });
  const signer = await fork.getSigner(0);
  const account = await signer.getAddress();
  const donor = vault.providers.find((provider) => provider.kind === ProviderKindEnum.Morpho)!;
  // From the head of the real chain: on an early fork block the provider is not deployed yet.
  const donorCode = (await new JsonRpcProvider(FORK_URL).getCode(donor.address)).toLowerCase();
  const clone = '0x7a9e000000000000000000000000000000000fff';
  let worst = 0;
  let compared = 0;

  const samples = process.env.TANGEM_BLOCKS
    ? process.env.TANGEM_BLOCKS.split(',').map((block) => raw.find((sample) => sample.block === Number(block)))
    : Array.from({ length: CHECKS }, (_, check) => raw[Math.floor(((check + 0.5) * raw.length) / CHECKS)]);
  for (const sample of samples) {
    if (!sample) throw new Error(`${DIR}/raw.jsonl has no reading at one of the blocks ${process.env.TANGEM_BLOCKS}`);
    await fork.send('hardhat_reset', [{ forking: { jsonRpcUrl: FORK_URL, blockNumber: sample.block } }]);
    const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [account, 9]));
    await fork.send('hardhat_setStorageAt', [USDC, slot, toBeHex(100n * 10n ** 12n, 32)]);
    await fork.send('hardhat_setCode', [LENS_WIDE, lensWide.deployedBytecode]);
    const timestamp = Number(sample.values.timestamp);

    for (const name of config.providers) {
      const { kind, market } = venueOf(name);
      // A venue the collector did not read here, or read before its deployment, checks nothing.
      if (sample.values[`${name}.rate`] == null) {
        throw new Error(`${name} has no reading at block ${sample.block}: nothing to check it against`);
      }
      for (const millions of MILLIONS) {
        const expected = sample.values[`${name}.rateAfter${millions}`];
        const amount = BigInt(millions) * 10n ** 12n;
        const snapshot = await fork.send('evm_snapshot', []);
        await fork.send('evm_setNextBlockTimestamp', [timestamp + 1]);
        // A single Morpho Blue market is entered at Morpho itself.
        const spender = kind === 'morpho-market' ? MORPHO : market;
        await (await new Contract(USDC, ['function approve(address,uint256)'], signer).approve(spender, amount)).wait();
        // Each branch sends the deposit and leaves the reading for after the try: only a
        // deposit that fails may pass for the collector's refusal.
        let readRate: () => Promise<bigint>;
        try {
          if (kind === 'aave') {
            const pool = new Contract(
              market,
              [
                'function supply(address,uint256,address,uint16)',
                'function getReserveData(address) view returns (uint256,uint128,uint128 currentLiquidityRate,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)',
              ],
              signer
            );
            await (await pool.supply(USDC, amount, account, 0)).wait();
            readRate = async () => (await pool.getReserveData(USDC)).currentLiquidityRate;
          } else if (kind === 'compound') {
            const comet = new Contract(
              market,
              [
                'function supply(address,uint256)',
                'function getUtilization() view returns (uint256)',
                'function getSupplyRate(uint256) view returns (uint64)',
              ],
              signer
            );
            await (await comet.supply(USDC, amount)).wait();
            readRate = async () => (await comet.getSupplyRate(await comet.getUtilization())) * 10n ** 9n * 31536000n;
          } else if (kind === 'morpho') {
            const metaMorpho = new Contract(market, ['function deposit(uint256,address)'], signer);
            await (await metaMorpho.deposit(amount, account)).wait();
            readRate = async () => {
              await fork.send('hardhat_setCode', [
                clone,
                donorCode.split(donor.market.slice(2).toLowerCase()).join(market.slice(2).toLowerCase()),
              ]);
              return new Contract(
                clone,
                ['function getDepositRate(address) view returns (uint256)'],
                fork
              ).getDepositRate(ZeroAddress);
            };
          } else if (kind === 'morpho-market') {
            const morpho = new Contract(
              MORPHO,
              [
                'function idToMarketParams(bytes32) view returns (address,address,address,address,uint256)',
                'function supply((address,address,address,address,uint256),uint256,uint256,address,bytes)',
              ],
              signer
            );
            await (await morpho.supply([...(await morpho.idToMarketParams(market))], amount, 0, account, '0x')).wait();
            readRate = () => wideRate(fork, kind, market);
          } else if (kind === 'morpho-v2' || kind === 'fluid' || kind === 'susdc') {
            // Vault V2, fToken and UsdcVault all take the ERC-4626 call.
            await (
              await new Contract(market, ['function deposit(uint256,address)'], signer).deposit(amount, account)
            ).wait();
            readRate = () => wideRate(fork, kind, market);
          } else {
            throw new Error(`${name}: no deposit for venue kind ${kind}`);
          }
        } catch (error) {
          // The collector's deposit was refused: the transaction must be refused as well.
          if (expected !== null || (error as { code?: string }).code !== 'CALL_EXCEPTION') throw error;
          await fork.send('evm_revert', [snapshot]);
          compared++;
          console.log(`block ${sample.block} ${name} $${millions}M: refused in the eth_call and on the fork`);
          continue;
        }
        const rate = await readRate();
        await fork.send('evm_revert', [snapshot]);
        if (expected === null)
          throw new Error(`${name} at ${sample.block}: refused in the eth_call, taken on the fork`);
        // Equal covers a rate of zero on both sides, where the ratio is not a number.
        const deviation = rate === BigInt(expected) ? 0 : Math.abs(Number(rate) / Number(expected) - 1);
        worst = Math.max(worst, deviation);
        compared++;
        console.log(
          `block ${sample.block} ${name} $${millions}M: eth_call ${(Number(expected) / 1e25).toFixed(6)}%, fork ${(
            Number(rate) / 1e25
          ).toFixed(6)}%, off by ${(deviation * 100).toExponential(2)}%`
        );
        if (deviation > TOLERANCE) throw new Error(`${name} at ${sample.block}: the fork disagrees with the eth_call`);
      }
    }
  }
  console.log(
    `Fork check passed: ${compared} deposits on ${samples.length} blocks, largest deviation ${(
      worst * 100
    ).toExponential(2)}%`
  );
}

/** The rate TangemLensWide reports for a venue without an adapter, read on the fork after the deposit. */
function wideRate(fork: JsonRpcProvider, kind: Kind, market: string): Promise<bigint> {
  return new Contract(LENS_WIDE, ['function rate(uint8,address,bytes32) view returns (uint256)'], fork).rate(
    LENS_KIND[kind],
    USDC,
    zeroPadValue(market, 32)
  );
}

main().catch((error) => {
  // The archive RPC URL carries the key: neither reaches the log, whatever characters they hold.
  console.error(
    [FORK_URL, env('ALCHEMY_API_KEY')]
      .filter((secret): secret is string => !!secret)
      .reduce((out, secret) => out.split(secret).join('<redacted>'), String(error.message ?? error))
      .replace(/\/v2\/[^\s"\\]+/g, '/v2/<redacted>')
  );
  process.exit(1);
});
