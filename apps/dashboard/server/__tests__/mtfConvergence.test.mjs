import { describe, expect, it } from "vitest"
import {
  DIMENSIONS,
  MIN_BARS,
  STOCHRSI_TRIGGER_BAND,
  voteTrend,
  voteMomentum,
  voteStructure,
  voteTrendStrength,
  voteMomentumTrigger,
  voteVolatility,
  planeScore,
  converge,
  fetchPlanes
} from "../services/mtfConvergence.mjs"

// ---------------------------------------------------------------------
// Deterministic OHLC series generators (modelMatrix.test.mjs conventions).
// ---------------------------------------------------------------------

/**
 * Accelerating ramp: strictly convex upward (drift>0) or concave downward
 * (drift<0). The accelerating slope keeps the MACD histogram sign definite at
 * the last bar (a linear ramp's hist converges to ~0, which would mute the
 * momentum dimension); still monotonic, so no confirmed swing structure.
 */
function synth(n, driftPerBar, { vol = 0.5, base = 100, accel = 0.001 } = {}) {
  const rows = []
  let price = base
  const dir = driftPerBar >= 0 ? 1 : -1
  for (let i = 0; i < n; i++) {
    price += driftPerBar + dir * accel * i
    rows.push({
      time: 1700000000 + i * 60,
      open: price - (driftPerBar + dir * accel * i),
      high: price + vol,
      low: price - vol,
      close: price,
      volume: 1000
    })
  }
  return rows
}

/** Flat series: constant close. All dimension reads deterministic. */
function flat(n = 260, { base = 100, vol = 0.5 } = {}) {
  const rows = []
  for (let i = 0; i < n; i++) {
    rows.push({
      time: 1700000000 + i * 60,
      open: base,
      high: base + vol,
      low: base - vol,
      close: base,
      volume: 1000
    })
  }
  return rows
}

/** Zig-zag with rising (up) or falling (down) confirmed swing structure. */
function zigzag(n, { up = true, vol = 0.05 } = {}) {
  const rows = []
  let price = 100
  let phase = 0
  const dir = up ? 1 : -1
  while (rows.length < n) {
    const upLeg = phase % 2 === 0 // thrust leg first, then a partial retrace
    const bars = upLeg ? 8 : 4
    const step = (upLeg ? 0.5 : -0.32) * dir
    for (let k = 0; k < bars && rows.length < n; k++) {
      price += step
      rows.push({
        time: 1700000000 + rows.length * 60,
        open: price - step,
        high: price + vol,
        low: price - vol,
        close: price,
        volume: 1000
      })
    }
    phase++
  }
  return rows
}

const up = (n = 260) => synth(n, 0.5)
const down = (n = 260) => synth(n, -0.5)

// ---------------------------------------------------------------------
// 1a. Per-dimension voters — unit branches on hand-built fixtures
// ---------------------------------------------------------------------

describe("dimension voters (unit)", () => {
  it("trend reads EMA alignment", () => {
    expect(voteTrend({ ema: { read: "bullish alignment" } })).toEqual({ vote: 1, observed: true, reason: "ema bull align" })
    expect(voteTrend({ ema: { read: "bearish alignment" } })).toEqual({ vote: -1, observed: true, reason: "ema bear align" })
    expect(voteTrend({ ema: { read: "mixed" } })).toEqual({ vote: 0, observed: true, reason: "ema mixed" })
    expect(voteTrend({ ema: { read: "n/a" } })).toEqual({ vote: 0, observed: false, reason: "ema n/a" })
    expect(voteTrend({})).toEqual({ vote: 0, observed: false, reason: "ema n/a" })
  })

  it("momentum requires RSI and MACD-hist agreement", () => {
    const bull = { rsi: { value: 55 }, macd: { hist: 1.2 } }
    const bear = { rsi: { value: 45 }, macd: { hist: -1.2 } }
    expect(voteMomentum(bull)).toEqual({ vote: 1, observed: true, reason: "rsi+macd bull" })
    expect(voteMomentum(bear)).toEqual({ vote: -1, observed: true, reason: "rsi+macd bear" })
    expect(voteMomentum({ rsi: { value: 55 }, macd: { hist: -1.2 } })).toEqual({ vote: 0, observed: true, reason: "rsi/macd mixed" })
    expect(voteMomentum({ rsi: { value: null }, macd: { hist: 1 } })).toEqual({ vote: 0, observed: false, reason: "rsi/macd n/a" })
  })

  it("structure uses the two latest confirmed swings on each side", () => {
    const swingsUp = {
      highs: [{ index: 10, price: 110 }, { index: 20, price: 120 }],
      lows: [{ index: 12, price: 105 }, { index: 22, price: 115 }]
    }
    const swingsDown = {
      highs: [{ index: 10, price: 120 }, { index: 20, price: 110 }],
      lows: [{ index: 12, price: 115 }, { index: 22, price: 105 }]
    }
    const mixed = {
      highs: [{ index: 10, price: 110 }, { index: 20, price: 120 }],
      lows: [{ index: 12, price: 110 }, { index: 22, price: 105 }]
    }
    expect(voteStructure(swingsUp, 999)).toEqual({ vote: 1, observed: true, reason: "HH/HL" })
    expect(voteStructure(swingsDown, 999)).toEqual({ vote: -1, observed: true, reason: "LH/LL" })
    expect(voteStructure(mixed, 999)).toEqual({ vote: 0, observed: true, reason: "mixed structure" })
    expect(voteStructure({ highs: [{ index: 1, price: 1 }], lows: [] }, 999)).toEqual({ vote: 0, observed: false, reason: "structure n/a" })
    // swing points after the observation time are never used
    expect(voteStructure(swingsUp, 15)).toEqual({ vote: 0, observed: false, reason: "structure n/a" })
  })

  it("trend_strength gates on ADX>=25, direction from +DI/-DI (spec 2.6)", () => {
    expect(voteTrendStrength({ adx: { adx: 30, plusDI: 25, minusDI: 10 } })).toEqual({ vote: 1, observed: true, reason: "adx +DI" })
    expect(voteTrendStrength({ adx: { adx: 26, plusDI: 10, minusDI: 20 } })).toEqual({ vote: -1, observed: true, reason: "adx -DI" })
    expect(voteTrendStrength({ adx: { adx: 18, plusDI: 25, minusDI: 10 } })).toEqual({ vote: 0, observed: true, reason: "no trend" })
    expect(voteTrendStrength({ adx: { adx: 22, plusDI: 25, minusDI: 10 } })).toEqual({ vote: 0, observed: true, reason: "trend forming" })
    expect(voteTrendStrength({})).toEqual({ vote: 0, observed: false, reason: "adx n/a" })
  })

  it("momentum_trigger fires only for an in-band %K/%D cross (design choice)", () => {
    const crossUp = { k: [0, 0, 45], d: [0, 0, 40] }
    const crossDown = { k: [55, 55, 40], d: [50, 50, 45] }
    expect(voteMomentumTrigger(crossUp, 2)).toEqual({ vote: 1, observed: true, reason: "stochRSI cross up" })
    expect(voteMomentumTrigger(crossDown, 2)).toEqual({ vote: -1, observed: true, reason: "stochRSI cross down" })
    // cross outside the band: no trigger
    expect(voteMomentumTrigger({ k: [50, 50, 75], d: [55, 55, 70] }, 2)).toEqual({ vote: 0, observed: true, reason: "no in-band cross" })
    // %K exactly on the band edges fires
    expect(voteMomentumTrigger({ k: [40, 40, 60], d: [40, 40, 55] }, 2).vote).toBe(1)
    expect(voteMomentumTrigger({ k: [59, 59, 40], d: [54, 54, 45] }, 2).vote).toBe(-1)
    // %K just outside the band: no trigger
    expect(voteMomentumTrigger({ k: [38, 38, 62], d: [40, 40, 55] }, 2)).toEqual({ vote: 0, observed: true, reason: "no in-band cross" })
    expect(voteMomentumTrigger({ k: [null, null, 45], d: [null, null, 40] }, 2)).toEqual({ vote: 0, observed: false, reason: "stochRSI n/a" })
    expect(STOCHRSI_TRIGGER_BAND).toEqual({ lo: 40, hi: 60 })
  })

  it("volatility votes on pull-from-band, not extension", () => {
    const above = { last: 101, bollinger: { mid: 100, percentB: 0.6 } }
    const below = { last: 99, bollinger: { mid: 100, percentB: 0.4 } }
    expect(voteVolatility(above)).toEqual({ vote: 1, observed: true, reason: "bull pull" })
    expect(voteVolatility(below)).toEqual({ vote: -1, observed: true, reason: "bear pull" })
    // overextended (pctB outside (0.2, 0.8)) is not a pull
    expect(voteVolatility({ last: 102, bollinger: { mid: 100, percentB: 0.9 } })).toEqual({ vote: 0, observed: true, reason: "band extreme" })
    expect(voteVolatility({ last: 98, bollinger: { mid: 100, percentB: 0.1 } })).toEqual({ vote: 0, observed: true, reason: "band extreme" })
    expect(voteVolatility({ last: null, bollinger: { mid: 100, percentB: 0.5 } })).toEqual({ vote: 0, observed: false, reason: "boll n/a" })
  })
})

// ---------------------------------------------------------------------
// 1a. Per-dimension votes on synthetic series (whole pipeline)
// ---------------------------------------------------------------------

describe("plane score on synthetic series", () => {
  it("monotonic up feed: trend/momentum/strength +1; no swings; no in-band cross; band-extreme", () => {
    const p = planeScore({ candles: up() })
    expect(p.active).toBe(true)
    expect(p.votes.trend.vote).toBe(1)
    expect(p.votes.momentum.vote).toBe(1)
    expect(p.votes.market_structure).toEqual({ vote: 0, observed: false, reason: "structure n/a" })
    expect(p.votes.trend_strength.vote).toBe(1)
    expect(p.votes.momentum_trigger.vote).toBe(0)
    expect(p.votes.volatility.vote).toBe(0)
    expect(p.observed).toBe(5) // only structure abstains on a monotonic ramp
    expect(p.amplitude).toBe(3)
    expect(p.sign).toBe(1)
  })

  it("monotonic down feed mirrors", () => {
    const p = planeScore({ candles: down() })
    expect(p.votes.trend.vote).toBe(-1)
    expect(p.votes.momentum.vote).toBe(-1)
    expect(p.votes.trend_strength.vote).toBe(-1)
    expect(p.amplitude).toBe(-3)
    expect(p.sign).toBe(-1)
  })

  it("flat feed: every dimension abstains from voting (all-zero plane)", () => {
    const p = planeScore({ candles: flat(260) })
    expect(p.active).toBe(true)
    for (const dim of DIMENSIONS) expect(p.votes[dim].vote).toBe(0)
    expect(p.amplitude).toBe(0)
    expect(p.sign).toBe(0)
  })

  it("zig-zag feed produces confirmed swing structure", () => {
    const upP = planeScore({ candles: zigzag(260, { up: true }) })
    expect(upP.votes.market_structure.vote).toBe(1)
    expect(upP.votes.market_structure.observed).toBe(true)
    expect(upP.sign).toBe(1)
    const downP = planeScore({ candles: zigzag(260, { up: false }) })
    expect(downP.votes.market_structure.vote).toBe(-1)
    expect(downP.sign).toBe(-1)
  })

  it("thin and empty planes abstain", () => {
    const thin = planeScore({ candles: up(10) })
    expect(thin.active).toBe(false)
    expect(thin.abstain).toBe(`low bars (<${MIN_BARS})`)
    expect(thin.score).toBeNull()
    const empty = planeScore({ candles: [] })
    expect(empty.active).toBe(false)
    expect(empty.abstain).toBe("no data")
  })
})

// ---------------------------------------------------------------------
// 1c. Closed-bar invariant: a forming bar never changes the state (R9)
// ---------------------------------------------------------------------

describe("closed-bar invariant (dropOpen)", () => {
  it("dropOpen computes on [0..N-2]; a forming bar cannot move the read", () => {
    const base = up(260) // natural closed 260-bar window
    const A0 = planeScore({ candles: base, dropOpen: false })

    // Append a violently bearish forming bar: without dropOpen it flips momentum.
    const forming = {
      time: 1700000000 + 260 * 60,
      open: 225, high: 240, low: 5, close: 10, volume: 1000
    }
    const withForming = [...base, forming]

    const C = planeScore({ candles: withForming, dropOpen: false })
    expect(C.votes.momentum.vote).not.toBe(A0.votes.momentum.vote) // test is meaningful

    const B = planeScore({ candles: withForming, dropOpen: true })
    expect(B.votes).toEqual(A0.votes)
    expect(B.sign).toBe(A0.sign)
    expect(B.amplitude).toBe(A0.amplitude)
  })

  it("converge passes the invariant through", () => {
    const base = up(260)
    const forming = { time: 1700000000 + 260 * 60, open: 225, high: 240, low: 5, close: 10, volume: 1000 }
    const a = converge({ planes: { 300: base }, dropOpen: false })
    const b = converge({ planes: { 300: [...base, forming] }, dropOpen: true })
    expect(b.score5).toBe(a.score5)
    expect(b.composite).toBe(a.composite)
    expect(b.planes[0].sign).toBe(a.planes[0].sign)
  })
})

// ---------------------------------------------------------------------
// 1b. Timeframe aggregation: 5-scale / quality / confidence (R5)
// ---------------------------------------------------------------------

describe("convergence aggregation (1b)", () => {
  const threeUp = { 60: up(), 300: up(), 900: up(260) }

  it("full alignment -> 5/5, quality 10, confidence ~80 on three strong-up planes", () => {
    const r = converge({ planes: threeUp })
    expect(r.ok).toBe(true)
    expect(r.meta.active).toBe(3)
    expect(r.meta.aligned).toBe(3)
    expect(r.composite).toBe(1)
    expect(r.compositeDirection).toBe(1)
    expect(r.score5).toBe(5)
    expect(r.quality).toBe(10)
    expect(r.confidence).toBe(80)
  })

  it("signs cancel -> 0/5 no-alignment with exact bands", () => {
    const r = converge({ planes: { 60: up(), 300: flat(), 900: down() } })
    expect(r.composite).toBe(0)
    expect(r.compositeDirection).toBe(0)
    expect(r.meta.aligned).toBe(0)
    expect(r.score5).toBe(0)
    expect(r.quality).toBe(5)
    expect(r.confidence).toBe(13)
  })

  it("mixed active-count: an abstaining plane degrades quality honestly", () => {
    const r = converge({ planes: { 60: up(), 300: up(), 900: up(10) } })
    expect(r.meta.available).toBe(3)
    expect(r.meta.active).toBe(2)
    expect(r.meta.aligned).toBe(2)
    expect(r.score5).toBe(5)
    expect(r.quality).toBe(8) // participation 2/3 absorbs the abstainer
    expect(r.confidence).toBe(80)
    const thinPlane = r.planes.find((p) => p.tf === 900)
    expect(thinPlane.active).toBe(false)
    expect(thinPlane.abstain).toBe(`low bars (<${MIN_BARS})`)
    expect(thinPlane.score).toBeNull()
  })

  it("no active planes -> nulls ('\u2014'), never zero; empty input reports not-ok", () => {
    const r1 = converge({ planes: { 60: [] } })
    expect(r1.ok).toBe(true)
    expect(r1.meta.active).toBe(0)
    expect(r1.score5).toBeNull()
    expect(r1.quality).toBeNull()
    expect(r1.confidence).toBeNull()
    const r2 = converge({ planes: {} })
    expect(r2.ok).toBe(false)
    expect(r2.score5).toBeNull()
  })

  it("per-plane source labels pass through honestly (unknown when absent)", () => {
    const r = converge({
      planes: { 60: up(), 300: up() },
      sourceByTf: { 60: "live" }
    })
    expect(r.planes.find((p) => p.tf === 60).source).toBe("live")
    expect(r.planes.find((p) => p.tf === 300).source).toBe("unknown")
  })

  it("equal-weight default is a pure sign-sum; explicit weights keep direction", () => {
    const r = converge({ planes: threeUp, weights: { 60: 3, 300: 1, 900: 1 } })
    expect(r.composite).toBe(1)
    expect(r.score5).toBe(5)
  })

  it("all-up planes must stay aligned when one plane is flat", () => {
    const r = converge({ planes: { 60: up(), 300: up(), 900: flat() } })
    expect(r.meta.aligned).toBe(2)
    expect(r.score5).toBe(Math.round(5 * (2 / 3)))
  })
})

// ---------------------------------------------------------------------
// 1d. Thin async loader with mocked brokers
// ---------------------------------------------------------------------

describe("thin async loader (1d)", () => {
  it("maps {candles, source} fetcher results into the pure input shape", async () => {
    const fetcher = async (tf) =>
      tf === 60 ? { candles: up(), source: "live" } : { candles: [], source: "backfill" }
    const { planes, sourceByTf } = await fetchPlanes([60, 300], fetcher)
    expect(planes[60]).toHaveLength(260)
    expect(planes[300]).toEqual([])
    expect(sourceByTf).toEqual({ 60: "live", 300: "backfill" })
    const r = await converge({ planes, sourceByTf })
    expect(r.planes.find((p) => p.tf === 60).active).toBe(true)
    expect(r.planes.find((p) => p.tf === 300).abstain).toBe("no data")
  })

  it("accepts plain-array fetchers and labels the source unknown", async () => {
    const { planes, sourceByTf } = await fetchPlanes([60], async () => up())
    expect(planes[60]).toHaveLength(260)
    expect(sourceByTf[60]).toBe("unknown")
  })

  it("a failing fetcher yields an absent plane labeled 'error' (no fabrication)", async () => {
    const { planes, sourceByTf } = await fetchPlanes([900], async () => {
      throw new Error("broker down")
    })
    expect(planes[900]).toEqual([])
    expect(sourceByTf[900]).toBe("error")
    const r = await converge({ planes, sourceByTf })
    expect(r.score5).toBeNull()
  })
})