import { afterEach, expect, test, vi } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const AGGREGATE_FILE = "ccxt-risk-aggregate.json"
const SPOT_FILE = "ccxt-equity.json"
const PERPS_FILE = "ccxt-perps-risk.json"

let dir = null

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0)
const NEXT_DAY = Date.UTC(2026, 8, 23, 12, 0, 0)
const at = (t) => new Date(t).toISOString()

function spotVenue({ exchange = "hyperliquid", equityUsd, dayStartEquityUsd, dayKey = "2026-09-22", t = NOW } = {}) {
  return { exchange, dayKey, at: at(t), equityUsd, dayStartEquityUsd }
}

function perpsVenue({ equityUsd, dayStartEquityUsd, dayKey = "2026-09-22", t = NOW, runningPeakUsd = equityUsd } = {}) {
  return {
    version: 1,
    equityUsd,
    equityAt: at(t),
    runningPeakUsd,
    peakAt: at(t),
    drawdownFromPeakPct: 0,
    dayKey,
    dayStartEquityUsd,
    dayLossPct: 0,
    halted: null
  }
}

async function writeVenues({ spot, perps }) {
  await writeFile(join(dir, SPOT_FILE), JSON.stringify({ hyperliquid: spot }, null, 2))
  await writeFile(join(dir, PERPS_FILE), JSON.stringify(perps, null, 2))
}

async function boot() {
  dir = await mkdtemp(join(tmpdir(), "picc-riskstate-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  vi.resetModules()
  return import("../services/commandCentre/riskState.mjs")
}

async function restart() {
  vi.resetModules()
  return import("../services/commandCentre/riskState.mjs")
}

afterEach(async () => {
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  delete process.env.PICC_RISK_AGGREGATE_STALE_MS
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  vi.resetModules()
})

test("AC-1 SUM aggregation: dayLossPct = (ΣdayStart − Σequity)/ΣdayStart × 100", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }),
    perps: perpsVenue({ equityUsd: 8.26, dayStartEquityUsd: 10.0 })
  })
  const r = await m.refreshAggregateRisk({ now: NOW })
  expect(r.ok).toBe(true)
  expect(r.aggregate).toMatchObject({
    dayKey: "2026-09-22",
    dayStartEquityUsd: 28.86,
    equityUsd: 27.12,
    dayLossPct: 6.03,
    fresh: true
  })
  expect(r.venues["hyperliquid:spot"].equityUsd).toBe(18.86)
  expect(r.venues["hyperliquid:perps"].equityUsd).toBe(8.26)
  expect(r.unobservable).toEqual([])
})

test("AC-1 rollover re-baselines: a new UTC day re-baselines to current equity, dayLossPct 0", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }),
    perps: perpsVenue({ equityUsd: 8.26, dayStartEquityUsd: 10.0 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  await writeVenues({
    spot: spotVenue({ equityUsd: 20, dayStartEquityUsd: 20, dayKey: "2026-09-23", t: NEXT_DAY }),
    perps: perpsVenue({ equityUsd: 10, dayStartEquityUsd: 10, dayKey: "2026-09-23", t: NEXT_DAY })
  })
  const r = await m.refreshAggregateRisk({ now: NEXT_DAY })
  expect(r.ok).toBe(true)
  expect(r.aggregate).toMatchObject({ dayKey: "2026-09-23", dayStartEquityUsd: 30, equityUsd: 30, dayLossPct: 0 })
})

test("AC-1 day losses never go negative: a profitable day reports dayLossPct 0", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }),
    perps: perpsVenue({ equityUsd: 8.26, dayStartEquityUsd: 10.0 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  await writeVenues({
    spot: spotVenue({ equityUsd: 25, dayStartEquityUsd: 18.86 }),
    perps: perpsVenue({ equityUsd: 12, dayStartEquityUsd: 10.0 })
  })
  const r = await m.refreshAggregateRisk({ now: NOW + 60_000 })
  expect(r.ok).toBe(true)
  expect(r.aggregate.dayLossPct).toBe(0)
})

test("AC-1 missing venue → aggregate null + a reason naming the venue", async () => {
  const m = await boot()
  await writeFile(join(dir, SPOT_FILE), JSON.stringify({ hyperliquid: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }) }, null, 2))
  const r = await m.refreshAggregateRisk({ now: NOW })
  expect(r.ok).toBe(false)
  expect(r.aggregate).toBe(null)
  expect(r.unobservable.some((u) => u.venue === "hyperliquid:perps")).toBe(true)
  expect(r.reason).toContain("hyperliquid:perps")
})

test("AC-1 every covered venue is present and labeled distinctly (spot never merges into perps)", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }),
    perps: perpsVenue({ equityUsd: 8.26, dayStartEquityUsd: 10.0 })
  })
  const r = await m.refreshAggregateRisk({ now: NOW })
  const labels = Object.keys(r.venues).sort()
  expect(labels).toEqual(["hyperliquid:perps", "hyperliquid:spot"])
  expect(r.venues["hyperliquid:spot"].source).toBe(SPOT_FILE)
  expect(r.venues["hyperliquid:perps"].source).toBe(PERPS_FILE)
  expect(r.aggregate.equityUsd).toBeCloseTo(r.venues["hyperliquid:spot"].equityUsd + r.venues["hyperliquid:perps"].equityUsd, 5)
})

test("AC-1 a stale venue nulls the aggregate with a named reason (freshness window)", async () => {
  const m = await boot()
  process.env.PICC_RISK_AGGREGATE_STALE_MS = "60000"
  await writeVenues({
    spot: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86, t: NOW - 120_000 }),
    perps: perpsVenue({ equityUsd: 8.26, dayStartEquityUsd: 10.0, t: NOW - 120_000 })
  })
  const r = await m.refreshAggregateRisk({ now: NOW })
  expect(r.ok).toBe(false)
  expect(r.aggregate).toBe(null)
  expect(r.unobservable.length).toBeGreaterThan(0)
  expect(r.reason).toMatch(/stale: hyperliquid:(spot|perps)/)
})

test("AC-1 invalid PICC_RISK_AGGREGATE_STALE_MS is treated as unavailable (deny, never fallback)", async () => {
  const m = await boot()
  process.env.PICC_RISK_AGGREGATE_STALE_MS = "not-a-number"
  await writeVenues({
    spot: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }),
    perps: perpsVenue({ equityUsd: 8.26, dayStartEquityUsd: 10.0 })
  })
  const r = await m.refreshAggregateRisk({ now: NOW })
  expect(r.ok).toBe(false)
  expect(r.aggregate).toBe(null)
  expect(r.reason).toContain("invalid-environment")
})

test("AC-1 corrupted perps store nulls the aggregate naming the venue and keeps nothing partial", async () => {
  const m = await boot()
  await writeFile(join(dir, SPOT_FILE), JSON.stringify({ hyperliquid: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }) }, null, 2))
  await writeFile(join(dir, PERPS_FILE), "{ this is not json")
  const r = await m.refreshAggregateRisk({ now: NOW })
  expect(r.ok).toBe(false)
  expect(r.aggregate).toBe(null)
  expect(r.unobservable.some((u) => u.venue === "hyperliquid:perps" && u.reason.includes("unreadable"))).toBe(true)
})

test("AC-4 one-way peak ratchet: 100 → 95 → 110 peaks once, never decreases", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 60, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  expect(m.aggregateRiskState().runningPeakUsd).toBe(100)
  expect(m.aggregateRiskState().drawdownFromPeakPct).toBe(0)

  await writeVenues({
    spot: spotVenue({ equityUsd: 55, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW + 60_000 })
  expect(m.aggregateRiskState().runningPeakUsd).toBe(100)
  expect(m.aggregateRiskState().drawdownFromPeakPct).toBe(5)

  await writeVenues({
    spot: spotVenue({ equityUsd: 70, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW + 120_000 })
  expect(m.aggregateRiskState().runningPeakUsd).toBe(110)
  expect(m.aggregateRiskState().drawdownFromPeakPct).toBe(0)

  await writeVenues({
    spot: spotVenue({ equityUsd: 50, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW + 180_000 })
  expect(m.aggregateRiskState().runningPeakUsd).toBe(110)
  expect(m.aggregateRiskState().drawdownFromPeakPct).toBe(18.18)
})

test("AC-4 a stale observation never moves the peak ratchet", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 60, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  expect(m.aggregateRiskState().runningPeakUsd).toBe(100)

  process.env.PICC_RISK_AGGREGATE_STALE_MS = "60000"
  await writeVenues({
    spot: spotVenue({ equityUsd: 80, dayStartEquityUsd: 60, t: NOW - 120_000 }),
    perps: perpsVenue({ equityUsd: 50, dayStartEquityUsd: 40, t: NOW - 120_000 })
  })
  const r = await m.refreshAggregateRisk({ now: NOW + 30_000 })
  expect(r.ok).toBe(false)
  expect(r.aggregate).toBe(null)
  expect(m.aggregateRiskState().runningPeakUsd).toBe(100)
})

test("AC-4 fresh observation above peak still ratchets the peak higher", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 60, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  await writeVenues({
    spot: spotVenue({ equityUsd: 80, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 50, dayStartEquityUsd: 40 })
  })
  const r = await m.refreshAggregateRisk({ now: NOW + 60_000 })
  expect(r.ok).toBe(true)
  expect(r.aggregate.runningPeakUsd).toBe(130)
})

test("corrupted aggregate store file → UNHEALTHY, mutations refuse, file preserved", async () => {
  dir = await mkdtemp(join(tmpdir(), "picc-riskstate-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  const raw = "{\n  \"version\": 1,\n  \"dayKey\": \"2026-09-22\",\n  "
  await writeFile(join(dir, AGGREGATE_FILE), raw)
  vi.resetModules()
  const m = await import("../services/commandCentre/riskState.mjs")
  expect(m.storeHealth().ok).toBe(false)
  expect(m.storeHealth().reason).toBe("risk-aggregate-store-unreadable")
  const r = await m.refreshAggregateRisk({ now: NOW })
  expect(r.ok).toBe(false)
  expect(r.reason).toBe("risk-aggregate-store-unreadable")
  expect(() => m.haltForDrawdown({ note: "x", now: NOW })).toThrow(/risk-aggregate-store-unreadable/)
  expect(await readFile(join(dir, AGGREGATE_FILE), "utf8")).toBe(raw)
})

test("version-≠1 aggregate store file → UNHEALTHY version-mismatch, file preserved", async () => {
  dir = await mkdtemp(join(tmpdir(), "picc-riskstate-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  const raw = JSON.stringify({ version: 2, dayKey: "2026-09-22" }, null, 2)
  await writeFile(join(dir, AGGREGATE_FILE), raw)
  vi.resetModules()
  const m = await import("../services/commandCentre/riskState.mjs")
  expect(m.storeHealth().ok).toBe(false)
  expect(m.storeHealth().reason).toBe("risk-aggregate-store-version-mismatch")
  expect(() => m.haltForDrawdown({ note: "x", now: NOW })).toThrow(/risk-aggregate-store-version-mismatch/)
  expect(await readFile(join(dir, AGGREGATE_FILE), "utf8")).toBe(raw)
})

test("halted latch trips via haltForDrawdown, clears on a new peak, null on an equal-peak refresh", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 60, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  const latch = m.haltForDrawdown({ note: "test trip", now: NOW + 1_000 })
  expect(latch.trip).toBe("drawdown")
  expect(m.aggregateRiskState().halted).toMatchObject({ trip: "drawdown", note: "test trip" })

  await writeVenues({
    spot: spotVenue({ equityUsd: 55, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  const dipped = await m.refreshAggregateRisk({ now: NOW + 60_000 })
  expect(dipped.ok).toBe(true)
  expect(dipped.aggregate.halted).toMatchObject({ trip: "drawdown" })

  await writeVenues({
    spot: spotVenue({ equityUsd: 60, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  const recovered = await m.refreshAggregateRisk({ now: NOW + 120_000 })
  expect(recovered.ok).toBe(true)
  expect(recovered.aggregate.equityUsd).toBe(100)
  expect(recovered.aggregate.halted).toBe(null)
})

test("the halted latch and peak survive a restart from the persisted aggregate store", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 60, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  await writeVenues({
    spot: spotVenue({ equityUsd: 55, dayStartEquityUsd: 60 }),
    perps: perpsVenue({ equityUsd: 40, dayStartEquityUsd: 40 })
  })
  const dipped = await m.refreshAggregateRisk({ now: NOW + 60_000 })
  expect(dipped.aggregate.drawdownFromPeakPct).toBe(5)
  m.haltForDrawdown({ note: "hard stop", now: NOW + 90_000 })

  const m2 = await restart()
  expect(m2.aggregateRiskState().runningPeakUsd).toBe(100)
  expect(m2.aggregateRiskState().halted).toMatchObject({ trip: "drawdown", note: "hard stop" })
})

test("reset seam drops in-memory state and the store re-observes cleanly without touching live data", async () => {
  const m = await boot()
  await writeVenues({
    spot: spotVenue({ equityUsd: 18.86, dayStartEquityUsd: 18.86 }),
    perps: perpsVenue({ equityUsd: 8.26, dayStartEquityUsd: 10.0 })
  })
  await m.refreshAggregateRisk({ now: NOW })
  expect(m.aggregateRiskState()).not.toBe(null)
  m.resetRiskState()
  expect(m.aggregateRiskState()).toBe(null)
  const r = await m.refreshAggregateRisk({ now: NOW })
  expect(r.ok).toBe(true)
  expect(r.aggregate.dayLossPct).toBe(6.03)
})