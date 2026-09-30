// WS-7 T11 — the risk layer PRODUCER.
//
// §4.4:695 — "**Risk layer:** ATR(14) stop at 1.5x · 2% daily drawdown disable ·
//             3-strike rule locks keys for 24h."
//
// T11's scope at spec :1292 ends with "and the risk layer", and
// `src/terminal/routes/RiskRoom.tsx:100` names this task as the owner of the
// two capabilities that do not exist yet:
//   pendingScope: "WS-7 T11 - the risk layer (2% daily drawdown disable,
//                 3-strike 24h key lock)"
//
// This module is the PRODUCER. `src/terminal/domain/riskLayer.ts` is the
// RENDER side and is untouched by T11 (BS-2 must not touch room visuals, spec
// :1397) — it currently reports both capabilities as honest absences, and it
// will keep doing so until a caller feeds it observations produced HERE. That
// is recorded as a named BS-3 handoff in changelog entry 0022.
//
// ---------------------------------------------------------------------------
// THE NEAR-MISS THIS MODULE REFUSES
// ---------------------------------------------------------------------------
//
// `riskLayer.ts:141-150` names two figures that look like the 2% daily
// drawdown disable and are not it:
//
//   - `v32Copilot.SESSION_HALT_FLOOR_PCT` (-2%) is a **SESSION** halt, not a
//     daily one. `riskLayer.ts:134-137` says the disable must be evaluated
//     against the daily figure, and `:183` says the session number is "shown for
//     context and is NOT the rail's input".
//   - `u4faRisk`'s -5% is a daily limit, but at 5%, not 2%.
//
// So this module imports NEITHER. It does not import `v32Copilot.mjs`, and it
// defines its own 2 from the spec text. Wiring a session halt under a "daily
// drawdown disable" label is the fabrication `riskLayer.ts:165` refuses to
// display — and `DAILY_DRAWDOWN_DISABLE_PCT` is asserted to be neither 5 nor a
// session figure in the tests.
//
// PURE. No clock, no network, no filesystem. Times are supplied.

import { atr as atrOf } from "../indicators.mjs"

/** §4.4:695 — "ATR(14) stop at 1.5x". */
export const ATR_STOP_MULTIPLE = 1.5

/** §4.4:695 — "2% daily drawdown disable". A DAILY figure, per riskLayer.ts:132-138. */
export const DAILY_DRAWDOWN_DISABLE_PCT = 2

/** §4.4:695 — "3-strike rule locks keys for 24h". */
export const THREE_STRIKE_LIMIT = 3

/** §4.4:695 — the lock duration, in ms. */
export const KEY_LOCK_MS = 24 * 60 * 60 * 1000

export const RISK_LAYER_VERSION = "copilot-risk-layer/1.0.0"

// ---------------------------------------------------------------------------
// ATR(14) stop
// ---------------------------------------------------------------------------

/**
 * The ATR(14) stop distance at 1.5x.
 *
 * @param {Array<number>} highs
 * @param {Array<number>} lows
 * @param {Array<number>} closes
 * @param {number} [period]
 * @returns {{stopDistance: number|null, atr: number|null, multiple: number,
 *            available: boolean, unavailableReason: string|null}}
 */
export function atrStop(highs, lows, closes, period = 14) {
  const series = atrOf(highs, lows, closes, period)
  const value = lastFinite(series)
  if (value === null || value <= 0) {
    return {
      stopDistance: null,
      atr: null,
      multiple: ATR_STOP_MULTIPLE,
      available: false,
      unavailableReason: `ATR(${period}) has not warmed up, so no stop distance can be computed`
    }
  }
  return {
    stopDistance: value * ATR_STOP_MULTIPLE,
    atr: value,
    multiple: ATR_STOP_MULTIPLE,
    available: true,
    unavailableReason: null
  }
}

// ---------------------------------------------------------------------------
// 2% DAILY drawdown disable
// ---------------------------------------------------------------------------

/**
 * The 2% daily drawdown disable.
 *
 * @param {object} observation
 * @param {number} [observation.dailyDrawdownPct] The DAILY figure. This is the
 *   only figure the rail reads — `riskLayer.ts:132-138` requires it and forbids
 *   the session number's substitution.
 * @param {number} [observation.sessionLossPct] Carried for display only, and
 *   explicitly NOT the input (`riskLayer.ts:183`).
 * @param {string} [observation.dayKey] The UTC day the daily figure is for.
 * @param {number} observation.observedAt
 * @param {string} observation.source
 * @returns {object} A reading. `fired` is null when it cannot be evaluated.
 */
export function dailyDrawdownDisable(observation) {
  if (observation === null || typeof observation !== "object") {
    return {
      key: "drawdownDisable",
      fired: null,
      available: false,
      dailyDrawdownPct: null,
      sessionLossPct: null,
      railPct: DAILY_DRAWDOWN_DISABLE_PCT,
      unavailableReason: "no drawdown observation has been supplied to the risk layer",
      riskLayerVersion: RISK_LAYER_VERSION
    }
  }

  const daily = observation.dailyDrawdownPct
  const sessionLossPct = finiteOrNull(observation.sessionLossPct)

  if (daily === undefined || daily === null) {
    // The failure this design exists to prevent. A caller with ONLY a session
    // number must be told the rail cannot be evaluated — not quietly handed the
    // session figure and a "disable fired" verdict computed from it.
    return {
      key: "drawdownDisable",
      fired: null,
      available: false,
      dailyDrawdownPct: null,
      sessionLossPct,
      railPct: DAILY_DRAWDOWN_DISABLE_PCT,
      unavailableReason:
        "the DAILY drawdown figure cannot be observed, and the session figure must not be substituted for it " +
        "(riskLayer.ts:132-138) — a session halt is not a daily rail",
      riskLayerVersion: RISK_LAYER_VERSION
    }
  }

  if (typeof daily !== "number" || !Number.isFinite(daily)) {
    throw new TypeError(`copilot: dailyDrawdownPct must be a finite number; received ${String(daily)}`)
  }

  return {
    key: "drawdownDisable",
    fired: daily >= DAILY_DRAWDOWN_DISABLE_PCT,
    available: true,
    dailyDrawdownPct: daily,
    // Carried so a caller can SHOW the context without it ever being the input.
    sessionLossPct,
    railPct: DAILY_DRAWDOWN_DISABLE_PCT,
    dayKey: String(observation.dayKey ?? "unknown"),
    source: String(observation.source ?? "unnamed"),
    observedAt: observation.observedAt,
    unavailableReason: null,
    riskLayerVersion: RISK_LAYER_VERSION
  }
}

// ---------------------------------------------------------------------------
// The 3-strike, 24h key lock
// ---------------------------------------------------------------------------

/**
 * A REAL strike counter and key-lock store.
 *
 * `riskLayer.ts:197-206` states that in the tree as T11 received it, "there is
 * no strike counter and no key-lock store anywhere in this tree", and that
 * `strikes: 0` must be REJECTED because "zero strikes means 'this key is
 * unlocked and has never been struck', which is a claim about a counter that
 * does not exist".
 *
 * This store is that counter. It exists, it counts, and it locks. `readStrike`
 * on a key that this store has never seen returns the honest zero BECAUSE THE
 * STORE EXISTS and knows it — the case `riskLayer.ts:207` had no way to
 * distinguish. A store that does not exist still reports `null`, and
 * `strikeStateUnavailable()` is the reading for that state.
 *
 * APPEND-ONLY in the same sense as `vetoIndex.mjs`: no update, no delete, no
 * reset. A strike that happened happened; being able to erase it would make
 * the lock advisory. There is no `reset` method on purpose.
 *
 * @param {object} [options]
 * @param {(record: object) => void} [options.sink] Called once per strike, for
 *   T15's persistence layer. A throwing sink propagates.
 */
export function createStrikeStore({ sink = null, store = [] } = {}) {
  if (sink !== null && typeof sink !== "function") {
    throw new TypeError(`copilot: strikeStore sink must be a function or null; received ${typeof sink}`)
  }

  /** key → array of strike epoch-ms values, appended in order. */
  const strikes = new Map()
  let sequence = 0
  for (const entry of store) {
    if (typeof entry?.key === "string" && Number.isFinite(Number(entry.at))) {
      if (!strikes.has(entry.key)) strikes.set(entry.key, [])
      strikes.get(entry.key).push(Number(entry.at))
    }
  }

  return Object.freeze({
    /**
     * Record one strike against a key. The ONLY mutator.
     *
     * @param {string} key The API key / credential identifier.
     * @param {number} at Epoch ms of the strike. Supplied, never read from a clock.
     */
    recordStrike(key, at) {
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError(`copilot: a strike must name a key; received ${String(key)}`)
      }
      if (typeof at !== "number" || !Number.isFinite(at)) {
        throw new TypeError(`copilot: a strike needs a supplied finite timestamp; received ${String(at)}`)
      }
      sequence += 1
      if (!strikes.has(key)) strikes.set(key, [])
      strikes.get(key).push(at)
      const entry = Object.freeze({ sequence, key, at, retentionClass: "permanent_append_only" })
      if (sink !== null) sink(entry)
      return entry
    },

    /**
     * Read a key's real state.
     *
     * @param {string} key
     * @param {number} nowMs The instant to measure the remaining lock against.
     *   Supplied, so the reading is deterministic (AC-021).
     * @returns {{key: string, strikes: number, lockedUntil: number|null,
     *            locked: boolean, available: boolean, lockMs: number,
     *            limit: number, unavailableReason: string|null}}
     */
    readStrike(key, nowMs) {
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError(`copilot: readStrike requires a key; received ${String(key)}`)
      }
      if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
        throw new TypeError(`copilot: readStrike requires a supplied finite nowMs; received ${String(nowMs)}`)
      }
      const list = strikes.get(key) ?? []
      const count = list.length
      const reached = count >= THREE_STRIKE_LIMIT

      // The lock runs 24h from the MOST RECENT strike once the limit is
      // reached — not from the first. A third strike at hour 23 must lock for a
      // further 24h, or the limit silently shortens as strikes accumulate.
      const lockedUntil = reached ? list[list.length - 1] + KEY_LOCK_MS : null

      return {
        key,
        // A REAL count, because this counter exists. `null` is reserved for
        // `strikeStateUnavailable()` below.
        strikes: count,
        lockedUntil,
        locked: lockedUntil !== null && nowMs < lockedUntil,
        available: true,
        lockMs: KEY_LOCK_MS,
        limit: THREE_STRIKE_LIMIT,
        unavailableReason: null
      }
    },

    /** The raw strike timestamps for a key, oldest first. Read-only. */
    strikeTimes(key) {
      return [...(strikes.get(key) ?? [])]
    },

    /** Every key this store has seen a strike against, sorted. */
    keys() {
      return [...strikes.keys()].sort()
    }
  })
}

/**
 * The reading for a system where NO counter has been wired.
 *
 * This is what `riskLayer.ts:207-215` needs and what T11 could not give it
 * before this store existed. It reports `strikes: null` — never 0 — because 0
 * would be a claim about a counter that does not exist.
 */
export function strikeStateUnavailable(key, reason = "no strike counter has been wired for this key") {
  return {
    key: String(key ?? "unknown"),
    strikes: null,
    lockedUntil: null,
    locked: false,
    available: false,
    lockMs: KEY_LOCK_MS,
    limit: THREE_STRIKE_LIMIT,
    unavailableReason: reason
  }
}

function lastFinite(series) {
  if (!Array.isArray(series)) return null
  for (let i = series.length - 1; i >= 0; i--) {
    if (typeof series[i] === "number" && Number.isFinite(series[i])) return series[i]
  }
  return null
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
