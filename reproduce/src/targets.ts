/** The networks of the Tangem data pack and the venues collected beyond each live vault's own providers. */
import { NetworkEnum } from '@backend-ts/enums';

export type Kind = 'aave' | 'compound' | 'morpho';
export interface Venue {
  name: string;
  kind: Kind;
  /** Aave-style pool, Comet, or MetaMorpho vault. */
  market: string;
  /** Our adapter, for venues of the live vault. */
  provider?: string;
}

export interface Target {
  network: NetworkEnum;
  /** Alchemy subdomain, used when the network's own RPC variable is not set. */
  alchemy: string;
  /** About four hours of blocks. */
  stepBlocks: number;
  /** Chainlink ETH / USD, eight decimals: prices a rebalance's gas in the vault's asset. */
  ethUsdFeed: string;
  /** The vault generation before the live one. */
  previousVault: string;
  /** OP Stack only: a real one-leg rebalance, priced by the L1 fee oracle at every sample. */
  l1FeeSampleTx?: string;
  /** Deep venues outside the live vault. */
  extraVenues: Venue[];
}

export const TARGETS: Record<string, Target> = {
  Ethereum: {
    network: NetworkEnum.Ethereum,
    alchemy: 'eth-mainnet',
    stepBlocks: 1200,
    ethUsdFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    previousVault: '0x839E57080C18195D8D343a02c2f623b5916f7383',
    // The other five venues of the Ethereum study in the research article.
    extraVenues: [
      { name: 'SparkProvider', kind: 'aave', market: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987' },
      { name: 'GauntletCoreMorphoProvider', kind: 'morpho', market: '0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458' },
      { name: 'GauntletRwaMorphoProvider', kind: 'morpho', market: '0xA8875aaeBc4f830524e35d57F9772FfAcbdD6C45' },
      { name: 'OevBoostedMorphoProvider', kind: 'morpho', market: '0x68Aea7b82Df6CcdF76235D46445Ed83f85F845A3' },
      { name: 'HakutoraMorphoProvider', kind: 'morpho', market: '0x974c8FBf4fd795F66B85B73ebC988A51F1A040a9' },
    ],
  },
  Base: {
    network: NetworkEnum.Base,
    alchemy: 'base-mainnet',
    stepBlocks: 7200,
    ethUsdFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    previousVault: '0xCA6029f2d5f5d36DA047206Ae7A254Fa80F579B8',
    l1FeeSampleTx: '0x9e7364ffe559f5cc84e4aed506dcc3e246efedefe55aceba06641da55d31854d',
    // The three deepest MetaMorpho USDC vaults of the year, and Re7, which TS-389 names.
    extraVenues: [
      { name: 'GauntletPrimeMorphoProvider', kind: 'morpho', market: '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61' },
      { name: 'SparkMorphoProvider', kind: 'morpho', market: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A' },
      { name: 'SteakhouseMorphoProvider', kind: 'morpho', market: '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183' },
      { name: 'Re7MorphoProvider', kind: 'morpho', market: '0x12AFDeFb2237a5963e7BAb3e2D46ad0eee70406e' },
    ],
  },
};
