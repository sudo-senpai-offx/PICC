// WS-2 F2 — risk gates 16-19 (aggregate day loss, MDD size-step/hard-stop,
// portfolio heat), evaluated in fixed order AFTER the sidecar 10 + perps 11-15.
// Honesty contract: every un-evaluable input (null aggregate, unreadable heat
// source, invalid env) is a DENY that names it — never a silent pass. Gate 16's
// trip is the production dailyLoss producer (riskHaltStore.tripBreaker vines the
// sidecar globalHalt → gate 2 blocks the UTC day); gate 18's trips set the
// cross-day drawdown latch in the aggregate store.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { haltForDrawdown } from "./riskState.mjs"
import { tripBreaker } from "./riskHaltStore.mjs"
import { proposalOrdersFromAudit } from "./ccxtExecution.mjs"

export const RISK_GATE_ORDER = Object.freeze([
  "risk-day-loss-aggregate",
  "risk-mdd-size-step",
  "risk-mdd-hard-stop",
  "risk-portfolio-heat"
])

const ENV_DEFAULTS = Object.freeze({
  PICC_RISK_AGGREGATE_DAILY_LOSS_PCT: 5,
  PICC_RISK_MDD_STEP_TRIP_PCT: 10,
  PICC_RISK_MDD_HARD_STOP_PCT: 15,
  PICC_RISK_MDD_SIZE_STEP_FACTOR: 0.5,
  PICC_RISK_PORTFOLIO_HEAT_CAP_USD: 30
})

const POSITIONS_SOURCE = "ccxt-perps-positions.json"
const AUDIT_SOURCE = "audit:proposalOrdersFromAudit"

const round2 = (x) => Math.round(Number(x) * 100) / 100

function envNumber(name) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return { ok: true, value: ENV_DEFAULTS[name], varName: name }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return { ok: false, varName: name, raw }
  return { ok: true, value, varName: name }
}

function dataDir() {
  return process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
}

/**
 * Portfolio heat (R3/D3): perps open margin = SUM(marginUsd) over the persisted
 * positions store ccxt-perps-positions.json (the same data gate 14 counts);
 * spot open notional = SUM(notionalUsd) over open/executed orders resolved from
 * the audit via proposalOrdersFromAudit. Either source unreadable → usd null +
 * a reason naming it — heat is never partial.
 */
export function portfolioHeatUsd({ audits = null, dataDir: dirOverride = null } = {}) {
  const dir = dirOverride ?? dataDir()
  const sources = [POSITIONS_SOURCE, AUDIT_SOURCE]

  let perps = null
  const path = join(dir, POSITIONS_SOURCE)
  try {
    const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null
    const positions = raw && typeof raw === "object" && Array.isArray(raw.positions) ? raw.positions : null
    if (!raw) perps = { ok: false, reason: `unreadable: ${POSITIONS_SOURCE} missing` }
    else if (!positions) perps = { ok: false, reason: `unreadable: ${POSITIONS_SOURCE} unusable (no positions array)` }
    else {
      let sum = 0
      let broken = null
      for (const rec of positions) {
        const margin = rec && typeof rec === "object" ? Number(rec.marginUsd) : NaN
        if (!Number.isFinite(margin)) {
          broken = `unobservable: ${POSITIONS_SOURCE} record with invalid marginUsd`
          break
        }
        sum += margin
      }
      perps = broken ? { ok: false, reason: broken } : { ok: true, usd: round2(sum) }
    }
  } catch {
    perps = { ok: false, reason: `unreadable: ${POSITIONS_SOURCE} unparseable` }
  }

  let spot = null
  if (!Array.isArray(audits)) {
    spot = { ok: false, reason: `unreadable: ${AUDIT_SOURCE} — no audit rows to read` }
  } else {
    try {
      const openOrders = proposalOrdersFromAudit(audits).filter((o) => o.status === "open" || o.status === "executed")
      let sum = 0
      let broken = null
      for (const o of openOrders) {
        const notional = Number(o.notionalUsd)
        if (!Number.isFinite(notional)) {
          broken = `unobservable: ${AUDIT_SOURCE} open order with invalid notionalUsd`
          break
        }
        sum += notional
      }
      spot = broken ? { ok: false, reason: broken } : { ok: true, usd: round2(sum) }
    } catch {
      spot = { ok: false, reason: `unreadable: ${AUDIT_SOURCE} — audit rows unusable` }
    }
  }

  const perpsMarginUsd = perps.ok ? perps.usd : null
  const spotNotionalUsd = spot.ok ? spot.usd : null
  if (!perps.ok || !spot.ok) {
    const failedReason = [perps.ok ? null : perps.reason, spot.ok ? null : spot.reason].filter(Boolean).join("; ")
    return { usd: null, perpsMarginUsd, spotNotionalUsd, sources, reason: failedReason }
  }
  return { usd: round2(perpsMarginUsd + spotNotionalUsd), perpsMarginUsd, spotNotionalUsd, sources, reason: null }
}

/**
 * Evaluate one action proposal against risk gates 16-19 in fixed order; the
 * FIRST deny stops the rail and names itself (one `safety-gate:deny` audited).
 * observation.risk = refreshAggregateRisk result (fresh aggregate contract);
 * observation.heat = portfolioHeatUsd result or a plain usd number.
 */
export function evaluateRiskGate({ template, proposal, observation = {}, audit = null, now = Date.now() } = {}) {
  const site = template?.site ?? "unknown"
  const risk = observation?.risk ?? {}
  const aggregate = risk.aggregate ?? observation?.aggregate ?? null
  const riskReason = risk.ok === false ? risk.reason ?? null : observation?.reason ?? null

  const block = (blockedBy, reason) => {
    if (audit) {
      audit({ site, kind: "safety-gate:deny", data: { action: proposal?.action ?? null, blockedBy, reason } })
    }
    return { allow: false, blockedBy, gate: blockedBy, reason }
  }
  const allow = (gate, reason, extra = {}) => {
    if (audit) {
      audit({ site, kind: "safety-gate:allow", data: { action: proposal?.action ?? null, blockedBy: null, gate, reason, ...extra } })
    }
    return { allow: true, blockedBy: null, gate, reason, ...extra }
  }

  if (!proposal || typeof proposal !== "object" || !observation || typeof observation !== "object") {
    return block("risk-day-loss-aggregate", "no proposal/observation to gate — cannot evaluate risk gates")
  }

  const action = proposal.action ?? "unknown"
  const reduceOnly = proposal.reduceOnly === true
  let adjustment = null

  const dayLossEnv = envNumber("PICC_RISK_AGGREGATE_DAILY_LOSS_PCT")
  if (!dayLossEnv.ok) return block("risk-day-loss-aggregate", `invalid-environment: ${dayLossEnv.varName}=${dayLossEnv.raw}`)
  if (!aggregate || aggregate.fresh !== true || aggregate.dayLossPct == null) {
    return block("risk-day-loss-aggregate", `un-evaluable: ${riskReason ?? "risk aggregate unavailable or not fresh"}`)
  }
  const dayLoss = Number(aggregate.dayLossPct)
  if (!Number.isFinite(dayLoss)) {
    return block("risk-day-loss-aggregate", "un-evaluable: aggregate dayLossPct is not a number")
  }
  if (dayLoss > dayLossEnv.value) {
    tripBreaker("trading", "dailyLoss", { now, audit })
    return block(
      "risk-day-loss-aggregate",
      `aggregate day loss ${dayLoss}% > ceiling ${dayLossEnv.value}% (${dayLossEnv.varName}) — all sites halted for the UTC day`
    )
  }

  const stepEnv = envNumber("PICC_RISK_MDD_STEP_TRIP_PCT")
  if (!stepEnv.ok) return block("risk-mdd-size-step", `invalid-environment: ${stepEnv.varName}=${stepEnv.raw}`)
  const hardEnv = envNumber("PICC_RISK_MDD_HARD_STOP_PCT")
  if (!hardEnv.ok) return block("risk-mdd-size-step", `invalid-environment: ${hardEnv.varName}=${hardEnv.raw}`)
  const factorEnv = envNumber("PICC_RISK_MDD_SIZE_STEP_FACTOR")
  if (!factorEnv.ok || factorEnv.value > 1) {
    return block(
      "risk-mdd-size-step",
      `invalid-environment: PICC_RISK_MDD_SIZE_STEP_FACTOR=${process.env.PICC_RISK_MDD_SIZE_STEP_FACTOR ?? "default"} — must be a positive number ≤ 1`
    )
  }
  const dd = Number.isFinite(aggregate.drawdownFromPeakPct) ? aggregate.drawdownFromPeakPct : null
  if (!reduceOnly && dd !== null && dd >= stepEnv.value && dd < hardEnv.value) {
    const capFromProposal = Number.isFinite(proposal.exposureCapUsd)
    const cap = capFromProposal ? proposal.exposureCapUsd : template?.envelope?.maxExposureUsd
    if (!Number.isFinite(cap)) {
      return block(
        "risk-mdd-size-step",
        `un-evaluable: drawdown ${dd}% in step zone but no per-position cap (proposal.exposureCapUsd or template.envelope.maxExposureUsd)`
      )
    }
    const ceiling = round2(cap * factorEnv.value)
    const exposure = Number.isFinite(proposal.exposureUsd) ? proposal.exposureUsd : null
    if (exposure === null) {
      return block("risk-mdd-size-step", `un-evaluable: drawdown ${dd}% in step zone but proposal.exposureUsd missing`)
    }
    if (exposure > ceiling) {
      return block(
        "risk-mdd-size-step",
        `exposure $${exposure} > step ceiling $${ceiling} (cap $${cap} × sizeStepFactor ${factorEnv.value}) at drawdown ${dd}% — mddAdjusted`
      )
    }
    adjustment = { mddAdjusted: true, sizeStepFactor: factorEnv.value, ceilingUsd: ceiling, capUsd: cap, drawdownFromPeakPct: dd }
  }

  const ddHard = Number.isFinite(aggregate?.drawdownFromPeakPct) ? aggregate.drawdownFromPeakPct : null
  const latchActive = aggregate?.halted?.trip === "drawdown"
  if (ddHard !== null && ddHard >= hardEnv.value && !latchActive) {
    try {
      haltForDrawdown({ note: `drawdown ${ddHard}% >= ${hardEnv.value}% (${hardEnv.varName})`, now })
    } catch (err) {
      // the latch store refused — the open stays denied, the reason names it
    }
  }
  if (!reduceOnly && (latchActive || (ddHard !== null && ddHard >= hardEnv.value))) {
    const source = latchActive ? "the cross-day drawdown latch is active" : `drawdown ${ddHard}% >= ${hardEnv.value}%`
    return block("risk-mdd-hard-stop", `${source} — new exposure denied; reduce-only closes remain allowed`)
  }

  const heatEnv = envNumber("PICC_RISK_PORTFOLIO_HEAT_CAP_USD")
  if (!heatEnv.ok) return block("risk-portfolio-heat", `invalid-environment: ${heatEnv.varName}=${heatEnv.raw}`)
  const heatIn = observation.heat
  const heatUsd = heatIn != null && typeof heatIn === "object" ? heatIn.usd : heatIn
  const heatSources =
    heatIn != null && typeof heatIn === "object" && Array.isArray(heatIn.sources) && heatIn.sources.length > 0
      ? heatIn.sources
      : ["injected-portfolio-heat"]
  const heatReason = heatIn != null && typeof heatIn === "object" ? (heatIn.reason ?? null) : null
  if (heatUsd == null || !Number.isFinite(Number(heatUsd))) {
    return block(
      "risk-portfolio-heat",
      `un-evaluable: ${heatReason ?? "portfolio heat unavailable (observation.heat missing or not a number)"}`
    )
  }
  const portHeat = Number(heatUsd)
  if (portHeat > heatEnv.value) {
    const perpsPart = heatIn != null && typeof heatIn === "object" ? heatIn.perpsMarginUsd : null
    const spotPart = heatIn != null && typeof heatIn === "object" ? heatIn.spotNotionalUsd : null
    const parts = perpsPart != null || spotPart != null ? ` (perps margin $${perpsPart}, spot open notional $${spotPart})` : ""
    return block(
      "risk-portfolio-heat",
      `portfolio heat $${portHeat} > cap $${heatEnv.value} (${heatEnv.varName}) — sources: ${heatSources.join(", ")}${parts}`
    )
  }

  const adjustLine = adjustment
    ? ` — mddAdjusted: exposure within step ceiling (drawdown ${adjustment.drawdownFromPeakPct}%, sizeStepFactor ${adjustment.sizeStepFactor}, cap $${adjustment.capUsd})`
    : ""
  const extra = adjustment
    ? { mddAdjusted: true, sizeStepFactor: adjustment.sizeStepFactor, ceilingUsd: adjustment.ceilingUsd, capUsd: adjustment.capUsd }
    : {}
  return allow("risk-portfolio-heat", `risk gates 16-19 passed for ${action} on ${site}${adjustLine}`, extra)
}