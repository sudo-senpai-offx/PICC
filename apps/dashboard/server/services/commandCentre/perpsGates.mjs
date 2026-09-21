// Command Centre — Perps Gates (F4, WS-1: live order lifecycle).
//
// The 5 additive gates (11–15) composed AFTER the existing 10-gate sidecar
// allow (R4.3 — that module is not modified and not referenced from here; the
// file name is deliberately absent so a source-level no-import assertion can
// stay a pure string check). This module is PURE and standalone: it imports
// nothing and NEVER calls `evaluateGate` — there is exactly one gate path per
// proposal (10 sidecar gates, then this rail). The T6 execution rail composes
// the two; this file is not modified for that.
//
//   11. perps-leverage-band   — proposal leverage in [PICC_CCXT_LEVERAGE_MIN,
//                               PICC_CCXT_LEVERAGE_MAX]; absent/NaN → deny.
//   12. perps-margin-cap      — implied margin (notionalUsd / leverage) <=
//                               PICC_CCXT_MARGIN_PER_POSITION_CAP_USD.
//   13. perps-isolated-only   — proposal marginMode must be "isolated".
//   14. perps-position-cap    — net open perps positions after this action
//                               within PICC_CCXT_PERPS_MAX_OPEN_POSITIONS.
//   15. perps-funding-fresh   — a funding observation within
//                               PICC_CCXT_FUNDING_STALE_MS; absent/stale deny
//                               with the observed age.
//
// Cascade: the gates run in the fixed order 11→15; the FIRST deny stops the
// rail and names itself (only that one deny is audited/reported).
//
// Proposal shape (the T6 contract — the rail builds these):
//   {
//     action:           "perps:open-order" | "perps:close-order",
//     leverage:         number,   // requested leverage — gate 11 (opens)
//     positionLeverage: number,   // the position record's DECLARED leverage —
//                                 // gate 11 reads this for reduce-only closes
//     notionalUsd:      number,   // order notional — gate 12 margin math
//     marginMode:       "isolated" | "cross",
//     reduceOnly:       boolean,  // true → this is a reduce-only close
//   }
//
// Reduce-only close semantics (R4.2): gates 12/14 evaluate the POST-CLOSE
// state (a close never adds exposure → they pass); gate 11 uses the position
// record's declared leverage; gate 15 still requires funding freshness (a
// close without a fresh funding read is refused — the human re-proposes when
// the venue answers).
//
// Every allow AND deny is audited (`safety-gate:deny`/`safety-gate:allow`)
// when an `audit` fn is injected, matching the sidecar's appendAudit shape:
//   { site, kind, data: { action, blockedBy, reason } }
// Audit is wiring, not flow: with audit omitted the decision is returned and
// nothing is recorded.

/** The perps gate order, declared once and enforced by tests. */
export const PERPS_GATE_ORDER = Object.freeze([
  "perps-leverage-band",
  "perps-margin-cap",
  "perps-isolated-only",
  "perps-position-cap",
  "perps-funding-fresh"
])

const ENV_DEFAULTS = Object.freeze({
  PICC_CCXT_LEVERAGE_MIN: 3,
  PICC_CCXT_LEVERAGE_MAX: 5,
  PICC_CCXT_MARGIN_PER_POSITION_CAP_USD: 10,
  PICC_CCXT_PERPS_MAX_OPEN_POSITIONS: 1,
  PICC_CCXT_FUNDING_STALE_MS: 7_200_000
})

// Honesty rule mirrored from the adapter seam: an invalid numeric env
// (non-finite, <= 0) at first use is an explicit `invalid-environment` deny
// naming the var — never a silent fallback.
function envNumber(name) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return { ok: true, value: ENV_DEFAULTS[name] }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return { ok: false, varName: name, raw }
  return { ok: true, value }
}

/**
 * Evaluate one perps proposal against gates 11–15. Pure: reads `process.env`
 * at call time and nothing else external.
 *
 *   template   — the site's policy-graph template; only template.site names
 *                the audit site (the perps gates are self-sufficient).
 *   proposal   — the T6 proposal shape documented above.
 *   observation= { leverage, notionalUsd, marginMode, openNetPositions,
 *                  funding: { rate, at } | null }
 *   audit      — appendAudit-compatible fn; every decision audited when present
 */
export function evaluatePerpsGate({ template, proposal, observation, audit = null } = {}) {
  const site = template?.site ?? "unknown"
  const block = (blockedBy, reason) => {
    if (audit) {
      audit({ site, kind: "safety-gate:deny", data: { action: proposal?.action ?? null, blockedBy, reason } })
    }
    return { allow: false, blockedBy, reason }
  }
  const allow = (reason) => {
    if (audit) {
      audit({ site, kind: "safety-gate:allow", data: { action: proposal?.action ?? null, blockedBy: null, reason } })
    }
    return { allow: true, blockedBy: null, reason }
  }

  if (!proposal || typeof proposal !== "object" || !observation || typeof observation !== "object") {
    return block("perps-leverage-band", "no proposal/observation to gate — cannot evaluate perps gates")
  }

  const action = proposal.action ?? "unknown"
  const reduceOnly = proposal.reduceOnly === true

  // ── 11. perps-leverage-band ───────────────────────────────────────────────
  const minEnv = envNumber("PICC_CCXT_LEVERAGE_MIN")
  if (!minEnv.ok) return block("perps-leverage-band", `invalid-environment: ${minEnv.varName}=${minEnv.raw}`)
  const maxEnv = envNumber("PICC_CCXT_LEVERAGE_MAX")
  if (!maxEnv.ok) return block("perps-leverage-band", `invalid-environment: ${maxEnv.varName}=${maxEnv.raw}`)
  if (minEnv.value > maxEnv.value) {
    return block(
      "perps-leverage-band",
      `invalid-environment: PICC_CCXT_LEVERAGE_MIN=${minEnv.value}; PICC_CCXT_LEVERAGE_MAX=${maxEnv.value} — min > max`
    )
  }
  const leverage = reduceOnly ? proposal.positionLeverage : proposal.leverage
  if (!Number.isFinite(leverage)) {
    return block("perps-leverage-band", `leverage not-a-number — a numeric leverage is required (${reduceOnly ? "positionLeverage" : "leverage"})`)
  }
  if (leverage < minEnv.value || leverage > maxEnv.value) {
    return block("perps-leverage-band", `leverage ${leverage} outside band [${minEnv.value}, ${maxEnv.value}]`)
  }

  // ── 12. perps-margin-cap ──────────────────────────────────────────────────
  // Reduce-only close: post-close state is zero exposure → passes.
  if (!reduceOnly) {
    const capEnv = envNumber("PICC_CCXT_MARGIN_PER_POSITION_CAP_USD")
    if (!capEnv.ok) return block("perps-margin-cap", `invalid-environment: ${capEnv.varName}=${capEnv.raw}`)
    const margin = observation.notionalUsd / leverage
    if (!Number.isFinite(margin)) {
      return block("perps-margin-cap", "implied margin not computable — notionalUsd missing or not a number")
    }
    if (margin > capEnv.value) {
      return block("perps-margin-cap", `implied margin $${margin} > cap $${capEnv.value}`)
    }
  }

  // ── 13. perps-isolated-only ───────────────────────────────────────────────
  if (proposal.marginMode !== "isolated") {
    return block("perps-isolated-only", `marginMode ${JSON.stringify(proposal.marginMode)} — isolated margin only (perps, never cross)`)
  }

  // ── 14. perps-position-cap ────────────────────────────────────────────────
  const capEnv = envNumber("PICC_CCXT_PERPS_MAX_OPEN_POSITIONS")
  if (!capEnv.ok) return block("perps-position-cap", `invalid-environment: ${capEnv.varName}=${capEnv.raw}`)
  const openNetPositions = observation.openNetPositions
  if (!Number.isFinite(openNetPositions)) {
    return block("perps-position-cap", "openNetPositions missing or not a number — cannot evaluate the position cap")
  }
  const postAction = reduceOnly ? openNetPositions - 1 : openNetPositions + 1
  if (postAction > capEnv.value) {
    return block(
      "perps-position-cap",
      `net open positions after action ${postAction} > cap ${capEnv.value} (max open positions)`
    )
  }

  // ── 15. perps-funding-fresh ───────────────────────────────────────────────
  const staleEnv = envNumber("PICC_CCXT_FUNDING_STALE_MS")
  if (!staleEnv.ok) return block("perps-funding-fresh", `invalid-environment: ${staleEnv.varName}=${staleEnv.raw}`)
  const funding = observation.funding ?? null
  if (!funding || !Number.isFinite(funding.at)) {
    return block("perps-funding-fresh", "no funding observation for this symbol — absent-funding; re-propose when the venue answers")
  }
  const ageMs = Date.now() - funding.at
  if (ageMs > staleEnv.value) {
    return block("perps-funding-fresh", `funding observation is stale — observed age ${ageMs}ms > window ${staleEnv.value}ms`)
  }

  return allow(`perps gates 11-15 passed for ${action} on ${site}`)
}