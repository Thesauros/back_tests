/**
 * The venues the selection rule (client/VENUE_RULE.md) was applied to, and the collateral it lists.
 *
 * On the list: every USDC venue the candidate search read on-chain at or above $100M at one of the
 * twelve rule readings (the 7th, October 2025 to September 2026), every venue the history collects,
 * the venues the rule names on either chain, whatever their size, and the venues that reach $100M
 * only at the window end, 7 October 2026, which is not a rule reading. Not on the list, and named
 * in FOUND_NOT_READ at the end of this file: what the search found at that size only in DefiLlama's
 * protocol totals and did not read on-chain. Sizes and collateral are not kept here:
 * collect-eligibility.ts reads them from the chain at every reading. Kept here is what a reading
 * cannot say: the class of a venue under the rule, the terms tests 1 and 2 are decided on (TERMS,
 * by kind of contract, and a verdict of its own where a venue differs), and for every verdict the
 * evidence and its source. UNVERIFIED marks what the candidate search did not read.
 */

export type RuleClass = 'named governance venue' | 'curated vault' | 'single market' | 'wrapper' | 'other';

export type CandidateKind =
  // As in targets.ts.
  | 'aave'
  | 'compound'
  | 'morpho'
  | 'morpho-v2'
  | 'morpho-market'
  | 'fluid'
  | 'susdc'
  // Another ERC-4626 vault: totalAssets().
  | 'erc4626'
  // Euler vault: ERC-4626, one pool lent against the collateral vaults of LTVList().
  | 'euler'
  // Compound V2 style market.
  | 'moonwell'
  // DolomiteMargin: one cross-margin pool, every market token is collateral.
  | 'dolomite'
  // ERC-4626 wrapper over an Aave aToken.
  | 'stata'
  // A venue sized by one view, priced by a second where it counts tokens (`size`).
  | 'view'
  // Stream xUSD: totalSupply() at the price of the last completed round.
  | 'stream';

/** A test decided by the venue's terms, not by a reading. */
export interface Verdict {
  /** unverified: the candidate search did not read it. */
  result: 'pass' | 'fail' | 'unverified';
  /** The phrase the table prints for a failure; no commas. */
  reason: string;
  evidence: string;
  source: string;
}

export interface Candidate {
  /** Public name. */
  name: string;
  /** The name in the history (configs, raw.jsonl), for a venue collected there. */
  provider?: string;
  kind: CandidateKind;
  /** The venue's contract; for a single Morpho Blue market, its 32-byte id. */
  address: string;
  ruleClass: RuleClass;
  /** Test 1, asset: USDC in and out, one transaction each, at the venue's own contract. */
  test1?: Verdict;
  /** Test 2, withdrawal on demand. */
  test2?: Verdict;
  /** Test 4, for a venue whose collateral the chain does not list. */
  test4?: Verdict;
  /**
   * Kind `view`: the view, the decimals of what it returns, and where it counts tokens, the view
   * that prices one of them in USD with 18 decimals.
   */
  size?: { fn: string; decimals: number; price?: { target: string; fn: string }; label: string };
  /** Kind `stata`: the Aave pool whose aToken it wraps. */
  through?: string;
  /** What the size is when it is not USDC that can be withdrawn; printed next to the size. */
  sizeNote?: string;
  /** At or above $100M only at the window end: the figure of 7 October 2026 and where it was read. */
  windowEndOnly?: string;
}

/** The address a deposit is tried from: one no venue has onboarded. */
const STRANGER = '0x000000000000000000000000000000000000dEaD';

export const NOT_READ = (what: string): Verdict => ({
  result: 'unverified',
  reason: '',
  evidence: `UNVERIFIED: ${what}`,
  source: '',
});

const PASS = (evidence: string, source: string): Verdict => ({ result: 'pass', reason: '', evidence, source });

/**
 * Tests 1 and 2 for the kinds of contract whose terms are those of the contract type: what a
 * deposit and a withdrawal are, and what limits a withdrawal. Test 2 passes where there is no
 * queue of requests, cooldown, epoch or notice period; every venue here pays only up to the USDC
 * that is not lent out at the moment, and the limit is stated. A kind that is not here has no
 * terms of its type: a venue of it carries its own verdicts, and a test with neither was not
 * read and prints `unverified`.
 */
export const TERMS: Partial<Record<CandidateKind, { test1: Verdict; test2: Verdict }>> = {
  aave: {
    test1: PASS(
      'Pool.supply and Pool.withdraw of USDC at the pool, one transaction each. Thesauros runs an adapter of ' +
        'this type (AaveV3Provider); SparkLend is read through the same Pool interface.',
      'Aave V3 Pool'
    ),
    test2: PASS(
      'No queue, cooldown or epoch in Pool.withdraw: it pays up to the USDC the aToken holds and reverts above ' +
        'it. On Ethereum that was 159.0M of 1926.5M on 2026-05-07, and the pool was reported fully borrowed for ' +
        'days after 18 April 2026.',
      'on-chain USDC.balanceOf(aToken) at the readings; incident reports found by the candidate search'
    ),
  },
  compound: {
    test1: PASS(
      'Comet.supply and Comet.withdraw of USDC at the market, one transaction each. Thesauros runs an adapter ' +
        'of this type (CompoundV3Provider).',
      'Compound V3 Comet'
    ),
    test2: PASS(
      'No queue, cooldown or epoch in Comet.withdraw: it pays up to the USDC the market holds. On Ethereum ' +
        'isWithdrawPaused() was false at every reading, and withdrawals were paused from 4 to 6 November 2025, ' +
        'between two readings.',
      'on-chain; incident reports found by the candidate search'
    ),
  },
  fluid: {
    test1: PASS(
      'ERC-4626 deposit and withdraw of USDC at the fToken, one transaction each.',
      'on-chain: LendingFactory.computeToken(USDC, "fToken") returns the address; Fluid deployments.md'
    ),
    test2: PASS(
      'No queue of requests and no epoch, but a rate limit: the Liquidity layer lets the fToken withdraw at ' +
        'most 50% of its supply at once, the limit re-expanding over 6 hours (expandPercent 5000, expandDuration ' +
        '21600), and only up to the idle USDC of the layer: 24.5M of 101.6M on Ethereum on 2026-06-07. A ' +
        'withdrawal of 10M by a holder succeeded in simulation on 2026-10-09.',
      'on-chain: LiquidityResolver 0xca13A15de31235A37134B4717021C35A3CF25C60 getUserSupplyData(fUSDC, USDC)'
    ),
  },
  susdc: {
    test1: PASS(
      'ERC-4626 deposit and withdraw of USDC at the vault, one transaction each: the vault swaps through a PSM ' +
        'in the same call and holds sUSDS (Ethereum: the Sky LitePSM, tin and tout 0; Base: the Spark PSM3).',
      'on-chain; UsdcVault and UsdcVaultL2 verified source; SUSDC in spark-address-registry'
    ),
    test2: PASS(
      'No queue in the vault. A withdrawal is limited by the USDC the PSM holds: 2133M to 4927M at the readings ' +
        'on Ethereum, 15.0M until 2026-06-07 and 1.0M after on Base. A withdrawal of 10M by a holder succeeded in ' +
        'simulation on Ethereum on 2026-10-09.',
      'on-chain'
    ),
  },
  morpho: {
    test1: PASS(
      'ERC-4626 deposit and withdraw of USDC at the vault, one transaction each. The Thesauros MorphoProvider ' +
        'adapter makes these two calls.',
      'MetaMorpho; Thesauros MorphoProvider.sol'
    ),
    test2: PASS(
      "No queue of requests, cooldown or epoch: withdraw pays from the markets of the vault's withdraw queue, " +
        'which is an order of markets, up to their unborrowed USDC.',
      'MetaMorpho'
    ),
  },
  'morpho-v2': {
    test1: PASS(
      'deposit and withdraw of USDC at the vault, one transaction each. The four gates that can refuse an ' +
        'address are read at every reading and fail this test when one is set. maxDeposit and maxWithdraw ' +
        'return 0 by design and say nothing.',
      'morpho-org/vault-v2 src/VaultV2.sol 720-783, the code on chain'
    ),
    test2: PASS(
      'No queue, cooldown or epoch: withdraw pays the idle USDC plus what the liquidity adapter pulls, in the ' +
        'same transaction, from the one market or vault it names. forceDeallocate reaches the others for a ' +
        'penalty of at most 2%.',
      'morpho-org/vault-v2 src/VaultV2.sol 749-798'
    ),
  },
  'morpho-market': {
    test1: PASS(
      'Morpho.supply and Morpho.withdraw of USDC at the Morpho Blue singleton, one transaction each. The loan ' +
        'token of the market is read at every reading and fails this test when it is not USDC.',
      'Morpho Blue'
    ),
    test2: PASS('No queue: a withdrawal is limited by the unborrowed USDC of the market.', 'Morpho Blue'),
  },
  moonwell: {
    test1: PASS('mToken.mint and mToken.redeem of USDC at the market, one transaction each.', 'on-chain'),
    test2: PASS(
      'No queue: redeem pays up to getCash(). getCash() was 0 on 2026-09-07 and on 2026-10-07: lenders could ' +
        'not withdraw then.',
      'on-chain'
    ),
  },
  euler: {
    test1: PASS(
      'ERC-4626 deposit and withdraw of USDC at the vault, one transaction each; a plain approval is enough. ' +
        'hookConfig() is read at every reading and fails this test when a deposit or a withdrawal is hooked.',
      'on-chain; Euler Vault Kit'
    ),
    test2: PASS(
      'No queue: a withdrawal is limited by cash(). On 2026-10-09 eUSDC-70 was cash-bound: a holder could ' +
        'withdraw 0.76M of 0.98M.',
      'on-chain'
    ),
  },
};

/** Rule application, point 2. */
const MIDAS_TOKEN: Verdict = {
  result: 'fail',
  reason: 'tokenised fund issued and redeemed by Midas',
  evidence:
    'A certificate of a managed strategy: the size is token supply at the issuer NAV feed, not USDC held. ' +
    'UNVERIFIED: the Midas deposit vault address and its onboarding terms were not read.',
  source: 'token and feed addresses from the DefiLlama midas-rwa adapter, read on-chain; Midas terms not read',
};

/** 1337 USDC and Adpend USDC: interest accruing on a fully borrowed sdeUSD market. */
const TAKEN_AS_READ = 'taken as read: VENUE_RULE.md rule application point 5';
/**
 * The same in single markets: supply minus borrow is 0 at every reading of the PAXG and sdeUSD
 * markets above $100M and 51.64 USDC at the one such reading of the HERMES market.
 */
const ACCRUED_INTEREST =
  'at its readings above $100M the market holds under $100 of idle USDC: the total is accrued interest';

export const CANDIDATES: Record<string, Candidate[]> = {
  Ethereum: [
    // The governance-run venues the rule names: test 4 is waived.
    {
      name: 'Aave V3',
      provider: 'AaveV3Provider',
      kind: 'aave',
      address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      ruleClass: 'named governance venue',
    },
    {
      name: 'Compound V3',
      provider: 'CompoundV3Provider',
      kind: 'compound',
      address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
      ruleClass: 'named governance venue',
    },
    {
      name: 'SparkLend',
      provider: 'SparkProvider',
      kind: 'aave',
      address: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987',
      ruleClass: 'named governance venue',
    },
    {
      name: 'Fluid fUSDC',
      provider: 'FluidProvider',
      kind: 'fluid',
      address: '0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33',
      ruleClass: 'named governance venue',
    },
    {
      name: 'Spark USDC Vault (sUSDC)',
      provider: 'SparkSavingsProvider',
      kind: 'susdc',
      address: '0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE',
      ruleClass: 'named governance venue',
    },
    {
      // Rule application, point 4.
      name: 'Spark Savings USDC v2 (spUSDC)',
      kind: 'erc4626',
      address: '0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d',
      ruleClass: 'named governance venue',
      test1: PASS(
        'ERC-4626 deposit and withdraw of USDC at the vault, one transaction each.',
        'on-chain; SparkVault verified source; SPARK_VAULT_V2_SPUSDC in spark-address-registry'
      ),
      test2: {
        result: 'fail',
        reason: 'only a buffer is payable on demand: 10% of assets in 2025 and a fixed $10M from January 2026',
        evidence:
          'USDC.balanceOf(vault) against totalAssets() at the readings: 7.4M of 72.7M on 2025-11-07, 24.0M of ' +
          '240.4M on 2025-12-07, then 10.0M at every reading from 2026-01-07 against 157M to 920M. On 2026-10-09 ' +
          'maxWithdraw(holder) returned exactly 10000000000000 for two holders with 11.24M and 10.17M of assets, ' +
          'and assetsOutstanding() was 303.5M of 313.5M: the rest is with the Spark Liquidity Layer and waits ' +
          'for it.',
        source: 'on-chain, at the readings and on 2026-10-09',
      },
    },

    // Morpho vaults, first generation (MetaMorpho).
    {
      name: 'Steakhouse USDC',
      provider: 'SteakhouseMorphoProvider',
      kind: 'morpho',
      address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
      ruleClass: 'curated vault',
    },
    {
      // At three readings it is at or above $100M only with the deposit of Gauntlet USDC Prime V2, which is
      // left out as a wrapper then: 126.2M with 66.5M of it on 2026-03-07, 133.8M with 57.1M on 2026-04-07,
      // 155.7M with 104.8M on 2026-05-07.
      name: 'Gauntlet USDC Prime',
      provider: 'GauntletPrimeMorphoProvider',
      kind: 'morpho',
      address: '0xdd0f28e19C1780eb6396170735D45153D261490d',
      ruleClass: 'curated vault',
    },
    {
      name: 'Smokehouse USDC',
      provider: 'SmokehouseMorphoProvider',
      kind: 'morpho',
      address: '0xBEeFFF209270748ddd194831b3fa287a5386f5bC',
      ruleClass: 'curated vault',
    },
    {
      name: 'Gauntlet USDC Core',
      provider: 'GauntletCoreMorphoProvider',
      kind: 'morpho',
      address: '0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458',
      ruleClass: 'curated vault',
    },
    {
      name: 'Gauntlet USDC RWA',
      provider: 'GauntletRwaMorphoProvider',
      kind: 'morpho',
      address: '0xA8875aaeBc4f830524e35d57F9772FfAcbdD6C45',
      ruleClass: 'curated vault',
    },
    {
      name: 'Yearn USDC (oevUSDC)',
      provider: 'OevBoostedMorphoProvider',
      kind: 'morpho',
      address: '0x68Aea7b82Df6CcdF76235D46445Ed83f85F845A3',
      ruleClass: 'curated vault',
    },
    {
      name: 'Hakutora USDC',
      provider: 'HakutoraMorphoProvider',
      kind: 'morpho',
      address: '0x974c8FBf4fd795F66B85B73ebC988A51F1A040a9',
      ruleClass: 'curated vault',
    },
    {
      name: 'Vault Bridge USDC',
      provider: 'VaultBridgeMorphoProvider',
      kind: 'morpho',
      address: '0xBEefb9f61CC44895d8AEc381373555a64191A9c4',
      ruleClass: 'curated vault',
    },
    {
      name: 'Usual Boosted USDC',
      provider: 'UsualBoostedMorphoProvider',
      kind: 'morpho',
      address: '0xd63070114470f685b75B74D60EEc7c1113d33a3D',
      ruleClass: 'curated vault',
    },
    {
      name: 'Gauntlet USDC Frontier',
      provider: 'GauntletFrontierMorphoProvider',
      kind: 'morpho',
      address: '0xc582F04d8a82795aa2Ff9c8bb4c1c889fe7b754e',
      ruleClass: 'curated vault',
    },
    {
      // "Steakhouse Reservoir USDC" until it was renamed.
      name: 'Waterline Reservoir USDC',
      provider: 'WaterlineReservoirMorphoProvider',
      kind: 'morpho',
      address: '0xbeEF346d7099865208Ff331e4f648f4154DDAa05',
      ruleClass: 'curated vault',
    },
    {
      name: 'Hyperithm USDC Apex',
      provider: 'HyperithmApexMorphoProvider',
      kind: 'morpho',
      address: '0x777791C4d6DC2CE140D00D2828a7C93503c67777',
      ruleClass: 'curated vault',
    },
    {
      name: '1337 USDC',
      provider: 'Vault1337MorphoProvider',
      kind: 'morpho',
      address: '0x94643e86aa5E38DDAc6c7791C1297f4E40cD96c1',
      ruleClass: 'curated vault',
      sizeNote: TAKEN_AS_READ,
    },
    {
      name: 'Adpend USDC',
      provider: 'AdpendMorphoProvider',
      kind: 'morpho',
      address: '0x55555815a5595991C3A0Ff119B59AEF6C8B55555',
      ruleClass: 'curated vault',
      sizeNote: TAKEN_AS_READ,
    },

    // Morpho vaults, second generation.
    {
      // Its June verdict depends on where the reading falls: totalAssets() was 102.188M at block 25261800, the
      // first of 2026-06-07 (00:00:11 UTC), and 99.823M at the reading, block 25262163 (01:13:47 UTC). The rule
      // takes the reading. No venue of the set is on the other side of $100M between those two blocks.
      name: 'Gauntlet USDC Prime V2',
      provider: 'GauntletPrimeV2MorphoProvider',
      kind: 'morpho-v2',
      address: '0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0',
      ruleClass: 'curated vault',
    },
    {
      name: 'Steakhouse Prime USDC V2',
      provider: 'SteakhousePrimeV2MorphoProvider',
      kind: 'morpho-v2',
      address: '0xbeef088055857739C12CD3765F20b7679Def0f51',
      ruleClass: 'curated vault',
    },
    {
      name: 'Gauntlet USDC Frontier V2',
      provider: 'GauntletFrontierV2MorphoProvider',
      kind: 'morpho-v2',
      address: '0x9a1D6bd5b8642C41F25e0958129B85f8E1176F3e',
      ruleClass: 'curated vault',
    },

    // Euler vaults (K3 Capital RLUSD and PYUSD markets, earlier Sentora).
    {
      name: 'Euler eUSDC-70',
      kind: 'euler',
      address: '0x9bD52F2805c6aF014132874124686e7b248c2Cbb',
      ruleClass: 'curated vault',
    },
    {
      name: 'Euler eUSDC-80',
      kind: 'euler',
      address: '0xAB2726DAf820Aa9270D14Db9B18c8d187cbF2f30',
      ruleClass: 'curated vault',
    },

    // Single Morpho Blue markets.
    {
      name: 'Morpho market cbBTC/USDC 86%',
      provider: 'CbBtcMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64',
      ruleClass: 'single market',
    },
    {
      name: 'Morpho market WBTC/USDC 86%',
      provider: 'WbtcMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49',
      ruleClass: 'single market',
    },
    {
      name: 'Morpho market srUSD/USDC 91.5%',
      provider: 'SrUsdMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0xbfed072faee09b963949defcdb91094465c34c6c62d798b906274ef3563c9cac',
      ruleClass: 'single market',
    },
    {
      name: 'Morpho market mHYPER/USDC 86%',
      provider: 'MHyperMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x95c28d447950ca6c8bbfd25fc05b80b1fd7a1cdd17a3610b4b3f1ffc8dc2e2ed',
      ruleClass: 'single market',
    },
    {
      name: 'Morpho market wsrUSD/USDC 94.5%',
      provider: 'WsrUsdMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x1590cb22d797e226df92ebc6e0153427e207299916e7e4e53461389ad68272fb',
      ruleClass: 'single market',
    },
    {
      name: 'Morpho market PAXG/USDC 91.5%',
      provider: 'PaxgMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9',
      ruleClass: 'single market',
      sizeNote: ACCRUED_INTEREST,
    },
    {
      name: 'Morpho market sdeUSD/USDC 91.5%',
      provider: 'SdeUsdMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x0f9563442d64ab3bd3bcb27058db0b0d4046a4c46f0acd811dacae9551d2b129',
      ruleClass: 'single market',
      sizeNote: ACCRUED_INTEREST,
    },
    {
      name: 'Morpho market PT-reUSD-10DEC2026/USDC 91.5%',
      kind: 'morpho-market',
      address: '0x1e9d614631a7df0ec07fb05b2c8cb2491575fd1a63a33bf187a6afb295a4fc64',
      ruleClass: 'single market',
      windowEndOnly: '112.4M of totalSupplyAssets on-chain at block 26136783',
    },
    {
      name: 'Morpho market wstUSR/USDC 91.5%',
      kind: 'morpho-market',
      address: '0xd9e34b1eed46d123ac1b69b224de1881dbc88798bc7b70f504920f62f58f28cc',
      ruleClass: 'single market',
      sizeNote: ACCRUED_INTEREST,
      windowEndOnly: '205.0M of totalSupplyAssets on-chain at block 26136783',
    },

    // Rule application, point 3.
    {
      name: 'Wrapped Aave Ethereum USDC (waEthUSDC)',
      kind: 'stata',
      address: '0xD4fa2D31b7968E448877f69A96DE69f5de8cD23E',
      ruleClass: 'wrapper',
      through: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    },

    // Neither a curated vault nor a venue the rule names.
    {
      // Rule application, point 1, decides the venue on its collateral.
      name: 'Dolomite USDC',
      kind: 'dolomite',
      address: '0x003Ca23Fd5F0ca87D01F6eC6CD14A8AE60c2b97D',
      ruleClass: 'other',
      test1: NOT_READ(
        'a deposit: balances are internal to DolomiteMargin and users go through the DepositWithdrawalRouter ' +
          '0xf8b2c637A68cF6A17b1DF9F8992EeBeFf63d2dFf, whose deposit path was not read'
      ),
      test2: PASS(
        'ActionType.Withdraw runs inside DolomiteMargin.operate() with no queue, cooldown, delay or epoch in the ' +
          'verified source, up to the idle USDC of the pool. 100,000 USDC left in one transaction through the ' +
          'router on 2026-10-09 (0x2cca187a1bc919bc492ff01701a1f168b052cf49e764b99ae0d42d8e51a55b77). A larger ' +
          'withdrawal was not simulated.',
        'on-chain; DolomiteMargin verified source'
      ),
    },
    {
      // Rule application, point 2.
      name: 'Maple Syrup USDC (syrupUSDC)',
      kind: 'erc4626',
      address: '0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b',
      ruleClass: 'other',
      test1: {
        result: 'fail',
        reason: 'deposits are permissioned',
        evidence: `maxDeposit(${STRANGER}) = 0 at every reading.`,
        source: 'on-chain',
      },
      test2: {
        result: 'fail',
        reason: 'withdrawals go through a queue',
        evidence:
          'maxWithdraw(address) = 0: a redemption is requested and served from a queue. LlamaRisk data of ' +
          '2026-06-17: median 3.42 minutes, 92% within the hour, longest about 125 hours.',
        source: 'on-chain; LlamaRisk as quoted on the Aave governance forum',
      },
    },
    {
      // Rule application, point 2.
      name: 'Maple High Yield Secured Lending USDC',
      kind: 'erc4626',
      address: '0xc39a5a616f0ad1ff45077fa2de3f79ab8eb8b8b9',
      ruleClass: 'other',
      test1: {
        result: 'fail',
        reason: 'deposits are permissioned',
        evidence: `maxDeposit(${STRANGER}) = 0 at every reading; the Maple API gives openToPublic: false.`,
        source: 'on-chain; Maple GraphQL API (poolV2S)',
      },
      test2: NOT_READ('the withdrawal manager of this pool'),
    },
    {
      name: 'Pareto FalconX USDC credit vault',
      kind: 'view',
      address: '0x433D5B175148dA32Ffe1e1A37a939E1b7e79be4d',
      ruleClass: 'other',
      size: { fn: 'getContractValue', decimals: 6, label: 'getContractValue()' },
      test1: {
        result: 'fail',
        reason: 'deposits are allow-listed',
        evidence: `isWalletAllowed(${STRANGER}) is false at every reading.`,
        source: 'on-chain',
      },
      test2: {
        result: 'fail',
        reason: 'monthly redemption epochs',
        evidence:
          'A credit line to one borrower with monthly redemptions; a deposit shows only after the current ' +
          'epoch ends. On-chain at every reading: isEpochRunning() is true and epochDuration() is between ' +
          '2338848 and 2820960 seconds, 27 to 33 days.',
        source: 'on-chain; app.rwa.xyz/assets/AA_FalconXUSDC and the Gauntlet vault page',
      },
    },
    {
      name: 'Midas mHYPER',
      kind: 'view',
      address: '0x9b5528528656DBC094765E2abB79F293c21191B9',
      ruleClass: 'other',
      size: {
        fn: 'totalSupply',
        decimals: 18,
        price: { target: '0x92004DCC5359eD67f287F32d12715A37916deCdE', fn: 'getDataInBase18' },
        label: 'totalSupply() x getDataInBase18(): token value at the issuer NAV not USDC held',
      },
      test1: MIDAS_TOKEN,
      test2: NOT_READ('the terms of the Midas redemption vaults'),
    },
    {
      name: 'Midas mFONE',
      kind: 'view',
      address: '0x238a700eD6165261Cf8b2e544ba797BC11e466Ba',
      ruleClass: 'other',
      size: {
        fn: 'totalSupply',
        decimals: 18,
        price: { target: '0xCF4e49f5e750Af8F2f9Aa1642B68E5839D9c1C00', fn: 'getDataInBase18' },
        label: 'totalSupply() x getDataInBase18(): token value at the issuer NAV not USDC held',
      },
      test1: MIDAS_TOKEN,
      test2: NOT_READ('the terms of the Midas redemption vaults'),
    },
    {
      // name() on-chain: "Plasma syrupUSD Pre-deposit Midas Vault".
      name: 'Midas msyrupUSDp',
      kind: 'view',
      address: '0x2fE058CcF29f123f9dd2aEC0418AA66a877d8E50',
      ruleClass: 'other',
      size: { fn: 'totalSupply', decimals: 18, label: 'totalSupply() at $1: nominal and the NAV was not read' },
      test1: {
        result: 'fail',
        reason: 'pre-deposit certificate issued by Midas',
        evidence:
          'A pre-deposit certificate, not a venue that lends USDC. UNVERIFIED: the deposit asset (the Pendle ' +
          'market of the token carries "(USDT)", so it may never have taken USDC) and the NAV.',
        source: 'on-chain name() and totalSupply(); DefiLlama yields pool 7ee289d7-72aa-4295-99a7-c4551e3f15d1',
      },
      test2: NOT_READ('the redemption terms'),
    },
    {
      name: 'Re reUSD',
      kind: 'view',
      address: '0x5086bf358635B81D8C47C66d1C8b9E567Db70c72',
      ruleClass: 'other',
      size: {
        fn: 'totalSupply',
        decimals: 18,
        price: { target: '0xd1D104a7515989ac82F1AFDa15a23650411b05B8', fn: 'getSharePrice' },
        label: 'totalSupply() x getSharePrice(): token value at NAV not USDC held',
      },
      test1: {
        result: 'fail',
        reason: 'mint and redemption are KYC-gated',
        evidence:
          'Mint and redeem are KYC-gated. On Ethereum the instant redemption asset is sUSDe; redemption in ' +
          'USDC exists only on Avalanche.',
        source: 'docs.re.xyz/protocol/redemptions, read through a search result',
      },
      test2: {
        result: 'fail',
        reason: 'redemption beyond a buffer goes through a queue',
        evidence: 'Instant from a buffer with a 16 bps fee, otherwise a first-in-first-out queue.',
        source: 'docs.re.xyz/protocol/redemptions, read through a search result',
      },
    },
    {
      name: 'Cap cUSD',
      kind: 'view',
      address: '0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC',
      ruleClass: 'other',
      size: { fn: 'totalSupply', decimals: 18, label: 'totalSupply() at $1: stablecoin supply not USDC held' },
      test1: {
        result: 'fail',
        reason: 'the yield needs a second transaction',
        evidence:
          'USDC mints cUSD, which pays nothing; the yield is paid after staking cUSD into stcUSD ' +
          '0x88887bE419578051FF9F4eb6C858A951921D8888.',
        source: 'LlamaRisk review, governance.aave.com/t/arfc-onboard-stcusd-to-aave-v3-megaeth/25018/8',
      },
      test2: NOT_READ('the limits on burning cUSD for a reserve asset'),
    },
    {
      name: 'Almanak alUSD',
      kind: 'erc4626',
      address: '0xDCD0f5ab30856F28385F641580Bbd85f88349124',
      ruleClass: 'other',
      test1: NOT_READ(`whether a deposit settles in one transaction; maxDeposit(${STRANGER}) is 0 at every reading`),
      test2: {
        result: 'fail',
        reason: 'withdrawals are asynchronous requests',
        evidence:
          'ERC-7540 request and claim. On-chain at every reading: supportsInterface(0x620ee8e4), the ' +
          'asynchronous redeem interface, is true; previewRedeem and previewWithdraw revert, as that standard ' +
          `requires; maxWithdraw(${STRANGER}) is 0. How long a request takes was not read.`,
        source: 'on-chain; Almanak docs, read through a search result',
      },
    },
    {
      name: 'Stream xUSD',
      kind: 'stream',
      address: '0xE2Fc85BfB48C4cF147921fBE110cf92Ef9f26F94',
      ruleClass: 'other',
      sizeNote: 'from 2025-11-07 the price is the last one set before the collapse: not a redeemable value',
      test1: NOT_READ('the deposit flow'),
      test2: {
        result: 'fail',
        reason: 'withdrawals are processed in rounds (suspended since November 2025)',
        evidence:
          'Deposits and withdrawals were suspended on 3 to 4 November 2025 after a disclosed loss of about ' +
          '$93M. round() was 262 on 2025-10-07 and has stayed at 289 from the 2025-11-07 reading on.',
        source: 'on-chain round(); finance.yahoo.com/news/stream-finance-freezes-withdrawals-93m-152500237.html',
      },
    },
    {
      name: '3Jane USD3',
      kind: 'erc4626',
      address: '0x056B269Eb1f75477a8666ae8C7fE01b64dD55eCc',
      ruleClass: 'other',
      windowEndOnly: '100.8M of totalAssets() on-chain at block 26136783',
      test1: NOT_READ(
        `why maxDeposit(${STRANGER}) was 0 or under $150 at seven rule readings, to 2026-01-07 and from 2026-07-07: ` +
          'a cap or an allow-list'
      ),
      test2: NOT_READ('the lock on USD3, which third-party summaries of the 3Jane docs say is none'),
    },
    {
      name: 'Avalon SuperEarn',
      kind: 'view',
      address: '0xf297230fA5614545B427616148a74C888620d659',
      ruleClass: 'other',
      size: { fn: 'mintedAvalonVault', decimals: 18, label: 'mintedAvalonVault() at $1: the unit was not verified' },
      windowEndOnly: '111.5M tokens of mintedAvalonVault() on-chain at block 26136783',
      test1: NOT_READ('the deposit terms'),
      test2: NOT_READ('the withdrawal terms'),
    },
  ],

  Base: [
    // The governance-run venues the rule names: test 4 is waived.
    {
      name: 'Aave V3',
      provider: 'AaveV3Provider',
      kind: 'aave',
      address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      ruleClass: 'named governance venue',
    },
    {
      name: 'Compound V3',
      provider: 'CompoundV3Provider',
      kind: 'compound',
      address: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
      ruleClass: 'named governance venue',
    },
    {
      name: 'Moonwell USDC',
      kind: 'moonwell',
      address: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
      ruleClass: 'named governance venue',
    },
    {
      name: 'Fluid fUSDC',
      kind: 'fluid',
      address: '0xf42f5795D9ac7e9D757dB633D693cD548Cfd9169',
      ruleClass: 'named governance venue',
    },
    {
      // Not the Morpho vault of the same name below: this one holds sUSDS through the Spark PSM3.
      name: 'Spark USDC Vault (sUSDC)',
      kind: 'susdc',
      address: '0x3128a0F7f0ea68E7B7c9B00AFa7E41045828e858',
      ruleClass: 'named governance venue',
    },

    // Morpho vaults, first generation (MetaMorpho).
    {
      name: 'Steakhouse USDC',
      provider: 'SteakhouseMorphoProvider',
      kind: 'morpho',
      address: '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183',
      ruleClass: 'curated vault',
    },
    {
      name: 'Gauntlet USDC Prime',
      provider: 'GauntletPrimeMorphoProvider',
      kind: 'morpho',
      address: '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61',
      ruleClass: 'curated vault',
    },
    {
      name: 'Steakhouse Prime USDC',
      provider: 'SteakhousePrimeMorphoProvider',
      kind: 'morpho',
      address: '0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2',
      ruleClass: 'curated vault',
    },
    {
      name: 'Spark USDC Vault',
      provider: 'SparkMorphoProvider',
      kind: 'morpho',
      address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A',
      ruleClass: 'curated vault',
    },
    {
      name: 'Steakhouse High Yield USDC v1.1',
      provider: 'SteakhouseHighYieldMorphoProvider',
      kind: 'morpho',
      address: '0xBEEFA7B88064FeEF0cEe02AAeBBd95D30df3878F',
      ruleClass: 'curated vault',
    },
    {
      name: 'Gauntlet USDC Core',
      provider: 'GauntletCoreMorphoProvider',
      kind: 'morpho',
      address: '0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12',
      ruleClass: 'curated vault',
    },
    {
      name: 'Re7 USDC',
      provider: 'Re7MorphoProvider',
      kind: 'morpho',
      address: '0x12AFDeFb2237a5963e7BAb3e2D46ad0eee70406e',
      ruleClass: 'curated vault',
    },
    {
      name: 'Grove x Steakhouse USDC High Yield',
      kind: 'morpho',
      address: '0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A',
      ruleClass: 'curated vault',
      windowEndOnly: '103.4M of totalAssets() on-chain at block 52270927',
    },

    // Morpho vaults, second generation.
    {
      name: 'Steakhouse Prime USDC V2',
      provider: 'SteakhousePrimeV2MorphoProvider',
      kind: 'morpho-v2',
      address: '0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9',
      ruleClass: 'curated vault',
    },
    {
      name: 'Steakhouse High Yield USDC Edition V2',
      provider: 'SteakhouseHighYieldV2MorphoProvider',
      kind: 'morpho-v2',
      address: '0xbeeff2490FEffa212faC2f6553682C219E6a8845',
      ruleClass: 'curated vault',
    },
    {
      name: 'Gauntlet USDC Prime V2',
      kind: 'morpho-v2',
      address: '0x050cE30b927Da55177A4914EC73480238BAD56f0',
      ruleClass: 'curated vault',
      windowEndOnly: '176.8M of totalAssets() on-chain at block 52270927',
    },
    {
      name: 'Grove x Steakhouse USDC V2',
      kind: 'morpho-v2',
      address: '0xbeef0786756810478b88982DE00F3CD7fdB8e7c7',
      ruleClass: 'curated vault',
      windowEndOnly: '156.1M of totalAssets() on-chain at block 52270927',
    },

    // Single Morpho Blue markets.
    {
      name: 'Morpho market cbBTC/USDC 86%',
      provider: 'CbBtcMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
      ruleClass: 'single market',
    },
    {
      name: 'Morpho market USDe/USDC 91.5%',
      provider: 'UsdeMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354',
      ruleClass: 'single market',
    },
    {
      name: 'Morpho market HERMES/USDC 98%',
      provider: 'HermesMarketMorphoProvider',
      kind: 'morpho-market',
      address: '0xe1986e80099257c65dd18091ec7e34752ae2336870a5649f20c450c9c4931fb8',
      ruleClass: 'single market',
      sizeNote: ACCRUED_INTEREST,
    },
    {
      name: 'Morpho market WETH/USDC 86%',
      kind: 'morpho-market',
      address: '0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda',
      ruleClass: 'single market',
      windowEndOnly: '104.7M of totalSupplyAssets on-chain at block 52270927',
    },

    // Neither a curated vault nor a venue the rule names. Rule application, point 1.
    {
      name: 'Avantis USDC Vault (avUSDC)',
      kind: 'erc4626',
      address: '0x944766f715b51967E56aFdE5f0Aa76cEaCc9E7f9',
      ruleClass: 'other',
      test2: NOT_READ(
        'the withdrawal mechanism. On 2026-10-09 maxWithdraw returned the full holding of the two largest holders ' +
          'and a withdrawal of 99% of it reverted with "ERC20: burn amount exceeds balance"'
      ),
      test4: {
        result: 'fail',
        reason: 'not lent against collateral: the vault is the counterparty of perpetuals traders',
        evidence:
          'Liquidity of the Avantis perpetuals exchange: depositors are the counterparty of its traders and earn ' +
          'trading fees and trader losses. totalAssets() equals USDC.balanceOf(vault) at every reading: the USDC ' +
          'is not lent, it stands behind the traders, which is collateral outside the list.',
        source: 'on-chain; what the vault does is from its DefiLlama listing (as Veranta), official docs not read',
      },
    },
  ],
};

/**
 * Found by the candidate search at or above $100M only as a DefiLlama protocol figure (the USDC in
 * its TVL plus borrowed, $M at the twelve rule readings and then at the window end), and NOT read
 * on-chain: UNVERIFIED, the sizes and the terms alike. None is in the table. `why` is what the
 * search noted about each, from the DefiLlama adapter where one is named and otherwise unsourced.
 * Outside the search altogether: issuers and tokenised funds that hold under $60M of USDC by the
 * same figures whatever their total (falcon-finance, ethena-usdtb, invesco-ustb, resolv-usr,
 * bitwise-uscc, saturn, theo-network, bitfi-basis, frax-usd, anzen-v2, m0).
 */
export const FOUND_NOT_READ: { name: string; network: string; defillama: string; readings: number[]; why: string }[] = [
  {
    name: 'infiniFi iUSD',
    network: 'Ethereum',
    defillama: 'infinifi',
    readings: [140.9, 162.6, 161.9, 190.5, 162.9, 164.8, 113.8, 82.1, 77.8, 65.7, 52, 46.2, 45],
    why: 'iUSD is minted with USDC and the yield needs a second step, staking into siUSD or locking: test 1, as Cap cUSD',
  },
  {
    name: 'Reservoir rUSD',
    network: 'Ethereum',
    defillama: 'reservoir-protocol',
    readings: [185.5, 50.6, 0.1, 3.5, 3.9, 10.8, 16.9, 5.7, 7.6, 2.4, 4, 2.6, 1.4],
    why:
      'rUSD is minted with USDC through a PSM and the yield is in srUSD, a second step: test 1. The adapter ' +
      'sums what the Reservoir reserve wallets hold, shares of Morpho, Euler and Fluid USDC venues among it: ' +
      'money already counted in those venues',
  },
  {
    name: 'Anemoy tokenised fund',
    network: 'Ethereum',
    defillama: 'anemoy-capital',
    readings: [345.8, 295.7, 296.1, 263.6, 566.8, 568.2, 1241.2, 1134.8, 865.2, 870.7, 871.2, 799.6, 326.3],
    why:
      'a Janus Henderson fund token on Centrifuge with KYC and asynchronous subscriptions: rule application ' +
      'point 2. The adapter books totalSupply() of the token 0x8c213ee79581Ff4984583C6a801e5263418C4b86 at its ' +
      'price per share as USDC (misrepresentedTokens): it is not USDC held',
  },
  {
    name: 'Wildcat',
    network: 'Ethereum',
    defillama: 'wildcat-protocol',
    readings: [102.5, 81.7, 65.7, 97.3, 89.6, 113.8, 132.7, 139.8, 112.6, 104.1, 106.1, 108.4, 102.7],
    why:
      'a protocol total over uncollateralised credit markets, one per borrower, with withdrawals in cycles; ' +
      'the largest single USDC market in DefiLlama yields is 20.9M',
  },
  {
    name: 'Upshift',
    network: 'Ethereum',
    defillama: 'upshift',
    readings: [65.7, 67.3, 61.9, 67.3, 65.8, 66.6, 122, 72.5, 80, 89.3, 79.7, 111.8, 180],
    why:
      'a protocol total over vaults; the largest single USDC vault, Azure Tide USDC ' +
      '0x69FC3f84FD837217377d9Dae0212068cEB65818e, read on-chain with totalAssets(), is 36.3M at most',
  },
  {
    name: 'Huma',
    network: 'Ethereum',
    defillama: 'huma',
    readings: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 75, 110],
    why: 'at or above $100M at the window end only; new in September 2026; credit to payment firms; terms not read',
  },
];

export interface ListedToken {
  symbol: string;
  decimals: number;
  address: string;
  source: string;
}

const AAVE_BOOK = 'github.com/bgd-labs/aave-address-book';

/**
 * Test 4: the collateral the rule lists, by token address on each chain. A symbol proves nothing,
 * anyone can deploy a token called WBTC; collect-eligibility.ts matches addresses and checks
 * symbol() and decimals() of each against this table before it reads anything else.
 */
export const LISTED_COLLATERAL: Record<string, ListedToken[]> = {
  Ethereum: [
    {
      symbol: 'WBTC',
      decimals: 8,
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      source: `${AAVE_BOOK} src/AaveV3Ethereum.sol WBTC_UNDERLYING`,
    },
    {
      symbol: 'cbBTC',
      decimals: 8,
      address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      source: `${AAVE_BOOK} src/AaveV3Ethereum.sol cbBTC_UNDERLYING`,
    },
    {
      symbol: 'tBTC',
      decimals: 18,
      address: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
      source: `${AAVE_BOOK} src/AaveV3Ethereum.sol tBTC_UNDERLYING; docs.threshold.network/resources/contract-addresses/mainnet/tbtc`,
    },
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      source: `${AAVE_BOOK} src/AaveV3Ethereum.sol WETH_UNDERLYING`,
    },
    {
      symbol: 'wstETH',
      decimals: 18,
      address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      source: `${AAVE_BOOK} src/AaveV3Ethereum.sol wstETH_UNDERLYING; docs.lido.fi/deployed-contracts`,
    },
    {
      symbol: 'cbETH',
      decimals: 18,
      address: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704',
      source: `${AAVE_BOOK} src/AaveV3Ethereum.sol cbETH_UNDERLYING`,
    },
    {
      symbol: 'rETH',
      decimals: 18,
      address: '0xae78736Cd615f374D3085123A210448E74Fc6393',
      source: `${AAVE_BOOK} src/AaveV3Ethereum.sol rETH_UNDERLYING`,
    },
  ],
  Base: [
    {
      // Aave has no WBTC reserve on Base; wbtc.network names Base as a WBTC network and prints no address.
      // The address is CoinGecko's. Read on-chain it is a LayerZero token (endpoint()
      // 0x1a44076050125825900e736c501f859c50fE728c) with 65.2 WBTC of supply at the September reading, and
      // its Ethereum peer is a contract at the same address whose token() is the Ethereum WBTC above, which
      // held 1003.3 WBTC and names this token as its Base peer. No venue at any reading lends against it.
      symbol: 'WBTC',
      decimals: 8,
      address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
      source:
        'api.coingecko.com/api/v3/coins/wrapped-bitcoin platforms.base; on-chain peers(30101) at Base block ' +
        '50974927 and token() and peers(30184) of that peer at Ethereum block 25922163',
    },
    {
      symbol: 'cbBTC',
      decimals: 8,
      address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      source: `${AAVE_BOOK} src/AaveV3Base.sol cbBTC_UNDERLYING`,
    },
    {
      symbol: 'tBTC',
      decimals: 18,
      address: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b',
      source: `${AAVE_BOOK} src/AaveV3Base.sol tBTC_UNDERLYING; docs.threshold.network/resources/contract-addresses/mainnet/tbtc`,
    },
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0x4200000000000000000000000000000000000006',
      source: `${AAVE_BOOK} src/AaveV3Base.sol WETH_UNDERLYING`,
    },
    {
      symbol: 'wstETH',
      decimals: 18,
      address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
      source: `${AAVE_BOOK} src/AaveV3Base.sol wstETH_UNDERLYING; docs.lido.fi/deployed-contracts`,
    },
    {
      symbol: 'cbETH',
      decimals: 18,
      address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
      source: `${AAVE_BOOK} src/AaveV3Base.sol cbETH_UNDERLYING`,
    },
    {
      // Aave has no rETH reserve on Base.
      symbol: 'rETH',
      decimals: 18,
      address: '0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c',
      source: 'github.com/ethereum-optimism/ethereum-optimism.github.io data/rETH/data.json (Superchain token list)',
    },
  ],
};
