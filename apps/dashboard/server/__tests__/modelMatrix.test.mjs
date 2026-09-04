import { describe, expect, it } from "vitest"
import { computeModelMatrix, recordModelOutcomes, getModelWeights, isPruned } from "../services/modelMatrix.mjs"
import { canonicalAssetId, assetsEquivalent, yahooSymbolFor, ASSET_ALIASES } from "../services/assetCatalog.mjs"

/** Deterministic OHLC series generator. */
function synth(n, driftPerBar) {
  const rows = []
  let price = 100
  for (let i = 0; i < n; i++) {
    price += driftPerBar
    rows.push({
      time: 1700000000 + i * 60,
      open: price - driftPerBar,
      high: price + 0.5,
      low: price - 0.5,
      close: price
    })
  }
  return rows
}

describe("asset catalog (active-asset detection)", () => {
  it("canonicalizes every instrument class", () => {
    expect(canonicalAssetId("XAU/USD")).toBe("GOLD")
    expect(canonicalAssetId("Gold (OTC)")).toBe("GOLD")
    expect(canonicalAssetId("Bitcoin")).toBe("BTCUSD")
    expect(canonicalAssetId("btc")).toBe("BTCUSD")
    expect(canonicalAssetId("US30")).toBe("US30")
    expect(canonicalAssetId("Wall Street")).toBe("US30")
    expect(canonicalAssetId("DOW")).toBe("US30")
    expect(canonicalAssetId("NAS100")).toBe("NAS100")
    expect(canonicalAssetId("GER40")).toBe("GER40")
    expect(canonicalAssetId("DAX")).toBe("GER40")
    expect(canonicalAssetId("WTI")).toBe("OIL")
    expect(canonicalAssetId("UKOIL")).toBe("BRENT")
    expect(canonicalAssetId("EUR/USD")).toBe("EURUSD")
    expect(canonicalAssetId("Ethereum")).toBe("ETHUSD")
  })

  it("matches broker labels against normalized client ids equivalently", () => {
    expect(assetsEquivalent("Gold", "GOLD")).toBe(true)
    expect(assetsEquivalent("XAU/USD", "GOLD")).toBe(true)
    expect(assetsEquivalent("Bitcoin", "BTCUSD")).toBe(true)
    expect(assetsEquivalent("EURUSD", "GBPUSD")).toBe(false)
  })

  it("treats stablecoin-quoted crypto as the same instrument as USD-quoted", () => {
    // Binance-style BTCUSDT and Coinbase-style BTC-USD are the same asset to PICC.
    expect(canonicalAssetId("BTCUSDT")).toBe("BTCUSD")
    expect(canonicalAssetId("BTC/USDT")).toBe("BTCUSD")
    expect(canonicalAssetId("ETHUSDT")).toBe("ETHUSD")
    expect(canonicalAssetId("SOLUSDT")).toBe("SOLUSD")
    expect(assetsEquivalent("BTCUSDT", "BTCUSD")).toBe(true)
    expect(assetsEquivalent("BTC/USDT", "BTC-USD")).toBe(true)
  })

  it("resolves forex pairs via slash, Yahoo =X and human nicknames", () => {
    expect(canonicalAssetId("EUR/USD")).toBe("EURUSD")
    expect(canonicalAssetId("USDJPY=X")).toBe("USDJPY")
    expect(canonicalAssetId("Cable")).toBe("GBPUSD")
    expect(canonicalAssetId("Aussie")).toBe("AUDUSD")
    expect(canonicalAssetId("Loonie")).toBe("USDCAD")
    expect(canonicalAssetId("Euro Dollar")).toBe("EURUSD")
    expect(canonicalAssetId("Dollar Yen")).toBe("USDJPY")
    expect(canonicalAssetId("gbpjpy")).toBe("GBPJPY")
    expect(canonicalAssetId("USDMXN=X")).toBe("USDMXN")
    expect(assetsEquivalent("EUR/USD", "EURUSD=X")).toBe(true)
    expect(assetsEquivalent("Cable", "GBP/USD")).toBe(true)
    expect(assetsEquivalent("EURUSD", "GBPUSD")).toBe(false)
  })

  it("resolves top-traded equities via ticker and human names", () => {
    expect(canonicalAssetId("AAPL")).toBe("AAPL")
    expect(canonicalAssetId("Apple")).toBe("AAPL")
    expect(canonicalAssetId("Apple Inc")).toBe("AAPL")
    expect(canonicalAssetId("TSLA")).toBe("TSLA")
    expect(canonicalAssetId("Google")).toBe("GOOGL")
    expect(canonicalAssetId("Alphabet")).toBe("GOOGL")
    expect(canonicalAssetId("Microsoft")).toBe("MSFT")
    expect(canonicalAssetId("Nvidia")).toBe("NVDA")
    expect(canonicalAssetId("Meta Platforms")).toBe("META")
    expect(assetsEquivalent("Apple", "AAPL")).toBe(true)
    expect(assetsEquivalent("Tesla", "TSLA")).toBe(true)
  })

  it("drops Yahoo =X forex suffixes but never =F futures", () => {
    // "=X" is Yahoo's forex quote form — collapses to the bare pair.
    expect(canonicalAssetId("BTCUSD=X")).toBe("BTCUSD")
    // "=F" is Yahoo's futures form — distinct instrument, must stay intact.
    expect(canonicalAssetId("GC=F")).toBe("GC=F")
    expect(yahooSymbolFor("GC=F")).toBe("GC=F")
  })

  it("maps every commodity/index to a real Yahoo symbol", () => {
    expect(yahooSymbolFor("GOLD")).toBe("GC=F")
    expect(yahooSymbolFor("SILVER")).toBe("SI=F")
    expect(yahooSymbolFor("PLATINUM")).toBe("PL=F")
    expect(yahooSymbolFor("OIL")).toBe("CL=F")
    expect(yahooSymbolFor("BRENT")).toBe("BZ=F")
    expect(yahooSymbolFor("NATGAS")).toBe("NG=F")
    expect(yahooSymbolFor("US30")).toBe("^DJI")
    expect(yahooSymbolFor("NAS100")).toBe("^NDX")
    expect(yahooSymbolFor("SPX500")).toBe("^GSPC")
    expect(yahooSymbolFor("GER40")).toBe("^GDAXI")
    expect(yahooSymbolFor("UK100")).toBe("^FTSE")
    // forex + crypto conventions preserved
    expect(yahooSymbolFor("EURUSD")).toBe("EURUSD=X")
    expect(yahooSymbolFor("BTCUSD")).toBe("BTC-USD")
    // equities pass through untouched (no Yahoo suffix magic)
    expect(yahooSymbolFor("AAPL")).toBe("AAPL")
    expect(yahooSymbolFor("TSLA")).toBe("TSLA")
    expect(yahooSymbolFor("Nvidia")).toBe("NVDA")
  })

  it("every alias resolves to a non-empty canonical id", () => {
    for (const [canonical, aliases] of Object.entries(ASSET_ALIASES)) {
      for (const alias of aliases) {
        expect(canonicalAssetId(alias), `${alias} → ${canonical}`).toBe(canonical)
      }
    }
  })
})

describe("model matrix (multiplexing consensus)", () => {
  it("runs the full battery and fuses a bullish consensus on an uptrend", () => {
    const out = computeModelMatrix(synth(120, 0.3))
    expect(out.ok).toBe(true)
    expect(out.modelsRun).toBe(9)
    expect(out.pruned).toEqual([])
    // Monte-Carlo may honestly abstain on degenerate series, but on a real
    // uptrend every model votes.
    expect(out.consensus.total).toBe(out.modelsRun)
    expect(out.votes.length).toBe(out.modelsRun)
    expect(out.consensus.direction).toBe("up")
    expect(out.consensus.agree).toBeGreaterThanOrEqual(Math.ceil(out.modelsRun / 2))
    expect(out.spot).toBeGreaterThan(0)
  }, 20000)

  it("fuses bearish on a downtrend", () => {
    const out = computeModelMatrix(synth(120, -0.3))
    expect(out.ok).toBe(true)
    expect(out.consensus.direction).toBe("down")
  }, 20000)

  it("shrinks confidence when models disagree (flat series)", () => {
    const flat = synth(120, 0)
    const out = computeModelMatrix(flat)
    expect(out.ok).toBe(true)
    expect(out.consensus.confidence).toBeLessThanOrEqual(75)
  }, 20000)

  it("votes carry weights and notes; every vote has direction+confidence", () => {
    const out = computeModelMatrix(synth(120, 0.2))
    for (const v of out.votes) {
      expect(["up", "down", "flat"]).toContain(v.direction)
      expect(v.confidence).toBeGreaterThanOrEqual(0)
      expect(v.confidence).toBeLessThanOrEqual(100)
      expect(Number.isFinite(v.weight)).toBe(true)
      expect(typeof v.note).toBe("string")
    }
  }, 20000)

  it("refuses thin or corrupt input without throwing", () => {
    expect(computeModelMatrix([]).ok).toBe(false)
    expect(computeModelMatrix(synth(10, 0.1)).ok).toBe(false)
    expect(() => computeModelMatrix(null)).not.toThrow()
    expect(() => computeModelMatrix([{ open: "x" }])).not.toThrow()
  })

  it("online learner updates weights from outcomes and clamps them", () => {
    recordModelOutcomes(
      [{ short: "trend", direction: "up" }, { short: "rsi", direction: "down" }],
      true // price went up: trend right, rsi wrong
    )
    const weights = getModelWeights()
    expect(weights.trend.accuracy).toBeGreaterThan(50)
    expect(weights.rsi.accuracy).toBeLessThan(50)
    for (const w of Object.values(weights)) {
      expect(w.weight).toBeGreaterThanOrEqual(0.4)
      expect(w.weight).toBeLessThanOrEqual(1.6)
    }
  })

  it("stochastic reversion votes against the extreme on one-sided series, flat mid-band", () => {
    // Steady uptrend: price pinned to the top of its 14-bar window → %K ≥ 80 → fades down.
    expect(computeModelMatrix(synth(120, 0.3)).votes.find((v) => v.short === "stoch").direction).toBe("down")
    // Steady downtrend: %K ≤ 20 → fades up.
    expect(computeModelMatrix(synth(120, -0.3)).votes.find((v) => v.short === "stoch").direction).toBe("up")
    // Flat series: %K = 50 → neutral, no chase.
    expect(computeModelMatrix(synth(120, 0)).votes.find((v) => v.short === "stoch").direction).toBe("flat")
  }, 20000)

  it("anchored-VWAP deviation reversion beyond the band, flat inside it", () => {
    // Rising series trades well above its volume-weighted anchor → overextended down.
    expect(computeModelMatrix(synth(120, 0.3)).votes.find((v) => v.short === "avwap").direction).toBe("down")
    // Falling series: underbought up.
    expect(computeModelMatrix(synth(120, -0.3)).votes.find((v) => v.short === "avwap").direction).toBe("up")
    // Flat series: deviation ≈ 0 → in band, neutral.
    expect(computeModelMatrix(synth(120, 0)).votes.find((v) => v.short === "avwap").direction).toBe("flat")
  }, 20000)

  it("prunes a model that persists at-or-below chance across 50+ resolved outcomes", () => {
    // Drive a dedicated (non-registered) short consistently wrong 60 times.
    for (let i = 0; i < 60; i++) recordModelOutcomes([{ short: "doomed", direction: "up" }], false)
    expect(isPruned("doomed")).toBe(true)
    const w = getModelWeights().doomed
    expect(w.pruned).toBe(true)
    expect(w.samples).toBeGreaterThanOrEqual(50)
    expect(w.weight).toBe(0) // excluded from fusion — record kept, weighting stopped
    expect(w.prunedReason).toContain("persistent realized accuracy")
  })

  it("decays an elevated win-rate toward chance when new evidence stops", () => {
    // Build an accurate record for a dedicated short.
    for (let i = 0; i < 12; i++) recordModelOutcomes([{ short: "hotstreak", direction: "up" }], true)
    const before = getModelWeights().hotstreak.accuracy
    expect(before).toBeGreaterThan(80)
    // No further wins recorded — pure decay ticks must erode the elevated rate.
    recordModelOutcomes([], true)
    recordModelOutcomes([], true)
    recordModelOutcomes([], true)
    const after = getModelWeights().hotstreak.accuracy
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(50) // eroded toward, never below, chance
  })
})

/** Range-bound series pinned mid-channel (Donchian hi 101 / lo 99, close 100). */
function rangeBound(n) {
  const rows = []
  for (let i = 0; i < n; i++) {
    rows.push({ time: 1700000000 + i * 60, open: 100, high: 101, low: 99, close: 100 })
  }
  return rows
}

/** Deterministic non-trivial series (oscillation + drift) for MACD equivalence. */
function wavy(n) {
  const rows = []
  for (let i = 0; i < n; i++) {
    const price = 100 + 4 * Math.sin(i / 6) + i * 0.02
    rows.push({
      time: 1700000000 + i * 60,
      open: price - 0.05,
      high: price + 0.4,
      low: price - 0.4,
      close: price
    })
  }
  return rows
}

/** The ORIGINAL O(n²) MACD implementation — reference the O(n) rewrite must match. */
function referenceMacdHist(closes) {
  const emaOf = (values, period) => {
    if (!Array.isArray(values) || values.length < period) return null
    const k = 2 / (period + 1)
    let e = values.slice(0, period).reduce((s, v) => s + v, 0) / period
    for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k)
    return e
  }
  const macdSeries = []
  for (let end = 26; end <= closes.length; end++) {
    const f = emaOf(closes.slice(0, end), 12)
    const s = emaOf(closes.slice(0, end), 26)
    if (f != null && s != null) macdSeries.push(f - s)
  }
  const signal = emaOf(macdSeries, 9)
  const macd = macdSeries[macdSeries.length - 1]
  if (signal == null || !Number.isFinite(macd)) return null
  return macd - signal
}

describe("audit §5.4/§5.5 — breakout neutrality + O(n) MACD", () => {
  it("breakout votes flat mid-channel instead of a coin-flip direction", () => {
    const out = computeModelMatrix(rangeBound(80))
    const b = out.votes.find((v) => v.short === "breakout")
    expect(b.direction).toBe("flat")
    expect(b.note).toContain("mid-band")
    expect(b.confidence).toBeLessThan(40)
  }, 20000)

  it("breakout still fires directionally at the channel tails", () => {
    const up = computeModelMatrix(synth(120, 0.3)).votes.find((v) => v.short === "breakout")
    const down = computeModelMatrix(synth(120, -0.3)).votes.find((v) => v.short === "breakout")
    expect(up.direction).toBe("up")
    expect(down.direction).toBe("down")
  }, 20000)

  it("O(n) MACD reproduces the quadratic implementation exactly", () => {
    const candles = wavy(90)
    const closes = candles.map((c) => Number(c.close))
    const refHist = referenceMacdHist(closes)
    const out = computeModelMatrix(candles)
    const v = out.votes.find((x) => x.short === "macd")
    expect(v.direction).toBe(refHist > 0 ? "up" : refHist < 0 ? "down" : "flat")
    const normRef = (refHist / closes[closes.length - 1]) * 100
    expect(v.note).toBe(`hist ${normRef.toFixed(4)}%`)
  }, 20000)
})
