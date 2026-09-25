/**
 * WS-6 T4 — server-side D10 session POLICY seam.
 *
 * This is a NEW module. It is deliberately separate from `tradingSessions.mjs`,
 * which already owns session DETECTION (getCurrentSession / getSessionSchedule /
 * getSessionForAsset) and predates WS-6. WS-6 adds only the D10 *routing
 * policy* on top, and derives its bounds from the existing canonical tables so
 * there is ONE source of truth for session times.
 *
 * POLICY VERSION: ws6-session-policy/1
 *
 * D10 precedence: dead zone -> overlap -> NY afternoon -> Tokyo lull -> reserved.
 * The client counterpart is `src/terminal/domain/sessionRouting.ts`; the two
 * cannot share a module (TS client, plain Node ESM server, no build step), so
 * `server/__tests__/ws6-domain.test.ts` replays a shared versioned fixture
 * through BOTH and fails on any divergence. If D10 changes, bump the version
 * and update the fixture in the same commit.
 */

import { SESSIONS, OVERLAPS } from "./tradingSessions.mjs"

export const SESSION_POLICY_VERSION = "ws6-session-policy/1"

const londonNyOverlap = OVERLAPS.find((o) => o.name === "London-NY Overlap")
if (!londonNyOverlap) {
  // A missing canonical overlap would silently change trading hours.
  throw new Error("tradingSessions.mjs is missing the London-NY Overlap definition")
}

export const SESSION_BOUNDS_UTC = Object.freeze({
  // Absolute no-trading window. The 00:00 endpoint INCLUDES the 00:00 instant
  // (conservative resolution of D10's ambiguous "20:00-00:00").
  deadZone: Object.freeze({ startHour: 20, endHour: 24, inclusiveEnd: true }),
  // Derived from the canonical overlap table, not restated.
  overlap: Object.freeze({ startHour: londonNyOverlap.start, endHour: londonNyOverlap.end }),
  // NY afternoon = after the London-NY overlap closes, clipped by the Dead Zone.
  nyAfternoon: Object.freeze({ startHour: londonNyOverlap.end, endHour: 20 }),
  // Tokyo/Asian session, starting 30 minutes after midnight so no trading rule
  // begins on the Dead Zone boundary minute.
  tokyo: Object.freeze({ startHour: 0.5, endHour: SESSIONS.asian.close }),
  adxLullThreshold: 20
})

function decimalUtcHour(timestampMs) {
  const d = new Date(timestampMs)
  if (Number.isNaN(d.getTime())) throw new TypeError("session routing requires a valid UTC timestamp")
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

export function routeSession(timestampMs, market = {}) {
  const h = decimalUtcHour(timestampMs)

  // Dead zone is an absolute override and INCLUDES the 00:00 instant.
  if (h >= SESSION_BOUNDS_UTC.deadZone.startHour || h === 0) {
    return {
      route: "no_trade",
      matchedRule: "dead zone 20:00-00:00 UTC — no trading",
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  if (h >= SESSION_BOUNDS_UTC.overlap.startHour && h < SESSION_BOUNDS_UTC.overlap.endHour) {
    return {
      route: "trend_following",
      matchedRule: "London/NY overlap 13:00-16:00 UTC",
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  if (h >= SESSION_BOUNDS_UTC.nyAfternoon.startHour && h < SESSION_BOUNDS_UTC.nyAfternoon.endHour) {
    return {
      route: "intermediary",
      matchedRule: "NY afternoon 16:00-20:00 UTC",
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  const inTokyo = h >= SESSION_BOUNDS_UTC.tokyo.startHour && h < SESSION_BOUNDS_UTC.tokyo.endHour
  const adx = market?.adx
  const adxObserved = typeof adx === "number" && Number.isFinite(adx)
  if (inTokyo && adxObserved && adx < SESSION_BOUNDS_UTC.adxLullThreshold) {
    return {
      route: "mean_reversion",
      matchedRule: `Tokyo mid-session lull — ADX ${adx} < ${SESSION_BOUNDS_UTC.adxLullThreshold}`,
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  return {
    route: "reserved",
    matchedRule: "unlisted time/regime combination — no D10 rule matches",
    evaluatedAt: timestampMs,
    timezone: "UTC"
  }
}
