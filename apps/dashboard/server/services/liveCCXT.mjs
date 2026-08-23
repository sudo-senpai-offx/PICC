// Live CCXT realtime layer — shared state for multi-exchange market data,
// shaped to mirror liveEOData() so the existing indicator pipeline
// (indicators.mjs / adaptiveConfluence.mjs) can consume exchange candles
// without any special-casing.
//
// The scheduler's "ccxt-market-data" job polls each configured exchange every
// 15s and calls recordCandles()/recordTicker() here; consumers read the folded
// snapshot via liveCCXTData() or mergeCCXTAssets(data).

import { rsi, macd, ema, atr, adx, bollinger } from "./indicators.mjs"
import { createLogger } from "../logger.mjs"

const log = createLogger("picc-live-ccxt")

const BUFFER_CAP = 400 // per pair/timeframe, same order as liveEO buffers

// `${exchange}:${symbol}:${tfSec}` -> buffer record
const buffers = new Map()
// `${exchange}:${symbol}` -> { price, ts }
const lastTick = new Map()

/** "1m"|"5m"|"15m"|"4h"|"1d"|60 -> seconds (null when unparseable). */
export function timeframeSeconds(tf) {
  if (Number.isFinite(Number(tf)) && Number(tf) > 0) return Math.floor(Number(tf))
  const m = String(tf ?? "").trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d|w)?$/)
  if (!m) return null
  const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2] ?? "m"]
  return Number(m[1]) * mult
}

/** Accept either an exchange id ("binance") or a ccxt instance ({id:"binance"}). */
export const normalizeExchangeId = (exchange) =>
  String(typeof exchange === "object" && exchange !== null ? (exchange.id ?? "") : exchange ?? "")
    .trim()
    .toLowerCase()

export const pairKey = (exchange, symbol) => `${normalizeExchangeId(exchange)}:${String(symbol).toUpperCase()}`
const bufferKey = (exchange, symbol, tfSec) => `${pairKey(exchange, symbol)}:${tfSec}`

/**
 * Merge a batch of normalized candles into a pair's buffer. Dedupes by bar
 * time (latest wins), keeps bars sorted oldest-first, caps length.
 */
export function mergeCandles(existing, incoming, cap = BUFFER_CAP) {
  const byTime = new Map()
  for (const c of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!c || !Number.isFinite(c.close)) continue
    byTime.set(c.time, c)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-cap)
}

/**
 * Honest volume proxy for pairs with no tick stream: bar-direction activity.
 * Same shape as liveEO's tick state ({count, up, down, delta, ratePerMin,
 * profile}) but labelled "bar-direction" so the UI never presents it as ticks.
 */
export function volumeProxy(ohlc) {
  const bars = Array.isArray(ohlc) ? ohlc.slice(-48) : []
  let up = 0
  let down = 0
  const profile = bars.map((c) => {
    const isUp = c.close > c.open
    if (isUp) up += 1
    else down += 1
    return { t: c.time, up: isUp ? 1 : 0, down: isUp ? 0 : 1 }
  })
  const recent = profile.slice(-12)
  const total = recent.reduce((a, b) => a + b.up + b.down, 0)
  const spanSec = recent.length ? Math.max(1, recent[recent.length - 1].t - recent[0].t + 60) : 0
  return {
    count: bars.length,
    up,
    down,
    delta: up - down,
    ratePerMin: spanSec > 0 ? Math.round((total / spanSec) * 60) : 0,
    profile,
    proxy: "bar-direction"
  }
}

const lastFinite = (series) => {
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i]
  }
  return null
}

/**
 * Indicator dashboard over one candle series — the direct indicators.mjs feed.
 * Returns nulls gracefully when there isn't enough history yet.
 */
export function indicatorSnapshot(ohlc) {
  const candles = Array.isArray(ohlc) ? ohlc.filter((c) => c && Number.isFinite(c.close)) : []
  if (candles.length < 2) {
    return { bars: candles.length, ready: false }
  }
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const e20 = lastFinite(ema(closes, 20))
  const e50 = lastFinite(ema(closes, 50))
  const m = macd(closes)
  const bb = bollinger(closes, { period: 20 })
  return {
    bars: candles.length,
    ready: true,
    price: closes[closes.length - 1],
    rsi: lastFinite(rsi(closes)),
    macd: { line: lastFinite(m.line), signal: lastFinite(m.signal), hist: lastFinite(m.hist) },
    ema: { ema20: e20, ema50: e50 },
    atr: lastFinite(atr(highs, lows, closes)),
    adx: lastFinite(adx(highs, lows, closes).adx),
    bollinger: { upper: lastFinite(bb.upper), lower: lastFinite(bb.lower), mid: lastFinite(bb.mid) },
    trend: e20 != null && e50 != null ? (e20 > e50 ? "up" : e20 < e50 ? "down" : "flat") : "unknown"
  }
}

function ensureBuffer(exchange, symbol, tfSec) {
  const key = bufferKey(exchange, symbol, tfSec)
  if (!buffers.has(key)) {
    buffers.set(key, {
      key,
      exchange: String(exchange).toLowerCase(),
      symbol: String(symbol).toUpperCase(),
      tfSec,
      ohlc: [],
      updatedAt: 0,
      lastPrice: null,
      indicators: { bars: 0, ready: false },
      ticker: null
    })
  }
  return buffers.get(key)
}

/**
 * Store one poll's candles for a pair. Returns the buffer summary, or null
 * when nothing usable arrived (callers keep their previous data).
 */
export function recordCandles({ exchange, symbol, timeframe = "1m", candles }) {
  const id = normalizeExchangeId(exchange)
  const tfSec = timeframeSeconds(timeframe)
  if (!id || !tfSec || !Array.isArray(candles) || candles.length === 0) return null
  const buf = ensureBuffer(id, symbol, tfSec)
  buf.ohlc = mergeCandles(buf.ohlc, candles)
  if (buf.ohlc.length === 0) return null
  buf.lastPrice = buf.ohlc[buf.ohlc.length - 1].close
  buf.updatedAt = Date.now()
  try {
    buf.indicators = indicatorSnapshot(buf.ohlc)
  } catch (err) {
    log.warn("indicator computation failed", { pair: pairKey(id, symbol), error: err.message })
  }
  return { ...buf, ohlc: buf.ohlc.length }
}

/** Fold a ticker quote into the pair's buffers (refreshes "last price"). */
export function recordTicker({ exchange, symbol, ticker }) {
  const id = normalizeExchangeId(exchange)
  const price = Number(ticker?.price)
  if (!id || !Number.isFinite(price) || price <= 0) return null
  const key = pairKey(id, symbol)
  lastTick.set(key, { price, ts: Date.now(), symbol: ticker.symbol ?? symbol })
  for (const buf of buffers.values()) {
    if (buf.key.startsWith(`${key}:`)) {
      buf.ticker = ticker
      buf.lastPrice = price
    }
  }
  return lastTick.get(key)
}

/** All recorded timeframes for one pair, oldest-first OHLC arrays. */
export function pairPeriods(exchange, symbol) {
  const prefix = `${pairKey(exchange, symbol)}:`
  const periods = {}
  for (const buf of buffers.values()) {
    if (buf.key.startsWith(prefix)) periods[buf.tfSec] = buf.ohlc
  }
  return periods
}

/**
 * liveEOData()-shaped snapshot of everything CCXT has collected:
 * assets[].periods is keyed in SECONDS (60/300/900/3600…) exactly like EO's,
 * so confluenceRead/quickMtfCheck work unchanged.
 */
export function liveCCXTData() {
  const byPair = new Map()
  const latestBuf = new Map() // pairKey -> most recently updated buffer
  for (const buf of buffers.values()) {
    const key = pairKey(buf.exchange, buf.symbol)
    if (!byPair.has(key)) {
      byPair.set(key, {
        id: key,
        name: buf.symbol,
        type: "crypto",
        exchange: buf.exchange,
        symbol: buf.symbol,
        periods: {},
        indicators: {},
        updatedAt: 0,
        lastPrice: null,
        ticks: { count: 0, up: 0, down: 0, delta: 0, ratePerMin: 0, profile: [], proxy: "bar-direction" }
      })
    }
    const asset = byPair.get(key)
    asset.periods[buf.tfSec] = buf.ohlc
    asset.indicators[buf.tfSec] = buf.indicators
    asset.updatedAt = Math.max(asset.updatedAt, buf.updatedAt)
    if (!latestBuf.has(key) || buf.updatedAt >= latestBuf.get(key).updatedAt) latestBuf.set(key, buf)
  }
  const assets = [...byPair.values()].map((a) => {
    const freshest = latestBuf.get(a.id)
    return {
      ...a,
      lastPrice: Number.isFinite(freshest?.lastPrice) ? freshest.lastPrice : null,
      ticks: volumeProxy(a.periods[60] ?? Object.values(a.periods)[0] ?? [])
    }
  })
  return {
    status: assets.length ? "connected" : "idle",
    mode: "live",
    source: "ccxt",
    account: null,
    viewed: null,
    watching: assets.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    assets,
    ts: Date.now()
  }
}

/**
 * Fold CCXT assets into a liveEOData()-shaped object WITHOUT mutating it, so
 * the decision engine evaluates exchange pairs in the same batch as broker
 * pairs (and still works when either side is empty).
 */
export function mergeCCXTAssets(data) {
  const base = data && typeof data === "object" ? data : {}
  const ccxtAssets = liveCCXTData().assets
  if (!ccxtAssets.length) return base
  return {
    ...base,
    status: base.status === "connected" || base.status === "connecting" ? base.status : ccxtAssets.length ? "connected" : base.status,
    assets: [...(Array.isArray(base.assets) ? base.assets : []), ...ccxtAssets]
  }
}

/** Observability for health endpoints/tests. */
export function ccxtStats() {
  const pairs = new Set()
  for (const buf of buffers.values()) pairs.add(pairKey(buf.exchange, buf.symbol))
  return {
    pairs: pairs.size,
    buffers: buffers.size,
    tickers: lastTick.size,
    exchanges: [...new Set([...buffers.values()].map((b) => b.exchange))]
  }
}

/** Test/shutdown hook — drops all stored market state. */
export function resetCCXTData() {
  buffers.clear()
  lastTick.clear()
}
