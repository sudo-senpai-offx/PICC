// @vitest-environment jsdom
// B-PAP-2/B-PAP-4 component twin: the portfolio aggregate renders the two
// money buckets (paper vs EO demo) as SEPARATELY-labeled rows — never one
// merged "Today P&L (+$N)" chip. Paper exposure renders per-venue too, so a
// summed notional is never the only exposure number on screen.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { getPortfolioAggregate } from "@/lib/trading"
import { PortfolioAggregatePanel } from "@/components/PortfolioAggregatePanel"

vi.mock("@/lib/trading", () => ({
  getPortfolioAggregate: vi.fn()
}))

function aggregateFixture(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    generatedAt: "2026-08-31T00:00:00.000Z",
    positions: [
      { venue: "paper", id: "p1", symbol: "EURUSD", side: "up", entry: 1.08, amount: 100, openedAt: "2026-08-30T10:00:00Z" }
    ],
    byInstrument: {
      EURUSD: { symbol: "EURUSD", totalSize: 100, positions: 1, avgEntry: 1.08, venues: ["paper"], hedged: false }
    },
    venues: [
      { venue: "paper", totalSize: 100, positions: 1 },
      { venue: "expertoption", totalSize: 250, positions: 1 }
    ],
    totals: { openPositions: 2, notional: 350, instruments: 1 },
    todayPnl: {
      paper: { pnl: 12.5, trades: 2 },
      expertoption: { pnl: -4.5, trades: 1 }
    },
    riskCheck: null,
    ...over
  }
}

function mount(paperAvailable = true) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<PortfolioAggregatePanel paperAvailable={paperAvailable} />) })
  return { host, root, unmount() { flushSync(() => { root.unmount() }); document.body.removeChild(host) } }
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
  flushSync(() => {})
}

describe("PortfolioAggregatePanel bucket separation (B-PAP-2)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("renders paper and EO-demo P&L as two separately-labeled rows", async () => {
    vi.mocked(getPortfolioAggregate).mockResolvedValue(aggregateFixture() as never)
    const { host, unmount } = mount()
    await waitFor(() => host.textContent?.includes("Paper P&L (simulated)") === true, "paper row")

    const text = host.textContent ?? ""
    expect(text).toContain("Paper P&L (simulated)")
    expect(text).toContain("+$12.5")
    expect(text).toContain("EO demo P&L")
    expect(text).toContain("$-4.5")
    // The merged "+$8" (12.5 + -4.5) number must NOT exist on the surface.
    expect(text).not.toContain("+$8")
    expect(text).not.toContain("Today P&L")
    unmount()
  })

  it("renders per-venue exposure instead of only a merged Notional chip", async () => {
    vi.mocked(getPortfolioAggregate).mockResolvedValue(aggregateFixture() as never)
    const { host, unmount } = mount()
    await waitFor(() => host.textContent?.includes("paper exposure") === true, "per-venue exposure")

    const text = host.textContent ?? ""
    expect(text).toContain("paper exposure")
    expect(text).toContain("$100")
    expect(text).toContain("expertoption exposure")
    expect(text).toContain("$250")
    // A bare "Notional $350" merged chip is gone (350 = 100 + 250).
    expect(text).not.toMatch(/Notional\s*\$350/)
    unmount()
  })

  it("old zero-PnL event correctness: empty buckets still render honestly", async () => {
    const agg = aggregateFixture({
      venues: [],
      positions: [],
      byInstrument: {},
      totals: { openPositions: 0, notional: 0, instruments: 0 },
      todayPnl: { paper: { pnl: 0, trades: 0 }, expertoption: null }
    })
    vi.mocked(getPortfolioAggregate).mockResolvedValue(agg as never)
    const { host, unmount } = mount()
    await waitFor(() => host.textContent?.includes("Paper P&L (simulated)") === true, "zero paper row")

    const text = host.textContent ?? ""
    expect(text).toContain("$0")
    expect(text).toContain("No open positions observed across venues")
    unmount()
  })
})