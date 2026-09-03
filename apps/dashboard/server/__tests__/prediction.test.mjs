import { describe, expect, it } from "vitest"
import { backtestModels, conformalQuantile, predictDirection } from "../services/prediction.mjs"

// Deterministic synthetic series so tests never depend on the network.
function series(start, dailyReturn, n) {
  const out = []
  let v = start
  for (let i = 0; i < n; i++) {
    out.push(v)
    v = v * (1 + dailyReturn)
  }
  return out
}

describe("predictDirection", () => {
  it("needs at least 30 observations", () => {
    const r = predictDirection(series(100, 0.001, 20), 3)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/30/)
  })

  it("calls a sustained uptrend up", () => {
    const r = predictDirection(series(100, 0.002, 200), 3)
    expect(r.ok).toBe(true)
    expect(r.direction).toBe("up")
    expect(r.confidence).toBeGreaterThanOrEqual(50)
    expect(r.confidence).toBeLessThanOrEqual(95)
  })

  it("calls a sustained downtrend down", () => {
    const r = predictDirection(series(100, -0.002, 200), 3)
    expect(r.ok).toBe(true)
    expect(r.direction).toBe("down")
  })

  it("is deterministic for identical input", () => {
    const closes = series(100, 0.001, 150)
    expect(predictDirection(closes, 5)).toEqual(predictDirection(closes, 5))
  })

  it("reports honest backtest metadata", () => {
    const r = predictDirection(series(100, 0.0015, 300), 3)
    expect(r.horizonDays).toBe(3)
    expect(r.sampleSize).toBeGreaterThan(0)
    expect(r.hitRate).toBeGreaterThanOrEqual(0)
    expect(r.hitRate).toBeLessThanOrEqual(100)
    expect(typeof r.models.momentum).toBe("number")
    expect(typeof r.models.trend).toBe("number")
    expect(typeof r.models.monteCarlo).toBe("number")
    expect(typeof r.agreement).toBe("number")
    expect(r.note.length).toBeGreaterThan(0)
  })

  it("clamps the horizon to a sane range", () => {
    const closes = series(100, 0.001, 200)
    expect(predictDirection(closes, 5000).horizonDays).toBe(60)
    expect(predictDirection(closes, 0).horizonDays).toBe(3) // 0 => default
    expect(predictDirection(closes, -2).horizonDays).toBe(3) // negative => default
  })

  it("cleans non-finite and non-positive values", () => {
    const closes = [100, 0, NaN, 105, "bad"]
    for (let v = 108; v <= 220; v += 3) closes.push(v)
    const r = predictDirection(closes, 3)
    expect(r.ok).toBe(true)
    expect(r.last).toBeGreaterThan(0)
  })

  it("mean-reversion model pulls toward the long-run mean log-price", () => {
    // A series that sits well below its own historical mean (long high plateau,
    // then a step down and flat). The mean-reversion model must lean "up"
    // toward the long-run mean. This catches the old unit bug where the long-run
    // mean was taken from the mean *daily return* instead of the mean
    // *log-price*, which flipped the pull term negative for prices above 1.
    const closes = []
    for (let i = 0; i < 300; i++) closes.push(200)
    for (let i = 0; i < 60; i++) closes.push(100)
    const r = predictDirection(closes, 3)
    expect(r.ok).toBe(true)
    expect(r.models.meanRevert).toBeGreaterThan(0)
  })

  it("tags the engine identity (F-08) and emits a split-conformal band on a long series (F-10)", () => {
    const r = predictDirection(series(100, 0.001, 1200), 3)
    expect(r.ok).toBe(true)
    expect(r.engine).toBe("8-model-classic")
    expect(r.band).not.toBeNull()
    expect(r.band.method).toBe("split-conformal")
    expect(r.band.sampleSize).toBeGreaterThanOrEqual(20)
    expect(r.band.horizonLogMoveP80).toBeGreaterThan(0)
    expect(r.band.horizonLogMoveP90).toBeGreaterThanOrEqual(r.band.horizonLogMoveP80)
    expect(r.band.upperPrice90).toBeGreaterThan(r.last)
    expect(r.band.lowerPrice90).toBeLessThan(r.last)
  })

  it("declines to claim a best model or band when the sample is too thin (F-07/F-10)", () => {
    // 70 bars, h=3 => 9 embargoed windows => below the 12-window significance
    // floor and the 20-residual conformal floor.
    const r = predictDirection(series(100, 0.001, 70), 3)
    expect(r.ok).toBe(true)
    expect(r.bestModelHitRate).toBeNull()
    expect(r.band).toBeNull()
  })
})

describe("backtestModels (F-06 embargo)", () => {
  it("keeps walk-forward windows non-overlapping with an embargo bar", () => {
    const bt = backtestModels(series(100, 0.001, 1200), 3, 20)
    const starts = bt.windows.map((w) => w.start)
    expect(starts.length).toBeGreaterThan(1)
    for (let i = 1; i < starts.length; i++) {
      // h test bars consumed by the previous window, plus 1 quiet embargo bar.
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(4)
    }
  })

  it("reports per-model counts and residuals sized to the evaluated windows", () => {
    const bt = backtestModels(series(100, 0.001, 1200), 3, 20)
    expect(bt.sampleSize).toBeGreaterThan(0)
    expect(bt.residuals.length).toBe(bt.sampleSize)
    for (const [name, n] of Object.entries(bt.counts)) {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(bt.sampleSize)
    }
  })
})

describe("conformalQuantile (F-10)", () => {
  it("returns the finite-sample corrected empirical quantile", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    // ceil((100+1)*0.9)-1 = 90 => sorted[90] = 91
    expect(conformalQuantile(sorted, 0.1)).toBe(91)
    // ceil((100+1)*0.8)-1 = 80 => sorted[80] = 81
    expect(conformalQuantile(sorted, 0.2)).toBe(81)
  })

  it("returns null on an empty sample and clamps into range", () => {
    expect(conformalQuantile([], 0.1)).toBeNull()
    expect(conformalQuantile([5], 0.1)).toBe(5) // single observation, clamped
  })
})
