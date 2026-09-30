import type { Availability, RiskCapabilityKey, RiskLayerReading } from "../contracts"
import { unavailable } from "./availability"

/**
 * WS-7 T7 — the Risk room's view of the spec §4.4 risk layer.
 *
 * THE THREE CAPABILITIES AND THEIR REAL STATUS IN THIS TREE, MEASURED:
 *
 *  1. `atrStop` — ATR(14) with a 1.5x stop. REAL. `indicators.mjs:600-617`
 *     exposes `trueRange` and the Wilder-smoothed `atr(highs, lows, closes,
 *     period)`, and `v32Context.mjs:185-213` derives a volatility regime from
 *     ATR(14) with an explicit "insufficient candles" branch that returns
 *     `available: false` rather than a fabricated value. The room can therefore
 *     show a real ATR when the engine supplies one, and the upstream honest
 *     branch is the same shape this module uses.
 *
 *  2. `drawdownDisable` — 2% daily drawdown disable. DOES NOT EXIST. The
 *     nearest thing in the tree is `v32Copilot.mjs:28`'s
 *     `SESSION_HALT_FLOOR_PCT = 2`, which is a -2% SESSION halt, not a 2%
 *     daily drawdown disable; and `u4faRisk.mjs` carries a -5% daily limit
 *     behind `checkProposalGate`. Neither is this capability, and rendering
 *     either under this row's label would be exactly the kind of near-match
 *     substitution the honesty rules forbid. Owned by the WS-7 T11 risk layer.
 *
 *  3. `threeStrike` — 3-strike rule locking keys for 24h. DOES NOT EXIST.
 *     A tree-wide search for `threeStrike`, `3-strike`, `strikeCount`,
 *     `keyLock` and `keyLocked` returns nothing. Owned by WS-7 T11.
 *
 * WHY EACH ROW CARRIES ITS OWN AVAILABILITY.
 *
 * One shared "risk layer" flag would render a live ATR next to two silent
 * capabilities and let the reader infer all three are real. They are not, and
 * the difference is load-bearing: a 2% daily drawdown disable is a safety rail,
 * and a safety rail that appears present and is not is worse than one that is
 * visibly absent. So `riskLayerView` takes three independent readings and
 * refuses to produce a view at all unless all three are supplied.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not compute ATR, does not enforce a
 * drawdown limit, does not count strikes, and does not hold a stop price. It
 * renders what a producer observed. The 1.5x multiplier, the 2% figure and the
 * 24h lock are carried as `specValue` strings so the room states PICC's own
 * specification rather than a number this module chose.
 */

/** The spec §4.4 risk layer, exactly. Carried so the room never invents a threshold. */
export const RISK_LAYER_SPEC = {
  atrStop: "ATR(14) stop at 1.5x",
  drawdownDisable: "2% daily drawdown disable",
  threeStrike: "3-strike rule locks keys for 24h"
} as const satisfies Record<RiskCapabilityKey, string>

/** The owner of the two capabilities that do not exist yet. A WS-7 task, not WS-8. */
export const RISK_LAYER_OWNER = "WS-7 T11"

export type AtrObservation = {
  /** ATR(14). Null only when the producer has not observed it. */
  atr: number | null
  period: 14
  /** The 1.5x stop distance derived from the ATR, in the same units. Null with a null atr. */
  stopDistance: number | null
  observedAt: number
  source: string
}

/**
 * The ATR stop, or the honest absence of one.
 *
 * `atrStopDistance` is DERIVED here rather than accepted, so a producer cannot
 * hand the room a stop distance that does not correspond to its own ATR — the
 * 1.5x is the spec's and is applied in exactly one place. When there is no
 * ATR the distance is null, never 0: a stop distance of 0 means "stop at the
 * entry price", which is a catastrophic configuration, not an absent one.
 */
export function atrStopReading(observation: AtrObservation | null): RiskLayerReading {
  if (observation === null) {
    return {
      key: "atrStop",
      availability: unavailable({
        reason: "no ATR(14) observation has been supplied to the Risk room",
        owner: RISK_LAYER_OWNER,
        since: 0
      }),
      label: "ATR(14) stop",
      specValue: RISK_LAYER_SPEC.atrStop,
      value: null,
      detail: "ATR(14) is implemented upstream (indicators.mjs, v32Context.mjs); no reading is wired into this room yet."
    }
  }
  if (observation.period !== 14) {
    throw new TypeError(`risk: ATR period must be 14, received ${observation.period}`)
  }
  if (observation.atr === null) {
    return {
      key: "atrStop",
      availability: unavailable({
        reason: "the ATR(14) producer reported no value for this window",
        owner: RISK_LAYER_OWNER,
        since: observation.observedAt
      }),
      label: "ATR(14) stop",
      specValue: RISK_LAYER_SPEC.atrStop,
      value: null,
      detail: "No ATR value was observed. Unavailable is not zero: an ATR of 0 would mean a market with no range."
    }
  }
  if (typeof observation.atr !== "number" || !Number.isFinite(observation.atr) || observation.atr < 0) {
    throw new TypeError(`risk: ATR must be a non-negative finite number or null, received ${observation.atr}`)
  }
  const stopDistance = observation.atr * 1.5
  return {
    key: "atrStop",
    availability: {
      status: "live",
      source: observation.source,
      observedAt: observation.observedAt,
      freshnessMs: 0
    },
    label: "ATR(14) stop",
    specValue: RISK_LAYER_SPEC.atrStop,
    value: `ATR ${observation.atr.toFixed(5)} · stop distance ${stopDistance.toFixed(5)} (1.5x)`,
    detail: "Observed ATR(14) with the spec's 1.5x stop distance applied."
  }
}

export type DrawdownObservation = {
  /** Session loss percentage so far. Positive numbers are gains. */
  sessionLossPct: number
  /** UTC day key the drawdown is measured against. */
  dayKey: string
  observedAt: number
  source: string
  /**
   * The measured daily drawdown percentage, or null when it cannot be
   * observed. The disable is evaluated against this, not against the session
   * figure: the 2% rail is a DAILY rail and using the session number would
   * disable trading on a different rule than the spec states.
   */
  dailyDrawdownPct: number | null
}

/**
 * The 2% daily drawdown disable — currently an honest absence, and the
 * absence is the deliverable.
 *
 * The function is written in full, including the branch that would report the
 * disable as fired, so that wiring the producer is a data change and not a
 * design change. What it deliberately does NOT do is fall back to a similar
 * number that happens to exist: `v32Copilot.SESSION_HALT_FLOOR_PCT` is a
 * session halt and `u4faRisk`'s limit is 5% daily, and neither may be
 * substituted for "2% daily drawdown disable" under this label.
 */
export function drawdownDisableReading(observation: DrawdownObservation | null): RiskLayerReading {
  if (observation === null || observation.dailyDrawdownPct === null) {
    const reason =
      observation === null
        ? "no drawdown observation has been supplied to the Risk room"
        : "the daily drawdown figure cannot be observed for this day"
    return {
      key: "drawdownDisable",
      availability: unavailable({ reason, owner: RISK_LAYER_OWNER, since: observation?.observedAt ?? 0 }),
      label: "2% daily drawdown disable",
      specValue: RISK_LAYER_SPEC.drawdownDisable,
      value: null,
      detail:
        "NOT IMPLEMENTED. The nearest existing rails are v32Copilot's -2% SESSION halt and u4faRisk's -5% daily limit; neither is this capability, and neither is displayed here as if it were."
    }
  }
  if (typeof observation.dailyDrawdownPct !== "number" || !Number.isFinite(observation.dailyDrawdownPct)) {
    throw new TypeError(`risk: dailyDrawdownPct must be a finite number, received ${observation.dailyDrawdownPct}`)
  }
  const fired = observation.dailyDrawdownPct >= 2
  return {
    key: "drawdownDisable",
    availability: {
      status: "live",
      source: observation.source,
      observedAt: observation.observedAt,
      freshnessMs: 0
    },
    label: "2% daily drawdown disable",
    specValue: RISK_LAYER_SPEC.drawdownDisable,
    value: fired ? "disable FIRED" : "disable armed",
    detail: `Daily drawdown ${observation.dailyDrawdownPct.toFixed(2)}% against the 2% rail (day ${observation.dayKey}). Session loss ${observation.sessionLossPct.toFixed(2)}% is shown for context and is NOT the rail's input.`
  }
}

export type ThreeStrikeObservation = {
  /** Strikes recorded in the current lock window. Null when the counter is unavailable. */
  strikes: number | null
  /** Epoch ms until which the key is locked, or null when not locked. */
  lockedUntil: number | null
  observedAt: number
  source: string
}

/**
 * The 3-strike 24h key lock — currently an honest absence, and the absence is
 * the deliverable.
 *
 * There is no strike counter and no key-lock store anywhere in this tree, so
 * there is nothing to read. `strikes: 0` is REJECTED rather than accepted as a
 * reading: zero strikes means "this key is unlocked and has never been struck",
 * which is a claim about a counter that does not exist. A producer wired to
 * this surface must therefore supply a real counter, and until one exists the
 * room says the capability is unavailable.
 */
export function threeStrikeReading(observation: ThreeStrikeObservation | null): RiskLayerReading {
  if (observation === null || observation.strikes === null) {
    const reason =
      observation === null
        ? "no strike observation has been supplied to the Risk room"
        : "the strike counter reported no value for this key"
    return {
      key: "threeStrike",
      availability: unavailable({ reason, owner: RISK_LAYER_OWNER, since: observation?.observedAt ?? 0 }),
      label: "3-strike key lock",
      specValue: RISK_LAYER_SPEC.threeStrike,
      value: null,
      detail:
        "NOT IMPLEMENTED. No strike counter and no 24h key-lock store exist in this tree, so the state is unknown rather than zero. Unavailable is not zero: 0 strikes would assert a counter that was never read."
    }
  }
  if (!Number.isInteger(observation.strikes) || observation.strikes < 0) {
    throw new TypeError(`risk: strikes must be a non-negative integer, received ${observation.strikes}`)
  }
  if (observation.lockedUntil !== null && !Number.isFinite(observation.lockedUntil)) {
    throw new TypeError(`risk: lockedUntil must be a finite epoch or null, received ${observation.lockedUntil}`)
  }
  const locked = observation.lockedUntil !== null && observation.lockedUntil > observation.observedAt
  return {
    key: "threeStrike",
    availability: {
      status: "live",
      source: observation.source,
      observedAt: observation.observedAt,
      freshnessMs: 0
    },
    label: "3-strike key lock",
    specValue: RISK_LAYER_SPEC.threeStrike,
    value: locked ? "key LOCKED" : `${observation.strikes} of 3 strikes`,
    detail: locked
      ? `Locked until ${new Date(observation.lockedUntil as number).toISOString()} (${observation.strikes} strikes).`
      : `${observation.strikes} strike(s) recorded; the third locks the key for 24h.`
  }
}

export type RiskLayerInput = {
  atr: AtrObservation | null
  drawdown: DrawdownObservation | null
  threeStrike: ThreeStrikeObservation | null
}

export type RiskLayerView = {
  readings: RiskLayerReading[]
  /** True only when ALL THREE capabilities carry a `live` reading. */
  complete: boolean
  /** Named owners of every capability that is not live. Empty when complete. */
  incompleteOwners: string[]
}

/**
 * The Risk room's three rows, each with its own availability.
 *
 * `complete` is deliberately `false` today — one of the three capabilities is
 * real and two are not — and the room renders that state rather than hiding
 * it. A single `available` boolean for the whole risk layer would let a live
 * ATR read as "the risk layer is live", which is the fabrication this module
 * exists to prevent.
 */
export function riskLayerView(input: RiskLayerInput): RiskLayerView {
  const readings: RiskLayerReading[] = [
    atrStopReading(input.atr),
    drawdownDisableReading(input.drawdown),
    threeStrikeReading(input.threeStrike)
  ]
  // The owner is read from two different non-live variants - `unavailable`
  // names the owning workstream and `reserved` names the workstream it is
  // held for - so the narrowing is done with a switch rather than a property
  // access. A `.filter(...)` followed by `.map(...)` does not narrow in
  // TypeScript, and writing it that way is how a `live` reading ends up
  // dereferenced for a field it does not have.
  const owners: string[] = []
  for (const r of readings) {
    if (r.availability.status === "unavailable") {
      owners.push(r.availability.owner)
    } else if (r.availability.status === "reserved") {
      owners.push(r.availability.workstream)
    }
  }
  return { readings, complete: owners.length === 0, incompleteOwners: [...new Set(owners)] }
}

/** Re-exported so a room can narrow the availability union without a deep import. */
export type { Availability }
