# Figures of the Tangem pack
Written by `reproduce/figures.js` (its source is `reproduce/src/pack-figures.ts`) from the files `reproduce/simulate.js` writes and from `raw.jsonl` and `venue-eligibility.csv` under `reproduce/data/tangem/<network>/`. Do not edit: run the script again.
A run is named by its config: `base.deployed` is `config.base.deployed.json`. `simulate.js` writes the files of a run to the output folder of the table, under `reproduce/data/tangem/<network>/`. The pack has the same files, byte for byte, in the run folder of the table; a run without one is in the pack as its config only.

| Run | Config | Network | Output folder of `simulate.js` | Run folder of the pack | Venues | Fee | Rate impact | Limit on our share of a venue | Venue rule |
|---|---|---|---|---|---|---|---|---|---|
| `base.alloc-a` | `config.base.alloc-a.json` | Base | `simulation-alloc-a` | `base-allocator-set-a/simulation` | Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Steakhouse Prime USDC, Spark USDC Vault, Steakhouse Prime USDC V2, Morpho cbBTC market | 20% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `base.alloc-a.measured` | `config.base.alloc-a.measured.json` | Base | `simulation-alloc-a-measured` | `base-allocator-set-a-measured/simulation` | Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Steakhouse Prime USDC, Spark USDC Vault, Steakhouse Prime USDC V2, Morpho cbBTC market | 20% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `base.alloc-strict` | `config.base.alloc-strict.json` | Base | `simulation-alloc-strict` | `base-allocator-strict-set/simulation` | Aave V3, Morpho cbBTC market | 20% | on | 10% | `in_set` of `venue-eligibility.csv` |
| `base.alloc-b` | `config.base.alloc-b.json` | Base | `simulation-alloc-b` | `base-allocator-set-b/simulation` | Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Steakhouse Prime USDC, Spark USDC Vault, Steakhouse Prime USDC V2, Steakhouse High Yield USDC V2, Morpho cbBTC market, Morpho USDe market, Morpho HERMES market | 20% | on | 10% | `in_set_broad` of `venue-eligibility.csv` |
| `base.alloc-b.measured` | `config.base.alloc-b.measured.json` | Base | `simulation-alloc-b-measured` | `base-allocator-set-b-measured/simulation` | Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Steakhouse Prime USDC, Spark USDC Vault, Steakhouse Prime USDC V2, Steakhouse High Yield USDC V2, Morpho cbBTC market, Morpho USDe market, Morpho HERMES market | 20% | on | 10% | `in_set_broad` of `venue-eligibility.csv` |
| `base.public-a` | `config.base.public-a.json` | Base | `simulation-public-a` | `base-public-rules-set-a/simulation` | Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Steakhouse Prime USDC, Spark USDC Vault, Steakhouse Prime USDC V2, Morpho cbBTC market | 20% | on | 10% | `in_set_vaults_kept` of `venue-eligibility.csv` |
| `base.deployed` | `config.base.deployed.json` | Base | `simulation-deployed` | `base-vault-as-deployed/simulation` | Compound V3, Aave V3, Steakhouse High Yield USDC, Steakhouse Prime USDC, Gauntlet USDC Core | 20% | on | none | none |

- Rate impact: `rate_impact_enabled` of the config. On: a position earns the rate the deposit probes measured with it in the venue, and the venue can pay it out next to its own liquidity. Off: the deposit moves no rate, and the venue pays its liquid share of itself with the position in it.
- Limit on our share of a venue: `max_share_of_venue_percent` of the config. A venue takes no new money while a full position, 60% of the vault, would be more than that share of the venue with the position in it, and what the vault holds there leaves when the decision moves it and the move can execute. The allocator also keeps what it aims to hold in a venue within that share of it, the entry provider excepted. The limit is tested when a move is decided: a venue that shrinks under a position the vault cannot take out leaves the vault above it, and the largest share of table 2 is the share the vault reached.

## 1. Result
Yield for the year on the deposit, in USD and in percent of the deposit.

|  | `base.alloc-a` | `base.alloc-a.measured` | `base.alloc-strict` | `base.alloc-b` | `base.alloc-b.measured` | `base.public-a` | `base.deployed` |
|---|---|---|---|---|---|---|---|
| Decision of Thesauros Simple | allocator, production's constants | allocator, measured exponents | allocator, production's constants | allocator, production's constants | allocator, measured exponents | public vault's rules | public vault's rules |
| Venue set | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | the strict set: `in_set` of `venue-eligibility.csv` | set B: `in_set_broad` of `venue-eligibility.csv` | set B: `in_set_broad` of `venue-eligibility.csv` | set A: `in_set_vaults_kept` of `venue-eligibility.csv` | no rule: the venues of the config, all year |
| Liquidity rule | on | on | on | on | on | on | off |
| Just Aave: all in Aave V3, never moved | $326,880 (3.27%) | $326,880 (3.27%) | $326,880 (3.27%) | $326,880 (3.27%) | $326,880 (3.27%) | $326,880 (3.27%) | $326,880 (3.27%) |
| First split held: the first allocation, never rebalanced, no fee | $436,635 (4.37%) | $436,635 (4.37%) | $413,981 (4.14%) | $436,635 (4.37%) | $436,635 (4.37%) | $436,680 (4.37%) | $465,125 (4.65%) |
| Eligible equal weight: equal parts over the venues allowed, no fee | $414,203 (4.14%) | $414,203 (4.14%) | $401,463 (4.01%) | $408,914 (4.09%) | $408,914 (4.09%) | $414,203 (4.14%) | $411,779 (4.12%) |
| Thesauros Simple before its fee | $458,213 (4.58%) | $459,130 (4.59%) | $412,491 (4.12%) | $458,213 (4.58%) | $459,130 (4.59%) | $456,798 (4.57%) | $456,117 (4.56%) |
| Choosing by rate added, against first split held | +$21,578 (+0.22 pp) | +$22,495 (+0.22 pp) | −$1,489 (−0.01 pp) | +$21,578 (+0.22 pp) | +$22,495 (+0.22 pp) | +$20,118 (+0.20 pp) | −$9,009 (−0.09 pp) |
| Choosing by rate added, against eligible equal weight | +$44,011 (+0.44 pp) | +$44,927 (+0.45 pp) | +$11,028 (+0.11 pp) | +$49,299 (+0.49 pp) | +$50,216 (+0.50 pp) | +$42,596 (+0.43 pp) | +$44,338 (+0.44 pp) |
| Months ahead of eligible equal weight, before the fee: months from the 7th to the 6th | 12 of 12 | 12 of 12 | 12 of 12 | 12 of 12 | 12 of 12 | 12 of 12 | 9 of 12 |
| Months ahead of eligible equal weight, before the fee: calendar months | 13 of 13 | 13 of 13 | 13 of 13 | 13 of 13 | 13 of 13 | 13 of 13 | 9 of 13 |
| Performance fee | $91,643 (20% of each positive day) | $91,826 (20% of each positive day) | $82,498 (20% of each positive day) | $91,643 (20% of each positive day) | $91,826 (20% of each positive day) | $91,360 (20% of each positive day) | $91,223 (20% of each positive day) |
| Thesauros Simple after its fee | $366,571 (3.67%) | $367,304 (3.67%) | $329,993 (3.30%) | $366,571 (3.67%) | $367,304 (3.67%) | $365,439 (3.65%) | $364,893 (3.65%) |
| Just Best Vault: all in the venue with the highest rate on day one | $457,845 (4.58%) | $457,845 (4.58%) | $457,845 (4.58%) | $457,845 (4.58%) | $457,845 (4.58%) | $457,845 (4.58%) | $449,622 (4.50%) |
| The venue Just Best Vault picked | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Steakhouse Prime USDC |
| Thesauros Simple after its fee, against Just Aave | +$39,690 (+0.40 pp) | +$40,424 (+0.40 pp) | +$3,113 (+0.03 pp) | +$39,690 (+0.40 pp) | +$40,424 (+0.40 pp) | +$38,558 (+0.39 pp) | +$38,013 (+0.38 pp) |
| After its fee, against first split held | −$70,064 (−0.70 pp) | −$69,331 (−0.69 pp) | −$83,988 (−0.84 pp) | −$70,064 (−0.70 pp) | −$69,331 (−0.69 pp) | −$71,242 (−0.71 pp) | −$100,232 (−1.00 pp) |
| After its fee, against eligible equal weight | −$47,632 (−0.48 pp) | −$46,899 (−0.47 pp) | −$71,470 (−0.71 pp) | −$42,344 (−0.42 pp) | −$41,610 (−0.42 pp) | −$48,764 (−0.49 pp) | −$46,885 (−0.47 pp) |
| Break-even fee: the fee at which Thesauros Simple equals Just Aave | about 29% | about 29% | about 21% | about 29% | about 29% | about 28% | about 28% |

- A yield is `total_assets` of the last day of `tangem-simulation-daily.csv` minus the deposit.
- Before its fee: the yield of `thesauros_simple` plus the sum of its `fees_paid`. The fee is that sum.
- Choosing by rate added: the yield before the fee minus the yield of the control. `first_split_held` keeps a venue that later leaves the set, so under a venue rule its difference also carries what the rule costs; `eligible_equal_weight` follows the rule.
- Months ahead: a month counts when the sum of `daily_yield` and `fees_paid` of `thesauros_simple` over its days is above the sum of `daily_yield` of `eligible_equal_weight`. It is counted two ways, and each cell says of how many: by the months of the venue rule, which run from the 7th to the 6th, and by the calendar months the year touches, of which the first and the last are touched in part.
- After its fee, against a control: the yield of `thesauros_simple` minus the yield of the control, which pays no Thesauros fee.
- The venue of Just Best Vault is the venue column that is 100 on its first day.
- Break-even fee: (yield before the fee − yield of Just Aave) / yield before the fee, to the whole percent. It is an approximation: the fee is charged on each positive day and the balance compounds, which the formula leaves out.
- Decision: `policy` and `impact_exponent` of the config. The public vault's rules are the decision of the vault as deployed, with RiskGuard's rules around it: at most 60% of the vault in a venue, at least two venues, the circuit breaker, the anomaly gate and the cooldown. The allocator is the water-filling step of the Thesauros cross-chain planner, which is not live for the public vaults. It prices the vault's own deposit in each venue with the exponent production has for the venue's protocol: 2 for Aave V3 and Compound V3, 1.75 for Morpho, which a Morpho Vault V2 and a single Morpho Blue market also take. With measured exponents it is the exponent that reproduces the $10M deposit probe of the reading; a reading that measures none leaves the venue's last one, and the constant before the first. Of RiskGuard's rules the allocator runs keep one, by choice: at most 60% of the vault in a venue, the entry provider excepted, which has no limit. They apply no minimum of two venues, no circuit breaker, no anomaly gate and no cooldown: the planner's step has none of them.
- Venue set: the column of `venue-eligibility.csv` the `eligible_periods` of the config are, as in the table of the runs. `in_set` is the strict set, `in_set_vaults_kept` is set A, `in_set_broad` is set B of `PROGRAMME.md`.
- Liquidity rule: `liquidity_rule` of the config. On: a venue whose own free liquidity at a reading is below a full position of the vault, 60% of the vault at that reading, takes no new money at that reading.
- Just Best Vault takes the venue with the highest `rate` at the first reading among the venues that are in the set that day and accept the whole deposit. The liquidity rule and the limit on our share of a venue do not bind it, nor Just Aave: they bind `thesauros_simple`, `first_split_held` up to its first rebalance and `eligible_equal_weight`.
- `base.alloc-b` and `base.alloc-a` are one run of `thesauros_simple`: the same `total_assets` and `fees_paid` on every day and the same movements. The venues only one of them has are at 0.00% of the vault on every day: Steakhouse High Yield USDC V2 of `base.alloc-b`, Morpho USDe market of `base.alloc-b`, Morpho HERMES market of `base.alloc-b`. Of their controls, `eligible_equal_weight` ends on another balance.
- `base.alloc-b.measured` and `base.alloc-a.measured` are one run of `thesauros_simple`: the same `total_assets` and `fees_paid` on every day and the same movements. The venues only one of them has are at 0.00% of the vault on every day: Steakhouse High Yield USDC V2 of `base.alloc-b.measured`, Morpho USDe market of `base.alloc-b.measured`, Morpho HERMES market of `base.alloc-b.measured`. Of their controls, `eligible_equal_weight` ends on another balance.

## 2. What the vault did
`thesauros_simple` only, except the last four rows: the last five are one a strategy.

|  | `base.alloc-a` | `base.alloc-a.measured` | `base.alloc-strict` | `base.alloc-b` | `base.alloc-b.measured` | `base.public-a` | `base.deployed` |
|---|---|---|---|---|---|---|---|
| Rebalances (transactions) | 66 | 13 | 32 | 66 | 13 | 75 | 392 |
| Movements of funds | 153 | 28 | 32 | 153 | 28 | 197 | 807 |
| Movements a rebalance, mean | 2.32 | 2.15 | 1.00 | 2.32 | 2.15 | 2.63 | 2.06 |
| Rebalances that reverse the previous one within 24 hours | 34 | 2 | 1 | 34 | 2 | 50 | 315 |
| The same, counting movements of any size | 34 | 2 | 1 | 34 | 2 | 50 | 328 |
| Of the rebalances that reverse the previous one, counting movements of at least $10,000: those that send back under half of what it moved | 0 | 0 | 0 | 0 | 0 | 0 | 42 |
| Rebalances after which the vault's rate was lower than before | 29 | 3 | 28 | 29 | 3 | 36 | 191 |
| Rebalances a decision priced | 63 | 10 | 5 | 63 | 10 | 75 | 392 |
| Of them, the vault's rate was lower after the move | 27 | 0 | 1 | 27 | 0 | 36 | 191 |
| Of them, the realized change was under the gain the move had to expect: 0.25 pp under the public vault's rules, 0.05 pp for the allocator | 52 | 0 | 1 | 52 | 0 | 72 | 204 |
| Of them, the realized change was under the expected gain | 58 | 2 | 2 | 58 | 2 | 74 | 381 |
| Mean expected gain of the priced rebalances | 0.19 pp | 0.25 pp | 0.33 pp | 0.19 pp | 0.25 pp | 0.34 pp | 0.95 pp |
| Mean realized change of the priced rebalances | 0.04 pp | 0.28 pp | 0.21 pp | 0.04 pp | 0.28 pp | 0.04 pp | 0.03 pp |
| Rebalances that take a venue back under the provider cap, which no gain decided | 2 | 2 | 27 | 2 | 2 | 0 | 0 |
| Movements that are forced exits | 1 | 3 | 0 | 1 | 3 | 0 | 0 |
| Movements sent in the transaction of a forced exit | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| Movements that took out more than the source venue had free without us | 0 | 0 | 0 | 0 | 0 | 0 | 435 |
| Movements under $1,000 | 6 | 0 | 0 | 6 | 0 | 50 | 121 |
| Movements whose gas cost was above the amount moved | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Legs refused | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Gas for the year | $2.15 | $1.45 | $0.50 | $2.15 | $1.45 | $3.99 | $11.66 |
| Gas for the year, as the daily file has it | $2.16 | $1.45 | $0.48 | $2.16 | $1.45 | $3.98 | $11.64 |
| Days on which the whole balance could be withdrawn, to the cent | 363 of 365 | 362 of 365 | 363 of 365 | 363 of 365 | 362 of 365 | 362 of 365 | 40 of 365 |
| Days on which the whole balance could be withdrawn, within 0.01% of the balance | 363 of 365 | 362 of 365 | 363 of 365 | 363 of 365 | 362 of 365 | 362 of 365 | 41 of 365 |
| Days on which less than half could be withdrawn | 2 of 365 | 0 of 365 | 2 of 365 | 2 of 365 | 0 of 365 | 0 of 365 | 131 of 365 |
| Largest share of a venue we would have been | 2.6% of Aave V3 on 2026-02-03 | 6.4% of Steakhouse Prime USDC on 2026-07-29 | 2.6% of Aave V3 on 2026-02-03 | 2.6% of Aave V3 on 2026-02-03 | 6.4% of Steakhouse Prime USDC on 2026-07-29 | 5.2% of Steakhouse Prime USDC V2 on 2026-05-10 | 89.4% of Steakhouse High Yield USDC on 2026-10-02 |
| Average share of the vault per venue | Morpho cbBTC market 52.3%, Gauntlet USDC Prime 23.9%, Steakhouse Prime USDC 8.9%, Spark USDC Vault 6.7%, Steakhouse Prime USDC V2 5.8%, Aave V3 2.4%, Steakhouse USDC 0.0% | Morpho cbBTC market 39.4%, Gauntlet USDC Prime 27.7%, Steakhouse Prime USDC 12.9%, Steakhouse Prime USDC V2 11.3%, Spark USDC Vault 6.7%, Aave V3 2.1%, Steakhouse USDC 0.0% | Morpho cbBTC market 58.9%, Aave V3 41.1% | Morpho cbBTC market 52.3%, Gauntlet USDC Prime 23.9%, Steakhouse Prime USDC 8.9%, Spark USDC Vault 6.7%, Steakhouse Prime USDC V2 5.8%, Aave V3 2.4%, Steakhouse USDC 0.0%, Steakhouse High Yield USDC V2 0.0%, Morpho USDe market 0.0%, Morpho HERMES market 0.0% | Morpho cbBTC market 39.4%, Gauntlet USDC Prime 27.7%, Steakhouse Prime USDC 12.9%, Steakhouse Prime USDC V2 11.3%, Spark USDC Vault 6.7%, Aave V3 2.1%, Steakhouse USDC 0.0%, Steakhouse High Yield USDC V2 0.0%, Morpho USDe market 0.0%, Morpho HERMES market 0.0% | Morpho cbBTC market 38.9%, Gauntlet USDC Prime 32.5%, Steakhouse Prime USDC 11.9%, Steakhouse Prime USDC V2 8.5%, Spark USDC Vault 6.7%, Aave V3 1.5%, Steakhouse USDC 0.0% | Steakhouse High Yield USDC 52.1%, Steakhouse Prime USDC 36.9%, Compound V3 5.8%, Gauntlet USDC Core 3.5%, Aave V3 1.7% |
| Outside the set: `thesauros_simple` | 0 | 0 | 0 | 0 | 0 | 0 | no rule in this run |
| Outside the set: `first_split_held` | 212 venue-days on 212 days, up to 39.96% of the balance | 212 venue-days on 212 days, up to 39.96% of the balance | 0 | 212 venue-days on 212 days, up to 39.96% of the balance | 212 venue-days on 212 days, up to 39.96% of the balance | 212 venue-days on 212 days, up to 39.95% of the balance | no rule in this run |
| Outside the set: `eligible_equal_weight` | 0 | 0 | 0 | 0 | 0 | 0 | no rule in this run |
| Outside the set: `just_aave` | 0 | 0 | 0 | 0 | 0 | 0 | no rule in this run |
| Outside the set: `just_best_vault` | 0 | 0 | 0 | 0 | 0 | 0 | no rule in this run |

- Rebalances: distinct `tx` of `tangem-simulation-rebalances.csv`; movements: its rows.
- Reverses the previous one: the rebalance comes at most 24 hours after the one before it and has a movement of at least $10,000 from B to A where the one before had a movement of at least $10,000 from A to B. Smaller movements are left out: a rebalance of the public vault's rules evens out positions by a few dollars next to its main movements, and such a remainder running the other way is not money sent back. The next row counts them too.
- Under half of what it moved: one movement running back is enough for a rebalance to count as reversing the previous one, so it need not undo it. What a rebalance sends back is its movements of at least $10,000 along a path the previous one used the other way with a movement of at least $10,000, each up to what the previous one sent along that path. The row counts the rebalances of the first of the two rows above that send back under half of all the previous one moved.
- Rate lower than before: `realized_change_pp` below zero, counted once a transaction.
- A decision priced: the rebalance has an `expected_gain_pp` and is no move back under the provider cap. Under the public vault's rules the decision compared the rates as they stood before the move and expected at least 0.25 pp a year. The allocator priced the vault's own deposit in each venue and expected at least 0.05 pp of the vault a year, from a plan that fills the same venues and drains the same venues, by at least $1,000 each, at 2 readings in a row, which are 4 hours apart in this history; the amounts may differ between the readings. In both `realized_change_pp` is the vault's rate with our positions in place after the move less the same before it. No decision priced a rebalance without an `expected_gain_pp`: in these runs the `reason` of its movements is "forced exit: the venue is too small for a full position" or "moved in the transaction of a forced exit". The five rows that follow count the priced ones only, one value a transaction; the means are over them.
- Back under the provider cap: rebalances whose `reason` begins with "back under the provider cap". Only the allocator makes them: a venue other than its entry provider that has grown above the cap gives up the excess whatever the move earns. Such a rebalance has an `expected_gain_pp`: what the allocator expects the move to change, which may be a loss, and not a gain it had to reach. So it is not counted as priced. The public vault's rules apply the cap inside every rebalance and have no such move.
- Forced exits: movements whose `reason` begins with "forced exit": they leave a venue the decision read as paying nothing, and the `reason` says why. Sent in the transaction of a forced exit: the other movements of that transaction, by their `reason`. Movements a rebalance: the movements over the rebalances.
- More than the source had free: rows with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid.
- Movements under $1,000: rows with `amount` below it. A rebalance of the public vault's rules evens out positions by such remainders next to its main movements. A plan of the allocator that a gain decided has no movement under $10 and moves at least $1,000 in all, and the script stops on one that does not: the allocator's movements under $1,000 are parts of such a plan. Gas above the amount: rows with `gas_cost_usd` above `amount`.
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

|  | `base.alloc-a` | `base.alloc-a.measured` | `base.alloc-strict` | `base.alloc-b` | `base.alloc-b.measured` | `base.public-a` | `base.deployed` |
|---|---|---|---|---|---|---|---|
| First day of every scenario | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 | 2026-04-07, day 183 |
| `no_stress`: venue hit | — | — | — | — | — | — | — |
| `no_stress`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `no_stress`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| `no_stress`: balance at year end | $10,366,571 | $10,367,304 | $10,329,993 | $10,366,571 | $10,367,304 | $10,365,439 | $10,364,893 |
| `depeg`: venue hit | — | — | — | — | — | — | — |
| `depeg`: largest loss | $508,970 (4.99%) | $508,970 (4.99%) | $508,095 (4.99%) | $508,970 (4.99%) | $508,970 (4.99%) | $508,955 (4.99%) | $509,178 (4.99%) |
| `depeg`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| `depeg`: balance at year end | $10,366,571 | $10,367,304 | $10,329,993 | $10,366,571 | $10,367,304 | $10,365,439 | $10,364,893 |
| `depeg`: balance at year end, against `no_stress` | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| `curator_bad_debt`: venue hit | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Gauntlet USDC Prime | Steakhouse High Yield USDC |
| `curator_bad_debt`: largest loss | $610,631 (5.99%) | $338,966 (3.32%) | $609,597 (5.99%) | $610,631 (5.99%) | $338,966 (3.32%) | $610,715 (5.99%) | $611,135 (5.99%) |
| `curator_bad_debt`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| `curator_bad_debt`: balance at year end | $9,744,958 | $10,021,923 | $9,710,649 | $9,744,958 | $10,021,923 | $9,743,978 | $9,743,656 |
| `curator_bad_debt`: balance at year end, against `no_stress` | −$621,612 | −$345,381 | −$619,344 | −$621,612 | −$345,381 | −$621,461 | −$621,237 |
| `protocol_hack`: venue hit | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Gauntlet USDC Prime | Steakhouse High Yield USDC |
| `protocol_hack`: largest loss | $6,115,518 (59.99%) | $3,398,877 (33.34%) | $6,104,168 (59.99%) | $6,115,518 (59.99%) | $3,398,877 (33.34%) | $6,116,355 (60.00%) | $6,121,677 (60.01%) |
| `protocol_hack`: days until everything can be withdrawn | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `protocol_hack`: balance at year end | $4,148,717 | $6,910,671 | $4,123,624 | $4,148,717 | $6,910,671 | $4,146,906 | $4,142,920 |
| `protocol_hack`: balance at year end, against `no_stress` | −$6,217,854 | −$3,456,633 | −$6,206,369 | −$6,217,854 | −$3,456,633 | −$6,218,533 | −$6,221,974 |
| `withdrawal_freeze`: venue hit | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Morpho cbBTC market | Gauntlet USDC Prime | Steakhouse High Yield USDC |
| `withdrawal_freeze`: largest loss | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) | $0 (0.00%) |
| `withdrawal_freeze`: days until everything can be withdrawn | 30 | 30 | 30 | 30 | 30 | 30 | 32 |
| `withdrawal_freeze`: balance at year end | $10,366,674 | $10,367,304 | $10,329,993 | $10,366,674 | $10,367,304 | $10,365,397 | $10,365,990 |
| `withdrawal_freeze`: balance at year end, against `no_stress` | +$103 | $0 | $0 | +$103 | $0 | −$41 | +$1,097 |

- Columns `provider_hit`, `max_loss_usd` and `max_loss_percent` (against the value on the day before the event), `time_to_exit_days`, `final_balance_usd`, `final_balance_vs_no_stress_usd`. The depeg loss and balance are in USD value; the others in USDC.
- Against `no_stress`: `final_balance_vs_no_stress_usd`, the balance at year end less the balance of the run without the event.
- The scenarios, by `stress` of the config: `depeg` values a USDC at $0.95 for 14 days and hits no venue (—); `curator_bad_debt` takes 10% of the position in the venue hit; `protocol_hack` takes 100% of it, and the venue pays nothing afterwards; `withdrawal_freeze` lets nothing out of the venue hit for 30 days.
- Venue hit: `provider_hit`, the venue `provider` of the scenario names in the config, taken on the first day: `largest` is the venue with the vault's largest position that day, `largest_morpho` the largest among the curated Morpho vaults. `curator_bad_debt` takes `largest` in `base.alloc-a`, `base.alloc-a.measured`, `base.alloc-strict`, `base.alloc-b`, `base.alloc-b.measured`, `base.public-a` and `largest_morpho` in `base.deployed`; `protocol_hack` takes `largest` in every run; `withdrawal_freeze` takes `largest` in every run.
- `curator_bad_debt` hits a venue that has no curator in `base.alloc-a` (Morpho cbBTC market), `base.alloc-a.measured` (Morpho cbBTC market), `base.alloc-strict` (Morpho cbBTC market), `base.alloc-b` (Morpho cbBTC market), `base.alloc-b.measured` (Morpho cbBTC market): there it is the loss of 10% of the vault's largest position, whatever the venue is.

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
| Steakhouse High Yield USDC V2 | `0xbeeff2490FEffa212faC2f6553682C219E6a8845` | 2.92% a year; 1.25% from 2026-05-01 to 2026-10-07: the venue has no reading before | 3.01% | 2.32% | 2.21% | $0 to $464M | $0 | 0 of 12 | 0 of 12 | 3 of 12 | no: needs a new adapter (Morpho Vault V2) |
| Morpho USDe market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354` | 3.54% a year; 1.27% from 2026-05-27 to 2026-10-07: the venue has no reading before | 3.66% | 2.89% | 2.81% | $1 to $395M | $0 | 0 of 12 | 0 of 12 | 3 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Morpho HERMES market | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`, market `0xe1986e80099257c65dd18091ec7e34752ae2336870a5649f20c450c9c4931fb8` | 87212.86% a year; 4427.59% from 2026-03-15 to 2026-10-07: the venue has no reading before | 9743.10% | 1370.23% | 666.84% | $5.0M to $226M | $0 | 0 of 12 | 0 of 12 | 1 of 12 | no: needs a new adapter (single Morpho Blue market) |
| Compound V3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | 4.07% | 3.99% | 2.04% | 1.66% | $8.2M to $19M | $0.5M | 0 of 12 | 0 of 12 | 0 of 12 | yes: a provider of the live vault |
| Steakhouse High Yield USDC | `0xBEEFA7B88064FeEF0cEe02AAeBBd95D30df3878F` | 5.28% | 5.31% | 4.76% | 4.57% | $0.7M to $25M | $0.3M | 0 of 12 | 0 of 12 | 0 of 12 | yes: a provider of the live vault |
| Gauntlet USDC Core | `0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12` | 4.26% | 4.30% | 4.20% | 4.16% | $1.5M to $8.2M | $0.8M | 0 of 12 | 0 of 12 | 0 of 12 | yes: a provider of the live vault |

- Contract: the Aave pool, the Comet, the vault or the token; for a single Morpho Blue market, Morpho Blue and the market id.
- Index growth: the last `index` over the first, minus one, raised to a year by the seconds between the two readings. It is what a deposit in the venue earned, a fall of the index included. For a venue whose first reading is later than the first of the window both figures are shown: the growth raised to a year, and the growth between its two readings, which is all a deposit could have earned there.
- Average rate: the mean of `rate` over the readings. With $6M and $10M of ours: the mean of `rateAfter6` and `rateAfter10`, the rate read back after that deposit, over the readings at which the venue took it.
- Size: the lowest and the highest `supplied`. Lowest free liquidity: the lowest `liquidity`.
- Months in a set: rows of `venue-eligibility.csv` with the column of the set equal to 1: `in_set` for the strict set, `in_set_vaults_kept` for set A, `in_set_broad` for set B.
- Thesauros adapter: yes for a provider of the live vault of the network in the networks library and for a MetaMorpho V1 vault, which the MorphoProvider contract of the live vaults reads; no for a Morpho Vault V2, a single Morpho Blue market, Fluid and Spark sUSDC.

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
| Steakhouse High Yield USDC V2 | `............` | 0 | `............` | 0 | `.........xxx` | 3 |
| Morpho cbBTC market | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 | `xxxxxxxxxxxx` | 12 |
| Morpho USDe market | `............` | 0 | `............` | 0 | `.........xxx` | 3 |
| Morpho HERMES market | `............` | 0 | `............` | 0 | `...........x` | 1 |

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
| Steakhouse High Yield USDC V2 | morpho-v2 | 3 | `.........xxx` | 0 | 3 | listed collateral 0.0000% to 1.0044% of assets (the reason of 3 of the 3, with the lowest and the highest figure of those months) |
| Morpho USDe market | morpho-market | 3 | `.........xxx` | 0 | 3 | listed collateral 0.0000% of assets (the reason of 3 of the 3, as written for 2026-07-07) |
| Morpho HERMES market | morpho-market | 1 | `...........x` | 0 | 1 | listed collateral 0.0000% of assets (the reason of 1 of the 1, as written for 2026-09-07) |
| Avantis USDC Vault (avUSDC) | erc4626 | 2 | `.xx.........` | 0 | 0 | not lent against collateral: the vault is the counterparty of perpetuals traders (the reason of 2 of the 2, as written for 2025-11-07) |

Base, the months of the Morpho vaults (kinds `morpho` and `morpho-v2`) that pass the four tests:

| Vault-months that pass the four tests | In the strict set | Left out as the same book | Their share in that one market | Left out as a wrapper | In set A |
|---|---|---|---|---|---|
| 38 | 0 | 38 | 86.14% to 99.99% | 0 | 38 |

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
| `base.alloc-a.measured` | Morpho cbBTC market | 96.2% | 39.4% | 56.8% | 100.0% on 2025-10-19 |
| `base.alloc-strict` | Morpho cbBTC market | 58.9% | 58.9% | 0.0% | 60.0% on 2025-10-15 |
| `base.alloc-b` | Morpho cbBTC market | 96.2% | 52.3% | 43.9% | 100.0% on 2025-10-19 |
| `base.alloc-b` | Morpho USDe market | 0.0% | 0.0% | 0.0% | — |
| `base.alloc-b` | Morpho HERMES market | 0.0% | 0.0% | 0.0% | — |
| `base.alloc-b.measured` | Morpho cbBTC market | 96.2% | 39.4% | 56.8% | 100.0% on 2025-10-19 |
| `base.alloc-b.measured` | Morpho USDe market | 0.0% | 0.0% | 0.0% | — |
| `base.alloc-b.measured` | Morpho HERMES market | 0.0% | 0.0% | 0.0% | — |
| `base.public-a` | Morpho cbBTC market | 96.7% | 38.9% | 57.9% | 100.0% on 2025-11-13 |

- Directly: the market's own column of the daily file. Through vaults: each other venue's column times `largest_set_market_percent` of its row in `venue-eligibility.csv` for the month the day falls in, where `largest_set_market` is this market.
- Highest day: the largest sum of the two parts at one day's close, and that day. It is a single close, not a period: the average says how the year went.
- It is an approximation: the look-through is read once a month, at the first reading of the month, and applied to every day of it.
- It is a lower bound where a vault lends into two markets of the set: the table has a vault's share in the one market of the set where it has the most, and only for a market that passes the rule that month.
- No look-through is read for a market that passes the four tests in no month (Morpho USDe market, Morpho HERMES market): its figure is what the vault held in it directly, and what the vaults of the run lend into it is not counted.
- — in the highest day: the vault held nothing in the market on any day, itself or through a vault.

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
| `base.alloc-a.measured` | Morpho cbBTC market | $190,945 | 41.6% |
| `base.alloc-a.measured` | Gauntlet USDC Prime | $120,954 | 26.3% |
| `base.alloc-a.measured` | Steakhouse Prime USDC | $51,910 | 11.3% |
| `base.alloc-a.measured` | Steakhouse Prime USDC V2 | $48,864 | 10.6% |
| `base.alloc-a.measured` | Spark USDC Vault | $37,825 | 8.2% |
| `base.alloc-a.measured` | Aave V3 | $8,634 | 1.9% |
| `base.alloc-a.measured` | Steakhouse USDC | $0 | 0.0% |
| `base.alloc-a.measured` | All venues | $459,131 | 100.0% |
| `base.alloc-strict` | Morpho cbBTC market | $271,273 | 65.8% |
| `base.alloc-strict` | Aave V3 | $141,219 | 34.2% |
| `base.alloc-strict` | All venues | $412,492 | 100.0% |
| `base.alloc-b` | Morpho cbBTC market | $241,518 | 52.7% |
| `base.alloc-b` | Gauntlet USDC Prime | $105,285 | 23.0% |
| `base.alloc-b` | Spark USDC Vault | $37,825 | 8.3% |
| `base.alloc-b` | Steakhouse Prime USDC | $37,418 | 8.2% |
| `base.alloc-b` | Steakhouse Prime USDC V2 | $26,725 | 5.8% |
| `base.alloc-b` | Aave V3 | $9,445 | 2.1% |
| `base.alloc-b` | Steakhouse USDC | $0 | 0.0% |
| `base.alloc-b` | Steakhouse High Yield USDC V2 | $0 | 0.0% |
| `base.alloc-b` | Morpho USDe market | $0 | 0.0% |
| `base.alloc-b` | Morpho HERMES market | $0 | 0.0% |
| `base.alloc-b` | All venues | $458,215 | 100.0% |
| `base.alloc-b.measured` | Morpho cbBTC market | $190,945 | 41.6% |
| `base.alloc-b.measured` | Gauntlet USDC Prime | $120,954 | 26.3% |
| `base.alloc-b.measured` | Steakhouse Prime USDC | $51,910 | 11.3% |
| `base.alloc-b.measured` | Steakhouse Prime USDC V2 | $48,864 | 10.6% |
| `base.alloc-b.measured` | Spark USDC Vault | $37,825 | 8.2% |
| `base.alloc-b.measured` | Aave V3 | $8,634 | 1.9% |
| `base.alloc-b.measured` | Steakhouse USDC | $0 | 0.0% |
| `base.alloc-b.measured` | Steakhouse High Yield USDC V2 | $0 | 0.0% |
| `base.alloc-b.measured` | Morpho USDe market | $0 | 0.0% |
| `base.alloc-b.measured` | Morpho HERMES market | $0 | 0.0% |
| `base.alloc-b.measured` | All venues | $459,131 | 100.0% |
| `base.public-a` | Morpho cbBTC market | $186,827 | 40.9% |
| `base.public-a` | Gauntlet USDC Prime | $141,758 | 31.0% |
| `base.public-a` | Steakhouse Prime USDC | $46,878 | 10.3% |
| `base.public-a` | Spark USDC Vault | $37,914 | 8.3% |
| `base.public-a` | Steakhouse Prime USDC V2 | $36,793 | 8.1% |
| `base.public-a` | Aave V3 | $6,632 | 1.5% |
| `base.public-a` | Steakhouse USDC | $0 | 0.0% |
| `base.public-a` | All venues | $456,802 | 100.0% |
| `base.deployed` | Steakhouse High Yield USDC | $253,101 | 55.5% |
| `base.deployed` | Steakhouse Prime USDC | $172,465 | 37.8% |
| `base.deployed` | Gauntlet USDC Core | $14,770 | 3.2% |
| `base.deployed` | Compound V3 | $8,900 | 2.0% |
| `base.deployed` | Aave V3 | $6,893 | 1.5% |
| `base.deployed` | All venues | $456,128 | 100.0% |

- Interest: the sum over the year of the venue's `interest_` column of `thesauros_simple` in `tangem-simulation-daily.csv`: what the venue paid on the position that day, before gas and before the fee. It is the growth of the venue's index between two readings, scaled by the measured ratio of its rate with our deposit to its rate without it and never above that growth. A fall of the index is a negative figure. No venue has one on any day of these runs.
- All venues: their sum. Less the gas of the year it is the yield before the fee of table 1.
- The script stops unless, on every day, the interest of the venues less `gas_spent_usd` and `fees_paid` is `daily_yield`, within the rounding of those columns to the cent.

## 8. Liquidity episodes
The days of `thesauros_simple` on which less than the whole balance could be withdrawn, consecutive days as one episode.

| Run | From | To | Days | Of them under half | Lowest share that could be withdrawn | Venues that held more than they had free |
|---|---|---|---|---|---|---|
| `base.alloc-a` | 2026-02-03 | 2026-02-04 | 2 | 2 | 31.15% on 2026-02-03 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $10.14M held |
| `base.alloc-a.measured` | 2026-02-03 | 2026-02-04 | 2 | 0 | 64.09% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $6.80M held |
| `base.alloc-a.measured` | 2026-05-21 | 2026-05-21 | 1 | 0 | 97.01% on 2026-05-21 | Steakhouse Prime USDC V2: at 1 reading, the lowest $2.32M free at 2026-05-21 16:00 UTC against $2.62M held |
| `base.alloc-strict` | 2026-02-03 | 2026-02-04 | 2 | 2 | 31.20% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $10.13M held |
| `base.alloc-b` | 2026-02-03 | 2026-02-04 | 2 | 2 | 31.15% on 2026-02-03 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $10.14M held |
| `base.alloc-b.measured` | 2026-02-03 | 2026-02-04 | 2 | 0 | 64.09% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $6.80M held |
| `base.alloc-b.measured` | 2026-05-21 | 2026-05-21 | 1 | 0 | 97.01% on 2026-05-21 | Steakhouse Prime USDC V2: at 1 reading, the lowest $2.32M free at 2026-05-21 16:00 UTC against $2.62M held |
| `base.public-a` | 2026-02-03 | 2026-02-04 | 2 | 0 | 71.15% on 2026-02-04 | Aave V3: at 1 reading, the lowest $3.16M free at 2026-02-04 00:00 UTC against $6.09M held |
| `base.public-a` | 2026-05-21 | 2026-05-21 | 1 | 0 | 82.63% on 2026-05-21 | Steakhouse Prime USDC V2: at 1 reading, the lowest $2.32M free at 2026-05-21 16:00 UTC against $4.09M held |
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

- A day counts when `available_liquidity` is under `total_assets` in `tangem-simulation-daily.csv`; the share is one over the other. The days of this table are the days table 2 does not count as whole to the cent.
- Venues: at each reading of `raw.jsonl` on those days the vault's position in a venue, once the movements of that reading are made, is set against the venue's `liquidity` at that reading, and each day's closing position against the first reading after it; that is how `available_liquidity` is taken. A venue is named when its position was above its free liquidity at one of them, with the number of such readings and the one at which it had the least free. Positions are rebuilt as for the largest share in table 2.
- The script stops unless the lowest share so rebuilt for a day, of every day of the year, is within 0.1% of the balance of the share in the daily file.

## 9. Fee
What `thesauros_simple` would hold at another performance fee, worked out from the daily file of the run.

|  | `base.alloc-a` | `base.alloc-a.measured` | `base.alloc-strict` | `base.alloc-b` | `base.alloc-b.measured` | `base.public-a` | `base.deployed` |
|---|---|---|---|---|---|---|---|
| At a fee of 0%: balance at the end of the year, and yield | $10,460,288 (4.60%) | $10,461,213 (4.61%) | $10,414,174 (4.14%) | $10,460,288 (4.60%) | $10,461,213 (4.61%) | $10,458,860 (4.59%) | $10,458,172 (4.58%) |
| At a fee of 0%: against Just Aave | +$133,407 (+1.33 pp) | +$134,332 (+1.34 pp) | +$87,294 (+0.87 pp) | +$133,407 (+1.33 pp) | +$134,332 (+1.34 pp) | +$131,979 (+1.32 pp) | +$131,292 (+1.31 pp) |
| At a fee of 10%: balance at the end of the year, and yield | $10,413,324 (4.13%) | $10,414,153 (4.14%) | $10,371,999 (3.72%) | $10,413,324 (4.13%) | $10,414,153 (4.14%) | $10,412,045 (4.12%) | $10,411,429 (4.11%) |
| At a fee of 10%: against Just Aave | +$86,444 (+0.86 pp) | +$87,272 (+0.87 pp) | +$45,118 (+0.45 pp) | +$86,444 (+0.86 pp) | +$87,272 (+0.87 pp) | +$85,164 (+0.85 pp) | +$84,548 (+0.85 pp) |
| At a fee of 15%: balance at the end of the year, and yield | $10,389,921 (3.90%) | $10,390,702 (3.91%) | $10,350,975 (3.51%) | $10,389,921 (3.90%) | $10,390,702 (3.91%) | $10,388,716 (3.89%) | $10,388,135 (3.88%) |
| At a fee of 15%: against Just Aave | +$63,041 (+0.63 pp) | +$63,822 (+0.64 pp) | +$24,094 (+0.24 pp) | +$63,041 (+0.63 pp) | +$63,822 (+0.64 pp) | +$61,835 (+0.62 pp) | +$61,255 (+0.61 pp) |
| The fee the run was made at | 20% | 20% | 20% | 20% | 20% | 20% | 20% |
| At that fee, the run itself: balance at the end of the year, and yield | $10,366,571 (3.67%) | $10,367,304 (3.67%) | $10,329,993 (3.30%) | $10,366,571 (3.67%) | $10,367,304 (3.67%) | $10,365,439 (3.65%) | $10,364,893 (3.65%) |
| At that fee, the run itself: against Just Aave | +$39,690 (+0.40 pp) | +$40,424 (+0.40 pp) | +$3,113 (+0.03 pp) | +$39,690 (+0.40 pp) | +$40,424 (+0.40 pp) | +$38,558 (+0.39 pp) | +$38,013 (+0.38 pp) |
| At that fee: the balance worked out less the balance of the run | −$0.12 | −$0.07 | +$0.04 | −$0.12 | −$0.07 | −$0.10 | −$0.02 |
| The fee at which the balance worked out is that of Just Aave | 28.5% | 28.7% | 20.7% | 28.5% | 28.7% | 28.3% | 28.2% |

- A day's return before the fee: the sum of the `interest_` columns of the day less `gas_spent_usd`, over `total_assets` of the day before, the deposit for the first day. At a fee the balance of a day is the balance of the day before times one plus the return, less the fee's share of the return when it is positive. The year starts on the deposit.
- Yield: the balance less the deposit, in percent of the deposit. Against Just Aave: the same less the yield of Just Aave of table 1.
- At the fee the run was made at the arithmetic is the run itself, so those two rows show `total_assets` of the last day, as table 1 does. The script stops unless the balance worked out at that fee is within $1 of it: the files are in cents, and the row after shows what the rounding leaves.
- At 0% the yield is above the yield before the fee of table 1: that one adds the fees of the year to the yield, without what they would have earned had they stayed in the vault.
- The fee at which the balance is that of Just Aave: found by halving between 0% and 100% on the same arithmetic. The break-even fee of table 1 is its approximation in one line.
- The arithmetic keeps the returns of the run as they are. A run made at another fee differs: with a lower fee the vault is larger, so each venue pays a little less on a larger position and a move is decided on other amounts. The runs below were made at another fee to measure it.
- `base.alloc-a.fee10` is `base.alloc-a` made at a fee of 10%, in the output folder `simulation-alloc-a-fee10`; the pack has its config and no copy of its files. The balance of `base.alloc-a` worked out at 10%: $10,413,324. The balance of the run made at 10%: $10,413,313. Worked out less made: +$11.

## 10. Venues held
`thesauros_simple`, at each day's close.

|  | `base.alloc-a` | `base.alloc-a.measured` | `base.alloc-strict` | `base.alloc-b` | `base.alloc-b.measured` | `base.public-a` | `base.deployed` |
|---|---|---|---|---|---|---|---|
| Days with 1 venue | 1 | 5 | 1 | 1 | 5 | 0 | 0 |
| Days with 2 venues | 143 | 120 | 364 | 143 | 120 | 365 | 363 |
| Days with 3 venues | 209 | 159 | 0 | 209 | 159 | 0 | 2 |
| Days with 4 venues | 12 | 81 | 0 | 12 | 81 | 0 | 0 |
| Venues held, mean over the days | 2.64 | 2.87 | 2.00 | 2.64 | 2.87 | 2.00 | 2.01 |
| Largest share of the vault in one venue | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-07 | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-07 | 60.02% in Morpho cbBTC market on 2025-11-13 | 60.02% in Steakhouse High Yield USDC on 2026-04-06 |
| The most the entry provider held | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-07 | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-03 | 100.00% in Aave V3 on 2026-02-07 | 60.00% in Aave V3 on 2026-02-03 | 60.00% in Compound V3 on 2026-01-30 |

- A venue is held on a day when its column of `tangem-simulation-daily.csv` is 1% of the vault or more at that day's close. The rows go up to the most venues any run held on one day.
- Largest share: the highest venue column of the year, with its venue and the first day it is reached. The entry provider is `entry_provider` of the config, where a deposit lands. The allocator does not cap it, so it can hold the whole vault; under the public vault's rules a rebalance caps it as it caps every venue.
- The cap of 60% of the vault acts when a rebalance executes: between two rebalances a venue that earns more than the others stands a little above it.
- The allocator has no minimum of two venues. On the days of an allocator run with one venue, that venue is Aave V3, the entry provider, which it does not cap.

## 11. Movements against the source's own free liquidity and interest that could not be withdrawn
What `thesauros_simple` took out of a venue beyond the venue's own free liquidity, and the interest it was credited in a venue on days the venue could not have paid its position out.

|  | `base.alloc-a` | `base.alloc-a.measured` | `base.alloc-strict` | `base.alloc-b` | `base.alloc-b.measured` | `base.public-a` | `base.deployed` |
|---|---|---|---|---|---|---|---|
| Movements that took out more than the source venue had free without us | 0 | 0 | 0 | 0 | 0 | 0 | 435 |
| Their amount | $0 | $0 | $0 | $0 | $0 | $0 | $1,674,033,193 |
| Their sources, with the movements of each | — | — | — | — | — | — | Compound V3 296, Steakhouse High Yield USDC 90, Gauntlet USDC Core 49 |
| `thesauros_simple`: interest credited on venue-days short of liquidity | $1,065 | $1,143 | $1,635 | $1,065 | $1,143 | $1,453 | $247,480 |
| `thesauros_simple`: its share of the interest of the year | 0.2% | 0.2% | 0.4% | 0.2% | 0.2% | 0.3% | 54.3% |
| `thesauros_simple`: such venue-days | 2 | 3 | 2 | 2 | 3 | 3 | 485 |
| `thesauros_simple`: their venues, with the days of each | Aave V3 2 | Aave V3 2, Steakhouse Prime USDC V2 1 | Aave V3 2 | Aave V3 2 | Aave V3 2, Steakhouse Prime USDC V2 1 | Aave V3 2, Steakhouse Prime USDC V2 1 | Steakhouse High Yield USDC 302, Compound V3 123, Gauntlet USDC Core 58, Aave V3 2 |

The same interest for the four controls, which sit in venues through such days too:

|  | `base.alloc-a` | `base.alloc-a.measured` | `base.alloc-strict` | `base.alloc-b` | `base.alloc-b.measured` | `base.public-a` | `base.deployed` |
|---|---|---|---|---|---|---|---|
| `first_split_held`: interest credited on venue-days short of liquidity | $330 | $330 | $1,140 | $330 | $330 | $330 | $112,712 |
| `first_split_held`: its share of the interest of the year | 0.1% | 0.1% | 0.3% | 0.1% | 0.1% | 0.1% | 24.2% |
| `first_split_held`: such venue-days | 1 | 1 | 2 | 1 | 1 | 1 | 227 |
| `first_split_held`: their venues, with the days of each | Spark USDC Vault 1 | Spark USDC Vault 1 | Aave V3 2 | Spark USDC Vault 1 | Spark USDC Vault 1 | Spark USDC Vault 1 | Steakhouse High Yield USDC 226, Compound V3 1 |
| `eligible_equal_weight`: interest credited on venue-days short of liquidity | $0 | $0 | $1,397 | $0 | $0 | $0 | $124,833 |
| `eligible_equal_weight`: its share of the interest of the year | 0.0% | 0.0% | 0.3% | 0.0% | 0.0% | 0.0% | 30.3% |
| `eligible_equal_weight`: such venue-days | 0 | 0 | 2 | 0 | 0 | 0 | 602 |
| `eligible_equal_weight`: their venues, with the days of each | — | — | Aave V3 2 | — | — | — | Compound V3 308, Gauntlet USDC Core 219, Steakhouse High Yield USDC 75 |
| `just_aave`: interest credited on venue-days short of liquidity | $4,605 | $4,605 | $4,605 | $4,605 | $4,605 | $4,605 | $4,605 |
| `just_aave`: its share of the interest of the year | 1.4% | 1.4% | 1.4% | 1.4% | 1.4% | 1.4% | 1.4% |
| `just_aave`: such venue-days | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| `just_aave`: their venues, with the days of each | Aave V3 4 | Aave V3 4 | Aave V3 4 | Aave V3 4 | Aave V3 4 | Aave V3 4 | Aave V3 4 |
| `just_best_vault`: interest credited on venue-days short of liquidity | $0 | $0 | $0 | $0 | $0 | $0 | $26,211 |
| `just_best_vault`: its share of the interest of the year | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 5.8% |
| `just_best_vault`: such venue-days | 0 | 0 | 0 | 0 | 0 | 0 | 15 |
| `just_best_vault`: their venues, with the days of each | — | — | — | — | — | — | Steakhouse Prime USDC 15 |

- More than the source had free: the movements of table 2, rows of `tangem-simulation-rebalances.csv` with `amount` above `source_free_liquidity`, what the venue could pay at the reading with none of our deposit counted as liquid. The run lets such a movement execute: it takes our own deposit to be payable next to that liquidity, in whole with rate impact on and in the liquid share of the venue with it off. Whether the venue would have paid it on chain is not in the history.
- Interest on venue-days short of liquidity: the simulator credits the growth of a venue's index whether or not the venue could have paid the vault out. A venue-day counts when the position in the venue is above the venue's `liquidity` at a reading of `raw.jsonl` on that day, once the movements of that reading are made, or when the day's closing position is above its `liquidity` at the first reading after the close. That is how table 8 names its venues and how `available_liquidity` is taken, so a venue that was short while the vault held it counts whether or not it was still held at the close. The figure is the sum of the venue's `interest_` column over such days. It is the interest of the whole day, the finest the daily file has: the most that was credited while the venue was short, with the hours of such a day on which the venue could have paid in it.
- Share: of the sum of every `interest_` column of the strategy over the year, in which a fall of an index is the negative figure it is. Positions are rebuilt as for the largest share in table 2, and a position under 0.01% of the deposit is not weighed.
- A control is credited the same way, so its yield in table 1 has this interest in it. Its positions are rebuilt from its own days and its own movements in `tangem-simulation-rebalances.csv`; `just_aave` and `just_best_vault` have none. For every strategy the script stops unless the lowest share of the balance so payable on a day is within 0.1% of the balance of `available_liquidity` over `total_assets` in the daily file.
- —: no such movement, or no such venue-day.
