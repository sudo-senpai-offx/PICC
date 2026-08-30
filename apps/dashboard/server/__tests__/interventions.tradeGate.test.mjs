import { describe, expect, it, vi, beforeEach, afterAll } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetU4faRiskState } from "../services/u4faRisk.mjs"

const dir = mkdtempSync(join(tmpdir(), "picc-tradegate-"))
process.env.PICC_DATA_DIR = dir

vi.mock("../services/browserStudio.mjs", () => ({
  studioBroadcast: vi.fn(),
  studioIsOpen: () => true,
  studioPageFor: () => fakePage,
  studioTypeText: vi.fn(async () => {})
}))

vi.mock("../services/browserBridge.mjs", () => ({
  readPage: vi.fn(async () => ({ balance: "$1,234" }))
}))

// T11 acceptance: approve -> exactly ONE openPaperTrade with the U4FA order
// shape; the barrier/cap/cooldown feeds come from the REAL paper ledger shape
// (closed entries: { pnl, closedAt }) + accuracy-ledger misses.
const trading = vi.hoisted(() => ({
  paperOverview: vi.fn(async () => ({ starting: 10000, cash: 10000, committed: 0, realizedPnl: 0, openCount: 0, closedCount: 0 })),
  paperHistory: vi.fn(async () => []),
  openPaperTrade: vi.fn(async (o) => ({ id: "paper-abc", ...o, status: "open" }))
}))
vi.mock("../services/trading.mjs", () => trading)

const ledger = vi.hoisted(() => ({
  ledgerHistory: vi.fn(async () => ({ entries: [] }))
}))
vi.mock("../services/accuracyLedger.mjs", () => ledger)

const loc = {
  waitFor: vi.fn(async () => {}),
  click: vi.fn(async () => {}),
  innerText: vi.fn(async () => "Submit order")
}
const fakePage = {
  locator: vi.fn(() => ({ first: () => loc })),
  keyboard: { press: vi.fn(async () => {}), type: vi.fn(async () => {}) },
  goto: vi.fn(async () => {}),
  waitForTimeout: vi.fn(async () => {})
}

const NOW = Date.parse("2026-03-10T12:00:00Z") // fixed UTC instant (outside VITEST clock concerns)
const iso = (ts) => new Date(ts).toISOString()
const UTC_DAY = new Date(NOW).toISOString().slice(0, 10)

const ORDER = { symbol: "EURUSD", direction: "up", entry: 1.0854321, expiry: 300, takeProfit: 1.09, stopLoss: 1.08, signalId: "sig-1", summary: "U4FA EURUSD 5m" }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function settle() {
  for (let i = 0; i < 50; i++) {
    await sleep(5)
    const s = m.listInterventions()
    if (!s.running || ["done", "error", "aborted", "interrupted"].includes(s.running.status)) return s
  }
  return m.listInterventions()
}

let m
beforeEach(async () => {
  vi.clearAllMocks()
  trading.paperOverview.mockResolvedValue({ starting: 10000, cash: 10000, committed: 0, realizedPnl: 0, openCount: 0, closedCount: 0 })
  trading.paperHistory.mockResolvedValue([])
  ledger.ledgerHistory.mockResolvedValue({ entries: [] })
  // u4faRisk.mjs is statically imported by interventions.mjs (one module
  // instance per process, even though each test re-imports interventions with
  // a cache-busting query) — its UTC day-latch must be reset per test.
  resetU4faRiskState()
  m = await import("../services/interventions.mjs?case=tradegate-" + Math.random())
})

afterAll(() => {
  delete process.env.PICC_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("interventions — U4FA trade gate (T11): proposal lifecycle", () => {
  it("proposeTrade raises a pending source:trade proposal surfaced by /api/browser/interventions", async () => {
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(r.ok).toBe(true)
    expect(r.status).toBe("pending")
    const s = m.listInterventions()
    const p = s.proposals.find((x) => x.source === "trade")
    expect(p).toBeTruthy()
    expect(p.action).toBe("order")
    expect(p.risk).toBe("high")
    expect(p.status).toBe("pending")
    expect(p.label).toContain("U4FA up EURUSD (300s)")
    expect(p.detail).toContain("PAPER ONLY")
    expect(p.detail).toContain("stake $50.00") // 0.5% of $10,000 (Decision A)
  })

  it("a second proposeTrade while one is pending returns the same id (no dupes)", async () => {
    const a = await m.proposeTrade({ ...ORDER }, { now: NOW })
    const b = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(b.id).toBe(a.id)
    expect(b.duplicate).toBe(true)
    expect(m.listInterventions().proposals.filter((x) => x.source === "trade")).toHaveLength(1)
  })

  it("approve → exactly one openPaperTrade call with the U4FA order shape, proposal approved", async () => {
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    await m.respondIntervention({ id: r.id, decision: "approve" })
    expect(trading.openPaperTrade).toHaveBeenCalledTimes(1)
    expect(trading.openPaperTrade).toHaveBeenCalledWith({
      symbol: "EURUSD",
      side: "up",
      entry: 1.085432, // rounded to 1e-6 like every paper order
      amount: 50,
      takeProfit: 1.09,
      stopLoss: 1.08,
      signalId: "sig-1"
    })
    expect(m.listInterventions().proposals.find((x) => x.id === r.id).status).toBe("approved")
  })

  it("reject → zero openPaperTrade calls, proposal rejected", async () => {
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    await m.respondIntervention({ id: r.id, decision: "reject" })
    expect(trading.openPaperTrade).not.toHaveBeenCalled()
    expect(m.listInterventions().proposals.find((x) => x.id === r.id).status).toBe("rejected")
  })

  it("a decided gate re-arms on the next propose with a FRESH proposal", async () => {
    const a = await m.proposeTrade({ ...ORDER }, { now: NOW })
    await m.respondIntervention({ id: a.id, decision: "reject" })
    const b = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(b.id).not.toBe(a.id)
    expect(b.status).toBe("pending")
  })

  it("responding twice to the same proposal throws (no double order)", async () => {
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    await m.respondIntervention({ id: r.id, decision: "approve" })
    await expect(m.respondIntervention({ id: r.id, decision: "approve" })).rejects.toThrow(/no pending intervention/)
    expect(trading.openPaperTrade).toHaveBeenCalledTimes(1)
  })

  it("declares the ≥1-unit risk floor honestly when 0.5% of balance binds", async () => {
    trading.paperOverview.mockResolvedValue({ starting: 100, cash: 100, committed: 0, realizedPnl: 0 })
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(r.amount).toBe(1)
    expect(r.floorApplied).toBe(true)
    expect(m.listInterventions().proposals.find((x) => x.source === "trade").detail).toContain("risk floor $1")
  })

  it("a malformed proposal is a loud throw, never a silent skip", async () => {
    await expect(m.proposeTrade({ symbol: "EURUSD", direction: "maybe", entry: 1.08, expiry: 300 })).rejects.toThrow(/direction up\|down/)
    await expect(m.proposeTrade({ symbol: "", direction: "up", entry: 1.08, expiry: 300 })).rejects.toThrow(/needs a symbol/)
    await expect(m.proposeTrade({ symbol: "EURUSD", direction: "up", entry: 0, expiry: 300 })).rejects.toThrow(/entry price/)
    await expect(m.proposeTrade({ symbol: "EURUSD", direction: "up", entry: 1.08, expiry: 30 })).rejects.toThrow(/expiry/)
  })
})

describe("interventions — U4FA trade gate (T10): risk mapping binds at proposal time", () => {
  it("a −5% UTC-day PnL of the day-start balance blocks with the barrier reason", async () => {
    const dayPnl = -500 // -5% of $10,000
    trading.paperHistory.mockResolvedValue([{ pnl: dayPnl, closedAt: iso(NOW - 60 * 60 * 1000) }]) // 1h ago, same UTC day
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(r.ok).toBe(false)
    expect(r.status).toBe("blocked")
    expect(r.reason).toMatch(/daily loss barrier/)
    expect(m.listInterventions().proposals.filter((x) => x.source === "trade")).toHaveLength(0)
  })

  it("the 11th U4FA proposal of one UTC day is refused with the cap reason", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
      expect(r.ok).toBe(true)
      await m.respondIntervention({ id: r.id, decision: "reject" })
    }
    const eleventh = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(eleventh.ok).toBe(false)
    expect(eleventh.reason).toMatch(/daily proposal cap 10/)
    expect(trading.openPaperTrade).not.toHaveBeenCalled()
  })

  it("day-rollover at 00:00:01 GMT resets the proposal counter", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
      expect(r.ok).toBe(true)
      await m.respondIntervention({ id: r.id, decision: "reject" })
    }
    expect((await m.proposeTrade({ ...ORDER }, { now: NOW })).ok).toBe(false) // day-1 cap closes
    const nextDay = Date.parse(`${UTC_DAY}T00:00:00Z`) + 24 * 3600 * 1000 + 1000 // 00:00:01 GMT next day
    const c = await m.proposeTrade({ ...ORDER }, { now: nextDay })
    expect(c.ok).toBe(true) // fresh counter after the UTC rollover
    expect(c.dayKey).not.toBe(UTC_DAY)
  })

  it("the 15-min post-loss throttle suppresses NEW proposals after a resolved loss", async () => {
    trading.paperHistory.mockResolvedValue([{ pnl: -10, closedAt: iso(NOW - 60 * 1000) }]) // loss 1 min ago
    const blocked = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toMatch(/post-loss cooldown/)

    trading.paperHistory.mockResolvedValue([{ pnl: -10, closedAt: iso(NOW - 20 * 60 * 1000) }]) // loss 20 min ago → cleared
    const allowed = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(allowed.ok).toBe(true)
  })

  it("the throttle also suppresses from accuracy-ledger misses", async () => {
    ledger.ledgerHistory.mockResolvedValue({ entries: [{ result: "miss", resolvedAt: iso(NOW - 120 * 1000) }] })
    const blocked = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toMatch(/post-loss cooldown/)
  })
})

describe("interventions — trade gate vs running workflow (spec R4)", () => {
  it("a pending trade proposal resolves while a workflow is running", async () => {
    m.saveWorkflow({ id: "wf-tradegate", name: "Gate flow", approval: "manual", steps: [{ type: "click", selector: "button", label: "Submit" }] })
    await m.runWorkflow({ workflowId: "wf-tradegate", tabId: 1 })
    const waiting = m.listInterventions()
    expect(waiting.running.status).toBe("waiting")

    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    // Must NOT throw "intervention is not for the running workflow" (R4 check:
    // the tradeGate branch short-circuits before the running check).
    await m.respondIntervention({ id: r.id, decision: "approve" })
    expect(trading.openPaperTrade).toHaveBeenCalledTimes(1)

    // The workflow itself is untouched and still resolvable.
    await m.respondIntervention({ id: waiting.running.pendingId, decision: "reject" })
    const after = m.listInterventions()
    expect(after.running.status).toBe("aborted")
  })
})

describe("interventions — pendingTradeProposals (T12 M8 compliance.proposalId feed)", () => {
  it("reports the pending proposal keyed by upper-case symbol; nothing when no gate", async () => {
    expect(m.pendingTradeProposals()).toEqual({})
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(m.pendingTradeProposals()).toEqual({ EURUSD: r.id })
    await m.respondIntervention({ id: r.id, decision: "approve" })
    expect(m.pendingTradeProposals()).toEqual({}) // resolved → nothing pending
  })

  it("matches the gate symbol regardless of case", async () => {
    const r = await m.proposeTrade({ ...ORDER, symbol: "eurusd" }, { now: NOW })
    expect(m.pendingTradeProposals()).toEqual({ EURUSD: r.id })
  })
})