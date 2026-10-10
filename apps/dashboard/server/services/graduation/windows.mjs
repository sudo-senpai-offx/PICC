// Graduation analytics — window collector (W3-04, layer 1 of 4).
//
// WHAT THIS IS. A pure normalizer that turns three kinds of raw evidence —
// embargoed backtest walk-forward windows, paper closes, and live fills — into
// ONE comparable per-strategy window shape. Downstream (Task 2 weighting, Task
// 3 gates) reads nothing but the windows this module emits, so the honesty of
// the readout is decided HERE, once, rather than re-decided by each consumer.
//
// ADVISORY ONLY. This is a readout. It contains no permit flip, no unlock, no
// ceremony gate, no credential read, no store, no filesystem, no network, no
// `process.env`, and no import of any backtest/paper/live service module — the
// caller hands over plain arrays and the route (Task 4) does the adapting. A
// window emitted here authorizes nothing.
//
// THE HONESTY RULES, which are the reason this module exists at all:
//
//   1. ABSENCE, NEVER ZERO. A statistic that could not be measured is `null` and
//      is named in `reasons`. It is never 0. `0` means "measured, and the
//      measurement was zero"; `null` plus a reason means "not enough data to
//      know". A caller therefore distinguishes the two with
//      `Number.isFinite(w.sharpe)` — which fails closed on `null` — and never by
//      reading a zero it cannot trust. This is the same rule the rest of the
//      server already speaks: `finiteOrNull` in trading.mjs:287, `reason:` in
//      wealth/fx.mjs:54, `{ lines, skipped }` in costs/paperOverlay.mjs:56.
//
//   2. EXCLUSION, NOT DEFAULTING. A row whose `windowStart`/`windowEnd` is
//      missing, unparseable, or inverted is EXCLUDED from the output entirely
//      rather than defaulted to "now" or an epoch. A window with invented bounds
//      would sort into a chronology it never belonged to, and Task 3's
//      "12 consecutive windows" gate would then count it as real evidence.
//      Excluded rows are reported, not swallowed — see EXCLUDED below.
//
//   3. ORDER IS CHRONOLOGICAL. `collectWindows` returns windows sorted by
//      `windowStart` ascending, because "consecutive windows" is only a
//      well-defined predicate against a chronology. Task 3 depends on this.
//
// WHY `provenance` AND `source` ARE BOTH PRESENT. `source` is the routing key
// ("which evidence pile is this from", used for grouping and for the paper-room
// table's leg columns). `provenance` is the brief's named field recording where
// the numbers came from. They are equal by default and a row may override
// `provenance` when its evidence is narrower than its pile. Cost-drag
// provenance is deliberately NOT folded into this string: the W3-02
// `overlayForCloses` line already carries its own `provenance` field per line,
// and this module must not invent a compound label that no upstream module
// emits. Task 4/UI reads that off the cost lines it already holds.
//
// COST DRAG. `costDragUsd` is populated ONLY from W3-02 `overlayForCloses`
// lines, passed in on the row as `costLines`. The arithmetic is W3-02's own:
// `feeUsd + spreadUsd + slipUsd` per line, summed over the window — the same
// three legs `dragAdjustedEquity` accumulates (costs/paperOverlay.mjs:113), not
// a conversion invented here. When no cost lines are supplied the field is
// `null` with a named reason, because an absent cost leg is NOT a zero cost
// leg: "we did not measure drag" and "drag was zero" are different claims and
// only one of them may be used to argue a strategy over the floor.

// A source is one of exactly these three. Nothing else is a window.
export const SOURCES = Object.freeze(["backtest", "paper", "live"])

// Reason vocabulary. Stable strings, not free text, so a consumer (or Task 3's
// readout) can branch on them without pattern-matching English.
export const REASONS = Object.freeze({
  RETURN_UNMEASURED: "returnPct:unmeasured",
  SHARPE_UNMEASURED: "sharpe:insufficient-observations",
  MAX_DD_UNMEASURED: "maxDd:insufficient-observations",
  COST_DRAG_ABSENT: "costDragUsd:no-cost-lines"
})

const EXCLUDED = Object.freeze({
  START_MISSING: "windowStart:missing",
  START_UNPARSEABLE: "windowStart:unparseable",
  END_MISSING: "windowEnd:missing",
  END_UNPARSEABLE: "windowEnd:unparseable",
  END_BEFORE_START: "window:end-before-start"
})

/** A finite number, or null. Null/undefined is never coerced to 0. */
function finiteOrNull(value) {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse an ISO string / epoch-ms value to a UTC ISO-8601 string, or null.
 *
 * Normalizing to UTC is what makes the sort in `collectWindows` meaningful: raw
 * fixture stamps mix offsets (`...T10:00:00+08:00` and `...T00:00:00Z`), and
 * lexicographic comparison of those two strings is not chronological order.
 * Converting to a canonical instant is lossless — it is the same moment — and
 * it keeps the sort and Task 2's recency weighting honest.
 */
function parseInstant(value) {
  if (value == null) return null
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/**
 * W3-02 cost drag for one window: the sum of `feeUsd + spreadUsd + slipUsd`
 * over the supplied `overlayForCloses` lines.
 *
 * A line missing any leg contributes nothing *for that leg only* (the W3-02
 * `finiteOrZero` reading of an absent optional leg, costs/paperOverlay.mjs:43);
 * the window's `costDragUsd` is `null` — with a named reason — only when there
 * are no cost lines at all, because then no drag was measured in either
 * direction. An all-zero sum is a MEASURED zero and is reported as `0`, which
 * is the legitimate case: paper charges no explicit fee.
 */
function costDragUsdFrom(costLines) {
  if (!Array.isArray(costLines) || costLines.length === 0) return null
  let total = 0
  for (const line of costLines) {
    if (!line || typeof line !== "object") continue
    total += finiteOrNull(line.feeUsd) ?? 0
    total += finiteOrNull(line.spreadUsd) ?? 0
    total += finiteOrNull(line.slipUsd) ?? 0
  }
  return total
}

/**
 * One row of round-trip evidence (a paper close, or a live fill pair) becomes
 * one window. A single round trip is one observation, so a statistic that needs
 * a distribution (Sharpe) or an equity path (max drawdown) is ABSENT unless the
 * row measured it itself — it is never back-filled from a single point.
 */
function windowFromRoundTrip(row, source) {
  const reasons = []

  const returnPct = finiteOrNull(row?.returnPct ?? row?.pnlPct)
  if (returnPct == null) reasons.push(REASONS.RETURN_UNMEASURED)

  // A row may carry a pre-measured distribution statistic (a backtest window
  // legitimately has one). Absent that, a single round trip cannot yield it.
  const sharpe = finiteOrNull(row?.sharpe)
  if (sharpe == null) reasons.push(REASONS.SHARPE_UNMEASURED)

  const maxDd = finiteOrNull(row?.maxDd)
  if (maxDd == null) reasons.push(REASONS.MAX_DD_UNMEASURED)

  const costDragUsd = costDragUsdFrom(row?.costLines)
  if (costDragUsd == null) reasons.push(REASONS.COST_DRAG_ABSENT)

  return {
    source,
    strategyTag: row?.strategyTag ?? null,
    returnPct,
    sharpe,
    maxDd,
    costDragUsd,
    provenance: row?.provenance ?? source,
    reasons
  }
}

/** One embargoed walk-forward window is already one window; stats pass through. */
function windowFromBacktest(row) {
  return windowFromRoundTrip(row, "backtest")
}

/**
 * Parse the bounds of a candidate window, or return the reason it is excluded.
 *
 * Returns `{ ok: true, windowStart, windowEnd }` or `{ ok: false, reason }`.
 * Exclusion is a first-class outcome with a stable reason string, because a
 * dropped window that leaves no trace is indistinguishable from a window that
 * never existed.
 */
function parseBounds(row) {
  const rawStart = row?.windowStart ?? row?.entryTime
  const rawEnd = row?.windowEnd ?? row?.exitTime

  if (rawStart == null) return { ok: false, reason: EXCLUDED.START_MISSING }
  if (rawEnd == null) return { ok: false, reason: EXCLUDED.END_MISSING }

  const windowStart = parseInstant(rawStart)
  if (windowStart == null) return { ok: false, reason: EXCLUDED.START_UNPARSEABLE }
  const windowEnd = parseInstant(rawEnd)
  if (windowEnd == null) return { ok: false, reason: EXCLUDED.END_UNPARSEABLE }

  // An inverted window is malformed, not short. Normalizing it by swapping would
  // invent a chronology, so it is excluded and the reason says so.
  if (windowEnd < windowStart) return { ok: false, reason: EXCLUDED.END_BEFORE_START }

  return { ok: true, windowStart, windowEnd }
}

/** Read an input array defensively: a non-array pile is no evidence, not an error. */
function rows(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Collect every window, recording the rows that could not become windows.
 *
 * Exported alongside `collectWindows` so the reason for an absent window is
 * recoverable by a caller. `collectWindows` is this function's `.windows`.
 *
 * @param {object} [input]
 * @param {Array} [input.backtests]  embargoed walk-forward window rows
 * @param {Array} [input.paperCloses] paper close rows
 * @param {Array} [input.liveFills]  live fill rows (ephemeral source; defaults [])
 * @returns {{ windows: Array, excluded: Array<{source: string, index: number, reason: string}> }}
 */
export function collectWindowsWithReasons(input = {}) {
  const piles = [
    { source: "backtest", rows: rows(input?.backtests), build: windowFromBacktest },
    { source: "paper", rows: rows(input?.paperCloses), build: windowFromRoundTrip },
    { source: "live", rows: rows(input?.liveFills), build: windowFromRoundTrip }
  ]

  const windows = []
  const excluded = []

  for (const pile of piles) {
    pile.rows.forEach((row, index) => {
      const bounds = parseBounds(row)
      if (!bounds.ok) {
        excluded.push({ source: pile.source, index, reason: bounds.reason })
        return
      }
      windows.push({
        ...pile.build(row, pile.source),
        // Bounds are attached here, not in the builders, so that EVERY window
        // carries them and the sort below has a single key to read.
        windowStart: bounds.windowStart,
        windowEnd: bounds.windowEnd
      })
    })
  }

  // Chronological by start, then by end, then by source and tag. The last two
  // are not cosmetic: two windows can share a start instant, and a sort that
  // left them in pile order would make "consecutive" depend on which evidence
  // pile happened to be listed first.
  windows.sort(
    (a, b) =>
      a.windowStart.localeCompare(b.windowStart) ||
      a.windowEnd.localeCompare(b.windowEnd) ||
      a.source.localeCompare(b.source) ||
      String(a.strategyTag ?? "").localeCompare(String(b.strategyTag ?? ""))
  )

  return { windows, excluded }
}

/**
 * Per-strategy graduation windows, normalized and sorted chronologically.
 *
 * Advisory readout data only — a returned window moves no permit and unlocks
 * nothing. Statistics that could not be measured are `null` and named in the
 * window's `reasons`; statistics that measured zero are `0`. Rows without
 * parseable, non-inverted bounds are absent entirely rather than defaulted.
 *
 * @param {object} [input]
 * @param {Array} [input.backtests]   embargoed walk-forward window rows
 * @param {Array} [input.paperCloses] paper close rows
 * @param {Array} [input.liveFills]   live fill rows; an ephemeral source, so it defaults to []
 * @returns {Array<{source: string, strategyTag: string|null, windowStart: string, windowEnd: string,
 *   returnPct: number|null, sharpe: number|null, maxDd: number|null, costDragUsd: number|null,
 *   provenance: string, reasons: string[]}>} windows sorted by `windowStart` ascending
 */
export function collectWindows(input = {}) {
  return collectWindowsWithReasons(input).windows
}