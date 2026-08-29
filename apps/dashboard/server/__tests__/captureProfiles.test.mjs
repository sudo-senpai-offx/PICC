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
  _resetHeadlessSessionState,
  _approveFirstLogin
} from "../services/captureProfiles.mjs"
import { captureExpertOptionSession, captureViaStorageScan, getSiteCredentials, studioLivePages } from "../services/browserStudio.mjs"
import { getCredentials, saveCredentials, getVenueToken, saveVenueToken } from "../services/trading.mjs"
import { restartLiveEO } from "../services/liveEO.mjs"

vi.mock("../services/browserStudio.mjs", () => ({
  getSiteCredentials: vi.fn(),
  captureExpertOptionSession: vi.fn(),
  captureViaStorageScan: vi.fn(), // T11 generic storage-scan hook
  maskToken: vi.fn((t) => t ?? ""),
  // Host-matched tab lookup (T12.1 after-login flow): a stub EO + IQ tab so
  // captureVenue's venue-by-host resolution finds a page for either venue.
  studioLivePages: vi.fn(() => [
    { url: () => "https://app.expertoption.com/", isClosed: () => false },
    { url: () => "https://iqoption.com/en/login", isClosed: () => false }
  ]),
  // The REAL interventions module loads in this file (the T9 gate uses it) —
  // give it the broadcast/lookup surface it statically imports.
  studioBroadcast: vi.fn(),
  studioIsOpen: vi.fn(() => true),
  studioPageFor: vi.fn(() => null),
  studioTypeText: vi.fn(async () => {})
}))
vi.mock("../services/trading.mjs", () => ({
  getCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  getVenueToken: vi.fn(), // T11 venue-tokens seam
  saveVenueToken: vi.fn()
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

beforeEach(async () => {
  vi.clearAllMocks()
  await _resetHeadlessSessionState()
  getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })
  getVenueToken.mockResolvedValue(TOK_A)
  captureExpertOptionSession.mockResolvedValue({
    ok: true,
    token: TOK_A,
    source: "cookie:token",
    guest: false,
    saved: true,
    account: { type: "active", guest: false, email: "trader@example.com" }
  })
  captureViaStorageScan.mockResolvedValue({
    ok: true,
    token: TOK_A,
    source: "cookie:ssid",
    guest: false,
    saved: true,
    account: { type: "active", guest: false, email: "iq@example.com" }
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

  it("ExpertOption + IQ Option are the full profiles; the rest are honest v1 states", () => {
    const byId = Object.fromEntries(listCaptureProfiles().map((p) => [p.id, p]))
    expect(byId.expertoption.status).toBe("full")
    expect(byId.expertoption.capture.via).toBe("liveEO")
    expect(byId.expertoption.demoReal).toBe("demo-first")
    // T11 promotion: iqoption is a DATA flip onto the generic storageScan hook
    // (browserStudio.captureViaStorageScan). The row names the exact keys the
    // hook may read — nothing invented.
    expect(byId.iqoption.status).toBe("full")
    expect(byId.iqoption.capture.via).toBe("storageScan")
    expect(byId.iqoption.capture.storageScan).toEqual([{ type: "cookie", key: "ssid", verified: false }])
    expect(byId.iqoption.capture.hostRe).toBeTruthy()
    expect(byId.iqoption.demoReal).toBe("demo-first")
    for (const id of ["binance", "kucoin", "okx"]) {
      expect(byId[id].status).toBe("capture-only")
      expect(byId[id].capture.via).toBeNull() // mechanism ready, ZERO documented keys — live fixture gates them
    }
    for (const id of ["bybit", "etoro", "plus500", "olymptrade", "deriv"]) {
      expect(byId[id].status).toBe("catalog-only")
    }
  })

  it("enabled venues for the refresh job are exactly the rows with a capture hook (v2: EO + iqoption)", () => {
    expect(enabledCaptureVenues()).toEqual(["expertoption", "iqoption"])
  })

  it("a row can be flipped without touching the engine (promote bybit = data edit)", () => {
    const row = CAPTURE_PROFILES.find((p) => p.id === "bybit")
    const original = row.capture.via
    try {
      row.capture.via = "storageScan" // a future promotion, as a data change
      expect(enabledCaptureVenues()).toEqual(["bybit", "expertoption", "iqoption"])
      expect(getCaptureProfile("bybit").status).toBe("catalog-only") // row data untouched
    } finally {
      row.capture.via = original
    }
    expect(enabledCaptureVenues()).toEqual(["expertoption", "iqoption"])
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

  it("T8 status surface is honest before any run: idle+stale for capture-capable, not-enabled for the rest", () => {
    const rows = headlessSessionStatus()
    expect(rows.expertoption.status).toBe("idle") // full venue, never captured — idle, NOT ok
    expect(rows.expertoption.stale).toBe(true) // never captured = the stalest possible state
    expect(rows.expertoption.lastCaptureAt).toBeNull()
    expect(rows.expertoption.tokenChangedAt).toBeNull()
    expect(rows.bybit.status).toBe("not-enabled") // catalog-only — honest, and NOT stale
    expect(rows.bybit.stale).toBe(false)
    expect(rows.iqoption.status).toBe("idle") // T11: storageScan hook exists → capture-capable
    expect(rows.iqoption.stale).toBe(true) // never captured = the stalest possible state
    expect(rows.iqoption.enabled).toBe(true)
    expect(rows.iqoption.lastCaptureAt).toBeNull()
    // capture-capable venues all surface the same never-run truth.
    for (const id of ["iqoption", "binance", "kucoin", "okx", "bybit", "etoro", "plus500", "olymptrade", "deriv"]) {
      expect(["not-enabled", "idle"]).toContain(rows[id].status)
    }
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
    for (const id of ["binance", "kucoin", "okx"]) {
      const r = await captureVenue(id)
      expect(r.state).toBe("not-enabled")
    }
  })

  it("no vault entry → capture is NOT vault-gated (the logged-in tab is the credential)", async () => {
    // Regression (T12.1): EO showed "login needed · stale" forever after a
    // manual relog because the legacy form-fill vault gate demanded a
    // username/password entry that exists for no venue the user form-fills.
    // Token-capture venues gate on T9 approval + a host-matched tab instead.
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    getSiteCredentials.mockResolvedValue(null) // vault: no expertoption entry at all
    const r = await captureVenue("expertoption")
    expect(r.state).toBe("ok")
    expect(r.loginApproved).toBe(true)
    expect(captureExpertOptionSession).toHaveBeenCalledTimes(1)
    expect(saveCredentials).not.toHaveBeenCalled() // the SAVE itself runs inside the hook
  })

  it("approved but NO matching venue tab → honest no-tab, hook never called", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    studioLivePages.mockReturnValueOnce([]) // no tabs at all
    const r = await captureVenue("expertoption")
    expect(r.state).toBe("no-tab")
    expect(r.venue).toBe("expertoption")
    expect(captureExpertOptionSession).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("guest session is reported guest — token never saved, no revive", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
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
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    captureExpertOptionSession.mockRejectedValue(new Error("open an app.expertoption.finance tab first"))
    const r = await captureVenue("expertoption")
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/app\.expertoption\.(com|finance)/)
  })

  it("storageScan venues run the SAME first-login gate (iqoption)", async () => {
    getSiteCredentials.mockResolvedValue({ site: "iqoption", username: "u", password: "p" })
    const r = await captureVenue("iqoption")
    expect(r).toMatchObject({ state: "pending-approval", venue: "iqoption" })
    expect(captureViaStorageScan).not.toHaveBeenCalled() // browser UNTOUCHED
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("storageScan ok capture → saved + tokenChanged, NO live-leg restart (honest)", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    getSiteCredentials.mockResolvedValue({ site: "iqoption", username: "u", password: "p" })
    getVenueToken.mockResolvedValueOnce(null).mockResolvedValueOnce(TOK_B)
    captureViaStorageScan.mockResolvedValue({
      ok: true,
      token: TOK_B,
      source: "cookie:ssid",
      guest: false,
      saved: true,
      account: { type: "active", guest: false, email: "iq@example.com" }
    })
    const r = await captureVenue("iqoption")
    expect(r).toMatchObject({
      state: "ok",
      venue: "iqoption",
      saved: true,
      source: "cookie:ssid",
      tokenChanged: true,
      reconnectTriggered: false,
      liveLeg: false, // honest: no live bridge consumes this token yet
      loginApproved: true
    })
    // The runner hands the hook the HOST-MATCHED tab (never the active tab).
    expect(captureViaStorageScan).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.any(Function) }),
      expect.objectContaining({ via: "storageScan", hostRe: "iqoption\\.com", venueId: "iqoption" })
    )
    // The SAVE itself runs inside the hook (trading.saveVenueToken) — this
    // layer only proves the before/after compare + the honest report. The real
    // save-on-disk is asserted in captureVenue.test.mjs (real hook) and in
    // trading.test.mjs (venue-tokens seam).
    expect(restartLiveEO).not.toHaveBeenCalled() // storage-scan venues have no live leg
    // Token never reaches a report or the status surface.
    const blob = JSON.stringify(r) + JSON.stringify(headlessSessionStatus())
    expect(blob).not.toContain(TOK_B)
    // tokenChangedAt surfaces WHEN, never the value (status "ok" is asserted
    // through the refresh pass in the participation test).
    expect(headlessSessionStatus().iqoption.tokenChangedAt).toBe(r.at)
  })

  it("storageScan guest → reported guest, token never saved", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    getSiteCredentials.mockResolvedValue({ site: "iqoption", username: "u", password: "p" })
    captureViaStorageScan.mockResolvedValue({
      ok: true,
      token: TOK_B,
      source: "cookie:ssid",
      guest: true,
      saved: false,
      account: { type: "guest", guest: true }
    })
    const r = await captureVenue("iqoption")
    expect(r.state).toBe("guest")
    expect(r.account).toMatchObject({ type: "guest" })
    expect(saveVenueToken).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("storageScan capture throwing (host lock, no key) maps to an honest error", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    getSiteCredentials.mockResolvedValue({ site: "iqoption", username: "u", password: "p" })
    captureViaStorageScan.mockRejectedValue(new Error("no configured session token found on this page — log in first (IQ Option)"))
    const r = await captureVenue("iqoption")
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/no configured session token/)
    expect(saveVenueToken).not.toHaveBeenCalled()
  })
})

describe("headlessSessionRefresh — scheduler wiring (T4)", () => {
  it("token changed → restartLiveEO({force:true}) and the report/status carry no token", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    setHeadlessSessionPolicy({ iqoption: { enabled: false } }) // T11: keep this EO-focused test single-venue
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
    // T8: the surface says WHEN the token changed — never the value.
    expect(headlessSessionStatus().expertoption.tokenChangedAt).toBe(report.at)
  })

  it("same token re-captured → tokenChangedAt stays null (nothing changed)", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })
    await headlessSessionRefresh()
    expect(headlessSessionStatus().expertoption.tokenChangedAt).toBeNull()
  })

  it("same token re-captured → no restart (flap guard)", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
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
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
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

  it("cadence gate: a second pass within the cadence is skipped, after it runs again", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
      setHeadlessSessionPolicy({ iqoption: { enabled: false } }) // T11: keep this cadence test single-venue
      getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
      getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })

      // kickstart → due immediately (no prior run). The gate must be approved
      // or this run would report pending-approval and never count as fresh.
      await _approveFirstLogin("expertoption")
      const first = await headlessSessionRefresh()
      expect(first).toHaveLength(1)
      // 5 minutes later → still inside the 30 min cadence → skipped
      vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"))
      const second = await headlessSessionRefresh()
      expect(second).toHaveLength(0)
      // 31 minutes later → due again
      vi.setSystemTime(new Date("2026-01-01T00:31:00.000Z"))
      const third = await headlessSessionRefresh()
      expect(third).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("venues disabled by policy are skipped entirely", async () => {
    setHeadlessSessionPolicy({ expertoption: { enabled: false }, iqoption: { enabled: false } })
    const reports = await headlessSessionRefresh()
    expect(reports).toHaveLength(0)
    expect(getSiteCredentials).not.toHaveBeenCalled()
  })

  it("iqoption participates in the refresh pass once it has a hook (storageScan, same gate)", async () => {
    await _approveFirstLogin("expertoption")
    await _approveFirstLogin("iqoption")
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })
    getVenueToken.mockResolvedValue(TOK_A)
    const reports = await headlessSessionRefresh()
    expect(reports).toHaveLength(2) // both full-profile venues run in one pass
    const iq = reports.find((r) => r.venue === "iqoption")
    expect(iq).toMatchObject({ state: "ok", venue: "iqoption", loginApproved: true })
    expect(iq.reconnectTriggered).toBe(false)
    expect(iq.liveLeg).toBe(false)
    expect(headlessSessionStatus().iqoption.status).toBe("ok")
    expect(headlessSessionStatus().iqoption.enabled).toBe(true)
  })
})

describe("first-login approval gate (T9 / REQ-E)", () => {
  it("the first capture yields a proposal + pending-approval, browser UNTOUCHED", async () => {
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    const r = await captureVenue("expertoption")
    expect(r).toMatchObject({ state: "pending-approval", venue: "expertoption" })
    expect(r.proposalId).toBeTruthy()
    // The reference capture was never invoked — no login happened.
    expect(captureExpertOptionSession).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()
    // The proposal is visible in the interventions queue, source "capture".
    const { listInterventions } = await import("../services/interventions.mjs")
    const q = listInterventions().proposals.find((p) => p.id === r.proposalId)
    expect(q).toBeTruthy()
    expect(q.source).toBe("capture")
    expect(q.action).toBe("login")
    expect(q.status).toBe("pending")
  })

  it("approve (real respondIntervention path) → the next capture runs and reports ok + masked", async () => {
    const { listInterventions, respondIntervention } = await import("../services/interventions.mjs")
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    getCredentials.mockResolvedValueOnce({ expertoptionToken: TOK_A }).mockResolvedValueOnce({ expertoptionToken: TOK_B })
    const first = await captureVenue("expertoption")
    expect(first.state).toBe("pending-approval")
    expect(captureExpertOptionSession).not.toHaveBeenCalled()

    // The human approves through the SAME endpoint the dashboard uses.
    await respondIntervention({ id: first.proposalId, decision: "approve" })

    const r = await captureVenue("expertoption")
    expect(r.state).toBe("ok")
    expect(r.tokenChanged).toBe(true)
    expect(r.loginApproved).toBe(true) // approval echoed in the report
    expect(restartLiveEO).toHaveBeenCalledWith({ force: true })
    expect(JSON.stringify(r)).not.toContain(TOK_A)
    expect(JSON.stringify(r)).not.toContain(TOK_B)
  })

  it("reject → no token saved, state rejected; the cooldown suppresses re-asking", async () => {
    const { listInterventions, respondIntervention } = await import("../services/interventions.mjs")
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    const first = await captureVenue("expertoption")
    expect(first.state).toBe("pending-approval")
    await respondIntervention({ id: first.proposalId, decision: "reject" })

    const r = await captureVenue("expertoption")
    expect(r).toMatchObject({ state: "rejected", venue: "expertoption" })
    expect(captureExpertOptionSession).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()

    // Within the cooldown, subsequent passes report rejected WITHOUT spamming
    // the queue with a fresh proposal.
    const again = await captureVenue("expertoption")
    expect(again.state).toBe("rejected")
    const captureProposals = listInterventions().proposals.filter((p) => p.source === "capture")
    expect(captureProposals.filter((p) => p.status === "pending")).toHaveLength(0)
  })

  it("after the rejection cooldown the gate re-arms and asks again (fake timers)", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
      const { respondIntervention } = await import("../services/interventions.mjs")
      getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
      const first = await captureVenue("expertoption")
      await respondIntervention({ id: first.proposalId, decision: "reject" })
      let r = await captureVenue("expertoption")
      expect(r.state).toBe("rejected")

      vi.setSystemTime(new Date("2026-01-01T00:31:00.000Z")) // 31 minutes later
      r = await captureVenue("expertoption")
      expect(r.state).toBe("pending-approval") // re-asked, honestly
      expect(r.proposalId).not.toBe(first.proposalId) // a FRESH proposal

      // And the fresh proposal can be approved to completion.
      vi.setSystemTime(new Date("2026-01-01T00:32:00.000Z"))
      await respondIntervention({ id: r.proposalId, decision: "approve" })
      getCredentials.mockResolvedValue({ expertoptionToken: TOK_A })
      const ok = await captureVenue("expertoption")
      expect(ok.state).toBe("ok")
      expect(ok.loginApproved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("pending-approval does not count against the refresh cadence — the job retries next pass", async () => {
    setHeadlessSessionPolicy({ iqoption: { enabled: false } }) // T11: keep this gate test single-venue
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    const first = await headlessSessionRefresh()
    expect(first).toHaveLength(1)
    expect(first[0].state).toBe("pending-approval")
    // lastAutoRun is untouched (only ok/guest count) → the very next pass runs again.
    const second = await headlessSessionRefresh()
    expect(second).toHaveLength(1)
    expect(second[0].state).toBe("pending-approval")
  })

  it("headlessSessionStatus reports a gate-held run as NOT stale (engine is faithfully waiting)", async () => {
    getSiteCredentials.mockResolvedValue({ site: "expertoption", username: "u", password: "p" })
    const reports = await headlessSessionRefresh() // records lastReports, unlike a bare captureVenue
    expect(reports[0].state).toBe("pending-approval")
    const row = headlessSessionStatus().expertoption
    expect(row.status).toBe("pending-approval")
    expect(row.stale).toBe(false)
    expect(row.lastCaptureAt).toBeTruthy() // the At of the honest pending report
  })

  it("demo-first is the structural default: server rows never touch a real wallet for trading", () => {
    const byId = Object.fromEntries(listCaptureProfiles().map((p) => [p.id, p]))
    for (const id of Object.keys(PLATFORM_KINDS)) {
      expect(byId[id].demoReal).toBe("demo-first")
    }
    // REQ-E: no order/wallet-selection code exists anywhere in the engine —
    // nothing in the capture path can select a real wallet for trading.
    expect(getCaptureProfile("expertoption").kind).toBe("binary")
  })
})