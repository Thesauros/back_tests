/**
 * Checks the collector's "rate after our deposit" against real transactions on a Hardhat fork.
 *
 * collect-history.ts measures that rate inside one eth_call. Here an account on a fork of the
 * same block approves and deposits the same amount through the venue's public entry point,
 * and the rate is read back the way the engine reads it. The two must agree up to the second
 * or two of interest the fork's extra blocks accrue.
 *
 * Run, with a fork node up (any block; the script resets it):
 *   HH_CHAIN_ID=8453 HH_FORK_URL=<archive RPC> npx hardhat node --config apps/rebalancer/fork/hardhat.fork.config.js --port 8599
 *   FORK_URL=<the same archive RPC> yarn ts-node ... scripts/tangem/verify-on-fork.ts scripts/tangem/config.base.json
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { AbiCoder, Contract, JsonRpcProvider, ZeroAddress, keccak256, toBeHex } from 'ethers';
import { NetworkEnum, TokenEnum } from '@backend-ts/enums';
import { deployments, ProviderKindEnum } from '@backend-ts/networks';
import { Kind, TARGETS } from './targets';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { network: NetworkEnum; providers: string[] };
const network = deployments[config.network]!;
const vault = network.vaults[TokenEnum.USDC]!;
const USDC = vault.asset;
const MILLIONS = [6, 10];
const CHECKS = 3;
/** The fork mines a block a second after the sample, so a deposit sees a few seconds more interest. */
const TOLERANCE = 1e-4;

const raw = readFileSync(join(process.cwd(), 'data/tangem', config.network.toLowerCase(), 'raw.jsonl'), 'utf8')
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
  const fork = new JsonRpcProvider(process.env.FORK_NODE ?? 'http://127.0.0.1:8599', undefined, { batchMaxCount: 1 });
  const signer = await fork.getSigner(0);
  const account = await signer.getAddress();
  const donor = vault.providers.find((provider) => provider.kind === ProviderKindEnum.Morpho)!;
  // From the head of the real chain: on an early fork block the provider is not deployed yet.
  const donorCode = (await new JsonRpcProvider(process.env.FORK_URL).getCode(donor.address)).toLowerCase();
  const clone = '0x7a9e000000000000000000000000000000000fff';
  let worst = 0;
  let compared = 0;

  for (let check = 0; check < CHECKS; check++) {
    const sample = raw[Math.floor(((check + 0.5) * raw.length) / CHECKS)];
    await fork.send('hardhat_reset', [{ forking: { jsonRpcUrl: process.env.FORK_URL, blockNumber: sample.block } }]);
    const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [account, 9]));
    await fork.send('hardhat_setStorageAt', [USDC, slot, toBeHex(100n * 10n ** 12n, 32)]);
    const timestamp = Number(sample.values.timestamp);

    for (const name of config.providers) {
      const { kind, market } = venueOf(name);
      for (const millions of MILLIONS) {
        const expected = sample.values[`${name}.rateAfter${millions}`];
        if (expected === null) continue;
        const amount = BigInt(millions) * 10n ** 12n;
        const snapshot = await fork.send('evm_snapshot', []);
        await fork.send('evm_setNextBlockTimestamp', [timestamp + 1]);
        await (await new Contract(USDC, ['function approve(address,uint256)'], signer).approve(market, amount)).wait();
        let rate: bigint;
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
          rate = (await pool.getReserveData(USDC)).currentLiquidityRate;
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
          rate = (await comet.getSupplyRate(await comet.getUtilization())) * 10n ** 9n * 31536000n;
        } else {
          const metaMorpho = new Contract(market, ['function deposit(uint256,address)'], signer);
          await (await metaMorpho.deposit(amount, account)).wait();
          await fork.send('hardhat_setCode', [
            clone,
            donorCode.split(donor.market.slice(2).toLowerCase()).join(market.slice(2).toLowerCase()),
          ]);
          rate = await new Contract(
            clone,
            ['function getDepositRate(address) view returns (uint256)'],
            fork
          ).getDepositRate(ZeroAddress);
        }
        await fork.send('evm_revert', [snapshot]);
        const deviation = Math.abs(Number(rate) / Number(expected) - 1);
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
    `Fork check passed: ${compared} deposits on ${CHECKS} blocks, largest deviation ${(worst * 100).toExponential(2)}%`
  );
}

main().catch((error) => {
  console.error(String(error.message ?? error).replace(/\/v2\/[\w-]+/g, '/v2/<redacted>'));
  process.exit(1);
});
