// WS-7 slice B fix round 3 — gates the aggregation that fix round 2 got wrong.
//
// ── WHAT THIS GATES ──────────────────────────────────────────────────────────
// Round 2's central fix was to scope per-iteration aggregates by BOTH the throttle
// rate and the loop index, because the loop counter restarts per rate. It shipped
// with no automated coverage: `vite.config.ts` excludes `**/e2e/**` from vitest, so
// the only evidence the fix held was a boolean written into a gitignored JSON. This
// file imports the extracted aggregation and checks the keying directly, so a
// regression to the unkeyed form is a red test rather than a silent wrong number.
//
// It lives under `server/__tests__/` precisely because the aggregator lives under
// `e2e/helpers/` and vitest will not collect a test from there.
//
// NO ASSERTION, BUDGET, TIMEOUT OR SAMPLE COUNT IS DEFINED OR CHECKED HERE. Every
// fixture is synthetic, and the only things asserted are properties of the
// aggregation itself.
import { describe, expect, it } from "vitest"
import {
  classify,
  degradation,
  endpointReport,
  openAtCloseByPanel,
  ownedCalls,
  panelReport,
  panelsAcrossLoop,
  percentile,
  reconcile,
  recordClickFailure,
  stats
} from "../../e2e/helpers/transitionEvidence.mjs"

/** A recorded call, defaulted to "served, non-429" unless overridden. */
function call(over) {
  return {
    iteration: null,
    rate: 0,
    method: "GET",
    path: "/api/x",
    startMs: 0,
    endMs: 1,
    status: 200,
    failure: null,
    ...over
  }
}

const PANELS = [
  { panel: "Alpha", endpoints: ["/api/a"] },
  { panel: "Beta", endpoints: ["/api/b"] }
]

describe("the per-iteration scoping key (the round-2 bug)", () => {
  // The exact shape that produced round 1's 2.9x over-count: index 0 exists at all
  // three rates, and nothing on the call distinguishes them but `rate`.
  const calls = [
    call({ rate: 1, iteration: 0, path: "/api/a" }),
    call({ rate: 1, iteration: 0, path: "/api/a" }),
    call({ rate: 4, iteration: 0, path: "/api/a" }),
    call({ rate: 6, iteration: 0, path: "/api/a" }),
    call({ rate: 6, iteration: 0, path: "/api/a" }),
    call({ rate: 6, iteration: 0, path: "/api/a" })
  ]

  it("scopes to ONE rate, not to every rate sharing that loop index", () => {
    expect(ownedCalls(calls, { rate: 1, index: 0 })).toHaveLength(2)
    expect(ownedCalls(calls, { rate: 4, index: 0 })).toHaveLength(1)
    expect(ownedCalls(calls, { rate: 6, index: 0 })).toHaveLength(3)
  })

  it("does not confuse a different index at the same rate", () => {
    const withIndex9 = [...calls, call({ rate: 1, iteration: 9, path: "/api/a" })]
    expect(ownedCalls(withIndex9, { rate: 1, index: 0 })).toHaveLength(2)
    expect(ownedCalls(withIndex9, { rate: 1, index: 9 })).toHaveLength(1)
  })

  it("reports the mismatch through reconcile(), so a regression is visible without a run", () => {
    // The per-iteration rows are built by the SPEC, so the two cases are constructed
    // by hand: keyed rows add up, unkeyed rows do not.
    const keyed = [
      { rate: 1, index: 0, apiCalls: 2, apiRateLimited: 0 },
      { rate: 4, index: 0, apiCalls: 1, apiRateLimited: 0 },
      { rate: 6, index: 0, apiCalls: 3, apiRateLimited: 0 }
    ]
    expect(reconcile(keyed, calls).iterationAggregatesReconcile).toBe(true)

    // What round 1 produced: every row claimed all six calls, so the sums were 18
    // against 6 and the flag is false. This is the shape a regression would produce.
    const unkeyed = [
      { rate: 1, index: 0, apiCalls: 6, apiRateLimited: 0 },
      { rate: 4, index: 0, apiCalls: 6, apiRateLimited: 0 },
      { rate: 6, index: 0, apiCalls: 6, apiRateLimited: 0 }
    ]
    expect(reconcile(unkeyed, calls).iterationAggregatesReconcile).toBe(false)
  })

  it("excludes calls issued between iterations, and counts them", () => {
    // Two calls inside the one window, one issued between iterations.
    const withBetween = [
      call({ rate: 1, iteration: 0, path: "/api/a" }),
      call({ rate: 1, iteration: 0, path: "/api/a" }),
      call({ rate: 1, iteration: null, path: "/api/health" })
    ]
    const r = reconcile([{ rate: 1, index: 0, apiCalls: 2, apiRateLimited: 0 }], withBetween)
    // The between-iteration call belongs to no row, and must not make the rows look wrong.
    expect(r.iterationAggregatesReconcile).toBe(true)
    expect(r.callsOutsideAnyIteration).toBe(1)
  })

  it("counts a call at a rate the rows do not cover as outside, rather than as a mismatch", () => {
    // Rows covering only 1x while 4x/6x calls exist: they are unattributed, not wrong.
    const r = reconcile([{ rate: 1, index: 0, apiCalls: 2, apiRateLimited: 0 }], calls)
    expect(r.iterationAggregatesReconcile).toBe(true)
    expect(r.callsOutsideAnyIteration).toBe(4)
  })
})

describe("click() rejection is distinguishable from a slow commit", () => {
  // The point of round 3: these three cases are different failures and must not read
  // identically. Round 2 could only return "timed-out" for both of the last two.
  it("a click that never landed is its own state, whatever the marker did", () => {
    expect(classify(null, true, true)).toBe("click-error")
    expect(classify(50, true, true)).toBe("click-error")
    expect(classify(15000, true, true)).toBe("click-error")
  })

  it("a landed click keeps the three pre-existing readings", () => {
    expect(classify(10, true, false)).toBe("found-immediately")
    expect(classify(1500, true, false)).toBe("waited")
    expect(classify(null, true, false)).toBe("timed-out")
    expect(classify(null, false, false)).toBe("not-reached")
  })

  it("a timed-out marker with a failed click reports click-error, not timed-out", () => {
    // THE DISCRIMINATION. Identical inputs except the click, different answer.
    expect(classify(null, true, false)).toBe("timed-out")
    expect(classify(null, true, true)).toBe("click-error")
  })
})

describe("a swallowed click is recorded, not discarded", () => {
  const blank = () => ({ dashboardClickError: null, marketsClickError: null })

  it("writes the dashboard rejection onto the record with message, elapsed and direction", () => {
    const rec = blank()
    const err = new Error("page.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('a')")
    const out = recordClickFailure(rec, "dashboard", err, 1234)
    expect(rec.marketsClickError).toBeNull()
    expect(rec.dashboardClickError.direction).toBe("dashboard")
    expect(rec.dashboardClickError.elapsedMs).toBe(1234)
    expect(rec.dashboardClickError.message).toContain("Timeout 30000ms exceeded")
    expect(out).toBe(rec.dashboardClickError)
  })

  it("writes the markets rejection to the OTHER field, so the direction is unambiguous", () => {
    const rec = blank()
    recordClickFailure(rec, "markets", new Error("element is not attached"), 7)
    expect(rec.dashboardClickError).toBeNull()
    expect(rec.marketsClickError.direction).toBe("markets")
  })

  it("records both directions when both clicks fail in one iteration", () => {
    const rec = blank()
    recordClickFailure(rec, "dashboard", new Error("overlay intercepts pointer events"), 5)
    recordClickFailure(rec, "markets", new Error("element is not stable"), 6)
    expect(rec.dashboardClickError.message).toContain("overlay intercepts")
    expect(rec.marketsClickError.message).toContain("not stable")
  })

  it("truncates a huge actionability snapshot rather than writing it whole", () => {
    const rec = blank()
    recordClickFailure(rec, "markets", new Error("x".repeat(50_000)), 1)
    expect(rec.marketsClickError.message.length).toBe(500)
  })

  it("accepts a non-Error rejection, because a thrown value need not be one", () => {
    const rec = blank()
    recordClickFailure(rec, "dashboard", "plain string rejection", 2)
    expect(rec.dashboardClickError.message).toBe("plain string rejection")
  })

  it("throws on an unknown direction — that is a bug, not a click failure", () => {
    // The guard against a path by which a click problem could fail the spec.
    expect(() => recordClickFailure(blank(), "sidebar", new Error("x"), 1)).toThrow(/unknown direction/)
  })

  it("leaves a landed click's record untouched, so a healthy iteration stays null", () => {
    const rec = blank()
    expect(rec.dashboardClickError).toBeNull()
    expect(rec.marketsClickError).toBeNull()
    // And the classifier agrees it was a normal wait, not an error.
    expect(classify(1500, true, rec.marketsClickError !== null)).toBe("waited")
  })
})

describe("per-panel open-at-close (round 3 Important 1)", () => {
  const it0 = { rate: 1, index: 0 }
  // Two open calls, both on Alpha, both unanswered; Beta has one that closed.
  const calls = [
    call({ rate: 1, iteration: 0, path: "/api/a", endMs: null }),
    call({ rate: 1, iteration: 0, path: "/api/a", endMs: null }),
    call({ rate: 1, iteration: 0, path: "/api/b", endMs: null }),
    call({ rate: 1, iteration: 0, path: "/api/b", endMs: 5 })
  ]

  it("attributes open calls to the panel that issued them", () => {
    const byPanel = openAtCloseByPanel(calls, it0, PANELS)
    expect(byPanel).toEqual({ Alpha: 2, Beta: 1 })
  })

  it("gives each panel row ITS OWN stalled count, not the iteration-wide total", () => {
    // The round-2 defect: one iteration-wide number (3) handed to every panel, so all
    // rows read 3 despite Alpha issuing 2 open and Beta 1.
    const rows = panelReport(0, 1000, openAtCloseByPanel(calls, it0, PANELS), calls, PANELS)
    const alpha = rows.find((r) => r.panel === "Alpha")
    const beta = rows.find((r) => r.panel === "Beta")
    expect(alpha.stalled).toBe(2)
    expect(beta.stalled).toBe(1)
    // The defect this replaces, stated as the counter-case.
    expect(alpha.stalled).not.toBe(3)
    expect(beta.stalled).not.toBe(3)
  })

  it("sums the per-panel maps across the loop, so panelsAcrossLoop rows differ", () => {
    const iterations = [
      { ...it0, openByPanel: { Alpha: 2, Beta: 1 } },
      { rate: 1, index: 1, openByPanel: { Alpha: 0, Beta: 4 } }
    ]
    const rows = panelsAcrossLoop(calls, iterations, PANELS)
    expect(rows.find((r) => r.panel === "Alpha").stalled).toBe(2)
    expect(rows.find((r) => r.panel === "Beta").stalled).toBe(5)
  })

  it("falls back to a snapshot-time count when no map was captured", () => {
    // An iteration that never reached endIteration (a throw mid-loop) has no map.
    const rows = panelReport(0, 1000, null, calls, PANELS)
    expect(rows.find((r) => r.panel === "Alpha").stalled).toBe(2)
  })
})

describe("degradation, split by cause (round 3 Important 2)", () => {
  it("a 429 storm is rate-limit degradation, not the app misbehaving", () => {
    const d = degradation([
      call({ status: 429 }),
      call({ status: 429 }),
      call({ status: 200 })
    ])
    expect(d.rateLimitDegraded).toBe(true)
    expect(d.rateLimitedTotal).toBe(2)
    // THE POINT. The spec trips the limiter on every healthy run, so this true is
    // routine and must not be read as "the app is broken".
    expect(d.appMisbehaved).toBe(false)
    expect(d.failuresOutsideRateLimit).toBe(0)
  })

  it("a 500 with no 429 is the app misbehaving — round 2 called this NOT degraded", () => {
    const d = degradation([call({ status: 500 }), call({ status: 200 })])
    expect(d.rateLimitDegraded).toBe(false)
    // Round 2's `appDegraded` was `rateLimitedTotal > 0`, so this run read false.
    expect(d.appMisbehaved).toBe(true)
    expect(d.failuresOutsideRateLimit).toBe(1)
  })

  it("a transport failure counts as misbehaviour, and an unanswered call is reported", () => {
    const d = degradation([call({ failure: "net::ERR_CONNECTION_REFUSED" }), call({ endMs: null })])
    expect(d.appMisbehaved).toBe(true)
    expect(d.unanswered).toBe(1)
    expect(d.rateLimitDegraded).toBe(false)
  })

  it("a cross-document goto abort is NOT misbehaviour — it is the harness", () => {
    // I shipped a version that counted these, and it reported appMisbehaved: true on
    // four consecutive healthy runs with failuresOutsideRateLimit: 3, all three being
    // the SSE /api/trading/realtime abort. See degradation()'s doc.
    const d = degradation([
      call({ path: "/api/trading/realtime", failure: "net::ERR_ABORTED" }),
      call({ path: "/api/trading/realtime", failure: "net::ERR_ABORTED" }),
      call({ path: "/api/trading/realtime", failure: "net::ERR_ABORTED" })
    ])
    expect(d.appMisbehaved).toBe(false)
    expect(d.failuresOutsideRateLimit).toBe(0)
    // Set aside, NOT dropped: a reader can see what was excluded and why.
    expect(d.harnessAborts).toBe(3)
  })

  it("a harness abort and a real transport error are not conflated", () => {
    const d = degradation([
      call({ failure: "net::ERR_ABORTED" }),
      call({ failure: "net::ERR_CONNECTION_REFUSED" })
    ])
    expect(d.appMisbehaved).toBe(true)
    expect(d.harnessAborts).toBe(1)
    expect(d.failuresOutsideRateLimit).toBe(1)
  })

  it("a fully healthy run reports neither", () => {
    const d = degradation([call({ status: 200 }), call({ status: 204 })])
    expect(d.rateLimitDegraded).toBe(false)
    expect(d.appMisbehaved).toBe(false)
    expect(d.harnessAborts).toBe(0)
  })
})

describe("429s are excluded from latency but never dropped", () => {
  const calls = [
    call({ path: "/api/a", startMs: 0, endMs: 500, status: 200 }),
    call({ path: "/api/a", startMs: 1000, endMs: 1001, status: 429 }),
    call({ path: "/api/a", startMs: 2000, endMs: 2600, status: 200 })
  ]

  it("latency is computed over served calls only", () => {
    const rows = panelReport(0, 5000, { Alpha: 0 }, calls, PANELS)
    const alpha = rows.find((r) => r.panel === "Alpha")
    expect(alpha.slowestMs).toBe(600)
    expect(alpha.rateLimited).toBe(1)
    expect(alpha.requests).toBe(3)
    expect(alpha.firstResponseMs).toBe(500)
  })

  it("firstResponseMs is null only when there was no NON-REJECTED response", () => {
    const all429 = [call({ path: "/api/a", startMs: 0, endMs: 1, status: 429 })]
    const rows = panelReport(0, 5000, { Alpha: 0 }, all429, PANELS)
    const alpha = rows.find((r) => r.panel === "Alpha")
    // A response DID arrive — it was just the limiter. `responses` proves it, so a
    // null `firstResponseMs` here cannot be misread as "nothing came back".
    expect(alpha.firstResponseMs).toBeNull()
    expect(alpha.responses).toBe(1)
    expect(alpha.rateLimited).toBe(1)
  })

  it("the endpoint breakdown keeps the 429 count and the status histogram", () => {
    const rows = endpointReport(calls)
    expect(rows).toHaveLength(1)
    expect(rows[0].rateLimited).toBe(1)
    expect(rows[0].byStatus["429"]).toBe(1)
    expect(rows[0].requests).toBe(3)
    expect(rows[0].slowestMs).toBe(600)
  })

  it("records the first iteration at which an endpoint was limited, for correlation", () => {
    const rows = endpointReport([
      call({ iteration: 0, status: 200 }),
      call({ iteration: 9, status: 429 }),
      call({ iteration: 12, status: 429 })
    ])
    expect(rows[0].firstRateLimitedIteration).toBe(9)
  })
})

describe("percentile is the single source (round 3 Minor 5)", () => {
  it("stats() and percentile() agree, because stats() is defined in terms of it", () => {
    const values = [5, 1, 4, 2, 3]
    const sorted = [...values].sort((a, b) => a - b)
    expect(stats(values).p50).toBe(percentile(sorted, 0.5))
    expect(stats(values).p95).toBe(percentile(sorted, 0.95))
    expect(stats([5, 1, 4, 2, 3])).toEqual({ p50: 3, p95: 5 })
  })

  it("an empty population is null rather than NaN", () => {
    expect(percentile([], 0.95)).toBeNull()
  })
})
