# The reworked programme

Fixed on 10 October 2026, before any run of it was made. It was written after the results of the first programme were known (the public vault's rules on the rule's venue sets), so it is a choice made with knowledge of the year. No parameter below is tuned on a result, and every run made under it is reported.

## What changes and why

The public vault's rules put 60% of the vault into one venue and 40% into another, whatever the number of venues, and price a move on rates before the vault's own entry. At $10M that lowers the rate the vault earns and leaves the other venues unused.

1. **Allocator.** The runs use the water-filling allocator of the Thesauros cross-chain planner, which is in the production repository and is not live for the public vaults (`decideWaterFill` of `policies.ts`). It spreads the vault over the venues so that the last dollar earns the same everywhere, counting what the vault's own deposit does to each rate. Its settings are its defaults: at most 60% of the vault in a venue, at most 10% of a venue, a move of at least $1,000, a gain of at least 0.05 pp of the vault a year and of more than twice the gas over seven days, and the same plan on two readings in a row.
2. **Impact.** The allocator needs each venue's impact exponent. It is taken the way production takes it. If production uses a constant, a second run uses the exponent measured at each reading from the $10M deposit probe, and both are reported.
3. **No entry where liquidity is short.** A venue whose own free liquidity at the reading is below a full position of the vault takes no new money; what the vault already holds there is judged at the venue's current rate. This is the owner's rule against chasing a rate that is high because liquidity has left.
4. **Entry provider.** Aave V3 on both networks.

## Venue sets

Both are decided month by month at the first reading of the month, as in `VENUE_RULE.md`.

- **Set A, BTC and ETH collateral.** Tests 1 to 4 of the rule. A vault that lends into a single market of the set is a venue of its own (the `vaults kept` set). A wrapper is not.
- **Set B, any collateral.** Tests 1 to 3 only: USDC, withdrawal on demand, at least $100M. A wrapper is not a venue. Candidates the collector cannot read (Euler vaults, Dolomite) are left out and named.

## Runs

On each network: the allocator on set A; the allocator on set B; the public vault's rules on set A, to show what the allocator changes; and the controls on the same sets (equal parts, Just Aave, first split held). The vault as deployed today is kept as a reference run.

## Fee

Results are shown at a performance fee of 0%, 10%, 15% and the contract's cap.

## How the programme is carried out

Written on 10 October 2026 after the simulator was changed and before the first run of this programme, and committed before that run. It settles what the text above leaves open. Nothing here was chosen on a result of this programme: none existed.

1. **Main run.** The allocator on set A with production's impact constants. The run with measured exponents, the runs on set B and on the strict set, and the public vault's rules on set A are comparisons, and all are reported.
2. **Strict set.** The allocator is also run on the set of `VENUE_RULE.md` as first applied, in which a vault that is mostly one single market of the set is left out (`in_set`). It is one more run, with production's constants.
3. **Impact constants.** Production has a constant for three protocols: 2 for Aave V3 and Compound V3, 1.75 for Morpho. A Morpho Vault V2 and a single Morpho Blue market take the Morpho constant. Fluid and Spark Savings have no adapter and no constant in production; the run gives them 1.75. That is an assumption.
4. **Measured exponent.** The exponent of r(x) = r0 (T / (T + x))^alpha that reproduces the reading's $10M probe, between 0 and 10. A reading that measures none (the probe refused, no rate) leaves the venue's last one, and production's constant before the first.
5. **Gas in the decision.** Production prices a transaction at a flat $0.10 when it decides (`CROSSCHAIN_GAS_COST_USD`), and the runs decide the same way. What a move costs is charged as before: the gas of the reading, a leg at a time.
6. **Two readings in a row.** The history has a reading every four hours, so the same plan at two readings in a row is a plan that held for four hours. Production runs every fifteen minutes.
7. **The entry provider has no cap.** The planner caps every provider but the entry one, where the rest of the money is parked. Aave V3 can hold more than 60% of the vault.
8. **No RiskGuard.** The circuit breaker, the anomaly gate, the cooldown and the minimum of active providers are the public vault's. The planner's step has none of them, and the allocator runs apply none.
9. **Liquidity rule.** It is applied in every run of this programme. In the allocator's runs and in the public vault's rules on set A the venue's signal is zero and a leg that would enter it is dropped. The equal-weight control leaves such a venue out when it splits. A full position is 60% of the vault at the reading.
10. **Venue-share limit.** The limit of `VENUE_RULE.md` stays as it is written: a venue too small for a full position is read as paying nothing. The allocator's own limit, 10% of a venue with the vault's position in it, acts inside it.
11. **Interest that could not be withdrawn.** The simulator credits a venue's index growth whether or not the venue could pay the vault out. For every run the interest credited on days when the venue's own free liquidity was below the vault's position in it is reported beside the result.
12. **Fee table.** The runs charge the contract's cap. The result at another fee is worked out from the run's daily file: each day's return before the fee, less the fee on a positive day. At the cap this is the run itself. It is checked against a run made at 10% on each network, and the difference is reported.
13. **The port.** `decideWaterFill` is the port of production's `PlannerService.intraChainRebalance`. Every decision of every allocator run is put to the production function by `check-allocator.ts`, and the count that differ is reported.

## Corrections

Added on 10 October 2026 after the first runs. They correct the wording of this file and change no run.

- "Its settings are its defaults: at most 60% of the vault in a venue" is wrong on the 60%. The planner has no default limit per venue: in production it reads each venue's limit from the strategy contract. The 60% of the runs is the public vault's limit, applied here by choice. The other settings named there are the planner's defaults.
- "The same plan on two readings in a row" is the same two sets of venues, the ones filled and the ones drained by at least $1,000 each. The amounts may differ between the two readings.
- The entry provider is outside both limits: the 60% of the vault and the 10% of a venue (point 7 above names the first only).

Added on 11 October 2026 after an internal review of the simulator. They change no run either.

- Point 2: the strict set is the set as the first programme ran it (`in_set`). The rule as first applied kept those vaults; `VENUE_RULE.md` has the order of events.
- Point 3: production has no adapter for a Morpho Vault V2 or a single Morpho Blue market either. Their 1.75 is the constant of a first-generation Morpho vault, which is what production gives an adapter it does not know. It is an assumption for them as it is for Fluid and Spark Savings.
- Point 4: where the probe is steeper than an exponent of 10 gives, the run uses 10 and prices the venue's impact below what its own probe shows.
- Point 6: two readings in a row are two looks four hours apart. What the plan was in between is not seen. A move is made four hours after it is first seen; production would make it after about fifteen minutes.
- Point 9: "every run" is the Thesauros run and the equal-weight control of every run. Just Best Vault and Just Aave do not apply the liquidity rule. The control sells what it holds in such a venue at a split, where the allocator keeps it: the two are not treated alike.
- Point 11: what is credited is the index growth scaled by the measured effect of the vault's own deposit, never above the growth. The figure promised there is table 11 of the figures files, with its definition.
- Point 13: the decisions put to production are those of the Thesauros run without stress. The decisions of the four stress scenarios are not. The check shows that the port decides as production does on the inputs the simulator built; how the simulator builds them it does not show.
- Set B as simulated. The Euler vaults eUSDC-70 and eUSDC-80 pass tests 1 to 3 in some months and are not simulated: the collector cannot read them. Dolomite USDC on Ethereum and the Avantis vault on Base are neither in set B nor failed: a test of theirs was not read. Sixteen venue-months of set B are there on a size that is interest accrued on a market lent out in full, not USDC that can be withdrawn: the Morpho PAXG market in seven months, the sdeUSD market in five, Adpend USDC in two, 1337 USDC in one, and the HERMES market on Base in one. The liquidity rule kept every run out of them.
- Runs added after the first results, as the first programme had them: the main run with `rate_impact_enabled` false on each network, and on Ethereum the main run without Fluid and without Fluid and Spark Savings. They are sensitivity runs and are reported with the others.
- The wording of two reasons in the rebalance files was changed (a comma taken out, which broke the CSV) and the allocator runs were written again. No figure changed.

