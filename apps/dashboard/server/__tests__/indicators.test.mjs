import { describe, expect, test } from "vitest"
import { mean, std, sma, ema, rsi, macd } from "../services/indicators.mjs"

describe("indicators primitives (slice 5d coverage)", () => {
  test("mean and population std are exact", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(std([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2), 10) // population (TA-Lib) convention
  })

  test("sma seeds null until a full window", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  test("ema seeds with the SMA of the first period then recurs", () => {
    // period 3 → k = 0.5; seed SMA(1,2,3) = 2; then 4*0.5+2*0.5 = 3; 5*0.5+3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  test("rsi is 100 on a pure rally and 0 on a pure selloff", () => {
    const rally = Array.from({ length: 30 }, (_, i) => 100 + i)
    const selloff = Array.from({ length: 30 }, (_, i) => 200 - i)
    const up = rsi(rally, 14)
    const down = rsi(selloff, 14)
    expect(up[up.length - 1]).toBe(100)
    expect(down[down.length - 1]).toBe(0)
  })

  test("rsi sits near 50 on a flat series", () => {
    const flat = Array.from({ length: 30 }, () => 100)
    const r = rsi(flat, 14)
    expect(r[r.length - 1]).toBe(50)
  })

  test("macd trend: line above signal on an uptrend, below on an accelerating downtrend", () => {
    // MACD polarity is a statement about ACCELERATION: a constant-rate drift
    // makes fast/slow EMAs converge (hist ~ 0), so both fixtures must accelerate.
    // Rally: compounding growth (absolute step grows every bar).
    const rally = Array.from({ length: 80 }, (_, i) => 100 * 1.004 ** i)
    // Selloff: additive steps that widen every bar (price falls faster over time).
    const selloff = []
    let p = 2000
    for (let i = 0; i < 80; i++) {
      selloff.push(p)
      p -= 2 + i * 0.5
    }
    const up = macd(rally)
    const down = macd(selloff)
    const midMean = (arr) => {
      const mid = arr.slice(30, 65)
      return mid.reduce((s, v) => s + v, 0) / mid.length
    }
    expect(midMean(up.hist)).toBeGreaterThan(0)
    expect(midMean(down.hist)).toBeLessThan(0)
  })
})
