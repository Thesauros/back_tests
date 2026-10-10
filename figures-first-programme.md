# Figures of the Tangem pack
Written by `reproduce/figures.js` (its source is `reproduce/src/pack-figures.ts`) from the files `reproduce/simulate.js` writes and from `raw.jsonl` and `venue-eligibility.csv` under `reproduce/data/tangem/<network>/`. Do not edit: run the script again.
A run is named by its config: `base.deployed` is `config.base.deployed.json`. `simulate.js` writes the files of a run to the output folder of the table, under `reproduce/data/tangem/<network>/`. The pack has the same files, byte for byte, in the run folder of the table; a run without one is in the pack as its config only.

| Run | Config | Network | Output folder of `simulate.js` | Run folder of the pack | Venues | Fee | Rate impact | Limit on our share of a venue | Venue rule |
|---|---|---|---|---|---|---|---|---|---|
| `base.deployed` | `config.base.deployed.json` | Base | `simulation-deployed` | `base-vault-as-deployed/simulation` | Compound V3, Aave V3, Steakhouse High Yield USDC, Steakhouse Prime USDC, Gauntlet USDC Core | 20% | on | none | none |
| `base.wide` | `config.base.wide.json` | Base | `simulation-wide` | none | Aave V3, Morpho cbBTC market | 20% | on | 10% | `in_set` of `venue-eligibility.csv` |
| `base.wide-vaults-kept` | `config.base.wide-vaults-kept.json` | Base | `simulation-wide-vaults-kept` | none | Aave V3, Steakhouse Prime USDC, Spark USDC Vault, Morpho cbBTC market, Steakhouse USDC, Steakhouse Prime USDC V2, Gauntlet USDC Prime | 20% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `ethereum.deployed` | `config.ethereum.deployed.json` | Ethereum | `simulation-deployed` | `ethereum-vault-as-deployed/simulation` | Compound V3, Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Smokehouse USDC | 25% | on | none | none |
| `ethereum.wide` | `config.ethereum.wide.json` | Ethereum | `simulation-wide` | none | Compound V3, Aave V3, Steakhouse USDC, Morpho WBTC market, Morpho cbBTC market, Fluid fUSDC, Spark Savings sUSDC | 25% | on | 10% | `in_set` of `venue-eligibility.csv` |
| `ethereum.wide-vaults-kept` | `config.ethereum.wide-vaults-kept.json` | Ethereum | `simulation-wide-vaults-kept` | none | Compound V3, Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Morpho WBTC market, Morpho cbBTC market, Gauntlet USDC Prime V2, Fluid fUSDC, Spark Savings sUSDC, Steakhouse Prime USDC V2, Vault Bridge USDC | 25% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `base.wide.no-rate-impact` | `config.base.wide.no-rate-impact.json` | Base | `simulation-wide-no-rate-impact` | none | Aave V3, Morpho cbBTC market | 20% | off | 10% | `in_set` of `venue-eligibility.csv` |
| `ethereum.wide.no-rate-impact` | `config.ethereum.wide.no-rate-impact.json` | Ethereum | `simulation-wide-no-rate-impact` | none | Compound V3, Aave V3, Steakhouse USDC, Morpho WBTC market, Morpho cbBTC market, Fluid fUSDC, Spark Savings sUSDC | 25% | off | 10% | `in_set` of `venue-eligibility.csv` |
| `ethereum.wide.no-fluid` | `config.ethereum.wide.no-fluid.json` | Ethereum | `simulation-wide-no-fluid` | none | Compound V3, Aave V3, Steakhouse USDC, Morpho WBTC market, Morpho cbBTC market, Spark Savings sUSDC | 25% | on | 10% | `in_set` of `venue-eligibility.csv` without Fluid fUSDC |
| `ethereum.wide.no-fluid-no-spark` | `config.ethereum.wide.no-fluid-no-spark.json` | Ethereum | `simulation-wide-no-fluid-no-spark` | none | Compound V3, Aave V3, Steakhouse USDC, Morpho WBTC market, Morpho cbBTC market | 25% | on | 10% | `in_set` of `venue-eligibility.csv` without Fluid fUSDC and Spark Savings sUSDC |

- Rate impact: `rate_impact_enabled` of the config. On: a position earns the rate the deposit probes measured with it in the venue, and the venue can pay it out next to its own liquidity. Off: the deposit moves no rate, and the venue pays its liquid share of itself with the position in it.
- Limit on our share of a venue: `max_share_of_venue_percent` of the config. A venue takes no new money while a full position, 60% of the vault, would be more than that share of the venue with the position in it, and what the vault holds there leaves when the decision moves it and the move can execute. The limit is tested when a move is decided: a venue that shrinks under a position the vault cannot take out leaves the vault above it, and the largest share of table 2 is the share the vault reached.

## 1. Result
Yield for the year on the deposit, in USD and in percent of the deposit.

|  | `base.deployed` | `base.wide` | `base.wide-vaults-kept` | `ethereum.deployed` | `ethereum.wide` | `ethereum.wide-vaults-kept` | `base.wide.no-rate-impact` | `ethereum.wide.no-rate-impact` | `ethereum.wide.no-fluid` | `ethereum.wide.no-fluid-no-spark` |
|---|---|---|---|---|---|---|---|---|---|---|
| Decision of Thesauros Simple | public vault's rules | public vault's rules | public vault's rules | public vault's rules | public vault's rules | public vault's rules | public vault's rules | public vault's rules | public vault's rules | public vault's rules |
| Venue set | no rule: the venues of the config, all year | the strict set: `in_set` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | no rule: the venues of the config, all year | the strict set: `in_set` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | the strict set: `in_set` of `venue-eligibility.csv` | the strict set: `in_set` of `venue-eligibility.csv` | the strict set: `in_set` of `venue-eligibility.csv` without Fluid fUSDC | the strict set: `in_set` of `venue-eligibility.csv` without Fluid fUSDC and Spark Savings sUSDC |
| Liquidity rule | off | off | off | off | off | off | off | off | off | off |
| Just Aave: all in Aave V3, never moved | $326,880 (3.27%) | $326,880 (3.27%) | $326,880 (3.27%) | $350,663 (3.51%) | $350,663 (3.51%) | $350,663 (3.51%) | $355,279 (3.55%) | $357,939 (3.58%) | $350,663 (3.51%) | $350,663 (3.51%) |
| First split held: the first allocation, never rebalanced, no fee | $465,125 (4.65%) | $414,026 (4.14%) | $436,680 (4.37%) | $441,566 (4.42%) | $334,443 (3.34%) | $341,267 (3.41%) | $426,123 (4.26%) | $369,774 (3.70%) | $334,443 (3.34%) | $334,443 (3.34%) |
| Eligible equal weight: equal parts over the venues allowed, no fee | $411,779 (4.12%) | $401,463 (4.01%) | $414,203 (4.14%) | $387,171 (3.87%) | $368,479 (3.68%) | $368,043 (3.68%) | $414,380 (4.14%) | $378,212 (3.78%) | $357,412 (3.57%) | $345,845 (3.46%) |
| Thesauros Simple before its fee | $456,117 (4.56%) | $412,380 (4.12%) | $456,798 (4.57%) | $449,938 (4.50%) | $403,636 (4.04%) | $404,599 (4.05%) | $424,423 (4.24%) | $450,605 (4.51%) | $376,343 (3.76%) | $348,038 (3.48%) |
| Choosing by rate added, against first split held | −$9,009 (−0.09 pp) | −$1,646 (−0.02 pp) | +$20,118 (+0.20 pp) | +$8,372 (+0.08 pp) | +$69,193 (+0.69 pp) | +$63,333 (+0.63 pp) | −$1,700 (−0.02 pp) | +$80,831 (+0.81 pp) | +$41,900 (+0.42 pp) | +$13,595 (+0.14 pp) |
| Choosing by rate added, against eligible equal weight | +$44,338 (+0.44 pp) | +$10,916 (+0.11 pp) | +$42,596 (+0.43 pp) | +$62,767 (+0.63 pp) | +$35,157 (+0.35 pp) | +$36,557 (+0.37 pp) | +$10,043 (+0.10 pp) | +$72,393 (+0.72 pp) | +$18,932 (+0.19 pp) | +$2,192 (+0.02 pp) |
| Months ahead of eligible equal weight, before the fee: months from the 7th to the 6th | 9 of 12 | 12 of 12 | 12 of 12 | 12 of 12 | 11 of 12 | 11 of 12 | 12 of 12 | 12 of 12 | 8 of 12 | 7 of 12 |
| Months ahead of eligible equal weight, before the fee: calendar months | 9 of 13 | 13 of 13 | 13 of 13 | 13 of 13 | 11 of 13 | 11 of 13 | 13 of 13 | 13 of 13 | 8 of 13 | 5 of 13 |
| Performance fee | $91,223 (20% of each positive day) | $82,476 (20% of each positive day) | $91,360 (20% of each positive day) | $112,485 (25% of each positive day) | $100,909 (25% of each positive day) | $101,150 (25% of each positive day) | $84,885 (20% of each positive day) | $112,651 (25% of each positive day) | $94,086 (25% of each positive day) | $87,010 (25% of each positive day) |
| Thesauros Simple after its fee | $364,893 (3.65%) | $329,904 (3.30%) | $365,439 (3.65%) | $337,454 (3.37%) | $302,727 (3.03%) | $303,450 (3.03%) | $339,538 (3.40%) | $337,954 (3.38%) | $282,258 (2.82%) | $261,028 (2.61%) |
| Just Best Vault: all in the venue with the highest rate on day one | $449,622 (4.50%) | $457,845 (4.58%) | $457,845 (4.58%) | $484,853 (4.85%) | $328,922 (3.29%) | $328,922 (3.29%) | $473,481 (4.73%) | $369,049 (3.69%) | $328,922 (3.29%) | $328,922 (3.29%) |
| The venue Just Best Vault picked | Steakhouse Prime USDC | Morpho cbBTC market | Morpho cbBTC market | Smokehouse USDC | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market |
| Thesauros Simple after its fee, against Just Aave | +$38,013 (+0.38 pp) | +$3,023 (+0.03 pp) | +$38,558 (+0.39 pp) | −$13,209 (−0.13 pp) | −$47,936 (−0.48 pp) | −$47,213 (−0.47 pp) | −$15,741 (−0.16 pp) | −$19,986 (−0.20 pp) | −$68,405 (−0.68 pp) | −$89,635 (−0.90 pp) |
| After its fee, against first split held | −$100,232 (−1.00 pp) | −$84,122 (−0.84 pp) | −$71,242 (−0.71 pp) | −$104,113 (−1.04 pp) | −$31,716 (−0.32 pp) | −$37,817 (−0.38 pp) | −$86,585 (−0.87 pp) | −$31,821 (−0.32 pp) | −$52,185 (−0.52 pp) | −$73,415 (−0.73 pp) |
| After its fee, against eligible equal weight | −$46,885 (−0.47 pp) | −$71,560 (−0.72 pp) | −$48,764 (−0.49 pp) | −$49,717 (−0.50 pp) | −$65,752 (−0.66 pp) | −$64,593 (−0.65 pp) | −$74,842 (−0.75 pp) | −$40,258 (−0.40 pp) | −$75,154 (−0.75 pp) | −$84,817 (−0.85 pp) |
| Break-even fee: the fee at which Thesauros Simple equals Just Aave | about 28% | about 21% | about 28% | about 22% | about 13% | about 13% | about 16% | about 21% | about 7% | none: below Just Aave before any fee |

- A yield is `total_assets` of the last day of `tangem-simulation-daily.csv` minus the deposit.
- Before its fee: the yield of `thesauros_simple` plus the sum of its `fees_paid`. The fee is that sum.
- Choosing by rate added: the yield before the fee minus the yield of the control. `first_split_held` keeps a venue that later leaves the set, so under a venue rule its difference also carries what the rule costs; `eligible_equal_weight` follows the rule.
- Months ahead: a month counts when the sum of `daily_yield` and `fees_paid` of `thesauros_simple` over its days is above the sum of `daily_yield` of `eligible_equal_weight`. It is counted two ways, and each cell says of how many: by the months of the venue rule, which run from the 7th to the 6th, and by the calendar months the year touches, of which the first and the last are touched in part.
- After its fee, against a control: the yield of `thesauros_simple` minus the yield of the control, which pays no Thesauros fee.
- The venue of Just Best Vault is the venue column that is 100 on its first day.
- Break-even fee: (yield before the fee − yield of Just Aave) / yield before the fee, to the whole percent. It is an approximation: the fee is charged on each positive day and the balance compounds, which the formula leaves out.
- Decision: `policy` and `impact_exponent` of the config. The public vault's rules are the decision of the vault as deployed, with RiskGuard's rules around it: at most 60% of the vault in a venue, at least two venues, the circuit breaker, the anomaly gate and the cooldown.
- Venue set: the column of `venue-eligibility.csv` the `eligible_periods` of the config are, as in the table of the runs. `in_set` is the strict set, `in_set_vaults_kept` is set A, `in_set_broad` is set B of `PROGRAMME.md`.
- Liquidity rule: `liquidity_rule` of the config. On: a venue whose own free liquidity at a reading is below a full position of the vault, 60% of the vault at that reading, takes no new money at that reading.
- Just Best Vault takes the venue with the highest `rate` at the first reading among the venues that are in the set that day and accept the whole deposit. The liquidity rule and the limit on our share of a venue do not bind it, nor Just Aave: they bind `thesauros_simple`, `first_split_held` up to its first rebalance and `eligible_equal_weight`.

## 2. What the vault did
`thesauros_simple` only, except the last five rows.

|  | `base.deployed` | `base.wide` | `base.wide-vaults-kept` | `ethereum.deployed` | `ethereum.wide` | `ethereum.wide-vaults-kept` | `base.wide.no-rate-impact` | `ethereum.wide.no-rate-impact` | `ethereum.wide.no-fluid` | `ethereum.wide.no-fluid-no-spark` |
|---|---|---|---|---|---|---|---|---|---|---|
| Rebalances (transactions) | 392 | 1 | 75 | 219 | 453 | 515 | 3 | 150 | 419 | 367 |
| Movements of funds | 807 | 1 | 197 | 442 | 1048 | 1271 | 3 | 329 | 915 | 777 |
| Movements a rebalance, mean | 2.06 | 1.00 | 2.63 | 2.02 | 2.31 | 2.47 | 1.00 | 2.19 | 2.18 | 2.12 |
| Rebalances that reverse the previous one within 24 hours | 315 | 0 | 50 | 125 | 296 | 317 | 0 | 46 | 302 | 279 |
| The same, counting movements of any size | 328 | 0 | 50 | 126 | 305 | 328 | 0 | 51 | 313 | 287 |
| Of the rebalances that reverse the previous one, counting movements of at least $10,000: those that send back under half of what it moved | 42 | 0 | 1 | 15 | 73 | 110 | 0 | 14 | 52 | 39 |
| Rebalances after which the vault's rate was lower than before | 191 | 0 | 36 | 80 | 181 | 199 | 0 | 1 | 167 | 150 |
| Rebalances a decision priced | 392 | 1 | 75 | 219 | 452 | 514 | 3 | 149 | 418 | 365 |
| Of them, the vault's rate was lower after the move | 191 | 0 | 36 | 80 | 180 | 198 | 0 | 0 | 166 | 148 |
| Of them, the realized change was under the 0.25 pp the move had to expect | 204 | 0 | 72 | 112 | 278 | 334 | 0 | 0 | 264 | 224 |
| Of them, the realized change was under the expected gain | 381 | 1 | 74 | 183 | 418 | 479 | 0 | 0 | 381 | 346 |
| Mean expected gain of the priced rebalances | 0.95 pp | 0.83 pp | 0.34 pp | 0.55 pp | 0.57 pp | 0.57 pp | 0.44 pp | 0.67 pp | 0.56 pp | 0.56 pp |
| Mean realized change of the priced rebalances | 0.03 pp | 0.80 pp | 0.04 pp | 0.22 pp | 0.14 pp | 0.14 pp | 0.52 pp | 0.95 pp | 0.13 pp | 0.13 pp |
| Rebalances that take a venue back under the provider cap, which no gain decided | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Movements that are forced exits | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 3 |
| Movements sent in the transaction of a forced exit | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 1 | 1 | 2 |
| Movements that took out more than the source venue had free without us | 435 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Movements under $1,000 | 121 | 0 | 46 | 122 | 224 | 248 | 0 | 55 | 238 | 220 |
| Movements whose gas cost was above the amount moved | 0 | 0 | 0 | 1 | 12 | 8 | 0 | 3 | 8 | 13 |
| Legs refused | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Gas for the year | $11.66 | $0.03 | $4.01 | $475 | $1,350 | $1,716 | $0.06 | $493 | $1,184 | $971 |
| Gas for the year, as the daily file has it | $11.64 | $0.03 | $3.99 | $475 | $1,350 | $1,716 | $0.06 | $493 | $1,184 | $971 |
| Days on which the whole balance could be withdrawn, to the cent | 40 of 365 | 363 of 365 | 362 of 365 | 346 of 365 | 354 of 365 | 354 of 365 | 363 of 365 | 353 of 365 | 358 of 365 | 357 of 365 |
| Days on which the whole balance could be withdrawn, within 0.01% of the balance | 41 of 365 | 363 of 365 | 362 of 365 | 346 of 365 | 354 of 365 | 354 of 365 | 363 of 365 | 353 of 365 | 358 of 365 | 357 of 365 |
| Days on which less than half could be withdrawn | 131 of 365 | 0 of 365 | 0 of 365 | 7 of 365 | 6 of 365 | 6 of 365 | 0 of 365 | 6 of 365 | 6 of 365 | 6 of 365 |
| Largest share of a venue we would have been | 89.4% of Steakhouse High Yield USDC on 2026-10-02 | 2.5% of Aave V3 on 2025-10-07 | 5.2% of Steakhouse Prime USDC V2 on 2026-05-10 | 32.6% of Smokehouse USDC on 2026-10-03 | 6.0% of Morpho WBTC market on 2026-04-15 | 6.3% of Steakhouse Prime USDC V2 on 2026-08-19 | 2.5% of Aave V3 on 2025-10-07 | 5.8% of Morpho WBTC market on 2026-04-17 | 6.0% of Morpho WBTC market on 2026-04-15 | 6.0% of Morpho WBTC market on 2026-04-15 |
| Average share of the vault per venue | Steakhouse High Yield USDC 52.1%, Steakhouse Prime USDC 36.9%, Compound V3 5.8%, Gauntlet USDC Core 3.5%, Aave V3 1.7% | Morpho cbBTC market 60.2%, Aave V3 39.8% | Morpho cbBTC market 38.9%, Gauntlet USDC Prime 32.5%, Steakhouse Prime USDC 11.9%, Steakhouse Prime USDC V2 8.5%, Spark USDC Vault 6.7%, Aave V3 1.5%, Steakhouse USDC 0.0% | Smokehouse USDC 58.8%, Gauntlet USDC Prime 19.2%, Aave V3 9.5%, Steakhouse USDC 9.0%, Compound V3 3.5% | Fluid fUSDC 30.6%, Spark Savings sUSDC 27.9%, Morpho cbBTC market 15.9%, Morpho WBTC market 10.5%, Aave V3 8.0%, Compound V3 4.5%, Steakhouse USDC 2.6% | Fluid fUSDC 30.2%, Spark Savings sUSDC 27.1%, Morpho cbBTC market 11.4%, Aave V3 8.5%, Morpho WBTC market 7.7%, Steakhouse USDC 7.1%, Compound V3 3.6%, Gauntlet USDC Prime 3.2%, Steakhouse Prime USDC V2 0.7%, Gauntlet USDC Prime V2 0.5%, Vault Bridge USDC 0.0% | Morpho cbBTC market 59.2%, Aave V3 40.8% | Fluid fUSDC 28.2%, Spark Savings sUSDC 26.1%, Morpho cbBTC market 15.0%, Morpho WBTC market 12.8%, Compound V3 9.3%, Aave V3 7.8%, Steakhouse USDC 0.8% | Spark Savings sUSDC 35.6%, Morpho cbBTC market 25.8%, Morpho WBTC market 17.7%, Aave V3 11.6%, Compound V3 6.2%, Steakhouse USDC 3.2% | Morpho cbBTC market 35.8%, Morpho WBTC market 26.0%, Aave V3 20.9%, Compound V3 10.7%, Steakhouse USDC 6.6% |
| Outside the set: `thesauros_simple` | no rule in this run | 0 | 0 | no rule in this run | 0 | 0 | 0 | 0 | 0 | 0 |
| Outside the set: `first_split_held` | no rule in this run | 0 | 212 venue-days on 212 days, up to 39.95% of the balance | no rule in this run | 59 venue-days on 59 days, up to 40.00% of the balance | 92 venue-days on 92 days, up to 40.03% of the balance | 0 | 59 venue-days on 59 days, up to 40.00% of the balance | 59 venue-days on 59 days, up to 40.00% of the balance | 59 venue-days on 59 days, up to 40.00% of the balance |
| Outside the set: `eligible_equal_weight` | no rule in this run | 0 | 0 | no rule in this run | 0 | 0 | 0 | 0 | 0 | 0 |
| Outside the set: `just_aave` | no rule in this run | 0 | 0 | no rule in this run | 0 | 0 | 0 | 0 | 0 | 0 |
| Outside the set: `just_best_vault` | no rule in this run | 0 | 0 | no rule in this run | 0 | 0 | 0 | 0 | 0 | 0 |

- Rebalances: distinct `tx` of `tangem-simulation-rebalances.csv`; movements: its rows.
- Reverses the previous one: the rebalance comes at most 24 hours after the one before it and has a movement of at least $10,000 from B to A where the one before had a movement of at least $10,000 from A to B. Smaller movements are left out: a rebalance evens out positions by a few dollars next to its main movements, and such a remainder running the other way is not money sent back. The next row counts them too.
- Under half of what it moved: one movement running back is enough for a rebalance to count as reversing the previous one, so it need not undo it. What a rebalance sends back is its movements of at least $10,000 along a path the previous one used the other way with a movement of at least $10,000, each up to what the previous one sent along that path. The row counts the rebalances of the first of the two rows above that send back under half of all the previous one moved.
- Rate lower than before: `realized_change_pp` below zero, counted once a transaction.
- A decision priced: the rebalance has an `expected_gain_pp`. The decision compared the rates as they stood before the move and expected at least 0.25 pp a year; `realized_change_pp` is the vault's rate with our positions in place after the move less the same before it. No decision priced a rebalance without an `expected_gain_pp`: in these runs the `reason` of its movements is "forced exit: the venue is not in the set" or "moved in the transaction of a forced exit". The five rows that follow count the priced ones only, one value a transaction; the means are over them.
- Back under the provider cap: rebalances whose `reason` begins with "back under the provider cap". Only the allocator makes them: a venue other than its entry provider that has grown above the cap gives up the excess whatever the move earns. Such a rebalance has an `expected_gain_pp`: what the allocator expects the move to change, which may be a loss, and not a gain it had to reach. So it is not counted as priced. The public vault's rules apply the cap inside every rebalance and have no such move.
- Forced exits: movements whose `reason` begins with "forced exit": they leave a venue the decision read as paying nothing, and the `reason` says why. Sent in the transaction of a forced exit: the other movements of that transaction, by their `reason`. Movements a rebalance: the movements over the rebalances.
- More than the source had free: rows with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid.
- Movements under $1,000: rows with `amount` below it. A rebalance evens out positions by such remainders next to its main movements. Gas above the amount: rows with `gas_cost_usd` above `amount`.
- Legs refused: the sum of `rebalances_refused` of the daily file.
- A plan with a leg that cannot execute is refused whole, and every leg of it is counted, at each reading at which it is refused: the vault sends the legs of a rebalance in one transaction, which reverts when one of them does.
- Gas for the year: the sum of `gas_cost_usd` of the movements in `tangem-simulation-rebalances.csv`, which has four decimals. As the daily file has it: the sum of `gas_spent_usd` of `thesauros_simple` in `tangem-simulation-daily.csv`, which is rounded to the cent each day. The two differ by the rounding of the two columns and by nothing else: the script stops if they are further apart than that rounding allows.
- Whole balance, to the cent: days with `available_liquidity` at least `total_assets`. Within 0.01%: at least 99.99% of `total_assets`. Less than half: `available_liquidity` below half of `total_assets`.
- Largest share of a venue: at every reading of `raw.jsonl` the vault holds one position as the reading is taken and another once the movements of that reading are made. Each is divided by the venue's `supplied` at that reading plus the position, and the largest of all is shown. A position is the venue's share of `total_assets` at the day's close less what the later movements of that day brought into it. Interest of the hours between is left out; the script stops unless the positions so rebuilt for the start of a day are within 0.1% of the balance of the close before.
- A position under 0.01% of the deposit, $1,000, is not weighed in the largest share, nor in tables 8 and 11: the venue columns of the daily file have two decimals, and less than that is their rounding.
- Average share: the mean of the venue column over the days.
- Outside the set: a venue-day is a day on which a venue's column is above zero outside its `eligible_periods` in the config; the days are those with `outside_set_percent` above zero. The columns have two decimals, so a position under 0.005% of the balance does not show.

## 3. Stress
Straight from `tangem-stress-tests.csv`.

|  | `base.deployed` | `base.wide` | `base.wide-vaults-kept` | `ethereum.deployed` | `ethereum.wide` | `ethereum.wide-vaults-kept` | `base.wide.no-rate-impact` | `ethereum.wide.no-rate-impact` | `ethereum.wide.no-fluid` | `ethereum.wide.no-fluid-no-spark` |
|---|---|---|---|---|---|---|---|---|---|---|
| First day of every scenario | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 |
| `no_stress`: venue hit | — | — | — | — | — | — | — | — | — | — |
| `no_stress`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `no_stress`: days until everything can be withdrawn | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `no_stress`: balance at year end | $10,364,893 | $10,329,904 | $10,365,439 | $10,337,454 | $10,302,727 | $10,303,450 | $10,339,538 | $10,337,954 | $10,282,258 | $10,261,028 |
| `depeg`: venue hit | — | — | — | — | — | — | — | — | — | — |
| `depeg`: largest loss | $509,178 (4.99%) | $508,086 (4.99%) | $508,954 (4.99%) | $507,945 (4.99%) | $506,634 (4.99%) | $506,653 (4.99%) | $508,238 (4.99%) | $507,099 (4.99%) | $506,474 (4.99%) | $505,724 (5.00%) |
| `depeg`: days until everything can be withdrawn | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `depeg`: balance at year end | $10,364,893 | $10,329,904 | $10,365,439 | $10,337,454 | $10,302,727 | $10,303,450 | $10,339,538 | $10,337,954 | $10,282,258 | $10,261,028 |
| `depeg`: balance at year end, against `no_stress` | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| `curator_bad_debt`: venue hit | Steakhouse High Yield USDC | Morpho cbBTC market | Gauntlet USDC Prime | Smokehouse USDC | Spark Savings sUSDC | Spark Savings sUSDC | Morpho cbBTC market | Spark Savings sUSDC | Spark Savings sUSDC | Aave V3 |
| `curator_bad_debt`: largest loss | $611,135 (5.99%) | $611,315 (6.01%) | $610,715 (5.99%) | $609,500 (5.99%) | $607,921 (5.99%) | $607,943 (5.99%) | $610,177 (5.99%) | $608,474 (5.99%) | $607,733 (5.99%) | $606,812 (5.99%) |
| `curator_bad_debt`: days until everything can be withdrawn | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `curator_bad_debt`: balance at year end | $9,743,656 | $9,707,872 | $9,743,978 | $9,717,768 | $9,685,641 | $9,686,139 | $9,718,102 | $9,717,818 | $9,665,801 | $9,645,874 |
| `curator_bad_debt`: balance at year end, against `no_stress` | −$621,237 | −$622,032 | −$621,461 | −$619,686 | −$617,086 | −$617,311 | −$621,436 | −$620,135 | −$616,456 | −$615,154 |
| `protocol_hack`: venue hit | Steakhouse High Yield USDC | Morpho cbBTC market | Gauntlet USDC Prime | Smokehouse USDC | Spark Savings sUSDC | Spark Savings sUSDC | Morpho cbBTC market | Spark Savings sUSDC | Spark Savings sUSDC | Aave V3 |
| `protocol_hack`: largest loss | $6,121,677 (60.01%) | $6,121,345 (60.16%) | $6,116,355 (60.00%) | $6,103,200 (60.00%) | $6,087,343 (60.00%) | $6,087,563 (60.00%) | $6,110,080 (60.03%) | $6,092,968 (60.00%) | $6,085,313 (60.00%) | $6,074,276 (60.00%) |
| `protocol_hack`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `protocol_hack`: balance at year end | $4,142,920 | $4,106,053 | $4,146,906 | $4,127,860 | $4,125,535 | $4,125,707 | $4,123,488 | $4,134,443 | $4,115,447 | $4,105,701 |
| `protocol_hack`: balance at year end, against `no_stress` | −$6,221,974 | −$6,223,851 | −$6,218,533 | −$6,209,594 | −$6,177,192 | −$6,177,743 | −$6,216,050 | −$6,203,511 | −$6,166,810 | −$6,155,327 |
| `withdrawal_freeze`: venue hit | Steakhouse High Yield USDC | Morpho cbBTC market | Gauntlet USDC Prime | Smokehouse USDC | Spark Savings sUSDC | Spark Savings sUSDC | Morpho cbBTC market | Spark Savings sUSDC | Spark Savings sUSDC | Aave V3 |
| `withdrawal_freeze`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `withdrawal_freeze`: days until everything can be withdrawn | 32 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 |
| `withdrawal_freeze`: balance at year end | $10,365,990 | $10,329,904 | $10,365,397 | $10,336,371 | $10,297,053 | $10,297,903 | $10,339,538 | $10,330,625 | $10,281,088 | $10,260,112 |
| `withdrawal_freeze`: balance at year end, against `no_stress` | +$1,097 | $0 | −$41 | −$1,083 | −$5,674 | −$5,546 | $0 | −$7,329 | −$1,170 | −$916 |

- Columns `provider_hit`, `max_loss_usd` and `max_loss_percent` (against the value on the day before the event), `time_to_exit_days`, `final_balance_usd`, `final_balance_vs_no_stress_usd`. The depeg loss and balance are in USD value; the others in USDC.
- Against `no_stress`: `final_balance_vs_no_stress_usd`, the balance at year end less the balance of the run without the event.
- The scenarios, by `stress` of the config: `depeg` values a USDC at $0.95 for 14 days and hits no venue (—); `curator_bad_debt` takes 10% of the position in the venue hit; `protocol_hack` takes 100% of it, and the venue pays nothing afterwards; `withdrawal_freeze` lets nothing out of the venue hit for 30 days.
- Venue hit: `provider_hit`, the venue `provider` of the scenario names in the config, taken on the first day: `largest` is the venue with the vault's largest position that day, `largest_morpho` the largest among the curated Morpho vaults. `curator_bad_debt` takes `largest_morpho` in `base.deployed`, `ethereum.deployed` and `largest` in `base.wide`, `base.wide-vaults-kept`, `ethereum.wide`, `ethereum.wide-vaults-kept`, `base.wide.no-rate-impact`, `ethereum.wide.no-rate-impact`, `ethereum.wide.no-fluid`, `ethereum.wide.no-fluid-no-spark`; `protocol_hack` takes `largest` in every run; `withdrawal_freeze` takes `largest` in every run.
- `curator_bad_debt` hits a venue that has no curator in `base.wide` (Morpho cbBTC market), `ethereum.wide` (Spark Savings sUSDC), `ethereum.wide-vaults-kept` (Spark Savings sUSDC), `base.wide.no-rate-impact` (Morpho cbBTC market), `ethereum.wide.no-rate-impact` (Spark Savings sUSDC), `ethereum.wide.no-fluid` (Spark Savings sUSDC), `ethereum.wide.no-fluid-no-spark` (Aave V3): there it is the loss of 10% of the vault's largest position, whatever the venue is.

## 4. Venues
Every venue of the runs given.

Base, over the 2191 readings of `raw.jsonl`:

| Venue | Contract | Index growth over the year | Average rate | With $6M of ours | With $10M of ours | Size | Lowest free liquidity | Months in the set | Months in the set with the vaults kept | Thesauros adapter |
|---|---|---|---|---|---|---|---|---|---|---|
| Compound V3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | 4.07% | 3.99% | 2.04% | 1.66% | $8.2M to $19M | $0.5M | 0 of 12 | 0 of 12 | yes: a provider of the live vault |
| Aave V3 | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | 3.55% | 3.49% | 3.32% | 3.22% | $169M to $440M | $3.2M | 12 of 12 | 12 of 12 | yes: a provider of the live vault |
| Steakhouse High Yield USDC | `0xBEEFA7B88064FeEF0cEe02AAeBBd95D30df3878F` | 5.28% | 5.31% | 4.76% | 4.57% | $0.7M to $25M | $0.3M | 0 of 12 | 0 of 12 | yes: a provider of the live vault |
| Steakhouse Prime USDC | `0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2` | 4.65% | 4.67% | 4.56% | 4.53% | $7.8M to $574M | $7.8M | 0 of 12 | 6 of 12 | yes: a provider of the live vault |
| Gauntlet USDC Core | `0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12` | 4.26% | 4.30% | 4.20% | 4.16% | $1.5M to $8.2M | $0.8M | 0 of 12 | 0 of 12 | yes: a provider of the live vault |
| Morpho cbBTC market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836` | 4.73% | 4.76% | 4.64% | 4.61% | $986M to $1.7B | $63M | 12 of 12 | 12 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Spark USDC Vault | `0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A` | 4.24% | 4.27% | 3.95% | 3.81% | $6.4M to $641M | $0.8M | 0 of 12 | 5 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Steakhouse USDC | `0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183` | 3.52% | 3.56% | 3.48% | 3.45% | $123M to $507M | $66M | 0 of 12 | 12 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Steakhouse Prime USDC V2 | `0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9` | 4.59% a year; 4.32% from 2025-10-28 to 2026-10-07: the venue has no reading before | 4.62% | 4.51% | 4.47% | $0 to $601M | $0 | 0 of 12 | 5 of 12 | no: needs a new adapter (Morpho Vault V2) |
| Gauntlet USDC Prime | `0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61` | 4.69% | 4.71% | 4.60% | 4.56% | $11M to $443M | $11M | 0 of 12 | 10 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |

Ethereum, over the 2180 readings of `raw.jsonl`:

| Venue | Contract | Index growth over the year | Average rate | With $6M of ours | With $10M of ours | Size | Lowest free liquidity | Months in the set | Months in the set with the vaults kept | Thesauros adapter |
|---|---|---|---|---|---|---|---|---|---|---|
| Compound V3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | 3.57% | 3.51% | 3.04% | 2.99% | $326M to $580M | $4.6M | 12 of 12 | 12 of 12 | yes: a provider of the live vault |
| Aave V3 | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | 3.58% | 3.53% | 3.49% | 3.46% | $1.8B to $6.1B | $6,402 | 12 of 12 | 12 of 12 | yes: a provider of the live vault |
| Steakhouse USDC | `0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB` | 3.62% | 3.63% | 3.46% | 3.40% | $63M to $511M | $8.4M | 2 of 12 | 9 of 12 | yes: a provider of the live vault |
| Gauntlet USDC Prime | `0xdd0f28e19C1780eb6396170735D45153D261490d` | 3.69% | 3.70% | 3.49% | 3.43% | $22M to $211M | $8.4M | 0 of 12 | 8 of 12 | yes: a provider of the live vault |
| Smokehouse USDC | `0xBEeFFF209270748ddd194831b3fa287a5386f5bC` | 5.42% | 5.48% | 5.10% (deposit refused at 4 readings) | 4.91% (deposit refused at 4 readings) | $13M to $313M | $9,530 | 0 of 12 | 0 of 12 | yes: a provider of the live vault |
| Morpho WBTC market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49` | 3.72% | 3.72% | 3.22% | 3.06% | $82M to $221M | $1.4M | 10 of 12 | 10 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Morpho cbBTC market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64` | 3.69% | 3.71% | 3.38% | 3.30% | $210M to $555M | $4.7M | 12 of 12 | 12 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Fluid fUSDC | `0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33` | 4.29% | 4.19% | 3.78% | 3.59% | $101M to $388M | $0 | 12 of 12 | 12 of 12 | no: needs a new adapter (Fluid) |
| Spark Savings sUSDC | `0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE` | 3.88% | 3.81% | 3.81% | 3.81% | $120M to $1.4B | $2.0B | 12 of 12 | 12 of 12 | no: needs a new adapter (Spark sUSDC) |
| Gauntlet USDC Prime V2 | `0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0` | 3.70% | 3.71% | 3.48% | 3.42% | $1 to $119M | $1 | 0 of 12 | 1 of 12 | no: needs a new adapter (Morpho Vault V2) |
| Steakhouse Prime USDC V2 | `0xbeef088055857739C12CD3765F20b7679Def0f51` | 3.68% a year; 3.46% from 2025-10-27 to 2026-10-07: the venue has no reading before | 3.67% | 3.42% | 3.35% | $0 to $134M | $0 | 0 of 12 | 1 of 12 | no: needs a new adapter (Morpho Vault V2) |
| Vault Bridge USDC | `0xBEefb9f61CC44895d8AEc381373555a64191A9c4` | 3.52% | 3.54% | 3.29% | 3.22% | $10M to $227M | $7.3M | 0 of 12 | 1 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |

- Contract: the Aave pool, the Comet, the vault or the token; for a single Morpho Blue market, Morpho Blue and the market id.
- Index growth: the last `index` over the first, minus one, raised to a year by the seconds between the two readings. It is what a deposit in the venue earned, a fall of the index included. For a venue whose first reading is later than the first of the window both figures are shown: the growth raised to a year, and the growth between its two readings, which is all a deposit could have earned there.
- Average rate: the mean of `rate` over the readings. With $6M and $10M of ours: the mean of `rateAfter6` and `rateAfter10`, the rate read back after that deposit, over the readings at which the venue took it.
- Size: the lowest and the highest `supplied`. Lowest free liquidity: the lowest `liquidity`.
- Months in the set: rows of `venue-eligibility.csv` with `in_set` and with `in_set_vaults_kept` equal to 1.
- Thesauros adapter: yes for a provider of the live vault of the network in the networks library and for a MetaMorpho V1 vault, which the MorphoProvider contract of the live vaults reads; no for a Morpho Vault V2, a single Morpho Blue market, Fluid and Spark sUSDC.
- Spark Savings sUSDC: its free liquidity is the USDC of the Sky PSM the vault redeems through, which is no part of its size. It is above the size at 2,180 of its 2,180 readings.

## 5. The rule
From `venue-eligibility.csv`, which has one row for every candidate and month. A mark is a month: `x` in the set, `.` not.

Base, the set by month, from the month that starts on 2025-10-07 to the one that starts on 2026-09-07:

| Venue | In the set | Months | In the set with the vaults kept | Months |
|---|---|---|---|---|
| Aave V3 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Steakhouse USDC | `............` | 0 | `xxxxxxxxxxxx` | 12 |
| Gauntlet USDC Prime | `............` | 0 | `..xxxxxxxxxx` | 10 |
| Steakhouse Prime USDC | `............` | 0 | `....xxxxxx..` | 6 |
| Spark USDC Vault | `............` | 0 | `xxxx.......x` | 5 |
| Steakhouse Prime USDC V2 | `............` | 0 | `.......xxxxx` | 5 |
| Morpho cbBTC market | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |

Base, the candidates that held $100M or more in at least one month and were never in the set:

| Candidate | Kind | Months at $100M or more | Which | Months in the set with the vaults kept | Why it was out in those months |
|---|---|---|---|---|---|
| Steakhouse USDC | morpho | 12 | `xxxxxxxxxxxx` | 12 | same book: 86.14% to 99.98% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 12 of the 12, with the lowest and the highest figure of those months) |
| Gauntlet USDC Prime | morpho | 10 | `..xxxxxxxxxx` | 10 | same book: 92.10% to 99.67% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 10 of the 10, with the lowest and the highest figure of those months) |
| Steakhouse Prime USDC | morpho | 6 | `....xxxxxx..` | 6 | same book: 93.34% to 99.61% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 6 of the 6, with the lowest and the highest figure of those months) |
| Spark USDC Vault | morpho | 5 | `xxxx.......x` | 5 | same book: 94.63% to 99.99% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 5 of the 5, with the lowest and the highest figure of those months) |
| Steakhouse Prime USDC V2 | morpho-v2 | 5 | `.......xxxxx` | 5 | same book: 98.30% to 99.73% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 5 of the 5, with the lowest and the highest figure of those months) |
| Steakhouse High Yield USDC Edition V2 | morpho-v2 | 3 | `.........xxx` | 0 | listed collateral 0.0000% to 1.0044% of assets (the reason of 3 of the 3, with the lowest and the highest figure of those months) |
| Morpho market USDe/USDC 91.5% | morpho-market | 3 | `.........xxx` | 0 | listed collateral 0.0000% of assets (the reason of 3 of the 3, as written for 2026-07-07) |
| Morpho market HERMES/USDC 98% | morpho-market | 1 | `...........x` | 0 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-09-07) |
| Avantis USDC Vault (avUSDC) | erc4626 | 2 | `.xx.........` | 0 | not lent against collateral: the vault is the counterparty of perpetuals traders (the reason of 2 of the 2, as written for 2025-11-07) |

Base, the months of the Morpho vaults (kinds `morpho` and `morpho-v2`) that pass the four tests:

| Vault-months that pass the four tests | In the set | Left out as the same book | Their share in that one market | Left out as a wrapper | In the set with the vaults kept |
|---|---|---|---|---|---|
| 38 | 0 | 38 | 86.14% to 99.99% | 0 | 38 |

Ethereum, the set by month, from the month that starts on 2025-10-07 to the one that starts on 2026-09-07:

| Venue | In the set | Months | In the set with the vaults kept | Months |
|---|---|---|---|---|
| Aave V3 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Compound V3 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Fluid fUSDC | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Spark Savings sUSDC | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Steakhouse USDC | `.....xx.....` | 2 | `xxxxxxxxx...` | 9 |
| Gauntlet USDC Prime | `............` | 0 | `xxxxxxxx....` | 8 |
| Vault Bridge USDC | `............` | 0 | `.....x......` | 1 |
| Gauntlet USDC Prime V2 | `............` | 0 | `.........x..` | 1 |
| Steakhouse Prime USDC V2 | `............` | 0 | `..........x.` | 1 |
| Morpho cbBTC market | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Morpho WBTC market | `xxxx..xxxxxx` | 10 | `xxxx..xxxxxx` | 10 |

Ethereum, the candidates that held $100M or more in at least one month and were never in the set:

| Candidate | Kind | Months at $100M or more | Which | Months in the set with the vaults kept | Why it was out in those months |
|---|---|---|---|---|---|
| Spark Savings USDC v2 (spUSDC) | erc4626 | 10 | `..xxxxxxxxxx` | 0 | only a buffer is payable on demand: 10% of assets in 2025 and a fixed $10M from January 2026 (the reason of 10 of the 10, as written for 2025-12-07) |
| Gauntlet USDC Prime | morpho | 8 | `xxxxxxxx....` | 8 | same book: 55.77% to 91.73% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 6 of the 8, with the lowest and the highest figure of those months) |
| Smokehouse USDC | morpho | 3 | `x.xx........` | 0 | listed collateral 0.0000% to 1.1885% of assets (the reason of 3 of the 3, with the lowest and the highest figure of those months) |
| Vault Bridge USDC | morpho | 1 | `.....x......` | 1 | same book: 88.82% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 1 of the 1, as written for 2026-03-07) |
| Usual Boosted USDC | morpho | 2 | `xx..........` | 0 | listed collateral 0.0000% of assets (the reason of 2 of the 2, as written for 2025-10-07) |
| Gauntlet USDC Frontier | morpho | 3 | `...xxx......` | 0 | listed collateral 0.0054% to 9.0623% of assets (the reason of 3 of the 3, with the lowest and the highest figure of those months) |
| Waterline Reservoir USDC | morpho | 1 | `......x.....` | 0 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-04-07) |
| Hyperithm USDC Apex | morpho | 1 | `x...........` | 0 | listed collateral 0.2541% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| 1337 USDC | morpho | 1 | `...........x` | 0 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-09-07) |
| Adpend USDC | morpho | 2 | `..........xx` | 0 | listed collateral 0.0000% of assets (the reason of 2 of the 2, as written for 2026-08-07) |
| Gauntlet USDC Prime V2 | morpho-v2 | 2 | `.......x.x..` | 1 | wrapper: 100.00% of assets held through Gauntlet USDC Prime which passes the tests (the reason of 1 of the 2, as written for 2026-05-07) |
| Steakhouse Prime USDC V2 | morpho-v2 | 1 | `..........x.` | 1 | same book: 92.84% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 1 of the 1, as written for 2026-08-07) |
| Gauntlet USDC Frontier V2 | morpho-v2 | 1 | `....x.......` | 0 | listed collateral 9.0623% of assets; wrapper: 100.00% of assets held through Gauntlet USDC Frontier which passes tests 1 to 3 (the reason of 1 of the 1, as written for 2026-02-07) |
| Euler eUSDC-70 | euler | 5 | `.xx..xxx....` | 0 | accepts collateral outside the list: RLUSD sUSDe (the reason of 2 of the 5, as written for 2025-12-07) |
| Euler eUSDC-80 | euler | 6 | `...xxxxxx...` | 0 | accepts collateral outside the list: PYUSD USDe sUSDe (the reason of 3 of the 6, as written for 2026-01-07) |
| Morpho market srUSD/USDC 91.5% | morpho-market | 1 | `x...........` | 0 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| Morpho market mHYPER/USDC 86% | morpho-market | 1 | `x...........` | 0 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| Morpho market wsrUSD/USDC 94.5% | morpho-market | 1 | `......x.....` | 0 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-04-07) |
| Morpho market PAXG/USDC 91.5% | morpho-market | 7 | `.....xxxxxxx` | 0 | listed collateral 0.0000% of assets (the reason of 7 of the 7, as written for 2026-03-07) |
| Morpho market sdeUSD/USDC 91.5% | morpho-market | 5 | `.......xxxxx` | 0 | listed collateral 0.0000% of assets (the reason of 5 of the 5, as written for 2026-05-07) |
| Wrapped Aave Ethereum USDC (waEthUSDC) | stata | 7 | `.xxxxxxx....` | 0 | wrapper: 100.00% of assets held through Aave V3 which passes the tests (the reason of 7 of the 7, as written for 2025-11-07) |
| Dolomite USDC | dolomite | 8 | `....xxxxxxxx` | 0 | accepts collateral outside the list: USD1 LINK USDT weETH and 12 more (the reason of 6 of the 8, as written for 2026-02-07) |
| Maple Syrup USDC (syrupUSDC) | erc4626 | 12 | `xxxxxxxxxxxx` | 0 | deposits are permissioned; withdrawals go through a queue (the reason of 12 of the 12, as written for 2025-10-07) |
| Maple High Yield Secured Lending USDC | erc4626 | 3 | `....x.....xx` | 0 | deposits are permissioned (the reason of 3 of the 3, as written for 2026-02-07) |
| Pareto FalconX USDC credit vault | view | 8 | `....xxxxxxxx` | 0 | deposits are allow-listed; monthly redemption epochs (the reason of 8 of the 8, as written for 2026-02-07) |
| Midas mHYPER | view | 2 | `xx..........` | 0 | tokenised fund issued and redeemed by Midas (the reason of 2 of the 2, as written for 2025-10-07) |
| Midas mFONE | view | 6 | `xxxxxx......` | 0 | tokenised fund issued and redeemed by Midas (the reason of 6 of the 6, as written for 2025-10-07) |
| Midas msyrupUSDp | view | 2 | `xx..........` | 0 | pre-deposit certificate issued by Midas (the reason of 2 of the 2, as written for 2025-10-07) |
| Re reUSD | view | 9 | `...xxxxxxxxx` | 0 | mint and redemption are KYC-gated; redemption beyond a buffer goes through a queue (the reason of 9 of the 9, as written for 2026-01-07) |
| Cap cUSD | view | 8 | `xxxxxxxx....` | 0 | the yield needs a second transaction (the reason of 8 of the 8, as written for 2025-10-07) |
| Almanak alUSD | erc4626 | 3 | `xxx.........` | 0 | withdrawals are asynchronous requests (the reason of 3 of the 3, as written for 2025-10-07) |
| Stream xUSD | stream | 11 | `.xxxxxxxxxxx` | 0 | withdrawals are processed in rounds (suspended since November 2025) (the reason of 11 of the 11, as written for 2025-11-07) |

Ethereum, the months of the Morpho vaults (kinds `morpho` and `morpho-v2`) that pass the four tests:

| Vault-months that pass the four tests | In the set | Left out as the same book | Their share in that one market | Left out as a wrapper | In the set with the vaults kept |
|---|---|---|---|---|---|
| 21 | 2 | 18 | 55.77% to 92.84% | 1 | 20 |

- $100M or more: `size_usd` of the month's row. Never in the set: no row with `in_set` equal to 1.
- Why: the `reason` column of the reason met most often among the months at $100M or more. Reasons that differ only in a percent are counted as one. Where the percent is the same in all of them the earliest month's wording is shown verbatim; where it differs, its lowest and its highest among those months stand in its place.
- Vault-months: rows of kind `morpho` or `morpho-v2` with `test_1` to `test_4` all `pass`. In the set: `in_set` is 1. Same book and wrapper: `in_set` is 0 and `reason` begins with that word; the share is `largest_set_market_percent`. With the vaults kept: `in_set_vaults_kept` is 1.
- A venue of the runs is named as the runs name it; the other candidates as `venue-eligibility.csv` names them.

## 6. Shared exposure
The share of the vault that sat in a single Morpho Blue market, directly and through the vaults that lend into it.

| Run | Market | Average | Of it held directly | Of it through vaults | Highest day |
|---|---|---|---|---|---|
| `base.wide` | Morpho cbBTC market | 60.2% | 60.2% | 0.0% | 60.3% on 2026-09-14 |
| `base.wide-vaults-kept` | Morpho cbBTC market | 96.7% | 38.9% | 57.9% | 100.0% on 2025-11-13 |
| `ethereum.wide` | Morpho WBTC market | 10.5% | 10.5% | 0.0% | 60.0% on 2025-12-31 |
| `ethereum.wide` | Morpho cbBTC market | 16.8% | 15.9% | 0.9% | 79.1% on 2026-04-15 |
| `ethereum.wide-vaults-kept` | Morpho WBTC market | 9.8% | 7.7% | 2.1% | 90.8% on 2026-06-13 |
| `ethereum.wide-vaults-kept` | Morpho cbBTC market | 16.8% | 11.4% | 5.4% | 87.0% on 2025-10-07 |
| `base.wide.no-rate-impact` | Morpho cbBTC market | 59.2% | 59.2% | 0.0% | 60.1% on 2026-09-14 |
| `ethereum.wide.no-rate-impact` | Morpho WBTC market | 12.8% | 12.8% | 0.0% | 60.0% on 2025-12-31 |
| `ethereum.wide.no-rate-impact` | Morpho cbBTC market | 15.3% | 15.0% | 0.3% | 79.1% on 2026-04-14 |
| `ethereum.wide.no-fluid` | Morpho WBTC market | 17.7% | 17.7% | 0.0% | 60.0% on 2025-12-31 |
| `ethereum.wide.no-fluid` | Morpho cbBTC market | 26.8% | 25.8% | 1.1% | 79.1% on 2026-04-15 |
| `ethereum.wide.no-fluid-no-spark` | Morpho WBTC market | 26.0% | 26.0% | 0.0% | 60.0% on 2025-10-11 |
| `ethereum.wide.no-fluid-no-spark` | Morpho cbBTC market | 38.2% | 35.8% | 2.4% | 79.1% on 2026-04-17 |

- Directly: the market's own column of the daily file. Through vaults: each other venue's column times `largest_set_market_percent` of its row in `venue-eligibility.csv` for the month the day falls in, where `largest_set_market` is this market.
- Highest day: the largest sum of the two parts at one day's close, and that day. It is a single close, not a period: the average says how the year went.
- It is an approximation: the look-through is read once a month, at the first reading of the month, and applied to every day of it.
- It is a lower bound where a vault lends into two markets of the set: the table has a vault's share in the one market of the set where it has the most, and only for a market that passes the rule that month.

## 7. Interest by venue
What `thesauros_simple` earned in each venue over the year, before gas and before its fee.

| Run | Venue | Interest for the year | Share of the run's interest |
|---|---|---|---|
| `base.deployed` | Steakhouse High Yield USDC | $253,101 | 55.5% |
| `base.deployed` | Steakhouse Prime USDC | $172,465 | 37.8% |
| `base.deployed` | Gauntlet USDC Core | $14,770 | 3.2% |
| `base.deployed` | Compound V3 | $8,900 | 2.0% |
| `base.deployed` | Aave V3 | $6,893 | 1.5% |
| `base.deployed` | All venues | $456,128 | 100.0% |
| `base.wide` | Morpho cbBTC market | $275,425 | 66.8% |
| `base.wide` | Aave V3 | $136,955 | 33.2% |
| `base.wide` | All venues | $412,380 | 100.0% |
| `base.wide-vaults-kept` | Morpho cbBTC market | $186,827 | 40.9% |
| `base.wide-vaults-kept` | Gauntlet USDC Prime | $141,758 | 31.0% |
| `base.wide-vaults-kept` | Steakhouse Prime USDC | $46,878 | 10.3% |
| `base.wide-vaults-kept` | Spark USDC Vault | $37,914 | 8.3% |
| `base.wide-vaults-kept` | Steakhouse Prime USDC V2 | $36,793 | 8.1% |
| `base.wide-vaults-kept` | Aave V3 | $6,632 | 1.5% |
| `base.wide-vaults-kept` | Steakhouse USDC | $0 | 0.0% |
| `base.wide-vaults-kept` | All venues | $456,802 | 100.0% |
| `ethereum.deployed` | Smokehouse USDC | $293,516 | 65.2% |
| `ethereum.deployed` | Gauntlet USDC Prime | $69,437 | 15.4% |
| `ethereum.deployed` | Aave V3 | $42,630 | 9.5% |
| `ethereum.deployed` | Steakhouse USDC | $30,112 | 6.7% |
| `ethereum.deployed` | Compound V3 | $14,718 | 3.3% |
| `ethereum.deployed` | All venues | $450,414 | 100.0% |
| `ethereum.wide` | Fluid fUSDC | $136,156 | 33.6% |
| `ethereum.wide` | Spark Savings sUSDC | $114,636 | 28.3% |
| `ethereum.wide` | Morpho cbBTC market | $56,926 | 14.1% |
| `ethereum.wide` | Aave V3 | $40,530 | 10.0% |
| `ethereum.wide` | Morpho WBTC market | $34,584 | 8.5% |
| `ethereum.wide` | Compound V3 | $14,647 | 3.6% |
| `ethereum.wide` | Steakhouse USDC | $7,507 | 1.9% |
| `ethereum.wide` | All venues | $404,986 | 100.0% |
| `ethereum.wide-vaults-kept` | Fluid fUSDC | $134,317 | 33.1% |
| `ethereum.wide-vaults-kept` | Spark Savings sUSDC | $110,397 | 27.2% |
| `ethereum.wide-vaults-kept` | Morpho cbBTC market | $42,010 | 10.3% |
| `ethereum.wide-vaults-kept` | Aave V3 | $39,768 | 9.8% |
| `ethereum.wide-vaults-kept` | Morpho WBTC market | $26,062 | 6.4% |
| `ethereum.wide-vaults-kept` | Steakhouse USDC | $24,547 | 6.0% |
| `ethereum.wide-vaults-kept` | Compound V3 | $14,048 | 3.5% |
| `ethereum.wide-vaults-kept` | Gauntlet USDC Prime | $10,510 | 2.6% |
| `ethereum.wide-vaults-kept` | Steakhouse Prime USDC V2 | $2,888 | 0.7% |
| `ethereum.wide-vaults-kept` | Gauntlet USDC Prime V2 | $1,432 | 0.4% |
| `ethereum.wide-vaults-kept` | Vault Bridge USDC | $334 | 0.1% |
| `ethereum.wide-vaults-kept` | All venues | $406,315 | 100.0% |
| `base.wide.no-rate-impact` | Morpho cbBTC market | $278,782 | 65.7% |
| `base.wide.no-rate-impact` | Aave V3 | $145,641 | 34.3% |
| `base.wide.no-rate-impact` | All venues | $424,423 | 100.0% |
| `ethereum.wide.no-rate-impact` | Fluid fUSDC | $145,125 | 32.2% |
| `ethereum.wide.no-rate-impact` | Spark Savings sUSDC | $104,108 | 23.1% |
| `ethereum.wide.no-rate-impact` | Morpho cbBTC market | $59,566 | 13.2% |
| `ethereum.wide.no-rate-impact` | Morpho WBTC market | $54,093 | 12.0% |
| `ethereum.wide.no-rate-impact` | Compound V3 | $46,984 | 10.4% |
| `ethereum.wide.no-rate-impact` | Aave V3 | $37,891 | 8.4% |
| `ethereum.wide.no-rate-impact` | Steakhouse USDC | $3,330 | 0.7% |
| `ethereum.wide.no-rate-impact` | All venues | $451,098 | 100.0% |
| `ethereum.wide.no-fluid` | Spark Savings sUSDC | $142,157 | 37.7% |
| `ethereum.wide.no-fluid` | Morpho cbBTC market | $90,006 | 23.8% |
| `ethereum.wide.no-fluid` | Morpho WBTC market | $63,044 | 16.7% |
| `ethereum.wide.no-fluid` | Aave V3 | $51,843 | 13.7% |
| `ethereum.wide.no-fluid` | Compound V3 | $20,114 | 5.3% |
| `ethereum.wide.no-fluid` | Steakhouse USDC | $10,362 | 2.7% |
| `ethereum.wide.no-fluid` | All venues | $377,527 | 100.0% |
| `ethereum.wide.no-fluid-no-spark` | Morpho cbBTC market | $122,599 | 35.1% |
| `ethereum.wide.no-fluid-no-spark` | Morpho WBTC market | $90,657 | 26.0% |
| `ethereum.wide.no-fluid-no-spark` | Aave V3 | $79,791 | 22.9% |
| `ethereum.wide.no-fluid-no-spark` | Compound V3 | $36,218 | 10.4% |
| `ethereum.wide.no-fluid-no-spark` | Steakhouse USDC | $19,742 | 5.7% |
| `ethereum.wide.no-fluid-no-spark` | All venues | $349,008 | 100.0% |

- Interest: the sum over the year of the venue's `interest_` column of `thesauros_simple` in `tangem-simulation-daily.csv`: what the venue paid on the position that day, before gas and before the fee. It is the growth of the venue's index between two readings, scaled by the measured ratio of its rate with our deposit to its rate without it and never above that growth. A fall of the index is a negative figure. No venue has one on any day of these runs.
- All venues: their sum. Less the gas of the year it is the yield before the fee of table 1.
- The script stops unless, on every day, the interest of the venues less `gas_spent_usd` and `fees_paid` is `daily_yield`, within the rounding of those columns to the cent.

## 8. Liquidity episodes
The days of `thesauros_simple` on which less than the whole balance could be withdrawn, consecutive days as one episode.

| Run | From | To | Days | Of them under half | Lowest share that could be withdrawn | Venues that held more than they had free |
|---|---|---|---|---|---|---|
| `base.deployed` | 2025-10-07 | 2025-10-07 | 1 | 1 | 22.38% on 2025-10-07 | Compound V3: at 3 readings, the lowest $2.24M free at 2025-10-07 08:00 UTC against $10.00M held |
| `base.deployed` | 2025-10-16 | 2025-11-27 | 43 | 0 | 52.51% on 2025-10-20 | Compound V3: at 3 readings, the lowest $1.25M free at 2025-10-20 16:00 UTC against $6.01M held; Steakhouse High Yield USDC: at 232 readings, the lowest $4.14M free at 2025-11-11 16:00 UTC against $6.03M held |
| `base.deployed` | 2025-11-29 | 2025-12-09 | 11 | 0 | 89.01% on 2025-12-05 | Steakhouse High Yield USDC: at 62 readings, the lowest $4.94M free at 2025-12-05 20:00 UTC against $6.05M held |
| `base.deployed` | 2025-12-12 | 2026-01-31 | 51 | 6 | 44.81% on 2026-01-23 | Compound V3: at 3 readings, the lowest $1.31M free at 2026-01-31 04:00 UTC against $6.09M held; Steakhouse High Yield USDC: at 262 readings, the lowest $2.25M free at 2026-01-18 16:00 UTC against $6.08M held; Gauntlet USDC Core: at 69 readings, the lowest $2.02M free at 2026-01-29 20:00 UTC against $4.06M held |
| `base.deployed` | 2026-02-03 | 2026-02-04 | 2 | 0 | 71.14% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $6.09M held |
| `base.deployed` | 2026-02-10 | 2026-02-13 | 4 | 0 | 91.63% on 2026-02-10 | Steakhouse High Yield USDC: at 19 readings, the lowest $3.21M free at 2026-02-11 00:00 UTC against $4.06M held |
| `base.deployed` | 2026-02-20 | 2026-02-24 | 5 | 0 | 85.73% on 2026-02-23 | Steakhouse High Yield USDC: at 29 readings, the lowest $4.65M free at 2026-02-23 12:00 UTC against $6.10M held |
| `base.deployed` | 2026-02-28 | 2026-03-01 | 2 | 0 | 86.98% on 2026-02-28 | Steakhouse High Yield USDC: at 4 readings, the lowest $4.78M free at 2026-02-28 20:00 UTC against $6.10M held |
| `base.deployed` | 2026-03-06 | 2026-03-10 | 5 | 0 | 93.65% on 2026-03-09 | Steakhouse High Yield USDC: at 17 readings, the lowest $5.46M free at 2026-03-09 20:00 UTC against $6.11M held |
| `base.deployed` | 2026-03-17 | 2026-03-18 | 2 | 0 | 78.82% on 2026-03-18 | Steakhouse High Yield USDC: at 6 readings, the lowest $3.95M free at 2026-03-18 00:00 UTC against $6.11M held |
| `base.deployed` | 2026-03-20 | 2026-04-11 | 23 | 2 | 49.52% on 2026-03-23 | Steakhouse High Yield USDC: at 121 readings, the lowest $0.97M free at 2026-03-23 00:00 UTC against $6.11M held |
| `base.deployed` | 2026-04-14 | 2026-10-06 | 176 | 122 | 14.51% on 2026-10-01 | Compound V3: at 210 readings, the lowest $0.64M free at 2026-07-11 12:00 UTC against $6.17M held; Steakhouse High Yield USDC: at 876 readings, the lowest $0.33M free at 2026-05-31 16:00 UTC against $6.15M held; Gauntlet USDC Core: at 142 readings, the lowest $0.85M free at 2026-04-21 04:00 UTC against $4.09M held |
| `base.wide` | 2026-02-03 | 2026-02-04 | 2 | 0 | 91.33% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $4.04M held |
| `base.wide-vaults-kept` | 2026-02-03 | 2026-02-04 | 2 | 0 | 71.15% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $6.09M held |
| `base.wide-vaults-kept` | 2026-05-21 | 2026-05-21 | 1 | 0 | 82.63% on 2026-05-21 | Steakhouse Prime USDC V2: at 1 reading, the lowest $2.32M free at 2026-05-21 16:00 UTC against $4.09M held |
| `ethereum.deployed` | 2025-11-04 | 2025-11-04 | 1 | 1 | 40.08% on 2025-11-04 | Smokehouse USDC: at 4 readings, the lowest $9,530 free at 2025-11-04 17:11 UTC against $6.02M held |
| `ethereum.deployed` | 2026-03-22 | 2026-03-23 | 2 | 1 | 44.05% on 2026-03-22 | Smokehouse USDC: at 5 readings, the lowest $0.41M free at 2026-03-22 10:50 UTC against $6.10M held |
| `ethereum.deployed` | 2026-04-18 | 2026-04-23 | 6 | 5 | 40.06% on 2026-04-21 | Aave V3: at 22 readings, the lowest $6,402 free at 2026-04-19 17:14 UTC against $6.11M held; Smokehouse USDC: at 1 reading, the lowest $5.59M free at 2026-04-19 01:12 UTC against $6.11M held |
| `ethereum.deployed` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.34% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.13M held |
| `ethereum.deployed` | 2026-08-04 | 2026-08-12 | 9 | 0 | 94.14% on 2026-08-04 | Smokehouse USDC: at 26 readings, the lowest $5.57M free at 2026-08-04 18:31 UTC against $6.17M held |
| `ethereum.wide` | 2026-04-19 | 2026-04-23 | 5 | 5 | 40.05% on 2026-04-21 | Aave V3: at 22 readings, the lowest $6,402 free at 2026-04-19 17:14 UTC against $6.09M held |
| `ethereum.wide` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.44% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.11M held |
| `ethereum.wide` | 2026-05-28 | 2026-05-31 | 4 | 1 | 40.00% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.11M held |
| `ethereum.wide` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.09% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.13M held |
| `ethereum.wide-vaults-kept` | 2026-04-19 | 2026-04-23 | 5 | 5 | 40.05% on 2026-04-21 | Aave V3: at 22 readings, the lowest $6,402 free at 2026-04-19 17:14 UTC against $6.09M held |
| `ethereum.wide-vaults-kept` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.44% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.11M held |
| `ethereum.wide-vaults-kept` | 2026-05-28 | 2026-05-31 | 4 | 1 | 39.99% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.12M held |
| `ethereum.wide-vaults-kept` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.09% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.13M held |
| `base.wide.no-rate-impact` | 2026-02-03 | 2026-02-04 | 2 | 0 | 71.19% on 2026-02-03 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $6.08M held |
| `ethereum.wide.no-rate-impact` | 2026-04-18 | 2026-04-23 | 6 | 5 | 40.06% on 2026-04-21 | Aave V3: at 22 readings, the lowest $6,402 free at 2026-04-19 17:14 UTC against $6.10M held; Morpho WBTC market: at 2 readings, the lowest $3.34M free at 2026-04-19 09:13 UTC against $6.10M held |
| `ethereum.wide.no-rate-impact` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.40% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.12M held |
| `ethereum.wide.no-rate-impact` | 2026-05-28 | 2026-05-31 | 4 | 1 | 39.99% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.13M held |
| `ethereum.wide.no-rate-impact` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.02% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.14M held |
| `ethereum.wide.no-fluid` | 2026-04-19 | 2026-04-23 | 5 | 5 | 40.06% on 2026-04-21 | Aave V3: at 22 readings, the lowest $6,402 free at 2026-04-19 17:14 UTC against $6.09M held |
| `ethereum.wide.no-fluid` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.46% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.11M held |
| `ethereum.wide.no-fluid` | 2026-08-20 | 2026-08-20 | 1 | 1 | 46.81% on 2026-08-20 | Aave V3: at 1 reading, the lowest $0.70M free at 2026-08-20 23:56 UTC against $6.15M held |
| `ethereum.wide.no-fluid-no-spark` | 2026-04-18 | 2026-04-23 | 6 | 5 | 40.06% on 2026-04-21 | Aave V3: at 22 readings, the lowest $6,402 free at 2026-04-19 17:14 UTC against $6.08M held; Morpho WBTC market: at 1 reading, the lowest $5.77M free at 2026-04-18 21:12 UTC against $6.08M held; Morpho cbBTC market: at 1 reading, the lowest $4.70M free at 2026-04-19 09:13 UTC against $6.08M held |
| `ethereum.wide.no-fluid-no-spark` | 2026-05-22 | 2026-05-22 | 1 | 0 | 72.52% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $6.10M held |
| `ethereum.wide.no-fluid-no-spark` | 2026-08-20 | 2026-08-20 | 1 | 1 | 46.83% on 2026-08-20 | Aave V3: at 1 reading, the lowest $0.70M free at 2026-08-20 23:56 UTC against $6.13M held |

- A day counts when `available_liquidity` is under `total_assets` in `tangem-simulation-daily.csv`; the share is one over the other. The days of this table are the days table 2 does not count as whole to the cent.
- Venues: at each reading of `raw.jsonl` on those days the vault's position in a venue, once the movements of that reading are made, is set against the venue's `liquidity` at that reading, and each day's closing position against the first reading after it; that is how `available_liquidity` is taken. A venue is named when its position was above its free liquidity at one of them, with the number of such readings and the one at which it had the least free. Positions are rebuilt as for the largest share in table 2.
- The script stops unless the lowest share so rebuilt for a day, of every day of the year, is within 0.1% of the balance of the share in the daily file.

## 9. Fee
What `thesauros_simple` would hold at another performance fee, worked out from the daily file of the run.

|  | `base.deployed` | `base.wide` | `base.wide-vaults-kept` | `ethereum.deployed` | `ethereum.wide` | `ethereum.wide-vaults-kept` | `base.wide.no-rate-impact` | `ethereum.wide.no-rate-impact` | `ethereum.wide.no-fluid` | `ethereum.wide.no-fluid-no-spark` |
|---|---|---|---|---|---|---|---|---|---|---|
| At a fee of 0%: balance at the end of the year, and yield | $10,458,172 (4.58%) | $10,414,062 (4.14%) | $10,458,860 (4.59%) | $10,452,443 (4.52%) | $10,405,653 (4.06%) | $10,406,626 (4.07%) | $10,426,204 (4.26%) | $10,453,116 (4.53%) | $10,378,098 (3.78%) | $10,349,538 (3.50%) |
| At a fee of 0%: against Just Aave | +$131,292 (+1.31 pp) | +$87,181 (+0.87 pp) | +$131,979 (+1.32 pp) | +$101,780 (+1.02 pp) | +$54,990 (+0.55 pp) | +$55,963 (+0.56 pp) | +$70,925 (+0.71 pp) | +$95,177 (+0.95 pp) | +$27,435 (+0.27 pp) | −$1,125 (−0.01 pp) |
| At a fee of 10%: balance at the end of the year, and yield | $10,411,429 (4.11%) | $10,371,898 (3.72%) | $10,412,045 (4.12%) | $10,406,295 (4.06%) | $10,364,360 (3.64%) | $10,365,232 (3.65%) | $10,382,781 (3.83%) | $10,406,899 (4.07%) | $10,339,655 (3.40%) | $10,314,043 (3.14%) |
| At a fee of 10%: against Just Aave | +$84,548 (+0.85 pp) | +$45,017 (+0.45 pp) | +$85,164 (+0.85 pp) | +$55,632 (+0.56 pp) | +$13,697 (+0.14 pp) | +$14,569 (+0.15 pp) | +$27,502 (+0.28 pp) | +$48,959 (+0.49 pp) | −$11,008 (−0.11 pp) | −$36,620 (−0.37 pp) |
| At a fee of 15%: balance at the end of the year, and yield | $10,388,135 (3.88%) | $10,350,880 (3.51%) | $10,388,715 (3.89%) | $10,383,297 (3.83%) | $10,343,775 (3.44%) | $10,344,597 (3.45%) | $10,361,137 (3.61%) | $10,383,866 (3.84%) | $10,320,487 (3.20%) | $10,296,341 (2.96%) |
| At a fee of 15%: against Just Aave | +$61,255 (+0.61 pp) | +$23,999 (+0.24 pp) | +$61,835 (+0.62 pp) | +$32,634 (+0.33 pp) | −$6,888 (−0.07 pp) | −$6,066 (−0.06 pp) | +$5,858 (+0.06 pp) | +$25,927 (+0.26 pp) | −$30,176 (−0.30 pp) | −$54,322 (−0.54 pp) |
| The fee the run was made at | 20% | 20% | 20% | 25% | 25% | 25% | 20% | 25% | 25% | 25% |
| At that fee, the run itself: balance at the end of the year, and yield | $10,364,893 (3.65%) | $10,329,904 (3.30%) | $10,365,439 (3.65%) | $10,337,454 (3.37%) | $10,302,727 (3.03%) | $10,303,450 (3.03%) | $10,339,538 (3.40%) | $10,337,954 (3.38%) | $10,282,258 (2.82%) | $10,261,028 (2.61%) |
| At that fee, the run itself: against Just Aave | +$38,013 (+0.38 pp) | +$3,023 (+0.03 pp) | +$38,558 (+0.39 pp) | −$13,209 (−0.13 pp) | −$47,936 (−0.48 pp) | −$47,213 (−0.47 pp) | −$15,741 (−0.16 pp) | −$19,986 (−0.20 pp) | −$68,405 (−0.68 pp) | −$89,635 (−0.90 pp) |
| At that fee: the balance worked out less the balance of the run | −$0.02 | +$0.02 | −$0.12 | −$0.06 | −$0.06 | −$0.10 | +$0.05 | −$0.06 | −$0.13 | +$0.01 |
| The fee at which the balance worked out is that of Just Aave | 28.2% | 20.7% | 28.3% | 22.1% | 13.3% | 13.5% | 16.4% | 20.6% | 7.1% | none: below Just Aave before any fee |

- A day's return before the fee: the sum of the `interest_` columns of the day less `gas_spent_usd`, over `total_assets` of the day before, the deposit for the first day. At a fee the balance of a day is the balance of the day before times one plus the return, less the fee's share of the return when it is positive. The year starts on the deposit.
- Yield: the balance less the deposit, in percent of the deposit. Against Just Aave: the same less the yield of Just Aave of table 1.
- At the fee the run was made at the arithmetic is the run itself, so those two rows show `total_assets` of the last day, as table 1 does. The script stops unless the balance worked out at that fee is within $1 of it: the files are in cents, and the row after shows what the rounding leaves.
- At 0% the yield is above the yield before the fee of table 1: that one adds the fees of the year to the yield, without what they would have earned had they stayed in the vault.
- The fee at which the balance is that of Just Aave: found by halving between 0% and 100% on the same arithmetic. The break-even fee of table 1 is its approximation in one line.
- The arithmetic keeps the returns of the run as they are. A run made at another fee differs: with a lower fee the vault is larger, so each venue pays a little less on a larger position and a move is decided on other amounts.

## 10. Venues held
`thesauros_simple`, at each day's close.

|  | `base.deployed` | `base.wide` | `base.wide-vaults-kept` | `ethereum.deployed` | `ethereum.wide` | `ethereum.wide-vaults-kept` | `base.wide.no-rate-impact` | `ethereum.wide.no-rate-impact` | `ethereum.wide.no-fluid` | `ethereum.wide.no-fluid-no-spark` |
|---|---|---|---|---|---|---|---|---|---|---|
| Days with 1 venue | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Days with 2 venues | 363 | 365 | 365 | 365 | 364 | 365 | 365 | 365 | 365 | 364 |
| Days with 3 venues | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 |
| Venues held, mean over the days | 2.01 | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 |
| Largest share of the vault in one venue | 60.02% in Steakhouse High Yield USDC on 2026-04-06 | 60.27% in Morpho cbBTC market on 2026-09-14 | 60.02% in Morpho cbBTC market on 2025-11-13 | 60.03% in Smokehouse USDC on 2025-11-30 | 60.02% in Spark Savings sUSDC on 2026-03-06 | 60.01% in Spark Savings sUSDC on 2025-12-02 | 60.14% in Morpho cbBTC market on 2026-09-14 | 60.03% in Fluid fUSDC on 2026-06-03 | 60.02% in Spark Savings sUSDC on 2026-03-04 | 60.01% in Aave V3 on 2025-11-21 |
| The most the entry provider held | 60.00% in Compound V3 on 2026-01-30 | 40.00% in Aave V3 on 2025-10-07 | 60.00% in Aave V3 on 2026-02-03 | 60.00% in Compound V3 on 2026-05-16 | 60.00% in Compound V3 on 2025-10-10 | 60.00% in Compound V3 on 2025-10-10 | 60.00% in Aave V3 on 2026-02-03 | 60.01% in Compound V3 on 2025-11-10 | 60.00% in Compound V3 on 2025-10-10 | 60.00% in Compound V3 on 2025-10-19 |

- A venue is held on a day when its column of `tangem-simulation-daily.csv` is 1% of the vault or more at that day's close. The rows go up to the most venues any run held on one day.
- Largest share: the highest venue column of the year, with its venue and the first day it is reached. The entry provider is `entry_provider` of the config, where a deposit lands. The allocator does not cap it, so it can hold the whole vault; under the public vault's rules a rebalance caps it as it caps every venue.
- The cap of 60% of the vault acts when a rebalance executes: between two rebalances a venue that earns more than the others stands a little above it.

## 11. Movements against the source's own free liquidity and interest that could not be withdrawn
What `thesauros_simple` took out of a venue beyond the venue's own free liquidity, and the interest it was credited in a venue on days the venue could not have paid its position out.

|  | `base.deployed` | `base.wide` | `base.wide-vaults-kept` | `ethereum.deployed` | `ethereum.wide` | `ethereum.wide-vaults-kept` | `base.wide.no-rate-impact` | `ethereum.wide.no-rate-impact` | `ethereum.wide.no-fluid` | `ethereum.wide.no-fluid-no-spark` |
|---|---|---|---|---|---|---|---|---|---|---|
| Movements that took out more than the source venue had free without us | 435 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Their amount | $1,674,033,193 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| Their sources, with the movements of each | Compound V3 296, Steakhouse High Yield USDC 90, Gauntlet USDC Core 49 | — | — | — | — | — | — | — | — | — |
| `thesauros_simple`: interest credited on venue-days short of liquidity | $247,480 | $1,136 | $1,453 | $25,322 | $15,232 | $15,233 | $1,645 | $20,246 | $9,427 | $10,305 |
| `thesauros_simple`: its share of the interest of the year | 54.3% | 0.3% | 0.3% | 5.6% | 3.8% | 3.7% | 0.4% | 4.5% | 2.5% | 3.0% |
| `thesauros_simple`: such venue-days | 485 | 2 | 3 | 20 | 11 | 11 | 2 | 13 | 7 | 9 |
| `thesauros_simple`: their venues, with the days of each | Steakhouse High Yield USDC 302, Compound V3 123, Gauntlet USDC Core 58, Aave V3 2 | Aave V3 2 | Aave V3 2, Steakhouse Prime USDC V2 1 | Smokehouse USDC 14, Aave V3 6 | Aave V3 6, Fluid fUSDC 5 | Aave V3 6, Fluid fUSDC 5 | Aave V3 2 | Aave V3 6, Fluid fUSDC 5, Morpho WBTC market 2 | Aave V3 7 | Aave V3 7, Morpho WBTC market 1, Morpho cbBTC market 1 |

The same interest for the four controls, which sit in venues through such days too:

|  | `base.deployed` | `base.wide` | `base.wide-vaults-kept` | `ethereum.deployed` | `ethereum.wide` | `ethereum.wide-vaults-kept` | `base.wide.no-rate-impact` | `ethereum.wide.no-rate-impact` | `ethereum.wide.no-fluid` | `ethereum.wide.no-fluid-no-spark` |
|---|---|---|---|---|---|---|---|---|---|---|
| `first_split_held`: interest credited on venue-days short of liquidity | $112,712 | $1,140 | $330 | $18,318 | $1,822 | $541 | $1,243 | $2,482 | $1,822 | $1,822 |
| `first_split_held`: its share of the interest of the year | 24.2% | 0.3% | 0.1% | 4.1% | 0.5% | 0.2% | 0.3% | 0.7% | 0.5% | 0.5% |
| `first_split_held`: such venue-days | 227 | 2 | 1 | 16 | 5 | 1 | 2 | 5 | 5 | 5 |
| `first_split_held`: their venues, with the days of each | Steakhouse High Yield USDC 226, Compound V3 1 | Aave V3 2 | Spark USDC Vault 1 | Smokehouse USDC 16 | Morpho WBTC market 4, Morpho cbBTC market 1 | Morpho cbBTC market 1 | Aave V3 2 | Morpho WBTC market 4, Morpho cbBTC market 1 | Morpho WBTC market 4, Morpho cbBTC market 1 | Morpho WBTC market 4, Morpho cbBTC market 1 |
| `eligible_equal_weight`: interest credited on venue-days short of liquidity | $124,833 | $1,397 | $0 | $7,509 | $4,318 | $3,712 | $1,553 | $4,430 | $4,340 | $5,273 |
| `eligible_equal_weight`: its share of the interest of the year | 30.3% | 0.3% | 0.0% | 1.9% | 1.2% | 1.0% | 0.4% | 1.2% | 1.2% | 1.5% |
| `eligible_equal_weight`: such venue-days | 602 | 2 | 0 | 16 | 14 | 14 | 2 | 14 | 13 | 13 |
| `eligible_equal_weight`: their venues, with the days of each | Compound V3 308, Gauntlet USDC Core 219, Steakhouse High Yield USDC 75 | Aave V3 2 | — | Aave V3 13, Smokehouse USDC 3 | Aave V3 13, Fluid fUSDC 1 | Aave V3 12, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 2 | Aave V3 13, Fluid fUSDC 1 | Aave V3 13 | Aave V3 13 |
| `just_aave`: interest credited on venue-days short of liquidity | $4,605 | $4,605 | $4,605 | $34,352 | $34,352 | $34,352 | $5,768 | $35,911 | $34,352 | $34,352 |
| `just_aave`: its share of the interest of the year | 1.4% | 1.4% | 1.4% | 9.8% | 9.8% | 9.8% | 1.6% | 10.0% | 9.8% | 9.8% |
| `just_aave`: such venue-days | 4 | 4 | 4 | 23 | 23 | 23 | 4 | 23 | 23 | 23 |
| `just_aave`: their venues, with the days of each | Aave V3 4 | Aave V3 4 | Aave V3 4 | Aave V3 23 | Aave V3 23 | Aave V3 23 | Aave V3 4 | Aave V3 23 | Aave V3 23 | Aave V3 23 |
| `just_best_vault`: interest credited on venue-days short of liquidity | $26,211 | $0 | $0 | $102,454 | $1,675 | $1,675 | $0 | $2,435 | $1,675 | $1,675 |
| `just_best_vault`: its share of the interest of the year | 5.8% | 0.0% | 0.0% | 21.1% | 0.5% | 0.5% | 0.0% | 0.7% | 0.5% | 0.5% |
| `just_best_vault`: such venue-days | 15 | 0 | 0 | 74 | 2 | 2 | 0 | 2 | 2 | 2 |
| `just_best_vault`: their venues, with the days of each | Steakhouse Prime USDC 15 | — | — | Smokehouse USDC 74 | Morpho cbBTC market 2 | Morpho cbBTC market 2 | — | Morpho cbBTC market 2 | Morpho cbBTC market 2 | Morpho cbBTC market 2 |

- More than the source had free: the movements of table 2, rows of `tangem-simulation-rebalances.csv` with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid. The run lets such a movement execute: it takes our own deposit to be payable next to that liquidity, in whole with rate impact on and in the liquid share of the venue with it off. Whether the venue would have paid it on chain is not in the history.
- Interest on venue-days short of liquidity: the simulator credits the growth of a venue's index whether or not the venue could have paid the vault out. A venue-day counts when the position in the venue is above the venue's `liquidity` at a reading of `raw.jsonl` on that day, once the movements of that reading are made, or when the day's closing position is above its `liquidity` at the first reading after the close. That is how table 8 names its venues and how `available_liquidity` is taken, so a venue that was short while the vault held it counts whether or not it was still held at the close. The figure is the sum of the venue's `interest_` column over such days. It is the interest of the whole day, the finest the daily file has: the most that was credited while the venue was short, with the hours of such a day on which the venue could have paid in it.
- Share: of the sum of every `interest_` column of the strategy over the year, in which a fall of an index is the negative figure it is. Positions are rebuilt as for the largest share in table 2, and a position under 0.01% of the deposit is not weighed.
- A control is credited the same way, so its yield in table 1 has this interest in it. Its positions are rebuilt from its own days and its own movements in `tangem-simulation-rebalances.csv`; `just_aave` and `just_best_vault` have none. For every strategy the script stops unless the lowest share of the balance so payable on a day is within 0.1% of the balance of `available_liquidity` over `total_assets` in the daily file.
- —: no such movement, or no such venue-day.
