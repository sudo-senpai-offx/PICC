// Command Centre — L1 Execution ("the only layer that touches venues").
//
// Slice 5 delivers the FIRST live execution leg: the human-approved bandwidth
// payout claim (bandwidth:browser is gray in the 5C truth table → COPILOT,
// execution power `proposals`). The seam is a pure orchestrator:
//
//   1. build the proposal (power `proposals`, fresh per-action consent,
//      auto-rendered rationale, durable idempotency key),
//   2. run the FULL 10-gate sidecar chain (evaluateGate),
//   3. only after a pass, invoke the injected `executor` — the
//      venue-touching step (interventions workflow runner in production; a
//      fixture stub in CI — venue-touching code is never exercised live in
//      the test suite),
//   4. audit EVERY outcome: gate allow, gate deny, execution executed,
//      execution failed. There is no config that silences the audit (5A).
//
// Fail-safes: a deny never invokes the executor; an executor throw is caught,
// audited as `execution:failed`, and returned honestly (never a partial
// success claim); the idempotency key is derived from the payout reference so
// a raced/retried claim is rejected at gate 10 (5G) — durable via the audit
// trail reader, so it survives restarts.

import { evaluateGate } from "./safetySidecar.mjs"
import { templateForSite } from "./policyGraphCatalog.mjs"
import { appendAudit } from "./auditTrail.mjs"

export const CLAIM_ACTION = "bandwidth:payout-claim"
export const CLAIM_SITE = "bandwidth:browser"

// In-flight gated executions per site (claims currently being attempted by
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

/** 5G — a claim's identity comes from the payout reference, never a counter. */
export function claimIdempotencyKey({ platform, payoutRef }) {
  return `bandwidth:claim:${platform}:${payoutRef}`
}

/**
 * 5F — the rationale is auto-rendered from OBSERVED payout data (platform,
 * balance, threshold). Every claim PICC can act on has a stated why.
 */
export function claimRationale({ platform, balance, threshold, payoutRef }) {
  return (
    `Bandwidth payout claim for ${platform}: balance ${balance} meets the ` +
    `${threshold} payout threshold (ref ${payoutRef}) — transferring accrued ` +
    `earnings the provider has already authorized; human-approved per-action.`
  )
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

/**
 * Slice-5 leg: claim a payout the payout agent observed as ready
 * (automator payout_ready: balance >= payout threshold). The acting human's
 * identity is `consentBy` — fresh per-action consent, recorded, explicitly
 * NOT an automation opt-in (slice 4 decision). All gate inputs arrive via
 * `state` (observed in the caller: kill switch, breakers, stale feeds,
 * concurrent units, day loss). `executor` is the interventions workflow
 * runner seam (fixture-stubbed in tests).
 */
export async function claimPayout({
  platform,
  balance,
  threshold,
  payoutRef,
  consentBy,
  state = {},
  executor,
  audit = appendAudit,
  now = Date.now()
}) {
  const proposal = {
    action: CLAIM_ACTION,
    power: "proposals",
    consentBy,
    exposureUsd: null, // claims only — the catalog sets maxExposureUsd null for this site
    rationale: claimRationale({ platform, balance, threshold, payoutRef }),
    idempotencyKey: claimIdempotencyKey({ platform, payoutRef })
  }
  return executeProposal({
    template: templateForSite(CLAIM_SITE),
    proposal,
    state,
    executor,
    audit,
    now
  })
}