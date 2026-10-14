# Tangem Backtest — Executive Summary

**Date:** October 14, 2026  
**Period:** October 7, 2025 — October 7, 2026 (1 year)  
**Initial Deposit:** $10,000,000 USDC

---

## Key Results

### Base Network

| Strategy | Final Balance | Total Return | APY | Rebalances | Gas | Fees |
|----------|---------------|--------------|-----|------------|-----|------|
| **Thesauros** | $10,457,845 | **+$457,845 (4.58%)** | 4.25% | 179 | $2.67 | $91,643 |
| Just Aave | $10,326,880 | +$326,880 (3.27%) | 3.55% | 0 | $0 | $0 |
| Just Best Vault | $10,457,845 | +$457,845 (4.58%) | 4.73% | 0 | $0 | $0 |

**Insights:**
- Thesauros outperformed Aave by **$130,965 (+1.31 pp)**
- Thesauros matched Just Best Vault (both 4.58%)
- 96.2% of vault in Morpho cbBTC market (single collateral risk: cbBTC)
- Max drawdown: -4.17%
- Min liquidity: $3.16M (31.6% of vault) — healthy

---

### Ethereum Network

| Strategy | Final Balance | Total Return | APY | Rebalances | Gas | Fees |
|----------|---------------|--------------|-----|------------|-----|------|
| **Thesauros** | $10,328,922 | +$328,922 (3.29%) | 3.92% | 836 | $808 | $101,512 |
| Just Aave | $10,350,663 | **+$350,663 (3.51%)** | 3.58% | 0 | $0 | $0 |
| Just Best Vault | $10,328,922 | +$328,922 (3.29%) | 4.29% | 0 | $0 | $0 |

**Insights:**
- Thesauros underperformed Aave by **-$21,741 (-0.22 pp)**
- Result heavily dependent on Fluid fUSDC (31.1%) and Spark Savings sUSDC (27.9%)
- Both venues lack Thesauros adapter — simulation assumes 1.75 impact exponent
- Max drawdown: -3.54%
- Min liquidity: $6,403 (0.1% of vault) — **concerning**

---

## Critical Findings

### 1. Base Network — Strong Performance
- Allocator successfully identified Morpho cbBTC market as best venue
- Consistent outperformance vs Aave throughout the year
- Low gas costs ($2.67) due to Base L2 economics
- **Risk:** 96.2% concentration in one market (cbBTC collateral)

### 2. Ethereum Network — Mixed Results
- Underperformed simple Aave HODL strategy
- High gas costs ($808) and rebalance frequency (836 txs)
- Liquidity drops to 0.1% of vault — **withdrawal risk**
- **Dependency:** 59% of yield from 2 venues without production adapters

### 3. Fee Sensitivity
- Base: Break-even fee at 28.5% (depositor equals Aave)
- Ethereum: Break-even fee at 13.8% (depositor equals Aave)
- At 0% fee: Thesauros adds +$133,407 (Base) and +$57,425 (Ethereum) vs Aave

### 4. Operational Reality Check
- **Live vaults held $1-11 during simulation** — not track record
- Production allocator never ran on mainnet
- Most venues require new adapter development
- Single-EOA control on Ethereum vault (security risk)

---

## Risk Assessment

### High Priority Risks

1. **Concentration Risk (Base)**
   - 96.2% in Morpho cbBTC market
   - Single collateral token (cbBTC)
   - Single oracle (BTC/USD feed, no cbBTC feed)

2. **Liquidity Risk (Ethereum)**
   - Min liquidity 0.1% of vault
   - Only 346/365 days with full withdrawal possible
   - Fluid fUSDC and Spark sUSDC have withdrawal constraints

3. **Adapter Gap**
   - 6/11 Ethereum venues need new adapters
   - 3/7 Base venues need new adapters
   - Production cannot replicate simulation results today

### Medium Priority Risks

4. **Gas Cost Volatility**
   - Ethereum gas: $808 (simulation) vs real vault: $475
   - High rebalance frequency (836 txs) erodes yield

5. **Single-EOA Trust Root**
   - Ethereum vault: admin, treasury, proxy admin on one key
   - No timelock on fee changes or implementation upgrades

---

## Recommendations

### For Tangem Partnership

1. **Deploy on Base first** — stronger risk-adjusted returns, lower gas
2. **Reduce concentration limit** — cap Morpho cbBTC at 60% (currently 96%)
3. **Build adapters** — prioritize Fluid fUSDC and Spark sUSDC for Ethereum
4. **Move to Safe multisig** — Ethereum vault before any significant TVL
5. **Start with 0% fee** — build track record before enabling 20-25% cap

### For Production Readiness

1. **Liquidity guardrails** — min 10% available liquidity at all times
2. **Rebalance throttling** — reduce frequency on Ethereum (high gas)
3. **Multi-oracle validation** — add cbBTC-specific oracle feed
4. **Timelock on admin actions** — 24-48h delay on fee/implementation changes

---

## Files Delivered

### 4.1 Comparison Table
`tangem_4.1_comparison_table.md` — full metric comparison across strategies

### 4.2 Charts (8 PNG files, 300 DPI)
- Balance timeline (Base + Ethereum)
- Allocation stacked area (Base + Ethereum)
- Daily returns heatmap (Base + Ethereum)
- Rebalances timeline (Base + Ethereum)

### 4.3 Allocation Timeline
- `allocation_timeline_base.md` — 365 days, 179 rebalances highlighted
- `allocation_timeline_ethereum.md` — 365 days, 836 rebalances highlighted

---

## Methodology Notes

**Simulation:**
- Water-filling allocator with public vault rules
- 60% of vault in a venue (per-venue limit)
- Rate impact enabled (deposit affects venue rates)
- Set A venue selection (curated, collateral-tested)

**Controls:**
- Just Aave: buy & hold, no rebalancing
- Just Best Vault: best venue on day 1, no rebalancing
- Equal weight: rebalanced monthly across eligible venues

**Data:**
- 2,191 readings (Base), 2,180 readings (Ethereum)
- ~4 hour intervals from on-chain sources
- Venue eligibility verified monthly

---

**Prepared for Tangem partnership evaluation**  
**Not a track record — simulation results only**
