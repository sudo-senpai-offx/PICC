// WS-2 risk rail wiring (T3): the committed gate family 16-19 is composed into
// BOTH proposal rails (ccxt spot + hyperliquid perps) at propose AND click, and
// the reduce-only close keeps its escape hatch. The rails are FED: every test
// injects the risk observation (green / day-loss / step-zone / hard-stop / heat)
// so the rail never touches stores — except the dedicated withDisk tests that
// resolve the REAL refreshAggregateRisk/portfolioHeatUsd path against a temp
// data dir mirroring how the handlers observe at request time.
//
// First-deny semantics under test: a risk deny at propose never records
// proposal:created; a risk deny at click never reaches the venue; the response
// carries `riskGate` and the first-deny gate is `gate`.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { proposeCcxtOrder, executeCcxtOrder } from "../services/commandCentre/ccxtExecution.mjs"
import {
  proposePerpsOpen,
  executePerpsOpen,
  executePerpsClose,
  PERPS_OPEN_ACTION
} from "../services/commandCentre/perpsExecution.mjs"
import { _resetSidecarState } from "../services/commandCentre/safetySidecar.mjs"
import { _resetExecutionState } from "../services/commandCentre/commandCentreExecution.mjs"
import { _resetHaltStore } from "../services/commandCentre/riskHaltStore.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"
import { dayKeyOf } from "../services/u4faRisk.mjs"

const ccxtTemplate = () => templateForSite("trading:ccxt")
const perpsTemplate = () => templateForSite("trading:perps")

// ---- risk observation fixtures (the shapes refreshAggregateRisk /
// portfolioHeatUsd return — injected here so the rails don't touch stores) ----

const AGG_BASE = {
  dayKey: "2026-09-22",
  dayStartEquityUsd: 100,
  equityUsd: 100,
  dayLossPct: 0,
  runningPeakUsd: 100,
  peakAt: null,
  drawdownFromPeakPct: null,
  halted: null,
  fresh: true
}

function aggregate(overrides = {}) {
  return { ...AGG_BASE, ...overrides }
}

function riskOf(aggregate) {
  return { ok: true, aggregate, venues: {}, unobservable: [] }
}

function heatOf(usd, extra = {}) {
  return {
    usd,
    perpsMarginUsd: 0,
    spotNotionalUsd: 0,
    sources: ["ccxt-perps-positions.json", "audit:proposalOrdersFromAudit"],
    reason: null,
    ...extra
  }
}

const greenObservation = () => ({ risk: riskOf(aggregate()), heat: heatOf(0) })
const losingObservation = () =>
  ({ risk: riskOf(aggregate({ dayLossPct: 6.03, equityUsd: 93.97 })), heat: heatOf(0) })
const stepZoneObservation = (dd = 12) =>
  ({ risk: riskOf(aggregate({ drawdownFromPeakPct: dd, equityUsd: 88, runningPeakUsd: 100, peakAt: "2026-09-22T10:00:00.000Z" })), heat: heatOf(0) })
const hardStopObservation = () =>
  ({ risk: riskOf(aggregate({ drawdownFromPeakPct: 20, equityUsd: 80, runningPeakUsd: 100, peakAt: "2026-09-22T10:00:00.000Z" })), heat: heatOf(0) })
const unobservableObservation = () =>
  ({ risk: { ok: false, aggregate: null, venues: {}, unobservable: [{ venue: "hyperliquid:perps", reason: "ccxt-perps-risk-store-unreadable: missing" }], reason: "ccxt-perps-risk-store-unreadable: missing" }, heat: heatOf(0) })
const heatObservation = (usd) => ({ risk: riskOf(aggregate()), heat: heatOf(usd) })

const spotOrder = {
  exchange: "binance",
  symbol: "BTC/USDT",
  side: "buy",
  amount: 0.01,
  price: 1000,
  consentBy: "usr_owner_01"
}

const perpsOrder = {
  exchange: "hyperliquid",
  symbol: "BTC/USDT",
  side: "buy",
  amount: 0.01,
  price: 1000,
  leverage: 4,
  marginMode: "isolated",
  consentBy: "usr_owner_01"
}

const perpsObservation = (risk = riskOf(aggregate()), heat = heatOf(0), extra = {}) => ({
  leverage: 4,
  notionalUsd: 40,
  marginMode: "isolated",
  openNetPositions: 0,
  funding: { rate: 0.0001, at: Date.now() - 60_000 },
  risk,
  heat,
  ...extra
})

const position = {
  id: "pos-1",
  symbol: "BTC/USDT",
  side: "long",
  size: 0.01,
  entryPrice: 1000,
  leverage: 4,
  marginUsd: 2.5,
  marginMode: "isolated",
  openedAt: new Date(Date.now() - 60_000).toISOString(),
  openOrderId: "venue-1",
  source: "persisted"
}

function greenState(overrides = {}) {
  return {
    killSwitch: false,
    optIn: false,
    breakers: { dailyLossHalted: false, regimeHalted: false, siteCapped: false },
    staleFeeds: [],
    concurrentUnits: 0,
    dayLossPct: 0,
    ...overrides
  }
}

let auditEvents = []
const collector = () => (e) => {
  auditEvents.push(e)
}

beforeEach(() => {
  auditEvents = []
  _resetSidecarState()
  _resetExecutionState()
  _resetHaltStore()
})

describe("WS-2 risk rail wiring — trading:ccxt (spot)", () => {
  test("a green propose composes the risk gate: sidecar allow, risk allow, then proposal:created", async () => {
    const r = await proposeCcxtOrder({
      ...spotOrder,
      state: greenState({ riskObservation: greenObservation() }),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.gate.allow).toBe(true)
    expect(r.riskGate.allow).toBe(true)
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "safety-gate:allow", "proposal:created"])
  })

  test("an aggregate day loss over the ceiling denies at PROPOSE — no proposal:created", async () => {
    const r = await proposeCcxtOrder({
      ...spotOrder,
      state: greenState({ riskObservation: losingObservation() }),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate).toBe(r.riskGate)
    expect(r.gate.blockedBy).toBe("risk-day-loss-aggregate")
    // the day-loss trip writes its halt anchor (halt:trip) before the risk deny
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "halt:trip", "safety-gate:deny"])
    expect(auditEvents.some((e) => e.kind === "proposal:created")).toBe(false)
  })

  test("an aggregate day loss over the ceiling denies at CLICK — the venue is never reached", async () => {
    const calls = []
    const r = await executeCcxtOrder({
      ...spotOrder,
      state: greenState({ riskObservation: losingObservation() }),
      executor: async () => {
        calls.push(1)
        return { ok: true }
      },
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate).toBe(r.riskGate)
    expect(r.gate.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.execution).toBeNull()
    expect(calls).toEqual([])
  })

  test("an unobservable aggregate denies — fail-closed, nothing is assumed", async () => {
    const r = await proposeCcxtOrder({
      ...spotOrder,
      state: greenState({ riskObservation: unobservableObservation() }),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.gate.reason).toContain("un-evaluable")
  })

  test("portfolio heat over the cap denies at CLICK even on a green aggregate (gates 16-18 pass, gate 19 blocks)", async () => {
    const calls = []
    const r = await executeCcxtOrder({
      ...spotOrder,
      amount: 0.005,
      state: greenState({ riskObservation: heatObservation(31) }),
      executor: async () => {
        calls.push(1)
        return { ok: true }
      },
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("risk-portfolio-heat")
    expect(r.execution).toBeNull()
    expect(calls).toEqual([])
  })

  test("a step-zone drawdown adjusts the request: in-cap exposure passes with mddAdjusted surfaced", async () => {
    const r = await proposeCcxtOrder({
      ...spotOrder,
      amount: 0.005, // notional $5 = the $10 cap × 0.5 — INSIDE the step ceiling
      state: greenState({ riskObservation: stepZoneObservation(12) }),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.riskGate.allow).toBe(true)
    expect(r.riskGate.mddAdjusted).toBe(true)
    expect(r.riskGate.sizeStepFactor).toBe(0.5)
  })

  test("a step-zone drawdown denies exposure ABOVE the halved ceiling (risk-mdd-size-step)", async () => {
    const r = await proposeCcxtOrder({
      ...spotOrder, // notional $10 = the cap — ABOVE the $5 step ceiling
      state: greenState({ riskObservation: stepZoneObservation(12) }),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("risk-mdd-size-step")
    expect(r.gate.reason).toContain("mddAdjusted")
  })
})

describe("WS-2 risk rail wiring — trading:perps", () => {
  test("a green propose composes the risk gate AFTER the perps 5 allow", async () => {
    const r = await proposePerpsOpen({
      ...perpsOrder,
      state: greenState(),
      observation: perpsObservation(),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.riskGate.allow).toBe(true)
    expect(auditEvents.map((e) => e.kind)).toEqual([
      "safety-gate:allow",
      "safety-gate:allow",
      "safety-gate:allow",
      "proposal:created"
    ])
  })

  test("an aggregate day loss over the ceiling denies at perps PROPOSE — the response names the risk gate first", async () => {
    const r = await proposePerpsOpen({
      ...perpsOrder,
      state: greenState(),
      observation: perpsObservation(losingObservation().risk),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.riskGate.allow).toBe(false)
    expect(r.gate).toBe(r.riskGate)
    expect(r.gate.blockedBy).toBe("risk-day-loss-aggregate")
    expect(auditEvents.some((e) => e.kind === "proposal:created")).toBe(false)
  })

  test("a reduce-only close passes through the hard-stop drawdown while a NEW open is denied", async () => {
    const opened = await executePerpsOpen({
      ...perpsOrder,
      clientOrderId: "picc-wire-open",
      state: greenState(),
      observation: perpsObservation(hardStopObservation().risk),
      template: perpsTemplate(),
      executor: async () => ({ ok: true }),
      audit: collector()
    })
    expect(opened.ok).toBe(false)
    expect(opened.gate.blockedBy).toBe("risk-mdd-hard-stop")
    expect(opened.execution).toBeNull()

    const closed = await executePerpsClose({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      positionId: position.id,
      price: 1010,
      consentBy: perpsOrder.consentBy,
      position,
      state: greenState(),
      observation: perpsObservation(hardStopObservation().risk, heatOf(0), { openNetPositions: 1 }),
      submit: async () => ({ ok: true }),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(closed.ok).toBe(true)
    expect(closed.riskGate.allow).toBe(true)
  })
})

describe("WS-2 risk rail wiring — withDisk: the rails resolve the REAL risk stores against a temp data dir", () => {
  let dir
  const ENV = "PICC_COMMAND_CENTRE_DATA_DIR"

  function seedGreenStores({ perps = { equityUsd: 8.26, dayStartEquityUsd: 10.0 } } = {}) {
    const now = Date.now()
    const dayKey = dayKeyOf(now)
    const at = new Date(now - 1000).toISOString()
    writeFileSync(
      join(dir, "ccxt-equity.json"),
      JSON.stringify({ binance: { exchange: "binance", dayKey, at, equityUsd: 18.86, dayStartEquityUsd: 18.86 } })
    )
    writeFileSync(
      join(dir, "ccxt-perps-risk.json"),
      JSON.stringify({ version: 1, exchange: "hyperliquid", dayKey, equityAt: at, ...perps })
    )
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [] }))
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-risk-wire-"))
  })

  afterEach(() => {
    delete process.env[ENV]
    rmSync(dir, { recursive: true, force: true })
  })

  test("spot execute resolves the aggregate from the temp stores and denies at 6.03% aggregate day loss", async () => {
    seedGreenStores()
    process.env[ENV] = dir
    vi.resetModules()
    const ccx = await import("../services/commandCentre/ccxtExecution.mjs")
    const calls = []
    const r = await ccx.executeCcxtOrder({
      ...spotOrder,
      state: greenState(), // NO injected observation — the rail resolves the stores itself
      executor: async () => {
        calls.push(1)
        return { ok: true }
      },
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("risk-day-loss-aggregate")
    expect(r.gate.reason).toContain("6.03")
    expect(calls).toEqual([])
  })

  test("perps propose resolves the aggregate from the temp stores and denies at 6.03% aggregate day loss", async () => {
    seedGreenStores()
    process.env[ENV] = dir
    vi.resetModules()
    const p = await import("../services/commandCentre/perpsExecution.mjs")
    const r = await p.proposePerpsOpen({
      ...perpsOrder,
      state: greenState(),
      // a raw observation WITHOUT risk/heat — the perps rail falls back to the
      // real store resolution (mirrors how the handlers observe at request time)
      observation: {
        leverage: 4,
        notionalUsd: 40,
        marginMode: "isolated",
        openNetPositions: 0,
        funding: { rate: 0.0001, at: Date.now() - 60_000 }
      },
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.riskGate.allow).toBe(false)
    expect(r.gate).toBe(r.riskGate)
    expect(r.gate.blockedBy).toBe("risk-day-loss-aggregate")
    expect(auditEvents.some((e) => e.kind === "proposal:created")).toBe(false)
  })
})