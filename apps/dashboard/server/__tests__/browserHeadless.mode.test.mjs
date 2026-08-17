import { describe, expect, it } from "vitest"
import { resolveStudioHeadless } from "../services/browserStudio.mjs"

// The studio session must default to a REAL interactive headed window
// (headless:false). Embedded mirror-only is an opt-in (explicit headless:true)
// or a forced env override for headless CI/E2E runs.
describe("resolveStudioHeadless", () => {
  it("defaults to a headed (real interactive) window when nothing is set", () => {
    expect(resolveStudioHeadless(undefined, {})).toBe(false)
  })

  it("honors an explicit headless:true (embedded mirror-only)", () => {
    expect(resolveStudioHeadless(true, {})).toBe(true)
  })

  it("honors an explicit headless:false (real window)", () => {
    expect(resolveStudioHeadless(false, {})).toBe(false)
  })

  it("PICC_STUDIO_HEADLESS=1 forces embedded regardless of the arg", () => {
    expect(resolveStudioHeadless(undefined, { PICC_STUDIO_HEADLESS: "1" })).toBe(true)
    expect(resolveStudioHeadless(false, { PICC_STUDIO_HEADLESS: "1" })).toBe(true)
  })

  it("PICC_STUDIO_HEADLESS=0 does not force embedded", () => {
    expect(resolveStudioHeadless(undefined, { PICC_STUDIO_HEADLESS: "0" })).toBe(false)
    expect(resolveStudioHeadless(true, { PICC_STUDIO_HEADLESS: "0" })).toBe(true)
  })
})
