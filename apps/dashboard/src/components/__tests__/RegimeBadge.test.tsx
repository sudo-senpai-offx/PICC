// @vitest-environment jsdom
// B-REG-5 — the additive regime-engine badge (spec PICC_TRADING_SUITE_REBUILD_v1.md):
// RegimeBadge renders the additive regime block with honesty:
//   • read block        → regime + confidence + factors (+ volatile marker)
//   • null / missing    → the literal status "unknown", NEVER "0%"/garbage (R10)
//   • mode:"off"        → "advisory, not applied" tag (the read did NOT shape
//                         the displayed weights — R1 mitigation)
// Mounts the exported chip directly. Relocated with its component on slice 7
// (RegimeBadge.tsx) when the ConvergencePanel shell became a verified orphan —
// the chip's shape and honesty contracts are unchanged.
import { describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { RegimeBadge } from "@/components/RegimeBadge"
import type { RegimeBlock } from "@/lib/liveTrading"

function mount(el: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(el) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

const block = (overrides: Partial<RegimeBlock>): RegimeBlock => ({
  regime: "TRENDING",
  volatile: true,
  confidence: 100,
  factors: ["plane 3600 choppiness: trend", "plane 3600 adx: trend"],
  mode: "soft",
  applied: true,
  labels: { suffix: "regime:trending" },
  ...overrides
})

describe("RegimeBadge (B-REG-5)", () => {
  it("renders regime + confidence + the factor line from the additive block", () => {
    const { host, unmount } = mount(<RegimeBadge block={block({})} />)
    const text = host.textContent ?? ""
    expect(text).toContain("TRENDING")
    expect(text).toContain("100%")
    expect(text).toContain("volatile")
    expect(text).toContain("plane 3600 choppiness: trend")
    expect(text).toContain("plane 3600 adx: trend")
    expect(text).not.toContain("advisory, not applied")
    unmount()
  })

  it("a null block renders the status 'unknown' — never 0 or an empty chip", () => {
    const { host, unmount } = mount(<RegimeBadge block={null} />)
    const text = host.textContent ?? ""
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\b0%/)
    expect(text).not.toMatch(/RANGING|TRENDING|UNCERTAIN/)
    unmount()
  })

  it("an absent block (older snapshot) renders the same honest 'unknown'", () => {
    const { host, unmount } = mount(<RegimeBadge block={undefined} />)
    expect(host.textContent ?? "").toContain("unknown")
    unmount()
  })

  it("mode:off shows the 'advisory, not applied' tag — the read did not shape the weights", () => {
    const { host, unmount } = mount(<RegimeBadge block={block({ mode: "off", applied: false, labels: null })} />)
    expect(host.textContent ?? "").toContain("advisory, not applied")
    unmount()
  })
})