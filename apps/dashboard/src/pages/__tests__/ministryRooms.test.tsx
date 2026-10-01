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
  fetchMe: async () => ({ kind: "confirmed", user: { id: "u", name: "SP0 Observer", email: "sp0.observer@picc.local" } }),
  shouldClearStoredSession: (r: { kind: string }) => r?.kind === "rejected",
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
 *
 * AMENDED 2026-09-30 (WS-7 T7R-A) — see the header line above: the spec WAS
 * amended. The owner authorised four new keys (`risk`, `ceremony`, `ministry`,
 * `strategy`), taking the inventory from 18 instances / 11 distinct keys to
 * 22 / 15. Two values below are MOVED to their new true values as a result —
 * the ordered `trading` list (9 -> 13) and the cross-suite total (18 -> 22).
 * Neither was deleted, skipped, or weakened, and the ordered list remains an
 * exact pin rather than a length check.
 *
 * The amendment is recorded at
 * `docs/specs/PICC_TRADING_SUITE_WS6_TERMINAL_UI_REBUILD_v1.md` §0.3 "Room
 * keys" and in
 * `docs/trading-logic/changelog/entries/0027-T7RA_WS6_ROOM_KEY_AMENDMENT-v1-to-v2.md`.
 */
describe("WS-6 T0 — ministry room keys are frozen (spec §0.3, amended 2026-09-30)", () => {
  it("exposes exactly three suites", () => {
    expect(Object.keys(INNER_NAV).sort()).toEqual(["earnings", "intelligence", "trading"])
  })

  it("freezes the trading suite room keys, in order", () => {
    // MOVED 2026-09-30: 9 keys -> 13. The four authorised keys sit at their D1
    // order positions (Markets -> Risk -> Ceremony -> Ministry -> Strategy ->
    // Paper/Live, `...MATURITY_v1.md:97`), so `markets` is entry 2 and `paper`
    // is entry 7. Still an exact ordered `toEqual`, not a length or membership
    // check: the order is the part that would drift silently.
    expect(INNER_NAV.trading.map((e) => e.to)).toEqual([
      "dashboard",
      "markets",
      "risk",
      "ceremony",
      "ministry",
      "strategy",
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

  it("keeps the total room-key count at 22 across all suites", () => {
    // MOVED 2026-09-30: 18 -> 22. trading 13 + earnings 4 + intelligence 5.
    const total = Object.values(INNER_NAV).reduce((n, entries) => n + entries.length, 0)
    expect(total).toBe(22)
  })

  it("carries 15 distinct keys across 22 instances, so the total is not a free-floating 22", () => {
    // The count above is only meaningful beside the distinct-key count, and
    // neither number is meaningful unless the FOUR keys that caused the move are
    // actually present. A `22` reached by some other combination — a rename, a
    // duplicate, an unrelated addition — would satisfy a bare total, so the
    // four authorised keys are asserted by name here.
    const instances = Object.values(INNER_NAV).flatMap((entries) => entries.map((e) => e.to))
    expect(instances).toHaveLength(22)
    expect(new Set(instances).size, "22 instances across 15 distinct keys").toBe(15)

    const trading = new Set(INNER_NAV.trading.map((e) => e.to))
    for (const key of ["risk", "ceremony", "ministry", "strategy"] as const) {
      expect(trading.has(key), `the authorised key "${key}" must be present in the trading suite`).toBe(true)
    }
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
