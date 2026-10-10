/** The networks of the Tangem data pack and the venues collected beyond each live vault's own providers. */
import { NetworkEnum } from '@backend-ts/enums';

export type Kind = 'aave' | 'compound' | 'morpho' | 'morpho-v2' | 'morpho-market' | 'fluid' | 'susdc';
/** As TangemLens numbers the kinds it reads, and from 3 on as TangemLensWide does. */
export const LENS_KIND: Record<Kind, number> = {
  aave: 0,
  compound: 1,
  morpho: 2,
  'morpho-v2': 3,
  'morpho-market': 4,
  fluid: 5,
  susdc: 6,
};
export interface Venue {
  name: string;
  kind: Kind;
  /**
   * Aave-style pool, Comet, MetaMorpho vault, Morpho Vault V2, Fluid fToken or Spark USDC Vault
   * (sUSDC); for a single Morpho Blue market, its 32-byte id.
   */
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
      // Venues of the selection rule (client/VENUE_RULE.md) that have no Thesauros adapter yet.
      { name: 'FluidProvider', kind: 'fluid', market: '0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33' },
      { name: 'SparkSavingsProvider', kind: 'susdc', market: '0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE' },
      { name: 'VaultBridgeMorphoProvider', kind: 'morpho', market: '0xBEefb9f61CC44895d8AEc381373555a64191A9c4' },
      {
        name: 'GauntletPrimeV2MorphoProvider',
        kind: 'morpho-v2',
        market: '0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0',
      },
      {
        name: 'SteakhousePrimeV2MorphoProvider',
        kind: 'morpho-v2',
        market: '0xbeef088055857739C12CD3765F20b7679Def0f51',
      },
      {
        // cbBTC / USDC, LLTV 86%.
        name: 'CbBtcMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64',
      },
      {
        // WBTC / USDC, LLTV 86%.
        name: 'WbtcMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49',
      },
      // Set B of client/PROGRAMME.md: the venues that pass tests 1 to 3 of the rule at a monthly reading,
      // whatever they lend against. Added after the others, so that the reads of those stay as they were.
      { name: 'UsualBoostedMorphoProvider', kind: 'morpho', market: '0xd63070114470f685b75B74D60EEc7c1113d33a3D' },
      { name: 'GauntletFrontierMorphoProvider', kind: 'morpho', market: '0xc582F04d8a82795aa2Ff9c8bb4c1c889fe7b754e' },
      {
        name: 'WaterlineReservoirMorphoProvider',
        kind: 'morpho',
        market: '0xbeEF346d7099865208Ff331e4f648f4154DDAa05',
      },
      { name: 'HyperithmApexMorphoProvider', kind: 'morpho', market: '0x777791C4d6DC2CE140D00D2828a7C93503c67777' },
      // 1337 USDC.
      { name: 'Vault1337MorphoProvider', kind: 'morpho', market: '0x94643e86aa5E38DDAc6c7791C1297f4E40cD96c1' },
      { name: 'AdpendMorphoProvider', kind: 'morpho', market: '0x55555815a5595991C3A0Ff119B59AEF6C8B55555' },
      {
        name: 'GauntletFrontierV2MorphoProvider',
        kind: 'morpho-v2',
        market: '0x9a1D6bd5b8642C41F25e0958129B85f8E1176F3e',
      },
      {
        // srUSD / USDC, LLTV 91.5%.
        name: 'SrUsdMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0xbfed072faee09b963949defcdb91094465c34c6c62d798b906274ef3563c9cac',
      },
      {
        // mHYPER / USDC, LLTV 86%.
        name: 'MHyperMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x95c28d447950ca6c8bbfd25fc05b80b1fd7a1cdd17a3610b4b3f1ffc8dc2e2ed',
      },
      {
        // wsrUSD / USDC, LLTV 94.5%.
        name: 'WsrUsdMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x1590cb22d797e226df92ebc6e0153427e207299916e7e4e53461389ad68272fb',
      },
      {
        // PAXG / USDC, LLTV 91.5%.
        name: 'PaxgMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9',
      },
      {
        // sdeUSD / USDC, LLTV 91.5%.
        name: 'SdeUsdMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x0f9563442d64ab3bd3bcb27058db0b0d4046a4c46f0acd811dacae9551d2b129',
      },
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
      // Venues of the selection rule (client/VENUE_RULE.md) that have no Thesauros adapter yet.
      {
        name: 'SteakhousePrimeV2MorphoProvider',
        kind: 'morpho-v2',
        market: '0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9',
      },
      {
        // cbBTC / USDC, LLTV 86%.
        name: 'CbBtcMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
      },
      // Set B of client/PROGRAMME.md, as on Ethereum.
      {
        name: 'SteakhouseHighYieldV2MorphoProvider',
        kind: 'morpho-v2',
        market: '0xbeeff2490FEffa212faC2f6553682C219E6a8845',
      },
      {
        // USDe / USDC, LLTV 91.5%.
        name: 'UsdeMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354',
      },
      {
        // HERMES / USDC, LLTV 98%.
        name: 'HermesMarketMorphoProvider',
        kind: 'morpho-market',
        market: '0xe1986e80099257c65dd18091ec7e34752ae2336870a5649f20c450c9c4931fb8',
      },
    ],
  },
};
