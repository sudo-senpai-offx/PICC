import { describe, expect, it, beforeEach } from "vitest"

/**
 * Regression tests for the full-system audit (a-z pass). Each test pins one
 * confirmed defect so it can never silently regress.
 */

// ── Kelly payout corruption ─────────────────────────────────────────────────
describe("audit: kelly avgPayout uses wins only", () => {
  let tmp
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "picc-kelly-"))
    process.env.PICC_DATA_DIR = tmp
    process.env.PICC_TRADING_DATA_DIR = join(tmp, "trading")
  })
  it("losses never inflate the average payout; empty history defaults to 0.8", async () => {
    const { localStore } = await import("../services/localstore.mjs")
    const store = localStore("kelly", { history: [], settings: { mode: "half", baseFraction: 0.02, maxFraction: 0.1 } })
    // Legacy-style rows: losses carried payout:0 (the old bug), wins 0.8
    store.data.history = [
      { outcome: "win", win: true, stake: 10, payout: 0.8, timestamp: Date.now() },
      { outcome: "win", win: true, stake: 10, payout: 0.8, timestamp: Date.now() },
      { outcome: "loss", win: false, stake: 10, payout: null, timestamp: Date.now() },
      { outcome: "loss", win: false, stake: 10, payout: 0, timestamp: Date.now() }
    ]
    store.write()
    // Fresh module instance reads the seeded store
    vi.resetModules()
    const { kellySnapshot } = await import("../services/kellyCriterion.mjs")
    const snap = kellySnapshot()
    expect(snap.stats.avgPayout).toBe(0.8)
    expect(snap.stats.winRate).toBe(50)
    // Empty history → default 0.8 (was 1.5)
    store.data.history = []
    store.write()
    vi.resetModules()
    const mod2 = await import("../services/kellyCriterion.mjs")
    expect(mod2.kellySnapshot().stats.avgPayout).toBe(0.8)
  })
})

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"

// ── Risk of ruin ────────────────────────────────────────────────────────────
describe("audit: risk-of-ruin edge is not halved", () => {
  it("matches the classic formula at even-money odds", async () => {
    const { riskOfRuin } = await import("../services/trading.mjs")
    // p=0.55, ap=1 → edge = 2p−1 = 0.10; RoR = ((1−e)/(1+e))^units
    const r = riskOfRuin({ winRate: 55, avgPayout: 1, riskPct: 5, balance: 1000 })
    const edge = 0.55 * 1 - 0.45
    const units = Math.floor((1000 * 0.05 > 0 ? 1 / 0.05 : 1000))
    // riskOfRuin is reported rounded to 4dp
    expect(r.riskOfRuin).toBeCloseTo(Math.round(Math.pow((1 - edge) / (1 + edge), units) * 10000) / 10000, 6)
    // The old halved-edge formula gave ~13.9% here; correct is ~7.7× lower
    expect(r.riskOfRuin).toBeLessThan(0.03)
  })
})

// ── Volatility annualization unit mixing ────────────────────────────────────
describe("audit: volatility handles second-denominated candle times", () => {
  it("does not explode periodsPerYear for unix-second minute bars", async () => {
    const { realizedVolatility } = await import("../services/volatility.mjs")
    const nowSec = Math.floor(Date.now() / 1000) - 120 * 60
    const closes = Array.from({ length: 121 }, (_, i) => 100 + Math.sin(i * 0.2))
    const times = Array.from({ length: 121 }, (_, i) => (nowSec + i * 60))
    const r = realizedVolatility(closes, { period: 20, times })
    // The old bug annualized by √19,049 — absurd values like 900+ (90,000%).
    expect(Number.isFinite(r.annual)).toBe(true)
    expect(r.annual).toBeGreaterThan(0)
    expect(r.annual).toBeLessThan(10)
  })
})

// ── Prediction walk-forward horizon ─────────────────────────────────────────
describe("audit: backtest realized return spans h steps", () => {
  it("scores an h-day forecast against c[start+h], not c[start+1]", async () => {
    // Monotone up series: every model should score ~perfectly over windows;
    // with the old off-by-one the FIRST step was excluded from truth.
    const closes = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5)
    const { backtestModels } = await import("../services/prediction.mjs")
    const bt = backtestModels(closes, 3, 10)
    expect(bt.sampleSize).toBeGreaterThan(0)
    // Directional models must read the trend — the old off-by-one shrank the
    // realized move by one step and could flip marginal windows.
    expect(bt.hitRates.momentum).toBeGreaterThan(0.9)
    expect(bt.hitRates.trend).toBeGreaterThan(0.9)
  })
})

// ── Correlation pair alignment ──────────────────────────────────────────────
describe("audit: pearson drops non-finite pairs jointly", () => {
  it("stays aligned when y has interior gaps", async () => {
    const { pearsonCorrelation } = await import("../services/correlation.mjs")
    // Perfect linear relation x→y=2x with NaN holes in y at index 2
    const x = [1, 2, 3, 4, 5, 6]
    const y = [2, 4, NaN, 8, 10, 12]
    const r = pearsonCorrelation(x, y)
    expect(r).toBeCloseTo(1, 6)
  })
})
