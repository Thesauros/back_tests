# Venue selection rule

This section was fixed on 9 October 2026, before the candidate search and before any history of the added venues was collected. No rate, yield or outcome of the year enters a test. The section after it was written later the same day; the last section says when, and what was known by then.

A venue is in the set for a month of the window if, at the first reading of that month (the 7th, from 7 October 2025 to 7 September 2026), it passes every test:

1. **Asset.** USDC on Ethereum or Base, deposited and withdrawn as USDC, one transaction each, at the venue's own contract.
2. **Withdrawal on demand.** No queue, cooldown, epoch or notice period.
3. **Size.** At least $100M of USDC supplied, read on-chain.
4. **Collateral, for a curated vault** (one curator decides what it lends against: Morpho vaults of both generations, Euler vaults and the like). At least 90% of its assets are idle USDC or lent against WBTC, cbBTC, tBTC, WETH, wstETH, cbETH or rETH, read on-chain and looked through to the markets. Where a vault lends one pool against several collaterals and the split cannot be read, it qualifies only if every collateral it accepts is on that list.

Pooled markets and savings rates run by protocol governance (Aave V3, Compound V3, SparkLend, Fluid, Moonwell, Spark Savings) have no per-collateral split of their USDC, so test 4 cannot be computed for them. They are admitted on tests 1 to 3 and what stands behind them is described.

Candidates are searched in the Morpho API (both vault generations) and in DefiLlama histories, including venues that have since shrunk or failed. The sizes and the collateral that decide are read from the chain.

Inside a month the simulation applies its venue-share limit at every reading: a venue takes money only while a full position, 60% of the vault, would be at most 10% of that venue.

A venue that passes the rule but has no Thesauros provider adapter is a proposed venue: running it needs a new adapter.

## How the rule was applied

Decisions taken on 9 October 2026 after the candidate search and before the year's history of the added venues was collected. The candidate search had by then downloaded third-party rate histories of the candidates (DefiLlama, daily) and their share prices at the monthly readings (the Morpho API), and had listed the venues that failed in the year, so the decisions were taken with those at hand. The first four are the stricter reading; the fifth is the literal one and changes no set.

1. **Test 4 is waived only for the six governance-run venues the rule names.** Every other venue is tested on its collateral. A single Morpho Blue market is tested on its one collateral, so the cbBTC and WBTC markets pass and the USDe, srUSD and mHYPER markets fail. Dolomite, the Euler vaults and the Avantis vault accept or stand on collateral outside the list and fail.
2. **A venue that refuses a deposit from an address it has not onboarded fails test 1.** This covers permissioned Maple pools and tokenised funds.
3. **A wrapper is not a second venue.** A venue that at the reading holds most of its assets through another venue of the set is left out for that month: a Vault V2 still on its V1 vault adapter, the Aave wrapper waEthUSDC, and a curated vault with more than half of its assets in one single market of the set. The table first applied this to the first two cases only; an internal review pointed out that the sentence also covers the third, and the table was corrected after the collector's first full-year run and before any simulation of the set. On Base all 38 vault-months that pass the tests are 86% to 100% the cbBTC market. On Ethereum 21 pass: one is a wrapper (Gauntlet USDC Prime V2 in May 2026), 18 are more than half one of the two markets, and two are in the set (Steakhouse USDC in March and April 2026). A second run keeps those vaults, to show what they would add.
4. **Spark Savings USDC v2 (spUSDC) fails test 2.** Only a buffer is payable on demand, 10% of assets in 2025 and a fixed $10M from January 2026; the rest waits for the operator to refill it. Spark USDC Vault v1 (sUSDC), which pays the same rate and exits through the Sky PSM, is tested in its place.
5. **`totalAssets()` is taken as read.** 1337 USDC and Adpend USDC report above $100M from interest accruing on a fully borrowed sdeUSD market; they fail test 4.

"The first reading of the month" is the collector's first reading at or after 00:00 UTC on the 7th. On Ethereum it falls up to 2 hours 41 minutes after midnight.

## History

The file has three commits, all of 9 October 2026. Times are UTC.

| Commit | Time | What it added |
|---|---|---|
| `2e5b463` | 17:55:17 | the four tests, the six names that are admitted without test 4, the limit on our share of a venue |
| `353d46a` | 19:18:27 | how the rule was applied: single markets tested on their collateral, permissioned venues, wrappers, spUSDC, `totalAssets()` as read |
| `7548061` | 20:54:54 | a vault that is mostly one single market of the set is the same book, and is left out |

What had happened by each of them:

- The window closed on 7 October 2026, and an earlier version of this pack, with the results of the deployed vaults, had been reviewed. All three commits are later: the rule was not registered before the year it is applied to, and it was written by people who knew those results.
- By the times of its files, the candidate search began two minutes after the first commit and ended six minutes before the second. It downloaded third-party rate histories and monthly share prices of the candidates and listed the venues that failed in the year.
- The collector's first full-year run of the added venues, a test run, finished at 20:16 UTC for Ethereum and at 20:51 UTC for Base, before the third commit. No simulation with the added venues had been run by then.

The text was edited once more on 10 October 2026, after a review of the pack: the first line of each of the first two sections now says what was known when it was written, the sentence on when the table was corrected is put right (it read "before the history was collected"), the Ethereum count in point 3 is 21 with the wrapper month where it read "18 of 20", and this section is added. No test, no decision and no row of the tables changed.

The commits are local to Thesauros. They prove no date to a third party.
