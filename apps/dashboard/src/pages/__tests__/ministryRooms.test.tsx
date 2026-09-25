// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import App from "@/App"
import { INNER_NAV } from "@/pages/MinistryShell"

vi.mock("@/lib/auth", () => ({
  getStoredSession: () => ({ access_token: "t", user: { id: "u", name: "SP0 Observer", email: "sp0.observer@picc.local" } }),
  setStoredSession: () => {},
  fetchMe: async () => ({ id: "u", name: "SP0 Observer", email: "sp0.observer@picc.local" }),
  signOutLocal: async () => {},
  getToken: () => "t"
}))

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

function mount(url: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>
    )
  })
  return {
    host,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("ministry room routes (SP-1 T1.3)", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    mounted = []
    vi.stubGlobal("fetch", vi.fn(async () => {
      return { ok: false, status: 404, json: async () => ({ ok: false, error: "no data (stubbed)" }) } as Response
    }))
    // jsdom omits matchMedia, which browsers provide — required by the
    // iOS-install banner (useInstallBanner) that AutopilotSuite renders.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders the trading Markets room at its sub-route", async () => {
    const m = mount("/suites/trading/markets")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="markets"]'), "trading markets room header")
    expect(m.host.querySelector('header[data-room="markets"]')?.textContent).toContain("Markets")
  })

  it("renders the trading Autopilot room at its sub-route", async () => {
    const m = mount("/suites/trading/autopilot")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="autopilot"]'), "trading autopilot room header")
    expect(m.host.querySelector('header[data-room="autopilot"]')?.textContent).toContain("Autopilot")
  })

  it("renders an earnings room under the earnings shell", async () => {
    const m = mount("/suites/earnings/simulator")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="simulator"]'), "earnings simulator room header")
    expect(m.host.querySelector('header[data-room="simulator"]')?.textContent).toContain("Simulator")
  })

  it("renders an intelligence room under the intelligence shell", async () => {
    const m = mount("/suites/intelligence/guidance")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="guidance"]'), "intelligence guidance room header")
    expect(m.host.querySelector('header[data-room="guidance"]')?.textContent).toContain("Guidance")
  })

  it("markets room renders its curated panels", async () => {
    const m = mount("/suites/trading/markets")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="markets"]'), "markets room header")
    await waitFor(() => m.host.textContent.includes("Watchlists"), "markets Watchlists panel")
    expect(m.host.textContent).toContain("Cross-Venue Spread")
    expect(m.host.textContent).toContain("Economic Calendar")
  })

  it("dashboard room renders its curated panels", async () => {
    const m = mount("/suites/trading/dashboard")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="dashboard"]'), "dashboard room header")
    await waitFor(() => m.host.textContent.includes("Paper cash available"), "dashboard StatusCards")
    expect(m.host.textContent).toContain("Paper cash available")
    expect(m.host.textContent).toContain("Trade planner")
    expect(m.host.textContent).toContain("Adaptive Confluence")
  })

  it("paper room renders its curated panels", async () => {
    const m = mount("/suites/trading/paper")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="paper"]'), "paper room header")
    await waitFor(() => m.host.textContent.includes("Paper trading"), "paper PaperTradingCard")
    expect(m.host.textContent).toContain("Trade Journal")
    expect(m.host.textContent).toContain("Decision accuracy ledger")
  })

  it("command-centre room renders its curated panels", async () => {
    const m = mount("/suites/trading/command-centre")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="command-centre"]'), "command-centre room header")
    await waitFor(() => m.host.textContent.includes("Command Centre"), "command-centre panel")
    expect(m.host.textContent).toContain("Pattern Recognition")
    expect(m.host.textContent).toContain("Signal log")
  })

  it("autopilot room renders AutopilotSuite without triggering the ProAnalysis result", async () => {
    const m = mount("/suites/trading/autopilot")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector('header[data-room="autopilot"]'), "autopilot room header")
    await waitFor(() => m.host.textContent.includes("Automated demo-trading engine"), "autopilot suite static label")
    expect(m.host.textContent).toContain("Model Matrix")
  })
})

/**
 * WS-6 T0 — room-key contract freeze (characterisation).
 *
 * These assertions pin the EXACT room key set recorded in the WS-6 spec §0.3
 * so the strangler migration cannot silently rename, drop, or repoint a room
 * key. This is a freeze of current behaviour, not new behaviour: the values
 * below are transcribed from `MinistryShell.tsx:5-29` and are expected to pass
 * without any production change. If a test here fails, the migration has
 * broken routing compatibility and must be reverted or the spec amended.
 */
describe("WS-6 T0 — ministry room keys are frozen (spec §0.3)", () => {
  it("exposes exactly three suites", () => {
    expect(Object.keys(INNER_NAV).sort()).toEqual(["earnings", "intelligence", "trading"])
  })

  it("freezes the trading suite room keys, in order", () => {
    expect(INNER_NAV.trading.map((e) => e.to)).toEqual([
      "dashboard",
      "markets",
      "paper",
      "autopilot",
      "command-centre",
      "dispatch",
      "simulator",
      "studio",
      "settings"
    ])
  })

  it("freezes the earnings suite room keys, in order", () => {
    expect(INNER_NAV.earnings.map((e) => e.to)).toEqual(["dashboard", "simulator", "studio", "settings"])
  })

  it("freezes the intelligence suite room keys, in order", () => {
    expect(INNER_NAV.intelligence.map((e) => e.to)).toEqual([
      "dashboard",
      "governor",
      "guidance",
      "studio",
      "settings"
    ])
  })

  it("keeps the total room-key count at 18 across all suites", () => {
    const total = Object.values(INNER_NAV).reduce((n, entries) => n + entries.length, 0)
    expect(total).toBe(18)
  })

  it("keeps every room key unique within its suite", () => {
    for (const [suite, entries] of Object.entries(INNER_NAV)) {
      const keys = entries.map((e) => e.to)
      expect(new Set(keys).size, `${suite} has a duplicate room key`).toBe(keys.length)
    }
  })

  it("gives every room key a non-empty label", () => {
    for (const [suite, entries] of Object.entries(INNER_NAV)) {
      for (const e of entries) {
        expect(e.label.trim().length, `${suite}/${e.to} needs a label`).toBeGreaterThan(0)
      }
    }
  })
})
