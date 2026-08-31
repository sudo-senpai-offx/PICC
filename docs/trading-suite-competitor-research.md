# Competitive Gap Analysis: PICC Retail Web Trading Dashboard

**Scope + framing.** PICC is a lightweight, retail-focused web trading/analysis dashboard. It is **advisory-only / paper-trading**: it charts, analyzes, backtests, alerts, and simulates — but does **not** execute live orders. This report compares it against real paid suites (TradingView, MetaTrader 4/5, cTrader, NinjaTrader) and open-source suites (OpenBB, Freqtrade, Jesse, StockSharp, TradingVue.js, lightweight-charts, etc.), then derives a feature-by-feature gap analysis and a prioritized list of gaps worth closing.

**Method.** Primary sources only: official pricing pages, vendor help centers, and GitHub repos. Prices are as-checked and should be re-verified before quoting to customers. All URLs cited inline.

---

## 1. Paid suites

### 1.1 TradingView (free + paid)

- **Charting:** full candlestick/bar/line/area charting with all timeframes; up to **110+ smart drawing tools** (trend lines, fib, rectangles, text); multi-timeframe analysis on one chart; Bar Replay; custom timeframes, custom range bars, intraday Renko/Kagi/Line-Break/Point&Figure; Dividend-adjusted charts. Free tier gives 1 chart/tab, 2 indicators (some sources say up to 3); paid scales to 16 charts/tab / 50 indicators at Ultimate. (https://www.tradingview.com/pricing/)
- **Indicators:** 400+ built-in indicators and 100K+ community-Pine-Script indicators; indicator-on-indicator; Volume Profile, Volume Footprint, TPO, Volume Candles, candlestick-pattern recognition, Auto Chart Patterns at Premium+. (https://www.tradingview.com/pricing/)
- **Historical data depth:** 3.5M+ instruments across 150+ exchanges / 50+ countries; day-and-higher TF historical = "All"; by-the-minute data 180 days (free) up to "All" (Plus+); by-the-second and tick data only at Premium+/Ultimate; historical bars per chart 5K (free) → 40K (Ultimate). (https://www.tradingview.com/pricing/)
- **Screeners / watchlists / alerts:** stock/ETF/DEX/crypto screeners with 500+ fields and ~5K filters; watchlists scale 1→multiple (1,000 symbols) with import/export, custom columns; price alerts 3 (free) → 1,000 (Ultimate), technical alerts similar; webhook + multi-condition alerts; alert durations 1–2 months on mid tiers, non-expiring only at Premium+; a big differentiator is **Bar Replay** and **deep backtesting** (tick-level execution on the highest tiers).
- **Economic/fundamental:** economic, earnings, dividend, IPO calendars; fundamental graphs / financials; real-time context news.
- **Paper trading + broker:** free simulated (paper) trading; chart trading and DOM trading; connects 100+ brokers for live execution (which PICC deliberately does not do).
- **Pricing:** Basic free; Essential ~$14.95/mo (annual $12.95); Plus ~$29.95/mo (annual $24.95–29.95); Premium ~$59.95–69.95/mo; Ultimate ~$199.95/mo. Prices rose ~17–20% on 2026-04-10 (e.g. Plus annual ≈ $359.40, Premium ≈ $719.40). (https://www.tradingview.com/pricing/ ; https://chartinglens.com/blog/tradingview-price-increase-2026)

### 1.2 MetaTrader 4 / 5 (MT4/MT5)

- **Charting:** MT4 = 9 timeframes, 30 built-in indicators, candlestick/bar/line charts; MT5 = 21 timeframes, 38 indicators, 44 graphical objects, Renko/Range/Point&Figure/Histogram. Both support full drawing sets. (https://www.metatrader5.com/ ; https://blog.opofinance.com/en/metatrader-4-vs-metatrader-5/)
- **Backtesting / strategy tester:** MT5 has a multi-threaded Strategy Tester (vs single-thread on MT4), every-tick vs 1-min-OHLC modes, real tick data from broker, walk-forward, optimization/cloud optimization, "Stress and Delays" slippage simulation, visual mode / bar-by-bar replay, and deep statistics (profit factor, Sharpe, drawdown, expected payoff). MT4 tester is more limited (simulated OHLCV ticks, no native walk-forward). (https://www.metatrader5.com/en/automated-trading/strategy-tester ; https://algotradingspace.com/metatrader-5-backtesting)
- **Market data / asset breadth:** MT5 is multi-asset (forex, stocks, indices, commodities, futures, options, bonds, crypto) vs MT4 forex-centric; **Depth of Market (DOM)** in MT5 only; economic calendar; copy/community; MQL5 language; free through brokers.
- **Analysis/AI/signals:** no native AI; signals via MT5 Copy Trading marketplace and third-party Autochartist/Trading Central integrations.
- **Pricing:** platform free via brokers (spread/commission to broker); web/desktop/mobile all free programs.

### 1.3 cTrader (Spotware)

- **Charting:** clean modern multi-asset charting for forex/CFD; 26+ timeframes, 70+ indicators, Renko/Range; modern UI; Level II **Depth of Market** with standard/price/VWAP DOM types; ChartShots sharing.
- **Automation/backtest:** cTrader Automate (formerly cAlgo) in full C#/.NET — cBots + indicators; accurate backtesting engine with genetic optimization; cloud hosting for 24/7 bots. (https://help.ctrader.com/)
- **Analysis/AI/signals:** no native AI; broker-side Autochartist/Trading Central integrations.
- **Asset breadth / pricing:** limited to a broker's instruments (e.g. 1,700+ markets at IC Markets, but no share CFDs on cTrader); platform itself free, broker sets costs.

### 1.4 NinjaTrader 8

- **Charting/analysis:** advanced futures/equity charting; order-flow depth (volumetric bars, footprint charts, delta, DOM); free **Sim** license gives charting, **Market Replay** (play back recorded L1/L2 tick data), Strategy Analyzer backtesting, and trade simulation for free — with no real-time data included.
- **Backtest:** Strategy Analyzer (Summary/Chart/Executions/Trades tabs), NinjaScript (C#) strategies, backtesting + optimization, commission/slippage/fill simulation.
- **Market data:** data is **not** included — must add a data feed (Rithmic/CQG/Kinetick ~$50–100+/mo); free Sim license has no live/intraday data.
- **Analysis/AI/signals:** no native AI; ecosystem of third-party add-ons.
- **Pricing:** free Sim license; live trading via lease or ~$1,099 lifetime license; plus data-feed costs. Desktop-only (no web SPA); no mobile app in the classic sense. (https://ninjatrader.com/ ; https://forum.ninjatrader.com/ ; https://quantvps.com/blog/backtest-on-ninjatrader)

### 1.5 Binary/derivative retail web dashboards

**Deriv (Binary.com) — DTrader, DBot, Deriv Trader, DMT5, SmartTrader, TradingView integration.**
- Asset breadth: forex, stocks, stock indices, commodities, crypto, ETFs, plus proprietary **Derived (synthetic) Indices** that trade 24/7 — a genuinely distinctive asset class.
- Charting: candlestick/Heikin-Ashi/tick/line/area; technical indicators; drawing/text/arrow/Fibonacci; economic calendar; MT5 signals; paper/demo trading; DBot visual no-code strategy builder ("build a bot without writing code"); backtesting on MT5/DBot; no live order execution in PICC's sense, but full binary/CFD trading in theirs.
- Pricing: broker spread/commission-based; free demo. (https://deriv.com/trading-platforms/deriv-mt5 ; https://deriv.com/trading-platforms/deriv-bot)

**IQ Option vs Olymp Trade.**
- IQ Option: multi-asset (forex, stocks, crypto, indices, commodities, ETFs), options/CFDs; up to 90%+ payouts; more built-in indicators than Olymp; web+apps; $10 min deposit.
- Olymp Trade: fixed-time trades from **5 seconds**, $1 min trade, up to 93% payouts, adds ETFs + composite indices; but "very limited range of charting tools and indicators", basic platform. Neither has true AI/ML signals; both rely on built-in indicators + economic calendar + signals feeds; no algorithmic backtesting toolset to speak of. (https://www.daytrading.com/olymp-trade-vs-iq-option ; https://tradingbluechip.com/comparison/olymp-trade-vs-iq-option-ae-which-binary-options-platform-wins-in-2026/)
- Takeaway for PICC: these retail dashboards win on **asset breadth + ultra-short expiries + low stakes**, but are **weak on deep charting, data honesty, and backtesting** — areas where PICC can differentiate.

**ChartingLens** (commercial, referenced as a fast-moving benchmark): AI signals scanning 2,000+ stocks, plain-English strategy backtester, AI screener, auto pattern recognition, volume profile — free tier + $14.99–29.99/mo. Useful as the closest commercial analog to "charting + AI advisory, no execution." (https://chartinglens.com/blog/tradingview-price-increase-2026)

---

## 2. Open-source suites

### 2.1 OpenBB (Terminal / Platform / Workspace)

- **Data:** connects 30+ data providers across equities, options, crypto, forex, fixed income, macro, commodity, regulatory; unified SDK/CLI/REST/API via a single Fetcher abstraction; 600+ terminal commands.
- **Charting/analysis:** OBBject chart objects (candles/OHLCV); technical indicators (SMA/EMA/HMA, RSI, MACD, Stoch, support-resistance lines, Heikin-Ashi); fundamental + quant + dark-pool/insider data. Charting is functional but **basic** relative to TradingView.
- **AI/agents:** OpenBB Copilot, Workspace with AI agents via MCP; strong for research/investment workflow, not a live-charting terminal.
- **Pricing:** core ODP open source (AGPL-3.0); hosted Workspace UI and enterprise tiers are commercial. (https://github.com/OpenBB-finance/OpenBB ; https://docs.openbb.co/)
- Note: it's a research/data platform, **not** an interactive multi-timeframe candlestick trading dashboard; no native real-time charting terminal UI.

### 2.2 Freqtrade (MIT)

- Crypto bot framework: Python strategies (pandas), **backtesting**, **Hyperopt** (scikit-optimize ML parameter search), dry-run **paper trading**, walk-forward/recursive-analysis checks, lookahead analysis, 100+ exchanges via CCXT, FreqUI web dashboard, Telegram integration, TA-Lib/pandas-ta indicators.
- Strengths are algorithmic/quant, not a polished chart; FreqUI charting is monitoring-grade. (https://github.com/freqtrade/freqtrade ; https://www.freqtrade.io/)

### 2.3 Jesse (MIT)

- Research-first algo framework; candle-by-candle backtesting engine (fill/slippage/fee modeling), native multi-timeframe + multi-symbol without look-ahead bias; walk-forward optimization; Optuna parameter optimization; real-time alerts; live trading on supported exchanges. Not a charting/analysis SPA — code + CLI/web for strategy research. (https://jesse.trade ; https://voiceofchain.com/academy/jesse-vs-freqtrade)

### 2.4 Gekko (archived)

- Older Node.js crypto bot; backtesting + paper trading + live; web UI; TA (talib) strategies; **no longer maintained** — a caution against betting on unmaintained OSS for a production dashboard. (https://sourceforge.net/software/compare/Freqtrade-vs-Gekko-Crypto)

### 2.5 StockSharp (S#) (Apache-2.0 / free apps)

- C#/.NET + Python platform: **Designer** (visual no-code strategy builder + backtest + optimize), **Hydra** (market-data downloader for ticks/orderbooks/candles/news from 70+ sources), **Terminal** (charts with Volume/Tick/Range/P&F/Renko, cluster & box charts, Volume Profile, DOM), Shell + API; 74+ exchange/broker connectors (MT5, Binance, IB, cTrader, FIX/FAST, etc.); cloud backtester; now ships **JS web components** (JS-Charts, JS-Indicators, JS-Grids, JS-TradingControls) usable in a browser SPA. Excellent model for a real-time multi-source web trading UI on open source. (https://github.com/StockSharp/StockSharp ; https://stocksharp.com/en/)

### 2.6 Charting libraries for a web SPA

- **TradingView lightweight-charts** — **Apache-2.0** (NOTE: the prompt says "MIT", but the actual license on GitHub is Apache-2.0) — HTML5 canvas, ~45 KB, high-performance candlestick/line/area/baseline/histogram; scroll/zoom; plugin system (markers, overlays, volume profiles via community plugins); **no built-in drawing tools, indicators, or overlays** (those must be custom-built as plugins); requires the TradingView attribution notice/link. The de-facto base layer for PICC's charting. (https://github.com/tradingview/lightweight-charts ; https://www.tradingview.com/lightweight-charts)
- **TradingVue.js** — MIT, Vue 2; "hackable" candlestick charts where you can draw anything as Vue components; custom drawing tools, non-time-based (Renko) charts, scripts for custom indicators, works with ~3M candles. **Not maintained** (marker on repo), Vue 3 fork unmaintained — reuse with caution. (https://github.com/tvjsx/trading-vue-js)
- **OpenCharts / OpenTerminalUI** — MIT OSS terminal UIs built on lightweight-charts that bundle drawing toolbars, watchlists, DOM, paper-trading engines, screeners, backtesting, AI agents (OpenTerminalUI has multi-agent debate + Strategy Lab). Useful as blueprints/reference UIs for PICC rather than drop-in deps. (https://github.com/dylanpersonguy/OpenCharts ; https://github.com/Hitheshkaranth/OpenTerminalUI)
- **unovis** — MIT, modular data-viz for React/Angular/Svelte/vanilla; good for dashboards, **not** purpose-built for financial candlesticks/time-series trading needs. (https://unovis.dev/)
- **billboard.js** — MIT, D3-based general chart lib; has candlestick; no trading-specific features (drawing, DOM, indicators). (https://github.com/naver/billboard.js)
- **Chart.js / Apache ECharts / uPlot** — general-audience or time-series-optimized (uPlot) canvas libs; none ship trading-specific tooling. (charting benchmarks: https://www.scichart.com/blog/chart-bench-compare-javascript-chart-libraries/)

---

## 3. Gap analysis — feature by feature

Legend for PICC column: **Y** = in scope/worth building, **- (N)** = out of scope for advisory-only retail web dashboard, **Optional** = nice-to-have.

| Feature | TradingView? | OSS suites? | Applies to PICC web dashboard? |
|---|---|---|---|
| Historical intraday candle backfill | Yes — by-minute "All" tiers, by-sec/tick at Premium+; 5K–40K bars/chart | Yes — StockSharp Hydra, freqtrade download-data, OpenBB providers; depth varies | **Y** — core; deepest differentiator PICC can own (self-sourced, honest depth) |
| Multi-timeframe charts | Yes — native MTF on one chart | Partial — lightweight-charts needs custom panes; OpenBB basic; Jesse multi-TF in strategy | **Y** — core |
| Candlestick charting + drawing tools | Yes — 110+ drawing tools | lightweight-charts = none (plugins); TradingVue.js = custom drawing tools; OpenCharts bundles a toolbar | **Y** — canvas + custom drawing-tool layer (the big build effort) |
| Indicator overlays | Yes — 400+ built-in, 100K+ community | lightweight-charts = none built-in; StockSharp JS-Indicators; freqtrade/TA-Lib | **Y** — build oscillator/MA/volume overlay set on lightweight-charts |
| Watchlists | Yes — multiple, 1,000 sym, import/export, custom columns | OpenCharts has watchlist; StockSharp grids; freqtrade pairlist | **Y** — simple to build |
| Symbol screener | Yes — 500+ fields, 150+ exchanges | OpenTerminalUI has screener; OpenBB fundamental/screening; none standard | **Optional/Y** — big perceived value, heavy to build; v1 could do technical screen |
| Alert system | Yes — price/technical/watchlist, webhooks, multi-condition | freqtrade Telegram alerts; StockSharp Telegram; lightweight-charts none | **Y** — price/technical alerts via webhooks is high-value, low-cost |
| Economic calendar | Yes — built-in | No standard OSS equivalent (3rd-party API) | **Optional** — needs a data API; low differentiation |
| Backtesting UI | Yes — Strategy Tester, deep/tick-level at top tiers | freqtrade/Jesse/StockSharp backtesting (code-first, not visual); OpenCharts/OpenTerminalUI have visuals | **Y** — a visual backtest UI on strategy definitions is a strong, attainable differentiator |
| Portfolio/PnL analytics | Yes — Portfolios, Fundamental Graphs | OpenBB portfolio analysis; StockSharp reports | **Y** — valuable for paper-trading ledger & advisory value |
| Positions management | Yes — via brokers, DOM, chart trading | StockSharp Terminal/OMS; OpenCharts paper engine | **Optional** — only for paper/simulated positions, not live |
| Paper trading | Yes — free simulated trading | freqtrade dry-run, Jesse, OpenCharts paper engine, StockSharp | **Y** — core (matches advisory-only framing) |
| Signal/AI advisory | No real AI; Pine indicators + Auto Chart Patterns; signals via 3rd parties / ChartingLens-style AI is commercial | OpenTerminalUI multi-agent AI; OpenBB Copilot/agents; none at scale in classic suites | **Y** — the strongest differentiator; honest, labeled AI signals |
| Mobile / multi-asset breadth (indices/ETFs/crypto/currencies/stocks/commodities) | Yes — 3.5M instruments, all classes | OpenBB/StockSharp cover many classes; crypto-centric in freqtrade/Jesse | **Y (asset breadth) / Optional (mobile app)** — breadth is a feature; mobile is scope |
| Data-source honesty labeling | Weak — data provenance opaque; delayed data on free tier | OpenBB surfaces provider metadata; freqtrade documents data source | **Y** — a unique trust feature vs TradingView/retail dashboards |
| No live order execution (advisory-only) | N/A (it does execute) | Freqtrade/Jesse/StockSharp execute live | **Intentional** — PICC's differentiator vs all of these |

---

## 4. Top gaps worth closing for a retail web dashboard

Prioritized (each one sentence; evidence referenced above).

1. **Candlestick chart + drawing-tool layer** — TradingView ships 110+ drawing tools and OSS libs ship none (lightweight-charts), so a custom canvas drawing pane is the single biggest build and the minimum bar for credibility (§1.1, §2.6).
2. **Deep, self-sourced historical intraday backfill** — TradingView caps by-minute history to paid tiers ("All" only from Plus) and by-tick to Premium+, so owning full intraday/tick-depth data is a real open flank for a free dashboard.
3. **Visual, honest backtesting UI** — MT5's Strategy Tester and NinjaTrader's Strategy Analyzer are the gold standard and the OSS bots (freqtrade/Jesse) are code-first; a no-code visual backtester with clear metrics (profit factor, drawdown, Sharpe) is attainable and differentiating (§1.2, §1.4, §2.2–2.3).
4. **Paper-trading engine** — matches the advisory-only framing; free in TradingView and trivially achievable as an in-browser engine per OpenCharts/OpenTerminalUI (§1.1, §2.6).
5. **Labeled signal/AI advisory with data-source honesty** — no mainstream suite shows its analytical provenance; this is a unique trust differentiator for a retail web dashboard (§1.2–1.5 vs §2.1, §2.6).
6. **Multi-timeframe on one chart** — core to every serious suite (TradingView native, MT5/cTrader native); must be built on lightweight-charts as panes (§1.1–1.3).
7. **Indicator overlay set** — TradingView has 400+/100K+; lightweight-charts ships none; a curated built-in set (MA, EMA, RSI, MACD, Bollinger, Volume) is foundational (§1.1, §2.6).
8. **Webhook/multi-condition alerting** — TradingView gates webhooks and non-expiring alerts behind Premium; freqtrade uses Telegram; cheap to implement with high perceived value (§1.1, §2.2).
9. **Stock/ETF/crypto screener** — TradingView's 500-field screener is a huge draw; even a technical-only screener on top of the PICC universe covers most retail need (§1.1).
10. **Multiple syncable watchlists with import/export** — TradingView's 1,000-symbol/import-export lists are table stakes and easy to ship (§1.1).
11. **Portfolio/PnL analytics for the paper ledger** — TradingView portfolios and OpenBB portfolio tooling show this is expected; drives advisory value even without live positions (§1.1, §2.1).
12. **Multi-asset breadth (indices/ETFs/crypto/currencies/stocks/commodities)** — Deriv/Olymp/IQ win on breadth (Deriv's 24/7 derived indices are distinctive); asset-class reach is a retention feature PICC can match via low-cost data sources (§1.5).
13. **Economic calendar integration** — TradingView has it built-in and retail dashboards bundle it; requires only a data API, minor differentiation but expected (§1.1, §1.5).
14. **Paper/positions management panel** — for simulated positions & partial fills, mirroring NinjaTrader/MTS tester realism; builds trust in the paper-trading engine (§1.2, §1.4).
15. **Mobile/web responsive rendering** — TradingView is "100% synced" cross-device and lightweight-charts is tuned for mobile 60fps; PICC should not ship desktop-only given the target retail user (§1.1, §2.6).
