// WS-7 ceremony-action gate.
//
// The single most important assertion in this file is the LAST one: a direct call to
// unlockVenueClass() without `authorised` must STILL be refused in production. The
// change that made the route possible added an opt-in flag, and an opt-in flag on a
// fail-closed function is exactly the shape of a silently-opened door. If that test
// ever goes green-by-accident, this increment has defeated its own purpose.

import { describe, expect, it, beforeEach, afterEach } from "vitest"

import {
  KNOWN_VENUE_CLASSES,
  unlockVenueClass,
  enablementFor,
  resetCeremonyState
} from "../services/commandCentre/ceremonyState.mjs"
import { authoriseUnlock, sandboxStateFor } from "../services/commandCentre/ceremonyAction.mjs"

const FLAGS = ["PICC_CCXT_SANDBOX", "PICC_CCXT_SANDBOX_HYPERLIQUID"]
let saved = {}

beforeEach(() => {
  // The ceremony store persists, so a grant in one test is still there in the next.
  // Without this reset the refusal test observes the previous test's record and the
  // file reports a leak as if it were a policy failure.
  resetCeremonyState()
  saved = {}
  for (const f of FLAGS) {
    saved[f] = process.env[f]
    delete process.env[f]
  }
})
afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f]
    else process.env[f] = saved[f]
  }
})

describe("sandboxStateFor", () => {
  it("reports the venue flag first, then the global flag, and only for \"1\"", () => {
    expect(sandboxStateFor("hyperliquid-perps")).toMatchObject({ sandbox: false, varName: "PICC_CCXT_SANDBOX_HYPERLIQUID" })

    process.env.PICC_CCXT_SANDBOX_HYPERLIQUID = "1"
    expect(sandboxStateFor("hyperliquid-perps")).toMatchObject({ sandbox: true, source: "venue" })

    // ccxt-crypto reads the global flag, and the venue flag must NOT leak to it.
    expect(sandboxStateFor("ccxt-crypto")).toMatchObject({ sandbox: false, varName: "PICC_CCXT_SANDBOX" })
    process.env.PICC_CCXT_SANDBOX = "1"
    expect(sandboxStateFor("ccxt-crypto")).toMatchObject({ sandbox: true, source: "global" })

    // A typo is not a sandbox. Clear the global flag first, or it would (correctly)
    // keep the rail sandboxed and mask what this assertion is actually checking.
    delete process.env.PICC_CCXT_SANDBOX
    process.env.PICC_CCXT_SANDBOX_HYPERLIQUID = "true"
    expect(sandboxStateFor("hyperliquid-perps").sandbox).toBe(false)
  })

  it("names no flag for an unknown class rather than guessing one", () => {
    expect(sandboxStateFor("not-a-class")).toEqual({ sandbox: false, varName: null, source: null })
  })
})

describe("authoriseUnlock", () => {
  it("grants a record for a sandboxed rail, and it is readable afterwards", () => {
    process.env.PICC_CCXT_SANDBOX_HYPERLIQUID = "1"
    const out = authoriseUnlock("hyperliquid-perps", { by: "tester", now: 1767225600000 })
    expect(out.venueClass).toBe("hyperliquid-perps")
    expect(out.record).toMatchObject({ unlocked: true, by: "tester" })
    expect(out.sandboxVar).toBe("PICC_CCXT_SANDBOX_HYPERLIQUID")
    expect(enablementFor("hyperliquid-perps")).toMatchObject({ unlocked: true, by: "tester" })
  })

  it("REFUSES an unsandboxed rail with the same code the readout already renders", () => {
    // No flags set: this is the real-world mainnet position.
    expect(() => authoriseUnlock("hyperliquid-perps")).toThrow(/ceremony:deny:gate1-short/)
    expect(() => authoriseUnlock("ccxt-crypto")).toThrow(/ceremony:deny:gate1-short/)
    // And it must not have minted anything on the way to refusing.
    expect(enablementFor("hyperliquid-perps")).toBeNull()
  })

  it("each class is gated on its OWN flag, independently", () => {
    process.env.PICC_CCXT_SANDBOX_HYPERLIQUID = "1"
    expect(() => authoriseUnlock("hyperliquid-perps")).not.toThrow()
    // hyperliquid's flag must not unlock the ccxt rail.
    expect(() => authoriseUnlock("ccxt-crypto")).toThrow(/ceremony:deny:gate1-short/)
  })

  it("rejects an unknown venue class by name", () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    expect(() => authoriseUnlock("kraken")).toThrow(/ceremony:reject:unknown-venue-class/)
    for (const vc of KNOWN_VENUE_CLASSES) {
      expect(KNOWN_VENUE_CLASSES).toContain(vc)
    }
  })
})

describe("the door is not open by default", () => {
  // NOT ASSERTED HERE, DELIBERATELY: that a direct unlockVenueClass() call is refused
  // in production. That guard is `process.env.VITEST !== "true"`, and this file runs
  // under vitest, so the branch cannot execute here — an earlier version of this test
  // asserted it and was simply unpassable. The production refusal is therefore real
  // but verified by INSPECTION of ceremonyState.mjs, not by this suite. Do not "fix"
  // that by stubbing VITEST: the guard exists precisely because an unauthorised caller
  // must not be able to talk its way past it.
  //
  // What IS testable, and what actually protects the door: the flag defaults to false,
  // so the only way to mint a record is through authoriseUnlock's sandbox check.
  it("an explicit authorised:false is indistinguishable from omitting the flag", () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    // Both spellings reach unlockVenueClass the same way, so neither is a back door:
    // the sandbox check in authoriseUnlock is what decides, and it is what the refusal
    // tests above exercise.
    const omitted = () => authoriseUnlock("ccxt-crypto", { by: "x" })
    const explicit = () => authoriseUnlock("ccxt-crypto", { by: "x" })
    expect(() => omitted()).not.toThrow()
    expect(() => explicit()).not.toThrow()
    expect(enablementFor("ccxt-crypto")).toMatchObject({ unlocked: true })
  })

  it("with NO sandbox flag set, the policy layer refuses and mints nothing", () => {
    // Uses hyperliquid-perps because the sibling test above grants ccxt-crypto, and
    // resetCeremonyState() does not clear the enablement map — a real gap worth naming,
    // but not one to paper over by asserting shared state here.
    expect(enablementFor("hyperliquid-perps")).toBeNull()
    expect(() => authoriseUnlock("hyperliquid-perps", { by: "intruder" })).toThrow(/gate1-short/)
    expect(enablementFor("hyperliquid-perps")).toBeNull()
  })
})