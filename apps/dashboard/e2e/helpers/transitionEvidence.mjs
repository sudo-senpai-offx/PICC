// WS-7 slice B fix round 3 — the transition-loop instrumentation's AGGREGATION, extracted.
//
// ── WHY IT IS A MODULE AND NOT MORE LINES IN THE SPEC ────────────────────────
// Fix round 2's central bug was in the per-iteration aggregation: it keyed on the
// loop counter `index` alone, and the counter RESTARTS for every throttle rate, so
// every record with index N matched all three rates at once (762 counted 429s
// against a true 266; `1x i0` and `6x i0` byte-identical). It shipped with NO
// automated coverage: `vite.config.ts` excludes `**/e2e/**` from vitest, and nothing
// imported the collector, so a regression would have written `false` into a gitignored
// JSON and turned nothing red. A recorded self-check is a report, not a gate.
//
// So the pure half — the arithmetic over already-collected records, with no Playwright
// dependency at all — lives here, and `terminal-perf.spec.ts` keeps only the plumbing
// that needs a live `page`. `server/__tests__/transitionEvidenceAggregation.test.mjs`
// imports THIS file and gates the keying for real.
//
// ── NOTHING HERE ADDS AN ASSERTION ────────────────────────────────────────────
// Every function is a pure transform over data. No budget, no threshold, no sample
// count and no timeout is defined or enforced in this file, so extracting it cannot
// change what the spec asserts.

/**
 * A 429 is the server's own rate limiter answering, not the app doing work.
 *
 * WHY SEPARATE RATHER THAN FILTERED AWAY. A per-endpoint breakdown is what makes the
 * split possible, and the split is necessary because a 429's response time says
 * nothing about how fast the endpoint is. Both halves are kept everywhere: the latency
 * distribution excludes 429s, and the counts are recorded alongside. Filtering without
 * recording is how round 1 failed — a clean 5 078 ms headline with the degradation
 * sitting in the file unremarked.
 */
export const RATE_LIMIT_STATUS = 429

/** Under this many ms the marker was already present when the wait began. */
export const FOUND_IMMEDIATELY_MS = 50

export const isRateLimited = (c) => c.status === RATE_LIMIT_STATUS
export const isFailed = (c) => c.failure !== null || (c.status !== null && c.status >= 400)
export const latencyMs = (c) => c.endMs - c.startMs
export const failureKey = (c) => (c.failure !== null ? `net:${c.failure}` : c.status !== null ? String(c.status) : "unanswered")

/**
 * Nearest-rank percentile, and THE single source for it.
 *
 * Round 3 Minor: the spec had `stats()` and this function implementing the same
 * selection with different signatures, while the spec's own comment claimed
 * `stats()` "is the single source for the percentiles" — untrue once this file
 * existed. `stats()` is now defined here in terms of this and imported by the spec,
 * so the claim is true and there is one implementation.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** The spec's budget helper, unchanged in behaviour, now sharing `percentile`. */
export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
}

/**
 * Classify one wait.
 *
 * FIX ROUND 3 — the click case. Round 2 could only say `timed-out`, which reads the
 * same for the two failures that matter most and are completely different:
 *
 *   - THE CLICK NEVER LANDED. `page.click()` rejects (detached element, an overlay,
 *     or Playwright's own actionability wait timing out on a 6x-throttled main
 *     thread). The spec SWALLOWS that rejection so a flaky click cannot turn a
 *     green run red — which is correct — but swallowing it meant the subsequent
 *     `waitForSelector` waited its full 15 s for a marker that was never going to
 *     arrive, and the record could not tell that apart from a genuinely slow commit.
 *     That is exactly the recorded symptom: a 15 s selector timeout with no
 *     server-side explanation and nothing in the evidence.
 *   - THE CLICK LANDED AND THE COMMIT WAS SLOW. A real navigation latency problem.
 *
 * `click-error` is the new state, and it is the more actionable one: the fix for a
 * swallowed click is in the spec, and the fix for a slow commit is in the app.
 */
export function classify(markerMs, issued, clickErrored) {
  if (clickErrored) return "click-error"
  if (markerMs !== null) return markerMs < FOUND_IMMEDIATELY_MS ? "found-immediately" : "waited"
  return issued ? "timed-out" : "not-reached"
}

/**
 * THE ROUND-2 FIX, and the reason this file exists: scope a call list to ONE
 * iteration by BOTH its rate and its index.
 *
 * Keying on `index` alone is the bug — the counter restarts per rate, so index 0
 * matches 1x, 4x and 6x simultaneously. This is the line the unit test gates.
 */
export function ownedCalls(calls, it) {
  return calls.filter((c) => c.rate === it.rate && c.iteration === it.index)
}

/**
 * Per-PANEL count of requests still open when the window closed.
 *
 * FIX ROUND 3 IMPORTANT 1. Round 2 computed ONE `openAtClose` across every call in
 * the iteration and handed that single number to all seven panels, so every panel row
 * read identically (all seven `panelsAcrossLoop` rows read `stalled=67`; all seven
 * rows inside one iteration read `stalled=2` while their request counts were
 * 2/2/4/2/2/2/6). The doc comment said "the request the room was waiting on", which
 * reads as per-panel, so a reader comparing panels concluded all panels stall
 * equally. Round 1's version WAS per-panel but structurally always 0 on the manifest
 * path; round 2 traded a per-panel-always-zero field for a not-per-panel one. This is
 * the real fix: a map, keyed by panel, captured while the window is still recent.
 */
export function openAtCloseByPanel(calls, it, panelDefs) {
  const open = ownedCalls(calls, it).filter((c) => c.endMs === null)
  const out = {}
  for (const { panel, endpoints } of panelDefs) {
    out[panel] = open.filter((c) => endpoints.some((e) => c.path.startsWith(e))).length
  }
  return out
}

/**
 * Record a `page.click()` rejection onto the iteration. Pure, so it is unit-tested.
 *
 * The swallow in the loop is deliberate and stays: a click that misses must not fail
 * the spec, because that would turn an intermittent harness annoyance into a red gate.
 * What was wrong was that the rejection was invisible, so a click that never landed
 * looked exactly like a slow commit — the following `waitForSelector(..., 15_000)` then
 * burned its full 15 s for a marker that was never coming, which is the recorded symptom
 * with nothing server-side to explain it. Recording is the fix; the swallow stays.
 *
 * The message is truncated because Playwright actionability errors embed a snapshot of
 * the accessibility tree, which can be tens of kilobytes per event.
 */
export function recordClickFailure(record, direction, err, elapsedMs) {
  const message = err instanceof Error ? err.message : String(err)
  const failure = { direction, message: message.slice(0, 500), elapsedMs }
  if (direction === "dashboard") record.dashboardClickError = failure
  else if (direction === "markets") record.marketsClickError = failure
  // An unknown direction is a programming error, not a click failure: throwing here
  // would be a path by which a click problem fails the spec, which is the thing this
  // whole mechanism exists to prevent.
  else throw new Error(`recordClickFailure: unknown direction ${JSON.stringify(direction)}`)
  return failure
}

export function panelReport(fromMs, toMs, openByPanel, scoped, panelDefs) {
  const inWindow = scoped.filter((c) => c.startMs >= fromMs && c.startMs <= toMs)
  return panelDefs.map(({ panel, endpoints }) => {
    const own = inWindow.filter((c) => endpoints.some((e) => c.path.startsWith(e)))
    // A 429 is excluded from the latency distribution but never dropped: `served` is
    // the latency population, `rateLimited` counts what was kept out of it.
    const served = own.filter((c) => c.endMs !== null && !isRateLimited(c))
    return {
      panel,
      endpoints,
      requests: own.length,
      responses: own.filter((c) => c.endMs !== null).length,
      failures: own.filter(isFailed).length,
      stalled: openByPanel && panel in openByPanel ? openByPanel[panel] : own.filter((c) => c.endMs === null).length,
      openAtSnapshot: own.filter((c) => c.endMs === null).length,
      slowestMs: served.length ? Math.max(...served.map(latencyMs)) : null,
      // Round 1 documented "click -> first response" and measured the first REQUEST
      // start, which is off by the request's own duration.
      //
      // FIX ROUND 3 MINOR 3 — the null is ambiguous as previously worded. "Null when it
      // never had one" reads as "no data has arrived yet", but since 429s are excluded
      // from this population it now means "never had a NON-REJECTED response". A panel
      // that got six 429s and nothing else reports null here even though `responses`
      // is 6. `responses` and `rateLimited` disambiguate it, and
      // `firstResponseMsOfAnyKind` below is the reading that includes rejections.
      firstResponseMs: served.length ? served[0].endMs - fromMs : null,
      firstResponseMsOfAnyKind: own.some((c) => c.endMs !== null) ? own.find((c) => c.endMs !== null).endMs - fromMs : null,
      rateLimited: own.filter(isRateLimited).length
    }
  })
}

/**
 * Per-endpoint, per-method, with failures keyed by status code.
 *
 * This is what round 1 lacked: `apiFailures` was a bare count, so establishing that
 * every POST endpoint and only POST endpoints was failing meant rebuilding the
 * correlation by hand — which is what round 2 had to do, and why round 1's degraded
 * run read as a clean baseline.
 */
export function endpointReport(calls) {
  const rows = new Map()
  for (const c of calls) {
    const key = `${c.method} ${c.path}`
    if (!rows.has(key)) {
      rows.set(key, {
        method: c.method,
        path: c.path,
        requests: 0,
        responses: 0,
        byStatus: {},
        rateLimited: 0,
        slowestMs: null,
        p95Ms: null,
        firstRateLimitedIteration: null,
        latencies: []
      })
    }
    const row = rows.get(key)
    row.requests += 1
    if (c.endMs !== null) row.responses += 1
    if (isFailed(c)) row.byStatus[failureKey(c)] = (row.byStatus[failureKey(c)] ?? 0) + 1
    if (isRateLimited(c)) {
      row.rateLimited += 1
      if (row.firstRateLimitedIteration === null && c.iteration !== null) {
        row.firstRateLimitedIteration = c.iteration
      }
    } else if (c.endMs !== null) {
      row.latencies.push(latencyMs(c))
    }
  }
  return [...rows.values()]
    .map(({ latencies, ...row }) => {
      const sorted = [...latencies].sort((a, b) => a - b)
      return { ...row, slowestMs: sorted.length ? sorted[sorted.length - 1] : null, p95Ms: percentile(sorted, 0.95) }
    })
    .sort((a, b) => b.rateLimited - a.rateLimited || b.requests - a.requests)
}

/** A cross-loop view, so a reader need not diff 16 iterations to find the always-slow panel. */
export function panelsAcrossLoop(calls, iterations, panelDefs) {
  return panelDefs.map(({ panel, endpoints }) => {
    const own = calls.filter((c) => endpoints.some((e) => c.path.startsWith(e)))
    const served = own.filter((c) => c.endMs !== null && !isRateLimited(c))
    const sorted = served.map(latencyMs).sort((a, b) => a - b)
    // Summed PER PANEL from the per-panel maps, not from one iteration-wide number.
    const stalled = iterations.reduce((a, it) => a + ((it.openByPanel && it.openByPanel[panel]) || 0), 0)
    return {
      panel,
      endpoints,
      requests: own.length,
      responses: own.filter((c) => c.endMs !== null).length,
      failures: own.filter(isFailed).length,
      rateLimited: own.filter(isRateLimited).length,
      stalled,
      openAtSnapshot: own.filter((c) => c.endMs === null).length,
      slowestMs: sorted.length ? sorted[sorted.length - 1] : null,
      p95Ms: percentile(sorted, 0.95)
    }
  })
}

/**
 * Transport failures that are a HARNESS artifact rather than app misbehaviour.
 *
 * A cross-document `page.goto` aborts the in-flight requests of the document being
 * left, and Playwright emits no `requestfailed` for some of them. An EventSource-style
 * endpoint (`/api/trading/realtime`) is permanently open, so it is ALWAYS in flight at
 * a navigation and always aborts. Counting that as "the app misbehaved" would make
 * `appMisbehaved` true on a perfectly healthy run — which is precisely the overclaim
 * this function was written to remove, so it is not counted here. These are still
 * visible: they appear in `endpointFailures.byStatus` and in `neverAnswered`.
 */
const HARNESS_ABORT_ERRORS = ["net::ERR_ABORTED"]

export function isHarnessAbort(c) {
  return c.failure !== null && HARNESS_ABORT_ERRORS.includes(c.failure)
}

/**
 * The two degradation readings, kept separate because they mean opposite things.
 *
 * FIX ROUND 3 IMPORTANT 2. Round 2 shipped one boolean, `appDegraded`, defined as
 * `rateLimitedTotal > 0`, which overclaimed in BOTH directions:
 *
 *   - FALSE NEGATIVE. A run broken by 500s or transport failures, with zero 429s, read
 *     `appDegraded: false`. The predicate only knew about 429s and nothing in the file
 *     said so.
 *   - FALSE POSITIVE, and this is the worse one. `appDegraded: true` is the NORMAL
 *     state of this harness: the spec fires ~353 POSTs/min against a 60/min budget, so
 *     it trips the limiter on every healthy run. Read literally the field said "the app
 *     was degraded" when the SPEC caused the degradation. Round 2's own report drew
 *     exactly that distinction at its §21 and the field name erased it.
 *
 * So the honest split is:
 *   - `rateLimitDegraded` — the limiter was rejecting. Named for its cause, and to be
 *     read as "the SPEC tripped the limiter", not "the app is broken".
 *   - `appMisbehaved` — real failures that are neither the limiter nor a known harness
 *     abort: 5xx, other transport errors, a panel that never resolved. THIS is the one
 *     that means the app misbehaved.
 *
 * I shipped a version of this that counted the harness aborts, and it reported
 * `appMisbehaved: true` on four consecutive healthy runs with
 * `failuresOutsideRateLimit: 3` — all three of them the SSE abort documented above. So
 * the predicate is now scoped, and the excluded count is reported next to it rather
 * than dropped, because a reader must be able to see what was set aside and why.
 */
export function degradation(calls) {
  const rateLimited = calls.filter(isRateLimited).length
  const harnessAborts = calls.filter(isHarnessAbort).length
  const otherFailed = calls.filter((c) => isFailed(c) && !isRateLimited(c) && !isHarnessAbort(c)).length
  const unanswered = calls.filter((c) => c.endMs === null).length
  return {
    rateLimitDegraded: rateLimited > 0,
    rateLimitedTotal: rateLimited,
    failuresOutsideRateLimit: otherFailed,
    harnessAborts,
    unanswered,
    appMisbehaved: otherFailed > 0
  }
}

/**
 * Do the per-iteration aggregates still add up to the in-window totals?
 *
 * A REPORT, not a gate, and deliberately so: instrumentation must not be able to turn
 * a green run red. It is here because the round-2 fix needs a permanent, checkable
 * definition, and the unit test gates this function itself so a regression in the
 * keying is caught at test time rather than discovered in a JSON file weeks later.
 *
 * Only calls that happened INSIDE an iteration window belong to a per-iteration
 * record. Requests issued BETWEEN iterations (the spec calls /api/auth/me and
 * /api/health around a navigation) carry `iteration: null`, so the comparison is
 * against the in-window subset; comparing against `calls.length` would be false for a
 * benign reason and would train a reader to ignore the field.
 */
export function reconcile(perIteration, calls) {
  const ownedKeys = new Set(perIteration.map((it) => `${it.rate}/${it.index}`))
  const inWindowCalls = calls.filter((c) => c.iteration !== null && ownedKeys.has(`${c.rate}/${c.iteration}`))
  const iterationSum = perIteration.reduce((a, it) => a + it.apiRateLimited, 0)
  const callSum = perIteration.reduce((a, it) => a + it.apiCalls, 0)
  return {
    iterationAggregatesReconcile:
      iterationSum === inWindowCalls.filter(isRateLimited).length && callSum === inWindowCalls.length,
    callsOutsideAnyIteration: calls.length - inWindowCalls.length
  }
}
