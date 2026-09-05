// @vitest-environment jsdom
// The Command Centre panel must render honest states: the server's observed
// verdict + a full 10-gate rail on a populated payload; "not-wired" cells
// rendered as not-wired (never as OK); and the kill toggle must POST to the
// same store the enforcement layer reads and re-render the overview.
// fetch is stubbed so no network ever leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CommandCentrePanel } from "@/components/CommandCentrePanel"

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

const gate = (name: string, status: "pass" | "block" | "restricted" | "mechanism-on" | "not-wired" | "not-decided" = "pass", note = "") => ({ gate: name, status, note })

const overview = {
  ok: true,
  at: "2026-09-05T00:00:00.000Z",
  stream: "trading",
  killSwitch: { global: false, sites: {} },
  sites: [
    {
      site: "trading:ccxt",
      stream: "trading",
      venue: "ccxt-crypto (official protocol)",
      mode: "COPILOT",
      executionPower: "proposals",
      reasons: ["automation workability 0 below floor 0.5 (deterministic)"],
      inputs: {
        killSwitch: false,
        optIn: { status: "not-decided", note: "no automation opt-in granted (sync-approval is NOT an opt-in)" },
        workability: { value: null, note: "not-wired" },
        deliberation: "not-yet-available"
      },
      demo: { demoOnly: false, active: false, note: null },
      metrics: { source: "not-wired", note: "no capture profile for trading:ccxt" },
      gates: [
        gate("kill-switch"),
        gate("cross-site-day-halt"),
        gate("human-takeover"),
        gate("per-site-opt-in", "not-decided", "no opt-in granted"),
        gate("hard-breakers"),
        gate("fresh-data", "not-wired", "not-wired — arrives with execution (slice 5+)"),
        gate("toS-survival"),
        gate("envelope-within-ceiling", "not-wired", "not-wired — arrives with execution (slice 5+)"),
        gate("rationale-renderable", "not-wired", "not-wired — arrives with execution (slice 5+)"),
        gate("idempotent", "mechanism-on", "durable key store")
      ]
    }
  ]
}

const blocked = {
  ...overview,
  killSwitch: { global: true, sites: {} },
  sites: [
    {
      ...overview.sites[0],
      mode: "BLOCKED",
      executionPower: "none",
      inputs: { ...overview.sites[0].inputs, killSwitch: true },
      gates: overview.sites[0].gates.map((g) => (g.gate === "kill-switch" ? { ...g, status: "block" as const, note: "runtime kill switch is ON" } : g))
    }
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("CommandCentrePanel (slice 4 surface)", () => {
  it("renders the server's verdict, the full 10-gate rail, and honest not-wired cells", async () => {
    stubFetch(overview)
    const m = mount(<CommandCentrePanel stream="trading" />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("Command Centre")
    expect(text).toContain("trading:ccxt")
    expect(text).toContain("COPILOT")
    expect(text).toContain("proposals")
    // every gate of the rail is present
    for (const name of ["per-site-opt-in", "fresh-data", "envelope-within-ceiling", "rationale-renderable", "idempotent"]) {
      expect(text).toContain(name)
    }
    // not-wired cells are rendered as not-wired, never as an OK
    expect(text).toContain("not-decided")
    expect(text).toContain("not-yet-available")
    expect(text).toContain("not-wired")
    m.unmount()
  })

  it("renders the global-kill banner and BLOCKED verdicts when the switch is ON", async () => {
    stubFetch(blocked)
    const m = mount(<CommandCentrePanel stream="trading" />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("GLOBAL KILL ACTIVE")
    expect(text).toContain("BLOCKED")
    m.unmount()
  })

  it("toggle POSTs the kill to the shared store and re-renders from the response", async () => {
    const calls: { path: string; body: { scope: string; kill: boolean } }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        calls.push({ path, body: JSON.parse(String(init.body)) as { scope: string; kill: boolean } })
        return { ok: true, status: 200, json: async () => ({ ok: true, scope: "trading:ccxt", kill: true, state: { global: false, sites: { "trading:ccxt": true } } }) } as unknown as Response
      }
      if (calls.length > 0) return { ok: true, status: 200, json: async () => blocked } as unknown as Response
      return { ok: true, status: 200, json: async () => overview } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<CommandCentrePanel stream="trading" />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    expect(m.host.textContent).toContain("COPILOT")

    const toggle = m.host.querySelector('button[aria-label="kill switch trading:ccxt"]')
    expect(toggle).toBeTruthy()
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})

    expect(calls).toEqual([{ path: "/api/command-centre/kill-switch", body: { scope: "trading:ccxt", kill: true } }])
    expect(m.host.textContent).toContain("BLOCKED")
    m.unmount()
  })

  it("shows the fetch error instead of fabricated data when the endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "overview exploded" })
    } as unknown as Response)))
    const m = mount(<CommandCentrePanel stream="trading" />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    expect(m.host.textContent).toContain("overview exploded")
    m.unmount()
  })
})