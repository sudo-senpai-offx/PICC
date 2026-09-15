// S0/T0.1 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md ("Pack registry data model"):
// the pack registry is OBSERVATIONAL — every step stores what the underlying
// seam reported, never a guess. Honesty contract (enforced by tests):
//   - observed: null renders "not-observed", NEVER 0 / never zero-filled
//     (an observed 0 IS an observation and renders as "0");
//   - skipped-unconfigured carries the exact unconfigured reason;
//   - stopped-at-human exits ONLY via an explicit human ack (doneBy:"human")
//     — observation can never auto-run an L-class step (Governor §7, ministry
//     §11 L-class semantics, spec risk 1 guard);
//   - every step keeps lastObservedAt + bounded evidence (pruned by count and
//     age) so the dashboard's "as of" reads are truthful.
//
// Persistence: localStore("pack_registry") JSON under PICC_DATA_DIR (D8 — no
// Supabase). §8.5 caps (max RAM/CPU/storage) are parsed here as envs with
// conservative defaults; the runner (packRunner.mjs) gates RUN starts on them.
import { localStore } from "./localstore.mjs"

export const STEP_KINDS = ["run", "l-class"]
export const STEP_STATUSES = [
  "idle",
  "running",
  "stopped-at-human",
  "skipped-unconfigured",
  "blocked"
]

// Legal transitions. The ONLY exit from stopped-at-human is ackStep() — an
// explicit human handoff (spec: "Pack step statuses must never auto-transition
// a stopped-at-human step to running"; risk 1 guard: ack-only transition).
// Evidence refreshes on the same status never move the state machine.
const LEGAL = {
  idle: ["running", "stopped-at-human", "skipped-unconfigured", "blocked"],
  running: ["idle", "stopped-at-human", "skipped-unconfigured", "blocked"],
  "skipped-unconfigured": ["idle", "running", "blocked"],
  blocked: ["idle", "running", "skipped-unconfigured"],
  "stopped-at-human": ["stopped-at-human"]
}

function int(raw, fallback) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** §8.5 owner amendment — max RAM/CPU/storage configurable, conservative defaults. */
export function resourceCaps(env = process.env) {
  return {
    maxRamMb: int(env.PICC_RESOURCE_MAX_RAM_MB, 4096),
    maxCpuPct: int(env.PICC_RESOURCE_MAX_CPU_PCT, 50),
    maxStorageMb: int(env.PICC_RESOURCE_MAX_STORAGE_MB, 2048)
  }
}

/**
 * Pack 1 "Local Trading Core" — the four steps exactly as the approved
 * governor §5 list. Envelopes declare model tier + cadence + rpm ceiling per
 * step; L-class = the step stops at human handoff (P1-1's login gate).
 */
export function packOneDefinition() {
  return {
    id: "pack1-local-trading-core",
    label: "Local Trading Core",
    gateSet: ["hasApiKey", "hasCredentials", "hasVapid", "dependencyAvailable"],
    steps: [
      {
        id: "p1-1-eo-session-capture",
        label: "EO session capture",
        kind: "l-class",
        // T0-class extraction (Cactus Needle) is the declared tier; the actual
        // runtime is DEPENDENCY-NOT-YET-AVAILABLE — S1 reports the honest
        // skipped-unconfigured sub-state until it ships (never fake output).
        envelope: {
          tier: "T0",
          cadenceMs: 1_800_000, // captureProfiles token refresh cadence (30min)
          rpmCeiling: 0, // extraction on demand — no LLM polling rpm
          needs: "human demo-session login in the browser/extension; re-login on token expiry"
        }
      },
      {
        id: "p1-2-ccxt-data-poll",
        label: "CCXT market-data poll",
        kind: "run",
        envelope: {
          tier: "T1",
          cadenceMs: 15_000, // existing scheduler ccxt-market-data cadence
          rpmCeiling: 60, // conservative fact; T2.2 asserts ≤ catalog §5 cap
          needs: "≥1 ccxt pair configured (public, no key)"
        }
      },
      {
        id: "p1-3-news-digest",
        label: "News digest",
        kind: "run",
        envelope: {
          tier: "T3", // synthesis overflow only — never the primary tier
          cadenceMs: 600_000, // 10min, aligned to serper VERDICT_FRESH_MS
          rpmCeiling: 6, // ≤6 queries per 10min per source (B5-strict)
          needs: "free news feeds (RSS/Atom, no paid APIs) — resettable local rate limit"
        }
      },
      {
        id: "p1-4-signal-notifications",
        label: "Signal notifications",
        kind: "run",
        envelope: {
          tier: "T1", // observation only — no LLM synthesis
          cadenceMs: 45_000, // signalEngine CHECK_INTERVAL_MS
          rpmCeiling: 0, // dispatch records are observed, not polled
          needs: "in-app channel (always); webpush needs VAPID; webhook needs WEBHOOK_URL"
        }
      }
    ]
  }
}

function newStep(step) {
  return {
    ...step,
    envelope: { ...step.envelope },
    status: "idle",
    lastObservedAt: null,
    lastError: null,
    detail: null,
    acknowledgedBy: null,
    evidence: []
  }
}

function freshRegistry() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    totalBudgetUsd: 0,
    capExBudgetUsd: 0,
    env: process.env.PICC_ENV ?? "dev",
    ownerCountry: process.env.PICC_OWNER_COUNTRY ?? "BD",
    packs: [{ ...packOneDefinition(), steps: packOneDefinition().steps.map(newStep) }]
  }
}

const REGISTRY = localStore("pack_registry", freshRegistry())

/** Render an observed value honestly: null/undefined = "not-observed", never 0. */
export function renderObserved(value) {
  return value == null ? "not-observed" : value
}

function findStep(packId, stepId) {
  const pack = REGISTRY.data.packs.find((p) => p.id === packId)
  if (!pack) return null
  return pack.steps.find((s) => s.id === stepId) ?? null
}

/** Prune evidence to the env cap and a 30-day retention window. */
function pruneEvidence(step, nowMs, maxRows) {
  const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000
  step.evidence = step.evidence
    .filter((row) => new Date(row.ts).getTime() >= cutoff)
    .slice(-maxRows)
}

export async function getRegistry() {
  await REGISTRY.ready
  // Project the workflow pathway onto every step for the read surface; the
  // store itself keeps only raw evidence rows (projection is derived, never
  // persisted — a fresh read always reflects the latest observation).
  return {
    ...REGISTRY.data,
    packs: REGISTRY.data.packs.map((pack) => ({
      ...pack,
      steps: pack.steps.map(projectReadStep)
    }))
  }
}

export async function getStep(packId, stepId) {
  await REGISTRY.ready
  const step = findStep(packId, stepId)
  return step ? projectReadStep(step) : null
}

/**
 * T6.2 — project the workflow pathway (owner Q2: manual login is prompted,
 * never auto-detected/automated) from the LATEST evidence row's observed
 * payload onto the read surface. The pathway is written by the OBSERVING
 * seam (packObservers loginPathway), never invented here: a stopped step
 * whose latest observation carried no pathway renders pathway=null so the
 * strip shows only the ack button, never a fabricated procedure.
 */
function projectReadStep(step) {
  const last = step.evidence.at(-1)
  return {
    ...step,
    evidence: [...step.evidence],
    pathway: last?.observed?.pathway ?? null
  }
}

/**
 * Record what the observing seam saw. Legal moves only (LEGAL map); every
 * attempt lands in evidence — statuses are never mutated without a row.
 *
 * @param {{status:string, detail?:string, observed?:*} } observation
 * @param {{now?:number|string}} [opts] clock seam for retention tests
 */
export async function observeStep(packId, stepId, observation = {}, opts = {}) {
  await REGISTRY.ready
  const step = findStep(packId, stepId)
  if (!step) throw new Error(`packRegistry: unknown step ${packId}/${stepId}`)
  const status = observation.status
  if (!STEP_STATUSES.includes(status)) {
    throw new Error(`packRegistry: unknown status "${status}"`)
  }
  // Same-status re-observation is an evidence-only refresh (the normal case
  // for pollers: a ccxt poll that stays "running" every 15s just records a row).
  if (status !== step.status && !LEGAL[step.status]?.includes(status)) {
    throw new Error(
      `packRegistry: illegal transition ${step.status} -> ${status} for ${stepId} (stopped-at-human exits only via ack)`
    )
  }
  const now = opts.now != null ? new Date(opts.now).getTime() : Date.now()
  step.status = status
  step.lastObservedAt = new Date(now).toISOString()
  step.detail = observation.detail ?? null
  step.lastError = status === "blocked" ? (observation.detail ?? null) : null
  step.evidence.push({
    ts: new Date(now).toISOString(),
    status,
    detail: observation.detail ?? null,
    observed: observation.observed != null ? observation.observed : null
  })
  pruneEvidence(step, now, maxRows())
  REGISTRY.data.updatedAt = new Date(now).toISOString()
  await REGISTRY.write()
  return projectReadStep(step)
}

/**
 * The ONLY exit from stopped-at-human: the human acknowledges the handoff
 * (doneBy:"human"), the step re-arms to idle and the next observation tick
 * may move it to running. No RUN-step can ever resume an L-class step by
 * itself (spec risk 1 guard).
 */
export async function ackStep(packId, stepId, { by = "human", now } = {}) {
  await REGISTRY.ready
  const step = findStep(packId, stepId)
  if (!step) throw new Error(`packRegistry: unknown step ${packId}/${stepId}`)
  if (step.status !== "stopped-at-human") {
    throw new Error(`packRegistry: ack only valid on stopped-at-human (${stepId} is ${step.status})`)
  }
  const ts = now != null ? new Date(now).toISOString() : new Date().toISOString()
  step.status = "idle"
  step.acknowledgedBy = by
  step.detail = "human handoff acknowledged — step re-armed"
  step.evidence.push({
    ts,
    status: "acknowledged",
    detail: `human handoff acknowledged (${by})`,
    doneBy: by,
    observed: null
  })
  pruneEvidence(step, new Date(ts).getTime(), maxRows())
  REGISTRY.data.updatedAt = ts
  await REGISTRY.write()
  return projectReadStep(step)
}

function maxRows() {
  return int(process.env.PICC_PACK_REGISTRY_MAX_ROWS, 5000)
}