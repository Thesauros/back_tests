# Figures of the Tangem pack
Written by `reproduce/figures.js` (its source is `reproduce/src/pack-figures.ts`) from the files `reproduce/simulate.js` writes and from `raw.jsonl` and `venue-eligibility.csv` under `reproduce/data/tangem/<network>/`. Do not edit: run the script again.
A run is named by its config: `base.deployed` is `config.base.deployed.json`. `simulate.js` writes the files of a run to the output folder of the table, under `reproduce/data/tangem/<network>/`. The pack has the same files, byte for byte, in the run folder of the table; a run without one is in the pack as its config only.

| Run | Config | Network | Output folder of `simulate.js` | Run folder of the pack | Venues | Fee | Rate impact | Limit on our share of a venue | Venue rule |
|---|---|---|---|---|---|---|---|---|---|
| `ethereum.alloc-a` | `config.ethereum.alloc-a.json` | Ethereum | `simulation-alloc-a` | `ethereum-allocator-set-a/simulation` | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Vault Bridge USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market | 25% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `ethereum.alloc-a.measured` | `config.ethereum.alloc-a.measured.json` | Ethereum | `simulation-alloc-a-measured` | `ethereum-allocator-set-a-measured/simulation` | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Vault Bridge USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market | 25% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `ethereum.alloc-strict` | `config.ethereum.alloc-strict.json` | Ethereum | `simulation-alloc-strict` | `ethereum-allocator-strict-set/simulation` | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Morpho cbBTC market, Morpho WBTC market | 25% | on | 10% | `in_set` of `venue-eligibility.csv` |
| `ethereum.alloc-b` | `config.ethereum.alloc-b.json` | Ethereum | `simulation-alloc-b` | `ethereum-allocator-set-b/simulation` | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Smokehouse USDC, Vault Bridge USDC, Usual Boosted USDC, Gauntlet USDC Frontier, Waterline Reservoir USDC, Hyperithm USDC Apex, 1337 USDC, Adpend USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market, Morpho srUSD market, Morpho mHYPER market, Morpho wsrUSD market, Morpho PAXG market, Morpho sdeUSD market | 25% | on | 10% | `in_set_broad` of `venue-eligibility.csv` without Euler eUSDC-70 and Euler eUSDC-80 |
| `ethereum.alloc-b.measured` | `config.ethereum.alloc-b.measured.json` | Ethereum | `simulation-alloc-b-measured` | `ethereum-allocator-set-b-measured/simulation` | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Smokehouse USDC, Vault Bridge USDC, Usual Boosted USDC, Gauntlet USDC Frontier, Waterline Reservoir USDC, Hyperithm USDC Apex, 1337 USDC, Adpend USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market, Morpho srUSD market, Morpho mHYPER market, Morpho wsrUSD market, Morpho PAXG market, Morpho sdeUSD market | 25% | on | 10% | `in_set_broad` of `venue-eligibility.csv` without Euler eUSDC-70 and Euler eUSDC-80 |
| `ethereum.public-a` | `config.ethereum.public-a.json` | Ethereum | `simulation-public-a` | `ethereum-public-rules-set-a/simulation` | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Vault Bridge USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market | 25% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `ethereum.deployed` | `config.ethereum.deployed.json` | Ethereum | `simulation-deployed` | `ethereum-vault-as-deployed/simulation` | Compound V3, Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Smokehouse USDC | 25% | on | none | none |

- Rate impact: `rate_impact_enabled` of the config. On: a position earns the rate the deposit probes measured with it in the venue, and the venue can pay it out next to its own liquidity. Off: the deposit moves no rate, and the venue pays its liquid share of itself with the position in it.
- Limit on our share of a venue: `max_share_of_venue_percent` of the config. A venue takes no new money while a full position, 60% of the vault, would be more than that share of the venue with the position in it, and what the vault holds there leaves when the decision moves it and the move can execute. The allocator also keeps what it aims to hold in a venue within that share of it, the entry provider excepted. The limit is tested when a move is decided: a venue that shrinks under a position the vault cannot take out leaves the vault above it, and the largest share of table 2 is the share the vault reached.

## 1. Result
Yield for the year on the deposit, in USD and in percent of the deposit.

|  | `ethereum.alloc-a` | `ethereum.alloc-a.measured` | `ethereum.alloc-strict` | `ethereum.alloc-b` | `ethereum.alloc-b.measured` | `ethereum.public-a` | `ethereum.deployed` |
|---|---|---|---|---|---|---|---|
| Decision of Thesauros Simple | allocator, production's constants (1.75 assumed for Fluid fUSDC and Spark Savings sUSDC) | allocator, measured exponents | allocator, production's constants (1.75 assumed for Fluid fUSDC and Spark Savings sUSDC) | allocator, production's constants (1.75 assumed for Fluid fUSDC and Spark Savings sUSDC) | allocator, measured exponents | public vault's rules | public vault's rules |
| Venue set | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | the strict set: `in_set` of `venue-eligibility.csv` | set B: `in_set_broad` of `venue-eligibility.csv` without Euler eUSDC-70 and Euler eUSDC-80 | set B: `in_set_broad` of `venue-eligibility.csv` without Euler eUSDC-70 and Euler eUSDC-80 | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | no rule: the venues of the config, all year |
| Liquidity rule | on | on | on | on | on | on | off |
| Just Aave: all in Aave V3, never moved | $350,663 (3.51%) | $350,663 (3.51%) | $350,663 (3.51%) | $350,663 (3.51%) | $350,663 (3.51%) | $350,663 (3.51%) | $350,663 (3.51%) |
| First split held: the first allocation, never rebalanced, no fee | $348,624 (3.49%) | $353,630 (3.54%) | $334,463 (3.34%) | $280,416 (2.80%) | $281,237 (2.81%) | $341,366 (3.41%) | $441,566 (4.42%) |
| Eligible equal weight: equal parts over the venues allowed, no fee | $368,043 (3.68%) | $368,043 (3.68%) | $368,479 (3.68%) | $394,825 (3.95%) | $394,825 (3.95%) | $368,043 (3.68%) | $387,171 (3.87%) |
| Thesauros Simple before its fee | $406,047 (4.06%) | $409,915 (4.10%) | $404,683 (4.05%) | $266,204 (2.66%) | $270,856 (2.71%) | $399,728 (4.00%) | $449,938 (4.50%) |
| Choosing by rate added, against first split held | +$57,423 (+0.57 pp) | +$56,284 (+0.56 pp) | +$70,220 (+0.70 pp) | −$14,212 (−0.14 pp) | −$10,381 (−0.10 pp) | +$58,362 (+0.58 pp) | +$8,372 (+0.08 pp) |
| Choosing by rate added, against eligible equal weight | +$38,004 (+0.38 pp) | +$41,872 (+0.42 pp) | +$36,204 (+0.36 pp) | −$128,621 (−1.29 pp) | −$123,969 (−1.24 pp) | +$31,685 (+0.32 pp) | +$62,767 (+0.63 pp) |
| Months ahead of eligible equal weight, before the fee: months from the 7th to the 6th | 11 of 12 | 12 of 12 | 11 of 12 | 10 of 12 | 10 of 12 | 11 of 12 | 12 of 12 |
| Months ahead of eligible equal weight, before the fee: calendar months | 12 of 13 | 13 of 13 | 12 of 13 | 10 of 13 | 10 of 13 | 11 of 13 | 13 of 13 |
| Performance fee | $101,512 (25% of each positive day) | $102,479 (25% of each positive day) | $101,171 (25% of each positive day) | $119,885 (25% of each positive day) | $121,054 (25% of each positive day) | $99,932 (25% of each positive day) | $112,485 (25% of each positive day) |
| Thesauros Simple after its fee | $304,535 (3.05%) | $307,436 (3.07%) | $303,512 (3.04%) | $146,319 (1.46%) | $149,802 (1.50%) | $299,796 (3.00%) | $337,454 (3.37%) |
| Just Best Vault: all in the venue with the highest rate on day one | $328,922 (3.29%) | $328,922 (3.29%) | $328,922 (3.29%) | $137,109 (1.37%) | $137,109 (1.37%) | $328,922 (3.29%) | $484,853 (4.85%) |
| The venue Just Best Vault picked | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho mHYPER market | Morpho mHYPER market | Morpho cbBTC market | Smokehouse USDC |
| Thesauros Simple after its fee, against Just Aave | −$46,128 (−0.46 pp) | −$43,227 (−0.43 pp) | −$47,151 (−0.47 pp) | −$204,344 (−2.04 pp) | −$200,861 (−2.01 pp) | −$50,867 (−0.51 pp) | −$13,209 (−0.13 pp) |
| After its fee, against first split held | −$44,089 (−0.44 pp) | −$46,194 (−0.46 pp) | −$30,951 (−0.31 pp) | −$134,097 (−1.34 pp) | −$131,435 (−1.31 pp) | −$41,570 (−0.42 pp) | −$104,113 (−1.04 pp) |
| After its fee, against eligible equal weight | −$63,508 (−0.64 pp) | −$60,607 (−0.61 pp) | −$64,967 (−0.65 pp) | −$248,506 (−2.49 pp) | −$245,023 (−2.45 pp) | −$68,247 (−0.68 pp) | −$49,717 (−0.50 pp) |
| Break-even fee: the fee at which Thesauros Simple equals Just Aave | about 14% | about 14% | about 13% | none: below Just Aave before any fee | none: below Just Aave before any fee | about 12% | about 22% |

- A yield is `total_assets` of the last day of `tangem-simulation-daily.csv` minus the deposit.
- Before its fee: the yield of `thesauros_simple` plus the sum of its `fees_paid`. The fee is that sum.
- Choosing by rate added: the yield before the fee minus the yield of the control. `first_split_held` keeps a venue that later leaves the set, so under a venue rule its difference also carries what the rule costs; `eligible_equal_weight` follows the rule.
- Months ahead: a month counts when the sum of `daily_yield` and `fees_paid` of `thesauros_simple` over its days is above the sum of `daily_yield` of `eligible_equal_weight`. It is counted two ways, and each cell says of how many: by the months of the venue rule, which run from the 7th to the 6th, and by the calendar months the year touches, of which the first and the last are touched in part.
- After its fee, against a control: the yield of `thesauros_simple` minus the yield of the control, which pays no Thesauros fee.
- The venue of Just Best Vault is the venue column that is 100 on its first day.
- Break-even fee: (yield before the fee − yield of Just Aave) / yield before the fee, to the whole percent. It is an approximation: the fee is charged on each positive day and the balance compounds, which the formula leaves out.
- Decision: `policy` and `impact_exponent` of the config. The public vault's rules are the decision of the vault as deployed, with RiskGuard's rules around it: at most 60% of the vault in a venue, at least two venues, the circuit breaker, the anomaly gate and the cooldown. The allocator is the water-filling step of the Thesauros cross-chain planner, which is not live for the public vaults. It prices the vault's own deposit in each venue with the exponent production has for the venue's protocol: 2 for Aave V3 and Compound V3, 1.75 for Morpho, which a Morpho Vault V2 and a single Morpho Blue market also take. Production has no exponent for Fluid fUSDC and Spark Savings sUSDC: where a run takes production's exponent it gives them 1.75, an assumption. With measured exponents it is the exponent that reproduces the $10M deposit probe of the reading; a reading that measures none leaves the venue's last one, and the constant before the first. Of RiskGuard's rules the allocator runs keep one, by choice: at most 60% of the vault in a venue, the entry provider excepted, which has no limit. They apply no minimum of two venues, no circuit breaker, no anomaly gate and no cooldown: the planner's step has none of them.
- Venue set: the column of `venue-eligibility.csv` the `eligible_periods` of the config are, as in the table of the runs. `in_set` is the strict set, `in_set_vaults_kept` is set A, `in_set_broad` is set B of `PROGRAMME.md`.
- Liquidity rule: `liquidity_rule` of the config. On: a venue whose own free liquidity at a reading is below a full position of the vault, 60% of the vault at that reading, takes no new money at that reading.
- Just Best Vault takes the venue with the highest `rate` at the first reading among the venues that are in the set that day and accept the whole deposit. The liquidity rule and the limit on our share of a venue do not bind it, nor Just Aave: they bind `thesauros_simple`, `first_split_held` up to its first rebalance and `eligible_equal_weight`.

## 2. What the vault did
`thesauros_simple` only, except the last four rows: the last five are one a strategy.

|  | `ethereum.alloc-a` | `ethereum.alloc-a.measured` | `ethereum.alloc-strict` | `ethereum.alloc-b` | `ethereum.alloc-b.measured` | `ethereum.public-a` | `ethereum.deployed` |
|---|---|---|---|---|---|---|---|
| Rebalances (transactions) | 232 | 181 | 245 | 194 | 163 | 521 | 219 |
| Movements of funds | 783 | 634 | 669 | 637 | 542 | 1292 | 442 |
| Movements a rebalance, mean | 3.38 | 3.50 | 2.73 | 3.28 | 3.33 | 2.48 | 2.02 |
| Rebalances that reverse the previous one within 24 hours | 113 | 67 | 131 | 89 | 61 | 320 | 125 |
| The same, counting movements of any size | 114 | 67 | 134 | 89 | 61 | 336 | 126 |
| Of the rebalances that reverse the previous one, counting movements of at least $10,000: those that send back under half of what it moved | 23 | 10 | 26 | 14 | 9 | 118 | 15 |
| Rebalances after which the vault's rate was lower than before | 74 | 39 | 84 | 59 | 33 | 199 | 80 |
| Rebalances a decision priced | 227 | 177 | 242 | 183 | 154 | 519 | 219 |
| Of them, the vault's rate was lower after the move | 72 | 37 | 82 | 53 | 28 | 198 | 80 |
| Of them, the realized change was under the gain the move had to expect: 0.25 pp under the public vault's rules, 0.05 pp for the allocator | 84 | 42 | 95 | 60 | 32 | 335 | 112 |
| Of them, the realized change was under the expected gain | 154 | 93 | 167 | 125 | 81 | 482 | 183 |
| Mean expected gain of the priced rebalances | 0.51 pp | 0.41 pp | 0.47 pp | 0.50 pp | 0.40 pp | 0.58 pp | 0.55 pp |
| Mean realized change of the priced rebalances | 0.19 pp | 0.26 pp | 0.15 pp | 0.27 pp | 0.32 pp | 0.14 pp | 0.22 pp |
| Rebalances that take a venue back under the provider cap, which no gain decided | 2 | 2 | 3 | 2 | 1 | 0 | 0 |
| Movements that are forced exits | 5 | 2 | 0 | 16 | 16 | 2 | 0 |
| Movements sent in the transaction of a forced exit | 9 | 8 | 0 | 19 | 16 | 3 | 0 |
| Movements that took out more than the source venue had free without us | 0 | 0 | 0 | 4 | 3 | 0 | 0 |
| Movements under $1,000 | 46 | 48 | 60 | 48 | 43 | 244 | 122 |
| Movements whose gas cost was above the amount moved | 0 | 0 | 0 | 0 | 0 | 13 | 1 |
| Legs refused | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| Gas for the year | $716 | $724 | $609 | $609 | $672 | $1,844 | $475 |
| Gas for the year, as the daily file has it | $716 | $724 | $609 | $609 | $672 | $1,844 | $475 |
| Days on which the whole balance could be withdrawn, to the cent | 358 of 365 | 359 of 365 | 358 of 365 | 348 of 365 | 351 of 365 | 358 of 365 | 346 of 365 |
| Days on which the whole balance could be withdrawn, within 0.01% of the balance | 358 of 365 | 359 of 365 | 358 of 365 | 348 of 365 | 351 of 365 | 358 of 365 | 346 of 365 |
| Days on which less than half could be withdrawn | 1 of 365 | 1 of 365 | 1 of 365 | 6 of 365 | 5 of 365 | 1 of 365 | 7 of 365 |
| Largest share of a venue we would have been | 5.7% of Fluid fUSDC on 2026-06-06 | 5.7% of Fluid fUSDC on 2026-06-06 | 5.7% of Fluid fUSDC on 2026-06-06 | 20.4% of Morpho mHYPER market on 2025-11-06 | 16.0% of Morpho mHYPER market on 2025-11-06 | 6.3% of Steakhouse Prime USDC V2 on 2026-08-19 | 32.6% of Smokehouse USDC on 2026-10-03 |
| Average share of the vault per venue | Spark Savings sUSDC 28.4%, Fluid fUSDC 28.1%, Morpho cbBTC market 12.8%, Aave V3 9.3%, Morpho WBTC market 7.0%, Compound V3 5.0%, Steakhouse USDC 4.9%, Gauntlet USDC Prime 3.4%, Steakhouse Prime USDC V2 0.7%, Gauntlet USDC Prime V2 0.4%, Vault Bridge USDC 0.0% | Spark Savings sUSDC 33.8%, Fluid fUSDC 28.1%, Morpho cbBTC market 9.7%, Aave V3 9.1%, Steakhouse USDC 5.0%, Morpho WBTC market 4.9%, Gauntlet USDC Prime 4.2%, Compound V3 3.6%, Steakhouse Prime USDC V2 1.1%, Gauntlet USDC Prime V2 0.4%, Vault Bridge USDC 0.1% | Spark Savings sUSDC 30.3%, Fluid fUSDC 28.5%, Morpho cbBTC market 17.3%, Aave V3 9.7%, Morpho WBTC market 7.8%, Compound V3 4.7%, Steakhouse USDC 1.7% | Fluid fUSDC 23.7%, Spark Savings sUSDC 18.9%, Morpho cbBTC market 10.3%, Gauntlet USDC Frontier 8.7%, Smokehouse USDC 8.6%, Aave V3 6.5%, Morpho WBTC market 5.6%, Morpho mHYPER market 4.6%, Hyperithm USDC Apex 3.2%, Compound V3 2.6%, Steakhouse USDC 2.4%, Gauntlet USDC Prime 1.1%, Usual Boosted USDC 1.1%, Morpho wsrUSD market 0.8%, Waterline Reservoir USDC 0.7%, Steakhouse Prime USDC V2 0.6%, Gauntlet USDC Prime V2 0.4%, Morpho srUSD market 0.1%, Vault Bridge USDC 0.0%, 1337 USDC 0.0%, Adpend USDC 0.0%, Morpho PAXG market 0.0%, Morpho sdeUSD market 0.0% | Fluid fUSDC 23.6%, Spark Savings sUSDC 23.0%, Gauntlet USDC Frontier 9.2%, Smokehouse USDC 8.6%, Morpho cbBTC market 7.6%, Aave V3 5.7%, Morpho mHYPER market 4.4%, Morpho WBTC market 4.2%, Hyperithm USDC Apex 3.7%, Steakhouse USDC 2.6%, Compound V3 2.2%, Gauntlet USDC Prime 1.2%, Steakhouse Prime USDC V2 1.1%, Usual Boosted USDC 1.1%, Morpho wsrUSD market 0.8%, Waterline Reservoir USDC 0.7%, Gauntlet USDC Prime V2 0.4%, Morpho srUSD market 0.1%, Vault Bridge USDC 0.0%, 1337 USDC 0.0%, Adpend USDC 0.0%, Morpho PAXG market 0.0%, Morpho sdeUSD market 0.0% | Fluid fUSDC 30.4%, Spark Savings sUSDC 27.5%, Morpho cbBTC market 9.4%, Aave V3 8.2%, Morpho WBTC market 7.6%, Steakhouse USDC 7.2%, Compound V3 3.5%, Gauntlet USDC Prime 3.2%, Steakhouse Prime USDC V2 1.8%, Gauntlet USDC Prime V2 1.4%, Vault Bridge USDC 0.0% | Smokehouse USDC 58.8%, Gauntlet USDC Prime 19.2%, Aave V3 9.5%, Steakhouse USDC 9.0%, Compound V3 3.5% |
| Outside the set: `thesauros_simple` | 0 | 0 | 0 | 0 | 0 | 0 | no rule in this run |
| Outside the set: `first_split_held` | 273 venue-days on 181 days, up to 46.10% of the balance | 273 venue-days on 181 days, up to 62.55% of the balance | 59 venue-days on 59 days, up to 40.01% of the balance | 668 venue-days on 334 days, up to 100.00% of the balance | 668 venue-days on 334 days, up to 100.00% of the balance | 92 venue-days on 92 days, up to 40.03% of the balance | no rule in this run |
| Outside the set: `eligible_equal_weight` | 0 | 0 | 0 | 0 | 0 | 0 | no rule in this run |
| Outside the set: `just_aave` | 0 | 0 | 0 | 0 | 0 | 0 | no rule in this run |
| Outside the set: `just_best_vault` | 0 | 0 | 0 | 334 venue-days on 334 days, up to 100.00% of the balance | 334 venue-days on 334 days, up to 100.00% of the balance | 0 | no rule in this run |

- Rebalances: distinct `tx` of `tangem-simulation-rebalances.csv`; movements: its rows.
- Reverses the previous one: the rebalance comes at most 24 hours after the one before it and has a movement of at least $10,000 from B to A where the one before had a movement of at least $10,000 from A to B. Smaller movements are left out: a rebalance of the public vault's rules evens out positions by a few dollars next to its main movements, and such a remainder running the other way is not money sent back. The next row counts them too.
- Under half of what it moved: one movement running back is enough for a rebalance to count as reversing the previous one, so it need not undo it. What a rebalance sends back is its movements of at least $10,000 along a path the previous one used the other way with a movement of at least $10,000, each up to what the previous one sent along that path. The row counts the rebalances of the first of the two rows above that send back under half of all the previous one moved.
- Rate lower than before: `realized_change_pp` below zero, counted once a transaction.
- A decision priced: the rebalance has an `expected_gain_pp` and is no move back under the provider cap. Under the public vault's rules the decision compared the rates as they stood before the move and expected at least 0.25 pp a year. The allocator priced the vault's own deposit in each venue and expected at least 0.05 pp of the vault a year, from a plan that fills the same venues and drains the same venues, by at least $1,000 each, at 2 readings in a row, which are 4 hours apart in this history; the amounts may differ between the readings. In both `realized_change_pp` is the vault's rate with our positions in place after the move less the same before it. No decision priced a rebalance without an `expected_gain_pp`: in these runs the `reason` of its movements is "forced exit: the venue is not in the set" or "forced exit: the venue is too small for a full position" or "moved in the transaction of a forced exit". The five rows that follow count the priced ones only, one value a transaction; the means are over them.
- Back under the provider cap: rebalances whose `reason` begins with "back under the provider cap". Only the allocator makes them: a venue other than its entry provider that has grown above the cap gives up the excess whatever the move earns. Such a rebalance has an `expected_gain_pp`: what the allocator expects the move to change, which may be a loss, and not a gain it had to reach. So it is not counted as priced. The public vault's rules apply the cap inside every rebalance and have no such move.
- Forced exits: movements whose `reason` begins with "forced exit": they leave a venue the decision read as paying nothing, and the `reason` says why. Sent in the transaction of a forced exit: the other movements of that transaction, by their `reason`. Movements a rebalance: the movements over the rebalances.
- More than the source had free: rows with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid.
- Movements under $1,000: rows with `amount` below it. A rebalance of the public vault's rules evens out positions by such remainders next to its main movements. A plan of the allocator that a gain decided has no movement under $10 and moves at least $1,000 in all, and the script stops on one that does not: the allocator's movements under $1,000 are parts of such a plan, or of the transaction of a forced exit. Gas above the amount: rows with `gas_cost_usd` above `amount`.
- Legs refused: the sum of `rebalances_refused` of the daily file.
- A plan with a leg that cannot execute is refused whole, and every leg of it is counted, at each reading at which it is refused: the vault sends the legs of a rebalance in one transaction, which reverts when one of them does.
- Gas for the year: the sum of `gas_cost_usd` of the movements in `tangem-simulation-rebalances.csv`, which has four decimals. As the daily file has it: the sum of `gas_spent_usd` of `thesauros_simple` in `tangem-simulation-daily.csv`, which is rounded to the cent each day. The two differ by the rounding of the two columns and by nothing else: the script stops if they are further apart than that rounding allows.
- Whole balance, to the cent: days with `available_liquidity` at least `total_assets`. Within 0.01%: at least 99.99% of `total_assets`. Less than half: `available_liquidity` below half of `total_assets`.
- Largest share of a venue: at every reading of `raw.jsonl` the vault holds one position as the reading is taken and another once the movements of that reading are made. Each is divided by the venue's `supplied` at that reading plus the position, and the largest of all is shown. A position is the venue's share of `total_assets` at the day's close less what the later movements of that day brought into it. Interest of the hours between is left out; the script stops unless the positions so rebuilt for the start of a day are within 0.1% of the balance of the close before. A fall of a venue's index is in the close and in no movement, so for that check it is added back to the venue: the daily file has it as the venue's negative interest of the day.
- A position under 0.01% of the deposit, $1,000, is not weighed in the largest share, nor in tables 8 and 11: the venue columns of the daily file have two decimals, and less than that is their rounding.
- Average share: the mean of the venue column over the days.
- Outside the set: a venue-day is a day on which a venue's column is above zero outside its `eligible_periods` in the config; the days are those with `outside_set_percent` above zero. The columns have two decimals, so a position under 0.005% of the balance does not show.

## 3. Stress
Straight from `tangem-stress-tests.csv`.

|  | `ethereum.alloc-a` | `ethereum.alloc-a.measured` | `ethereum.alloc-strict` | `ethereum.alloc-b` | `ethereum.alloc-b.measured` | `ethereum.public-a` | `ethereum.deployed` |
|---|---|---|---|---|---|---|---|
| First day of every scenario | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 |
| `no_stress`: venue hit | — | — | — | — | — | — | — |
| `no_stress`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `no_stress`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `no_stress`: balance at year end | $10,304,535 | $10,307,436 | $10,303,512 | $10,146,319 | $10,149,802 | $10,299,796 | $10,337,454 |
| `depeg`: venue hit | — | — | — | — | — | — | — |
| `depeg`: largest loss | $506,737 (4.99%) | $506,780 (4.99%) | $506,719 (4.99%) | $498,859 (4.99%) | $498,941 (4.99%) | $506,656 (4.99%) | $507,945 (4.99%) |
| `depeg`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `depeg`: balance at year end | $10,304,535 | $10,307,436 | $10,303,512 | $10,146,319 | $10,149,802 | $10,299,796 | $10,337,454 |
| `depeg`: balance at year end, against `no_stress` | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| `curator_bad_debt`: venue hit | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Smokehouse USDC |
| `curator_bad_debt`: largest loss | $607,954 (5.99%) | $607,993 (5.99%) | $607,932 (5.99%) | $598,490 (5.99%) | $598,577 (5.99%) | $607,947 (5.99%) | $609,500 (5.99%) |
| `curator_bad_debt`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `curator_bad_debt`: balance at year end | $9,687,187 | $9,690,102 | $9,686,197 | $9,538,305 | $9,542,054 | $9,682,662 | $9,717,768 |
| `curator_bad_debt`: balance at year end, against `no_stress` | −$617,348 | −$617,334 | −$617,315 | −$608,014 | −$607,748 | −$617,133 | −$619,686 |
| `protocol_hack`: venue hit | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Smokehouse USDC |
| `protocol_hack`: largest loss | $6,087,669 (59.99%) | $6,088,063 (59.99%) | $6,087,455 (59.99%) | $5,993,449 (59.99%) | $5,994,313 (59.99%) | $6,087,606 (60.00%) | $6,103,200 (60.00%) |
| `protocol_hack`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `protocol_hack`: balance at year end | $4,126,615 | $4,127,320 | $4,126,186 | $4,063,805 | $4,064,713 | $4,124,240 | $4,127,860 |
| `protocol_hack`: balance at year end, against `no_stress` | −$6,177,920 | −$6,180,116 | −$6,177,326 | −$6,082,514 | −$6,085,089 | −$6,175,556 | −$6,209,594 |
| `withdrawal_freeze`: venue hit | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Smokehouse USDC |
| `withdrawal_freeze`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `withdrawal_freeze`: days until everything can be withdrawn | 30 | 30 | 30 | 30 | 30 | 30 | 30 |
| `withdrawal_freeze`: balance at year end | $10,301,710 | $10,304,081 | $10,300,880 | $10,142,395 | $10,145,687 | $10,297,976 | $10,336,371 |
| `withdrawal_freeze`: balance at year end, against `no_stress` | −$2,825 | −$3,355 | −$2,632 | −$3,924 | −$4,114 | −$1,820 | −$1,083 |

- Columns `provider_hit`, `max_loss_usd` and `max_loss_percent` (against the value on the day before the event), `time_to_exit_days`, `final_balance_usd`, `final_balance_vs_no_stress_usd`. The depeg loss and balance are in USD value; the others in USDC.
- Against `no_stress`: `final_balance_vs_no_stress_usd`, the balance at year end less the balance of the run without the event.
- The scenarios, by `stress` of the config: `depeg` values a USDC at $0.95 for 14 days and hits no venue (—); `curator_bad_debt` takes 10% of the position in the venue hit; `protocol_hack` takes 100% of it, and the venue pays nothing afterwards; `withdrawal_freeze` lets nothing out of the venue hit for 30 days.
- Venue hit: `provider_hit`, the venue `provider` of the scenario names in the config, taken on the first day: `largest` is the venue with the vault's largest position that day, `largest_morpho` the largest among the curated Morpho vaults. `curator_bad_debt` takes `largest` in `ethereum.alloc-a`, `ethereum.alloc-a.measured`, `ethereum.alloc-strict`, `ethereum.alloc-b`, `ethereum.alloc-b.measured`, `ethereum.public-a` and `largest_morpho` in `ethereum.deployed`; `protocol_hack` takes `largest` in every run; `withdrawal_freeze` takes `largest` in every run.
- `curator_bad_debt` hits a venue that has no curator in `ethereum.alloc-a` (Spark Savings sUSDC), `ethereum.alloc-a.measured` (Spark Savings sUSDC), `ethereum.alloc-strict` (Spark Savings sUSDC), `ethereum.alloc-b` (Spark Savings sUSDC), `ethereum.alloc-b.measured` (Spark Savings sUSDC), `ethereum.public-a` (Spark Savings sUSDC): there it is the loss of 10% of the vault's largest position, whatever the venue is.

## 4. Venues
Every venue of the runs given.

Ethereum, over the 2180 readings of `raw.jsonl`:

| Venue | Contract | Index growth over the year | Average rate | With $6M of ours | With $10M of ours | Size | Lowest free liquidity | Months in the strict set | Months in set A | Months in set B | Thesauros adapter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Aave V3 | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | 3.58% | 3.53% | 3.49% | 3.46% | $1.8B to $6.1B | $6,402 | 12 of 12 | 12 of 12 | 12 of 12 | yes: a provider of the live vault |
| Compound V3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | 3.57% | 3.51% | 3.04% | 2.99% | $326M to $580M | $4.6M | 12 of 12 | 12 of 12 | 12 of 12 | yes: a provider of the live vault |
| Fluid fUSDC | `0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33` | 4.29% | 4.19% | 3.78% | 3.59% | $101M to $388M | $0 | 12 of 12 | 12 of 12 | 12 of 12 | no: needs a new adapter (Fluid) |
| Spark Savings sUSDC | `0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE` | 3.88% | 3.81% | 3.81% | 3.81% | $120M to $1.4B | $2.0B | 12 of 12 | 12 of 12 | 12 of 12 | no: needs a new adapter (Spark sUSDC) |
| Steakhouse USDC | `0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB` | 3.62% | 3.63% | 3.46% | 3.40% | $63M to $511M | $8.4M | 2 of 12 | 9 of 12 | 9 of 12 | yes: a provider of the live vault |
| Gauntlet USDC Prime | `0xdd0f28e19C1780eb6396170735D45153D261490d` | 3.69% | 3.70% | 3.49% | 3.43% | $22M to $211M | $8.4M | 0 of 12 | 8 of 12 | 8 of 12 | yes: a provider of the live vault |
| Vault Bridge USDC | `0xBEefb9f61CC44895d8AEc381373555a64191A9c4` | 3.52% | 3.54% | 3.29% | 3.22% | $10M to $227M | $7.3M | 0 of 12 | 1 of 12 | 1 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Gauntlet USDC Prime V2 | `0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0` | 3.70% | 3.71% | 3.48% | 3.42% | $1 to $119M | $1 | 0 of 12 | 1 of 12 | 1 of 12 | no: needs a new adapter (Morpho Vault V2) |
| Steakhouse Prime USDC V2 | `0xbeef088055857739C12CD3765F20b7679Def0f51` | 3.68% a year; 3.46% from 2025-10-27 to 2026-10-07: the venue has no reading before | 3.67% | 3.42% | 3.35% | $0 to $134M | $0 | 0 of 12 | 1 of 12 | 1 of 12 | no: needs a new adapter (Morpho Vault V2) |
| Morpho cbBTC market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64` | 3.69% | 3.71% | 3.38% | 3.30% | $210M to $555M | $4.7M | 12 of 12 | 12 of 12 | 12 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Morpho WBTC market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49` | 3.72% | 3.72% | 3.22% | 3.06% | $82M to $221M | $1.4M | 10 of 12 | 10 of 12 | 10 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Smokehouse USDC | `0xBEeFFF209270748ddd194831b3fa287a5386f5bC` | 5.42% | 5.48% | 5.10% (deposit refused at 4 readings) | 4.91% (deposit refused at 4 readings) | $13M to $313M | $9,530 | 0 of 12 | 0 of 12 | 3 of 12 | yes: a provider of the live vault |
| Usual Boosted USDC | `0xd63070114470f685b75B74D60EEc7c1113d33a3D` | 1.39% | 6.01% | 3.34% (deposit refused at 131 readings) | 2.80% (deposit refused at 131 readings) | $2.0M to $336M | $0 | 0 of 12 | 0 of 12 | 2 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Gauntlet USDC Frontier | `0xc582F04d8a82795aa2Ff9c8bb4c1c889fe7b754e` | 3.43% | 4.31% | 5.59% (deposit refused at 1186 readings) | 5.42% (deposit refused at 1186 readings) | $1.9M to $202M | $0 | 0 of 12 | 0 of 12 | 3 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Waterline Reservoir USDC | `0xbeEF346d7099865208Ff331e4f648f4154DDAa05` | 4.98% a year; 4.58% from 2025-11-04 to 2026-10-07: the venue has no reading before | 5.09% | 3.21% (deposit refused at 765 readings) | 2.76% (deposit refused at 765 readings) | $1 to $134M | $0 | 0 of 12 | 0 of 12 | 1 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Hyperithm USDC Apex | `0x777791C4d6DC2CE140D00D2828a7C93503c67777` | 6.97% | 7.12% | 4.20% (deposit refused at 5 readings) | 3.59% (deposit refused at 5 readings) | $1.5M to $237M | $0 | 0 of 12 | 0 of 12 | 1 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| 1337 USDC | `0x94643e86aa5E38DDAc6c7791C1297f4E40cD96c1` | 150564.20% a year; 103229.14% from 2025-10-25 to 2026-10-07: the venue has no reading before | 11495.25% | 6225.53% (deposit refused at 5 readings) | 9.34% (deposit refused at 2044 readings) | $0.2M to $247M | $0 | 0 of 12 | 0 of 12 | 1 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Adpend USDC | `0x55555815a5595991C3A0Ff119B59AEF6C8B55555` | 50510.13% | 5451.29% | 8.83% (deposit refused at 1942 readings) | 7.45% (deposit refused at 1942 readings) | $0.5M to $463M | $0 | 0 of 12 | 0 of 12 | 2 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Morpho srUSD market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0xbfed072faee09b963949defcdb91094465c34c6c62d798b906274ef3563c9cac` | 2.62% | 2.77% | 0.69% | 0.62% | $80,063 to $327M | $0 | 0 of 12 | 0 of 12 | 1 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Morpho mHYPER market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x95c28d447950ca6c8bbfd25fc05b80b1fd7a1cdd17a3610b4b3f1ffc8dc2e2ed` | 7.53% | 7.67% | 1.79% | 1.43% | $21,142 to $142M | $0 | 0 of 12 | 0 of 12 | 1 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Morpho wsrUSD market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x1590cb22d797e226df92ebc6e0153427e207299916e7e4e53461389ad68272fb` | 4.10% a year; 3.03% from 2026-01-08 to 2026-10-07: the venue has no reading before | 4.13% | 2.59% | 2.18% | $1 to $134M | $0 | 0 of 12 | 0 of 12 | 1 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Morpho PAXG market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9` | 82892.30% | 12528.94% | 6848.62% | 6022.97% | $16M to $13.5B | $0 | 0 of 12 | 0 of 12 | 7 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Morpho sdeUSD market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x0f9563442d64ab3bd3bcb27058db0b0d4046a4c46f0acd811dacae9551d2b129` | 103727.86% | 10905.17% | 5815.34% | 5020.52% | $1.4M to $8.9B | $0 | 0 of 12 | 0 of 12 | 5 of 12 | no: needs a new adapter (single Morpho Blue market) |

- Contract: the Aave pool, the Comet, the vault or the token; for a single Morpho Blue market, Morpho Blue and the market id.
- Index growth: the last `index` over the first, minus one, raised to a year by the seconds between the two readings. It is what a deposit in the venue earned, a fall of the index included. For a venue whose first reading is later than the first of the window both figures are shown: the growth raised to a year, and the growth between its two readings, which is all a deposit could have earned there.
- Average rate: the mean of `rate` over the readings. With $6M and $10M of ours: the mean of `rateAfter6` and `rateAfter10`, the rate read back after that deposit, over the readings at which the venue took it.
- Size: the lowest and the highest `supplied`. Lowest free liquidity: the lowest `liquidity`.
- Months in a set: rows of `venue-eligibility.csv` with the column of the set equal to 1: `in_set` for the strict set, `in_set_vaults_kept` for set A, `in_set_broad` for set B.
- Thesauros adapter: yes for a provider of the live vault of the network in the networks library and for a MetaMorpho V1 vault, which the MorphoProvider contract of the live vaults reads; no for a Morpho Vault V2, a single Morpho Blue market, Fluid and Spark sUSDC.
- Spark Savings sUSDC: its free liquidity is the USDC of the Sky PSM the vault redeems through, which is no part of its size. It is above the size at 2,180 of its 2,180 readings.

## 5. The rule
From `venue-eligibility.csv`, which has one row for every candidate and month. A mark is a month: `x` in the set the column names, `.` not.

Ethereum, the set by month, from the month that starts on 2025-10-07 to the one that starts on 2026-09-07:

| Venue | In the strict set | Months | In set A | Months | In set B | Months |
|---|---|---|---|---|---|---|
| Aave V3 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Compound V3 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Fluid fUSDC | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Spark Savings sUSDC | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Steakhouse USDC | `.....xx.....` | 2 | `xxxxxxxxx...` | 9 | `xxxxxxxxx...` | 9 |
| Gauntlet USDC Prime | `............` | 0 | `xxxxxxxx....` | 8 | `xxxxxxxx....` | 8 |
| Smokehouse USDC | `............` | 0 | `............` | 0 | `x.xx........` | 3 |
| Vault Bridge USDC | `............` | 0 | `.....x......` | 1 | `.....x......` | 1 |
| Usual Boosted USDC | `............` | 0 | `............` | 0 | `xx..........` | 2 |
| Gauntlet USDC Frontier | `............` | 0 | `............` | 0 | `...xxx......` | 3 |
| Waterline Reservoir USDC | `............` | 0 | `............` | 0 | `......x.....` | 1 |
| Hyperithm USDC Apex | `............` | 0 | `............` | 0 | `x...........` | 1 |
| 1337 USDC | `............` | 0 | `............` | 0 | `...........x` | 1 |
| Adpend USDC | `............` | 0 | `............` | 0 | `..........xx` | 2 |
| Gauntlet USDC Prime V2 | `............` | 0 | `.........x..` | 1 | `.........x..` | 1 |
| Steakhouse Prime USDC V2 | `............` | 0 | `..........x.` | 1 | `..........x.` | 1 |
| Euler eUSDC-70 | `............` | 0 | `............` | 0 | `.xx..xxx....` | 5 |
| Euler eUSDC-80 | `............` | 0 | `............` | 0 | `...xxxxxx...` | 6 |
| Morpho cbBTC market | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Morpho WBTC market | `xxxx..xxxxxx` | 10 | `xxxx..xxxxxx` | 10 | `xxxx..xxxxxx` | 10 |
| Morpho srUSD market | `............` | 0 | `............` | 0 | `x...........` | 1 |
| Morpho mHYPER market | `............` | 0 | `............` | 0 | `x...........` | 1 |
| Morpho wsrUSD market | `............` | 0 | `............` | 0 | `......x.....` | 1 |
| Morpho PAXG market | `............` | 0 | `............` | 0 | `.....xxxxxxx` | 7 |
| Morpho sdeUSD market | `............` | 0 | `............` | 0 | `.......xxxxx` | 5 |

Ethereum, the venues that are in set B in some month and have no `provider` in `venue-eligibility.csv`, so that no run holds them: Euler eUSDC-70 `.xx..xxx....` (5 months), Euler eUSDC-80 `...xxxxxx...` (6 months).

Ethereum, the candidates at $100M or more that are outside set B in months in which none of tests 1 to 3 failed and one could not be read (`unverified`), which counts as not passed: Wrapped Aave Ethereum USDC (waEthUSDC) `.xxxxxxx....` (7 months; tests 1 and 2 not read; no `provider`, so no run holds it; held through Aave V3, so a wrapper too), Dolomite USDC `....xxxxxxxx` (8 months; test 1 not read; no `provider`, so no run holds it).

Ethereum, the candidates that held $100M or more in at least one month and were never in the strict set:

| Candidate | Kind | Months at $100M or more | Which | Months in set A | Months in set B | Why it was out in those months |
|---|---|---|---|---|---|---|
| Spark Savings USDC v2 (spUSDC) | erc4626 | 10 | `..xxxxxxxxxx` | 0 | 0 | only a buffer is payable on demand: 10% of assets in 2025 and a fixed $10M from January 2026 (the reason of 10 of the 10, as written for 2025-12-07) |
| Gauntlet USDC Prime | morpho | 8 | `xxxxxxxx....` | 8 | 8 | same book: 55.77% to 91.73% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 6 of the 8, with the lowest and the highest figure of those months) |
| Smokehouse USDC | morpho | 3 | `x.xx........` | 0 | 3 | listed collateral 0.0000% to 1.1885% of assets (the reason of 3 of the 3, with the lowest and the highest figure of those months) |
| Vault Bridge USDC | morpho | 1 | `.....x......` | 1 | 1 | same book: 88.82% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 1 of the 1, as written for 2026-03-07) |
| Usual Boosted USDC | morpho | 2 | `xx..........` | 0 | 2 | listed collateral 0.0000% of assets (the reason of 2 of the 2, as written for 2025-10-07) |
| Gauntlet USDC Frontier | morpho | 3 | `...xxx......` | 0 | 3 | listed collateral 0.0054% to 9.0623% of assets (the reason of 3 of the 3, with the lowest and the highest figure of those months) |
| Waterline Reservoir USDC | morpho | 1 | `......x.....` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-04-07) |
| Hyperithm USDC Apex | morpho | 1 | `x...........` | 0 | 1 | listed collateral 0.2541% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| 1337 USDC | morpho | 1 | `...........x` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-09-07) |
| Adpend USDC | morpho | 2 | `..........xx` | 0 | 2 | listed collateral 0.0000% of assets (the reason of 2 of the 2, as written for 2026-08-07) |
| Gauntlet USDC Prime V2 | morpho-v2 | 2 | `.......x.x..` | 1 | 1 | wrapper: 100.00% of assets held through Gauntlet USDC Prime which passes the tests (the reason of 1 of the 2, as written for 2026-05-07) |
| Steakhouse Prime USDC V2 | morpho-v2 | 1 | `..........x.` | 1 | 1 | same book: 92.84% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 1 of the 1, as written for 2026-08-07) |
| Gauntlet USDC Frontier V2 | morpho-v2 | 1 | `....x.......` | 0 | 0 | listed collateral 9.0623% of assets; wrapper: 100.00% of assets held through Gauntlet USDC Frontier which passes tests 1 to 3 (the reason of 1 of the 1, as written for 2026-02-07) |
| Euler eUSDC-70 | euler | 5 | `.xx..xxx....` | 0 | 5 | accepts collateral outside the list: RLUSD sUSDe (the reason of 2 of the 5, as written for 2025-12-07) |
| Euler eUSDC-80 | euler | 6 | `...xxxxxx...` | 0 | 6 | accepts collateral outside the list: PYUSD USDe sUSDe (the reason of 3 of the 6, as written for 2026-01-07) |
| Morpho srUSD market | morpho-market | 1 | `x...........` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| Morpho mHYPER market | morpho-market | 1 | `x...........` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| Morpho wsrUSD market | morpho-market | 1 | `......x.....` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-04-07) |
| Morpho PAXG market | morpho-market | 7 | `.....xxxxxxx` | 0 | 7 | listed collateral 0.0000% of assets (the reason of 7 of the 7, as written for 2026-03-07) |
| Morpho sdeUSD market | morpho-market | 5 | `.......xxxxx` | 0 | 5 | listed collateral 0.0000% of assets (the reason of 5 of the 5, as written for 2026-05-07) |
| Wrapped Aave Ethereum USDC (waEthUSDC) | stata | 7 | `.xxxxxxx....` | 0 | 0 | wrapper: 100.00% of assets held through Aave V3 which passes the tests (the reason of 7 of the 7, as written for 2025-11-07) |
| Dolomite USDC | dolomite | 8 | `....xxxxxxxx` | 0 | 0 | accepts collateral outside the list: USD1 LINK USDT weETH and 12 more (the reason of 6 of the 8, as written for 2026-02-07) |
| Maple Syrup USDC (syrupUSDC) | erc4626 | 12 | `xxxxxxxxxxxx` | 0 | 0 | deposits are permissioned; withdrawals go through a queue (the reason of 12 of the 12, as written for 2025-10-07) |
| Maple High Yield Secured Lending USDC | erc4626 | 3 | `....x.....xx` | 0 | 0 | deposits are permissioned (the reason of 3 of the 3, as written for 2026-02-07) |
| Pareto FalconX USDC credit vault | view | 8 | `....xxxxxxxx` | 0 | 0 | deposits are allow-listed; monthly redemption epochs (the reason of 8 of the 8, as written for 2026-02-07) |
| Midas mHYPER | view | 2 | `xx..........` | 0 | 0 | tokenised fund issued and redeemed by Midas (the reason of 2 of the 2, as written for 2025-10-07) |
| Midas mFONE | view | 6 | `xxxxxx......` | 0 | 0 | tokenised fund issued and redeemed by Midas (the reason of 6 of the 6, as written for 2025-10-07) |
| Midas msyrupUSDp | view | 2 | `xx..........` | 0 | 0 | pre-deposit certificate issued by Midas (the reason of 2 of the 2, as written for 2025-10-07) |
| Re reUSD | view | 9 | `...xxxxxxxxx` | 0 | 0 | mint and redemption are KYC-gated; redemption beyond a buffer goes through a queue (the reason of 9 of the 9, as written for 2026-01-07) |
| Cap cUSD | view | 8 | `xxxxxxxx....` | 0 | 0 | the yield needs a second transaction (the reason of 8 of the 8, as written for 2025-10-07) |
| Almanak alUSD | erc4626 | 3 | `xxx.........` | 0 | 0 | withdrawals are asynchronous requests (the reason of 3 of the 3, as written for 2025-10-07) |
| Stream xUSD | stream | 11 | `.xxxxxxxxxxx` | 0 | 0 | withdrawals are processed in rounds (suspended since November 2025) (the reason of 11 of the 11, as written for 2025-11-07) |

Ethereum, the months of the Morpho vaults (kinds `morpho` and `morpho-v2`) that pass the four tests:

| Vault-months that pass the four tests | In the strict set | Left out as the same book | Their share in that one market | Left out as a wrapper | In set A |
|---|---|---|---|---|---|
| 21 | 2 | 18 | 55.77% to 92.84% | 1 | 20 |

- $100M or more: `size_usd` of the month's row. Never in the strict set: no row with `in_set` equal to 1. Such a candidate may be in set A or in set B in some months: the two columns of months say so.
- Why: the `reason` column of the reason met most often among the months at $100M or more. Reasons that differ only in a percent are counted as one. Where the percent is the same in all of them the earliest month's wording is shown verbatim; where it differs, its lowest and its highest among those months stand in its place.
- Vault-months: rows of kind `morpho` or `morpho-v2` with `test_1` to `test_4` all `pass`. In the strict set: `in_set` is 1. Same book and wrapper: `in_set` is 0 and `reason` begins with that word; the share is `largest_set_market_percent`. In set A: `in_set_vaults_kept` is 1.
- A venue of the runs is named as the runs name it; the other candidates as `venue-eligibility.csv` names them.
- In set B: `in_set_broad` is 1. Set B is tests 1 to 3 of the rule whatever the collateral, without a venue that holds more than half of its assets through another venue of set B. Each of the three tests has to be `pass`: one that could not be read (`unverified`) keeps a candidate out as a failed one does, and the candidates it alone keeps out are named above. A venue of set B with an empty `provider` passes those tests and is not simulated: the collector has no reader for it.

## 6. Shared exposure
The share of the vault that sat in a single Morpho Blue market, directly and through the vaults that lend into it.

| Run | Market | Average | Of it held directly | Of it through vaults | Highest day |
|---|---|---|---|---|---|
| `ethereum.alloc-a` | Morpho cbBTC market | 18.0% | 12.8% | 5.3% | 81.5% on 2026-03-03 |
| `ethereum.alloc-a` | Morpho WBTC market | 8.2% | 7.0% | 1.2% | 60.0% on 2026-09-17 |
| `ethereum.alloc-a.measured` | Morpho cbBTC market | 15.5% | 9.7% | 5.8% | 83.6% on 2026-03-03 |
| `ethereum.alloc-a.measured` | Morpho WBTC market | 6.7% | 4.9% | 1.8% | 48.9% on 2026-06-14 |
| `ethereum.alloc-strict` | Morpho cbBTC market | 17.9% | 17.3% | 0.6% | 73.7% on 2026-04-15 |
| `ethereum.alloc-strict` | Morpho WBTC market | 7.8% | 7.8% | 0.0% | 60.0% on 2026-01-03 |
| `ethereum.alloc-b` | Morpho cbBTC market | 12.5% | 10.3% | 2.2% | 60.0% on 2026-05-25 |
| `ethereum.alloc-b` | Morpho WBTC market | 6.8% | 5.6% | 1.2% | 60.0% on 2026-09-17 |
| `ethereum.alloc-b` | Morpho srUSD market | 0.1% | 0.1% | 0.0% | 27.3% on 2025-11-06 |
| `ethereum.alloc-b` | Morpho mHYPER market | 4.6% | 4.6% | 0.0% | 60.0% on 2025-10-19 |
| `ethereum.alloc-b` | Morpho wsrUSD market | 0.8% | 0.8% | 0.0% | 24.2% on 2026-05-06 |
| `ethereum.alloc-b` | Morpho PAXG market | 0.0% | 0.0% | 0.0% | — |
| `ethereum.alloc-b` | Morpho sdeUSD market | 0.0% | 0.0% | 0.0% | — |
| `ethereum.alloc-b.measured` | Morpho cbBTC market | 10.2% | 7.6% | 2.6% | 58.7% on 2026-04-15 |
| `ethereum.alloc-b.measured` | Morpho WBTC market | 5.7% | 4.2% | 1.5% | 48.9% on 2026-06-14 |
| `ethereum.alloc-b.measured` | Morpho srUSD market | 0.1% | 0.1% | 0.0% | 18.9% on 2025-11-06 |
| `ethereum.alloc-b.measured` | Morpho mHYPER market | 4.4% | 4.4% | 0.0% | 60.0% on 2025-10-22 |
| `ethereum.alloc-b.measured` | Morpho wsrUSD market | 0.8% | 0.8% | 0.0% | 20.0% on 2026-04-18 |
| `ethereum.alloc-b.measured` | Morpho PAXG market | 0.0% | 0.0% | 0.0% | — |
| `ethereum.alloc-b.measured` | Morpho sdeUSD market | 0.0% | 0.0% | 0.0% | — |
| `ethereum.public-a` | Morpho cbBTC market | 15.9% | 9.4% | 6.5% | 95.7% on 2026-08-19 |
| `ethereum.public-a` | Morpho WBTC market | 10.3% | 7.6% | 2.7% | 90.8% on 2026-06-13 |

- Directly: the market's own column of the daily file. Through vaults: each other venue's column times `largest_set_market_percent` of its row in `venue-eligibility.csv` for the month the day falls in, where `largest_set_market` is this market.
- Highest day: the largest sum of the two parts at one day's close, and that day. It is a single close, not a period: the average says how the year went.
- It is an approximation: the look-through is read once a month, at the first reading of the month, and applied to every day of it.
- It is a lower bound where a vault lends into two markets of the set: the table has a vault's share in the one market of the set where it has the most, and only for a market that passes the rule that month.
- No look-through is read for a market that passes the four tests in no month (Morpho srUSD market, Morpho mHYPER market, Morpho wsrUSD market, Morpho PAXG market, Morpho sdeUSD market): its figure is what the vault held in it directly, and what the vaults of the run lend into it is not counted.
- — in the highest day: the vault held nothing in the market on any day, itself or through a vault.

## 7. Interest by venue
What `thesauros_simple` earned in each venue over the year, before gas and before its fee.

| Run | Venue | Interest for the year | Share of the run's interest |
|---|---|---|---|
| `ethereum.alloc-a` | Fluid fUSDC | $126,335 | 31.1% |
| `ethereum.alloc-a` | Spark Savings sUSDC | $113,454 | 27.9% |
| `ethereum.alloc-a` | Morpho cbBTC market | $49,133 | 12.1% |
| `ethereum.alloc-a` | Aave V3 | $39,465 | 9.7% |
| `ethereum.alloc-a` | Morpho WBTC market | $25,737 | 6.3% |
| `ethereum.alloc-a` | Steakhouse USDC | $17,863 | 4.4% |
| `ethereum.alloc-a` | Compound V3 | $17,309 | 4.3% |
| `ethereum.alloc-a` | Gauntlet USDC Prime | $12,979 | 3.2% |
| `ethereum.alloc-a` | Steakhouse Prime USDC V2 | $2,758 | 0.7% |
| `ethereum.alloc-a` | Gauntlet USDC Prime V2 | $1,606 | 0.4% |
| `ethereum.alloc-a` | Vault Bridge USDC | $125 | 0.0% |
| `ethereum.alloc-a` | All venues | $406,763 | 100.0% |
| `ethereum.alloc-a.measured` | Spark Savings sUSDC | $134,947 | 32.9% |
| `ethereum.alloc-a.measured` | Fluid fUSDC | $127,023 | 30.9% |
| `ethereum.alloc-a.measured` | Aave V3 | $38,277 | 9.3% |
| `ethereum.alloc-a.measured` | Morpho cbBTC market | $37,469 | 9.1% |
| `ethereum.alloc-a.measured` | Morpho WBTC market | $20,038 | 4.9% |
| `ethereum.alloc-a.measured` | Steakhouse USDC | $17,992 | 4.4% |
| `ethereum.alloc-a.measured` | Gauntlet USDC Prime | $16,333 | 4.0% |
| `ethereum.alloc-a.measured` | Compound V3 | $12,241 | 3.0% |
| `ethereum.alloc-a.measured` | Steakhouse Prime USDC V2 | $4,468 | 1.1% |
| `ethereum.alloc-a.measured` | Gauntlet USDC Prime V2 | $1,500 | 0.4% |
| `ethereum.alloc-a.measured` | Vault Bridge USDC | $350 | 0.1% |
| `ethereum.alloc-a.measured` | All venues | $410,639 | 100.0% |
| `ethereum.alloc-strict` | Fluid fUSDC | $127,693 | 31.5% |
| `ethereum.alloc-strict` | Spark Savings sUSDC | $120,125 | 29.6% |
| `ethereum.alloc-strict` | Morpho cbBTC market | $63,943 | 15.8% |
| `ethereum.alloc-strict` | Aave V3 | $41,689 | 10.3% |
| `ethereum.alloc-strict` | Morpho WBTC market | $28,758 | 7.1% |
| `ethereum.alloc-strict` | Compound V3 | $17,445 | 4.3% |
| `ethereum.alloc-strict` | Steakhouse USDC | $5,638 | 1.4% |
| `ethereum.alloc-strict` | All venues | $405,292 | 100.0% |
| `ethereum.alloc-b` | Fluid fUSDC | $107,566 | 40.3% |
| `ethereum.alloc-b` | Spark Savings sUSDC | $72,703 | 27.2% |
| `ethereum.alloc-b` | Morpho mHYPER market | $45,412 | 17.0% |
| `ethereum.alloc-b` | Smokehouse USDC | $41,432 | 15.5% |
| `ethereum.alloc-b` | Gauntlet USDC Frontier | $39,563 | 14.8% |
| `ethereum.alloc-b` | Morpho cbBTC market | $39,200 | 14.7% |
| `ethereum.alloc-b` | Hyperithm USDC Apex | $32,903 | 12.3% |
| `ethereum.alloc-b` | Aave V3 | $27,523 | 10.3% |
| `ethereum.alloc-b` | Morpho WBTC market | $20,664 | 7.7% |
| `ethereum.alloc-b` | Compound V3 | $10,466 | 3.9% |
| `ethereum.alloc-b` | Steakhouse USDC | $8,242 | 3.1% |
| `ethereum.alloc-b` | Gauntlet USDC Prime | $4,254 | 1.6% |
| `ethereum.alloc-b` | Morpho wsrUSD market | $3,124 | 1.2% |
| `ethereum.alloc-b` | Waterline Reservoir USDC | $2,504 | 0.9% |
| `ethereum.alloc-b` | Morpho srUSD market | $2,168 | 0.8% |
| `ethereum.alloc-b` | Steakhouse Prime USDC V2 | $2,158 | 0.8% |
| `ethereum.alloc-b` | Gauntlet USDC Prime V2 | $1,552 | 0.6% |
| `ethereum.alloc-b` | Vault Bridge USDC | $0 | 0.0% |
| `ethereum.alloc-b` | 1337 USDC | $0 | 0.0% |
| `ethereum.alloc-b` | Adpend USDC | $0 | 0.0% |
| `ethereum.alloc-b` | Morpho PAXG market | $0 | 0.0% |
| `ethereum.alloc-b` | Morpho sdeUSD market | $0 | 0.0% |
| `ethereum.alloc-b` | Usual Boosted USDC | −$194,622 | −72.9% |
| `ethereum.alloc-b` | All venues | $266,813 | 100.0% |
| `ethereum.alloc-b.measured` | Fluid fUSDC | $107,966 | 39.8% |
| `ethereum.alloc-b.measured` | Spark Savings sUSDC | $87,414 | 32.2% |
| `ethereum.alloc-b.measured` | Morpho mHYPER market | $43,464 | 16.0% |
| `ethereum.alloc-b.measured` | Smokehouse USDC | $42,305 | 15.6% |
| `ethereum.alloc-b.measured` | Gauntlet USDC Frontier | $41,875 | 15.4% |
| `ethereum.alloc-b.measured` | Hyperithm USDC Apex | $36,857 | 13.6% |
| `ethereum.alloc-b.measured` | Morpho cbBTC market | $29,834 | 11.0% |
| `ethereum.alloc-b.measured` | Aave V3 | $25,417 | 9.4% |
| `ethereum.alloc-b.measured` | Morpho WBTC market | $16,431 | 6.1% |
| `ethereum.alloc-b.measured` | Steakhouse USDC | $9,169 | 3.4% |
| `ethereum.alloc-b.measured` | Compound V3 | $7,565 | 2.8% |
| `ethereum.alloc-b.measured` | Gauntlet USDC Prime | $4,481 | 1.7% |
| `ethereum.alloc-b.measured` | Steakhouse Prime USDC V2 | $4,390 | 1.6% |
| `ethereum.alloc-b.measured` | Morpho wsrUSD market | $3,131 | 1.2% |
| `ethereum.alloc-b.measured` | Waterline Reservoir USDC | $2,624 | 1.0% |
| `ethereum.alloc-b.measured` | Morpho srUSD market | $1,641 | 0.6% |
| `ethereum.alloc-b.measured` | Gauntlet USDC Prime V2 | $1,476 | 0.5% |
| `ethereum.alloc-b.measured` | Vault Bridge USDC | $54 | 0.0% |
| `ethereum.alloc-b.measured` | 1337 USDC | $0 | 0.0% |
| `ethereum.alloc-b.measured` | Adpend USDC | $0 | 0.0% |
| `ethereum.alloc-b.measured` | Morpho PAXG market | $0 | 0.0% |
| `ethereum.alloc-b.measured` | Morpho sdeUSD market | $0 | 0.0% |
| `ethereum.alloc-b.measured` | Usual Boosted USDC | −$194,569 | −71.7% |
| `ethereum.alloc-b.measured` | All venues | $271,528 | 100.0% |
| `ethereum.public-a` | Fluid fUSDC | $134,477 | 33.5% |
| `ethereum.public-a` | Spark Savings sUSDC | $111,148 | 27.7% |
| `ethereum.public-a` | Morpho cbBTC market | $35,480 | 8.8% |
| `ethereum.public-a` | Aave V3 | $34,730 | 8.6% |
| `ethereum.public-a` | Morpho WBTC market | $26,082 | 6.5% |
| `ethereum.public-a` | Steakhouse USDC | $25,042 | 6.2% |
| `ethereum.public-a` | Compound V3 | $13,666 | 3.4% |
| `ethereum.public-a` | Gauntlet USDC Prime | $10,859 | 2.7% |
| `ethereum.public-a` | Steakhouse Prime USDC V2 | $5,428 | 1.4% |
| `ethereum.public-a` | Gauntlet USDC Prime V2 | $4,325 | 1.1% |
| `ethereum.public-a` | Vault Bridge USDC | $334 | 0.1% |
| `ethereum.public-a` | All venues | $401,571 | 100.0% |
| `ethereum.deployed` | Smokehouse USDC | $293,516 | 65.2% |
| `ethereum.deployed` | Gauntlet USDC Prime | $69,437 | 15.4% |
| `ethereum.deployed` | Aave V3 | $42,630 | 9.5% |
| `ethereum.deployed` | Steakhouse USDC | $30,112 | 6.7% |
| `ethereum.deployed` | Compound V3 | $14,718 | 3.3% |
| `ethereum.deployed` | All venues | $450,414 | 100.0% |

- Interest: the sum over the year of the venue's `interest_` column of `thesauros_simple` in `tangem-simulation-daily.csv`: what the venue paid on the position that day, before gas and before the fee. It is the growth of the venue's index between two readings, scaled by the measured ratio of its rate with our deposit to its rate without it and never above that growth. A fall of the index is a negative figure. 2 venue-days of these runs have one.
- All venues: their sum. Less the gas of the year it is the yield before the fee of table 1.
- The script stops unless, on every day, the interest of the venues less `gas_spent_usd` and `fees_paid` is `daily_yield`, within the rounding of those columns to the cent.
- A venue that lost over the year has a share below zero (Usual Boosted USDC in `ethereum.alloc-b`, Usual Boosted USDC in `ethereum.alloc-b.measured`), and the shares of the other venues of that run then add to more than 100%.

## 8. Liquidity episodes
The days of `thesauros_simple` on which less than the whole balance could be withdrawn, consecutive days as one episode.

| Run | From | To | Days | Of them under half | Lowest share that could be withdrawn | Venues that held more than they had free |
|---|---|---|---|---|---|---|
| `ethereum.alloc-a` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.14% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.16M held |
| `ethereum.alloc-a` | 2026-05-22 | 2026-05-22 | 1 | 0 | 92.44% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $4.07M held |
| `ethereum.alloc-a` | 2026-05-28 | 2026-05-31 | 4 | 1 | 40.01% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.11M held |
| `ethereum.alloc-a` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.10% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.13M held |
| `ethereum.alloc-a.measured` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.13% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.16M held |
| `ethereum.alloc-a.measured` | 2026-05-28 | 2026-05-31 | 4 | 1 | 40.01% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.11M held |
| `ethereum.alloc-a.measured` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.10% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.13M held |
| `ethereum.alloc-strict` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.14% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.16M held |
| `ethereum.alloc-strict` | 2026-05-22 | 2026-05-22 | 1 | 0 | 92.44% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $4.07M held |
| `ethereum.alloc-strict` | 2026-05-28 | 2026-05-31 | 4 | 1 | 40.01% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.11M held |
| `ethereum.alloc-strict` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.11% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.13M held |
| `ethereum.alloc-b` | 2025-10-17 | 2025-10-17 | 1 | 0 | 65.68% on 2025-10-17 | Morpho mHYPER market: at 2 readings, the lowest $2.57M free at 2025-10-17 13:44 UTC against $6.01M held |
| `ethereum.alloc-b` | 2025-10-29 | 2025-10-30 | 2 | 0 | 84.83% on 2025-10-30 | Morpho mHYPER market: at 2 readings, the lowest $4.50M free at 2025-10-29 12:10 UTC against $4.56M held |
| `ethereum.alloc-b` | 2025-11-03 | 2025-11-07 | 5 | 5 | 0.00% on 2025-11-04 | Usual Boosted USDC: at 3 readings, the lowest $0 free at 2025-11-06 21:36 UTC against $6.04M held; Hyperithm USDC Apex: at 8 readings, the lowest $0 free at 2025-11-04 21:13 UTC against $4.08M held; Morpho srUSD market: at 3 readings, the lowest $0 free at 2025-11-06 21:36 UTC against $2.74M held; Morpho mHYPER market: at 10 readings, the lowest $0 free at 2025-11-04 21:13 UTC against $5.97M held |
| `ethereum.alloc-b` | 2026-03-22 | 2026-03-22 | 1 | 0 | 59.99% on 2026-03-22 | Gauntlet USDC Frontier: at 3 readings, the lowest $0 free at 2026-03-22 14:51 UTC against $3.99M held |
| `ethereum.alloc-b` | 2026-04-18 | 2026-04-19 | 2 | 0 | 67.38% on 2026-04-18 | Waterline Reservoir USDC: at 1 reading, the lowest $0.74M free at 2026-04-19 01:12 UTC against $2.00M held; Morpho wsrUSD market: at 2 readings, the lowest $0 free at 2026-04-19 01:12 UTC against $2.00M held |
| `ethereum.alloc-b` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.95% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.00M held |
| `ethereum.alloc-b` | 2026-05-22 | 2026-05-22 | 1 | 0 | 92.67% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $4.04M held |
| `ethereum.alloc-b` | 2026-05-29 | 2026-05-31 | 3 | 1 | 40.01% on 2026-05-29 | Fluid fUSDC: at 5 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.02M held |
| `ethereum.alloc-b` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.54% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.04M held |
| `ethereum.alloc-b.measured` | 2025-10-17 | 2025-10-17 | 1 | 0 | 80.57% on 2025-10-17 | Morpho mHYPER market: at 2 readings, the lowest $2.57M free at 2025-10-17 13:44 UTC against $4.52M held |
| `ethereum.alloc-b.measured` | 2025-11-03 | 2025-11-07 | 5 | 4 | 0.00% on 2025-11-04 | Usual Boosted USDC: at 3 readings, the lowest $0 free at 2025-11-06 21:36 UTC against $6.04M held; Hyperithm USDC Apex: at 8 readings, the lowest $0 free at 2025-11-04 21:13 UTC against $4.35M held; Morpho srUSD market: at 3 readings, the lowest $0 free at 2025-11-06 21:36 UTC against $1.90M held; Morpho mHYPER market: at 10 readings, the lowest $0 free at 2025-11-04 21:13 UTC against $5.70M held |
| `ethereum.alloc-b.measured` | 2026-03-22 | 2026-03-22 | 1 | 0 | 59.99% on 2026-03-22 | Gauntlet USDC Frontier: at 4 readings, the lowest $0 free at 2026-03-22 14:51 UTC against $3.99M held |
| `ethereum.alloc-b.measured` | 2026-04-18 | 2026-04-19 | 2 | 0 | 67.38% on 2026-04-18 | Waterline Reservoir USDC: at 1 reading, the lowest $0.74M free at 2026-04-19 01:12 UTC against $2.00M held; Morpho wsrUSD market: at 2 readings, the lowest $0 free at 2026-04-19 01:12 UTC against $2.00M held |
| `ethereum.alloc-b.measured` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.94% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.01M held |
| `ethereum.alloc-b.measured` | 2026-05-29 | 2026-05-31 | 3 | 1 | 40.01% on 2026-05-29 | Fluid fUSDC: at 5 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.02M held |
| `ethereum.alloc-b.measured` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.54% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.04M held |
| `ethereum.public-a` | 2026-04-23 | 2026-04-23 | 1 | 0 | 92.15% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $6.10M held |
| `ethereum.public-a` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.46% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.11M held |
| `ethereum.public-a` | 2026-05-28 | 2026-05-31 | 4 | 1 | 39.99% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.11M held |
| `ethereum.public-a` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.10% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.13M held |
| `ethereum.deployed` | 2025-11-04 | 2025-11-04 | 1 | 1 | 40.08% on 2025-11-04 | Smokehouse USDC: at 4 readings, the lowest $9,530 free at 2025-11-04 17:11 UTC against $6.02M held |
| `ethereum.deployed` | 2026-03-22 | 2026-03-23 | 2 | 1 | 44.05% on 2026-03-22 | Smokehouse USDC: at 5 readings, the lowest $0.41M free at 2026-03-22 10:50 UTC against $6.10M held |
| `ethereum.deployed` | 2026-04-18 | 2026-04-23 | 6 | 5 | 40.06% on 2026-04-21 | Aave V3: at 22 readings, the lowest $6,402 free at 2026-04-19 17:14 UTC against $6.11M held; Smokehouse USDC: at 1 reading, the lowest $5.59M free at 2026-04-19 01:12 UTC against $6.11M held |
| `ethereum.deployed` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.34% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.13M held |
| `ethereum.deployed` | 2026-08-04 | 2026-08-12 | 9 | 0 | 94.14% on 2026-08-04 | Smokehouse USDC: at 26 readings, the lowest $5.57M free at 2026-08-04 18:31 UTC against $6.17M held |

- A day counts when `available_liquidity` is under `total_assets` in `tangem-simulation-daily.csv`; the share is one over the other. The days of this table are the days table 2 does not count as whole to the cent.
- Venues: at each reading of `raw.jsonl` on those days the vault's position in a venue, once the movements of that reading are made, is set against the venue's `liquidity` at that reading, and each day's closing position against the first reading after it; that is how `available_liquidity` is taken. A venue is named when its position was above its free liquidity at one of them, with the number of such readings and the one at which it had the least free. Positions are rebuilt as for the largest share in table 2.
- The script stops unless the lowest share so rebuilt for a day, of every day of the year, is within 0.1% of the balance of the share in the daily file.

## 9. Fee
What `thesauros_simple` would hold at another performance fee, worked out from the daily file of the run.

|  | `ethereum.alloc-a` | `ethereum.alloc-a.measured` | `ethereum.alloc-strict` | `ethereum.alloc-b` | `ethereum.alloc-b.measured` | `ethereum.public-a` | `ethereum.deployed` |
|---|---|---|---|---|---|---|---|
| At a fee of 0%: balance at the end of the year, and yield | $10,408,088 (4.08%) | $10,411,995 (4.12%) | $10,406,711 (4.07%) | $10,268,543 (2.69%) | $10,273,242 (2.73%) | $10,401,706 (4.02%) | $10,452,443 (4.52%) |
| At a fee of 0%: against Just Aave | +$57,425 (+0.57 pp) | +$61,332 (+0.61 pp) | +$56,048 (+0.56 pp) | −$82,120 (−0.82 pp) | −$77,421 (−0.77 pp) | +$51,043 (+0.51 pp) | +$101,780 (+1.02 pp) |
| At a fee of 10%: balance at the end of the year, and yield | $10,366,543 (3.67%) | $10,370,045 (3.70%) | $10,365,308 (3.65%) | $10,219,478 (2.19%) | $10,223,687 (2.24%) | $10,360,822 (3.61%) | $10,406,295 (4.06%) |
| At a fee of 10%: against Just Aave | +$15,880 (+0.16 pp) | +$19,382 (+0.19 pp) | +$14,645 (+0.15 pp) | −$131,185 (−1.31 pp) | −$126,975 (−1.27 pp) | +$10,159 (+0.10 pp) | +$55,632 (+0.56 pp) |
| At a fee of 15%: balance at the end of the year, and yield | $10,345,832 (3.46%) | $10,349,133 (3.49%) | $10,344,669 (3.45%) | $10,195,034 (1.95%) | $10,198,999 (1.99%) | $10,340,440 (3.40%) | $10,383,297 (3.83%) |
| At a fee of 15%: against Just Aave | −$4,830 (−0.05 pp) | −$1,530 (−0.02 pp) | −$5,994 (−0.06 pp) | −$155,629 (−1.56 pp) | −$151,663 (−1.52 pp) | −$10,223 (−0.10 pp) | +$32,634 (+0.33 pp) |
| The fee the run was made at | 25% | 25% | 25% | 25% | 25% | 25% | 25% |
| At that fee, the run itself: balance at the end of the year, and yield | $10,304,535 (3.05%) | $10,307,436 (3.07%) | $10,303,512 (3.04%) | $10,146,319 (1.46%) | $10,149,802 (1.50%) | $10,299,796 (3.00%) | $10,337,454 (3.37%) |
| At that fee, the run itself: against Just Aave | −$46,128 (−0.46 pp) | −$43,227 (−0.43 pp) | −$47,151 (−0.47 pp) | −$204,344 (−2.04 pp) | −$200,861 (−2.01 pp) | −$50,867 (−0.51 pp) | −$13,209 (−0.13 pp) |
| At that fee: the balance worked out less the balance of the run | +$0.17 | $0.00 | +$0.17 | +$0.11 | +$0.09 | −$0.13 | −$0.06 |
| The fee at which the balance worked out is that of Just Aave | 13.8% | 14.6% | 13.5% | none: below Just Aave before any fee | none: below Just Aave before any fee | 12.5% | 22.1% |

- A day's return before the fee: the sum of the `interest_` columns of the day less `gas_spent_usd`, over `total_assets` of the day before, the deposit for the first day. At a fee the balance of a day is the balance of the day before times one plus the return, less the fee's share of the return when it is positive. The year starts on the deposit.
- Yield: the balance less the deposit, in percent of the deposit. Against Just Aave: the same less the yield of Just Aave of table 1.
- At the fee the run was made at the arithmetic is the run itself, so those two rows show `total_assets` of the last day, as table 1 does. The script stops unless the balance worked out at that fee is within $1 of it: the files are in cents, and the row after shows what the rounding leaves.
- At 0% the yield is above the yield before the fee of table 1: that one adds the fees of the year to the yield, without what they would have earned had they stayed in the vault.
- The fee at which the balance is that of Just Aave: found by halving between 0% and 100% on the same arithmetic. The break-even fee of table 1 is its approximation in one line.
- The arithmetic keeps the returns of the run as they are. A run made at another fee differs: with a lower fee the vault is larger, so each venue pays a little less on a larger position and a move is decided on other amounts. The runs below were made at another fee to measure it.
- `ethereum.alloc-a.fee10` is `ethereum.alloc-a` made at a fee of 10%, in the output folder `simulation-alloc-a-fee10`; the pack has its config and no copy of its files. The balance of `ethereum.alloc-a` worked out at 10%: $10,366,543. The balance of the run made at 10%: $10,366,479. Worked out less made: +$64.

## 10. Venues held
`thesauros_simple`, at each day's close.

|  | `ethereum.alloc-a` | `ethereum.alloc-a.measured` | `ethereum.alloc-strict` | `ethereum.alloc-b` | `ethereum.alloc-b.measured` | `ethereum.public-a` | `ethereum.deployed` |
|---|---|---|---|---|---|---|---|
| Days with 1 venue | 19 | 14 | 18 | 15 | 10 | 0 | 0 |
| Days with 2 venues | 117 | 133 | 157 | 172 | 196 | 365 | 365 |
| Days with 3 venues | 78 | 60 | 160 | 78 | 54 | 0 | 0 |
| Days with 4 venues | 115 | 118 | 25 | 71 | 80 | 0 | 0 |
| Days with 5 venues | 34 | 38 | 5 | 29 | 23 | 0 | 0 |
| Days with 6 venues | 2 | 2 | 0 | 0 | 2 | 0 | 0 |
| Venues held, mean over the days | 3.09 | 3.11 | 2.57 | 2.80 | 2.77 | 2.00 | 2.00 |
| Largest share of the vault in one venue | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-10-07 | 100.00% in Aave V3 on 2026-04-23 | 60.01% in Spark Savings sUSDC on 2025-12-02 | 60.03% in Smokehouse USDC on 2025-11-30 |
| The most the entry provider held | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-10-07 | 100.00% in Aave V3 on 2026-04-23 | 60.00% in Aave V3 on 2025-11-05 | 60.00% in Compound V3 on 2026-05-16 |

- A venue is held on a day when its column of `tangem-simulation-daily.csv` is 1% of the vault or more at that day's close. The rows go up to the most venues any run held on one day.
- Largest share: the highest venue column of the year, with its venue and the first day it is reached. The entry provider is `entry_provider` of the config, where a deposit lands. The allocator does not cap it, so it can hold the whole vault; under the public vault's rules a rebalance caps it as it caps every venue.
- The cap of 60% of the vault acts when a rebalance executes: between two rebalances a venue that earns more than the others stands a little above it.
- The allocator has no minimum of two venues. On the days of an allocator run with one venue, that venue is Aave V3, the entry provider, which it does not cap.

## 11. Movements against the source's own free liquidity and interest that could not be withdrawn
What `thesauros_simple` took out of a venue beyond the venue's own free liquidity, and the interest it was credited in a venue on days the venue could not have paid its position out.

|  | `ethereum.alloc-a` | `ethereum.alloc-a.measured` | `ethereum.alloc-strict` | `ethereum.alloc-b` | `ethereum.alloc-b.measured` | `ethereum.public-a` | `ethereum.deployed` |
|---|---|---|---|---|---|---|---|
| Movements that took out more than the source venue had free without us | 0 | 0 | 0 | 4 | 3 | 0 | 0 |
| Their amount | $0 | $0 | $0 | $8,824,250 | $8,709,620 | $0 | $0 |
| Their sources, with the movements of each | — | — | — | Morpho mHYPER market 1, Morpho srUSD market 1, Gauntlet USDC Frontier 1, Fluid fUSDC 1 | Morpho mHYPER market 1, Morpho srUSD market 1, Gauntlet USDC Frontier 1 | — | — |
| `thesauros_simple`: interest credited on venue-days short of liquidity | $8,569 | $7,568 | $8,568 | $37,628 | $34,003 | $8,198 | $25,322 |
| `thesauros_simple`: its share of the interest of the year | 2.1% | 1.8% | 2.1% | 14.1% | 12.5% | 2.0% | 5.6% |
| `thesauros_simple`: such venue-days | 7 | 6 | 7 | 23 | 20 | 7 | 20 |
| `thesauros_simple`: their venues, with the days of each | Fluid fUSDC 5, Aave V3 2 | Fluid fUSDC 5, Aave V3 1 | Fluid fUSDC 5, Aave V3 2 | Morpho mHYPER market 6, Fluid fUSDC 4, Hyperithm USDC Apex 2, Usual Boosted USDC 2, Morpho srUSD market 2, Waterline Reservoir USDC 2, Morpho wsrUSD market 2, Aave V3 2, Gauntlet USDC Frontier 1 | Morpho mHYPER market 4, Fluid fUSDC 4, Hyperithm USDC Apex 2, Usual Boosted USDC 2, Morpho srUSD market 2, Waterline Reservoir USDC 2, Morpho wsrUSD market 2, Gauntlet USDC Frontier 1, Aave V3 1 | Fluid fUSDC 5, Aave V3 2 | Smokehouse USDC 14, Aave V3 6 |

The same interest for the four controls, which sit in venues through such days too:

|  | `ethereum.alloc-a` | `ethereum.alloc-a.measured` | `ethereum.alloc-strict` | `ethereum.alloc-b` | `ethereum.alloc-b.measured` | `ethereum.public-a` | `ethereum.deployed` |
|---|---|---|---|---|---|---|---|
| `first_split_held`: interest credited on venue-days short of liquidity | $0 | $142 | $1,822 | $131,679 | $131,685 | $541 | $18,318 |
| `first_split_held`: its share of the interest of the year | 0.0% | 0.0% | 0.5% | 47.0% | 46.8% | 0.2% | 4.1% |
| `first_split_held`: such venue-days | 0 | 1 | 5 | 519 | 519 | 1 | 16 |
| `first_split_held`: their venues, with the days of each | — | Morpho WBTC market 1 | Morpho WBTC market 4, Morpho cbBTC market 1 | Morpho mHYPER market 342, Hyperithm USDC Apex 177 | Morpho mHYPER market 342, Hyperithm USDC Apex 177 | Morpho cbBTC market 1 | Smokehouse USDC 16 |
| `eligible_equal_weight`: interest credited on venue-days short of liquidity | $3,712 | $3,712 | $4,318 | $10,420 | $10,420 | $3,712 | $7,509 |
| `eligible_equal_weight`: its share of the interest of the year | 1.0% | 1.0% | 1.2% | 2.6% | 2.6% | 1.0% | 1.9% |
| `eligible_equal_weight`: such venue-days | 14 | 14 | 14 | 30 | 30 | 14 | 16 |
| `eligible_equal_weight`: their venues, with the days of each | Aave V3 12, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 12, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 13, Fluid fUSDC 1 | Aave V3 12, Morpho srUSD market 3, Gauntlet USDC Frontier 3, Hyperithm USDC Apex 2, Morpho mHYPER market 2, Waterline Reservoir USDC 2, Morpho wsrUSD market 2, Smokehouse USDC 1, Usual Boosted USDC 1, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 12, Morpho srUSD market 3, Gauntlet USDC Frontier 3, Hyperithm USDC Apex 2, Morpho mHYPER market 2, Waterline Reservoir USDC 2, Morpho wsrUSD market 2, Smokehouse USDC 1, Usual Boosted USDC 1, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 12, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 13, Smokehouse USDC 3 |
| `just_aave`: interest credited on venue-days short of liquidity | $34,352 | $34,352 | $34,352 | $34,352 | $34,352 | $34,352 | $34,352 |
| `just_aave`: its share of the interest of the year | 9.8% | 9.8% | 9.8% | 9.8% | 9.8% | 9.8% | 9.8% |
| `just_aave`: such venue-days | 23 | 23 | 23 | 23 | 23 | 23 | 23 |
| `just_aave`: their venues, with the days of each | Aave V3 23 | Aave V3 23 | Aave V3 23 | Aave V3 23 | Aave V3 23 | Aave V3 23 | Aave V3 23 |
| `just_best_vault`: interest credited on venue-days short of liquidity | $1,675 | $1,675 | $1,675 | $107,378 | $107,378 | $1,675 | $102,454 |
| `just_best_vault`: its share of the interest of the year | 0.5% | 0.5% | 0.5% | 78.3% | 78.3% | 0.5% | 21.1% |
| `just_best_vault`: such venue-days | 2 | 2 | 2 | 352 | 352 | 2 | 74 |
| `just_best_vault`: their venues, with the days of each | Morpho cbBTC market 2 | Morpho cbBTC market 2 | Morpho cbBTC market 2 | Morpho mHYPER market 352 | Morpho mHYPER market 352 | Morpho cbBTC market 2 | Smokehouse USDC 74 |

- More than the source had free: the movements of table 2, rows of `tangem-simulation-rebalances.csv` with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid. The run lets such a movement execute: it takes our own deposit to be payable next to that liquidity, in whole with rate impact on and in the liquid share of the venue with it off. Whether the venue would have paid it on chain is not in the history.
- Interest on venue-days short of liquidity: the simulator credits the growth of a venue's index whether or not the venue could have paid the vault out. A venue-day counts when the position in the venue is above the venue's `liquidity` at a reading of `raw.jsonl` on that day, once the movements of that reading are made, or when the day's closing position is above its `liquidity` at the first reading after the close. That is how table 8 names its venues and how `available_liquidity` is taken, so a venue that was short while the vault held it counts whether or not it was still held at the close. The figure is the sum of the venue's `interest_` column over such days. It is the interest of the whole day, the finest the daily file has: the most that was credited while the venue was short, with the hours of such a day on which the venue could have paid in it.
- Share: of the sum of every `interest_` column of the strategy over the year, in which a fall of an index is the negative figure it is. Positions are rebuilt as for the largest share in table 2, and a position under 0.01% of the deposit is not weighed.
- A control is credited the same way, so its yield in table 1 has this interest in it. Its positions are rebuilt from its own days and its own movements in `tangem-simulation-rebalances.csv`; `just_aave` and `just_best_vault` have none. For every strategy the script stops unless the lowest share of the balance so payable on a day is within 0.1% of the balance of `available_liquidity` over `total_assets` in the daily file.
- —: no such movement, or no such venue-day.
