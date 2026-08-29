// Capture-profile registry + Headless-Capture-Engine wiring (T2/T3/T4 of
// docs/specs/PICC_HEADLESS_CAPTURE_ENGINE.md).
//
// This file tests the ENGINE against vi.mocked seams (browserStudio / trading /
// liveEO): the registry data table, the coverage matrix, the refresh policy
// cadence gate, and the scheduler-facing wiring (token changed → revive,
// same-token/settings-only → no-op, no token ever in a report or status).
// The REAL reference implementation (real browserStudio + fake-page harness,
// real trading.mjs on a tmp dir) is exercised in captureVenue.test.mjs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CAPTURE_PROFILES,
  clampCadence,
  enabledCaptureVenues,
  getCaptureProfile,
  headlessSessionRefresh,
  headlessSessionStatus,
  isVenueEnabled,
  listCaptureProfiles,
  refreshCadenceMs,
  setHeadlessSessionPolicy,
  captureVenue,
  _resetHeadlessSessionState
} from "../services/captureProfiles.mjs"
import { captureExpertOptionSession, getSiteCredentials } from "../services/browserStudio.mjs"
import { getCredentials, saveCredentials } from "../services/trading.mjs"
import { restartLiveEO } from "../services/liveEO.mjs"

vi.mock("../services/browserStudio.mjs", () => ({
  getSiteCredentials: vi.fn(),
  captureExpertOptionSession: vi.fn(),
  maskToken: vi.fn((t) => t ?? "")
}))
vi.mock("../services/trading.mjs", () => ({
  getCredentials: vi.fn(),
  saveCredentials: vi.fn()
}))
vi.mock("../services/liveEO.mjs", () => ({
  restartLiveEO: vi.fn(async () => true),
  feedProvenance: vi.fn(() => "studio"),
  liveEOStats: vi.fn(() => ({ legs: { extension: {}, studio: {} }, lastSeen: 0 }))
}))

// PLATFORM_KINDS (browserStudio.mjs:541-552) as a test-side literal — the
// registry's `kind` column must mirror it exactly or the matrix lies.
const PLATFORM_KINDS = {
  expertoption: "binary",
  iqoption: "binary",
  olymptrade: "binary",
  deriv: "binary",
  binance: "spot",
  bybit: "derivatives",
  kucoin: "spot",
  okx: "spot",
  etoro: "cfd",
  plus500: "cfd"
}

const TOK_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const TOK_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

beforeEach(() => {
  vi.clearAllMocks()
  _resetHeadlessSessionState()
  getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })
  captureExpertOptionSession.mockResolvedValue({
    ok: true,
    token: TOK_A,
    source: "cookie:token",
    guest: false,
    saved: true,
    account: { type: "active", guest: false, email: "trader@example.com" }
  })
  setHeadlessSessionPolicy({})
})

afterEach(() => {
  setHeadlessSessionPolicy({})
})

describe("coverage matrix (T2)", () => {
  it("lists exactly the ten trading venues", () => {
    const ids = listCaptureProfiles().map((p) => p.id).sort()
    expect(ids).toEqual(Object.keys(PLATFORM_KINDS).sort())
  })

  it("kinds mirror PLATFORM_KINDS for every venue", () => {
    for (const p of listCaptureProfiles()) {
      expect(p.kind).toBe(PLATFORM_KINDS[p.id])
    }
  })

  it("ExpertOption is the full reference profile; the rest are honest v1 states", () => {
    const byId = Object.fromEntries(listCaptureProfiles().map((p) => [p.id, p]))
    expect(byId.expertoption.status).toBe("full")
    expect(byId.expertoption.capture.via).toBe("liveEO")
    expect(byId.expertoption.demoReal).toBe("demo-first")
    for (const id of ["iqoption", "binance", "kucoin", "okx"]) {
      expect(byId[id].status).toBe("capture-only")
      expect(byId[id].capture.via).toBeNull() // hook not built — research (T10) gates it
    }
    for (const id of ["bybit", "etoro", "plus500", "olymptrade", "deriv"]) {
      expect(byId[id].status).toBe("catalog-only")
    }
  })

  it("enabled venues for the refresh job are exactly the rows with a capture hook (v1: EO)", () => {
    expect(enabledCaptureVenues()).toEqual(["expertoption"])
  })

  it("a row can be flipped without touching the engine (promote iqoption = data edit)", () => {
    const row = CAPTURE_PROFILES.find((p) => p.id === "iqoption")
    const original = row.capture.via
    try {
      row.capture.via = "liveEO" // the T10/T11 promotion, as a data change
      expect(enabledCaptureVenues()).toEqual(["expertoption", "iqoption"])
      expect(getCaptureProfile("iqoption").status).toBe("capture-only")
    } finally {
      row.capture.via = original
    }
    expect(enabledCaptureVenues()).toEqual(["expertoption"])
  })

  it("listCaptureProfiles returns copies — callers cannot corrupt the table", () => {
    const copy = listCaptureProfiles()
    copy[0].status = "catalog-only"
    expect(getCaptureProfile("expertoption").status).toBe("full")
  })
})

describe("refresh policy + cadence (T4 gate)", () => {
  it("default cadence comes from the profile row (30 min token)", () => {
    expect(refreshCadenceMs("expertoption")).toBe(30 * 60 * 1000)
    expect(isVenueEnabled("expertoption")).toBe(true)
    expect(isVenueEnabled("bybit")).toBe(false) // catalog-only has no hook
  })

  it("clampCadence bounds to [60s, 24h] and falls back on junk", () => {
    expect(clampCadence(1000, 30 * 60 * 1000)).toBe(60_000)
    expect(clampCadence(2 * 60 * 60 * 1000, 30 * 60 * 1000)).toBe(7_200_000)
    expect(clampCadence(48 * 60 * 60 * 1000, 30 * 60 * 1000)).toBe(24 * 60 * 60 * 1000)
    expect(clampCadence(Number.NaN, 30 * 60 * 1000)).toBe(30 * 60 * 1000)
    expect(clampCadence(0, 30 * 60 * 1000)).toBe(30 * 60 * 1000)
  })

  it("policy overrides cadence + enabled, and unknown venues are ignored", () => {
    setHeadlessSessionPolicy({ expertoption: { refreshCadenceMs: 2 * 60 * 60 * 1000 }, bogus: { enabled: false } })
    expect(refreshCadenceMs("expertoption")).toBe(7_200_000)
    setHeadlessSessionPolicy({ expertoption: { enabled: false } })
    expect(isVenueEnabled("expertoption")).toBe(false)
  })
})

describe("captureVenue states (T3)", () => {
  it("unknown venue → error, no browser touched", async () => {
    const r = await captureVenue("metaapi")
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/unknown venue/)
    expect(getSiteCredentials).not.toHaveBeenCalled()
  })

  it("catalog-only venues report not-enabled (Bybit etc.), no capture attempt", async () => {
    for (const id of ["bybit", "etoro", "plus500", "olymptrade", "deriv"]) {
      const r = await captureVenue(id)
      expect(r.state).toBe("not-enabled")
    }
    expect(getSiteCredentials).not.toHaveBeenCalled()
    expect(captureExpertOptionSession).not.toHaveBeenCalled()
  })

  it("capture-only venues without a built hook report not-enabled, not a claim", async () => {
    for (const id of ["iqoption", "binance", "kucoin", "okx"]) {
      const r = await captureVenue(id)
      expect(r.state).toBe("not-enabled")
    }
  })

  it("missing vault credentials → needs-credentials and NO capture/save (never fabricate login)", async () => {
    getSiteCredentials.mockResolvedValueOnce(null)
    const r = await captureVenue("expertoption")
    expect(r).toMatchObject({ state: "needs-credentials", venue: "expertoption" })
    expect(r.at).toBeTruthy()
    expect(captureExpertOptionSession).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it("guest session is reported guest — token never saved, no revive", async () => {
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    captureExpertOptionSession.mockResolvedValue({
      ok: true,
      token: TOK_B,
      source: "cookie:token",
      guest: true,
      saved: false,
      account: { type: "guest", guest: true }
    })
    const r = await captureVenue("expertoption")
    expect(r.state).toBe("guest")
    expect(r.account).toMatchObject({ type: "guest" })
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("capture throwing (host lock, no token) maps to an honest error state", async () => {
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    captureExpertOptionSession.mockRejectedValue(new Error("open an app.expertoption.finance tab first"))
    const r = await captureVenue("expertoption")
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/app\.expertoption\.(com|finance)/)
  })
})

describe("headlessSessionRefresh — scheduler wiring (T4)", () => {
  it("token changed → restartLiveEO({force:true}) and the report/status carry no token", async () => {
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    getCredentials.mockResolvedValueOnce({ expertoptionToken: TOK_A }).mockResolvedValueOnce({ expertoptionToken: TOK_B })
    const reports = await headlessSessionRefresh()
    expect(reports).toHaveLength(1)
    const report = reports[0]
    expect(report).toMatchObject({ state: "ok", venue: "expertoption", tokenChanged: true, reconnectTriggered: true })
    expect(restartLiveEO).toHaveBeenCalledWith({ force: true })
    // No token in the report or in the status surface, ever.
    const blob = JSON.stringify(report) + JSON.stringify(headlessSessionStatus())
    expect(blob).not.toContain(TOK_A)
    expect(blob).not.toContain(TOK_B)
    // Status surfacing reflects the run.
    expect(headlessSessionStatus().expertoption.status).toBe("ok")
    expect(headlessSessionStatus().expertoption.lastCaptureAt).toBeTruthy()
  })

  it("same token re-captured → no restart (flap guard)", async () => {
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    // before === after (capture saved what was already saved)
    getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })
    const report = (await headlessSessionRefresh())[0]
    expect(report.state).toBe("ok")
    expect(report.tokenChanged).toBe(false)
    expect(report.reconnectTriggered).toBe(false)
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("settings-only save (no token change) → no restart — mirrors credentials.test.mjs semantics", async () => {
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    let reads = 0
    getCredentials.mockImplementation(async () => {
      reads += 1
      return { expertoptionToken: TOK_A, riskPerTradePct: reads === 1 ? 2 : 5 } // settings changed, token identical
    })
    const report = (await headlessSessionRefresh())[0]
    expect(report.tokenChanged).toBe(false)
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("cadence gate: a second pass within the cadence is skipped, after it runs again", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
      getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
      getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })

      // kickstart → due immediately (no prior run)
      return headlessSessionRefresh().then(async (first) => {
        expect(first).toHaveLength(1)
        // 5 minutes later → still inside the 30 min cadence → skipped
        vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"))
        const second = await headlessSessionRefresh()
        expect(second).toHaveLength(0)
        // 31 minutes later → due again
        vi.setSystemTime(new Date("2026-01-01T00:31:00.000Z"))
        const third = await headlessSessionRefresh()
        expect(third).toHaveLength(1)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("a venue disabled by policy is skipped entirely", async () => {
    setHeadlessSessionPolicy({ expertoption: { enabled: false } })
    const reports = await headlessSessionRefresh()
    expect(reports).toHaveLength(0)
    expect(getSiteCredentials).not.toHaveBeenCalled()
  })
})