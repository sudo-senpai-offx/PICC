// PICC Broker Adapter Registry — the plug-and-play seam for trading venues.
//
// Every trading platform PICC can talk to is described here with its LIVE
// status probed from real sources (session state, stored credentials, active
// exchange connections) — never fabricated. This is the single place the UI
// asks "what can I trade through right now?" and the single place new venue
// adapters register themselves.
//
// Capability vocabulary (kept deliberately coarse so heterogeneous venues
// compare cleanly):
//   market-data    read-only candles/quotes
//   spot-orders    buy/sell at quote price (exchange-style)
//   demo-trading   executable DEMO order path wired end-to-end
//   close-position early exit of an open position
//   positions      open-deal lifecycle events
//   account        balance/account reporting
//
// Every row also declares `timeframes` — the bar resolutions that venue can
// actually serve (mirrors its adapter's availableTimeframes). The chart layer
// uses this to disable unsupported resolutions instead of silently relabeling.
//
// Adding a venue = adding one entry here + (when it trades) wiring its
// session into the autopilot's adapter seam. See
// docs/TRADING_MULTIPLATFORM_ROADMAP.md for the full integration playbook.

import { getCredentials } from "./trading.mjs"
import { connectedExchangeIds } from "./ccxtConnector.mjs"

/**
 * Live status of every registered trading surface.
 * @returns {ok, brokers[], activeExecutor}
 */
export async function listBrokerStatuses() {
  const creds = await getCredentials()
  const brokers = []

  // D2/AC-005: the ExpertOption row and the `getDemoSession()` call are removed
  // together. That call was one of the four dead call sites: `getDemoSession` is
  // defined NOWHERE in the server tree, so `getDemoSession()` threw and the throw
  // was swallowed by the `catch` above — `eo.connected` could only ever be false.
  // The row is gone rather than left present-but-disabled (AC-005 prohibits
  // "present-but-disabled"), and the four-call-site count drops 4 → 3 (the other
  // three are removed in autopilot.mjs, positionManager.mjs and trading.mjs).

  // ── CCXT exchanges — multi-exchange MARKET DATA (read-only today) ────────
  const pairs = Array.isArray(creds.ccxtExchanges) ? creds.ccxtExchanges : []
  let liveExchanges = []
  try {
    liveExchanges = connectedExchangeIds()
  } catch { /* connector unavailable */ }
  brokers.push({
    slug: "ccxt",
    label: "CCXT exchanges",
    category: "spot-market-data",
    capabilities: ["market-data"],
    timeframes: [60, 300, 900, 1800, 3600, 14400], // REST fetchOHLCV 1m..4h
    configured: pairs.length > 0,
    connected: liveExchanges.length > 0,
    pairs: pairs.map((p) => ({ exchange: p.exchange, symbol: p.symbol, timeframe: p.timeframe || "1m" })),
    liveExchanges,
    demoOnly: false,
    notes: "Read-only by contract: order methods are structurally amputated before any network call."
  })

  // ── Yahoo Finance — daily/weekly/monthly market data (read-only) ─────────
  brokers.push({
    slug: "yahoo",
    label: "Yahoo Finance",
    category: "market-data",
    capabilities: ["market-data"],
    timeframes: [86400, 604800, 2592000], // EOD candles: 1D, 1W, 1M (T7)
    configured: true,
    connected: true,
    demoOnly: false,
    notes: "Always-available EOD fallback (no auth). Delayed daily bars only — no intraday, no trading."
  })

  // ── Paper engine — always-available simulation executor ──────────────────
  brokers.push({
    slug: "paper",
    label: "Paper engine",
    category: "simulation",
    capabilities: ["market-data", "paper-trading", "positions", "close-position", "account"],
    timeframes: [60, 300, 900, 3600], // simulation standard; paper serves no candles — data flows from CCXT/Yahoo
    configured: true,
    connected: true,
    demoOnly: true,
    notes: "Local ledger with Yahoo mark-to-market; the safe default executor for simulations."
  })

  // The venue that currently owns real (demo) order execution. D2/AC-005 removed
  // the ExpertOption executor, so the paper engine is the only executor and
  // `activeExecutor` is unconditionally "paper" — it is no longer derived from
  // a token that no longer selects anything.
  const activeExecutor = "paper"

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    activeExecutor,
    brokers,
    summary: {
      total: brokers.length,
      configured: brokers.filter((b) => b.configured).length,
      connected: brokers.filter((b) => b.connected).length
    }
  }
}
