// @vitest-environment jsdom
// WS-6 T5 — dense virtualized table (RED, AC-004).
//
// AC-004 requires 10,000 rows with a BOUNDED DOM, deterministic headers, keyboard
// focus, and honest unavailable behaviour. Critically: a table must not create a
// second data source, and must never treat empty/unconfigured as zero — the
// exact defect class removed by the order-flow P0.
import { describe, expect, it, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { DenseTable } from "../DenseTable"

let mounted: Array<{ unmount: () => void }> = []

function render(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(node))
  mounted.push({
    unmount() {
      flushSync(() => root.unmount())
      document.body.removeChild(host)
    }
  })
  return host
}

afterEach(() => {
  mounted.forEach((m) => m.unmount())
  mounted = []
})

const columns = [
  { key: "symbol", header: "Symbol", width: 120 },
  { key: "price", header: "Price", width: 100 }
]

const rows10k = Array.from({ length: 10_000 }, (_, i) => ({ symbol: `SYM-${i}`, price: i }))

describe("DenseTable — bounded DOM at scale (AC-004)", () => {
  it("renders 10,000 rows without putting 10,000 nodes in the DOM", () => {
    const host = render(<DenseTable rows={rows10k} columns={columns} rowHeight={24} height={480} />)
    const bodyRows = host.querySelectorAll("[data-row-index]")
    expect(bodyRows.length).toBeGreaterThan(0)
    expect(bodyRows.length, "DOM must stay bounded, not render every row").toBeLessThan(200)
  })

  it("reports the true total row count without rendering it", () => {
    const host = render(<DenseTable rows={rows10k} columns={columns} rowHeight={24} height={480} />)
    expect(host.querySelector("[data-total-rows]")?.getAttribute("data-total-rows")).toBe("10000")
  })

  it("renders a deterministic header row in the declared order", () => {
    const host = render(<DenseTable rows={rows10k} columns={columns} rowHeight={24} height={480} />)
    const headers = [...host.querySelectorAll("[data-column-key]")].map((h) => h.getAttribute("data-column-key"))
    expect(headers).toEqual(["symbol", "price"])
  })

  it("renders the first window's rows at the top", () => {
    const host = render(<DenseTable rows={rows10k} columns={columns} rowHeight={24} height={480} />)
    expect(host.querySelector("[data-row-index='0']")?.textContent).toContain("SYM-0")
  })

  it("handles a small row set without virtualization artefacts", () => {
    const host = render(
      <DenseTable rows={[{ symbol: "A", price: 1 }]} columns={columns} rowHeight={24} height={480} />
    )
    expect(host.querySelectorAll("[data-row-index]").length).toBe(1)
    expect(host.textContent).toContain("A")
  })

  it("renders an empty state that does not claim zero rows of data", () => {
    const host = render(<DenseTable rows={[]} columns={columns} rowHeight={24} height={480} />)
    expect(host.textContent).toMatch(/no rows/i)
    // An empty array is an observed empty set, not an unconfigured source.
    expect(host.querySelector("[data-total-rows]")?.getAttribute("data-total-rows")).toBe("0")
  })
})

describe("DenseTable — accessibility (AC-004, AC-016)", () => {
  it("exposes a table role with a row count for assistive tech", () => {
    const host = render(<DenseTable rows={rows10k} columns={columns} rowHeight={24} height={480} />)
    const grid = host.querySelector("[role='grid']")
    expect(grid).not.toBeNull()
    expect(grid?.getAttribute("aria-rowcount")).toBe("10000")
  })

  it("gives the grid an accessible name", () => {
    const host = render(
      <DenseTable rows={rows10k} columns={columns} rowHeight={24} height={480} label="Markets" />
    )
    expect(host.querySelector("[role='grid']")?.getAttribute("aria-label")).toBe("Markets")
  })

  it("marks rendered rows with their absolute index for keyboard navigation", () => {
    const host = render(<DenseTable rows={rows10k} columns={columns} rowHeight={24} height={480} />)
    const first = host.querySelector("[data-row-index='0']")
    expect(first?.getAttribute("role")).toBe("row")
    expect(first?.getAttribute("tabindex")).toBe("0")
  })
})
