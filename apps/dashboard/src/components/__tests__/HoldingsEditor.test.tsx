// @vitest-environment jsdom
// REQ-C — the holdings editor writes nft_holdings / depin_nodes through the
// same server-backed CRUD as everything else. fetch is stubbed; no network.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { HoldingsEditor } from "@/components/HoldingsEditor"

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

function stubStore(initial: Record<string, unknown[]>) {
  const rows: Record<string, unknown[]> = JSON.parse(JSON.stringify(initial))
  const calls: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    calls.push(`${init?.method ?? "GET"} ${u}`)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const table = u.split("/")[3] ?? ""
    if (init?.method === "POST" && u.endsWith("/remove")) {
      rows[table] = (rows[table] ?? []).filter((r) => (r as { id: string }).id !== body.id)
      return { ok: true, status: 200, json: async () => ({ ok: true, removed: true }) } as unknown as Response
    }
    if (init?.method === "POST") {
      const row = { id: "gen-" + (rows[table]?.length ?? 0), created_at: new Date().toISOString(), user_id: null, ...body.row }
      rows[table] = [...(rows[table] ?? []), row]
      return { ok: true, status: 200, json: async () => ({ ok: true, row }) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rows: rows[table] ?? [] }) } as unknown as Response
  }))
  return { rows, calls }
}

// React 19: use the native setter so onChange sees the value.
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

const WAIT = { timeout: 5000 }

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("HoldingsEditor", () => {
  it("renders existing NFT rows and adds a new NFT through the form", async () => {
    const { calls } = stubStore({
      nft_holdings: [{ id: "n1", collection_name: "Bored Ape", blockchain: "Ethereum", purchase_price: 2, current_floor_price: 3 }],
      depin_nodes: []
    })
    mount(<HoldingsEditor />)

    await vi.waitFor(() => expect(document.body.textContent).toContain("Bored Ape"), WAIT)
    // P/L is computed, not stored: +50%.
    expect(document.body.textContent).toContain("+50%")

    const collection = Array.from(document.querySelectorAll("input")).find((i) => i.placeholder?.includes("Bored Ape"))!
    const buy = Array.from(document.querySelectorAll("input")).find((i) => i.placeholder === "0.00")!
    setInputValue(collection, "CryptoPunk")
    setInputValue(buy, "10")

    const add = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add NFT")!
    add.click()

    await vi.waitFor(() => expect(document.body.textContent).toContain("CryptoPunk"), WAIT)
    expect(calls.some((c) => c === "POST /api/data/nft_holdings")).toBe(true)
  })

  it("adds a DePIN node with its platform, type and earnings", async () => {
    stubStore({ nft_holdings: [], depin_nodes: [] })
    mount(<HoldingsEditor />)
    await vi.waitFor(() => expect(document.body.textContent).toContain("DePIN nodes"), WAIT)

    // Scope to the DePIN card — the NFT card has its own "0.00" inputs.
    const depinCard = Array.from(document.querySelectorAll("div.card")).find((c) => c.textContent?.includes("DePIN nodes"))!
    const inputs = Array.from(depinCard.querySelectorAll("input"))
    const daily = inputs.find((i) => i.placeholder === "0.00")!
    const total = inputs.filter((i) => i.placeholder === "0.00")[1]!
    setInputValue(daily, "0.4")
    setInputValue(total, "12.5")

    const add = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Add node")!
    add.click()

    await vi.waitFor(() => expect(document.body.textContent).toContain("Honeygain"), WAIT)
    // Monthly estimate is computed (0.4 * 30), not stored.
    await vi.waitFor(() => expect(document.body.textContent).toContain("$12.00/mo"), WAIT)
    expect(document.body.textContent).toContain("$12.50 total")
  })
})