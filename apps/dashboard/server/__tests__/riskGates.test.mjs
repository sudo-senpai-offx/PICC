// WS-2 T2 — risk gates 16-19 (AC-2/AC-5/AC-6, R1.5, R2.3-R2.5, R3, §3.3, §3.8):
// day-loss aggregate null→deny + trip to the T4 seam, MDD size-step/hard-stop
// + cross-day latch, portfolio heat with named sources, env invalid→named deny.
import { beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  evaluateRiskGate,
  portfolioHeatUsd,
  RISK_GATE_ORDER
} from "../services/commandCentre/riskGates.mjs"
import { aggregateRiskState, resetRiskState } from "../services/commandCentre/riskState.mjs"
import { _resetHaltStore, haltSnapshot } from "../services/commandCentre/riskHaltStore.mjs"
import { _resetSidecarState } from "../services/commandCentre/safetySidecar.mjs"
import { _resetAuditTrail } from "../services/commandCentre/auditTrail.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"
import { dayKeyOf } from "../services/u4faRisk.mjs"

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0)
const NEXT_DAY = Date.UTC(2026, 8, 23, 12, 0, 0)
const at = (t) => new Date(t).toISOString()

const template = { site: "trading:ccxt", envKeyValue: "PICC_RISK_AGGREGATE_DAILY_LOSS_PCT", envelope: { maxExposureUsd: 10 } }
const heatSources = ["ccxt-perps-positions.json", "audit:proposalOrdersFromAudit"]

function greenProposal(overrides = {}) {
  return {
    action: "ccxt:spot-order",
    live: true,
    power: "proposals",
    consentBy: "tester",
    exposureUsd: 5,
    exposureCapUsd: 10,
    rationale: "verified trend + entry within stop budget (risk gates green)",
    idempotencyKey: `risk-gate-${Math.random().toString(36).slice(2)}`,
    ...overrides
  }
}

function greenSidecarProposal(overrides = {}) {
  return {
    action: "ccxt:limit-buy",
    live: true,
    exposureUsd: 5,
    rationale: "verified trend + entry within stop budget (deterministic gates green)",
    idempotencyKey: `sidecar-${Math.random().toString(36).slice(2)}`,
    ...overrides
  }
}

function greenSidecarState(overrides = {}) {
  return {
    killSwitch: false,
    optIn: true,
    breakers: { dailyLossHalted: false, regimeHalted: false, siteCapped: false },
    staleFeeds: [],
    concurrentUnits: 0,
    dayLossPct: 0,
    now: Date.now(),
    ...overrides
  }
}

function synthAggregate(overrides = {}) {
  return {
    dayKey: "2026-09-22",
    dayStartEquityUsd: 100,
    equityUsd: 100,
    dayLossPct: 0,
    runningPeakUsd: 100,
    peakAt: at(NOW),
    drawdownFromPeakPct: 0,
    halted: null,
    fresh: true,
    ...overrides
  }
}

const heatOf = (usd, extra = {}) => ({ usd, perpsMarginUsd: null, spotNotionalUsd: null, sources: heatSources, reason: null, ...extra })

function observationFor(aggregate = synthAggregate(), heat = heatOf(10)) {
  return { risk: { ok: true, aggregate, venues: {}, unobservable: [] }, heat }
}

function collectAudit() {
  const events = []
  const audit = (e) => events.push(e)
  return { events, audit }
}

function spotVenue(equityUsd, dayStartEquityUsd, dayKey = "2026-09-22", t = NOW) {
  return { exchange: "hyperliquid", dayKey, at: at(t), equityUsd, dayStartEquityUsd }
}

function perpsVenue(equityUsd, dayStartEquityUsd, dayKey = "2026-09-22", t = NOW) {
  return {
    version: 1,
    equityUsd,
    equityAt: at(t),
    runningPeakUsd: equityUsd,
    peakAt: at(t),
    drawdownFromPeakPct: 0,
    dayKey,
    dayStartEquityUsd,
    dayLossPct: 0,
    halted: null
  }
}

function writeVenues(dir, { spot = spotVenue(18.86, 18.86), perps = perpsVenue(8.26, 10.0), positions = null } = {}) {
  writeFileSync(join(dir, "ccxt-equity.json"), JSON.stringify({ hyperliquid: spot }, null, 2), "utf8")
  writeFileSync(join(dir, "ccxt-perps-risk.json"), JSON.stringify(perps, null, 2), "utf8")
  if (positions) writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions }, null, 2), "utf8")
}

const spotAuditProposal = (key, notionalUsd) => ({
  kind: "proposal:created",
  at: at(NOW),
  data: { idempotencyKey: key, clientOrderId: key, exchange: "hyperliquid", symbol: "BTC/USDC", side: "buy", amount: 1, price: 10, notionalUsd, rationale: "x", consentBy: "tester" }
})
const spotAuditExecuted = (key) => ({ kind: "execution:executed", at: at(NOW), data: { idempotencyKey: `${key}:exec` } })
const spotAuditFilled = (key) => ({ kind: "ccxt-verify:filled", at: at(NOW), data: { idempotencyKey: key } })

async function withDisk(fn) {
  const dir = mkdtempSync(join(tmpdir(), "picc-riskgates-"))
  const envKey = "PICC_COMMAND_CENTRE_DATA_DIR"
  const prior = process.env[envKey]
  process.env[envKey] = dir
  try {
    vi.resetModules()
    const riskState = await import("../services/commandCentre/riskState.mjs")
    const gates = await import("../services/commandCentre/riskGates.mjs")
    const sidecar = await import("../services/commandCentre/safetySidecar.mjs")
    const haltStore = await import("../services/commandCentre/riskHaltStore.mjs")
    return await fn({ dir, riskState, gates, sidecar, haltStore })
  } finally {
    if (prior === undefined) delete process.env[envKey]
    else process.env[envKey] = prior
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  }
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("PICC_RISK_")) delete process.env[k]
  }
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  resetRiskState()
  _resetHaltStore()
  _resetSidecarState()
  _resetAuditTrail()
})

test("RISK_GATE_ORDER is the fixed 16→19 sequence", () => {
  expect(RISK_GATE_ORDER).toEqual([
    "risk-day-loss-aggregate",
    "risk-mdd-size-step",
    "risk-mdd-hard-stop",
    "risk-portfolio-heat"
  ])
})

describe("gate 16 risk-day-loss-aggregate (AC-2 / R1.5)", () => {
  test("aggregate dayLoss > 5 denies and trips via riskHaltStore (audit: deny + halt:trip)", () => {
    const { events, audit } = collectAudit()
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal({ action: "perps:open-order" }),
      observation: observationFor(synthAggregate({ dayLossPct: 6.03 })),
      audit,
      now: NOW
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.reason).toContain("6.03")
    expect(r.reason).toContain("PICC_RISK_AGGREGATE_DAILY_LOSS_PCT")
    const deny = events.find((e) => e.kind === "safety-gate:deny")
    expect(deny.data.blockedBy).toBe("risk-day-loss-aggregate")
    expect(events.some((e) => e.kind === "halt:trip" && e.data.breaker === "dailyLoss")).toBe(true)
  })

  test("the env ceiling (PICC_RISK_AGGREGATE_DAILY_LOSS_PCT) is honored at call time", () => {
    process.env.PICC_RISK_AGGREGATE_DAILY_LOSS_PCT = "3"
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal(),
      observation: observationFor(synthAggregate({ dayLossPct: 4 }))
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.reason).toContain("3")
  })

  test("a null aggregate denies un-evaluable naming the venue — never passes", () => {
    const observation = {
      risk: { ok: false, aggregate: null, venues: {}, unobservable: [{ venue: "hyperliquid:spot", reason: "stale: hyperliquid:spot last observed ..." }], reason: "stale: hyperliquid:spot last observed ..." },
      heat: heatOf(10)
    }
    const r = evaluateRiskGate({ template, proposal: greenProposal(), observation })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.reason).toContain("un-evaluable")
    expect(r.reason).toContain("hyperliquid:spot")
  })

  test("a null dayLossPct on a fresh aggregate denies (the null→deny flip gate-8 would pass)", () => {
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal(),
      observation: observationFor(synthAggregate({ dayLossPct: null }))
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.reason).toContain("un-evaluable")
  })

  test("fresh !== true denies un-evaluable even with a numeric dayLossPct", () => {
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal(),
      observation: observationFor(synthAggregate({ dayLossPct: 1, fresh: false }))
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.reason).toContain("un-evaluable")
  })

  test("an invalid PICC_RISK_AGGREGATE_DAILY_LOSS_PCT is a named invalid-environment deny", () => {
    process.env.PICC_RISK_AGGREGATE_DAILY_LOSS_PCT = "banana"
    const r = evaluateRiskGate({ template, proposal: greenProposal(), observation: observationFor() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.reason).toContain("invalid-environment")
    expect(r.reason).toContain("PICC_RISK_AGGREGATE_DAILY_LOSS_PCT")
  })
})

describe("gate 16's trip reaches the T4 seam (AC-3 / R1.5)", () => {
  test("day-loss deny persists command-centre-halt.json AND seeds the sidecar globalHalt, gate 2 re-blocks", async () => {
    await withDisk(async ({ dir, riskState, gates, sidecar, haltStore }) => {
      writeVenues(dir, { spot: spotVenue(18.86, 18.86), perps: perpsVenue(8.26, 10.0) })
      const refresh = await riskState.refreshAggregateRisk({ now: NOW })
      expect(refresh.ok).toBe(true)
      expect(refresh.aggregate.dayLossPct).toBe(6.03)

      const { events, audit } = collectAudit()
      const r = gates.evaluateRiskGate({
        template,
        proposal: greenProposal(),
        observation: { risk: refresh, heat: heatOf(10) },
        audit,
        now: NOW
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("risk-day-loss-aggregate")

      const persisted = JSON.parse(readFileSync(join(dir, "command-centre-halt.json"), "utf8"))
      expect(persisted.version).toBe(1)
      expect(persisted.globalHalt).toMatchObject({ dayKey: dayKeyOf(NOW), site: "trading", breaker: "dailyLoss", at: NOW })
      expect(persisted.takeover).toBeNull()
      expect(sidecar.crossSiteHaltState()).toEqual(persisted.globalHalt)
      expect(haltStore.haltSnapshot().globalHalt).toEqual(persisted.globalHalt)

      const gate2 = sidecar.evaluateGate({ template: templateForSite("trading:ccxt"), proposal: greenSidecarProposal(), state: greenSidecarState() })
      expect(gate2.allow).toBe(false)
      expect(gate2.blockedBy).toBe("cross-site-day-halt")

      expect(events.some((e) => e.kind === "halt:trip" && e.data.breaker === "dailyLoss")).toBe(true)
    })
  })
})

describe("gate 17 risk-mdd-size-step (AC-5 / R2.3)", () => {
  test("drawdown in [10,15): over-ceiling exposure denied (visible mddAdjusted)", () => {
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal({ exposureUsd: 8 }),
      observation: observationFor(synthAggregate({ drawdownFromPeakPct: 12 }))
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-mdd-size-step")
    expect(r.reason).toContain("12")
    expect(r.reason).toContain("mddAdjusted")
    expect(r.reason).toContain("sizeStepFactor 0.5")
  })

  test("drawdown in [10,15): at/below-ceiling exposure allowed, sizeStepFactor surfaced, mddAdjusted visible", () => {
    const { events, audit } = collectAudit()
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal({ exposureUsd: 5 }),
      observation: observationFor(synthAggregate({ drawdownFromPeakPct: 12 })),
      audit
    })
    expect(r.allow).toBe(true)
    expect(r.blockedBy).toBeNull()
    expect(r.mddAdjusted).toBe(true)
    expect(r.sizeStepFactor).toBe(0.5)
    expect(r.ceilingUsd).toBe(5)
    expect(r.capUsd).toBe(10)
    expect(r.reason).toContain("mddAdjusted")
    expect(events.find((e) => e.kind === "safety-gate:allow").data.mddAdjusted).toBe(true)
  })

  test("reduce-only closes pass the step zone without being size-capped (no trap)", () => {
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal({ action: "perps:close-order", reduceOnly: true, exposureUsd: 9 }),
      observation: observationFor(synthAggregate({ drawdownFromPeakPct: 12 }))
    })
    expect(r.allow).toBe(true)
    expect(r.mddAdjusted).toBeUndefined()
  })

  test("drawdown below the step trip passes untouched (no adjustment, no deny)", () => {
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal(),
      observation: observationFor(synthAggregate({ drawdownFromPeakPct: 9 }))
    })
    expect(r.allow).toBe(true)
    expect(r.mddAdjusted).toBeUndefined()
  })

  test("an invalid PICC_RISK_MDD_SIZE_STEP_FACTOR is a named invalid-environment deny", () => {
    process.env.PICC_RISK_MDD_SIZE_STEP_FACTOR = "3"
    const r = evaluateRiskGate({
      template,
      proposal: greenProposal(),
      observation: observationFor(synthAggregate({ drawdownFromPeakPct: 12 }))
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-mdd-size-step")
    expect(r.reason).toContain("invalid-environment")
    expect(r.reason).toContain("PICC_RISK_MDD_SIZE_STEP_FACTOR")
  })
})

describe("gate 18 risk-mdd-hard-stop (AC-5 / R2.4, R2.5 / risk 3)", () => {
  test("drawdown >= 15 denies an open and trips the cross-day aggregate latch", async () => {
    await withDisk(async ({ dir, riskState, gates }) => {
      writeVenues(dir, { spot: spotVenue(60, 60), perps: perpsVenue(40, 40) })
      await riskState.refreshAggregateRisk({ now: NOW })
      writeVenues(dir, { spot: spotVenue(40, 40), perps: perpsVenue(30, 30) })
      const refresh = await riskState.refreshAggregateRisk({ now: NOW + 60_000 })
      expect(refresh.aggregate.dayLossPct).toBe(0)
      expect(refresh.aggregate.drawdownFromPeakPct).toBe(30)

      const r = gates.evaluateRiskGate({
        template,
        proposal: greenProposal({ action: "perps:open-order" }),
        observation: { risk: refresh, heat: heatOf(10) },
        now: NOW + 60_000
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("risk-mdd-hard-stop")
      expect(r.reason).toContain("30")
      expect(riskState.aggregateRiskState().halted).toMatchObject({ trip: "drawdown" })
    })
  })

  test("the active latch denies opens below 15, and reduce-only closes still pass", () => {
    const aggregate = synthAggregate({ drawdownFromPeakPct: 14, halted: { trip: "drawdown", at: at(NOW), note: "latch" } })
    const open = evaluateRiskGate({ template, proposal: greenProposal(), observation: observationFor(aggregate) })
    expect(open.allow).toBe(false)
    expect(open.blockedBy).toBe("risk-mdd-hard-stop")
    expect(open.reason).toContain("latch")

    const close = evaluateRiskGate({
      template,
      proposal: greenProposal({ action: "perps:close-order", reduceOnly: true }),
      observation: observationFor(aggregate)
    })
    expect(close.allow).toBe(true)
  })

  test("the latch is cross-day: a trip before midnight stays blocking after midnight until a new peak", async () => {
    await withDisk(async ({ dir, riskState, gates }) => {
      writeVenues(dir, { spot: spotVenue(60, 60), perps: perpsVenue(40, 40) })
      await riskState.refreshAggregateRisk({ now: NOW })
      writeVenues(dir, { spot: spotVenue(40, 40), perps: perpsVenue(30, 30) })
      const tripped = await riskState.refreshAggregateRisk({ now: NOW + 60_000 })
      expect(tripped.aggregate.dayLossPct).toBe(0)
      expect(tripped.aggregate.drawdownFromPeakPct).toBe(30)
      const denyBeforeMidnight = gates.evaluateRiskGate({
        template,
        proposal: greenProposal({ action: "perps:open-order" }),
        observation: { risk: tripped, heat: heatOf(10) },
        now: NOW + 60_000
      })
      expect(denyBeforeMidnight.allow).toBe(false)
      expect(riskState.aggregateRiskState().halted).toMatchObject({ trip: "drawdown" })

      writeVenues(dir, {
        spot: spotVenue(40, 40, "2026-09-23", NEXT_DAY),
        perps: perpsVenue(30, 30, "2026-09-23", NEXT_DAY)
      })
      const afterMidnight = await riskState.refreshAggregateRisk({ now: NEXT_DAY })
      expect(afterMidnight.aggregate.dayKey).toBe("2026-09-23")
      expect(afterMidnight.aggregate.halted).toMatchObject({ trip: "drawdown" })
      const blockedAfterMidnight = gates.evaluateRiskGate({
        template,
        proposal: greenProposal({ action: "perps:open-order" }),
        observation: { risk: afterMidnight, heat: heatOf(10) },
        now: NEXT_DAY
      })
      expect(blockedAfterMidnight.allow).toBe(false)
      expect(blockedAfterMidnight.blockedBy).toBe("risk-mdd-hard-stop")

      writeVenues(dir, {
        spot: spotVenue(60, 40, "2026-09-23", NEXT_DAY + 60_000),
        perps: perpsVenue(40, 30, "2026-09-23", NEXT_DAY + 60_000)
      })
      const recovered = await riskState.refreshAggregateRisk({ now: NEXT_DAY + 60_000 })
      expect(recovered.aggregate.equityUsd).toBe(100)
      expect(recovered.aggregate.halted).toBeNull()
      const allowed = gates.evaluateRiskGate({
        template,
        proposal: greenProposal({ action: "perps:open-order" }),
        observation: { risk: recovered, heat: heatOf(10) },
        now: NEXT_DAY + 60_000
      })
      expect(allowed.allow).toBe(true)
    })
  })
})

describe("gate 19 risk-portfolio-heat + portfolioHeatUsd (AC-6 / R3)", () => {
  test("the builder sums perps margin + spot open notional; heat > cap denies with named sources", async () => {
    await withDisk(async ({ dir, gates }) => {
      writeVenues(dir, {
        positions: [
          { id: "p1", symbol: "BTC", side: "long", size: 1, entryPrice: 50, leverage: 5, marginUsd: 8, marginMode: "isolated", openedAt: at(NOW), openOrderId: "o1", source: "persisted" },
          { id: "p2", symbol: "ETH", side: "long", size: 1, entryPrice: 50, leverage: 5, marginUsd: 7, marginMode: "isolated", openedAt: at(NOW), openOrderId: "o2", source: "persisted" }
        ]
      })
      const audits = [
        spotAuditProposal("open-a", 10),
        spotAuditProposal("open-b", 10),
        spotAuditProposal("exec-c", 2),
        spotAuditExecuted("exec-c"),
        spotAuditProposal("filled-d", 50),
        spotAuditFilled("filled-d")
      ]
      const heat = portfolioHeatUsd({ audits, dataDir: dir })
      expect(heat.usd).toBe(37)
      expect(heat.perpsMarginUsd).toBe(15)
      expect(heat.spotNotionalUsd).toBe(22)
      expect(heat.sources).toEqual(["ccxt-perps-positions.json", "audit:proposalOrdersFromAudit"])

      const { events, audit } = collectAudit()
      const r = gates.evaluateRiskGate({
        template,
        proposal: greenProposal(),
        observation: { risk: { ok: true, aggregate: synthAggregate(), venues: {}, unobservable: [] }, heat },
        audit
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("risk-portfolio-heat")
      expect(r.reason).toContain("37")
      expect(r.reason).toContain("ccxt-perps-positions.json")
      expect(r.reason).toContain("audit:proposalOrdersFromAudit")
      expect(r.reason).toContain("perps margin $15")
      expect(r.reason).toContain("spot open notional $22")
      expect(events.find((e) => e.kind === "safety-gate:deny").data.blockedBy).toBe("risk-portfolio-heat")
    })
  })

  test("an unreadable perps source nulls the heat builder and the gate denies un-evaluable naming it", async () => {
    await withDisk(async ({ dir, gates }) => {
      const heat = portfolioHeatUsd({ audits: [spotAuditProposal("open-a", 10)], dataDir: dir })
      expect(heat.usd).toBeNull()
      expect(heat.reason).toContain("ccxt-perps-positions.json")
      const r = gates.evaluateRiskGate({
        template,
        proposal: greenProposal(),
        observation: { risk: { ok: true, aggregate: synthAggregate(), venues: {}, unobservable: [] }, heat }
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("risk-portfolio-heat")
      expect(r.reason).toContain("un-evaluable")
      expect(r.reason).toContain("ccxt-perps-positions.json")
    })
  })

  test("an unreadable audit source nulls the heat builder and the gate denies un-evaluable naming it", async () => {
    await withDisk(async ({ dir, gates }) => {
      writeVenues(dir, { positions: [{ id: "p1", symbol: "BTC", side: "long", size: 1, entryPrice: 50, leverage: 5, marginUsd: 8, marginMode: "isolated", openedAt: at(NOW), openOrderId: "o1", source: "persisted" }] })
      const heat = portfolioHeatUsd({ audits: null, dataDir: dir })
      expect(heat.usd).toBeNull()
      expect(heat.reason).toContain("audit:proposalOrdersFromAudit")
      const r = gates.evaluateRiskGate({
        template,
        proposal: greenProposal(),
        observation: { risk: { ok: true, aggregate: synthAggregate(), venues: {}, unobservable: [] }, heat }
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("risk-portfolio-heat")
      expect(r.reason).toContain("un-evaluable")
      expect(r.reason).toContain("audit:proposalOrdersFromAudit")
    })
  })

  test("heat at or below the cap passes", () => {
    const r = evaluateRiskGate({ template, proposal: greenProposal(), observation: observationFor(synthAggregate(), heatOf(20)) })
    expect(r.allow).toBe(true)
  })

  test("an invalid PICC_RISK_PORTFOLIO_HEAT_CAP_USD is a named invalid-environment deny", () => {
    process.env.PICC_RISK_PORTFOLIO_HEAT_CAP_USD = "not-a-number"
    const r = evaluateRiskGate({ template, proposal: greenProposal(), observation: observationFor() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-portfolio-heat")
    expect(r.reason).toContain("invalid-environment")
    expect(r.reason).toContain("PICC_RISK_PORTFOLIO_HEAT_CAP_USD")
  })
})

describe("gate order + full passes", () => {
  test("the fixed order is enforced: a heat breach is the binding deny when 16-18 are green", () => {
    const r = evaluateRiskGate({ template, proposal: greenProposal(), observation: observationFor(synthAggregate(), heatOf(40)) })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("risk-portfolio-heat")
  })

  test("all gates green → allow, audited safety-gate:allow, no adjustment fields", () => {
    const { events, audit } = collectAudit()
    const r = evaluateRiskGate({ template, proposal: greenProposal(), observation: observationFor(), audit })
    expect(r.allow).toBe(true)
    expect(r.blockedBy).toBeNull()
    expect(r.mddAdjusted).toBeUndefined()
    const allow = events.find((e) => e.kind === "safety-gate:allow")
    expect(allow).toBeTruthy()
    expect(allow.site).toBe("trading:ccxt")
    expect(allow.data.blockedBy).toBeNull()
  })
})

describe("portfolioHeatUsd edge honesty", () => {
  test("a corrupted positions file is an unreadable perps source, never a silent 0", async () => {
    await withDisk(async ({ dir, gates }) => {
      writeFileSync(join(dir, "ccxt-perps-positions.json"), "{ not json", "utf8")
      const heat = portfolioHeatUsd({ audits: [], dataDir: dir })
      expect(heat.usd).toBeNull()
      expect(heat.reason).toContain("ccxt-perps-positions.json")
      const r = gates.evaluateRiskGate({
        template,
        proposal: greenProposal(),
        observation: { risk: { ok: true, aggregate: synthAggregate(), venues: {}, unobservable: [] }, heat }
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("risk-portfolio-heat")
      expect(r.reason).toContain("un-evaluable")
    })
  })
})