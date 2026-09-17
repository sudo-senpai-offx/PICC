import { describe, expect, it } from "vitest"
import { resolveStudioHeadless } from "../services/browserStudio.mjs"

// The studio session is WINDOW-FIRST: it opens a REAL, visible, trackable
// browser window by default — the window where user input is intercepted for
// PICC intervention, with bidirectional tab sync. Headless (no window) is an
// explicit opt-in (headless:true) or a forced env override for CI/E2E runs.
// PICC_STUDIO_HEADLESS=1 always forces headless.
describe("resolveStudioHeadless", () => {
  it("defaults to a real window (headed) when nothing is set", () => {
    expect(resolveStudioHeadless(undefined, {})).toBe(false)
  })

  it("honors an explicit headless:true (embedded/CI)", () => {
    expect(resolveStudioHeadless(true, {})).toBe(true)
  })

  it("honors an explicit headless:false (real window)", () => {
    expect(resolveStudioHeadless(false, {})).toBe(false)
  })

  it("PICC_STUDIO_HEADLESS=1 forces headless regardless of the arg", () => {
    expect(resolveStudioHeadless(undefined, { PICC_STUDIO_HEADLESS: "1" })).toBe(true)
    expect(resolveStudioHeadless(false, { PICC_STUDIO_HEADLESS: "1" })).toBe(true)
  })

  it("PICC_STUDIO_HEADLESS=0 does not force headless for a real window", () => {
    expect(resolveStudioHeadless(false, { PICC_STUDIO_HEADLESS: "0" })).toBe(false)
    expect(resolveStudioHeadless(true, { PICC_STUDIO_HEADLESS: "0" })).toBe(true)
  })
})
