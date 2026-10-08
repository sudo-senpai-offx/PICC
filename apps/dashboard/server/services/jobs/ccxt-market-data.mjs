// PICC scheduler job: ccxt-market-data (extracted Wave 2.1 — body moved
// verbatim from services/scheduler.mjs; intervals, gates and wording
// unchanged).
//
// Phase 9 — multi-exchange market data via CCXT. Every 15s (stagger 25s,
// matching the decision engine's cadence) poll each exchange/symbol pair
// configured in the credential store, normalize OHLCV through the read-only
// connector, and store it in the shared liveCCXT state. adaptiveConfluence
// folds that state into its regular decision batch, so exchange candles flow
// through indicators.mjs and confluenceRead with zero special-casing. No CCXT
// pairs configured -> this job exits in one credential read.
import { getCredentials as getTradingCredentials } from "../trading.mjs"
import { connect, fetchCandles, fetchTicker, toCcxtSymbol } from "../ccxtConnector.mjs"
import { recordCandles, recordTicker, timeframeSeconds, ccxtStats } from "../liveCCXT.mjs"
import { createLogger } from "../../logger.mjs"

const log = createLogger("picc-scheduler")

export const name = "ccxt-market-data"
export const intervalMs = 15 * 1000
export const staggerMs = 25_000

export async function run() {
  const creds = await getTradingCredentials().catch(() => ({}))
  const configured = Array.isArray(creds.ccxtExchanges) ? creds.ccxtExchanges : []
  if (configured.length === 0) return

  for (const cfg of configured.slice(0, 12)) {
    if (!cfg?.exchange || !cfg?.symbol) continue
    const symbol = toCcxtSymbol(cfg.symbol)
    const timeframe = cfg.timeframe ?? "1m"
    if (!symbol || !timeframeSeconds(timeframe)) continue
    try {
      // connect() caches per exchange id and returns a structurally
      // read-only instance; public market data needs no API keys at all.
      const exchange = await connect({
        exchange: cfg.exchange,
        apiKey: cfg.apiKey,
        secret: cfg.secret,
        password: cfg.password
      })
      const candles = await fetchCandles(exchange, symbol, timeframe, cfg.limit)
      if (candles.length > 0) {
        recordCandles({ exchange, symbol, timeframe, candles })
        const ticker = await fetchTicker(exchange, symbol)
        if (ticker) recordTicker({ exchange, symbol, ticker })
      }
    } catch (err) {
      // One bad exchange must never starve the others in the loop.
      log.warn("ccxt poll failed", { exchange: cfg.exchange, symbol, error: err.message })
    }
  }
}

/** Health/observability view of the CCXT collection state. */
export function ccxtSchedulerStatus() {
  return { ok: true, stats: ccxtStats() }
}
