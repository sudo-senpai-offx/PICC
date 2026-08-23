import { describe, expect, test } from "vitest"
import {
  computeCalibration,
  getBreakevenWinRate,
  getCalibrationSummary,
  bucketKeyFor
} from "../services/calibration.mjs"
import {
  gridSearchGateThresholds,
  walkForwardBacktest,
  chronologicalSplit,
  evaluateGateParams,
  expandGrid,
  GATE_GRID
} from "../services/hyperopt.mjs"

const d = (confidence, result) => ({ confidence, result, payout: 80 })

describe("calibration buckets", () => {
  test("buckets resolved decisions by predicted confidence and computes realized rates", () => {
    const decisions = [
      d(62, "hit"),
      d(63, "hit"),
      d(61, "miss"),
      d(71, "hit"),
      d(73, "miss"),
      d(88, "miss"),
      d(89, "miss")
    ]
    const cal = computeCalibration(decisions)
    expect(cal.totalResolved).toBe(7)
    expect(cal.unbucketed).toBe(0)
    expect(cal.buckets).toHaveLength(3)

    const b62 = cal.buckets.find((b) => b.bucket === "60–65%")
    expect(b62.count).toBe(3)
    expect(b62.predictedWinRate).toBeCloseTo((0.62 + 0.63 + 0.61) / 3, 5)
    expect(b62.realizedWinRate).toBeCloseTo(2 / 3, 5)
    expect(b62.calibrationGap).toBeCloseTo(2 / 3 - (0.62 + 0.63 + 0.61) / 3, 5)

    const b75 = cal.buckets.find((b) => b.bucket === "70–75%")
    expect(b75.count).toBe(2)
    expect(b75.predictedWinRate).toBeCloseTo(0.72, 5)
    expect(b75.realizedWinRate).toBeCloseTo(0.5, 5)

    const b90 = cal.buckets.find((b) => b.bucket === "85–90%")
    expect(b90.count).toBe(2)
    expect(b90.realizedWinRate).toBeCloseTo(0, 5)
    expect(b90.calibrationGap).toBeCloseTo(0 - 0.885, 4)
  })

  test("fraction confidences are normalized to percent buckets and edge values land correctly", () => {
    expect(bucketKeyFor(55)).toBe("55–60%")
    expect(bucketKeyFor(59.9)).toBe("55–60%")
    expect(bucketKeyFor(60)).toBe("60–65%")
    expect(bucketKeyFor(95)).toBe("90–95%")
    expect(bucketKeyFor(54.9)).toBeNull()
    expect(bucketKeyFor(95.1)).toBeNull()
    const cal = computeCalibration([d(0.7, "hit"), d(0.72, "miss")])
    const b = cal.buckets.find((x) => x.bucket === "70–75%")
    expect(b.count).toBe(2)
    expect(b.predictedWinRate).toBeCloseTo(0.71, 5)
  })

  test("pushes count in the bucket but are excluded from the realized win rate", () => {
    const cal = computeCalibration([d(66, "hit"), d(67, "push")])
    const b = cal.buckets.find((x) => x.bucket === "65–70%")
    expect(b.count).toBe(2)
    expect(b.pushes).toBe(1)
    expect(b.realizedWinRate).toBe(1)
    const empty = computeCalibration([{ confidence: 80, result: "push" }])
    expect(empty.buckets[0].realizedWinRate).toBeNull()
    expect(empty.buckets[0].calibrationGap).toBeNull()
  })
})

describe("breakeven win rate", () => {
  test("computes 1 / (1 + payout/100) for standard binary payouts", () => {
    expect(getBreakevenWinRate(100)).toBeCloseTo(0.5, 6)
    expect(getBreakevenWinRate(70)).toBeCloseTo(1 / 1.7, 6)
    expect(getBreakevenWinRate(80)).toBeCloseTo(1 / 1.8, 6)
    expect(getBreakevenWinRate(95)).toBeCloseTo(1 / 1.95, 6)
  })

  test("is monotonically decreasing in payout and rejects invalid payouts", () => {
    expect(getBreakevenWinRate(50)).toBeGreaterThan(getBreakevenWinRate(90))
    for (const bad of [0, -70, null, undefined, "abc"]) {
      expect(getBreakevenWinRate(bad)).toBeNull()
    }
  })
})

describe("sample size adequacy", () => {
  test("labels <100 insufficient, 100–500 limited, >500 adequate", () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => d(70 + (i % 5), i % 2 ? "hit" : "miss"))
    expect(getCalibrationSummary(mk(99)).adequacy).toBe("insufficient")
    expect(getCalibrationSummary(mk(100)).adequacy).toBe("limited")
    expect(getCalibrationSummary(mk(500)).adequacy).toBe("limited")
    expect(getCalibrationSummary(mk(501)).adequacy).toBe("adequate")
  })

  test("summary reports hit rate, predicted average and calibration gap", () => {
    const summary = getCalibrationSummary([
      d(60, "hit"), d(60, "hit"), d(60, "miss"), d(60, "push")
    ])
    expect(summary.totalResolved).toBe(4)
    expect(summary.hits).toBe(2)
    expect(summary.misses).toBe(1)
    expect(summary.pushes).toBe(1)
    expect(summary.hitRate).toBeCloseTo(2 / 3, 5)
    expect(summary.avgPredictedConfidence).toBeCloseTo(0.6, 5)
    expect(summary.calibrationGap).toBeCloseTo(2 / 3 - 0.6, 5)
    expect(summary.source).toBe("trade history")
  })

  test("empty history reports insufficient data honestly", () => {
    const s = getCalibrationSummary([])
    expect(s.totalResolved).toBe(0)
    expect(s.hitRate).toBeNull()
    expect(s.calibrationGap).toBeNull()
    expect(s.adequacy).toBe("insufficient")
    expect(s.source).toBe("insufficient data")
  })
})

function seededCandles(n, { seed = 7, cycle = 40 } = {}) {
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  const out = []
  let price = 100
  for (let i = 0; i < n; i++) {
    const drift = 0.0025 * Math.sin(i / cycle) + 0.0008 * Math.sin(i / 7)
    price = Math.max(1, price * (1 + drift + (rand() - 0.5) * 0.004))
    out.push({ time: i, open: price, high: price, low: price, close: price })
  }
  return out
}

describe("walk-forward split discipline", () => {
  test("chronologicalSplit cuts train before validate with no overlap", () => {
    const candles = seededCandles(300)
    const split = chronologicalSplit(candles, { trainFrac: 0.7 })
    expect(split.splitIndex).toBe(Math.floor(300 * 0.7))
    expect(split.train).toHaveLength(split.splitIndex)
    expect(split.validate).toHaveLength(300 - split.splitIndex)
    expect(split.trainRange[1]).toBeLessThanOrEqual(split.validateRange[0])
    const lastTrainTime = split.train[split.train.length - 1].time
    const firstValidateTime = split.validate[0].time
    expect(lastTrainTime).toBeLessThan(firstValidateTime)
  })

  test("walk-forward windows validate strictly later folds they never trained on", () => {
    const candles = seededCandles(400)
    const wf = walkForwardBacktest(candles, { windows: 5 })
    expect(wf.ok).toBe(true)
    expect(wf.windows.length).toBeGreaterThan(0)
    let prevEnd = -1
    for (const w of wf.windows) {
      const [trainStart, trainEnd] = w.trainRange
      const [valStart, valEnd] = w.validateRange
      expect(trainStart).toBe(0)
      expect(trainEnd).toBeLessThanOrEqual(valStart)
      expect(valStart).toBeGreaterThanOrEqual(prevEnd)
      expect(valEnd).toBe(valStart + w.validateBars)
      expect(w.trainBars).toBe(trainEnd - trainStart)
      prevEnd = valEnd
    }
    const lastFold = wf.folds[wf.folds.length - 1]
    const lastWindow = wf.windows[wf.windows.length - 1]
    expect(lastWindow.validateRange[0]).toBe(lastFold.start)
    expect(lastWindow.validateRange[1]).toBe(lastFold.end)
    expect(wf.aggregate.avgValidationSharpe === null || typeof wf.aggregate.avgValidationSharpe === "number").toBe(true)
  })
})

describe("grid search isolation from the validation window", () => {
  test("mutating validation data never changes the search outcome", () => {
    const candles = seededCandles(320)
    const before = gridSearchGateThresholds(candles, {})
    expect(before.ok).toBe(true)
    expect(before.searchSpace.combos).toBe(
      GATE_GRID.minMtfAgree.length * GATE_GRID.minSentimentAlignment.length * GATE_GRID.aiGateWeight.length
    )
    expect(before.splitIndex).toBe(Math.floor(320 * 0.7))
    expect(before.validationMetrics.bars).toBe(320 - before.splitIndex)

    const snapshot = JSON.stringify({
      bestParams: before.bestParams,
      trainMetrics: before.trainMetrics,
      leaderboard: before.leaderboard
    })

    const mutated = candles.map((c) => ({ ...c }))
    for (let i = before.splitIndex; i < mutated.length; i++) {
      mutated[i] = { time: i, open: 9999, high: 9999, low: 9999, close: 9999 - i * 13.37 }
    }
    const after = gridSearchGateThresholds(mutated, {})
    expect(JSON.stringify({ bestParams: after.bestParams, trainMetrics: after.trainMetrics, leaderboard: after.leaderboard })).toBe(snapshot)
  })

  test("validation metrics are produced once on the untouched trailing slice", () => {
    const candles = seededCandles(280, { seed: 11 })
    const res = gridSearchGateThresholds(candles, {})
    if (res.validationMetrics) {
      expect(res.validationMetrics.bars).toBe(res.validateBars)
      const validateSlice = candles.slice(res.splitIndex)
      const direct = evaluateGateParams(validateSlice, res.bestParams, {})
      expect(direct).toEqual(res.validationMetrics)
    } else {
      expect(res.trainMetrics.trades).toBe(0)
    }
  })

  test("expandGrid enumerates the full cartesian product deterministically", () => {
    const combos = expandGrid(GATE_GRID)
    expect(combos).toHaveLength(3 * 4 * 3)
    expect(new Set(combos.map((c) => JSON.stringify(c))).size).toBe(combos.length)
  })
})
