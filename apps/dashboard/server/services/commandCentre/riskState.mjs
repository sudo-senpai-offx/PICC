// WS-2 F1 riskState — aggregate UTC day-loss + wallet peak store. Honesty contract: an unobservable venue nulls the aggregate (null ≠ 0), nothing partial is ever the portfolio.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { dayKeyOf } from "../u4faRisk.mjs"

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const AGGREGATE_FILE = join(DATA_DIR, "ccxt-risk-aggregate.json")
const SPOT_FILE = join(DATA_DIR, "ccxt-equity.json")
const PERPS_FILE = join(DATA_DIR, "ccxt-perps-risk.json")
const SPOT_NAME = "ccxt-equity.json"
const PERPS_NAME = "ccxt-perps-risk.json"

const DEFAULT_STALE_MS = 300000
const STALE_MS_ENV = "PICC_RISK_AGGREGATE_STALE_MS"

const canTouchDisk = () =>
  process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

const round2 = (x) => Math.round(Number(x) * 100) / 100

let aggregateStoreHealth = { ok: true }
let store = bootAggregate()

function bootAggregate() {
  if (!canTouchDisk() || !existsSync(AGGREGATE_FILE)) return null
  let data
  try {
    data = JSON.parse(readFileSync(AGGREGATE_FILE, "utf8"))
  } catch {
    aggregateStoreHealth = { ok: false, reason: "risk-aggregate-store-unreadable" }
    return null
  }
  if (!data || typeof data !== "object" || data.version !== 1) {
    const versionMismatch = data && typeof data === "object" && data.version !== 1
    aggregateStoreHealth = {
      ok: false,
      reason: versionMismatch ? "risk-aggregate-store-version-mismatch" : "risk-aggregate-store-unreadable"
    }
    return null
  }
  const { version, ...record } = data
  return record
}

function persist() {
  if (!canTouchDisk() || aggregateStoreHealth.ok !== true) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(AGGREGATE_FILE, JSON.stringify({ version: 1, ...store }, null, 2), "utf8")
}

function staleWindowMs() {
  const raw = process.env[STALE_MS_ENV]
  if (raw === undefined || raw === null || raw === "") return DEFAULT_STALE_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function unobservableSpotSource() {
  const covered = Object.keys(store?.venues ?? {}).filter((l) => l.endsWith(":spot"))
  if (covered.length === 0) {
    return [{ venue: "spot", reason: `ccxt-equity-store-unreadable: spot (${SPOT_NAME} missing)` }]
  }
  return covered.map((label) => ({
    venue: label,
    reason: `spot-venue-missing: ${label} no longer observable (${SPOT_NAME} missing)`
  }))
}

function readSpotVenues({ now, staleMs }) {
  const venues = {}
  const unobservable = []
  if (!existsSync(SPOT_FILE)) {
    return { venues, unobservable: unobservableSpotSource() }
  }
  let data
  try {
    data = JSON.parse(readFileSync(SPOT_FILE, "utf8"))
  } catch {
    return { venues, unobservable: unobservableSpotSource() }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { venues, unobservable: unobservableSpotSource() }
  }
  const present = new Set(Object.keys(data))
  for (const prevLabel of Object.keys(store?.venues ?? {}).filter((l) => l.endsWith(":spot"))) {
    const ex = prevLabel.slice(0, -":spot".length)
    if (!present.has(ex)) {
      unobservable.push({ venue: prevLabel, reason: `spot-venue-missing: ${prevLabel} absent from ${SPOT_NAME}` })
    }
  }
  for (const [ex, rec] of Object.entries(data)) {
    const label = `${ex}:spot`
    if (!rec || typeof rec !== "object") {
      unobservable.push({ venue: label, reason: `spot-record-unreadable: ${label}` })
      continue
    }
    const equityUsd = Number(rec.equityUsd)
    const dayStartEquityUsd = Number(rec.dayStartEquityUsd)
    if (!Number.isFinite(equityUsd) || equityUsd <= 0 || !Number.isFinite(dayStartEquityUsd) || dayStartEquityUsd <= 0) {
      unobservable.push({ venue: label, reason: `spot-record-unobservable: ${label} invalid equity/baseline` })
      continue
    }
    if (!rec.at || !Number.isFinite(Date.parse(rec.at))) {
      unobservable.push({ venue: label, reason: `stale: ${label} has no timestamp` })
      continue
    }
    if (now - Date.parse(rec.at) > staleMs) {
      unobservable.push({ venue: label, reason: `stale: ${label} last observed ${rec.at} (> ${staleMs}ms window)` })
      continue
    }
    venues[label] = { source: SPOT_NAME, dayKey: String(rec.dayKey ?? ""), equityUsd, dayStartEquityUsd, at: rec.at }
  }
  return { venues, unobservable }
}

function readPerpsVenue({ now, staleMs }) {
  const label = "hyperliquid:perps"
  if (!existsSync(PERPS_FILE)) {
    return {
      venues: {},
      unobservable: [{ venue: label, reason: `ccxt-perps-risk-store-unreadable: ${label} (${PERPS_NAME} missing)` }]
    }
  }
  let data
  try {
    data = JSON.parse(readFileSync(PERPS_FILE, "utf8"))
  } catch {
    return {
      venues: {},
      unobservable: [{ venue: label, reason: `ccxt-perps-risk-store-unreadable: ${label} (${PERPS_NAME} unparseable)` }]
    }
  }
  if (!data || typeof data !== "object" || data.version !== 1) {
    const versionMismatch = data && typeof data === "object" && data.version !== 1
    return {
      venues: {},
      unobservable: [
        {
          venue: label,
          reason: versionMismatch
            ? `ccxt-perps-risk-store-version-mismatch: ${label} (${PERPS_NAME} version ≠ 1)`
            : `ccxt-perps-risk-store-unreadable: ${label} (${PERPS_NAME} unusable)`
        }
      ]
    }
  }
  const equityUsd = Number(data.equityUsd)
  const dayStartEquityUsd = Number(data.dayStartEquityUsd)
  const at = data.equityAt
  if (!Number.isFinite(equityUsd) || equityUsd <= 0 || !Number.isFinite(dayStartEquityUsd) || dayStartEquityUsd <= 0) {
    return { venues: {}, unobservable: [{ venue: label, reason: `ccxt-perps-risk-store-unobservable: ${label} invalid equity/baseline` }] }
  }
  if (!at || !Number.isFinite(Date.parse(at))) {
    return { venues: {}, unobservable: [{ venue: label, reason: `stale: ${label} has no timestamp` }] }
  }
  if (now - Date.parse(at) > staleMs) {
    return { venues: {}, unobservable: [{ venue: label, reason: `stale: ${label} last observed ${at} (> ${staleMs}ms window)` }] }
  }
  return {
    venues: { [label]: { source: PERPS_NAME, dayKey: String(data.dayKey ?? ""), equityUsd, dayStartEquityUsd, at } },
    unobservable: []
  }
}

export function refreshAggregateRisk({ now = Date.now() } = {}) {
  if (aggregateStoreHealth.ok !== true) {
    return { ok: false, aggregate: null, venues: {}, unobservable: [], reason: aggregateStoreHealth.reason }
  }
  const staleMs = staleWindowMs()
  if (staleMs === null) {
    return {
      ok: false,
      aggregate: null,
      venues: {},
      unobservable: [],
      reason: `invalid-environment: ${STALE_MS_ENV} is not a positive number`
    }
  }
  const spot = readSpotVenues({ now, staleMs })
  const perps = readPerpsVenue({ now, staleMs })
  const venues = { ...spot.venues, ...perps.venues }
  const unobservable = [...spot.unobservable, ...perps.unobservable]
  if (unobservable.length > 0) {
    return { ok: false, aggregate: null, venues, unobservable, reason: unobservable[0].reason }
  }

  const aggregateDayKey = dayKeyOf(now)
  let totalEquity = 0
  let venueDayStartSum = 0
  for (const v of Object.values(venues)) {
    totalEquity += v.equityUsd
    venueDayStartSum += v.dayKey === aggregateDayKey ? v.dayStartEquityUsd : v.equityUsd
  }
  totalEquity = round2(totalEquity)
  venueDayStartSum = round2(venueDayStartSum)

  const dayStartEquityUsd = venueDayStartSum
  const dayLossPct =
    dayStartEquityUsd > 0 ? round2(Math.max(0, ((dayStartEquityUsd - totalEquity) / dayStartEquityUsd) * 100)) : null

  const atIso = new Date(now).toISOString()
  let runningPeakUsd
  let peakAt
  if (store && Number.isFinite(Number(store.runningPeakUsd))) {
    if (totalEquity > Number(store.runningPeakUsd)) {
      runningPeakUsd = totalEquity
      peakAt = atIso
    } else {
      runningPeakUsd = Number(store.runningPeakUsd)
      peakAt = store.peakAt ?? atIso
    }
  } else {
    runningPeakUsd = totalEquity
    peakAt = atIso
  }
  runningPeakUsd = round2(runningPeakUsd)
  const drawdownFromPeakPct = runningPeakUsd > 0 ? round2(((runningPeakUsd - totalEquity) / runningPeakUsd) * 100) : null

  let halted = store?.halted ?? null
  if (halted && totalEquity >= runningPeakUsd) halted = null

  store = {
    dayKey: aggregateDayKey,
    dayStartEquityUsd,
    equityUsd: totalEquity,
    dayLossPct,
    runningPeakUsd,
    peakAt,
    drawdownFromPeakPct,
    halted,
    venues,
    unobservable: []
  }
  persist()

  return {
    ok: true,
    aggregate: {
      dayKey: aggregateDayKey,
      dayStartEquityUsd,
      equityUsd: totalEquity,
      dayLossPct,
      runningPeakUsd,
      peakAt,
      drawdownFromPeakPct,
      halted,
      fresh: true
    },
    venues,
    unobservable: []
  }
}

export function haltForDrawdown({ note, now = Date.now() } = {}) {
  if (aggregateStoreHealth.ok !== true) {
    throw new Error(`risk state aggregate store: ${aggregateStoreHealth.reason} — refusing to mutate`)
  }
  if (!store) {
    throw new Error("risk state aggregate store: no observation yet — refresh before tripping the drawdown latch")
  }
  store = { ...store, halted: { trip: "drawdown", at: new Date(now).toISOString(), note: note ?? "drawdown hard-stop" } }
  persist()
  return { ...store.halted }
}

export function aggregateRiskState() {
  if (!store) return null
  return {
    dayKey: store.dayKey,
    dayStartEquityUsd: store.dayStartEquityUsd,
    equityUsd: store.equityUsd,
    dayLossPct: store.dayLossPct,
    runningPeakUsd: store.runningPeakUsd,
    peakAt: store.peakAt,
    drawdownFromPeakPct: store.drawdownFromPeakPct,
    halted: store.halted ? { ...store.halted } : null,
    venues: { ...store.venues },
    unobservable: [...store.unobservable]
  }
}

export function storeHealth() {
  return { ...aggregateStoreHealth }
}

export function resetRiskState() {
  store = null
  aggregateStoreHealth = { ok: true }
}