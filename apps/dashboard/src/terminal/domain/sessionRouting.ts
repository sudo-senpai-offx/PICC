import type { SessionRoute, SessionRouteName } from "../contracts"

/**
 * WS-6 T4 — deterministic session routing (AC-010, D10).
 *
 * D10 is normative: London/NY overlap -> trend following; Tokyo + mid-session
 * lull (ADX < 20) -> mean reversion; NY afternoon -> intermediary; Dead Zone
 * 20:00-00:00 GMT -> NO TRADING. An unlisted combination is `reserved`.
 *
 * PRECEDENCE (the locked part):
 *   1. Dead Zone          -> no_trade          (absolute override)
 *   2. London/NY overlap  -> trend_following   (unconditional; ignores ADX)
 *   3. NY afternoon       -> intermediary
 *   4. Tokyo + ADX < 20   -> mean_reversion    (requires an OBSERVED ADX)
 *   5. anything else      -> reserved
 *
 * The Dead Zone is checked first because it overlaps NY afternoon at
 * 20:00-21:00; an absolute no-trading window must not be overridden by a
 * directional session rule.
 *
 * SESSION BOUNDS: D10 fixes the Dead Zone numerically (20:00-00:00 GMT) and
 * names the other sessions qualitatively, but does not give them hour
 * boundaries. The bounds below are THIS implementation's explicit reading in
 * UTC, exported so the owner can audit or correct them without reading the
 * control flow. An unobserved ADX is never treated as a lull.
 *
 * Pure and deterministic: the same timestamp and market state always yield the
 * same route, and no animation, remote explanation, or convenience input can
 * influence it.
 */

export const SESSION_BOUNDS_UTC = {
  /**
   * Absolute no-trading window. The 00:00 endpoint INCLUDES the 00:00 instant
   * (conservative resolution of D10's ambiguous "20:00-00:00"); see the
   * precedence note in routeSession.
   */
  deadZone: { startHour: 20, endHour: 24, inclusiveEnd: true },
  /** London/NY overlap — trend following, unconditional. */
  overlap: { startHour: 13, endHour: 16 },
  /** NY afternoon — intermediary. Clipped by the Dead Zone. */
  nyAfternoon: { startHour: 16, endHour: 20 },
  /** Tokyo session. A mean-reversion lull requires an observed ADX < 20. */
  tokyo: { startHour: 0.5, endHour: 9 },
  /** ADX at or above this is NOT a lull. */
  adxLullThreshold: 20
} as const

function utcHours(timestampMs: number): { hour: number; minute: number } {
  const d = new Date(timestampMs)
  if (Number.isNaN(d.getTime())) throw new TypeError("session routing requires a valid UTC timestamp")
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

function inWindow(hour: number, start: number, end: number): boolean {
  return hour >= start && hour < end
}

export function routeSession(timestampMs: number, market: { adx?: number | null } = {}): SessionRoute {
  const { hour, minute } = utcHours(timestampMs)
  const decimalHour = hour + minute / 60

  // 1. Dead Zone — absolute override, evaluated before any directional rule.
  //
  //    BOUNDARY RESOLUTION: D10 writes the window as "20:00-00:00", which is
  //    ambiguous about the endpoint. This implementation resolves it
  //    CONSERVATIVELY: the 00:00 instant itself is still dead, so a one-second
  //    clock edge can never silently permit trading at the exact stop. Tokyo's
  //    lull window deliberately starts at 00:30 rather than 00:00 so no trading
  //    rule begins on the boundary minute.
  if (decimalHour >= SESSION_BOUNDS_UTC.deadZone.startHour || decimalHour === 0) {
    return {
      route: "no_trade",
      matchedRule: "dead zone 20:00-00:00 UTC — no trading",
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  // 2. London/NY overlap — unconditional; ADX is irrelevant here.
  if (inWindow(decimalHour, SESSION_BOUNDS_UTC.overlap.startHour, SESSION_BOUNDS_UTC.overlap.endHour)) {
    return {
      route: "trend_following",
      matchedRule: "London/NY overlap 13:00-16:00 UTC",
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  // 3. NY afternoon — intermediary (already clipped by the Dead Zone above).
  if (inWindow(decimalHour, SESSION_BOUNDS_UTC.nyAfternoon.startHour, SESSION_BOUNDS_UTC.nyAfternoon.endHour)) {
    return {
      route: "intermediary",
      matchedRule: "NY afternoon 16:00-20:00 UTC",
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  // 4. Tokyo + an OBSERVED mid-session lull. An unobserved ADX is not a lull.
  const inTokyo = decimalHour >= SESSION_BOUNDS_UTC.tokyo.startHour && decimalHour < SESSION_BOUNDS_UTC.tokyo.endHour
  const adx = market.adx
  const adxObserved = typeof adx === "number" && Number.isFinite(adx)
  if (inTokyo && adxObserved && adx < SESSION_BOUNDS_UTC.adxLullThreshold) {
    return {
      route: "mean_reversion",
      matchedRule: `Tokyo mid-session lull — ADX ${adx} < ${SESSION_BOUNDS_UTC.adxLullThreshold}`,
      evaluatedAt: timestampMs,
      timezone: "UTC"
    }
  }

  // 5. Anything unlisted is reserved, not defaulted to a direction.
  return {
    route: "reserved" as SessionRouteName,
    matchedRule: "unlisted time/regime combination — no D10 rule matches",
    evaluatedAt: timestampMs,
    timezone: "UTC"
  }
}
