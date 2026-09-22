// WS-2 (T8) no-regression seam guard — pins, at SOURCE level (real files read
// from disk; only safetySidecar.mjs is imported for its live exports), the
// WS-2 risk & drawdown enforcement contract (spec §8.2 / AC-10):
//   - every executor entry point (ccxtExecution, perpsExecution) evaluates the
//     risk gate on its own proposal/execute/close path — deny-before-venue.
//   - riskGates.mjs's aggregate day-loss trip is the production dailyLoss
//     producer and vines riskHaltStore.tripBreaker("trading", "dailyLoss");
//     the halt store persists to command-centre-halt.json under
//     PICC_COMMAND_CENTRE_DATA_DIR.
//   - the sidecar gate order is exactly the 10 documented entries and halt
//     persistence/hydration stay live exports (real wiring, not stubs).
//   - every rail-state observers block (spot + perps) exposes riskAggregate
//     and portfolioHeatUsd from the live risk feed (audited, not asserted).
//   - the consent payload-lock (T5): handlers.mjs runs consentDecision BEFORE
//     each executor (spot open, perps open, perps close), and the audited
//     consent:reconfirmed|denied kinds precede execution:executed, which is
//     emitted only by commandCentreExecution.mjs.
//   - PICC.md records the WS-2 land (registry row + methodology note).
//
// safetySidecar.mjs is safe to import: it performs no I/O at module init
// (state is in-memory until wireHaltPersistence wires disk handlers); every
// other module is read as source text, mirroring perpsSeamGuard.test.mjs.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { GATE_ORDER, hydrateHaltState, wireHaltPersistence } from "../services/commandCentre/safetySidecar.mjs"

const EXPECTED_SPOT_GATES = Object.freeze([
  "kill-switch",
  "cross-site-day-halt",
  "human-takeover",
  "per-site-opt-in",
  "hard-breakers",
  "fresh-data",
  "toS-survival",
  "envelope-within-ceiling",
  "rationale-renderable",
  "idempotent"
])

function source(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
}

describe("WS-2 risk & drawdown seam guard (T8 no-regression)", () => {
  it("ccxtExecution.mjs evaluates the risk gate on BOTH propose and execute paths", () => {
    const src = source("../services/commandCentre/ccxtExecution.mjs")
    expect(src).toContain('import { evaluateRiskGate, portfolioHeatUsd } from "./riskGates.mjs"')
    const proposeStart = src.indexOf("export async function proposeCcxtOrder(")
    const executeStart = src.indexOf("export async function executeCcxtOrder(")
    const verifyStart = src.indexOf("export async function verifyCcxtOrder(")
    expect(proposeStart).toBeGreaterThan(-1)
    expect(executeStart).toBeGreaterThan(proposeStart)
    expect(verifyStart).toBeGreaterThan(executeStart)
    const propose = src.slice(proposeStart, executeStart)
    const execute = src.slice(executeStart, verifyStart)
    expect(propose).toContain("evaluateRiskGate({")
    expect(execute).toContain("evaluateRiskGate({")
  })

  it("perpsExecution.mjs evaluates the risk gate on propose-open, execute-open AND close paths", () => {
    const src = source("../services/commandCentre/perpsExecution.mjs")
    expect(src).toContain('import { evaluateRiskGate } from "./riskGates.mjs"')
    const openProposeStart = src.indexOf("export async function proposePerpsOpen(")
    const executeOpenStart = src.indexOf("export async function executePerpsOpen(")
    const verifyOpenStart = src.indexOf("export async function verifyPerpsOpen(")
    const executeCloseStart = src.indexOf("export async function executePerpsClose(")
    const tailStart = src.indexOf("export function perpsProposalsFromAudit(")
    expect(executeOpenStart).toBeGreaterThan(openProposeStart)
    expect(verifyOpenStart).toBeGreaterThan(executeOpenStart)
    expect(executeCloseStart).toBeGreaterThan(verifyOpenStart)
    expect(tailStart).toBeGreaterThan(executeCloseStart)
    expect(src.slice(openProposeStart, executeOpenStart)).toContain("evaluateRiskGate({")
    expect(src.slice(executeOpenStart, verifyOpenStart)).toContain("evaluateRiskGate({")
    expect(src.slice(executeCloseStart, tailStart)).toContain("evaluateRiskGate({")
  })

  it("handlers.mjs rail-state observers expose riskAggregate + portfolioHeatUsd on every block", () => {
    const src = source("../handlers.mjs")
    const aggregate = src.match(/riskAggregate:\s*riskFeed\.risk\.aggregate\s*\?\?\s*null/g) ?? []
    const heat = src.match(/portfolioHeatUsd:\s*riskFeed\.heat\.usd\s*\?\?\s*null/g) ?? []
    // One observers block per rail (spot + perps) = two occurrences each.
    expect(aggregate).toHaveLength(2)
    expect(heat).toHaveLength(2)
  })

  it("aggregate day-loss trips ride riskHaltStore's persisted halt file", () => {
    const gates = source("../services/commandCentre/riskGates.mjs")
    const halt = source("../services/commandCentre/riskHaltStore.mjs")
    expect(gates).toContain('import { tripBreaker } from "./riskHaltStore.mjs"')
    expect(gates).toContain('tripBreaker("trading", "dailyLoss"')
    const gateStart = gates.indexOf("export const RISK_GATE_ORDER = Object.freeze([")
    const gateEnd = gates.indexOf("])", gateStart)
    expect(gateStart).toBeGreaterThan(-1)
    expect(gateEnd).toBeGreaterThan(gateStart)
    const block = gates.slice(gateStart, gateEnd)
    for (const name of ["risk-day-loss-aggregate", "risk-mdd-size-step", "risk-mdd-hard-stop", "risk-portfolio-heat"]) {
      expect(block, `RISK_GATE_ORDER must keep ${name}`).toContain(name)
    }
    expect(halt).toContain("export function tripBreaker(")
    expect(halt).toContain("command-centre-halt.json")
    expect(halt).toContain("PICC_COMMAND_CENTRE_DATA_DIR")
    expect(halt).toContain('import { hydrateHaltState, wireHaltPersistence } from "./safetySidecar.mjs"')
  })

  it("consent payload-lock: consentDecision runs BEFORE every executor, executed only in commandCentreExecution", () => {
    const handlers = source("../handlers.mjs")
    expect(handlers).toContain("function consentDecision(")
    expect(handlers).toContain('kind: "consent:reconfirmed"')
    expect(handlers).toContain('kind: "consent:denied"')
    expect(handlers).toContain("consent-payload-mismatch")
    expect(handlers).toContain("blockedBeforeVenue: true")
    const consentCalls = []
    for (const m of handlers.matchAll(/const consent = consentDecision\(\{/g)) consentCalls.push(m.index)
    const execCalls = []
    for (const m of handlers.matchAll(/await execute(?:CcxtOrder|PerpsOpen|PerpsClose)\(\{/g)) execCalls.push(m.index)
    expect(consentCalls).toHaveLength(3)
    expect(execCalls).toHaveLength(3)
    consentCalls.forEach((ci, i) => expect(ci, "consent must precede the executor it guards").toBeLessThan(execCalls[i]))
    const execution = source("../services/commandCentre/commandCentreExecution.mjs")
    expect(execution).toContain('kind: "execution:executed"')
  })

  it("sidecar gate order is exactly the 10 documented entries, halt wiring stays live", () => {
    expect(GATE_ORDER).toEqual(EXPECTED_SPOT_GATES)
    expect(wireHaltPersistence).toBeTypeOf("function")
    expect(hydrateHaltState).toBeTypeOf("function")
  })

  it("PICC.md records the WS-2 land (registry row + methodology note)", () => {
    const doc = source("../../../../PICC.md")
    expect(doc).toContain("PICC_TRADING_SUITE_WS2_RISK_AND_DRAWDOWN_ENFORCEMENT_v1")
    expect(doc).toContain("WS-2")
    expect(doc).toContain("risk gates 16")
    expect(doc).toContain("aggregate day-loss")
    expect(doc).toContain("consent payload-lock")
  })
})