// Command Centre — CCXT order leg (spec slice 6), mirroring the slice-5
// claim leg: a proposal railway with TWO carriers that share ONE gate+envelope.
//
//   • proposal rail:  proposeCcxtOrder runs the FULL 10-gate chain (kill
//     switch → … → idempotent) over the sized order proposal. The proposal
//     carries power `proposals` + fresh per-action consentBy (the acting
//     human's identity — consent, explicitly NOT an automation opt-in), a
//     stretch-clamped notional (never above the $10 envelope ceiling) and an
//     auto-rendered rationale. An allowed proposal is recorded durably as
//     proposal:created in the audit trail (the orders list reads it back).
//   • carrier A (“PICC executes”): executeCcxtOrder re-runs the FULL chain at
//     click time with FRESH observations (equity, reference price, kill state),
//     then — only on a pass — hands the venue step to the injected executor
//     (ccxtOrdering.placeCcxtOrder in production; a fixture stub in CI).
//   • carrier B (“the human executes”): the same proposal is acted on by the
//     human on the exchange; verifyCcxtOrder verifies the fill READ-ONLY
//     (injected read fn) and records ccxt-verify:filled|unobserved — never a
//     fabricated fill.
//
// Two keys per order (5G, deterministic pair): the PROPOSAL key
// `ccxt:order:<exchange>:<clientOrderId>` (registered at propose) and the
// EXECUTION key `${proposalKey}:exec` (registered at the first execute). A
// re-click of execute hits gate 10 with the exec key already present → denied;
// the venue is only ever reached once per proposal.

import { randomBytes } from "node:crypto"
import { evaluateGate } from "./safetySidecar.mjs"
import { executeProposal } from "./commandCentreExecution.mjs"
import { templateForSite } from "./policyGraphCatalog.mjs"
import { appendAudit, readAudit } from "./auditTrail.mjs"
import { refreshAggregateRisk } from "./riskState.mjs"
import { evaluateRiskGate, portfolioHeatUsd } from "./riskGates.mjs"
import { CCXT_HARD_NOTIONAL_CAP_USD } from "../ccxtOrdering.mjs"

export const CCXT_ORDER_ACTION = "ccxt:spot-order"
export const CCXT_SITE = "trading:ccxt"

/** Fresh short idempotency token for one order (bound to the proposal). */
export function clientOrderIdFor(now = Date.now()) {
  return `picc-${now.toString(36)}-${randomBytes(4).toString("hex")}`
}

/** 5G — a proposal's identity is the exchange + its clientOrderId, never a counter. */
export function orderIdempotencyKey({ exchange, clientOrderId }) {
  return `ccxt:order:${String(exchange ?? "").trim().toLowerCase()}:${clientOrderId}`
}

/** The execution half of the deterministic key pair (registered at first execute). */
export function executionIdempotencyKey(proposalKey) {
  return `${proposalKey}:exec`
}

/**
 * Gate-side clamp (the seam independently REFUSES over-cap by construction):
 * the amount is shrunk so amount×price never exceeds the envelope ceiling.
 * Rounded DOWN to 8 decimals so a clamped order can never overshoot at the
 * venue's precision floor.
 */
export function clampAmountToCap({ amount, price, capUsd = CCXT_HARD_NOTIONAL_CAP_USD }) {
  const amountN = Number(amount)
  const priceN = Number(price)
  const notional = amountN * priceN
  if (!(notional > capUsd)) return { amount: amountN, notionalUsd: notional, clamped: false }
  const clamped = Math.floor((capUsd / priceN) * 1e8) / 1e8
  return { amount: clamped, notionalUsd: Math.round(clamped * priceN * 100) / 100, clamped: true }
}

/**
 * The approved limit price vs the FRESH market reference (5E). Guards the
 * dangerous direction only: a BUY limit must not rest ABOVE the market just
 * seen (it would pay more than the market showed), a SELL limit must not rest
 * BELOW it. Within-tolerance / null-reference are decided honestly.
 */
export function limitPriceSanity({ side, limitPrice, referencePrice, tolerance = 0.01 }) {
  const s = String(side ?? "").toLowerCase()
  const limit = Number(limitPrice)
  const ref = Number(referencePrice)
  if (!Number.isFinite(limit) || limit <= 0) return { ok: false, reason: "limit price must be a positive number" }
  if (!Number.isFinite(ref) || ref <= 0) {
    return { ok: false, reason: "no fresh reference price observed — cannot sanity-check the approved limit (5E)" }
  }
  const deviationPct = Math.round(((limit - ref) / ref) * 10000) / 100
  if (s === "buy") {
    if (limit >= ref * (1 + tolerance)) {
      return {
        ok: false,
        deviationPct,
        reason: `BUY limit ${limit} is ${deviationPct}% ABOVE the fresh reference ${ref} — it would pay more than the market just showed (5E)`
      }
    }
  } else if (s === "sell") {
    if (limit <= ref * (1 - tolerance)) {
      return {
        ok: false,
        deviationPct,
        reason: `SELL limit ${limit} is ${deviationPct}% BELOW the fresh reference ${ref} — it would receive less than the market just showed (5E)`
      }
    }
  } else {
    return { ok: false, reason: `side must be buy or sell (got "${side}")` }
  }
  return { ok: true, deviationPct, reason: null }
}

/** 5F — the rationale is auto-rendered from OBSERVED inputs, never a template blob. */
export function orderRationale({ exchange, symbol, side, amount, price, notionalUsd, referencePrice, dayLossPct }) {
  const ref = Number.isFinite(referencePrice) ? referencePrice : null
  return (
    `CCXT ${String(side ?? "").toUpperCase()} ${symbol} limit ${amount} @ ${price} (~$${notionalUsd} within the ` +
    `$${CCXT_HARD_NOTIONAL_CAP_USD} envelope${ref ? `; fresh reference ${ref}` : ""}` +
    `${dayLossPct != null ? `; today's observed wallet loss ${dayLossPct}%` : ""}) — human-approved per-action.`
  )
}

/**
 * WS-2 risk observation (gates 16-19). The rails are FED first: an injected
 * `{ risk, heat }` (the handlers build it in observe*RailState) is used as-is;
 * when absent the rail resolves it from the committed stores itself —
 * refreshAggregateRisk (riskState) + portfolioHeatUsd over the durable audit
 * (riskGates). Deny-before-venue is the rail's contract either way.
 */
export async function resolveRiskObservation({ injected = null, now = Date.now() } = {}) {
  if (injected && typeof injected === "object" && injected.risk !== undefined) {
    return { risk: injected.risk, heat: injected.heat }
  }
  return { risk: refreshAggregateRisk({ now }), heat: portfolioHeatUsd({ audits: readAudit() }) }
}

/**
 * BOTH carriers start here: propose the order and run the FULL 10-gate chain
 * with the observed state the caller supplies (kill, breakers, equity/feed
 * freshness, day P/L, concurrency). No venue is touched. On allow the proposal
 * is recorded durably (proposal:created) so the orders list and the execute
 * route can act on the SAME identity.
 */
export async function proposeCcxtOrder({
  exchange,
  symbol,
  side,
  amount,
  price,
  consentBy,
  state = {},
  audit = appendAudit,
  now = Date.now()
}) {
  const clientOrderId = clientOrderIdFor(now)
  const sized = clampAmountToCap({ amount, price })
  const proposal = {
    action: CCXT_ORDER_ACTION,
    power: "proposals",
    consentBy,
    exposureUsd: sized.notionalUsd,
    rationale: orderRationale({
      exchange,
      symbol,
      side,
      amount: sized.amount,
      price,
      notionalUsd: sized.notionalUsd,
      referencePrice: state.referencePrice,
      dayLossPct: state.dayLossPct
    }),
    idempotencyKey: orderIdempotencyKey({ exchange, clientOrderId })
  }
  const gate = evaluateGate({ template: templateForSite(CCXT_SITE), proposal, state: { ...state, now }, audit })
  let riskGate = null
  if (gate.allow) {
    // WS-2 gates 16-19 compose AFTER the sidecar allow — a risk deny returns
    // before proposal:created, so a denied proposal never exists in the list.
    const riskObservation = await resolveRiskObservation({ injected: state.riskObservation ?? null, now })
    riskGate = evaluateRiskGate({ template: templateForSite(CCXT_SITE), proposal, observation: riskObservation, audit, now })
    if (!riskGate.allow) {
      return {
        ok: false,
        clientOrderId,
        idempotencyKey: proposal.idempotencyKey,
        proposal,
        gate: riskGate,
        riskGate,
        blockedBy: riskGate.blockedBy,
        order: {
          exchange: String(exchange ?? "").trim().toLowerCase(),
          symbol,
          side,
          amount: sized.amount,
          price,
          notionalUsd: sized.notionalUsd,
          clamped: sized.clamped
        }
      }
    }
    audit({
      site: CCXT_SITE,
      kind: "proposal:created",
      data: {
        clientOrderId,
        idempotencyKey: proposal.idempotencyKey,
        exchange: String(exchange ?? "").trim().toLowerCase(),
        symbol,
        side,
        amount: sized.amount,
        price,
        notionalUsd: sized.notionalUsd,
        clamped: sized.clamped,
        power: "proposals",
        consentBy,
        rationale: proposal.rationale
      }
    })
  }
  return {
    ok: gate.allow,
    clientOrderId,
    idempotencyKey: proposal.idempotencyKey,
    proposal,
    gate,
    riskGate,
    order: {
      exchange: String(exchange ?? "").trim().toLowerCase(),
      symbol,
      side,
      amount: sized.amount,
      price,
      notionalUsd: sized.notionalUsd,
      clamped: sized.clamped
    }
  }
}

/**
 * Carrier A: the acting human's click IS the fresh per-action consent. The
 * FULL chain re-runs at click time over the freshly-observed state; only a
 * pass reaches the venue (the injected executor). The execution carries its
 * own 5G key (proposalKey + ":exec") so a re-click is denied at gate 10.
 */
export async function executeCcxtOrder({
  exchange,
  symbol,
  side,
  amount,
  price,
  clientOrderId,
  consentBy,
  state = {},
  executor,
  audit = appendAudit,
  now = Date.now()
}) {
  const proposalKey = orderIdempotencyKey({ exchange, clientOrderId })
  const sized = clampAmountToCap({ amount, price })
  const proposal = {
    action: CCXT_ORDER_ACTION,
    power: "proposals",
    consentBy,
    exposureUsd: sized.notionalUsd,
    rationale: orderRationale({
      exchange,
      symbol,
      side,
      amount: sized.amount,
      price,
      notionalUsd: sized.notionalUsd,
      referencePrice: state.referencePrice,
      dayLossPct: state.dayLossPct
    }),
    idempotencyKey: executionIdempotencyKey(proposalKey)
  }
  // WS-2 gates 16-19 compose at click BEFORE the sidecar-10 re-run (which lives
  // inside executeProposal) — a risk deny stops so the venue is never reached.
  const riskObservation = await resolveRiskObservation({ injected: state.riskObservation ?? null, now })
  const riskGate = evaluateRiskGate({ template: templateForSite(CCXT_SITE), proposal, observation: riskObservation, audit, now })
  if (!riskGate.allow) {
    return { ok: false, gate: riskGate, riskGate, blockedBy: riskGate.blockedBy, execution: null }
  }
  const result = await executeProposal({
    template: templateForSite(CCXT_SITE),
    proposal,
    state: { ...state, now },
    executor,
    audit,
    now
  })
  return { ...result, riskGate }
}

/**
 * Carrier B: the human performed the venue step on the exchange. Verify the
 * fill READ-ONLY through the injected read fn (ccxtOrdering.verifyCcxtFill in
 * production; a fixture in CI) and append the honest result — a null read is
 * recorded as ccxt-verify:unobserved, never a fabricated fill.
 */
export async function verifyCcxtOrder({
  exchange,
  symbol,
  orderId,
  clientOrderId,
  verify = null,
  audit = appendAudit,
  now = Date.now()
}) {
  const filled = verify ? await verify({ exchange, symbol, orderId }) : null
  const proposalKey = orderIdempotencyKey({ exchange, clientOrderId })
  const kind = filled ? "ccxt-verify:filled" : "ccxt-verify:unobserved"
  audit({
    site: CCXT_SITE,
    kind,
    data: {
      idempotencyKey: proposalKey,
      clientOrderId,
      exchange: String(exchange ?? "").trim().toLowerCase(),
      symbol,
      venueOrderId: String(orderId ?? "").trim(),
      ...(filled
        ? {
            fill: {
              status: filled.status ?? null,
              filled: filled.filled ?? null,
              average: filled.average ?? null,
              at: filled.at ?? null
            }
          }
        : { reason: "verify unobserved — the venue did not answer (read-only, no fabrication)" })
    }
  })
  return { ok: Boolean(filled), clientOrderId, idempotencyKey: proposalKey, filled, kind, at: now }
}

/**
 * The orders list surface: proposal:created entries (durable audit) joined
 * with their honest latest state. Newest first. A proposal the human acted on
 * via carrier B shows verified-filled only AFTER the read-only verify says so.
 */
export function proposalOrdersFromAudit(audits = []) {
  const byKind = (kind) =>
    new Map(audits.filter((e) => e.kind === kind).map((e) => [e.data?.idempotencyKey, e]))
  const executed = byKind("execution:executed")
  const failed = byKind("execution:failed")
  const filled = byKind("ccxt-verify:filled")
  const unobserved = byKind("ccxt-verify:unobserved")

  return audits
    .filter((e) => e.kind === "proposal:created")
    .map((p) => {
      const key = p.data?.idempotencyKey
      const execKey = executionIdempotencyKey(key)
      let status = "open"
      if (executed.has(execKey)) status = "executed"
      else if (failed.has(execKey)) status = "failed"
      else if (filled.has(key)) status = "verified-filled"
      else if (unobserved.has(key)) status = "verify-unobserved"
      return {
        clientOrderId: p.data?.clientOrderId ?? null,
        idempotencyKey: key,
        exchange: p.data?.exchange ?? null,
        symbol: p.data?.symbol ?? null,
        side: p.data?.side ?? null,
        amount: p.data?.amount ?? null,
        price: p.data?.price ?? null,
        notionalUsd: p.data?.notionalUsd ?? null,
        clamped: p.data?.clamped === true,
        rationale: p.data?.rationale ?? null,
        status,
        proposedBy: p.data?.consentBy ?? null,
        proposedAt: p.at ?? null
      }
    })
    .reverse()
}