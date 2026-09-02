// T2 / REQ-2 — iOS install eligibility, PURE. The 2026 iOS push rule set:
// push works only from an INSTALLED PWA on iOS 16.4+. So "install needed" is
// true exactly when iOS AND (not standalone OR version < 16.4). Never a false
// claim that push works on a sub-16.4 PWA. Table-driven per the acceptance.
import { describe, expect, it } from "vitest"
import { isIOSInstallNeeded } from "@/lib/installEligibility"

const ios = (os: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1`
const ipad = (os: string) => `Mozilla/5.0 (iPad; CPU OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1`

describe("isIOSInstallNeeded (T2 / REQ-2)", () => {
  it("iOS 15.7 not standalone → install needed (push impossible)", () => {
    expect(isIOSInstallNeeded(ios("15_7"), false)).toBe(true)
  })

  it("iOS 16.4+ standalone → no banner (push works)", () => {
    expect(isIOSInstallNeeded(ios("16_4"), true)).toBe(false)
    expect(isIOSInstallNeeded(ios("17_0"), true)).toBe(false)
  })

  it("iOS 16.3 standalone → still needed (16.4 is the floor)", () => {
    expect(isIOSInstallNeeded(ios("16_3"), true)).toBe(true)
  })

  it("iOS not standalone at ANY version → install needed", () => {
    expect(isIOSInstallNeeded(ios("18_0"), false)).toBe(true)
    expect(isIOSInstallNeeded(ipad("16_6"), false)).toBe(true)
  })

  it("Android and desktop are never iOS → no banner", () => {
    expect(isIOSInstallNeeded("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36", false)).toBe(false)
    expect(isIOSInstallNeeded("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", false)).toBe(false)
  })

  it("an iOS UA with an unparseable version never fabricates an install requirement", () => {
    // Standalone iOS whose version we can't read: the install half is already
    // satisfied, so recommending install again would be untrue — return false.
    expect(isIOSInstallNeeded("Mozilla/5.0 (iPhone; CPU iPhone OS X_Y like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", true)).toBe(false)
    expect(isIOSInstallNeeded(ios(""), true)).toBe(false)
    // NOT standalone still needs install regardless of the version being
    // unparseable — an uninstalled iOS PWA can never push.
    expect(isIOSInstallNeeded(ios("X_Y"), false)).toBe(true)
  })

  it("standalone flag is honored independently of the version parse", () => {
    expect(isIOSInstallNeeded(ios("17_0"), false)).toBe(true)
    expect(isIOSInstallNeeded(ios("15_7"), true)).toBe(true)
  })
})