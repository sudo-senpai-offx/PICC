// WS-6 T3 — venue integrity register (RED, AC-012).
//
// D11 is a hard lock: no venue may be counterparty + price-feed authority +
// settlement authority simultaneously, and the terminal must NOT silently award
// independence. A conflict must be NAMED, the status must not be `verified`,
// and no execution may be enabled from a conflicted venue.
import { describe, expect, it } from "vitest"
import { assessVenue, assessRegister, type VenueRecord } from "../venueIntegrity"
import { live, unavailable, reserved } from "../../domain/availability"

const credsOk = live({ source: "vault", observedAt: 1_700_000_000, freshnessMs: 50 })

function venue(over: Partial<VenueRecord> = {}): VenueRecord {
  return {
    venueId: "hyperliquid",
    feedAuthority: "hyperliquid",
    counterpartyAuthority: "other-traders",
    settlementAuthority: "hyperliquid-onchain",
    credentialStatus: credsOk,
    ...over
  }
}

describe("venue integrity — independent authorities", () => {
  it("verifies a venue whose three authorities are distinct", () => {
    const r = assessVenue(venue())
    expect(r.integrityStatus).toBe("verified")
    expect(r.blocker).toBeNull()
  })

  it("treats different named entities as independent", () => {
    const r = assessVenue(
      venue({ feedAuthority: "vendor-a", counterpartyAuthority: "vendor-b", settlementAuthority: "custodian-c" })
    )
    expect(r.integrityStatus).toBe("verified")
  })
})

describe("venue integrity — the three-role conflict (AC-012)", () => {
  it("flags a conflict when one entity holds all three roles", () => {
    const r = assessVenue(
      venue({ feedAuthority: "acme", counterpartyAuthority: "acme", settlementAuthority: "acme" })
    )
    expect(r.integrityStatus).toBe("conflict")
    expect(r.blocker).toMatch(/acme/)
  })

  it("flags a conflict when one entity holds feed and settlement", () => {
    const r = assessVenue(
      venue({ feedAuthority: "acme", counterpartyAuthority: "others", settlementAuthority: "acme" })
    )
    expect(r.integrityStatus).toBe("conflict")
    expect(r.blocker).toMatch(/acme/)
  })

  it("flags a conflict when one entity holds counterparty and settlement", () => {
    const r = assessVenue(
      venue({ feedAuthority: "vendor", counterpartyAuthority: "acme", settlementAuthority: "acme" })
    )
    expect(r.integrityStatus).toBe("conflict")
  })

  it("flags a conflict when one entity holds feed and counterparty", () => {
    const r = assessVenue(
      venue({ feedAuthority: "acme", counterpartyAuthority: "acme", settlementAuthority: "onchain" })
    )
    expect(r.integrityStatus).toBe("conflict")
  })

  it("NAMES every conflicting entity rather than reporting a generic conflict", () => {
    const r = assessVenue(
      venue({ feedAuthority: "acme", counterpartyAuthority: "acme", settlementAuthority: "acme" })
    )
    expect(r.blocker).toMatch(/counterparty/i)
    expect(r.blocker).toMatch(/feed/i)
    expect(r.blocker).toMatch(/settlement/i)
  })

  it("never awards independence to a conflicted venue", () => {
    const r = assessVenue(
      venue({ feedAuthority: "x", counterpartyAuthority: "x", settlementAuthority: "x" })
    )
    expect(r.integrityStatus).not.toBe("verified")
  })
})

describe("venue integrity — unverified inputs stay unverified", () => {
  it("is unverified, not verified, when an authority is unknown/blank", () => {
    const r = assessVenue(venue({ settlementAuthority: "  " }))
    expect(r.integrityStatus).toBe("unverified")
    expect(r.integrityStatus).not.toBe("verified")
  })

  it("is unverified when credentials are not live", () => {
    // Integrity cannot be "verified" while the credential state is unknown.
    const r = assessVenue(venue({ credentialStatus: unavailable({ reason: "no vault entry", owner: "WS-7", since: 1 }) }))
    expect(r.integrityStatus).not.toBe("verified")
  })

  it("is unverified when credentials are reserved for a later workstream", () => {
    const r = assessVenue(venue({ credentialStatus: reserved({ workstream: "WS-11", reason: "ceremony pending" }) }))
    expect(r.integrityStatus).not.toBe("verified")
  })
})

describe("venue integrity — register level (AC-012)", () => {
  it("reports the conflicted venue and never lets the register read as all-clear", () => {
    const reg = assessRegister([
      venue({ venueId: "hata" }),
      venue({
        venueId: "suspect",
        feedAuthority: "suspect",
        counterpartyAuthority: "suspect",
        settlementAuthority: "suspect"
      })
    ])
    expect(reg.conflicted).toEqual(["suspect"])
    expect(reg.allVerified).toBe(false)
    expect(reg.blockers).toHaveLength(1)
  })

  it("is all-clear only when every venue is verified", () => {
    const reg = assessRegister([venue({ venueId: "hata" }), venue({ venueId: "ok-venue" })])
    expect(reg.allVerified).toBe(true)
    expect(reg.conflicted).toEqual([])
  })

  it("treats an empty register as NOT all-clear rather than vacuously safe", () => {
    // Zero configured venues is an unconfigured state, not a verified state.
    const reg = assessRegister([])
    expect(reg.allVerified).toBe(false)
  })
})
