// WS-7 T11 — the risk layer producer, and the engine entry point.
//
// Plan v1 §3.1 item 9: "The risk layer's two missing capabilities exist,
// because Risk's `RISK_COMPLETION.pendingScope` names T11 for exactly these
// (`terminal/routes/RiskRoom.tsx:100`): the 2% **daily** drawdown disable and
// the 3-strike 24h key lock. `riskLayer.ts:141-150` and `:204-206` record
// precisely what may **not** be substituted — `v32Copilot.SESSION_HALT_FLOOR_PCT`
// (a -2% *session* halt) and `u4faRisk`'s -5% *daily* limit are near-misses, and
// wiring either under the spec's label is the fabrication. Tests must assert the
// real counter and lock store exist and that the daily figure (not the session
// figure) is the disable's input, per `riskLayer.ts:131-137`."

import { describe, expect, it } from "vitest"

import { SESSION_HALT_FLOOR_PCT } from "../../v32Copilot.mjs"
import { evaluateCopilot, enabledRooms, isEngineEnabledForRoom } from "../engine.mjs"
import { createVetoIndex, VETO_RULE_IDS } from "../vetoIndex.mjs"
import {
  ATR_STOP_MULTIPLE,
  DAILY_DRAWDOWN_DISABLE_PCT,
  KEY_LOCK_MS,
  THREE_STRIKE_LIMIT,
  atrStop,
  createStrikeStore,
  dailyDrawdownDisable,
  strikeStateUnavailable
} from "../riskLayer.mjs"
import { fullMarketState } from "./fixtures/marketFixtures.mjs"

const at = (h, m = 0) => Date.UTC(2026, 2, 10, h, m)

describe("§4.4:695 — ATR(14) stop at 1.5x", () => {
  it("multiplies the observed ATR by exactly 1.5", () => {
    expect(ATR_STOP_MULTIPLE).toBe(1.5)
  })

  it("returns 1.5x the ATR the shared indicator computes", () => {
    const candles = fullMarketState().candles
    const r = atrStop(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      candles.map((c) => c.close)
    )
    expect(r.available).toBe(true)
    expect(r.stopDistance).toBeCloseTo(r.atr * 1.5, 12)
  })

  it("is unavailable, not zero, when ATR has not warmed up", () => {
    const r = atrStop([1], [1], [1])
    expect(r.available).toBe(false)
    expect(r.stopDistance).toBeNull()
    expect(r.unavailableReason).toContain("ATR")
  })
})

describe("§4.4:695 — the 2% DAILY drawdown disable", () => {
  it("is 2%, and is neither the session halt nor u4faRisk's 5%", () => {
    expect(DAILY_DRAWDOWN_DISABLE_PCT).toBe(2)
    // The near-miss this design refuses. Both are 2 or 5 by coincidence of
    // magnitude; neither is a 2% DAILY rail.
    expect(SESSION_HALT_FLOOR_PCT).toBe(2)
    expect(DAILY_DRAWDOWN_DISABLE_PCT).not.toBe(5)
  })

  it("fires at and above the rail", () => {
    const base = { dayKey: "2026-03-10", observedAt: at(12), source: "test" }
    expect(dailyDrawdownDisable({ ...base, dailyDrawdownPct: 1.99 }).fired).toBe(false)
    expect(dailyDrawdownDisable({ ...base, dailyDrawdownPct: 2 }).fired).toBe(true)
    expect(dailyDrawdownDisable({ ...base, dailyDrawdownPct: 2.01 }).fired).toBe(true)
  })

  it("reads the DAILY figure and refuses the session figure as its input", () => {
    // riskLayer.ts:132-138 — the whole point of this test.
    const sessionOnly = dailyDrawdownDisable({
      sessionLossPct: 2.5,
      dayKey: "2026-03-10",
      observedAt: at(12),
      source: "test"
    })
    expect(sessionOnly.available).toBe(false)
    expect(sessionOnly.fired).toBeNull()
    expect(sessionOnly.dailyDrawdownPct).toBeNull()
    expect(sessionOnly.unavailableReason).toContain("session")
  })

  it("does not fire on a session loss that is small while the daily figure is absent", () => {
    const r = dailyDrawdownDisable({ sessionLossPct: 0.5, observedAt: at(12), source: "test" })
    expect(r.fired).toBeNull()
    expect(r.available).toBe(false)
  })

  it("carries the session figure for display without letting it decide", () => {
    // A large session loss alongside a small daily figure must NOT fire.
    const r = dailyDrawdownDisable({
      dailyDrawdownPct: 0.4,
      sessionLossPct: 9.9,
      dayKey: "2026-03-10",
      observedAt: at(12),
      source: "test"
    })
    expect(r.fired).toBe(false)
    expect(r.sessionLossPct).toBe(9.9)
    expect(r.available).toBe(true)
  })

  it("reports unavailable for no observation at all", () => {
    const r = dailyDrawdownDisable(null)
    expect(r.available).toBe(false)
    expect(r.fired).toBeNull()
  })

  it("rejects a non-finite daily figure rather than comparing against NaN", () => {
    expect(() => dailyDrawdownDisable({ dailyDrawdownPct: Number.NaN, observedAt: 0, source: "t" })).toThrow(TypeError)
  })
})

describe("§4.4:695 — the 3-strike, 24h key lock, and the counter now EXISTS", () => {
  it("uses 3 strikes and a 24h lock", () => {
    expect(THREE_STRIKE_LIMIT).toBe(3)
    expect(KEY_LOCK_MS).toBe(24 * 60 * 60 * 1000)
  })

  it("reports a real count, because the store exists", () => {
    // riskLayer.ts:202-205 rejected `strikes: 0` because no counter existed.
    // It exists now, so 0 is a real observation and null is reserved for the
    // genuinely-unwired case.
    const store = createStrikeStore()
    expect(store.readStrike("key-a", at(12)).strikes).toBe(0)
    expect(store.readStrike("key-a", at(12)).available).toBe(true)
    store.recordStrike("key-a", at(12))
    expect(store.readStrike("key-a", at(12)).strikes).toBe(1)
  })

  it("does not lock below the limit", () => {
    const store = createStrikeStore()
    store.recordStrike("k", at(12))
    store.recordStrike("k", at(13))
    const r = store.readStrike("k", at(14))
    expect(r.locked).toBe(false)
    expect(r.lockedUntil).toBeNull()
  })

  it("locks for 24h at the third strike", () => {
    const store = createStrikeStore()
    store.recordStrike("k", at(10))
    store.recordStrike("k", at(11))
    store.recordStrike("k", at(12))
    const r = store.readStrike("k", at(13))
    expect(r.locked).toBe(true)
    expect(r.lockedUntil).toBe(at(12) + KEY_LOCK_MS)
  })

  it("expires exactly 24h after the THIRD strike, not the first", () => {
    const store = createStrikeStore()
    store.recordStrike("k", at(0))
    store.recordStrike("k", at(1))
    store.recordStrike("k", at(2))
    expect(store.readStrike("k", at(2) + KEY_LOCK_MS - 1).locked).toBe(true)
    expect(store.readStrike("k", at(2) + KEY_LOCK_MS).locked).toBe(false)
    // A lock measured from the FIRST strike would have expired hours earlier.
    expect(store.readStrike("k", at(0) + KEY_LOCK_MS + 1).locked).toBe(true)
  })

  it("keeps strikes separate per key", () => {
    const store = createStrikeStore()
    store.recordStrike("k1", at(10))
    store.recordStrike("k1", at(11))
    store.recordStrike("k1", at(12))
    expect(store.readStrike("k1", at(13)).locked).toBe(true)
    expect(store.readStrike("k2", at(13)).locked).toBe(false)
    expect(store.readStrike("k2", at(13)).strikes).toBe(0)
  })

  it("is append-only — no reset, delete or clear", () => {
    const store = createStrikeStore()
    for (const forbidden of ["reset", "delete", "clear", "remove", "set", "forgive"]) {
      expect(store[forbidden], `strikeStore must not expose ${forbidden}()`).toBeUndefined()
    }
    expect(Object.isFrozen(store)).toBe(true)
  })

  it("hands every strike to an injected sink exactly once", () => {
    const seen = []
    const store = createStrikeStore({ sink: (r) => seen.push(r) })
    store.recordStrike("k", at(10))
    store.recordStrike("k", at(11))
    expect(seen).toHaveLength(2)
    expect(seen.map((r) => r.key)).toEqual(["k", "k"])
  })

  it("rejects a strike with no key or no supplied time", () => {
    const store = createStrikeStore()
    expect(() => store.recordStrike("", at(12))).toThrow(TypeError)
    expect(() => store.recordStrike(null, at(12))).toThrow(TypeError)
    // A missing time must throw rather than be filled in from a clock. The
    // signature takes `at`, so "no time" arrives as undefined — which is exactly
    // the bug this rejects.
    expect(() => store.recordStrike("k", undefined)).toThrow(/supplied finite timestamp/)
    expect(() => store.recordStrike("k", "2026-03-10")).toThrow(/supplied finite timestamp/)
    expect(() => store.readStrike("k", undefined)).toThrow(/supplied finite nowMs/)
  })

  it("still offers the honest null reading for a system with no counter wired", () => {
    // The rendering contract at riskLayer.ts:207-215 needs this and it remains
    // correct: an unwired system is not a system with zero strikes.
    const r = strikeStateUnavailable("k")
    expect(r.strikes).toBeNull()
    expect(r.strikes).not.toBe(0)
    expect(r.available).toBe(false)
  })
})

describe("the engine entry point composes the whole path", () => {
  const state = fullMarketState({
    computedAt: at(11),
    newsEvents: [],
    proposals: [{ symbol: "BTCUSD", correlationGroup: "crypto" }],
    facts: { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 }
  })

  it("returns the confluence, the vetoes, the tier and the index together", () => {
    const r = evaluateCopilot({ marketState: state, broker: { automationPermitted: true, rung: "paper" } })
    expect(r.confluence.engineVersion).toBeTruthy()
    expect(r.vetoes).toHaveLength(6)
    expect(r.tier.tier).toBeTruthy()
    expect(r.vetoIndex.size).toBe(6)
  })

  it("records all six vetoes by default, so D7's record survives the call", () => {
    const index = createVetoIndex()
    evaluateCopilot({ marketState: state, broker: { automationPermitted: false, rung: "paper" }, vetoIndex: index })
    expect(index.read().map((r) => r.ruleId)).toEqual([...VETO_RULE_IDS])
  })

  it("accumulates into a caller-supplied index across calls", () => {
    const index = createVetoIndex()
    const broker = { automationPermitted: false, rung: "paper" }
    evaluateCopilot({ marketState: state, broker, vetoIndex: index })
    evaluateCopilot({ marketState: state, broker, vetoIndex: index })
    expect(index.size).toBe(12)
  })

  it("carries the rung through untouched", () => {
    for (const rung of ["paper", "demo", "live"]) {
      const r = evaluateCopilot({ marketState: state, broker: { automationPermitted: true, rung } })
      expect(r.tier.rung).toBe(rung)
    }
  })

  it("emits no conflictOverride — T12 owns C1/C2/C3", () => {
    expect(evaluateCopilot({ marketState: state, broker: {} }).confluence.conflictOverrides).toEqual([])
  })

  it("is byte-identical across repeated calls", () => {
    const broker = { automationPermitted: true, rung: "paper" }
    const strip = (r) => JSON.stringify({ c: r.confluence, v: r.vetoes, t: r.tier })
    const first = strip(evaluateCopilot({ marketState: state, broker }))
    for (let i = 0; i < 20; i++) {
      expect(strip(evaluateCopilot({ marketState: state, broker }))).toBe(first)
    }
  })

  it("rejects a call with no market state", () => {
    expect(() => evaluateCopilot({})).toThrow(/marketState/)
  })
})

describe("spec :1298 — it can ship dark and be enabled per room", () => {
  it("is disabled for every room by default", () => {
    for (const room of ["trading:dashboard", "earnings:governor", "intelligence:guidance", "risk"]) {
      expect(isEngineEnabledForRoom(room), `${room} must ship dark`).toBe(false)
    }
  })

  it("lights up only the rooms explicitly named", () => {
    const rooms = new Set(["trading:dashboard"])
    expect(isEngineEnabledForRoom("trading:dashboard", { enabledRooms: rooms })).toBe(true)
    expect(isEngineEnabledForRoom("earnings:governor", { enabledRooms: rooms })).toBe(false)
  })

  it("reports the lit rooms, sorted and frozen", () => {
    const lit = enabledRooms({ enabledRooms: new Set(["z", "a"]) })
    expect(lit).toEqual(["a", "z"])
    expect(Object.isFrozen(lit)).toBe(true)
  })

  it("refuses an empty room key rather than defaulting one", () => {
    expect(() => isEngineEnabledForRoom("")).toThrow(TypeError)
    expect(() => isEngineEnabledForRoom(undefined)).toThrow(TypeError)
  })
})
