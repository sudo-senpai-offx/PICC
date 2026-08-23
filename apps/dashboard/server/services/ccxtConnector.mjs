// CCXT market-data connector — read-only OHLCV/ticker feed across 100+
// crypto exchanges via the MIT-licensed ccxt library.
//
// Contract mirrors the other connectors (see connectors.mjs / expertoption.mjs):
//   connect(config)                     -> a guarded exchange instance
//   fetchCandles(exchange, symbol, tf)  -> [{time,open,high,low,close,volume}]
//   fetchTicker(exchange, symbol)       -> {symbol, price, bid, ask, ...} | null
//   disconnect(exchange)                -> cleanup + cache eviction
//
// PICC never executes on external platforms, so every instance produced here is
// structurally read-only: order/transfer/withdraw methods are replaced with
// guards that throw before any network call can happen.

import { createLogger } from "../logger.mjs"

const log = createLogger("picc-ccxt")

// Lazy-loaded so importing this module never pays ccxt's startup cost (it is a
// very large package); tests mock it anyway.
let ccxt = null
async function ccxtLib() {
  if (!ccxt) {
    const mod = await import("ccxt")
    ccxt = mod.default ?? mod
  }
  return ccxt
}

/**
 * Account-mutating methods that must never run from PICC. Any of these found
 * on an instance is replaced by guardReadOnly() with a throwing stub.
 */
export const READ_ONLY_BLOCKED = [
  "createOrder",
  "createOrders",
  "createOrderWs",
  "editOrder",
  "editOrders",
  "cancelOrder",
  "cancelOrders",
  "cancelAllOrders",
  "cancelAllOrdersWs",
  "cancelWsOrder",
  "setLeverage",
  "setLeverageWs",
  "setMarginMode",
  "setPositionMode",
  "setMargin",
  "setSandboxMode",
  "transfer",
  "transferWs",
  "withdraw",
  "withdrawWs",
  "borrowCrossMargin",
  "repayCrossMargin",
  "createDepositAddress",
  "closePosition",
  "closePositions"
]

export const DEFAULT_LIMIT = 200

const instances = new Map() // exchangeId -> guarded instance

export const connectedExchangeIds = () => [...instances.keys()]

/** Loose text -> CCXT unified symbol ("btc-usdt"|"BTCUSDT"|"BTC/USDT" -> "BTC/USDT"). */
export function toCcxtSymbol(raw) {
  const s = String(raw ?? "").trim().toUpperCase()
  if (!s) return null
  const split = s.match(/^([A-Z0-9]+)[/_:.-]([A-Z0-9]+)$/)
  if (split) return `${split[1]}/${split[2]}`
  // Compact form: most common quote currencies first — "BTCUSDT" -> USDT,
  // "XBTUSD" -> USD (never TUSD, even though "…TUSD" technically matches).
  const quotes = ["USDT", "USDC", "USD", "BUSD", "TUSD", "FDUSD", "BTC", "ETH", "SOL", "EUR", "GBP", "JPY"]
  for (const q of quotes) {
    if (s.length > q.length && s.endsWith(q)) return `${s.slice(0, -q.length)}/${q}`
  }
  return null
}

/**
 * Normalize one raw CCXT OHLCV row ([ms, o, h, l, c, v]) into the shape used
 * by liveEOData() buffers: time in unix SECONDS. Malformed rows are dropped;
 * partial rows are coerced around a valid close instead of crashing.
 */
export function normalizeCandle(row) {
  if (!Array.isArray(row) || row.length < 5) return null
  const [ts, o, h, l, c, v] = row
  const close = Number(c)
  if (!Number.isFinite(close) || close <= 0) return null
  const open = Number(o)
  const high = Number(h)
  const low = Number(l)
  return {
    time: Math.floor(Number(ts) / 1000) || 0,
    open: Number.isFinite(open) && open > 0 ? open : close,
    high: Number.isFinite(high) && high > 0 ? high : close,
    low: Number.isFinite(low) && low > 0 ? low : close,
    close,
    volume: Number.isFinite(v) && v >= 0 ? Number(v) : 0
  }
}

/** Normalize a full OHLCV payload; anything non-array yields []. */
export function normalizeCandles(rows) {
  if (!Array.isArray(rows)) return []
  const out = []
  for (const row of rows) {
    const candle = normalizeCandle(row)
    if (candle) out.push(candle)
  }
  return out.sort((a, b) => a.time - b.time)
}

function rateLimitClass(err) {
  const lib = ccxt
  if (!lib || !err) return false
  for (const cls of [lib.RateLimitExceeded, lib.DDoSProtection]) {
    if (cls && err instanceof cls) return true
  }
  return false
}

export function isRateLimitError(err) {
  if (rateLimitClass(err)) return true
  return /RateLimit|DDoSProtection|\b429\b|too many requests/i.test(
    `${String(err?.name ?? "")} ${String(err?.message ?? "")}`
  )
}

/**
 * Replace every account-mutating method with a throwing guard so an
 * accidental or malicious call fails loudly before any request leaves the
 * process. This is the structural half of the read-only guarantee; the other
 * half is that no PICC code path ever calls them.
 */
export function guardReadOnly(exchange) {
  for (const method of READ_ONLY_BLOCKED) {
    if (typeof exchange[method] === "function") {
      exchange[method] = () => {
        throw new Error(
          `PICC is read-only: ${exchange.id ?? "exchange"}.${method}() is blocked — connectors never place orders or move funds`
        )
      }
    }
  }
  return exchange
}

/**
 * Create (or reuse) a read-only CCXT exchange instance.
 * @param {object} config
 * @param {string} config.exchange   ccxt exchange id ("binance", "kraken", ...)
 * @param {string} [config.apiKey]   optional — public market data needs no keys
 * @param {string} [config.secret]
 * @param {string} [config.password] some exchanges (okx…) require it even read-only
 * @param {boolean} [config.sandbox] use the exchange's testnet when available
 * @param {boolean} [config.enableRateLimit=true]  ccxt built-in polite pacing
 * @param {number} [config.timeout=15000]
 */
export async function connect(config = {}) {
  const lib = await ccxtLib()
  const id = String(config?.exchange ?? config?.id ?? "").trim().toLowerCase()
  if (!id) throw new Error("ccxt connector requires an exchange id")
  const Ctor = lib[id]
  if (typeof Ctor !== "function") throw new Error(`unknown ccxt exchange "${id}"`)

  const existing = instances.get(id)
  if (existing) return existing

  const opts = {
    enableRateLimit: config?.enableRateLimit !== false,
    timeout: Number(config?.timeout) > 0 ? Number(config.timeout) : 15_000,
    options: { defaultType: config?.defaultType ?? "spot" }
  }
  if (config?.apiKey) opts.apiKey = String(config.apiKey)
  if (config?.secret) opts.secret = String(config.secret)
  if (config?.password) opts.password = String(config.password)

  const exchange = new Ctor(opts)

  // Testnet only matters for authenticated routes, but flipping it up-front
  // keeps any future (still read-only) private market calls pointed at sandbox.
  if (config?.sandbox === true && typeof exchange.setSandboxMode === "function") {
    try {
      exchange.setSandboxMode(true)
    } catch {
      /* no sandbox on this exchange — public endpoints are identical anyway */
    }
  }

  guardReadOnly(exchange)
  instances.set(id, exchange)
  return exchange
}

/**
 * Fetch and normalize recent candles. Never throws: transport failures,
 * rate limits, and malformed payloads all resolve to [] (the scheduler simply
 * keeps its previous buffer).
 * @returns {Promise<Array<{time,open,high,low,close,volume}>>}
 */
export async function fetchCandles(exchange, symbol, timeframe = "1m", limit = DEFAULT_LIMIT) {
  if (!exchange || typeof exchange.fetchOHLCV !== "function") return []
  const sym = symbol ?? exchange.symbol ?? null
  if (!sym) return []
  const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 1000))
  try {
    const raw = await exchange.fetchOHLCV(sym, timeframe, undefined, capped)
    return normalizeCandles(raw)
  } catch (err) {
    if (isRateLimitError(err)) {
      log.warn(`rate limited while fetching ${sym} ${timeframe} — backing off`, {
        exchange: exchange.id ?? "exchange",
        error: err.message
      })
    } else {
      log.warn(`fetchOHLCV failed for ${sym} ${timeframe}`, {
        exchange: exchange.id ?? "exchange",
        error: err.message
      })
    }
    return []
  }
}

const finiteOrNull = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Fetch a normalized ticker. Returns null (never throws) when the exchange
 * errors out or the payload carries no usable price.
 * @returns {Promise<{symbol,price,bid,ask,change,percentage,high,low,ts}|null>}
 */
export async function fetchTicker(exchange, symbol) {
  if (!exchange || typeof exchange.fetchTicker !== "function") return null
  if (!symbol) return null
  try {
    const t = await exchange.fetchTicker(symbol)
    const price = Number(t?.last ?? t?.close ?? t?.bid ?? t?.ask)
    if (!Number.isFinite(price) || price <= 0) return null
    return {
      symbol: String(t?.symbol ?? symbol),
      price,
      bid: finiteOrNull(t?.bid),
      ask: finiteOrNull(t?.ask),
      change: finiteOrNull(t?.change),
      percentage: finiteOrNull(t?.percentage),
      high: finiteOrNull(t?.high),
      low: finiteOrNull(t?.low),
      ts: Number(t?.timestamp) > 0 ? Number(t.timestamp) : Date.now()
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      log.warn(`rate limited while fetching ticker ${symbol}`, {
        exchange: exchange.id ?? "exchange",
        error: err.message
      })
    } else {
      log.warn(`fetchTicker failed for ${symbol}`, {
        exchange: exchange.id ?? "exchange",
        error: err.message
      })
    }
    return null
  }
}

/** Close one connection and evict it from the cache. Idempotent. */
export async function disconnect(exchange) {
  if (!exchange) return false
  for (const [key, inst] of [...instances.entries()]) {
    if (inst === exchange) instances.delete(key)
  }
  if (typeof exchange.close === "function") {
    try {
      await exchange.close()
    } catch {
      /* already closed — fine */
    }
  }
  return true
}

/** Tear down every cached exchange (used by shutdown/tests). */
export async function disconnectAll() {
  for (const inst of [...instances.values()]) {
    await disconnect(inst)
  }
  instances.clear()
}
