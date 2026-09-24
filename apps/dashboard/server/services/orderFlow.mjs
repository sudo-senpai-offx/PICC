/**
 * Order-flow / delta analysis.
 *
 * HONESTY CONTRACT (PICC Constitution; WS-6 D14 / AC-008)
 * --------------------------------------------------------
 * Order-flow delta, CVD, and absorption are properties of a *signed-trades
 * feed* (maker flow / trade classification). OHLCV bars carry no aggressor-side
 * information, so a bar cannot yield buy/sell delta.
 *
 * The pre-WS-6 implementation inferred delta from candle body direction
 * (close >= open => "buying") and published the result as `imbalance`,
 * `bullish-absorption`, `bearish-absorption`, and `divergence — hidden
 * selling`. That was fabricated market microstructure: invented data shaped
 * like a real signal. Its `divergence` branch was additionally *structurally
 * unreachable*, because the delta sign was derived from the very price
 * direction it claimed to contradict (recorded in AUDIT_REPORT §5.9 and pinned
 * by server/__tests__/orderFlow.test.mjs).
 *
 * That approximation is REMOVED. With no signed-trades feed, every order-flow
 * field is reported `unavailable` and states why. Divergence below is now
 * genuinely reachable, because delta comes from a feed independent of price.
 *
 * Mirrors the established honesty contract in
 * server/services/v32Execution.mjs (`volumeDelta`, `cumulativeVolumeDelta`).
 */

const round4 = (n) => Math.round(Number(n) * 1e4) / 1e4

const UNAVAILABLE_REASON =
  "no signed-trades feed: OHLCV bars contain no aggressor-side information, so delta/CVD/absorption " +
  "cannot be derived from candle structure. The former candle-derived approximation was removed as " +
  "fabricated data (PICC Constitution; WS-6 D14 / AC-008)."

function unavailableResult({ bars, lookback }) {
  return {
    available: false,
    delta: [],
    cumulative: null,
    avgDelta: null,
    imbalance: "unavailable",
    signals: [],
    dataFidelity: Array.isArray(bars) && bars.length ? "ohlcv-bar-only" : "no-feed",
    reason: UNAVAILABLE_REASON,
    lookback
  }
}

/**
 * @param {object} input
 * @param {Array<{timeMs?:number,time?:number,price?:number,side?:string,amount?:number}>|null} input.trades
 *   Signed-trade series. Without it, order flow is reported unavailable.
 * @param {Array<object>|null} input.bars
 *   OHLCV bars. Used only to classify the last bar's direction so that
 *   price/delta divergence can be evaluated. Never used to synthesize delta.
 * @param {number} input.lookback
 */
export function analyzeOrderFlow({ trades = null, bars = null, lookback = 20 } = {}) {
  const list = Array.isArray(trades) ? trades : null
  if (list == null || list.length === 0) {
    return unavailableResult({ bars, lookback })
  }

  const points = list.map((t) => {
    const amount = Number(t?.amount) || 0
    const side = t?.side
    // A "take" fill consumes resting size without shifting the delta.
    const signed = side === "buy" ? amount : side === "sell" ? -amount : 0
    return {
      time: t?.timeMs ?? t?.time ?? null,
      side: side ?? null,
      delta: round4(signed),
      price: Number.isFinite(Number(t?.price)) ? Number(t.price) : null,
      volume: round4(amount)
    }
  })

  const cumulative = points.reduce((sum, p) => sum + p.delta, 0)
  const avgDelta = points.length ? round4(cumulative / points.length) : 0

  let imbalance = "neutral"
  if (avgDelta > 100) imbalance = "buy-heavy"
  else if (avgDelta < -100) imbalance = "sell-heavy"

  const signals = []
  const last3 = points.slice(-3)
  if (last3.length === 3 && last3.every((p) => p.delta > 0)) {
    signals.push({ type: "bullish-absorption", desc: "3 consecutive buy-side delta prints" })
  }
  if (last3.length === 3 && last3.every((p) => p.delta < 0)) {
    signals.push({ type: "bearish-absorption", desc: "3 consecutive sell-side delta prints" })
  }

  // Divergence is meaningful only because delta is feed-derived and therefore
  // independent of the price move it is compared against.
  const lastTrade = points[points.length - 1]
  const lastBar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null
  if (lastTrade && lastBar && Number.isFinite(Number(lastBar.close)) && Number.isFinite(Number(lastBar.open))) {
    if (lastBar.close > lastBar.open && lastTrade.delta < 0) {
      signals.push({ type: "divergence", desc: "Price up but buy/sell delta negative — hidden selling" })
    }
    if (lastBar.close < lastBar.open && lastTrade.delta > 0) {
      signals.push({ type: "divergence", desc: "Price down but buy/sell delta positive — hidden buying" })
    }
  }

  return {
    available: true,
    delta: points,
    cumulative: round4(cumulative),
    avgDelta,
    imbalance,
    signals,
    dataFidelity: "signed-trades",
    source: "signed-trades maker flow",
    lookback
  }
}
