// S0/T0.2 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: the pack runner. One entry
// point (runStep) that observers call with what their seam saw; the runner
// applies the ENVELOPE GATE — §8.5 caps (max RAM/CPU/storage, observed usage
// only), tier availability, L-class credentials, declared dependencies —
// BEFORE the state machine moves. Honesty floor:
//   - a "running" observation is rewritten to blocked/skipped/stopped when the
//     gate rejects it (exact reason, never a graded blank);
//   - unobserved usage never fabricates a block (null = within budget);
//   - stopped-at-human is NEVER auto-run: the registry's legal map rejects it
//     and this runner never calls ackStep (that is a human action);
//   - every runStep attempt lands an evidence row with ts (observeStep).
import { observeStep, getStep } from "./packRegistry.mjs"

// Exact "skipped-unconfigured" reason vocabulary — one source of truth so the
// S1–S4 observers and the UI render the same strings (spec risk 5 guard).
export const SKIP_REASONS = Object.freeze({
  // Serper replaced (owner decision 2026-09-13): the digest reads free feeds
  // only — the reason vocabulary tracks the free-source config, not a key.
  noNewsSourceConfigured: "no-news-source-configured",
  noVapid: "no-vapid",
  noCcxtPairs: "no-ccxt-pairs-configured",
  signalEngineDisabled: "signal-engine-disabled",
  sessionCaptureDisabled: "session-capture-disabled",
  cactusNeedleT0NotShipped: "cactus-needle-t0-runtime-not-shipped",
  dependencyNotAvailable: "dependency-not-available",
  noWebhookUrl: "no-webhook-url"
})

/**
 * Which §8.5 cap is exceeded by OBSERVED usage (null usage = unobserved =
 * within budget — honesty: never block on absence of data). Pure.
 */
export function capReason(usage = {}, caps = {}) {
  if (usage.ramMb != null && caps.maxRamMb != null && usage.ramMb > caps.maxRamMb) {
    return `resource-cap-ram-exceeded (observed ${usage.ramMb}MB > cap ${caps.maxRamMb}MB)`
  }
  if (usage.cpuPct != null && caps.maxCpuPct != null && usage.cpuPct > caps.maxCpuPct) {
    return `resource-cap-cpu-exceeded (observed ${usage.cpuPct}% > cap ${caps.maxCpuPct}%)`
  }
  if (usage.storageMb != null && caps.maxStorageMb != null && usage.storageMb > caps.maxStorageMb) {
    return `resource-cap-storage-exceeded (observed ${usage.storageMb}MB > cap ${caps.maxStorageMb}MB)`
  }
  return null
}

/**
 * Pure envelope gate. Returns {status, reason} when a running-intent
 * observation must be rewritten, or null to pass through. Order: caps first
 * (the wall), then the step's own required gates.
 *
 * @param {{kind:string, envelope:{tier:string, requiresDependency?:boolean}}} step
 * @param {{gates?:{hasCredentials?:boolean, dependencyAvailable?:boolean,
 *                  tierAvailable?:boolean}, usage?:object, caps?:object}} opts
 */
export function envelopeGate(step = {}, opts = {}) {
  const gates = opts.gates ?? {}
  const usage = opts.usage ?? {}
  const caps = opts.caps ?? {}

  const cap = capReason(usage, caps)
  if (cap) return { status: "blocked", reason: cap }

  if (gates.tierAvailable === false) {
    const tier = step.envelope?.tier ?? "?unknown"
    return { status: "skipped-unconfigured", reason: `tier-unavailable-${tier}` }
  }

  if (step.kind === "l-class" && gates.hasCredentials !== true) {
    return { status: "stopped-at-human", reason: "login-gate: no credentials observed" }
  }

  if (step.envelope?.requiresDependency === true && gates.dependencyAvailable !== true) {
    return { status: "skipped-unconfigured", reason: SKIP_REASONS.dependencyNotAvailable }
  }

  return null
}

/**
 * Observe a step through the envelope gate. The observation is rewritten only
 * when it intends "running" and the gate rejects; honest statuses from the
 * observer (skipped-unconfigured/stopped-at-human/blocked) pass through
 * untouched.
 *
 * @param {{packId:string, stepId:string,
 *          observation:{status:string, detail?:string, observed?:*},
 *          gates?:object, usage?:object, caps?:object, now?:number|string}} opts
 * @returns {{step:object, applied:null|{from:string, to:string, reason:string}}}
 */
export async function runStep({ packId, stepId, observation = {}, gates = {}, usage = {}, caps = {}, now } = {}) {
  const current = await getStep(packId, stepId)
  if (!current) throw new Error(`packRunner: unknown step ${packId}/${stepId}`)

  let applied = null
  let final = { ...observation }
  if (observation.status === "running") {
    const problem = envelopeGate(current, { gates, usage, caps })
    if (problem) {
      applied = { from: "running", to: problem.status, reason: problem.reason }
      final = { ...observation, status: problem.status, detail: problem.reason }
    }
  }

  const step = await observeStep(packId, stepId, final, { now })
  return { step, applied }
}