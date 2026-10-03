import { test, expect } from "@playwright/test"
import { useSharedSession } from "../e2e/sharedAuth"
import { writeFileSync, mkdirSync } from "node:fs"
import { cpus } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import isolatedEnv, { assertIsolatedEnv, ISOLATION_TMP_ROOT } from "./helpers/isolatedEnv.mjs"
// Fix round 3: the aggregation is extracted so it can be unit-tested — `vite.config.ts`
// excludes `**/e2e/**` from vitest, which is why round 2's central fix shipped with no
// gate. See e2e/helpers/transitionEvidence.mjs and
// server/__tests__/transitionEvidenceAggregation.test.mjs. Only the pure transforms
// live there; the Playwright plumbing stays below.
import {
  classify,
  degradation,
  endpointReport,
  isFailed,
  isRateLimited,
  latencyMs,
  openAtCloseByPanel,
  ownedCalls,
  panelReport,
  panelsAcrossLoop,
  reconcile,
  recordClickFailure,
  stats
} from "./helpers/transitionEvidence.mjs"

assertIsolatedEnv(isolatedEnv, ISOLATION_TMP_ROOT)

// WS-6 T10 — target-device performance harness (AC-018).
//
// WHAT THIS MEASURES, AND WHAT IT DOES NOT
// ------------------------------------------
// Per the owner amendment to D2 (2026-09-25), a CPU-throttled proxy environment
// is accepted as evidence for the PERFORMANCE-BUDGET gate. Chromium's CDP
// `Emulation.setCPUThrottlingRate` was VERIFIED available on this host before
// being written into the spec (rate 6x produced 247ms vs 29ms at 1x on an
// identical workload, an 8.52x slowdown).
//
// This harness therefore reports REAL measured data about a constrained compute
// envelope, and it is labelled `throttled-proxy (x86, CPU-limited)` on every
// record. It must NEVER be reported as a Snapdragon 400 or Atom measurement:
// throttling an x86 host still executes x86. ARM64 correctness (ABI/alignment,
// native-module availability, 64-bit-only issues) stays UNVERIFIED and cannot
// be closed by emulation.
//
// Budgets are the proposed thresholds from spec 4.6. A FAIL is a real result,
// not a flake: this spec asserts the budgets and writes the evidence either way.

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST = resolve(HERE, "../perf/terminal-perf-manifest.json")
// The failure-path twin of MANIFEST. `test-results/` is gitignored, so this never
// shows up as a working-tree change, and it is written from an afterEach so it
// survives the throw a failing selector produces.
const EVIDENCE_FILE = resolve(HERE, "../test-results/terminal-perf-transition-evidence.json")

/** Proposed release thresholds from spec 4.6, in ms unless stated. */
const BUDGETS = {
  firstInteractiveWarm: 2000,
  firstContentfulPaintCold: 3000,
  roomTransition: 250,
  tickToVisible: 50,
  table10kInitialRender: 250,
  deterministicDomain: 16
}

/** Throttle rates applied. 1x is the unthrottled control. */
const THROTTLE_RATES = [1, 4, 6]

type Sample = { rate: number; p50: number; p95: number; samples: number }

// `stats()` now lives in e2e/helpers/transitionEvidence.mjs and is imported below, so
// the spec's own comment that it "is the single source for the percentiles" is true
// again: the instrumentation's percentile and the budget's percentile are one
// function. Round 3 Minor 5.

// ─────────────────────────────────────────────────────────────────────────────
// WS-7 slice B fix round 1 — TRANSITION-LOOP INSTRUMENTATION.
//
// WHY THIS EXISTS: IT CORRECTS MY OWN EARLIER CLAIM.
//
// The recorded symptom is `waitForSelector("[data-room='markets']")` at :89 AND at
// :128/:132. The :89 case is covered by the auth-me trace, because :83 and :88 are
// `page.goto` full page loads. The 16-iteration loop at :125-133 is NOT covered, and
// cannot be:
//
//   - the clicks land on `MinistryShell`'s INNER_NAV `NavLink`s (MinistryShell.tsx:54-60),
//     which are react-router CLIENT-SIDE navigations, not page loads;
//   - `useExternalLinkRouter` (AppShell.tsx:18-47) only intercepts `target="_blank`,
//     so it does not convert them;
//   - `RequireAuth` and `AppShell` stay mounted across a transition, so the `useAuth`
//     effect — keyed on `[inconclusive]` — does not re-run;
//   - and `useUser()` is the only other `/me` caller, and it is off the room path.
//
// So the loop issues ZERO /api/auth/me requests and all three round-4 signals are
// STRUCTURALLY BLIND to a failure at :128/:132, which is where the recorded symptom
// lives. The loop is also AUTH-FREE: client-side navigation between two already-mounted
// rooms — no `/me`, no sign-out, no session destruction.
//
// ── FIX ROUND 2 CORRECTS THE CLAIM I MADE ABOUT WHAT CAN DELAY THE MARKER ─────
// Round 1 wrote here: "the only things that can delay the room marker are inside
// MarketsRoom's own mount path: ITS PANELS' DATA FETCHES and the lazy chunk." The
// first half of that is FALSE and the shipped evidence proved it while I was calling
// the run clean. The marker is not gated on any fetch:
//
//   - MarketsRoom.tsx:15 renders `<header data-room="markets">` as the FIRST child of
//     the room's root, unconditionally. It precedes PackRegistryStrip (:19) and all six
//     panels (:31-36) in the same synchronous React commit, so it is in the DOM before
//     any effect has run.
//   - The panels fetch in `useEffect` and render unconditionally: SpreadPanel.tsx:30
//     `useEffect(() => { void refresh() }, [refresh])` with the card rendered at :32.
//   - trading.ts:13-21 throws on a non-2xx with NO retry and NO backoff, so a 429
//     lands in the panel's own `catch` and renders an error string immediately.
//
// So `[data-room='markets']` latency is React commit + module/chunk load +
// navigation, under CPU throttle — and it is NOT inflated by rate-limit rejections.
// What CAN delay it: the lazy MinistryRoom chunk, and main-thread work from the ~76
// responses this loop forces the browser to parse per iteration.
//
// (The room-mount guard at App.tsx:29 tests the SESSION, not `session.user`, and
// useAuth.ts:144-146 sets a non-null session with `loading=false` on the FIRST
// inconclusive answer — so the 503 / retained-session path cannot produce a 30s timeout
// either. That is what makes "something in the room's own mount" the surviving
// possibility rather than merely the last one standing.)
//
// WHAT THIS DOES NOT TOUCH. No existing assertion, budget, sample count or timeout is
// weakened, relaxed, re-timed or reordered. The two `waitForSelector` lines are
// byte-identical; the two timestamp reads around them are NEW lines, so `elapsed` still
// measures exactly what it measured before, and a failing selector still throws the same
// error out of the same place.
// ─────────────────────────────────────────────────────────────────────────────

const SELECTOR_TIMEOUT_MS = 15_000
/** Under this many ms the marker was already present when the wait began. */
const FOUND_IMMEDIATELY_MS = 50
/** Hard cap, so a pathological run cannot produce an unbounded evidence file. */
const MAX_RECORDS = 4000

/**
 * The components MarketsRoom renders, and the endpoints each fetches on mount.
 *
 * DERIVED FROM THE NETWORK, NOT FROM THE DOM. These components carry no stable root
 * hook — only PackRegistryStrip's inner `li[data-step]` does — so "when did panel X
 * mount" is not observable from the page without adding production attributes, which is
 * out of scope for instrumentation. What IS observable, and is what a 15 s selector
 * timeout needs, is that a waiting panel shows a request in flight across the
 * click->marker window. `stalled` is exactly that.
 *
 * Eight, not six or seven. Two additions, both by the same rule — the list tracks what
 * the room ACTUALLY fetches, and an endpoint left off the list is a request that lands
 * in the aggregate while belonging to no panel, which is the attribution defect this
 * harness exists to prevent:
 *
 *   - `PackRegistryStrip` (`:150-151`) fetches `/api/packs/registry` on mount.
 *   - `CopilotDecision` (WS-7 T7R-B, 2026-10-01) fetches `/api/trading/copilot` on
 *     mount and on every asset change. That is the route which runs the deterministic
 *     engine, so the room's decision surface is now backed by a real request rather
 *     than by a rendered absence.
 *
 * WHY ONE REQUEST AND NOT FOUR. The engine needs a working-timeframe series, a 4H series
 * and 400 daily closes. Those are three broker fetches made INSIDE the one authenticated
 * server call (`server/services/copilot/decision.mjs`), so the room adds one measurable
 * request rather than three. An earlier draft fetched `/api/trading/candles` from the
 * page instead; that was reverted because it put the decision path in the browser.
 *
 * WHAT THIS DOES TO THE NUMBERS. One additional request inside the measured window, so
 * the Markets transition's request count rises by one and its aggregate parse load rises
 * accordingly. D21 already superseded the 250 ms x86 tier with a ~1800 ms p95 ARM
 * re-baseline and recorded B1 as a KNOWN BREACH, so no ratified number is disturbed —
 * T19 re-measures the whole room set anyway. What this change refuses to do is leave
 * the request unattributed, which would make the re-measurement wrong rather than
 * merely pessimistic.
 */
const MARKETS_PANELS: { panel: string; endpoints: string[] }[] = [
  { panel: "PackRegistryStrip", endpoints: ["/api/packs/registry"] },
  { panel: "SpreadPanel", endpoints: ["/api/trading/spread"] },
  { panel: "WatchlistPanel", endpoints: ["/api/trading/watchlists"] },
  { panel: "MarketIntelPanel", endpoints: ["/api/trading/intel"] },
  { panel: "CalendarPanel", endpoints: ["/api/trading/calendar"] },
  { panel: "SessionPanel", endpoints: ["/api/trading/sessions"] },
  { panel: "ScreenerPanel", endpoints: ["/api/trading/screener", "/api/trading/watchlists"] },
  { panel: "CopilotDecision", endpoints: ["/api/trading/copilot"] }
]

type ApiCall = {
  iteration: number | null
  rate: number
  method: string
  path: string
  startMs: number
  endMs: number | null
  status: number | null
  failure: string | null
}

type Iteration = {
  index: number
  rate: number
  warmup: boolean
  startMs: number
  dashboardClickAt: number | null
  dashboardMarkerMs: number | null
  marketsClickAt: number | null
  marketsMarkerMs: number | null
  completed: boolean
  /**
   * Requests still open when the window closed, PER PANEL. Filled in by endIteration().
   * A map, not a single number — see openAtCloseByPanel in the helpers module.
   */
  openByPanel: Record<string, number> | null
  /**
   * The SWALLOWED CLICK, captured. Round 3.
   *
   * `page.click(...).catch(() => {})` is deliberately swallowing, so a flaky click
   * cannot turn a green run red. But swallowing it also meant a click that never
   * landed was indistinguishable from a slow commit: the following
   * `waitForSelector(..., { timeout: 15_000 })` then burned its full 15 s waiting for
   * a marker that was never going to appear, and the record said only "timed-out".
   * That is precisely the recorded symptom — a 15 s selector timeout with no
   * server-side explanation and nothing in the evidence file.
   */
  dashboardClickError: ClickFailure | null
  marketsClickError: ClickFailure | null
}

/** A captured `page.click()` rejection. Recorded, never thrown. */
type ClickFailure = {
  direction: "dashboard" | "markets"
  message: string
  /** How long the click itself took before rejecting. */
  elapsedMs: number
}

// The `PanelReport` and `EndpointReport` shapes are OWNED BY
// e2e/helpers/transitionEvidence.mjs, which is where they are built and
// unit-tested. They used to be declared here as well — a second description of the
// same record is a second thing to drift, which is the whole reason
// `runbookIsolationContract.test.mjs` imports the harness instead of restating it.
// Round 3 Minor 5 removed the parallel `percentile`/`stats` duplication for the same
// reason; this is the same class of fix applied to the types.

  /**
   * A 429 is the server's own rate limiter answering, not the app doing work. See
   * e2e/helpers/transitionEvidence.mjs for why the two halves — latency distribution
   * and rejection count — are both kept.
   */
  const RATE_LIMIT_STATUS = 429

function createTransitionEvidence() {
  const calls: ApiCall[] = []
  const byRequest = new Map<object, ApiCall>()
  const consoleLines: { iteration: number | null; rate: number; type: string; text: string }[] = []
  const iterations: Iteration[] = []
  let rate = 0
  let current: Iteration | null = null
  let attempted = false
  let dropped = 0
  /** The page `attach()` bound, so the loop can click through this recorder. */
  let boundPage: any = null

  const pathOf = (url: string) => {
    const i = url.indexOf("/api/")
    return i === -1 ? url : url.slice(i)
  }
  const push = <T>(list: T[], value: T): boolean => {
    if (list.length >= MAX_RECORDS) {
      dropped += 1
      return false
    }
    list.push(value)
    return true
  }

  function attach(page) {
    boundPage = page
    page.on("console", (msg: { type: () => string; text: () => string }) => {
      const text = msg.text()
      // The client auth line is the one signal this run depends on and it can fire
      // OUTSIDE a transition window (it fires on a sign-out), so it is always
      // recorded. Everything else is window-scoped, so a healthy run's file stays
      // about the loop.
      if (!current && !text.includes("[auth] sign-out")) return
      push(consoleLines, {
        iteration: current ? current.index : null,
        rate,
        type: msg.type(),
        text: text.slice(0, 2000)
      })
    })
    page.on("request", (req) => {
      const url = req.url()
      if (!url.includes("/api/")) return
      const call: ApiCall = {
        iteration: current ? current.index : null,
        rate,
        method: req.method(),
        path: pathOf(url),
        startMs: Date.now(),
        endMs: null,
        status: null,
        failure: null
      }
      if (push(calls, call)) byRequest.set(req, call)
    })
    page.on("response", (res) => {
      const call = byRequest.get(res.request())
      if (!call) return
      call.endMs = Date.now()
      call.status = res.status()
    })
    page.on("requestfailed", (req) => {
      const call = byRequest.get(req)
      if (!call) return
      call.endMs = Date.now()
      call.failure = req.failure()?.errorText ?? "request failed"
    })
  }

  function beginRate(next: number) {
    rate = next
  }

  /**
   * Click, and CAPTURE a rejection instead of discarding it.
   *
   * The swallow is deliberate and stays: a click that misses because the DOM moved
   * must not be able to fail the spec, because that would convert an intermittent
   * harness annoyance into a red gate. What changes is that the rejection is no
   * longer invisible. It is recorded with its message, its own elapsed time, and which
   * direction it was, so a later `waitForSelector` timeout can be attributed to "the
   * click never landed" rather than to the app being slow.
   */
  async function clickInto(record: Iteration, direction: "dashboard" | "markets", selector: string) {
    if (!boundPage) throw new Error("attach(page) must run before clickInto()")
    const startedAt = Date.now()
    try {
      await boundPage.click(selector)
      return true
    } catch (err) {
      recordClickFailure(record, direction, err, Date.now() - startedAt)
      return false
    }
  }

  function beginIteration(index: number, warmup: boolean): Iteration {
    attempted = true
    const record: Iteration = {
      index,
      rate,
      warmup,
      startMs: Date.now(),
      dashboardClickAt: null,
      dashboardMarkerMs: null,
      marketsClickAt: null,
      marketsMarkerMs: null,
      completed: false,
      openByPanel: null,
      dashboardClickError: null,
      marketsClickError: null
    }
    current = record
    iterations.push(record)
    return record
  }

  function endIteration(record: Iteration) {
    record.completed = true
    // Capture "still open when the window closed" HERE, while the window is still the
    // recent past, rather than at snapshot time ~2.5 minutes later — and PER PANEL, so
    // two panels with different request counts are not given the same number.
    record.openByPanel = openAtCloseByPanel(calls, record, MARKETS_PANELS)
    if (current === record) current = null
  }

  function snapshot() {
    const nowMs = Date.now()
    // The per-iteration scoping key lives in the helpers module and is unit-tested
    // there (server/__tests__/transitionEvidenceAggregation.test.mjs). Round 1 keyed
    // on the loop counter alone, which restarts per rate, so every record with index N
    // matched all three rates: 762 counted 429s against a true 266, and `1x i0` and
    // `6x i0` reported byte-identical counts. The fix is the rate in the key.
    const perIteration = iterations.map((it) => {
      const windowEnd =
        it.marketsMarkerMs !== null && it.marketsClickAt !== null ? it.marketsClickAt + it.marketsMarkerMs : nowMs
      const clickAt = it.marketsClickAt ?? it.startMs
      const mine = ownedCalls(calls, it)
      return {
        ...it,
        dashboardSelector: classify(it.dashboardMarkerMs, it.dashboardClickAt !== null, it.dashboardClickError !== null),
        marketsSelector: classify(it.marketsMarkerMs, it.marketsClickAt !== null, it.marketsClickError !== null),
        apiCalls: mine.length,
        apiFailures: mine.filter(isFailed).length,
        apiRateLimited: mine.filter(isRateLimited).length,
        slowestApiMs: mine
          .filter((c) => c.endMs !== null && !isRateLimited(c))
          .reduce((a, c) => Math.max(a, latencyMs(c)), 0) || null,
        marketsPanels: panelReport(clickAt, windowEnd, it.openByPanel, mine, MARKETS_PANELS)
      }
    })

    // A cross-loop view, so a reader does not have to diff 16 iterations to find the
    // panel that is always slow or always stalled. `stalled` is summed from the
    // PER-PANEL close maps, so the seven rows can differ.
    const byPanel = panelsAcrossLoop(calls, iterations, MARKETS_PANELS)
    const deg = degradation(calls)
    const rec = reconcile(perIteration, calls)
    const clickErrors = perIteration.filter(
      (it) => it.dashboardClickError !== null || it.marketsClickError !== null
    )

    return {
      note:
        "Instrumentation only. Adds no assertion, changes no budget, and changes no sample count. " +
        "Recorded because the 16-iteration transition loop is client-side navigation and therefore " +
        "issues zero /api/auth/me requests: the auth-me trace cannot see a failure in it.",
      fixRound2:
        "Round 2. (1) `endpointFailures` breaks every failure down per method+path with counts by " +
        "status code, which is what made the round-1 misreading possible to avoid: round 1 shipped " +
        "only an aggregate count. (2) 429s are EXCLUDED from every latency figure here " +
        "(`slowestApiMs`, `PanelReport.slowestMs`/`p95Ms`, `EndpointReport.slowestMs`/`p95Ms`) and " +
        "counted separately as `rateLimited`, because a limiter rejection returns in ~1ms having " +
        "done no app work and averaging it in understates the app. They are never dropped: the " +
        "counts and the per-status breakdown are kept. (3) `apiRateLimited` per iteration makes " +
        "the correlation with `marketsMarkerMs` checkable directly. IMPORTANT: the " +
        "[data-room='markets'] marker is NOT gated on any of these endpoints — MarketsRoom.tsx:15 " +
        "renders the header as an unconditional first child, the panels fetch in effects " +
        "(SpreadPanel.tsx:30) and render unconditionally, and trading.ts:13-21 throws on 429 with " +
        "no retry — so limiter rejections do not inflate marker latency. They are recorded because " +
        "the app's WRITE SURFACE was dead during the measurement, not because they caused the number.",
      fixRound3:
        "Round 3. (1) CLICK FAILURES ARE CAPTURED, not discarded. The loop's two " +
        "`.catch(() => {})` swallows stay — a click that misses must not fail the spec — but the " +
        "rejection is now recorded on the iteration with its message, its own elapsed ms and its " +
        "direction, and `classify()` returns the new state `click-error` so a click that never " +
        "landed is distinguishable from a click that landed and committed slowly. That is the " +
        "leading remaining candidate for the recorded symptom: a missed click leaves the page on " +
        "the old room, so the following waitForSelector burns its full 15s for a marker that was " +
        "never coming, with nothing server-side to explain it. (2) `stalled` is now PER PANEL. " +
        "Round 2 computed one iteration-wide `openAtClose` and handed it to all seven panels, so " +
        "all seven `panelsAcrossLoop` rows read `stalled=67` and all seven rows inside one " +
        "iteration read `stalled=2` despite request counts of 2/2/4/2/2/2/6; it is now summed from " +
        "per-panel close maps. (3) `appDegraded` is GONE, replaced by a split: " +
        "`rateLimitDegraded` (the limiter was rejecting — which in this harness means THE SPEC " +
        "tripped it, roughly 353 POSTs/min against a 60/min budget, so a true here is ROUTINE and " +
        "does NOT mean the app is broken) and `appMisbehaved` + `failuresOutsideRateLimit` (real " +
        "non-429 failures, which is what would mean the app misbehaved). Round 2's single boolean " +
        "overclaimed in both directions: a 500-storm with zero 429s read `appDegraded: false`, " +
        "and a healthy run read `true`.",
      wallClockMs: nowMs - (iterations[0]?.startMs ?? nowMs),
      recordsDroppedAtCap: dropped,
      // `appDegraded` was `rateLimitedTotal > 0`, which overclaimed in BOTH directions.
      // See degradation() in the helpers module and `fixRound3` above.
      rateLimitedTotal: deg.rateLimitedTotal,
      rateLimitDegraded: deg.rateLimitDegraded,
      failuresOutsideRateLimit: deg.failuresOutsideRateLimit,
      // Cross-document `goto` aborts — a harness artifact, not app misbehaviour, and
      // the reason `appMisbehaved` below is scoped. Reported, not dropped.
      harnessAborts: deg.harnessAborts,
      appMisbehaved: deg.appMisbehaved,
      unanswered: deg.unanswered,
      // A reported count, not a gate: how many iterations had a click that never landed,
      // and which direction. Non-zero here with a `click-error` selector outcome is the
      // single most actionable thing in this file.
      clickFailures: clickErrors.map((it) => ({
        rate: it.rate,
        index: it.index,
        dashboard: it.dashboardClickError,
        markets: it.marketsClickError,
        dashboardSelector: it.dashboardSelector,
        marketsSelector: it.marketsSelector
      })),
      clickFailureCount: clickErrors.length,
      // The standing report that the per-iteration breakdown is correctly scoped. False in
      // round 1 (762 counted 429s against a true 266) because the filter ignored the rate.
      // It is a RECORDED field so it cannot fail a run; the gate on the keying itself is
      // server/__tests__/transitionEvidenceAggregation.test.mjs.
      iterationAggregatesReconcile: rec.iterationAggregatesReconcile,
      // Calls issued outside every iteration window, so the delta above is accounted for.
      callsOutsideAnyIteration: rec.callsOutsideAnyIteration,
      endpointFailures: endpointReport(calls),
      iterations: perIteration,
      panelsAcrossLoop: byPanel,
      slowestApiCalls: [...calls]
        .filter((c) => c.endMs !== null)
        .sort((a, b) => (b.endMs as number) - b.startMs - ((a.endMs as number) - a.startMs))
        .slice(0, 20)
        .map((c) => ({ ...c, durationMs: (c.endMs as number) - c.startMs })),
      neverAnswered: calls
        .filter((c) => c.endMs === null)
        .map((c) => ({ iteration: c.iteration, rate: c.rate, method: c.method, path: c.path, startMs: c.startMs })),
      // WHY `neverAnswered` IS NOT A BUG LIST. A cross-document `page.goto` ABORTS the
      // in-flight requests of the document being left, and Playwright does NOT emit
      // `requestfailed` for those, so they arrive here as "never answered" and are also
      // skipped by `failures` (which keys on `failure !== null || status >= 400`). In
      // practice every entry is one of /api/auth/me, /api/crypto/market or /api/health —
      // the three the spec itself calls around a navigation — and they are always
      // `iteration: null`, i.e. outside any transition window, which is the tell. A real
      // stall inside the loop has a non-null `iteration` and appears in the owning
      // iteration's per-panel `stalled` (summed from `openByPanel`) instead.
      neverAnsweredAllOutsideIterations: calls
        .filter((c) => c.endMs === null)
        .every((c) => c.iteration === null),
      authMeConsoleLines: consoleLines.filter((l) => l.text.includes("[auth] sign-out")),
      otherConsoleLines: consoleLines.filter((l) => !l.text.includes("[auth] sign-out")).slice(-200)
    }
  }

  return { attach, beginRate, beginIteration, endIteration, clickInto, snapshot, wasAttempted: () => attempted }
}

const transitionEvidence = createTransitionEvidence()

// This spec only READS the terminal, so it shares one authenticated account
// across the whole e2e run instead of spending the auth rate limiter's budget on
async function signupAndLogin(page, request) {
  await useSharedSession(page, request)
  await page.goto("/markets")
  await expect(page).not.toHaveURL(/\/login(?:$|\?)/)
}

test.afterEach(() => {
  // The manifest the test body writes does NOT survive a failing run: a throw at
  // :128/:132 aborts before `writeFileSync(MANIFEST, ...)` is ever reached. So the
  // same evidence is also written here, which runs on pass AND on fail (including on
  // the 300 s timeout), into gitignored `test-results/`. On the success path both
  // copies exist and carry identical content — verified in fix round 2.
  //
  // BEST-EFFORT BY CONTRACT. This hook must never be able to turn a previously-green
  // run red. `mkdirSync`/`writeFileSync` can fail for reasons that have nothing to do
  // with the app under test: a read-only filesystem, a locked directory, a full disk,
  // an antivirus holding the file. Round 1 shipped this unguarded, which is a NEW way
  // to go red. Swallowed and recorded on stderr, so a missing file is still visible in
  // the run output even though it cannot fail the test.
  if (!transitionEvidence.wasAttempted()) return
  try {
    mkdirSync(dirname(EVIDENCE_FILE), { recursive: true })
    writeFileSync(EVIDENCE_FILE, JSON.stringify(transitionEvidence.snapshot(), null, 2), "utf8")
  } catch (err) {
    console.warn(`[terminal-perf] transition evidence NOT written: ${(err as Error)?.message ?? err}`)
  }
})

test.describe("WS-6 T10 terminal performance under CPU throttling", () => {
  // Three throttle rates x (2 navigations + 25 domain samples + 10 route
  // transitions) on an emulated low-end CPU needs more than the default 30s.
  //
  // THE BUDGET IS SIZED FROM THE MEASURED DISTRIBUTION, NOT ROUNDED UP BY FEEL.
  // T19 root-caused the ~4-in-5 run-level flake to this budget alone, and recorded
  // two points on the distribution:
  //
  //   - a COMPLETE run: 48/48 iterations in 281.7s  ->  5.87s per iteration;
  //   - the WORST observed elapsed: 295.9s, at 32/48 iterations.
  //
  // 281.7s against the old 300s budget is 6% headroom, which is not headroom, it is
  // a coin toss. Arithmetic for the figure below:
  //
  //   worst observed elapsed .................... 295.9 s
  //   uniform-cost projection of THAT run to 48
  //   iterations (295.9 x 48/32) ................ 443.9 s
  //   repo convention for a per-test budget:
  //   ~3x the slowest observed, explicitly NOT 10x
  //   (authBootstrapGateFailsClosed.test.mjs:288-291
  //   rejected 30s as "roughly 10x the slowest
  //   observed" and settled on ~3x) .............. 3 x 295.9 = 887.7 s
  //   rounded UP to a whole minute ............... 900 s
  //
  // So 900s is 3.04x the worst observed elapsed, 2.03x that run's projection to a
  // full 48 iterations, and 3.20x the observed complete run. The projection is the
  // figure that matters and it is a LOWER bound: rate 6 is the slowest of the
  // three, and the 32 iterations that had completed when that run died were rates
  // 1 and 4, so a run as slow as that one finishes the remaining 16 at a higher
  // per-iteration cost than the average it is projected with.
  //
  // THIS IS A WALL-CLOCK ENVELOPE, NOT A HANG DETECTOR, so widening it does not
  // weaken what can still fail. Every wait inside the loop already carries its own
  // bound — 15 s per selector at :677 and :685, 30 s for the throttled room marker
  // at :620 — so a transition that genuinely stalls still fails on THAT timeout in
  // seconds, and a dead page cannot consume the outer budget silently. The old
  // figure was simply below the harness's own legitimate work on a loaded host.
  //
  // **THIS IS NOT B1.** B1 is the x86 250 ms ROOM-TRANSITION BUDGET
  // (`BUDGETS.roomTransition`, :62) — a per-transition performance budget that is
  // currently BREACH, and which the owner has separately ruled must actually be
  // fixed. Raising a test's wall-clock timeout does nothing for it: B1 is compared
  // against a measured p50/p95 inside `verdict()` (:779-788) and asserted only as
  // `expect(budgetVerdicts.some(v => v.verdict === "BREACH")).toBe(true)` (:872-876)
  // — which means this spec currently DEPENDS on B1 breaching and would fail if B1
  // were fixed without that assertion being revisited. Nothing here touches B1, B3,
  // any budget value, any tolerance, or the 48-iteration count. T19 re-measures the
  // room set regardless.
  test.setTimeout(900_000)

  // D3 locks the minimum supported viewport at 1280x800. Measuring at
  // Playwright's 1280x720 default would understate layout cost, so the floor is
  // set explicitly.
  test.use({ viewport: { width: 1280, height: 800 } })

  test("records throttled-proxy evidence and asserts the proposed budgets", async ({ page, request }) => {
    // Before anything else, so a sign-out during login is captured too. Listeners
    // only RECORD inside a transition window (plus any `[auth] sign-out` line), so a
    // healthy run's evidence file is about the loop and nothing else.
    transitionEvidence.attach(page)
    await signupAndLogin(page, request)

    const hostCpu = cpus()[0]?.model?.trim() ?? "unknown"
    const records: Record<string, unknown>[] = []

    for (const rate of THROTTLE_RATES) {
      transitionEvidence.beginRate(rate)
      const pageErrors: string[] = []
      page.on("pageerror", (e) => pageErrors.push(String(e)))

      await page.goto("/suites/trading/markets", { waitUntil: "load" })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Emulation.setCPUThrottlingRate", { rate })

      // --- paint timing, measured from a fresh navigation under throttle ---
      await page.goto("/suites/trading/markets", { waitUntil: "load" })
      await page.waitForSelector("[data-room='markets']", { timeout: 30_000 })

      const paint = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
        const fcp = performance.getEntriesByName("first-contentful-paint")[0] as PerformanceEntry | undefined
        return {
          fcp: fcp ? fcp.startTime : null,
          domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
          loadEvent: nav ? nav.loadEventEnd : null
        }
      })

      // --- deterministic domain latency, executed in the page ---
      const domainSamples: number[] = []
      for (let i = 0; i < 25; i++) {
        const ms = await page.evaluate((idx) => {
          const start = performance.now()
          // Exercise a real deterministic path shape: fixed-cost arithmetic the
          // terminal must be able to do inside one frame.
          let acc = 0
          for (let k = 0; k < 20_000; k++) acc += (k * idx) % 7
          return { ms: performance.now() - start, acc }
        }, i)
        domainSamples.push(ms.ms)
      }

      // --- room transition, measured between two real routes ---
      // WS-7 (b): the previous loop took 5 samples and called max-of-5 a "p95".
      // That is not a percentile, and it silently reported COLD-CACHE cost as
      // steady-state cost. A WS-7 T2 diagnostic measured a 2.56x warm-up ratio
      // on this exact transition (first-3 avg 3202ms, last-3 avg 1251ms), so
      // cold samples are now discarded as WARMUP_SAMPLES and enough samples are
      // taken for the percentile to mean something.
      const WARMUP_SAMPLES = 4
      const STEADY_SAMPLES = 12
      const transitionSamples: number[] = []
      for (let i = 0; i < WARMUP_SAMPLES + STEADY_SAMPLES; i++) {
        // ── instrumentation, insertions ONLY ───────────────────────────────────
        // The six statements below are the ONLY additions in this loop, and each one
        // sits BETWEEN existing lines without displacing any of them. The seven
        // original statements keep their exact order, so `t0`, the two waits, the
        // `elapsed` computation, the warm-up discard and the push mean precisely what
        // they meant before: a run that passed passes for the same reason, and one
        // that failed still fails at the same line with the same error.
        //
        // Note what `elapsed` is NOT: it is t0 -> the DASHBOARD marker only, because
        // that is where the push sits in the original. The markets half is timed
        // separately below, and is recorded as its own number rather than folded in.
        const iteration = transitionEvidence.beginIteration(i, i >= WARMUP_SAMPLES)
        const t0 = Date.now()
        iteration.dashboardClickAt = Date.now()
        // FIX ROUND 3: the swallow is preserved, but the rejection is now RECORDED
        // rather than discarded, so a click that never landed is distinguishable from a
        // slow commit. Still not allowed to fail the spec.
        await transitionEvidence
          .clickInto(iteration, "dashboard", "a[href='/suites/trading/dashboard']")
          .catch(() => {})
        await page.waitForSelector("[data-room='dashboard']", { timeout: 15_000 })
        iteration.dashboardMarkerMs = Date.now() - (iteration.dashboardClickAt as number)
        const elapsed = Date.now() - t0
        if (i >= WARMUP_SAMPLES) transitionSamples.push(elapsed)
        iteration.marketsClickAt = Date.now()
        await transitionEvidence
          .clickInto(iteration, "markets", "a[href='/suites/trading/markets']")
          .catch(() => {})
        await page.waitForSelector("[data-room='markets']", { timeout: 15_000 })
        iteration.marketsMarkerMs = Date.now() - (iteration.marketsClickAt as number)
        transitionEvidence.endIteration(iteration)
      }
      // stats() below is the single source for the percentiles; with 12
      // steady-state samples its p95 is a real nearest-rank percentile rather
      // than the max of 5 warming ones.

      // --- reduced motion honoured ---
      const reducedMotion = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)

      // --- AC-002: 1280x800 layout floor, no horizontal page scroll ---------
      // jsdom cannot measure layout, so this MUST be a real-browser assertion.
      // D3 makes horizontal page scrolling a failure at the 1280x800 floor.
      const layout = await page.evaluate(() => {
        const el = document.documentElement
        const widest = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((n) => ({ cls: n.className?.toString().slice(0, 40) ?? "", right: n.getBoundingClientRect().right }))
      .filter((n) => n.right > el.clientWidth + 1)
      .slice(0, 5)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowing: widest
    }
  })

      // --- JS heap, when the browser exposes it ---
      const heapMb = await page
        .evaluate(() => {
          const perf = performance as unknown as { memory?: { usedJSHeapSize: number } }
          return perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null
        })
        .catch(() => null)

      const domain = stats(domainSamples)
      const transition = stats(transitionSamples)

      records.push({
        label: "throttled-proxy (x86, CPU-limited)",
        architecture: "x86",
        targetDeviceClaim: "UNVERIFIED — throttling an x86 host does not validate ARM64",
        throttle: { mechanism: "cdp:Emulation.setCPUThrottlingRate", rate },
        hostCpu,
        route: "/suites/trading/markets",
        viewport: page.viewportSize(),
        paintMs: paint,
        layout,
        deterministicDomainMs: { ...domain, samples: domainSamples.length },
        roomTransitionMs: {
          ...transition,
          samples: transitionSamples.length,
          warmupDiscarded: WARMUP_SAMPLES
        },
        // The per-iteration selector outcomes and the panel/network picture for
        // THIS rate. Additive: nothing above this line is read, changed or
        // re-derived from it.
        transitionIterations: transitionEvidence
          .snapshot()
          .iterations.filter((i) => i.rate === rate),
        reducedMotionHonoured: reducedMotion,
        jsHeapMb: heapMb,
        pageErrors
      })

      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
      await cdp.detach()
    }

    // --- evidence completeness: the harness FAILS when evidence is missing ---
    const throttled = records.find((r) => (r.throttle as { rate: number }).rate === 6) as
      | (Record<string, unknown> & {
          paintMs: { fcp: number | null; domContentLoaded: number | null; loadEvent: number | null }
          deterministicDomainMs: { p50: number; p95: number; samples: number }
          roomTransitionMs: { p50: number; p95: number; samples: number }
        })
      | undefined

    expect(throttled, "a rate-6 throttled sample must exist").toBeDefined()
    expect(throttled!.paintMs.fcp, "first-contentful-paint evidence is required").not.toBeNull()
    expect(throttled!.deterministicDomainMs.samples, "domain samples are required").toBeGreaterThan(0)
    expect(throttled!.roomTransitionMs.samples, "transition samples are required").toBeGreaterThan(0)
    expect(throttled!.pageErrors, "page must render without runtime errors").toEqual([])

    mkdirSync(dirname(MANIFEST), { recursive: true })

    // --- explicit per-metric verdicts -------------------------------------
    // Every declared budget gets a recorded pass/breach. A budget that is not
    // asserted here is a budget nobody is really holding the app to, so the
    // room-transition overrun is reported explicitly rather than omitted.
    const fcp = throttled!.paintMs.fcp!
    const domainP95 = throttled!.deterministicDomainMs.p95
    const transitionP50 = throttled!.roomTransitionMs.p50
    const verdict = (metric: string, observed: number, budget: number) => ({
      metric,
      observedMs: Number(observed.toFixed(1)),
      budgetMs: budget,
      verdict: observed <= budget ? "pass" : "BREACH",
      note:
        observed <= budget
          ? undefined
          : "Recorded, not suppressed. See WS-6 spec T10/T11 for the remediation owner."
    })

    const budgetVerdicts = [
      verdict("firstContentfulPaintCold@6x", fcp, BUDGETS.firstContentfulPaintCold),
      verdict("deterministicDomainP95@6x", domainP95, BUDGETS.deterministicDomain),
      verdict("roomTransitionP50@6x", transitionP50, BUDGETS.roomTransition),
      verdict("roomTransitionP95@6x", throttled!.roomTransitionMs.p95, BUDGETS.roomTransition)
    ]

    // Budgets this harness does NOT yet measure are recorded as UNMEASURED with a
    // reason. They are never given a synthetic number and never read as a pass.
    // ws6TerminalSeamGuard asserts every declared budget has either a measured
    // verdict or one of these markers.
    const measured = new Set(budgetVerdicts.map((v) => v.metric.split("@")[0]))
    const unmeasuredBudgets = Object.entries(BUDGETS)
      .filter(([key]) => !measured.has(key))
      .map(([key, budget]) => ({
        budget: key,
        budgetMs: budget,
        verdict: "UNMEASURED" as const,
        reason:
          "No measurement path exists yet for this budget. It requires a migrated terminal " +
          "room (a 10k virtual table, a tick-to-visible probe, or a warm-interactive marker); " +
          "the legacy suite surface does not expose one. Tracked for the T5/T6 surface slices."
      }))

    writeFileSync(
      MANIFEST,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          policy: "ws6-session-policy/1",
          evidenceKind: "throttled-proxy",
          disclaimer:
            "CPU-throttled x86 proxy. Satisfies the AC-018 performance-budget gate only. " +
            "ARM64 architecture correctness remains UNVERIFIED and requires physical ARM64 hardware. " +
            "These numbers must never be reported as a Snapdragon 400 or Intel Atom measurement.",
          viewportFloor: "1280x800 (D3)",
          budgets: BUDGETS,
          budgetVerdicts,
          unmeasuredBudgets,
          breaches: budgetVerdicts.filter((v) => v.verdict === "BREACH"),
          hostCpu,
          // The whole run's transition evidence, in one place. The same object is
          // written to test-results/terminal-perf-transition-evidence.json from an
          // afterEach, which is the copy that survives a FAILING run.
          transitionEvidence: transitionEvidence.snapshot(),
          records
        },
        null,
        2
      )
    )

    // --- budget assertions ------------------------------------------------
    // Paint and deterministic-domain latency are asserted as hard budgets: they
    // are comfortably within range and must stay there.
    expect(
      fcp,
      `cold FCP ${fcp}ms exceeded ${BUDGETS.firstContentfulPaintCold}ms at 6x throttle`
    ).toBeLessThanOrEqual(BUDGETS.firstContentfulPaintCold)

    expect(
      domainP95,
      `deterministic domain p95 ${domainP95}ms exceeded ${BUDGETS.deterministicDomain}ms at 6x throttle`
    ).toBeLessThanOrEqual(BUDGETS.deterministicDomain)

    // --- AC-002: layout floor assertions (D3) ----------------------------
    // Horizontal page scrolling at the 1280x800 floor is a FAILURE (D3), and a
    // clipped primary control is prohibited. These are measured in a real
    // browser because jsdom performs no layout.
    const layout = throttled!.layout
    expect(layout.viewport.width, "must be measured at the D3 width floor").toBe(1280)
    expect(layout.viewport.height, "must be measured at the D3 height floor").toBe(800)
    expect(
      layout.scrollWidth,
      `horizontal page scroll at 1280x800 (scrollWidth ${layout.scrollWidth} > clientWidth ${layout.clientWidth}); offenders: ${JSON.stringify(layout.overflowing)}`
    ).toBeLessThanOrEqual(layout.clientWidth + 1)

    // Room transition is RECORDED, not asserted, because the measured surface is
    // the LEGACY suite, not a migrated terminal room. Asserting it here would
    // fail the build on a pre-existing legacy cost that WS-6 has not yet taken
    // ownership of. It becomes a hard gate in T12 once a terminal room is
    // actually promoted.
    expect(
      budgetVerdicts.some((v) => v.verdict === "BREACH"),
      "room-transition breach must stay visible in the manifest, not be dropped"
    ).toBe(true)
  })
})
