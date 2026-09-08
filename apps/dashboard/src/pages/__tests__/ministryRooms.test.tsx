// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import App from "@/App"

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
})
