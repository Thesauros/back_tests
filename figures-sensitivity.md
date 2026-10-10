# Figures of the Tangem pack
Written by `reproduce/figures.js` (its source is `reproduce/src/pack-figures.ts`) from the files `reproduce/simulate.js` writes and from `raw.jsonl` and `venue-eligibility.csv` under `reproduce/data/tangem/<network>/`. Do not edit: run the script again.
A run is named by its config: `base.deployed` is `config.base.deployed.json`. `simulate.js` writes the files of a run to the output folder of the table, under `reproduce/data/tangem/<network>/`. The pack has the same files, byte for byte, in the run folder of the table; a run without one is in the pack as its config only.

| Run | Config | Network | Output folder of `simulate.js` | Run folder of the pack | Venues | Fee | Rate impact | Limit on our share of a venue | Venue rule |
|---|---|---|---|---|---|---|---|---|---|
| `base.alloc-a` | `config.base.alloc-a.json` | Base | `simulation-alloc-a` | `base-allocator-set-a/simulation` | Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Steakhouse Prime USDC, Spark USDC Vault, Steakhouse Prime USDC V2, Morpho cbBTC market | 20% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `base.alloc-a.no-rate-impact` | `config.base.alloc-a.no-rate-impact.json` | Base | `simulation-alloc-a-no-rate-impact` | none | Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Steakhouse Prime USDC, Spark USDC Vault, Steakhouse Prime USDC V2, Morpho cbBTC market | 20% | off | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `ethereum.alloc-a` | `config.ethereum.alloc-a.json` | Ethereum | `simulation-alloc-a` | `ethereum-allocator-set-a/simulation` | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Vault Bridge USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market | 25% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `ethereum.alloc-a.no-rate-impact` | `config.ethereum.alloc-a.no-rate-impact.json` | Ethereum | `simulation-alloc-a-no-rate-impact` | none | Aave V3, Compound V3, Fluid fUSDC, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Vault Bridge USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market | 25% | off | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `ethereum.alloc-a.no-fluid` | `config.ethereum.alloc-a.no-fluid.json` | Ethereum | `simulation-alloc-a-no-fluid` | none | Aave V3, Compound V3, Spark Savings sUSDC, Steakhouse USDC, Gauntlet USDC Prime, Vault Bridge USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market | 25% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` without Fluid fUSDC |
| `ethereum.alloc-a.no-fluid-no-spark` | `config.ethereum.alloc-a.no-fluid-no-spark.json` | Ethereum | `simulation-alloc-a-no-fluid-no-spark` | none | Aave V3, Compound V3, Steakhouse USDC, Gauntlet USDC Prime, Vault Bridge USDC, Gauntlet USDC Prime V2, Steakhouse Prime USDC V2, Morpho cbBTC market, Morpho WBTC market | 25% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` without Fluid fUSDC and Spark Savings sUSDC |

- Rate impact: `rate_impact_enabled` of the config. On: a position earns the rate the deposit probes measured with it in the venue, and the venue can pay it out next to its own liquidity. Off: the deposit moves no rate, and the venue pays its liquid share of itself with the position in it.
- Limit on our share of a venue: `max_share_of_venue_percent` of the config. A venue takes no new money while a full position, 60% of the vault, would be more than that share of the venue with the position in it, and what the vault holds there leaves when the decision moves it and the move can execute. The allocator also keeps what it aims to hold in a venue within that share of it, the entry provider excepted. The limit is tested when a move is decided: a venue that shrinks under a position the vault cannot take out leaves the vault above it, and the largest share of table 2 is the share the vault reached.

## 1. Result
Yield for the year on the deposit, in USD and in percent of the deposit.

|  | `base.alloc-a` | `base.alloc-a.no-rate-impact` | `ethereum.alloc-a` | `ethereum.alloc-a.no-rate-impact` | `ethereum.alloc-a.no-fluid` | `ethereum.alloc-a.no-fluid-no-spark` |
|---|---|---|---|---|---|---|
| Decision of Thesauros Simple | allocator, production's constants | allocator, production's constants | allocator, production's constants (1.75 assumed for Fluid fUSDC and Spark Savings sUSDC) | allocator, production's constants (1.75 assumed for Fluid fUSDC and Spark Savings sUSDC) | allocator, production's constants (1.75 assumed for Spark Savings sUSDC) | allocator, production's constants |
| Venue set | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` without Fluid fUSDC | set A: `in_set_vaults_kept` of `venue-eligibility.csv` without Fluid fUSDC and Spark Savings sUSDC |
| Liquidity rule | on | on | on | on | on | on |
| Just Aave: all in Aave V3, never moved | $326,880 (3.27%) | $355,279 (3.55%) | $350,663 (3.51%) | $357,939 (3.58%) | $350,663 (3.51%) | $350,663 (3.51%) |
| First split held: the first allocation, never rebalanced, no fee | $436,635 (4.37%) | $453,503 (4.54%) | $348,624 (3.49%) | $366,427 (3.66%) | $348,624 (3.49%) | $348,624 (3.49%) |
| Eligible equal weight: equal parts over the venues allowed, no fee | $414,203 (4.14%) | $418,803 (4.19%) | $368,043 (3.68%) | $375,887 (3.76%) | $358,834 (3.59%) | $352,002 (3.52%) |
| Thesauros Simple before its fee | $458,213 (4.58%) | $467,459 (4.67%) | $406,047 (4.06%) | $445,421 (4.45%) | $378,409 (3.78%) | $357,093 (3.57%) |
| Choosing by rate added, against first split held | +$21,578 (+0.22 pp) | +$13,956 (+0.14 pp) | +$57,423 (+0.57 pp) | +$78,994 (+0.79 pp) | +$29,785 (+0.30 pp) | +$8,470 (+0.08 pp) |
| Choosing by rate added, against eligible equal weight | +$44,011 (+0.44 pp) | +$48,655 (+0.49 pp) | +$38,004 (+0.38 pp) | +$69,534 (+0.70 pp) | +$19,574 (+0.20 pp) | +$5,091 (+0.05 pp) |
| Months ahead of eligible equal weight, before the fee: months from the 7th to the 6th | 12 of 12 | 12 of 12 | 11 of 12 | 12 of 12 | 8 of 12 | 6 of 12 |
| Months ahead of eligible equal weight, before the fee: calendar months | 13 of 13 | 13 of 13 | 12 of 13 | 13 of 13 | 8 of 13 | 7 of 13 |
| Performance fee | $91,643 (20% of each positive day) | $93,492 (20% of each positive day) | $101,512 (25% of each positive day) | $111,355 (25% of each positive day) | $94,602 (25% of each positive day) | $89,273 (25% of each positive day) |
| Thesauros Simple after its fee | $366,571 (3.67%) | $373,967 (3.74%) | $304,535 (3.05%) | $334,066 (3.34%) | $283,806 (2.84%) | $267,820 (2.68%) |
| Just Best Vault: all in the venue with the highest rate on day one | $457,845 (4.58%) | $473,481 (4.73%) | $328,922 (3.29%) | $369,049 (3.69%) | $328,922 (3.29%) | $328,922 (3.29%) |
| The venue Just Best Vault picked | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market |
| Thesauros Simple after its fee, against Just Aave | +$39,690 (+0.40 pp) | +$18,688 (+0.19 pp) | −$46,128 (−0.46 pp) | −$23,874 (−0.24 pp) | −$66,857 (−0.67 pp) | −$82,843 (−0.83 pp) |
| After its fee, against first split held | −$70,064 (−0.70 pp) | −$79,536 (−0.80 pp) | −$44,089 (−0.44 pp) | −$32,362 (−0.32 pp) | −$64,817 (−0.65 pp) | −$80,804 (−0.81 pp) |
| After its fee, against eligible equal weight | −$47,632 (−0.48 pp) | −$44,836 (−0.45 pp) | −$63,508 (−0.64 pp) | −$41,821 (−0.42 pp) | −$75,028 (−0.75 pp) | −$84,182 (−0.84 pp) |
| Break-even fee: the fee at which Thesauros Simple equals Just Aave | about 29% | about 24% | about 14% | about 20% | about 7% | about 2% |

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

|  | `base.alloc-a` | `base.alloc-a.no-rate-impact` | `ethereum.alloc-a` | `ethereum.alloc-a.no-rate-impact` | `ethereum.alloc-a.no-fluid` | `ethereum.alloc-a.no-fluid-no-spark` |
|---|---|---|---|---|---|---|
| Rebalances (transactions) | 66 | 10 | 232 | 138 | 265 | 231 |
| Movements of funds | 153 | 22 | 783 | 449 | 822 | 663 |
| Movements a rebalance, mean | 2.32 | 2.20 | 3.38 | 3.25 | 3.10 | 2.87 |
| Rebalances that reverse the previous one within 24 hours | 34 | 2 | 113 | 24 | 156 | 135 |
| The same, counting movements of any size | 34 | 2 | 114 | 24 | 156 | 135 |
| Of the rebalances that reverse the previous one, counting movements of at least $10,000: those that send back under half of what it moved | 0 | 0 | 23 | 6 | 22 | 10 |
| Rebalances after which the vault's rate was lower than before | 29 | 2 | 74 | 5 | 94 | 96 |
| Rebalances a decision priced | 63 | 6 | 227 | 131 | 261 | 227 |
| Of them, the vault's rate was lower after the move | 27 | 0 | 72 | 0 | 92 | 94 |
| Of them, the realized change was under the 0.05 pp the move had to expect | 52 | 1 | 84 | 1 | 115 | 101 |
| Of them, the realized change was under the expected gain | 58 | 1 | 154 | 5 | 188 | 174 |
| Mean expected gain of the priced rebalances | 0.19 pp | 0.26 pp | 0.51 pp | 0.46 pp | 0.48 pp | 0.52 pp |
| Mean realized change of the priced rebalances | 0.04 pp | 0.33 pp | 0.19 pp | 0.59 pp | 0.15 pp | 0.16 pp |
| Rebalances that take a venue back under the provider cap, which no gain decided | 2 | 2 | 2 | 5 | 1 | 0 |
| Movements that are forced exits | 1 | 3 | 5 | 2 | 3 | 4 |
| Movements sent in the transaction of a forced exit | 2 | 3 | 9 | 7 | 10 | 11 |
| Movements that took out more than the source venue had free without us | 0 | 0 | 0 | 0 | 0 | 0 |
| Movements under $1,000 | 6 | 2 | 46 | 29 | 31 | 7 |
| Movements whose gas cost was above the amount moved | 0 | 0 | 0 | 0 | 0 | 0 |
| Legs refused | 0 | 0 | 0 | 0 | 0 | 0 |
| Gas for the year | $2.15 | $0.63 | $716 | $415 | $861 | $619 |
| Gas for the year, as the daily file has it | $2.16 | $0.61 | $716 | $415 | $861 | $619 |
| Days on which the whole balance could be withdrawn, to the cent | 363 of 365 | 363 of 365 | 358 of 365 | 359 of 365 | 361 of 365 | 360 of 365 |
| Days on which the whole balance could be withdrawn, within 0.01% of the balance | 363 of 365 | 363 of 365 | 358 of 365 | 359 of 365 | 361 of 365 | 360 of 365 |
| Days on which less than half could be withdrawn | 2 of 365 | 2 of 365 | 1 of 365 | 2 of 365 | 1 of 365 | 1 of 365 |
| Largest share of a venue we would have been | 2.6% of Aave V3 on 2026-02-03 | 5.4% of Steakhouse Prime USDC on 2026-07-29 | 5.7% of Fluid fUSDC on 2026-06-06 | 5.7% of Fluid fUSDC on 2026-06-07 | 4.8% of Steakhouse USDC on 2026-06-15 | 5.0% of Gauntlet USDC Prime on 2026-05-19 |
| Average share of the vault per venue | Morpho cbBTC market 52.3%, Gauntlet USDC Prime 23.9%, Steakhouse Prime USDC 8.9%, Spark USDC Vault 6.7%, Steakhouse Prime USDC V2 5.8%, Aave V3 2.4%, Steakhouse USDC 0.0% | Morpho cbBTC market 58.4%, Gauntlet USDC Prime 20.6%, Steakhouse Prime USDC 8.5%, Spark USDC Vault 6.7%, Steakhouse Prime USDC V2 3.3%, Aave V3 2.6%, Steakhouse USDC 0.0% | Spark Savings sUSDC 28.4%, Fluid fUSDC 28.1%, Morpho cbBTC market 12.8%, Aave V3 9.3%, Morpho WBTC market 7.0%, Compound V3 5.0%, Steakhouse USDC 4.9%, Gauntlet USDC Prime 3.4%, Steakhouse Prime USDC V2 0.7%, Gauntlet USDC Prime V2 0.4%, Vault Bridge USDC 0.0% | Fluid fUSDC 27.5%, Spark Savings sUSDC 25.9%, Morpho cbBTC market 15.4%, Aave V3 9.9%, Compound V3 9.4%, Morpho WBTC market 5.8%, Steakhouse USDC 3.4%, Gauntlet USDC Prime 2.3%, Steakhouse Prime USDC V2 0.4%, Gauntlet USDC Prime V2 0.1%, Vault Bridge USDC 0.0% | Spark Savings sUSDC 31.0%, Morpho cbBTC market 20.4%, Aave V3 16.2%, Morpho WBTC market 9.9%, Steakhouse USDC 8.2%, Compound V3 6.7%, Gauntlet USDC Prime 4.2%, Steakhouse Prime USDC V2 1.9%, Gauntlet USDC Prime V2 1.5%, Vault Bridge USDC 0.0% | Aave V3 29.2%, Morpho cbBTC market 24.3%, Steakhouse USDC 15.1%, Morpho WBTC market 13.1%, Gauntlet USDC Prime 7.4%, Compound V3 6.6%, Steakhouse Prime USDC V2 1.8%, Gauntlet USDC Prime V2 1.6%, Vault Bridge USDC 0.8% |
| Outside the set: `thesauros_simple` | 0 | 0 | 0 | 0 | 0 | 0 |
| Outside the set: `first_split_held` | 212 venue-days on 212 days, up to 39.96% of the balance | 212 venue-days on 212 days, up to 39.96% of the balance | 273 venue-days on 181 days, up to 46.10% of the balance | 273 venue-days on 181 days, up to 46.08% of the balance | 273 venue-days on 181 days, up to 46.10% of the balance | 273 venue-days on 181 days, up to 46.10% of the balance |
| Outside the set: `eligible_equal_weight` | 0 | 0 | 0 | 0 | 0 | 0 |
| Outside the set: `just_aave` | 0 | 0 | 0 | 0 | 0 | 0 |
| Outside the set: `just_best_vault` | 0 | 0 | 0 | 0 | 0 | 0 |

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
- Largest share of a venue: at every reading of `raw.jsonl` the vault holds one position as the reading is taken and another once the movements of that reading are made. Each is divided by the venue's `supplied` at that reading plus the position, and the largest of all is shown. A position is the venue's share of `total_assets` at the day's close less what the later movements of that day brought into it. Interest of the hours between is left out; the script stops unless the positions so rebuilt for the start of a day are within 0.1% of the balance of the close before.
- A position under 0.01% of the deposit, $1,000, is not weighed in the largest share, nor in tables 8 and 11: the venue columns of the daily file have two decimals, and less than that is their rounding.
- Average share: the mean of the venue column over the days.
- Outside the set: a venue-day is a day on which a venue's column is above zero outside its `eligible_periods` in the config; the days are those with `outside_set_percent` above zero. The columns have two decimals, so a position under 0.005% of the balance does not show.

## 3. Stress
Straight from `tangem-stress-tests.csv`.

|  | `base.alloc-a` | `base.alloc-a.no-rate-impact` | `ethereum.alloc-a` | `ethereum.alloc-a.no-rate-impact` | `ethereum.alloc-a.no-fluid` | `ethereum.alloc-a.no-fluid-no-spark` |
|---|---|---|---|---|---|---|
| First day of every scenario | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 |
| `no_stress`: venue hit | — | — | — | — | — | — |
| `no_stress`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `no_stress`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 |
| `no_stress`: balance at year end | $10,366,571 | $10,373,967 | $10,304,535 | $10,334,066 | $10,283,806 | $10,267,820 |
| `depeg`: venue hit | — | — | — | — | — | — |
| `depeg`: largest loss | $508,970 (4.99%) | $509,116 (4.99%) | $506,737 (4.99%) | $507,113 (4.99%) | $506,568 (4.99%) | $506,030 (5.00%) |
| `depeg`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 |
| `depeg`: balance at year end | $10,366,571 | $10,373,967 | $10,304,535 | $10,334,066 | $10,283,806 | $10,267,820 |
| `depeg`: balance at year end, against `no_stress` | $0 | $0 | $0 | $0 | $0 | $0 |
| `curator_bad_debt`: venue hit | Morpho cbBTC market | Morpho cbBTC market | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Aave V3 |
| `curator_bad_debt`: largest loss | $610,631 (5.99%) | $610,809 (5.99%) | $607,954 (5.99%) | $608,395 (5.99%) | $607,743 (5.99%) | $1,012,415 (9.99%) |
| `curator_bad_debt`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 |
| `curator_bad_debt`: balance at year end | $9,744,958 | $9,751,802 | $9,687,187 | $9,714,754 | $9,667,506 | $9,241,646 |
| `curator_bad_debt`: balance at year end, against `no_stress` | −$621,612 | −$622,165 | −$617,348 | −$619,312 | −$616,300 | −$1,026,173 |
| `protocol_hack`: venue hit | Morpho cbBTC market | Morpho cbBTC market | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Aave V3 |
| `protocol_hack`: largest loss | $6,115,518 (59.99%) | $6,117,354 (59.99%) | $6,087,669 (59.99%) | $6,092,183 (59.99%) | $6,085,419 (59.99%) | $10,130,228 (100.00%) |
| `protocol_hack`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 |
| `protocol_hack`: balance at year end | $4,148,717 | $4,150,898 | $4,126,615 | $4,134,351 | $4,116,677 | $0 |
| `protocol_hack`: balance at year end, against `no_stress` | −$6,217,854 | −$6,223,069 | −$6,177,920 | −$6,199,715 | −$6,167,130 | −$10,267,820 |
| `withdrawal_freeze`: venue hit | Morpho cbBTC market | Morpho cbBTC market | Spark Savings sUSDC | Spark Savings sUSDC | Spark Savings sUSDC | Aave V3 |
| `withdrawal_freeze`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `withdrawal_freeze`: days until everything can be withdrawn | 30 | 30 | 30 | 30 | 30 | 30 |
| `withdrawal_freeze`: balance at year end | $10,366,674 | $10,373,967 | $10,301,710 | $10,329,590 | $10,285,312 | $10,274,525 |
| `withdrawal_freeze`: balance at year end, against `no_stress` | +$103 | $0 | −$2,825 | −$4,476 | +$1,506 | +$6,705 |

- Columns `provider_hit`, `max_loss_usd` and `max_loss_percent` (against the value on the day before the event), `time_to_exit_days`, `final_balance_usd`, `final_balance_vs_no_stress_usd`. The depeg loss and balance are in USD value; the others in USDC.
- Against `no_stress`: `final_balance_vs_no_stress_usd`, the balance at year end less the balance of the run without the event.
- The scenarios, by `stress` of the config: `depeg` values a USDC at $0.95 for 14 days and hits no venue (—); `curator_bad_debt` takes 10% of the position in the venue hit; `protocol_hack` takes 100% of it, and the venue pays nothing afterwards; `withdrawal_freeze` lets nothing out of the venue hit for 30 days.
- Venue hit: `provider_hit`, the venue `provider` of the scenario names in the config, taken on the first day: `largest` is the venue with the vault's largest position that day, `largest_morpho` the largest among the curated Morpho vaults. `curator_bad_debt` takes `largest` in every run; `protocol_hack` takes `largest` in every run; `withdrawal_freeze` takes `largest` in every run.
- `curator_bad_debt` hits a venue that has no curator in `base.alloc-a` (Morpho cbBTC market), `base.alloc-a.no-rate-impact` (Morpho cbBTC market), `ethereum.alloc-a` (Spark Savings sUSDC), `ethereum.alloc-a.no-rate-impact` (Spark Savings sUSDC), `ethereum.alloc-a.no-fluid` (Spark Savings sUSDC), `ethereum.alloc-a.no-fluid-no-spark` (Aave V3): there it is the loss of 10% of the vault's largest position, whatever the venue is.

## 4. Venues
Every venue of the runs given.

Base, over the 2191 readings of `raw.jsonl`:

| Venue | Contract | Index growth over the year | Average rate | With $6M of ours | With $10M of ours | Size | Lowest free liquidity | Months in the strict set | Months in set A | Months in set B | Thesauros adapter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Aave V3 | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | 3.55% | 3.49% | 3.32% | 3.22% | $169M to $440M | $3.2M | 12 of 12 | 12 of 12 | 12 of 12 | yes: a provider of the live vault |
| Steakhouse USDC | `0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183` | 3.52% | 3.56% | 3.48% | 3.45% | $123M to $507M | $66M | 0 of 12 | 12 of 12 | 12 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Gauntlet USDC Prime | `0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61` | 4.69% | 4.71% | 4.60% | 4.56% | $11M to $443M | $11M | 0 of 12 | 10 of 12 | 10 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Steakhouse Prime USDC | `0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2` | 4.65% | 4.67% | 4.56% | 4.53% | $7.8M to $574M | $7.8M | 0 of 12 | 6 of 12 | 6 of 12 | yes: a provider of the live vault |
| Spark USDC Vault | `0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A` | 4.24% | 4.27% | 3.95% | 3.81% | $6.4M to $641M | $0.8M | 0 of 12 | 5 of 12 | 5 of 12 | yes: a MetaMorpho V1 vault, which the MorphoProvider contract reads; no provider is deployed for it |
| Steakhouse Prime USDC V2 | `0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9` | 4.59% a year; 4.32% from 2025-10-28 to 2026-10-07: the venue has no reading before | 4.62% | 4.51% | 4.47% | $0 to $601M | $0 | 0 of 12 | 5 of 12 | 5 of 12 | no: needs a new adapter (Morpho Vault V2) |
| Morpho cbBTC market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836` | 4.73% | 4.76% | 4.64% | 4.61% | $986M to $1.7B | $63M | 12 of 12 | 12 of 12 | 12 of 12 | no: needs a new adapter (single Morpho Blue market) |

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

- Contract: the Aave pool, the Comet, the vault or the token; for a single Morpho Blue market, Morpho Blue and the market id.
- Index growth: the last `index` over the first, minus one, raised to a year by the seconds between the two readings. It is what a deposit in the venue earned, a fall of the index included. For a venue whose first reading is later than the first of the window both figures are shown: the growth raised to a year, and the growth between its two readings, which is all a deposit could have earned there.
- Average rate: the mean of `rate` over the readings. With $6M and $10M of ours: the mean of `rateAfter6` and `rateAfter10`, the rate read back after that deposit, over the readings at which the venue took it.
- Size: the lowest and the highest `supplied`. Lowest free liquidity: the lowest `liquidity`.
- Months in a set: rows of `venue-eligibility.csv` with the column of the set equal to 1: `in_set` for the strict set, `in_set_vaults_kept` for set A, `in_set_broad` for set B.
- Thesauros adapter: yes for a provider of the live vault of the network in the networks library and for a MetaMorpho V1 vault, which the MorphoProvider contract of the live vaults reads; no for a Morpho Vault V2, a single Morpho Blue market, Fluid and Spark sUSDC.
- Spark Savings sUSDC: its free liquidity is the USDC of the Sky PSM the vault redeems through, which is no part of its size. It is above the size at 2,180 of its 2,180 readings.

## 5. The rule
From `venue-eligibility.csv`, which has one row for every candidate and month. A mark is a month: `x` in the set the column names, `.` not.

Base, the set by month, from the month that starts on 2025-10-07 to the one that starts on 2026-09-07:

| Venue | In the strict set | Months | In set A | Months | In set B | Months |
|---|---|---|---|---|---|---|
| Aave V3 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Steakhouse USDC | `............` | 0 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Gauntlet USDC Prime | `............` | 0 | `..xxxxxxxxxx` | 10 | `..xxxxxxxxxx` | 10 |
| Steakhouse Prime USDC | `............` | 0 | `....xxxxxx..` | 6 | `....xxxxxx..` | 6 |
| Spark USDC Vault | `............` | 0 | `xxxx.......x` | 5 | `xxxx.......x` | 5 |
| Steakhouse Prime USDC V2 | `............` | 0 | `.......xxxxx` | 5 | `.......xxxxx` | 5 |
| Steakhouse High Yield USDC Edition V2 | `............` | 0 | `............` | 0 | `.........xxx` | 3 |
| Morpho cbBTC market | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Morpho market USDe/USDC 91.5% | `............` | 0 | `............` | 0 | `.........xxx` | 3 |
| Morpho market HERMES/USDC 98% | `............` | 0 | `............` | 0 | `...........x` | 1 |

Base, the venues that are in set B in some month and have no `provider` in `venue-eligibility.csv`, so that no run holds them: none.

Base, the candidates at $100M or more that are outside set B in months in which none of tests 1 to 3 failed and one could not be read (`unverified`), which counts as not passed: Avantis USDC Vault (avUSDC) `.xx.........` (2 months; tests 1 and 2 not read; no `provider`, so no run holds it).

Base, the candidates that held $100M or more in at least one month and were never in the strict set:

| Candidate | Kind | Months at $100M or more | Which | Months in set A | Months in set B | Why it was out in those months |
|---|---|---|---|---|---|---|
| Steakhouse USDC | morpho | 12 | `xxxxxxxxxxxx` | 12 | 12 | same book: 86.14% to 99.98% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 12 of the 12, with the lowest and the highest figure of those months) |
| Gauntlet USDC Prime | morpho | 10 | `..xxxxxxxxxx` | 10 | 10 | same book: 92.10% to 99.67% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 10 of the 10, with the lowest and the highest figure of those months) |
| Steakhouse Prime USDC | morpho | 6 | `....xxxxxx..` | 6 | 6 | same book: 93.34% to 99.61% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 6 of the 6, with the lowest and the highest figure of those months) |
| Spark USDC Vault | morpho | 5 | `xxxx.......x` | 5 | 5 | same book: 94.63% to 99.99% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 5 of the 5, with the lowest and the highest figure of those months) |
| Steakhouse Prime USDC V2 | morpho-v2 | 5 | `.......xxxxx` | 5 | 5 | same book: 98.30% to 99.73% of assets in Morpho market cbBTC/USDC 86% which is in the set (the reason of 5 of the 5, with the lowest and the highest figure of those months) |
| Steakhouse High Yield USDC Edition V2 | morpho-v2 | 3 | `.........xxx` | 0 | 3 | listed collateral 0.0000% to 1.0044% of assets (the reason of 3 of the 3, with the lowest and the highest figure of those months) |
| Morpho market USDe/USDC 91.5% | morpho-market | 3 | `.........xxx` | 0 | 3 | listed collateral 0.0000% of assets (the reason of 3 of the 3, as written for 2026-07-07) |
| Morpho market HERMES/USDC 98% | morpho-market | 1 | `...........x` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-09-07) |
| Avantis USDC Vault (avUSDC) | erc4626 | 2 | `.xx.........` | 0 | 0 | not lent against collateral: the vault is the counterparty of perpetuals traders (the reason of 2 of the 2, as written for 2025-11-07) |

Base, the months of the Morpho vaults (kinds `morpho` and `morpho-v2`) that pass the four tests:

| Vault-months that pass the four tests | In the strict set | Left out as the same book | Their share in that one market | Left out as a wrapper | In set A |
|---|---|---|---|---|---|
| 38 | 0 | 38 | 86.14% to 99.99% | 0 | 38 |

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
| Morpho market srUSD/USDC 91.5% | `............` | 0 | `............` | 0 | `x...........` | 1 |
| Morpho market mHYPER/USDC 86% | `............` | 0 | `............` | 0 | `x...........` | 1 |
| Morpho market wsrUSD/USDC 94.5% | `............` | 0 | `............` | 0 | `......x.....` | 1 |
| Morpho market PAXG/USDC 91.5% | `............` | 0 | `............` | 0 | `.....xxxxxxx` | 7 |
| Morpho market sdeUSD/USDC 91.5% | `............` | 0 | `............` | 0 | `.......xxxxx` | 5 |

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
| Morpho market srUSD/USDC 91.5% | morpho-market | 1 | `x...........` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| Morpho market mHYPER/USDC 86% | morpho-market | 1 | `x...........` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2025-10-07) |
| Morpho market wsrUSD/USDC 94.5% | morpho-market | 1 | `......x.....` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-04-07) |
| Morpho market PAXG/USDC 91.5% | morpho-market | 7 | `.....xxxxxxx` | 0 | 7 | listed collateral 0.0000% of assets (the reason of 7 of the 7, as written for 2026-03-07) |
| Morpho market sdeUSD/USDC 91.5% | morpho-market | 5 | `.......xxxxx` | 0 | 5 | listed collateral 0.0000% of assets (the reason of 5 of the 5, as written for 2026-05-07) |
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
| `base.alloc-a` | Morpho cbBTC market | 96.2% | 52.3% | 43.9% | 100.0% on 2025-10-19 |
| `base.alloc-a.no-rate-impact` | Morpho cbBTC market | 96.3% | 58.4% | 37.9% | 100.0% on 2025-10-19 |
| `ethereum.alloc-a` | Morpho cbBTC market | 18.0% | 12.8% | 5.3% | 81.5% on 2026-03-03 |
| `ethereum.alloc-a` | Morpho WBTC market | 8.2% | 7.0% | 1.2% | 60.0% on 2026-09-17 |
| `ethereum.alloc-a.no-rate-impact` | Morpho cbBTC market | 19.4% | 15.4% | 4.0% | 92.2% on 2026-03-03 |
| `ethereum.alloc-a.no-rate-impact` | Morpho WBTC market | 6.2% | 5.8% | 0.4% | 60.0% on 2026-09-24 |
| `ethereum.alloc-a.no-fluid` | Morpho cbBTC market | 28.1% | 20.4% | 7.7% | 93.2% on 2026-08-19 |
| `ethereum.alloc-a.no-fluid` | Morpho WBTC market | 13.4% | 9.9% | 3.5% | 85.9% on 2026-06-15 |
| `ethereum.alloc-a.no-fluid-no-spark` | Morpho cbBTC market | 38.5% | 24.3% | 14.3% | 92.6% on 2025-12-14 |
| `ethereum.alloc-a.no-fluid-no-spark` | Morpho WBTC market | 17.4% | 13.1% | 4.3% | 79.1% on 2026-05-29 |

- Directly: the market's own column of the daily file. Through vaults: each other venue's column times `largest_set_market_percent` of its row in `venue-eligibility.csv` for the month the day falls in, where `largest_set_market` is this market.
- Highest day: the largest sum of the two parts at one day's close, and that day. It is a single close, not a period: the average says how the year went.
- It is an approximation: the look-through is read once a month, at the first reading of the month, and applied to every day of it.
- It is a lower bound where a vault lends into two markets of the set: the table has a vault's share in the one market of the set where it has the most, and only for a market that passes the rule that month.

## 7. Interest by venue
What `thesauros_simple` earned in each venue over the year, before gas and before its fee.

| Run | Venue | Interest for the year | Share of the run's interest |
|---|---|---|---|
| `base.alloc-a` | Morpho cbBTC market | $241,518 | 52.7% |
| `base.alloc-a` | Gauntlet USDC Prime | $105,285 | 23.0% |
| `base.alloc-a` | Spark USDC Vault | $37,825 | 8.3% |
| `base.alloc-a` | Steakhouse Prime USDC | $37,418 | 8.2% |
| `base.alloc-a` | Steakhouse Prime USDC V2 | $26,725 | 5.8% |
| `base.alloc-a` | Aave V3 | $9,445 | 2.1% |
| `base.alloc-a` | Steakhouse USDC | $0 | 0.0% |
| `base.alloc-a` | All venues | $458,215 | 100.0% |
| `base.alloc-a.no-rate-impact` | Morpho cbBTC market | $276,546 | 59.2% |
| `base.alloc-a.no-rate-impact` | Gauntlet USDC Prime | $91,806 | 19.6% |
| `base.alloc-a.no-rate-impact` | Spark USDC Vault | $38,424 | 8.2% |
| `base.alloc-a.no-rate-impact` | Steakhouse Prime USDC | $35,387 | 7.6% |
| `base.alloc-a.no-rate-impact` | Steakhouse Prime USDC V2 | $14,203 | 3.0% |
| `base.alloc-a.no-rate-impact` | Aave V3 | $11,094 | 2.4% |
| `base.alloc-a.no-rate-impact` | Steakhouse USDC | $0 | 0.0% |
| `base.alloc-a.no-rate-impact` | All venues | $467,459 | 100.0% |
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
| `ethereum.alloc-a.no-rate-impact` | Fluid fUSDC | $140,930 | 31.6% |
| `ethereum.alloc-a.no-rate-impact` | Spark Savings sUSDC | $102,837 | 23.1% |
| `ethereum.alloc-a.no-rate-impact` | Morpho cbBTC market | $61,545 | 13.8% |
| `ethereum.alloc-a.no-rate-impact` | Compound V3 | $47,640 | 10.7% |
| `ethereum.alloc-a.no-rate-impact` | Aave V3 | $43,225 | 9.7% |
| `ethereum.alloc-a.no-rate-impact` | Morpho WBTC market | $25,103 | 5.6% |
| `ethereum.alloc-a.no-rate-impact` | Steakhouse USDC | $13,787 | 3.1% |
| `ethereum.alloc-a.no-rate-impact` | Gauntlet USDC Prime | $8,823 | 2.0% |
| `ethereum.alloc-a.no-rate-impact` | Steakhouse Prime USDC V2 | $1,502 | 0.3% |
| `ethereum.alloc-a.no-rate-impact` | Gauntlet USDC Prime V2 | $445 | 0.1% |
| `ethereum.alloc-a.no-rate-impact` | Vault Bridge USDC | $0 | 0.0% |
| `ethereum.alloc-a.no-rate-impact` | All venues | $445,836 | 100.0% |
| `ethereum.alloc-a.no-fluid` | Spark Savings sUSDC | $125,179 | 33.0% |
| `ethereum.alloc-a.no-fluid` | Morpho cbBTC market | $75,658 | 19.9% |
| `ethereum.alloc-a.no-fluid` | Aave V3 | $63,031 | 16.6% |
| `ethereum.alloc-a.no-fluid` | Morpho WBTC market | $38,607 | 10.2% |
| `ethereum.alloc-a.no-fluid` | Steakhouse USDC | $28,928 | 7.6% |
| `ethereum.alloc-a.no-fluid` | Compound V3 | $19,777 | 5.2% |
| `ethereum.alloc-a.no-fluid` | Gauntlet USDC Prime | $15,519 | 4.1% |
| `ethereum.alloc-a.no-fluid` | Steakhouse Prime USDC V2 | $7,222 | 1.9% |
| `ethereum.alloc-a.no-fluid` | Gauntlet USDC Prime V2 | $5,195 | 1.4% |
| `ethereum.alloc-a.no-fluid` | Vault Bridge USDC | $154 | 0.0% |
| `ethereum.alloc-a.no-fluid` | All venues | $379,270 | 100.0% |
| `ethereum.alloc-a.no-fluid-no-spark` | Aave V3 | $107,946 | 30.2% |
| `ethereum.alloc-a.no-fluid-no-spark` | Morpho cbBTC market | $85,089 | 23.8% |
| `ethereum.alloc-a.no-fluid-no-spark` | Steakhouse USDC | $51,070 | 14.3% |
| `ethereum.alloc-a.no-fluid-no-spark` | Morpho WBTC market | $48,137 | 13.5% |
| `ethereum.alloc-a.no-fluid-no-spark` | Gauntlet USDC Prime | $27,309 | 7.6% |
| `ethereum.alloc-a.no-fluid-no-spark` | Compound V3 | $22,947 | 6.4% |
| `ethereum.alloc-a.no-fluid-no-spark` | Steakhouse Prime USDC V2 | $6,821 | 1.9% |
| `ethereum.alloc-a.no-fluid-no-spark` | Gauntlet USDC Prime V2 | $5,854 | 1.6% |
| `ethereum.alloc-a.no-fluid-no-spark` | Vault Bridge USDC | $2,539 | 0.7% |
| `ethereum.alloc-a.no-fluid-no-spark` | All venues | $357,712 | 100.0% |

- Interest: the sum over the year of the venue's `interest_` column of `thesauros_simple` in `tangem-simulation-daily.csv`: what the venue paid on the position that day, before gas and before the fee. It is the growth of the venue's index between two readings, scaled by the measured ratio of its rate with our deposit to its rate without it and never above that growth. A fall of the index is a negative figure. No venue has one on any day of these runs.
- All venues: their sum. Less the gas of the year it is the yield before the fee of table 1.
- The script stops unless, on every day, the interest of the venues less `gas_spent_usd` and `fees_paid` is `daily_yield`, within the rounding of those columns to the cent.

## 8. Liquidity episodes
The days of `thesauros_simple` on which less than the whole balance could be withdrawn, consecutive days as one episode.

| Run | From | To | Days | Of them under half | Lowest share that could be withdrawn | Venues that held more than they had free |
|---|---|---|---|---|---|---|
| `base.alloc-a` | 2026-02-03 | 2026-02-04 | 2 | 2 | 31.15% on 2026-02-03 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $10.14M held |
| `base.alloc-a.no-rate-impact` | 2026-02-03 | 2026-02-04 | 2 | 2 | 31.15% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $10.15M held |
| `ethereum.alloc-a` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.14% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.16M held |
| `ethereum.alloc-a` | 2026-05-22 | 2026-05-22 | 1 | 0 | 92.44% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $4.07M held |
| `ethereum.alloc-a` | 2026-05-28 | 2026-05-31 | 4 | 1 | 40.01% on 2026-05-29 | Fluid fUSDC: at 6 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.11M held |
| `ethereum.alloc-a` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.10% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.13M held |
| `ethereum.alloc-a.no-rate-impact` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.09% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.17M held |
| `ethereum.alloc-a.no-rate-impact` | 2026-05-22 | 2026-05-22 | 1 | 1 | 32.41% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $10.20M held |
| `ethereum.alloc-a.no-rate-impact` | 2026-05-29 | 2026-05-31 | 3 | 1 | 40.01% on 2026-05-29 | Fluid fUSDC: at 5 readings, the lowest $0 free at 2026-05-29 16:17 UTC against $6.12M held |
| `ethereum.alloc-a.no-rate-impact` | 2026-06-29 | 2026-06-29 | 1 | 0 | 68.06% on 2026-06-29 | Fluid fUSDC: at 1 reading, the lowest $2.87M free at 2026-06-29 11:16 UTC against $6.14M held |
| `ethereum.alloc-a.no-fluid` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.16% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.16M held |
| `ethereum.alloc-a.no-fluid` | 2026-05-22 | 2026-05-22 | 1 | 1 | 33.11% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $10.11M held |
| `ethereum.alloc-a.no-fluid` | 2026-07-13 | 2026-07-13 | 1 | 0 | 94.46% on 2026-07-13 | Gauntlet USDC Prime V2: at 1 reading, the lowest $0.65M free at 2026-07-13 12:39 UTC against $1.21M held |
| `ethereum.alloc-a.no-fluid` | 2026-10-06 | 2026-10-06 | 1 | 0 | 87.35% on 2026-10-06 | Aave V3: at 1 reading, the lowest $8.98M free at 2026-10-07 00:00 UTC against $10.28M held |
| `ethereum.alloc-a.no-fluid-no-spark` | 2026-04-19 | 2026-04-19 | 1 | 0 | 86.41% on 2026-04-19 | Morpho cbBTC market: at 1 reading, the lowest $4.70M free at 2026-04-19 09:13 UTC against $6.08M held |
| `ethereum.alloc-a.no-fluid-no-spark` | 2026-04-23 | 2026-04-23 | 1 | 0 | 52.24% on 2026-04-23 | Aave V3: at 1 reading, the lowest $5.30M free at 2026-04-23 17:32 UTC against $10.14M held |
| `ethereum.alloc-a.no-fluid-no-spark` | 2026-05-22 | 2026-05-22 | 1 | 1 | 32.51% on 2026-05-22 | Aave V3: at 1 reading, the lowest $3.30M free at 2026-05-22 23:43 UTC against $10.16M held |
| `ethereum.alloc-a.no-fluid-no-spark` | 2026-07-13 | 2026-07-13 | 1 | 0 | 82.69% on 2026-07-13 | Gauntlet USDC Prime V2: at 1 reading, the lowest $0.65M free at 2026-07-13 12:39 UTC against $2.41M held |
| `ethereum.alloc-a.no-fluid-no-spark` | 2026-10-06 | 2026-10-06 | 1 | 0 | 87.48% on 2026-10-06 | Aave V3: at 1 reading, the lowest $8.98M free at 2026-10-07 00:00 UTC against $10.27M held |

- A day counts when `available_liquidity` is under `total_assets` in `tangem-simulation-daily.csv`; the share is one over the other. The days of this table are the days table 2 does not count as whole to the cent.
- Venues: at each reading of `raw.jsonl` on those days the vault's position in a venue, once the movements of that reading are made, is set against the venue's `liquidity` at that reading, and each day's closing position against the first reading after it; that is how `available_liquidity` is taken. A venue is named when its position was above its free liquidity at one of them, with the number of such readings and the one at which it had the least free. Positions are rebuilt as for the largest share in table 2.
- The script stops unless the lowest share so rebuilt for a day, of every day of the year, is within 0.1% of the balance of the share in the daily file.

## 9. Fee
What `thesauros_simple` would hold at another performance fee, worked out from the daily file of the run.

|  | `base.alloc-a` | `base.alloc-a.no-rate-impact` | `ethereum.alloc-a` | `ethereum.alloc-a.no-rate-impact` | `ethereum.alloc-a.no-fluid` | `ethereum.alloc-a.no-fluid-no-spark` |
|---|---|---|---|---|---|---|
| At a fee of 0%: balance at the end of the year, and yield | $10,460,288 (4.60%) | $10,469,617 (4.70%) | $10,408,088 (4.08%) | $10,447,875 (4.48%) | $10,380,182 (3.80%) | $10,358,673 (3.59%) |
| At a fee of 0%: against Just Aave | +$133,407 (+1.33 pp) | +$114,338 (+1.14 pp) | +$57,425 (+0.57 pp) | +$89,936 (+0.90 pp) | +$29,519 (+0.30 pp) | +$8,010 (+0.08 pp) |
| At a fee of 10%: balance at the end of the year, and yield | $10,413,324 (4.13%) | $10,421,683 (4.22%) | $10,366,543 (3.67%) | $10,402,202 (4.02%) | $10,341,524 (3.42%) | $10,322,236 (3.22%) |
| At a fee of 10%: against Just Aave | +$86,444 (+0.86 pp) | +$66,404 (+0.66 pp) | +$15,880 (+0.16 pp) | +$44,263 (+0.44 pp) | −$9,139 (−0.09 pp) | −$28,427 (−0.28 pp) |
| At a fee of 15%: balance at the end of the year, and yield | $10,389,921 (3.90%) | $10,397,797 (3.98%) | $10,345,832 (3.46%) | $10,379,440 (3.79%) | $10,322,249 (3.22%) | $10,304,065 (3.04%) |
| At a fee of 15%: against Just Aave | +$63,041 (+0.63 pp) | +$42,518 (+0.43 pp) | −$4,830 (−0.05 pp) | +$21,501 (+0.22 pp) | −$28,414 (−0.28 pp) | −$46,598 (−0.47 pp) |
| The fee the run was made at | 20% | 20% | 25% | 25% | 25% | 25% |
| At that fee, the run itself: balance at the end of the year, and yield | $10,366,571 (3.67%) | $10,373,967 (3.74%) | $10,304,535 (3.05%) | $10,334,066 (3.34%) | $10,283,806 (2.84%) | $10,267,820 (2.68%) |
| At that fee, the run itself: against Just Aave | +$39,690 (+0.40 pp) | +$18,688 (+0.19 pp) | −$46,128 (−0.46 pp) | −$23,874 (−0.24 pp) | −$66,857 (−0.67 pp) | −$82,843 (−0.83 pp) |
| At that fee: the balance worked out less the balance of the run | −$0.12 | −$0.04 | +$0.17 | −$0.14 | −$0.03 | $0.00 |
| The fee at which the balance worked out is that of Just Aave | 28.5% | 23.9% | 13.8% | 19.7% | 7.6% | 2.2% |

- A day's return before the fee: the sum of the `interest_` columns of the day less `gas_spent_usd`, over `total_assets` of the day before, the deposit for the first day. At a fee the balance of a day is the balance of the day before times one plus the return, less the fee's share of the return when it is positive. The year starts on the deposit.
- Yield: the balance less the deposit, in percent of the deposit. Against Just Aave: the same less the yield of Just Aave of table 1.
- At the fee the run was made at the arithmetic is the run itself, so those two rows show `total_assets` of the last day, as table 1 does. The script stops unless the balance worked out at that fee is within $1 of it: the files are in cents, and the row after shows what the rounding leaves.
- At 0% the yield is above the yield before the fee of table 1: that one adds the fees of the year to the yield, without what they would have earned had they stayed in the vault.
- The fee at which the balance is that of Just Aave: found by halving between 0% and 100% on the same arithmetic. The break-even fee of table 1 is its approximation in one line.
- The arithmetic keeps the returns of the run as they are. A run made at another fee differs: with a lower fee the vault is larger, so each venue pays a little less on a larger position and a move is decided on other amounts.

## 10. Venues held
`thesauros_simple`, at each day's close.

|  | `base.alloc-a` | `base.alloc-a.no-rate-impact` | `ethereum.alloc-a` | `ethereum.alloc-a.no-rate-impact` | `ethereum.alloc-a.no-fluid` | `ethereum.alloc-a.no-fluid-no-spark` |
|---|---|---|---|---|---|---|
| Days with 1 venue | 1 | 1 | 19 | 19 | 25 | 78 |
| Days with 2 venues | 143 | 127 | 117 | 152 | 104 | 65 |
| Days with 3 venues | 209 | 235 | 78 | 60 | 105 | 158 |
| Days with 4 venues | 12 | 2 | 115 | 111 | 99 | 52 |
| Days with 5 venues | 0 | 0 | 34 | 18 | 30 | 12 |
| Days with 6 venues | 0 | 0 | 2 | 5 | 1 | 0 |
| Days with 7 venues | 0 | 0 | 0 | 0 | 1 | 0 |
| Venues held, mean over the days | 2.64 | 2.65 | 3.09 | 2.92 | 3.03 | 2.60 |
| Largest share of the vault in one venue | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-02 |
| The most the entry provider held | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-05 | 100.00% in Aave V3 on 2025-11-02 |

- A venue is held on a day when its column of `tangem-simulation-daily.csv` is 1% of the vault or more at that day's close. The rows go up to the most venues any run held on one day.
- Largest share: the highest venue column of the year, with its venue and the first day it is reached. The entry provider is `entry_provider` of the config, where a deposit lands. The allocator does not cap it, so it can hold the whole vault; under the public vault's rules a rebalance caps it as it caps every venue.
- The cap of 60% of the vault acts when a rebalance executes: between two rebalances a venue that earns more than the others stands a little above it.
- The allocator has no minimum of two venues. On the days of an allocator run with one venue, that venue is Aave V3, the entry provider, which it does not cap.

## 11. Movements against the source's own free liquidity and interest that could not be withdrawn
What `thesauros_simple` took out of a venue beyond the venue's own free liquidity, and the interest it was credited in a venue on days the venue could not have paid its position out.

|  | `base.alloc-a` | `base.alloc-a.no-rate-impact` | `ethereum.alloc-a` | `ethereum.alloc-a.no-rate-impact` | `ethereum.alloc-a.no-fluid` | `ethereum.alloc-a.no-fluid-no-spark` |
|---|---|---|---|---|---|---|
| Movements that took out more than the source venue had free without us | 0 | 0 | 0 | 0 | 0 | 0 |
| Their amount | $0 | $0 | $0 | $0 | $0 | $0 |
| Their sources, with the movements of each | — | — | — | — | — | — |
| `thesauros_simple`: interest credited on venue-days short of liquidity | $1,065 | $1,847 | $8,569 | $9,969 | $3,367 | $3,848 |
| `thesauros_simple`: its share of the interest of the year | 0.2% | 0.4% | 2.1% | 2.2% | 0.9% | 1.1% |
| `thesauros_simple`: such venue-days | 2 | 2 | 7 | 6 | 4 | 5 |
| `thesauros_simple`: their venues, with the days of each | Aave V3 2 | Aave V3 2 | Fluid fUSDC 5, Aave V3 2 | Fluid fUSDC 4, Aave V3 2 | Aave V3 3, Gauntlet USDC Prime V2 1 | Aave V3 3, Morpho cbBTC market 1, Gauntlet USDC Prime V2 1 |

The same interest for the four controls, which sit in venues through such days too:

|  | `base.alloc-a` | `base.alloc-a.no-rate-impact` | `ethereum.alloc-a` | `ethereum.alloc-a.no-rate-impact` | `ethereum.alloc-a.no-fluid` | `ethereum.alloc-a.no-fluid-no-spark` |
|---|---|---|---|---|---|---|
| `first_split_held`: interest credited on venue-days short of liquidity | $330 | $505 | $0 | $0 | $0 | $0 |
| `first_split_held`: its share of the interest of the year | 0.1% | 0.1% | 0.0% | 0.0% | 0.0% | 0.0% |
| `first_split_held`: such venue-days | 1 | 1 | 0 | 0 | 0 | 0 |
| `first_split_held`: their venues, with the days of each | Spark USDC Vault 1 | Spark USDC Vault 1 | — | — | — | — |
| `eligible_equal_weight`: interest credited on venue-days short of liquidity | $0 | $0 | $3,712 | $3,783 | $3,869 | $4,555 |
| `eligible_equal_weight`: its share of the interest of the year | 0.0% | 0.0% | 1.0% | 1.0% | 1.1% | 1.3% |
| `eligible_equal_weight`: such venue-days | 0 | 0 | 14 | 14 | 14 | 14 |
| `eligible_equal_weight`: their venues, with the days of each | — | — | Aave V3 12, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 12, Fluid fUSDC 1, Gauntlet USDC Prime V2 1 | Aave V3 13, Gauntlet USDC Prime V2 1 | Aave V3 13, Gauntlet USDC Prime V2 1 |
| `just_aave`: interest credited on venue-days short of liquidity | $4,605 | $5,768 | $34,352 | $35,911 | $34,352 | $34,352 |
| `just_aave`: its share of the interest of the year | 1.4% | 1.6% | 9.8% | 10.0% | 9.8% | 9.8% |
| `just_aave`: such venue-days | 4 | 4 | 23 | 23 | 23 | 23 |
| `just_aave`: their venues, with the days of each | Aave V3 4 | Aave V3 4 | Aave V3 23 | Aave V3 23 | Aave V3 23 | Aave V3 23 |
| `just_best_vault`: interest credited on venue-days short of liquidity | $0 | $0 | $1,675 | $2,435 | $1,675 | $1,675 |
| `just_best_vault`: its share of the interest of the year | 0.0% | 0.0% | 0.5% | 0.7% | 0.5% | 0.5% |
| `just_best_vault`: such venue-days | 0 | 0 | 2 | 2 | 2 | 2 |
| `just_best_vault`: their venues, with the days of each | — | — | Morpho cbBTC market 2 | Morpho cbBTC market 2 | Morpho cbBTC market 2 | Morpho cbBTC market 2 |

- More than the source had free: the movements of table 2, rows of `tangem-simulation-rebalances.csv` with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid. The run lets such a movement execute: it takes our own deposit to be payable next to that liquidity, in whole with rate impact on and in the liquid share of the venue with it off. Whether the venue would have paid it on chain is not in the history.
- Interest on venue-days short of liquidity: the simulator credits the growth of a venue's index whether or not the venue could have paid the vault out. A venue-day counts when the position in the venue is above the venue's `liquidity` at a reading of `raw.jsonl` on that day, once the movements of that reading are made, or when the day's closing position is above its `liquidity` at the first reading after the close. That is how table 8 names its venues and how `available_liquidity` is taken, so a venue that was short while the vault held it counts whether or not it was still held at the close. The figure is the sum of the venue's `interest_` column over such days. It is the interest of the whole day, the finest the daily file has: the most that was credited while the venue was short, with the hours of such a day on which the venue could have paid in it.
- Share: of the sum of every `interest_` column of the strategy over the year, in which a fall of an index is the negative figure it is. Positions are rebuilt as for the largest share in table 2, and a position under 0.01% of the deposit is not weighed.
- A control is credited the same way, so its yield in table 1 has this interest in it. Its positions are rebuilt from its own days and its own movements in `tangem-simulation-rebalances.csv`; `just_aave` and `just_best_vault` have none. For every strategy the script stops unless the lowest share of the balance so payable on a day is within 0.1% of the balance of `available_liquidity` over `total_assets` in the daily file.
- —: no such movement, or no such venue-day.
