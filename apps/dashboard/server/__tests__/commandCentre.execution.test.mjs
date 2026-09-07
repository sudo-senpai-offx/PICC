// Command Centre — L1 execution seam. The generic seam runs the FULL 10-gate
// chain (evaluateGate) BEFORE the venue-touching executor; a deny never reaches
// the executor; a throwing executor is audited as failed and never reported as
// a partial success. The executor is a fixture stub — venue-touching code is
// never exercised live in the test suite (spec testing decision). The ccxt
// order rail (ccxtExecution.mjs) is the "live" embodiment of the same seam.
import { beforeEach, describe, expect, test } from "vitest"
import {
  executeProposal,
  executionStatus,
  _resetExecutionState
} from "../services/commandCentre/commandCentreExecution.mjs"
import { _resetSidecarState, wireAuditReader, wireKillSwitchReader, noteBreakerTrip, humanTakeover, clearTakeover } from "../services/commandCentre/safetySidecar.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"

const ccxt = () => templateForSite("trading:ccxt")

/** A proposal in the ccxt order-rail shape the seam consumes unchanged. */
function proposal(overrides = {}) {
  return {
    action: "ccxt:spot-order",
    power: "proposals",
    exposureUsd: 5,
    rationale: "verified trend + entry within stop budget (deterministic gates green)",
    idempotencyKey: `ccxt-order-${Math.random().toString(36).slice(2)}`,
    consentBy: "usr_owner_01",
    ...overrides
  }
}

function greenState(overrides = {}) {
  return {
    killSwitch: false,
    optIn: false, // the proposals leg must NOT need a standing opt-in
    breakers: { dailyLossHalted: false, regimeHalted: false, siteCapped: false },
    staleFeeds: [],
    concurrentUnits: 0,
    dayLossPct: 0,
    ...overrides
  }
}

let auditEvents = []
const collector = () => (e) => auditEvents.push(e)

function stubExecutor(tag = "fixture-fill") {
  return async ({ proposal: p }) => ({ ok: true, workflow: tag, action: p.action })
}

function run(overrides = {}, state = greenState()) {
  return executeProposal({
    template: ccxt(),
    proposal: proposal(overrides),
    state,
    executor: stubExecutor(),
    audit: collector()
  })
}

beforeEach(() => {
  _resetSidecarState()
  _resetExecutionState()
  wireAuditReader(null)
  wireKillSwitchReader(null)
  auditEvents = []
})

describe("Command Centre — L1 execution seam: the proposal shape", () => {
  test("the audit records action/idempotencyKey/power/consentBy from the proposal (5A, no counters)", async () => {
    const r = await run({ idempotencyKey: "buy-btc-2026-09-05T00:00:00Z-zz99" })
    expect(r.ok).toBe(true)
    const executed = auditEvents.find((e) => e.kind === "execution:executed")
    expect(executed.data.action).toBe("ccxt:spot-order")
    expect(executed.data.idempotencyKey).toBe("buy-btc-2026-09-05T00:00:00Z-zz99")
    expect(executed.data.power).toBe("proposals")
    expect(executed.data.consentBy).toBe("usr_owner_01")
    expect(executed.data.idempotencyKey.length).toBeGreaterThanOrEqual(8)
  })
})

describe("Command Centre — L1 execution seam: approved-proposal leg", () => {
  test("a fully green proposal executes exactly once and records allow + executed", async () => {
    const calls = []
    const exec = async ({ proposal: p }) => {
      calls.push(p.action)
      return { ok: true, workflow: "fixture-fill" }
    }
    const r = await executeProposal({
      template: ccxt(),
      proposal: proposal(),
      state: greenState(),
      executor: exec,
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.execution.status).toBe("executed")
    expect(calls).toEqual(["ccxt:spot-order"])
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "execution:executed"])
    expect(auditEvents[0].data.power).toBe("proposals")
    expect(auditEvents[0].data.consentBy).toBe("usr_owner_01")
    expect(auditEvents[1].data.result.workflow).toBe("fixture-fill")
  })

  test("concurrent in-flight units are counted and capped by the envelope (5D)", async () => {
    const r = await run({}, greenState({ concurrentUnits: 2 }))
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("envelope-within-ceiling")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
    // never reached the executor
    expect(auditEvents[0].data.blockedBy).toBe("envelope-within-ceiling")
  })

  test("an in-flight execution is OBSERVED by executionStatus() and released on completion", async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const exec = async () => {
      await gate
      return { ok: true }
    }
    const p = proposal()
    const runPromise = executeProposal({
      template: ccxt(),
      proposal: p,
      state: greenState(),
      executor: exec,
      audit: collector()
    })
    // the executor is awaiting the deferred gate — the action is in flight RIGHT NOW
    await new Promise((r) => setTimeout(r, 10))
    expect(executionStatus()["trading:ccxt"]?.inFlight).toBe(1)
    release()
    const r = await runPromise
    expect(r.ok).toBe(true)
    expect(executionStatus()["trading:ccxt"]).toBeUndefined()
  })

  test("a stale mandatory feed blocks the proposal at fresh-data (5E)", async () => {
    const r = await run(
      {},
      greenState({ staleFeeds: [{ name: "ccxt-equity", ageSec: 3600, maxAgeSec: 300 }] })
    )
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("fresh-data")
    expect(r.gate.reason).toContain("ccxt-equity")
  })
})

describe("Command Centre — L1 execution seam: the gate cannot be skipped", () => {
  test("the global kill switch — even with the reader reporting clean — denies before the executor", async () => {
    const r = await run({}, greenState({ killSwitch: true }))
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("kill-switch")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
  })

  test("a cross-site day halt (breaker elsewhere) denies the proposal", async () => {
    noteBreakerTrip("expertoption", "dailyLoss")
    const r = await run()
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("cross-site-day-halt")
  })

  test("human takeover (5B) denies until a full re-pass", async () => {
    humanTakeover()
    const r = await run()
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("human-takeover")
    clearTakeover()
    const again = await run({ idempotencyKey: "buy-btc-2026-09-05T00:00:00Z-zz98" })
    expect(again.ok).toBe(true)
  })

  test("a proposal without the acting human's identity is denied at opt-in (consent, not opt-in)", async () => {
    const r = await run({ consentBy: "   " })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("per-site-opt-in")
    expect(r.gate.reason).toContain("consent")
  })

  test("a duplicate proposal (same idempotency key) is rejected at 5G — double-fire impossible", async () => {
    const key = "buy-btc-2026-09-05T00:00:00Z-zz99"
    const r1 = await run({ idempotencyKey: key })
    expect(r1.ok).toBe(true)
    const r2 = await run({ idempotencyKey: key })
    expect(r2.ok).toBe(false)
    expect(r2.gate.blockedBy).toBe("idempotent")
    expect(r2.gate.reason).toContain("double-fire")
  })

  test("the sidecar's wired kill reader also gates the proposal — one switch, both seams", async () => {
    wireKillSwitchReader(() => true)
    const r = await run({}, greenState({ killSwitch: false }))
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("kill-switch")
  })
})

describe("Command Centre — L1 execution seam: fail-safe on the venue-touching leg", () => {
  test("a throwing executor is caught, audited as failed, never reported as executed", async () => {
    const exec = async () => {
      throw new Error("exchange unreachable")
    }
    const r = await executeProposal({
      template: ccxt(),
      proposal: proposal(),
      state: greenState(),
      executor: exec,
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.execution.status).toBe("failed")
    expect(r.execution.error).toContain("exchange unreachable")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "execution:failed"])
    expect(auditEvents[1].data.error).toContain("exchange unreachable")
  })
})