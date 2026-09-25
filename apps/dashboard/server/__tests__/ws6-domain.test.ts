// WS-6 T4 — server/client policy parity fixture (AC-010).
//
// The client policy is TypeScript; the server is Node ESM with no build step, so
// the two cannot import one module. That duplication is only safe if it is
// GUARDED. This test is the guard: it replays one shared fixture through both
// implementations and requires identical output, and it pins the policy version
// on both sides.
//
// If D10 changes, bump SESSION_POLICY_VERSION and update this fixture in the
// same commit. Editing one side alone fails here.
import { describe, expect, it } from "vitest"
import { routeSession as clientRoute, SESSION_BOUNDS_UTC as CLIENT_BOUNDS } from "../../src/terminal/domain/sessionRouting"
import { routeSession as serverRoute, SESSION_POLICY_VERSION, SESSION_BOUNDS_UTC as SERVER_BOUNDS } from "../services/tradingSessionPolicy.mjs"
import { SESSIONS, OVERLAPS } from "../services/tradingSessions.mjs"

const at = (hour, minute = 0) => Date.UTC(2026, 0, 5, hour, minute)

/** Versioned fixture: every D10 branch, both sides of each boundary. */
const FIXTURE = [
  { name: "dead zone 20:00", ts: at(20), adx: 10 },
  { name: "dead zone 20:30 beats NY afternoon", ts: at(20, 30), adx: 10 },
  { name: "dead zone 23:59", ts: at(23, 59), adx: 10 },
  { name: "dead zone includes the 00:00 instant", ts: at(0), adx: 10 },
  { name: "overlap 13:00", ts: at(13), adx: 5 },
  { name: "overlap 15:59", ts: at(15, 59), adx: 50 },
  { name: "NY afternoon 16:00", ts: at(16), adx: 10 },
  { name: "NY afternoon 19:59", ts: at(19, 59), adx: 10 },
  { name: "Tokyo lull 02:00 ADX 19.9", ts: at(2), adx: 19.9 },
  { name: "Tokyo 08:59 ADX 5", ts: at(8, 59), adx: 5 },
  { name: "Tokyo strong trend is unlisted", ts: at(4), adx: 35 },
  { name: "Tokyo with unobserved ADX is unlisted", ts: at(4), adx: null },
  { name: "London-only 10:00 is unlisted", ts: at(10), adx: 10 },
  { name: "London-only 12:59 is unlisted", ts: at(12, 59), adx: 10 }
]

describe("WS-6 T4 — server/client session-policy parity (AC-010)", () => {
  it("pins a policy version on the server side", () => {
    expect(SESSION_POLICY_VERSION).toBe("ws6-session-policy/1")
  })

  it("agrees on every branch and boundary in the versioned fixture", () => {
    const divergences = []
    for (const row of FIXTURE) {
      const client = clientRoute(row.ts, { adx: row.adx })
      const server = serverRoute(row.ts, { adx: row.adx })
      if (client.route !== server.route || client.matchedRule !== server.matchedRule) {
        divergences.push({ name: row.name, client, server })
      }
    }
    expect(divergences, "client and server session policy diverged").toEqual([])
  })

  it("agrees on the declared session bounds", () => {
    expect(SERVER_BOUNDS.overlap).toEqual(CLIENT_BOUNDS.overlap)
    expect(SERVER_BOUNDS.nyAfternoon).toEqual(CLIENT_BOUNDS.nyAfternoon)
    expect(SERVER_BOUNDS.tokyo).toEqual(CLIENT_BOUNDS.tokyo)
    expect(SERVER_BOUNDS.deadZone).toEqual(CLIENT_BOUNDS.deadZone)
    expect(SERVER_BOUNDS.adxLullThreshold).toBe(CLIENT_BOUNDS.adxLullThreshold)
  })

  it("never lets the server route the Dead Zone to a directional session", () => {
    for (const hour of [20, 21, 22, 23]) {
      for (const adx of [0, 19.9, 20, 50]) {
        expect(serverRoute(at(hour), { adx }).route, `${hour}:00 must be no_trade`).toBe("no_trade")
      }
    }
  })

  it("derives the overlap from the canonical session tables, not a restated copy", () => {
    // The D10 policy must not invent trading hours: they come from the
    // pre-existing canonical tables in tradingSessions.mjs.
    const overlap = OVERLAPS.find((o) => o.name === "London-NY Overlap")
    expect(SERVER_BOUNDS.overlap.startHour).toBe(overlap.start)
    expect(SERVER_BOUNDS.overlap.endHour).toBe(overlap.end)
    expect(SERVER_BOUNDS.tokyo.endHour).toBe(SESSIONS.asian.close)
  })

  it("agrees with the client on the canonical overlap bounds", () => {
    const overlap = OVERLAPS.find((o) => o.name === "London-NY Overlap")
    expect(CLIENT_BOUNDS.overlap.startHour).toBe(overlap.start)
    expect(CLIENT_BOUNDS.overlap.endHour).toBe(overlap.end)
  })
})
