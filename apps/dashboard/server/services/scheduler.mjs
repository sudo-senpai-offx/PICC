// PICC periodic orchestrator — small in-process jobs that keep the dashboard
// fresh without hammering any external API.
//
//   yield-refresh     every 30 min  warms the DeFi/staking cache (harmless when
//                                   the cache is already warm — single-flight).
//   ccxt-market-data  every 15 sec  polls every CCXT exchange configured in the
//                                   credential store (trading-credentials.json →
//                                   ccxtExchanges) for OHLCV + ticker, stores the
//                                   normalized candles in the shared liveCCXT state
//                                   and lets adaptiveConfluence fold them into the
//                                   existing indicator/decision pipeline. Read-only.
//   paper-mark        every 15 min  marks paper positions to market and auto-closes
//                                   take-profit/stop-loss hits.
//   eo-staleness      every 30 sec  flags a connected-but-stale ExpertOption stream
//                                   honestly (never a silent OK).
//   eo-liveness       every 30 sec  re-checks the live browser session behind the
//                                   token + samples the 24h uptime ring.
//   headless-session-refresh  every 60 sec  iterates the enabled venues of the
//                                   headless-session capture engine (captureProfiles)
//                                   whose token-refresh cadence is due, re-capturing
//                                   the broker session token through the studio
//                                   browser and reviving a dead EO session when the
//                                   token actually changed. No enabled venue / no
//                                   cadence due ⇒ exits in one loop over the profile
//                                   table. Read-only vs the broker (session reads);
//                                   token strings never reach logs or responses.
//
// Jobs are concurrency-guarded (a slow run is skipped, not queued) and all
// outbound work funnels through the shared polite rate limiter. startScheduler
// is called from index.mjs only — tests import the module without side effects.
import { yieldSnapshot } from "./yields.mjs"
import { appendRow, listRows } from "./localstore.mjs"
import { rateLimitStatus } from "./rateLimit.mjs"
import { paperAnalytics, getCredentials as getTradingCredentials } from "./trading.mjs"
import { getBrokerStats, setBrokerStale } from "./brokers/index.mjs"
import { connect, fetchCandles, fetchTicker, toCcxtSymbol } from "./ccxtConnector.mjs"
import { recordCandles, recordTicker, timeframeSeconds, ccxtStats } from "./liveCCXT.mjs"
import { headlessSessionRefresh } from "./captureProfiles.mjs"
import { createLogger } from "../logger.mjs"

const log = createLogger("picc-scheduler")

const jobs = []
const intervals = []
const lastRuns = new Map() // name -> { ok, at, ms, error }
const running = new Set()
let startedAt = null

export function every(name, intervalMs, fn, { staggerMs = 0 } = {}) {
  jobs.push({ name, intervalMs: Math.max(10_000, Number(intervalMs) || 600_000), fn, staggerMs })
}

async function runJob(job) {
  if (running.has(job.name)) return // already running — skip, never queue
  running.add(job.name)
  const started = Date.now()
  try {
    await job.fn()
    lastRuns.set(job.name, { ok: true, at: Date.now(), ms: Date.now() - started, error: null })
  } catch (err) {
    lastRuns.set(job.name, { ok: false, at: Date.now(), ms: Date.now() - started, error: err.message })
    console.warn(`[picc-scheduler] ${job.name} failed:`, err.message)
  } finally {
    running.delete(job.name)
  }
}

export function startScheduler() {
  if (startedAt) return false
  startedAt = new Date().toISOString()
  jobs.forEach((job, i) => {
    const firstDelay = Math.max(0, job.staggerMs || 10_000 + i * 5_000)
    setTimeout(() => {
      void runJob(job)
      intervals.push(setInterval(() => void runJob(job), job.intervalMs))
    }, firstDelay)
  })
  return true
}

export function schedulerStatus() {
  return {
    ok: true,
    running: Boolean(startedAt),
    startedAt,
    jobs: jobs.map((j) => {
      const last = lastRuns.get(j.name)
      return {
        name: j.name,
        intervalMs: j.intervalMs,
        lastRunAt: last?.at ?? null,
        lastRunMs: last?.ms ?? null,
        lastOk: last?.ok ?? null,
        error: last?.error ?? null,
        runningNow: running.has(j.name)
      }
    }),
    rateLimits: rateLimitStatus()
  }
}

// ---------------------------------------------------------------------
// Registered jobs
// ---------------------------------------------------------------------

every(
  "yield-refresh",
  30 * 60 * 1000,
  async () => {
    await yieldSnapshot()
  },
  { staggerMs: 20_000 }
)

// Marks paper positions to market and auto-closes any whose take-profit or
// stop-loss has been hit at the last quote. Keeps the paper ledger honest even
// when nobody is looking at the page.
every(
  "paper-mark",
  15 * 60 * 1000,
  async () => {
    const report = await paperAnalytics()
    if (report.autoClosed.length > 0) {
      await appendRow("agent_logs", {
        kind: "paper_auto_close",
        source: "scheduler",
        level: "info",
        count: report.autoClosed.length,
        note: `Auto-closed ${report.autoClosed.length} paper position(s) at take-profit/stop-loss. Equity now ${report.overview.equity}.`
      })
    }
  },
  { staggerMs: 60_000 }
)

// Honest "connected but stale" signal: the session claims to be connected but
// no frame has been consumed for over a minute. Flags the liveEO state so the
// health endpoint and UI can show it instead of trusting a silent socket.
every(
  "eo-staleness",
  30 * 1000,
  async () => {
    const st = getBrokerStats() ?? {}
    if (st.status !== "connected" || !Number(st.lastSeen)) {
      // Only clear the flag when the stream is genuinely healthy. A
      // disconnected/reconnecting session with old buffers is still stale —
      // clearing here hid the staleness from the UI during reconnect gaps.
      if (st.status === "idle") setBrokerStale(false)
      return
    }
    const tickAgeSec = Math.round((Date.now() - Number(st.lastSeen)) / 1000)
    const wasStale = Boolean(st.stale)
    const stale = tickAgeSec > 60
    setBrokerStale(stale)
    if (stale) {
      log.warn("ExpertOption stream is connected but stale", { lastTickAgeSec: tickAgeSec, viewed: st.viewed ?? null })
      if (!wasStale) {
        import("./notificationCenter.mjs")
          .then((m) => m.emitEvent("connector.stale", { connector: "expertoption", lastTickAgeSec: tickAgeSec, viewed: st.viewed ?? null }))
          .catch(() => {})
      }
    }
  },
  { staggerMs: 15_000 }
)

// ── Phase 13/15 — session liveness re-check + uptime sampling ───────────────
// Independent of autopilot ticking: the dashboard should honestly reflect
// "is there a live browser session behind this token" at all times, and the
// 24h uptime ring gives you a real reliability number, not a vibe.
const UPTIME_RING_CAP = 2880 // 24h at 30s samples
const uptimeRing = []
export function sessionUptime24h() {
  const n = uptimeRing.length
  if (!n) return { samples: 0, connectedPct: null, livePct: null, windowHours: 0 }
  const connected = uptimeRing.filter((s) => s.connected).length
  const live = uptimeRing.filter((s) => s.live).length
  const spanMs = Date.now() - Number(uptimeRing[0]?.ts || Date.now())
  return {
    samples: n,
    connectedPct: Math.round((connected / n) * 1000) / 10,
    livePct: Math.round((live / n) * 1000) / 10,
    windowHours: Math.round((spanMs / 3_600_000) * 10) / 10
  }
}

let livenessJobStarted = false
export function startLivenessMonitor() {
  if (livenessJobStarted) return true
  livenessJobStarted = true
  return every(
    "eo-liveness",
    30 * 1000,
    async () => {
      try {
        const { getSessionLive, refreshSessionLiveCache } = await import("./autopilot.mjs")
        const verdict = await getSessionLive()
        refreshSessionLiveCache(verdict)
        const st = getBrokerStats() ?? {}
        uptimeRing.push({ ts: Date.now(), connected: st.status === "connected", live: Boolean(verdict.live) })
        if (uptimeRing.length > UPTIME_RING_CAP) uptimeRing.splice(0, uptimeRing.length - UPTIME_RING_CAP)
        // Transition warnings — silent degradation is the enemy.
        const prev = uptimeRing[uptimeRing.length - 2]
        if (prev && prev.live !== Boolean(verdict.live)) {
          import("./notificationCenter.mjs")
            .then((m) => m.emitEvent(verdict.live ? "session.live-restored" : "session.lost", { reason: verdict.reason, via: verdict.via }))
            .catch(() => {})
        }
      } catch (err) {
        log.warn("liveness check failed", { error: String(err?.message ?? err) })
      }
    },
    { staggerMs: 5_000 }
  )
}

// Phase 9 — multi-exchange market data via CCXT. Every 15s (matching the
// decision engine's cadence) poll each exchange/symbol pair configured in the
// credential store, normalize OHLCV through the read-only connector, and store
// it in the shared liveCCXT state. adaptiveConfluence folds that state into its
// regular decision batch, so exchange candles flow through indicators.mjs and
// confluenceRead with zero special-casing. No CCXT pairs configured -> this job
// exits in one credential read.
every(
  "ccxt-market-data",
  15 * 1000,
  async () => {
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
  },
  { staggerMs: 25_000 }
)

/** Health/observability view of the CCXT collection state. */
export function ccxtSchedulerStatus() {
  return { ok: true, stats: ccxtStats() }
}

// ── Phase 5 (spec PICC_HEADLESS_CAPTURE_ENGINE.md, T4/T5/T7) ─────────────────
// Headless session refresh + account-metrics collection share this 60 s job,
// each with its own per-venue cadence gate so neither disturbs the other.
//     1. Session pass: iterate the venues whose token-refresh cadence is due
//        (captureProfiles owns the cadence gate + per-venue policy; T7 feeds
//        per-user prefs through that seam without touching this job).
//        captureVenue handles vault gate → capture → save → token-change revive
//        (restartLiveEO({force:true}) ONLY when the EO token string actually
//        changed, the flap guard of handlers.mjs:1292-1302). Failures surface
//        through the runner's honest per-venue report; token values never
//        arrive here.
//     2. Metrics pass (T5): for every venue whose metrics cadence is due,
//        re-derive the latest account observation from the accumulated WS
//        frames and store it per-user (accountMetrics.mjs owns its cadence
//        gate + store). Observe + persist ONLY — a null observation stores
//        nothing and leaves that venue's gate open for the next pass.
every(
  "headless-session-refresh",
  60 * 1000,
  async () => {
    const reports = await headlessSessionRefresh()
    for (const r of reports) {
      log.info("headless capture pass", { venue: r.venue, state: r.state, tokenChanged: r.state === "ok" ? r.tokenChanged : undefined })
    }
    const { accountMetricsRefresh } = await import("./accountMetrics.mjs")
    const collected = await accountMetricsRefresh("default")
    for (const rec of collected) {
      log.info("account metrics collect", { venue: rec.venueId, sourceLeg: rec.sourceLeg, active: rec.active ?? null })
    }
  },
  { staggerMs: 45_000 }
)
