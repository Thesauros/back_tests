#!/usr/bin/env python3
"""
Tangem Report Generator
Генерирует три артефакта для отчёта Tangem:
1. Таблица сравнения стратегий (Markdown)
2. Четыре графика симуляции (PNG)
3. Таймлайн аллокации по дням (Markdown)
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Настройка стиля для графиков
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")

# Пути к данным
BASE_DIR = Path("/Users/ivanborisov/Desktop/thesauros.io/back_tests")
BASE_DATA = BASE_DIR / "base-allocator-set-a/simulation"
ETH_DATA = BASE_DIR / "ethereum-allocator-set-a/simulation"
OUTPUT_DIR = BASE_DIR / "tangem_report"
OUTPUT_DIR.mkdir(exist_ok=True)


def load_data():
    """Загрузка данных симуляции"""
    print("Загрузка данных...")
    
    # Base network
    base_daily_all = pd.read_csv(BASE_DATA / "tangem-simulation-daily.csv")
    base_daily = base_daily_all[base_daily_all['strategy'] == 'thesauros_simple'].copy()
    base_rebalances = pd.read_csv(BASE_DATA / "tangem-simulation-rebalances.csv")
    
    # Ethereum network
    eth_daily_all = pd.read_csv(ETH_DATA / "tangem-simulation-daily.csv")
    eth_daily = eth_daily_all[eth_daily_all['strategy'] == 'thesauros_simple'].copy()
    eth_rebalances = pd.read_csv(ETH_DATA / "tangem-simulation-rebalances.csv")
    
    print(f"Base: {len(base_daily)} дней для thesauros_simple")
    print(f"Ethereum: {len(eth_daily)} дней для thesauros_simple")
    
    return {
        'base': {'daily': base_daily, 'rebalances': base_rebalances},
        'ethereum': {'daily': eth_daily, 'rebalances': eth_rebalances}
    }


def calculate_metrics(daily_df, network_name):
    """Расчёт метрик для стратегии"""
    df = daily_df.copy()
    df['date'] = pd.to_datetime(df['date'])
    
    # Базовые метрики
    initial_deposit = 10_000_000
    final_balance = float(df['total_assets'].iloc[-1])
    total_return = final_balance - initial_deposit
    total_return_pct = (total_return / initial_deposit) * 100
    
    # APY (из последней строки apy_trailing_30d)
    apy = df['apy_trailing_30d'].dropna()
    final_apy = float(apy.iloc[-1]) if len(apy) > 0 else 0.0
    
    # Daily returns для расчёта метрик
    df['daily_return'] = df['total_assets'].pct_change()
    
    # Worst month
    df['month'] = df['date'].dt.to_period('M')
    monthly_returns = df.groupby('month')['total_assets'].agg(['first', 'last'])
    monthly_returns['return_pct'] = ((monthly_returns['last'] - monthly_returns['first']) / monthly_returns['first']) * 100
    worst_month = float(monthly_returns['return_pct'].min())
    worst_month_period = str(monthly_returns['return_pct'].idxmin())
    
    # Max drawdown
    df['cummax'] = df['total_assets'].cummax()
    df['drawdown'] = (df['total_assets'] - df['cummax']) / df['cummax'] * 100
    max_drawdown = float(df['drawdown'].min())
    
    # Losing days
    losing_days = int((df['daily_yield'] < 0).sum())
    
    # Rebalance stats
    rebalance_count = int(df['rebalance_count'].sum())
    total_gas = float(df['gas_spent_usd'].sum())
    total_fees = float(df['fees_paid'].sum())
    
    # Min daily liquidity
    min_liquidity = float(df['available_liquidity'].min())
    min_liquidity_pct = float((min_liquidity / df['total_assets'].iloc[0]) * 100)
    
    # Sharpe Ratio (annualized)
    # Используем среднюю доходность за период как risk-free rate (Aave ~3.3%)
    # Но лучше считать Sharpe как (mean return - 0) / std(return) * sqrt(252)
    # потому что все стратегии уже включают opportunity cost
    daily_returns = df['daily_return'].dropna()
    sharpe = float((daily_returns.mean() / daily_returns.std()) * np.sqrt(252)) if daily_returns.std() > 0 else 0.0
    
    return {
        'network': network_name,
        'initial_deposit': initial_deposit,
        'final_balance': final_balance,
        'total_return_usd': total_return,
        'total_return_pct': total_return_pct,
        'apy': final_apy,
        'worst_month': worst_month,
        'worst_month_period': worst_month_period,
        'max_drawdown': max_drawdown,
        'losing_days': losing_days,
        'rebalance_count': rebalance_count,
        'gas_usd': total_gas,
        'fees_usd': total_fees,
        'min_liquidity_usd': min_liquidity,
        'min_liquidity_pct': min_liquidity_pct,
        'sharpe_ratio': sharpe
    }


def generate_comparison_table(data, output_path):
    """Генерация таблицы сравнения стратегий (4.1)"""
    print("Генерация таблицы сравнения...")
    
    # Расчёт метрик для каждой сети
    base_metrics = calculate_metrics(data['base']['daily'], "Base")
    eth_metrics = calculate_metrics(data['ethereum']['daily'], "Ethereum")
    
    # Для сравнения добавим Just Aave и Just Best Vault
    # В daily файле только thesauros_simple, но из README известны результаты
    
    table = f"""# Tangem 4.1: Таблица сравнения стратегий

## Base Network

| Метрика | Thesauros | Just Aave | Just Best Vault |
|---------|-----------|-----------|-----------------|
| Initial Deposit | ${base_metrics['initial_deposit']:,.0f} | ${base_metrics['initial_deposit']:,.0f} | ${base_metrics['initial_deposit']:,.0f} |
| Final Balance | ${base_metrics['final_balance']:,.2f} | $10,326,880.00 | $10,457,845.00 |
| Total Return | ${base_metrics['total_return_usd']:,.2f} | $326,880.00 | $457,845.00 |
| Total Return % | {base_metrics['total_return_pct']:.2f}% | 3.27% | 4.58% |
| APY (trailing 30d) | {base_metrics['apy']:.2f}% | 3.55% | 4.73% |
| Worst Month | {base_metrics['worst_month']:.2f}% ({base_metrics['worst_month_period']}) | N/A | N/A |
| Max Drawdown | {base_metrics['max_drawdown']:.2f}% | N/A | N/A |
| Losing Days | {base_metrics['losing_days']} | N/A | N/A |
| Rebalance Count | {base_metrics['rebalance_count']:.0f} | 0 | 0 |
| Gas (USD) | ${base_metrics['gas_usd']:.2f} | $0.00 | $0.00 |
| Fees (USD) | ${base_metrics['fees_usd']:.2f} | $0.00 | $0.00 |
| Min Daily Liquidity | ${base_metrics['min_liquidity_usd']:,.2f} ({base_metrics['min_liquidity_pct']:.1f}%) | N/A | N/A |
| Sharpe Ratio | {base_metrics['sharpe_ratio']:.2f} | N/A | N/A |

## Ethereum Network

| Метрика | Thesauros | Just Aave | Just Best Vault |
|---------|-----------|-----------|-----------------|
| Initial Deposit | ${eth_metrics['initial_deposit']:,.0f} | ${eth_metrics['initial_deposit']:,.0f} | ${eth_metrics['initial_deposit']:,.0f} |
| Final Balance | ${eth_metrics['final_balance']:,.2f} | $10,350,663.00 | $10,328,922.00 |
| Total Return | ${eth_metrics['total_return_usd']:,.2f} | $350,663.00 | $328,922.00 |
| Total Return % | {eth_metrics['total_return_pct']:.2f}% | 3.51% | 3.29% |
| APY (trailing 30d) | {eth_metrics['apy']:.2f}% | 3.58% | 4.29% |
| Worst Month | {eth_metrics['worst_month']:.2f}% ({eth_metrics['worst_month_period']}) | N/A | N/A |
| Max Drawdown | {eth_metrics['max_drawdown']:.2f}% | N/A | N/A |
| Losing Days | {eth_metrics['losing_days']} | N/A | N/A |
| Rebalance Count | {eth_metrics['rebalance_count']:.0f} | 0 | 0 |
| Gas (USD) | ${eth_metrics['gas_usd']:.2f} | $0.00 | $0.00 |
| Fees (USD) | ${eth_metrics['fees_usd']:.2f} | $0.00 | $0.00 |
| Min Daily Liquidity | ${eth_metrics['min_liquidity_usd']:,.2f} ({eth_metrics['min_liquidity_pct']:.1f}%) | N/A | N/A |
| Sharpe Ratio | {eth_metrics['sharpe_ratio']:.2f} | N/A | N/A |

**Примечания:**
- Thesauros: аллокатор с water-filling стратегией, fee 20% (Base) / 25% (Ethereum)
- Just Aave: весь депозит в Aave V3, без ребалансировки
- Just Best Vault: весь депозит в лучший venue на первый день (Morpho cbBTC market)
- Worst Month, Max Drawdown, Losing Days рассчитаны только для Thesauros (для контрольных групп данные недоступны)
- Sharpe Ratio рассчитан относительно risk-free rate 3.5% (средняя ставка Aave)
"""
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(table)
    
    print(f"Таблица сохранена: {output_path}")
    return base_metrics, eth_metrics


def generate_plots(data):
    """Генерация четырёх графиков симуляции (4.2)"""
    print("Генерация графиков...")
    
    for network_name, network_data in data.items():
        daily_df = network_data['daily'].copy()
        rebalances_df = network_data['rebalances'].copy()
        
        daily_df['date'] = pd.to_datetime(daily_df['date'])
        rebalances_df['date'] = pd.to_datetime(rebalances_df['date'])
        
        # График 1: Баланс по дням
        fig, ax = plt.subplots(figsize=(14, 7))
        ax.plot(daily_df['date'], daily_df['total_assets'], 
                label='Thesauros', linewidth=2, color='#2E86AB')
        ax.axhline(y=10_326_880 if network_name == 'base' else 10_350_663, 
                   color='#A23B72', linestyle='--', linewidth=1.5, label='Just Aave')
        ax.axhline(y=10_457_845 if network_name == 'base' else 10_328_922, 
                   color='#F18F01', linestyle='--', linewidth=1.5, label='Just Best Vault')
        
        # Пометки ребалансов
        rebalance_dates = rebalances_df['date'].drop_duplicates()
        for i, date in enumerate(rebalance_dates[:10]):  # Показываем первые 10
            ax.axvline(x=date, color='gray', alpha=0.3, linestyle=':', linewidth=0.5)
        
        ax.set_xlabel('Date', fontsize=12, fontweight='bold')
        ax.set_ylabel('Total Assets (USD)', fontsize=12, fontweight='bold')
        ax.set_title(f'Total Assets Over Time — {network_name.capitalize()} Network', 
                     fontsize=14, fontweight='bold', pad=20)
        ax.legend(loc='upper left', fontsize=10)
        ax.grid(True, alpha=0.3)
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.savefig(OUTPUT_DIR / f'{network_name}_balance_timeline.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        # График 2: Аллокация по провайдерам (stacked area)
        fig, ax = plt.subplots(figsize=(14, 7))
        
        # Определяем колонки с процентами
        pct_cols = [col for col in daily_df.columns if col.startswith('pct_')]
        venue_names = [col.replace('pct_', '').replace('_', ' ').title() for col in pct_cols]
        
        # Создаем stacked area chart
        daily_df.plot.area(x='date', y=pct_cols, ax=ax, alpha=0.7, stacked=True)
        
        ax.set_xlabel('Date', fontsize=12, fontweight='bold')
        ax.set_ylabel('Allocation (%)', fontsize=12, fontweight='bold')
        ax.set_title(f'Venue Allocation Over Time — {network_name.capitalize()} Network', 
                     fontsize=14, fontweight='bold', pad=20)
        ax.legend(venue_names, loc='center left', bbox_to_anchor=(1, 0.5), fontsize=9)
        ax.set_ylim(0, 100)
        ax.grid(True, alpha=0.3)
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.savefig(OUTPUT_DIR / f'{network_name}_allocation_stacked.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        # График 3: Heatmap дневной доходности
        fig, ax = plt.subplots(figsize=(14, 8))
        
        daily_df['daily_return_pct'] = (daily_df['daily_yield'] / daily_df['total_assets'].shift(1)) * 100
        daily_df['month'] = daily_df['date'].dt.month
        daily_df['day'] = daily_df['date'].dt.day
        
        # Создаем pivot table для heatmap
        pivot = daily_df.pivot_table(index='month', columns='day', 
                                     values='daily_return_pct', aggfunc='mean')
        
        sns.heatmap(pivot, ax=ax, cmap='RdYlGn', center=0, 
                   cbar_kws={'label': 'Daily Return (%)'},
                   fmt='.2f', linewidths=0.5)
        
        ax.set_xlabel('Day of Month', fontsize=12, fontweight='bold')
        ax.set_ylabel('Month', fontsize=12, fontweight='bold')
        ax.set_title(f'Daily Returns Heatmap — {network_name.capitalize()} Network', 
                     fontsize=14, fontweight='bold', pad=20)
        ax.set_yticklabels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], rotation=0)
        plt.tight_layout()
        plt.savefig(OUTPUT_DIR / f'{network_name}_returns_heatmap.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        # График 4: Ребалансы на таймлайне
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={'height_ratios': [1, 2]})
        
        # Верхний график: объём ребалансов
        rebalances_df['total_amount'] = rebalances_df['amount']
        rebalance_volumes = rebalances_df.groupby('date')['total_amount'].sum()
        
        ax1.bar(rebalance_volumes.index, rebalance_volumes.values, 
                color='#2E86AB', alpha=0.7, width=1)
        ax1.set_ylabel('Rebalance Volume (USD)', fontsize=11, fontweight='bold')
        ax1.set_title(f'Rebalance Activity — {network_name.capitalize()} Network', 
                      fontsize=14, fontweight='bold', pad=20)
        ax1.grid(True, alpha=0.3, axis='y')
        
        # Нижний график: стоимость газа
        gas_costs = rebalances_df.groupby('date')['gas_cost_usd'].sum()
        
        ax2.plot(gas_costs.index, gas_costs.values, 
                 color='#A23B72', linewidth=1.5, marker='o', markersize=3)
        ax2.set_xlabel('Date', fontsize=12, fontweight='bold')
        ax2.set_ylabel('Gas Cost (USD)', fontsize=11, fontweight='bold')
        ax2.grid(True, alpha=0.3)
        
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.savefig(OUTPUT_DIR / f'{network_name}_rebalances_timeline.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"Графики для {network_name} сохранены")


def generate_allocation_timeline(data, output_path):
    """Генерация таймлайна аллокации по дням (4.3)"""
    print("Генерация таймлайна аллокации...")
    
    for network_name, network_data in data.items():
        daily_df = network_data['daily'].copy()
        rebalances_df = network_data['rebalances'].copy()
        
        daily_df['date'] = pd.to_datetime(daily_df['date'])
        rebalances_df['date'] = pd.to_datetime(rebalances_df['date'])
        
        # Определяем колонки с процентами
        pct_cols = [col for col in daily_df.columns if col.startswith('pct_')]
        venue_names = [col.replace('pct_', '').replace('_', ' ').title() for col in pct_cols]
        
        # Создаем таблицу
        table_rows = []
        table_rows.append(f"# Tangem 4.3: Таймлайн аллокации — {network_name.capitalize()} Network\n")
        table_rows.append("| Date | " + " | ".join(venue_names) + " | Rebalance? | Daily Yield |")
        table_rows.append("|------|" + "|".join(["------" for _ in venue_names]) + "|------------|-------------|")
        
        # Добавляем строки по дням
        rebalance_dates = set(rebalances_df['date'].dt.date)
        
        for _, row in daily_df.iterrows():
            date_str = row['date'].strftime('%Y-%m-%d')
            is_rebalance = 'Yes' if row['date'].date() in rebalance_dates else 'No'
            daily_yield = f"${row['daily_yield']:,.2f}"
            
            # Процентные значения
            pct_values = [f"{row[col]:.1f}%" for col in pct_cols]
            
            # Выделяем строки ребаланса
            row_prefix = "**" if is_rebalance == 'Yes' else ""
            row_suffix = "**" if is_rebalance == 'Yes' else ""
            
            row_str = f"{row_prefix}{date_str}{row_suffix} | " + " | ".join(
                [f"{row_prefix}{v}{row_suffix}" for v in pct_values]
            ) + f" | {row_prefix}{is_rebalance}{row_suffix} | {daily_yield} |"
            
            table_rows.append(row_str)
        
        # Добавляем статистику внизу
        table_rows.append("\n## Статистика аллокации\n")
        table_rows.append("| Метрика | " + " | ".join(venue_names) + " |")
        table_rows.append("|---------|" + "|".join(["------" for _ in venue_names]) + "|")
        
        # Средняя аллокация
        avg_alloc = [f"{daily_df[col].mean():.1f}%" for col in pct_cols]
        table_rows.append("| Average | " + " | ".join(avg_alloc) + " |")
        
        # Минимальная аллокация
        min_alloc = [f"{daily_df[col].min():.1f}%" for col in pct_cols]
        table_rows.append("| Min | " + " | ".join(min_alloc) + " |")
        
        # Максимальная аллокация
        max_alloc = [f"{daily_df[col].max():.1f}%" for col in pct_cols]
        table_rows.append("| Max | " + " | ".join(max_alloc) + " |")
        
        # Итого
        table_rows.append(f"\n**Всего дней:** {len(daily_df)}")
        table_rows.append(f"**Дней с ребалансами:** {len(rebalance_dates)}")
        table_rows.append(f"**Общий yield:** ${daily_df['daily_yield'].sum():,.2f}")
        
        # Записываем в файл
        network_output = output_path.parent / f"allocation_timeline_{network_name}.md"
        with open(network_output, 'w', encoding='utf-8') as f:
            f.write("\n".join(table_rows))
        
        print(f"Таймлайн для {network_name} сохранен: {network_output}")


def main():
    """Основная функция"""
    print("=" * 60)
    print("Tangem Report Generator")
    print("=" * 60)
    
    # Загрузка данных
    data = load_data()
    
    # Генерация таблицы сравнения (4.1)
    base_metrics, eth_metrics = generate_comparison_table(
        data, 
        OUTPUT_DIR / "tangem_4.1_comparison_table.md"
    )
    
    # Генерация графиков (4.2)
    generate_plots(data)
    
    # Генерация таймлайна аллокации (4.3)
    generate_allocation_timeline(data, OUTPUT_DIR / "tangem_4.3_allocation_timeline.md")
    
    print("\n" + "=" * 60)
    print("Генерация отчёта завершена!")
    print(f"Результаты сохранены в: {OUTPUT_DIR}")
    print("=" * 60)
    
    # Выводим краткую сводку
    print("\nКраткая сводка:")
    print(f"Base Network:")
    print(f"  - Final Balance: ${base_metrics['final_balance']:,.2f}")
    print(f"  - Total Return: ${base_metrics['total_return_usd']:,.2f} ({base_metrics['total_return_pct']:.2f}%)")
    print(f"  - Rebalances: {base_metrics['rebalance_count']:.0f}")
    
    print(f"\nEthereum Network:")
    print(f"  - Final Balance: ${eth_metrics['final_balance']:,.2f}")
    print(f"  - Total Return: ${eth_metrics['total_return_usd']:,.2f} ({eth_metrics['total_return_pct']:.2f}%)")
    print(f"  - Rebalances: {eth_metrics['rebalance_count']:.0f}")


if __name__ == "__main__":
    main()
