// @vitest-environment jsdom
// C2 — the Command Deck spine (PICC_COPILOT_REDESIGN ch.3): the trading
// Dashboard stacks Watch → Decide → Dispatch → Act vertically, surfacing the
// Soak bay and the Dispatch strip alongside the existing suite cards.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { DashboardRoom } from "../DashboardRoom"

let mockSnapshot: { ts: number; v32: unknown; dispatch: { unread: number; entries: unknown[] } | null } = {
  ts: Date.now(), v32: null, dispatch: { unread: 1, entries: [{ id: "d1", kind: "decision", severity: "info", title: "Soak milestone", ts: 100, read: false }] }
}

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ snapshot: mockSnapshot, live: null, connected: true, error: null })
}))
vi.mock("@/lib/trading", async (orig) => {
  const real = await orig<typeof import("@/lib/trading")>()
  return { ...real, getTradingStatus: vi.fn(async () => ({ paper: { cash: 100, balance: 100, equity: 100, riskPerTradePct: 2 }, riskPerTradePct: 2 })) }
})
vi.mock("@/lib/liveTrading", async (orig) => {
  const real = await orig<typeof import("@/lib/liveTrading")>()
  return { ...real, getTradingDecisions: vi.fn(async () => ({ ts: Date.now(), status: "connected", mode: "paper", account: null, viewed: null, decisions: [] })) }
})

describe("DashboardRoom — Command Deck spine", () => {
  beforeEach(() => { mockSnapshot = { ts: Date.now(), v32: null, dispatch: { unread: 1, entries: [{ id: "d1", kind: "decision", severity: "info", title: "Soak milestone", ts: 100, read: false }] } } })
  afterEach(() => { vi.clearAllMocks() })

  it("stacks the Watch → Decide → Dispatch → Act spine and shows the Soak bay", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => { root.render(<MemoryRouter><DashboardRoom /></MemoryRouter>) })
    const text = host.textContent ?? ""
    expect(text).toContain("Watch")
    expect(text).toContain("Decide")
    expect(text).toContain("Dispatch")
    expect(text).toContain("Act")
    // Soak bay + dispatch strip present (honest empty v32 state renders the vault note)
    expect(text).toContain("awaiting live buffers")
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })
})