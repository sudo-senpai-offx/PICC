// WS-7 T14 - the delivery-state CONTRACT across the server/client boundary.
//
// This file exists to be a SECOND CONTRACT HOME for the four delivery states,
// which is the defect it prevents. The states are owned by
// `server/services/notifications/states.mjs`; the client's label-and-tone map
// lives in `src/lib/notificationDelivery.ts`. A hand-written copy of that list on
// each side is precisely what `ws7SeamGuard.test.mjs`'s Risk 9 check forbids for
// `ConfluenceScore`.
//
// The check is EQUALITY in both directions, not containment:
//   * a state the server can emit with no client presentation fails, so a new
//     state cannot ship unrendered; and
//   * a client presentation for a state the server cannot emit fails, so the map
//     cannot accumulate entries for states that do not exist.
//
// It is `.mjs` because that is where this repo puts a test that reaches across
// the boundary in both directions - `crossRoomInvariantGate.test.mjs` and
// `ws7SeamGuard.test.mjs` both import client `.ts` modules from here, and a
// `.ts` test cannot import a `.mjs` module without a declaration shim. The
// companion `src/lib/__tests__/notificationDelivery.test.ts` covers the
// presentation's own behaviour from literal fixtures.

import { describe, expect, it } from "vitest"

import {
  DELIVERY_STATES,
  deliveredOutcome,
  describeSummary,
  failedOutcome,
  summariseDeliveries,
  unavailableOutcome
} from "../services/notifications/states.mjs"
import { DELIVERY_PRESENTATION, describeDelivery } from "../../src/lib/notificationDelivery"

describe("the client and the server agree on the delivery-state vocabulary", () => {
  it("the client's presentation map EQUALS the server's state set", () => {
    const server = new Set(Object.values(DELIVERY_STATES))
    const client = new Set(Object.keys(DELIVERY_PRESENTATION))
    expect(
      [...client].filter((s) => !server.has(s)),
      "a client presentation for a state the server cannot emit"
    ).toEqual([])
    expect(
      [...server].filter((s) => !client.has(s)),
      "a server state with no client presentation - it would ship unrendered"
    ).toEqual([])
    expect(client.size).toBe(4)
  })

  it("the client's tone vocabulary is the Badge component's, not an invented one", () => {
    // `Badge` in components/ui.tsx:93-102 accepts exactly these five. A sixth
    // would render as an unstyled span, which is a silent visual regression.
    const allowed = new Set(["accent", "success", "warn", "danger", "muted"])
    for (const [state, p] of Object.entries(DELIVERY_PRESENTATION)) {
      expect(allowed.has(p.tone), `${state} -> ${p.tone}`).toBe(true)
    }
  })
})

describe("the client and the server never disagree about whether a message arrived", () => {
  // The server is the ONLY authority on delivery, so the client's sentence is
  // checked against the server's for the same input. They are two renderings of
  // one fact; if they ever diverge, the room is showing a claim the dispatcher
  // did not make.
  const cases = [
    {
      name: "one transport acknowledged",
      results: { telegram: deliveredOutcome({ attempted: 1, acknowledged: 1 }) }
    },
    {
      name: "two transports acknowledged, one failed",
      results: {
        inApp: deliveredOutcome({ attempted: 1, acknowledged: 1 }),
        webpush: deliveredOutcome({ attempted: 2, acknowledged: 2 }),
        telegram: failedOutcome({ reason: "telegram 401", attempted: 1, acknowledged: 0 })
      }
    },
    {
      name: "nothing acknowledged, one failed one unavailable",
      results: {
        webpush: failedOutcome({ reason: "web-push 500", attempted: 3, acknowledged: 0 }),
        telegram: unavailableOutcome("TELEGRAM_BOT_TOKEN unset")
      }
    },
    {
      name: "nothing at all",
      results: {}
    }
  ]

  for (const { name, results } of cases) {
    it(`agrees exactly: ${name}`, () => {
      const serverSummary = summariseDeliveries(results)
      expect(describeDelivery(serverSummary)).toBe(describeSummary(serverSummary))
    })
  }

  it("a readout that was not obtained is refused on BOTH sides", () => {
    const absent = summariseDeliveries({}, { readoutObtained: false })
    expect(absent.readoutObtained).toBe(false)
    expect(describeSummary(absent)).toMatch(/could not reach/i)
    expect(describeDelivery(absent)).toBe(describeSummary(absent))
    expect(describeDelivery(null)).toBe(describeSummary(absent))
  })
})
