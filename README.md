# Thesauros × Tangem: $10M USDC simulation

A one-year backtest of a $10,000,000 USDC deposit in a Thesauros vault, with four stress scenarios, on historical on-chain data. It answers three questions: what the vault would have earned, where that yield comes from, and how the vault behaves at this size.

| | |
|---|---|
| Deposit | $10,000,000 USDC, one deposit on day one, no withdrawals |
| Period | 7 October 2025 to 6 October 2026, 365 days |
| Data | one on-chain reading every four hours, no gaps: 2,191 on Base, 2,179 on Ethereum |
| Decisions | the rules of the production rebalancer, evaluated at every reading |

Three runs:

| Run | Venues | What it represents |
|---|---|---|
| `base-vault-as-deployed` | Compound V3, Aave V3, Steakhouse High Yield USDC, Steakhouse Prime USDC, Gauntlet USDC Core | the Base vault with the providers it has today |
| `base-proposed-configuration` | Compound V3, Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Spark USDC Vault, Steakhouse Prime USDC, with a limit on our share of a venue | a configuration sized for $10M; not deployed |
| `ethereum-vault-as-deployed` | Compound V3, Aave V3, Steakhouse USDC, Gauntlet USDC Prime, Smokehouse USDC | the Ethereum vault with the providers it has today |

## Result

Yield for the year on $10M.

| | Base, as deployed | Base, proposed | Ethereum, as deployed |
|---|---|---|---|
| Just Aave: all in Aave V3, never moved | $326,880 (3.27%) | $326,880 (3.27%) | $350,511 (3.51%) |
| First split held: the vault's first allocation, never rebalanced, no Thesauros fee | $465,387 (4.65%) | $371,816 (3.72%) | $441,787 (4.42%) |
| **Thesauros Simple before its fee** | $456,370 (4.56%) | $443,847 (4.44%) | $450,119 (4.50%) |
| What rebalancing added | −$9,017 | +$72,031 | +$8,332 |
| Performance fee | $91,274 (20%) | $88,769 (20%) | $112,530 (25%) |
| **Thesauros Simple after its fee** | **$365,096 (3.65%)** | **$355,078 (3.55%)** | **$337,589 (3.38%)** |
| Just Best Vault: all in the venue with the highest rate on day one, never moved | $449,622 (4.50%) | $449,622 (4.50%) | $485,021 (4.85%) |

**Where the yield comes from.** Most of the yield above Aave comes from which venues the vault holds, not from moving between them. In the two runs of the deployed vaults, holding the first allocation without rebalancing earns the same as the rebalancer or more. Rebalancing adds yield only in the proposed configuration, where the venue-share limit keeps money out of venues until they are large enough and the rebalancer moves in as they grow.

**After the fee** the depositor earns $38,216 and $28,198 more than in Aave on Base and $12,921 less than in Aave on Ethereum. In all three runs it is less than holding the vault's first allocation directly.

**Just Best Vault** is a single curated vault picked by its rate on day one: Steakhouse Prime USDC on Base, which held $7.8M that day, and Smokehouse USDC on Ethereum. It is shown as the ticket defines it; it ignores venue size and concentration.

## What the vault did

| | Base, as deployed | Base, proposed | Ethereum, as deployed |
|---|---|---|---|
| Rebalances, movements of funds | 391, 807 | 20, 39 | 219, 442 |
| Rebalances that reverse the previous one within 24 hours | 319 | 6 | 125 |
| Rebalances after which the vault's rate was lower than before | 189 | 4 | 80 |
| Gas for the year | $11.5 | $0.7 | $471 |
| Days on which the whole balance could be withdrawn | 41 of 365 | 363 of 365 | 346 of 365 |
| Days on which less than half could be withdrawn | 131 | 0 | 7 |
| Largest share of a venue we would have been | 89% | 10% | 33% |

Four behaviours of the rebalancer explain this table. They are properties of the production rules, not of the simulation.

1. **It prices a move on rates before its own entry.** The 0.25 pp threshold compares rates as they stand before the move. Several million dollars arriving lowers the destination's rate, the next run sees the lower rate and moves back. `tangem-simulation-rebalances.csv` shows both numbers for every move: `expected_gain_pp` and `realized_change_pp`.
2. **It enters a venue whose rate is high because liquidity is short.** On Base on 3 February 2026 Aave's rate rose from 3.8% to 6.8% as its free liquidity fell from $46M to $26M, and in both Base runs the rebalancer moved about $6M, 60% of the vault, into it. Eight hours later Aave had $3.2M free and 71% of the vault could be withdrawn; before the move it was 100%. On Ethereum on 19 April 2026 it moved $6.1M into Aave at 12.6% with no free liquidity, and for five days 40% of the vault could be withdrawn; before the move it was 95%.
3. **It has no limit on its share of a venue.** As deployed on Base, the vault would have been more than half of Steakhouse High Yield USDC on 190 days, up to $6.2M next to $0.8M of other deposits, and up to 71% of Gauntlet USDC Core. On Ethereum it would have been more than a quarter of Smokehouse USDC on 88 days.
4. **It has no exit rule after a loss.** See the stress scenarios.

The deployed Base vault cannot hold $10M: three of its five venues stayed between $1M and $25M all year (Compound V3 $8M to $19M, Steakhouse High Yield USDC $1M to $25M, Gauntlet USDC Core $2M to $8M).

## The proposed Base configuration

It differs from the deployed vault in venues and in one rule, and it is not live.

- **Venues.** Steakhouse USDC, Gauntlet USDC Prime and Spark USDC Vault are not providers of the Base vault today. Running this configuration needs three new provider adapters, their registration through the ProviderManager and the Timelock, and a change of the entry provider from Compound to Aave.
- **Rule.** A venue takes money only while a full position, 60% of the vault, would be at most 10% of that venue. The same rule is applied to every venue: it is what keeps Compound V3 out, and what keeps Steakhouse Prime USDC and Gauntlet USDC Prime out until they grow. The production rebalancer of the public vault does not have this rule; the cross-chain allocator does.
- **Hindsight.** The three added venues were chosen knowing how the year went: they are the largest MetaMorpho USDC vaults on Base over the period. The result is a capacity estimate, not a track record.

## Fees

The runs charge the fee the way the vault contract does: a share of every positive change in assets, applied daily here, with no high-water mark. The contract's cap is 20% on the Base vault and 25% on the Ethereum vault, and the runs use the cap. The fee is set to 0% on both vaults today.

The published terms, 25% above a high-water mark, cannot be set on the Base vault as deployed. The difference from a high-water mark shows only after a loss: the fee resumes on the first positive day.

The fee line in the result table is the whole performance fee. How it is shared between Thesauros and Tangem is a commercial term this simulation does not set.

## What the venues lend against

Supply of each Morpho vault by collateral, from the Morpho API on 9 October 2026; `market-data/venue-collateral.csv` has the full breakdown. This is today's composition, not the year's.

| Venue | Size today | Collateral |
|---|---|---|
| Base: Gauntlet USDC Prime | $414M | cbBTC 91%, WETH 8% |
| Base: Spark USDC Vault | $361M | cbBTC 100% |
| Base: Steakhouse USDC | $122M | cbBTC 97%, cbETH 2% |
| Base: Steakhouse Prime USDC | $14M | cbBTC 74%, cbETH 22%, WETH 4% |
| Base: Gauntlet USDC Core | $2M | cbBTC 84%, cbETH 10% |
| Base: Steakhouse High Yield USDC | $1M | cbXRP 42%, USDe 27%, cbDOGE 13%, cbADA 6%, mGLO 5% |
| Ethereum: Steakhouse USDC | $65M | cbBTC 40%, weETH 21%, steakEURCV 18%, WBTC 12%, wstETH 7% |
| Ethereum: Gauntlet USDC Prime | $22M | cbBTC 47%, WBTC 29%, WETH 15%, wstETH 10% |
| Ethereum: Smokehouse USDC | $13M | mF-ONE 33%, PT-reUSD 25%, wFalconX 19%, weETH 15%, reUSD 7% |

The Ethereum run holds 59% of the deposit in Smokehouse USDC on average, and the Base run as deployed holds 52% in Steakhouse High Yield USDC. The rebalancer ranks venues by rate; it does not read what a venue lends against.

## Stress scenarios

Four independent scenarios with the agreed parameters, each starting on 7 April 2026, day 183. They hit the venue with the largest position that day, which holds 60% of the vault in every run: Steakhouse High Yield USDC (Base as deployed), Gauntlet USDC Prime (Base proposed), Smokehouse USDC (Ethereum).

| Scenario | | Base, as deployed | Base, proposed | Ethereum, as deployed |
|---|---|---|---|---|
| No stress | balance at year end | $10,365,096 | $10,355,078 | $10,337,589 |
| USDC at $0.95 for 14 days | largest loss, in USD value | $509,184 (4.99%) | $508,658 (4.99%) | $507,945 (4.99%) |
| | balance at year end | $10,365,096 | $10,355,078 | $10,337,589 |
| Curated vault writes off 10% | largest loss | $611,142 (5.99%) | $610,353 (5.99%) | $609,500 (5.99%) |
| | balance at year end | $9,743,872 | $9,734,126 | $9,717,913 |
| Venue loses everything | largest loss | $6,121,750 (60.0%) | $6,112,728 (60.0%) | $6,103,201 (60.0%) |
| | balance at year end | $4,142,978 | $4,140,859 | $4,127,811 |
| Venue freezes withdrawals for 30 days | largest loss | none | none | none |
| | days until everything can be withdrawn | 32 | 30 | 30 |

What the vault's rules do in each:

- **Depeg.** Nothing reacts. The vault is denominated in USDC and no rule reads the dollar price. The scenario changes the USD valuation for fourteen days and tests no rule of the vault.
- **Curator bad debt.** The 60% provider cap holds the loss to 5.99% of the vault instead of 10%. Nothing else acts: the asset change is under the 20% circuit-breaker threshold, there is no exit rule, and the rebalancer keeps the position in the vault that took the loss.
- **Protocol hack.** The circuit breaker triggers on the day (assets moved 60.0% against a 20% threshold) and halts rebalancing for that run. It recovers nothing; the provider cap is what holds the loss to 60%. The remaining 40% stays invested.
- **Withdrawal freeze.** No loss, and no rule detects a freeze. 40% of the vault stays withdrawable and the rest after the freeze ends. Moves out of the frozen venue that the rebalancer decided on would have reverted: fifteen on Base as deployed, none in the proposed configuration, thirteen on Ethereum.

The provider cap is the one protection that acted in these scenarios. Day-by-day series are in `simulation/tangem-stress-timelines.csv` of each run.

## Real events in the window

The year contains events of the same kind as the scenarios. The runs pass through all of them.

| Date | Network | Event | In the simulation |
|---|---|---|---|
| 3 to 7 November 2025 | Ethereum | Smokehouse USDC shrank from $216M to $59M. On 4 November it had no free liquidity for at least eight hours, at a rate of 33%. | The vault held 60% there; 40% of the vault could be withdrawn that day. No loss. |
| 3 and 4 February 2026 | Base | Aave V3 USDC free liquidity fell from $46M to $3.2M, rate up to 12.6%. | The rebalancer moved 60% of the vault into Aave on the way up (behaviour 2). |
| 22 and 23 March 2026 | Ethereum | Smokehouse USDC free liquidity fell to $0.4M, rate 20%. | 44% and 57% of the vault could be withdrawn. |
| 31 March 2026 | Ethereum | Gauntlet USDC Core lost 29.5% of its share price in four hours. | Not a venue of the vault. A real curator loss three times the scenario's 10%. |
| 19 to 23 April 2026 | Ethereum | Aave V3 USDC had under $10M free for almost four days, rate pinned at 12.6%. | The rebalancer moved 60% of the vault into Aave on 19 April (behaviour 2); 40% could be withdrawn for five days. |
| 5 and 11 May 2026 | Base | Re7 USDC lost 80.4% and then 9.0% of its share price. | Not a venue of the vault. |

## Method

**Rates include our own deposit.** A lending rate falls as capital arrives. At every reading a deposit of $4M, $6M and $10M is executed through each venue's own contracts at that block, the resulting rate is read back, and the deposit is rolled back. The simulation earns the rate after its own entry.

**Decisions.** The Thesauros run calls the decision function of the production rebalancer: new money enters on a 12-hour smoothed rate, no venue holds more than 60%, at least two venues are active, a move needs an expected gain of 0.25 pp a year, a venue whose rate jumps more than 100% above its 24-hour average receives nothing, and a circuit breaker stops rebalancing when assets change by more than 20% between readings. The deposit lands in the entry provider and is first moved once twelve hours of rate history exist.

**Yield.** Interest is each venue's realized on-chain index growth, scaled by the measured ratio of the rate after our deposit to the rate before it. A falling index is a loss and is taken in full.

**Costs.** A movement of funds uses 982,930 gas, the median of real single-movement rebalance transactions on Base, priced at the fees of its block, plus the L1 data fee on Base, at the ETH price of that moment. Gas is charged to the vault here; in production the operator pays it.

**Liquidity.** `available_liquidity` is the lowest, over the day's six readings, of what the venues could pay out of our positions.

| Venue | Address | Average rate | With $10M of ours in it | Size over the year |
|---|---|---|---|---|
| Base: Aave V3 | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | 3.49% | 3.22% | $169M to $440M |
| Base: Compound V3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | 3.99% | 1.66% | $8M to $19M |
| Base: Steakhouse High Yield USDC | `0xBEEFA7B88064FeEF0cEe02AAeBBd95D30df3878F` | 5.31% | 4.57% | $1M to $25M |
| Base: Steakhouse Prime USDC | `0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2` | 4.67% | 4.53% | $8M to $574M |
| Base: Gauntlet USDC Core | `0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12` | 4.30% | 4.16% | $2M to $8M |
| Base: Steakhouse USDC | `0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183` | 3.56% | 3.45% | $123M to $507M |
| Base: Gauntlet USDC Prime | `0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61` | 4.71% | 4.56% | $11M to $443M |
| Base: Spark USDC Vault | `0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A` | 4.27% | 3.81% | $6M to $642M |
| Ethereum: Aave V3 | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | 3.53% | 3.45% | $1.8B to $6.1B |
| Ethereum: Compound V3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | 3.51% | 2.99% | $326M to $580M |
| Ethereum: Steakhouse USDC | `0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB` | 3.63% | 3.40% | $63M to $511M |
| Ethereum: Gauntlet USDC Prime | `0xdd0f28e19C1780eb6396170735D45153D261490d` | 3.70% | 3.43% | $22M to $211M |
| Ethereum: Smokehouse USDC | `0xBEeFFF209270748ddd194831b3fa287a5386f5bC` | 5.48% | 4.90% | $13M to $313M |

## Limits

- Native lending rates only. Incentive programmes are not counted.
- Decisions are evaluated every four hours; production evaluates every 30 minutes, on hourly rate samples. The hours between readings are filled in on a straight line for the 12-hour average. More frequent decisions would not reduce the reversals described above.
- The effect of our deposit is measured venue by venue. Two Morpho vaults that lend into the same market also move each other's rate, which is not counted.
- Liquidity and the days to exit use what each venue could pay without us in it.
- The stress scenarios are hypothetical and independent. The depeg scenario moves the USD value only.
- This is a backtest on historical data, not a forecast.

## Verification and reproduction

- The rate reads reproduce the Thesauros provider contracts on-chain exactly, to the wei, on both networks.
- The rate after our own deposit was repeated as real transactions on a Hardhat fork: 30 deposits of $6M and $10M at three blocks on each network. The largest difference from the simulated figure is 0.00005% on Base and 0.00012% on Ethereum.
- Sampled rates agree with realized index growth for every venue of the runs, within 0.08 pp over the year.
- Daily yields add up to the final balance, and the rows of the rebalance file match the daily counters.

The `reproduce` folder runs the simulation again from the pack alone, with Node 18 or later:

```bash
cd reproduce
node simulate.js config.base.deployed.json
```

It writes `data/tangem/base/simulation-deployed/*.csv`, byte for byte the files of `base-vault-as-deployed/simulation`; the other two configs do the same for their runs. `data/tangem/*/raw.jsonl` holds every on-chain reading the simulation uses. `src/` has the sources: `simulate.ts`, the production decision rules (`policies.ts`, `allocation/`), the collector that produced the readings (`collect-history.ts`, `TangemLens.sol`) and the fork check (`verify-on-fork.ts`). The collector and the fork check need an archive RPC and the Thesauros repository; the simulator needs neither. Every parameter of a run, including the stress scenarios, is in its config file.

## Files

Each run folder has the same content.

| File | Content |
|---|---|
| `tangem-simulation.zip` | the first three files below |
| `simulation/tangem-simulation-daily.csv` | one row per day and strategy |
| `simulation/tangem-simulation-rebalances.csv` | every movement of funds of the Thesauros run |
| `simulation/tangem-stress-tests.csv` | the stress table |
| `simulation/tangem-stress-timelines.csv` | the four scenarios day by day |
| `market-data/venue-rates.csv` | the run's venues every four hours |
| `market-data/gas.csv` | network fees and ETH price every four hours |
| `market-data/venue-collateral.csv` | what each Morpho venue lends against today |

**`tangem-simulation-daily.csv`**: `strategy` is `thesauros_simple`, `first_split_held`, `just_aave` or `just_best_vault`; `total_assets` the depositor's balance in USD after gas and fees; `daily_yield` its change on the day; `cumulative_yield` its change since the deposit; `apy_trailing_30d` the annualised return of the last 30 days, in percent; `rebalance_count` the movements of funds that day; `gas_spent_wei` and `gas_spent_usd` their cost; `fees_paid` the performance fee of the day; `available_liquidity` what could be withdrawn at the worst reading of the day; `pct_*` the share of each venue.

**`tangem-simulation-rebalances.csv`**: one row per movement between two venues, with the amount and its gas. `apr_before_percent` and `apr_after_percent` are the vault's rate before and after the rebalance, each with our positions in place; `expected_gain_pp` is what the decision expected on rates before the move; `realized_change_pp` is the difference of the two rates. Movements of one transaction share a `tx` number.

**`tangem-stress-tests.csv`**: `max_loss_usd` and `max_loss_percent` against the balance on the day before the event; `time_to_exit_days` until the whole balance could be withdrawn; `riskguard_response` what the vault's rules did.

**`venue-rates.csv`**: `deposit_rate_ray` is the rate as the vault reads it on-chain (1e27 = 100% a year) and `deposit_rate_percent` the same in percent; `deposit_rate_after_4m_percent`, `_6m_`, `_10m_` the rate with that much of ours deposited, empty when the venue refused the deposit; `total_supplied_usd` and `available_liquidity_usd` the venue's size and what it could pay out; `supply_index` the value of a fixed deposit, whose ratio between two readings is the realized growth.

**`gas.csv`**: base and priority fee of the block, their median and 90th percentile over the 300 blocks before it, the L1 data fee of one rebalance transaction (Base), the gas of one movement and the ETH price.
