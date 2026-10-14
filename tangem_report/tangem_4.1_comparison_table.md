# Tangem 4.1: Strategy Comparison Table

## Base Network

| Metric | Thesauros | Just Aave | Just Best Vault |
|---------|-----------|-----------|-----------------|
| Initial Deposit | $10,000,000 | $10,000,000 | $10,000,000 |
| Final Balance | $10,366,570.77 | $10,326,880.00 | $10,457,845.00 |
| Total Return | $366,570.77 | $326,880.00 | $457,845.00 |
| Total Return % | 3.67% | 3.27% | 4.58% |
| APY (trailing 30d) | 3.41% | 3.55% | 4.73% |
| Worst Month | 0.05% (2026-10) | N/A | N/A |
| Max Drawdown | 0.00% | N/A | N/A |
| Losing Days | 0 | N/A | N/A |
| Rebalance Count | 153 | 0 | 0 |
| Gas (USD) | $2.16 | $0.00 | $0.00 |
| Fees (USD) | $91642.69 | $0.00 | $0.00 |
| Min Daily Liquidity | $3,160,015.86 (31.6%) | N/A | N/A |
| Sharpe Ratio | 85.42 | N/A | N/A |

## Ethereum Network

| Metric | Thesauros | Just Aave | Just Best Vault |
|---------|-----------|-----------|-----------------|
| Initial Deposit | $10,000,000 | $10,000,000 | $10,000,000 |
| Final Balance | $10,304,534.96 | $10,350,663.00 | $10,328,922.00 |
| Total Return | $304,534.96 | $350,663.00 | $328,922.00 |
| Total Return % | 3.05% | 3.51% | 3.29% |
| APY (trailing 30d) | 3.04% | 3.58% | 4.29% |
| Worst Month | 0.04% (2026-10) | N/A | N/A |
| Max Drawdown | 0.00% | N/A | N/A |
| Losing Days | 0 | N/A | N/A |
| Rebalance Count | 783 | 0 | 0 |
| Gas (USD) | $716.17 | $0.00 | $0.00 |
| Fees (USD) | $101511.67 | $0.00 | $0.00 |
| Min Daily Liquidity | $4,077,246.51 (40.8%) | N/A | N/A |
| Sharpe Ratio | 104.74 | N/A | N/A |

**Notes:**
- Thesauros: allocator with water-filling strategy, fee 20% (Base) / 25% (Ethereum)
- Just Aave: entire deposit in Aave V3, no rebalancing
- Just Best Vault: entire deposit in the best venue on day one (Morpho cbBTC market)
- Worst Month, Max Drawdown, Losing Days calculated only for Thesauros (control groups data unavailable)
- Sharpe Ratio calculated as (mean daily return / std daily return) × √252
