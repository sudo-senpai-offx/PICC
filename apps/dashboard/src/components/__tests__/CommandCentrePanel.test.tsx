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

// Drains the microtask chain an async handler queues (fetch is stubbed to a
// resolved promise) and yields a macrotask so React's passive-effect queue
// settles deterministically (reliable under BOTH fake and real timers).
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  flushSync(() => {})
}

const gate = (name: string, status: "pass" | "block" | "restricted" | "mechanism-on" | "not-wired" | "not-decided" = "pass", note = "") => ({ gate: name, status, note })

const overview = {
  ok: true,
  at: "2026-09-05T00:00:00.000Z",
  stream: "trading",
  killSwitch: { global: false, sites: {} },
  risk: {
    dayLossPct: 6.03,
    drawdownFromPeakPct: 12,
    halted: null,
    portfolioHeatUsd: 30,
    unobservable: [],
    reason: null,
    at: "2026-09-05T00:00:00.000Z"
  },
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("CommandCentrePanel (slice 4 surface)", () => {
  it("renders the server's verdict, the full 10-gate rail, and honest not-wired cells", async () => {
    stubFetch(overview)
    const m = mount(<CommandCentrePanel />)
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
    // the aggregate-risk strip renders what the server observed (M4 cell)
    expect(text).toContain("Aggregate risk")
    expect(text).toContain("day loss 6.03%")
    expect(text).toContain("drawdown 12%")
    expect(text).toContain("heat $30")
    expect(text).toContain("not halted")
    m.unmount()
  })

  it("renders no aggregate-risk strip when the server reports risk not-wired (null)", async () => {
    stubFetch({ ...overview, risk: null })
    const m = mount(<CommandCentrePanel />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).not.toContain("Aggregate risk")
    expect(text).not.toContain("day loss 6.03%")
    m.unmount()
  })

  it("renders the global-kill banner and BLOCKED verdicts when the switch is ON", async () => {
    stubFetch(blocked)
    const m = mount(<CommandCentrePanel />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("GLOBAL KILL ACTIVE")
    expect(text).toContain("BLOCKED")
    // the ON state is visible: both toggles carry the toggle-on class (the
    // shared Toggle's knob translation is that class — previously the hand-rolled
    // buttons never applied it, so "kill on" looked identical to "kill off")
    const globalToggle = m.host.querySelector('button[aria-label="global kill switch"]')
    expect(globalToggle?.className).toContain("toggle-on")
    const siteToggle = m.host.querySelector('button[aria-label="kill switch trading:ccxt"]')
    expect(siteToggle?.className).toContain("toggle-on")
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

    const m = mount(<CommandCentrePanel />)
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
    const m = mount(<CommandCentrePanel />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    expect(m.host.textContent).toContain("overview exploded")
    m.unmount()
  })
})

// ---- slice 6: the CCXT order rail (trading stream). ONE proposal, TWO carriers.
// Proposing only runs the gate + records the durable proposal (no venue touch);
// each carrier POST is a FRESH human action that the server gates again at click
// time against fresh observations. The panel renders exactly what the server
// answered — blocked/failed states are shown as blocked/failed, never as OK.
describe("CommandCentrePanel (slice 6 order rail)", () => {
  const tradingSite = {
    ...overview.sites[0],
    mode: "COPILOT" as const,
    executionPower: "proposals",
    executionLeg: {
      leg: "proposals",
      action: "ccxt:spot-order",
      inFlight: 0,
      lastExecutedAt: null,
      consent: "per-action human consent (consentBy) — NOT an automation opt-in"
    },
    gates: overview.sites[0].gates.map((g) =>
      g.gate === "envelope-within-ceiling" || g.gate === "rationale-renderable"
        ? { ...g, status: "pass" as const }
        : g
    )
  }

  const openOrder = {
    clientOrderId: "picc-ord-1",
    idempotencyKey: "ccxt:order:binance:picc-ord-1",
    exchange: "binance",
    symbol: "BTC/USDT",
    side: "buy" as const,
    amount: 0.01,
    price: 1000,
    notionalUsd: 10,
    clamped: false,
    rationale: "CCXT BUY BTC/USDT limit 0.01 @ 1000 (~$10 within the $10 envelope) — human-approved per-action.",
    status: "open" as const,
    proposedBy: "default",
    proposedAt: "2026-09-05T00:00:00.000Z"
  }

  it("propose gate-checks ONLY (no venue): POSTs the order, records the proposal, renders the open row with both carriers", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(path).includes("/command-centre/orders")) {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            consentBy: "default",
            gate: { allow: true, blockedBy: null },
            order: { exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000, notionalUsd: 10, clamped: false },
            idempotencyKey: "ccxt:order:binance:picc-ord-1",
            clientOrderId: "picc-ord-1",
            at: "2026-09-05T00:00:01.000Z"
          })
        } as unknown as Response
      }
      if (String(path).includes("/command-centre/orders")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, at: "2026-09-05T00:00:02.000Z", orders: posts.length > 0 ? [openOrder] : [] })
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ...overview, sites: [tradingSite] }) } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<CommandCentrePanel />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    expect(m.host.textContent).toContain("CCXT orders (trading)")

    const gateBtn = m.host.querySelector('button[aria-label="gate this order"]') as HTMLButtonElement
    expect(gateBtn).toBeTruthy()
    gateBtn.click()
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})

    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000 })
    const after = m.host.textContent ?? ""
    expect(after).toContain("proposal recorded as picc-ord-1")
    expect(after).toContain("open")
    expect(after).toContain("buy BTC/USDT")
    expect(after).toContain("Execute via PICC")
    expect(after).toContain("I placed it — verify")
    m.unmount()
  })

  it("Execute via PICC opens the reconfirm modal; confirm re-submits { clientOrderId, payload } with the EXACT replayed fields", async () => {
    // The human review window defaults to 5s in production; the panel takes an
    // optional reviewSeconds so the countdown is testable without wall-clock
    // waits. 0.3s here — the assertions still land INSIDE/after the window by
    // the real-time settle below.
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(path).includes("/command-centre/orders/execute")) {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: false,
            consentBy: "default",
            blockedBeforeVenue: true,
            gate: { allow: false, blockedBy: "fresh-data", reason: "BUY limit 1000 is 5.3% ABOVE the fresh reference 950 (5E)" },
            execution: null,
            state: { global: false, sites: {} }
          })
        } as unknown as Response
      }
      if (String(path).includes("/command-centre/orders")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, at: "2026-09-05T00:00:02.000Z", orders: [openOrder] })
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ...overview, sites: [tradingSite] }) } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<CommandCentrePanel reviewSeconds={0.3} />)
    await flushMicrotasks()
    const execute = m.host.querySelector('button[aria-label="execute via picc picc-ord-1"]') as HTMLButtonElement
    expect(execute).toBeTruthy()
    execute.click()
    flushSync(() => {})

    // the reconfirm modal renders the EXACT payload fields it will submit,
    // plus the approval rationale and the recorded consentBy — nothing has been
    // posted yet, the click alone is NOT consent.
    const modal = m.host.querySelector('div[role="dialog"]') as HTMLElement
    expect(modal).toBeTruthy()
    const modalText = modal.textContent ?? ""
    expect(modalText).toContain("exchange")
    expect(modalText).toContain("binance")
    expect(modalText).toContain("BTC/USDT")
    expect(modalText).toContain("buy")
    expect(modalText).toContain("0.01")
    expect(modalText).toContain("1000")
    expect(modalText).toContain("picc-ord-1")
    expect(modalText).toContain(openOrder.rationale)
    expect(modalText).toContain("consentBy: default")
    expect(posts).toHaveLength(0)

    // the confirm is gated by the countdown + checkbox: elapse the review
    // window (real clock, 0.3s review), acknowledge, then confirm POSTs
    // { clientOrderId, payload }.
    await new Promise((r) => setTimeout(r, 650))
    flushSync(() => {})
    const ack = m.host.querySelector('input[aria-label="acknowledge exact payload"]') as HTMLInputElement
    expect(ack).toBeTruthy()
    ack.click()
    flushSync(() => {})
    const confirm = m.host.querySelector('button[aria-label="Confirm execution"]') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    confirm.click()
    await flushMicrotasks()

    expect(posts).toEqual([
      {
        path: "/api/command-centre/orders/execute",
        body: {
          clientOrderId: "picc-ord-1",
          payload: { exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000, clientOrderId: "picc-ord-1" }
        }
      }
    ])
    const after = m.host.textContent ?? ""
    expect(after).toContain("refused before the venue: BUY limit 1000 is 5.3% ABOVE the fresh reference")
    expect(after).toContain("open") // the proposal is untouched — the card never fabricates success
    m.unmount()
  })

  it("the reconfirm modal gates the confirm behind the countdown AND the checkbox", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (String(path).includes("/command-centre/orders")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, at: "2026-09-05T00:00:02.000Z", orders: [openOrder] }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ...overview, sites: [tradingSite] }) } as unknown as Response
    }))

    const m = mount(<CommandCentrePanel reviewSeconds={2} />)
    await flushMicrotasks()
    ;(m.host.querySelector('button[aria-label="execute via picc picc-ord-1"]') as HTMLButtonElement).click()
    flushSync(() => {})

    const confirm = m.host.querySelector('button[aria-label="Confirm execution"]') as HTMLButtonElement
    const ack = m.host.querySelector('input[aria-label="acknowledge exact payload"]') as HTMLInputElement
    // the window is running: the box AND the confirm are locked
    expect(confirm.disabled).toBe(true)
    expect(ack.disabled).toBe(true)
    // mid-window (2s review → at ~1.2s we are inside it) still locked
    await new Promise((r) => setTimeout(r, 1200))
    flushSync(() => {})
    expect(confirm.disabled).toBe(true)
    expect(ack.disabled).toBe(true)
    // past the window the box unlocks, but the unchecked box keeps the confirm
    // disabled — one gate is "review elapsed", the other is "acknowledged this EXACT payload"
    await new Promise((r) => setTimeout(r, 1200))
    flushSync(() => {})
    expect(ack.disabled).toBe(false)
    expect(confirm.disabled).toBe(true)
    ack.click()
    flushSync(() => {})
    expect(confirm.disabled).toBe(false)
    m.unmount()
  })

  it("cancel closes the reconfirm modal without posting anything", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
      if (String(path).includes("/command-centre/orders")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, at: "2026-09-05T00:00:02.000Z", orders: [openOrder] }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ...overview, sites: [tradingSite] }) } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<CommandCentrePanel reviewSeconds={0.3} />)
    await flushMicrotasks()
    ;(m.host.querySelector('button[aria-label="execute via picc picc-ord-1"]') as HTMLButtonElement).click()
    flushSync(() => {})
    expect(m.host.querySelector('div[role="dialog"]')).toBeTruthy()

    ;(m.host.querySelector('button[aria-label="cancel execution"]') as HTMLButtonElement).click()
    flushSync(() => {})
    expect(m.host.querySelector('div[role="dialog"]')).toBeNull()
    expect(posts).toHaveLength(0)
    m.unmount()
  })

  it("carrier B: the human places the order, the panel verifies the fill read-only via the venue order id", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(path).includes("/command-centre/orders/verify")) {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, consentBy: "default", kind: "ccxt-verify:filled", clientOrderId: "picc-ord-1", at: "2026-09-05T00:00:03.000Z" })
        } as unknown as Response
      }
      if (String(path).includes("/command-centre/orders")) {
        const settled = posts.length > 0 ? [{ ...openOrder, status: "verified-filled" as const }] : [openOrder]
        return { ok: true, status: 200, json: async () => ({ ok: true, at: "2026-09-05T00:00:02.000Z", orders: settled }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ ...overview, sites: [tradingSite] }) } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<CommandCentrePanel />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const input = m.host.querySelector('input[aria-label="venue order id for picc-ord-1"]') as HTMLInputElement
    expect(input).toBeTruthy()
    // the field is styled with the shared .input class (dark-theme bg/border),
    // not a bare native input on the light default
    expect(input.className).toContain("input")
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    valueSetter?.call(input, "venue-314")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    flushSync(() => {})

    const verify = m.host.querySelector('button[aria-label="verify fill picc-ord-1"]') as HTMLButtonElement
    expect(verify.disabled).toBe(false)
    verify.click()
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})

    expect(posts).toEqual([{ path: "/api/command-centre/orders/verify", body: { clientOrderId: "picc-ord-1", orderId: "venue-314" } }])
    const after = m.host.textContent ?? ""
    expect(after).toContain("fill verified read-only against the venue")
    expect(after).toContain("verified-filled")
    m.unmount()
  })
})