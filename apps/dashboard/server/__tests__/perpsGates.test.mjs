import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import {
  PERPS_GATE_ORDER,
  evaluatePerpsGate
} from "../services/commandCentre/perpsGates.mjs"

// Environment lease for the env-configurable caps (read at call time).
const ENV_KEYS = [
  "PICC_CCXT_LEVERAGE_MIN",
  "PICC_CCXT_LEVERAGE_MAX",
  "PICC_CCXT_MARGIN_PER_POSITION_CAP_USD",
  "PICC_CCXT_PERPS_MAX_OPEN_POSITIONS",
  "PICC_CCXT_FUNDING_STALE_MS"
]
let envSnapshot = {}
let auditEvents = []

const template = () => ({ site: "trading:perps" })

// Clean OPEN proposal: leverage 4 in-band, margin = 40/4 = 10.00 (at the cap).
function cleanProposal(overrides = {}) {
  return {
    action: "perps:open-order",
    leverage: 4,
    notionalUsd: 40,
    marginMode: "isolated",
    reduceOnly: false,
    ...overrides
  }
}

// Clean observations: post-action net positions leave room under the default
// max of 1, funding observed a minute ago (fresh inside the 2h window).
function cleanObservation(overrides = {}) {
  return {
    leverage: 4,
    notionalUsd: 40,
    marginMode: "isolated",
    openNetPositions: 0,
    funding: { rate: 0.0001, at: Date.now() - 60_000 },
    ...overrides
  }
}

// Reduce-only CLOSE proposal (R4.2 close semantics): gate 11 reads the
// position record's DECLARED leverage; gates 12/14 evaluate the post-close
// state; gate 15 still requires fresh funding.
function closeProposal(overrides = {}) {
  return {
    action: "perps:close-order",
    positionLeverage: 4,
    notionalUsd: 0,
    marginMode: "isolated",
    reduceOnly: true,
    ...overrides
  }
}

function auditCollector() {
  return (e) => auditEvents.push(e)
}

beforeEach(() => {
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

describe("perps gates — contract surface", () => {
  test("PERPS_GATE_ORDER is the fixed 11→15 cascade", () => {
    expect(PERPS_GATE_ORDER).toEqual([
      "perps-leverage-band",
      "perps-margin-cap",
      "perps-isolated-only",
      "perps-position-cap",
      "perps-funding-fresh"
    ])
  })

  test("module-import assertion: perpsGates.mjs does NOT import the safety sidecar", () => {
    const src = readFileSync(
      new URL("../services/commandCentre/perpsGates.mjs", import.meta.url),
      "utf8"
    )
    expect(src).not.toContain("safetySidecar")
    expect(src).not.toContain("safety-sidecar")
  })
})

describe("perps gate 11 — perps-leverage-band", () => {
  test("leverage 4 (in [3,5]) is allowed with blockedBy null", () => {
    const r = evaluatePerpsGate({ template: template(), proposal: cleanProposal(), observation: cleanObservation() })
    expect(r.allow).toBe(true)
    expect(r.blockedBy).toBeNull()
  })

  test("leverage 2 is denied naming perps-leverage-band", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ leverage: 2 }),
      observation: cleanObservation({ leverage: 2 })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-leverage-band")
  })

  test("leverage 6 is denied naming perps-leverage-band", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ leverage: 6 }),
      observation: cleanObservation({ leverage: 6 })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-leverage-band")
  })

  test("absent / NaN leverage is denied", () => {
    for (const leverage of [undefined, NaN, "four"]) {
      const r = evaluatePerpsGate({
        template: template(),
        proposal: cleanProposal({ leverage }),
        observation: cleanObservation()
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("perps-leverage-band")
    }
  })

  test("reduce-only close reads the position record's declared leverage (gate 11)", () => {
    const bad = evaluatePerpsGate({
      template: template(),
      proposal: closeProposal({ positionLeverage: 6 }),
      observation: cleanObservation()
    })
    expect(bad.allow).toBe(false)
    expect(bad.blockedBy).toBe("perps-leverage-band")
    const good = evaluatePerpsGate({
      template: template(),
      proposal: closeProposal({ positionLeverage: 4 }),
      observation: cleanObservation()
    })
    expect(good.allow).toBe(true)
  })
})

describe("perps gate 12 — perps-margin-cap", () => {
  test("implied margin exactly at the cap (10.00) is allowed", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ leverage: 4, notionalUsd: 40 }),
      observation: cleanObservation()
    })
    expect(r.allow).toBe(true)
  })

  test("implied margin over the cap (10.01) is denied naming perps-margin-cap", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ leverage: 4, notionalUsd: 40.04 }),
      observation: cleanObservation()
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-margin-cap")
  })

  test("first open from a flat book uses the ORDER's implied margin (proposal notional), not the pre-action book — denies over-cap", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ notionalUsd: 100000 }),
      observation: cleanObservation({ notionalUsd: 0 })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-margin-cap")
    expect(r.reason).toContain("25000")
  })

  test("reduce-only close with any margin passes gate 12 (post-close zero exposure)", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: closeProposal({ notionalUsd: 999 }),
      observation: cleanObservation({ notionalUsd: 999 })
    })
    expect(r.allow).toBe(true)
  })

  test("env cap is honored: PICC_CCXT_MARGIN_PER_POSITION_CAP_USD=25 allows margin 20", () => {
    process.env.PICC_CCXT_MARGIN_PER_POSITION_CAP_USD = "25"
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ leverage: 4, notionalUsd: 80 }),
      observation: cleanObservation()
    })
    expect(r.allow).toBe(true)
  })
})

describe("perps gate 13 — perps-isolated-only", () => {
  test("marginMode isolated is allowed", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ marginMode: "isolated" }),
      observation: cleanObservation({ marginMode: "isolated" })
    })
    expect(r.allow).toBe(true)
  })

  test("marginMode cross is denied naming perps-isolated-only", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ marginMode: "cross" }),
      observation: cleanObservation({ marginMode: "cross" })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-isolated-only")
  })
})

describe("perps gate 14 — perps-position-cap", () => {
  test("openNetPositions 0 with max 1 → allowed", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation({ openNetPositions: 0 })
    })
    expect(r.allow).toBe(true)
  })

  test("openNetPositions at the cap (1 === max) → denied naming perps-position-cap", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation({ openNetPositions: 1 })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-position-cap")
  })

  test("reduce-only close with openNetPositions 1 → allowed (post-close count drops)", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: closeProposal(),
      observation: cleanObservation({ openNetPositions: 1 })
    })
    expect(r.allow).toBe(true)
  })

  test("env cap is honored: PICC_CCXT_PERPS_MAX_OPEN_POSITIONS=2 allows an open at 1", () => {
    process.env.PICC_CCXT_PERPS_MAX_OPEN_POSITIONS = "2"
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation({ openNetPositions: 1 })
    })
    expect(r.allow).toBe(true)
  })
})

describe("perps gate 15 — perps-funding-fresh", () => {
  test("funding observed within the 2h window → allowed", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation({ funding: { rate: 0.0001, at: Date.now() - 60_000 } })
    })
    expect(r.allow).toBe(true)
  })

  test("stale funding (older than the window) is denied naming perps-funding-fresh with the observed age", () => {
    const at = Date.now() - 3 * 60 * 60 * 1000
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation({ funding: { rate: 0.0001, at } })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-funding-fresh")
    const m = r.reason.match(/observed age (\d+)ms/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeGreaterThanOrEqual(3 * 60 * 60 * 1000)
  })

  test("funding null is denied naming absent funding, even for a reduce-only close", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: closeProposal(),
      observation: cleanObservation({ funding: null })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-funding-fresh")
    expect(r.reason).toMatch(/absent|no funding/i)
  })

  test("staleness window is env-configurable: 1h-old observation denied at 30min, allowed at 2h", () => {
    const at = Date.now() - 60 * 60 * 1000
    process.env.PICC_CCXT_FUNDING_STALE_MS = String(30 * 60 * 1000)
    const denied = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation({ funding: { rate: 0.0001, at } })
    })
    expect(denied.allow).toBe(false)
    expect(denied.blockedBy).toBe("perps-funding-fresh")

    delete process.env.PICC_CCXT_FUNDING_STALE_MS
    const allowed = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation({ funding: { rate: 0.0001, at } })
    })
    expect(allowed.allow).toBe(true)
  })
})

describe("perps gates — cascade + audit", () => {
  test("cascade stops at the FIRST deny: leverage 6 + over-cap + cross reports only perps-leverage-band", () => {
    const r = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({
        leverage: 6,
        marginMode: "cross",
        notionalUsd: 999
      }),
      observation: cleanObservation({
        leverage: 6,
        marginMode: "cross",
        notionalUsd: 999
      }),
      audit: auditCollector()
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("perps-leverage-band")
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].kind).toBe("safety-gate:deny")
    expect(auditEvents[0].data.blockedBy).toBe("perps-leverage-band")
  })

  test("a deny audits safety-gate:deny with the blockedBy name and the reason", () => {
    evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ marginMode: "cross" }),
      observation: cleanObservation({ marginMode: "cross" }),
      audit: auditCollector()
    })
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].kind).toBe("safety-gate:deny")
    expect(auditEvents[0].site).toBe("trading:perps")
    expect(auditEvents[0].data.action).toBe("perps:open-order")
    expect(auditEvents[0].data.blockedBy).toBe("perps-isolated-only")
    expect(typeof auditEvents[0].data.reason).toBe("string")
    expect(auditEvents[0].data.reason.length).toBeGreaterThan(0)
  })

  test("an all-clean proposal audits exactly ONE safety-gate:allow", () => {
    evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal(),
      observation: cleanObservation(),
      audit: auditCollector()
    })
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].kind).toBe("safety-gate:allow")
    expect(auditEvents[0].data.blockedBy).toBeNull()
  })

  test("audit omitted → decision returned, no throw (audit is wiring, not flow)", () => {
    expect(() =>
      evaluatePerpsGate({ template: template(), proposal: cleanProposal(), observation: cleanObservation() })
    ).not.toThrow()
    const denied = evaluatePerpsGate({
      template: template(),
      proposal: cleanProposal({ leverage: 1 }),
      observation: cleanObservation({ leverage: 1 })
    })
    expect(denied.allow).toBe(false)
    expect(denied.blockedBy).toBe("perps-leverage-band")
  })
})

describe("perps gates — invalid environment is an explicit deny, never a silent fallback", () => {
  test("LEVERAGE_MIN > LEVERAGE_MAX → invalid-environment naming the vars", () => {
    process.env.PICC_CCXT_LEVERAGE_MIN = "7"
    process.env.PICC_CCXT_LEVERAGE_MAX = "3"
    const r = evaluatePerpsGate({ template: template(), proposal: cleanProposal(), observation: cleanObservation() })
    expect(r.allow).toBe(false)
    expect(r.reason).toContain("invalid-environment")
    expect(r.reason).toContain("PICC_CCXT_LEVERAGE_MIN")
  })

  test("garbage on the margin cap → invalid-environment naming the var on gate 12", () => {
    process.env.PICC_CCXT_MARGIN_PER_POSITION_CAP_USD = "ten-bucks"
    const r = evaluatePerpsGate({ template: template(), proposal: cleanProposal(), observation: cleanObservation() })
    expect(r.allow).toBe(false)
    expect(r.reason).toContain("invalid-environment")
    expect(r.reason).toContain("PICC_CCXT_MARGIN_PER_POSITION_CAP_USD")
  })

  test("garbage on the funding-staleness window → invalid-environment naming the var on gate 15", () => {
    process.env.PICC_CCXT_FUNDING_STALE_MS = "recently"
    const r = evaluatePerpsGate({ template: template(), proposal: cleanProposal(), observation: cleanObservation() })
    expect(r.allow).toBe(false)
    expect(r.reason).toContain("invalid-environment")
    expect(r.reason).toContain("PICC_CCXT_FUNDING_STALE_MS")
  })
})
