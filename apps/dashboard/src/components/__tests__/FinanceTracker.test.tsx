// @vitest-environment jsdom
// PICC_FULL_SCOPE Part 2a — the finance tracker renders real account data,
// auto-creates the synced paper-trading account, and posts CRUD writes to the
// /api/data/* store. fetch is stubbed; no network ever leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { FinanceTracker } from "@/components/FinanceTracker"

// The trading-suite bridge must see a live paper balance so it auto-creates
// the synced account. fetch is stubbed below, but getPaperOverview is its own
// fetch call — mock the module instead.
vi.mock("@/lib/trading", () => ({
  getPaperOverview: vi.fn(async () => ({ ok: true, cash: 500 }))
}))

// React 19 tracks input values; a bare `.value = x` assignment never reaches
// onChange. Use the native setter, then dispatch the input event.
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

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

// Route-aware fetch stub over a mutable row store, mirroring localstore's
// /api/data/:table GET / POST / upsert / remove contract.
function stubStore(initial: Record<string, unknown[]>) {
  const rows: Record<string, unknown[]> = JSON.parse(JSON.stringify(initial))
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    calls.push(`${init?.method ?? "GET"} ${u}`)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const table = u.split("/")[3] ?? ""
    if (init?.method === "POST" && u.endsWith("/remove")) {
      rows[table] = (rows[table] ?? []).filter((r) => (r as { id: string }).id !== body.id)
      return { ok: true, status: 200, json: async () => ({ ok: true, removed: true }) } as unknown as Response
    }
    if (init?.method === "POST" && u.endsWith("/upsert")) {
      const row = { id: body.row?.id ?? "gen-u", created_at: new Date().toISOString(), user_id: null, ...body.row }
      rows[table] = [...(rows[table] ?? []).filter((r) => (r as { id: string }).id !== row.id), row]
      return { ok: true, status: 200, json: async () => ({ ok: true, row }) } as unknown as Response
    }
    if (init?.method === "POST") {
      const row = { id: "gen-" + (rows[table]?.length ?? 0), created_at: new Date().toISOString(), user_id: null, ...body.row }
      rows[table] = [...(rows[table] ?? []), row]
      return { ok: true, status: 200, json: async () => ({ ok: true, row }) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rows: rows[table] ?? [] }) } as unknown as Response
  })
  vi.stubGlobal("fetch", fetchMock)
  return { rows, calls, fetchMock }
}

// Under full-suite load a busy machine can stall the effect chain — wait
// generously before declaring failure.
const WAIT = { timeout: 5000 }

const savings = {
  id: "a1",
  name: "Savings",
  type: "asset",
  balance: 1000,
  currency: "USD",
  created_at: "2026-09-01T00:00:00Z",
  user_id: null
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("FinanceTracker", () => {
  it("renders accounts, computes net worth and auto-creates the synced paper account", async () => {
    const { fetchMock } = stubStore({ financial_accounts: [savings], transactions: [] })
    mount(<FinanceTracker />)

    await vi.waitFor(() => expect(document.body.textContent).toContain("Savings"), WAIT)
    // Net worth = savings 1000 + synced paper 500.
    await vi.waitFor(() => expect(document.body.textContent).toContain("$1,500.00"), WAIT)
    expect(document.body.textContent).toContain("linked · auto-synced")
    expect(document.body.textContent).toContain("Net worth (assets − liabilities)")
    // The trading bridge POSTed the new account.
    expect(fetchMock.mock.calls.some(([u, init]) => String(u).includes("financial_accounts") && init?.method === "POST")).toBe(true)
  })

  it("adds an account through the form and it appears with its balance", async () => {
    stubStore({ financial_accounts: [savings], transactions: [] })
    mount(<FinanceTracker />)
    await vi.waitFor(() => expect(document.body.textContent).toContain("Savings"), WAIT)

    const nameInput = Array.from(document.querySelectorAll("input")).find((i) => i.placeholder?.includes("Name"))!
    const balanceInput = Array.from(document.querySelectorAll("input")).find((i) => i.placeholder === "0.00")!
    setInputValue(nameInput, "Credit card")
    setInputValue(balanceInput, "-250")

    const addButton = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add account")!
    addButton.click()

    await vi.waitFor(() => expect(document.body.textContent).toContain("Credit card"), WAIT)
    await vi.waitFor(() => expect(document.body.textContent).toContain("-$250.00"), WAIT)
  })

  it("adds a transaction to the selected account and shows the running balance", async () => {
    stubStore({ financial_accounts: [savings], transactions: [] })
    mount(<FinanceTracker />)
    await vi.waitFor(() => expect(document.body.textContent).toContain("Savings"), WAIT)

    const descInput = Array.from(document.querySelectorAll("input")).find((i) => i.placeholder === "Description")!
    // Two number inputs carry the "0.00" placeholder (account balance + tx
    // amount) — the tx amount is the last one in the document.
    const amountInput = Array.from(document.querySelectorAll("input")).filter(
      (i) => i.type === "number" && i.placeholder === "0.00"
    ).at(-1)!
    setInputValue(descInput, "Coffee")
    setInputValue(amountInput, "-4.5")

    const addTx = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add transaction")!
    addTx.click()

    await vi.waitFor(() => expect(document.body.textContent).toContain("Coffee"), WAIT)
    // Running balance: 1000 - 4.5 = 995.5 → shown as $995.50.
    await vi.waitFor(() => expect(document.body.textContent).toContain("$995.50"), WAIT)
  })
})