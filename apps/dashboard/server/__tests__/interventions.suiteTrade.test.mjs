import { describe, expect, it, vi, beforeEach, afterAll } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetU4faRiskState } from "../services/u4faRisk.mjs"

const dir = mkdtempSync(join(tmpdir(), "picc-suitetrade-"))
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

// B-EXE-1 acceptance: the suite proposal flows through the REAL paper ledger
// shape (closed: { pnl, closedAt }) and sizes its default amount from the
// user's riskPerTradePct credentials context, NOT the U4FA 0.5% knob.
const trading = vi.hoisted(() => ({
  paperOverview: vi.fn(async () => ({ starting: 10000, cash: 10000, committed: 0, realizedPnl: 0, openCount: 0, closedCount: 0 })),
  paperHistory: vi.fn(async () => []),
  openPaperTrade: vi.fn(async (o) => ({ id: "paper-abc", ...o, status: "open" })),
  getCredentials: vi.fn(async () => ({ riskPerTradePct: 5 }))
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

const NOW = Date.parse("2026-03-10T12:00:00Z")
const COOLDOWN_MS = 15 * 60 * 1000

const SUITE = {
  assetId: "EURUSD",
  side: "up",
  reason: "Confluence BUY 0.42 · trending regime · 68% confidence",
  verdict: { verdict: "BUY", confidence: 68 }
}
const ENTRY = 1.0854321

let m
beforeEach(async () => {
  vi.clearAllMocks()
  trading.paperOverview.mockResolvedValue({ starting: 10000, cash: 10000, committed: 0, realizedPnl: 0, openCount: 0, closedCount: 0 })
  trading.paperHistory.mockResolvedValue([])
  trading.getCredentials.mockResolvedValue({ riskPerTradePct: 5 })
  ledger.ledgerHistory.mockResolvedValue({ entries: [] })
  resetU4faRiskState()
  m = await import("../services/interventions.mjs?case=suitetrade-" + Math.random())
})

afterAll(() => {
  delete process.env.PICC_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("interventions — suite trade gate (B-EXE-3): proposal lifecycle", () => {
  it("proposeSuiteTrade raises a pending source:trade proposal with the human-readable suite reason", async () => {
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    expect(r.ok).toBe(true)
    expect(r.status).toBe("pending")
    expect(r.source).toBe("trade")
    expect(r.workflowName).toBe("Suite signal")
    const s = m.listInterventions()
    const p = s.proposals.find((x) => x.id === r.id)
    expect(p.source).toBe("trade")
    expect(p.action).toBe("order")
    expect(p.risk).toBe("high")
    expect(p.label).toBe("Suite up EURUSD")
    expect(p.detail).toContain(SUITE.reason) // reason survives into the bell wording
    expect(p.detail).toContain("PAPER ONLY")
  })

  it("amount defaults from the riskPerTradePct credentials context (5% → $500 on $10k), not the U4FA knob", async () => {
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    expect(r.amount).toBe(500) // 5% of $10,000 — a U4FA proposal here would size $50 (0.5%)
    expect(m.listInterventions().proposals.find((x) => x.id === r.id).detail).toContain("$500.00")
    expect(trading.openPaperTrade).not.toHaveBeenCalled() // proposing is not placing
  })

  it("an explicit amount wins over the default", async () => {
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW, amount: 25 })
    expect(r.amount).toBe(25)
  })

  it("the $1 floor binds and is declared when risk% of balance is below $1", async () => {
    trading.paperOverview.mockResolvedValue({ starting: 10, cash: 10, committed: 0, realizedPnl: 0 })
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    expect(r.amount).toBe(1) // 5% of $10 = $0.50 → floored to $1
  })

  it("approve → exactly one openPaperTrade call with the suite-shaped order, proposal approved", async () => {
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    await m.respondIntervention({ id: r.id, decision: "approve" })
    expect(trading.openPaperTrade).toHaveBeenCalledTimes(1)
    expect(trading.openPaperTrade).toHaveBeenCalledWith({
      symbol: "EURUSD",
      side: "up",
      entry: 1.085432, // rounded to 1e-6 like every paper order
      amount: 500,
      takeProfit: null,
      stopLoss: null,
      signalId: null
    })
    expect(m.listInterventions().proposals.find((x) => x.id === r.id).status).toBe("approved")
  })

  it("reject → zero openPaperTrade calls, proposal rejected", async () => {
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    await m.respondIntervention({ id: r.id, decision: "reject" })
    expect(trading.openPaperTrade).not.toHaveBeenCalled()
    expect(m.listInterventions().proposals.find((x) => x.id === r.id).status).toBe("rejected")
  })

  it("responding twice to the same suite proposal throws (no double order)", async () => {
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    await m.respondIntervention({ id: r.id, decision: "approve" })
    await expect(m.respondIntervention({ id: r.id, decision: "approve" })).rejects.toThrow(/no pending intervention/)
    expect(trading.openPaperTrade).toHaveBeenCalledTimes(1)
  })

  it("a second suite proposal while one is pending returns the same id (shared one-gate rule)", async () => {
    const a = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    const b = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW + 60_000 })
    expect(b.id).toBe(a.id)
    expect(b.duplicate).toBe(true)
    expect(m.listInterventions().proposals.filter((x) => x.source === "trade")).toHaveLength(1)
  })
})

describe("interventions — suite proposal factory (B-EXE-1): gates bind at propose time", () => {
  it("the per-asset 15-min cooldown blocks a repeat proposal for the same asset and allows a different one", async () => {
    const a = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    await m.respondIntervention({ id: a.id, decision: "reject" })

    const repeat = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW + 60_000 })
    expect(repeat.ok).toBe(false)
    expect(repeat.status).toBe("blocked")
    expect(repeat.reason).toMatch(/cooldown/)
    expect(repeat.retryAfterMs).toBe(COOLDOWN_MS - 60_000)

    // A different asset is not on cooldown → fresh proposal allowed.
    const other = await m.proposeSuiteTrade(
      { assetId: "GBPUSD", side: "down", reason: "Confluence SELL · divergence", verdict: { verdict: "SELL" }, entry: 1.24 },
      { now: NOW + 60_000 }
    )
    expect(other.ok).toBe(true)
    expect(other.id).not.toBe(a.id)
  })

  it("the cooldown clears after 15 minutes and the same asset may propose again", async () => {
    const a = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    await m.respondIntervention({ id: a.id, decision: "reject" })
    const after = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW + COOLDOWN_MS + 1 })
    expect(after.ok).toBe(true)
    expect(after.id).not.toBe(a.id)
  })

  it("NEUTRAL / absent verdicts are loud throws — the suite's own verdict is never bypassed", async () => {
    await expect(
      m.proposeSuiteTrade({ ...SUITE, verdict: { verdict: "NEUTRAL" }, entry: ENTRY }, { now: NOW })
    ).rejects.toThrow(/tradable verdict/)
    await expect(
      m.proposeSuiteTrade({ assetId: "EURUSD", side: "up", reason: "flat read", entry: ENTRY }, { now: NOW })
    ).rejects.toThrow(/tradable verdict/)
  })

  it("a side/verdict mismatch is a loud throw", async () => {
    await expect(
      m.proposeSuiteTrade({ ...SUITE, side: "down", entry: ENTRY }, { now: NOW })
    ).rejects.toThrow(/direction\/verdict mismatch/)
  })

  it("a missing human-readable reason is a loud throw (proposal spam guard)", async () => {
    await expect(
      m.proposeSuiteTrade({ assetId: "EURUSD", side: "up", verdict: { verdict: "BUY" }, entry: ENTRY }, { now: NOW })
    ).rejects.toThrow(/human-readable reason/)
    await expect(
      m.proposeSuiteTrade({ ...SUITE, reason: "   ", entry: ENTRY }, { now: NOW })
    ).rejects.toThrow(/human-readable reason/)
  })

  it("an unobservable entry price throws (no observable entry → no proposal)", async () => {
    await expect(
      m.proposeSuiteTrade({ ...SUITE, entry: undefined }, { now: NOW })
    ).rejects.toThrow(/entry price/)
    await expect(
      m.proposeSuiteTrade({ ...SUITE, entry: 0 }, { now: NOW })
    ).rejects.toThrow(/entry price/)
  })

  it("a malformed assetId/side is a loud throw, never a silent skip", async () => {
    await expect(
      m.proposeSuiteTrade({ assetId: "", side: "up", reason: "r", verdict: { verdict: "BUY" }, entry: ENTRY }, { now: NOW })
    ).rejects.toThrow(/assetId/)
    await expect(
      m.proposeSuiteTrade({ assetId: "EURUSD", side: "sideways", reason: "r", verdict: { verdict: "BUY" }, entry: ENTRY }, { now: NOW })
    ).rejects.toThrow(/side up\|down/)
  })
})

describe("interventions — suite vs U4FA quota segregation (B-EXE-1)", () => {
  it("the suite factory never consumes the U4FA 10/day proposal quota", async () => {
    // The suite path shares the gate but must NOT feed recordU4faProposal:
    // burn all 10 U4FA proposals, then a suite proposal still proposes.
    const u4faOrder = { symbol: "EURUSD", direction: "up", entry: 1.08, expiry: 300 }
    for (let i = 0; i < 10; i++) {
      const r = await m.proposeTrade(u4faOrder, { now: NOW })
      expect(r.ok).toBe(true)
      await m.respondIntervention({ id: r.id, decision: "reject" })
    }
    expect((await m.proposeTrade(u4faOrder, { now: NOW })).ok).toBe(false) // U4FA cap now closed

    const suite = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    expect(suite.ok).toBe(true) // suite path unaffected by the U4FA cap
    await m.respondIntervention({ id: suite.id, decision: "reject" })
  })
})

describe("interventions — pendingTradeProposals surfaces suite gate (B-EXE-1)", () => {
  it("reports the pending suite proposal keyed by upper-case symbol; nothing once resolved", async () => {
    expect(m.pendingTradeProposals()).toEqual({})
    const r = await m.proposeSuiteTrade({ ...SUITE, entry: ENTRY }, { now: NOW })
    expect(m.pendingTradeProposals()).toEqual({ EURUSD: r.id })
    await m.respondIntervention({ id: r.id, decision: "approve" })
    expect(m.pendingTradeProposals()).toEqual({})
  })

  it("matches the gate symbol regardless of case", async () => {
    const r = await m.proposeSuiteTrade({ ...SUITE, assetId: "eurusd", entry: ENTRY }, { now: NOW })
    expect(m.pendingTradeProposals()).toEqual({ EURUSD: r.id })
  })
})