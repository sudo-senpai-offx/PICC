# VALIDATION — evidence base for trusting (or distrusting) the engine

This file records *how* to validate and *where the numbers live*. It is
refreshed by re-running the commands; do not hand-edit numbers here — paste
fresh endpoint output instead. Last structural audit: full-system pass
(commit `9c28826`), math defects fixed and regression-tested.

## What was verified (code level)

- **Indicators** (RSI/EMA/SMMA/ATR/Bollinger/MACD/Stoch/ADX/PSAR/Ichimoku):
  derived against canonical formulas during the adversarial audit; RSI Wilder
  seed hardened against interior nulls.
- **No look-ahead**: prediction backtest truth spans exactly `h` steps from
  the decision bar (`prediction.mjs`); hyperopt's `searchGateGrid(train…)`
  structurally cannot see the validation slice; accuracy ledger resolves at
  candle-time-correct expiry (ms/seconds unit bug fixed).
- **EV units**: predicted (fraction of stake) and realized (now also fraction)
  are comparable everywhere; the old percent/fraction mix is regression-pinned
  in `accuracyLedger.test.mjs`.
- **Kelly**: payout odds estimated from wins only; empty history → 0.8 default.

## How to validate going forward (live evidence)

1. **Calibration** — predicted vs realized per confidence bucket:
   ```
   curl -s localhost:3000/api/trading/health | jq .calibration
   ```
   Healthy: buckets monotonically increasing realized win rate with
   calibrationGap ≥ −0.03..−0.05. Persistently < −0.08 = overconfidence
   (the readiness gate blocks on this).

2. **Realized vs predicted EV**:
   ```
   curl -s localhost:3000/api/trading/ledger/stats | jq '.predictedEv, .realizedEv, .edge'
   ```
   Both in fraction-of-stake units. Edge ≤ 0 over ≥200 decisions = the engine
   does not beat its own predictions.

3. **Walk-forward hyperopt** (gate thresholds, leakage-proofed):
   ```
   curl -s -X POST localhost:3000/api/trading/walk-forward \
     -H 'content-type: application/json' \
     -d '{"candles":[…],"folds":5}'
   ```
   Trust `aggregate.validationHitRate` / stability only, never train metrics.

4. **Per-asset honesty**:
   ```
   curl -s localhost:3000/api/trading/export | jq .perAsset
   ```
   If an instrument's hitRate sits below breakeven, exclude it from autopilot
   scope rather than averaging it away.

5. **Reliability floor** before reading any signal statistics:
   ```
   curl -s localhost:3000/api/trading/status | jq .uptime24h
   ```
   Require ≥24h window with livePct ≥95% or treat all downstream stats as
   provisional.

## The one-line rule

> A number in PICC is trustworthy only while its honesty label says LIVE,
> its source reports healthy in data-sources, and the calibration gap for its
> confidence bucket is inside tolerance. Everything else is a hypothesis.
