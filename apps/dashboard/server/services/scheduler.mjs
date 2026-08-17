// PICC periodic orchestrator — small in-process jobs that keep the dashboard
// fresh without hammering any external API.
//
//   yield-refresh   every 30 min  warms the DeFi/staking cache (harmless when
//                                 the cache is already warm — single-flight).
//   payout-alert    every 30 min  sweeps provider + manual balances and logs a
//                                 "balance meets payout threshold" entry to
//                                 agent_logs ONCE per platform per day. It only
//                                 flags; requesting a payout stays human.
//   credential-expiry  every 30 min  checks session JWTs for upcoming expiry and
//                                 logs a credential_expiry entry to agent_logs
//                                 ONCE per platform per day.
//
// Jobs are concurrency-guarded (a slow run is skipped, not queued) and all
// outbound work funnels through the shared polite rate limiter. startScheduler
// is called from index.mjs only — tests import the module without side effects.
import { automatorStatus, getCredentials, jwtInfo } from "./automator.mjs"
import { yieldSnapshot } from "./yields.mjs"
import { appendRow, listRows } from "./localstore.mjs"
import { rateLimitStatus } from "./rateLimit.mjs"
import { paperAnalytics } from "./trading.mjs"

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

every(
  "payout-alert",
  30 * 60 * 1000,
  async () => {
    const status = await automatorStatus()
    const ready = []
    for (const p of Object.values(status.providers ?? {})) {
      const threshold = Number(p?.payoutThreshold)
      if (p?.status === "ok" && Number.isFinite(threshold) && threshold > 0 && Number(p?.balance) >= threshold) {
        ready.push({ platform: p.platform, balance: Number(p.balance), threshold })
      }
    }
    for (const m of status.manual ?? []) {
      const threshold = Number(m?.payoutThreshold)
      if (threshold > 0 && Number(m?.balance) >= threshold && m?.status !== "paused") {
        ready.push({ platform: m.platform || m.name, balance: Number(m.balance), threshold })
      }
    }
    if (ready.length === 0) return

    const today = new Date().toISOString().slice(0, 10)
    const existing = await listRows("agent_logs")
    const loggedToday = (platform) =>
      existing.some(
        (r) =>
          r?.kind === "payout_ready" &&
          r?.platform === platform &&
          String(r?.created_at ?? "").startsWith(today)
      )

    for (const r of ready) {
      if (loggedToday(r.platform)) continue
      await appendRow("agent_logs", {
        kind: "payout_ready",
        source: "scheduler",
        level: "info",
        platform: r.platform,
        balance: r.balance,
        payoutThreshold: r.threshold,
        note: `Balance ${r.balance} meets the ${r.threshold} payout threshold — request the payout manually when ready.`
      })
    }
  },
  { staggerMs: 35_000 }
)

every(
  "credential-expiry",
  30 * 60 * 1000,
  async () => {
    const creds = await getCredentials()
    const sessions = [
      { platform: "Traffmonetizer", token: creds.traffmonetizerToken },
      { platform: "Pawns", token: creds.pawnsToken },
      { platform: "Repocket", token: creds.repocketToken }
    ]
    const today = new Date().toISOString().slice(0, 10)
    const existing = await listRows("agent_logs")
    const loggedToday = (platform) =>
      existing.some(
        (r) =>
          r?.kind === "credential_expiry" &&
          r?.platform === platform &&
          String(r?.created_at ?? "").startsWith(today)
      )

    for (const { platform, token } of sessions) {
      const info = jwtInfo(token)
      if (!info.valid || info.exp == null) continue
      const level = info.daysLeft < 0 ? "danger" : "warn"
      const note =
        info.daysLeft < 0
          ? `${platform} session token expired on ${info.expiresAt.slice(0, 10)} — paste a fresh one or collection stops.`
          : `${platform} session token expires on ${info.expiresAt.slice(0, 10)} (${Math.max(1, Math.ceil(info.daysLeft))} days) — refresh before then.`
      if (loggedToday(platform)) continue
      await appendRow("agent_logs", {
        kind: "credential_expiry",
        source: "scheduler",
        level,
        platform,
        expiresAt: info.expiresAt,
        note
      })
    }
  },
  { staggerMs: 50_000 }
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
