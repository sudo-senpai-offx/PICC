// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { SettingsRoom } from "@/pages/ministry/SettingsRoom"
import { getMinistrySettings } from "@/lib/ministrySettings"

const WAIT = { timeout: 5000 }

const TRADING_FIXTURE = {
  entries: [
    {
      id: "twelve-data",
      ministry: "trading",
      name: "Twelve Data",
      url: "https://twelvedata.com/pricing",
      purpose: "Real-time US equities, forex, crypto, technical indicators",
      boundary: { freeTier: "8 API credits/min, 800/day", rateLimit: "8 API credits/min", keyRequired: true },
      state: "unconfigured"
    },
    {
      id: "binance-public",
      ministry: "trading",
      name: "Binance Public API",
      url: "https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md",
      purpose: "Spot market data, order book depth, trades, klines/candlesticks",
      boundary: { freeTier: "Weight-based limits, no key for public endpoints", rateLimit: "~1200 weight/min", keyRequired: false },
      state: "unconfigured"
    },
    {
      id: "gdelt",
      ministry: "trading",
      name: "GDELT DOC 2.0",
      url: "https://gdeltproject.org/",
      purpose: "Global news monitoring, tone/sentiment scoring, event detection",
      boundary: { freeTier: "100% free, open data", rateLimit: "~1 request/5 seconds recommended", keyRequired: false },
      state: "unconfigured"
    }
  ]
}

function mountAt(path: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/suites/:suiteId/*" element={<SettingsRoom />} />
        </Routes>
      </MemoryRouter>
    )
  })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("SettingsRoom", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => TRADING_FIXTURE
    })))
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it("renders the two per-ministry controls", () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    expect(m.host.textContent).toContain("Autopilot mode")
    expect(m.host.textContent).toContain("Confidence threshold")
    expect(m.host.textContent).toContain("stored locally on this machine per ministry")
  })

  it("persists a mode flip to copilot via saveMinistrySettings", () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    const toggle = m.host.querySelector("input[type=checkbox]") as HTMLInputElement | null
    expect(toggle).not.toBeNull()
    flushSync(() => {
      toggle!.click()
    })
    expect(getMinistrySettings("trading").mode).toBe("copilot")
  })

  it("renders the per-ministry integration registry table", async () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    await vi.waitFor(() => expect(m.host.textContent).toContain("Twelve Data"), WAIT)
    expect(m.host.textContent).toContain("Binance Public API")
    expect(m.host.textContent).toContain("GDELT DOC 2.0")
    expect(m.host.textContent).toContain("Read-only info acquisition")
    expect(m.host.textContent).toContain("Unconfigured")
    expect(m.host.textContent).toContain("Key?")
    expect(m.host.textContent).toContain("PICC-as-a-country")
  })
})