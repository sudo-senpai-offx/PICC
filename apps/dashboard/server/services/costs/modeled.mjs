// Costs modeled leg — `costAdjustedEv` wrapper + adaptive medians.
//
// FEEDBACK LOOP (read before touching calibration): `calibratedInputs` derives
// venue spread/slippage medians from observed (measured) fills; those medians
// feed back into `modelFillCost` as inputs for future modeled records. So every
// new batch of measured fills shifts what later modeled costs assume — the
// loop is deliberate (spec decision 11), and the provenance label is what keeps
// it honest: outputs are "modeled" on defaults, "modeled-with-calibrated-inputs"
// once venue medians take over, and NEVER "measured". A calibrated number is
// still a model guess; relabeling it measured would launder the guess.
//
// No network, no store writes (persistence is a later task's job). Cost math is
// owned by constitution.mjs `costAdjustedEv` — imported and wrapped here, never
// reimplemented: `costPct` (cost in payout-percent units) is its output, and
// per-leg USD follows the same pips→stake-fraction conversion it applies
// (`costUsd = notionalUsd * pips * pipValuePct`).

import { costAdjustedEv } from "../constitution.mjs"

export const CALIBRATION_MIN_FILLS = 30
export const DEFAULT_SPREAD_PIPS = 1.5
export const DEFAULT_SLIPPAGE_PIPS = 0
export const DEFAULT_PIP_VALUE_PCT = 0.01

const MODELED = "modeled"
const CALIBRATED = "modeled-with-calibrated-inputs"

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

function finiteNumbers(fills, key) {
  const out = []
  for (const fill of fills) {
    if (fill == null || typeof fill !== "object") continue
    const v = Number(fill[key])
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

// Venue medians once ≥30 observed fills carry usable pips, else the
// constitution 1.5/0 defaults. Only fills for `venue` count; other venues
// never calibrate this one. Provenance is "modeled-with-calibrated-inputs"
// ONLY when medians take over — defaults stay "modeled".
export function calibratedInputs(venue, measuredFills) {
  const fills = Array.isArray(measuredFills) ? measuredFills : []
  const scoped = fills.filter((f) => f != null && typeof f === "object" && (f.venue ?? null) === venue)
  const observedFills = scoped.length
  if (observedFills < CALIBRATION_MIN_FILLS) {
    return {
      venue,
      spreadPips: DEFAULT_SPREAD_PIPS,
      slippagePips: DEFAULT_SLIPPAGE_PIPS,
      provenance: MODELED,
      observedFills,
      reason: `calibration-thin:have-${observedFills}-need-${CALIBRATION_MIN_FILLS}`
    }
  }
  const spreads = finiteNumbers(scoped, "spreadPips")
  const slips = finiteNumbers(scoped, "slippagePips")
  return {
    venue,
    spreadPips: spreads.length > 0 ? median(spreads) : DEFAULT_SPREAD_PIPS,
    slippagePips: slips.length > 0 ? median(slips) : DEFAULT_SLIPPAGE_PIPS,
    provenance: CALIBRATED,
    observedFills
  }
}

function observedAtNow() {
  return new Date().toISOString()
}

// Spread + slippage legs for one fill's notional, shaped for Task 1
// `recordFillCost`. `costPct` comes from `costAdjustedEv` (neutral 50/100
// ticket purely to exercise its cost path — costPct is independent of
// winProb/payoutPct); a null costPct means the inputs failed its gate, so the
// fill is skipped with a reason, never zeroed. `provenance` accepts only the
// two modeled labels — anything else (including "measured") falls back to
// "modeled", pinning the never-measured rule at the seam.
export function modelFillCost({
  venue,
  route = "fill",
  notionalUsd,
  spreadPips = DEFAULT_SPREAD_PIPS,
  slippagePips = DEFAULT_SLIPPAGE_PIPS,
  pipValuePct = DEFAULT_PIP_VALUE_PCT,
  provenance = MODELED,
  observedAt
} = {}) {
  const notional = Number(notionalUsd)
  if (!Number.isFinite(notional) || notional <= 0) {
    return { records: [], skipped: [{ kind: "spread+slippage", reason: "notional-not-positive-finite" }] }
  }
  const gate = costAdjustedEv({
    winProb: 0.5,
    payoutPct: 100,
    spreadPips,
    slippagePips,
    pipValuePct
  })
  if (gate.costPct == null) {
    return { records: [], skipped: [{ kind: "spread+slippage", reason: "cost-unmodelable" }] }
  }
  const pip = Number(pipValuePct)
  const at = observedAt ?? observedAtNow()
  const prov = provenance === CALIBRATED ? CALIBRATED : MODELED
  const inputs = {
    notionalUsd: notional,
    spreadPips: Number(spreadPips),
    slippagePips: Number(slippagePips),
    pipValuePct: pip,
    costPct: gate.costPct
  }
  return {
    records: [
      {
        venue,
        route,
        kind: "spread",
        amountUsd: notional * Number(spreadPips) * pip,
        ccy: "USD",
        fxSource: "constitution-costAdjustedEv",
        fxAt: null,
        provenance: prov,
        observedAt: at,
        inputs
      },
      {
        venue,
        route,
        kind: "slippage",
        amountUsd: notional * Number(slippagePips) * pip,
        ccy: "USD",
        fxSource: "constitution-costAdjustedEv",
        fxAt: null,
        provenance: prov,
        observedAt: at,
        inputs
      }
    ],
    skipped: []
  }
}
