// Command Centre — perps execution rail (F5, WS-1 live order lifecycle),
// the perps mirror of ccxtExecution.mjs. Two carriers + one gate+envelope:
//
//   • proposal rail:  proposePerpsOpen runs the FULL 10-gate sidecar then the
//     5-gate perps rail (gates 11–15, perpsGates.mjs) over the sized proposal.
//     The proposal records power:"proposals" + the acting human's consentBy, a
//     margin-clamped NOTIONAL (implied margin = notionalUsd/leverage capped so
//     it never exceeds PICC_CCXT_MARGIN_PER_POSITION_CAP_USD, default 10 —
//     rounded DOWN so a clamped order never overshoots), and an auto-rendered
//     rationale citing leverage, margin, the funding observation and day-loss.
//     An allowed proposal is recorded durably as proposal:created.
//   • carrier A ("PICC executes"): executePerpsOpen RE-RUNS the perps 5 gates
//     at click over the ACTUAL proposal the venue will receive — gate 11
//     certifies the REQUESTED leverage (the one deployed), not a derived view —
//     then treats the observed wallet leverage as a SEPARATE wallet-health
//     assertion: if it diverges from the requested leverage, deny
//     perps-leverage-mismatch before the venue. On a pass it delegates the
//     sidecar 10 + venue to executeProposal (commandCentreExecution.mjs). The
//     executor is the injected venue (adapter.submitOrder in production; a
//     fixture stub in CI). executionStatus() counts trading:perps in-flight.
//   • carrier B ("the human executes"): verifyPerpsOpen verifies the fill
//     READ-ONLY through the injected read fn (adapter.verifyFill; fixture in
//     CI) and records perps-verify:filled|unobserved — never a fabrication.
//   • close: executePerpsClose replays a reduce-only proposal from the passed
//     durable position record (position.leverage → positionLeverage for gate
//     11), runs the same perps-5-then-sidecar-10 composition, and audits the
//     execution outcome. The rail is venue-carrier only: recording the close
//     in the position manager (livePositionManager.recordClose) is T7's wiring,
//     NOT this rail's job.
//
// THE EXECUTION COMPOSITION (read twice before touching): executeProposal runs
// the sidecar's 10 internally INCLUDING the idempotent gate (5G), which
// registers the proposal's idempotencyKey. executePerpsOpen therefore NEVER
// runs evaluateGate on the ":exec" proposal itself — doing so would register
// the key twice and the FIRST execute would self-deny at `idempotent`. The
// correct composition:
//   1. evaluatePerpsGate (5) runs MANUALLY over the REAL proposal with the
//      fresh observation — gate 11 certifies the REQUESTED leverage itself, so
//      an out-of-band request at click denies BEFORE the venue; then, when the
//      OBSERVED wallet leverage differs from the requested one, a second
//      wallet-health assertion denies (perps-leverage-mismatch) before the
//      venue;
//   2. on a perps pass, executeProposal runs the sidecar 10 (kill → … →
//      idempotent) with the FRESH click-time state, then the venue.
//   End-to-end order: perps-5 (request-certified) → wallet-health drift check →
//   WS-2 risk gates 16-19 → sidecar-10 → venue.
//
// AUDIT-SEQUENCE HONESTY (the rail's contract, test-verified):
//   • green open propose:  ["safety-gate:allow"(sidecar), "safety-gate:allow"(perps),
//     "safety-gate:allow"(risk), "proposal:created"] — every gate fn audits its own allow.
//   • green open execute:  ["safety-gate:allow"(perps), "safety-gate:allow"(risk),
//     "safety-gate:allow"(sidecar), "execution:executed"].
//   • stale-feed execute:  ["safety-gate:allow"(perps), "safety-gate:allow"(risk),
//     "safety-gate:deny"(sidecar fresh-data)] — risk first-deny stops: the perps
//     allow IS audited, the risk allow IS audited, the sidecar deny IS audited,
//     NO execution:* and the venue stub never runs.
//   • venue throw execute: ["safety-gate:allow"(perps), "safety-gate:allow"(risk),
//     "safety-gate:allow"(sidecar), "execution:failed"].
//   • over-band-REQUEST click: ["safety-gate:deny"(perps perps-leverage-band)] — the
//     requested leverage itself is out of band; only the perps deny is audited.
//   • wallet-drift click:  ["safety-gate:allow"(perps), "safety-gate:deny"(perps
//     perps-leverage-mismatch)] — the request IS certified, the drift denies.
//   • green close:         ["safety-gate:allow"(perps), "safety-gate:allow"(risk),
//     "safety-gate:allow"(sidecar), "execution:executed", "proposal:created"(kind:"close")].
//   • re-click (both):     perps-allow + risk-allow re-audited THEN sidecar
//     `idempotent` deny (["safety-gate:allow","safety-gate:allow","safety-gate:deny"]);
//     venue reached exactly once.
//
// The rail is FED, never self-fetching: the venue (submit/verify) and every
// observation/state object are injected by the caller (T7 composes them from
// livePositionManager.observePerpsWallet / hyperliquidPerps.observeFunding /
// openPositions() in production). No venue, no position store, no hyperliquid
// import in this file.
//
// Idempotency (5G, deterministic pair, never counters): opens
// `perps:order:<exchange>:<clientOrderId>` + ":exec"; closes
// `perps:close:<exchange>:<positionId>:<clientOrderId>` + ":exec". The token
// generator is RE-USED from ccxtExecution.mjs (clientOrderIdFor) — not
// duplicated. The close's clientOrderId is a deterministic function of the
// position id so a re-click of the same position presents the SAME key pair.
//
// Template note: the rail accepts the site template injectably, defaulting to
// templateForSite(PERPS_SITE) — the trading:perps catalog row (policyGraphCatalog.mjs).

import { evaluateGate } from "./safetySidecar.mjs"
import { evaluatePerpsGate } from "./perpsGates.mjs"
import { evaluateRiskGate } from "./riskGates.mjs"
import { executeProposal } from "./commandCentreExecution.mjs"
import { templateForSite } from "./policyGraphCatalog.mjs"
import { appendAudit } from "./auditTrail.mjs"
import { clientOrderIdFor, executionIdempotencyKey, resolveRiskObservation } from "./ccxtExecution.mjs"

export { clientOrderIdFor, executionIdempotencyKey }

export const PERPS_OPEN_ACTION = "perps:open-order"
export const PERPS_CLOSE_ACTION = "perps:close-order"
export const PERPS_SITE = "trading:perps"

/** 5G — an OPEN proposal's identity is exchange + clientOrderId, never a counter. */
export function perpsOpenIdempotencyKey({ exchange, clientOrderId }) {
  return `perps:order:${String(exchange ?? "").trim().toLowerCase()}:${clientOrderId}`
}

/** 5G — a CLOSE proposal's identity is exchange + position + clientOrderId. */
export function perpsCloseIdempotencyKey({ exchange, positionId, clientOrderId }) {
  return `perps:close:${String(exchange ?? "").trim().toLowerCase()}:${positionId}:${clientOrderId}`
}

/**
 * The close's deterministic, position-bound idempotency token. A close is
 * replayed from the durable POSITION, so its token derives from the position
 * id (not the clock): a re-click of the same position presents the same key
 * pair and is denied at the sidecar's idempotent gate after the first attempt.
 * A short FNV-1a hash of the RAW position id is appended so two position ids
 * that sanitize to the same base — or the "unnamed" default — can never
 * collide on the close idempotency key. The token stays ≤ 32 chars.
 */
function shortHash(s, len = 6) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(len, "0").slice(0, len)
}

export function closeClientOrderIdFor(positionId) {
  const raw = String(positionId ?? "")
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 13)
  return `picc-close-${base || "unnamed"}-${shortHash(raw)}`
}

/**
 * Gate-side margin clamp (the seam independently REFUSES over-cap by
 * construction — R2.11/R4.5; the rail must not rely on the seam alone):
 * the AMOUNT is shrunk so amount×price/leverage (implied margin) never exceeds
 * PICC_CCXT_MARGIN_PER_POSITION_CAP_USD (default 10). Rounded DOWN to 8
 * decimals so a clamped order can never overshoot at the venue's precision
 * floor. The cap is read from env at CALL time; an invalid numeric env means
 * the clamp cannot size → explicit invalid-environment deny (never silent).
 * Malformed order params (non-finite amount/price/leverage, non-positive
 * price/leverage) are a named invalid-order deny BEFORE any sizing math,
 * mirroring the adapter's wording — so a NaN amount can never surface as a
 * mislabeled perps-margin-cap deny or a $0 order.
 */
export function clampPerpsMargin({ amount, price, leverage }) {
  const amountN = Number(amount)
  const priceN = Number(price)
  const levN = Number(leverage)
  const rawCap = process.env.PICC_CCXT_MARGIN_PER_POSITION_CAP_USD
  let cap = rawCap === undefined || rawCap === "" ? 10 : Number(rawCap)
  if (rawCap !== undefined && rawCap !== "" && (!Number.isFinite(cap) || cap <= 0)) {
    return {
      ok: false,
      blockedBy: "invalid-environment",
      reason: `invalid-environment: PICC_CCXT_MARGIN_PER_POSITION_CAP_USD=${rawCap}`
    }
  }
  if (!Number.isFinite(amountN) || amountN <= 0) {
    return { ok: false, blockedBy: "invalid-order", reason: `invalid-order: amount=${String(amount ?? "")}` }
  }
  if (!Number.isFinite(priceN) || priceN <= 0) {
    return { ok: false, blockedBy: "invalid-order", reason: `invalid-order: price=${String(price ?? "")}` }
  }
  if (!Number.isFinite(levN) || levN <= 0) {
    return { ok: false, blockedBy: "invalid-order", reason: `invalid-order: leverage=${String(leverage ?? "")}` }
  }
  const notional = amountN * priceN
  const margin = notional / levN
  if (!(margin > cap)) {
    return {
      ok: true,
      amount: amountN,
      price: priceN,
      leverage: levN,
      notionalUsd: Math.round(notional * 100) / 100,
      marginUsd: Math.round(margin * 100) / 100,
      clamped: false
    }
  }
  const amountCap = (cap * levN) / priceN
  const clampedAmount = Math.floor(amountCap * 1e8) / 1e8
  const clampedNotional = clampedAmount * priceN
  const clampedMargin = clampedNotional / levN
  return {
    ok: true,
    amount: clampedAmount,
    price: priceN,
    leverage: levN,
    notionalUsd: Math.round(clampedNotional * 100) / 100,
    marginUsd: Math.round(clampedMargin * 100) / 100,
    clamped: true
  }
}

/** 5F — the OPEN rationale is auto-rendered from OBSERVED inputs, never a template blob. */
export function perpsOrderRationale({
  symbol,
  side,
  amount,
  price,
  notionalUsd,
  marginUsd,
  leverage,
  marginMode,
  funding = null,
  dayLossPct = null
}) {
  const observed = funding && Number.isFinite(funding.rate)
  return (
    `PERPS ${String(side ?? "").toUpperCase()} ${symbol} limit ${amount} @ ${price} ` +
    `(notional ~$${notionalUsd}, margin $${marginUsd} at ${leverage}x ${String(marginMode ?? "").toLowerCase()}` +
    `${observed ? `; funding ${funding.rate} observed` : "; no funding observation"}` +
    `${dayLossPct != null ? `; today's observed wallet loss ${dayLossPct}%` : ""}) — human-approved per-action.`
  )
}

/** 5F — the CLOSE rationale, rendered from the durable position + exit price. */
export function perpsCloseRationale({ symbol, amount, price, notionalUsd, leverage, positionId, dayLossPct = null }) {
  return (
    `PERPS CLOSE ${symbol} (reduce-only ${amount} @ ${price}, ~$${notionalUsd}) at ${leverage}x ` +
    `leverage — closes position ${positionId}` +
    `${dayLossPct != null ? `; today's observed wallet loss ${dayLossPct}%` : ""}. Human-approved per-action.`
  )
}

function gateDeny(reason, action, audit, blockedBy = "invalid-environment") {
  audit({ site: PERPS_SITE, kind: "safety-gate:deny", data: { action: action ?? null, blockedBy, reason } })
  return { allow: false, blockedBy, reason }
}

/**
 * BOTH carriers start here: propose the order and run the FULL 10 then 5 gate
 * chain (sidecar: kill → breakers → opt-in → fresh-data → ToS → envelope →
 * rationale → idempotent; then perps 11–15: leverage-band → margin-cap →
 * isolated-only → position-cap → funding-fresh). On a deny the blocking layers
 * are returned named. On both-allow the proposal is recorded durably
 * (proposal:created) with everything the list/execute needs to REPLAY.
 * No venue is touched.
 */
export async function proposePerpsOpen({
  exchange,
  symbol,
  side,
  amount,
  price,
  leverage,
  marginMode,
  consentBy,
  state = {},
  observation,
  audit = appendAudit,
  now = Date.now(),
  template = templateForSite(PERPS_SITE)
}) {
  const clientOrderId = clientOrderIdFor(now)
  const sized = clampPerpsMargin({ amount, price, leverage })
  if (!sized.ok) {
    const gate = gateDeny(sized.reason, PERPS_OPEN_ACTION, audit, sized.blockedBy)
    return { ok: false, gate, perpsGate: null, clientOrderId, idempotencyKey: null, proposal: null, order: null, blockedBy: gate.blockedBy }
  }
  const proposal = {
    action: PERPS_OPEN_ACTION,
    power: "proposals",
    consentBy,
    exposureUsd: sized.marginUsd,
    rationale: perpsOrderRationale({
      symbol,
      side,
      amount: sized.amount,
      price,
      notionalUsd: sized.notionalUsd,
      marginUsd: sized.marginUsd,
      leverage,
      marginMode,
      funding: observation?.funding ?? null,
      dayLossPct: state.dayLossPct
    }),
    idempotencyKey: perpsOpenIdempotencyKey({ exchange, clientOrderId }),
    symbol,
    side,
    amount: sized.amount,
    price,
    leverage,
    positionLeverage: leverage,
    marginMode,
    reduceOnly: false,
    notionalUsd: sized.notionalUsd,
    marginUsd: sized.marginUsd
  }
  const gate = evaluateGate({ template, proposal, state: { ...state, now }, audit })
  if (!gate.allow) {
    return { ok: false, gate, perpsGate: null, riskGate: null, clientOrderId, idempotencyKey: proposal.idempotencyKey, proposal, order: null, blockedBy: gate.blockedBy }
  }
  const perpsGate = evaluatePerpsGate({ template, proposal, observation, audit })
  if (!perpsGate.allow) {
    return { ok: false, gate, perpsGate, riskGate: null, clientOrderId, idempotencyKey: proposal.idempotencyKey, proposal, order: null, blockedBy: perpsGate.blockedBy }
  }
  // WS-2 gates 16-19 compose AFTER the perps 5 allow — deny before proposal:created.
  const riskObservation = await resolveRiskObservation({ injected: observation ? { risk: observation.risk, heat: observation.heat } : null, now })
  const riskGate = evaluateRiskGate({ template, proposal, observation: riskObservation, audit, now })
  if (!riskGate.allow) {
    return { ok: false, gate: riskGate, perpsGate, riskGate, clientOrderId, idempotencyKey: proposal.idempotencyKey, proposal, order: null, blockedBy: riskGate.blockedBy }
  }
  audit({
    site: PERPS_SITE,
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
      marginUsd: sized.marginUsd,
      clamped: sized.clamped,
      leverage,
      marginMode,
      positionLeverage: leverage,
      reduceOnly: false,
      kind: "open",
      power: "proposals",
      consentBy,
      rationale: proposal.rationale
    }
  })
  return {
    ok: true,
    clientOrderId,
    idempotencyKey: proposal.idempotencyKey,
    proposal,
    gate,
    perpsGate,
    riskGate,
    blockedBy: null,
    order: {
      exchange: String(exchange ?? "").trim().toLowerCase(),
      symbol,
      side,
      amount: sized.amount,
      price,
      notionalUsd: sized.notionalUsd,
      marginUsd: sized.marginUsd,
      clamped: sized.clamped,
      leverage,
      marginMode
    }
  }
}

/**
 * Carrier A: the acting human's click IS the fresh per-action consent. The
 * perps 5 RE-RUN at click over the ACTUAL proposal the venue receives — gate 11
 * certifies the REQUESTED leverage end-to-end (an out-of-band request denies
 * before the venue), gate 12's margin math uses the deployed leverage — then a
 * separate wallet-health assertion denies (perps-leverage-mismatch) when the
 * OBSERVED wallet leverage diverges from the deployed request. On a pass the
 * sidecar 10 re-run happens with the FRESH click-time state via
 * executeProposal (also a real re-check), and only a pass reaches the venue.
 * The execution carries its own 5G key (:exec) registered by
 * executeProposal's idempotent gate; re-click is denied, venue reached once.
 */
export async function executePerpsOpen({
  exchange,
  symbol,
  side,
  amount,
  price,
  leverage,
  marginMode,
  clientOrderId,
  consentBy,
  state = {},
  observation,
  executor,
  audit = appendAudit,
  now = Date.now(),
  template = templateForSite(PERPS_SITE)
}) {
  const proposalKey = perpsOpenIdempotencyKey({ exchange, clientOrderId })
  const sized = clampPerpsMargin({ amount, price, leverage })
  if (!sized.ok) {
    const gate = gateDeny(sized.reason, PERPS_OPEN_ACTION, audit, sized.blockedBy)
    return { ok: false, gate, perpsGate: null, riskGate: null, execution: null }
  }
  const proposal = {
    action: PERPS_OPEN_ACTION,
    power: "proposals",
    consentBy,
    exposureUsd: sized.marginUsd,
    rationale: perpsOrderRationale({
      symbol,
      side,
      amount: sized.amount,
      price,
      notionalUsd: sized.notionalUsd,
      marginUsd: sized.marginUsd,
      leverage,
      marginMode,
      funding: observation?.funding ?? null,
      dayLossPct: state.dayLossPct
    }),
    idempotencyKey: executionIdempotencyKey(proposalKey),
    symbol,
    side,
    amount: sized.amount,
    price,
    leverage,
    positionLeverage: leverage,
    marginMode,
    reduceOnly: false,
    notionalUsd: sized.notionalUsd,
    marginUsd: sized.marginUsd,
    clamped: sized.clamped
  }
  // The click-time re-check runs the perps 5 gates over the ACTUAL proposal the
  // venue receives — gate 11 certifies the REQUESTED leverage (the one that gets
  // deployed), so an out-of-band request at click denies BEFORE the venue, and
  // gate 12's margin math divides by the same leverage the venue deploys.
  const perpsGate = evaluatePerpsGate({ template, proposal, observation, audit })
  if (!perpsGate.allow) {
    // perps deny stops before the venue; only the perps deny is audited.
    return { ok: false, gate: null, perpsGate, riskGate: null, execution: null }
  }
  // Wallet-health assertion (separate from the request certification above):
  // the perps-5 was over the requested proposal; the OBSERVED wallet leverage is
  // a distinct signal — if it diverges from the leverage the order deploys, the
  // order no longer describes the observed wallet state → named deny, venue not
  // reached. When the wallet observation has no leverage there is nothing to
  // assert divergence against.
  const observedLeverage = Number.isFinite(Number(observation?.leverage)) ? Number(observation.leverage) : null
  if (observedLeverage !== null && Math.abs(observedLeverage - proposal.leverage) > 1e-6) {
    const reason =
      `perps-leverage-mismatch: wallet observed leverage ${observedLeverage} != requested ${proposal.leverage} — ` +
      "the order no longer describes the observed wallet state"
    audit({
      site: PERPS_SITE,
      kind: "safety-gate:deny",
      data: { action: PERPS_OPEN_ACTION, blockedBy: "perps-leverage-mismatch", reason }
    })
    return { ok: false, gate: null, perpsGate, riskGate: null, execution: null, blockedBy: "perps-leverage-mismatch", reason }
  }
  // WS-2 gates 16-19 compose after the wallet-health assertion and BEFORE the
  // sidecar-10 re-run inside executeProposal — a risk deny stops pre-venue.
  const riskObservation = await resolveRiskObservation({ injected: observation ? { risk: observation.risk, heat: observation.heat } : null, now })
  const riskGate = evaluateRiskGate({ template, proposal, observation: riskObservation, audit, now })
  if (!riskGate.allow) {
    return { ok: false, gate: riskGate, perpsGate, riskGate, execution: null, blockedBy: riskGate.blockedBy }
  }
  const result = await executeProposal({
    template,
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
 * fill READ-ONLY through the injected read fn (hyperliquidPerps.verifyFill in
 * production; a fixture in CI) and append the honest result — a null read is
 * recorded as perps-verify:unobserved, never a fabricated fill.
 */
export async function verifyPerpsOpen({
  exchange,
  symbol,
  orderId,
  clientOrderId,
  positionId = null,
  verify = null,
  audit = appendAudit,
  now = Date.now()
}) {
  const proposalKey = positionId
    ? perpsCloseIdempotencyKey({ exchange, positionId, clientOrderId })
    : perpsOpenIdempotencyKey({ exchange, clientOrderId })
  const observed = verify ? await verify({ exchange, symbol, orderId }) : null
  const readAnswered = observed !== null
  const filled = readAnswered && Number(observed?.filled ?? 0) > 0 ? observed : null
  const kind = filled ? "perps-verify:filled" : "perps-verify:unobserved"
  audit({
    site: PERPS_SITE,
    kind,
    data: {
      idempotencyKey: proposalKey,
      clientOrderId,
      exchange: String(exchange ?? "").trim().toLowerCase(),
      symbol,
      venueOrderId: String(orderId ?? "").trim(),
      ...(positionId ? { positionId } : {}),
      ...(filled
        ? {
            fill: {
              status: filled.status ?? null,
              filled: filled.filled ?? null,
              average: filled.average ?? null,
              at: filled.at ?? null
            }
          }
        : {
            reason: readAnswered
              ? "verify observed but zero fills — order open/unfilled (no fabricated close)"
              : "verify unobserved — the venue did not answer (read-only, no fabrication)"
          })
    }
  })
  return { ok: Boolean(filled), clientOrderId, idempotencyKey: proposalKey, filled, kind, at: now }
}

/**
 * The reduce-only close leg, replayed from the durable position record. The
 * proposal carries reduceOnly:true, marginMode:"isolated", leverage AND
 * positionLeverage = position.leverage (gate 11 reads positionLeverage on
 * reduce-only), exit notional = size × price, positionId, and the deterministic
 * close idempotency key. Same execution composition as opens: perps-5 first
 * (position-cap denies here when the post-close net count is at/over the cap),
 * then executeProposal runs the sidecar 10 + venue.
 *
 * BOUNDARY: the rail audits execution outcomes only. Recording the close in
 * the position manager (livePositionManager.recordClose) is T7's wiring on the
 * verified fill — NOT this rail's job.
 *
 * The close anchor: proposal:created (kind:"close") is recorded only when the
 * execution actually proceeded (execution !== null) — so a sidecar deny or an
 * idempotent re-click never spawns a phantom second anchor, and the close's
 * list row only exists from an executed/failed attempt, keyed by its proposal
 * key while execution:executed|failed is keyed by the matching :exec half.
 */
export async function executePerpsClose({
  exchange,
  symbol,
  positionId,
  price,
  consentBy,
  position,
  state = {},
  observation,
  submit,
  audit = appendAudit,
  now = Date.now(),
  template = templateForSite(PERPS_SITE)
}) {
  const clientOrderId = closeClientOrderIdFor(positionId)
  const proposalKey = perpsCloseIdempotencyKey({ exchange, positionId, clientOrderId })
  const leverage = Number(position?.leverage)
  const amount = Number(position?.size)
  const notionalUsd = Math.round(amount * Number(price) * 100) / 100
  const proposal = {
    action: PERPS_CLOSE_ACTION,
    power: "proposals",
    consentBy,
    exposureUsd: 0, // a close adds no exposure — the 5D envelope is untouched
    rationale: perpsCloseRationale({
      symbol,
      amount,
      price,
      notionalUsd,
      leverage,
      positionId,
      dayLossPct: state.dayLossPct
    }),
    idempotencyKey: executionIdempotencyKey(proposalKey),
    symbol,
    side: position?.side ?? null,
    amount,
    price,
    leverage,
    positionLeverage: leverage,
    marginMode: "isolated",
    reduceOnly: true,
    notionalUsd,
    marginUsd: 0,
    positionId
  }
  const perpsGate = evaluatePerpsGate({ template, proposal, observation, audit })
  if (!perpsGate.allow) {
    return { ok: false, gate: null, perpsGate, riskGate: null, execution: null, clientOrderId, idempotencyKey: proposalKey, proposal }
  }
  // WS-2 gates 16-19 also guard the close click: reduceOnly skips gates 17/18,
  // but the aggregate day-loss and portfolio-heat gates still apply before the
  // sidecar-10 re-run inside executeProposal.
  const riskObservation = await resolveRiskObservation({ injected: observation ? { risk: observation.risk, heat: observation.heat } : null, now })
  const riskGate = evaluateRiskGate({ template, proposal, observation: riskObservation, audit, now })
  if (!riskGate.allow) {
    return { ok: false, gate: riskGate, perpsGate, riskGate, execution: null, clientOrderId, idempotencyKey: proposalKey, proposal, blockedBy: riskGate.blockedBy }
  }
  const result = await executeProposal({
    template,
    proposal,
    state: { ...state, now },
    executor: submit,
    audit,
    now
  })
  if (result.execution) {
    audit({
      site: PERPS_SITE,
      kind: "proposal:created",
      data: {
        clientOrderId,
        idempotencyKey: proposalKey,
        action: PERPS_CLOSE_ACTION,
        exchange: String(exchange ?? "").trim().toLowerCase(),
        symbol,
        side: position?.side ?? null,
        amount,
        price,
        notionalUsd,
        marginUsd: 0,
        clamped: false,
        leverage,
        marginMode: "isolated",
        positionLeverage: leverage,
        reduceOnly: true,
        kind: "close",
        positionId,
        power: "proposals",
        consentBy,
        rationale: proposal.rationale
      }
    })
  }
  return { ...result, riskGate, clientOrderId, idempotencyKey: proposalKey }
}

/**
 * The perps list surface: proposal:created entries (durable audit) joined with
 * their honest latest state, for BOTH open and close kinds. Newest first. kind
 * comes from the recorded proposal ("open" | "close").
 *
 * CLOSE-ROW MARGIN NOTE (T7's list composer): a close deploys NO new margin —
 * its anchor records marginUsd: 0 / exposureUsd: 0, so a close row's
 * marginUsd: 0 must be read as "no new margin deployed", never as "free".
 */
export function perpsProposalsFromAudit(audits = []) {
  const byKind = (kind) =>
    new Map(audits.filter((e) => e.kind === kind).map((e) => [e.data?.idempotencyKey, e]))
  const executed = byKind("execution:executed")
  const failed = byKind("execution:failed")
  const filled = byKind("perps-verify:filled")
  const unobserved = byKind("perps-verify:unobserved")

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
        marginUsd: p.data?.marginUsd ?? null,
        leverage: p.data?.leverage ?? null,
        marginMode: p.data?.marginMode ?? null,
        clamped: p.data?.clamped === true,
        rationale: p.data?.rationale ?? null,
        status,
        kind: p.data?.kind === "close" ? "close" : "open",
        positionId: p.data?.positionId ?? null,
        proposedBy: p.data?.consentBy ?? null,
        proposedAt: p.at ?? null
      }
    })
    .reverse()
}