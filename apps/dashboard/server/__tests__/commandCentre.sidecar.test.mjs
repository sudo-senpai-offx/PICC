import { beforeEach, describe, expect, test } from "vitest"
import {
  GATE_ORDER,
  MIN_RATIONALE_LENGTH,
  _resetSidecarState,
  clearTakeover,
  crossSiteHaltState,
  evaluateGate,
  humanTakeover,
  noteBreakerTrip,
  takeoverState,
  wireAuditReader,
  wireKillSwitchReader
} from "../services/commandCentre/safetySidecar.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"
import { dayKeyOf } from "../services/u4faRisk.mjs"

const ccxt = () => templateForSite("trading:ccxt")
const bandwidth = () => templateForSite("bandwidth:browser")
const expertoption = () => templateForSite("expertoption")

const DAY_MS = 24 * 60 * 60 * 1000

function greenState(overrides = {}) {
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

function greenProposal(overrides = {}) {
  return {
    action: "ccxt:limit-buy",
    live: true,
    exposureUsd: 5,
    rationale: "verified trend + entry within stop budget (deterministic gates green)",
    idempotencyKey: "buy-btc-2026-09-05T00:00:00Z-ab12cd34",
    ...overrides
  }
}

let auditEvents = []
function auditCollector() {
  return (e) => auditEvents.push(e)
}

beforeEach(() => {
  _resetSidecarState()
  wireAuditReader(null)
  wireKillSwitchReader(null)
  auditEvents = []
})

describe("Command Centre — Safety Sidecar: gate order (the contract)", () => {
  test("GATE_ORDER matches the spec's fixed pre-action sequence exactly", () => {
    expect(GATE_ORDER).toEqual([
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
  })
})

describe("Command Centre — Safety Sidecar: allow path", () => {
  test("fully green live action passes with a reason", () => {
    const r = evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState(), audit: auditCollector() })
    expect(r.allow).toBe(true)
    expect(r.blockedBy).toBeNull()
    expect(r.reason).toContain("gate passed")
  })

  test("demo execution passes on a demoOnly template (expertoption surface)", () => {
    const r = evaluateGate({
      template: expertoption(),
      proposal: greenProposal({ action: "eo:demo-trade", live: false }),
      state: greenState(),
      audit: auditCollector()
    })
    expect(r.allow).toBe(true)
  })

  test("envelope ceiling is the site's own template (null = n/a fields never block)", () => {
    const r = evaluateGate({
      template: expertoption(),
      proposal: greenProposal({ action: "eo:demo-trade", live: false, exposureUsd: 999 }),
      state: greenState({ concurrentUnits: 0 }),
      audit: auditCollector()
    })
    // expertoption envelope: maxExposureUsd null (demo credits) — 999 passes, no fabricated cap
    expect(r.allow).toBe(true)
  })
})

describe("Command Centre — Safety Sidecar: each gate in order", () => {
  test("kill switch", () => {
    const r = evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState({ killSwitch: true }) })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("kill-switch")
  })

  test("cross-site day halt — a breaker on ANY site halts every site for the UTC day", () => {
    noteBreakerTrip("trading:ccxt", "dailyLoss")
    const r = evaluateGate({ template: bandwidth(), proposal: greenProposal({ action: "bandwidth:claim-payout" }), state: greenState() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("cross-site-day-halt")
    expect(r.reason).toContain("trading:ccxt")
  })

  test("cross-site halt is day-scoped — next UTC day the gate opens again", () => {
    const now = Date.now()
    noteBreakerTrip("trading:ccxt", "dailyLoss", { now })
    const nextDay = now + DAY_MS
    const r = evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState({ now: nextDay }) })
    expect(r.allow).toBe(true)
  })

  test("human takeover (5B) denies everything until clearTakeover", () => {
    humanTakeover()
    expect(takeoverState()).not.toBeNull()
    const r = evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("human-takeover")
    clearTakeover()
    const again = evaluateGate({ template: ccxt(), proposal: greenProposal({ idempotencyKey: "new-key-after-rearm-xyz" }), state: greenState() })
    expect(again.allow).toBe(true) // re-entry = a full gate pass
  })

  test("re-entry after takeover is a FULL gate pass — a proposal failing another gate is still denied", () => {
    humanTakeover()
    clearTakeover()
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ rationale: "short" }),
      state: greenState()
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("rationale-renderable")
  })

  test("live action without per-site opt-in", () => {
    const r = evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState({ optIn: false }) })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("per-site-opt-in")
  })

  test("each hard breaker is named", () => {
    for (const b of ["dailyLossHalted", "regimeHalted", "siteCapped"]) {
      const r = evaluateGate({
        template: ccxt(),
        proposal: greenProposal(),
        state: greenState({ breakers: { [b]: true } })
      })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("hard-breakers")
      expect(r.reason.length).toBeGreaterThan(0)
    }
  })

  test("stale mandatory feed (5E)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal(),
      state: greenState({ staleFeeds: [{ name: "price", ageSec: 300, maxAgeSec: 60 }] })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("fresh-data")
    expect(r.reason).toContain("price")
  })

  test("forbidden venue live action (5C)", () => {
    const r = evaluateGate({ template: expertoption(), proposal: greenProposal(), state: greenState() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
  })

  test("gray venue live action (5C) — proposals only", () => {
    const r = evaluateGate({ template: bandwidth(), proposal: greenProposal(), state: greenState() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
    expect(r.reason).toContain("gray")
  })

  test("demo surface on a non-demoOnly site is denied", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ live: false, action: "demo-trade" }),
      state: greenState()
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
    expect(r.reason).toContain("demo surface not permitted")
  })

  test("envelope: single exposure over ceiling (5D)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ exposureUsd: 11 }),
      state: greenState()
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("envelope-within-ceiling")
    expect(r.reason).toContain("$11")
  })

  test("envelope: concurrent units at ceiling (5D)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal(),
      state: greenState({ concurrentUnits: 2 })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("envelope-within-ceiling")
  })

  test("envelope: cross-site daily-loss over ceiling (5D)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal(),
      state: greenState({ dayLossPct: 6 })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("envelope-within-ceiling")
    expect(r.reason).toContain("6%")
  })

  test("rationale below the minimum (5F)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ rationale: "yolo" }),
      state: greenState()
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("rationale-renderable")
  })

  test("rationale exactly at the minimum passes (5F boundary)", () => {
    const longEnough = "x".repeat(MIN_RATIONALE_LENGTH)
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ rationale: longEnough }),
      state: greenState()
    })
    expect(r.allow).toBe(true)
  })
})

describe("Command Centre — Safety Sidecar: 5G idempotency (double-claim race)", () => {
  test("same idempotency key twice in memory → second is denied", () => {
    const p = greenProposal()
    const first = evaluateGate({ template: ccxt(), proposal: p, state: greenState() })
    expect(first.allow).toBe(true)
    const second = evaluateGate({ template: ccxt(), proposal: p, state: greenState() })
    expect(second.allow).toBe(false)
    expect(second.blockedBy).toBe("idempotent")
  })

  test("missing / short idempotency key is denied — repeat actions must be provably unique", () => {
    for (const key of [undefined, "short"]) {
      const r = evaluateGate({ template: ccxt(), proposal: greenProposal({ idempotencyKey: key }), state: greenState() })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("idempotent")
    }
  })

  test("idempotency survives restarts via the audit trail when a reader is wired", () => {
    const p = greenProposal({ idempotencyKey: "claim-hg-2026-09-05-aa11" })
    const durable = [{ seq: 1, kind: "safety-gate:allow", data: { idempotencyKey: p.idempotencyKey } }]
    wireAuditReader(() => durable)
    const r = evaluateGate({ template: ccxt(), proposal: p, state: greenState() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("idempotent")
  })

  test("audit reader that throws → conservative deny (can never double-fire)", () => {
    const p = greenProposal({ idempotencyKey: "claim-x-2026-09-05-bb22" })
    wireAuditReader(() => {
      throw new Error("ledger unavailable")
    })
    const r = evaluateGate({ template: ccxt(), proposal: p, state: greenState() })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("idempotent")
  })
})

describe("Command Centre — Safety Sidecar: 5A execution-power separation (audit always on)", () => {
  test("every decision — allow AND deny — is audited", () => {
    evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState(), audit: auditCollector() })
    evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState({ killSwitch: true }), audit: auditCollector() })
    expect(auditEvents.map((e) => e.kind)).toEqual(["safety-gate:allow", "safety-gate:deny"])
  })

  test("loosening the risk envelope never silences the recorded why (5A)", () => {
    const loosened = { ...ccxt(), envelope: { ...ccxt().envelope, maxExposureUsd: 100000 } }
    evaluateGate({
      template: loosened,
      proposal: greenProposal({ exposureUsd: 50000 }),
      state: greenState(),
      audit: auditCollector()
    })
    expect(auditEvents.length).toBe(1)
    expect(auditEvents[0].kind).toBe("safety-gate:allow")
    expect(auditEvents[0].data.action).toBe("ccxt:limit-buy")
  })

  test("deny without an injected audit fn still returns the blocked reason (audit is wiring, not flow)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ rationale: "no" }),
      state: greenState()
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("rationale-renderable")
  })
})

describe("Command Centre — Safety Sidecar: cross-site halt state", () => {
  test("noteBreakerTrip records site + breaker + day key", () => {
    const now = Date.now()
    const h = noteBreakerTrip("trading:ccxt", "dailyLoss", { now })
    expect(h.site).toBe("trading:ccxt")
    expect(h.breaker).toBe("dailyLoss")
    expect(h.dayKey).toBe(dayKeyOf(now))
    expect(crossSiteHaltState()).toEqual(h)
  })

  test("reset clears the halt", () => {
    noteBreakerTrip("trading:ccxt", "regimeHalted")
    _resetSidecarState()
    expect(crossSiteHaltState()).toBeNull()
  })
})

describe("Command Centre — Safety Sidecar: wired kill-switch reader (the enforcement seam)", () => {
  test("the reader's kill is enforced even when the per-call state says off — one switch, two reads", () => {
    wireKillSwitchReader(() => true)
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal(),
      state: greenState({ killSwitch: false })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("kill-switch")
  })

  test("a throwing reader reads as KILL — cannot prove it is off, so it is denied (fail-safe)", () => {
    wireKillSwitchReader(() => {
      throw new Error("store unreadable")
    })
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal(),
      state: greenState({ killSwitch: false })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("kill-switch")
  })

  test("a reader reporting no kill leaves the explicit state argument authoritative", () => {
    wireKillSwitchReader(() => false)
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal(),
      state: greenState({ killSwitch: false })
    })
    expect(r.allow).toBe(true)
  })

  test("unwiring the reader restores state-only behavior", () => {
    wireKillSwitchReader(() => true)
    wireKillSwitchReader(null)
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal(),
      state: greenState({ killSwitch: false })
    })
    expect(r.allow).toBe(true)
  })
})

describe("Command Centre — Safety Sidecar: execution power (slice 5 approved-claim leg)", () => {
  // bandwidth:browser is gray (5C) → COPILOT only. The claim executes on FRESH
  // per-action human consent (consentBy), which is NOT an automation opt-in.
  function claimProposal(overrides = {}) {
    return greenProposal({
      action: "bandwidth:payout-claim",
      power: "proposals",
      consentBy: "usr_claim_01",
      exposureUsd: 25,
      idempotencyKey: "bandwidth:claim:traffmonetizer:2026-09-05-aabbcc",
      ...overrides
    })
  }

  test("gray venue + proposals power with fresh human consent passes the FULL gate (approved-claim leg)", () => {
    const r = evaluateGate({ template: bandwidth(), proposal: claimProposal(), state: greenState({ optIn: false }), audit: auditCollector() })
    expect(r.allow).toBe(true)
    expect(r.reason).toContain("gate passed")
  })

  test("proposals leg WITHOUT consent is denied at opt-in — consent is required, and is NOT an opt-in", () => {
    const r = evaluateGate({
      template: bandwidth(),
      proposal: claimProposal({ consentBy: undefined }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("per-site-opt-in")
    expect(r.reason).toContain("consent")
  })

  test("gray venue + live power is denied even WITH a standing opt-in — proposals only (5C)", () => {
    const r = evaluateGate({
      template: bandwidth(),
      proposal: claimProposal({ power: "live" }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
    expect(r.reason).toContain("proposals only")
  })

  test("gray venue + liveDemo power is denied (no demo surface on a gray site)", () => {
    const r = evaluateGate({
      template: bandwidth(),
      proposal: claimProposal({ power: "liveDemo" }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
  })

  test("sanctioned + live power passes with a standing opt-in (the ccxt leg, slice 6 pattern)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ power: "live" }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(true)
  })

  test("sanctioned + live power WITHOUT a standing opt-in is denied at per-site-opt-in", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ power: "live" }),
      state: greenState({ optIn: false })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("per-site-opt-in")
  })

  test("forbidden venue + liveDemo on a demoOnly template passes (the recorded demo exception)", () => {
    const r = evaluateGate({
      template: expertoption(),
      proposal: greenProposal({ action: "eo:demo-trade", power: "liveDemo" }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(true)
  })

  test("forbidden venue + proposals on a demoOnly template passes (demo proposals are the demo surface)", () => {
    const r = evaluateGate({
      template: expertoption(),
      proposal: greenProposal({ action: "eo:demo-trade", power: "proposals", consentBy: "usr_demo_01" }),
      state: greenState({ optIn: false })
    })
    expect(r.allow).toBe(true)
  })

  test("forbidden venue + live power is denied (5C truth table)", () => {
    const r = evaluateGate({
      template: expertoption(),
      proposal: greenProposal({ action: "eo:live-trade", power: "live" }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
  })

  test("sanctioned site with liveDemo power is denied (demo surface only on demo sites)", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ power: "liveDemo" }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
  })

  test("an action declaring zero execution power is denied — nothing to gate or run", () => {
    const r = evaluateGate({
      template: ccxt(),
      proposal: greenProposal({ power: "none" }),
      state: greenState({ optIn: true })
    })
    expect(r.allow).toBe(false)
    expect(r.blockedBy).toBe("toS-survival")
    expect(r.reason).toContain("zero execution power")
  })

  test("the allow audit event records the power + the consent identity (5A separation intact)", () => {
    evaluateGate({ template: bandwidth(), proposal: claimProposal(), state: greenState({ optIn: false }), audit: auditCollector() })
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].kind).toBe("safety-gate:allow")
    expect(auditEvents[0].data.power).toBe("proposals")
    expect(auditEvents[0].data.consentBy).toBe("usr_claim_01")
  })

  test("legacy proposals (no power field) keep today's exact semantics", () => {
    // gray + legacy live → proposals-only deny (unchanged)
    const grayLive = evaluateGate({ template: bandwidth(), proposal: greenProposal(), state: greenState() })
    expect(grayLive.allow).toBe(false)
    expect(grayLive.blockedBy).toBe("toS-survival")
    // sanctioned legacy live + opt-in → allow (unchanged)
    const ccxtLive = evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
    expect(ccxtLive.allow).toBe(true)
  })
})