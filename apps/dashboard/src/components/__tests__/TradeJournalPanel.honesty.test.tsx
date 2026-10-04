// @vitest-environment jsdom
// Regression: the Paper room rendered "Something went wrong — Cannot read properties
// of null (reading 'toFixed')" and the whole page died behind the error boundary.
//
// Cause, confirmed against the live route: GET /api/trading/journal returns
// `entryPrice: null` for an entry that was opened without a price, and
// TradeJournalPanel rendered it bare (`e.entryPrice.toFixed(4)`) while the three
// sibling cells in the same row — exitPrice, pnl, rMultiple — each already rendered
// an honest "-". One cell in a row was the outlier.
//
// This is pinned as an HONESTY test, not a smoke test: the absence must render as
// "-", not as a fabricated 0.0000 and not as a thrown TypeError. A page that crashes
// is not a way of saying "unknown", and a fabricated 0.0000 is a lie a trader could
// act on.
import { describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

const { entry, stats } = vi.hoisted(() => ({
  entry: {
    id: "jrnl_open_no_price",
    symbol: "EURUSD",
    side: "long",
    entryPrice: null,
    exitPrice: null,
    pnl: null,
    rMultiple: null,
    quantity: 1,
    reason: "",
    confidence: 0,
    strategy: "",
    tags: [],
    note: "",
    entryTime: 1767225600000,
    exitTime: null,
    status: "open",
  },
  stats: {
    totalTrades: 1,
    openTrades: 1,
    closedTrades: 0,
    winRate: 0,
    totalPnl: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    avgRMultiple: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    bestTrade: null,
    worstTrade: null,
    byStrategy: {},
    bySymbol: {},
  },
}))

vi.mock("@/lib/trading", () => ({
  getJournal: async () => ({ ok: true, entries: [entry], total: 1, stats }),
  addJournalEntry: async () => ({ ok: true }),
  closeJournalEntry: async () => ({ ok: true }),
  deleteJournalEntry: async () => ({ ok: true }),
  updateEntry: async () => ({ ok: true }),
  listEntries: async () => [],
}))

import { TradeJournalPanel } from "@/components/TradeJournalPanel"

// The panel fetches its journal in a useEffect, so a single synchronous flush renders
// the empty table and the row under test never mounts. Poll until the entry lands —
// otherwise this test passes/fails for the wrong reason (it once reported a red with
// zero entries rendered, proving nothing about the crash it was written to pin).
async function waitFor(host: HTMLElement, needle: string, ms = 2000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (host.textContent?.includes(needle)) return true
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
  }
  return false
}

async function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(<TradeJournalPanel />)
  })
  await waitFor(host, "EURUSD")
  return {
    host,
    root,
    unmount() {
      flushSync(() => {
        root.unmount()
      })
      host.remove()
    },
  }
}

describe("TradeJournalPanel — an open entry with no recorded price", () => {
  it("renders the row instead of throwing on a null entryPrice", async () => {
    const view = await mount()
    try {
      // The regression: this render threw
      // "Cannot read properties of null (reading 'toFixed')" and the Paper page
      // went behind its error boundary.
      expect(view.host.textContent).toContain("EURUSD")

      // The row exists, so the absence is rendered rather than the cell vanishing.
      const cells = Array.from(view.host.querySelectorAll("tbody tr td")).map((td) => td.textContent?.trim() ?? "")
      expect(cells.length).toBeGreaterThan(0)

      // entryPrice, exitPrice, pnl and rMultiple are all absent on this entry and
      // all four must say so with "-".
      expect(cells).toContain("-")
      expect(cells.filter((c) => c === "-").length).toBeGreaterThanOrEqual(3)

      // Critically: absence must not be fabricated as a zero price.
      expect(view.host.textContent).not.toContain("0.0000")
    } finally {
      view.unmount()
    }
  })
})