// @vitest-environment jsdom
// T2 / REQ-2 — the banner component shows ONLY when the shared hook reports
// install-needed. The hook is the single opinion in the app; this test pins
// "mocked true → banner, mocked false → nothing" so no surface can improvise
// its own iOS detection.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { IOSInstallBanner } from "@/components/IOSInstallBanner"

let bannerNeeded = false
vi.mock("@/hooks/useInstallBanner", () => ({ useInstallBanner: () => bannerNeeded }))

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<IOSInstallBanner />) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

const bannerEl = () => document.querySelector<HTMLElement>('[data-testid="ios-install-banner"]')

describe("IOSInstallBanner (T2 / REQ-2)", () => {
  beforeEach(() => { bannerNeeded = false })
  afterEach(() => { vi.restoreAllMocks() })

  it("renders the Add to Home Screen guidance when recourse is needed", () => {
    bannerNeeded = true
    const m = mount()
    expect(bannerEl()).not.toBeNull()
    expect(bannerEl()?.textContent).toMatch(/Add to Home Screen/i)
    m.unmount()
  })

  it("renders nothing when install is not needed (never a false gate)", () => {
    const m = mount()
    expect(bannerEl()).toBeNull()
    m.unmount()
  })
})