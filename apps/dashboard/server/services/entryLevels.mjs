// Ideal buy/sell price points near the current timeframe.
//
// Given a candle series for the ACTIVE asset + selected timeframe, derives the
// nearest actionable price zones using confluence of classic techniques:
//   • Classic floor-trader pivots (PP / R1-R2 / S1-S2) from the previous
//     trading window (the older half of the visible candles acts as the
//     "previous period" so intraday timeframes work without session calendars)
//   • Recent swing highs/lows (fractal pivots over a 5-bar wing)
//   • EMA20 / EMA50 dynamic support-resistance
//   • ATR(14) proximity bands around spot
// Every level carries a confluence strength (how many independent methods
// agree within half an ATR) and its distance from spot in percent. The two
// strongest clusters below/above spot become the ideal buy / sell zones.
//
// Pure function — no I/O, easy to unit test. Never throws.

function round(n, digits = 6) {
  const f = Math.pow(10, digits)
  return Math.round(Number(n) * f) / f
}

export function computeAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return null
  let atr = null
  let count = 0
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]
    const p = candles[i - 1]
    const tr = Math.max(
      Number(c.high) - Number(c.low),
      Math.abs(Number(c.high) - Number(p.close)),
      Math.abs(Number(c.low) - Number(p.close))
    )
    if (!Number.isFinite(tr) || tr < 0) continue
    count++
    atr = atr == null ? tr : (atr * (Math.min(count, period) - 1) + tr) / Math.min(count, period)
  }
  return atr != null && atr > 0 ? atr : null
}

export function computeEma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
  }
  return Number.isFinite(ema) ? ema : null
}

/** Fractal swing points: bar whose high/low is the extreme within a 5-bar wing. */
function swings(candles, wing = 2) {
  const highs = []
  const lows = []
  for (let i = wing; i < candles.length - wing; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue
      if (Number(candles[j].high) >= Number(candles[i].high)) isHigh = false
      if (Number(candles[j].low) <= Number(candles[i].low)) isLow = false
    }
    if (isHigh) highs.push({ price: Number(candles[i].high), time: candles[i].time })
    if (isLow) lows.push({ price: Number(candles[i].low), time: candles[i].time })
  }
  return { highs, lows }
}

/**
 * Compute ideal buy/sell levels.
 * @param candles Array<{time, open, high, low, close}> ascending by time,
 *                newest last. Should be the ACTIVE asset's candles at the
 *                user's timeframe.
 */
export function computeEntryLevels(candles, opts = {}) {
  try {
    const rows = Array.isArray(candles) ? candles.filter((c) => (
      c && Number.isFinite(Number(c.open)) && Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) && Number.isFinite(Number(c.close)) &&
      Number(c.close) > 0 && Number(c.high) >= Number(c.low)
    )) : []
    if (rows.length < 30) {
      return { ok: false, reason: `not enough candles (${rows.length}/30)` }
    }
    const closes = rows.map((c) => Number(c.close))
    const spot = closes[closes.length - 1]
    const atr = computeAtr(rows.slice(-60), 14) ?? spot * 0.002 // 0.2% sensible floor

    // ── Classic pivots from the previous window ────────────────────────────
    // The first half of the visible window approximates the completed period;
    // the second half is the live one. Works uniformly on any timeframe.
    const halfIdx = Math.floor(rows.length / 2)
    const prevWindow = rows.slice(Math.max(0, halfIdx - 24), halfIdx)
    const pH = Math.max(...prevWindow.map((c) => Number(c.high)))
    const pL = Math.min(...prevWindow.map((c) => Number(c.low)))
    const pC = Number(prevWindow[prevWindow.length - 1]?.close ?? spot)
    const pp = (pH + pL + pC) / 3
    const r1 = 2 * pp - pL
    const s1 = 2 * pp - pH
    const r2 = pp + (pH - pL)
    const s2 = pL - (pH - pp)

    // ── Dynamic S/R ────────────────────────────────────────────────────────
    const ema20 = computeEma(closes.slice(-120), 20)
    const ema50 = computeEma(closes.slice(-150), 50)

    // ── Candidate pool with sources ────────────────────────────────────────
    const candidates = [
      { price: pp, source: "pivot-pp" },
      { price: r1, source: "pivot-r1" },
      { price: s1, source: "pivot-s1" },
      { price: r2, source: "pivot-r2" },
      { price: s2, source: "pivot-s2" }
    ]
    if (ema20 != null) candidates.push({ price: ema20, source: "ema20" })
    if (ema50 != null) candidates.push({ price: ema50, source: "ema50" })

    const { highs, lows } = swings(rows.slice(-80), 2)
    for (const s of highs.slice(-4)) candidates.push({ price: s.price, source: "swing-high" })
    for (const s of lows.slice(-4)) candidates.push({ price: s.price, source: "swing-low" })

    // ── Cluster candidates into levels (half-ATR tolerance) ────────────────
    const tol = atr / 2
    const sorted = [...candidates].sort((a, b) => a.price - b.price)
    const clusters = []
    for (const cand of sorted) {
      const last = clusters[clusters.length - 1]
      if (last && Math.abs(cand.price - last.anchor) <= tol) {
        last.members.push(cand)
        last.anchor = last.members.reduce((s, m) => s + m.price, 0) / last.members.length
      } else {
        clusters.push({ anchor: cand.price, members: [cand] })
      }
    }

    // ── Score, classify and rank ───────────────────────────────────────────
    const levels = clusters.map((cl) => {
      const price = round(cl.anchor)
      const distancePct = round(((price - spot) / spot) * 100, 3)
      const kind = price < spot ? "support" : price > spot ? "resistance" : "spot"
      const sources = [...new Set(cl.members.map((m) => m.source))]
      // Confluence strength: distinct methods agreeing here (1..5).
      const methodGroups = new Set(sources.map((s) => s.replace(/-(high|low)$/, "")))
      const strength = Math.min(5, Math.max(1, methodGroups.size + (cl.members.length >= 3 ? 1 : 0)))
      return {
        price,
        kind,
        strength,
        sources,
        distancePct,
        atrMultiple: round(Math.abs(price - spot) / atr, 2)
      }
    }).filter((l) => l.kind !== "spot" && Math.abs(l.distancePct) <= 5) // keep near-the-money only

    const supports = levels.filter((l) => l.kind === "support").sort((a, b) => b.distancePct - a.distancePct)
    const resistances = levels.filter((l) => l.kind === "resistance").sort((a, b) => a.distancePct - b.distancePct)

    // Ideal BUY zone: strongest nearby support band (level ± quarter ATR).
    // Ideal SELL zone: strongest nearby resistance band.
    const buildZone = (list) => {
      const best = list.find((l) => l.strength >= 2) ?? list[0] ?? null
      if (!best) return null
      const band = Math.max(atr / 4, spot * 0.0002)
      return {
        low: round(best.price - band),
        high: round(best.price + band),
        anchor: best.price,
        strength: best.strength,
        sources: best.sources
      }
    }

    return {
      ok: true,
      timeframe: opts.timeframe ?? null,
      generatedAt: new Date().toISOString(),
      spot: round(spot),
      atr: round(atr),
      levels: [...supports, ...resistances].slice(0, 8),
      buyZone: buildZone(supports),
      sellZone: buildZone(resistances),
      note:
        supports.length && resistances.length
          ? "confluence of pivots, swings and EMAs"
          : "thin level set — widen timeframe or candle count"
    }
  } catch (err) {
    return { ok: false, reason: err?.message ?? "entry-level computation failed" }
  }
}
