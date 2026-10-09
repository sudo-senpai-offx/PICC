import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { equitySeries, metricsFrom } from "../services/analytics.mjs"

// Paper cost-drag overlay — modeled cost lines beside the untouched ledger.
// Hermetic by construction: every assertion below is pure (fixture closes +
// dependency-free analytics.mjs + the overlay's own pure mappers). No
// `process.env.PICC_*` redirect, no disk, no network, no ledger import — so
// this file needs no ws7TestStoreIsolation legacy-inventory entry. The
// ledger-untouched proof is a deep-equal of analytics output before/after the
// overlay run (the load-bearing claim: the ledger is only ever read), plus a
// static read-path proof that the module never touches a marking/closing
// writer.
describe("paper cost-drag overlay", () => {
  let mod
  beforeEach(async () => {
    vi.resetModules()
    mod = await import("../services/costs/paperOverlay.mjs")
  })

  const STARTING = 10000
  const closes = () => [
    {
      id: "c1", symbol: "BTC", side: "up", entry: 100, exit: 110,
      amount: 1000, pnl: 100, closedAt: "2026-10-06T10:00:00+08:00"
    },
    {
      id: "c2", symbol: "ETH", side: "up", entry: 50, exit: 48,
      amount: 2000, pnl: -50, closedAt: "2026-10-07T10:00:00+08:00"
    }
  ]

  it("fixture closes produce per-close modeled cost lines with exact spread math", () => {
    const { lines, skipped } = mod.overlayForCloses(closes())
    expect(skipped).toEqual([])
    expect(lines).toHaveLength(2)
    // Defaults: 1.5 spread pips at 0.01 pip value = 1.5% of notional; paper
    // charges no explicit fee, so the fee leg is a modeled zero.
    expect(lines[0]).toMatchObject({ closeId: "c1", feeUsd: 0, spreadUsd: 15, slipUsd: 0, provenance: "modeled" })
    expect(lines[1]).toMatchObject({ closeId: "c2", feeUsd: 0, spreadUsd: 30, slipUsd: 0, provenance: "modeled" })
    for (const line of lines) {
      expect(["modeled", "modeled-with-calibrated-inputs"]).toContain(line.provenance)
      expect(Number.isFinite(line.spreadUsd)).toBe(true)
    }
  })

  it("never emits a measured label, even when asked to", () => {
    const { lines } = mod.overlayForCloses(closes(), { provenance: "measured" })
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.provenance).not.toBe("measured")
    }
  })

  it("unmodelable closes are absent with reasons, never zero lines", () => {
    const { lines, skipped } = mod.overlayForCloses([
      { id: "good", amount: 1000, closedAt: "2026-10-07T10:00:00+08:00" },
      { id: "zero", amount: 0, closedAt: "2026-10-07T10:00:00+08:00" },
      { id: "junk", amount: NaN, closedAt: "2026-10-07T10:00:00+08:00" },
      { id: "missing", closedAt: "2026-10-07T10:00:00+08:00" }
    ])
    expect(lines.map((l) => l.closeId)).toEqual(["good"])
    expect(skipped.length).toBeGreaterThanOrEqual(3)
    for (const s of skipped) {
      expect(typeof s.reason).toBe("string")
    }
  })

  it("equity curve + overlays produce an exact parallel drag-adjusted series", () => {
    const curve = equitySeries(closes(), STARTING)
    // [{t:null,equity:10000},{t:c1,equity:10100},{t:c2,equity:10050}]
    const { lines } = mod.overlayForCloses(closes())
    const out = mod.dragAdjustedEquity(curve, lines)
    expect(out.label).toBe("drag-adjusted (modeled)")
    expect(out.series).toHaveLength(curve.length)
    // Same timestamps, original equity verbatim.
    expect(out.series.map((p) => p.t)).toEqual(curve.map((p) => p.t))
    expect(out.series.map((p) => p.equity)).toEqual(curve.map((p) => p.equity))
    // Cumulative modeled drag: 0, 15, 15+30=45.
    expect(out.series[0]).toMatchObject({ dragEquity: 10000, cumulativeCostUsd: 0 })
    expect(out.series[1]).toMatchObject({ dragEquity: 10085, cumulativeCostUsd: 15 })
    expect(out.series[2]).toMatchObject({ dragEquity: 10005, cumulativeCostUsd: 45 })
  })

  it("original curve and closes pass through untouched (no input mutation)", () => {
    const fixture = closes()
    const curve = equitySeries(fixture, STARTING)
    const fixtureCopy = JSON.parse(JSON.stringify(fixture))
    const curveCopy = JSON.parse(JSON.stringify(curve))
    const { lines } = mod.overlayForCloses(fixture)
    mod.dragAdjustedEquity(curve, lines)
    expect(fixture).toEqual(fixtureCopy)
    expect(curve).toEqual(curveCopy)
  })

  it("paper analytics output is deep-equal before/after overlay computation", () => {
    const fixture = closes()
    const before = metricsFrom(fixture, STARTING)
    const { lines } = mod.overlayForCloses(fixture)
    const curve = equitySeries(fixture, STARTING)
    mod.dragAdjustedEquity(curve, lines)
    // The ledger is only ever read: same input rows recompute to the identical
    // report after the overlay ran beside them.
    expect(metricsFrom(fixture, STARTING)).toEqual(before)
    expect(equitySeries(fixture, STARTING)).toEqual(curve)
  })

  it("readPaperCloses uses the injected paper-service reader and returns it verbatim", async () => {
    const fixture = closes()
    const out = await mod.readPaperCloses({ paperHistory: async () => fixture })
    expect(out).toEqual(fixture)
    const empty = await mod.readPaperCloses({ paperHistory: async () => null })
    expect(empty).toEqual([])
  })

  it("read path names the read-only history reader and no marking/closing writer", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../services/costs/paperOverlay.mjs", import.meta.url)),
      "utf8"
    )
    expect(src).toMatch(/paperHistory/)
    for (const banned of [
      "closePaperTrade",
      "openPaperTrade",
      "checkPaperExit",
      "paperAnalytics",
      "saveLedger",
      "writeJSON",
      "writeFile",
      "getHistory",
      "recordSignal",
      "resolveSignal",
      "flushStaleSignals",
      "handlers.mjs",
      "/api/trading"
    ]) {
      expect(src, `read path must not reference ${banned}`).not.toMatch(new RegExp(banned))
    }
  })
})
