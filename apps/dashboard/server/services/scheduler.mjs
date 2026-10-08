// PICC periodic orchestrator — REGISTRY ONLY (Wave 2.1).
//
// Orchestration (registry + `every/start/stop/status`) lives here. Job BODIES
// live in `./jobs/<job-name>.mjs` (one file per job, same names/intervals/
// gates/wording as before — pure move). Import a job's `{ name, intervalMs,
// staggerMs, run }` and register it with `every()` below.
//
//   yield-refresh     every 30 min  warms the DeFi/staking cache.
//   paper-mark        every 15 min  marks paper positions to market.
//   eo-liveness       every 30 sec  browser session liveness + 24h uptime ring
//                                   (registered via startLivenessMonitor(),
//                                   BEFORE startScheduler() — boot invariant
//                                   liveness-before-scheduler, see
//                                   bootSequence.mjs — the extracted liveness
//                                   job still registers first at runtime).
//   ccxt-market-data  every 15 sec  multi-exchange CCXT OHLCV + ticker poll.
//   ccxt-equity-refresh  every 4 min  overview trading:ccxt feed refresh.
//   headless-session-refresh  every 60 sec  venue token refresh + metrics.
//   pack-observation  every 60 sec  Pack-1 step survey (observe-only).
//   news-digest       every 10 min  free RSS/Atom fetch (OFF-safe honest skip).
//   corpus-refresh    every 60 min  copytrading corpus prune (OFF-gated).
//
// D2/AC-005: the "eo-staleness" job is removed (see jobs/eo-liveness.mjs).
// Jobs are concurrency-guarded (a slow run is skipped, not queued) and all
// outbound work funnels through the shared polite rate limiter. startScheduler
// is called from bootSequence.mjs only — tests import the module without side
// effects.
import { rateLimitStatus } from "./rateLimit.mjs"
import { name as yieldName, intervalMs as yieldIntervalMs, staggerMs as yieldStaggerMs, run as runYieldRefresh } from "./jobs/yield-refresh.mjs"
import { name as paperName, intervalMs as paperIntervalMs, staggerMs as paperStaggerMs, run as runPaperMark } from "./jobs/paper-mark.mjs"
import {
  name as livenessName,
  intervalMs as livenessIntervalMs,
  staggerMs as livenessStaggerMs,
  run as runEoLiveness,
  sessionUptime24h
} from "./jobs/eo-liveness.mjs"
import { name as marketName, intervalMs as marketIntervalMs, staggerMs as marketStaggerMs, run as runCcxtMarketData, ccxtSchedulerStatus } from "./jobs/ccxt-market-data.mjs"
import { name as equityName, intervalMs as equityIntervalMs, staggerMs as equityStaggerMs, run as runCcxtEquityRefresh } from "./jobs/ccxt-equity-refresh.mjs"
import { name as sessionName, intervalMs as sessionIntervalMs, staggerMs as sessionStaggerMs, run as runHeadlessSessionRefresh } from "./jobs/headless-session-refresh.mjs"
import { name as packName, intervalMs as packIntervalMs, staggerMs as packStaggerMs, run as runPackObservation } from "./jobs/pack-observation.mjs"
import { name as newsName, intervalMs as newsIntervalMs, staggerMs as newsStaggerMs, run as runNewsDigest } from "./jobs/news-digest.mjs"
import { name as corpusName, intervalMs as corpusIntervalMs, staggerMs as corpusStaggerMs, run as runCorpusRefresh } from "./jobs/corpus-refresh.mjs"

export { sessionUptime24h, ccxtSchedulerStatus }

const jobs = []
const timeouts = []
const intervals = []
const lastRuns = new Map() // name -> { ok, at, ms, error }
const running = new Set()
let startedAt = null

export function every(name, intervalMs, fn, { staggerMs = 0 } = {}) {
  const job = { name, intervalMs: Math.max(10_000, Number(intervalMs) || 600_000), fn, staggerMs }
  jobs.push(job)
  if (startedAt) {
    // The silent case is now loud: a job registered after start never gets
    // an interval (boot invariant liveness-before-scheduler depends on
    // registration order), so say so. Never throw in the production path.
    console.warn(`[picc-scheduler] late registration: "${name}" registered after start — it will not run until restart`)
  }
  return jobs.length
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
    timeouts.push(
      setTimeout(() => {
        void runJob(job)
        intervals.push(setInterval(() => void runJob(job), job.intervalMs))
      }, firstDelay)
    )
  })
  return true
}

export function stopScheduler() {
  for (const t of timeouts.splice(0)) clearTimeout(t)
  for (const iv of intervals.splice(0)) clearInterval(iv)
  startedAt = null
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

// ── Phase 13/15 — session liveness registration ─────────────────────────────
// Independent of autopilot ticking: the dashboard should honestly reflect
// "is there a live browser session behind this token" at all times. Called
// BEFORE startScheduler() (bootSequence.mjs) so the eo-liveness job
// registers first at runtime.
let livenessJobStarted = false
export function startLivenessMonitor() {
  if (livenessJobStarted) return true
  livenessJobStarted = true
  return every(livenessName, livenessIntervalMs, runEoLiveness, { staggerMs: livenessStaggerMs })
}

// ---------------------------------------------------------------------
// Registered jobs (module scope, original order — liveness registers via
// startLivenessMonitor() above, first at runtime before startScheduler()).
// ---------------------------------------------------------------------

every(yieldName, yieldIntervalMs, runYieldRefresh, { staggerMs: yieldStaggerMs })

every(paperName, paperIntervalMs, runPaperMark, { staggerMs: paperStaggerMs })

every(marketName, marketIntervalMs, runCcxtMarketData, { staggerMs: marketStaggerMs })

every(equityName, equityIntervalMs, runCcxtEquityRefresh, { staggerMs: equityStaggerMs })

every(sessionName, sessionIntervalMs, runHeadlessSessionRefresh, { staggerMs: sessionStaggerMs })

every(packName, packIntervalMs, runPackObservation, { staggerMs: packStaggerMs })

every(newsName, newsIntervalMs, runNewsDigest, { staggerMs: newsStaggerMs })

every(corpusName, corpusIntervalMs, runCorpusRefresh, { staggerMs: corpusStaggerMs })
