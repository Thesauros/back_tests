/**
 * What stands behind each MetaMorpho venue today: its supply by collateral asset, from the
 * Morpho API. A snapshot of the day it is run, not a history.
 *
 * Run: yarn ts-node ... scripts/tangem/collect-collateral.ts Base
 * Writes data/tangem/<network>/venue-collateral.csv.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { TokenEnum } from '@backend-ts/enums';
import { chains, deployments, ProviderKindEnum } from '@backend-ts/networks';
import { TARGETS } from './targets';

const target = TARGETS[process.argv[2]];
if (!target) throw new Error(`Usage: collect-collateral.ts ${Object.keys(TARGETS).join('|')}`);
const chainId = chains[target.network]!.chainId;

const venues = [
  ...deployments[target.network]!.vaults[TokenEnum.USDC]!.providers.filter(
    (provider) => provider.kind === ProviderKindEnum.Morpho
  ).map((provider) => ({ name: provider.name, market: provider.market })),
  ...target.extraVenues.filter((venue) => venue.kind === 'morpho'),
];

const QUERY = `query ($address: String!, $chainId: Int!) {
  vaultByAddress(address: $address, chainId: $chainId) {
    state { totalAssetsUsd allocation { supplyAssetsUsd market { collateralAsset { symbol } } } }
  }
}`;

async function main(): Promise<void> {
  const asOf = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const rows: (string | number)[][] = [];
  for (const venue of venues) {
    const response = await fetch('https://blue-api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { address: venue.market, chainId } }),
    });
    const { state } = (await response.json()).data.vaultByAddress;
    // A market without collateral is the vault's idle cash.
    const byAsset = new Map<string, number>();
    for (const { supplyAssetsUsd, market } of state.allocation) {
      const asset = market.collateralAsset?.symbol ?? 'idle';
      byAsset.set(asset, (byAsset.get(asset) ?? 0) + (supplyAssetsUsd ?? 0));
    }
    [...byAsset.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, usd]) => usd > 0)
      .forEach(([asset, usd]) =>
        rows.push([
          target.network,
          venue.name,
          venue.market,
          asOf,
          asset,
          ((usd / state.totalAssetsUsd) * 100).toFixed(2),
          usd.toFixed(2),
        ])
      );
  }
  const header = [
    'network',
    'provider',
    'venue_address',
    'as_of_utc',
    'collateral_asset',
    'share_percent',
    'supplied_usd',
  ];
  const file = join(process.cwd(), 'data/tangem', target.network.toLowerCase(), 'venue-collateral.csv');
  writeFileSync(file, [header, ...rows].map((row) => row.join(',')).join('\n') + '\n');
  console.log(`venue-collateral.csv: ${rows.length} rows`);
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
