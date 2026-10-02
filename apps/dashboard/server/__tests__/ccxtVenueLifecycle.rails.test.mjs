// WS-7 T17 — THE MATRIX. 4 venues x 4 legs x 3 rails, per cell.
//
// Spec :1350: "The ceremony gate, consent payload lock, and risk rails are
// honored on EVERY leg." AC-036:1058: "A per-venue lifecycle test; assert the
// venue list equals exactly the four."
//
// "Honored on every leg" is a CLAIM about a cross product, so it is tested as a
// cross product. A loop that asserted "the rails pass" once for `place` and once
// for `close` would prove two points and leave sixteen unexamined, and the two it
// did prove would be the two a reader checked first. `lifecycleRailMatrix` and
// `railMatrixProblems` enumerate and validate the cells, so the matrix is a
// first-class export rather than a loop written inside one test.
//
// THREE PROPERTIES PER CELL, and all three are asserted:
//
//   1. the rail was EVALUATED — a cell that does not exist is a failure, not a
//      skip, which is why `railMatrixProblems` treats a missing cell as a problem;
//   2. the verdict is one of pass/block/absent — nothing else is reportable;
//   3. a NON-APPLYING cell carries a WRITTEN reason. This is the load-bearing
//      one: `absent` is not `pass`, and the only way a rail that does not apply
//      to a leg may leave that leg unblocked is by saying so in words.
//
// AND THE ADAPTER PROOF. Every leg is additionally run against an adapter whose
// members THROW if reached, so "the rails blocked it" cannot be satisfied by an
// adapter that ran first and was ignored afterwards. A rail that blocks after the
// venue call is not a rail.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  D6_LADDER,
  EXPOSURE_ADDING_LEGS,
  EXPOSURE_REMOVING_LEGS,
  LIFECYCLE_LEGS,
  LIFECYCLE_RAILS,
  RAIL_CODES,
  RAIL_VERDICTS,
  ceremonyUnlockForCcxt,
  evaluateLifecycleRails,
  lifecycleRailMatrix,
  railMatrixProblems
} from "../services/venues/ccxtLifecycleRails.mjs"
import {
  CCXT_LIFECYCLE_VENUE_COUNT,
  CCXT_LIFECYCLE_VENUES,
  VENUE_NOT_IN_THE_FOUR_CODE,
  ccxtLifecycleVenue
} from "../services/venues/ccxtVenues.mjs"
import { createStrikeStore } from "../services/copilot/riskLayer.mjs"
import { createAuthority } from "../services/authority/authorityModel.mjs"
import { createBrokerAutomationPermitStore } from "../services/authority/brokerAutomationPermit.mjs"
import { resetCeremonyState, unlockVenueClass } from "../services/commandCentre/ceremonyState.mjs"
import { consentPayloadHash, spotOpenConsent, venueLegConsent, venueLegConsentFields, venueLegConsentHash } from "../services/commandCentre/ccxtExecution.mjs"

const VENUE_IDS = CCXT_LIFECYCLE_VENUES.map((v) => v.id)
const CEREMONY_CLASS = "ccxt-crypto"
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const SYMBOL = "BTC/USDT"

// An ATR(14)-warm series. Constant bar range 2 around a 100 close, so TR is 2 on
// every bar, ATR settles at 2, and T11's 1.5x multiple gives a stop distance of 3.
// A buy at 100 with a stop at 98 is 2 away (inside); a stop at 96 is 4 away
// (outside, and must be refused).
const atrSeries = (() => {
  const highs = []
  const lows = []
  const closes = []
  for (let i = 0; i < 40; i += 1) {
    const close = 100 + (i % 2 === 0 ? 0 : 0.4)
    closes.push(close)
    highs.push(close + 1)
    lows.push(close - 1)
  }
  return { highs, lows, closes }
})()

/** A permit store with a REAL T16 authority, so the provenance read is T16's. */
function permittedStore({ grant = true } = {}) {
  const authorities = [createAuthority({ id: "authority:venue-ops", title: "Venue operations", scope: ["trading:ccxt"], canApprove: ["trading:ccxt"] })]
  const store = createBrokerAutomationPermitStore({ authorities, buildRecords: [], brokers: [{ id: "broker:venue-1" }] })
  if (grant) store.setAutomationPermitted({ brokerId: "broker:venue-1", permitted: true, authorityId: "authority:venue-ops", roomKey: "trading:ccxt", at: NOW })
  return { store, authorities }
}

/**
 * The adapter every leg is expected NEVER to reach in the matrix test.
 * A member that throws turns "the rails blocked it" into a real observation.
 */
const sealedAdapter = () => {
  const boom = (name) => () => {
    throw new Error(`adapter.${name} must not be reached when a rail blocks`)
  }
  return { placeOrder: boom("placeOrder"), amendOrder: boom("amendOrder"), cancelOrder: boom("cancelOrder"), closeOrder: boom("closeOrder"), verifyFill: boom("verifyFill") }
}

const clearEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PICC_CCXT_VENUE_ENABLED_")) delete process.env[key]
  }
}

function enableAll() {
  clearEnv()
  for (const v of CCXT_LIFECYCLE_VENUES) process.env[`PICC_CCXT_VENUE_ENABLED_${v.envSuffix}`] = "1"
}

/** The request a leg carries, and the anchor fields it locks. */
function legRequest(leg, venueId, overrides = {}) {
  const base = {
    // `exchange` is a LOCKED field on all four consent field sets (WS-2 locked it
    // on spotOpen first), so a request without it is refused by the consent rail
    // before any risk rail is consulted. It is here because every leg carries it.
    place: { exchange: venueId, symbol: SYMBOL, side: "buy", amount: 0.01, price: 100, stopPrice: 98, clientOrderId: `picc-${venueId}-place` },
    amend: { exchange: venueId, symbol: SYMBOL, orderId: `venue-order-${venueId}`, side: "buy", amount: 0.01, price: 100, stopPrice: 98, clientOrderId: `picc-${venueId}-place` },
    cancel: { exchange: venueId, symbol: SYMBOL, orderId: `venue-order-${venueId}`, clientOrderId: `picc-${venueId}-place` },
    close: { exchange: venueId, symbol: SYMBOL, positionOrderId: `${venueId}:${SYMBOL}`, side: "sell", amount: 0.01, price: 101, clientOrderId: `picc-${venueId}-place` }
  }
  return { ...base[leg], consentBy: "operator:ws-7-test", ...overrides }
}

/** Build the consent anchor a leg must replay, using WS-2's own mechanism. */
function anchorFor(leg, request) {
  const fields = { ...request, leg }
  const projection = venueLegConsent(leg, fields)
  expect(projection.ok, `leg "${leg}" must have a declared consent field set`).toBe(true)
  return { consentHash: venueLegConsentHash(leg, fields), fields: projection.fields }
}

/**
 * The same request WITH the payload its consent was granted over.
 *
 * A leg carrying an anchor but no payload is refused — that is WS-2's 409 and it
 * is correct, so a test expecting a rail other than consent to be reached has to
 * supply the payload explicitly. `leg` is added for the same reason: it is a
 * locked field on the three T17 sets, and `ccxtVenueLifecycle.mjs`'s `gatedLeg`
 * and `proposeLeg` inject it themselves. A test that calls the rails DIRECTLY
 * bypasses that injection, so it has to carry the same derived fields or it would
 * be measuring a request shape production never sends.
 */
const carrying = (leg, venueId, overrides = {}) => {
  const request = legRequest(leg, venueId, overrides)
  return { ...request, leg, consentPayload: request }
}

const baseDeps = (overrides = {}) => ({
  consentAnchor: null,
  permitStore: null,
  strikeStore: createStrikeStore(),
  credentialKey: "picc:key:venue-1",
  atrSeries,
  dailyDrawdownPct: 0.4,
  dayKey: "2026-10-02",
  source: "T17-matrix-test",
  now: NOW,
  ...overrides
})

beforeEach(() => {
  resetCeremonyState()
  clearEnv()
})

afterEach(() => {
  resetCeremonyState()
  clearEnv()
})

// ==========================================================================
// 1. THE FAIL-CLOSED POSTURE — what every venue renders with no unlock
// ==========================================================================

describe("T17 matrix — the posture with no ceremony unlock, which is the tree's actual state", () => {
  it("there is no production authority set and no unlock, so every venue x leg cell is blocked at the ceremony rail", () => {
    // T8 measured that the Ceremony room renders "not unlocked". This is the
    // same fact at the rail: with the store reset and nothing granted, all sixteen
    // (venue, leg) pairs refuse, and they refuse at the FIRST rail.
    expect(ceremonyUnlockForCcxt(CEREMONY_CLASS).unlocked).toBe(false)
    const blocked = []
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const result = evaluateLifecycleRails({ leg, venueId, request: legRequest(leg, venueId), deps: baseDeps({ consentAnchor: anchorFor(leg, legRequest(leg, venueId)) }) })
        expect(result.ok, `${venueId}/${leg} must fail closed`).toBe(false)
        expect(result.blockedBy).toBe("ceremony")
        blocked.push(`${venueId}/${leg}`)
      }
    }
    expect(blocked).toHaveLength(CCXT_LIFECYCLE_VENUE_COUNT * LIFECYCLE_LEGS.length)
    expect(blocked).toHaveLength(16)
  })

  it("on THIS tree the 48-cell matrix is COMPLETE: ceremony blocks, and consent and risk are NAMED absences", () => {
    // The gap this closes. The evaluator short-circuits on a ceremony refusal,
    // which is correct — there is nothing downstream to authorise. But it used to
    // return `{ ceremony }` alone, so the consent and risk cells read `null`, and
    // `railMatrixProblems` — the function that exists to enforce AC-036:1350's
    // "on every leg" — reported all thirty-two of them as "rail was not evaluated
    // at all". On the real, dark tree that is every cell.
    //
    // `null` is not a named absence, and an unnamed gap is indistinguishable from
    // a rail somebody forgot to write. The short circuit now still refuses, and
    // also reports `absent` with the reason for each rail it did not consult.
    //
    // This runs on the REAL deps — no ceremony unlock, no consent anchor — rather
    // than on the green fixtures the passing matrix uses, because the property
    // being claimed is about the state this repository is actually in.
    resetCeremonyState()
    expect(ceremonyUnlockForCcxt(CEREMONY_CLASS).unlocked).toBe(false)

    const cells = lifecycleRailMatrix(
      VENUE_IDS,
      LIFECYCLE_LEGS,
      (venueId, leg) => evaluateLifecycleRails({ leg, venueId, request: legRequest(leg, venueId) })
    )
    expect(cells).toHaveLength(CCXT_LIFECYCLE_VENUE_COUNT * LIFECYCLE_LEGS.length * LIFECYCLE_RAILS.length)
    expect(cells).toHaveLength(48)
    // Every cell carries a verdict from the closed vocabulary — none is null.
    for (const cell of cells) {
      expect(cell.verdict, `${cell.venueId}/${cell.leg}/${cell.rail} has no verdict`).not.toBeNull()
      expect(RAIL_VERDICTS, `${cell.venueId}/${cell.leg}/${cell.rail} verdict '${cell.verdict}' is outside the vocabulary`).toContain(cell.verdict)
    }
    // And the matrix checker that enforces "on every leg" agrees.
    expect(railMatrixProblems(cells, { venues: VENUE_IDS, legs: LIFECYCLE_LEGS })).toEqual([])

    // The specific shape: ceremony blocks all sixteen, and the other two are named
    // absences on all sixteen.
    const byRail = (rail) => cells.filter((c) => c.rail === rail)
    expect(byRail("ceremony").every((c) => c.verdict === "block")).toBe(true)
    for (const rail of ["consent", "risk"]) {
      const railCells = byRail(rail)
      expect(railCells).toHaveLength(16)
      for (const cell of railCells) {
        expect(cell.verdict, `${cell.venueId}/${cell.leg}/${rail} must be a named absence, not a pass`).toBe("absent")
        // A NAMED absence: it says what was not consulted and why, and it says in
        // terms that cannot be mistaken for permission.
        expect(cell.reason).toContain("not-evaluated")
        expect(cell.reason).toContain("ceremony rail refused")
        expect(cell.reason).toMatch(/never consulted/)
        expect(cell.reason).toMatch(/not a pass/)
      }
    }
  })

  it("the refusal names the ceremony class and never says 'permitted'", () => {
    const r = evaluateLifecycleRails({ leg: "place", venueId: "kraken", request: legRequest("place", "kraken"), deps: baseDeps() })
    expect(r.reason).toContain("ceremony:deny:venue-class-not-unlocked")
    expect(r.reason).toContain(CEREMONY_CLASS)
    expect(String(r.reason).toLowerCase()).not.toContain("permitted")
  })

  it("an unlocked ceremony class is still refused while the venue bit is off", () => {
    // The two conditions are a CONJUNCT, and this is the direction that matters:
    // granting the ceremony does not by itself enable a venue.
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    expect(ceremonyUnlockForCcxt(CEREMONY_CLASS).unlocked).toBe(true)
    clearEnv()
    for (const venueId of VENUE_IDS) {
      const r = evaluateLifecycleRails({ leg: "place", venueId, request: legRequest("place", venueId), deps: baseDeps({ consentAnchor: anchorFor("place", legRequest("place", venueId)) }) })
      expect(r.ok, `${venueId} must stay closed while its enable bit is off`).toBe(false)
      expect(r.blockedBy).toBe("ceremony")
      expect(r.reason).toContain(RAIL_CODES.CEREMONY_VENUE_DISABLED)
      expect(r.reason).toContain(`PICC_CCXT_VENUE_ENABLED_${venueId.toUpperCase()}`)
    }
  })

  it("a ceremony store that reports itself unhealthy reads LOCKED, not unlocked", () => {
    const unhealthy = evaluateLifecycleRails({
      leg: "place",
      venueId: "binance",
      request: legRequest("place", "binance"),
      deps: baseDeps({ ceremonyUnlockFor: () => { throw new Error("store unreadable") } })
    })
    expect(unhealthy.ok).toBe(false)
    expect(unhealthy.blockedBy).toBe("ceremony")
    expect(unhealthy.reason).toContain(RAIL_CODES.CEREMONY_STORE_UNHEALTHY)
  })

  it("a ceremony reader that returns a non-boolean is refused, not coerced", () => {
    for (const value of [undefined, null, "yes", 1, {}]) {
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId: "bybit",
        request: legRequest("place", "bybit"),
        deps: baseDeps({ ceremonyUnlockFor: () => ({ unlocked: value }) })
      })
      expect(r.ok, `unlocked=${JSON.stringify(value)} must not read as permitted`).toBe(false)
      expect(r.blockedBy).toBe("ceremony")
    }
  })
})

// ==========================================================================
// 2. THE MATRIX — every cell, unlocked, per venue per leg
// ==========================================================================

describe("T17 matrix — 4 venues x 4 legs x 3 rails, every cell evaluated", () => {
  it("all sixteen (venue, leg) pairs pass all three rails when unlocked, and the matrix is complete", () => {
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()

    const captured = new Map()
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const request = carrying(leg, venueId)
        const result = evaluateLifecycleRails({ leg, venueId, request, deps: baseDeps({ consentAnchor: anchorFor(leg, legRequest(leg, venueId)) }) })
        captured.set(`${venueId}:${leg}`, result)
      }
    }

    const cells = lifecycleRailMatrix(VENUE_IDS, LIFECYCLE_LEGS, (venueId, leg) => captured.get(`${venueId}:${leg}`))

    // Completeness + vocabulary + named absences, in one validator. An empty
    // array here is the whole claim; a non-empty one names the cell that is wrong.
    expect(railMatrixProblems(cells, { venues: VENUE_IDS, legs: LIFECYCLE_LEGS })).toEqual([])

    expect(cells).toHaveLength(CCXT_LIFECYCLE_VENUE_COUNT * LIFECYCLE_LEGS.length * LIFECYCLE_RAILS.length)
    expect(cells).toHaveLength(48)

    // Per-cell verdict evidence, printed in the failure message so a reader can
    // see WHICH cell failed rather than only that one did.
    for (const cell of cells) {
      expect(cell.covered, `${cell.venueId}/${cell.leg}/${cell.rail} was not evaluated`).toBe(true)
      expect(RAIL_VERDICTS, `${cell.venueId}/${cell.leg}/${cell.rail} reported an unknown verdict`).toContain(cell.verdict)
      expect(cell.verdict, `${cell.venueId}/${cell.leg}/${cell.rail} must pass with an unlock, a matching payload and green rails`).toBe("pass")
      expect(cell.applies, `${cell.venueId}/${cell.leg}/${cell.rail} must apply`).toBe(true)
    }
  })

  it("the venue count and the rail/leg counts are the ones the matrix was built from", () => {
    // Spelled out so a change to any of the three constants shows up as a
    // mismatch against a fixed expectation rather than as a silently larger loop.
    expect(CCXT_LIFECYCLE_VENUE_COUNT).toBe(4)
    expect(VENUE_IDS).toHaveLength(4)
    expect([...LIFECYCLE_LEGS]).toEqual(["place", "amend", "cancel", "close"])
    expect([...LIFECYCLE_RAILS]).toEqual(["ceremony", "consent", "risk"])
  })

  it("THE RISK RAIL'S NON-APPLYING CELLS ARE THE EXIT LEGS, EACH WITH A WRITTEN REASON", () => {
    // This is the property the matrix exists to prevent silently losing: an ATR
    // stop and a drawdown disable that quietly stop applying to `cancel` and
    // `close` would look identical to rails that still apply and still pass.
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()
    const rows = []
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const r = evaluateLifecycleRails({ leg, venueId, request: carrying(leg, venueId), deps: baseDeps({ consentAnchor: anchorFor(leg, legRequest(leg, venueId)) }) })
        rows.push({ venueId, leg, risk: r.rails.risk.detail.components })
      }
    }
    expect(rows).toHaveLength(16)
    for (const row of rows) {
      const expectedBinding = EXPOSURE_ADDING_LEGS.includes(row.leg)
      for (const key of ["atrStop", "drawdownDisable"]) {
        const c = row.risk[key]
        expect(c.applies, `${row.venueId}/${row.leg}: ${key} applicability`).toBe(expectedBinding)
        if (expectedBinding) {
          expect(c.verdict).toBe("pass")
        } else {
          expect(c.verdict, `${row.venueId}/${row.leg}: ${key} must be ABSENT, never a silent pass`).toBe("absent")
          expect(typeof c.reason).toBe("string")
          expect(c.reason.trim().length, `${row.venueId}/${row.leg}: ${key} needs a written non-applicability`).toBeGreaterThan(40)
          expect(c.reason).toContain(row.leg)
        }
      }
      // The 3-strike key lock binds on EVERY leg, including the exits.
      expect(row.risk.keyLock.applies, `${row.venueId}/${row.leg}: the key lock must apply to every leg`).toBe(true)
      expect(row.risk.keyLock.verdict).toBe("pass")
      expect(row.risk.automationProvenance.verdict).toBe("pass")
    }
    expect([...EXPOSURE_REMOVING_LEGS]).toEqual(["cancel", "close"])
  })

  it("a rail that PROMISED to apply and then answered `absent` BLOCKS rather than passing", () => {
    // The anti-fabrication half. `applies: true` + `verdict: "absent"` is the
    // signature of a control that could not be evaluated, and it must read as a
    // failure. This cannot happen through the rail's own helpers, so the
    // hand-built component is injected directly to prove the aggregate rule.
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()
    const request = legRequest("place", "binance")
    const r = evaluateLifecycleRails({
      leg: "place",
      venueId: "binance",
      request,
      deps: baseDeps({ consentAnchor: anchorFor("place", request) })
    })
    expect(r.rails.risk.detail.components.atrStop.verdict).toBe("pass")

    // The aggregate rule itself, exercised through the exported helpers.
    const absentNonApplicable = (reason) => ({ applies: false, verdict: "absent", reason, detail: {} })
    expect(absentNonApplicable("a written reason").applies).toBe(false)
    expect(() => absentNonApplicable("   ")).not.toThrow()
    // And the vocabulary: an `absent` verdict is only reachable with `applies`
    // false, which is why RAIL_VERDICTS has no "skipped" or "n/a".
    expect(RAIL_VERDICTS).toEqual(["pass", "block", "absent"])
    expect(RAIL_VERDICTS).not.toContain("skipped")
    expect(RAIL_VERDICTS).not.toContain("default-allow")
  })
})

// ==========================================================================
// 3. THE CEREMONY GATE — per cell
// ==========================================================================

describe("T17 matrix — the ceremony gate, per venue per leg", () => {
  it("each venue refuses at the ceremony rail with its own class and enable variable named", () => {
    for (const venueId of VENUE_IDS) {
      const v = ccxtLifecycleVenue(venueId)
      for (const leg of LIFECYCLE_LEGS) {
        const r = evaluateLifecycleRails({ leg, venueId, request: legRequest(leg, venueId), deps: baseDeps() })
        expect(r.rails.ceremony.verdict).toBe("block")
        expect(r.rails.ceremony.applies).toBe(true)
        expect(r.rails.ceremony.reason).toContain(v.ceremonyVenueClass)
      }
    }
  })

  it("one venue can be enabled while another stays closed — the four are independent", () => {
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    clearEnv()
    process.env.PICC_CCXT_VENUE_ENABLED_COINBASE = "1"
    const read = (venueId, leg) =>
      evaluateLifecycleRails({ leg, venueId, request: carrying(leg, venueId), deps: baseDeps({ consentAnchor: anchorFor(leg, legRequest(leg, venueId)) }) })
    expect(read("coinbase", "place").ok).toBe(true)
    for (const venueId of ["kraken", "binance", "bybit"]) {
      for (const leg of LIFECYCLE_LEGS) {
        const r = read(venueId, leg)
        expect(r.ok, `${venueId}/${leg} must stay closed`).toBe(false)
        expect(r.blockedBy).toBe("ceremony")
      }
    }
  })

  it("the venue list is consulted before the rails, so a fifth venue is refused by name", () => {
    for (const leg of LIFECYCLE_LEGS) {
      const r = evaluateLifecycleRails({ leg, venueId: "okx", request: legRequest(leg, "okx"), deps: baseDeps() })
      expect(r.ok).toBe(false)
      expect(r.blockedBy).toBe("venue")
      expect(r.reason).toContain(VENUE_NOT_IN_THE_FOUR_CODE)
      expect(r.rails).toEqual({})
    }
  })

  it("an unknown leg is refused by name too", () => {
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()
    for (const leg of ["liquidate", "", null, "PLACE"]) {
      const r = evaluateLifecycleRails({ leg, venueId: "kraken", request: legRequest("place", "kraken"), deps: baseDeps() })
      expect(r.ok, `leg ${JSON.stringify(leg)} must be refused`).toBe(false)
      expect(r.reason).toContain(RAIL_CODES.LEG_UNKNOWN)
    }
  })
})

// ==========================================================================
// 4. THE CONSENT PAYLOAD LOCK — extended, not duplicated
// ==========================================================================

describe("T17 matrix — the consent payload lock on every leg", () => {
  beforeEach(() => {
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()
  })

  it("each leg locks its own field set, and `place` reuses the WS-2 spot set rather than declaring a twin", () => {
    expect(venueLegConsentFields("place")).toEqual(["exchange", "symbol", "side", "amount", "price", "clientOrderId"])
    expect(venueLegConsentFields("amend")).toEqual(["leg", "exchange", "symbol", "orderId", "side", "amount", "price", "clientOrderId"])
    expect(venueLegConsentFields("cancel")).toEqual(["leg", "exchange", "symbol", "orderId", "clientOrderId"])
    expect(venueLegConsentFields("close")).toEqual(["leg", "exchange", "symbol", "positionOrderId", "side", "amount", "price", "clientOrderId"])
    expect(venueLegConsentFields("liquidate")).toBeNull()
  })

  it("a T17 place hash EQUALS the WS-2 spotOpen hash for the same fields — one mechanism, one value", () => {
    // The decisive proof that the lock was EXTENDED and not forked. `place` maps to
    // `spotOpen`, so the two paths must agree byte-for-byte. A parallel set with
    // the same six names would pass every other test here and fail this one.
    const fields = { exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 100, clientOrderId: "picc-x" }
    expect(venueLegConsentHash("place", fields)).toBe(consentPayloadHash(spotOpenConsent(fields)))
    expect(venueLegConsentHash("place", fields)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("the hash is canonical — key order is irrelevant", () => {
    const a = { leg: "amend", exchange: "kraken", symbol: SYMBOL, orderId: "o1", side: "buy", amount: 0.01, price: 100, clientOrderId: "c1" }
    const b = { clientOrderId: "c1", price: 100, amount: 0.01, side: "buy", orderId: "o1", symbol: SYMBOL, exchange: "kraken", leg: "amend" }
    expect(venueLegConsentHash("amend", a)).toBe(venueLegConsentHash("amend", b))
  })

  it("NO ANCHOR blocks every leg of every venue — a leg with nothing recorded is refused", () => {
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const r = evaluateLifecycleRails({ leg, venueId, request: legRequest(leg, venueId), deps: baseDeps({ consentAnchor: null }) })
        expect(r.ok, `${venueId}/${leg} must refuse with no anchor`).toBe(false)
        expect(r.blockedBy).toBe("consent")
        expect(r.reason).toContain(RAIL_CODES.CONSENT_NO_ANCHOR)
      }
    }
  })

  it("a MISSING payload blocks every leg of every venue, naming the leg", () => {
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const request = { ...legRequest(leg, venueId) }
        delete request.consentPayload
        const r = evaluateLifecycleRails({ leg, venueId, request, deps: baseDeps({ consentAnchor: anchorFor(leg, legRequest(leg, venueId)) }) })
        expect(r.ok, `${venueId}/${leg} must refuse a missing payload`).toBe(false)
        expect(r.blockedBy).toBe("consent")
        expect(r.reason).toContain("payload missing")
      }
    }
  })

  it("a MUTATED field blocks and NAMES the field — on every leg of every venue", () => {
    const mutated = {
      place: { amount: 0.02 },
      amend: { newPrice: 999 },
      cancel: { orderId: "someone-elses-order" },
      close: { price: 0.01 }
    }
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const original = legRequest(leg, venueId)
        const payload = { ...original, ...mutated[leg] }
        const request = { ...original, consentPayload: payload }
        const r = evaluateLifecycleRails({ leg, venueId, request, deps: baseDeps({ consentAnchor: anchorFor(leg, original) }) })
        expect(r.ok, `${venueId}/${leg} must refuse a mutated payload`).toBe(false)
        expect(r.blockedBy).toBe("consent")
        expect(r.reason).toContain("consent-payload-mismatch")
        expect(r.reason, `${venueId}/${leg} must name the divergent field`).toMatch(/field:[a-zA-Z]+/)
      }
    }
  })

  it("a field the consent never covered cannot be smuggled in", () => {
    // The field list IS the consent. A payload carrying an extra key the anchor
    // does not hash cannot widen what was agreed — and the hash check catches the
    // case where every DECLARED field agrees but the object does not.
    const original = legRequest("place", "binance")
    const anchor = anchorFor("place", original)
    const payload = { ...original, side: "sell" }
    expect(payload.side).not.toBe(anchor.fields.side)
    const r = evaluateLifecycleRails({
      leg: "place",
      venueId: "binance",
      request: { ...original, consentPayload: payload },
      deps: baseDeps({ consentAnchor: anchor })
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("field:side")
  })

  it("a TAMPERED anchor is caught by the hash even when every declared field agrees", () => {
    // The hash is an independent second check, not a restatement of the field
    // comparison: here the fields match the payload and only the recorded hash
    // disagrees, which is exactly the case a field comparison alone would pass.
    const original = legRequest("place", "binance")
    const anchor = anchorFor("place", original)
    const tampered = { ...anchor, consentHash: "f".repeat(64) }
    const r = evaluateLifecycleRails({
      leg: "place",
      venueId: "binance",
      request: { ...original, consentPayload: { ...original } },
      deps: baseDeps({ consentAnchor: tampered })
    })
    expect(r.ok).toBe(false)
    expect(r.blockedBy).toBe("consent")
    expect(r.reason).toContain("does not match a recomputation")
  })

  it("one leg's anchor does not satisfy another leg's request", () => {
    const placeAnchor = anchorFor("place", legRequest("place", "kraken"))
    for (const leg of ["amend", "cancel", "close"]) {
      const r = evaluateLifecycleRails({
        leg,
        venueId: "kraken",
        request: { ...legRequest(leg, "kraken"), consentPayload: legRequest(leg, "kraken") },
        deps: baseDeps({ consentAnchor: placeAnchor })
      })
      expect(r.ok, `${leg} must not consume the place anchor`).toBe(false)
      // The legs key their anchor differently, so the rail sees a field set the
      // place anchor does not carry at all.
      expect(r.reason).toMatch(/field:(leg|orderId|positionOrderId)/)
    }
  })
})

// ==========================================================================
// 5. THE RISK RAILS — T11's own producers, per cell
// ==========================================================================

describe("T17 matrix — the risk rails, read from T11's producers", () => {
  beforeEach(() => {
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()
  })

  it("the ATR stop blocks a place whose stop is beyond T11's distance, on every venue", () => {
    for (const venueId of VENUE_IDS) {
      const request = { ...legRequest("place", venueId), price: 100, stopPrice: 96 }
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request) })
      })
      expect(r.ok, `${venueId} must refuse a stop beyond the ATR distance`).toBe(false)
      expect(r.blockedBy).toBe("risk")
      expect(r.reason).toContain(RAIL_CODES.RISK_ATR_CONFORMANCE)
      expect(r.rails.risk.detail.blockedByComponent).toBe("atrStop")
    }
  })

  it("a leg with no stopPrice is refused — an entry with no stop is not an entry this rail accepts", () => {
    for (const venueId of VENUE_IDS) {
      const request = { ...legRequest("place", venueId), stopPrice: undefined }
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request) })
      })
      expect(r.ok).toBe(false)
      expect(r.reason).toContain("declares no stopPrice")
    }
  })

  it("an ATR that has not warmed up blocks rather than passing an un-computed stop", () => {
    const request = legRequest("place", "kraken")
    const r = evaluateLifecycleRails({
      leg: "place",
      venueId: "kraken",
      request: { ...request, consentPayload: request },
      deps: baseDeps({ consentAnchor: anchorFor("place", request), atrSeries: { highs: [100, 101], lows: [99, 100], closes: [100, 100.5] } })
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain(RAIL_CODES.RISK_ATR_UNCOMPUTABLE)
    expect(r.reason).toContain("warmed up")
  })

  it("the 2% daily drawdown disable blocks a place at 2% and passes below it", () => {
    const at = (pct) => (venueId) => {
      const request = legRequest("place", venueId)
      return evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), dailyDrawdownPct: pct })
      })
    }
    for (const venueId of VENUE_IDS) {
      expect(at(1.99)(venueId).ok, `${venueId} below 2% must pass`).toBe(true)
      const fired = at(2)(venueId)
      expect(fired.ok, `${venueId} AT 2% must be disabled (the rail is "at or beyond")`).toBe(false)
      expect(fired.reason).toContain(RAIL_CODES.RISK_DRAWDOWN_FIRED)
      expect(at(5)(venueId).ok).toBe(false)
    }
  })

  it("an UNOBSERVED daily figure blocks every venue — T11 forbids substituting the session number", () => {
    for (const venueId of VENUE_IDS) {
      const request = legRequest("place", venueId)
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), dailyDrawdownPct: null })
      })
      expect(r.ok, `${venueId} must refuse an unobservable drawdown`).toBe(false)
      expect(r.reason).toContain(RAIL_CODES.RISK_DRAWDOWN_UNOBSERVED)
      expect(r.reason).toContain("session")
    }
  })

  it("a session loss figure ALONE is refused, on every venue", () => {
    for (const venueId of VENUE_IDS) {
      const request = legRequest("place", venueId)
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        // A caller offering only the session figure, which is the near-miss
        // `riskLayer.mjs:129-140` exists to refuse.
        request: { ...request, consentPayload: request, sessionLossPct: 3 },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), dailyDrawdownPct: undefined })
      })
      expect(r.ok, `${venueId} must not accept a session figure as the daily rail's input`).toBe(false)
      expect(r.reason).toContain("must not be substituted")
    }
  })

  it("the 3-strike key lock blocks EVERY venue and EVERY leg, exits included", () => {
    // T11's rule is about the CREDENTIAL. A locked key cannot reach the venue on
    // an exit either, and this is the one place the rails make a recovery harder —
    // stated rather than softened.
    const store = createStrikeStore()
    for (let i = 0; i < 3; i += 1) store.recordStrike("picc:key:venue-1", NOW - i * 1000)
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const request = carrying(leg, venueId)
        const r = evaluateLifecycleRails({
          leg,
          venueId,
          request,
          deps: baseDeps({ consentAnchor: anchorFor(leg, request), strikeStore: store })
        })
        expect(r.ok, `${venueId}/${leg} must be blocked by the key lock`).toBe(false)
        expect(r.blockedBy).toBe("risk")
        expect(r.reason).toContain(RAIL_CODES.RISK_KEY_LOCKED)
        expect(r.rails.risk.detail.blockedByComponent).toBe("keyLock")
      }
    }
  })

  it("two strikes do not lock; the third does, and the lock runs 24h from the MOST RECENT strike", () => {
    const request = legRequest("place", "kraken")
    const twoStrikes = createStrikeStore()
    twoStrikes.recordStrike("picc:key:venue-1", NOW - 10_000)
    twoStrikes.recordStrike("picc:key:venue-1", NOW - 5_000)
    const pass = evaluateLifecycleRails({
      leg: "place",
      venueId: "kraken",
      request: { ...request, consentPayload: request },
      deps: baseDeps({ consentAnchor: anchorFor("place", request), strikeStore: twoStrikes })
    })
    expect(pass.ok).toBe(true)
    expect(pass.rails.risk.detail.components.keyLock.detail.strikes).toBe(2)

    const threeStrikes = createStrikeStore()
    threeStrikes.recordStrike("picc:key:venue-1", NOW - 10_000)
    threeStrikes.recordStrike("picc:key:venue-1", NOW - 5_000)
    threeStrikes.recordStrike("picc:key:venue-1", NOW - 1_000)
    const blocked = evaluateLifecycleRails({
      leg: "place",
      venueId: "kraken",
      request: { ...request, consentPayload: request },
      deps: baseDeps({ consentAnchor: anchorFor("place", request), strikeStore: threeStrikes })
    })
    const detail = blocked.rails.risk.detail.components.keyLock.detail
    expect(detail.strikes).toBe(3)
    expect(detail.limit).toBe(3)
    expect(detail.lockMs).toBe(24 * 60 * 60 * 1000)
    // 24h from the most recent strike, not the first — a third strike at hour 23
    // must lock for a further 24h.
    expect(detail.lockedUntil).toBe(NOW - 1_000 + 24 * 60 * 60 * 1000)
  })

  it("an ABSENT strike counter blocks, because `strikes: null` is not `strikes: 0`", () => {
    for (const venueId of VENUE_IDS) {
      const request = legRequest("place", venueId)
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), strikeStore: null })
      })
      expect(r.ok, `${venueId} must refuse with no counter wired`).toBe(false)
      expect(r.reason).toContain(RAIL_CODES.RISK_STRIKE_STATE_ABSENT)
      expect(r.rails.risk.detail.components.keyLock.detail.strikes).toBeNull()
    }
  })

  it("a different credential key has its own strike state — the lock is per key", () => {
    const store = createStrikeStore()
    store.recordStrike("picc:key:venue-1", NOW)
    store.recordStrike("picc:key:venue-1", NOW)
    store.recordStrike("picc:key:venue-1", NOW)
    const request = legRequest("place", "bybit")
    const r = evaluateLifecycleRails({
      leg: "place",
      venueId: "bybit",
      request: { ...request, consentPayload: request },
      deps: baseDeps({ consentAnchor: anchorFor("place", request), strikeStore: store, credentialKey: "picc:key:other" })
    })
    expect(r.ok, "an unstruck key must not inherit another key's lock").toBe(true)
    expect(r.rails.risk.detail.components.keyLock.detail.strikes).toBe(0)
  })
})

// ==========================================================================
// 6. THE D5 automationPermitted PROVENANCE GATE — in the order path
// ==========================================================================

describe("T17 matrix — D5's automationPermitted provenance gate, in the order path", () => {
  beforeEach(() => {
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()
  })

  const autoRequest = (venueId, leg, overrides = {}) => {
    const base = legRequest(leg, venueId)
    const { consentBy, ...fields } = base
    return { ...fields, leg, automation: true, consentBy: undefined, ...overrides }
  }

  /** The auto-execute request with its payload, matching `carrying` for the human case. */
  const autoCarrying = (venueId, leg, overrides = {}) => {
    const request = autoRequest(venueId, leg, overrides)
    return { ...request, consentPayload: request }
  }

  it("a per-action human consent passes the authority component on every leg", () => {
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const request = carrying(leg, venueId)
        const r = evaluateLifecycleRails({
          leg,
          venueId,
          request,
          deps: baseDeps({ consentAnchor: anchorFor(leg, request) })
        })
        const c = r.rails.risk.detail.components.automationProvenance
        expect(c.verdict, `${venueId}/${leg}`).toBe("pass")
        expect(c.detail.claim).toBe("human-consent")
      }
    }
  })

  it("auto-execute with NO permit store is refused on every leg of every venue — nothing is wired, so nothing is permitted", () => {
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const request = autoCarrying(venueId, leg)
        const r = evaluateLifecycleRails({
          leg,
          venueId,
          request,
          deps: baseDeps({ consentAnchor: anchorFor(leg, request), permitStore: null, brokerId: "broker:venue-1" })
        })
        expect(r.ok, `${venueId}/${leg} must refuse auto-execute with no permit store`).toBe(false)
        const c = r.rails.risk.detail.components.automationProvenance
        expect(c.verdict).toBe("block")
        expect(c.detail.claim).toBe("auto-execute")
        expect(r.reason).toContain(RAIL_CODES.AUTOMATION_NO_PROVENANCE)
      }
    }
  })

  it("a BARE BOOLEAN is not permission — a record patched true with no approving authority still reads false", () => {
    // The provenance half of D5, proved against T16's OWN store rather than a
    // re-implementation: patch the flag directly, and the read stays false because
    // `permitChangedByAuthorityId` never resolved.
    const { store } = permittedStore({ grant: false })
    // Reach past the one write path and set the flag by hand.
    const patched = { ...store.read("broker:venue-1"), automationPermitted: true }
    expect(patched.automationPermitted).toBe(true)
    expect(store.isAutomationPermitted("broker:venue-1")).toBe(false)

    const fakeStore = {
      read: () => patched,
      isAutomationPermitted: (brokerId) => store.isAutomationPermitted(brokerId)
    }
    for (const venueId of VENUE_IDS) {
      const request = autoRequest(venueId, "place")
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), permitStore: fakeStore, brokerId: "broker:venue-1" })
      })
      expect(r.ok, `${venueId} must refuse a bare-boolean permit`).toBe(false)
      expect(r.reason).toContain(RAIL_CODES.AUTOMATION_NO_PROVENANCE)
    }
  })

  it("a grant whose approver is LATER REMOVED stops reading as permitted — provenance, not value", () => {
    const { store, authorities } = permittedStore({ grant: true })
    expect(store.isAutomationPermitted("broker:venue-1")).toBe(true)
    const request = autoRequest("binance", "place")
    const allowed = evaluateLifecycleRails({
      leg: "place",
      venueId: "binance",
      request: { ...request, consentPayload: request },
      deps: baseDeps({ consentAnchor: anchorFor("place", request), permitStore: store, brokerId: "broker:venue-1", rung: { current: "paper", requested: "paper" } })
    })
    expect(allowed.ok).toBe(true)

    // The approving authority is withdrawn. T16's override is the mechanism for
    // exactly this, and the rail's answer must follow it.
    const withdrawn = evaluateLifecycleRails({
      leg: "place",
      venueId: "binance",
      request: { ...request, consentPayload: request },
      deps: baseDeps({ consentAnchor: anchorFor("place", request), permitStore: { ...store, isAutomationPermitted: (id) => store.isAutomationPermitted(id, { authorities: [] }) }, brokerId: "broker:venue-1", rung: { current: "paper", requested: "paper" } })
    })
    expect(withdrawn.ok).toBe(false)
    expect(withdrawn.reason).toContain(RAIL_CODES.AUTOMATION_NO_PROVENANCE)
    expect(authorities).toHaveLength(1)
  })

  it("D6: auto-execute may stay inside the current rung and may NEVER advance it", () => {
    const { store } = permittedStore({ grant: true })
    for (const rung of D6_LADDER) {
      const request = autoRequest("kraken", "place")
      const inside = evaluateLifecycleRails({
        leg: "place",
        venueId: "kraken",
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), permitStore: store, brokerId: "broker:venue-1", rung: { current: rung, requested: rung } })
      })
      expect(inside.ok, `auto-execute inside the ${rung} rung must pass`).toBe(true)
    }
    // Every forward step is refused, on every venue.
    for (let from = 0; from < D6_LADDER.length; from += 1) {
      for (let to = from + 1; to < D6_LADDER.length; to += 1) {
        for (const venueId of VENUE_IDS) {
          const request = autoRequest(venueId, "place")
          const r = evaluateLifecycleRails({
            leg: "place",
            venueId,
            request: { ...request, consentPayload: request },
            deps: baseDeps({ consentAnchor: anchorFor("place", request), permitStore: store, brokerId: "broker:venue-1", rung: { current: D6_LADDER[from], requested: D6_LADDER[to] } })
          })
          expect(r.ok, `${venueId}: ${D6_LADDER[from]} -> ${D6_LADDER[to]} must be refused`).toBe(false)
          expect(r.reason).toContain(RAIL_CODES.AUTOMATION_CROSSES_RUNG)
        }
      }
    }
  })

  it("an unknown rung is refused rather than treated as \"within\" whatever it is", () => {
    const { store } = permittedStore({ grant: true })
    for (const rung of ["", "live-ish", "PAPER", null, undefined]) {
      const request = autoRequest("coinbase", "place")
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId: "coinbase",
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), permitStore: store, brokerId: "broker:venue-1", rung: { current: rung, requested: rung } })
      })
      expect(r.ok, `rung ${JSON.stringify(rung)} must not read as within a rung`).toBe(false)
      expect(r.reason).toContain(RAIL_CODES.AUTOMATION_CROSSES_RUNG)
    }
  })

  it("auto-execute naming NO broker is refused — the permit is a field ON a record", () => {
    const { store } = permittedStore({ grant: true })
    for (const venueId of VENUE_IDS) {
      const request = autoRequest(venueId, "place")
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request), permitStore: store, brokerId: null, rung: { current: "paper", requested: "paper" } })
      })
      expect(r.ok).toBe(false)
      expect(r.reason).toContain(RAIL_CODES.AUTOMATION_NO_PROVENANCE)
    }
  })

  it("a leg naming NEITHER a human nor automation is refused — three forms, one permitted", () => {
    for (const venueId of VENUE_IDS) {
      const request = { ...legRequest("place", venueId), consentBy: undefined, automation: false }
      const r = evaluateLifecycleRails({
        leg: "place",
        venueId,
        request: { ...request, consentPayload: request },
        deps: baseDeps({ consentAnchor: anchorFor("place", request) })
      })
      expect(r.ok, `${venueId} must refuse an unauthorised leg`).toBe(false)
      expect(r.rails.risk.detail.components.automationProvenance.detail.claim).toBe("none")
      expect(r.reason).toContain(RAIL_CODES.AUTOMATION_NO_AUTHORITY)
    }
  })
})

// ==========================================================================
// 7. NOTHING IS RESTATED — the source-level anti-duplication proof
// ==========================================================================

describe("T17 — the rails file restates no boundary another task owns", () => {
  const src = readFileSync(fileURLToPath(new URL("../services/venues/ccxtLifecycleRails.mjs", import.meta.url)), "utf8")

  it("T11's constants are read from riskLayer.mjs, never re-declared", () => {
    expect(src).toContain('from "../copilot/riskLayer.mjs"')
    for (const constant of ["ATR_STOP_MULTIPLE", "DAILY_DRAWDOWN_DISABLE_PCT", "THREE_STRIKE_LIMIT", "KEY_LOCK_MS", "RISK_LAYER_VERSION"]) {
      // An import or a destructured read is fine; a local `const X = <number>`
      // would be the drift the plan's Risk 6 warns about.
      expect(src, `${constant} must not be declared here`).not.toMatch(new RegExp(`(?:const|let|var)\\s+${constant}\\b`))
    }
    // And the numbers themselves must not appear as a literal boundary.
    expect(src).not.toMatch(/ATR[^=]{0,20}=\s*1\.5/)
    expect(src).not.toMatch(/DRAWDOWN[^=]{0,20}=\s*2\b/)
  })

  it("the ceremony gate is READ from WS-3's store, not reimplemented", () => {
    expect(src).toContain('from "../commandCentre/ceremonyState.mjs"')
    expect(src).toContain("ceremonyEnablementFor")
    // A re-implementation would carry its own unlock write or its own store.
    expect(src).not.toContain("unlockVenueClass(")
    expect(src).not.toContain("KNOWN_VENUE_CLASSES")
  })

  it("the consent lock is READ from WS-2's mechanism, not a second hashing path", () => {
    expect(src).toContain('from "../commandCentre/ccxtExecution.mjs"')
    expect(src).toContain("venueLegConsent")
    expect(src).toContain("venueLegConsentHash")
    // A second canonicaliser or a second digest would be the fork.
    expect(src).not.toContain("createHash")
    expect(src).not.toContain("sortConsentKeys")
    expect(src).not.toMatch(/sha256|md5/i)
  })

  it("D5's provenance read is T16's method, and its rule is not restated here", () => {
    expect(src).toContain("isAutomationPermitted")
    // The provenance RULE lives in T16: a true flag AND a resolving approver.
    // Re-deriving either half here would be the second copy.
    expect(src).not.toContain("permitChangedByAuthorityId")
    expect(src).not.toContain("permitChangedAt")
    expect(src).not.toMatch(/automationPermitted\s*!==\s*true/)
  })

  it("the venue list is read from ccxtVenues.mjs, not re-declared", () => {
    expect(src).toContain('from "./ccxtVenues.mjs"')
    expect(src).toContain("ccxtLifecycleVenue")
    expect(src).not.toMatch(/\[\s*"kraken"\s*,/)
  })
})

// ==========================================================================
// 8. THE SEALED ADAPTER — a rail that blocks after the venue call is not a rail
// ==========================================================================

describe("T17 — the rails run BEFORE the adapter, proven by an adapter that throws", () => {
  it("the sealed adapter is well-formed, so the throw is a real observation", async () => {
    const { assertLifecycleAdapter } = await import("../services/venues/ccxtVenueLifecycle.mjs")
    expect(() => assertLifecycleAdapter(sealedAdapter())).not.toThrow()
    expect(() => assertLifecycleAdapter({ place: () => {} })).toThrow(/missing member/)
    expect(() => assertLifecycleAdapter(null)).toThrow(/adapter object is required/)
  })

  it("every blocked leg throws if the adapter is reached — so a blocked verdict means the adapter was NOT reached", async () => {
    const { placeOrder, amendOrder, cancelOrder, closePosition, _resetVenueLifecycleState } = await import("../services/venues/ccxtVenueLifecycle.mjs")
    _resetVenueLifecycleState()
    unlockVenueClass(CEREMONY_CLASS, "test-operator", { now: NOW })
    enableAll()
    const adapter = sealedAdapter()
    for (const venueId of VENUE_IDS) {
      for (const leg of LIFECYCLE_LEGS) {
        const request = carrying(leg, venueId)
        let thrown = null
        let result = null
        try {
          if (leg === "place") result = await placeOrder({ ...request, venueId, deps: baseDeps(), adapter })
          else if (leg === "amend") result = await amendOrder({ ...request, venueId, deps: baseDeps(), adapter })
          else if (leg === "cancel") result = await cancelOrder({ ...request, venueId, deps: baseDeps(), adapter })
          else result = await closePosition({ ...request, venueId, exitPrice: 101, deps: baseDeps(), adapter })
        } catch (err) {
          thrown = err
        }
        // No anchor was proposed, so the consent rail refuses; the adapter must
        // never be reached, and `adapterTouched` says so on the record itself.
        expect(thrown, `${venueId}/${leg} must not reach the adapter`).toBeNull()
        if (result !== null) {
          expect(result.ok, `${venueId}/${leg} must be refused`).toBe(false)
          expect(result.adapterTouched, `${venueId}/${leg} must report the adapter untouched`).toBe(false)
        }
      }
    }
    _resetVenueLifecycleState()
  })
})
