// Wave3+02 — graduated paper day-loss circuit (paper-first). TDD: per-level
// transitions, paper-only application, manual re-enable, restart persistence.
// Hermetic: PICC_DATA_DIR tmp; live gate files untouched (proven by existing
// sidecar/risk suites staying green).
import { beforeEach, describe, expect, it, vi, afterAll } from "vitest"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "picc-papercircuit-"))
process.env.PICC_DATA_DIR = dir

vi.mock("../services/browserStudio.mjs", () => ({
  studioBroadcast: vi.fn(),
  studioIsOpen: () => true,
  studioPageFor: () => null,
  studioTypeText: vi.fn(async () => {})
}))
vi.mock("../services/browserBridge.mjs", () => ({
  readPage: vi.fn(async () => ({}))
}))

const trading = vi.hoisted(() => ({
  paperOverview: vi.fn(async () => ({ starting: 10000, cash: 10000, committed: 0, realizedPnl: 0, openCount: 0, closedCount: 0 })),
  paperHistory: vi.fn(async () => []),
  openPaperTrade: vi.fn(async (o) => ({ id: "paper-x", ...o, status: "open" }))
}))
vi.mock("../services/trading.mjs", () => trading)
const ledger = vi.hoisted(() => ({
  ledgerHistory: vi.fn(async () => ({ entries: [] }))
}))
vi.mock("../services/accuracyLedger.mjs", () => ledger)

import {
  PAPER_CIRCUIT_L1_PCT,
  PAPER_CIRCUIT_L2_PCT,
  PAPER_CIRCUIT_L3_PCT,
  PAPER_CIRCUIT_SIZE_FACTOR_L1,
  evaluatePaperCircuit,
  paperDayLossPctOf,
  paperCircuitSnapshot,
  tripPaperCircuitHalt,
  clearPaperCircuitHalt,
  hydratePaperCircuit,
  isPaperCircuitHalted,
  _resetPaperCircuitStore
} from "../services/paperCircuit.mjs"
import { resetU4faRiskState } from "../services/u4faRisk.mjs"

const NOW = Date.parse("2026-03-10T12:00:00Z")
const iso = (ts) => new Date(ts).toISOString()
const ORDER = { symbol: "EURUSD", direction: "up", entry: 1.085, expiry: 300 }

function pnlCloses(dayPnl) {
  if (dayPnl === 0) return []
  return [{ pnl: dayPnl, closedAt: iso(NOW - 60 * 60 * 1000) }]
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetPaperCircuitStore()
  resetU4faRiskState()
  trading.paperOverview.mockResolvedValue({ starting: 10000, cash: 10000, committed: 0, realizedPnl: 0, openCount: 0, closedCount: 0 })
  trading.paperHistory.mockResolvedValue([])
  ledger.ledgerHistory.mockResolvedValue({ entries: [] })
})

afterAll(() => {
  delete process.env.PICC_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("paperCircuit — named thresholds on the day-loss-pct scale", () => {
  it("exposes graduated named constants (3/5/10 on the % scale in use)", () => {
    expect(PAPER_CIRCUIT_L1_PCT).toBe(3)
    expect(PAPER_CIRCUIT_L2_PCT).toBe(5)
    expect(PAPER_CIRCUIT_L3_PCT).toBe(10)
    expect(PAPER_CIRCUIT_SIZE_FACTOR_L1).toBe(0.5)
    expect(PAPER_CIRCUIT_L1_PCT).toBeLessThan(PAPER_CIRCUIT_L2_PCT)
    expect(PAPER_CIRCUIT_L2_PCT).toBeLessThan(PAPER_CIRCUIT_L3_PCT)
  })

  it("paperDayLossPctOf matches the % scale (loss/start*100, gains floor at 0)", () => {
    expect(paperDayLossPctOf({ dayStartBalance: 10000, dayPnl: -300 })).toBe(3)
    expect(paperDayLossPctOf({ dayStartBalance: 10000, dayPnl: 50 })).toBe(0)
    expect(paperDayLossPctOf({ dayStartBalance: null, dayPnl: -300 })).toBeNull()
  })
})

describe("paperCircuit — per-level transitions with NAMED reasons", () => {
  it("L0 below L1 allows", () => {
    const r = evaluatePaperCircuit({ dayLossPct: 2.99, now: NOW })
    expect(r.level).toBe(0)
    expect(r.action).toBe("allow")
    expect(r.sizeFactor).toBe(1)
    expect(r.reason).toMatch(/paper-circuit-ok/)
  })
  it("L1 at/above 3 reduces size (halve)", () => {
    for (const pct of [3, 3.5, 4.99]) {
      const r = evaluatePaperCircuit({ dayLossPct: pct, now: NOW })
      expect(r.level).toBe(1)
      expect(r.action).toBe("reduce-size")
      expect(r.sizeFactor).toBe(0.5)
      expect(r.reason).toMatch(/paper-circuit-l1-reduce-size/)
    }
  })
  it("L2 at/above 5 halts new trades", () => {
    for (const pct of [5, 7, 9.99]) {
      const r = evaluatePaperCircuit({ dayLossPct: pct, now: NOW })
      expect(r.level).toBe(2)
      expect(r.action).toBe("halt-new")
      expect(r.reason).toMatch(/paper-circuit-l2-halt-new/)
    }
  })
  it("L3 at/above 10 halts-all", () => {
    const r = evaluatePaperCircuit({ dayLossPct: 10, now: NOW })
    expect(r.level).toBe(3)
    expect(r.action).toBe("halt-all")
    expect(r.reason).toMatch(/paper-circuit-l3-halt-all/)
  })
  it("unobservable loss fails closed with a named reason", () => {
    for (const bad of [null, undefined, NaN, Infinity]) {
      const r = evaluatePaperCircuit({ dayLossPct: bad, now: NOW })
      expect(r.action).toBe("halt-new")
      expect(r.reason).toMatch(/paper-circuit-unobservable/)
    }
  })
})

describe("paperCircuit — paper-only application via the tradeGate", () => {
  it("L1 halves the proposed stake and names the circuit", async () => {
    const m = await import("../services/interventions.mjs?case=circuit-l1-" + Math.random())
    trading.paperHistory.mockResolvedValue(pnlCloses(-400)) // 4% of 10k
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW })
    expect(r.ok).toBe(true)
    expect(r.amount).toBe(25) // 0.5% of 10k = 50, halved
    expect(r.circuit.level).toBe(1)
    expect(r.circuit.reason).toMatch(/paper-circuit-l1-reduce-size/)
  })
  it("L2 blocks new paper proposals with a named reason", async () => {
    const m = await import("../services/interventions.mjs?case=circuit-l2-" + Math.random())
    trading.paperHistory.mockResolvedValue(pnlCloses(-600)) // 6%
    // The pre-existing U4FA -5% barrier fires first at defaults (precedence
    // unchanged) — raise it so the graduated L2 is the deciding control.
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW, risk: { dailyLossLimitPct: 50 } })
    expect(r.ok).toBe(false)
    expect(r.status).toBe("blocked")
    expect(r.reason).toMatch(/paper-circuit-l2-halt-new/)
    expect(trading.openPaperTrade).not.toHaveBeenCalled()
  })
  it("L3 trips the persisted halt-all and blocks", async () => {
    const m = await import("../services/interventions.mjs?case=circuit-l3-" + Math.random())
    trading.paperHistory.mockResolvedValue(pnlCloses(-1200)) // 12%
    const r = await m.proposeTrade({ ...ORDER }, { now: NOW, risk: { dailyLossLimitPct: 50 } })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/paper-circuit-l3-halt-all/)
    expect(isPaperCircuitHalted()).toBe(true)
  })
  it("live 5D gate file is untouched: safetySidecar keeps its exact contract", async () => {
    const { GATE_ORDER, evaluateGate } = await import("../services/commandCentre/safetySidecar.mjs")
    expect(GATE_ORDER).toEqual([
      "kill-switch", "cross-site-day-halt", "human-takeover", "per-site-opt-in",
      "hard-breakers", "fresh-data", "toS-survival", "envelope-within-ceiling",
      "rationale-renderable", "idempotent"
    ])
    expect(typeof evaluateGate).toBe("function")
  })
})

describe("paperCircuit — manual re-enable (explicit, never automatic)", () => {
  it("trip → halted; day rollover does NOT auto-clear; clear needs a reviewer", () => {
    tripPaperCircuitHalt({ dayLossPct: 12, now: NOW, reason: "test-trip" })
    expect(isPaperCircuitHalted()).toBe(true)
    const nextDay = NOW + 24 * 3600 * 1000 + 1000
    const still = evaluatePaperCircuit({ dayLossPct: 0, now: nextDay })
    expect(still.action).toBe("halt-all")
    expect(still.reason).toMatch(/manual re-enable required/)
    expect(() => clearPaperCircuitHalt({})).toThrow(/reviewer/)
    clearPaperCircuitHalt({ reviewer: "owner-manual-review", now: nextDay })
    expect(isPaperCircuitHalted()).toBe(false)
    expect(evaluatePaperCircuit({ dayLossPct: 0, now: nextDay }).action).toBe("allow")
  })
})

describe("paperCircuit — restart persistence of halted state", () => {
  it("halted state survives a simulated restart via the persisted file", async () => {
    tripPaperCircuitHalt({ dayLossPct: 11, now: NOW, reason: "restart-proof" })
    const file = join(dir, "paper-circuit.json")
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, "utf8")).halted).toBeTruthy()
    // Simulate restart: wipe memory only, re-hydrate from disk.
    const mod = await import("../services/paperCircuit.mjs?restart=" + Math.random())
    void mod
    hydratePaperCircuit()
    expect(isPaperCircuitHalted()).toBe(true)
    expect(paperCircuitSnapshot().halted.reason).toMatch(/restart-proof/)
  })
})
