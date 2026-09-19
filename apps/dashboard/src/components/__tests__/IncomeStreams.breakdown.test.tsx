// @vitest-environment jsdom
// Hub per-stream breakdown (UI-reskin REQ-D.1 / T8):
//  - every stream card links to the owning ministry's suite route, resolved
//    through the registry (familyToSuite) — never a hardcoded path
//  - an unknown family renders honestly (no dead link, "Uncategorized")
//  - zero streams renders an honest empty state, never fabricated cards
import { describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { hubBreakdown, StreamBreakdown } from "@/components/IncomeStreams"
import type { IncomeStream } from "@/lib/types"
import { familyToSuite } from "@/lib/registry"

function stream(over: Partial<IncomeStream>): IncomeStream {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test stream",
    category: "dividend",
    platform: "test",
    status: "active",
    balance: 0,
    totalEarned: 0,
    payoutThreshold: 0,
    payoutMethod: "—",
    estimatedDaily: 0,
    ...over
  }
}

function renderBreakdown(streams: IncomeStream[]) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter>
        <StreamBreakdown streams={streams} />
      </MemoryRouter>
    )
  })
  return {
    host,
    cleanup() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("hubBreakdown (registry-driven stream rows)", () => {
  it("resolves every family's owning suite route through the registry", () => {
    const rows = hubBreakdown([
      stream({ category: "dividend", balance: 12 }),
      stream({ category: "crypto", balance: 34 }),
      stream({ category: "defi", balance: 56 })
    ])
    expect(rows.map((r) => r.suite)).toEqual(["earnings", "trading", "intelligence"])
    for (const r of rows) {
      expect(r.to).toBe(`/suites/${familyToSuite(r.category)}`)
    }
  })

  it("labels each stream from the registry family label", () => {
    const rows = hubBreakdown([stream({ category: "content" })])
    expect(rows[0].family).toBe("Content")
  })

  it("handles an unknown family honestly: no suite, no dead link", () => {
    const rows = hubBreakdown([stream({ category: "other" as IncomeStream["category"] })])
    expect(rows[0].suite).toBeNull()
    expect(rows[0].to).toBe("")
    expect(rows[0].family).toBe("Uncategorized")
  })

  it("returns zero rows for zero streams", () => {
    expect(hubBreakdown([])).toEqual([])
  })
})

describe("StreamBreakdown render (hub per-stream cards)", () => {
  it("links every known-family stream card to its owning ministry route", () => {
    const m = renderBreakdown([
      stream({ name: "VOO dividends", category: "dividend" }),
      stream({ name: "SOL staking", category: "crypto" })
    ])
    const links = Array.from(m.host.querySelectorAll<HTMLAnchorElement>("a[data-testid='stream-card']"))
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/suites/earnings", "/suites/trading"])
    expect(links[0].textContent).toContain("VOO dividends")
    expect(links[0].textContent).toContain("Dividends")
    m.cleanup()
  })

  it("never renders a dead link for an unknown family", () => {
    const m = renderBreakdown([stream({ name: "Mystery", category: "other" as IncomeStream["category"] })])
    expect(m.host.querySelector("a[data-testid='stream-card']")).toBeNull()
    expect(m.host.textContent).toContain("Uncategorized")
    m.cleanup()
  })

  it("shows an honest empty state for zero streams", () => {
    const m = renderBreakdown([])
    expect(m.host.textContent).toContain("No streams yet")
    m.cleanup()
  })
})