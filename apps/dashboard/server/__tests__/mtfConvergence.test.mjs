import { describe, expect, it } from "vitest"
import {
  DIMENSIONS,
  MIN_BARS,
  STOCHRSI_TRIGGER_BAND,
  STOCHRSI_OB_OS,
  TF_SECONDS,
  PRESETS,
  resolvePreset,
  voteTrend,
  voteMomentum,
  voteStructure,
  voteTrendStrength,
  voteMomentumTrigger,
  voteVolatility,
  planeScore,
  converge,
  classifyState,
  adxGate,
  fetchPlanes,
  deriveAggregatePlanes,
  loadConvergence
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
    expect(voteTrend({ ema: { read: "bullish alignment" } })).toEqual({ enabled: true, observed: true, value: 1, reason: "ema bull align" })
    expect(voteTrend({ ema: { read: "bearish alignment" } })).toEqual({ enabled: true, observed: true, value: -1, reason: "ema bear align" })
    expect(voteTrend({ ema: { read: "mixed" } })).toEqual({ enabled: true, observed: true, value: 0, reason: "ema mixed" })
    expect(voteTrend({ ema: { read: "n/a" } })).toEqual({ enabled: true, observed: false, value: null, reason: "ema n/a" })
    expect(voteTrend({})).toEqual({ enabled: true, observed: false, value: null, reason: "ema n/a" })
  })

  it("momentum requires RSI and MACD-hist agreement", () => {
    const bull = { rsi: { value: 55 }, macd: { hist: 1.2 } }
    const bear = { rsi: { value: 45 }, macd: { hist: -1.2 } }
    expect(voteMomentum(bull)).toEqual({ enabled: true, observed: true, value: 1, reason: "rsi+macd bull" })
    expect(voteMomentum(bear)).toEqual({ enabled: true, observed: true, value: -1, reason: "rsi+macd bear" })
    expect(voteMomentum({ rsi: { value: 55 }, macd: { hist: -1.2 } })).toEqual({ enabled: true, observed: true, value: 0, reason: "rsi/macd mixed" })
    expect(voteMomentum({ rsi: { value: null }, macd: { hist: 1 } })).toEqual({ enabled: true, observed: false, value: null, reason: "rsi/macd n/a" })
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
    expect(voteStructure(swingsUp, 999)).toEqual({ enabled: true, observed: true, value: 1, reason: "HH/HL" })
    expect(voteStructure(swingsDown, 999)).toEqual({ enabled: true, observed: true, value: -1, reason: "LH/LL" })
    expect(voteStructure(mixed, 999)).toEqual({ enabled: true, observed: true, value: 0, reason: "mixed structure" })
    expect(voteStructure({ highs: [{ index: 1, price: 1 }], lows: [] }, 999)).toEqual({ enabled: true, observed: false, value: null, reason: "structure n/a" })
    // swing points after the observation time are never used
    expect(voteStructure(swingsUp, 15)).toEqual({ enabled: true, observed: false, value: null, reason: "structure n/a" })
  })

  it("trend_strength gates on ADX>=25, direction from +DI/-DI (spec 2.6)", () => {
    expect(voteTrendStrength({ adx: { adx: 30, plusDI: 25, minusDI: 10 } })).toEqual({ enabled: true, observed: true, value: 1, reason: "adx +DI" })
    expect(voteTrendStrength({ adx: { adx: 26, plusDI: 10, minusDI: 20 } })).toEqual({ enabled: true, observed: true, value: -1, reason: "adx -DI" })
    expect(voteTrendStrength({ adx: { adx: 18, plusDI: 25, minusDI: 10 } })).toEqual({ enabled: true, observed: true, value: 0, reason: "no trend" })
    expect(voteTrendStrength({ adx: { adx: 22, plusDI: 25, minusDI: 10 } })).toEqual({ enabled: true, observed: true, value: 0, reason: "trend forming" })
    expect(voteTrendStrength({})).toEqual({ enabled: true, observed: false, value: null, reason: "adx n/a" })
  })

  it("momentum_trigger fires only for an in-band %K/%D cross (design choice)", () => {
    const crossUp = { k: [0, 0, 45], d: [0, 0, 40] }
    const crossDown = { k: [55, 55, 40], d: [50, 50, 45] }
    expect(voteMomentumTrigger(crossUp, 2)).toEqual({ enabled: true, observed: true, value: 1, reason: "stochRSI cross up" })
    expect(voteMomentumTrigger(crossDown, 2)).toEqual({ enabled: true, observed: true, value: -1, reason: "stochRSI cross down" })
    // cross outside the band: no trigger
    expect(voteMomentumTrigger({ k: [50, 50, 75], d: [55, 55, 70] }, 2)).toEqual({ enabled: true, observed: true, value: 0, reason: "no in-band cross" })
    // %K exactly on the band edges fires
    expect(voteMomentumTrigger({ k: [40, 40, 60], d: [40, 40, 55] }, 2).value).toBe(1)
    expect(voteMomentumTrigger({ k: [59, 59, 40], d: [54, 54, 45] }, 2).value).toBe(-1)
    // %K just outside the band: no trigger
    expect(voteMomentumTrigger({ k: [38, 38, 62], d: [40, 40, 55] }, 2)).toEqual({ enabled: true, observed: true, value: 0, reason: "no in-band cross" })
    expect(voteMomentumTrigger({ k: [null, null, 45], d: [null, null, 40] }, 2)).toEqual({ enabled: true, observed: false, value: null, reason: "stochRSI n/a" })
    expect(STOCHRSI_TRIGGER_BAND).toEqual({ lo: 40, hi: 60 })
  })

  it("volatility votes on pull-from-band, not extension", () => {
    const above = { last: 101, bollinger: { mid: 100, percentB: 0.6 } }
    const below = { last: 99, bollinger: { mid: 100, percentB: 0.4 } }
    expect(voteVolatility(above)).toEqual({ enabled: true, observed: true, value: 1, reason: "bull pull" })
    expect(voteVolatility(below)).toEqual({ enabled: true, observed: true, value: -1, reason: "bear pull" })
    // overextended (pctB outside (0.2, 0.8)) is not a pull
    expect(voteVolatility({ last: 102, bollinger: { mid: 100, percentB: 0.9 } })).toEqual({ enabled: true, observed: true, value: 0, reason: "band extreme" })
    expect(voteVolatility({ last: 98, bollinger: { mid: 100, percentB: 0.1 } })).toEqual({ enabled: true, observed: true, value: 0, reason: "band extreme" })
    expect(voteVolatility({ last: null, bollinger: { mid: 100, percentB: 0.5 } })).toEqual({ enabled: true, observed: false, value: null, reason: "boll n/a" })
  })
})

// ---------------------------------------------------------------------
// 1a. Per-dimension votes on synthetic series (whole pipeline)
// ---------------------------------------------------------------------

describe("plane score on synthetic series", () => {
  it("monotonic up feed: trend/momentum/strength +1; no swings; no in-band cross; band-extreme", () => {
    const p = planeScore({ candles: up() })
    expect(p.active).toBe(true)
    expect(p.votes.trend.value).toBe(1)
    expect(p.votes.momentum.value).toBe(1)
    expect(p.votes.market_structure).toEqual({ enabled: true, observed: false, value: null, reason: "structure n/a" })
    expect(p.votes.trend_strength.value).toBe(1)
    expect(p.votes.momentum_trigger.value).toBe(0)
    expect(p.votes.volatility.value).toBe(0)
    expect(p.observed).toBe(5) // only structure abstains on a monotonic ramp
    expect(p.amplitude).toBe(3)
    expect(p.sign).toBe(1)
  })

  it("monotonic down feed mirrors", () => {
    const p = planeScore({ candles: down() })
    expect(p.votes.trend.value).toBe(-1)
    expect(p.votes.momentum.value).toBe(-1)
    expect(p.votes.trend_strength.value).toBe(-1)
    expect(p.amplitude).toBe(-3)
    expect(p.sign).toBe(-1)
  })

  it("flat feed: every dimension abstains from voting (all-zero plane)", () => {
    const p = planeScore({ candles: flat(260) })
    expect(p.active).toBe(true)
    const zeroVoted = DIMENSIONS.filter((d) => d !== "market_structure")
    for (const dim of zeroVoted) expect(p.votes[dim].value).toBe(0)
    expect(p.votes.market_structure.value).toBeNull() // unobserved, not a zero vote
    expect(p.amplitude).toBe(0)
    expect(p.sign).toBe(0)
  })

  it("zig-zag feed produces confirmed swing structure", () => {
    const upP = planeScore({ candles: zigzag(260, { up: true }) })
    expect(upP.votes.market_structure.value).toBe(1)
    expect(upP.votes.market_structure.observed).toBe(true)
    expect(upP.sign).toBe(1)
    const downP = planeScore({ candles: zigzag(260, { up: false }) })
    expect(downP.votes.market_structure.value).toBe(-1)
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
    expect(C.votes.momentum.value).not.toBe(A0.votes.momentum.value) // test is meaningful

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
// 2a/2b/2c. Five-tier presets + plane labels + weights
// ---------------------------------------------------------------------

describe("five-tier presets (2a)", () => {
  it("declares the five presets with exact TF ladders (spec 2.5)", () => {
    expect(PRESETS.scalping).toEqual({ entry: 60, confirm: 300, bias: 900, weights: { entry: 0.3, confirm: 0.3, bias: 0.4 } })
    expect(PRESETS.intraday).toEqual({ entry: 300, confirm: 900, bias: 3600, weights: { entry: 0.3, confirm: 0.3, bias: 0.4 } })
    expect(PRESETS.swingIntraday).toEqual({ entry: 900, confirm: 3600, bias: 14400, weights: { entry: 0.3, confirm: 0.3, bias: 0.4 } })
    expect(PRESETS.swing).toEqual({ entry: 3600, confirm: 14400, bias: 86400, weights: { entry: 0.25, confirm: 0.3, bias: 0.45 } })
    expect(PRESETS.position).toEqual({ entry: 86400, confirm: 604800, bias: 2592000, weights: { entry: 0.2, confirm: 0.35, bias: 0.45 } })
  })

  it("resolves role labels + default weights per plane", () => {
    const r = resolvePreset("swing")
    expect(r.key).toBe("swing")
    expect(r.tfs).toEqual([3600, 14400, 86400])
    expect(r.labels).toEqual({ 3600: "entry", 14400: "confirm", 86400: "bias" })
    expect(r.weights).toEqual({ 3600: 0.25, 14400: 0.3, 86400: 0.45 })
    expect(r.top).toBeNull()
    expect(resolvePreset("nonsense")).toBeNull()
  })

  it("optional top plane is off by default and labeled when enabled (2c)", () => {
    const off = resolvePreset("swing")
    expect(off.tfs).toHaveLength(3)
    const on = resolvePreset("swing", { top: true })
    expect(on.tfs).toEqual([3600, 14400, 86400, 604800])
    expect(on.labels[604800]).toBe("context")
    // position's top plane has no higher standard timeframe -> tf null
    const pos = resolvePreset("position", { top: true })
    expect(pos.top).toEqual({ tf: null, label: "context" })
    expect(pos.tfs).toEqual([86400, 604800, 2592000])
  })
})

describe("preset weights vs sign-sum (2b)", () => {
  it("weighted composite differs from the equal-weight sign-sum", () => {
    // entry up (0.25) vs bias down (0.45): sign-sum cancels, weighting decides
    const planes = { 3600: up(), 14400: flat(), 86400: down() }
    const plain = converge({ planes })
    expect(plain.composite).toBe(0) // pure sign-sum cancels (flat abstains from direction)
    expect(plain.compositeDirection).toBe(0)

    const preset = resolvePreset("swing")
    const weighted = converge({ planes, weights: preset.weights })
    expect(weighted.composite).toBeCloseTo((0.25 - 0.45) / 1, 6)
    expect(weighted.compositeDirection).toBe(-1)
    expect(weighted.compositeDirection).not.toBe(plain.compositeDirection)
  })

  it("plane labels pass through to converge output", () => {
    const preset = resolvePreset("swing")
    const r = converge({
      planes: { 3600: up(), 14400: flat(), 86400: up() },
      labels: preset.labels
    })
    expect(r.planes.find((p) => p.tf === 3600).label).toBe("entry")
    expect(r.planes.find((p) => p.tf === 14400).label).toBe("confirm")
    expect(r.planes.find((p) => p.tf === 86400).label).toBe("bias")
    expect(r.planes.find((p) => p.tf === 3600).source).toBe("unknown")
  })
})

describe("optional top plane data honesty (2c)", () => {
  it("enabling the top plane with data absent abstains; with data it participates", () => {
    const preset = resolvePreset("swing", { top: true })
    const planes = {
      [preset.tfs[0]]: up(),
      [preset.tfs[1]]: flat(),
      [preset.tfs[2]]: up(),
      [preset.tfs[3]]: [] // no data for the context plane
    }
    const r = converge({ planes, labels: preset.labels, sourceByTf: { [preset.tfs[3]]: "backfill" } })
    const top = r.planes.find((p) => p.tf === preset.tfs[3])
    expect(top.active).toBe(false)
    expect(top.abstain).toBe("no data")
    expect(top.label).toBe("context")
    expect(top.source).toBe("backfill")
    expect(r.score5).toBe(Math.round(5 * (2 / 3))) // absent top plane does not change the 3-plane read

    const withData = converge({
      planes: { ...planes, [preset.tfs[3]]: up() },
      labels: preset.labels
    })
    expect(withData.meta.active).toBe(4)
    expect(withData.planes.find((p) => p.tf === preset.tfs[3]).active).toBe(true)
    expect(withData.planes.find((p) => p.tf === preset.tfs[3]).label).toBe("context")
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

// ---------------------------------------------------------------------
// 3a. Per-timeframe dimension config: disabled dims are excluded, not zero-voted
// ---------------------------------------------------------------------

describe("per-timeframe dimension config (3a)", () => {
  it("a flat dim map disables a dimension on every plane, excluding its vote", () => {
    const r = converge({
      planes: { 60: up(), 300: flat(), 900: down() },
      dims: { trend: false }
    })
    for (const p of r.planes) {
      expect(p.votes.trend).toEqual({ enabled: false, observed: false, value: null, reason: "disabled" })
      expect(p.enabledDims).toBe(5)
    }
    expect(r.planes.find((p) => p.tf === 60).amplitude).toBe(2) // momentum + trend_strength only
    expect(r.meta.enabledDims).toBe(5)
  })

  it("disabling a dimension changes the sign-sum by exactly that dimension's vote", () => {
    const full = planeScore({ candles: up() })
    expect(full.amplitude).toBe(3)
    const noTrend = planeScore({ candles: up(), dims: { trend: false } })
    expect(noTrend.amplitude).toBe(full.amplitude - full.votes.trend.value) // 3 - 1 = 2
    // momentum_trigger contributed 0 on this feed; disabling it must not move the sum
    const noTrigger = planeScore({ candles: up(), dims: { momentum_trigger: false } })
    expect(noTrigger.amplitude).toBe(full.amplitude)
    expect(noTrigger.votes.momentum_trigger.enabled).toBe(false)
  })

  it("a per-timeframe map only affects that plane's read; strength normalizes per plane", () => {
    const r = converge({
      planes: { 3600: up(), 14400: up() },
      dims: { 3600: { trend_strength: false } }
    })
    const h1 = r.planes.find((p) => p.tf === 3600)
    const h4 = r.planes.find((p) => p.tf === 14400)
    expect(h1.enabledDims).toBe(5)
    expect(h1.amplitude).toBe(2)
    expect(h4.enabledDims).toBe(6)
    expect(h4.amplitude).toBe(3)
    expect(r.meta.active).toBe(2)
  })
})

// ---------------------------------------------------------------------
// 3b. {enabled, observed, value} honesty: unobserved <> zero
// ---------------------------------------------------------------------

describe("unobserved never zero-votes (3b)", () => {
  it("every dimension reports {enabled, observed, value}; value is null when unobserved", () => {
    const p = planeScore({ candles: up() })
    for (const dim of DIMENSIONS) {
      const v = p.votes[dim]
      expect(v.enabled).toBe(true)
      expect(typeof v.observed).toBe("boolean")
    }
    // structure is configured but unobserved on this feed: null, never a 0 vote
    expect(p.votes.market_structure).toEqual({ enabled: true, observed: false, value: null, reason: "structure n/a" })
    expect(p.observed).toBe(5)
    expect(p.amplitude).toBe(3) // 1+1+1, the structure non-vote never counted
  })

  it("a genuine zero (observed) is value 0 — distinguishable from null and from disabled", () => {
    const p = planeScore({ candles: up() })
    expect(p.votes.momentum_trigger.observed).toBe(true)
    expect(p.votes.momentum_trigger.value).toBe(0) // observed, genuinely zero
    expect(p.votes.market_structure.observed).toBe(false)
    expect(p.votes.market_structure.value).toBeNull() // unobserved
    const disabled = planeScore({ candles: up(), dims: { momentum_trigger: false } })
    expect(disabled.votes.momentum_trigger.enabled).toBe(false)
    expect(disabled.votes.momentum_trigger.value).toBeNull()
    expect(disabled.votes.momentum_trigger.reason).toBe("disabled")
  })
})

// ---------------------------------------------------------------------
// 4a. State machine — deterministic bands + synthetic reachability (R4)
// ---------------------------------------------------------------------

describe("state machine (4a)", () => {
  it("NO TRADE: no directional composite (signs cancel)", () => {
    const r = converge({ planes: { 60: up(), 300: flat(), 900: down() } })
    expect(r.state).toBe("NO TRADE")
    expect(r.why).toBe("no directional composite")
  })

  it("NO TRADE: zero active planes never fabricates a direction", () => {
    const r = converge({ planes: { 60: [] } })
    expect(r.state).toBe("NO TRADE")
    expect(r.why).toBe("no data") // requested but nothing fetched at all
    const abstain = converge({ planes: { 60: up(10), 300: up(10) } })
    expect(abstain.state).toBe("NO TRADE")
    expect(abstain.why).toBe("zero active planes (data abstain)") // requested + fetched-but-thin
    const noData = converge({ planes: {} })
    expect(noData.state).toBe("NO TRADE")
    expect(noData.why).toBe("no data")
  })

  it("NO TRADE: conservative-mode HTF veto beats entry alignment (R8)", () => {
    const planes = { 60: up(), 300: up(), 900: down() } // entry+confirm up, bias down
    const plain = converge({ planes })
    expect(plain.state).toBe("LONG ONLY")
    const veto = converge({ planes, conservative: true })
    expect(veto.state).toBe("NO TRADE")
    expect(veto.why).toBe("H1/4H conflict (conservative veto)")
  })

  it("WAIT: few planes aligned", () => {
    // bias (highest TF) must be trend-moded or the R6 no-trend band rejects first
    const r = converge({ planes: { 60: flat(), 300: flat(), 900: flat(), 3600: up() } })
    expect(r.state).toBe("WAIT")
    // the up ramp's bias plane reads ADX>40 -> the extreme note rides along
    expect(r.why).toBe("weak alignment (1 of 4 planes aligned); low volatility; ADX≥40 extreme")
  })

  it("WATCH both directions: lean established, ladder unconfirmed", () => {
    const longR = converge({ planes: { 60: up(), 300: flat(), 900: up(), 3600: down() } })
    expect(longR.meta.aligned).toBe(2)
    expect(longR.state).toBe("LONG WATCH") // 2 of 4 aligned -> 0.5
    const shortR = converge({ planes: { 60: down(), 300: flat(), 900: down(), 3600: up() } })
    expect(shortR.state).toBe("SHORT WATCH")
  })

  it("ONLY both directions: strong alignment, higher planes agree", () => {
    // the dissenting highest plane keeps ADX in trend-mode so the gate passes
    const longR = converge({ planes: { 60: up(), 300: up(), 3600: down() } })
    expect(longR.state).toBe("LONG ONLY") // 2 of 3 -> 2/3
    expect(longR.why).toBe("bull confluence (higher planes agree); H1/4H conflict; ADX≥40 extreme")
    const shortR = converge({ planes: { 60: down(), 300: down(), 3600: up() } })
    expect(shortR.state).toBe("SHORT ONLY")
    expect(shortR.why).toBe("bear confluence (higher planes agree); H1/4H conflict; ADX≥40 extreme")
  })

  it("BIAS both directions: full confluence", () => {
    const longR = converge({ planes: { 60: up(), 300: up(), 900: up() } })
    expect(longR.state).toBe("LONG BIAS")
    expect(longR.why).toBe("strong bull confluence; ADX≥40 extreme")
    const shortR = converge({ planes: { 60: down(), 300: down(), 900: down() } })
    expect(shortR.state).toBe("SHORT BIAS")
    expect(shortR.why).toBe("bear regime only; ADX≥40 extreme")
  })
})

// ---------------------------------------------------------------------
// 4b. why reason composer — exact strings locked (R4)
// ---------------------------------------------------------------------

describe("why reason composer (4b)", () => {
  it("H1/4H conflict surfaces even without conservative veto", () => {
    const r = converge({ planes: { 60: up(), 300: up(), 900: down() } })
    expect(r.state).toBe("LONG ONLY")
    expect(r.why).toContain("H1/4H conflict")
  })

  it("ADX<20 no trend from a flat bias plane rejects to NO TRADE (R6)", () => {
    const r = converge({ planes: { 60: up(), 300: flat() } })
    expect(r.state).toBe("NO TRADE")
    expect(r.why).toBe("ADX<20 no trend")
  })

  it("data-abstain is appended when a plane lacks samples", () => {
    const r = converge({ planes: { 60: up(), 300: up(), 900: up(10) } })
    expect(r.state).toBe("LONG BIAS")
    expect(r.why).toBe("strong bull confluence; ADX≥40 extreme; data: 2 of 3 planes active")
  })

  it("exact per-state strings are locked against drift", () => {
    expect(classifyState({ compositeDirection: 1, aligned: 2, nActive: 3 })).toEqual({
      state: "LONG ONLY",
      why: "bull confluence (higher planes agree)"
    })
    expect(classifyState({ compositeDirection: -1, aligned: 1, nActive: 4, lowVol: true })).toEqual({
      state: "WAIT",
      why: "weak alignment (1 of 4 planes aligned); low volatility"
    })
    expect(classifyState({ nActive: 0, available: 2 })).toEqual({
      state: "NO TRADE",
      why: "zero active planes (data abstain)"
    })
    expect(classifyState({ compositeDirection: 0, adxTier: "no-trend", nActive: 2, aligned: 0 })).toEqual({
      state: "NO TRADE",
      why: "ADX<20 no trend"
    })
    expect(classifyState({ compositeDirection: 1, adxTier: "no-trend", nActive: 3, aligned: 3 })).toEqual({
      state: "NO TRADE",
      why: "ADX<20 no trend"
    })
  })
})

// ---------------------------------------------------------------------
// 5a. ADX graded gate (R6) — Wilder-attributed convention, direction-blind
// ---------------------------------------------------------------------

describe("ADX graded gate (5a)", () => {
  it("adxGate tiers match the reuse vocabulary (very strong/strong/weak/none)", () => {
    expect(adxGate(15)).toEqual({ tier: "no-trend", label: "none" })
    expect(adxGate(20)).toEqual({ tier: "no-trend", label: "none" }) // boundary: also "no-trend band"
    expect(adxGate(22)).toEqual({ tier: "forming", label: "weak" })
    expect(adxGate(25)).toEqual({ tier: "forming", label: "weak" }) // gray stays gray until >25
    expect(adxGate(26)).toEqual({ tier: "trend", label: "strong" })
    expect(adxGate(40)).toEqual({ tier: "trend", label: "strong" })
    expect(adxGate(41)).toEqual({ tier: "extreme", label: "very strong" })
    expect(adxGate(null)).toEqual({ tier: "none", label: "n/a" })
  })

  it("state/why driven through every tier at the classify-state level", () => {
    expect(classifyState({ compositeDirection: 1, adxTier: "no-trend", nActive: 3, aligned: 3 }))
      .toEqual({ state: "NO TRADE", why: "ADX<20 no trend" })
    expect(classifyState({ compositeDirection: 1, adxTier: "forming", nActive: 3, aligned: 3 }))
      .toEqual({ state: "LONG ONLY", why: "bull confluence (higher planes agree); ADX 20-25 trend forming (gray)" })
    expect(classifyState({ compositeDirection: 1, adxTier: "forming", nActive: 3, aligned: 2 }))
      .toEqual({ state: "LONG WATCH", why: "directional lean (2 of 3 planes aligned); ADX 20-25 trend forming (gray)" })
    expect(classifyState({ compositeDirection: 1, adxTier: "trend", nActive: 3, aligned: 3 }))
      .toEqual({ state: "LONG BIAS", why: "strong bull confluence" })
    expect(classifyState({ compositeDirection: 1, adxTier: "extreme", nActive: 3, aligned: 3 }))
      .toEqual({ state: "LONG BIAS", why: "strong bull confluence; ADX≥40 extreme" })
  })

  it("converge reads the tier from the bias plane's real ADX read", () => {
    expect(converge({ planes: { 60: up(), 300: up(), 900: up() } }).state).toBe("LONG BIAS")
    expect(converge({ planes: { 60: up(), 300: up(), 900: down() } }).state).toBe("LONG ONLY")
    expect(converge({ planes: { 60: up(), 300: flat() } }).state).toBe("NO TRADE")
  })
})

// ---------------------------------------------------------------------
// 5b. StochRSI trigger correction (R7) — cross vs OB/OS zone
// ---------------------------------------------------------------------

describe("StochRSI trigger correction (5b)", () => {
  it("canonical OB/OS stays 80/20 and the trigger line sits strictly inside", () => {
    expect(STOCHRSI_OB_OS).toEqual({ over: 80, under: 20 })
    expect(STOCHRSI_TRIGGER_BAND).toEqual({ lo: 40, hi: 60 })
    expect(STOCHRSI_TRIGGER_BAND.hi).toBeLessThan(STOCHRSI_OB_OS.over)
    expect(STOCHRSI_TRIGGER_BAND.lo).toBeGreaterThan(STOCHRSI_OB_OS.under)
  })

  it("an in-band %K/%D cross fires; a cross leaving the band or into OB/OS does not", () => {
    expect(voteMomentumTrigger({ k: [50, 50, 59], d: [52, 52, 55] }, 2).value).toBe(1)
    // cross closes above the trigger line (60) -> not a trigger, approaching OB
    expect(voteMomentumTrigger({ k: [55, 75], d: [50, 72] }, 1).value).toBe(0)
    expect(voteMomentumTrigger({ k: [55, 75], d: [50, 72] }, 1).reason).toBe("no in-band cross")
    // cross inside the OB zone (80+) -> still not a trigger
    expect(voteMomentumTrigger({ k: [75, 85], d: [72, 82] }, 1).value).toBe(0)
    expect(voteMomentumTrigger({ k: [75, 85], d: [72, 82] }, 1).reason).toBe("no in-band cross")
    // cross down inside the band -> fires -1
    expect(voteMomentumTrigger({ k: [59, 59, 41], d: [54, 54, 45] }, 2).value).toBe(-1)
  })
})

// ---------------------------------------------------------------------
// 6a. M1 -> 30m/4h aggregation: timestamps + planes compute (R10)
// ---------------------------------------------------------------------

describe("M1 aggregation (6a)", () => {
  it("deriveAggregatePlanes groups M1 into whole-multiple TFs with group-end timestamps", () => {
    const m1 = synth(120, 0.5) // times 1700000000 + i*60
    const { planes, sourceByTf } = deriveAggregatePlanes(m1, [1800, 14400])
    expect(Object.keys(planes).map(Number).sort((a, b) => a - b)).toEqual([1800, 14400])
    const m30 = planes[1800]
    expect(m30).toHaveLength(4) // 120 / 30
    expect(m30.map((c) => c.time)).toEqual([
      1700000000 + 29 * 60,
      1700000000 + 59 * 60,
      1700000000 + 89 * 60,
      1700000000 + 119 * 60
    ])
    expect(sourceByTf[1800]).toBe("aggregate")
    // OHLC: open of the group's first bar, high/low across the group, close of the last
    expect(m30[0].open).toBe(m1[0].open)
    expect(m30[0].close).toBe(m1[29].close)
    expect(m30[0].high).toBe(Math.max(...m1.slice(0, 30).map((c) => c.high)))
    expect(m30[0].low).toBe(Math.min(...m1.slice(0, 30).map((c) => c.low)))
  })

  it("a long M1 feed yields ACTIVE 30m + 4h planes that compute with matching timestamps", () => {
    const m1 = synth(8000, 0.5)
    const { planes } = deriveAggregatePlanes(m1, [1800, 14400])
    expect(planes[1800]).toHaveLength(267) // ceil(8000 / 30); trailing partial group is kept
    expect(planes[14400]).toHaveLength(34) // ceil(8000 / 240)
    const p30 = planeScore({ candles: planes[1800] })
    expect(p30.active).toBe(true)
    expect(p30.sign).toBe(1)
    const p240 = planeScore({ candles: planes[14400] })
    expect(p240.active).toBe(true)
    expect(p240.sign).toBe(1)
    // last aggregated bar closes at the same instant as the last M1 bar
    expect(planes[1800][planes[1800].length - 1].time).toBe(m1[m1.length - 1].time)
    expect(planes[14400][planes[14400].length - 1].time).toBe(m1[m1.length - 1].time)
  })
})

// ---------------------------------------------------------------------
// 6b. Wired loader: source/stale reporting, honest absence (R10)
// ---------------------------------------------------------------------

describe("wired loader (6b)", () => {
  it("in-buffer TFs direct, 30m/4h from M1, daily+ via fetchHigher", async () => {
    const m1 = synth(1000, 0.5) // 33 x 30m bars, 4 x 4h bars
    const live300 = up(260)
    const res = await loadConvergence({
      tfs: [300, 900, 1800, 14400, 86400],
      liveByTf: { 300: live300, 900: [] }, // preseeded but empty -> falls through honestly
      m1,
      fetchHigher: async (tf) =>
        tf === 86400
          ? { candles: up(260), source: "yahoo", stale: false }
          : { candles: [], source: "none", stale: true }
    })
    expect(res.planes[300]).toBe(live300)
    expect(res.sourceByTf[300]).toBe("live")
    expect(res.planes[1800]).toHaveLength(34) // ceil(1000 / 30)
    expect(res.sourceByTf[1800]).toBe("aggregate")
    expect(res.planes[14400]).toHaveLength(5) // ceil(1000 / 240)
    expect(res.sourceByTf[14400]).toBe("aggregate")
    expect(res.planes[86400]).toHaveLength(260)
    expect(res.sourceByTf[86400]).toBe("yahoo")
    expect(res.staleByTf).toEqual({ 300: false, 900: true, 1800: false, 14400: false, 86400: false })
  })

  it("empty everywhere -> source none + stale, and converge excludes it (never zero)", async () => {
    const res = await loadConvergence({
      tfs: [86400, 604800],
      fetchHigher: async () => ({ candles: [], source: "none", stale: true })
    })
    expect(res.planes).toEqual({ 86400: [], 604800: [] })
    expect(res.sourceByTf[86400]).toBe("none")
    expect(res.staleByTf[86400]).toBe(true)
    const r = converge({ planes: res.planes, sourceByTf: res.sourceByTf, staleByTf: res.staleByTf })
    expect(r.meta.active).toBe(0)
    expect(r.score5).toBeNull()
    expect(r.planes.every((p) => p.score === null)).toBe(true)
    expect(r.planes.every((p) => p.stale === true)).toBe(true)
    expect(r.state).toBe("NO TRADE")
  })

  it("a throwing higher fetcher yields absent planes, never zeros", async () => {
    const res = await loadConvergence({
      tfs: [86400],
      fetchHigher: async () => { throw new Error("yahoo down") }
    })
    expect(res.planes[86400]).toEqual([])
    expect(res.sourceByTf[86400]).toBe("none")
    expect(res.staleByTf[86400]).toBe(true)
  })

  it("stale-but-present data flags the plane while staying included", async () => {
    const res = await loadConvergence({
      tfs: [300, 86400],
      liveByTf: { 300: up() },
      fetchHigher: async () => ({ candles: up(260), source: "yahoo", stale: true })
    })
    const r = converge({ planes: res.planes, sourceByTf: res.sourceByTf, staleByTf: res.staleByTf })
    const daily = r.planes.find((p) => p.tf === 86400)
    expect(daily.active).toBe(true)
    expect(daily.stale).toBe(true)
    expect(daily.source).toBe("yahoo")
    expect(r.planes.find((p) => p.tf === 300).stale).toBe(false)
  })
})