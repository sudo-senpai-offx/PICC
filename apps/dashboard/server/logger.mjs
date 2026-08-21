// Structured logger for PICC server.
// Replaces raw console.log/warn/error with JSON-structured output + request-ID correlation.
// Every log line includes: timestamp, level, component, message, and optional metadata.
import { randomUUID } from "node:crypto"

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL ?? "info"] ?? 20

// ── Per-request context (via AsyncLocalStorage or manual binding) ──
const requestContext = new Map()
let nextReqId = 1

export function createRequestId() {
  return `req-${nextReqId++}-${randomUUID().slice(0, 8)}`
}

export function bindRequest(reqId, meta = {}) {
  requestContext.set(reqId, { ...meta, startTime: Date.now() })
}

export function unbindRequest(reqId) {
  requestContext.delete(reqId)
}

export function getRequestMeta(reqId) {
  return requestContext.get(reqId) || null
}

// ── Metrics counters (in-memory, scraped by /metrics) ──
const counters = {
  requestsTotal: 0,
  responsesTotal: 0,
  errorsTotal: 0,
  requestDurations: [],
  maxDurationSamples: 1000
}

export function recordRequest(durationMs, status, path) {
  counters.requestsTotal++
  if (status >= 400) counters.errorsTotal++
  counters.responsesTotal++
  counters.requestDurations.push(durationMs)
  if (counters.requestDurations.length > counters.maxDurationSamples) {
    counters.requestDurations.shift()
  }
}

export function getMetrics() {
  const durations = counters.requestDurations
  const sorted = [...durations].sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0
  return {
    requestsTotal: counters.requestsTotal,
    responsesTotal: counters.responsesTotal,
    errorsTotal: counters.errorsTotal,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    p50DurationMs: p50,
    p95DurationMs: p95,
    p99DurationMs: p99,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  }
}

// ── Prometheus text format for /metrics ──
export function prometheusMetrics() {
  const m = getMetrics()
  const lines = [
    "# HELP picc_requests_total Total number of API requests",
    "# TYPE picc_requests_total counter",
    `picc_requests_total ${m.requestsTotal}`,
    "",
    "# HELP picc_responses_total Total number of API responses",
    "# TYPE picc_responses_total counter",
    `picc_responses_total ${m.responsesTotal}`,
    "",
    "# HELP picc_errors_total Total number of error responses (>=400)",
    "# TYPE picc_errors_total counter",
    `picc_errors_total ${m.errorsTotal}`,
    "",
    "# HELP picc_request_duration_ms Request duration in milliseconds",
    "# TYPE picc_request_duration_ms summary",
    `picc_request_duration_ms{quantile="0.5"} ${m.p50DurationMs}`,
    `picc_request_duration_ms{quantile="0.95"} ${m.p95DurationMs}`,
    `picc_request_duration_ms{quantile="0.99"} ${m.p99DurationMs}`,
    `picc_request_duration_ms_sum ${durations.length ? durations.reduce((a, b) => a + b, 0) : 0}`,
    `picc_request_duration_ms_count ${durations.length}`,
    "",
    "# HELP picc_uptime_seconds Server uptime in seconds",
    "# TYPE picc_uptime_seconds gauge",
    `picc_uptime_seconds ${m.uptimeSeconds}`,
    "",
    "# HELP picc_memory_mb Heap memory usage in megabytes",
    "# TYPE picc_memory_mb gauge",
    `picc_memory_mb ${m.memoryMB}`,
    ""
  ]
  return lines.join("\n")
}

// ── Structured log emitter ──
function emit(level, component, message, extra = {}) {
  if (LEVELS[level] < CURRENT_LEVEL) return
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg: message,
    ...extra
  }
  const line = JSON.stringify(entry)
  if (level === "error") {
    process.stderr.write(line + "\n")
  } else {
    process.stdout.write(line + "\n")
  }
}

// ── Logger factory ──
export function createLogger(component) {
  return {
    debug: (msg, extra) => emit("debug", component, msg, extra),
    info: (msg, extra) => emit("info", component, msg, extra),
    warn: (msg, extra) => emit("warn", component, msg, extra),
    error: (msg, extra) => emit("error", component, msg, extra)
  }
}

// ── Default logger for handlers ──
export const log = createLogger("picc")
