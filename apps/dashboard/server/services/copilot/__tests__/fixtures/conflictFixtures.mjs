// WS-7 T12 — the frozen fixtures the three conflict-resolution tests read.
//
// A fixture, not a stub, for T11's reason (marketFixtures.mjs:1-7): the values
// are deterministic functions of nothing, so a failing test is testing the RULE
// rather than its inputs. No clock, no `Math.random`, no network.
//
// ---------------------------------------------------------------------------
// WHY THESE SERIES ARE SHAPED THE WAY THEY ARE
// ---------------------------------------------------------------------------
//
// AC-027 needs a candle on which **Booster1 AND Booster2 both fire**, and a
// candle on which **only Booster1 fires** — AC-027's prohibited side effect
// names the single-booster case explicitly. `experts/volatilityBoosters.mjs`
// defines:
//
//   Booster1 (:73)  crossedUp  = ema20 − ema50 crosses from <= 0 to > 0
//   Booster2 (:80)  bbwNow > bbwPrev  (strictly expanding)
//
// Neither is hand-settable on a single bar: both are read off 20- and 50-period
// and 20-period BOLLINGER series, so the shape of the last ~60 bars decides
// them. These two series were therefore chosen by SCANNING candidate shapes and
// recording which ones produce the two required bar kinds — the numbers below
// are what was found, not what was guessed:
//
//   dualBoosterCandles()     9 bars fire both;  0 fire only Booster1
//   singleBoosterCandles()   0 bars fire both; 10 fire only Booster1
//
// The growth factor `1 + k*i` is what makes BBW expand: a constant-amplitude
// sine has a flat bandwidth, and `seededSeries`-style noise gives no 20/50
// cross at all. Both were tried first and produced zero dual-booster bars.
//
// ---------------------------------------------------------------------------
// WHY THE TWO-TIER-STOP BARS ARE PLACED RELATIVE TO THE HEAD
// ---------------------------------------------------------------------------
//
// ATR(14) is *fed by* the bar being judged, so a hand-picked close moves the
// stop level that the close is measured against. The head below is a 70-bar
// ramp-plus-sine with a deliberate property: its price sits only ~1.06 ABOVE
// its own 50 EMA while 1.5x ATR is ~1.72. That puts the 50-EMA stop level
// ABOVE the 1.5x-ATR stop level, which is the only market shape in which
// AC-028's two hard-stop clauses are separately observable:
//
//   close in (stopLevel, ema50)  -> ema50 clause only   -> C_closeBelowEma50
//   close <= stopLevel           -> ATR clause (and ema50, which is above it)
//
// In a market where price is far above the 50 EMA — the default fixture — the
// ATR clause is strictly *tighter* and the ema50 clause can never be isolated.
// That is a real property of the rule, not a fixture artefact, and it is why
// the ema50 clause carries its own case rather than being asserted as a
// side-effect of the ATR case.
//
// `assertFixtureGeometry()` at the bottom re-derives every relationship from
// the DERIVED state and THROWS if a future indicator change invalidates the
// design. A changed indicator should fail loudly here with a named message,
// not produce a confusing verdict failure three tests later.

import { deriveMarketState, lastValue } from "../../marketState.mjs"
import { COMPUTED_AT } from "./marketFixtures.mjs"

/** 12:00 UTC on a fixed date — inside the London-NY overlap, never the dead zone. */
export const CONFLICT_COMPUTED_AT = COMPUTED_AT

function candlesFromCloses(closes, { wickFactor = 0.0008 } = {}) {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1]
    return {
      open: prev,
      high: Math.max(prev, close) * (1 + wickFactor),
      low: Math.min(prev, close) * (1 - wickFactor),
      close,
      volume: 1000,
      time: i * 60_000
    }
  })
}

// ---------------------------------------------------------------------------
// C1 — the dual-booster and single-booster families
// ---------------------------------------------------------------------------

/** Bars in `dualBoosterCandles`; index 67 is the dual-booster trigger bar. */
export const DUAL_BOOSTER_TRIGGER_INDEX = 67

/** Bars in `singleBoosterCandles`; index 78 fires Booster1 only. */
export const SINGLE_BOOSTER_INDEX = 78

/** Bars in `adxLaggingCandles`; index 245 is the dual-booster trigger bar. */
export const ADX_LAGGING_TRIGGER_INDEX = 245

/**
 * The series C1 was written FOR.
 *
 * 250 bars of pure chop, then a gentle ramp. The chop keeps ADX below T11's
 * `ADX_TREND_THRESHOLD` of 25 while the 20/50 cross and an expanding BBW both
 * fire inside it — which is exactly §4.4:699's rationale, "ADX lags; BBW and the
 * 20/50 cross lead", made observable.
 *
 * WHY THE GROWING-AMPLITUDE FAMILY ABOVE IS NOT USED FOR C1'S SCORE CLAIM: on
 * every one of its nine dual-booster bars the ADX leg already read
 * `above-25-rising` and the trend sub-score was already 100, so C1's maxing was
 * a no-op there. That is a real property of that shape, not a defect — but it
 * means it can only demonstrate that C1 FIRES, never that C1 MAXES anything.
 * This family scores 66.67 on the trigger bar with the ADX leg at zero, so
 * forcing the score to its band maximum is worth a visible 6.67 points.
 *
 * Found by scanning candidate shapes, not by guessing: 85 of the 85
 * dual-booster bars in the chop-then-ramp family read below-threshold on ADX.
 */
export function adxLaggingCandles() {
  const closes = []
  for (let i = 0; i < 400; i++) {
    if (i < 250) closes.push(100 + 4 * Math.sin(2.7 * i))
    else {
      const j = i - 250
      closes.push(100 + 0.2 * j + 0.5 * Math.sin(j / 3))
    }
  }
  return candlesFromCloses(closes)
}

/** The raw market state whose LAST bar is the "ADX has not caught up" trigger. */
export function adxLaggingState(overrides = {}) {
  return {
    candles: adxLaggingCandles().slice(0, ADX_LAGGING_TRIGGER_INDEX + 1),
    computedAt: CONFLICT_COMPUTED_AT,
    ...overrides
  }
}

/**
 * The C2 entry price that makes the ADX-lagging state a HARD stop.
 *
 * `close + 8` places the 1.5x-ATR stop level 7.599 below the close, so the CLOSE
 * is beyond it — the clause, not merely the wick. It is a supplied fill, which
 * is the realistic reading: a long entered 8 points above the current price has
 * moved against us.
 */
export const ADX_LAGGING_HARD_STOP_OFFSET = 8

/**
 * A growing-amplitude oscillation: BBW expands on most bars, and the 20/50
 * spread crosses zero on nine of them.
 */
export function dualBoosterCandles() {
  return candlesFromCloses(
    Array.from({ length: 320 }, (_, i) => 100 * (1 + 0.0006 * i) * (1 + 0.18 * Math.sin(i / 5)))
  )
}

/** The same family with a faster, faster-growing swing: Booster1 alone. */
export function singleBoosterCandles() {
  return candlesFromCloses(
    Array.from({ length: 320 }, (_, i) => 100 * (1 + 0.0015 * i) * (1 + 0.14 * Math.sin(i / 4)))
  )
}

/** The raw market state whose LAST bar is the dual-booster trigger bar. */
export function dualBoosterState(overrides = {}) {
  return {
    candles: dualBoosterCandles().slice(0, DUAL_BOOSTER_TRIGGER_INDEX + 1),
    computedAt: CONFLICT_COMPUTED_AT,
    ...overrides
  }
}

/** The raw market state whose LAST bar fires Booster1 and NOT Booster2. */
export function singleBoosterState(overrides = {}) {
  return {
    candles: singleBoosterCandles().slice(0, SINGLE_BOOSTER_INDEX + 1),
    computedAt: CONFLICT_COMPUTED_AT,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// C2 — the two-tier stop families
// ---------------------------------------------------------------------------

const HEAD_BARS = 70

/** A rising ramp-plus-sine: price ~1.06 above its own 50 EMA, 1.5x ATR ~1.72. */
function longHead() {
  const base = []
  for (let i = 0; i < HEAD_BARS; i++) {
    const close = 100 + 0.05 * i + 3.0 * Math.sin(i / 2)
    const prev = i === 0 ? close : base[i - 1].close
    base.push({
      open: prev,
      high: Math.max(prev, close) * 1.001,
      low: Math.min(prev, close) * 0.999,
      close,
      volume: 1000,
      time: i * 60_000
    })
  }
  return base
}

/** The exact mirror: price ~1.06 BELOW its own 50 EMA, so a short's ema clause is quiet. */
function shortHead() {
  const base = []
  for (let i = 0; i < HEAD_BARS; i++) {
    const close = 100 - 0.05 * i - 3.0 * Math.sin(i / 2)
    const prev = i === 0 ? close : base[i - 1].close
    base.push({
      open: prev,
      high: Math.max(prev, close) * 1.001,
      low: Math.min(prev, close) * 0.999,
      close,
      volume: 1000,
      time: i * 60_000
    })
  }
  return base
}

/** The head's last close — the reference price an entry is anchored to. */
function headEntry(head) {
  return lastValue(head.map((c) => c.close))
}

/** Head + one controlled bar, with the controlled bar's extremes set. */
function withFinalBar(head, { close, low, high }) {
  const entry = headEntry(head)
  return [...head, { open: entry, high, low, close, volume: 1000, time: HEAD_BARS * 60_000 }]
}

/**
 * The long-side two-tier-stop cases, one per verdict AC-028 names.
 *
 * `entryPrice` is supplied rather than inferred so the stop level is anchored
 * to a number the reader can see. It equals the head's last close.
 *
 * - `wickInside`     — the wick pierces 1.5x ATR, the CLOSE does not, and the
 *                      close is above the 50 EMA. AC-028 case 1: alert only.
 * - `closeBeyondAtr` — the CLOSE is beyond 1.5x ATR. AC-028 case 2: hard stop.
 * - `closeBelowEma50`— the close is inside 1.5x ATR but below the 50 EMA.
 *                      AC-028 case 3: hard stop, and it isolates the ema clause.
 * - `clean`          — nothing is breached. The verdict `none` must exist too,
 *                      or "no verdict" and "no stop" are indistinguishable.
 */
export function longTwoTierStopCases() {
  const head = longHead()
  const entry = headEntry(head)
  return [
    {
      label: "wickInside",
      expect: "softAlert",
      direction: "long",
      entryPrice: entry,
      candles: withFinalBar(head, { close: entry - 0.3, low: entry - 2.25, high: entry + 0.1 })
    },
    {
      label: "closeBeyondAtr",
      expect: "hardStop",
      direction: "long",
      entryPrice: entry,
      candles: withFinalBar(head, { close: entry - 2.1, low: entry - 2.3, high: entry + 0.1 })
    },
    {
      label: "closeBelowEma50",
      expect: "hardStop",
      direction: "long",
      entryPrice: entry,
      candles: withFinalBar(head, { close: entry - 1.42, low: entry - 1.62, high: entry + 0.1 })
    },
    {
      label: "clean",
      expect: "none",
      direction: "long",
      entryPrice: entry,
      candles: withFinalBar(head, { close: entry - 0.1, low: entry - 0.5, high: entry + 0.1 })
    }
  ]
}

/** The short-side mirror, so the rule's direction symmetry is testable. */
export function shortTwoTierStopCases() {
  const head = shortHead()
  const entry = headEntry(head)
  return [
    {
      label: "shortWickInside",
      expect: "softAlert",
      direction: "short",
      entryPrice: entry,
      candles: withFinalBar(head, { close: entry + 0.3, low: entry - 0.1, high: entry + 2.25 })
    },
    {
      label: "shortCloseBeyondAtr",
      expect: "hardStop",
      direction: "short",
      entryPrice: entry,
      candles: withFinalBar(head, { close: entry + 2.1, low: entry - 0.1, high: entry + 2.3 })
    },
    {
      label: "shortClean",
      expect: "none",
      direction: "short",
      entryPrice: entry,
      candles: withFinalBar(head, { close: entry + 0.1, low: entry - 0.1, high: entry + 0.5 })
    }
  ]
}

/** Every two-tier-stop case, long side first, each with its raw market state. */
export function twoTierStopCases() {
  return [...longTwoTierStopCases(), ...shortTwoTierStopCases()].map((c) => ({
    ...c,
    state: { candles: c.candles, computedAt: CONFLICT_COMPUTED_AT }
  }))
}

// ---------------------------------------------------------------------------
// The geometry self-check
// ---------------------------------------------------------------------------

/**
 * Prove the fixtures still describe the market shapes they were built to
 * describe. THROWS with a named message when they do not.
 *
 * This is the anti-rot for a fixture whose numbers were derived by scanning
 * candidate series. A change to `indicators.mjs` would otherwise move the
 * geometry silently and turn three AC-028 cases into three vacuous ones.
 *
 * @param {(state: object) => object} [evaluateBoosterLegs] Injected in tests so
 *   this file never imports the expert under test.
 */
export function assertFixtureGeometry(evaluateBoosterLegs) {
  const problems = []

  // --- C1: the two bar kinds AC-027 needs really are the two bar kinds. ------
  for (const [label, raw, wantDual] of [
    ["dualBooster", dualBoosterState(), true],
    ["singleBooster", singleBoosterState(), false],
    ["adxLagging", adxLaggingState(), true]
  ]) {
    if (typeof evaluateBoosterLegs !== "function") {
      problems.push(`${label}: no booster evaluator was supplied to verify the bar kind`)
      continue
    }
    const fired = evaluateBoosterLegs(deriveMarketState(raw))
    const isDual = fired.booster1 === true && fired.booster2 === true
    const onlyFirst = fired.booster1 === true && fired.booster2 === false
    if (wantDual && !isDual) problems.push(`${label}: expected both boosters to fire, saw ${JSON.stringify(fired)}`)
    if (!wantDual && !onlyFirst) {
      problems.push(`${label}: expected Booster1 alone to fire, saw ${JSON.stringify(fired)}`)
    }
  }

  // --- C2: each case really is the verdict it claims. ------------------------
  for (const c of twoTierStopCases()) {
    const s = deriveMarketState(c.state)
    const atr = lastValue(s.series.atr14)
    const ema50 = lastValue(s.series.ema50)
    const isLong = c.direction === "long"
    const stopLevel = isLong ? c.entryPrice - atr * 1.5 : c.entryPrice + atr * 1.5
    const closeBeyond = isLong ? s.last.close <= stopLevel : s.last.close >= stopLevel
    const emaTrigger = isLong ? s.last.close < ema50 : s.last.close > ema50
    const wickBeyond = isLong ? s.last.low <= stopLevel : s.last.high >= stopLevel

    const shouldHard = c.expect === "hardStop"
    const shouldAlert = c.expect === "softAlert"
    if (shouldHard && !closeBeyond && !emaTrigger) {
      problems.push(`${c.label}: declared hardStop but neither hard clause is satisfied`)
    }
    if (shouldAlert && (closeBeyond || emaTrigger)) {
      problems.push(`${c.label}: declared softAlert but a hard clause is satisfied — the alert-only case is unreachable`)
    }
    if (shouldAlert && !wickBeyond) {
      problems.push(`${c.label}: declared softAlert but the wick does not pierce 1.5x ATR`)
    }
    if (c.expect === "none" && (closeBeyond || emaTrigger || wickBeyond)) {
      problems.push(`${c.label}: declared clean but something is breached`)
    }
    if (c.label === "closeBelowEma50" && (closeBeyond || !emaTrigger)) {
      problems.push(
        `${c.label}: exists to isolate the 50-EMA clause, so it must be below the EMA and INSIDE 1.5x ATR ` +
          `(closeBeyond=${closeBeyond} emaTrigger=${emaTrigger})`
      )
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `copilot: the T12 conflict fixtures no longer describe their intended market shapes:\n  - ${problems.join(
        "\n  - "
      )}`
    )
  }
  return true
}
