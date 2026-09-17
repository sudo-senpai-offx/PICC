import { afterEach, describe, expect, it } from "vitest"
import { TF_SECONDS } from "../services/mtfConvergence.mjs"
import {
  REGIME_DIMS,
  MIN_BARS,
  choppinessIndex,
  voteChoppiness,
  voteAtrRatio,
  voteAdxRegime,
  voteSupertrend,
  detectRegimeEnhanced,
  detectRegimeLatched,
  resetRegimeLatches,
  regimeKnobs,
  REGIME_MODES,
  DEFAULT_FLOORS
} from "../services/regimeEngine.mjs"

// ---------------------------------------------------------------------
// B-REG-1 — regimeEngine per-plane voters (spec PICC_TRADING_SUITE_REBUILD_v1.md D1).
// Per-voter, per-class fixtures: the six cataloged asset classes (assetCatalog.mjs
// ASSET_ALIASES) share one pure voter surface — class-agnosticism is asserted via
// parity tests (same normalized pattern -> identical vote across class bases).
// Expected values below are hand-worked literals (never recomputed from the
// implementation).
// ---------------------------------------------------------------------

// Class-flavored bases (canonical ids per assetCatalog.mjs ASSET_ALIASES).
const CLASS_BASES = {
  forex: { base: 1.08, label: "EURUSD" },
  metals: { base: 2000, label: "XAUUSD" },
  crypto: { base: 60000, label: "BTCUSD" },
  energies: { base: 78, label: "WTI" },
  indices: { base: 4500, label: "SPX500" },
  equities: { base: 180, label: "TSLA" }
}

/**
 * Deterministic OHLC series in the mtfConvergence.test.mjs style, scaled to the
 * class base price so one pattern works for every class.
 * @param {string} klass - one of CLASS_BASES keys
 * @param {string} pattern - "trend" | "chop" | "neutral" | "volatile" | "flat"
 * @param {number} n - number of bars
 */
function candlesFor(klass, pattern, n, { vol } = {}) {
  const { base } = CLASS_BASES[klass]
  const rows = []
  let close = base
  const tick = Math.max(base * 0.0001, 0.0001)
  for (let i = 0; i < n; i++) {
    let open = close
    if (pattern === "trend") {
      close = base + (i + 1) * tick // steady monotonic ramp
    } else if (pattern === "chop") {
      close = base + (i % 2 === 0 ? 1 : -1) * tick // tight alternation
    } else if (pattern === "neutral") {
      // drift 1.0*base-tick/bar + small alternating offset (hand-worked fixture, see test below)
      close = base + i * tick + (i % 2 === 0 ? 0.6 : -0.6) * tick
    } else if (pattern === "surge") {
      close = base + (i + 1) * tick // trending ramp + expanding range (see calibration note)
    } else if (pattern === "quiet") {
      close = base // flat close, range collapses for the last 12 bars
    } else if (pattern === "flat") {
      close = base
    }
    // Precisely-calibrated range profiles (verified against indicators.mjs
    // adx/atr at fixture design time):
    //   trend/chop/flat   -> constant range 3*tick  (ADX 100 / 3.7, ATR-ratio 1.00)
    //   surge (vol ramp)  -> range (3 + 0.8i)*tick  (ATR-ratio 1.75)
    //   quiet (collapse)  -> range 3*tick, 0.02*tick in the final 12 bars (ATR-ratio 0.46)
    let half
    if (pattern === "surge") half = (1.5 + i * 0.4) * tick
    else if (pattern === "quiet") half = (i < n - 12 ? 1.5 : 0.01) * tick
    else half = (vol ?? 1.5) * tick
    rows.push({ time: 1700000000 + i * 60, open, high: close + half, low: close - half, close, volume: 1000 })
  }
  return rows
}

describe("regimeEngine constants (B-REG-1)", () => {
  it("MIN_BARS matches the MTF engine and legacy regimeDetection floor (30)", () => {
    expect(MIN_BARS).toBe(30)
  })
})

describe("choppinessIndex (B-REG-1)", () => {
  it("returns the textbook Choppiness Index over the last n bars", () => {
    // Hand-worked for base=4500, tick=0.45, window = last 14 bars (i=46..59):
    // close_i = base + i*tick + (i even ? +0.6 : -0.6)*tick, range/bar = 2*vol*tick = 6*tick.
    // sumRange = 14 * 6t = 84t; maxHigh (i=58, even): (58 + 0.6 + 3)t above base;
    // minLow (i=47, odd): (47 - 0.6 - 3)t above base; span = 18.2t.
    // ratio 84/18.2 = 4.615, CHI = 100*log10(4.615)/log10(14) = 57.9 (neutral band).
    const fx = candlesFor("indices", "neutral", 60, { vol: 3 })
    const chi = choppinessIndex(fx, { n: 14 })
    expect(chi).toBeGreaterThan(38.2)
    expect(chi).toBeLessThan(61.8)
    expect(Math.abs(chi - 57.9)).toBeLessThan(1.0)
  })

  it("trending series reads below the trend band (38.2)", () => {
    const forex = candlesFor("forex", "trend", 60)
    const chi = choppinessIndex(forex, { n: 14 })
    expect(chi).not.toBeNull()
    expect(chi).toBeLessThan(38.2)
  })

  it("chop series reads above the chop band (61.8)", () => {
    const energies = candlesFor("energies", "chop", 60)
    const chi = choppinessIndex(energies, { n: 14 })
    expect(chi).not.toBeNull()
    expect(chi).toBeGreaterThan(61.8)
  })

  it("a flat (displacement zero) series abstains: span <= 0 cannot be indexed", () => {
    const metals = candlesFor("metals", "flat", 60, { vol: 0 })
    expect(choppinessIndex(metals, { n: 14 })).toBeNull()
  })

  it("thin data returns null (fewer than n+1 bars)", () => {
    const crypto = candlesFor("crypto", "trend", 10)
    expect(choppinessIndex(crypto, { n: 14 })).toBeNull()
    expect(choppinessIndex(null, { n: 14 })).toBeNull()
  })
})

describe("voteChoppiness (B-REG-1)", () => {
  it("trend vote on a trending forex series", () => {
    const vote = voteChoppiness(candlesFor("forex", "trend", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "trend" })
    expect(typeof vote.reason).toBe("string")
    expect(vote.reason.length).toBeGreaterThan(0)
  })

  it("chop vote on a chop energy series", () => {
    const vote = voteChoppiness(candlesFor("energies", "chop", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "chop" })
  })

  it("neutral vote on the hand-worked neutral indices fixture (CHI 57.9)", () => {
    const vote = voteChoppiness(candlesFor("indices", "neutral", 60, { vol: 3 }))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "neutral" })
  })

  it("equities-class trending parity: same pattern -> same vote regardless of base price", () => {
    const vote = voteChoppiness(candlesFor("equities", "trend", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "trend" })
    const crypto = voteChoppiness(candlesFor("crypto", "trend", 60))
    expect(vote.value).toBe(crypto.value)
  })

  it("thin data abstains honestly: observed false, null value, never a guess", () => {
    const vote = voteChoppiness(candlesFor("metals", "trend", 10))
    expect(vote).toMatchObject({ enabled: true, observed: false, value: null })
    expect(vote.reason.length).toBeGreaterThan(0)
    const missing = voteChoppiness(null)
    expect(missing.observed).toBe(false)
    expect(missing.value).toBeNull()
  })
})

describe("voteAtrRatio (B-REG-1)", () => {
  it("neutral on a constant-range series (ratio ~1.00 in the 0.8-1.5 band)", () => {
    const vote = voteAtrRatio(candlesFor("forex", "trend", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "neutral" })
    expect(vote.reason.length).toBeGreaterThan(0)
  })

  it("volatile when the current ATR runs well above its average (surge, ratio 1.75)", () => {
    const vote = voteAtrRatio(candlesFor("metals", "surge", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "volatile" })
  })

  it("quiet when volatility collapses (quiet, ratio 0.46)", () => {
    const vote = voteAtrRatio(candlesFor("indices", "quiet", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "quiet" })
  })

  it("equities-class parity: surge yields the same volatile vote at any base price", () => {
    expect(voteAtrRatio(candlesFor("equities", "surge", 60)).value).toBe("volatile")
    expect(voteAtrRatio(candlesFor("crypto", "surge", 60)).value).toBe("volatile")
  })

  it("thin data abstains honestly", () => {
    const vote = voteAtrRatio(candlesFor("energies", "trend", 10))
    expect(vote).toMatchObject({ enabled: true, observed: false, value: null })
    expect(vote.reason.length).toBeGreaterThan(0)
    expect(voteAtrRatio(null).observed).toBe(false)
  })
})

describe("voteAdxRegime (B-REG-1)", () => {
  it("trend on a clean directional ramp (ADX 100 >= 25)", () => {
    const vote = voteAdxRegime(candlesFor("energies", "trend", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "trend" })
    expect(vote.reason.length).toBeGreaterThan(0)
  })

  it("no-trend on a chop alternation (ADX 3.7 < 20)", () => {
    const vote = voteAdxRegime(candlesFor("crypto", "chop", 60))
    expect(vote).toMatchObject({ enabled: true, observed: true, value: "no-trend" })
  })

  it("equities-class parity: clean ramp -> trend vote at any base price", () => {
    expect(voteAdxRegime(candlesFor("equities", "trend", 60)).value).toBe("trend")
    expect(voteAdxRegime(candlesFor("metals", "trend", 60)).value).toBe("trend")
  })

  it("thin data abstains honestly", () => {
    const vote = voteAdxRegime(candlesFor("forex", "trend", 10))
    expect(vote).toMatchObject({ enabled: true, observed: false, value: null })
    expect(vote.reason.length).toBeGreaterThan(0)
    expect(voteAdxRegime(null).observed).toBe(false)
  })
})

describe("voteSupertrend (B-REG-1)", () => {
  it("always abstains honestly: indicators.mjs has no Supertrend helper (R6)", () => {
    const vote = voteSupertrend(candlesFor("crypto", "trend", 60))
    expect(vote).toMatchObject({ enabled: true, observed: false, value: null })
    expect(vote.reason).toMatch(/unavailable/i)
  })

  it("never fabricates a read, even on full data", () => {
    for (const klass of Object.keys(CLASS_BASES)) {
      const vote = voteSupertrend(candlesFor(klass, "trend", 60))
      expect(vote.observed).toBe(false)
      expect(vote.value).toBeNull()
    }
  })
})

describe("REGIME_DIMS (B-REG-1)", () => {
  it("lists exactly the four spec dimensions, supertrend included as an abstaining voter", () => {
    expect(REGIME_DIMS).toEqual(["choppiness", "atr_ratio", "adx", "supertrend"])
  })
})

// ---------------------------------------------------------------------
// B-REG-2 — consensus + state + latch (spec D1 / D2, REQ-R1/R2).
// planes are { tfSeconds: candles[] }; biasTf = the bias plane's tf seconds
// (bias weighting per REQ-R2, resolvePreset role labels).
// ---------------------------------------------------------------------

const P = (pattern, klass = "forex", n = 60) => candlesFor(klass, pattern, n)

const planes3Trend = {
  [TF_SECONDS.M5]: P("trend", "forex"),
  [TF_SECONDS.M15]: P("trend", "crypto"),
  [TF_SECONDS.H1]: P("trend", "metals")
}

describe("detectRegimeEnhanced consensus (B-REG-2)", () => {
  it("all-trend planes -> TRENDING with confidence >= 80 and legacy label", () => {
    const read = detectRegimeEnhanced({ planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    expect(read.regime).toBe("TRENDING")
    expect(read.confidence).toBeGreaterThanOrEqual(80)
    expect(read.legacy).toBe("trending")
    expect(read.volatile).toBe(false)
    expect(Array.isArray(read.factors)).toBe(true)
    expect(read.factors.length).toBeGreaterThan(0)
  })

  it("mixed planes (bias trending, entry choppy) -> TRENDING with the conflict carried in factors", () => {
    const read = detectRegimeEnhanced({
      planes: { [TF_SECONDS.M5]: P("chop", "energies"), [TF_SECONDS.H1]: P("trend", "metals") },
      biasTf: TF_SECONDS.H1
    })
    expect(read.regime).toBe("TRENDING")
    expect(read.factors.some((f) => f.includes("61.8"))).toBe(true) // the chop reason is visible, not averaged away
  })

  it("all-flat planes -> RANGING (directionless market)", () => {
    const read = detectRegimeEnhanced({
      planes: { [TF_SECONDS.M5]: P("flat"), [TF_SECONDS.H1]: P("flat", "crypto") },
      biasTf: TF_SECONDS.H1
    })
    expect(read.regime).toBe("RANGING")
    expect(read.legacy).toBe("ranging")
  })

  it("a tied conflict (trend vs chop+flat) -> UNCERTAIN, honest legacy null", () => {
    // Real lean weights (verified probe): trend-plane 2*BIAS=3, chop-plane 2,
    // flat-plane 1 -> trend 3 vs range 3, a tie -> UNCERTAIN.
    const read = detectRegimeEnhanced({
      planes: {
        [TF_SECONDS.M5]: P("chop", "energies"),
        [TF_SECONDS.M15]: P("flat", "indices"),
        [TF_SECONDS.H1]: P("trend", "metals")
      },
      biasTf: TF_SECONDS.H1
    })
    expect(read.regime).toBe("UNCERTAIN")
    expect(read.legacy).toBeNull()
    expect(read.factors.length).toBeGreaterThan(0)
  })

  it("UNCERTAIN + volatile annotation maps to the legacy volatile label", () => {
    // H1 surge: chop-lean 1.5 + trend-lean 1.5 + volatile; M15 trend: 2;
    // M5 chop: 2 -> trend 3.5 vs range 3.5, a tie -> UNCERTAIN, volatile true.
    const read = detectRegimeEnhanced({
      planes: {
        [TF_SECONDS.M5]: P("chop", "energies"),
        [TF_SECONDS.M15]: P("trend", "crypto", 60),
        [TF_SECONDS.H1]: P("surge", "metals")
      },
      biasTf: TF_SECONDS.H1
    })
    expect(read.regime).toBe("UNCERTAIN")
    expect(read.volatile).toBe(true)
    expect(read.legacy).toBe("volatile")
  })

  it("thin planes -> honest unknown, zero confidence, no fabricated regime", () => {
    const read = detectRegimeEnhanced({ planes: { [TF_SECONDS.M5]: P("trend", "forex", 10) }, biasTf: TF_SECONDS.M5 })
    expect(read.regime).toBe("unknown")
    expect(read.confidence).toBe(0)
    expect(read.legacy).toBeNull()
    expect(read.perPlane[TF_SECONDS.M5].abstain).toBe(true)
  })

  it("no planes at all -> unknown, never a crash", () => {
    const read = detectRegimeEnhanced({})
    expect(read.regime).toBe("unknown")
    expect(read.confidence).toBe(0)
  })
})

// A genuinely-different regime from planes3Trend: trend 3 vs range 3 -> UNCERTAIN.
const uncertainTiePlanes = () => ({
  [TF_SECONDS.M5]: P("chop", "energies"),
  [TF_SECONDS.M15]: P("flat", "indices"),
  [TF_SECONDS.H1]: P("trend", "metals")
})

describe("detectRegimeLatched anti-flicker latch (B-REG-2)", () => {
  afterEach(() => resetRegimeLatches())

  it("two consecutive agreeing reads settle the regime", () => {
    const first = detectRegimeLatched({ assetId: "XAUUSD", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    expect(first.unsettled).toBe(true)
    const second = detectRegimeLatched({ assetId: "XAUUSD", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    expect(second.regime).toBe("TRENDING")
    expect(second.unsettled).toBe(false)
    expect(second.confirmCount).toBe(2)
  })

  it("a single conflicting read does NOT flip the settled regime", () => {
    detectRegimeLatched({ assetId: "BTCUSD", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    const second = detectRegimeLatched({ assetId: "BTCUSD", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    expect(second.unsettled).toBe(false)
    const flip = detectRegimeLatched({ assetId: "BTCUSD", planes: uncertainTiePlanes(), biasTf: TF_SECONDS.H1 })
    expect(flip.regime).toBe("TRENDING") // still the settled regime
    expect(flip.unsettled).toBe(true)
    expect(flip.confirmCount).toBe(1)
  })

  it("two consecutive conflicting reads DO flip the regime", () => {
    detectRegimeLatched({ assetId: "EURUSD", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    detectRegimeLatched({ assetId: "EURUSD", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    const first = detectRegimeLatched({ assetId: "EURUSD", planes: uncertainTiePlanes(), biasTf: TF_SECONDS.H1 })
    expect(first.regime).toBe("TRENDING") // settled regime wins while unsettled
    expect(first.unsettled).toBe(true)
    const second = detectRegimeLatched({ assetId: "EURUSD", planes: uncertainTiePlanes(), biasTf: TF_SECONDS.H1 })
    expect(second.regime).toBe("UNCERTAIN") // now committed
    expect(second.unsettled).toBe(false)
  })

  it("resetRegimeLatches clears per-asset latch state", () => {
    detectRegimeLatched({ assetId: "WTI", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    detectRegimeLatched({ assetId: "WTI", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    resetRegimeLatches()
    const again = detectRegimeLatched({ assetId: "WTI", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    expect(again.unsettled).toBe(true)
  })

  it("thin data clears the latch and emits unknown", () => {
    detectRegimeLatched({ assetId: "SPX500", planes: planes3Trend, biasTf: TF_SECONDS.H1 })
    const thin = detectRegimeLatched({ assetId: "SPX500", planes: { [TF_SECONDS.M5]: P("trend", "forex", 10) }, biasTf: TF_SECONDS.M5 })
    expect(thin.regime).toBe("unknown")
    expect(thin.unsettled).toBe(false)
  })
})

describe("regimeKnobs modulation (B-REG-3)", () => {
  const none = { weights: null, conservative: false, labels: null }

  it("mode off returns no knobs for ANY regime (byte-identical converge call)", () => {
    expect(regimeKnobs({ regime: "TRENDING", confidence: 100 }, { mode: "off" })).toEqual(none)
    expect(regimeKnobs({ regime: "UNCERTAIN", confidence: 50 }, { mode: "off" })).toEqual(none)
  })

  it("soft TRENDING scales the bias weight by confidence; floor 60 gates it", () => {
    // confidence 100 -> scale 1.0 -> the intraday preset ladder verbatim
    const hi = regimeKnobs({ regime: "TRENDING", confidence: 100 })
    expect(hi.weights).toEqual({ entry: 0.3, confirm: 0.3, bias: 0.4 })
    expect(hi.conservative).toBe(false)
    expect(hi.labels.suffix).toMatch(/^regime:trending/)
    // confidence 60 (>= floor) -> bias 0.4 * 0.8 = 0.32 — literally scaled
    const mid = regimeKnobs({ regime: "TRENDING", confidence: 60 })
    expect(mid.weights.bias).toBeCloseTo(0.32)
    expect(mid.weights.entry).toBe(0.3)
    expect(mid.weights.confirm).toBe(0.3)
    // confidence 50 (< floor) -> advisory only, nothing applied
    const low = regimeKnobs({ regime: "TRENDING", confidence: 50 })
    expect(low).toEqual(none)
    expect(DEFAULT_FLOORS.soft).toBe(60)
  })

  it("soft RANGING de-emphasizes the bias plane's extrapolation", () => {
    // high confidence ranging -> HTF extrapolation trusted less (0.4 * 0.5)
    const r = regimeKnobs({ regime: "RANGING", confidence: 100 })
    expect(r.weights.bias).toBeCloseTo(0.2)
    expect(r.weights.entry).toBe(0.3)
    expect(r.conservative).toBe(false)
    expect(r.labels.suffix).toMatch(/^regime:ranging/)
  })

  it("soft UNCERTAIN -> conservative, even below the confidence floor", () => {
    const r = regimeKnobs({ regime: "UNCERTAIN", confidence: 50, volatile: true })
    expect(r.conservative).toBe(true)
    expect(r.weights).toBeNull()
    expect(r.labels.suffix).toMatch(/^regime:uncertain/)
    expect(r.labels.suffix).toContain("volatile")
  })

  it("unknown regime and unknown preset are honest no-ops", () => {
    expect(regimeKnobs({}, {})).toEqual(none)
    expect(regimeKnobs({ regime: "TRENDING", confidence: 100 }, { preset: "no-such-preset" })).toEqual(none)
    expect(REGIME_MODES).toEqual(["soft", "hard", "off"])
  })

  it("hard mode: TRENDING verbatim ladder, RANGING mean-reversion weights, UNCERTAIN conservative", () => {
    const t = regimeKnobs({ regime: "TRENDING", confidence: 42 }, { mode: "hard" })
    expect(t.weights).toEqual({ entry: 0.3, confirm: 0.3, bias: 0.4 })
    expect(t.conservative).toBe(false)
    const rg = regimeKnobs({ regime: "RANGING", confidence: 88 }, { mode: "hard" })
    expect(rg.weights).toEqual({ entry: 0.4, confirm: 0.4, bias: 0.2 })
    expect(rg.conservative).toBe(false)
    const u = regimeKnobs({ regime: "UNCERTAIN", confidence: 10 }, { mode: "hard", floors: { soft: 0 } })
    expect(u.conservative).toBe(true)
    expect(u.weights).toBeNull()
  })
})