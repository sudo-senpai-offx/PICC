// WS-7 T14 - the delivery state machine. Pure functions, no I/O, no env.
//
// The claim under test is D11's "Delivery failures are explicit, not silent"
// (spec :191) and AC-037's "the failure is explicit" (spec :1064), tested as
// four states that cannot be confused with one another. The single most
// important test here is the last describe block: it is the one that would fail
// if someone reintroduced a transport-reported success flag.

import { describe, expect, it } from "vitest"

import {
  DELIVERY_STATES,
  classifyDelivery,
  deliveredOutcome,
  describeSummary,
  failedOutcome,
  isDelivered,
  offOutcome,
  summariseDeliveries,
  unavailableOutcome
} from "../services/notifications/states.mjs"

describe("the four delivery states are distinguishable", () => {
  it("unavailable REQUIRES a reason - an unexplained absence is the state D11 forbids", () => {
    expect(() => unavailableOutcome("")).toThrow()
    expect(() => unavailableOutcome("   ")).toThrow()
    expect(() => unavailableOutcome(undefined)).toThrow()
    const o = unavailableOutcome("VAPID_PUBLIC_KEY unset")
    expect(o.state).toBe(DELIVERY_STATES.UNAVAILABLE)
    expect(o.reason).toBe("VAPID_PUBLIC_KEY unset")
    // Nothing was attempted, and that is a different fact from "tried, none arrived".
    expect(o.attempted).toBe(0)
    expect(o.acknowledged).toBe(0)
  })

  it("a configured transport that acknowledged nothing is FAILED, not unavailable", () => {
    // This is the conflation the notifier shipped with: "skipped" meant both
    // "no key" and "every send threw".
    const o = classifyDelivery({
      configured: true,
      attempted: 3,
      acknowledged: 0,
      reason: "webpush 500"
    })
    expect(o.state).toBe(DELIVERY_STATES.FAILED)
    expect(o.attempted).toBe(3)
    expect(o.acknowledged).toBe(0)
    expect(o.reason).toBe("webpush 500")
  })

  it("a configured transport with nothing to send to is UNAVAILABLE, not failed", () => {
    // Same wire result (nothing delivered), different cause. Naming the cause
    // is the difference between "we have no subscribers" and "push is broken".
    const o = classifyDelivery({ configured: true, attempted: 0, reason: "no-subscriptions" })
    expect(o.state).toBe(DELIVERY_STATES.UNAVAILABLE)
    expect(o.reason).toBe("no-subscriptions")
  })

  it("an unconfigured transport is UNAVAILABLE and never FAILED", () => {
    const o = classifyDelivery({ configured: false })
    expect(o.state).toBe(DELIVERY_STATES.UNAVAILABLE)
    expect(o.reason).toBe("transport-not-configured")
  })

  it("a user-disabled transport is OFF, and is distinguishable from all three", () => {
    const off = classifyDelivery({ configured: true, userEnabled: false, attempted: 2, acknowledged: 2 })
    expect(off.state).toBe(DELIVERY_STATES.OFF)
    expect(off.reason).toBeNull()
    // Off is checked BEFORE configured, so a disabled-and-unconfigured transport
    // is honestly "off" - the operator's choice outranks the missing key.
    expect(classifyDelivery({ configured: false, userEnabled: false }).state).toBe(DELIVERY_STATES.OFF)
  })

  it("a failed outcome without a reported error is still NAMED, never blank", () => {
    const o = failedOutcome({ attempted: 1 })
    expect(o.reason).toBe("send-failed-without-a-reported-error")
  })

  it("every constructed outcome is frozen and carries the full shape", () => {
    for (const o of [
      offOutcome(),
      unavailableOutcome("x"),
      failedOutcome({ reason: "y" }),
      deliveredOutcome({ attempted: 1, acknowledged: 1 })
    ]) {
      expect(Object.isFrozen(o)).toBe(true)
      expect(Object.keys(o).sort()).toEqual(["acknowledged", "attempted", "reason", "state"])
    }
  })

  it("the vocabulary is CLOSED - every constructor lands inside it and none takes a state", () => {
    const allowed = new Set(Object.values(DELIVERY_STATES))
    for (const o of [
      offOutcome(),
      unavailableOutcome("x"),
      failedOutcome({ reason: "y" }),
      deliveredOutcome({ attempted: 1, acknowledged: 1 })
    ]) {
      expect(allowed.has(o.state), `${o.state} must be one of the four`).toBe(true)
    }
    expect(allowed.size).toBe(4)
    expect(Object.isFrozen(DELIVERY_STATES)).toBe(true)
    // The structural half of "closed": no constructor accepts a caller-chosen
    // state, so the set cannot be widened from the outside.
    expect(Object.keys(deliveredOutcome({ attempted: 1, acknowledged: 1 })).sort()).toEqual([
      "acknowledged",
      "attempted",
      "reason",
      "state"
    ])
  })
})

describe("delivered is the only state that may license a claim", () => {
  it("isDelivered requires BOTH the state and a positive acknowledgement", () => {
    expect(isDelivered(deliveredOutcome({ attempted: 1, acknowledged: 1 }))).toBe(true)
    expect(isDelivered(failedOutcome({ reason: "x", attempted: 1, acknowledged: 0 }))).toBe(false)
    expect(isDelivered(unavailableOutcome("x"))).toBe(false)
    expect(isDelivered(offOutcome())).toBe(false)
    // A hand-rolled object claiming the state with zero acknowledgements is
    // refused, so a forged shape cannot buy a delivery claim.
    expect(isDelivered({ state: "delivered", acknowledged: 0, reason: null, attempted: 9 })).toBe(false)
  })

  it("summarise separates the four buckets and derives deliveredAny from acknowledgements", () => {
    const s = summariseDeliveries({
      telegram: deliveredOutcome({ attempted: 1, acknowledged: 1 }),
      webpush: failedOutcome({ reason: "webpush 500", attempted: 2, acknowledged: 0 }),
      webhook: unavailableOutcome("WEBHOOK_URL unset")
    })
    expect(s.readoutObtained).toBe(true)
    expect(s.delivered).toEqual([{ transport: "telegram", acknowledged: 1 }])
    expect(s.failed).toEqual([{ transport: "webpush", reason: "webpush 500", attempted: 2 }])
    expect(s.unavailable).toEqual([{ transport: "webhook", reason: "WEBHOOK_URL unset" }])
    expect(s.off).toEqual([])
    expect(s.deliveredAny).toBe(true)
    expect(Object.isFrozen(s)).toBe(true)
  })

  it("a summary with no delivery reports deliveredAny false, and it is falsy BY DERIVATION", () => {
    const s = summariseDeliveries({
      telegram: failedOutcome({ reason: "telegram 401", attempted: 1 }),
      webpush: unavailableOutcome("VAPID_PUBLIC_KEY unset")
    })
    expect(s.deliveredAny).toBe(false)
    expect(s.delivered).toEqual([])
  })

  it("readoutObtained is SEPARATE from the buckets - 'ran and found nothing' is not 'could not be reached'", () => {
    const ran = summariseDeliveries({}, { readoutObtained: true })
    const notReached = summariseDeliveries({}, { readoutObtained: false })
    expect(ran.readoutObtained).toBe(true)
    expect(notReached.readoutObtained).toBe(false)
    // Both have identical empty buckets, and describeSummary still distinguishes
    // them - which is the T10 discipline applied to a dispatcher.
    expect(describeSummary(ran)).not.toBe(describeSummary(notReached))
    expect(describeSummary(notReached)).toMatch(/could not reach/i)
  })

  it("rows that are not outcomes are ignored rather than crashing the summary", () => {
    const s = summariseDeliveries({
      telegram: deliveredOutcome({ attempted: 1, acknowledged: 1 }),
      bogus: null,
      weirder: { state: "not-a-state" }
    })
    expect(s.delivered.map((d) => d.transport)).toEqual(["telegram"])
    expect(s.deliveredAny).toBe(true)
  })
})

describe("NEVER FABRICATE A DELIVERY", () => {
  it("classifyDelivery accepts NO success flag, so a transport cannot assert one", () => {
    // A transport that "reports success" can only do so by claiming
    // acknowledgements. Hand it every plausible lie and it still cannot reach
    // `delivered` without a positive count.
    const lying = classifyDelivery({
      configured: true,
      attempted: 1,
      acknowledged: 0,
      success: true,
      ok: true,
      sent: true,
      delivered: true,
      claimed: "success"
    })
    expect(lying.state).toBe(DELIVERY_STATES.FAILED)
    expect(lying.state).not.toBe(DELIVERY_STATES.DELIVERED)
    expect(isDelivered(lying)).toBe(false)
  })

  it("a transport that acknowledged nothing makes the whole dispatch un-delivered", () => {
    // This is the room-level consequence: with no acknowledgement anywhere, the
    // one boolean the UI is allowed to consult is false.
    const results = {
      telegram: classifyDelivery({ configured: true, attempted: 1, acknowledged: 0, reason: "telegram 401" }),
      webpush: classifyDelivery({ configured: true, attempted: 4, acknowledged: 0, reason: "webpush 500" })
    }
    const s = summariseDeliveries(results)
    expect(s.deliveredAny).toBe(false)
    expect(describeSummary(s)).toMatch(/^Not delivered\./)
    expect(describeSummary(s)).toMatch(/telegram: telegram 401/)
    expect(describeSummary(s)).toMatch(/webpush: webpush 500/)
  })

  it("describeSummary never renders a bare success, and names the reason in every non-delivery branch", () => {
    const delivered = describeSummary(
      summariseDeliveries({ telegram: deliveredOutcome({ attempted: 1, acknowledged: 1 }) })
    )
    expect(delivered).toMatch(/^Delivered on telegram \(1 acknowledged\)\.$/)

    // One of two delivered is still a partial delivery, and says so.
    const partial = describeSummary(
      summariseDeliveries({
        telegram: deliveredOutcome({ attempted: 1, acknowledged: 1 }),
        webpush: failedOutcome({ reason: "webpush 500", attempted: 2 })
      })
    )
    expect(partial).toMatch(/^Delivered on telegram/)
    expect(partial).toMatch(/\(1 acknowledged\)/)

    const noneConfigured = describeSummary(
      summariseDeliveries({
        telegram: unavailableOutcome("TELEGRAM_BOT_TOKEN unset"),
        webpush: unavailableOutcome("VAPID_PUBLIC_KEY unset")
      })
    )
    expect(noneConfigured).toMatch(/no transport was configured/)

    const allOff = describeSummary(summariseDeliveries({ telegram: offOutcome(), webpush: offOutcome() }))
    expect(allOff).toMatch(/turned off/)

    // Zero transports at all is its own sentence, not a blank.
    expect(describeSummary(summariseDeliveries({}))).toMatch(/no transports/)
  })

  it("a PARTIAL delivery still reports the transports that missed it", () => {
    // The regression this pins: an early return on the success branch reported
    // a broken transport as a clean delivery whenever anything ELSE had
    // succeeded - and the in-app bell succeeds on essentially every dispatch,
    // so in practice the failure was reported almost never. AC-037 (spec
    // :1064) requires "the reachable transport delivers AND the failure is
    // explicit" in the same breath, so both must appear in one sentence.
    const partial = describeSummary(
      summariseDeliveries({
        inApp: deliveredOutcome({ attempted: 1, acknowledged: 1 }),
        webpush: failedOutcome({ reason: "web-push 500", attempted: 3, acknowledged: 0 })
      })
    )
    expect(partial).toMatch(/^Delivered on inApp/)
    expect(partial).toMatch(/Not delivered on: webpush: web-push 500\.$/)

    // A success with nothing missed says nothing extra, so the sentence stays
    // short rather than ending in an empty clause.
    const clean = describeSummary(
      summariseDeliveries({ inApp: deliveredOutcome({ attempted: 1, acknowledged: 1 }) })
    )
    expect(clean).not.toMatch(/Not delivered on/)

    // And an off transport is named on a successful dispatch too, so turning
    // push off is visible without reading the toggle's own row.
    const withOff = describeSummary(
      summariseDeliveries({
        inApp: deliveredOutcome({ attempted: 1, acknowledged: 1 }),
        telegram: offOutcome()
      })
    )
    expect(withOff).toMatch(/telegram: turned off by the operator/)
  })
})
