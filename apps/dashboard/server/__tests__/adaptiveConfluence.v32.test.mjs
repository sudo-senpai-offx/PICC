// v3.2 Plan 3 — Task 5 regression bed: toggle-gated live wiring in
// adaptiveConfluence.mjs (REQ-P3-1 / REQ-STG-1/2 / ADR-0004).
//
// OFF ⇒ byte-identical legacy decisions (deep-equal against the pre-v32
// fixtures, no `v32` field anywhere, existing adaptiveConfluence.test.mjs /
// u4faPayload.test.mjs stay green UNMODIFIED). ON ⇒ the lane rides the
// decideAssets → evaluateAsset → logTradeVerdicts chain with engine:"v3.2"
// ledger rows; every failure fails closed per-asset, never the batch.
import { describe, it, expect } from "vitest"
import {
  decideAssets,
  evaluateAsset,
  logTradeVerdicts,
  resetU4faRegimeStates
} from "../services/adaptiveConfluence.mjs"
import { ledgerHistory } from "../services/accuracyLedger.mjs"

const FIXED_NOW = 1_750_000_000_000

function trendCandles(n = 80, step = 0.2, base = 100) {
  const out = []
  for (let i = 0; i < n; i++) {
    const close = base + step * i
    const open = close - step
    out.push({ time: i * 60, open, high: close + 0.05, low: close - 0.05, close })
  }
  return out
}

function trending300(n = 80, step = 1.2, base = 100) {
  return Array.from({ length: n }, (_, i) => ({
    open: base + i * step - 0.5,
    high: base + i * step + 1,
    low: base + i * step - 1,
    close: base + i * step,
    volume: 100
  }))
}

const BTC = { id: "BTC", name: "BTC", periods: { 60: trendCandles(80), 300: trending300() }, ticks: {} }
const EUR = { id: "142", name: "EUR / USD", periods: { 60: trendCandles(80) }, ticks: {} }

const HEALTHY_RISK = {
  dayStartBalance: 1000,
  pnl: 0,
  sessionPnL: 0,
  sessionBalance: 1000,
  killSwitch: false,
  proposalsToday: 0,
  consecutiveLosses: 0
}

function ctxFixture(overrides = {}) {
  return {
    config: {},
    calendarEvents: [],
    calendarSource: "fixture",
    spread: { spreadPips: 1.2, source: "fixture", at: 0 },
    losses: [],
    candleSource: "fixture",
    ...overrides
  }
}

describe("OFF (enabled:false / no v32Config) — byte-identical floor", () => {
  it("deep-equals the pre-v32 decision output when the toggle is absent", async () => {
    const data = { assets: [BTC, EUR] }
    const legacy = await decideAssets({ data, now: FIXED_NOW, u4faContext: ctxFixture() })
    const off = await decideAssets({ data, now: FIXED_NOW, u4faContext: ctxFixture({ v32Config: { enabled: false } }) })
    expect(off).toEqual(legacy)
    expect(off).toHaveLength(2)
    for (const d of off) {
      expect(d.strategies).toBeDefined()
      expect(d.strategies).not.toHaveProperty("v32")
    }
  })

  it("attaches no v32 field through evaluateAsset either", () => {
    const d = evaluateAsset({ id: "BTC", name: "BTC", candles: trendCandles(80), volume: {}, strategies: { u4fa: { enabled: false } } })
    expect(d.strategies).not.toHaveProperty("v32")
  })

  it("logTradeVerdicts writes nothing extra under OFF", async () => {
    const before = ledgerHistory(500).filter((r) => r.engine === "v3.2").length
    await logTradeVerdicts([
      { assetId: "BTC", asset: "BTC", verdict: "TRADE", direction: "up", expiry: 60, winProb: 0.7, strategies: { u4fa: { enabled: false } } }
    ])
    const after = ledgerHistory(500).filter((r) => r.engine === "v3.2").length
    expect(after).toBe(before)
  })
})

describe("ON (v32Config.enabled: true) — the lane rides the live chain", () => {
  it("attaches strategies.v32 with a composed v3.2 row per tradable asset", async () => {
    const out = await decideAssets({
      data: { assets: [BTC, EUR] },
      now: FIXED_NOW,
      u4faContext: ctxFixture({ v32Config: { enabled: true }, risk: HEALTHY_RISK })
    })
    expect(out.length).toBeGreaterThanOrEqual(1)
    for (const d of out) {
      expect(d.strategies.v32.enabled).toBe(true)
      const row = d.strategies.v32.result
      expect(row.engine).toBe("v3.2")
      expect(row.assetId).toBe(d.assetId)
      expect(row.verdict).toBeDefined()
    }
  })

  it("clears wires 1/2/3/4/6/7/8 on a healthy fixture (only the EV-margin wire may trip)", async () => {
    const out = await decideAssets({
      data: { assets: [BTC] },
      now: FIXED_NOW,
      u4faContext: ctxFixture({ v32Config: { enabled: true }, risk: HEALTHY_RISK })
    })
    const row = out[0].strategies.v32.result
    expect(["TRADE", "OBSERVE"]).toContain(row.verdict)
    for (const id of ["1", "2", "3", "4", "6", "7", "8"]) {
      expect(row.copilot.blockedBy).not.toContain(id)
    }
  })

  it("logs v3.2 TRADE rows to the shared ledger with engine:'v3.2' while legacy rows stay 'legacy'", async () => {
    const v32row = {
      engine: "v3.2",
      assetId: "BTC",
      asset: "BTC",
      direction: "up",
      expiry: 60,
      ts: FIXED_NOW,
      verdict: "TRADE",
      score: { available: true, direction: "up" },
      reasons: []
    }
    await logTradeVerdicts([
      { assetId: "BTC", asset: "BTC", verdict: "TRADE", direction: "up", expiry: 60, winProb: 0.7, strategies: { v32: { enabled: true, result: v32row } } },
      { assetId: "EUR", asset: "EUR / USD", verdict: "TRADE", direction: "up", expiry: 60, winProb: 0.7, strategies: { u4fa: { enabled: false } } }
    ])
    const rows = ledgerHistory(500)
    expect(rows.some((r) => r.engine === "v3.2" && r.assetId === "BTC" && r.expirySec === 60)).toBe(true)
    expect(rows.some((r) => r.engine === "legacy" && r.assetId === "EUR")).toBe(true)
  })

  it("fails closed per-asset when the v3.2 context is unavailable (never the batch)", () => {
    const d = evaluateAsset({
      id: "BTC",
      name: "BTC",
      candles: trendCandles(80),
      volume: {},
      strategies: { u4fa: { enabled: false }, v32: { enabled: true, context: null, config: { enabled: true }, rows: [], risk: {} } }
    })
    const row = d.strategies.v32.result
    expect(row.engine).toBe("v3.2")
    expect(row.verdict).toBe("OBSERVE")
    expect(row.reason).toMatch(/no v3.2 context/)
  })
})