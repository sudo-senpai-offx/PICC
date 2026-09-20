// v3.2 Plan 3 — v32Copilot: the 8 approved deterministic trip-wires + a
// serializable explain-state (blueprint §5; B-IND-0 §11.4 + §12.4). Zero LLM
// in the trade path — this module imports NO LLM service (pinned by a static
// check in the test bed). Every wire FAILS CLOSED: an unavailable input blocks
// the entry with an honest reason and never passes (REQ-P3-7). The verdict
// TRADE/OBSERVE/NEUTRAL composition lives in v32Engine; copilotGate only
// answers "are the trip-wires clear, and which are not" (REQ-P3-7/8).
//
// Frozen-surface reads (read-only, never edited):
//   - safetySidecar.mjs  — `crossSiteHaltState()` for the cross-site breaker
//     halt; the runtime kill switch is matched through the same store the
//     killSwitchReader points at (safetySidecar.mjs:56-59). copilot keeps the
//     read explicit (risk.killSwitch) rather than holding a reader.
//   - u4faRisk.mjs       — wire 1 daily barrier via `checkProposalGate` (:95)
//     floor semantics; wire 8 count comes in as `risk.proposalsToday` (the
//     caller supplies `riskDayState().proposals`, u4faRisk.mjs:139).
//   - constitution.mjs   — wire 5 threshold via `EV_RR_MIN` (constitution.mjs:22).

import { checkProposalGate } from "./u4faRisk.mjs"
import { crossSiteHaltState } from "./commandCentre/safetySidecar.mjs"
import { EV_RR_MIN } from "./constitution.mjs"

/**
 * The −2% session halt floor (blueprint §5 / B-IND-0 §12.4). NON-CONFIGURABLE:
 * there is deliberately no config knob for this value — raising or lowering it
 * requires a spec change, not a runtime setting.
 */
export const SESSION_HALT_FLOOR_PCT = 2

/** Stable wire order, enforced by the test bed (wires 1-8). */
export const COPILOT_WIRE_IDS = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8"])

const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null)

function wireResult(id, tripped, reason) {
  return { id, tripped, reason }
}

// ---------------------------------------------------------------------
// Wire 1 — −5% daily / −2% session hard-halt floor (non-configurable)
// ---------------------------------------------------------------------
function wire1Daily(risk) {
  const start = Number(risk?.dayStartBalance)
  const pnl = Number(risk?.pnl)
  if (!(Number.isFinite(start) && start > 0) || !Number.isFinite(pnl)) {
    return { failClosed: true, reason: "cannot compute daily PnL - balance unavailable" }
  }
  const gate = checkProposalGate({ dayStartBalance: start, pnl })
  if (gate.ok === false && gate.reason.startsWith("daily loss barrier")) {
    return { failClosed: false, tripped: true, reason: gate.reason }
  }
  return { failClosed: false, tripped: false, reason: null }
}

function wire1Session(risk) {
  const spnl = Number(risk?.sessionPnL)
  const sbal = Number(risk?.sessionBalance)
  if (!Number.isFinite(spnl) || !(Number.isFinite(sbal) && sbal > 0)) {
    return { failClosed: true, reason: "cannot compute session PnL - balance unavailable" }
  }
  const pct = (spnl / sbal) * 100
  if (pct <= -SESSION_HALT_FLOOR_PCT) {
    return {
      failClosed: false,
      tripped: true,
      reason: `session loss barrier (-${Math.abs(round2(pct))}% of session balance; floor -${SESSION_HALT_FLOOR_PCT}%)`
    }
  }
  return { failClosed: false, tripped: false, reason: null }
}

function wire1(risk) {
  const daily = wire1Daily(risk)
  const session = wire1Session(risk)
  const reasons = []
  const failClosed = daily.failClosed || session.failClosed
  if (daily.failClosed || daily.tripped) reasons.push(daily.reason)
  if (session.failClosed || session.tripped) reasons.push(session.reason)
  if (reasons.length === 0) return wireResult("1", false, "no halt condition")
  return wireResult("1", true, reasons.join("; ") + (failClosed ? " (fail-closed: input unavailable)" : ""))
}

// ---------------------------------------------------------------------
// Wire 2 — Regime-3 chop override (REQ-CTX-1)
// ---------------------------------------------------------------------
function wire2(regime) {
  const adx = regime?.registers?.adx
  if (adx == null || adx.available !== true) {
    return wireResult("2", true, `adx register unavailable — ${adx?.reason ?? "no register"} (fail-closed)`)
  }
  if (adx.chop === true) return wireResult("2", true, "Regime-3 chop override — adx.chop true (REQ-CTX-1)")
  return wireResult("2", false, "no chop condition")
}

// ---------------------------------------------------------------------
// Wire 3 — dead-zone / red-folder entry block (REQ-CTX-5)
// ---------------------------------------------------------------------
function wire3(regime) {
  const session = regime?.registers?.session
  if (session == null || session.available !== true) {
    return wireResult("3", true, `${session?.reason ?? "session register unavailable"} (fail-closed)`)
  }
  if (session.label !== "normal") {
    return wireResult("3", true, `dead-zone/red-folder — session label "${session.label}" (REQ-CTX-5)`)
  }
  return wireResult("3", false, "session open and clear")
}

// ---------------------------------------------------------------------
// Wire 4 — 1.5-pip spread-spike abort (REQ-CTX-6; unmeasurable ⇒ closed)
// ---------------------------------------------------------------------
function wire4(regime) {
  const spread = regime?.f1?.checks?.spread
  if (spread == null || spread.check !== "ok") {
    return wireResult("4", true, `${spread?.reason ?? "spread gate unavailable (unmeasurable = closed)"} (REQ-CTX-6)`)
  }
  return wireResult("4", false, "spread within limit")
}

// ---------------------------------------------------------------------
// Wire 5 — cost line below 2:1 EV margin (REQ-P3-8)
// ---------------------------------------------------------------------
function wire5(execution, constitution) {
  const line = execution?.costLine
  const threshold = Number(constitution?.evRRMin ?? EV_RR_MIN)
  if (line == null) return wireResult("5", true, "cost line unavailable (fail-closed)")
  const evRR = Number(line.evRR)
  if (line.evRRPass === false || (Number.isFinite(evRR) && evRR < threshold)) {
    const got = Number.isFinite(evRR) ? evRR : "null"
    return wireResult("5", true, `cost line below ${threshold}:1 EV margin — evRR ${got} (REQ-P3-8)`)
  }
  return wireResult("5", false, `cost line clears ${threshold}:1 EV margin (evRR ${evRR})`)
}

// ---------------------------------------------------------------------
// Wire 6 — kill-switch everywhere
// ---------------------------------------------------------------------
function wire6(risk) {
  const halt = crossSiteHaltState()
  const kills = risk?.killSwitch
  if (halt != null) {
    return wireResult("6", true, `cross-site day halt — breaker "${halt.breaker}" on ${halt.site} (safetySidecar)`)
  }
  if (kills === true) return wireResult("6", true, "global kill switch is ON (runtime store)")
  if (kills !== false) return wireResult("6", true, "kill switch state unavailable — cannot prove it is off (fail-closed)")
  return wireResult("6", false, "kill switch confirmed off")
}

// ---------------------------------------------------------------------
// Wire 7 — voluntary pause on consecutive losses (threshold owner-set)
// ---------------------------------------------------------------------
function wire7(risk, config) {
  const threshold = config?.consecutiveLossThreshold
  if (threshold == null || Number(threshold) <= 0) {
    return wireResult("7", false, "disabled (threshold not set)")
  }
  const count = Number(risk?.consecutiveLosses)
  if (!Number.isFinite(count)) {
    return wireResult("7", true, "consecutive-loss count unavailable (fail-closed)")
  }
  if (count >= Number(threshold)) {
    return wireResult("7", true, `voluntary pause — ${count} consecutive losses ≥ threshold ${threshold}`)
  }
  return wireResult("7", false, `${count} consecutive losses below threshold ${threshold}`)
}

// ---------------------------------------------------------------------
// Wire 8 — configurable proposals/day cap (supersedes the U4FA cap on the
// v3.2 lane per ADR-0004 Consequences / REQ-P3-9). Default 0 = unlimited;
// the U4FA lanes keep `maxDailyTrades` (u4faConfig.mjs:121) and
// `U4FA_MAX_DAILY_PROPOSALS` (u4faRisk.mjs:23) — ONLY the v3.2 lane is capped
// by `config.proposalCap`.
// ---------------------------------------------------------------------
function wire8(risk, config) {
  const cap = Number(config?.proposalCap)
  if (!Number.isFinite(cap) || cap <= 0) {
    return wireResult("8", false, "unlimited (0/undefined)")
  }
  const today = Number(risk?.proposalsToday)
  if (!Number.isFinite(today)) {
    return wireResult("8", true, "today's proposals unknown (fail-closed)")
  }
  if (today >= cap) {
    return wireResult("8", true, `daily proposal cap ${cap} reached (${today} today)`)
  }
  return wireResult("8", false, `${today} proposals under cap ${cap}`)
}

/**
 * The copilot gate (REQ-P3-7/8/9): runs wires 1-8 in COPILOT_WIRE_IDS order.
 * `ok` = no wire tripped. Any fail-closed wire trips (a wire that cannot
 * honestly prove its input is safe BLOCKS — it never passes). `blockedBy`
 * lists the tripping wire ids.
 */
export function copilotGate({ regime = {}, execution = {}, constitution = {}, risk = {}, config = {} } = {}) {
  const wires = [
    wire1(risk),
    wire2(regime),
    wire3(regime),
    wire4(regime),
    wire5(execution, constitution),
    wire6(risk),
    wire7(risk, config),
    wire8(risk, config)
  ]
  const blockedBy = wires.filter((w) => w.tripped).map((w) => w.id)
  return { ok: blockedBy.length === 0, wires, blockedBy }
}

/**
 * Deterministic explain-state serializer (REQ-P3-7 explain half). Reduces the
 * gate + the registers into a stable, JSON-safe object. `at` is explicit — the
 * serializer never reads the wall clock. Zero LLM: this is the object an LLM
 * could later render, never a call to one.
 */
export function explainState({ regime = {}, execution = {}, constitution = {}, risk = {}, config = {}, at = null } = {}) {
  const gate = copilotGate({ regime, execution, constitution, risk, config })
  const score = execution?.score
  const sessionReg = regime?.registers?.session
  const adxReg = regime?.registers?.adx
  return {
    at,
    ok: gate.ok,
    verdict: gate.ok ? "TRADE" : "NEUTRAL",
    blockedBy: gate.blockedBy,
    wires: gate.wires,
    costLine: execution?.costLine ?? null,
    score: score == null || score.available !== true ? null : { available: true, score: score.score, direction: score.direction },
    regime: {
      adx: adxReg == null ? null : { available: adxReg.available === true, chop: adxReg.available === true ? adxReg.chop : null },
      session: sessionReg == null ? null : { available: sessionReg.available === true, label: sessionReg.available === true ? sessionReg.label : null }
    },
    risk: { dayStartBalance: risk?.dayStartBalance ?? null, pnl: risk?.pnl ?? null, proposalsToday: risk?.proposalsToday ?? null },
    config: { proposalCap: config?.proposalCap ?? null, consecutiveLossThreshold: config?.consecutiveLossThreshold ?? null }
  }
}