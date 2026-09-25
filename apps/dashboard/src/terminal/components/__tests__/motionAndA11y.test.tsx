// @vitest-environment jsdom
// WS-6 T8 — reduced motion + accessibility (RED, AC-005 / AC-006 / AC-016).
//
// Motion must be isolated from state transitions: a data update may lag an
// animation, but an animation may never REWRITE a value (R3.4). With reduced
// motion honoured, the same update must land immediately. T8 also covers the
// terminal's motion package, which is specified in 4.8 as a deferred install.
import { describe, expect, it, afterEach, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { useMotionPreference } from "../../hooks/useMotionPreference"
import { MotionValue } from "../MotionValue"

let mounted: Array<{ unmount: () => void }> = []

function render(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(node))
  mounted.push({
    unmount() {
      flushSync(() => root.unmount())
      document.body.removeChild(host)
    }
  })
  return host
}

afterEach(() => {
  mounted.forEach((m) => m.unmount())
  mounted = []
  vi.restoreAllMocks()
})

function stubMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })) as unknown as typeof window.matchMedia
}

function probe() {
  let value: ReturnType<typeof useMotionPreference> | null = null
  function Probe() {
    value = useMotionPreference()
    return null
  }
  render(<Probe />)
  return value!
}

describe("useMotionPreference", () => {
  it("reports reduced motion when the user requests it", () => {
    stubMatchMedia(true)
    expect(probe().prefersReducedMotion).toBe(true)
  })

  it("reports motion allowed when the user does not request reduction", () => {
    stubMatchMedia(false)
    expect(probe().prefersReducedMotion).toBe(false)
  })

  it("returns a usable duration either way", () => {
    stubMatchMedia(true)
    expect(probe().durationMs).toBe(0)
    stubMatchMedia(false)
    expect(probe().durationMs).toBeGreaterThan(0)
  })
})

describe("MotionValue — animation cannot rewrite the underlying value (R3.4)", () => {
  it("commits the real value immediately when motion is reduced", () => {
    const mv = new MotionValue(10, { prefersReducedMotion: true })
    mv.set(42)
    expect(mv.value).toBe(42)
  })

  it("never reports an animated value as the settled value", () => {
    // An animation may lag a value for DISPLAY, but the authoritative value is
    // always the last committed one.
    const mv = new MotionValue(10, { prefersReducedMotion: true })
    mv.set(20)
    mv.set(30)
    expect(mv.value).toBe(30)
  })

  it("exposes the settled value separately from any display value", () => {
    const mv = new MotionValue(1, { prefersReducedMotion: true })
    mv.set(2)
    expect(mv.displayValue).toBe(mv.value)
  })

  it("is safe to construct with no options", () => {
    const mv = new MotionValue(5)
    mv.set(6)
    expect(mv.value).toBe(6)
  })
})
