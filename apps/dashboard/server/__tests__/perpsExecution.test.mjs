// Command Centre WS-1 slice F5 — perps execution rail. Mirror of the ccxt
// order leg's test surface (ccxtExecution.test.mjs), perps-namespaced:
// propose (full 10+5 gate + margin clamp + proposal:created), execute (carrier A
// — re-run perps-5 then sidecar-10 at click, reach the venue exactly once),
// verify (carrier B — read-only, never a fabricated fill), close (reduce-only
// proposal replayed from the durable position record) and the list surface.
//
// The rail is venue-carrier only: the venue (submit/verify) and the
// observation/state are injected fixture stubs — no live exchange is touched.

import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  PERPS_OPEN_ACTION,
  PERPS_CLOSE_ACTION,
  PERPS_SITE,
  perpsOpenIdempotencyKey,
  perpsCloseIdempotencyKey,
  clampPerpsMargin,
  perpsOrderRationale,
  closeClientOrderIdFor,
  proposePerpsOpen,
  executePerpsOpen,
  verifyPerpsOpen,
  executePerpsClose,
  perpsProposalsFromAudit,
  clientOrderIdFor,
  executionIdempotencyKey
} from "../services/commandCentre/perpsExecution.mjs"
import { clientOrderIdFor as ccxtClientOrderIdFor } from "../services/commandCentre/ccxtExecution.mjs"
import { _resetSidecarState, wireAuditReader } from "../services/commandCentre/safetySidecar.mjs"
import {
  _resetExecutionState,
  executionStatus
} from "../services/commandCentre/commandCentreExecution.mjs"

// Environment lease for the perps env-configurable caps (read at call time).
const ENV_KEYS = [
  "PICC_CCXT_LEVERAGE_MIN",
  "PICC_CCXT_LEVERAGE_MAX",
  "PICC_CCXT_MARGIN_PER_POSITION_CAP_USD",
  "PICC_CCXT_PERPS_MAX_OPEN_POSITIONS",
  "PICC_CCXT_FUNDING_STALE_MS"
]
let envSnapshot = {}

// The trading:perps template (catalog row shape, §3.7 of the WS-1 spec). The
// catalog row itself is T7-owned (M2) and not present yet — the rail accepts
// the template injectably, so the tests feed it the exact row shape.
function perpsTemplate() {
  return {
    site: "trading:perps",
    stream: "trading",
    venue: "hyperliquid perps (swap, testnet-first)",
    automationPermission: "sanctioned",
    demoOnly: false,
    envelope: { mode: "copilot", maxExposureUsd: 10, maxConcurrent: 1, maxDailyLossPct: 5 }
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
    ...overrides
  }
}

// Fresh perps observation: leverage 4 in-band, margin 10 at the cap, isolated,
// no open positions, funding observed a minute ago (fresh inside the 2h window).
function observation(overrides = {}) {
  return {
    leverage: 4,
    notionalUsd: 40,
    marginMode: "isolated",
    openNetPositions: 0,
    funding: { rate: 0.0001, at: Date.now() - 60_000 },
    ...overrides
  }
}

const order = {
  exchange: "hyperliquid",
  symbol: "BTC/USDT",
  side: "buy",
  amount: 0.01, // ≈ $10 notional at price 1000 (margin $2.50 at 4x)
  price: 1000,
  leverage: 4,
  marginMode: "isolated",
  consentBy: "usr_owner_01"
}

// Durable position record (livePositionManager shape, T4) replayed for closes.
const position = {
  id: "pos-hl-01",
  symbol: "BTC/USDT",
  side: "long",
  size: 0.01,
  entryPrice: 1000,
  leverage: 4,
  marginUsd: 2.5,
  marginMode: "isolated",
  openedAt: 1700000000000,
  openOrderId: "venue-open-1",
  source: "venue-observed"
}

let auditEvents = []
const collector = () => (e) => auditEvents.push(e)

function stubExecutor(tag = "fixture-perps-placed") {
  return async ({ proposal }) => ({ ok: true, venue: "fixture", tag, action: proposal.action })
}

beforeEach(() => {
  _resetSidecarState()
  _resetExecutionState()
  wireAuditReader(null)
  auditEvents = []
  envSnapshot = {}
  for (const k of ENV_KEYS) envSnapshot[k] = process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k]
    else process.env[k] = envSnapshot[k]
  }
})

describe("Command Centre — perps rail: identity + shape", () => {
  test("the three perps identities are the namespaced action/site constants", () => {
    expect(PERPS_OPEN_ACTION).toBe("perps:open-order")
    expect(PERPS_CLOSE_ACTION).toBe("perps:close-order")
    expect(PERPS_SITE).toBe("trading:perps")
  })

  test("the perps idempotency pairs are exchange-based deterministic keys with :exec halves", () => {
    const open = perpsOpenIdempotencyKey({ exchange: "Hyperliquid", clientOrderId: "picc-x" })
    expect(open).toBe("perps:order:hyperliquid:picc-x")
    expect(executionIdempotencyKey(open)).toBe("perps:order:hyperliquid:picc-x:exec")

    const close = perpsCloseIdempotencyKey({ exchange: "hyperliquid", positionId: "pos-1", clientOrderId: "picc-y" })
    expect(close).toBe("perps:close:hyperliquid:pos-1:picc-y")
    expect(executionIdempotencyKey(close)).toBe("perps:close:hyperliquid:pos-1:picc-y:exec")
  })

  test("clientOrderIdFor is REUSED from ccxtExecution.mjs, not re-implemented", () => {
    expect(clientOrderIdFor).toBe(ccxtClientOrderIdFor)
    const a = clientOrderIdFor(1700000000000)
    expect(a).toMatch(/^picc-[a-z0-9]{2,}-[0-9a-f]{8}$/)
  })

  test("the close's clientOrderId is a deterministic position-bound token (re-click idempotency)", () => {
    expect(closeClientOrderIdFor("pos-hl-01")).toBe(closeClientOrderIdFor("pos-hl-01"))
    expect(closeClientOrderIdFor("pos-hl-01")).not.toBe(closeClientOrderIdFor("pos-hl-02"))
    expect(closeClientOrderIdFor("pos-hl-01")).toMatch(/^picc-close-/)
  })
})

describe("Command Centre — perps rail: the gate-side margin clamp", () => {
  test("an over-cap request is clamped DOWN so implied margin never exceeds the cap", () => {
    const r = clampPerpsMargin({ amount: 0.4, price: 1000, leverage: 4 }) // $100 notional, $25 margin
    expect(r.ok).toBe(true)
    expect(r.clamped).toBe(true)
    expect(r.marginUsd).toBeLessThanOrEqual(10)
    expect(r.amount * r.price / r.leverage).toBeLessThanOrEqual(10) // rounded DOWN, never overshoots
    expect(r.notionalUsd).toBe(40) // floor(cap * leverage)
  })

  test("an under-cap request passes untouched", () => {
    const r = clampPerpsMargin({ amount: 0.01, price: 1000, leverage: 4 }) // $10 notional, $2.50 margin
    expect(r.ok).toBe(true)
    expect(r.clamped).toBe(false)
    expect(r.amount).toBe(0.01)
  })

  test("an invalid margin-cap env is an explicit invalid-environment deny naming the var", () => {
    process.env.PICC_CCXT_MARGIN_PER_POSITION_CAP_USD = "ten-bucks"
    const r = clampPerpsMargin({ amount: 0.4, price: 1000, leverage: 4 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("invalid-environment")
    expect(r.reason).toContain("PICC_CCXT_MARGIN_PER_POSITION_CAP_USD")
  })
})

describe("Command Centre — perps rail: proposal leg, propose", () => {
  test("a green proposal passes the FULL 10+5 gate and records proposal:created durably", async () => {
    const r = await proposePerpsOpen({
      ...order,
      state: greenState(),
      observation: observation(),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.gate.allow).toBe(true)
    expect(r.perpsGate.allow).toBe(true)
    expect(r.idempotencyKey).toBe(`perps:order:hyperliquid:${r.clientOrderId}`)
    expect(r.order).toMatchObject({ exchange: "hyperliquid", side: "buy", notionalUsd: 10, marginUsd: 2.5 })
    const kinds = auditEvents.map((e) => e.kind)
    expect(kinds).toEqual(["safety-gate:allow", "safety-gate:allow", "proposal:created"])
    const created = auditEvents[2].data
    expect(created).toMatchObject({
      clientOrderId: r.clientOrderId,
      idempotencyKey: r.idempotencyKey,
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      side: "buy",
      power: "proposals",
      consentBy: "usr_owner_01",
      kind: "open",
      leverage: 4,
      marginMode: "isolated",
      reduceOnly: false,
      marginUsd: 2.5
    })
    expect(created.clamped).toBe(false)
    expect(created.rationale.length).toBeGreaterThanOrEqual(12)
    expect(created.rationale).toMatch(/margin/)
    expect(created.rationale).toMatch(/leverage|4x|lever/)
  })

  test("an over-cap request is clamped at PROPOSE — clamped visible in the order AND proposal:created", async () => {
    const r = await proposePerpsOpen({
      ...order,
      amount: 0.4, // $400 notional → $100 margin → clamped to $10 margin
      state: greenState(),
      observation: observation({ notionalUsd: 400 }),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.order.clamped).toBe(true)
    expect(r.order.marginUsd).toBeLessThanOrEqual(10)
    expect(r.proposal.notionalUsd).toBe(40)
    expect(r.proposal.marginUsd).toBeLessThanOrEqual(10)
    const created = auditEvents.find((e) => e.kind === "proposal:created")
    expect(created.data.clamped).toBe(true)
    expect(created.data.notionalUsd).toBe(40)
  })

  test("absent consentBy denies at per-site-opt-in — ONLY the deny audited, perps gate never runs", async () => {
    const r = await proposePerpsOpen({
      ...order,
      consentBy: undefined,
      state: greenState(),
      observation: observation(),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("per-site-opt-in")
    expect(r.perpsGate).toBeNull()
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
  })

  test("over-band leverage at PROPOSE denies at perps gate 11 — no proposal:created", async () => {
    const r = await proposePerpsOpen({
      ...order,
      leverage: 6,
      state: greenState(),
      observation: observation({ leverage: 6 }),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.perpsGate.blockedBy).toBe("perps-leverage-band")
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "safety-gate:deny"])
    expect(auditEvents.every((e) => e.kind !== "proposal:created")).toBe(true)
  })

  test("a kill switch deny short-circuits BEFORE the perps gate — no proposal recorded", async () => {
    const r = await proposePerpsOpen({
      ...order,
      state: greenState({ killSwitch: true }),
      observation: observation(),
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("kill-switch")
    expect(r.perpsGate).toBeNull()
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
  })
})

describe("Command Centre — perps rail: carrier A (PICC executes), execute", () => {
  test("a green order re-runs perps-5 THEN sidecar-10 at click and reaches the venue EXACTLY once", async () => {
    const calls = []
    const exec = async (ctx) => {
      calls.push(ctx.proposal.action)
      return { ok: true, workflow: "fixture-perps-placed" }
    }
    const r = await executePerpsOpen({
      ...order,
      clientOrderId: "picc-ord-test",
      state: greenState(),
      observation: observation(),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.execution.status).toBe("executed")
    expect(r.execution.idempotencyKey).toBe(`perps:order:hyperliquid:picc-ord-test:exec`)
    expect(calls).toEqual([PERPS_OPEN_ACTION])
    expect(auditEvents.map((e) => e.kind)).toEqual([
      "safety-gate:allow",
      "safety-gate:allow",
      "execution:executed"
    ])
    expect(auditEvents[1].data.power).toBe("proposals")
    expect(auditEvents[1].data.consentBy).toBe("usr_owner_01")
    expect(auditEvents[2].data.result.workflow).toBe("fixture-perps-placed")
  })

  test("the execution leg counts trading:perps in-flight via executeProposal", async () => {
    const entered = Promise.withResolvers()
    const release = Promise.withResolvers()
    const exec = async () => {
      entered.resolve()
      await release.promise
      return { ok: true }
    }
    const run = executePerpsOpen({
      ...order,
      clientOrderId: "picc-flight",
      state: greenState(),
      observation: observation(),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    await entered.promise
    expect(executionStatus()["trading:perps"]?.inFlight).toBe(1)
    release.resolve()
    await run
    expect(executionStatus()["trading:perps"]).toBeUndefined()
  })

  test("a stale perps-equity feed at CLICK time denies at fresh-data — venue NOT reached", async () => {
    const calls = []
    const exec = async () => {
      calls.push(1)
      return { ok: true }
    }
    const r = await executePerpsOpen({
      ...order,
      clientOrderId: "picc-stale",
      state: greenState({ staleFeeds: [{ name: "perps-equity", ageSec: 600, maxAgeSec: 300 }] }),
      observation: observation(),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("fresh-data")
    expect(r.gate.reason).toContain("perps-equity")
    expect(calls).toEqual([])
    // first-deny consequence: the perps allow IS audited, then the sidecar deny;
    // NO execution:* and the venue stub never ran.
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "safety-gate:deny"])
  })

  test("a day loss over the envelope ceiling at CLICK denies at envelope-within-ceiling", async () => {
    const calls = []
    const exec = async () => {
      calls.push(1)
      return { ok: true }
    }
    const r = await executePerpsOpen({
      ...order,
      clientOrderId: "picc-loss",
      state: greenState({ dayLossPct: 6 }),
      observation: observation(),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate.blockedBy).toBe("envelope-within-ceiling")
    expect(calls).toEqual([])
  })

  test("over-band leverage at CLICK denies at perps gate 11 BEFORE the venue (fresh re-check is real)", async () => {
    const calls = []
    const exec = async () => {
      calls.push(1)
      return { ok: true }
    }
    const r = await executePerpsOpen({
      ...order,
      clientOrderId: "picc-band",
      state: greenState(),
      observation: observation({ leverage: 6, notionalUsd: 60 }),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate).toBeNull()
    expect(r.perpsGate.blockedBy).toBe("perps-leverage-band")
    expect(calls).toEqual([])
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
  })

  test("a venue throw surfaces as execution:failed — never a partial-success claim", async () => {
    const exec = async () => {
      throw new Error("fixture: hyperliquid rejected the order")
    }
    const r = await executePerpsOpen({
      ...order,
      clientOrderId: "picc-throw",
      state: greenState(),
      observation: observation(),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.execution.status).toBe("failed")
    expect(r.execution.error).toContain("fixture: hyperliquid rejected the order")
    expect(auditEvents.map((e) => e.kind)).toEqual([
      "safety-gate:allow",
      "safety-gate:allow",
      "execution:failed"
    ])
  })

  test("a re-click is denied at the idempotent gate — the venue is reached EXACTLY once", async () => {
    const calls = []
    const exec = async () => {
      calls.push(1)
      return { ok: true }
    }
    const first = await executePerpsOpen({
      ...order,
      clientOrderId: "picc-rc",
      state: greenState(),
      observation: observation(),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(first.ok).toBe(true)
    const second = await executePerpsOpen({
      ...order,
      clientOrderId: "picc-rc",
      state: greenState(),
      observation: observation(),
      executor: exec,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(second.ok).toBe(false)
    expect(second.gate.blockedBy).toBe("idempotent")
    expect(calls).toEqual([1])
  })
})

describe("Command Centre — perps rail: carrier B (the human executes), verify", () => {
  test("a read-only verify records perps-verify:filled with the honest fill fields", async () => {
    const verify = async () => ({ status: "closed", filled: 0.01, average: 1001.5, at: 1700000000000 })
    const r = await verifyPerpsOpen({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      orderId: "venue-42",
      clientOrderId: order.clientOrderId,
      verify,
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.kind).toBe("perps-verify:filled")
    const entry = auditEvents[0]
    expect(entry.kind).toBe("perps-verify:filled")
    expect(entry.data).toMatchObject({
      idempotencyKey: `perps:order:hyperliquid:${order.clientOrderId}`,
      venueOrderId: "venue-42",
      fill: { status: "closed", filled: 0.01, average: 1001.5 }
    })
  })

  test("an unobserved read is recorded as perps-verify:unobserved — NEVER a fabricated fill", async () => {
    const verify = async () => null
    const r = await verifyPerpsOpen({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      orderId: "venue-43",
      clientOrderId: order.clientOrderId,
      verify,
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("perps-verify:unobserved")
    expect(auditEvents[0].data.reason).toContain("did not answer")
  })

  test("without a verify function the read is honestly unobserved — never assumed filled", async () => {
    const r = await verifyPerpsOpen({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      orderId: "venue-44",
      clientOrderId: order.clientOrderId,
      verify: null,
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("perps-verify:unobserved")
  })
})

describe("Command Centre — perps rail: close (reduce-only replay)", () => {
  test("a green close runs the reduce-only proposal through the chain and records it once", async () => {
    const calls = []
    const submit = async (ctx) => {
      calls.push(ctx.proposal)
      return { ok: true, order: { id: "venue-close-1", reduceOnly: true } }
    }
    const r = await executePerpsClose({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      positionId: position.id,
      price: 1010,
      consentBy: order.consentBy,
      position,
      state: greenState(),
      observation: observation({ openNetPositions: 1 }),
      submit,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(true)
    expect(r.execution.status).toBe("executed")
    expect(calls).toHaveLength(1)
    const sent = calls[0]
    expect(sent.action).toBe(PERPS_CLOSE_ACTION)
    expect(sent.reduceOnly).toBe(true)
    expect(sent.positionLeverage).toBe(4)
    expect(sent.leverage).toBe(4)
    expect(sent.marginMode).toBe("isolated")
    expect(sent.notionalUsd).toBe(10.1)
    expect(r.execution.idempotencyKey).toBe(
      `perps:close:hyperliquid:${position.id}:${closeClientOrderIdFor(position.id)}:exec`
    )
    // perps allow + sidecar allow + execution:executed + close proposal:created
    expect(auditEvents.map((e) => e.kind)).toEqual([
      "safety-gate:allow",
      "safety-gate:allow",
      "execution:executed",
      "proposal:created"
    ])
    const created = auditEvents[3].data
    expect(created.action).toBe(PERPS_CLOSE_ACTION)
    expect(created.kind).toBe("close")
    expect(created.positionId).toBe(position.id)
    expect(created.reduceOnly).toBe(true)
  })

  test("a close is denied at perps-position-cap when another position remains open", async () => {
    const calls = []
    const submit = async () => {
      calls.push(1)
      return { ok: true }
    }
    const r = await executePerpsClose({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      positionId: position.id,
      price: 1010,
      consentBy: order.consentBy,
      position,
      state: greenState(),
      observation: observation({ openNetPositions: 3 }), // post-close 2 > cap 1
      submit,
      template: perpsTemplate(),
      audit: collector()
    })
    expect(r.ok).toBe(false)
    expect(r.gate).toBeNull()
    expect(r.perpsGate.blockedBy).toBe("perps-position-cap")
    expect(calls).toEqual([])
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:deny"])
  })

  test("a close executes only once per idempotency key — the re-click is denied", async () => {
    const calls = []
    const submit = async () => {
      calls.push(1)
      return { ok: true }
    }
    const args = {
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      positionId: position.id,
      price: 1010,
      consentBy: order.consentBy,
      position,
      state: greenState(),
      observation: observation({ openNetPositions: 1 }),
      submit,
      template: perpsTemplate(),
      audit: collector()
    }
    const first = await executePerpsClose(args)
    expect(first.ok).toBe(true)
    const second = await executePerpsClose(args)
    expect(second.ok).toBe(false)
    expect(second.gate.blockedBy).toBe("idempotent")
    expect(calls).toEqual([1])
  })
})

describe("Command Centre — perps rail: the list surface", () => {
  function makeProposal(audit, o = {}) {
    return proposePerpsOpen({ ...order, ...o, state: greenState(), observation: observation(), template: perpsTemplate(), audit })
  }

  test("open/executed/failed/verified-filled/verify-unobserved map for open AND close kinds", async () => {
    const allAudits = []
    const cap = (acc) => (e) => acc.push(e)

    const open = await makeProposal(cap(allAudits))
    expect(open.ok).toBe(true)

    const execProposal = await makeProposal(cap(allAudits))
    expect(execProposal.ok).toBe(true)
    await executePerpsOpen({
      ...order,
      clientOrderId: execProposal.clientOrderId,
      state: greenState(),
      observation: observation(),
      executor: stubExecutor(),
      template: perpsTemplate(),
      audit: cap(allAudits)
    })

    const failProposal = await makeProposal(cap(allAudits))
    expect(failProposal.ok).toBe(true)
    await executePerpsOpen({
      ...order,
      clientOrderId: failProposal.clientOrderId,
      state: greenState(),
      observation: observation(),
      executor: async () => {
        throw new Error("boom")
      },
      template: perpsTemplate(),
      audit: cap(allAudits)
    })

    const filledProposal = await makeProposal(cap(allAudits))
    expect(filledProposal.ok).toBe(true)
    await verifyPerpsOpen({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      orderId: "venue-50",
      clientOrderId: filledProposal.clientOrderId,
      verify: async () => ({ status: "closed", filled: 0.01, average: 1000, at: 1700000000000 }),
      audit: cap(allAudits)
    })

    const unobservedProposal = await makeProposal(cap(allAudits))
    expect(unobservedProposal.ok).toBe(true)
    await verifyPerpsOpen({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      orderId: "venue-51",
      clientOrderId: unobservedProposal.clientOrderId,
      verify: async () => null,
      audit: cap(allAudits)
    })

    await executePerpsClose({
      exchange: "hyperliquid",
      symbol: "BTC/USDT",
      positionId: position.id,
      price: 1010,
      consentBy: order.consentBy,
      position,
      state: greenState(),
      observation: observation({ openNetPositions: 1 }),
      submit: stubExecutor("fixture-close-placed"),
      template: perpsTemplate(),
      audit: cap(allAudits)
    })

    const list = perpsProposalsFromAudit(allAudits)
    expect(list).toHaveLength(6)
    const byClient = new Map(list.map((p) => [p.clientOrderId, p]))
    expect(byClient.get(open.clientOrderId).status).toBe("open")
    expect(byClient.get(execProposal.clientOrderId).status).toBe("executed")
    expect(byClient.get(execProposal.clientOrderId).idempotencyKey).toBe(
      `perps:order:hyperliquid:${execProposal.clientOrderId}`
    )
    expect(byClient.get(failProposal.clientOrderId).status).toBe("failed")
    expect(byClient.get(filledProposal.clientOrderId).status).toBe("verified-filled")
    expect(byClient.get(unobservedProposal.clientOrderId).status).toBe("verify-unobserved")
    expect(list.every((p) => p.kind === "open" || p.kind === "close")).toBe(true)
    expect(list.every((p) => p.rationale && p.rationale.length >= 12)).toBe(true)

    const closeRow = list.find((p) => p.kind === "close")
    expect(closeRow).toBeTruthy()
    expect(closeRow.status).toBe("executed")
    expect(closeRow.positionId).toBe(position.id)
    expect(closeRow.idempotencyKey).toBe(
      `perps:close:hyperliquid:${position.id}:${closeClientOrderIdFor(position.id)}`
    )
  })
})