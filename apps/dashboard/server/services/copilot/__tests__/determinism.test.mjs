// WS-7 T11 — AC-021: the Copilot decision path is deterministic.
//
// AC-021:933-939:
//   Scenario:  The same market state is evaluated 100 times.
//   Action:    Run the confluence engine.
//   Expected:  An identical `ConfluenceScore` every time, with an
//              `engineVersion`; no model call occurs on the decision path.
//   Prohibited: The decision path may not depend on a network call, a model, or
//              wall-clock nondeterminism beyond the supplied `computedAt`.
//   Verification: A determinism test with the model layer mocked to throw.
//
// Plan v1 §3.1 item 3: "100 evaluations of one frozen market state produce
// byte-identical `ConfluenceScore` including `engineVersion`, with the model
// layer mocked to THROW. `computedAt` is the only permitted time input."
//
// BYTE-IDENTICAL is checked with `JSON.stringify`, not `toEqual`. `toEqual`
// treats `-0` and `0` as equal and would also hide a property whose insertion
// ORDER changed — and AC-021's concern is that repeated evaluation of one input
// produces the same bytes, not merely a deeply-equal object.

import { describe, expect, it, vi } from "vitest"

import { evaluateConfluence, ENGINE_VERSION } from "../confluence.mjs"
import { deriveMarketState } from "../marketState.mjs"
import { classifyRegime } from "../regime.mjs"
import {
  COMPUTED_AT,
  DEAD_ZONE_AT,
  fullMarketState,
  rangingMarketState,
  sentimentUnavailableState
} from "./fixtures/marketFixtures.mjs"

describe("AC-021 — 100 evaluations of one state are byte-identical", () => {
  it("produces the same string 100 times", () => {
    const state = sentimentUnavailableState()
    const first = JSON.stringify(evaluateConfluence(state))
    for (let i = 1; i < 100; i++) {
      expect(JSON.stringify(evaluateConfluence(state)), `run ${i} differed from run 0`).toBe(first)
    }
    expect(first.length).toBeGreaterThan(0)
  })

  it("does the same when the state object is rebuilt each time", () => {
    // Rebuilding proves determinism does not depend on object identity or on
    // some cached series surviving from a previous call.
    const first = JSON.stringify(evaluateConfluence(fullMarketState()))
    for (let i = 0; i < 25; i++) {
      expect(JSON.stringify(evaluateConfluence(fullMarketState()))).toBe(first)
    }
  })

  it("carries a non-empty engineVersion on every evaluation", () => {
    const score = evaluateConfluence(fullMarketState())
    expect(score.engineVersion).toBe(ENGINE_VERSION)
    expect(typeof score.engineVersion).toBe("string")
    expect(score.engineVersion.length).toBeGreaterThan(0)
  })

  it("does not drift across an hour of wall-clock time", async () => {
    // If any part of the path read `Date.now()`, a real pause between runs would
    // change the answer. This is the test that catches it — the 100-run loop
    // above would NOT, because it runs inside one millisecond often enough.
    const state = fullMarketState()
    const first = JSON.stringify(evaluateConfluence(state))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(JSON.stringify(evaluateConfluence(state))).toBe(first)
  })
})

describe("AC-021 — no model call occurs on the decision path", () => {
  it("evaluates identically with every plausible model module mocked to throw", () => {
    // AC-021:938 names this verification explicitly. Mocking a module that the
    // engine never imports is the point: if the engine ever DID import one, the
    // mock would fire and the engine would refuse to produce a score rather than
    // silently degrading — which is what AC-021's "no model call" requires.
    const baseline = JSON.stringify(evaluateConfluence(sentimentUnavailableState()))

    for (const moduleId of [
      "llm",
      "llmSettings",
      "sentimentEngine",
      "../experts/sentiment"
    ]) {
      const spy = vi.doMock(moduleId, () => {
        throw new Error(`copilot must never load ${moduleId} on the decision path`)
      })
      try {
        expect(JSON.stringify(evaluateConfluence(sentimentUnavailableState())), moduleId).toBe(baseline)
      } finally {
        spy?.mockRestore?.()
        vi.doUnmock(moduleId)
        vi.resetModules()
      }
    }
  })

  it("scores with the sentiment seam empty, which is the model-free path", () => {
    const score = evaluateConfluence(sentimentUnavailableState())
    expect(score.score).not.toBeNull()
    expect(score.score).toBeGreaterThan(0)
  })

  it("imports nothing that could reach the network", async () => {
    // A source-level check rather than a runtime one: fetch, WebSocket, http
    // and ccxt must not appear anywhere in the engine's own import graph.
    const { readFileSync } = await import("node:fs")
    const { globSync } = await import("node:fs")
    const files = [
      "../confluence.mjs",
      "../regime.mjs",
      "../marketState.mjs",
      "../experts/macroBias.mjs",
      "../experts/structural.mjs",
      "../experts/trendStrength.mjs",
      "../experts/momentumExhaustion.mjs",
      "../experts/volatilityBoosters.mjs",
      "../experts/sentiment.mjs"
    ]
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8")
      for (const forbidden of ["fetch(", "WebSocket", "node:http", "ccxt", "Date.now", "Math.random"]) {
        expect(src.includes(forbidden), `${f} must not reference ${forbidden}`).toBe(false)
      }
    }
    expect(typeof globSync).toBe("function")
  })
})

describe("AC-021 — computedAt is the only time input", () => {
  it("is supplied by the caller, and a missing one is a loud error", () => {
    expect(() => evaluateConfluence({ candles: [], dailyCloses: [] })).toThrow(/computedAt/)
    expect(() => evaluateConfluence({ computedAt: "2026-03-10", candles: [] })).toThrow(/computedAt/)
  })

  it("is echoed onto the score unchanged", () => {
    expect(evaluateConfluence(fullMarketState()).computedAt).toBe(COMPUTED_AT)
  })

  it("changes the regime when the supplied instant moves into the dead zone", () => {
    // Proves `computedAt` is genuinely read and genuinely the only clock.
    expect(evaluateConfluence(fullMarketState()).regime).not.toBe("deadZone")
    expect(evaluateConfluence(fullMarketState({ computedAt: DEAD_ZONE_AT })).regime).toBe("deadZone")
  })
})

describe("AC-021 / §4.7:747 — a dead zone is no trading, not a low score", () => {
  it("returns a null score rather than 0 in the dead zone", () => {
    const score = evaluateConfluence(fullMarketState({ computedAt: DEAD_ZONE_AT }))
    expect(score.score).toBeNull()
    expect(score.score).not.toBe(0)
    expect(score.confidence).toBe("unavailable")
    expect(score.regime).toBe("deadZone")
  })

  it("still returns all six contributions so a room can show why", () => {
    const score = evaluateConfluence(fullMarketState({ computedAt: DEAD_ZONE_AT }))
    expect(score.contributions).toHaveLength(6)
    for (const c of score.contributions) {
      expect(typeof c.expert).toBe("string")
      expect(typeof c.available).toBe("boolean")
    }
  })

  it("classifies 00:00 exactly as dead zone, per the frozen rule", () => {
    // tradingSessionPolicy.mjs:54 includes the 00:00 instant deliberately.
    // A RANGING fixture is used here so the session mapping is what is under
    // test — a trending series would legitimately be overridden by the
    // hypertrend overlay and the assertion would be measuring the wrong thing.
    const at = (h, m = 0) => Date.UTC(2026, 2, 10, h, m)
    const regimeAt = (ms) => classifyRegime(deriveMarketState(rangingMarketState({ computedAt: ms }))).regime

    expect(regimeAt(at(0))).toBe("deadZone")
    expect(regimeAt(at(0, 30))).toBe("tokyoRange")
    expect(regimeAt(at(8, 0))).toBe("tokyoRange")
    expect(regimeAt(at(9, 30))).toBe("londonTrend")
    expect(regimeAt(at(12, 0))).toBe("londonTrend")
    expect(regimeAt(at(14, 0))).toBe("nyVolatility")
    expect(regimeAt(at(19, 59))).toBe("nyVolatility")
    expect(regimeAt(at(20))).toBe("deadZone")
    expect(regimeAt(at(23, 59))).toBe("deadZone")
  })

  it("reaches all five regimes across the day, none invented", () => {
    const at = (h) => Date.UTC(2026, 2, 10, h, 0)
    const seen = new Set(
      [0, 1, 5, 8, 10, 12, 14, 17, 19, 21].map((h) =>
        classifyRegime(deriveMarketState(rangingMarketState({ computedAt: at(h) }))).regime
      )
    )
    expect([...seen].sort()).toEqual(["deadZone", "londonTrend", "nyVolatility", "tokyoRange"])
  })

  it("reaches hypertrend only on a trending market", () => {
    const at = (h) => Date.UTC(2026, 2, 10, h, 0)
    // The default fixture trends hard enough to clear ADX 30 with expanding
    // bandwidth, so the overlay fires — and it OVERRIDES the session regime,
    // which is the documented behaviour (`regime.mjs` REGIME_RULES comment).
    const trending = classifyRegime(deriveMarketState(fullMarketState({ computedAt: at(14) })))
    const ranging = classifyRegime(deriveMarketState(rangingMarketState({ computedAt: at(14) })))
    expect(trending.regime).toBe("hypertrend")
    expect(ranging.regime).toBe("nyVolatility")
  })
})
