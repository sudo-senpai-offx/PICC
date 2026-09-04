// @vitest-environment jsdom
// The correlation screen must render honest states: measured pairs + score on
// a populated payload, and "—" rather than fabricated zeros when nothing is
// measured. fetch is stubbed so no network ever leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CorrelationScreen } from "@/components/CorrelationScreen"

function mount(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<>{node}</>) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

function stubFetch(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response)))
}

const populated = {
  ok: true,
  symbols: ["BTCUSD", "ETHUSD", "EURUSD"],
  matrix: [[1, 0.92, -0.1], [0.92, 1, -0.05], [-0.1, -0.05, 1]],
  pairs: [
    { asset1: "BTCUSD", asset2: "ETHUSD", correlation: 0.92 },
    { asset1: "BTCUSD", asset2: "EURUSD", correlation: -0.1 },
    { asset1: "ETHUSD", asset2: "EURUSD", correlation: -0.05 }
  ],
  highlyCorrelated: [{ asset1: "BTCUSD", asset2: "ETHUSD", correlation: 0.92 }],
  diversificationScore: 0.31
}

const empty = { ok: true, symbols: [], matrix: [], pairs: [], highlyCorrelated: [], diversificationScore: 0 }

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("CorrelationScreen (R6 portfolio correlation)", () => {
  it("renders measured pairs, high-correlation badges and the diversification score", async () => {
    stubFetch(populated)
    const m = mount(<CorrelationScreen symbols={["BTCUSD", "ETHUSD", "EURUSD"]} />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("BTCUSD × ETHUSD")
    expect(text).toContain("high corr")
    expect(text).toContain("0.31")
    expect(text).toContain("+0.92")
    expect(text).toContain("3") // instruments
    m.unmount()
  })

  it("renders an honest empty state with an em-dash score when nothing is measured", async () => {
    stubFetch(empty)
    const m = mount(<CorrelationScreen />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("No instruments measured")
    // Honest em-dash for the score — a measured zero would be fabrication.
    expect(text).toContain("—")
    expect(text).not.toContain("+0.")
    m.unmount()
  })

  it("shows the fetch error instead of fabricated data when the endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "correlation exploded" })
    } as unknown as Response)))
    const m = mount(<CorrelationScreen />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    expect(m.host.textContent).toContain("correlation exploded")
    m.unmount()
  })
})
