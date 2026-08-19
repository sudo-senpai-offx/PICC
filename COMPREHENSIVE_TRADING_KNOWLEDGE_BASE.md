# Comprehensive Professional Trading Suite — Knowledge Base

> Researched and compiled from 40+ authoritative sources across web research (2024-2026)

---

## TABLE OF CONTENTS

1. [Technical Indicators — Top 50+ with Formulas](#1-technical-indicators)
2. [Trading Strategies — 25+ with Entry/Exit Rules](#2-trading-strategies)
3. [Risk Management — Formulas & Algorithms](#3-risk-management)
4. [Pattern Recognition — 30+ Patterns](#4-pattern-recognition)
5. [AI/ML in Trading](#5-aiml-in-trading)
6. [Backtesting — Best Practices](#6-backtesting)
7. [ExpertOption / Binary Options](#7-expertoption--binary-options)

---

# 1. TECHNICAL INDICATORS

## 1.1 TREND INDICATORS

### 1. SMA — Simple Moving Average
- **Formula:** SMA(n) = (P₁ + P₂ + ... + Pₙ) / n
- **Use:** Trend direction, support/resistance, Golden/Death Cross (50/200 SMA)
- **Lagging indicator**, smooths price noise
- **Typical periods:** 10, 20, 50, 100, 200

### 2. EMA — Exponential Moving Average
- **Formula:** EMA_today = Price_today × (2/(n+1)) + EMA_yesterday × (1 - 2/(n+1))
- **Multiplier:** Multiplier = 2 / (Days + 1)
- **Use:** More responsive than SMA, weighted toward recent prices
- **Typical periods:** 9, 12, 21, 26, 50, 200
- **Used in:** MACD, PPO calculations

### 3. WMA — Weighted Moving Average
- **Formula:** WMA = (n×P₁ + (n-1)×P₂ + ... + 1×Pₙ) / (n + (n-1) + ... + 1)
- **Use:** More weight to recent prices, faster response than SMA

### 4. MACD — Moving Average Convergence Divergence
- **Formula:**
  - MACD Line = 12-period EMA − 26-period EMA
  - Signal Line = 9-period EMA of MACD Line
  - Histogram = MACD Line − Signal Line
- **Signals:** MACD crosses above Signal = Buy; below = Sell; Divergence = Reversal
- **Use:** Trend direction, momentum, crossovers, histogram divergence

### 5. ADX — Average Directional Index
- **Formula:**
  - +DM = Current High − Previous High
  - −DM = Previous Low − Current Low
  - TR = max(High-Low, |High-PrevClose|, |Low-PrevClose|)
  - +DI = 100 × EMA(+DM, 14) / EMA(TR, 14)
  - −DI = 100 × EMA(−DM, 14) / EMA(TR, 14)
  - DX = |+DI − −DI| / (+DI + −DI) × 100
  - ADX = EMA(DX, 14)
- **Use:** Trend strength (0-100). >25 = strong trend; <20 = weak/ranging
- **Does NOT indicate direction**, only strength

### 6. Parabolic SAR (PSAR)
- **Formula:**
  - SAR_new = SAR_old + AF × (EP − SAR_old)
  - AF starts at 0.02, increases by 0.02 each new EP, max 0.20
  - EP = Extreme Point (highest high in uptrend, lowest low in downtrend)
- **Use:** Trailing stop-loss, trend reversal signals (dots flip sides)
- **Best in:** Trending markets; produces false signals in ranging markets

### 7. Ichimoku Cloud (Ichimoku Kinko Hyo)
- **Components:**
  - Tenkan-sen = (Highest High₉ + Lowest Low₉) / 2
  - Kijun-sen = (Highest High₂₆ + Lowest Low₂₆) / 2
  - Senkou Span A = (Tenkan-sen + Kijun-sen) / 2, plotted 26 periods ahead
  - Senkou Span B = (Highest High₅₂ + Lowest Low₅₂) / 2, plotted 26 periods ahead
  - Chikou Span = Current Close plotted 26 periods back
- **Kumo (Cloud):** Area between Senkou Span A & B
- **Signals:** Price above cloud = uptrend; below = downtrend; inside = neutral
- **Default settings:** 9, 26, 52

### 8. Supertrend
- **Formula:**
  - HL2 = (High + Low) / 2
  - Upper Band = HL2 + (Multiplier × ATR)
  - Lower Band = HL2 − (Multiplier × ATR)
  - Supertrend = Lower Band (uptrend) or Upper Band (downtrend)
- **Trend flip:** Price closes above/below the Supertrend line
- **Default:** ATR period 10, Multiplier 3.0
- **Use:** Clean binary buy/sell signals, trailing stop

### 9. Aroon Oscillator
- **Formula:**
  - Aroon Up = ((Period − Bars since highest high) / Period) × 100
  - Aroon Down = ((Period − Bars since lowest low) / Period) × 100
  - Aroon Oscillator = Aroon Up − Aroon Down
- **Use:** Trend identification, new trend detection

### 10. TRIX — Triple Exponential Moving Average
- **Formula:** TRIX = (EMA₁ of EMA₂ of EMA₃ / prev EMA) − 1
- **Use:** Momentum oscillator, trend direction, divergence signals

### 11. Linear Regression Indicator
- **Formula:** Uses least-squares regression to fit a line through price data
- **Use:** Trend direction, statistical trend analysis

### 12. Vortex Indicator
- **Formula:** VM+ and VM− based on directional movement, compared to TR
- **Use:** Trend identification, crossovers signal trend changes

---

## 1.2 MOMENTUM INDICATORS

### 13. RSI — Relative Strength Index
- **Formula:**
  - RS = Average Gain(n) / Average Loss(n)
  - RSI = 100 − (100 / (1 + RS))
- **Smoothing:** Avg Gain = (PrevAvgGain × (n-1) + CurrentGain) / n
- **Levels:** >70 overbought, <30 oversold (traditional); >80/<20 (aggressive)
- **Default period:** 14
- **Use:** Overbought/oversold, divergence, trend confirmation

### 14. Stochastic Oscillator
- **Formula:**
  - %K = ((Close − Low₁₄) / (High₁₄ − Low₁₄)) × 100
  - %D = 3-period SMA of %K (signal line)
  - Slow %K = 3-period SMA of Fast %K
- **Levels:** >80 overbought, <20 oversold
- **Signals:** %K crosses %D above 80 = sell; below 20 = buy
- **Use:** Overbought/oversold, divergence, momentum

### 15. Stochastic RSI
- **Formula:** RSI applied to Stochastic calculation
- **Use:** More sensitive version of RSI, better for short-term

### 16. CCI — Commodity Channel Index
- **Formula:**
  - TP = (High + Low + Close) / 3
  - CCI = (TP − SMA(TP,20)) / (0.015 × Mean Deviation)
- **Levels:** >+100 overbought, <-100 oversold
- **Use:** Trend identification, cyclical turns, divergence

### 17. Williams %R
- **Formula:** %R = ((Highest High − Close) / (Highest High − Lowest Low)) × (−100)
- **Levels:** -20 to 0 = overbought; -80 to -100 = oversold
- **Use:** Overbought/oversold, similar to Stochastic but inverted

### 18. MFI — Money Flow Index
- **Formula:**
  - Typical Price = (H + L + C) / 3
  - Money Flow = TP × Volume
  - MFR = Positive Money Flow / Negative Money Flow
  - MFI = 100 − (100 / (1 + MFR))
- **Levels:** >80 overbought, <20 oversold
- **Use:** Volume-weighted RSI, confirms price moves

### 19. ROC — Rate of Change
- **Formula:** ROC = ((Close − Close_n) / Close_n) × 100
- **Use:** Momentum measurement, overbought/oversold at extremes

### 20. TSI — True Strength Index
- **Formula:**
  - PC = Close − Previous Close
  - Double smoothed PC / Double smoothed |PC|
  - TSI = 100 × (DoubleSmoothed_PC / DoubleSmoothed_AbsPC)
- **Use:** Momentum, overbought/oversold, divergence

### 21. CMO — Chande Momentum Oscillator
- **Formula:** CMO = ((Sum of Up Moves − Sum of Down Moves) / (Sum of Up Moves + Sum of Down Moves)) × 100
- **Levels:** >+50 overbought, <-50 oversold
- **Use:** Pure momentum, oscillator similar to RSI

### 22. Ultimate Oscillator
- **Formula:** Weighted average of 3 oscillators (7, 14, 28 period)
- **Use:** Multi-timeframe momentum, divergence signals

### 23. Momentum Indicator
- **Formula:** Momentum = Close − Close_n
- **Use:** Rate of price change, simple momentum measurement

### 24. DeMarker Indicator
- **Formula:** Based on comparison of current high/low to previous high/low
- **Use:** Overbought/oversold, similar to RSI/Stochastic

### 25. Relative Vigor Index (RVI)
- **Formula:** Based on relationship of closing price to trading range
- **Use:** Trend strength, crossovers for signals

### 26. Fisher Transform
- **Formula:** Converts prices to Gaussian normal distribution
- **Use:** Identifying turning points, cleaner signals than RSI/Stochastic

---

## 1.3 VOLATILITY INDICATORS

### 27. Bollinger Bands
- **Formula:**
  - Middle Band = 20-period SMA
  - Upper Band = Middle Band + (2 × Standard Deviation)
  - Lower Band = Middle Band − (2 × Standard Deviation)
  - %B = (Price − Lower Band) / (Upper Band − Lower Band)
  - Bandwidth = (Upper − Lower) / Middle
- **Use:** Overbought/oversold, volatility measurement, squeeze detection
- **Squeeze:** Narrow bands → expect volatility expansion

### 28. ATR — Average True Range
- **Formula:**
  - TR = max(High-Low, |High-PrevClose|, |Low-PrevClose|)
  - ATR = EMA(TR, 14) or SMA(TR, 14)
- **Use:** Volatility measurement, stop-loss placement (1.5-3× ATR), position sizing
- **ATR% = ATR / Close × 100**

### 29. Keltner Channels
- **Formula:**
  - Middle Band = 20-period EMA
  - Upper Band = EMA + (2 × ATR)
  - Lower Band = EMA − (2 × ATR)
- **Use:** Trend identification, volatility, BB squeeze confirmation

### 30. Donchian Channels
- **Formula:**
  - Upper Band = Highest High of n periods
  - Lower Band = Lowest Low of n periods
  - Middle Band = (Upper + Lower) / 2
- **Use:** Breakout trading, Turtle Trading system core indicator
- **Default period:** 20

### 31. Historical Volatility
- **Formula:** Standard deviation of ln(Close/PrevClose) × √252
- **Use:** Annualized volatility, options pricing, risk assessment

### 32. Standard Deviation
- **Formula:** σ = √(Σ(xᵢ − μ)² / n)
- **Use:** Volatility measurement, statistical analysis of price dispersion

### 33. Bollinger Band Width
- **Formula:** (Upper Band − Lower Band) / Middle Band
- **Use:** Volatility squeeze detection, regime identification

### 34. Choppiness Index
- **Formula:** 100 × LOG10(ATR_sum / (High_max − Low_min)) / LOG10(period)
- **Levels:** >61.8 = choppy/ranging; <38.2 = trending
- **Use:** Regime detection, filters for trend vs range strategies

---

## 1.4 VOLUME INDICATORS

### 35. OBV — On-Balance Volume
- **Formula:**
  - If Close > Prev Close: OBV = Prev OBV + Volume
  - If Close < Prev Close: OBV = Prev OBV − Volume
  - If Close = Prev Close: OBV = Prev OBV
- **Use:** Accumulation/distribution, confirms price trends, divergence

### 36. VWAP — Volume Weighted Average Price
- **Formula:** VWAP = Σ(Price × Volume) / Σ(Volume)
- **Use:** Intraday benchmark, institutional execution, mean reversion target
- **Resets daily**, widely used for intraday trading

### 37. Accumulation/Distribution Line
- **Formula:**
  - CLV = ((Close − Low) − (High − Close)) / (High − Low)
  - A/D = Prev A/D + (CLV × Volume)
- **Use:** Buying vs selling pressure, trend confirmation, divergence

### 38. Chaikin Money Flow (CMF)
- **Formula:**
  - MF Multiplier = ((Close − Low) − (High − Close)) / (High − Low)
  - MF Volume = MF Multiplier × Volume
  - CMF = Sum(MF Volume, 20) / Sum(Volume, 20)
- **Levels:** >0 bullish, <0 bearish
- **Use:** Money flow direction, buying/selling pressure

### 39. Force Index
- **Formula:** Force Index = (Close − Prev Close) × Volume
- **Use:** Direction and strength of price movement, confirms trends

### 40. Volume Rate of Change (VROC)
- **Formula:** VROC = ((Volume − Volume_n) / Volume_n) × 100
- **Use:** Volume momentum, confirms price breakouts

### 41. Price Volume Trend (VPT)
- **Formula:** VPT = Prev VPT + Volume × (Close − Prev Close) / Prev Close
- **Use:** Volume-weighted price trend, accumulation/distribution

### 42. Chaikin Oscillator
- **Formula:** 3-period EMA of A/D Line − 10-period EMA of A/D Line
- **Use:** Momentum of accumulation/distribution, trend confirmation

### 43. Klinger Oscillator
- **Formula:** Based on volume flow direction relative to price movement
- **Use:** Volume momentum, trend confirmation, divergence

---

## 1.5 ADDITIONAL INDICATORS

### 44. Fibonacci Retracement
- **Key Levels:** 23.6%, 38.2%, 50%, 61.8%, 78.6%
- **Use:** Support/resistance, pullback entries, target levels

### 45. Pivot Points
- **Formula:**
  - Pivot = (H + L + C) / 3
  - R1 = 2×P − L; R2 = P + (H − L); R3 = H + 2×(P − L)
  - S1 = 2×P − H; S2 = P − (H − L); S3 = L − 2×(H − P)
- **Use:** Intraday support/resistance, institutional levels

### 46. Coppock Curve
- **Formula:** 10-period WMA of (ROC₁₄ + ROC₁₁)
- **Use:** Long-term trend identification, buy signals

### 47. Elder Impulse System
- **Formula:** Combination of 13-period EMA + MACD histogram color
- **Use:** Trend confirmation, entry/exit timing

### 48. Connors RSI
- **Formula:** RSI(3) of (Price change) + RSI(3) of (Streak) + RSI(3) of (PercentRank)
- **Use:** Short-term mean reversion signals

### 49. Schaff Trend Cycle
- **Formula:** Stochastic of MACD
- **Use:** Trend-following oscillator, faster than MACD alone

### 50. Hurst Exponent
- **Formula:** Statistical analysis of fractal dimension of price series
- **Levels:** >0.5 trending, <0.5 mean-reverting, =0.5 random walk
- **Use:** Regime detection, fractal analysis

### 51. Kalman Filter
- **Formula:** State-space model with prediction and update steps
- **Use:** Noise filtering, adaptive trend estimation

### 52. McClellan Oscillator
- **Formula:** 19-day EMA of (Advances − Declines) − 39-day EMA of (Advances − Declines)
- **Use:** Market breadth, overbought/oversold

### 53. ZigZag Indicator
- **Formula:** Filters moves smaller than specified %; connects significant highs/lows
- **Use:** Pattern recognition, wave counting, noise filtering

---

# 2. TRADING STRATEGIES

## 2.1 TREND FOLLOWING STRATEGIES

### Strategy 1: Moving Average Crossover
- **Entry:** Buy when short MA crosses above long MA (e.g., 9 EMA crosses 21 EMA)
- **Exit:** Opposite crossover or trailing stop
- **Filters:** RSI between 40-65, price above 200 EMA for longs
- **Win rate:** 35-50%, but large winners compensate
- **Profit factor:** 1.2-2.0

### Strategy 2: MACD Crossover with Trend Filter
- **Entry:** MACD line crosses above Signal line + price above 200 SMA
- **Exit:** MACD crosses below Signal or trailing ATR stop
- **Best in:** Strong trending markets

### Strategy 3: Donchian Channel Breakout (Turtle Trading)
- **Entry:** Buy on 20-period high breakout; Short on 20-period low breakout
- **Exit:** Parabolic SAR flip or opposite Donchian signal
- **Position sizing:** Based on ATR (N-value)
- **Rule:** Trade the breakout, not the pullback

### Strategy 4: Ichimoku Cloud Breakout
- **Entry:** Price breaks above cloud + Tenkan crosses above Kijun + Chikou above price
- **Exit:** Price falls below cloud or Tenkan crosses below Kijun
- **Stop:** Below Kijun-sen or cloud bottom

### Strategy 5: Supertrend + EMA Strategy
- **Entry:** Supertrend flips green + price above 200 EMA → Buy
- **Exit:** Supertrend flips red
- **Results:** 14.36% return, 49.57% win rate, 1.503 profit factor (backtested)

### Strategy 6: ADX Momentum Filter Strategy
- **Entry:** ADX > 25 confirms trend strength + take directional signals
- **Rule:** ADX < 20 = no trade (ranging market)
- **Use:** Filter for any trend-following strategy

---

## 2.2 MEAN REVERSION STRATEGIES

### Strategy 7: RSI Mean Reversion
- **Entry:** RSI(14) < 30 → Buy (oversold); RSI > 70 → Sell (overbought)
- **Exit:** RSI returns to 50 or Bollinger Band midline
- **Filters:** Only trade with trend on higher timeframe
- **Win rate:** 55-75% in ranging markets

### Strategy 8: Bollinger Band Reversion
- **Entry:** Price touches lower BB → Buy; upper BB → Sell
- **Exit:** Return to middle band (20 SMA)
- **Best in:** Range-bound, low-ADX markets
- **Risk:** Fails in strong trends

### Strategy 9: VWAP Mean Reversion
- **Entry:** Price touches VWAP ± 2 standard deviations → Fade
- **Exit:** Return to VWAP midline or session close
- **Best in:** First 90 minutes of session for equities
- **Expiry (binary):** 5-15 minutes

### Strategy 10: Pairs Trading (Statistical Arbitrage)
- **Entry:** When spread between cointegrated pairs exceeds 2σ → Go long underperformer, short outperformer
- **Exit:** Spread reverts to mean (z-score crosses 0)
- **Tools:** Engle-Granger cointegration test, Kalman filter for hedge ratio
- **Win rate:** 50-65%

### Strategy 11: Stochastic Cross in Range
- **Entry:** In ranging market: %K crosses %D below 20 → Buy; above 80 → Sell
- **Exit:** Opposite signal or middle range
- **Filter:** ADX < 25 to confirm ranging market

---

## 2.3 MOMENTUM STRATEGIES

### Strategy 12: Breakout Momentum
- **Entry:** Price breaks N-candle high with volume 1.5× 20-bar average
- **Exit:** Trailing ATR stop (1.5× ATR below entry) or 2× ATR target
- **Best sessions:** London/New York (win rates 62-64%)
- **Results:** +14.7% over 90 days in tested experiment

### Strategy 13: 3-Candle Momentum
- **Entry:** Three strong consecutive candles with minimal wicks, breaking micro-consolidation
- **Exit:** 1-minute expiry (for binary)
- **Filter:** Only active sessions (London/New York)

### Strategy 14: Cross-Sectional Momentum Ranking
- **Entry:** Rank universe by 3-12 month return (skip last month), buy top decile
- **Exit:** Monthly rebalance
- **Enhancement:** Combine with earnings-revision momentum

### Strategy 15: Volume Delta + MACD Confirmation
- **Entry:** MACD crossover (12,26,9) + cumulative delta rising
- **Exit:** Opposite signal or 1.5% stop
- **Results:** +8.9% over 90 days

---

## 2.4 GRID & DCA STRATEGIES

### Strategy 16: Grid Trading
- **Setup:** Define price range (upper/lower bounds), divide into N grids
- **Logic:** Place buy orders at each grid below current price, corresponding sell orders above
- **Profit:** Each completed buy-sell cycle captures grid spread
- **Win rate:** 70-85% in ranging markets
- **Best for:** Volatile, range-bound assets (e.g., BTC/USDT during consolidation)
- **Risk:** Strong trends break the grid; set stop-loss below grid lower bound
- **Parameters:** Grid count (20-40), range width, single-grid yield > fees
- **Allocation:** Typically 40% of portfolio for multi-strategy approach

### Strategy 17: Dollar-Cost Averaging (DCA)
- **Setup:** Buy fixed dollar amount at regular intervals (daily/weekly/monthly)
- **Logic:** More units bought when price is low, fewer when high → smooths average cost
- **Best for:** Long-term accumulation of high-conviction assets
- **Enhanced DCA:** Buy more during dips (safety orders at progressively lower prices)
- **Risk:** No exit logic — must pair with separate exit strategy
- **Allocation:** Typically 20% of multi-strategy portfolio

### Strategy 18: DCA + Grid Combined
- **Setup:** DCA for core accumulation + Grid for active range trading on volatile altcoins
- **Logic:** Run DCA on BTC/ETH (stable), Grid on more volatile pairs

---

## 2.5 VOLATILITY STRATEGIES

### Strategy 19: ATR Volatility Squeeze (Bollinger inside Keltner)
- **Entry:** When Bollinger Bands squeeze inside Keltner Channels + momentum turns positive after release
- **Exit:** 2% hard stop
- **Best in:** Low volatility → high volatility transitions
- **Enhancement:** Add 50 EMA filter (only trade above/below)

### Strategy 20: Channel Breakout with ATR Trailing
- **Entry:** Price breaks above Keltner or Donchian Channel upper band
- **Exit:** Trailing stop at 2× ATR
- **Position sizing:** Risk 1% per trade, size based on ATR stop distance

---

## 2.6 HARTE PATTERN / ADVANCED STRATEGIES

### Strategy 21: Gartley Harmonic Pattern
- **Entry:** Point D at 0.786 XA retracement with specific AB/BC ratios
- **Stop:** Beyond X point
- **Target:** 1.618 extension of AD or 0.382 retracement of AD
- **Ratios:** AB = 0.618 XA, BC = 0.382-0.886 AB, CD = 1.27-1.618 BC

### Strategy 22: Elliott Wave Trading
- **Entry:** End of Wave 2 (for Wave 3 entry) at 61.8% Fibonacci retracement
- **Stop:** Below Wave 1 origin (invalidation: Wave 2 > 100% retracement)
- **Target:** 1.618× Wave 1 length projected from Wave 2 end
- **Rules:** Wave 3 cannot be shortest; Wave 4 cannot overlap Wave 1

### Strategy 23: False Breakout Fade
- **Entry:** Price breaks above resistance, immediately closes back below + bearish engulfing
- **Win rate:** 66% (tested across 100 trades)
- **vs. Chasing breakouts:** Only 49% win rate

### Strategy 24: Session Open Volatility Expansion
- **Entry:** Mark first 5-minute range at London open → enter continuation breakout
- **Rules:** Maximum 3 trades, stop after 2 losses
- **Best for:** Major forex pairs during London/NY overlap

### Strategy 25: Composite Multi-Timeframe Strategy
- **Higher TF (Daily):** Ichimoku defines trend direction
- **Entry TF (H1):** Supertrend provides entry signals in direction of higher TF trend
- **Risk:** Each trade 1% of capital

---

## 2.7 BINARY OPTIONS SPECIFIC STRATEGIES

### Strategy 26: RSI Pullback Within Trend
- **Entry:** 5-min chart shows uptrend → 1-min RSI dips below 40 → CALL when bullish candle confirms
- **Expiry:** 2 minutes
- **Win rate:** 63% (trend-aligned) vs 44% (counter-trend)

### Strategy 27: Support/Resistance Rejection
- **Entry:** Price touches tested support + strong lower wick rejection + confirmation candle → CALL
- **Expiry:** 1-3 minutes
- **Key:** Wait for candle confirmation (win rate improved from 48% to 61%)

### Strategy 28: Moving Average + Parabolic SAR
- **Entry:** 21 MA above 50 MA (uptrend) + SAR flips below candles → CALL
- **Exit:** SAR flips above candles
- **Win rate:** 60-70% with proper filtering

### Strategy 29: Donchian Channel Breakout + SAR Exit
- **Entry:** Price breaks above Donchian upper band → CALL
- **Exit:** SAR dots change position
- **Filter:** Only trending markets (not ranging)

### Strategy 30: Pathfinder Strategy (SMA + Bollinger + RSI)
- **CALL:** Price and SMA bounce from lower BB or cross middle band up + RSI rising and <70
- **PUT:** Price and SMA bounce from upper BB + RSI falling and >30
- **Works in both trending and flat markets**

---

# 3. RISK MANAGEMENT

## 3.1 POSITION SIZING FORMULAS

### Fixed Fractional Sizing
```
Position Size = (Account × Risk%) / (Entry Price − Stop Loss)
Risk Amount = Account × Risk Fraction
```
- **Standard:** Risk 1-2% per trade
- **Conservative:** 0.25-0.5% per trade

### Kelly Criterion
```
f* = (p × b − q) / b
Where:
  f* = fraction of capital to risk
  p = probability of winning
  q = 1 − p (probability of losing)
  b = win/loss ratio (avg win ÷ avg loss)

Simplified: f* = W − ((1 − W) / R)
  W = win rate (decimal)
  R = win/loss ratio
```
- **Example:** W=55%, R=1.5 → f* = 0.55 − (0.45/1.5) = 0.25 (25%)
- **In practice:** Use HALF Kelly or QUARTER Kelly
  - Half Kelly: 12.5% — maintains 75% of growth, cuts drawdown in half
  - Quarter Kelly: 6.25% — maintains 50% of growth, drawdown to 8-12%
- **Double Kelly = ZERO growth** — the curve is asymmetric

### Volatility-Based Position Sizing (ATR)
```
Position Size = (Account × Risk%) / (ATR × Multiplier × Point Value)
```
- Stop = Entry ± (ATR × 2)
- Adapts to current market volatility

### Dollar Volatility Position Sizing
```
Position Size = (Account × Risk%) / DollarVolPerContract
DollarVolPerContract = ATR × PointValue
```

---

## 3.2 KEY RISK FORMULAS

### Risk of Ruin
```
RoR = ((1 − Edge) / (1 + Edge)) ^ Capital_Units

Where:
  Edge = Win Rate (or (WinRate × AvgWin) − (LossRate × AvgLoss))
  Capital_Units = Ruin Threshold ($) / Risk Per Trade ($)
```
- **Example:** 55% win rate, $2000 ruin threshold, $100 risk/trade
  - Edge = 0.55, Units = 20
  - RoR = (0.45/1.55)^20 = 0.290^20 ≈ 0.0000000018% (near zero)
- **Same but $1000 risk/trade:** Units = 2, RoR = 0.290^2 = 8.4%

### Expectancy (Expected Value)
```
Expectancy = (Win% × AvgWin) − (Loss% × AvgLoss)
Expectancy Ratio = Expectancy / AvgLoss
```
- **Positive expectancy required** for any strategy to be profitable long-term

### Profit Factor
```
Profit Factor = Gross Profits / Gross Losses
```
- **>1.5** is good; **>2.0** is excellent

### Sharpe Ratio
```
Sharpe = (Rp − Rf) / σp
Where:
  Rp = portfolio return
  Rf = risk-free rate
  σp = standard deviation of portfolio returns
```

### Sortino Ratio
```
Sortino = (Rp − Rf) / σd
Where σd = standard deviation of downside returns only
```

### Maximum Drawdown Recovery
```
Recovery % = Drawdown% / (1 − Drawdown%)

-10% DD → +11.1% to recover
-25% DD → +33.3% to recover
-50% DD → +100% to recover
```

### Kelly Criterion for Continuous Returns
```
f* = (μ − r) / σ²
Where:
  μ = expected return of asset
  r = risk-free rate
  σ² = variance of asset returns
```

---

## 3.3 DRAWDOWN MANAGEMENT RULES

### Circuit Breakers
- **Daily Loss Limit:** 2-3% of account → stop trading for the day
- **Weekly Loss Limit:** 5-8% of risk capital → stop for the week, review journal
- **Monthly Drawdown Threshold:** 10-15% → reduce position size by half until recovery
- **Max Consecutive Losses:** 3-5 → mandatory break

### Position Sizing During Drawdowns
```
Adjusted Risk% = Base Risk% × (Current Equity / Peak Equity)
```
- Automatically reduces exposure during drawdowns
- 50% drawdown → risk half the normal amount

### Correlation Cap
```
Effective Risk = Sum of individual risks × Correlation Factor
For N positions with avg correlation ρ:
  Effective Units = Total Units / √(N + N×(N-1)×ρ)
```

---

## 3.4 RISK MANAGEMENT FRAMEWORK (Professional)

| Rule | Setting | Rationale |
|------|---------|-----------|
| Max risk per trade | 0.5-2% | Survival through losing streaks |
| Max daily loss | 2-3% | Prevent tilt and blowup |
| Max weekly loss | 5-8% | Cap weekly damage |
| Max monthly drawdown | 10-15% | Limit recovery time |
| Max correlated exposure | 3-5% total | Avoid concentration risk |
| Position sizing method | Fixed fractional or fractional Kelly | Optimal growth with survival |
| Stop-loss type | ATR-based or structure-based | Adapts to volatility |
| Risk of ruin target | < 1% | Institutional standard |

---

# 4. PATTERN RECOGNITION

## 4.1 REVERSAL PATTERNS

| # | Pattern | Bias | Signal | Reliability |
|---|---------|------|--------|-------------|
| 1 | Head & Shoulders | Bearish | Neckline break | High |
| 2 | Inverse H&S | Bullish | Neckline break | High |
| 3 | Double Top | Bearish | Support break | High |
| 4 | Double Bottom | Bullish | Resistance break | High |
| 5 | Triple Top | Bearish | Neckline break | Very High |
| 6 | Triple Bottom | Bullish | Neckline break | Very High |
| 7 | Rounding Top | Bearish | Support break | Medium |
| 8 | Rounding Bottom | Bullish | Resistance break | Medium |
| 9 | Island Reversal | Both | Opposing gap | High |
| 10 | V-Reversal | Both | Sharp reversal | Medium |
| 11 | Rising Wedge (after uptrend) | Bearish | Lower trendline break | Medium-High |
| 12 | Falling Wedge (after downtrend) | Bullish | Upper trendline break | Medium-High |

## 4.2 CONTINUATION PATTERNS

| # | Pattern | Bias | Signal |
|---|---------|------|--------|
| 13 | Bull Flag | Bullish | Flag breakout |
| 14 | Bear Flag | Bearish | Flag breakdown |
| 15 | Bull Pennant | Bullish | Pennant break |
| 16 | Bear Pennant | Bearish | Pennant break |
| 17 | Ascending Triangle | Bullish | Resistance break |
| 18 | Descending Triangle | Bearish | Support break |
| 19 | Symmetrical Triangle | Neutral | Directional breakout |
| 20 | Rectangle | Trend-based | Range break |
| 21 | Rising Channel | Bullish | Channel breakout |
| 22 | Falling Channel | Bearish | Channel breakdown |
| 23 | Cup & Handle | Bullish | Handle breakout |
| 24 | Inverse Cup & Handle | Bearish | Handle breakdown |

## 4.3 HARMONIC PATTERNS (Fibonacci-based)

| # | Pattern | B-Point | D-Point Entry | Bias |
|---|---------|---------|---------------|------|
| 25 | Gartley | 0.618 XA | 0.786 XA | Reversal |
| 26 | Bat | 0.382-0.500 XA | 0.886 XA | Reversal |
| 27 | Butterfly | 0.786 XA | 1.272-1.618 XA extension | Reversal |
| 28 | Crab | 0.382-0.618 XA | 1.618 XA extension | Reversal |
| 29 | Shark | 0.886-1.0 XA | 0.886-1.0 BC | Reversal |
| 30 | Cypher | 0.382-0.618 XA | 0.786 XC | Reversal |

## 4.4 CANDLESTICK PATTERNS

### Single-Candle Patterns
| Pattern | Signal | Strength |
|---------|--------|----------|
| Doji | Indecision | Neutral |
| Hammer | Bullish reversal | Strong |
| Inverted Hammer | Possible bullish reversal | Moderate |
| Hanging Man | Bearish reversal | Moderate |
| Shooting Star | Bearish reversal | Strong |
| Marubozu (Green) | Strong bullish | Strong |
| Marubozu (Red) | Strong bearish | Strong |
| Dragonfly Doji | Bullish reversal | Moderate |
| Gravestone Doji | Bearish reversal | Moderate |

### Two-Candle Patterns
| Pattern | Signal | Strength |
|---------|--------|----------|
| Bullish Engulfing | Strong bullish reversal | Strong |
| Bearish Engulfing | Strong bearish reversal | Strong |
| Piercing Pattern | Bullish reversal | Moderate |
| Dark Cloud Cover | Bearish reversal | Moderate |
| Bullish Harami | Possible bullish reversal | Moderate |
| Bearish Harami | Possible bearish reversal | Moderate |
| Bullish Kicker | Strong bullish reversal | Very Strong |
| Bearish Kicker | Strong bearish reversal | Very Strong |

### Three-Candle Patterns
| Pattern | Signal | Strength |
|---------|--------|----------|
| Morning Star | Bullish reversal | Very Strong |
| Evening Star | Bearish reversal | Very Strong |
| Three White Soldiers | Strong bullish continuation | Strong |
| Three Black Crows | Strong bearish continuation | Strong |
| Rising Three Methods | Bullish continuation | Moderate |
| Falling Three Methods | Bearish continuation | Moderate |

## 4.5 ELLIOTT WAVE PATTERNS

### Impulse Wave (5-wave structure)
- **Wave 1:** Initial move in trend direction
- **Wave 2:** Retracement (never >100% of Wave 1)
- **Wave 3:** Strongest/longest wave (never shortest of 1, 3, 5)
- **Wave 4:** Retracement (no overlap with Wave 1 territory)
- **Wave 5:** Final impulse wave (often with divergences)

### Corrective Waves (3-wave structure)
- **Zigzag:** 5-3-5 structure (sharp corrections)
- **Flat:** 3-3-5 structure (sideways movement)
- **Triangle:** Contracting pattern before breakout (A-B-C-D-E)
- **Complex:** Combinations of above

### Fibonacci Relationships
- Wave 2 typically retraces 50-61.8% of Wave 1
- Wave 3 often = 1.618× Wave 1
- Wave 4 typically retraces 38.2% of Wave 3
- Wave 5 often = 0.618× Wave 1 or Wave 3

## 4.6 MARKET STRUCTURE PATTERNS

| Pattern | Description |
|---------|-------------|
| Higher Highs & Higher Lows | Bullish structure |
| Lower Highs & Lower Lows | Bearish structure |
| Break of Structure (BOS) | Trend continuation signal |
| Change of Character (ChoCH) | Trend reversal signal |
| Equal Highs/Lows | Liquidity targets |
| Liquidity Sweep | Stop-hunt reversal |
| Wyckoff Accumulation | Smart money buying phase |
| Wyckoff Distribution | Smart money selling phase |

---

# 5. AI/ML IN TRADING

## 5.1 MACHINE LEARNING APPROACHES

### Supervised Learning
- **Gradient Boosting (XGBoost, LightGBM):** Workhorse for tabular financial data; feature-engineered technical indicators + fundamentals
- **Random Forests:** Ensemble of decision trees; robust to overfitting
- **Support Vector Machines (SVM):** Classification of buy/sell/hold signals
- **Neural Networks (MLP):** Pattern recognition in engineered features

### Deep Learning Architectures
- **LSTM (Long Short-Term Memory):** Captures sequential dependencies in price data; excels at time-series forecasting
- **GRU (Gated Recurrent Unit):** Similar to LSTM, lighter computation
- **CNN (Convolutional Neural Networks):** Pattern recognition in price charts (treating as images); candlestick pattern detection
- **Transformers:** Attention mechanisms capture long-range dependencies; Time-Series Transformers
- **Autoencoders:** Feature extraction, dimensionality reduction, anomaly detection
- **BiLSTM:** Bidirectional processing of historical data

### Reinforcement Learning
- **DQN (Deep Q-Network):** Discrete action space (buy/sell/hold)
- **PPO (Proximal Policy Optimization):** Policy gradient method; balances exploration/exploitation
- **A2C (Advantage Actor-Critic):** Good for risk-adjusted returns
- **DDPG (Deep Deterministic Policy Gradient):** Continuous action space (position sizing)
- **SARSA:** Conservative learning from actual action sequences
- **Ensemble RL:** Combine PPO + A2C + DDPG; select best performer via Sharpe ratio

### Key Research Results
- **StockFormer (IJCAI 2023):** Three Transformer branches (long-term, short-term, relational) + actor-critic RL → outperforms existing approaches on NASDAQ, Chinese markets, and crypto
- **AlphaCrafter (2025):** Multi-agent LLM framework (Miner/Screener/Trader) → CSI 300 live AR 5.70%, Sharpe 0.70; S&P 500 live AR 9.26%, Sharpe 0.72
- **TradingMoE (2025):** Mixture-of-Experts with frozen LLM + lightweight experts → 30.89% improvement over best baseline on stocks
- **Ensemble Strategy (2025):** PPO + A2C + DDPG ensemble → Sharpe 1.30 vs DJIA 0.47

### NLP/Sentiment Approaches
- **LLM-based:** Extract signals from earnings calls, SEC filings, news, social media
- **FinGPT, FinLlama:** Domain-specific financial LLMs
- **Sentiment scoring:** Positive/negative/neutral → alpha signals
- **Alternative data:** App downloads, satellite imagery, credit card data

## 5.2 FEATURE ENGINEERING FOR ML

### Technical Features
- All standard indicator values (RSI, MACD, etc.)
- Rolling statistics (mean, std, skew, kurtosis)
- Price momentum at multiple lookbacks
- Volume indicators and ratios
- Volatility measures (realized, implied)

### Fundamental Features
- Financial quality metrics (ROE, ROA, debt ratios)
- Valuation metrics (P/E, P/B, EV/EBITDA)
- Earnings revision momentum

### Sentiment Features
- News sentiment scores
- Social media velocity
- Analyst rating changes

## 5.3 CRITICAL ML CHALLENGES
- **Overfitting:** Financial signal-to-noise ratio is extremely low
- **Non-stationarity:** Markets change regimes; models decay
- **Data leakage:** Future data contamination in features
- **Regime detection:** Must classify market state before model selection
- **Walk-forward validation:** Essential; standard backtests overfit by 30-60%

---

# 6. BACKTESTING

## 6.1 THREE TYPES OF BACKTESTS

### 1. Standard Historical Backtest
- **Method:** Apply strategy to full historical dataset
- **Pro:** Simple, fast, easy to interpret
- **Con:** 100% overfitting risk; single path; upward-biased returns
- **Use:** Initial screening only — never final validation

### 2. Walk-Forward Analysis (WFA)
- **Method:**
  1. Optimize on in-sample window (e.g., 2020-2022)
  2. Test on out-of-sample window (e.g., 2023)
  3. Slide forward, repeat
- **Walk-Forward Efficiency Ratio (WFER):** OOS performance / IS performance
- **WFER > 0.5** = strategy has genuine predictive power
- **Results typically 30-60% lower** than standard backtests
- **Use:** Required for any strategy before live deployment

### 3. Monte Carlo Simulation
- **Method:** Randomize trade order or resample returns 10,000+ times
- **Outputs:** Distribution of returns, drawdowns, Sharpe ratios
- **Uses:**
  - Bootstrap returns → Sharpe confidence intervals
  - Shuffle trade order → drawdown path sensitivity
  - Skip simulation → worst-case scenarios
- **Block bootstrap** for clustered volatility (don't assume independence)

## 6.2 BACKTESTING BEST PRACTICES

### Avoid These Biases
1. **Look-Ahead Bias:** Using future data in decision logic → verify using only past data
2. **Survivorship Bias:** Only testing assets that survived → include delisted assets
3. **Overfitting:** >10 parameters or perfect historical fit → use WFA + out-of-sample
4. **Transaction Cost Ignoring:** Add realistic spreads, commissions, slippage
5. **Selection Bias:** Testing many strategies and picking the best → account for multiple testing

### Realistic Cost Modeling
```
Actual Return = Backtest Return − Commission − Spread − Slippage − Financing

Typical costs:
  - Commission: 0.05% per trade
  - Slippage: 0.04% (BTC/USDT) to 1.5% (mid-cap alts)
  - Spread: varies by asset/liquidity
```

### Validation Pipeline (Professional Standard)
```
1. Standard Backtest → Initial screening
2. Walk-Forward Analysis → Rigorous validation
3. Monte Carlo on OOS results → Risk assessment
4. Paper Trading (4-12 weeks) → Live execution confirmation
5. Small Capital (5-10%) → Gradual scaling
6. Full Deployment → With risk controls
```

### Performance Metrics to Track
| Metric | Good | Excellent |
|--------|------|-----------|
| Sharpe Ratio | >1.0 | >1.5 |
| Profit Factor | >1.5 | >2.0 |
| Max Drawdown | <20% | <10% |
| Win Rate | >50% | >60% |
| Expectancy | >0 | >0.5R |
| WFER | >0.5 | >0.7 |
| Minimum Trades | >200 | >500 |

## 6.3 BACKTESTING FRAMEWORKS

### Python Frameworks (2026)
| Framework | Best For | Speed | Live Trading |
|-----------|----------|-------|-------------|
| **VectorBT PRO** | Parameter sweeps, research | 2,400/hr | No |
| **Backtrader** | Legacy, community | 850/hr | Yes |
| **Backtesting.py** | First framework, simple | 940/hr | No |
| **NautilusTrader** | Production-grade, Rust core | 2,100/hr | Yes (parity) |
| **PyBroker** | ML strategies, walk-forward | 1,200/hr | Via Alpaca |
| **Zipline Reloaded** | US equity factors | 620/hr | No |
| **Freqtrade** | Crypto bots | 1,200/hr | Yes |

### Commercial Platforms
| Platform | Best For | Key Feature |
|----------|----------|-------------|
| **StrategyQuant X** | No-code strategy generation | Genetic algo + walk-forward + Monte Carlo |
| **MultiCharts** | Serious systematic traders | Optimization + portfolio backtesting |
| **TradeStation** | US futures (broker-integrated) | EasyLanguage + live execution |
| **NinjaTrader** | US futures (user-friendly) | Strategy Analyzer + live trading |
| **MetaTrader 5** | Retail forex | Free + EA marketplace |

## 6.4 OVERFITTING DETECTION

### Tests for Overfitting
1. **Parameter Sensitivity:** Small parameter changes → huge performance swings = overfit
2. **Walk-Forward Efficiency:** WFER < 0.3 = likely overfit
3. **In-Sample vs Out-of-Sample Gap:** If IS Sharpe > 2.0 but OOS < 0.8 → overfit
4. **Probability of Backtest Overfitting (PBO):** Statistical test for strategy selection bias
5. **Minimum Backtest Length:** Need sufficient trades (rule of thumb: >100 for basic statistical validity)

---

# 7. EXPERTOPTION / BINARY OPTIONS

## 7.1 PLATFORM-SPECIFIC CONSIDERATIONS

### ExpertOption Characteristics
- **Trade durations:** 5 seconds to several minutes (typically 1-15 minutes)
- **Assets:** 100+ (forex pairs, crypto, stocks, commodities)
- **Chart types:** Candlestick, Area, Line, Bar
- **Timeframes:** 5s, 10s, 15s, 30s, 60s
- **Key limitation:** 60-second trades are too noisy for technical analysis

### Optimal Settings for Binary Options
- **Preferred expiry:** 5-minute and 15-minute (not 60-second)
- **Preferred timeframes:** 1-minute and 5-minute charts
- **Best sessions:** London and New York overlap
- **Payout requirement:** >70-75% minimum

## 7.2 INDICATORS THAT WORK BEST

### Primary Indicators (6-Indicator Confluence System)
| Indicator | Setting | Role | Signal Threshold |
|-----------|---------|------|-----------------|
| RSI | Period 7 | Momentum | <25 oversold, >75 overbought |
| Stochastic | %K=14, %D=3 | Overbought/oversold | <25 buy, >75 sell; crossovers |
| Williams %R | Period 14 | Third confirmation | <-80 oversold, >-20 overbought |
| MACD Histogram | 12,26,9 | Timing | Histogram crosses zero |
| SMA | Period 20 | Trend filter | Above/below = trend direction |
| Bollinger Bands | 20, 2 StdDev | Mean reversion | Touch upper/lower band |

### Confluence Scoring
- **6/6 indicators agree:** 100% confidence → High-probability trade
- **5/6 agree:** 83% → Strong trade
- **4/6 agree:** 67% → Good trade (minimum threshold)
- **<4/6 agree:** <50% → Skip the trade

## 7.3 PROVEN STRATEGIES

### Strategy A: RSI + Trend Alignment
1. Identify 5-minute trend bias (higher highs/lows)
2. Drop to 1-minute chart
3. Wait for RSI pullback below 40 (in uptrend) or above 60 (in downtrend)
4. Enter CALL when bullish candle confirms (CALL)
5. Expiry: 2 minutes
6. **Win rate:** 63% (tested)

### Strategy B: Support/Resistance Rejection
1. Mark session highs/lows and intraday consolidation zones
2. Wait for price to touch tested support/resistance
3. Look for strong wick rejection
4. Wait for confirmation candle to close
5. Enter opposite direction with 1-3 minute expiry
6. **Win rate:** 61% (improved from 48% with confirmation)

### Strategy C: MA + Parabolic SAR System
1. Set 21 MA and 50 MA on chart
2. 21 MA above 50 MA = uptrend
3. Wait for Parabolic SAR dots to flip below candles
4. Enter CALL with 1-minute expiry
5. **Win rate:** 60-70% with proper filtering

### Strategy D: Breakout with Confirmation
1. Identify clear resistance level
2. Wait for breakout candle
3. Wait for FALSE breakout (price closes back below)
4. Enter PUT on bearish engulfing confirmation
5. **Win rate:** 66% (tested vs 49% for breakout chasing)

### Strategy E: Multi-Timeframe Analysis
1. Entry timeframe: 5-15 seconds
2. Higher timeframe: 4-6× entry (e.g., 30s or 60s)
3. Establish higher TF swing direction
4. Enter on entry TF in same direction with candle pattern confirmation
5. **Filter:** Only trade with higher TF trend

## 7.4 RISK MANAGEMENT FOR BINARY OPTIONS

### Position Sizing
```
Max Risk Per Trade: 1-2% of account
Max Daily Loss: 5% of account
Max Trades Per Session: 10
Max Consecutive Losses Before Break: 3
```

### Session Rules
- **Active sessions only:** London (03:00-12:00 EST) and New York (08:00-17:00 EST)
- **Avoid:** Asian session (thin liquidity), first/last 5 minutes of session
- **News events:** Avoid trading 15 minutes before/after major news

### Discipline Framework
1. Never risk more than 2% per trade
2. Never trade more than 10 trades per session
3. Mandatory break after 3 consecutive losses
4. Stop after hitting daily loss limit (5%)
5. Log every trade for review
6. Never increase size after wins (anti-martingale)

## 7.5 CANDLESTICK PATTERNS FOR BINARY OPTIONS

### High-Reliability Patterns (use at support/resistance)
| Pattern | Signal | Action | Expiry |
|---------|--------|--------|--------|
| Bullish Engulfing at support | CALL | Strong | 2-3 candles |
| Bearish Engulfing at resistance | PUT | Strong | 2-3 candles |
| Morning Star | CALL | Very Strong | 2-3 candles |
| Evening Star | PUT | Very Strong | 2-3 candles |
| Hammer at support | CALL | Strong | 1-2 candles |
| Shooting Star at resistance | PUT | Strong | 1-2 candles |

### Rules
- Patterns at key price levels with above-average volume carry highest reliability
- Never use candlestick patterns in isolation
- Combine with RSI, Moving Averages, and S/R levels
- Wait for candle to close before acting

## 7.6 WITHOUT-INDICATORS APPROACH

### Pure Price Action
1. **Support & Resistance:** Identify zones where price repeatedly reverses
2. **Market Structure:** 4 stages — Accumulation → Advancing → Distribution → Declining
3. **Trend Lines:** Draw connecting swing points using Ray tool
4. **Candlestick Patterns:** Self-sufficient signals at key levels

### Dead Zones / Red Zones / End Zones
- **Dead Zones:** Low-activity periods (no trade)
- **Red Zones:** High volatility periods (be cautious, reduce size)
- **End Zones:** Session end (avoid new entries)

---

# APPENDIX A: QUICK REFERENCE — INDICATOR COMBINATIONS

| Combination | Purpose | When to Use |
|------------|---------|-------------|
| RSI + MACD | Momentum + trend | General purpose |
| Bollinger + RSI | Volatility + momentum | Range trading |
| Supertrend + EMA(200) | Trend filter + entry | Trending markets |
| Stochastic + ADX | Overbought/oversold + trend strength | Range & trend |
| Ichimoku + Supertrend | Big picture + entry timing | Multi-timeframe |
| MACD + Volume + S/R | Momentum + confirmation + levels | Breakout trading |
| RSI + Bollinger + MA | Triple confirmation | Binary options |

---

# APPENDIX B: CRITICAL FORMULAS CHEAT SHEET

```
SMA(n) = ΣPrice / n
EMA = Price × (2/(n+1)) + EMA_prev × (1 - 2/(n+1))
MACD = EMA(12) - EMA(26); Signal = EMA(9, MACD)
RSI = 100 - (100/(1+RS)); RS = AvgGain/AvgLoss
Stochastic %K = ((Close-Low)/(High-Low)) × 100
Bollinger = SMA(20) ± 2×StdDev
ATR = EMA(TR, 14); TR = max(H-L,|H-PC|,|L-PC|)
VWAP = Σ(Price×Volume) / ΣVolume
ADX = EMA(|+DI-(-DI)|/(+DI+(-DI))×100, 14)
Supertrend = HL2 ± Multiplier×ATR
Kelly f* = W - ((1-W)/R)
RoR = ((1-Edge)/(1+Edge))^Capital_Units
Sharpe = (Rp-Rf)/σp
```

---

*Document compiled from 40+ sources including Investopedia, QuantifiedStrategies, TradingView, academic papers (IJCAI, ACL, arXiv), and professional trading platforms. Data current as of July 2026.*
