// Command Centre — L1 Execution ("the only layer that touches venues").
//
// The generic gated-execution seam shared by every live execution leg. The
// ccxt order rail (ccxtExecution.mjs) builds its proposals from observed order
// data and runs them through this orchestrator:
//
//   1. run the FULL 10-gate sidecar chain (evaluateGate) over the caller's
//      proposal + template,
//   2. only after a pass, invoke the injected `executor` — the
//      venue-touching step (interventions workflow runner / ccxt order in
//      production; a fixture stub in CI — venue-touching code is never
//      exercised live in the test suite),
//   3. audit EVERY outcome: gate allow, gate deny, execution executed,
//      execution failed. There is no config that silences the audit (5A).
//
// Fail-safes: a deny never invokes the executor; an executor throw is caught,
// audited as `execution:failed`, and returned honestly (never a partial
// success claim); the idempotency key is carried by the caller's proposal and
// enforced by the sidecar, so a raced/retried action is rejected at the gate
// (5G) — durable via the audit trail reader, so it survives restarts.

import { evaluateGate } from "./safetySidecar.mjs"
import { templateForSite } from "./policyGraphCatalog.mjs"
import { appendAudit } from "./auditTrail.mjs"

// In-flight gated executions per site (actions currently being attempted by
// THIS process). Feeds the envelope cell: concurrentUnits is observed, not
// guessed. In-memory by design — the durable 5G key is the restart guard.
const running = new Map() // site -> count

/** Observed concurrent-execution state per site, for the overview envelope cell. */
export function executionStatus() {
  return Object.fromEntries([...running.entries()].map(([site, n]) => [site, { inFlight: n }]))
}

/** Test seam only. */
export function _resetExecutionState() {
  running.clear()
}

/**
 * Generic gated execution. Runs the full gate chain over an arbitrary
 * proposal/template, then — only on a pass — the executor. Every outcome is
 * audited. Returns { ok, gate, execution? } where execution is
 * { status: "executed"|"failed", idempotencyKey, result|error }.
 */
export async function executeProposal({
  template,
  proposal,
  state = {},
  executor,
  audit = appendAudit,
  now = Date.now()
}) {
  const gate = evaluateGate({ template, proposal, state: { ...state, now }, audit })
  if (!gate.allow) {
    return { ok: false, gate, execution: null }
  }

  const key = proposal.idempotencyKey
  const site = template?.site ?? "unknown"
  running.set(site, (running.get(site) ?? 0) + 1)
  try {
    const result = await executor({ proposal, state })
    audit({
      site,
      kind: "execution:executed",
      data: {
        action: proposal.action ?? null,
        idempotencyKey: key,
        power: proposal.power ?? null,
        consentBy: proposal.consentBy ?? null,
        result: result ?? null
      }
    })
    return { ok: true, gate, execution: { status: "executed", idempotencyKey: key, result } }
  } catch (err) {
    const message = String(err?.message ?? err)
    audit({
      site,
      kind: "execution:failed",
      data: {
        action: proposal.action ?? null,
        idempotencyKey: key,
        consentBy: proposal.consentBy ?? null,
        error: message
      }
    })
    return { ok: false, gate, execution: { status: "failed", idempotencyKey: key, error: message } }
  } finally {
    const next = (running.get(site) ?? 1) - 1
    if (next <= 0) running.delete(site)
    else running.set(site, next)
  }
}