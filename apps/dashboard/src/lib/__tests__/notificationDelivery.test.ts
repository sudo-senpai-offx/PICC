// WS-7 T14 - the client's presentation of a delivery state.
//
// The states themselves are owned by the SERVER
// (`server/services/notifications/states.mjs`). The check that the client's
// presentation map cannot drift from that list is NOT here, because a `.ts`
// test cannot import a `.mjs` module without a declaration shim: it lives in
// `server/__tests__/notifications.deliveryContract.test.mjs`, which imports
// BOTH sides and is the repo's established pattern for a cross-boundary check
// (as `crossRoomInvariantGate.test.mjs` does for the room facts).
//
// What is here is the presentation's own behaviour, driven by LITERAL fixtures,
// so a client test never has to reach across the boundary to make a claim.

import { describe, expect, it } from "vitest"

import {
  DELIVERY_PRESENTATION,
  describeDelivery,
  deliveryPresentation,
  deliveryRows,
  type DeliverySummary
} from "../notificationDelivery"

const summary = (over: Partial<DeliverySummary> = {}): DeliverySummary => ({
  readoutObtained: true,
  delivered: [],
  unavailable: [],
  failed: [],
  off: [],
  deliveredAny: false,
  ...over
})

describe("every state resolves to a label and a tone", () => {
  it("covers the four states the server can emit, and nothing else", () => {
    // The exhaustive half. `notifications.deliveryContract.test.mjs` proves this
    // list still EQUALS the server's; this half fails if an entry loses its
    // label or tone, which the cross-check would not catch on its own.
    expect(Object.keys(DELIVERY_PRESENTATION).sort()).toEqual(["delivered", "failed", "off", "unavailable"])
    for (const state of Object.keys(DELIVERY_PRESENTATION)) {
      const p = deliveryPresentation(state)
      expect(typeof p.label, state).toBe("string")
      expect(p.label.length, state).toBeGreaterThan(0)
      expect(["accent", "success", "warn", "danger", "muted"], state).toContain(p.tone)
    }
  })

  it("only `delivered` is a success and only `failed` is a danger", () => {
    // A muted badge on an unconfigured transport and a danger badge on a real
    // failure is the distinction that stops an operator dismissing the badge
    // that matters.
    expect(deliveryPresentation("delivered").tone).toBe("success")
    expect(deliveryPresentation("failed").tone).toBe("danger")
    expect(deliveryPresentation("unavailable").tone).toBe("muted")
    expect(deliveryPresentation("off").tone).toBe("muted")
  })

  it("an unrecognised state is rendered as an explicit unknown, never as a success", () => {
    const p = deliveryPresentation("some-future-state")
    expect(p.tone).toBe("danger")
    expect(p.label).toMatch(/unrecognised/)
    expect(p.label).not.toBe("delivered")
  })
})

describe("the client may only claim a delivery the server reported", () => {
  it("states a delivered outcome with its acknowledgement count", () => {
    const said = describeDelivery(summary({ deliveredAny: true, delivered: [{ transport: "telegram", acknowledged: 1 }] }))
    expect(said).toMatch(/^Delivered on telegram \(1 acknowledged\)\.$/)
  })

  it("never says delivered when nothing was acknowledged", () => {
    const said = describeDelivery(
      summary({
        failed: [{ transport: "webpush", reason: "web-push 500", attempted: 2 }],
        unavailable: [{ transport: "telegram", reason: "TELEGRAM_BOT_TOKEN unset" }]
      })
    )
    expect(said).toMatch(/^Not delivered\./)
    expect(said).not.toMatch(/Delivered on/)
    expect(said).toMatch(/webpush: web-push 500/)
    expect(said).toMatch(/telegram: TELEGRAM_BOT_TOKEN unset/)
  })

  it("reports the MISSES on a partial delivery - the in-app bell must not hide them", () => {
    const said = describeDelivery(
      summary({
        deliveredAny: true,
        delivered: [{ transport: "inApp", acknowledged: 1 }],
        failed: [{ transport: "telegram", reason: "telegram 401", attempted: 1 }]
      })
    )
    expect(said).toMatch(/Delivered on inApp/)
    expect(said).toMatch(/Not delivered on: telegram: telegram 401\./)
  })

  it("a readout that was not obtained is its own sentence", () => {
    for (const absent of [null, undefined, summary({ readoutObtained: false })]) {
      expect(describeDelivery(absent)).toMatch(/could not reach/i)
    }
  })

  it("an empty-but-obtained readout says the dispatcher reported nothing", () => {
    expect(describeDelivery(summary())).toMatch(/no transports/)
  })

  it("an all-off readout names the off transports", () => {
    const said = describeDelivery(summary({ off: ["telegram", "webpush"] }))
    expect(said).toMatch(/every notification transport is turned off/)
    expect(said).toMatch(/telegram: turned off by the operator/)
  })
})

describe("the per-transport table renders every transport with its own reason", () => {
  it("one row per transport, sorted, reason present only where the server gave one", () => {
    const rows = deliveryRows({
      webpush: { state: "failed", reason: "web-push 500", attempted: 1, acknowledged: 0 },
      inApp: { state: "delivered", reason: null, attempted: 1, acknowledged: 1 },
      telegram: { state: "unavailable", reason: "TELEGRAM_CHAT_ID unset", attempted: 0, acknowledged: 0 },
      webhook: { state: "off", reason: null, attempted: 0, acknowledged: 0 }
    })
    expect(rows.map((r) => r.transport)).toEqual(["inApp", "telegram", "webhook", "webpush"])
    expect(rows.map((r) => r.label)).toEqual(["delivered", "unavailable", "off", "failed"])
    expect(rows.find((r) => r.transport === "inApp")?.reason).toBeNull()
    expect(rows.find((r) => r.transport === "webpush")?.reason).toBe("web-push 500")
    expect(rows.find((r) => r.transport === "telegram")?.reason).toBe("TELEGRAM_CHAT_ID unset")
  })

  it("a missing or malformed record yields a usable table, not a crash", () => {
    expect(deliveryRows(null)).toEqual([])
    expect(deliveryRows(undefined)).toEqual([])
    // A row the server did not shape is shown as unknown, not silently dropped.
    const rows = deliveryRows({ weird: { state: "nope" } as never })
    expect(rows[0].label).toMatch(/unrecognised/)
  })
})
