// Failed-attempt counter — seam instrumentation for the fee-intelligence
// scorecard (spec decision 9: count at ordering-seam refuse points only).
//
// What this is: an in-memory day-keyed counter. `countAttempt` is called with
// ONE line per existing refusal return in ccxtOrdering.mjs (requireKeys /
// sandbox-unsupported / mode blocks) and hyperliquidPerps.mjs submit paths.
// It never changes a message, shape, or gate — the refusal return it sits
// before is untouched.
//
// Outcomes: "refused" = the seam's own gate denied the attempt (missing keys,
// rail-off, limit-only, cap); "failed" = the venue could not be observed or
// the call failed (unobservable lookups, setup-failed, submit failed). The
// aggregator (Task 5) shows these as waste lines, never merged into costs.
//
// Day key uses the same rule as the costs store rollups: PICC_SNAPSHOT_TZ,
// default Asia/Singapore. Memory-only on purpose: attempts are a daily waste
// signal, not a retained record (fills keep 90d, rollups 2yrs — store.mjs).
// The `reason` is carried for the caller's honesty, not stored; only the
// outcome count is kept.

const OUTCOMES = new Set(["refused", "failed"])

// tzDate ("YYYY-MM-DD") -> venue -> { refused, failed }
const counters = new Map()

function snapshotTz() {
  return process.env.PICC_SNAPSHOT_TZ || "Asia/Singapore"
}

function tzDateFor(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: snapshotTz() }).format(new Date(at))
}

export function countAttempt({ venue, outcome, reason, at = null } = {}) {
  const name = String(venue ?? "").trim().toLowerCase()
  if (!name) return { ok: false, reason: "attempt-venue-required" }
  if (!OUTCOMES.has(outcome)) return { ok: false, reason: `invalid-outcome:${String(outcome ?? "")}` }
  // Never-throw guarantee: this sits before refusal returns on the live-money
  // rails, so a counter failure must degrade to an uncounted refusal, never
  // convert a refusal return into a throw (e.g. a garbage PICC_SNAPSHOT_TZ
  // makes Intl throw — the seam refusal below it still returns honestly).
  let tzDate
  try {
    tzDate = tzDateFor(at ?? Date.now())
  } catch {
    return { ok: false, reason: "attempt-count-failed" }
  }
  let day = counters.get(tzDate)
  if (!day) {
    day = new Map()
    counters.set(tzDate, day)
  }
  let entry = day.get(name)
  if (!entry) {
    entry = { refused: 0, failed: 0 }
    day.set(name, entry)
  }
  entry[outcome] += 1
  return { ok: true, venue: name, outcome, tzDate }
}

export function attemptCounts({ date } = {}) {
  const tzDate = date === undefined || date === null || date === "" ? tzDateFor(Date.now()) : tzDateFor(date)
  const day = counters.get(tzDate)
  if (!day) return {}
  const out = {}
  for (const [venue, entry] of day) out[venue] = { refused: entry.refused, failed: entry.failed }
  return out
}

export function _resetAttemptsForTest() {
  counters.clear()
}
