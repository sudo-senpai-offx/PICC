// Command Centre slice 6 — CCXT order leg. Tests are FIXTURE tests: the venue
// executor/verify fns are injected stubs, so no live exchange is ever reached
// (spec testing decision, same as slice 5's claim leg). The leg under test:
// propose (full gate + clamp + proposal:created), execute (carrier A — re-run
// full gate at click, reach the venue exactly once, audit every outcome),
// verify (carrier B — read-only fill verify, never a fabricated fill) and the
// orders list surface. The WS-2 risk gates (16-19) compose onto both carriers,
// so every fixture injects a green risk observation — the rail never touches
// the real risk stores under test.

import { beforeEach, describe, expect, test } from "vitest"
import {
  CCXT_ORDER_ACTION,
  CCXT_SITE,
  clientOrderIdFor,
  orderIdempotencyKey,
  executionIdempotencyKey,
  clampAmountToCap,
  limitPriceSanity,
  orderRationale,
  proposeCcxtOrder,
  executeCcxtOrder,
  verifyCcxtOrder,
  proposalOrdersFromAudit
} from "../services/commandCentre/ccxtExecution.mjs"
import { _resetSidecarState, wireAuditReader } from "../services/commandCentre/safetySidecar.mjs"
import { _resetExecutionState } from "../services/commandCentre/commandCentreExecution.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"

const ccxt = () => templateForSite("trading:ccxt")

const greenAggregate = {
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

function greenRiskObservation(overrides = {}) {
  return {
    risk: {
      ok: true,
      aggregate: greenAggregate,
      venues: {},
      unobservable: []
    },
    heat: {
      usd: 0,
      perpsMarginUsd: 0,
      spotNotionalUsd: 0,
      sources: ["ccxt-perps-positions.json", "audit:proposalOrdersFromAudit"],
      reason: null
    },
    ...overrides
  }
}

function greenState(overrides = {}) {
  return {
    killSwitch: false,
    optIn: false, // proposals power — per-action consent, no standing opt-in
    breakers: { dailyLossHalted: false, regimeHalted: false, siteCapped: false },
    staleFeeds: [],
    concurrentUnits: 0,
    dayLossPct: 0,
    riskObservation: greenRiskObservation(),
    ...overrides
  }
}

const order = {
  exchange: "binance",
  symbol: "BTC/USDT",
  side: "buy",
  amount: 0.01, // ≈ $10 at price 1000
  price: 1000,
  clientOrderId: "picc-ord-test",
  consentBy: "usr_owner_01"
}

let auditEvents = []
const collector = () => (e) => auditEvents.push(e)

function stubExecutor(tag = "fixture-order-placed") {
  return async ({ proposal }) => ({ ok: true, venue: "fixture", tag, action: proposal.action })
}

beforeEach(() => {
  _resetSidecarState()
  _resetExecutionState()
  wireAuditReader(null)
  auditEvents = []
})

describe("Command Centre — ccxt order leg: identity + shape", () => {
  test("the clientOrderId is a short, fresh, exchange-safe token bound to the proposal", () => {
    const a = clientOrderIdFor(1700000000000)
    const b = clientOrderIdFor(1700000000000)
    expect(a).toMatch(/^picc-[a-z0-9]{2,}-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
    expect(a.length).toBeLessThanOrEqual(32) // binance clientOrderId ceiling
  })

  test("the 5G identity is exchange + clientOrderId (a deterministic pair, not a counter)", () => {
    const key = orderIdempotencyKey({ exchange: "Binance", clientOrderId: "picc-x" })
    expect(key).toBe("ccxt:order:binance:picc-x")
    expect(executionIdempotencyKey(key)).toBe(`${key}:exec`)
    expect(orderIdempotencyKey({ exchange: "binance", clientOrderId: "picc-x" })).toBe(key)
  })

  test("the gate-side clamp never lets notional exceed the envelope; under-cap orders pass untouched", () => {
    const under = clampAmountToCap({ amount: 0.005, price: 1000 })
    expect(under).toEqual({ amount: 0.005, notionalUsd: 5, clamped: false })
    const over = clampAmountToCap({ amount: 0.1, price: 200 }) // $20 > $10
    expect(over.clamped).toBe(true)
    expect(over.notionalUsd).toBeLessThanOrEqual(10)
    expect(over.amount * 200).toBeLessThanOrEqual(10) // rounded DOWN, never overshoots
  })
})

describe("Command Centre — ccxt order leg: limit-price sanity vs the FRESH market (5E)", () => {
  test("a BUY limit resting ABOVE the fresh reference is denied — it would pay more than the market just showed", () => {
    const r = limitPriceSanity({ side: "buy", limitPrice: 1010, referencePrice: 1000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("ABOVE the fresh reference")
    expect(r.reason).toContain("(5E)")
  })

  test("a SELL limit resting BELOW the fresh reference is denied — it would receive less", () => {
    const r = limitPriceSanity({ side: "sell", limitPrice: 990, referencePrice: 1000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("BELOW the fresh reference")
  })

  test("within-tolerance limits pass both directions", () => {
    expect(limitPriceSanity({ side: "buy", limitPrice: 999, referencePrice: 1000 }).ok).toBe(true)
    expect(limitPriceSanity({ side: "sell", limitPrice: 1001, referencePrice: 1000 }).ok).toBe(true)
  })

  test("without a fresh reference the limit is UNVERIFIABLE — denied, honestly (never unchecked)", () => {
    const r = limitPriceSanity({ side: "buy", limitPrice: 1000, referencePrice: null })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("no fresh reference price")
  })

  test("malformed inputs are refused before any market comparison", () => {
    expect(limitPriceSanity({ side: "buy", limitPrice: -1, referencePrice: 1000 }).ok).toBe(false)
    expect(limitPriceSanity({ side: "hold", limitPrice: 1000, referencePrice: 1000 }).ok).toBe(false)
  })
})

describe("Command Centre — ccxt order leg: proposal rail (BOTH carriers), propose", () => {
  test("a green proposal passes the FULL gate and is recorded durably as proposal:created", async () => {
    const r = await proposeCcxtOrder({ ...order, state: greenState(), audit: collector() })
    expect(r.ok).toBe(true)
    expect(r.gate.allow).toBe(true)
    expect(r.idempotencyKey).toBe(`ccxt:order:binance:${r.clientOrderId}`)
    expect(r.order).toMatchObject({ exchange: "binance", side: "buy", notionalUsd: 10 })
    const kinds = auditEvents.map((e) => e.kind)
    expect(kinds).toEqual(["safety-gate:allow", "safety-gate:allow", "proposal:created"])
    const created = auditEvents[2].data
    expect(created).toMatchObject({
      clientOrderId: r.clientOrderId,
      idempotencyKey: r.idempotencyKey,
      exchange: "binance",
      symbol: "BTC/USDT",
      side: "buy",
      power: "proposals",
      consentBy: "usr_owner_01"
    })
    expect(created.notionalUsd).toBe(10)
    expect(JSON.stringify(auditEvents)).not.toContain("secret") // key material never leaks into the trail
  })

  test("an over-cap request is clamped DOWN at propose (gate-side), the venue sees the clamp", async () => {
    const r = await proposeCcxtOrder({
      ...order,
      amount: 0.1,
      price: 200, // $20 gross → clamped to ~$10
      state: greenState(),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.order.clamped).toBe(true)
    expect(r.order.amount * 200).toBeLessThanOrEqual(10)
    expect(r.order.notionalUsd).toBeLessThanOrEqual(10)
    expect(r.proposal.exposureUsd).toBe(r.order.notionalUsd)
  })

  test("fresh per-action consent is REQUIRED — absent consentBy denies at the gate (consent ≠ opt-in)", async () => {
    const r = await proposeCcxtOrder({ ...order, consentBy: undefined, state: greenState(), audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("per-site-opt-in")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
  })

  test("a deny never creates a proposal entry — no phantom orders in the list", async () => {
    const r = await proposeCcxtOrder({
      ...order,
      state: greenState({ killSwitch: true }),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("kill-switch")
    expect(auditEvents.every((e) => e.kind !== "proposal:created")).toBe(true)
  })
})

describe("Command Centre — ccxt order leg: carrier A (PICC executes), execute", () => {
  test("a green order executes exactly once: full gate re-run + venue reached + both audits", async () => {
    const calls = []
    const exec = async (ctx) => {
      calls.push(ctx.proposal.action)
      return { ok: true, workflow: "fixture-order-placed" }
    }
    const r = await executeCcxtOrder({ ...order, state: greenState(), executor: exec, audit: collector() })
    expect(r.ok).toBe(true)
    expect(r.execution.status).toBe("executed")
    expect(r.execution.idempotencyKey).toBe(`ccxt:order:binance:${order.clientOrderId}:exec`)
    expect(calls).toEqual([CCXT_ORDER_ACTION])
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "safety-gate:allow", "execution:executed"])
    expect(auditEvents[1].data.power).toBe("proposals")
    expect(auditEvents[1].data.consentBy).toBe("usr_owner_01")
    expect(auditEvents[2].data.result.workflow).toBe("fixture-order-placed")
  })

  test("a stale ccxt-equity feed at CLICK time denies at fresh-data (5E) — the re-check is real", async () => {
    const calls = []
    const exec = async () => {
      calls.push(1)
      return { ok: true }
    }
    const r = await executeCcxtOrder({
      ...order,
      state: greenState({ staleFeeds: [{ name: "ccxt-equity", ageSec: 600, maxAgeSec: 300 }] }),
      executor: exec,
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("fresh-data")
    expect(r.gate.reason).toContain("ccxt-equity")
    expect(calls).toEqual([])
  })

  test("a day loss over the envelope ceiling denies at envelope-within-ceiling (5D)", async () => {
    const r = await executeCcxtOrder({
      ...order,
      state: greenState({ dayLossPct: 6 }),
      executor: stubExecutor(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("envelope-within-ceiling")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "safety-gate:deny"])
  })

  test("in-flight concurrent capacity is enforced by the envelope before the venue (5D)", async () => {
    const r = await executeCcxtOrder({
      ...order,
      state: greenState({ concurrentUnits: 2 }),
      executor: stubExecutor(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("envelope-within-ceiling")
  })

  test("a venue throw surfaces as execution:failed — never a partial-success claim", async () => {
    const exec = async () => {
      throw new Error("fixture: exchange rejected the order")
    }
    const r = await executeCcxtOrder({ ...order, state: greenState(), executor: exec, audit: collector() })
    expect(r.ok).toBe(false)
    expect(r.execution.status).toBe("failed")
    expect(r.execution.error).toContain("fixture: exchange rejected the order")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "safety-gate:allow", "execution:failed"])
  })

  test("a re-click is denied at the idempotent gate (5G) — the venue is reached EXACTLY once", async () => {
    const calls = []
    const exec = async () => {
      calls.push(1)
      return { ok: true }
    }
    const first = await executeCcxtOrder({ ...order, state: greenState(), executor: exec, audit: collector() })
    expect(first.ok).toBe(true)
    const second = await executeCcxtOrder({ ...order, state: greenState(), executor: exec, audit: collector() })
    expect(second.ok).toBe(false)
    expect(second.gate.blockedBy).toBe("idempotent")
    expect(calls).toEqual([1])
  })
})

describe("Command Centre — ccxt order leg: carrier B (the human executes), verify", () => {
  test("a read-only verify records ccxt-verify:filled with the honest fill fields", async () => {
    const verify = async () => ({ status: "closed", filled: 0.01, average: 999.5, at: 1700000000000 })
    const r = await verifyCcxtOrder({
      exchange: "binance",
      symbol: "BTC/USDT",
      orderId: "venue-42",
      clientOrderId: order.clientOrderId,
      verify,
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.kind).toBe("ccxt-verify:filled")
    const entry = auditEvents[0]
    expect(entry.kind).toBe("ccxt-verify:filled")
    expect(entry.data).toMatchObject({
      idempotencyKey: `ccxt:order:binance:${order.clientOrderId}`,
      venueOrderId: "venue-42",
      fill: { status: "closed", filled: 0.01, average: 999.5 }
    })
  })

  test("an unobserved read is recorded as ccxt-verify:unobserved — NEVER a fabricated fill", async () => {
    const verify = async () => null
    const r = await verifyCcxtOrder({
      exchange: "binance",
      symbol: "BTC/USDT",
      orderId: "venue-43",
      clientOrderId: order.clientOrderId,
      verify,
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("ccxt-verify:unobserved")
    expect(auditEvents[0].data.reason).toContain("did not answer")
  })

  test("without a verify function the read is honestly unobserved — never assumed filled", async () => {
    const r = await verifyCcxtOrder({
      exchange: "binance",
      symbol: "BTC/USDT",
      orderId: "venue-44",
      clientOrderId: order.clientOrderId,
      verify: null,
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("ccxt-verify:unobserved")
  })
})

describe("Command Centre — ccxt order leg: the orders list surface", () => {
  function makeProposal(audit, o = {}) {
    return proposeCcxtOrder({ ...order, ...o, state: greenState(), audit })
  }

  test("open → executed → failed → verified-filled → verify-unobserved map to honest statuses", async () => {
    const allAudits = []
    const cap = (acc) => (e) => acc.push(e)

    // open: proposal:created only (never executed, never verified)
    const open = await makeProposal(cap(allAudits))
    expect(open.ok).toBe(true)

    // executed: carrier A placed it (propose, then the human's click executes
    // with the SAME clientOrderId the proposal returned — the panel flow)
    const execProposal = await makeProposal(cap(allAudits))
    expect(execProposal.ok).toBe(true)
    await executeCcxtOrder({
      ...order,
      clientOrderId: execProposal.clientOrderId,
      state: greenState(),
      executor: stubExecutor(),
      audit: cap(allAudits)
    })
    // failed: a DIFFERENT order whose venue step threw
    const failProposal = await makeProposal(cap(allAudits))
    expect(failProposal.ok).toBe(true)
    await executeCcxtOrder({
      ...order,
      clientOrderId: failProposal.clientOrderId,
      state: greenState(),
      executor: async () => {
        throw new Error("boom")
      },
      audit: cap(allAudits)
    })
    // verified-filled: carrier B, human executed, read-only verify saw the fill
    const filledProposal = await makeProposal(cap(allAudits))
    expect(filledProposal.ok).toBe(true)
    await verifyCcxtOrder({
      exchange: "binance",
      symbol: "BTC/USDT",
      orderId: "venue-50",
      clientOrderId: filledProposal.clientOrderId,
      verify: async () => ({ status: "closed", filled: 0.01, average: 1000, at: 1700000000000 }),
      audit: cap(allAudits)
    })
    // verify-unobserved: carrier B, human executed, venue did not answer
    const unobservedProposal = await makeProposal(cap(allAudits))
    expect(unobservedProposal.ok).toBe(true)
    await verifyCcxtOrder({
      exchange: "binance",
      symbol: "BTC/USDT",
      orderId: "venue-51",
      clientOrderId: unobservedProposal.clientOrderId,
      verify: async () => null,
      audit: cap(allAudits)
    })

    const list = proposalOrdersFromAudit(allAudits)
    expect(list).toHaveLength(5)
    const byClient = new Map(list.map((p) => [p.clientOrderId, p]))
    expect(byClient.get(open.clientOrderId).status).toBe("open")
    expect(byClient.get(execProposal.clientOrderId).status).toBe("executed")
    expect(byClient.get(execProposal.clientOrderId).idempotencyKey).toBe(`ccxt:order:binance:${execProposal.clientOrderId}`)
    expect(byClient.get(failProposal.clientOrderId).status).toBe("failed")
    expect(byClient.get(filledProposal.clientOrderId).status).toBe("verified-filled")
    expect(byClient.get(unobservedProposal.clientOrderId).status).toBe("verify-unobserved")
    // newest first, and each row carries enough for the panel to act
    expect(list[0].proposedAt >= list[list.length - 1].proposedAt).toBe(true)
    expect(list.every((p) => p.rationale && p.rationale.length >= 12)).toBe(true)
  })
})