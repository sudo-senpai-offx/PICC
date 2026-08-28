import { describe, expect, it } from "vitest"
import {
  DIMENSIONS,
  MIN_BARS,
  STOCHRSI_TRIGGER_BAND,
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