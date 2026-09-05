// Command Centre slice 5 — L1 execution seam. The seam runs the FULL 10-gate
// chain BEFORE the venue-touching executor; a deny never reaches the executor;
// a throwing executor is audited as failed and never reported as a partial
// success. The executor is a fixture stub — venue-touching code is never
// exercised live in the test suite (spec testing decision).
import { beforeEach, describe, expect, test } from "vitest"
import {
  CLAIM_ACTION,
  claimIdempotencyKey,
  claimPayout,
  claimRationale,
  executeProposal,
  executionStatus,
  _resetExecutionState
} from "../services/commandCentre/commandCentreExecution.mjs"
import { _resetSidecarState, wireAuditReader, wireKillSwitchReader, noteBreakerTrip, humanTakeover, clearTakeover } from "../services/commandCentre/safetySidecar.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"

const bw = () => templateForSite("bandwidth:browser")
const ccxt = () => templateForSite("trading:ccxt")

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

const claim = {
  platform: "Traffmonetizer",
  balance: 14.2,
  threshold: 10,
  payoutRef: "txn-2026-09-05-abc123",
  consentBy: "usr_owner_01"
}

let auditEvents = []
const collector = () => (e) => auditEvents.push(e)

function stubExecutor(tag = "fixture-claim-done") {
  return async ({ proposal }) => ({ ok: true, workflow: tag, action: proposal.action })
}

beforeEach(() => {
  _resetSidecarState()
  _resetExecutionState()
  wireAuditReader(null)
  wireKillSwitchReader(null)
  auditEvents = []
})

describe("Command Centre — L1 execution seam: the claim shape", () => {
  test("the idempotency key is derived from platform + payout ref (5G identity, no counters)", () => {
    expect(claimIdempotencyKey(claim)).toBe("bandwidth:claim:Traffmonetizer:txn-2026-09-05-abc123")
    expect(claimIdempotencyKey(claim).length).toBeGreaterThanOrEqual(8)
  })

  test("the rationale is auto-rendered from observed payout data and passes 5F", () => {
    const rationale = claimRationale(claim)
    expect(rationale).toContain("Traffmonetizer")
    expect(rationale).toContain("14.2")
    expect(rationale).toContain("10")
    expect(rationale.length).toBeGreaterThanOrEqual(12) // MIN_RATIONALE_LENGTH — renderable
    expect(rationale).toContain("human-approved")
  })
})

describe("Command Centre — L1 execution seam: approved-claim leg", () => {
  test("a fully green claim executes exactly once and records allow + executed", async () => {
    const calls = []
    const exec = async (ctx) => {
      calls.push(ctx.proposal.action)
      return { ok: true, workflow: "fixture-claim-done" }
    }
    const r = await claimPayout({ ...claim, state: greenState(), executor: exec, audit: collector() })
    expect(r.ok).toBe(true)
    expect(r.execution.status).toBe("executed")
    expect(r.execution.idempotencyKey).toBe("bandwidth:claim:Traffmonetizer:txn-2026-09-05-abc123")
    expect(calls).toEqual([CLAIM_ACTION])
    const kinds = auditEvents.map((e) => e.kind)
    expect(kinds).toEqual(["safety-gate:allow", "execution:executed"])
    expect(auditEvents[0].data.power).toBe("proposals")
    expect(auditEvents[0].data.consentBy).toBe("usr_owner_01")
    expect(auditEvents[1].data.result.workflow).toBe("fixture-claim-done")
  })

  test("concurrent in-flight claims are counted and capped by the envelope (5D)", async () => {
    const r = await claimPayout({ ...claim, state: greenState({ concurrentUnits: 2 }), executor: stubExecutor(), audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("envelope-within-ceiling")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
    // never reached the executor
    expect(auditEvents[0].data.blockedBy).toBe("envelope-within-ceiling")
  })

  test("an in-flight claim is OBSERVED by executionStatus() and released on completion", async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const exec = async () => {
      await gate
      return { ok: true }
    }
    const run = claimPayout({ ...claim, state: greenState(), executor: exec, audit: collector() })
    // the executor is awaiting the deferred gate — the claim is in flight RIGHT NOW
    await new Promise((r) => setTimeout(r, 10))
    expect(executionStatus()["bandwidth:browser"]?.inFlight).toBe(1)
    release()
    const r = await run
    expect(r.ok).toBe(true)
    expect(executionStatus()["bandwidth:browser"]).toBeUndefined()
  })

  test("a stale mandatory feed blocks the claim at fresh-data (5E)", async () => {
    const r = await claimPayout({
      ...claim,
      state: greenState({ staleFeeds: [{ name: "presence-heartbeat", ageSec: 600, maxAgeSec: 300 }] }),
      executor: stubExecutor(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("fresh-data")
    expect(r.gate.reason).toContain("presence-heartbeat")
  })
})

describe("Command Centre — L1 execution seam: the gate cannot be skipped", () => {
  test("the global kill switch — even with the reader reporting clean — denies before the executor", async () => {
    const r = await claimPayout({ ...claim, state: greenState({ killSwitch: true }), executor: stubExecutor(), audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("kill-switch")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
  })

  test("a cross-site day halt (breaker elsewhere) denies the claim", async () => {
    noteBreakerTrip("trading:ccxt", "dailyLoss")
    const r = await claimPayout({ ...claim, state: greenState(), executor: stubExecutor(), audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("cross-site-day-halt")
  })

  test("human takeover (5B) denies until a full re-pass", async () => {
    humanTakeover()
    const r = await claimPayout({ ...claim, state: greenState(), executor: stubExecutor(), audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("human-takeover")
    clearTakeover()
    const again = await claimPayout({
      ...claim,
      payoutRef: "txn-2026-09-05-def456",
      state: greenState(),
      executor: stubExecutor(),
      audit: collector()
    })
    expect(again.ok).toBe(true)
  })

  test("a claim without the acting human's identity is denied at opt-in (consent, not opt-in)", async () => {
    const r = await claimPayout({ ...claim, consentBy: "   ", state: greenState(), executor: stubExecutor(), audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("per-site-opt-in")
    expect(r.gate.reason).toContain("consent")
  })

  test("a duplicate claim (same payout ref) is rejected at 5G — double-fire impossible", async () => {
    const r1 = await claimPayout({ ...claim, state: greenState(), executor: stubExecutor(), audit: collector() })
    expect(r1.ok).toBe(true)
    const r2 = await claimPayout({ ...claim, state: greenState(), executor: stubExecutor(), audit: collector() })
    expect(r2.ok).toBe(false)
    expect(r2.gate.blockedBy).toBe("idempotent")
    expect(r2.gate.reason).toContain("double-fire")
  })

  test("the sidecar's wired kill reader also gates the claim — one switch, both seams", async () => {
    wireKillSwitchReader(() => true)
    const r = await claimPayout({ ...claim, state: greenState({ killSwitch: false }), executor: stubExecutor(), audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("kill-switch")
  })
})

describe("Command Centre — L1 execution seam: fail-safe on the venue-touching leg", () => {
  test("a throwing executor is caught, audited as failed, never reported as executed", async () => {
    const exec = async () => {
      throw new Error("browser closed")
    }
    const r = await claimPayout({ ...claim, state: greenState(), executor: exec, audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.execution.status).toBe("failed")
    expect(r.execution.error).toContain("browser closed")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "execution:failed"])
    expect(auditEvents[1].data.error).toContain("browser closed")
  })

  test("executeProposal against a sanctioned live proposal still runs the full chain (generic seam)", async () => {
    const r = await executeProposal({
      template: ccxt(),
      proposal: {
        action: "ccxt:limit-buy",
        power: "live",
        exposureUsd: 5,
        rationale: "verified trend + entry within stop budget (deterministic gates green)",
        idempotencyKey: "buy-btc-2026-09-05T00:00:00Z-zz99"
      },
      state: greenState({ optIn: true }),
      executor: stubExecutor("fixture-fill"),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.execution.status).toBe("executed")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "execution:executed"])
  })
})