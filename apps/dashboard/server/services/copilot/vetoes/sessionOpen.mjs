// WS-7 T11 — veto 6 of 6: SESSION OPEN.
// §4.4:691 — "(6) Session Open (first 15 min of London/NY)"
//
// Fires during the first 15 minutes of the London or New York session — the
// window where the session's real price is still being discovered and a stop
// placed on the opening noise is a stop placed on noise.
//
// THE HOURS ARE READ, NOT RESTATED. London 07:00 and New York 13:00 UTC come
// from `SESSIONS.london.open` / `SESSIONS.newyork.open`
// (`tradingSessions.mjs:14-31`), the repo's single canonical table, which
// `tradingSessionPolicy.mjs:8` already names as "ONE source of truth for session
// times". This module adds no third copy of the hours — the same reason
// `regime.mjs` reads `SESSION_BOUNDS_UTC` rather than defining its own.
//
// The boundary is INCLUSIVE of the opening minute and EXCLUSIVE of minute 15:
// at exactly 07:00 the window has lasted zero minutes and the veto is on; at
// exactly 07:15 it has lasted the full 15 and the veto is off. Both edges are
// asserted in the test, because an open-ended `<=` here would suppress an extra
// minute of every session, every day, silently.

import { buildOutcome, clearOutcome, unevaluatedOutcome } from "./outcome.mjs"
import { SESSIONS } from "../../tradingSessions.mjs"

export const RULE_ID = "sessionOpen"
export const RULE_VERSION = "copilot-veto-sessionOpen/1.0.0"
export const SUPPRESSED = "entry"

/** §4.4:691 — "first 15 min". */
export const OPEN_WINDOW_MINUTES = 15

/** The two sessions §4.4:691 names. Hours read from the canonical table. */
export const GUARDED_SESSIONS = Object.freeze([
  Object.freeze({ id: "london", openHour: SESSIONS.london.open }),
  Object.freeze({ id: "newyork", openHour: SESSIONS.newyork.open })
])

export function evaluate(state) {
  const evaluatedAt = state.computedAt
  if (typeof evaluatedAt !== "number" || !Number.isFinite(evaluatedAt)) {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt: 0,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["computedAt (session windows are measured against it)"]
    })
  }

  const date = new Date(evaluatedAt)
  if (Number.isNaN(date.getTime())) {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt: 0,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["a parseable computedAt"]
    })
  }

  const minutesSinceMidnight = date.getUTCHours() * 60 + date.getUTCMinutes()

  // Deterministic order: GUARDED_SESSIONS is frozen and in the declared order,
  // and the London/NY overlap cannot contain both windows anyway.
  for (const session of GUARDED_SESSIONS) {
    const openMinute = session.openHour * 60
    const elapsed = minutesSinceMidnight - openMinute
    if (elapsed < 0 || elapsed >= OPEN_WINDOW_MINUTES) continue

    return buildOutcome({
      ruleId: RULE_ID,
      fired: true,
      inputs: {
        session: session.id,
        openHourUtc: session.openHour,
        minutesSinceOpen: elapsed,
        windowMinutes: OPEN_WINDOW_MINUTES
      },
      suppressed: SUPPRESSED,
      evaluatedAt,
      ruleVersion: RULE_VERSION
    })
  }

  return clearOutcome({
    ruleId: RULE_ID,
    inputs: {
      minutesSinceMidnightUtc: minutesSinceMidnight,
      windowMinutes: OPEN_WINDOW_MINUTES,
      guardedSessions: GUARDED_SESSIONS.map((s) => s.id).join(","),
      inWindow: false
    },
    suppressed: SUPPRESSED,
    evaluatedAt,
    ruleVersion: RULE_VERSION
  })
}
