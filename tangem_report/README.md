# Tangem Report — Backtest Results

**Period:** October 7, 2025 — October 7, 2026  
**Initial Deposit:** $10,000,000 USDC  
**Networks:** Base, Ethereum  
**Generated:** October 14, 2026

---

## Contents

### 4.1 Strategy Comparison Table
**File:** `tangem_4.1_comparison_table.md`

Summary table for the Tangem report comparing three strategies:
- **Thesauros** — allocator with water-filling strategy
- **Just Aave** — entire deposit in Aave V3, no rebalancing
- **Just Best Vault** — entire deposit in the best venue on day one

**Metrics:**
- Initial deposit, final balance, total return
- APY, worst month, max drawdown
- Losing days, rebalance count
- Gas costs, fees paid
- Min daily liquidity, Sharpe ratio

**Key Results:**

| Network | Strategy | Final Balance | Total Return | APY |
|---------|----------|---------------|--------------|-----|
| Base | Thesauros | $10,457,845 | 4.58% | 4.25% |
| Base | Just Aave | $10,326,880 | 3.27% | 3.55% |
| Base | Just Best Vault | $10,457,845 | 4.58% | 4.73% |
| Ethereum | Thesauros | $10,328,922 | 3.29% | 3.92% |
| Ethereum | Just Aave | $10,350,663 | 3.51% | 3.58% |
| Ethereum | Just Best Vault | $10,328,922 | 3.29% | 4.29% |

---

### 4.2 Four Simulation Charts

#### 1. Balance Timeline
**Files:** `base_balance_timeline.png`, `ethereum_balance_timeline.png`

Daily balance chart for three strategies:
- Thesauros (blue line)
- Just Aave (red dashed line)
- Just Best Vault (orange dashed line)

With rebalance markers and stress triggers.

#### 2. Allocation Stacked Area
**Files:** `base_allocation_stacked.png`, `ethereum_allocation_stacked.png`

Stacked area chart showing allocation by venue (0-100%):
- Aave V3
- Steakhouse USDC
- Gauntlet USDC Prime
- Steakhouse Prime USDC
- Spark USDC Vault
- Steakhouse Prime USDC V2
- Morpho cbBTC Market

#### 3. Daily Returns Heatmap
**Files:** `base_returns_heatmap.png`, `ethereum_returns_heatmap.png`

Heatmap of daily returns by month and day.  
Color scale: red (negative returns) to green (positive returns).

#### 4. Rebalances Timeline
**Files:** `base_rebalances_timeline.png`, `ethereum_rebalances_timeline.png`

Two charts:
- **Top:** rebalance volume (USD) by date
- **Bottom:** gas costs (USD) by date

---

### 4.3 Daily Allocation Timeline
**Files:** `allocation_timeline_base.md`, `allocation_timeline_ethereum.md`

Table with daily allocation by provider:
- **Columns:** date, % allocation for each provider, rebalance occurred?, daily yield
- **Rebalance rows highlighted in bold**
- **Bottom:** average, min, and max allocation for each provider

**Statistics:**

| Network | Total Days | Rebalance Days | Total Yield |
|---------|------------|----------------|-------------|
| Base | 365 | 179 | $457,845 |
| Ethereum | 365 | 836 | $328,922 |

---

## Data Sources

All data obtained from simulation in the `back_tests` repo:
- `base-allocator-set-a/simulation/` — results for Base network
- `ethereum-allocator-set-a/simulation/` — results for Ethereum network

**Configuration:**
- Allocator: water-filling strategy
- Fee: 20% (Base), 25% (Ethereum)
- Rate impact: enabled
- Venue set: set A (curated venues with collateral test)
- Liquidity rule: 60% of vault in a venue

---

## Important Notes

1. **This is not a track record.** Live vaults were deployed within the simulation window and held $1-11.

2. **The simulation does not move real vaults.** Uses a port of the water-filling allocator, but not the production service.

3. **Most venues are not live vault providers.** New adapters required for Morpho cbBTC market, Fluid fUSDC, Spark Savings sUSDC.

4. **Base: 96.2% of vault in one Morpho cbBTC market.** Most of the result depends on a single collateral token (cbBTC) and a single oracle.

5. **Ethereum: 59% of interest from two venues.** Fluid fUSDC and Spark Savings sUSDC do not have a Thesauros adapter.

---

## Files Generated

```
tangem_report/
├── README.md (this file)
├── tangem_4.1_comparison_table.md
├── allocation_timeline_base.md
├── allocation_timeline_ethereum.md
├── base_balance_timeline.png
├── base_allocation_stacked.png
├── base_returns_heatmap.png
├── base_rebalances_timeline.png
├── ethereum_balance_timeline.png
├── ethereum_allocation_stacked.png
├── ethereum_returns_heatmap.png
└── ethereum_rebalances_timeline.png
```

---

## Regeneration

To regenerate the report:

```bash
cd /Users/ivanborisov/Desktop/thesauros.io/back_tests
python3 generate_tangem_report.py
```

**Requirements:** Python 3.14+, pandas, matplotlib, seaborn, numpy

---

**Report generated for Tangem partnership evaluation.**
