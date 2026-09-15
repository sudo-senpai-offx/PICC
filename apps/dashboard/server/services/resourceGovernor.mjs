// G1 — PICC_RESOURCE_GOVERNOR_v1.md §3.2/§4.2/§7: the Resource Governor's
// observability ledger + parameter-aware routing.
//
//   routeTask(task, opts)  — PURE tier decision (§3.2). No I/O, table-tested.
//   recordCall(entry)      — append-only ledger row (Q5: tokens+metrics only,
//                            prompt content stripped), rotate-by-day, bounded.
//   governorStats()        — honest aggregates from the persisted ledger.
//
// Tier truth (§3.1/§3.2):
//   T0 continuous (tool-call/extraction/micro-decision, confidence-gated:
//      act above the threshold, escalate below);
//   T1 continuous (text gen ≤ ~500 tokens, no deep reasoning);
//   T2 burst only (reasoning / long synthesis, X calls/hour, conservative);
//   T3 overflow only (T2 budget exhausted), never the primary tier;
//   nothing available → honest "unavailable", never a stall, never a
//   fabricated result (ministry §11.2 / honesty contract).
//
// Ceilings come from env with conservative defaults (owner amendment §8.5:
// configurable limits — settings surface lands in G3; env is the config
// seam here). The ledger lives in the local JSON store (localstore.mjs,
// D8 — no Supabase) and never contains prompt content.
import { randomBytes } from "node:crypto"
import { localStore } from "./localstore.mjs"

const TOOL_KINDS = new Set(["tool-call", "extraction", "micro-decision"])
const HEAVY_KINDS = new Set(["reasoning", "synthesis", "analysis", "review", "brief"])
const TIERS = ["T0", "T1", "T2", "T3"]

function num(raw, fallback) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
function int(raw, fallback) {
  return Math.floor(num(raw, fallback))
}

/** Conservative defaults — every ceiling is configurable (env override). */
export function defaultBudgets(env = process.env) {
  return {
    t0ConfidenceThreshold: num(env.PICC_GOV_T0_CONFIDENCE_THRESHOLD, 0.6),
    t1MaxTokens: int(env.PICC_GOV_T1_MAX_TOKENS, 500),
    t2BurstPerHour: int(env.PICC_GOV_T2_BURST_PER_HOUR, 6),
    maxLedgerEntriesPerDay: int(env.PICC_GOV_LEDGER_MAX_PER_DAY, 1000)
  }
}

/**
 * Parameter-aware routing (§3.2). Pure: every input is an argument, so the
 * routing matrix is table-tested with no I/O. `usedT2` is the caller's
 * live burst consumption for this hour; `t2BurstLimit` the wall.
 *
 * @param {{taskKind:string, complexity?:number, maxTokens?:number,
 *          deadlineMs?:number, toolCall?:boolean, confidence?:number}} task
 * @param {{usedT2?:number, t2BurstLimit?:number, overflowEnabled?:boolean}} [opts]
 * @returns {{tier:"T0"|"T1"|"T2"|"T3"|"unavailable", escalated?:boolean,
 *           overflow?:boolean, burstExhausted?:boolean, reasons:string[]}}
 */
export function routeTask(task = {}, opts = {}) {
  const budgets = defaultBudgets()
  const reasons = []
  const base = { reasons }

  const kind = String(task.taskKind ?? "")
  const toolish = TOOL_KINDS.has(kind) || task.toolCall === true

  if (toolish) {
    const confidence = typeof task.confidence === "number" ? task.confidence : -1
    if (confidence >= budgets.t0ConfidenceThreshold) {
      reasons.push("t0 tool-call above confidence threshold")
      return { ...base, tier: "T0", escalated: false }
    }
    reasons.push("confidence below T0 threshold — escalate")
    return { ...base, tier: "T1", escalated: true }
  }

  const maxTokens = Number(task.maxTokens) > 0 ? Number(task.maxTokens) : 0
  const heavy = HEAVY_KINDS.has(kind) || maxTokens > budgets.t1MaxTokens

  if (!heavy) {
    reasons.push("light text gen within T1 budget")
    return { ...base, tier: "T1" }
  }

  // Heavy: T2 on burst, T3 overflow when the burst is spent, honest
  // "unavailable" when overflow is off — never a silent fallback to T1.
  const t2Limit = num(opts.t2BurstLimit, budgets.t2BurstPerHour)
  const usedT2 = num(opts.usedT2, 0)
  const burstExhausted = usedT2 >= t2Limit
  if (burstExhausted) {
    if (opts.overflowEnabled === false) {
      reasons.push("T2 burst exhausted and overflow disabled — honest unavailable")
      return { ...base, tier: "unavailable", burstExhausted: true }
    }
    reasons.push("T2 burst exhausted — T3 overflow")
    return { ...base, tier: "T3", overflow: true, burstExhausted: true }
  }
  reasons.push("reasoning within T2 burst budget")
  return { ...base, tier: "T2", burstExhausted: false }
}

// ── Ledger ───────────────────────────────────────────────────────────────────
// Bounded, rotate-by-day: one bucket per day, capped entries per day (oldest
// dropped once the cap is hit — bounded storage, per Q5). The store's own
// write chain makes writes atomic and ordered; PICC_DATA_DIR is the seam.
const LEDGER = localStore("resource_ledger", { days: {}, hourly: {} })

const SENSITIVE_KEYS = ["prompt", "context", "input", "content", "raw"]
function stripPrompt(entry) {
  const clean = { ...entry }
  for (const key of SENSITIVE_KEYS) {
    if (key in clean) delete clean[key]
  }
  return clean
}

function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10)
}
function hourKey(now) {
  return new Date(now).toISOString().slice(0, 13)
}

/**
 * Append one call to the observability ledger. Prompt/context content is
 * NEVER written (Q5 — tokens+metrics only). Returns the stored row.
 *
 * @param {{feature:string, tier:"T0"|"T1"|"T2"|"T3", model?:string,
 *          tokens:number, latencyMs:number, verdict:"accepted"|"throttled"|"failed"}} entry
 * @param {{now?:number|string}} [opts]  clock seam for day-rotation tests
 */
export async function recordCall(entry = {}, opts = {}) {
  await LEDGER.ready
  const now = opts.now != null ? new Date(opts.now).getTime() : Date.now()
  const day = dayKey(now)
  const budgets = defaultBudgets()
  const row = {
    id: randomBytes(8).toString("hex"),
    created_at: new Date(now).toISOString(),
    day,
    ...stripPrompt(entry)
  }

  const dayRows = LEDGER.data.days[day] ?? { entries: [] }
  dayRows.entries.push(row)
  if (dayRows.entries.length > budgets.maxLedgerEntriesPerDay) {
    dayRows.entries.shift() // bounded: cap per day, oldest out
    dayRows.capped = true
  }
  LEDGER.data.days[day] = dayRows

  const hour = hourKey(now)
  const hourly = LEDGER.data.hourly
  if (hourly.key !== hour) {
    hourly.key = hour
    hourly.t2Calls = 0
  }
  if (row.tier === "T2") hourly.t2Calls += 1

  await LEDGER.write() // resolution means the row is on disk (append semantics)
  return row
}

/**
 * Honest aggregates from the persisted ledger: per-tier calls/tokens/latency
 * + verdict counts, today's day key, and the T2 hourly burst state. Empty
 * ledger → observed zeros, never invented rows.
 */
export async function governorStats(opts = {}) {
  await LEDGER.ready
  const now = opts.now != null ? new Date(opts.now).getTime() : Date.now()
  const day = dayKey(now)

  const perTier = {}
  for (const tier of TIERS) {
    perTier[tier] = { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } }
  }
  const verdicts = { accepted: 0, throttled: 0, failed: 0 }

  const today = LEDGER.data.days[day]
  const entries = today?.entries ?? []
  for (const row of entries) {
    const cell = perTier[row.tier] ?? perTier.T1
    cell.calls += 1
    cell.tokens += Number(row.tokens) || 0
    cell.latencyMs += Number(row.latencyMs) || 0
    if (verdicts[row.verdict] !== undefined) {
      cell.verdicts[row.verdict] += 1
      verdicts[row.verdict] += 1
    }
  }

  const hourly = LEDGER.data.hourly
  const budgets = defaultBudgets()
  return {
    day,
    verdicts,
    perTier,
    burst: {
      hour: hourly.key ?? null,
      T2: {
        callsThisHour: hourly.key === hourKey(now) ? Number(hourly.t2Calls) || 0 : 0,
        limitPerHour: budgets.t2BurstPerHour
      }
    },
    ledger: {
      entriesToday: entries.length,
      capped: Boolean(today?.capped),
      days: Object.keys(LEDGER.data.days ?? {})
    }
  }
}

/**
 * Bounded, newest-first read for the dashboard live table (G3). Reads the
 * persisted ledger directly — the table shows exactly what the governor
 * recorded, nothing more. Empty ledger → [] (the UI renders "—", never a
 * fabricated row).
 *
 * @param {{limit?:number, days?:number, now?:number|string}} [opts]
 *   limit caps returned rows (default 50); days bounds how many day-buckets
 *   are scanned (default 3 — past-day context without unbounded reads).
 */
export async function recentRows(opts = {}) {
  await LEDGER.ready
  const limit = int(opts.limit, 50)
  const maxDays = int(opts.days, 3)
  const buckets = Object.keys(LEDGER.data.days ?? {})
    .sort()
    .slice(-maxDays)

  const rows = []
  for (const key of buckets) {
    rows.push(...(LEDGER.data.days[key]?.entries ?? []))
  }
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return rows.slice(0, limit)
}