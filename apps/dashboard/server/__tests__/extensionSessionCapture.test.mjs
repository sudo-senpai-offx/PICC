// T13 — the extension session-capture leg (spec docs/specs/PICC_HEADLESS_CAPTURE_ENGINE.md)
//
// The PICC content script runs on every venue tab the human browses (studio
// browser optional). It observes the venue's configured storage keys +
// storage-tier account profile and relays the observation to
// POST /api/trading/capture-session, which applies the IDENTICAL rules of the
// studio leg: hostRe validation → guest decision → T9 first-login gate → save
// through the venue's own path → compare/revive (flap guard). This file pins
// the endpoint surface + the shared-rule parity at the HTTP layer. The REAL
// engine seams (browserStudio/trading/liveEO) are vi.mocked exactly like
// captureProfiles.test.mjs; interventions loads for real via the broadcast-mock
// surface so the T9 gate runs its true dashboard path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handleApi } from "../handlers.mjs"
import { stopLiveEO } from "../services/liveEO.mjs"
import {
  _approveFirstLogin,
  _resetHeadlessSessionState,
  captureSessionFromExtension,
  extensionCaptureConfigs,
  extensionCaptureConfigsByMinistry,
  headlessSessionRefresh,
  headlessSessionStatus
} from "../services/captureProfiles.mjs"
import { getCredentials, saveCredentials, getVenueToken, saveVenueToken } from "../services/trading.mjs"
import { restartLiveEO } from "../services/liveEO.mjs"

vi.mock("../services/trading.mjs", () => ({
  getCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  getVenueToken: vi.fn(),
  saveVenueToken: vi.fn()
}))
vi.mock("../services/liveEO.mjs", () => ({
  restartLiveEO: vi.fn(async () => true),
  stopLiveEO: vi.fn(async () => {}),
  feedProvenance: vi.fn(() => "extension"),
  liveEOStats: vi.fn(() => ({ legs: { extension: {}, studio: {} }, lastSeen: 0 }))
}))
// The REAL interventions module loads in this file (the T9 gate uses it) —
// give it the broadcast/lookup surface it statically imports (same pattern as
// captureProfiles.test.mjs).
vi.mock("../services/browserStudio.mjs", () => ({
  getSiteCredentials: vi.fn(),
  captureExpertOptionSession: vi.fn(async () => ({
    guest: false,
    account: { type: "active", guest: false, email: null, name: null },
    source: "cookie:token",
    token: "0123456789abcdef0123456789abcdef"
  })),
  captureViaStorageScan: vi.fn(),
  maskToken: vi.fn((t) => t ?? ""),
  studioBroadcast: vi.fn(),
  studioIsOpen: vi.fn(() => true),
  studioPageFor: vi.fn(() => null),
  studioTypeText: vi.fn(async () => {}),
  // Studio-leg host-matched tab lookup (same fixture as captureProfiles.test.mjs)
  studioLivePages: vi.fn(() => [{ url: () => "https://app.expertoption.com/", isClosed: () => false }])
}))

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  const remote = headers.host && !/^localhost(:|$)/.test(headers.host) ? "93.184.216.34" : "127.0.0.1"
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: remote },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

const EO_TOKEN = "0123456789abcdef0123456789abcdef"
const ACTIVE = { guest: false, active: true, email: "me@example.com", name: "Me" }

describe("POST /api/trading/capture-session (T13 extension leg)", () => {
  beforeEach(async () => {
    await _resetHeadlessSessionState()
    getCredentials.mockResolvedValue({ expertoptionToken: null })
    saveCredentials.mockResolvedValue(undefined)
    getVenueToken.mockResolvedValue(null)
    saveVenueToken.mockResolvedValue(undefined)
    restartLiveEO.mockResolvedValue(true)
    // Reset call history AFTER the resolved values are set: assertions like
    // `saveCredentials not called` must not see earlier tests' calls.
    vi.clearAllMocks()
  })
  afterEach(async () => {
    await _resetHeadlessSessionState()
    await stopLiveEO()
  })

  it("rejects GET, remote callers, and unauthenticated remote calls", async () => {
    const get = await call("GET", "/api/trading/capture-session", { venueId: "expertoption" })
    expect(get.status).toBe(405)
    const remote = await call("POST", "/api/trading/capture-session", { venueId: "expertoption" }, { host: "evil.example.com" })
    expect(remote.status).toBe(403)
    // Even WITH a bearer token a remote caller stays out — localhost-only is
    // the contract for a token-bearing endpoint, not the weakest of the two.
    const remoteAuthed = await call(
      "POST", "/api/trading/capture-session",
      { venueId: "expertoption", token: EO_TOKEN },
      { host: "evil.example.com", authorization: "Bearer whatever" }
    )
    expect(remoteAuthed.status).toBe(403)
  })

  it("unknown venue and unknown capture hooks report honestly", async () => {
    const unknown = await call("POST", "/api/trading/capture-session", { venueId: "coinbase", token: "x", url: "https://coinbase.com/" })
    expect(unknown.status).toBe(200)
    expect(unknown.body.state).toBe("error")
    expect(unknown.body.reason).toMatch(/unknown venue/)
    const noHook = await call("POST", "/api/trading/capture-session", { venueId: "binance", token: "x", url: "https://www.binance.com/" })
    expect(noHook.body.state).toBe("not-enabled")
  })

  it("EO observation with an active account saves via saveCredentials + revives once (token changed)", async () => {
    await _approveFirstLogin("expertoption")
    getCredentials.mockResolvedValue({ expertoptionToken: null })
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: EO_TOKEN,
      url: "https://app.expertoption.com/",
      account: ACTIVE,
      source: "cookie:token"
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      state: "ok",
      venue: "expertoption",
      saved: true,
      tokenChanged: true,
      reconnectTriggered: true,
      sourceLeg: "extension",
      source: "cookie:token",
      loginApproved: true
    })
    expect(saveCredentials).toHaveBeenCalledWith({ expertoptionToken: EO_TOKEN })
    expect(restartLiveEO).toHaveBeenCalledWith({ force: true })
    // The report NEVER carries a token, no matter the branch.
    expect(JSON.stringify(res.body)).not.toContain(EO_TOKEN)
    expect(res.body.token).toBeUndefined()
    expect(res.body.account).toMatchObject({ type: "active", email: "me@example.com" })
  })

  it("same token re-observed → no save side-effects flagged, NO restart (T4 flap guard)", async () => {
    await _approveFirstLogin("expertoption")
    getCredentials.mockResolvedValue({ expertoptionToken: EO_TOKEN })
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: EO_TOKEN,
      url: "https://app.expertoption.com/",
      account: ACTIVE
    })
    expect(res.body.tokenChanged).toBe(false)
    expect(res.body.state).toBe("ok")
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("EO cookie tokens with a binary prefix are normalized to the trailing 32-hex session id (server-side, one place)", async () => {
    await _approveFirstLogin("expertoption")
    const prefixed = `\u0001\u0002prefix:${EO_TOKEN}`
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: prefixed,
      url: "https://app.expertoption.com/",
      account: ACTIVE
    })
    expect(res.body.state).toBe("ok")
    expect(saveCredentials).toHaveBeenCalledWith({ expertoptionToken: EO_TOKEN })
  })

  it("storageScan venue (iqoption) saves via saveVenueToken and honestly reports liveLeg:false", async () => {
    await _approveFirstLogin("iqoption")
    getVenueToken.mockResolvedValue(null)
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "iqoption",
      token: "ssid-value-123",
      url: "https://iqoption.com/en/traderoom",
      account: ACTIVE
    })
    expect(res.body).toMatchObject({ state: "ok", venue: "iqoption", saved: true, tokenChanged: true, liveLeg: false, sourceLeg: "extension" })
    expect(saveVenueToken).toHaveBeenCalledWith("iqoption", "ssid-value-123")
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("guest session is reported guest — token NEVER saved, no revive", async () => {
    await _approveFirstLogin("expertoption")
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: EO_TOKEN,
      url: "https://app.expertoption.com/",
      account: { guest: true, active: false }
    })
    expect(res.body.state).toBe("guest")
    expect(res.body.account.guest).toBe(true)
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("UNPROVEN account (no profile signal) is saved, not reported guest — parity with the studio hook's catch default", async () => {
    // The extension cannot read the DOM-tier guest signal (login button /
    // avatar) by construction; the studio hook's own catch defaults to
    // guest=false and SAVES (browserStudio.mjs:3662-3664). A storage probe
    // finding no profile object must therefore NOT flip the observation to
    // guest — that was the live failure ("server never showed ok" for a
    // logged-in session whose profile was not in web storage).
    await _approveFirstLogin("expertoption")
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: EO_TOKEN,
      url: "https://app.expertoption.com/",
      account: { guest: false, active: false, email: null, name: null }
    })
    expect(res.body.state).toBe("ok")
    expect(res.body.account).toMatchObject({ type: "unknown", guest: false })
    expect(saveCredentials).toHaveBeenCalledWith({ expertoptionToken: EO_TOKEN })
  })

  it("legacy uuid::base64 web-storage tokens are accepted and saved as-is (same normalization as the studio hook)", async () => {
    await _approveFirstLogin("expertoption")
    const legacy = "01234567-89ab-cdef-0123-456789abcdef::/WiTID2B3LL6S2BHO3g=="
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: legacy,
      url: "https://app.expertoption.com/",
      account: ACTIVE
    })
    expect(res.body.state).toBe("ok")
    expect(saveCredentials).toHaveBeenCalledWith({ expertoptionToken: legacy })
  })

  it("venue URL that does not match the row's host pattern is refused", async () => {
    await _approveFirstLogin("expertoption")
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: EO_TOKEN,
      url: "https://evil.example.com/",
      account: ACTIVE
    })
    expect(res.body.state).toBe("error")
    expect(res.body.reason).toMatch(/does not match/)
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it("missing token observations are errors, not saves", async () => {
    await _approveFirstLogin("expertoption")
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: "",
      url: "https://app.expertoption.com/",
      account: ACTIVE
    })
    expect(res.body.state).toBe("error")
    expect(res.body.reason).toMatch(/no session token observed/)
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it("T9 gate: without human approval the observation is pending-approval and NOTHING is saved", async () => {
    const res = await call("POST", "/api/trading/capture-session", {
      venueId: "expertoption",
      token: EO_TOKEN,
      url: "https://app.expertoption.com/",
      account: ACTIVE
    })
    expect(res.body.state).toBe("pending-approval")
    expect(res.body.proposalId).toBeTypeOf("string")
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(restartLiveEO).not.toHaveBeenCalled()
  })
})

describe("GET /api/trading/capture-profiles (T13 scanner config)", () => {
  beforeEach(async () => {
    await _resetHeadlessSessionState()
  })
  afterEach(async () => {
    await _resetHeadlessSessionState()
  })

  it("serves key NAMES + host patterns only — no tokens, no credentials, no values", async () => {
    const res = await call("GET", "/api/trading/capture-profiles")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const ids = res.body.venues.map((v) => v.venueId)
    expect(ids).toContain("expertoption")
    expect(ids).toContain("iqoption")
    // Venues with no documented scan keys are absent — nothing honest to read.
    expect(ids).not.toContain("binance")
    const eo = res.body.venues.find((v) => v.venueId === "expertoption")
    expect(eo.hostRe).toBe("expertoption\\.(com|finance)")
    // The scan MODE the content script mirrors per venue: EO shape-scans like
    // the studio hook (captureExpertOptionSession); storageScan venues read
    // exact configured keys (captureViaStorageScan).
    expect(eo.via).toBe("liveEO")
    expect(eo.keys.map((k) => `${k.type}:${k.key}`)).toEqual([
      "cookie:token", "cookie:tokenDemo", "localStorage:token", "sessionStorage:token"
    ])
    expect(eo.profileKeys).toBe("user|account|profile|auth|session|current|me$|identity")
    const iq = res.body.venues.find((v) => v.venueId === "iqoption")
    expect(iq.via).toBe("storageScan")
    expect(iq.keys).toEqual([{ type: "cookie", key: "ssid", verified: false }])
    expect(iq.enabled).toBe(true)
    // The whole payload is key names + host patterns — assert the absence of
    // token-shaped values outright (values are never served).
    expect(JSON.stringify(res.body)).not.toContain("0123456789abcdef")
  })

  it("service view and endpoint view agree (one source of truth)", () => {
    const service = extensionCaptureConfigs().map((v) => v.venueId)
    // Capture venues + recognized (identity-only) venue hosts — the extension's
    // host catalog IS the served list; terminal-ccxt is recognized but has no
    // capture leg (never scannable).
    const ids = ["expertoption", "iqoption", "terminal-ccxt"]
    expect(service).toEqual(ids)
  })
})

describe("status provenance — sourceLeg (T13)", () => {
  beforeEach(async () => {
    await _resetHeadlessSessionState()
    getCredentials.mockResolvedValue({ expertoptionToken: null })
    saveCredentials.mockResolvedValue(undefined)
    getVenueToken.mockResolvedValue(null)
    saveVenueToken.mockResolvedValue(undefined)
    restartLiveEO.mockResolvedValue(true)
    vi.clearAllMocks()
  })
  afterEach(async () => {
    await _resetHeadlessSessionState()
    await stopLiveEO()
  })

  it("an extension-leg capture marks the status row sourceLeg:extension; a studio-leg run marks studio", async () => {
    await _approveFirstLogin("expertoption")
    await captureSessionFromExtension({
      venueId: "expertoption",
      token: "0123456789abcdef0123456789abcdef",
      url: "https://app.expertoption.com/",
      account: { guest: false, active: true }
    })
    expect(headlessSessionStatus().expertoption.sourceLeg).toBe("extension")
    expect(headlessSessionStatus().expertoption.status).toBe("ok")

    // Same venue, next process: the studio runner (captureVenue through the
    // studio-browser hook, driven by the scheduler — the production recorder)
    // marks sourceLeg "studio" — both legs stay visible in the surface.
    await _resetHeadlessSessionState()
    await _approveFirstLogin("expertoption")
    await headlessSessionRefresh()
    const row = headlessSessionStatus().expertoption
    expect(row.sourceLeg).toBe("studio")
    expect(row.status).toBe("ok")
  })

  it("a venue never captured reports sourceLeg null (honest provenance)", () => {
    expect(headlessSessionStatus().iqoption.sourceLeg).toBeNull()
  })
})

describe("per-ministry capture catalog (REQ-14)", () => {
  it("tags every served venue with its ministry", () => {
    const configs = extensionCaptureConfigs()
    expect(configs.length).toBeGreaterThan(0)
    for (const c of configs) expect(c.ministry).toBe("trading")
  })
  it("reports a ministry WITHOUT extension support honestly (empty, not fabricated)", () => {
    expect(extensionCaptureConfigsByMinistry("earnings")).toEqual([])
    expect(extensionCaptureConfigsByMinistry("intelligence")).toEqual([])
  })
  it("returns the capture-enabled venues for a supported ministry", () => {
    const ids = extensionCaptureConfigsByMinistry("trading").map((c) => c.venueId)
    expect(ids).toContain("expertoption")
    expect(ids).toContain("iqoption")
  })
})