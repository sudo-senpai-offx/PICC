# PICC Engine Coverage — Current Trading-Logic Inventory (for v3.2 rebuild)

Status: FINDINGS (inventory of every trading-logic surface that exists today, with
real-world traits, to drive the "append or not" decisions during the v3.2 decision-core
rebuild). Compiled 2026-09-19. Blueprint authority: user's v3.2 master blueprint
(replaces v3.1). Real-world evidence: `docs/specs/PICC_ALGORY_FINDINGS_v1.md`
(reverse-engineering of a live MT5 trading platform), v3.2 research notes, domain knowledge.

Everything is observed from the code — file:line refs are included so each row can be
re-verified. Nothing is inferred where the code is readable.

---

## 1. Indicator primitives (`apps/dashboard/server/services/indicators.mjs`)

| Function | Line | Real-world traits |
|---|---|---|
| `sma(xs, period=20)` | 41 | Baseline; lags by half its period; useful for longer bias, useless fast |
| `ema(xs, period=20)` | 55 | Generic EMA — 9/21 is just `ema(x,9)`/`ema(x,21)`; still "invented", never composed yet |
| `adx(highs,lows,closes,period=14)` | 353 | Trend-strength ruler; rises in both up/down trends; 25+ = "trending"; lags and whipsaws in chop. v3.2: **keeps** as regime/context |
| `rsi(closes,period=14)` | 396 | 60/40-band reads (not OB/OS 70/30) are the useful intraday momentum read; OB/OS mostly noise on 5–60s |
| `stochRSI(closes,{period=14,smoothK=3,smoothD=3})` | 433 | Double-smoothed, most trigger-happy oscillator in the family; **known for "a lot of false signals" (v3.2 §3.2)** — context-only in v3.2, never a primary trigger |
| `atr(highs,lows,closes,period=14)` | 613 | Volatility yardstick; feeds stops/sizing/regime; v3.2 keeps for ATR sizing + volatility regime |
| `bollinger(closes,{period=20,mult=2})` | 625 | Mean-reversion tool; permanent "overbought" in trends; v3.2: **demoted to context** |
| `vwap(highs,lows,closes,volumes)` | 657 | Anchored cumulative VWAP; institutional intraday fair-value anchor; supports at VWAP, resistance above; v3.2 execution pillar #1 |
| `supportResistance(candles,{lookback=2,maxLevels=6})` | 723 | S/R level extractor; v3.2 keeps 4H S/R as context/regime reference |

All nine exist and are unit-tested. Nothing here needs new math — only composition (9/21)
and the net-new Delta/CVD/RelativeVolume series.

---

## 2. ProAnalysis confluence (`apps/dashboard/server/services/proanalysis.mjs`)

A heavy weighted indicator basket (daily/EOD analysis):
- Trend & Structure (weight 0.45): Alligator 1.5, Close-vs-EMA20 1.0, EMA20-vs-EMA50 1.0,
  Close-vs-EMA200 1.2, MACD 1.0, ParabolicSAR 0.8, Regression slope 1.2, Aroon 0.8, DMI 0.8,
  **Price-vs-VWAP 0.7** (line 168).
- Momentum & Strength (0.35): RSI(14) 1.2, StochRSI 1.0, Stoch cross 0.9, MACD hist 1.0,
  Awesome 0.8, CCI(20) 0.9, Williams %R 0.8, CMO(14) 0.8, ROC(12) 0.7, Momentum(10) 0.6, APO 0.6.
- Volatility & Cycle (0.2): BB %B 1.0, Vol-cycle 0.7, ATR percentile 0.7, Persistence 0.8.

Real-world trait: this is a **daily/EOD analyzer** (Yahoo 1d/2y), not a decision engine —
nothing here fires trades. It is evidence the codebase already "reads" the same vocabulary
(EMA20/50/200, VWAP, ADX-adjacent DMI, StochRSI, BB) v3.2 must demote. Keep as research UI;
do NOT let it leak into the decision path.

---

## 3. Model Matrix (`apps/dashboard/server/services/modelMatrix.mjs`)

7-model multiplexed vote with **recency-weighted confidence fusion**:
- `DECAY_ALPHA = 0.05` — every stored weight drifts toward chance each tick (line 26).
- Per-model win-rate tracked on settled outcomes; **failing models decay toward 0.4** then get
  **pruned** (record kept, weighting stopped) (lines 12–18, 333).
- Includes an **Anchored-VWAP-deviation** model (`modelMatrix.mjs:270`): ±1% overextension →
  fade call with 55–90 confidence (lines 288–290).

Real-world trait: honest ensemble practice — recency decay + pruning + recorded-but-excluded
models. **v3.2 relevance:** the anchoring/fade concept (VWAP ±1% → fade) is compatible with
v3.2's "don't chase at ±2σ, fade to AVWAP/+1σ"; the *confidence percentage* output is exactly
what v3.2 forbids as a decision input (confidence must be sample-size + expectancy, not a %).
Keep the ensemble machinery, strip/relabel the confidence output.

---

## 4. MTF Convergence (`apps/dashboard/server/services/mtfConvergence.mjs`)

Multi-timeframe confluence state machine. Voters:
- `voteTrend` 158, `voteMomentum` 167 (RSI>50 + MACD), `voteMomentumRsi60_40` 183 (**5c** —
  strict RSI 60/40 band), `voteStructure` 196 (swings), `voteTrendStrength` 214,
  `voteMomentumTrigger` 231 (**5b** — StochRSI 40/60 in-band cross), `voteVolatility` 250.
- `STOCHRSI_TRIGGER_BAND = {lo:40, hi:60}` (36), `STOCHRSI_OB_OS = {over:80, under:20}` (44),
  `RSI_TRIGGER_BAND = {lo:40, hi:60}` (52).
- Presets (88): scalping M1→M5→M15 (0.3/0.3/0.4), intraday M5→M15→H1, swingIntraday M15→H1→H4,
  swing H1→H4→D1, position D1→W1→MN. `PRESET_MOMENTUM` (109): only `intraday` uses the RSI 60/40
  read (giua64 Intraday convention, 5c); others default RSI>50+MACD.

Real-world trait: HTF-bias filtered entries is sound practice — trade in the direction of the
higher timeframe's trend. The **StochRSI trigger (5b) is the banned-by-v3.2 leg** (already demoted
to context in the 5c work). v3.2 keeps HTF bias (`voteTrend`/`voteStructure`/ADX) as the
**Context/Regime** registers feeding the execution score; momentum dimension becomes reference only.

---

## 5. U4FA 4-Factor Engine (`fourFactor.mjs` + `u4faConfig.mjs`) — the current decision core

Pipeline: **F1 gate → F2 structure → F3 trend → F4 boosters → verdict**, with Regime-3 Chop hard halt.

- **F1 gates** (`fourFactor.mjs:101,131,75,32`): session window, spread gate `spreadGateF1(spread, 1.5 pips)`,
  news blackout (±15 min, `u4faConfig.mjs:109`), correlation lock (static GBPUSD↔EURUSD 15-min pause,
  `u4faConfig.mjs:105-108`).
- **F2** `resolveStructureLevels` (176): hourly/daily S/R, tolerance 10 pips.
- **F3** trend + `triggerFromCandle` (220): candle vs SMA20, pin-bar hit.
- **F4 boosters** (238–292): `boosterB1` StochRSI-K/D cross (levels long 60/short 40), `boosterB2`
  candle-vs-SMA20, `boosterB3` Bollinger %B + ADX (hug `bbHugPct 0.9`). Verdict = `f4.passed >= f4.required`
  → TRADE else OBSERVE, else NEUTRAL (594–607). **Regime-3 Chop overrides the booster majority → NEUTRAL** (611–613).
- Timing: `timingRecommendation` (315) — ADX at/above threshold → enter at open of **next bar +2s** (`timingAtNextBarMs=2000`).
- Risk (`u4faConfig.mjs:118-122`): 0.5%/trade, −5% daily (UTC day-key), 10 proposals/day, 15-min post-loss cooldown.

Asset-class calibration (`u4faConfig.mjs:72-78`) — blueprint transcription, **verbatim-preserved**:
forex 5/5, gold 4/5, indices 3/5, crypto 3/5, commodities 1/5 **AVOID** (hard-refused, `resolveAssetConfig:480`).

Real-world trait: a four-factor scorecard with gates + boosters is a legitimate discretionary
framework, but it is exactly the shape v3.2 replaces. **B1 (StochRSI cross), B2 (candle-vs-SMA20),
B3 (BB %B hug, 50-EMA implied)** are all 50-EMA/BB/StochRSI-family triggers — **banned as primary
triggers by v3.2 §3.2**. The F1 gates (session/spread/news/correlation), ADX trend leg, chop halt,
and risk knobs are otherwise solid and map onto v3.2's Normalization/Constitution layers.

---

## 6. Adaptive Confluence / expiry optimizer (`adaptiveConfluence.mjs`)

- `CANDIDATE_EXPIRIES = [60, 120, 300, 900]` (33), U4FA adds 1800 (43). **15s explicitly excluded** (33).
- `ASSUMED_PAYOUT = {60:82, 120:85, 300:88, 900:90}` (%) conservative (45). **1800 has NO assumed
  payout** — an unobserved expiry can never pass the EV gate (487–493).
- EV gate `evGate` (360): `EV = p·(pay/100) − (1−p)` per $1; requires `EV × margin(1.15) ≥ 2:1 R:R`
  (`EV_RR_MIN`, `PRICE_RR_MIN = 2`, `PAYOUT_MARGIN = 1.15`, `MIN_WIN_PROB = 0.52`, `MIN_SCORE = 0.15`,
  `MAX_LOOKAHEAD_BARS = 15`) (46–53). `DECISION_INTERVAL_MS = 15_000` (54) — the engine already
  re-decides every 15s on the newest complete 60s candle.
- Breakeven math is derived from live/observed payout (`breakevenPayout`), not assumed (367).

Real-world trait: this is the **only market-structure-honest module in the decision core** — it
already refuses to trade when the payout math can't clear a cost+edge hurdle. It is the seed of
v3.2's Constitution layer (edge > cost). The `ASSUMED_PAYOUT` table + `obsPay` override = exactly
the cost-adjusted edge gate v3.2 demands; it just needs to run on sample-size + expectancy rather
than a point win-probability.

---

## 7. Expectancy / validation / sizing layer (`accuracyLedger, calibration, kellyCriterion, riskParity, correlation, monteCarlo, hyperopt, analytics, tradeJournal`)

- `accuracyLedger.mjs`: decision journal `LEDGER_CAP 1000`, 5s resolve cadence, 2s grace, 10-min
  pending cap, `PUSH_TOL 0.0002`, `backtestGates` (268). Realized-outcome tracking exists.
- `calibration.mjs`: confidence buckets `[55..95]` (15), `computeCalibration` (58),
  `getBreakevenWinRate(payoutPct)` (106) — realized vs claimed accuracy + breakeven per payout.
- `kellyCriterion.mjs`: half-Kelly sizing (19), anti-martingale tiering (39).
- `riskParity.mjs`: inverse-vol + equal-risk-contribution allocations (30, 55).
- `correlation.mjs`: Pearson + matrix + 0.8 threshold + diversification score (30, 65, 116, 134).
- `hyperopt.mjs`: gate-param grid + chronological split + walk-forward backtest (180, 195, 270).
- `analytics.mjs`/`tradeJournal.mjs`: expectancy, profit factor, avg win/loss.

Real-world trait: the validation stack **already** mirrors Algory's `locked_grade` acceptance
criteria (OOS floor, beat-random, MC p95 DD, plateau stability — `PICC_ALGORY_FINDINGS_v1.md`
§5.2). The seams exist; v3.2 just raises the floor: **300+ trades deployable / 500+ forward**, and
**never a confidence number without sample size + cost-adjusted expectancy**.

---

## 8. Sessions & data reality

- `tradingSessions.mjs`: asian/london/newyork + overlaps — used for *display/context*; U4FA runs
  its own `europe-london 07:00-16:00` + `ny-london 13:00-17:00` windows. No dead-zone/red-folder
  classes exist.
- **Volume reality (v3.2 Normalization input):** crypto/ccxt OHLCV carries volume, finest 60s
  (`ccxtAdapter.mjs:19`); Yahoo is OHLC-only (`yahooAdapter.mjs:75`); EO candles carry none.
  → Volume Delta / CVD / Relative Volume are **net-new** and only honestly computable on crypto
  today; forex/EO must degrade to **VWAP + EMA-only** (v3.2 §2.5) until the futures-proxy leg
  (>0.80 corr, >70% same-sign) is provisioned.

---

## 9. Disposition map (v3.2 rebuild, unchanged by a/b/c choice)

| Existing logic | v3.2 disposition |
|---|---|
| ADX(14) trend + Regime-3 chop halt | Keep — Context/Regime (already trims chop) |
| 4H/daily S/R (`resolveStructureLevels`) | Keep — Context/Regime |
| VWAP anchored (`indicators:657`, modelMatrix avwap, proanalysis 0.7) | Keep — Execution pillar 1 |
| EMA 9/21 composition (net-new from `ema`) | Keep — Execution pillars 2–3 |
| Session windows + spread gate 1.5 pips | Keep — Normalization |
| F1 news blackout ±15 + correlation locks | Keep (cooldown values: revisit vs prop-firm ±2 research) |
| EV gate + `ASSUMED_PAYOUT` + breakeven | Keep — seed of Constitution layer |
| `accuracyLedger` + `calibration` + walk-forward | Keep — raised to 300/500 floor |
| StochRSI cross (5b, B1), BB %B hug (B3), candle-vs-SMA20 (B2), 50/200 EMA as triggers | **Demote/cut from decision path** (v3.2 §3.2) — context registers/log only |
| Model-Matrix confidence %, U4FA 0–5 "score", calibration buckets as decision inputs | Relabel: confidence = sample size + cost-adjusted expectancy only |
| Volume Delta / CVD / Relative Volume | **Net-new** — crypto only, degrade elsewhere |
| 15s bars | **Net-new slot** (future-proof feed) — schedule (b)/(c)-inside-(a) |
| Dead-zone / red-folder session classes | **Net-new** — decision to make |

---

## 10. Locked dispositions (owner decisions, 2026-09-19)

Interactive Q&A — all recommended options accepted:

1. **VWAP anchor** — both: anchored-cumulative remains primary; session-reset VWAP added as a
   configurable secondary anchor. Execution engine selects per venue/session preference.
2. **EMA chain** — append **EMA400 top-down** (D1/H4 → EMA400, → EMA200/100) as a Context/Regime
   register only; never a trigger. 9/21 alignment remains the execution fast pair.
3. **StochRSI + BB %B** — demoted from the decision path, **kept as context registers**
   (computed, logged, shown in HUD; never trigger/booster inputs). Existing tests stay meaningful.
4. **Delta / CVD / Relative Volume** — **net-new, wired for crypto (ccxt) now**; forex/EO degrade
   to VWAP+EMA-only per v3.2 §2.5 until the proxy validates.
5. **Futures-proxy leg** — **build now inside the (b) 15s slot**: the proxy validator
   (>0.80 corr, >70% same-sign) is the honesty gate that unlocks delta/CVD on non-crypto.
6. **Volatility regime** — reuse ATR-percentile; add LOW/NORMAL/HIGH classifier with the
   v3.2 25–50% size cut in HIGH VOL.
7. **Sample-size gate** — **hard gate now**: Constitution layer refuses real-money execution
   below 300+ deployable / 500+ forward; paper/demo always open; never a confidence number
   without sample size + cost-adjusted expectancy.
8. **Session classes** — append **dead-zone** (illiquid, wide spread → no fresh entries) and
   **red-folder** (news-heavy windows → no new entries) classification; feeds F1/spread gate.
9. **Cost-adjusted edge** — append an **explicit cost line** on every forex/EO decision output:
   payout, 1.5-pip spread model, slippage, and the EV-gate margin; rejection reasons cite the number.
10. **Sizing** — keep **half-Kelly + anti-martingale**, with the volatile-regime cut layered on top.

## 11. Locked structural decisions (owner, 2026-09-19)

1. **Composition** — the U4FA `verdict` object retires completely. Decision path =
   Constitution → Context/Regime → 5-point Execution (section §2 of the design).
   U4FA + MTF outputs keep logging as **reference registers during the soak**, then retire.
   Their legs (F1 safety gates, ADX/Chop, 4H S/R) are re-homed into the new layers.
2. **Staging** — **parallel soak, then flip**: the new engine ships alongside the old; a config
   toggle routes the decision path; the old path keeps logging. Flip when the new path matches
   or exceeds on paper over a soak window (~2–4 weeks).
3. **Paper/demo** — the **new engine runs on paper + demo immediately** (fast-forwarding the
   sample clock); real money is gated by the Constitution floor.
4. **Copilot** — **deterministic enforcement only**: trip-wire veto + alerting, zero LLM in the
   trade path. LLM is explain-only inside the HUD (never decides, never vetoes with unsupported
   reasoning). Matches v3.2 Part 0.5.

## 12. Locked design details (owner, 2026-09-19)

1. **Sample clock** — one **aggregate global counter** across all venues/assets that meet the
   volume-reliability bar. Real-money unlock at 300+ deployable; 500+ forward validation required.
2. **Soak flip gate** — shared `accuracyLedger` tagged per engine (old/new) + signal source.
   Flip when the **new path's cost-adjusted expectancy ≥ old path's in the same window with
   ≥ 100 paper trades on each** AND the ~2–4 week soak elapsed.
3. **Venue shapes, one signal** — 5-point score = directional entry signal. EO: expiry picked by
   the EV gate across `CANDIDATE_EXPIRIES`. Crypto: open-candle direction entry.
4. **Copilot trip-wires (8)** — approved list: (1) −5% daily / −2% session hard-halt;
   (2) Regime-3 Chop override; (3) dead-zone/red-folder entry block; (4) 1.5-pip spread-spike
   abort; (5) cost line below 2:1 EV margin abort; (6) kill-switch everywhere; (7) voluntary
   pause on consecutive losses (threshold TBD); (8) **configurable proposals/day cap**.
   Reuses existing `safetySidecar` + `interventions` + §1 venue-capability gates.
5. **Trade cap is user-configurable with "unlimited" as the UI default.** Owner added
   2026-09-19: the proposals/day cap is a setting (persisted, same data-dir config as U4FA
   knobs), default = unlimited. The 10/day references from the prior blueprint and the legacy
   `maxDailyTrades` knob are superseded when the setting is unlimited; `0` in the UI = unlimited.