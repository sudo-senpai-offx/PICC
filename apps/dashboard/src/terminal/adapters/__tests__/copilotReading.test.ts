// WS-7 T7R-B — the client seam, proven against the REAL engine.
//
// WHY THIS TEST SHAPE. The obvious test for an adapter that projects a server
// response is to hand it an object literal and assert it comes out the other
// side. That test would pass happily against a projection written to agree with
// a bug, because the literal and the projection would share the same author's
// mistake.
//
// So this file does not build the payload. It runs the real decision service
// (`services/copilot/decision.mjs`), which runs the real engine
// (`services/copilot/engine.mjs`), over a deterministic injected series, and
// projects THAT. If the engine's shape changes, this test fails rather than
// quietly agreeing.
//
// The HTTP layer is exercised for real too: `fetchCopilotReading` is driven
// through the actual route handler over the actual req/res seam, so the path,
// the status handling and the projection are all under test together.

import { describe, expect, it } from "vitest"
import { copilotDecisionForAsset } from "../../../../server/services/copilot/decision.mjs"
import { fetchCopilotReading, projectDecision, projectRisk } from "../copilotReading"

const AT = Date.UTC(2023, 10, 14, 13, 0, 0)

/** A deterministic ramp — the same shape the server-side test uses. */
function ramp(n: number, { start = 1.08, step = 0.0004 } = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    const close = start + step * i
    out.push({
      time: AT - (n - 1 - i) * 60_000,
      open: close - step / 2,
      high: close + Math.abs(step),
      low: close - Math.abs(step),
      close,
      volume: 1000
    })
  }
  return out
}

const broker = {
  fetchCandles: async (_assetId: string, { timeframe }: { timeframe: number }) => {
    if (timeframe === 14400) return { candles: ramp(200), source: "test-broker" }
    if (timeframe === 86400) return { candles: ramp(420, { step: 0.002 }), source: "test-broker" }
    return { candles: ramp(240), source: "test-broker" }
  }
}

/** A REAL engine result, produced by running the engine. */
async function realDecision() {
  return copilotDecisionForAsset({ assetId: "EURUSD", ...broker })
}

/** A `fetch` stand-in that answers with a status and a body. */
function jsonFetch(status: number, body: unknown) {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    })
}

describe("WS-7 T7R-B — the client projects the REAL engine's output", () => {
  it("carries a real score, six contributions and the fired vetoes through", async () => {
    const decision = await realDecision()
    const reading = projectDecision("EURUSD", decision as never)

    // Every one of these came out of the engine, not out of this file.
    expect(reading.confluence).not.toBeNull()
    expect(reading.confluence!.score).toBe(decision.confluence!.score)
    expect(reading.confluence!.contributions).toHaveLength(6)
    expect(reading.confluence!.regime).toBe(decision.confluence!.regime)
    expect(reading.confluence!.computedAt).toBe(AT)
    expect(reading.engineVersion).toMatch(/^copilot-engine\//)

    // The vetoes that actually fired, each with the suppression it names.
    expect(reading.vetoes.length).toBe(decision.firedVetoes.length)
    for (const v of reading.vetoes) {
      expect(typeof v.ruleId).toBe("string")
      expect(typeof v.suppressed).toBe("string")
    }
    expect(reading.vetoes.some((v) => v.ruleId === "sessionOpen")).toBe(true)
  })

  it("preserves each unavailable expert's reason rather than flattening it to zero", async () => {
    const decision = await realDecision()
    const reading = projectDecision("EURUSD", decision as never)

    const sentiment = reading.confluence!.contributions.find((c) => c.expert === "sentiment")
    expect(sentiment).toBeDefined()
    // T13 supplies the 5% input and nothing does. The reason must survive the
    // projection intact — it is what tells a reader the leg is cold rather than
    // scoring zero.
    expect(sentiment!.available).toBe(false)
    expect(sentiment!.rawDelta).toBeNull()
    expect(sentiment!.unavailableReason).toBe(
      decision.confluence!.contributions.find((c: { expert: string }) => c.expert === "sentiment")!
      .unavailableReason
    )
  })

  it("projects a real ATR observation, and refuses to invent the other two", async () => {
    const risk = projectRisk((await realDecision()) as never)

    expect(risk.atr).not.toBeNull()
    expect(risk.atr!.atr).toBeGreaterThan(0)
    expect(risk.atr!.period).toBe(14)
    expect(risk.atr!.source).toContain("/api/trading/copilot")

    // The two rails the server did not produce stay null. This adapter must not
    // assemble a `strikes: 0` or evaluate a drawdown rail from a session figure.
    expect(risk.drawdown).toBeNull()
    expect(risk.threeStrike).toBeNull()
  })
})

describe("WS-7 T7R-B — the HTTP layer", () => {
  // The adapter's own transport handling, with an injected `fetch`.
  //
  // The end-to-end proof that an AUTHENTICATED caller receives a real score from
  // the real handler lives in `server/__tests__/copilotDecisionRoute.test.mjs`.
  // It is there rather than here for a concrete reason: driving the handler from
  // a `.ts` test needs a declaration for the `handlers.mjs?query` import
  // specifier, which only a `.mjs` test may use. Splitting them keeps each test
  // about one seam and keeps the typecheck honest.

  it("reports a 401 as a named absence, not as a score and not as a throw", async () => {
    const reading = await fetchCopilotReading("EURUSD", {
      fetchImpl: jsonFetch(401, { error: "unauthorized" })
    })
    expect(reading.confluence).toBeNull()
    expect(reading.vetoes).toEqual([])
    expect(reading.reason).toMatch(/authenticated session/i)
    // Fail closed, whatever the transport said.
    expect(reading.automationPermitted).toBe(false)
    expect(reading.rung).toBe("paper")
  })

  it("reports a 502 and a transport throw as absences, never as zeroes", async () => {
    const server5xx = await fetchCopilotReading("EURUSD", { fetchImpl: jsonFetch(502, { error: "upstream" }) })
    expect(server5xx.confluence).toBeNull()
    expect(server5xx.reason).toMatch(/502/)

    const thrown = await fetchCopilotReading("EURUSD", {
      fetchImpl: async () => {
        throw new Error("network down")
      }
    })
    expect(thrown.confluence).toBeNull()
    expect(thrown.reason).toMatch(/network down/)
  })

  it("rejects a non-JSON body rather than reading garbage as a reading", async () => {
    const reading = await fetchCopilotReading("EURUSD", { fetchImpl: jsonFetch(200, "<html>oops</html>") })
    expect(reading.confluence).toBeNull()
    expect(reading.reason).toMatch(/not JSON/i)
  })

  it("distinguishes 'the engine declined to score' from 'the engine was not evaluated'", async () => {
    // These two look alike in a JSON payload and mean opposite things. The dead
    // zone is a decision REACHED and correctly unscoreable, so it keeps its
    // regime label and its six contributions. A refusal is not a decision at all.
    const decision = await realDecision()

    // The engine ran and produced a score: a live reading.
    const live = projectDecision("EURUSD", decision as never)
    expect(live.confluence).not.toBeNull()
    expect(live.confluence!.score).toBeTypeOf("number")

    // The same object with the score the dead zone yields: STILL a reading, with
    // `null` preserved as `null` and never coerced to 0.
    const dead = projectDecision("EURUSD", {
      ...decision,
      confluence: { ...decision.confluence, regime: "deadZone", score: null }
    } as never)
    expect(dead.confluence).not.toBeNull()
    expect(dead.confluence!.score).toBeNull()
    expect(dead.confluence!.regime).toBe("deadZone")
    expect(dead.confluence!.contributions).toHaveLength(6)
    expect(dead.reason).toBeNull()

    // A refusal: no confluence object at all, with the short leg named.
    const refused = projectDecision("EURUSD", {
      ok: true,
      confluence: null,
      unavailable: [{ leg: "working", reason: "only 5 bars, 60 required" }]
    } as never)
    expect(refused.confluence).toBeNull()
    expect(refused.reason).toMatch(/not evaluated/i)
    expect(refused.reason).toContain("only 5 bars, 60 required")
  })

  it("treats a MALFORMED score as an absence rather than coercing it to zero", async () => {
    // `"high"`, `NaN`, `0`-as-string: each is a server-side contract violation.
    // The safe reading of a violation is no reading, never a score of 0.
    for (const score of ["high", NaN, undefined, {}, true]) {
      const reading = projectDecision("EURUSD", { ok: true, confluence: { score } } as never)
      expect(reading.confluence, `score=${String(score)} must not become a reading`).toBeNull()
      expect(reading.reason).toMatch(/malformed|not evaluated/i)
    }
  })

  it("names the short leg when the engine was not evaluated, instead of saying nothing", async () => {
    const reading = projectDecision("EURUSD", {
      ok: true,
      confluence: null,
      unavailable: [{ leg: "working", reason: "only 5 bars, 60 required" }]
    } as never)
    expect(reading.confluence).toBeNull()
    expect(reading.reason).toContain("only 5 bars, 60 required")
    expect(reading.unavailable).toHaveLength(1)
  })

  it("does not accept a truthy non-boolean automationPermitted, or an unknown rung", async () => {
    // AC-024/AC-025 fail closed at the CLIENT boundary too, not only on the
    // server. A server that sent `"true"` must not light up automation here.
    const permissive = projectDecision("EURUSD", {
      ok: true,
      confluence: { score: 12 },
      tier: { automationPermitted: "true", rung: "live-eu" }
    } as never)
    expect(permissive.automationPermitted).toBe(false)
    expect(permissive.rung).toBe("paper")

    // A rung it does not recognise is the lowest rung, never a pass-through.
    const unknownRung = projectDecision("EURUSD", {
      ok: true,
      confluence: { score: 12 },
      tier: { automationPermitted: true, rung: "prod" }
    } as never)
    expect(unknownRung.rung).toBe("paper")
    // ...while a genuinely permitted live rung IS carried, or the field is a lie.
    const live = projectDecision("EURUSD", {
      ok: true,
      confluence: { score: 12 },
      tier: { automationPermitted: true, rung: "live" }
    } as never)
    expect(live.automationPermitted).toBe(true)
    expect(live.rung).toBe("live")
  })

  it("refuses an empty assetId without making a request", async () => {
    let called = false
    const reading = await fetchCopilotReading("  ", {
      fetchImpl: async () => {
        called = true
        return new Response("{}", { status: 200 })
      }
    })
    expect(called).toBe(false)
    expect(reading.confluence).toBeNull()
  })

  it("posts an assetId and NOTHING else — no candles, no timestamps", async () => {
    // The whole point of the route. A client that sent a series would be a
    // second decision path, and one that sent `computedAt` would control the
    // `sessionOpen` veto.
    let sent: { url: string; body: Record<string, unknown>; method: string } | null = null
    await fetchCopilotReading("eurusd", {
      fetchImpl: async (url, init) => {
        sent = { url: String(url), body: JSON.parse(String(init?.body)), method: String(init?.method) }
        return new Response(JSON.stringify({ ok: true, confluence: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      }
    })
    expect(sent).not.toBeNull()
    expect(sent!.method).toBe("POST")
    expect(sent!.url).toBe("/api/trading/copilot")
    expect(sent!.body).toEqual({ assetId: "EURUSD" })
    expect(Object.keys(sent!.body)).toHaveLength(1)
  })
})
