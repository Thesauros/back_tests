// scripts/tangem/pack-figures.ts
var import_fs = require("fs");
var import_path = require("path");

// libs/networks/src/chains.ts
var MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
var chains = {
  ["Arbitrum" /* Arbitrum */]: {
    network: "Arbitrum" /* Arbitrum */,
    chainId: 42161,
    slug: "arbitrum",
    rpcEnvKey: "ARBITRUM_RPC_URL",
    // Arbitrum Multicall2 — kept over Multicall3 because it is the aggregator
    // the service has always used here and it exposes getL1BlockNumber().
    multicall: "0x842eC2c7D803033Edf55E478F461FC547Bc54EB2",
    explorerUrl: "https://arbiscan.io"
  },
  ["Base" /* Base */]: {
    network: "Base" /* Base */,
    chainId: 8453,
    slug: "base",
    rpcEnvKey: "BASE_RPC_URL",
    multicall: MULTICALL3,
    explorerUrl: "https://basescan.org"
  },
  ["Plasma" /* Plasma */]: {
    network: "Plasma" /* Plasma */,
    chainId: 9745,
    slug: "plasma",
    rpcEnvKey: "PLASMA_RPC_URL",
    multicall: MULTICALL3,
    explorerUrl: "https://plasmascan.to"
  },
  ["Monad" /* Monad */]: {
    network: "Monad" /* Monad */,
    chainId: 143,
    slug: "monad",
    rpcEnvKey: "MONAD_RPC_URL",
    multicall: MULTICALL3,
    explorerUrl: "https://monadexplorer.com"
  },
  ["Ethereum" /* Ethereum */]: {
    network: "Ethereum" /* Ethereum */,
    chainId: 1,
    slug: "mainnet",
    rpcEnvKey: "ETHEREUM_RPC_URL",
    multicall: MULTICALL3,
    explorerUrl: "https://etherscan.io"
  }
};
var supportedNetworks = [
  "Base" /* Base */,
  "Arbitrum" /* Arbitrum */,
  "Plasma" /* Plasma */,
  "Monad" /* Monad */,
  ...process.env[chains["Ethereum" /* Ethereum */].rpcEnvKey]?.trim() ? ["Ethereum" /* Ethereum */] : []
];

// libs/networks/src/deployments.ts
var TREASURY_ADDRESS = "0xafA9ed53c33bbD8DE300481ce150dB3D35738F9D";
var deployments = {
  ["Base" /* Base */]: {
    network: "Base" /* Base */,
    chainId: 8453,
    slug: "base",
    timelock: "0xb2b1A0c173549A498859822f20Da68be1bEA593D",
    providerManager: "0x633c0D91BBD2d3F3DEF62d784c7d2bfd46487b05",
    treasury: TREASURY_ADDRESS,
    vaults: {
      ["USDC" /* USDC */]: {
        token: "USDC" /* USDC */,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        assetDecimals: 6,
        name: "Thesauros USDC Vault",
        symbol: "tUSDC",
        proxy: "0x3C7739173cca612B6394EE57131458185A5beC44",
        implementation: "0xd4aC8Bcec0790ADDa563dB1B35c072B485fE2708",
        deploymentBlock: 49576041,
        activationBlock: 49576045,
        activationTimestamp: 1785941437,
        providers: [
          {
            kind: "CompoundV3" /* CompoundV3 */,
            name: "CompoundV3Provider",
            address: "0x7EbD3E69954f0Af98Adbfe80B8f28c0B82B3b74C",
            market: "0xb125E6687d4313864e53df431d5425969c15Eb2F"
          },
          {
            kind: "AaveV3" /* AaveV3 */,
            name: "AaveV3Provider",
            address: "0xDDAA9700c0Da1020AE5dabC7AA0A0bb750DD317c",
            market: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "SteakhouseHighYield" /* SteakhouseHighYield */,
            name: "SteakhouseHighYieldMorphoProvider",
            address: "0x9c35b8a92Fc3a305712b9dD8a1C34310eA09C61c",
            market: "0xBEEFA7B88064FeEF0cEe02AAeBBd95D30df3878F"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "SteakhousePrime" /* SteakhousePrime */,
            name: "SteakhousePrimeMorphoProvider",
            address: "0xDDf2C1f8EAf567c084dEE07658Ed3906029395b1",
            market: "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "GauntletCore" /* GauntletCore */,
            name: "GauntletCoreMorphoProvider",
            address: "0x51B8BdCdA5E41893737C9C3A08f528C97fCc1b8b",
            market: "0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12"
          }
        ]
      }
    },
    external: {
      aaveV3: {
        poolAddressesProvider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
        pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
        poolDataProvider: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A"
      },
      compoundV3: {
        comet: "0xb125E6687d4313864e53df431d5425969c15Eb2F"
      }
    },
    crosschain: {
      role: "hub",
      profile: "stand",
      epochVault: "0x33c4F5Efc49DCEa72bfA8Fe62e5Cb7B3226d7cB6",
      tickAccountant: "0xB45819B6844708915c5d7936A847186A6a078b27",
      chainAgent: "0x3BAf244cAB9a35F75e5F606704Ad7A9D09C16B83",
      strategy: "0x4cBb4042F79e150F99D3Da4d666e10fdB0711F33",
      cctpAdapter: "0x26f9955157CeE02A39B61739abe7A520aB9868ea",
      startBlock: 51905646
    },
    legacy: {
      timelock: "0xED495C426F361A05572B48E4B546d307812AD2C1",
      providerManager: "0x75Bad13288603842bD8083eed7B97c8c5E816dd1",
      vaults: {
        ["USDC" /* USDC */]: {
          proxy: "0xCA6029f2d5f5d36DA047206Ae7A254Fa80F579B8",
          deploymentBlock: 42024291
        }
      },
      providers: [
        {
          kind: "CompoundV3" /* CompoundV3 */,
          name: "CompoundV3Provider",
          address: "0xea1D7f906dcB2caF0a9833Bc82EB4b1E7593bf94"
        },
        {
          kind: "AaveV3" /* AaveV3 */,
          name: "AaveV3Provider",
          address: "0x47448b505EeBF1b7Da5cfE9Aa1eaa8EBa8F20eb9"
        },
        {
          kind: "Morpho" /* Morpho */,
          strategy: "SteakhouseHighYield" /* SteakhouseHighYield */,
          name: "SteakhouseHighYieldMorphoProvider",
          address: "0x133C32b6A0eF2e091A11Fe7234a14eBfe3dde21f"
        },
        {
          kind: "Morpho" /* Morpho */,
          strategy: "SteakhousePrime" /* SteakhousePrime */,
          name: "SteakhousePrimeMorphoProvider",
          address: "0x585B8e4160607339ff425BaF75b22506C1779Fc2"
        },
        {
          kind: "Morpho" /* Morpho */,
          strategy: "GauntletCore" /* GauntletCore */,
          name: "GauntletCoreMorphoProvider",
          address: "0x21E96029eC4bB2d2492dC1ea1A0aB5D15943fDD3"
        }
      ]
    }
  },
  ["Arbitrum" /* Arbitrum */]: {
    network: "Arbitrum" /* Arbitrum */,
    chainId: 42161,
    slug: "arbitrum",
    timelock: "0x694C38fb29fd14dECbBe11A15009aC7e728A686D",
    providerManager: "0x37C900930013D0f8766cCe006a867493B54fAa4c",
    treasury: TREASURY_ADDRESS,
    vaults: {
      ["USDC" /* USDC */]: {
        token: "USDC" /* USDC */,
        asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        assetDecimals: 6,
        name: "Thesauros USDC Vault",
        symbol: "tUSDC",
        proxy: "0x4E5c0A4C11d713002D74bA43a458efc31bc76378",
        implementation: "0xEd3296117dAAa46FE4Cf94036bb42EE86100F8c7",
        deploymentBlock: 491503900,
        activationBlock: 491503910,
        activationTimestamp: 1785969040,
        providers: [
          {
            kind: "CompoundV3" /* CompoundV3 */,
            name: "CompoundV3Provider",
            address: "0xD5209C39b3ca78a3eF952c311a29326e7f316E67",
            market: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf"
          },
          {
            kind: "AaveV3" /* AaveV3 */,
            name: "AaveV3Provider",
            address: "0xA34574Dae6284EDc7348C36A80242b92CFBd13A5",
            market: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "SteakhouseHighYield" /* SteakhouseHighYield */,
            name: "SteakhouseHighYieldMorphoProvider",
            address: "0x6240402d3Cb33777D4E5E6B5791bC8518AEb8B99",
            market: "0x5c0C306Aaa9F877de636f4d5822cA9F2E81563BA"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "SteakhousePrime" /* SteakhousePrime */,
            name: "SteakhousePrimeMorphoProvider",
            address: "0x0D9FD60E25b0C3b2416D46F7dd311b0ED6743484",
            market: "0x250CF7c82bAc7cB6cf899b6052979d4B5BA1f9ca"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "GauntletCore" /* GauntletCore */,
            name: "GauntletCoreMorphoProvider",
            address: "0xeB98d46937C537efF376361536D58d78c57c40d7",
            market: "0x7e97fa6893871A2751B5fE961978DCCb2c201E65"
          }
        ]
      }
    },
    external: {
      aaveV3: {
        poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
        pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        poolDataProvider: "0x243Aa95cAC2a25651eda86e80bEe66114413c43b"
      },
      compoundV3: {
        comet: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf"
      },
      // No Dolomite provider is part of the current vault; the address is kept
      // for the stats endpoints, which still read Dolomite markets.
      dolomite: {
        getter: "0x7b1fFbf8e633bC52d356601eF3323efEEf1e78a3"
      }
    },
    crosschain: {
      role: "spoke",
      profile: "stand",
      chainAgent: "0x10DaB1A9BB794A53849D295fF08768345888Ddd9",
      strategy: "0xD211BfFAB29e60c17a2B406B3FAf3d0E29282B71",
      cctpAdapter: "0x12a6126507012368c8a4523437f7c3422CBFea0f",
      startBlock: 509725687
    }
  },
  ["Plasma" /* Plasma */]: {
    network: "Plasma" /* Plasma */,
    chainId: 9745,
    slug: "plasma",
    timelock: "0xE1Cfb1BDb3901dcEe9F21146c1F299c775d9B65C",
    providerManager: "0x40F1fBf6a92155a6D321c09936234BFEb9Ec4760",
    treasury: TREASURY_ADDRESS,
    vaults: {
      // Plasma runs an Aave-only strategy on USDT0.
      ["USDT0" /* USDT0 */]: {
        token: "USDT0" /* USDT0 */,
        asset: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
        assetDecimals: 6,
        name: "Thesauros USDT0 Vault",
        symbol: "tUSDT0",
        proxy: "0x2Ed9B7fB6Bbe0920145B2a79c18C3f7cFCAE3C99",
        implementation: "0x4382190FDbf4befA016Ea412f34eb54593312aD5",
        deploymentBlock: 29065973,
        activationBlock: 29065973,
        activationTimestamp: 1786006401,
        providers: [
          {
            kind: "AaveV3" /* AaveV3 */,
            name: "AaveV3Provider",
            address: "0x27a1c09eb8D7536A76010c14deA14e3fD5C828B5",
            market: "0x061D8e131F26512348ee5FA42e2DF1bA9d6505E9"
          }
        ]
      }
    },
    external: {
      aaveV3: {
        poolAddressesProvider: "0x061D8e131F26512348ee5FA42e2DF1bA9d6505E9",
        pool: "0x925a2A7214Ed92428B5b1B090F80b25700095e12",
        poolDataProvider: "0xf2D6E38B407e31E7E7e4a16E6769728b76c7419F"
      }
    }
  },
  ["Monad" /* Monad */]: {
    network: "Monad" /* Monad */,
    chainId: 143,
    slug: "monad",
    timelock: "0x30dC35B78a401Fd0227C229ADF6d0F5097358EF9",
    providerManager: "0x0c5cEd804488E4AbdE6B809164e72cc0F91896b5",
    treasury: TREASURY_ADDRESS,
    vaults: {
      // Monad runs an Aave-only strategy on USDC.
      ["USDC" /* USDC */]: {
        token: "USDC" /* USDC */,
        asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
        assetDecimals: 6,
        name: "Thesauros USDC Vault",
        symbol: "tUSDC",
        proxy: "0x40F1fBf6a92155a6D321c09936234BFEb9Ec4760",
        implementation: "0x44eC9D49196749Cf647339350d381302af4a3d60",
        deploymentBlock: 93601297,
        activationBlock: 93601302,
        activationTimestamp: 1786009609,
        providers: [
          {
            kind: "AaveV3" /* AaveV3 */,
            name: "AaveV3Provider",
            address: "0xAeEcf7F780e88B155df330434Ef29b2B077024e0",
            market: "0x34793Fb9935F7bB5E5aE920fb963F39063E7A615"
          }
        ]
      }
    },
    external: {
      aaveV3: {
        poolAddressesProvider: "0x34793Fb9935F7bB5E5aE920fb963F39063E7A615",
        pool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
        poolDataProvider: "0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad"
      }
    }
  },
  // Deployed 2026-09-21 (contracts `dev` @ b0066f1). An earlier generation at
  // 0x839E57080C18195D8D343a02c2f623b5916f7383 is still live under the same
  // name and symbol: this vault is told apart by its address only.
  ["Ethereum" /* Ethereum */]: {
    network: "Ethereum" /* Ethereum */,
    chainId: 1,
    slug: "mainnet",
    timelock: "0xB7d7e747b583bDE56f5277a6E4820Cfec7e0f587",
    providerManager: "0xDDce69b66E9DD56c506918Dd347f32A78002C7b6",
    treasury: TREASURY_ADDRESS,
    vaults: {
      ["USDC" /* USDC */]: {
        token: "USDC" /* USDC */,
        asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        assetDecimals: 6,
        name: "Thesauros USDC Vault",
        symbol: "tUSDC",
        proxy: "0xc3156Da39EeEa9De80F1d74b497C0E4A7030Aae3",
        implementation: "0x048C31D6ED2e4f04ADadB4F61116Ae3971EC7547",
        // VaultFactory created and initialized the proxy in one transaction.
        deploymentBlock: 26026159,
        activationBlock: 26026159,
        activationTimestamp: 1789997003,
        // The bot holds no ETH here, and the allocator weighs a move against the
        // APR threshold only, not against what the move costs in L1 gas.
        readOnly: true,
        providers: [
          {
            kind: "CompoundV3" /* CompoundV3 */,
            name: "CompoundV3Provider",
            address: "0x902F8Ba5872A15d84193A5DEbf8A74d90BEF08e7",
            market: "0xc3d688B66703497DAA19211EEdff47f25384cdc3"
          },
          {
            kind: "AaveV3" /* AaveV3 */,
            name: "AaveV3Provider",
            address: "0x107DA8Bd8a6DBaB9823E316e10abCDaC4d4D6941",
            market: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "Steakhouse" /* Steakhouse */,
            name: "SteakhouseMorphoProvider",
            address: "0x4C7e55689aCcC42562E113e04c3BDe1B2eb76622",
            market: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "GauntletPrime" /* GauntletPrime */,
            name: "GauntletPrimeMorphoProvider",
            address: "0xBC64abbCa87289746f2B01C8ab02A78c9fC92B89",
            market: "0xdd0f28e19C1780eb6396170735D45153D261490d"
          },
          {
            kind: "Morpho" /* Morpho */,
            strategy: "Smokehouse" /* Smokehouse */,
            name: "SmokehouseMorphoProvider",
            address: "0x2fe36048F394A0732E8F28C43DbF351F0253C6E5",
            market: "0xBEeFFF209270748ddd194831b3fa287a5386f5bC"
          }
        ]
      }
    },
    external: {
      aaveV3: {
        poolAddressesProvider: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
        pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
        poolDataProvider: "0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD"
      },
      compoundV3: {
        comet: "0xc3d688B66703497DAA19211EEdff47f25384cdc3"
      }
    }
  }
};

// scripts/tangem/pack-figures.ts
var DAY = 86400;
var YEAR = 365 * DAY;
var STRATEGIES = ["thesauros_simple", "first_split_held", "eligible_equal_weight", "just_aave", "just_best_vault"];
var MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
var DUST = 1e4;
var WHOLE = 0.9999;
var REMAINDER = 1e3;
var THRESHOLD_PP = { public_vault: 0.25, water_filling: 0.05 };
var ALLOCATOR = { readings: 2, move: 1e3, leg: 10 };
var LIVE_CAP = 60;
var PRODUCTION_EXPONENT = {
  aave: 2,
  compound: 2,
  morpho: 1.75,
  "morpho-v2": 1.75,
  "morpho-market": 1.75
};
var ASSUMED_EXPONENT = 1.75;
var FORCED = [
  "forced exit: the venue has no reading",
  "forced exit: the venue is not in the set",
  "forced exit: the venue is too small for a full position"
];
var HIT = ["curator_bad_debt", "protocol_hack", "withdrawal_freeze"];
var WITH_FORCED = "moved in the transaction of a forced exit";
var EQUAL_PARTS = "equal parts over the venues that take money";
var FEES = [0, 10, 15];
var HELD_FROM = 1;
var PACK_FOLDER = {
  "alloc-a": "allocator-set-a",
  "alloc-a.measured": "allocator-set-a-measured",
  "alloc-strict": "allocator-strict-set",
  "alloc-b": "allocator-set-b",
  "alloc-b.measured": "allocator-set-b-measured",
  "public-a": "public-rules-set-a",
  deployed: "vault-as-deployed"
};
var SETS = { in_set: "the strict set", in_set_vaults_kept: "set A", in_set_broad: "set B" };
var FIRST_SETS = { in_set: "the set", in_set_vaults_kept: "the set with the vaults kept" };
var REBUILT_WITHIN = 1e-3;
var NO_ADAPTER = {
  "morpho-v2": "Morpho Vault V2",
  "morpho-market": "single Morpho Blue market",
  fluid: "Fluid",
  susdc: "Spark sUSDC"
};
function cellsOf(line) {
  const cells = [""];
  let quoted = false;
  for (const char of line) {
    if (char === '"')
      quoted = !quoted;
    else if (char === "," && !quoted)
      cells.push("");
    else
      cells[cells.length - 1] += char;
  }
  return cells;
}
function csv(path) {
  const [header, ...rows] = (0, import_fs.readFileSync)(path, "utf8").trim().split("\n").map(cellsOf);
  if (new Set(header).size !== header.length)
    throw new Error(`${path}: two columns have one name`);
  return rows.map((cells, index) => {
    if (cells.length !== header.length)
      throw new Error(`${path}: line ${index + 2} has ${cells.length} cells, the header has ${header.length}`);
    return Object.fromEntries(header.map((name, column2) => [name, cells[column2]]));
  });
}
function num(row, column2) {
  const value = Number(row[column2]);
  if (row[column2] === void 0 || row[column2] === "" || !Number.isFinite(value))
    throw new Error(`No number in ${column2}: ${JSON.stringify(row)}`);
  return value;
}
var dayOf = (t) => new Date(t * 1e3).toISOString().slice(0, 10);
var networks = /* @__PURE__ */ new Map();
function loadNetwork(config) {
  const known = networks.get(config.network);
  if (known)
    return known;
  const dir = (0, import_path.join)(process.cwd(), "data/tangem", config.network.toLowerCase());
  const from = Date.parse(config.start_date) / 1e3;
  const to = Date.parse(config.end_date) / 1e3;
  const readings = (0, import_fs.readFileSync)((0, import_path.join)(dir, "raw.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).sort((a, b) => a.block - b.block).map(({ values }) => ({ t: Number(values.timestamp), values })).filter(({ t }) => t >= from && t <= to + 4 * 3600);
  const byDay = /* @__PURE__ */ new Map();
  for (const reading of readings)
    byDay.set(dayOf(reading.t), [...byDay.get(dayOf(reading.t)) ?? [], reading]);
  const rule2 = csv((0, import_path.join)(dir, "venue-eligibility.csv"));
  const network = {
    name: config.network,
    readings,
    byDay,
    rule: rule2,
    months: [...new Set(rule2.map((row) => row.month))].sort(),
    labels: {}
  };
  networks.set(config.network, network);
  return network;
}
function loadRun(path) {
  const config = JSON.parse((0, import_fs.readFileSync)(path, "utf8"));
  const network = loadNetwork(config);
  Object.assign(network.labels, config.labels);
  const dir = (0, import_path.join)(process.cwd(), "data/tangem", config.network.toLowerCase(), config.output ?? "simulation");
  const days = csv((0, import_path.join)(dir, "tangem-simulation-daily.csv"));
  const moved = csv((0, import_path.join)(dir, "tangem-simulation-rebalances.csv"));
  const name = (0, import_path.basename)(path).replace(/^config\./, "").replace(/\.json$/, "");
  const of = (rows) => Object.fromEntries(STRATEGIES.map((strategy) => [strategy, rows.filter((row) => row.strategy === strategy)]));
  const run = {
    name,
    path,
    config,
    network,
    daily: of(days),
    moves: moved.filter((row) => row.strategy === "thesauros_simple"),
    movesOf: of(moved),
    stress: csv((0, import_path.join)(dir, "tangem-stress-tests.csv"))
  };
  moved.forEach((move) => kindOf(run, move));
  if (moved.some((move) => !STRATEGIES.includes(move.strategy)))
    throw new Error(`${name}: the rebalance file has a strategy the script does not know`);
  for (const strategy of STRATEGIES) {
    const rows = run.daily[strategy];
    if (rows.length === 0 || rows.length !== run.daily.thesauros_simple.length || rows[0].date !== config.start_date)
      throw new Error(`${name}: ${strategy} has ${rows.length} days from ${rows[0]?.date}`);
    const last = rows[rows.length - 1];
    if (Math.abs(num(last, "total_assets") - config.initial_deposit - num(last, "cumulative_yield")) > 0.011)
      throw new Error(`${name}: ${strategy} ends on a balance that is not the deposit plus its yield`);
  }
  const counted = run.daily.thesauros_simple.reduce((sum, row) => sum + num(row, "rebalance_count"), 0);
  if (counted !== run.moves.length)
    throw new Error(`${name}: ${run.moves.length} movements in the rebalance file, ${counted} in the daily file`);
  return run;
}
var out = [];
var tables = [];
var say = (...lines) => out.push(...lines, "");
function table(header, rows) {
  tables.push([header, ...rows]);
  say(
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  );
}
function perRun(runs, rows) {
  table(
    ["", ...runs.map((run) => `\`${run.name}\``)],
    rows.map(([title, cell]) => [title, ...runs.map(cell)])
  );
}
var thousands = (value) => Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
var usd = (value) => `${value < 0 ? "\u2212" : ""}$${thousands(Math.abs(value))}`;
var signed = (value, text) => value < 0 ? text : `+${text}`;
var percent = (value, digits = 2) => `${value < 0 ? "\u2212" : ""}${Math.abs(value).toFixed(digits)}%`;
var size = (value) => value >= 1e9 ? `$${(value / 1e9).toFixed(1)}B` : value >= 1e7 ? `$${(value / 1e6).toFixed(0)}M` : value >= 1e5 ? `$${(value / 1e6).toFixed(1)}M` : usd(value);
var column = (run, provider, prefix = "pct") => `${prefix}_${run.config.labels[provider].toLowerCase().replace(/ /g, "_")}`;
function packFolder(run) {
  const [network, ...rest] = run.name.split(".");
  const folder = PACK_FOLDER[rest.join(".")];
  return folder ? `\`${network}-${folder}/simulation\`` : "none";
}
var inSet = (config, provider, date) => config.eligible_periods === void 0 || (config.eligible_periods[provider] ?? []).some(([from, to]) => date >= from && date < to);
var allocator = (run) => run.config.policy === "water_filling";
var threshold = (run) => THRESHOLD_PP[run.config.policy ?? "public_vault"];
var free = (reading, provider) => Number(reading.values[`${provider}.liquidity`] ?? 0) / 1e6;
var cap = (run) => run.config.risk_guard_enabled ? run.config.provider_cap_percent ?? LIVE_CAP : 100;
var rounding = (run) => run.config.initial_deposit / 1e4;
function hoursApart(network) {
  const gaps = network.readings.slice(1).map((reading, i) => reading.t - network.readings[i].t);
  return Math.round(gaps.sort((a, b) => a - b)[gaps.length >> 1] / 3600);
}
var reworked = false;
var setsShown = () => Object.keys(reworked ? SETS : FIRST_SETS);
var setName = (set) => (reworked ? SETS : FIRST_SETS)[set];
function kindOf(run, move) {
  const { reason } = move;
  const priced2 = allocator(run) ? `expected gain with the vault's own deposit priced at least ${threshold(run)} pp a year at ${ALLOCATOR.readings} readings in a row` : `expected gain on the rates before the move at least ${threshold(run)} pp a year`;
  if (FORCED.includes(reason))
    return "forced";
  if (reason === EQUAL_PARTS && move.strategy === "eligible_equal_weight")
    return "equal_parts";
  if (move.strategy !== "eligible_equal_weight") {
    if (reason === WITH_FORCED)
      return "with_forced";
    if (reason === priced2)
      return "priced";
    if (allocator(run) && reason === `back under the provider cap of ${cap(run)}% whatever the move earns`)
      return "restore";
  }
  throw new Error(`${run.name}: a movement of ${move.strategy} at ${move.datetime_utc} has the reason "${reason}"`);
}
function ruleOf(run) {
  const { config, network } = run;
  if (!config.eligible_periods)
    return "none";
  const days = run.daily.thesauros_simple.map((day) => day.date);
  const monthOf = (date) => network.months.filter((month) => month <= date).pop();
  if (!days.every(monthOf))
    throw new Error(`${run.name}: a day is before the first month of venue-eligibility.csv`);
  config.providers.forEach((provider) => ruleRows(network, provider));
  const follows = (set) => network.rule.filter((row) => config.providers.includes(row.provider)).every(
    (row) => days.filter((date) => monthOf(date) === row.month).every((date) => inSet(config, row.provider, date) === (row[set] === "1"))
  );
  const leftOut = (set) => [
    ...new Set(
      network.rule.filter((row) => row[set] === "1" && !config.providers.includes(row.provider)).map((row) => network.labels[row.provider] ?? row.venue)
    )
  ];
  const [followed] = Object.keys(SETS).filter(follows).sort((a, b) => leftOut(a).length - leftOut(b).length);
  if (!followed)
    throw new Error(`${run.name}: eligible_periods are no set of venue-eligibility.csv`);
  const without = leftOut(followed);
  return `\`${followed}\` of \`venue-eligibility.csv\`` + (without.length ? ` without ${without.join(" and ")}` : "");
}
var lastDay = (run, strategy) => run.daily[strategy][run.daily[strategy].length - 1];
var earned = (run, strategy) => num(lastDay(run, strategy), "total_assets") - run.config.initial_deposit;
var fees = (run) => run.daily.thesauros_simple.reduce((sum, row) => sum + num(row, "fees_paid"), 0);
var beforeFee = (run) => earned(run, "thesauros_simple") + fees(run);
var ofDeposit = (run, value) => value / run.config.initial_deposit * 100;
var yielded = (run, value) => `${usd(value)} (${percent(ofDeposit(run, value))})`;
var difference = (run, value) => `${signed(value, usd(value))} (${signed(value, percent(ofDeposit(run, value)).replace("%", " pp"))})`;
function bestVault(run) {
  const picked = run.config.providers.filter(
    (provider) => num(run.daily.just_best_vault[0], column(run, provider)) === 100
  );
  if (picked.length !== 1)
    throw new Error(`${run.name}: just_best_vault holds ${picked.length} venues at 100% on day one`);
  return run.config.labels[picked[0]];
}
function breakEvenFee(run) {
  const aave = earned(run, "just_aave");
  return beforeFee(run) > aave ? `about ${percent((beforeFee(run) - aave) / beforeFee(run) * 100, 0)}` : "none: below Just Aave before any fee";
}
function monthsAhead(run, monthOf) {
  const lead = /* @__PURE__ */ new Map();
  run.daily.thesauros_simple.forEach((day, d) => {
    const control = run.daily.eligible_equal_weight[d];
    if (control.date !== day.date)
      throw new Error(`${run.name}: the strategies do not share their days`);
    const ahead = num(day, "daily_yield") + num(day, "fees_paid") - num(control, "daily_yield");
    lead.set(monthOf(day.date), (lead.get(monthOf(day.date)) ?? 0) + ahead);
  });
  return `${[...lead.values()].filter((value) => value > 0).length} of ${lead.size}`;
}
var ruleMonth = (run) => (date) => new Date(Date.parse(date) - (Number(run.config.start_date.slice(8)) - 1) * DAY * 1e3).toISOString().slice(0, 7);
var assumed = (run) => allocator(run) ? run.config.providers.filter((provider) => PRODUCTION_EXPONENT[ruleRows(run.network, provider)[0].kind] === void 0).map((provider) => run.config.labels[provider]) : [];
function sameRuns(runs) {
  const days = (run) => run.daily.thesauros_simple.map((day) => `${day.date} ${day.total_assets} ${day.fees_paid}`);
  const moves = (run) => run.moves.map((move) => `${move.datetime_utc} ${move.from} ${move.to} ${move.amount}`);
  const print = (run) => JSON.stringify([run.config.network, days(run), moves(run)]);
  return runs.flatMap(
    (run, i) => runs.slice(i + 1).filter((other) => print(other) === print(run)).map((other) => {
      const only = [
        [other, run],
        [run, other]
      ].flatMap(
        ([a, b]) => a.config.providers.filter((provider) => !b.config.providers.includes(provider)).map((provider) => {
          if (a.daily.thesauros_simple.some((day) => num(day, column(a, provider)) !== 0))
            throw new Error(`${a.name}: ${provider} holds money, and ${b.name} is the same run without it`);
          return `${a.config.labels[provider]} of \`${a.name}\``;
        })
      );
      const differ = STRATEGIES.slice(1).filter(
        (strategy) => lastDay(run, strategy).total_assets !== lastDay(other, strategy).total_assets
      );
      return `- \`${other.name}\` and \`${run.name}\` are one run of \`thesauros_simple\`: the same \`total_assets\` and \`fees_paid\` on every day and the same movements.${only.length === 0 ? "" : ` The venues only one of them has are at 0.00% of the vault on every day: ${only.join(", ")}.`} ${differ.length === 0 ? "Their controls end on the same balances too." : `Of their controls, ${differ.map((strategy) => `\`${strategy}\``).join(" and ")} ends on another balance.`}`;
    })
  );
}
function result(runs) {
  if (runs.some((run) => run.config.start_date.slice(8) !== "07"))
    throw new Error("The rows of table 1 are worded for a year that starts on the 7th");
  const withAllocator = runs.some(allocator);
  const noExponent = [...new Set(runs.flatMap(assumed))];
  say("## 1. Result", "Yield for the year on the deposit, in USD and in percent of the deposit.");
  perRun(runs, [
    [
      "Decision of Thesauros Simple",
      (run) => !allocator(run) ? "public vault's rules" : run.config.impact_exponent === "measured" ? "allocator, measured exponents" : `allocator, production's constants${assumed(run).length ? ` (${ASSUMED_EXPONENT} assumed for ${assumed(run).join(" and ")})` : ""}`
    ],
    [
      "Venue set",
      (run) => {
        const set = Object.keys(SETS).find((name) => ruleOf(run).startsWith(`\`${name}\``));
        return set ? `${SETS[set]}: ${ruleOf(run)}` : "no rule: the venues of the config, all year";
      }
    ],
    ["Liquidity rule", (run) => run.config.liquidity_rule ? "on" : "off"],
    ["Just Aave: all in Aave V3, never moved", (run) => yielded(run, earned(run, "just_aave"))],
    [
      "First split held: the first allocation, never rebalanced, no fee",
      (run) => yielded(run, earned(run, "first_split_held"))
    ],
    [
      "Eligible equal weight: equal parts over the venues allowed, no fee",
      (run) => yielded(run, earned(run, "eligible_equal_weight"))
    ],
    ["Thesauros Simple before its fee", (run) => yielded(run, beforeFee(run))],
    [
      "Choosing by rate added, against first split held",
      (run) => difference(run, beforeFee(run) - earned(run, "first_split_held"))
    ],
    [
      "Choosing by rate added, against eligible equal weight",
      (run) => difference(run, beforeFee(run) - earned(run, "eligible_equal_weight"))
    ],
    [
      "Months ahead of eligible equal weight, before the fee: months from the 7th to the 6th",
      (run) => monthsAhead(run, ruleMonth(run))
    ],
    [
      "Months ahead of eligible equal weight, before the fee: calendar months",
      (run) => monthsAhead(run, (date) => date.slice(0, 7))
    ],
    ["Performance fee", (run) => `${usd(fees(run))} (${run.config.performance_fee_percent}% of each positive day)`],
    ["Thesauros Simple after its fee", (run) => yielded(run, earned(run, "thesauros_simple"))],
    [
      "Just Best Vault: all in the venue with the highest rate on day one",
      (run) => yielded(run, earned(run, "just_best_vault"))
    ],
    ["The venue Just Best Vault picked", bestVault],
    [
      "Thesauros Simple after its fee, against Just Aave",
      (run) => difference(run, earned(run, "thesauros_simple") - earned(run, "just_aave"))
    ],
    [
      "After its fee, against first split held",
      (run) => difference(run, earned(run, "thesauros_simple") - earned(run, "first_split_held"))
    ],
    [
      "After its fee, against eligible equal weight",
      (run) => difference(run, earned(run, "thesauros_simple") - earned(run, "eligible_equal_weight"))
    ],
    ["Break-even fee: the fee at which Thesauros Simple equals Just Aave", breakEvenFee]
  ]);
  say(
    "- A yield is `total_assets` of the last day of `tangem-simulation-daily.csv` minus the deposit.",
    "- Before its fee: the yield of `thesauros_simple` plus the sum of its `fees_paid`. The fee is that sum.",
    "- Choosing by rate added: the yield before the fee minus the yield of the control. `first_split_held` keeps a venue that later leaves the set, so under a venue rule its difference also carries what the rule costs; `eligible_equal_weight` follows the rule.",
    "- Months ahead: a month counts when the sum of `daily_yield` and `fees_paid` of `thesauros_simple` over its days is above the sum of `daily_yield` of `eligible_equal_weight`. It is counted two ways, and each cell says of how many: by the months of the venue rule, which run from the 7th to the 6th, and by the calendar months the year touches, of which the first and the last are touched in part.",
    "- After its fee, against a control: the yield of `thesauros_simple` minus the yield of the control, which pays no Thesauros fee.",
    "- The venue of Just Best Vault is the venue column that is 100 on its first day.",
    "- Break-even fee: (yield before the fee \u2212 yield of Just Aave) / yield before the fee, to the whole percent. It is an approximation: the fee is charged on each positive day and the balance compounds, which the formula leaves out.",
    `- Decision: \`policy\` and \`impact_exponent\` of the config. The public vault's rules are the decision of the vault as deployed, with RiskGuard's rules around it: at most ${cap(
      runs[0]
    )}% of the vault in a venue, at least two venues, the circuit breaker, the anomaly gate and the cooldown.${withAllocator ? ` The allocator is the water-filling step of the Thesauros cross-chain planner, which is not live for the public vaults. It prices the vault's own deposit in each venue with the exponent production has for the venue's protocol: 2 for Aave V3 and Compound V3, 1.75 for Morpho, which a Morpho Vault V2 and a single Morpho Blue market also take.${noExponent.length === 0 ? "" : ` Production has no exponent for ${noExponent.join(
      " and "
    )}: where a run takes production's exponent it gives them ${ASSUMED_EXPONENT}, an assumption.`} With measured exponents it is the exponent that reproduces the $10M deposit probe of the reading; a reading that measures none leaves the venue's last one, and the constant before the first. Of RiskGuard's rules the allocator runs keep one, by choice: at most ${cap(
      runs[0]
    )}% of the vault in a venue, the entry provider excepted, which has no limit. They apply no minimum of two venues, no circuit breaker, no anomaly gate and no cooldown: the planner's step has none of them.` : ""}`,
    `- Venue set: the column of \`venue-eligibility.csv\` the \`eligible_periods\` of the config are, as in the table of the runs. ${Object.entries(
      SETS
    ).map(([name, set]) => `\`${name}\` is ${set}`).join(", ")} of \`PROGRAMME.md\`.`,
    `- Liquidity rule: \`liquidity_rule\` of the config. On: a venue whose own free liquidity at a reading is below a full position of the vault, ${cap(
      runs[0]
    )}% of the vault at that reading, takes no new money at that reading.`,
    "- Just Best Vault takes the venue with the highest `rate` at the first reading among the venues that are in the set that day and accept the whole deposit. The liquidity rule and the limit on our share of a venue do not bind it, nor Just Aave: they bind `thesauros_simple`, `first_split_held` up to its first rebalance and `eligible_equal_weight`.",
    ...sameRuns(runs)
  );
}
var transacted = /* @__PURE__ */ new Map();
function transactions(run) {
  const known = transacted.get(run);
  if (known)
    return known;
  const sent = [];
  for (const move of run.moves) {
    if (sent.length === 0 || sent[sent.length - 1][0].tx !== move.tx)
      sent.push([]);
    sent[sent.length - 1].push(move);
  }
  if (sent.length !== new Set(run.moves.map((move) => move.tx)).size)
    throw new Error(`${run.name}: the movements of a transaction are not consecutive in the rebalance file`);
  const txs = sent.map((moves) => {
    const [first] = moves;
    const kinds = new Set(moves.map((move) => kindOf(run, move)));
    const gains = new Set(moves.map((move) => move.expected_gain_pp));
    const forced = kinds.has("forced");
    const legs = moves.map((move) => ({ from: move.from, to: move.to, amount: num(move, "amount") }));
    const sound = forced ? [...kinds].every((kind) => kind === "forced" || kind === "with_forced") && gains.size === 1 && gains.has("") : kinds.size === 1 && (kinds.has("priced") || kinds.has("restore")) && gains.size === 1 && !gains.has("");
    if (!sound || new Set(moves.map((move) => `${move.datetime_utc} ${move.realized_change_pp}`)).size !== 1)
      throw new Error(`${run.name}: the movements of transaction ${first.tx} are not of one decision`);
    if (allocator(run) && kinds.has("priced") && (legs.some((leg) => leg.amount < ALLOCATOR.leg) || legs.reduce((sum, leg) => sum + leg.amount, 0) < ALLOCATOR.move))
      throw new Error(`${run.name}: transaction ${first.tx} is a plan under the allocator's least move or leg`);
    return {
      t: Date.parse(first.datetime_utc) / 1e3,
      lower: num(first, "realized_change_pp") < 0,
      expected: kinds.has("priced") ? num(first, "expected_gain_pp") : null,
      restore: kinds.has("restore"),
      forced,
      realized: num(first, "realized_change_pp"),
      legs
    };
  });
  transacted.set(run, txs);
  return txs;
}
var reversals = (txs, least) => txs.flatMap((tx, i) => {
  if (i === 0 || tx.t - txs[i - 1].t > DAY)
    return [];
  const before = txs[i - 1].legs;
  const sent = (leg) => before.filter((other) => other.amount >= least && other.from === leg.to && other.to === leg.from).reduce((sum, other) => sum + other.amount, 0);
  const back = tx.legs.filter((leg) => leg.amount >= least && sent(leg) > 0);
  return back.length === 0 ? [] : [
    back.reduce((sum, leg) => sum + Math.min(leg.amount, sent(leg)), 0) / before.reduce((sum, other) => sum + other.amount, 0)
  ];
});
var priced = (run) => transactions(run).filter((tx) => tx.expected !== null);
var mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
var points = (values) => values.length === 0 ? "none priced" : `${mean(values).toFixed(2)} pp`;
var aboveFree = (run) => run.moves.filter((move) => num(move, "amount") > num(move, "source_free_liquidity"));
var dollars = (spent) => spent < 100 ? `$${spent.toFixed(2)}` : usd(spent);
function gas(run) {
  return dollars(run.moves.reduce((sum, move) => sum + num(move, "gas_cost_usd"), 0));
}
function gasByDay(run) {
  const days = run.daily.thesauros_simple;
  const byDay = days.reduce((sum, day) => sum + num(day, "gas_spent_usd"), 0);
  const byMove = run.moves.reduce((sum, move) => sum + num(move, "gas_cost_usd"), 0);
  const moved = days.filter((day) => num(day, "rebalance_count") > 0).length;
  if (Math.abs(byDay - byMove) > moved * 5e-3 + run.moves.length * 5e-5 + 1e-9)
    throw new Error(`${run.name}: gas is ${byDay} in the daily file and ${byMove} in the rebalance file`);
  return dollars(byDay);
}
function withdrawable(run, test) {
  const days = run.daily.thesauros_simple;
  const count = days.filter((day) => test(num(day, "available_liquidity"), num(day, "total_assets"))).length;
  return `${count} of ${days.length}`;
}
var walks = /* @__PURE__ */ new Map();
function walk(run, strategy = "thesauros_simple") {
  const known = walks.get(`${run.name} ${strategy}`);
  if (known)
    return known;
  const days = run.daily[strategy];
  const moved = /* @__PURE__ */ new Map();
  for (const move of run.movesOf[strategy]) {
    const t = Date.parse(move.datetime_utc) / 1e3;
    moved.set(t, [...moved.get(t) ?? [], move]);
  }
  const at = [];
  const close = /* @__PURE__ */ new Map();
  let before = {};
  for (const day of days) {
    const held = {};
    for (const provider of run.config.providers)
      held[run.config.labels[provider]] = num(day, column(run, provider)) / 100 * num(day, "total_assets");
    close.set(day.date, { ...held });
    const readings = run.network.byDay.get(day.date);
    if (!readings)
      throw new Error(`${run.name}: no reading on ${day.date}`);
    for (const reading of [...readings].reverse()) {
      const after = { ...held };
      for (const move of moved.get(reading.t) ?? []) {
        held[move.from] += num(move, "amount");
        held[move.to] -= num(move, "amount");
      }
      moved.delete(reading.t);
      at.push({ reading, date: day.date, before: { ...held }, after });
    }
    const drift = run.config.providers.map((provider) => {
      const venue = run.config.labels[provider];
      const fall = Math.min(0, num(day, column(run, provider, "interest")));
      return before[venue] === void 0 ? 0 : Math.abs(held[venue] - fall - before[venue]);
    });
    if (Math.max(0, ...drift) > num(day, "total_assets") * REBUILT_WITHIN)
      throw new Error(
        `${run.name}: the positions of ${strategy} on ${day.date} less its movements are not the close of the day before`
      );
    before = close.get(day.date);
  }
  if (moved.size > 0)
    throw new Error(`${run.name}: ${moved.size} rebalances are at no reading of raw.jsonl`);
  walks.set(`${run.name} ${strategy}`, { at, close });
  return { at, close };
}
var looked = /* @__PURE__ */ new Map();
function looks(run, strategy = "thesauros_simple") {
  const known = looked.get(`${run.name} ${strategy}`);
  if (known)
    return known;
  const days = run.daily[strategy];
  const { providers, labels } = run.config;
  const { readings } = run.network;
  const { at, close } = walk(run, strategy);
  const found = new Map(days.map((day) => [day.date, []]));
  for (const { reading, date, after } of at)
    found.get(date).push([reading, after]);
  const payable = (reading, held) => providers.reduce((sum, provider) => sum + Math.min(held[labels[provider]], free(reading, provider)), 0) / providers.reduce((sum, provider) => sum + held[labels[provider]], 0);
  for (const day of days) {
    const next = readings[readings.indexOf(found.get(day.date)[0][0]) + 1];
    if (!next)
      throw new Error(`${run.name}: no reading after the close of ${day.date}`);
    found.get(day.date).push([next, close.get(day.date)]);
    const filed = num(day, "available_liquidity") / num(day, "total_assets");
    const lowest = Math.min(...found.get(day.date).map(([reading, held]) => payable(reading, held)));
    if (Math.abs(lowest - filed) > REBUILT_WITHIN)
      throw new Error(
        `${run.name}: ${strategy} on ${day.date} has ${percent(
          filed * 100
        )} withdrawable in the daily file and ${percent(lowest * 100)} by its positions and the readings`
      );
  }
  looked.set(`${run.name} ${strategy}`, found);
  return found;
}
function largestShare(run) {
  const days = run.daily.thesauros_simple;
  let top = { share: 0, venue: "", date: "" };
  const weigh = (held, reading) => {
    for (const provider of run.config.providers) {
      const position = held[run.config.labels[provider]];
      if (position < rounding(run))
        continue;
      const share = position / (Number(reading.values[`${provider}.supplied`] ?? 0) / 1e6 + position);
      if (share > top.share)
        top = { share, venue: run.config.labels[provider], date: dayOf(reading.t) };
    }
  };
  const { at, close } = walk(run);
  for (const { reading, before, after } of at) {
    weigh(after, reading);
    weigh(before, reading);
  }
  const end = days[days.length - 1].date;
  for (const reading of run.network.readings.filter((item) => dayOf(item.t) > end))
    weigh(close.get(end), reading);
  return `${percent(top.share * 100, 1)} of ${top.venue} on ${top.date}`;
}
function averageShares(run) {
  const days = run.daily.thesauros_simple;
  return run.config.providers.map((provider) => [
    run.config.labels[provider],
    days.reduce((sum, day) => sum + num(day, column(run, provider)), 0) / days.length
  ]).sort((a, b) => b[1] - a[1]).map(([venue, share]) => `${venue} ${percent(share, 1)}`).join(", ");
}
function outsideSet(run, strategy) {
  if (!run.config.eligible_periods)
    return "no rule in this run";
  const days = run.daily[strategy];
  const venueDays = days.reduce(
    (sum, day) => sum + run.config.providers.filter((p) => num(day, column(run, p)) > 0 && !inSet(run.config, p, day.date)).length,
    0
  );
  const flagged = days.filter((day) => num(day, "outside_set_percent") > 0);
  if (venueDays === 0 && flagged.length === 0)
    return "0";
  const most = Math.max(...flagged.map((day) => num(day, "outside_set_percent")));
  return `${venueDays} venue-days on ${flagged.length} days, up to ${percent(most)} of the balance`;
}
function behaviour(runs) {
  const withAllocator = runs.some(allocator);
  const ofRules = withAllocator ? " of the public vault's rules" : "";
  const least = [...new Set(runs.map(threshold))];
  const fell = runs.some(
    (run) => run.daily.thesauros_simple.some(
      (day) => run.config.providers.some((provider) => num(day, column(run, provider, "interest")) < 0)
    )
  );
  const small = runs.filter(allocator).flatMap(transactions).filter((tx) => tx.legs.some((leg) => leg.amount < REMAINDER));
  const apart = [...new Set(runs.filter(allocator).map((run) => hoursApart(run.network)))];
  say(
    "## 2. What the vault did",
    withAllocator ? "`thesauros_simple` only, except the last four rows: the last five are one a strategy." : "`thesauros_simple` only, except the last five rows."
  );
  perRun(runs, [
    ["Rebalances (transactions)", (run) => String(transactions(run).length)],
    ["Movements of funds", (run) => String(run.moves.length)],
    [
      "Movements a rebalance, mean",
      (run) => run.moves.length === 0 ? "\u2014" : (run.moves.length / transactions(run).length).toFixed(2)
    ],
    [
      "Rebalances that reverse the previous one within 24 hours",
      (run) => String(reversals(transactions(run), DUST).length)
    ],
    ["The same, counting movements of any size", (run) => String(reversals(transactions(run), 0).length)],
    [
      `Of the rebalances that reverse the previous one, counting movements of at least ${usd(
        DUST
      )}: those that send back under half of what it moved`,
      (run) => String(reversals(transactions(run), DUST).filter((share) => share < 0.5).length)
    ],
    [
      "Rebalances after which the vault's rate was lower than before",
      (run) => String(transactions(run).filter((tx) => tx.lower).length)
    ],
    ["Rebalances a decision priced", (run) => String(priced(run).length)],
    [
      "Of them, the vault's rate was lower after the move",
      (run) => String(priced(run).filter((tx) => tx.lower).length)
    ],
    [
      least.length === 1 ? `Of them, the realized change was under the ${least[0]} pp the move had to expect` : `Of them, the realized change was under the gain the move had to expect: ${THRESHOLD_PP.public_vault} pp under the public vault's rules, ${THRESHOLD_PP.water_filling} pp for the allocator`,
      (run) => String(priced(run).filter((tx) => tx.realized < threshold(run)).length)
    ],
    [
      "Of them, the realized change was under the expected gain",
      (run) => String(priced(run).filter((tx) => tx.realized < tx.expected).length)
    ],
    ["Mean expected gain of the priced rebalances", (run) => points(priced(run).map((tx) => tx.expected))],
    ["Mean realized change of the priced rebalances", (run) => points(priced(run).map((tx) => tx.realized))],
    [
      "Rebalances that take a venue back under the provider cap, which no gain decided",
      (run) => String(transactions(run).filter((tx) => tx.restore).length)
    ],
    [
      "Movements that are forced exits",
      (run) => String(run.moves.filter((move) => move.reason.startsWith("forced exit")).length)
    ],
    [
      "Movements sent in the transaction of a forced exit",
      (run) => String(run.moves.filter((move) => move.reason === "moved in the transaction of a forced exit").length)
    ],
    ["Movements that took out more than the source venue had free without us", (run) => String(aboveFree(run).length)],
    [
      `Movements under ${usd(REMAINDER)}`,
      (run) => String(run.moves.filter((move) => num(move, "amount") < REMAINDER).length)
    ],
    [
      "Movements whose gas cost was above the amount moved",
      (run) => String(run.moves.filter((move) => num(move, "gas_cost_usd") > num(move, "amount")).length)
    ],
    [
      "Legs refused",
      (run) => String(run.daily.thesauros_simple.reduce((sum, day) => sum + num(day, "rebalances_refused"), 0))
    ],
    ["Gas for the year", gas],
    ["Gas for the year, as the daily file has it", gasByDay],
    [
      "Days on which the whole balance could be withdrawn, to the cent",
      (run) => withdrawable(run, (available, assets) => available >= assets)
    ],
    [
      `Days on which the whole balance could be withdrawn, within ${percent((1 - WHOLE) * 100)} of the balance`,
      (run) => withdrawable(run, (available, assets) => available >= assets * WHOLE)
    ],
    [
      "Days on which less than half could be withdrawn",
      (run) => withdrawable(run, (available, assets) => available < assets / 2)
    ],
    ["Largest share of a venue we would have been", largestShare],
    ["Average share of the vault per venue", averageShares],
    ...STRATEGIES.map((strategy) => [
      `Outside the set: \`${strategy}\``,
      (run) => outsideSet(run, strategy)
    ])
  ]);
  const unpriced = [
    ...new Set(
      runs.flatMap((run) => run.moves.filter((move) => move.expected_gain_pp === "").map((move) => move.reason))
    )
  ].sort();
  say(
    "- Rebalances: distinct `tx` of `tangem-simulation-rebalances.csv`; movements: its rows.",
    `- Reverses the previous one: the rebalance comes at most 24 hours after the one before it and has a movement of at least ${usd(
      DUST
    )} from B to A where the one before had a movement of at least ${usd(
      DUST
    )} from A to B. Smaller movements are left out: a rebalance${ofRules} evens out positions by a few dollars next to its main movements, and such a remainder running the other way is not money sent back. The next row counts them too.`,
    `- Under half of what it moved: one movement running back is enough for a rebalance to count as reversing the previous one, so it need not undo it. What a rebalance sends back is its movements of at least ${usd(
      DUST
    )} along a path the previous one used the other way with a movement of at least ${usd(
      DUST
    )}, each up to what the previous one sent along that path. The row counts the rebalances of the first of the two rows above that send back under half of all the previous one moved.`,
    "- Rate lower than before: `realized_change_pp` below zero, counted once a transaction.",
    `- A decision priced: the rebalance has an \`expected_gain_pp\`${withAllocator ? " and is no move back under the provider cap" : ""}. ${withAllocator ? `Under the public vault's rules the decision compared the rates as they stood before the move and expected at least ${THRESHOLD_PP.public_vault} pp a year. The allocator priced the vault's own deposit in each venue and expected at least ${THRESHOLD_PP.water_filling} pp of the vault a year, from a plan that fills the same venues and drains the same venues, by at least ${usd(
      ALLOCATOR.move
    )} each, at ${ALLOCATOR.readings} readings in a row${apart.length === 1 ? `, which are ${apart[0]} hours apart in this history` : ""}; the amounts may differ between the readings. In both` : `The decision compared the rates as they stood before the move and expected at least ${least[0]} pp a year;`} \`realized_change_pp\` is the vault's rate with our positions in place after the move less the same before it. No decision priced a rebalance without an \`expected_gain_pp\`: ${unpriced.length === 0 ? "these runs have none" : `in these runs the \`reason\` of its movements is ${unpriced.map((reason) => `"${reason}"`).join(" or ")}`}. The five rows that follow count the priced ones only, one value a transaction; the means are over them.`,
    '- Back under the provider cap: rebalances whose `reason` begins with "back under the provider cap". Only the allocator makes them: a venue other than its entry provider that has grown above the cap gives up the excess whatever the move earns. Such a rebalance has an `expected_gain_pp`: what the allocator expects the move to change, which may be a loss, and not a gain it had to reach. So it is not counted as priced. The public vault\'s rules apply the cap inside every rebalance and have no such move.',
    '- Forced exits: movements whose `reason` begins with "forced exit": they leave a venue the decision read as paying nothing, and the `reason` says why. Sent in the transaction of a forced exit: the other movements of that transaction, by their `reason`. Movements a rebalance: the movements over the rebalances.',
    "- More than the source had free: rows with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid.",
    `- Movements under ${usd(
      REMAINDER
    )}: rows with \`amount\` below it. A rebalance${ofRules} evens out positions by such remainders next to its main movements.${withAllocator ? ` A plan of the allocator that a gain decided has no movement under ${usd(
      ALLOCATOR.leg
    )} and moves at least ${usd(
      ALLOCATOR.move
    )} in all, and the script stops on one that does not: the allocator's movements under ${usd(
      REMAINDER
    )} are parts of such a plan${small.some((tx) => tx.forced) ? ", or of the transaction of a forced exit" : ""}${small.some((tx) => tx.restore) ? ", or of a move back under the provider cap" : ""}.` : ""} Gas above the amount: rows with \`gas_cost_usd\` above \`amount\`.`,
    "- Legs refused: the sum of `rebalances_refused` of the daily file.",
    "- A plan with a leg that cannot execute is refused whole, and every leg of it is counted, at each reading at which it is refused: the vault sends the legs of a rebalance in one transaction, which reverts when one of them does.",
    "- Gas for the year: the sum of `gas_cost_usd` of the movements in `tangem-simulation-rebalances.csv`, which has four decimals. As the daily file has it: the sum of `gas_spent_usd` of `thesauros_simple` in `tangem-simulation-daily.csv`, which is rounded to the cent each day. The two differ by the rounding of the two columns and by nothing else: the script stops if they are further apart than that rounding allows.",
    `- Whole balance, to the cent: days with \`available_liquidity\` at least \`total_assets\`. Within ${percent(
      (1 - WHOLE) * 100
    )}: at least ${percent(
      WHOLE * 100
    )} of \`total_assets\`. Less than half: \`available_liquidity\` below half of \`total_assets\`.`,
    `- Largest share of a venue: at every reading of \`raw.jsonl\` the vault holds one position as the reading is taken and another once the movements of that reading are made. Each is divided by the venue's \`supplied\` at that reading plus the position, and the largest of all is shown. A position is the venue's share of \`total_assets\` at the day's close less what the later movements of that day brought into it. Interest of the hours between is left out; the script stops unless the positions so rebuilt for the start of a day are within ${percent(
      REBUILT_WITHIN * 100,
      1
    )} of the balance of the close before.${fell ? " A fall of a venue's index is in the close and in no movement, so for that check it is added back to the venue: the daily file has it as the venue's negative interest of the day." : ""}`,
    `- A position under 0.01% of the deposit, ${usd(
      rounding(runs[0])
    )}, is not weighed in the largest share, nor in tables 8 and 11: the venue columns of the daily file have two decimals, and less than that is their rounding.`,
    "- Average share: the mean of the venue column over the days.",
    "- Outside the set: a venue-day is a day on which a venue's column is above zero outside its `eligible_periods` in the config; the days are those with `outside_set_percent` above zero. The columns have two decimals, so a position under 0.005% of the balance does not show."
  );
}
function stress(runs) {
  const scenarios = runs[0].stress.map((row) => row.scenario);
  const of = (run, scenario) => {
    const row = run.stress.find((item) => item.scenario === scenario);
    if (!row)
      throw new Error(`${run.name}: no ${scenario} in the stress file`);
    return row;
  };
  const { stress: sizes } = runs[0].config;
  const sized = ({ config: { stress: s } }) => [
    s.depeg.price,
    s.depeg.days,
    s.curator_bad_debt.loss_percent,
    s.protocol_hack.loss_percent,
    s.withdrawal_freeze.days
  ].join();
  if (new Set(runs.map(sized)).size !== 1)
    throw new Error("Table 3 is worded for scenarios of one size in every run");
  const uncurated = runs.flatMap((run) => {
    const hit = of(run, "curator_bad_debt").provider_hit;
    const provider = run.config.providers.find((name) => run.config.labels[name] === hit);
    if (!provider)
      throw new Error(`${run.name}: curator_bad_debt hit ${hit}, which is no venue of the run`);
    return provider.includes("Morpho") && !provider.includes("Market") ? [] : [`\`${run.name}\` (${hit})`];
  });
  say("## 3. Stress", "Straight from `tangem-stress-tests.csv`.");
  perRun(runs, [
    ["First day of every scenario", (run) => `${run.stress[0].trigger_date}, day ${run.stress[0].trigger_day}`],
    ...scenarios.flatMap((scenario) => [
      [`\`${scenario}\`: venue hit`, (run) => of(run, scenario).provider_hit || "\u2014"],
      [
        `\`${scenario}\`: largest loss`,
        (run) => `${usd(num(of(run, scenario), "max_loss_usd"))} (${percent(num(of(run, scenario), "max_loss_percent"))})`
      ],
      [`\`${scenario}\`: days until everything can be withdrawn`, (run) => of(run, scenario).time_to_exit_days],
      [`\`${scenario}\`: balance at year end`, (run) => usd(num(of(run, scenario), "final_balance_usd"))],
      ...scenario === "no_stress" ? [] : [
        [
          `\`${scenario}\`: balance at year end, against \`no_stress\``,
          (run) => {
            const value = num(of(run, scenario), "final_balance_vs_no_stress_usd");
            return Math.round(value) === 0 ? usd(0) : signed(value, usd(value));
          }
        ]
      ]
    ])
  ]);
  say(
    "- Columns `provider_hit`, `max_loss_usd` and `max_loss_percent` (against the value on the day before the event), `time_to_exit_days`, `final_balance_usd`, `final_balance_vs_no_stress_usd`. The depeg loss and balance are in USD value; the others in USDC.",
    "- Against `no_stress`: `final_balance_vs_no_stress_usd`, the balance at year end less the balance of the run without the event.",
    `- The scenarios, by \`stress\` of the config: \`depeg\` values a USDC at $${sizes.depeg.price.toFixed(2)} for ${sizes.depeg.days} days and hits no venue (\u2014); \`curator_bad_debt\` takes ${sizes.curator_bad_debt.loss_percent}% of the position in the venue hit; \`protocol_hack\` takes ${sizes.protocol_hack.loss_percent}% of it, and the venue pays nothing afterwards; \`withdrawal_freeze\` lets nothing out of the venue hit for ${sizes.withdrawal_freeze.days} days.`,
    `- Venue hit: \`provider_hit\`, the venue \`provider\` of the scenario names in the config, taken on the first day: \`largest\` is the venue with the vault's largest position that day, \`largest_morpho\` the largest among the curated Morpho vaults. ${HIT.map(
      (scenario) => `\`${scenario}\` takes ${[...new Set(runs.map((run) => run.config.stress[scenario].provider))].map((choice) => {
        const chosen = runs.filter((run) => run.config.stress[scenario].provider === choice);
        return `\`${choice}\` in ${chosen.length === runs.length ? "every run" : chosen.map((run) => `\`${run.name}\``).join(", ")}`;
      }).join(" and ")}`
    ).join("; ")}.`,
    ...uncurated.length === 0 ? [] : [
      `- \`curator_bad_debt\` hits a venue that has no curator in ${uncurated.join(
        ", "
      )}: there it is the loss of ${sizes.curator_bad_debt.loss_percent}% of the vault's largest position, whatever the venue is.`
    ]
  );
}
function ruleRows(network, provider) {
  const rows = network.rule.filter((row) => row.provider === provider);
  if (rows.length !== network.months.length)
    throw new Error(`${network.name}: ${provider} has ${rows.length} months in venue-eligibility.csv`);
  return rows;
}
var monthsIn = (rows, set) => rows.filter((row) => row[set] === "1").length;
function contractOf(network, token, provider) {
  const [{ kind, address }] = ruleRows(network, provider);
  const deployment = deployments[network.name];
  const vault = deployment?.vaults?.[token];
  if (!deployment || !vault)
    throw new Error(`${network.name}: no ${token} vault in the networks library`);
  const live = vault.providers.find((entry) => entry.name === provider);
  if (live) {
    const market = live.kind === "AaveV3" /* AaveV3 */ ? deployment.external.aaveV3.pool : live.market;
    if (market.toLowerCase() !== address.toLowerCase())
      throw new Error(`${provider}: ${market} in the networks library, ${address} in venue-eligibility.csv`);
    return [`\`${market}\``, "yes: a provider of the live vault"];
  }
  if (kind === "morpho-market")
    return [`\`${MORPHO}\`, market \`${address}\``, `no: needs a new adapter (${NO_ADAPTER[kind]})`];
  if (kind === "morpho")
    return [
      `\`${address}\``,
      "yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it"
    ];
  if (!NO_ADAPTER[kind])
    throw new Error(`${provider}: whether a ${kind} venue has an adapter is not known here`);
  return [`\`${address}\``, `no: needs a new adapter (${NO_ADAPTER[kind]})`];
}
function venues(network, runs) {
  const providers = [...new Set(runs.flatMap((run) => run.config.providers))];
  say(`${network.name}, over the ${network.readings.length} readings of \`raw.jsonl\`:`);
  table(
    [
      "Venue",
      "Contract",
      "Index growth over the year",
      "Average rate",
      "With $6M of ours",
      "With $10M of ours",
      "Size",
      "Lowest free liquidity",
      ...setsShown().map((set) => `Months in ${setName(set)}`),
      "Thesauros adapter"
    ],
    providers.map((provider) => {
      const value = (reading, field) => reading.values[`${provider}.${field}`];
      const read = network.readings.filter((reading) => Number(value(reading, "index") ?? 0) > 0);
      if (read.length === 0)
        throw new Error(`${network.name}: ${provider} has no reading`);
      const [first, last] = [read[0], read[read.length - 1]];
      const growth = Number(value(last, "index")) / Number(value(first, "index"));
      const allYear = first === network.readings[0] && last === network.readings[network.readings.length - 1];
      const after = (probe) => {
        const taken = read.filter((reading) => value(reading, probe) != null);
        if (taken.length === 0)
          return "refused at every reading";
        const refused = read.length - taken.length;
        return percent(mean(taken.map((reading) => Number(value(reading, probe)) / 1e25))) + (refused ? ` (deposit refused at ${refused} readings)` : "");
      };
      const supplied = read.map((reading) => Number(value(reading, "supplied")) / 1e6);
      const rows = ruleRows(network, provider);
      return [
        network.labels[provider],
        contractOf(network, runs[0].config.token, provider)[0],
        percent((growth ** (YEAR / (last.t - first.t)) - 1) * 100) + (allYear ? "" : ` a year; ${percent((growth - 1) * 100)} from ${dayOf(first.t)} to ${dayOf(
          last.t
        )}: the venue has no reading before`),
        percent(mean(read.map((reading) => Number(value(reading, "rate")) / 1e25))),
        after("rateAfter6"),
        after("rateAfter10"),
        `${size(Math.min(...supplied))} to ${size(Math.max(...supplied))}`,
        size(Math.min(...read.map((reading) => Number(value(reading, "liquidity")) / 1e6))),
        ...setsShown().map((set) => `${monthsIn(rows, set)} of ${rows.length}`),
        contractOf(network, runs[0].config.token, provider)[1]
      ];
    })
  );
  return providers.filter((provider) => ruleRows(network, provider)[0].kind === "susdc").map((provider) => {
    const read = network.readings.filter((reading) => Number(reading.values[`${provider}.index`] ?? 0) > 0);
    const above = read.filter(
      (reading) => free(reading, provider) > Number(reading.values[`${provider}.supplied`]) / 1e6
    );
    return `- ${network.labels[provider]}: its free liquidity is the USDC of the Sky PSM the vault redeems through, which is no part of its size. It is above the size at ${thousands(
      above.length
    )} of its ${thousands(read.length)} readings.`;
  });
}
function rule(network) {
  const names = [...new Set(network.rule.map((row) => row.venue))];
  const of = (venue) => network.rule.filter((row) => row.venue === venue);
  const label = (venue) => network.labels[of(venue)[0].provider] ?? venue;
  const marks = (rows, mark) => `\`${network.months.map((month) => rows.some((row) => row.month === month && mark(row)) ? "x" : ".").join("")}\``;
  const [from, to] = [network.months[0], network.months[network.months.length - 1]];
  say(`${network.name}, the set by month, from the month that starts on ${from} to the one that starts on ${to}:`);
  table(
    ["Venue", ...setsShown().flatMap((set) => [`In ${setName(set)}`, "Months"])],
    names.filter((venue) => setsShown().some((set) => monthsIn(of(venue), set) > 0)).map((venue) => [
      label(venue),
      ...setsShown().flatMap((set) => [
        marks(of(venue), (row) => row[set] === "1"),
        String(monthsIn(of(venue), set))
      ])
    ])
  );
  const large = (row) => row.size_usd !== "" && num(row, "size_usd") >= 1e8;
  if (reworked) {
    const unread = names.filter((venue) => of(venue)[0].provider === "" && monthsIn(of(venue), "in_set_broad") > 0);
    say(
      `${network.name}, the venues that are in set B in some month and have no \`provider\` in \`venue-eligibility.csv\`, so that no run holds them: ${unread.length === 0 ? "none" : unread.map(
        (venue) => `${venue} ${marks(of(venue), (row) => row.in_set_broad === "1")} (${monthsIn(
          of(venue),
          "in_set_broad"
        )} months)`
      ).join(", ")}.`
    );
    const tests = (row) => [row.test_1, row.test_2, row.test_3];
    const notRead = (row) => large(row) && row.in_set_broad !== "1" && !tests(row).includes("fail") && tests(row).includes("unverified");
    const unverified = names.filter((venue) => of(venue).some(notRead));
    say(
      `${network.name}, the candidates at $100M or more that are outside set B in months in which none of tests 1 to 3 failed and one could not be read (\`unverified\`), which counts as not passed: ${unverified.length === 0 ? "none" : unverified.map((venue) => {
        const months = of(venue).filter(notRead);
        const which = [1, 2, 3].filter((test) => months.some((row) => row[`test_${test}`] === "unverified"));
        const through = [
          ...new Set(
            months.filter((row) => row.held_through !== "" && num(row, "held_through_percent") > 50).map((row) => row.held_through)
          )
        ];
        return `${label(venue)} ${marks(of(venue), notRead)} (${months.length} months; test${which.length === 1 ? "" : "s"} ${which.join(" and ")} not read${of(venue)[0].provider === "" ? "; no `provider`, so no run holds it" : ""}${through.length === 0 ? "" : `; held through ${through.join(" and ")}, so a wrapper too`})`;
      }).join(", ")}.`
    );
  }
  const shape = (row) => row.reason.replace(/[\d.]+%/g, "%");
  say(
    `${network.name}, the candidates that held $100M or more in at least one month and were never in ${setName(
      "in_set"
    )}:`
  );
  table(
    [
      "Candidate",
      "Kind",
      "Months at $100M or more",
      "Which",
      ...setsShown().slice(1).map((set) => `Months in ${setName(set)}`),
      "Why it was out in those months"
    ],
    names.filter((venue) => of(venue).some(large) && monthsIn(of(venue), "in_set") === 0).map((venue) => {
      const months = of(venue).filter(large);
      const times = (row) => months.filter((other) => shape(other) === shape(row)).length;
      const most = months.reduce((top, row) => times(row) > times(top) ? row : top);
      const shares = months.filter((row) => shape(row) === shape(most)).map((row) => /[\d.]+(?=%)/.exec(row.reason)?.[0]).filter((share) => share !== void 0).sort((a, b) => Number(a) - Number(b));
      const [low, high] = [shares[0], shares[shares.length - 1]];
      return [
        label(venue),
        most.kind,
        String(months.length),
        marks(of(venue), large),
        ...setsShown().slice(1).map((set) => String(monthsIn(of(venue), set))),
        low === high ? `${most.reason} (the reason of ${times(most)} of the ${months.length}, as written for ${most.month})` : `${most.reason.replace(/[\d.]+%/, `${low}% to ${high}%`)} (the reason of ${times(most)} of the ${months.length}, with the lowest and the highest figure of those months)`
      ];
    })
  );
  const passing = network.rule.filter(
    (row) => (row.kind === "morpho" || row.kind === "morpho-v2") && ["test_1", "test_2", "test_3", "test_4"].every((test) => row[test] === "pass")
  );
  const sameBook = passing.filter((row) => row.in_set !== "1" && row.reason.startsWith("same book"));
  const wrapper = passing.filter((row) => row.in_set !== "1" && row.reason.startsWith("wrapper"));
  const inside = passing.filter((row) => row.in_set === "1");
  if (sameBook.length + wrapper.length + inside.length !== passing.length)
    throw new Error(`${network.name}: a vault-month passes the four tests and is out for another reason`);
  const inMarket = sameBook.map((row) => num(row, "largest_set_market_percent"));
  say(
    `${network.name}, the months of the Morpho vaults (kinds \`morpho\` and \`morpho-v2\`) that pass the four tests:`
  );
  table(
    [
      "Vault-months that pass the four tests",
      `In ${setName("in_set")}`,
      "Left out as the same book",
      "Their share in that one market",
      "Left out as a wrapper",
      `In ${setName("in_set_vaults_kept")}`
    ],
    [
      [
        String(passing.length),
        String(inside.length),
        String(sameBook.length),
        sameBook.length ? `${percent(Math.min(...inMarket))} to ${percent(Math.max(...inMarket))}` : "\u2014",
        String(wrapper.length),
        String(monthsIn(passing, "in_set_vaults_kept"))
      ]
    ]
  );
}
function sharedExposure(runs) {
  const rows = [];
  const unseen = /* @__PURE__ */ new Set();
  for (const run of runs) {
    const { network, config } = run;
    const monthly = new Map(config.providers.map((provider) => [provider, ruleRows(network, provider)]));
    for (const market of config.providers.filter((provider) => monthly.get(provider)[0].kind === "morpho-market")) {
      const days = run.daily.thesauros_simple;
      if (monthsIn(monthly.get(market), "in_set") === 0)
        unseen.add(config.labels[market]);
      let [direct, through, most, when] = [0, 0, 0, ""];
      for (const day of days) {
        const month = network.months.filter((item) => item <= day.date).pop();
        const own = num(day, column(run, market));
        const via = config.providers.reduce((sum, provider) => {
          const row = monthly.get(provider).find((item) => item.month === month);
          if (!row)
            throw new Error(`${run.name}: ${provider} has no row of the rule for ${day.date}`);
          return provider !== market && row.largest_set_market === monthly.get(market)[0].venue ? sum + num(day, column(run, provider)) * num(row, "largest_set_market_percent") / 100 : sum;
        }, 0);
        direct += own / days.length;
        through += via / days.length;
        if (own + via > most)
          [most, when] = [own + via, day.date];
      }
      rows.push([
        `\`${run.name}\``,
        config.labels[market],
        percent(direct + through, 1),
        percent(direct, 1),
        percent(through, 1),
        // A market the vault never held, itself or through a vault, has no highest day.
        when === "" ? "\u2014" : `${percent(most, 1)} on ${when}`
      ]);
    }
  }
  if (rows.length === 0)
    return;
  say(
    "## 6. Shared exposure",
    "The share of the vault that sat in a single Morpho Blue market, directly and through the vaults that lend into it."
  );
  table(["Run", "Market", "Average", "Of it held directly", "Of it through vaults", "Highest day"], rows);
  say(
    "- Directly: the market's own column of the daily file. Through vaults: each other venue's column times `largest_set_market_percent` of its row in `venue-eligibility.csv` for the month the day falls in, where `largest_set_market` is this market.",
    "- Highest day: the largest sum of the two parts at one day's close, and that day. It is a single close, not a period: the average says how the year went.",
    "- It is an approximation: the look-through is read once a month, at the first reading of the month, and applied to every day of it.",
    "- It is a lower bound where a vault lends into two markets of the set: the table has a vault's share in the one market of the set where it has the most, and only for a market that passes the rule that month.",
    ...unseen.size === 0 ? [] : [
      `- No look-through is read for a market that passes the four tests in no month (${[...unseen].join(
        ", "
      )}): its figure is what the vault held in it directly, and what the vaults of the run lend into it is not counted.`
    ],
    ...rows.some((row) => row[5] === "\u2014") ? ["- \u2014 in the highest day: the vault held nothing in the market on any day, itself or through a vault."] : []
  );
}
function interestByVenue(runs) {
  const rows = [];
  let falls = 0;
  const lost = [];
  for (const run of runs) {
    const days = run.daily.thesauros_simple;
    const { providers, labels } = run.config;
    for (const day of days) {
      const paid = providers.map((provider) => num(day, column(run, provider, "interest")));
      falls += paid.filter((value) => value < 0).length;
      const left = paid.reduce((sum, value) => sum + value, 0) - num(day, "gas_spent_usd") - num(day, "fees_paid");
      if (Math.abs(left - num(day, "daily_yield")) > (providers.length + 3) * 5e-3 + 1e-9)
        throw new Error(`${run.name}: interest less gas and fees is not the yield of ${day.date}`);
    }
    const year = providers.map((provider) => [
      labels[provider],
      days.reduce((sum, day) => sum + num(day, column(run, provider, "interest")), 0)
    ]).sort((a, b) => b[1] - a[1]);
    const all = year.reduce((sum, [, value]) => sum + value, 0);
    lost.push(...year.filter(([, value]) => value < 0).map(([venue]) => `${venue} in \`${run.name}\``));
    for (const [venue, value] of year)
      rows.push([`\`${run.name}\``, venue, usd(value), percent(value / all * 100, 1)]);
    rows.push([`\`${run.name}\``, "All venues", usd(all), percent(100, 1)]);
  }
  say(
    "## 7. Interest by venue",
    "What `thesauros_simple` earned in each venue over the year, before gas and before its fee."
  );
  table(["Run", "Venue", "Interest for the year", "Share of the run's interest"], rows);
  say(
    "- Interest: the sum over the year of the venue's `interest_` column of `thesauros_simple` in `tangem-simulation-daily.csv`: what the venue paid on the position that day, before gas and before the fee. It is the growth of the venue's index between two readings, scaled by the measured ratio of its rate with our deposit to its rate without it and never above that growth. A fall of the index is a negative figure. " + (falls === 0 ? "No venue has one on any day of these runs." : `${falls} venue-days of these runs have one.`),
    "- All venues: their sum. Less the gas of the year it is the yield before the fee of table 1.",
    "- The script stops unless, on every day, the interest of the venues less `gas_spent_usd` and `fees_paid` is `daily_yield`, within the rounding of those columns to the cent.",
    ...lost.length === 0 ? [] : [
      `- A venue that lost over the year has a share below zero (${lost.join(
        ", "
      )}), and the shares of the other venues of that run then add to more than 100%.`
    ]
  );
}
function episodes(runs) {
  const rows = [];
  const minute = (t) => new Date(t * 1e3).toISOString().slice(0, 16).replace("T", " ");
  const fine = (value) => value >= 1e5 ? `$${(value / 1e6).toFixed(2)}M` : usd(value);
  for (const run of runs) {
    const days = run.daily.thesauros_simple;
    const { providers, labels } = run.config;
    const seenOn = looks(run);
    const filed = (day) => num(day, "available_liquidity") / num(day, "total_assets");
    const short = (day) => day !== void 0 && num(day, "available_liquidity") < num(day, "total_assets");
    for (let first = 0; first < days.length; first++) {
      if (!short(days[first]))
        continue;
      let last = first;
      while (short(days[last + 1]))
        last++;
      const span = days.slice(first, last + 1);
      const low = span.reduce((a, b) => filed(b) < filed(a) ? b : a);
      const seen = span.flatMap((day) => seenOn.get(day.date));
      const venues2 = providers.flatMap((provider) => {
        const hits = seen.filter(
          ([reading2, held2]) => held2[labels[provider]] >= rounding(run) && held2[labels[provider]] > free(reading2, provider)
        );
        if (hits.length === 0)
          return [];
        const [reading, held] = hits.reduce((a, b) => free(b[0], provider) < free(a[0], provider) ? b : a);
        const count = new Set(hits.map(([hit]) => hit.t)).size;
        return [
          `${labels[provider]}: at ${count} reading${count === 1 ? "" : "s"}, the lowest ${fine(
            free(reading, provider)
          )} free at ${minute(reading.t)} UTC against ${fine(held[labels[provider]])} held`
        ];
      });
      if (venues2.length === 0)
        throw new Error(`${run.name}: no venue explains the days from ${span[0].date}`);
      rows.push([
        `\`${run.name}\``,
        span[0].date,
        span[span.length - 1].date,
        String(span.length),
        String(span.filter((day) => filed(day) < 0.5).length),
        `${percent(filed(low) * 100)} on ${low.date}`,
        venues2.join("; ")
      ]);
      first = last;
    }
  }
  if (rows.length === 0)
    return;
  say(
    "## 8. Liquidity episodes",
    "The days of `thesauros_simple` on which less than the whole balance could be withdrawn, consecutive days as one episode."
  );
  table(
    [
      "Run",
      "From",
      "To",
      "Days",
      "Of them under half",
      "Lowest share that could be withdrawn",
      "Venues that held more than they had free"
    ],
    rows
  );
  say(
    "- A day counts when `available_liquidity` is under `total_assets` in `tangem-simulation-daily.csv`; the share is one over the other. The days of this table are the days table 2 does not count as whole to the cent.",
    "- Venues: at each reading of `raw.jsonl` on those days the vault's position in a venue, once the movements of that reading are made, is set against the venue's `liquidity` at that reading, and each day's closing position against the first reading after it; that is how `available_liquidity` is taken. A venue is named when its position was above its free liquidity at one of them, with the number of such readings and the one at which it had the least free. Positions are rebuilt as for the largest share in table 2.",
    `- The script stops unless the lowest share so rebuilt for a day, of every day of the year, is within ${percent(
      REBUILT_WITHIN * 100,
      1
    )} of the balance of the share in the daily file.`
  );
}
function balanceAt(run, fee) {
  const days = run.daily.thesauros_simple;
  return days.reduce((balance, day, d) => {
    const paid = run.config.providers.reduce((sum, provider) => sum + num(day, column(run, provider, "interest")), 0);
    const before = d === 0 ? run.config.initial_deposit : num(days[d - 1], "total_assets");
    const gross = (paid - num(day, "gas_spent_usd")) / before;
    return balance * (1 + gross - fee / 100 * Math.max(0, gross));
  }, run.config.initial_deposit);
}
function breakEvenByDay(run) {
  const aave = run.config.initial_deposit + earned(run, "just_aave");
  if (balanceAt(run, 0) <= aave)
    return "none: below Just Aave before any fee";
  if (balanceAt(run, 100) > aave)
    throw new Error(`${run.name}: above Just Aave at a fee of 100%`);
  let [low, high] = [0, 100];
  while (high - low > 1e-3) {
    const middle = (low + high) / 2;
    if (balanceAt(run, middle) > aave)
      low = middle;
    else
      high = middle;
  }
  return percent(low, 1);
}
function feeTable(runs, checks) {
  const own = (run) => run.config.performance_fee_percent;
  const filed = (run) => num(lastDay(run, "thesauros_simple"), "total_assets");
  const gap = (run) => {
    const value = balanceAt(run, own(run)) - filed(run);
    if (!(Math.abs(value) <= 1))
      throw new Error(`${run.name}: its daily returns at its own fee end $${value.toFixed(2)} from its balance`);
    return value;
  };
  const at = (title, balanceOf) => [
    [
      `${title}: balance at the end of the year, and yield`,
      (run) => `${usd(balanceOf(run))} (${percent(ofDeposit(run, balanceOf(run) - run.config.initial_deposit))})`
    ],
    [
      `${title}: against Just Aave`,
      (run) => difference(run, balanceOf(run) - run.config.initial_deposit - earned(run, "just_aave"))
    ]
  ];
  say(
    "## 9. Fee",
    "What `thesauros_simple` would hold at another performance fee, worked out from the daily file of the run."
  );
  perRun(runs, [
    ...FEES.flatMap((percentage) => at(`At a fee of ${percentage}%`, (run) => balanceAt(run, percentage))),
    ["The fee the run was made at", (run) => `${own(run)}%`],
    ...at("At that fee, the run itself", filed),
    [
      "At that fee: the balance worked out less the balance of the run",
      (run) => {
        const value = gap(run);
        return Math.abs(value) < 5e-3 ? "$0.00" : `${value < 0 ? "\u2212" : "+"}$${Math.abs(value).toFixed(2)}`;
      }
    ],
    ["The fee at which the balance worked out is that of Just Aave", breakEvenByDay]
  ]);
  const sameBut = ({ config }) => JSON.stringify({ ...config, performance_fee_percent: 0, output: "" });
  const made = checks.flatMap((check) => {
    const columns = runs.filter((run) => sameBut(run) === sameBut(check));
    if (columns.length === 0)
      throw new Error(`${check.name}: no run given has this config at another fee`);
    return columns.map((run) => {
      const over = balanceAt(run, own(check)) - filed(check);
      return `- \`${check.name}\` is \`${run.name}\` made at a fee of ${own(check)}%, in the output folder \`${check.config.output ?? "simulation"}\`${packFolder(check) === "none" ? "; the pack has its config and no copy of its files" : `; its files are in ${packFolder(check)} of the pack`}. The balance of \`${run.name}\` worked out at ${own(check)}%: ${usd(
        balanceAt(run, own(check))
      )}. The balance of the run made at ${own(check)}%: ${usd(filed(check))}. Worked out less made: ${Math.round(over) === 0 ? usd(0) : signed(over, usd(over))}.`;
    });
  });
  say(
    "- A day's return before the fee: the sum of the `interest_` columns of the day less `gas_spent_usd`, over `total_assets` of the day before, the deposit for the first day. At a fee the balance of a day is the balance of the day before times one plus the return, less the fee's share of the return when it is positive. The year starts on the deposit.",
    "- Yield: the balance less the deposit, in percent of the deposit. Against Just Aave: the same less the yield of Just Aave of table 1.",
    "- At the fee the run was made at the arithmetic is the run itself, so those two rows show `total_assets` of the last day, as table 1 does. The script stops unless the balance worked out at that fee is within $1 of it: the files are in cents, and the row after shows what the rounding leaves.",
    "- At 0% the yield is above the yield before the fee of table 1: that one adds the fees of the year to the yield, without what they would have earned had they stayed in the vault.",
    "- The fee at which the balance is that of Just Aave: found by halving between 0% and 100% on the same arithmetic. The break-even fee of table 1 is its approximation in one line.",
    "- The arithmetic keeps the returns of the run as they are. A run made at another fee differs: with a lower fee the vault is larger, so each venue pays a little less on a larger position and a move is decided on other amounts." + (made.length === 0 ? "" : " The runs below were made at another fee to measure it."),
    ...made
  );
}
function venuesHeld(runs) {
  const held = (run) => run.daily.thesauros_simple.map(
    (day) => run.config.providers.filter((provider) => num(day, column(run, provider)) >= HELD_FROM).length
  );
  if (runs.some((run) => held(run).includes(0)))
    throw new Error("A day has no venue at the share a venue is held from");
  const most = Math.max(...runs.flatMap(held));
  const lone = runs.filter(allocator).flatMap(
    (run) => run.daily.thesauros_simple.flatMap((day) => {
      const venues2 = run.config.providers.filter((provider) => num(day, column(run, provider)) >= HELD_FROM);
      return venues2.length === 1 ? [{ venue: run.config.labels[venues2[0]], entry: venues2[0] === run.config.entry_provider }] : [];
    })
  );
  const alone = new Set(lone.map(({ venue }) => venue));
  const entryOnly = lone.every(({ entry }) => entry);
  const top = (run, providers = run.config.providers) => {
    let best = { share: -1, venue: "", date: "" };
    for (const day of run.daily.thesauros_simple)
      for (const provider of providers) {
        const share = num(day, column(run, provider));
        if (share > best.share)
          best = { share, venue: run.config.labels[provider], date: day.date };
      }
    return `${percent(best.share)} in ${best.venue} on ${best.date}`;
  };
  say("## 10. Venues held", "`thesauros_simple`, at each day's close.");
  perRun(runs, [
    ...Array.from({ length: most }, (_unused, n) => [
      `Days with ${n + 1} venue${n === 0 ? "" : "s"}`,
      (run) => String(held(run).filter((count) => count === n + 1).length)
    ]),
    ["Venues held, mean over the days", (run) => mean(held(run)).toFixed(2)],
    ["Largest share of the vault in one venue", (run) => top(run)],
    ["The most the entry provider held", (run) => top(run, [run.config.entry_provider])]
  ]);
  say(
    `- A venue is held on a day when its column of \`tangem-simulation-daily.csv\` is ${HELD_FROM}% of the vault or more at that day's close. The rows go up to the most venues any run held on one day.`,
    "- Largest share: the highest venue column of the year, with its venue and the first day it is reached. The entry provider is `entry_provider` of the config, where a deposit lands. The allocator does not cap it, so it can hold the whole vault; under the public vault's rules a rebalance caps it as it caps every venue.",
    `- The cap of ${cap(
      runs[0]
    )}% of the vault acts when a rebalance executes: between two rebalances a venue that earns more than the others stands a little above it.`,
    ...alone.size === 0 ? [] : [
      `- The allocator has no minimum of two venues. On the days of an allocator run with one venue, that venue is ${[
        ...alone
      ].join(" or ")}${entryOnly ? ", the entry provider, which it does not cap" : ""}.`
    ]
  );
}
var credited = /* @__PURE__ */ new Map();
function unpayable(run, strategy) {
  const known = credited.get(`${run.name} ${strategy}`);
  if (known)
    return known;
  const days = /* @__PURE__ */ new Map();
  let [interest, all] = [0, 0];
  const seenOn = looks(run, strategy);
  for (const day of run.daily[strategy]) {
    for (const provider of run.config.providers) {
      const venue = run.config.labels[provider];
      const paid = num(day, column(run, provider, "interest"));
      all += paid;
      if (seenOn.get(day.date).some(([reading, held]) => held[venue] >= rounding(run) && held[venue] > free(reading, provider))) {
        interest += paid;
        days.set(venue, (days.get(venue) ?? 0) + 1);
      }
    }
  }
  credited.set(`${run.name} ${strategy}`, { interest, all, days });
  return { interest, all, days };
}
function notWithdrawable(runs) {
  const tally = (counts) => [...counts].sort((a, b) => b[1] - a[1]).map(([venue, count]) => `${venue} ${count}`).join(", ") || "\u2014";
  const rowsOf = (strategy) => [
    [
      `\`${strategy}\`: interest credited on venue-days short of liquidity`,
      (run) => usd(unpayable(run, strategy).interest)
    ],
    [
      `\`${strategy}\`: its share of the interest of the year`,
      (run) => percent(unpayable(run, strategy).interest / unpayable(run, strategy).all * 100, 1)
    ],
    [
      `\`${strategy}\`: such venue-days`,
      (run) => String([...unpayable(run, strategy).days.values()].reduce((sum, count) => sum + count, 0))
    ],
    [`\`${strategy}\`: their venues, with the days of each`, (run) => tally(unpayable(run, strategy).days)]
  ];
  say(
    "## 11. Movements against the source's own free liquidity and interest that could not be withdrawn",
    "What `thesauros_simple` took out of a venue beyond the venue's own free liquidity, and the interest it was credited in a venue on days the venue could not have paid its position out."
  );
  perRun(runs, [
    ["Movements that took out more than the source venue had free without us", (run) => String(aboveFree(run).length)],
    ["Their amount", (run) => usd(aboveFree(run).reduce((sum, move) => sum + num(move, "amount"), 0))],
    [
      "Their sources, with the movements of each",
      (run) => tally(
        aboveFree(run).reduce(
          (counts, move) => counts.set(move.from, (counts.get(move.from) ?? 0) + 1),
          /* @__PURE__ */ new Map()
        )
      )
    ],
    ...rowsOf("thesauros_simple")
  ]);
  say("The same interest for the four controls, which sit in venues through such days too:");
  perRun(runs, STRATEGIES.slice(1).flatMap(rowsOf));
  say(
    "- More than the source had free: the movements of table 2, rows of `tangem-simulation-rebalances.csv` with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid. The run lets such a movement execute: it takes our own deposit to be payable next to that liquidity, in whole with rate impact on and in the liquid share of the venue with it off. Whether the venue would have paid it on chain is not in the history.",
    "- Interest on venue-days short of liquidity: the simulator credits the growth of a venue's index whether or not the venue could have paid the vault out. A venue-day counts when the position in the venue is above the venue's `liquidity` at a reading of `raw.jsonl` on that day, once the movements of that reading are made, or when the day's closing position is above its `liquidity` at the first reading after the close. That is how table 8 names its venues and how `available_liquidity` is taken, so a venue that was short while the vault held it counts whether or not it was still held at the close. The figure is the sum of the venue's `interest_` column over such days. It is the interest of the whole day, the finest the daily file has: the most that was credited while the venue was short, with the hours of such a day on which the venue could have paid in it.",
    "- Share: of the sum of every `interest_` column of the strategy over the year, in which a fall of an index is the negative figure it is. Positions are rebuilt as for the largest share in table 2, and a position under 0.01% of the deposit is not weighed.",
    `- A control is credited the same way, so its yield in table 1 has this interest in it. Its positions are rebuilt from its own days and its own movements in \`tangem-simulation-rebalances.csv\`; \`just_aave\` and \`just_best_vault\` have none. For every strategy the script stops unless the lowest share of the balance so payable on a day is within ${percent(
      REBUILT_WITHIN * 100,
      1
    )} of the balance of \`available_liquidity\` over \`total_assets\` in the daily file.`,
    "- \u2014: no such movement, or no such venue-day."
  );
}
function main() {
  const given = process.argv.slice(2);
  const named = (key) => given.filter((arg) => arg.startsWith(`${key}=`)).map((arg) => arg.slice(key.length + 1));
  const paths = given.filter((arg) => !/^(out|check)=/.test(arg));
  if (paths.length === 0)
    throw new Error("Usage: pack-figures.ts [out=<file>] <config>... [check=<config>]...");
  const runs = paths.map(loadRun);
  const checks = named("check").map(loadRun);
  reworked = runs.some(allocator);
  if (new Set(runs.map((run) => `${cap(run)} ${run.config.initial_deposit}`)).size !== 1 || runs.some((run) => !run.config.risk_guard_enabled))
    throw new Error("The definitions are worded for runs with RiskGuard on, one provider cap and one deposit");
  say(
    "# Figures of the Tangem pack",
    "Written by `reproduce/figures.js` (its source is `reproduce/src/pack-figures.ts`) from the files `reproduce/simulate.js` writes and from `raw.jsonl` and `venue-eligibility.csv` under `reproduce/data/tangem/<network>/`. Do not edit: run the script again.",
    "A run is named by its config: `base.deployed` is `config.base.deployed.json`. `simulate.js` writes the files of a run to the output folder of the table, under `reproduce/data/tangem/<network>/`. The pack has the same files, byte for byte, in the run folder of the table; a run without one is in the pack as its config only."
  );
  table(
    [
      "Run",
      "Config",
      "Network",
      "Output folder of `simulate.js`",
      "Run folder of the pack",
      "Venues",
      "Fee",
      "Rate impact",
      "Limit on our share of a venue",
      "Venue rule"
    ],
    runs.map((run) => [
      `\`${run.name}\``,
      `\`${(0, import_path.basename)(run.path)}\``,
      run.config.network,
      `\`${run.config.output ?? "simulation"}\``,
      packFolder(run),
      run.config.providers.map((provider) => run.config.labels[provider]).join(", "),
      `${run.config.performance_fee_percent}%`,
      run.config.rate_impact_enabled ? "on" : "off",
      run.config.max_share_of_venue_percent === void 0 ? "none" : `${run.config.max_share_of_venue_percent}%`,
      ruleOf(run)
    ])
  );
  say(
    "- Rate impact: `rate_impact_enabled` of the config. On: a position earns the rate the deposit probes measured with it in the venue, and the venue can pay it out next to its own liquidity. Off: the deposit moves no rate, and the venue pays its liquid share of itself with the position in it.",
    `- Limit on our share of a venue: \`max_share_of_venue_percent\` of the config. A venue takes no new money while a full position, ${cap(
      runs[0]
    )}% of the vault, would be more than that share of the venue with the position in it, and what the vault holds there leaves when the decision moves it and the move can execute.${reworked ? " The allocator also keeps what it aims to hold in a venue within that share of it, the entry provider excepted." : ""} The limit is tested when a move is decided: a venue that shrinks under a position the vault cannot take out leaves the vault above it, and the largest share of table 2 is the share the vault reached.`
  );
  result(runs);
  behaviour(runs);
  stress(runs);
  say("## 4. Venues", "Every venue of the runs given.");
  const notes = [...networks.values()].flatMap(
    (network) => venues(
      network,
      runs.filter((run) => run.network === network)
    )
  );
  say(
    "- Contract: the Aave pool, the Comet, the vault or the token; for a single Morpho Blue market, Morpho Blue and the market id.",
    "- Index growth: the last `index` over the first, minus one, raised to a year by the seconds between the two readings. It is what a deposit in the venue earned, a fall of the index included. For a venue whose first reading is later than the first of the window both figures are shown: the growth raised to a year, and the growth between its two readings, which is all a deposit could have earned there.",
    "- Average rate: the mean of `rate` over the readings. With $6M and $10M of ours: the mean of `rateAfter6` and `rateAfter10`, the rate read back after that deposit, over the readings at which the venue took it.",
    "- Size: the lowest and the highest `supplied`. Lowest free liquidity: the lowest `liquidity`.",
    reworked ? `- Months in a set: rows of \`venue-eligibility.csv\` with the column of the set equal to 1: ${Object.entries(
      SETS
    ).map(([name, set]) => `\`${name}\` for ${set}`).join(", ")}.` : "- Months in the set: rows of `venue-eligibility.csv` with `in_set` and with `in_set_vaults_kept` equal to 1.",
    "- Thesauros adapter: yes for a provider of the live vault of the network in the networks library and for a MetaMorpho V1 vault, which the MorphoProvider contract of the live vaults reads; no for a Morpho Vault V2, a single Morpho Blue market, Fluid and Spark sUSDC.",
    ...notes
  );
  say(
    "## 5. The rule",
    `From \`venue-eligibility.csv\`, which has one row for every candidate and month. A mark is a month: \`x\` in the set${reworked ? " the column names" : ""}, \`.\` not.`
  );
  for (const network of networks.values())
    rule(network);
  say(
    `- $100M or more: \`size_usd\` of the month's row. Never in ${setName(
      "in_set"
    )}: no row with \`in_set\` equal to 1.${reworked ? " Such a candidate may be in set A or in set B in some months: the two columns of months say so." : ""}`,
    "- Why: the `reason` column of the reason met most often among the months at $100M or more. Reasons that differ only in a percent are counted as one. Where the percent is the same in all of them the earliest month's wording is shown verbatim; where it differs, its lowest and its highest among those months stand in its place.",
    `- Vault-months: rows of kind \`morpho\` or \`morpho-v2\` with \`test_1\` to \`test_4\` all \`pass\`. In ${setName(
      "in_set"
    )}: \`in_set\` is 1. Same book and wrapper: \`in_set\` is 0 and \`reason\` begins with that word; the share is \`largest_set_market_percent\`. ${reworked ? "In set A" : "With the vaults kept"}: \`in_set_vaults_kept\` is 1.`,
    "- A venue of the runs is named as the runs name it; the other candidates as `venue-eligibility.csv` names them.",
    ...reworked ? [
      "- In set B: `in_set_broad` is 1. Set B is tests 1 to 3 of the rule whatever the collateral, without a venue that holds more than half of its assets through another venue of set B. Each of the three tests has to be `pass`: one that could not be read (`unverified`) keeps a candidate out as a failed one does, and the candidates it alone keeps out are named above. A venue of set B with an empty `provider` passes those tests and is not simulated: the collector has no reader for it."
    ] : []
  );
  sharedExposure(runs);
  interestByVenue(runs);
  episodes(runs);
  feeTable(runs, checks);
  venuesHeld(runs);
  notWithdrawable(runs);
  for (const [header, ...rows] of tables) {
    for (const row of rows) {
      const empty = row.length !== header.length || row.some((cell) => cell === "" || /\b(NaN|undefined|Infinity|null)\b/.test(cell));
      if (empty)
        throw new Error(`A table has a cell that could not be filled: ${row.join(" | ")}`);
    }
    if (rows.length === 0)
      throw new Error(`A table has no rows: ${header.join(" | ")}`);
  }
  const text = out.join("\n");
  (0, import_fs.writeFileSync)((0, import_path.resolve)(named("out")[0] ?? "data/tangem/figures.md"), text);
  process.stdout.write(text);
}
main();
