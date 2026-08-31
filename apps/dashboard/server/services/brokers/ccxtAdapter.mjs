// CCXT broker adapter — wraps existing ccxtConnector.mjs + liveCCXT.mjs behind LiveBroker.
// CCXT provides REST-based candle data from multiple exchanges. Read-only by contract.

import { registerBroker } from "./index.mjs"

let _liveCCXT = null
async function getLiveCCXT() {
  if (!_liveCCXT) _liveCCXT = await import("../liveCCXT.mjs")
  return _liveCCXT
}

let _ccxtConn = null
async function getCcxtConn() {
  if (!_ccxtConn) _ccxtConn = await import("../ccxtConnector.mjs")
  return _ccxtConn
}

// CCXT interval label per served timeframe (matches availableTimeframes()).
const INTERVAL_BY_TF = {
  60: "1m",
  300: "5m",
  900: "15m",
  1800: "30m",
  3600: "1h",
  14400: "4h"
}

/**
 * T2 — real OHLCV candles for the CCXT broker (see getCandles doc above).
 * Never throws: every fetch path resolves to [] on failure so the bus can
 * fall through to the next source (Yahoo) without crashing.
 */
async function ccxtCandles(assetId, opts) {
  const tf = opts?.timeframe ?? 60
  const interval = INTERVAL_BY_TF[tf]
  if (!interval) return [] // resolver prevents reaching here — defense in depth
  const count = Math.min(Math.max(Number(opts?.count) ?? 200, 20), 2000)

  let conn = null
  try { conn = await getCcxtConn() } catch { /* connector unavailable */ }
  if (!conn) return []

  const symbols = candidateSymbols(conn, assetId)
  if (!symbols.length) return [] // e.g. "AAPL"/"GOLD" — not a crypto pair on any exchange

  const exchanges = conn.connectedExchangeIds()
  const bases = new Set(symbols.map((s) => s.split("/")[0]))
  let thin = [] // best below-30-row result so the buffer can still win
  if (exchanges.length) {
    const cap = Math.min(count, 1000) // connector's hard per-call limit
    for (const id of exchanges) {
      const exchange = await conn.connect({ exchange: id }).catch(() => null)
      if (!exchange || typeof exchange.fetchOHLCV !== "function") continue
      // Each exchange only lists SOME quote spellings for a base (BTC/USDT on
      // binance, BTC/USD on kraken); the exchange's own non-empty answer — not
      // which spelling is prettiest — decides what is served.
      for (const symbol of symbols) {
        const rows = await conn.fetchCandles(exchange, symbol, interval, cap)
        if (rows.length >= 30) {
          return rows.map((c) => ({ ...c, timeframe: tf })).slice(-count)
        }
        if (rows.length > thin.length) thin = rows
      }
    }
  }

  // No connected exchange answered (or none is connected): fall back to the
  // scheduler-fed buffers — still honest live data, 400-bar cap per pair.
  // Symbols there are stored as the scheduler observed them (often USDT even
  // when the chart asked for USD), so match on the BASE token.
  try {
    const { liveCCXTData } = await getLiveCCXT()
    const data = liveCCXTData()
    const sameBase = (data.assets ?? []).filter(
      (a) => bases.has(String(a.symbol ?? "").split("/")[0])
    )
    if (sameBase.length) {
      const buffered = sameBase.find((a) => Array.isArray(a.periods?.[tf]) && a.periods[tf].length)
        ?? sameBase.find((a) => Array.isArray(a.periods?.[tf]))
      if (buffered?.periods?.[tf]?.length) {
        return buffered.periods[tf].map((c) => ({ ...c, timeframe: tf })).slice(-count)
      }
    }
  } catch { /* buffers unavailable — thin fetch result (if any) stands */ }

  // Thin rows from a live exchange beat nothing, but only when nothing else
  // had data — longest thin series wins.
  return thin.slice(-count)
}

/**
 * Candidate CCXT unified symbols for a PICC asset id. The connector's compact
 * matcher prefers USD ("BTCUSD" → "BTC/USD"), but connected exchanges often
 * list the same base against USDT/USDC. Each is tried in order and only the
 * exchange's own non-empty answer is ever served.
 */
function candidateSymbols(conn, assetId) {
  const seen = new Set()
  const list = []
  const push = (s) => {
    if (s && !seen.has(s)) {
      seen.add(s)
      list.push(s)
    }
  }
  const primary = conn.toCcxtSymbol(assetId)
  push(primary)
  if (primary) {
    const m = primary.match(/^([A-Z0-9]+)\/([A-Z0-9]+)$/)
    if (m) {
      if (m[2] === "USD") {
        push(`${m[1]}/USDT`)
        push(`${m[1]}/USDC`)
      } else {
        push(`${m[1]}/USD`) // e.g. "BTCUSDT" on an exchange listing BTC/USD
      }
    }
  }
  return list
}

// Eagerly import CCXT modules at registration time
Promise.all([getLiveCCXT(), getCcxtConn()]).catch(() => null)

registerBroker({
  slug: "ccxt",
  label: "CCXT exchanges",
  weight: 40, // Lower than EO — REST polling, not push

  isAlive() {
    if (!_ccxtConn) return false
    try {
      const ids = _ccxtConn.connectedExchangeIds()
      return ids.length > 0
    } catch { return false }
  },

  stats() {
    if (!_ccxtConn) return { status: "disconnected", error: null, lastSeen: 0, stale: false, upstream: {} }
    try {
      const ids = _ccxtConn.connectedExchangeIds()
      return {
        status: ids.length > 0 ? "connected" : "idle",
        error: null,
        lastSeen: 0,
        stale: false,
        upstream: { exchanges: ids }
      }
    } catch { return { status: "error", error: "ccxt unavailable", lastSeen: 0, stale: true, upstream: {} } }
  },

  getCandles(assetId, opts = {}) {
    // T2 — real OHLCV history. Served resolution arrives pre-resolved by the
    // bus (1m..4h only — the resolver declines everything else via null).
    // Path order:
    //   1. On-demand fetch from a CONNECTED exchange (deep window, up to the
    //      connector's 1000-row cap) — the chart's history source for crypto;
    //   2. the scheduler-fed in-memory buffers (same 400-bar cap as liveEO)
    //      when no exchange answers or nothing is connected;
    //   3. [] — honest: CCXT simply doesn't serve this asset right now, and the
    //      bus falls through to Yahoo. Never a fabricated series.
    return ccxtCandles(assetId, opts)
  },

  subscribe(assetId, cb) {
    // CCXT doesn't push — it polls. Subscription is a no-op for now.
    // The liveCCXT module handles polling internally.
    return () => {}
  },

  availableTimeframes() {
    return [60, 300, 900, 1800, 3600, 14400] // 1m through 4h
  },

  getAccountState() {
    // CCXT is read-only — no account state exposed.
    return null
  },

  getExpiryDurations() {
    // CCXT spot = no expiry. Futures have expiry but we don't trade them.
    return null
  }
})
