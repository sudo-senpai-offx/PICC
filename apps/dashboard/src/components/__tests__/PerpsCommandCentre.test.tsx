// @vitest-environment jsdom
// PerpsCommandCentre is the FIRST perps UI in the app. It renders the durable
// positions + proposals the rail recorded, and every action re-confirms the
// EXACT payload it submits (per-action human consent — the enforcement stays
// server-side, the modal is the human doorway):
//   • propose POSTs the perps body (gate-check only, the venue is NOT touched)
//   • execute opens a reconfirm modal; confirm POSTs { clientOrderId, payload }
//     with the D5 open field set replayed from the durable proposal
//   • close opens a reconfirm modal locking the fresh exit price; confirm POSTs
//     { positionId, price, payload } with the D5 close field set
//   • verify stays read-only (carrier B)
// fetch is stubbed so no network ever leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { PerpsCommandCentre } from "@/components/PerpsCommandCentre"

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

async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  flushSync(() => {})
}

function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
  flushSync(() => {})
}

const positionsResult = {
  ok: true,
  consentBy: "default",
  positions: [
    {
      id: "venue-pos-1",
      symbol: "BTC/USDT",
      side: "long",
      size: 0.01,
      entryPrice: 62000,
      leverage: 5,
      marginUsd: 12.4,
      marginMode: "isolated",
      openedAt: "2026-09-20T00:00:00.000Z",
      openOrderId: "venue-pos-1",
      source: "persisted"
    }
  ],
  reconcile: { ok: true, closedUnobserved: [] },
  proposals: [
    {
      clientOrderId: "picc-perps-1",
      idempotencyKey: "perps:open:hyperliquid:picc-perps-1",
      exchange: "hyperliquid",
      symbol: "ETH/USDT",
      side: "buy",
      amount: 0.5,
      price: 2400,
      notionalUsd: 1200,
      marginUsd: 24,
      leverage: 25,
      marginMode: "isolated",
      clamped: true,
      rationale: "PERPS BUY ETH/USDT limit 0.5 @ 2400 (notional ~$1200, margin $24 at 25x isolated) within the per-position cap.",
      status: "open",
      kind: "open",
      positionId: null,
      proposedBy: "default",
      proposedAt: "2026-09-21T00:00:00.000Z"
    }
  ],
  at: "2026-09-21T00:00:01.000Z"
}

const unobservableResult = {
  ok: false,
  consentBy: "default",
  reason: "positions-unobservable: venue did not answer",
  positions: [],
  reconcile: { ok: false, reason: "positions-unobservable", closedUnobserved: [] },
  proposals: [],
  at: "2026-09-21T00:00:01.000Z"
}

const executeResult = {
  ok: true,
  consentBy: "default",
  gate: { allow: true, blockedBy: null },
  execution: { status: "executed", idempotencyKey: "perps:open:hyperliquid:picc-perps-1:exec" },
  state: { global: false, sites: {} }
}

const verifyResult = { ok: true, consentBy: "default", kind: "perps-verify:filled", clientOrderId: "picc-perps-1", at: "2026-09-21T00:00:03.000Z" }

function positionsFetch(posts?: { path: string; body: Record<string, unknown> }[]) {
  return vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST" && posts) {
      posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
    }
    return { ok: true, status: 200, json: async () => positionsResult } as unknown as Response
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("PerpsCommandCentre (slice 6b — the perps rail)", () => {
  it("renders the durable positions + proposals the rail recorded", async () => {
    vi.stubGlobal("fetch", positionsFetch())
    const m = mount(<PerpsCommandCentre />)
    await flushMicrotasks()
    const text = m.host.textContent ?? ""
    expect(text).toContain("Perps Command Centre")
    expect(text).toContain("long BTC/USDT")
    expect(text).toContain("Close")
    expect(text).toContain("open buy ETH/USDT")
    expect(text).toContain("Execute via PICC")
    expect(text).toContain("I placed it — verify")
    m.unmount()
  })

  it("propose gate-checks ONLY (no venue): POSTs the perps body and renders the recorded proposal", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(path).includes("/command-centre/perps/propose")) {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            consentBy: "default",
            gate: { allow: true, blockedBy: null },
            order: { exchange: "hyperliquid", symbol: "ETH/USDT", side: "buy", amount: 0.5, price: 2400, notionalUsd: 1200, marginUsd: 24, clamped: true, leverage: 25, marginMode: "isolated" },
            idempotencyKey: "perps:open:hyperliquid:picc-perps-1",
            clientOrderId: "picc-perps-1",
            at: "2026-09-21T00:00:00.500Z"
          })
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => positionsResult } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<PerpsCommandCentre />)
    await flushMicrotasks()
    setInput(m.host.querySelector('input[aria-label="perps symbol"]') as HTMLInputElement, "ETH/USDT")
    setInput(m.host.querySelector('input[aria-label="perps amount"]') as HTMLInputElement, "0.5")
    setInput(m.host.querySelector('input[aria-label="perps price"]') as HTMLInputElement, "2400")
    ;(m.host.querySelector('button[aria-label="gate perps order"]') as HTMLButtonElement).click()
    await flushMicrotasks()

    expect(posts).toEqual([
      {
        path: "/api/command-centre/perps/propose",
        body: { exchange: "hyperliquid", symbol: "ETH/USDT", side: "buy", amount: 0.5, price: 2400, leverage: 25, marginMode: "isolated" }
      }
    ])
    expect(m.host.textContent).toContain("proposal recorded as picc-perps-1")
    m.unmount()
  })

  it("execute opens the reconfirm modal; confirm POSTs { clientOrderId, payload } with the D5 open field set", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(path).includes("/command-centre/perps/execute")) {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return { ok: true, status: 200, json: async () => executeResult } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => positionsResult } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<PerpsCommandCentre reviewSeconds={0.3} />)
    await flushMicrotasks()
    ;(m.host.querySelector('button[aria-label="execute perps picc-perps-1"]') as HTMLButtonElement).click()
    flushSync(() => {})

    const modal = m.host.querySelector('div[role="dialog"]') as HTMLElement
    expect(modal).toBeTruthy()
    const modalText = modal.textContent ?? ""
    for (const expected of ["action", "open", "exchange", "hyperliquid", "symbol", "ETH/USDT", "side", "buy", "amount", "0.5", "price", "2400", "leverage", "25", "marginMode", "isolated", "clientOrderId", "picc-perps-1"]) {
      expect(modalText).toContain(expected)
    }
    expect(modalText).toContain(positionsResult.proposals[0].rationale)
    expect(modalText).toContain("consentBy: default")
    expect(posts).toHaveLength(0)

    await new Promise((r) => setTimeout(r, 650))
    flushSync(() => {})
    const ack = m.host.querySelector('input[aria-label="acknowledge exact payload"]') as HTMLInputElement
    ack.click()
    flushSync(() => {})
    const confirm = m.host.querySelector('button[aria-label="Confirm execution"]') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    confirm.click()
    await flushMicrotasks()

    expect(posts).toEqual([
      {
        path: "/api/command-centre/perps/execute",
        body: {
          clientOrderId: "picc-perps-1",
          payload: {
            action: "open",
            exchange: "hyperliquid",
            symbol: "ETH/USDT",
            side: "buy",
            amount: 0.5,
            price: 2400,
            leverage: 25,
            marginMode: "isolated",
            clientOrderId: "picc-perps-1"
          }
        }
      }
    ])
    expect(m.host.textContent).toContain("order executed (audit: execution:executed)")
    m.unmount()
  })

  it("cancel closes the execute modal without posting", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", positionsFetch(posts))
    const m = mount(<PerpsCommandCentre reviewSeconds={0.3} />)
    await flushMicrotasks()
    ;(m.host.querySelector('button[aria-label="execute perps picc-perps-1"]') as HTMLButtonElement).click()
    flushSync(() => {})
    expect(m.host.querySelector('div[role="dialog"]')).toBeTruthy()
    ;(m.host.querySelector('button[aria-label="cancel execution"]') as HTMLButtonElement).click()
    flushSync(() => {})
    expect(m.host.querySelector('div[role="dialog"]')).toBeNull()
    expect(posts).toHaveLength(0)
    m.unmount()
  })

  it("close opens the reconfirm modal locking the fresh exit price; confirm POSTs { positionId, price, payload }", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(path).includes("/command-centre/perps/close")) {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            consentBy: "default",
            gate: { allow: true, blockedBy: null },
            execution: { status: "executed", idempotencyKey: "perps:close:hyperliquid:venue-pos-1:exec" },
            state: { global: false, sites: {} }
          })
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => positionsResult } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<PerpsCommandCentre reviewSeconds={0.3} />)
    await flushMicrotasks()
    ;(m.host.querySelector('button[aria-label="close position venue-pos-1"]') as HTMLButtonElement).click()
    flushSync(() => {})

    const modal = m.host.querySelector('div[role="dialog"]') as HTMLElement
    expect(modal).toBeTruthy()
    let modalText = modal.textContent ?? ""
    // the close payload the human confirms: D-close set, exit price defaulted
    // to the recorded entry so the human edits the one field that matters
    for (const expected of ["action", "close", "exchange", "hyperliquid", "BTC/USDT", "positionId", "venue-pos-1", "sell", "0.01", "5", "62000"]) {
      expect(modalText).toContain(expected)
    }
    expect(modalText).toContain("Reduce-only exit")

    // a fresh exit price is locked into both the rendered payload and the body
    setInput(m.host.querySelector('input[aria-label="perps close price"]') as HTMLInputElement, "61400")
    modalText = modal.textContent ?? ""
    expect(modalText).toContain("61400")

    await new Promise((r) => setTimeout(r, 650))
    flushSync(() => {})
    const ack = m.host.querySelector('input[aria-label="acknowledge exact payload"]') as HTMLInputElement
    ack.click()
    flushSync(() => {})
    const confirm = m.host.querySelector('button[aria-label="Confirm close"]') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    confirm.click()
    await flushMicrotasks()

    expect(posts).toEqual([
      {
        path: "/api/command-centre/perps/close",
        body: {
          positionId: "venue-pos-1",
          price: 61400,
          payload: {
            action: "close",
            exchange: "hyperliquid",
            symbol: "BTC/USDT",
            positionId: "venue-pos-1",
            price: 61400,
            side: "sell",
            amount: 0.01,
            leverage: 5
          }
        }
      }
    ])
    expect(m.host.textContent).toContain("position reduced (audit: execution:executed)")
    m.unmount()
  })

  it("carrier B: the human places the order, the panel verifies the fill read-only", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(path).includes("/command-centre/perps/verify")) {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return { ok: true, status: 200, json: async () => verifyResult } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => positionsResult } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<PerpsCommandCentre />)
    await flushMicrotasks()
    setInput(m.host.querySelector('input[aria-label="perps venue order id for picc-perps-1"]') as HTMLInputElement, "venue-999")
    ;(m.host.querySelector('button[aria-label="verify perps fill picc-perps-1"]') as HTMLButtonElement).click()
    await flushMicrotasks()

    expect(posts).toEqual([
      { path: "/api/command-centre/perps/verify", body: { clientOrderId: "picc-perps-1", orderId: "venue-999" } }
    ])
    expect(m.host.textContent).toContain("fill verified read-only against the venue")
    m.unmount()
  })

  it("an unobservable venue renders honestly — positions are never fabricated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => unobservableResult
    } as unknown as Response)))
    const m = mount(<PerpsCommandCentre />)
    await flushMicrotasks()
    expect(m.host.textContent).toContain("positions-unobservable")
    expect(m.host.textContent).not.toContain("long BTC/USDT")
    m.unmount()
  })
})
