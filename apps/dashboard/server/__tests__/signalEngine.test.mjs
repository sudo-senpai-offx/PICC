import { describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// T5: literal window copy (REQ-7) + Decision D venue resolution
// ---------------------------------------------------------------------------
// Provider mocks: the engine's data + math legs are stubbed so evaluateAsset
// can be driven deterministically to the PRE_TRADE branch; notifier is the
// capture point for the dispatch payload. browserStudio/captureProfiles stay
// REAL (resolved lazily inside resolveAlertVenue) — the venue assertions must
// exercise the real instrumentUrl + live capture catalog.

vi.mock("../services/notifier.mjs", () => ({
  dispatchAlert: vi.fn(async (p) => ({ results: { inApp: "sent" }, ...p })),
  getPrefs: vi.fn(() => ({
    minConfidence: 60,
    leadMinutes: 3,
    windowMinutes: 15,
    channels: { inApp: true }
  }))
}))
vi.mock("../services/marketDataBus.mjs", () => ({
  // Only length + source + stale are consumed before the (mocked) math legs.
  getBestCandles: vi.fn(async () => ({ candles: [{}], source: "expertoption", stale: false }))
}))
vi.mock("../services/modelMatrix.mjs", () => ({
  computeModelMatrix: vi.fn(() => ({
    ok: true,
    consensus: { direction: "up", confidence: 78, agree: 5, total: 7 }
  }))
}))
vi.mock("../services/entryLevels.mjs", () => ({
  // spot === anchor → distanceAtr 0 ≤ TRIGGER_ATR → PRE_TRADE fires.
  computeEntryLevels: vi.fn(() => ({
    ok: true,
    buyZone: { low: 1.07, high: 1.075, anchor: 1.073, strength: 4, sources: ["pivot"] },
    sellZone: null,
    spot: 1.073,
    atr: 0.0012
  }))
}))
vi.mock("../services/autopilot.mjs", () => ({
  getAutopilotConfig: vi.fn(async () => ({})),
  enabledAssetTargets: vi.fn(() => [])
}))

import { dispatchAlert } from "../services/notifier.mjs"
import { computeModelMatrix } from "../services/modelMatrix.mjs"
import { evaluateAsset, resolveAlertVenue, windowLabel, signalEngineStatus } from "../services/signalEngine.mjs"

describe("windowLabel (T5 / REQ-7)", () => {
  it("renders the local-time span boundary — lead = window start, lead+window = end", () => {
    const base = new Date()
    base.setHours(21, 54, 0, 0) // local-time construction → TZ-independent expected span
    const label = windowLabel({ leadMinutes: 3, windowMinutes: 15, at: base.getTime() })
    expect(label).toMatch(/^Window: 21:57–22:12 .+$/)
  })

  it("crosses midnight without mangling the span", () => {
    const base = new Date()
    base.setHours(23, 50, 0, 0)
    const label = windowLabel({ leadMinutes: 7, windowMinutes: 15, at: base.getTime() })
    expect(label).toMatch(/^Window: 23:57–00:12 .+$/)
  })

  it("degrades to a shape-safe line when no lead/window is given", () => {
    const label = windowLabel({ at: 0 }) // 1970-01-01T00:00Z → local wall-clock is machine-dependent
    expect(label).toMatch(/^Window: \d{2}:\d{2}–\d{2}:\d{2} .+$/)
  })
})

describe("resolveAlertVenue (T5 / Decision D)", () => {
  it("wins the exactly-one-non-none branch for an EO-resolvable asset (REAL instrumentUrl)", async () => {
    // A candidate pool with a single resolvable venue (ExpertOption — live via
    // liveEO today) resolves to an honest {venueId, tradeUrl}, never fabricated.
    const candidateConfigs = [{ venueId: "expertoption", name: "ExpertOption" }]
    const out = await resolveAlertVenue({ assetId: "EURUSD", candidateConfigs })
    expect(out).toEqual({ venueId: "expertoption", tradeUrl: "https://app.expertoption.finance/" })
  })

  it("omits the venue under the REAL catalog: expertoption AND iqoption both resolve non-'none'", async () => {
    // Ground truth (spec Decision D assumes only ExpertOption resolves non-"none"): iqoption
    // is a SITE_INDEX trading venue too, so instrumentUrl gives mode "venue" for both →
    // two candidates → the exactly-one rule omits the field. This is the honest else-branch.
    const out = await resolveAlertVenue({ assetId: "EURUSD" })
    expect(out).toBeUndefined()
  })

  it("omits the venue when every candidate resolves mode 'none' (catalog-only asset)", async () => {
    const candidateConfigs = [{ venueId: "honeygain", name: "Honeygain" }, { venueId: "whatever", name: "Whatever" }]
    const out = await resolveAlertVenue({ assetId: "EURUSD", candidateConfigs })
    expect(out).toBeUndefined()
  })

  it("omits the venue when several candidates resolve non-'none' (no pick between venues)", async () => {
    const candidateConfigs = [{ venueId: "expertoption", name: "Expert Option" }, { venueId: "binance", name: "Binance" }]
    const out = await resolveAlertVenue({ assetId: "BTCUSD", candidateConfigs })
    expect(out).toBeUndefined()
  })
})

describe("signal engine PRE_TRADE dispatch (T5)", () => {
  it("fires PRE_TRADE with literal Window: copy (venue follows the resolver outcome)", async () => {
    vi.mocked(dispatchAlert).mockClear()
    const note = await evaluateAsset("EURUSD")
    expect(note).toContain("PRE_TRADE alerted")
    const call = vi.mocked(dispatchAlert).mock.calls[0][0]
    expect(call.kind).toBe("PRE_TRADE")
    expect(call.body).toMatch(/Window: \d{2}:\d{2}–\d{2}:\d{2} .+/)
    expect(call.windowText).toMatch(/^Window: \d{2}:\d{2}–\d{2}:\d{2} .+$/)
    // Under today's real catalog (expertoption + iqoption both "venue") the
    // exactly-one rule omits `venue` — asserted here so the engine behavior
    // can never silently start guessing a venue.
    expect(call.venue).toBeUndefined()
  })
})

describe("signalEngineStatus per-state `since` (T7 / REQ-8)", () => {
  it("reports {phase:'alerted', since} for an alerted asset — fresh asset each run", async () => {
    // A dedicated assetId keeps this ordered-independent: any prior test alerting
    // EURUSD flips it to the ALERTED watch branch, never re-arms PRE_TRADE.
    const note = await evaluateAsset("XAUUSD")
    expect(note).toContain("PRE_TRADE alerted")
    const st = signalEngineStatus().states["XAUUSD"]
    expect(st.phase).toBe("alerted")
    expect(typeof st.since).toBe("number")
    expect(Number.isFinite(st.since)).toBe(true)
  })

  it("omits `since` for an idle asset (phase key unchanged)", async () => {
    // Flat consensus → no-signal path → stays idle; mockImplementationOnce keeps
    // the default up-consensus intact for the rest of the file.
    vi.mocked(computeModelMatrix).mockImplementationOnce(() =>
      ({ ok: true, consensus: { direction: "flat", confidence: 40, agree: 2, total: 7 } })
    )
    const note = await evaluateAsset("GBPUSD")
    expect(note).toContain("no signal")
    const st = signalEngineStatus().states["GBPUSD"]
    expect(st.phase).toBe("idle")
    expect("since" in st).toBe(false)
  })
})