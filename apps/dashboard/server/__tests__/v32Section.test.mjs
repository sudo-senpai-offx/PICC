import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROW = (assetId) => ({
  engine: "v3.2",
  assetId,
  asset: assetId,
  direction: "up",
  expiry: 60,
  ts: 100,
  score: { available: true, score: 0.8, direction: "up", pillars: [
    { pillar: "vwap", available: true, side: "above", direction: "up" },
    { pillar: "ema", available: true, aligned: "long", direction: "up" }
  ], degraded: [] },
  costLine: { ev: 0.14, evPerWin: null, breakevenPayout: 55, payoutBeats: true, evRR: 2.4, evRRPass: true },
  confidence: 66,
  regime: { registers: { adx: { available: true, chop: false } } },
  copilot: { ok: true, wires: [], blockedBy: [] },
  verdict: "TRADE",
  gates: { score: true, costLine: true, copilot: true },
  reasons: [],
  honesty: { sampleSource: "rows", spreadSource: null, calendarSource: "fallback-schedule", candleSource: "liveEO", tradesFeed: "absent" }
})

const LEDGER_ROWS = [
  { engine: "v3.2", expiry: "60", hits: 12, misses: 6, total: 18 },
  { engine: "legacy", expiry: "60", hits: 90, misses: 60, total: 150 }
]

describe("v32Section compose (pure, injectable)", () => {
  let sec
  beforeEach(async () => {
    vi.resetModules()
    sec = await import("../services/v32Section.mjs")
  })
  afterEach(() => vi.resetModules())

  it("sits inert under an OFF lane: zeros, honest reasons, no phantom assets", async () => {
    const out = await sec.composeV32Section({
      decisions: [{ strategies: { v32: { enabled: true, result: ROW("EURUSD") } } }],
      rows: LEDGER_ROWS,
      config: { enabled: false },
      watch: [{ id: "EURUSD", periods: { 60: Array(40).fill({ c: 1 }) } }],
      at: 50
    })
    expect(out.enabled).toBe(false)
    expect(out.mode).toBe("shadow")
    expect(out.assets).toEqual([])
    expect(out.assetCount).toBe(0)
    expect(out.watch.total).toBe(1)
    expect(out.watch.buffered).toBe(1)
    expect(out.decisions.resolved).toBe(18)
    expect(out.decisions.total).toBe(100)
    expect(out.breakeven).toBeNull()
    expect(out.uptime.seconds).toBeNull()
    expect(out.uptime.reason).toContain("v3.2 lane off")
    expect(out.explain).toEqual([])
    expect(out.soak.reason).toContain("powered toggle")
  })

  it("reports buffer coverage from the live watch set vs MIN_BARS", async () => {
    const out = await sec.composeV32Section({
      decisions: [],
      rows: [],
      config: { enabled: false },
      watch: [
        { id: "EURUSD", periods: { 60: Array(40).fill({ c: 1 }) } },
        { id: "GBPUSD", periods: { 60: [] } },
        { id: "BTCUSD", periods: { 60: Array(12).fill({ c: 1 }) } }
      ],
      at: 1
    })
    expect(out.watch.total).toBe(3)
    expect(out.watch.buffered).toBe(1)
    expect(out.watch.reason).toBeNull()
  })

  it("honestly reports an empty watch set instead of inventing coverage", async () => {
    const out = await sec.composeV32Section({ decisions: [], rows: [], config: { enabled: false }, watch: [], at: 1 })
    expect(out.watch.total).toBe(0)
    expect(out.watch.buffered).toBe(0)
    expect(out.watch.reason).toContain("waiting for the live watch set")
  })

  it("computes breakeven + uptime from flip-gate digits and the config stamp", async () => {
    const out = await sec.composeV32Section({
      decisions: [],
      rows: LEDGER_ROWS,
      config: { enabled: true, enabledAt: 400_000 },
      watch: [],
      at: 1_500_000
    })
    expect(out.enabled).toBe(true)
    expect(out.mode).toBe("powered")
    // candidate = 18 trades, 12 hits at 82 payout / 6 misses → ev = 12*0.82 - 6 = 3.84 → /18 = 0.2133 → 0.213
    expect(out.breakeven).toBe(0.213)
    expect(out.uptime.seconds).toBe(1100)
    expect(out.uptime.reason).toBeNull()
    expect(out.decisions.resolved).toBe(18)
    expect(out.flipGate.candidateTrades).toBe(18)
  })

  it("returns null uptime with an explicit reason when enabled but never stamped", async () => {
    const out = await sec.composeV32Section({
      decisions: [],
      rows: LEDGER_ROWS,
      config: { enabled: true, enabledAt: null },
      watch: [],
      at: 1500
    })
    expect(out.uptime.seconds).toBeNull()
    expect(out.uptime.reason).toContain("enabledAt")
  })

  it("forwards enabled v3.2 rows exactly and attaches additive explain state", async () => {
    const row = ROW("EURUSD")
    const out = await sec.composeV32Section({
      decisions: [{ strategies: { v32: { enabled: true, result: row } } }],
      rows: LEDGER_ROWS,
      config: { enabled: true, enabledAt: 100, proposalCap: 0, consecutiveLossThreshold: null },
      watch: [],
      at: 200
    })
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toEqual(row) // register contract: wire bytes mirrored exactly
    expect(out.explain).toHaveLength(1)
    expect(out.explain[0].assetId).toBe("EURUSD")
    expect(out.explain[0].state.ok).toBe(true)
    expect(out.explain[0].state.verdict).toBe("TRADE")
    expect(out.explain[0].state.score).toEqual({ available: true, score: 0.8, direction: "up" })
  })
})