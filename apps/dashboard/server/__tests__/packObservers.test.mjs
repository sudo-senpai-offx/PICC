// S1 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: P1-1 EO session-capture observer.
// The → status mapping table (T1.1 AC) is tested against fake seams — no file
// writes, no network, no credentials anywhere.
//
// Honesty contract under test:
//   - extension kill-switch off → skipped-unconfigured "extension-capture-disabled";
//   - degraded unconfigured/expired → stopped-at-human "needs: re-login";
//   - no token → stopped-at-human "needs: login";
//   - token + connected session → running with sourceLeg;
//   - the kill switch is ONLY honored when the server observed it (false), never
//     assumed — null means "not observed, default-ON assumed";
//   - T1.2: no Cactus Needle runtime → skipped-unconfigured
//     "cactus-needle-t0-runtime-not-shipped" with observed null — never fake
//     extraction output; with runtime → routeTask obeys the confidence
//     threshold env (act above, escalate below).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let obs

async function loadFresh() {
  vi.resetModules()
  obs = await import("../services/packObservers.mjs")
}

describe("observeEoCapture — T1.1 status mapping table", () => {
  beforeEach(async () => {
    await loadFresh()
  })
  afterEach(() => {
    vi.resetModules()
  })

  it("extension kill-switch observed OFF → skipped-unconfigured with the exact reason", () => {
    const r = obs.observeEoCapture({ captureEnabled: false })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("extension-capture-disabled")
    expect(r.observed.captureEnabled).toBe(false)
  })

  it("PICC-settings kill-switch observed OFF → skipped-unconfigured session-capture-disabled (settings wins)", () => {
    const r = obs.observeEoCapture({ sessionCaptureEnabled: false })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("session-capture-disabled")
    expect(r.observed.sessionCaptureEnabled).toBe(false)
  })

  it("settings OFF + extension OFF → settings reason (PICC-side is authoritative)", () => {
    const r = obs.observeEoCapture({ sessionCaptureEnabled: false, captureEnabled: false })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("session-capture-disabled")
    expect(r.observed.captureEnabled).toBe(false)
  })

  it("settings OFF carries the 'capture' workflow pathway prompting PICC settings", () => {
    const r = obs.observeEoCapture({ sessionCaptureEnabled: false })
    expect(r.observed.pathway.need).toBe("capture")
    expect(r.observed.pathway.prompt).toMatch(/PICC settings/)
    expect(r.observed.pathway.steps.length).toBeGreaterThan(0)
  })

  it("settings NOT observed (null) is never assumed off — extension gate still governs", () => {
    const r = obs.observeEoCapture({ sessionCaptureEnabled: null, captureEnabled: false })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("extension-capture-disabled")
  })

  it("kill-switch NOT observed (null) is never assumed off — the mapping proceeds", () => {
    const r = obs.observeEoCapture({ creds: { expertoptionToken: "" } })
    expect(r.status).toBe("stopped-at-human")
    expect(r.detail).toBe("needs: login")
    expect(r.observed.tokenConfigured).toBe(false)
  })

  it("degraded unconfigured → stopped-at-human, needs re-login (sticky seam state)", () => {
    const r = obs.observeEoCapture({
      liveStats: { status: "unconfigured", degraded: { kind: "unconfigured", reason: "no expertoption session" } },
      creds: { expertoptionToken: "abc123" }
    })
    expect(r.status).toBe("stopped-at-human")
    expect(r.detail).toBe("needs: re-login")
    expect(r.observed.degradedKind).toBe("unconfigured")
    expect(r.observed.tokenConfigured).toBe(true) // token on file, session rejected — truth
  })

  it("stopped-at-human carries the workflow PATHWAY prompt (owner Q2) — no autodetection claims", () => {
    const r = obs.observeEoCapture({
      liveStats: { status: "expired", degraded: { kind: "expired", reason: "session token rejected" } },
      creds: { expertoptionToken: "abc123" }
    })
    expect(r.observed.pathway).toBeDefined()
    expect(r.observed.pathway.need).toBe("re-login")
    expect(r.observed.pathway.prompt).toContain("never auto-fills, auto-detects, or automates")
    const joined = r.observed.pathway.steps.join(" ")
    expect(joined).toContain("https://app.expertoption.com/")
    expect(joined).toContain("Log in AGAIN to the DEMO account manually") // re-login wording
    expect(joined).toContain("acknowledge this handoff")
    // the pathway never references an automated fill/login attempt
    expect(joined).not.toMatch(/auto-fill|automated login/)
  })

  it("no token → stopped-at-human needs login, with the login pathway (first-login wording)", () => {
    const r = obs.observeEoCapture({ creds: { expertoptionToken: "" } })
    expect(r.status).toBe("stopped-at-human")
    expect(r.detail).toBe("needs: login")
    expect(r.observed.tokenConfigured).toBe(false)
    expect(r.observed.pathway.need).toBe("login")
    expect(r.observed.pathway.steps.join(" ")).toContain("Open the ExpertOption app tab")
    expect(r.observed.pathway.steps.join(" ")).not.toMatch(/AGAIN/)
  })

  it("connected session + token → running with honest sourceLeg provenance", () => {
    const r = obs.observeEoCapture({
      headless: { sourceLeg: "extension" },
      liveStats: { status: "connected", feedMode: "extension" },
      creds: { expertoptionToken: "abc123" },
      captureEnabled: null
    })
    expect(r.status).toBe("running")
    expect(r.observed.tokenConfigured).toBe(true)
    expect(r.observed.sourceLeg).toBe("extension")
    expect(r.observed.feedMode).toBe("extension")
    expect(r.observed.status).toBe("connected")
    expect(r.observed.captureEnabled).toBeNull() // null observed — rendered "not-observed"
  })

  it("REGRESSION: degraded cleared by softReconnect + fresh token → running (not stuck stopped-at-human)", () => {
    // Bug chain (2026-09-14): softReconnectLiveEO did NOT clear the degraded
    // flag from a previous auth failure. When a fresh token arrived, the stale
    // degraded survived, causing currentStatus() to return "expired" perpetually
    // — the observer always reported stopped-at-human despite a valid session.
    // Fix: softReconnectLiveEO now clears degraded + lastError before starting
    // fresh. This test verifies the seam produces the right state AFTER the fix:
    // degraded=null (cleared) + token present → running.
    const r = obs.observeEoCapture({
      headless: { sourceLeg: "extension" },
      liveStats: { status: "connected", degraded: null, feedMode: "extension" },
      creds: { expertoptionToken: "fresh-token-after-reconnect" },
      captureEnabled: null
    })
    expect(r.status).toBe("running")
    expect(r.observed.tokenConfigured).toBe(true)
    expect(r.observed.degradedKind).toBeUndefined() // null degraded → not surfaced
    // If degraded were STILL set (the old bug), this would be stopped-at-human:
    const stuckBug = obs.observeEoCapture({
      headless: { sourceLeg: "extension" },
      liveStats: { status: "expired", degraded: { kind: "expired", reason: "old error" }, feedMode: "extension" },
      creds: { expertoptionToken: "fresh-token-after-reconnect" },
      captureEnabled: null
    })
    expect(stuckBug.status).toBe("stopped-at-human") // confirms the old bug behavior
    expect(stuckBug.observed.degradedKind).toBe("expired")
  })

  it("studio leg is reported as studio, never guessed", () => {
    const r = obs.observeEoCapture({
      headless: { sourceLeg: "studio" },
      liveStats: { status: "running" === "x" ? "connected" : "idle", feedMode: "auto" },
      creds: { expertoptionToken: "abc123" }
    })
    expect(r.status).toBe("running")
    expect(r.observed.sourceLeg).toBe("studio")
  })

  it("unknown/never-captured leg stays null (rendered 'not-observed'), never zero-filled", () => {
    const r = obs.observeEoCapture({
      headless: { sourceLeg: null },
      liveStats: { status: "idle", feedMode: "auto" },
      creds: { expertoptionToken: "abc123" }
    })
    expect(r.status).toBe("running") // armed, waiting — the capture RUN leg is active
    expect(r.observed.sourceLeg).toBeNull()
  })
})

describe("coerceObservationForStoppedStep — ack-only guard at the wiring seam", () => {
  beforeEach(async () => {
    await loadFresh()
  })
  afterEach(() => {
    vi.resetModules()
  })

  it("running-intent on a stopped-at-human step → same-status stopped-at-human (never auto-resumes)", () => {
    const r = obs.coerceObservationForStoppedStep(
      { status: "running", detail: "capture armed (token present; liveEO connected)", observed: { tokenConfigured: true, status: "connected" } },
      "stopped-at-human"
    )
    expect(r.status).toBe("stopped-at-human")
    expect(r.detail).toBe("seam healthy; step awaits human ack — observation never auto-resumes")
    // the REAL observed payload survives the coercion (fresh evidence, honest)
    expect(r.observed).toEqual({ tokenConfigured: true, status: "connected" })
  })

  it("running-intent on an idle/running step passes through untouched", () => {
    const obsObj = { status: "running", detail: "capture armed", observed: { tokenConfigured: true } }
    expect(obs.coerceObservationForStoppedStep(obsObj, "idle")).toBe(obsObj)
    expect(obs.coerceObservationForStoppedStep(obsObj, "running")).toBe(obsObj)
    expect(obs.coerceObservationForStoppedStep(obsObj, null)).toBe(obsObj)
  })

  it("S6/T6.2: a kill-switch skip on a stopped step → same-status stopped-at-human carrying the real facts + the prior login pathway (pending handoff is never auto-cancelled)", () => {
    const r = obs.coerceObservationForStoppedStep(
      { status: "skipped-unconfigured", detail: "session-capture-disabled", observed: { sessionCaptureEnabled: false, source: "PICC settings kill-switch", captureEnabled: true } },
      "stopped-at-human",
      { need: "re-login", prompt: "Manual login required", steps: ["Log in"] }
    )
    expect(r.status).toBe("stopped-at-human") // ack-only exit preserved
    expect(r.detail).toBe("capture kill-switch off (session-capture-disabled); pending handoff still awaits human ack — the flip never cancels the handoff")
    // the REAL observed kill-switch facts survive (honest evidence, fresh row)
    expect(r.observed.sessionCaptureEnabled).toBe(false)
    expect(r.observed.captureEnabled).toBe(true)
    expect(r.observed.source).toBe("PICC settings kill-switch")
    // the pending login handoff's pathway stays on the read surface; the
    // capture prompt appears only after the ack re-arms the step
    expect(r.observed.pathway).toEqual({ need: "re-login", prompt: "Manual login required", steps: ["Log in"] })
  })

  it("S6/T6.2: an extension kill-switch skip on a stopped step coerce the same way (server-side reason rides along)", () => {
    const r = obs.coerceObservationForStoppedStep(
      { status: "skipped-unconfigured", detail: "extension-capture-disabled", observed: { captureEnabled: false, source: "extension kill-switch", sessionCaptureEnabled: null } },
      "stopped-at-human",
      null // no prior pathway — nothing to preserve
    )
    expect(r.status).toBe("stopped-at-human")
    expect(r.detail).toContain("extension-capture-disabled")
    expect(r.observed.captureEnabled).toBe(false)
  })

  it("non-kill-switch skip intents on a stopped step pass through untouched (the observer's honest status wins)", () => {
    for (const detail of ["no-news-source-configured", "dependency-not-available", "no-webhook-url"]) {
      const obsObj = { status: "skipped-unconfigured", detail, observed: null }
      expect(obs.coerceObservationForStoppedStep(obsObj, "stopped-at-human", null)).toBe(obsObj)
    }
  })

  it("regression: the registry LEGAL map still blocks stopped-at-human → running (the watchdog stays)", async () => {
    // The coercion exists only at the SCHEDULER wiring seam so one step's guard
    // cannot starve the other pack steps. The registry legality map itself is
    // untouched — stopped-at-human still exits ONLY via ack (packRunner.test
    // asserts the runStep rejection end-to-end; this pins the map directly).
    vi.resetModules()
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "picc-coerce-"))
    process.env.PICC_DATA_DIR = dir
    try {
      const reg = await import("../services/packRegistry.mjs")
      await reg.observeStep("pack1-local-trading-core", "p1-1-eo-session-capture", { status: "stopped-at-human", detail: "token expired" })
      await expect(
        reg.observeStep("pack1-local-trading-core", "p1-1-eo-session-capture", { status: "running", detail: "token back" })
      ).rejects.toThrow(/stopped-at-human exits only via ack/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      delete process.env.PICC_DATA_DIR
      vi.resetModules()
    }
  })
})

describe("t0ExtractionSubStep — T1.2 (Cactus Needle T0 runtime)", () => {
  beforeEach(async () => {
    await loadFresh()
  })
  afterEach(() => {
    vi.resetModules()
    delete process.env.PICC_GOV_T0_CONFIDENCE_THRESHOLD
  })

  it("runtime absent → skipped-unconfigured, never fake extraction output", () => {
    const r = obs.t0ExtractionSubStep({ runtimeAvailable: false, confidence: 0.99 })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("cactus-needle-t0-runtime-not-shipped")
    expect(r.observed).toEqual({ runtimeAvailable: false })
    expect(r.observed.tier).toBeUndefined() // nothing routed, nothing invented
  })

  it("runtime present + confidence above the threshold → T0 (no escalation)", () => {
    const r = obs.t0ExtractionSubStep({ runtimeAvailable: true, confidence: 0.9 })
    expect(r.status).toBe("running")
    expect(r.observed.tier).toBe("T0")
    expect(r.observed.escalated).toBe(false)
  })

  it("runtime present + confidence below the threshold → escalates to T1 (governor rule)", () => {
    const r = obs.t0ExtractionSubStep({ runtimeAvailable: true, confidence: 0.3 })
    expect(r.observed.tier).toBe("T1")
    expect(r.observed.escalated).toBe(true)
  })

  it("the threshold env governs — 0.85 is 'act' at default 0.6 but 'escalate' at 0.9", async () => {
    // default threshold 0.6 → 0.85 acts at T0
    let r = obs.t0ExtractionSubStep({ runtimeAvailable: true, confidence: 0.85 })
    expect(r.observed.tier).toBe("T0")
    // threshold raised to 0.9 (configurable ceiling, owner §8.5) → escalates
    process.env.PICC_GOV_T0_CONFIDENCE_THRESHOLD = "0.9"
    await loadFresh() // defaultBudgets reads env at call time; fresh import is belt+braces
    r = obs.t0ExtractionSubStep({ runtimeAvailable: true, confidence: 0.85 })
    expect(r.observed.tier).toBe("T1")
    expect(r.observed.escalated).toBe(true)
  })
})

describe("observeCcxtPoll — T2.1 mapping (P1-2)", () => {
  beforeEach(async () => {
    await loadFresh()
  })
  afterEach(() => {
    vi.resetModules()
  })

  it("no configured pairs → skipped-unconfigured with the exact reason", () => {
    const r = obs.observeCcxtPoll({ exchanges: [] })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("no-ccxt-pairs-configured")
    expect(r.observed.configuredPairs).toBe(0)
  })

  it("null/empty creds are handled like no config (never a fake running)", () => {
    const r = obs.observeCcxtPoll({ exchanges: null })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("no-ccxt-pairs-configured")
  })

  it("a config entry missing exchange or symbol does not count as configured", () => {
    const r = obs.observeCcxtPoll({ exchanges: [{ exchange: "binance" }, { symbol: "BTC/USDT" }] })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.observed.configuredPairs).toBe(0)
  })

  it("configured pairs + connected state → running with honest observed counts", () => {
    const r = obs.observeCcxtPoll({
      exchanges: [{ exchange: "binance", symbol: "BTC/USDT", timeframe: "5m" }],
      stats: { pairs: 1, buffers: 1, exchanges: ["binance"] },
      status: "connected"
    })
    expect(r.status).toBe("running")
    expect(r.observed.configuredPairs).toBe(1)
    expect(r.observed.bufferedPairs).toBe(1)
    expect(r.observed.status).toBe("connected")
    expect(r.observed.exchanges).toEqual(["binance"])
  })

  it("configured but nothing landed yet → running with OBSERVED 0 (never null)", () => {
    const r = obs.observeCcxtPoll({
      exchanges: [{ exchange: "binance", symbol: "BTC/USDT" }],
      stats: { pairs: 0, buffers: 0, exchanges: [] },
      status: "idle"
    })
    expect(r.status).toBe("running")
    expect(r.observed.bufferedPairs).toBe(0) // real observed zero, not "not-observed"
    expect(r.observed.status).toBe("idle")
  })

  it("stale state stays running with the honest stale label", () => {
    const r = obs.observeCcxtPoll({
      exchanges: [{ exchange: "binance", symbol: "BTC/USDT" }],
      stats: { pairs: 1, buffers: 1, exchanges: ["binance"] },
      status: "stale"
    })
    expect(r.status).toBe("running")
    expect(r.observed.status).toBe("stale")
  })
})

describe("observeNewsDigest — T3.1 mapping (Serper replaced by free feeds)", () => {
  beforeEach(async () => {
    await loadFresh()
  })
  afterEach(() => {
    vi.resetModules()
  })

  it("no PICC_NEWS_FEEDS → skipped-unconfigured no-news-source-configured", () => {
    const r = obs.observeNewsDigest({ feeds: [] })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("no-news-source-configured")
    expect(r.observed).toEqual({ configuredFeeds: 0 })
  })

  it("non-URL garbage feeds are not configured either", () => {
    const r = obs.observeNewsDigest({ feeds: [{ id: "x", url: "" }, null] })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.observed.configuredFeeds).toBe(0)
  })

  it("feeds configured but no pass yet → running with items null (never an invented 0)", () => {
    const r = obs.observeNewsDigest({
      feeds: [{ id: "fx-news", url: "https://www.forexlive.com/feed/news" }],
      digest: { last: null, lastRunAt: null }
    })
    expect(r.status).toBe("running")
    expect(r.observed).toMatchObject({
      configuredFeeds: 1,
      fetchedSources: null,
      okSources: null,
      gatedSources: null,
      rateLimitedSources: null,
      items: null,
      lastRunAt: null,
      synthesisEnabled: false
    })
  })

  it("feeds configured + a real pass → honest counts ride along", () => {
    const r = obs.observeNewsDigest({
      feeds: [{ id: "fx-news", url: "https://www.forexlive.com/feed/news" }],
      digest: {
        last: { ts: "2026-09-13T12:00:00.000Z", feeds: 2, fetchedOk: 1, gated: 1, rateLimited: 0, items: 6 }
      },
      synthesisEnabled: true
    })
    expect(r.status).toBe("running")
    expect(r.detail).toContain("1 feed configured")
    expect(r.observed).toMatchObject({
      configuredFeeds: 1,
      fetchedSources: 2,
      okSources: 1,
      gatedSources: 1,
      rateLimitedSources: 0,
      items: 6,
      lastRunAt: "2026-09-13T12:00:00.000Z",
      synthesisEnabled: true
    })
  })
})

describe("T2.2 — P1-2 envelope fact (cadence/rpm ceilings, no new rate limiter)", () => {
  let registry
  beforeEach(async () => {
    vi.resetModules()
    registry = await import("../services/packRegistry.mjs")
  })
  afterEach(() => {
    vi.resetModules()
  })

  it("envelope facts match the existing run cadence and are within the catalog cap", () => {
    const step = registry.packOneDefinition().steps.find((s) => s.id === "p1-2-ccxt-data-poll")
    expect(step.envelope.cadenceMs).toBe(15_000) // rides the existing ccxt-market-data job — no new cadence
    expect(step.envelope.rpmCeiling).toBeLessThanOrEqual(60) // ≤ catalog §5 public-data cap minus margin
    expect(step.kind).toBe("run") // NOT l-class — no credential gate on public market data
  })

  it("no new rate limiter was introduced in the pack service files", async () => {
    // Spec AC: the only rateLimited( in pack sources stays the registry ROUTE
    // (handlers.mjs — not a service file). Observers/runner/registry add none.
    const fs = await import("node:fs/promises")
    const files = [
      "../services/packObservers.mjs",
      "../services/packRunner.mjs",
      "../services/packRegistry.mjs"
    ]
    for (const f of files) {
      const src = await fs.readFile(new URL(f, import.meta.url), "utf8")
      expect(src).not.toMatch(/rateLimited\(/)
    }
  })
})

describe("observeSignalNotifications — T4.1/T4.2 mapping (P1-4)", () => {
  beforeEach(async () => { await loadFresh() })
  afterEach(() => { vi.resetModules() })

  // Default channel config: in-app always on, webpush unconfigured (no VAPID),
  // webhook unconfigured (no URL) — matches the live precondition.
  const defaultChannels = [
    { name: "inApp", configured: true, userEnabled: true },
    { name: "webpush", configured: false, userEnabled: true },
    { name: "webhook", configured: false, userEnabled: true }
  ]

  it("T4.2: engine disabled (PICC_SIGNAL_ENGINE=0) → skipped-unconfigured signal-engine-disabled", () => {
    const r = obs.observeSignalNotifications({ engineEnabled: false, channels: defaultChannels })
    expect(r.status).toBe("skipped-unconfigured")
    expect(r.detail).toBe("signal-engine-disabled")
    expect(r.observed.engineEnabled).toBe(false)
  })

  it("engine null (not observed) → default-ON assumption, running", () => {
    const r = obs.observeSignalNotifications({ engineEnabled: null, channels: defaultChannels })
    expect(r.status).toBe("running")
    expect(r.observed.engineEnabled).toBe(true)
  })

  it("in-app healthy + webpush/webhook unconfigured → running; channel rows show honest skip reasons", () => {
    const r = obs.observeSignalNotifications({
      engineEnabled: true,
      recent: [{
        ts: "2026-09-14T12:00:00.000Z",
        results: { inApp: "sent", webpush: "skipped", webhook: "skipped" },
        webpushError: undefined,
        webhookError: undefined
      }],
      channels: defaultChannels
    })
    expect(r.status).toBe("running")
    expect(r.observed.channels).toHaveLength(3)
    const inApp = r.observed.channels.find((c) => c.name === "inApp")
    expect(inApp.state).toBe("sent")
    expect(inApp.reason).toBeUndefined()
    const webpush = r.observed.channels.find((c) => c.name === "webpush")
    expect(webpush.state).toBe("skipped")
    expect(webpush.reason).toBe("no-vapid")
    const webhook = r.observed.channels.find((c) => c.name === "webhook")
    expect(webhook.state).toBe("skipped")
    expect(webhook.reason).toBe("no-webhook-url")
  })

  it("no dispatch records yet → running; configured+enabled channel shows no-dispatch-yet; unconfigured still shows skip reason", () => {
    const r = obs.observeSignalNotifications({
      engineEnabled: true,
      recent: [],
      channels: defaultChannels
    })
    expect(r.status).toBe("running")
    expect(r.observed.recentCount).toBe(0)
    expect(r.observed.lastDispatchAt).toBeNull()
    const inApp = r.observed.channels.find((c) => c.name === "inApp")
    expect(inApp.state).toBeNull()
    expect(inApp.reason).toBe("no-dispatch-yet")
    const webpush = r.observed.channels.find((c) => c.name === "webpush")
    expect(webpush.state).toBe("skipped")
    expect(webpush.reason).toBe("no-vapid")
  })

  it("failed channel surfaces error detail from the dispatch record", () => {
    const r = obs.observeSignalNotifications({
      engineEnabled: true,
      recent: [{
        ts: "2026-09-14T12:00:00.000Z",
        results: { inApp: "sent", webpush: "failed", webhook: "skipped" },
        webpushError: "push service rejected"
      }],
      channels: defaultChannels
    })
    const webpush = r.observed.channels.find((c) => c.name === "webpush")
    expect(webpush.state).toBe("failed")
    expect(webpush.reason).toBe("push service rejected")
  })

  it("volume: recentCount reflects actual record count (observer honest, notifier caps at 20)", () => {
    const records = Array.from({ length: 15 }, (_, i) => ({
      ts: `2026-09-14T12:${String(i).padStart(2, "0")}:00.000Z`,
      results: { inApp: "sent", webpush: "skipped", webhook: "skipped" }
    }))
    const r = obs.observeSignalNotifications({ engineEnabled: true, recent: records, channels: defaultChannels })
    expect(r.observed.recentCount).toBe(15)
    expect(r.observed.channels).toHaveLength(3)
  })

  it("channel disabled by user (pref off) → state off with channel-disabled-by-user reason", () => {
    const channels = [
      { name: "inApp", configured: true, userEnabled: false },
      { name: "webpush", configured: true, userEnabled: true },
      { name: "webhook", configured: true, userEnabled: true }
    ]
    const r = obs.observeSignalNotifications({ engineEnabled: true, recent: [], channels })
    const inApp = r.observed.channels.find((c) => c.name === "inApp")
    expect(inApp.state).toBe("off")
    expect(inApp.reason).toBe("channel-disabled-by-user")
  })
})