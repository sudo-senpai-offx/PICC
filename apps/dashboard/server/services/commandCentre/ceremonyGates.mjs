// WS-3 F2 ceremonyGates — pure gate-1/2/3/4 evaluators AND-composed in evaluateCeremony. Honesty contract (ADR-0005): every un-evaluable input (short streak, null winProb, invalid env, unhealthy store) is a ceremony:deny:* named deny — never a silent pass.
import * as ceremonyState from "./ceremonyState.mjs"
import { tradingDaysElapsed } from "./tradingCalendar.mjs"
import { flipGate } from "../constitution.mjs"

const ENV_DEFAULTS = Object.freeze({
  PICC_CEREMONY_GATE1_MIN_RESOLVES: 300,
  PICC_CEREMONY_GATE3_STREAK: 50,
  PICC_CEREMONY_GATE3_RATIO_LO: 0.7,
  PICC_CEREMONY_GATE3_RATIO_HI: 1.3,
  PICC_CEREMONY_GATE4_TRADING_DAYS: 30
})

export const BINARY_PAYOUT_FLOOR_PCT = 85

function envNumber(name) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return { ok: true, value: ENV_DEFAULTS[name], varName: name }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return { ok: false, varName: name, raw }
  return { ok: true, value, varName: name }
}

const asCount = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function ceremonyGate1(storeClass = {}) {
  const env = envNumber("PICC_CEREMONY_GATE1_MIN_RESOLVES")
  if (!env.ok) return { id: "gate1-constitution-300", pass: false, reason: `invalid-environment: ${env.varName}=${env.raw}` }
  const have = asCount(storeClass?.spendableResolved)
  if (have < env.value) {
    return { id: "gate1-constitution-300", pass: false, reason: `ceremony:deny:gate1-short (have ${have}, require ${env.value})` }
  }
  return { id: "gate1-constitution-300", pass: true, reason: `spendable resolved ${have} ≥ ${env.value} (${env.varName})` }
}

function flipRowsFromBuckets(byEngine = {}) {
  const rows = []
  for (const [engine, buckets] of Object.entries(byEngine)) {
    if (!buckets || typeof buckets !== "object" || Array.isArray(buckets)) continue
    for (const [expiry, b] of Object.entries(buckets)) {
      if (!b || typeof b !== "object" || Array.isArray(b)) continue
      rows.push({ engine, expiry, hits: asCount(b.hits), misses: asCount(b.misses), total: asCount(b.total) })
    }
  }
  return rows
}

export function ceremonyGate2(storeClass = {}) {
  const rows = flipRowsFromBuckets(storeClass?.byEngine)
  const flip = flipGate({ rows, legacy: "legacy", candidate: "v3.2", minTrades: 100 })
  if (!flip.flip) {
    return { id: "gate2-flip-gate-100", pass: false, reason: `ceremony:deny:flip-unmet (${flip.reason})` }
  }
  return { id: "gate2-flip-gate-100", pass: true, reason: `flip gate passes: ${flip.reason}` }
}

export function ceremonyGate3(storeClass = {}) {
  const streakEnv = envNumber("PICC_CEREMONY_GATE3_STREAK")
  if (!streakEnv.ok) return { id: "gate3-streak-50-ratio", pass: false, reason: `invalid-environment: ${streakEnv.varName}=${streakEnv.raw}` }
  const loEnv = envNumber("PICC_CEREMONY_GATE3_RATIO_LO")
  if (!loEnv.ok) return { id: "gate3-streak-50-ratio", pass: false, reason: `invalid-environment: ${loEnv.varName}=${loEnv.raw}` }
  const hiEnv = envNumber("PICC_CEREMONY_GATE3_RATIO_HI")
  if (!hiEnv.ok) return { id: "gate3-streak-50-ratio", pass: false, reason: `invalid-environment: ${hiEnv.varName}=${hiEnv.raw}` }
  const needed = streakEnv.value
  const window = Array.isArray(storeClass?.streak) ? storeClass.streak.slice(-needed) : []
  if (window.length < needed) {
    return { id: "gate3-streak-50-ratio", pass: false, reason: `ceremony:deny:streak-short (have ${window.length} rows, require ${needed})` }
  }
  const nullWinProb = window.find((r) => !r || r.winProb == null)
  if (nullWinProb) {
    const seq = nullWinProb.ledgerSeq != null ? nullWinProb.ledgerSeq : "?"
    return { id: "gate3-streak-50-ratio", pass: false, reason: `ceremony:deny:streak-winprob-missing (window row ${seq} has null winProb)` }
  }
  const hits = window.filter((r) => r.result === "hit").length
  const observed = hits / window.length
  const expected = window.reduce((a, r) => a + Number(r.winProb), 0) / window.length
  const ratio = expected > 0 ? observed / expected : Number.NaN
  if (!(Number.isFinite(ratio) && ratio >= loEnv.value && ratio <= hiEnv.value)) {
    const shown = Number.isFinite(ratio) ? ratio.toFixed(4) : String(ratio)
    return { id: "gate3-streak-50-ratio", pass: false, reason: `ceremony:deny:streak-out-of-band (ratio ${shown}, band [${loEnv.value}, ${hiEnv.value}])` }
  }
  return { id: "gate3-streak-50-ratio", pass: true, reason: `streak ratio ${ratio.toFixed(4)} ∈ [${loEnv.value}, ${hiEnv.value}] over ${window.length} rows` }
}

export function ceremonyGate4(storeClass = {}) {
  const env = envNumber("PICC_CEREMONY_GATE4_TRADING_DAYS")
  if (!env.ok) return { id: "gate4-trading-days-30", pass: false, reason: `invalid-environment: ${env.varName}=${env.raw}` }
  const days = tradingDaysElapsed(storeClass?.tradingDays ?? [])
  if (days < env.value) {
    return { id: "gate4-trading-days-30", pass: false, reason: `ceremony:deny:days-short (have ${days} trading days, require ${env.value})` }
  }
  return { id: "gate4-trading-days-30", pass: true, reason: `${days} distinct trading days ≥ ${env.value} (${env.varName})` }
}

export function ceremonyPlatformGate(venueClass, platformVerificationMap = {}) {
  const isBinary =
    platformVerificationMap != null &&
    typeof platformVerificationMap === "object" &&
    !Array.isArray(platformVerificationMap) &&
    Object.prototype.hasOwnProperty.call(platformVerificationMap, venueClass)
  if (!isBinary) return null
  const rec = platformVerificationMap[venueClass]
  if (!rec || rec.verified !== true) {
    return { id: "gate-platform-verification-85", pass: false, reason: "ceremony:deny:platform-unverified" }
  }
  const pct = rec.payoutFloorPct
  const floorOk = (pct != null && Number(pct) >= BINARY_PAYOUT_FLOOR_PCT) || rec.payoutUnderFloor === false
  if (!floorOk) {
    return { id: "gate-platform-verification-85", pass: false, reason: "ceremony:deny:payout-below-floor" }
  }
  return { id: "gate-platform-verification-85", pass: true, reason: `platform verified: regulator ${rec.regulator}, payout floor ${pct}%, withdrawal tested` }
}

const GATE_IDS = Object.freeze([
  "gate1-constitution-300",
  "gate2-flip-gate-100",
  "gate3-streak-50-ratio",
  "gate4-trading-days-30"
])

const EMPTY_CLASS = Object.freeze({
  windowOpenedAt: null,
  lastCreditAt: null,
  spendableResolved: 0,
  byEngine: {},
  streak: [],
  tradingDays: []
})

export function evaluateCeremony(venueClass) {
  if (ceremonyState.storeHealth().ok !== true) {
    const reason = "ceremony:deny:store-unhealthy"
    const gates = GATE_IDS.map((id) => ({ id, pass: false, reason }))
    return {
      venueClass,
      gates,
      spendableResolved: null,
      scaleResolved: null,
      enablement: ceremonyState.enablement(),
      platformVerification: ceremonyState.platformVerification(),
      lastCreditAt: null,
      ok: false
    }
  }
  const cls = ceremonyState.classState(venueClass) ?? { ...EMPTY_CLASS }
  const platformMap = ceremonyState.platformVerification()
  const gates = []
  const finish = (ok) => ({
    venueClass,
    gates,
    spendableResolved: cls.spendableResolved,
    scaleResolved: cls.spendableResolved,
    enablement: ceremonyState.enablementFor(venueClass),
    platformVerification: platformMap[venueClass] ?? null,
    lastCreditAt: cls.lastCreditAt,
    ok
  })
  const g1 = ceremonyGate1(cls)
  gates.push(g1)
  if (!g1.pass) return finish(false)
  const gPlatform = ceremonyPlatformGate(venueClass, platformMap)
  if (gPlatform) {
    gates.push(gPlatform)
    if (!gPlatform.pass) return finish(false)
  }
  const g2 = ceremonyGate2(cls)
  gates.push(g2)
  if (!g2.pass) return finish(false)
  const g3 = ceremonyGate3(cls)
  gates.push(g3)
  if (!g3.pass) return finish(false)
  const g4 = ceremonyGate4(cls)
  gates.push(g4)
  return finish(g4.pass)
}