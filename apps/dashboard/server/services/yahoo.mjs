// Real historical market data from Yahoo Finance (free, no key).
// query1.finance.yahoo.com/v8/finance/chart returns daily OHLCV + timestamps.
import { env } from "../config.mjs"

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map()

// ExpertOption-style 6-letter ids (EURUSD, BTCUSD, ...) are not valid Yahoo
// symbols on their own. Map the base currency to the Yahoo convention: crypto
// pairs use BASE-QUOTE, everything else uses QUOTE=X (forex futures).
const CRYPTO_BASES = new Set([
  "BTC", "ETH", "LTC", "XRP", "SOL", "DOGE", "ADA", "DOT", "BNB", "MATIC",
  "AVAX", "LINK", "UNI", "ATOM", "ETC", "FIL", "XLM", "XTZ", "VET", "TRX",
  "SHIB", "NEAR", "APT", "ARB", "OP", "SUI", "PEPE", "TON", "INJ", "SEI",
  "JUP", "WBTC", "BCH", "LDO", "AAVE", "MKR", "DYDX", "CRV", "GRT", "SAND",
  "MANA", "AXS", "ENJ", "CHZ", "ZIL", "HBAR", "ALGO", "EGLD", "FTM", "KAVA",
  "ROSE", "RUNE", "BLUR", "JTO", "WIF", "BONK", "ORDI", "LUNC", "LINA", "1INCH"
])

/**
 * Convert a user-supplied id (e.g. "eurusd", "BTCUSD", "gold") to a valid
 * Yahoo Finance symbol. Ids that already carry a Yahoo separator are kept
 * as-is. Anything else 6-letter uppercase is treated as a currency pair.
 */
export function normalizeYahooSymbol(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase().replace(/[/\s.]+/g, "")
  if (!s) return s
  if (s === "GOLD") return "GC=F"
  if (s === "SILVER") return "SI=F"
  if (!/^[A-Z]{6}$/.test(s)) return s
  const base = s.slice(0, 3)
  const quote = s.slice(3)
  if (CRYPTO_BASES.has(base)) return `${base}-${quote}`
  return `${s}=X`
}

/**
 * Fetch daily close prices for a symbol over `range` (e.g. "5y").
 * Returns normalized data or throws.
 */
export async function getHistory(symbol, range = "5y", interval = "1d") {
  const raw = String(symbol ?? "").trim()
  const normalized = normalizeYahooSymbol(raw)
  const key = `${raw}:${range}:${interval}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data

  const url = `${BASE}/${encodeURIComponent(normalized)}?range=${range}&interval=${interval}&events=div%2Csplit`
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (PICC dashboard)" }
  })
  if (!res.ok) {
    const hint = raw !== normalized ? ` — did you mean "${normalized}"?` : ""
    throw new Error(`Yahoo Finance ${res.status} for ${raw}${hint}`)
  }

  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error(`No data for symbol ${symbol}`)

  const quote = result.indicators?.quote?.[0] ?? {}
  const mapSeries = (arr) =>
    (Array.isArray(arr) ? arr : []).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
  const closes = mapSeries(quote.close)
  const opens = mapSeries(quote.open)
  const highs = mapSeries(quote.high)
  const lows = mapSeries(quote.low)
  const volumes = mapSeries(quote.volume)
  const timestamps = (result.timestamp ?? []).map((t) => t * 1000)

  const lastPrice = result.meta?.regularMarketPrice ?? lastNonNull(closes)
  const data = {
    symbol: String(result.meta?.symbol ?? symbol).toUpperCase(),
    name: result.meta?.shortName ?? symbol,
    exchange: result.meta?.exchangeName ?? "",
    currency: result.meta?.currency ?? "USD",
    lastPrice,
    dividendYield: trailingDividendYield(result, lastPrice),
    dates: timestamps,
    closes,
    opens,
    highs,
    lows,
    volumes
  }
  cache.set(key, { at: Date.now(), data })
  return data
}

/** Annualized trailing dividend yield from the chart's `events.dividends`. */
function trailingDividendYield(result, lastPrice) {
  const events = result?.events?.dividends ?? {}
  const divs = Object.values(events)
    .map((d) => ({ at: Number(d.date) * 1000, amount: Number(d.amount) }))
    .filter((d) => Number.isFinite(d.amount) && d.amount > 0)
  if (!divs.length || !(lastPrice > 0)) return null
  const yearMs = 365 * 24 * 3600 * 1000
  const trailing = divs.filter((d) => d.at >= Date.now() - yearMs)
  const pool = trailing.length >= 2 ? trailing : divs
  const spanMs =
    pool.length > 1 ? Math.max(...pool.map((d) => d.at)) - Math.min(...pool.map((d) => d.at)) : yearMs
  const annual = pool.reduce((a, d) => a + d.amount, 0) * (yearMs / Math.max(spanMs, 1))
  return Number((annual / lastPrice).toFixed(4))
}

/** Quick current-price lookup (reuses getHistory, cached 10 min). */
export async function getQuote(symbol) {
  const h = await getHistory(symbol, "3mo")
  return {
    symbol: h.symbol,
    name: h.name,
    exchange: h.exchange,
    currency: h.currency,
    price: typeof h.lastPrice === "number" && Number.isFinite(h.lastPrice) ? h.lastPrice : null
  }
}

/** Annualized drift and volatility from daily closes (252 trading days/year). */
export function statsFromHistory(history) {  const returns = []
  let prev = null
  for (const c of history.closes) {
    if (c == null || prev == null) {
      if (c != null) prev = c
      continue
    }
    if (prev > 0) returns.push(Math.log(c / prev))
    prev = c
  }
  if (returns.length < 20) throw new Error("Not enough price history")

  const n = returns.length
  const mean = returns.reduce((a, b) => a + b, 0) / n
  const variance = returns.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (n - 1)
  const vol = Math.sqrt(variance) * Math.sqrt(252)
  const drift = mean * 252

  return {
    annualizedVol: Number(vol.toFixed(4)),
    annualizedDrift: Number(drift.toFixed(4)),
    observations: n
  }
}

function lastNonNull(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i]
  }
  return null
}

/** Trim history to a bounded series for charting (keeps memory small). */
export function downsample(dates, closes, maxPoints = 260) {
  if (dates.length <= maxPoints) return { dates, closes }
  const step = Math.ceil(dates.length / maxPoints)
  const d = []
  const c = []
  for (let i = 0; i < dates.length; i += step) {
    if (closes[i] != null) {
      d.push(dates[i])
      c.push(closes[i])
    }
  }
  return { dates: d, closes: c }
}

/** Sanity-clamp real params before feeding the Monte Carlo engine. */
export function clampDrift(d) {
  return Math.min(0.25, Math.max(-0.12, d))
}

export function clampVol(v) {
  return Math.min(0.8, Math.max(0.05, v))
}

/** @internal for tests */
export function _clearCache() {
  cache.clear()
}
