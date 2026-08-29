// captureVenue against the REAL reference implementation (T3 acceptance):
// real browserStudio.captureExpertOptionSession (the profile's capture hook)
// driven by the fake-page harness from browserStudio.login.test.mjs, real
// trading.mjs getCredentials/saveCredentials on a tmp data dir, and liveEO
// vi.mocked so the revive wiring is asserted rather than a real socket session.
//
// Covered: missing vault creds → needs-credentials with NO capture/save; guest
// session never saved; same-token re-capture → no revive (flap guard); changed
// token → restartLiveEO({force:true}) + observable token save; non-EO host →
// honest error with the pinned message; token never in any returned report.
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  let cookieList = []
  const pages = []
  const makePage = () => {
    let url = "https://app.example.com/dashboard"
    let evalResult = null
    return {
      isClosed: () => false,
      url: () => url,
      title: async () => "Fake",
      on: () => {},
      close: async () => {},
      goto: vi.fn(async (u) => {
        url = String(u)
      }),
      setUrl: (u) => {
        url = String(u)
      },
      setEval: (v) => {
        evalResult = v
      },
      evaluate: async () => evalResult,
      addInitScript: async () => {},
      exposeFunction: async () => Promise.resolve(),
      viewportSize: () => ({ width: 1440, height: 900 })
    }
  }
  const createContext = () => {
    const handlers = []
    return {
      pages: () => pages,
      newPage: async () => {
        const p = makePage()
        pages.push(p)
        return p
      },
      cookies: async () => cookieList,
      clearCookies: async () => {},
      newCDPSession: async () => ({ send: async () => {}, on: () => {}, detach: async () => {} }),
      close: async () => {},
      on: (name, cb) => {
        handlers.push([name, cb])
        return () => {}
      },
      _handlers: handlers
    }
  }
  return {
    pages,
    bridges: [],
    get cookies() {
      return cookieList
    },
    setCookies: (list) => {
      cookieList = list
    },
    makeBridge: () => {
      const context = createContext()
      const bridge = {
        context,
        page: null,
        frames: [],
        close: async () => {},
        onFrame: () => () => {},
        goto: async () => {},
        read: async () => ({}),
        evaluate: async () => null,
        addOverlay: async () => {},
        setOverlay: async () => {}
      }
      h.bridges.push({ bridge, context })
      return bridge
    }
  }
})

vi.mock("../services/browserBridge.mjs", () => ({
  openBridge: async () => h.makeBridge(),
  browserAvailable: () => true
}))

vi.mock("../services/liveEO.mjs", () => ({
  restartLiveEO: vi.fn(async () => true),
  feedProvenance: vi.fn(() => "studio"),
  liveEOStats: vi.fn(() => ({ legs: { extension: {}, studio: {} }, lastSeen: 0 })),
  liveEOData: vi.fn(() => null)
}))

import { restartLiveEO } from "../services/liveEO.mjs"

let tmp
let captureVenue
let headlessSessionStatus
let _approveFirstLogin
let _resetHeadlessSessionState
let bs
let respondIntervention

const TOKEN_A = "11111111111111111111111111111111" // already saved (before)
const TOKEN_B = "22222222222222222222222222222222" // what the page now carries
const VAULT_FILE = () => join(tmp, "browser-credentials.json")
const CREDS_FILE = () => join(tmp, "trading-credentials.json")

function seedVault() {
  return writeFile(VAULT_FILE(), JSON.stringify({ expertoption: { username: "trader@example.com", password: "pw" } }))
}

function seedTradingToken(token) {
  return writeFile(CREDS_FILE(), JSON.stringify({ expertoptionToken: token }))
}

function eoPage() {
  const p = h.bridges.at(-1).context.pages()[0]
  p.setUrl("https://app.expertoption.com/")
  return p
}

/** Storage-scan hits with domLoginSignals shape attached (the harness trick). */
function scanHits(token, { guest = false, active = true } = {}) {
  const hits = [{ source: "cookie", key: "token", value: token, score: 3 }]
  hits.guest = guest
  hits.active = active
  hits.email = "trader@example.com"
  hits.name = "Trader"
  hits.wallet = "demo"
  hits.balance = "$1,234.50"
  return hits
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-capture-venue-"))
  process.env.PICC_BROWSER_DATA_DIR = tmp
  process.env.PICC_TRADING_DATA_DIR = tmp
  vi.resetModules()
  const mod = await import("../services/captureProfiles.mjs")
  captureVenue = mod.captureVenue
  headlessSessionStatus = mod.headlessSessionStatus
  _approveFirstLogin = mod._approveFirstLogin
  _resetHeadlessSessionState = mod._resetHeadlessSessionState
  respondIntervention = (await import("../services/interventions.mjs")).respondIntervention
  bs = await import("../services/browserStudio.mjs")
  await bs.openStudio({ headless: true, homepage: "" })
  await seedVault()
})

afterAll(async () => {
  try {
    await bs.closeStudio()
  } catch {
    /* ignore */
  }
  rmSync(tmp, { recursive: true, force: true })
  delete process.env.PICC_BROWSER_DATA_DIR
  delete process.env.PICC_TRADING_DATA_DIR
})

beforeEach(() => {
  restartLiveEO.mockClear()
})

describe("captureVenue — real EO reference path", () => {
  it("missing vault credentials → needs-credentials, NO capture, NO save", async () => {
    await writeFile(VAULT_FILE(), JSON.stringify({}))
    const r = await captureVenue("expertoption", { page: eoPage() })
    expect(r).toMatchObject({ state: "needs-credentials", venue: "expertoption" })
    expect(r.at).toBeTruthy()
    // Nothing captured, nothing saved (nostroke on the token file).
    expect(restartLiveEO).not.toHaveBeenCalled()
    await seedVault() // restore for the rest of the suite
  })

  it("non-EO page → honest error with the pinned host message", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    const p = eoPage()
    p.setUrl("https://example.com/")
    const r = await captureVenue("expertoption", { page: p })
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/app\.expertoption\.(com|finance)/)
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("guest session → reported guest, token never saved, no revive", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    await rmSync(CREDS_FILE(), { force: true }) // no good token on disk
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B, { guest: true, active: false }))
    const r = await captureVenue("expertoption", { page: p })
    expect(r.state).toBe("guest")
    expect(r.account).toMatchObject({ type: "guest", guest: true })
    expect(restartLiveEO).not.toHaveBeenCalled()
    // Guest is never saved — the token file either stays absent or carries no
    // expertoptionToken (never the captured guest's token).
    let file = null
    try {
      file = JSON.parse(readFileSync(CREDS_FILE(), "utf8"))
    } catch {
      /* no file written — also fine */
    }
    expect(file?.expertoptionToken ?? "").not.toBe(TOKEN_B)
  })

  it("same token re-captured → ok, tokenChanged false, NO restart (flap guard)", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    await seedTradingToken(TOKEN_A)
    const p = eoPage()
    p.setEval(scanHits(TOKEN_A))
    const r = await captureVenue("expertoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.saved).toBe(true)
    expect(r.source).toBe("cookie:token")
    expect(r.tokenChanged).toBe(false)
    expect(r.reconnectTriggered).toBe(false)
    expect(restartLiveEO).not.toHaveBeenCalled()
    expect(r.account).toMatchObject({ type: "active", guest: false })
    expect(JSON.stringify(r)).not.toContain(TOKEN_A)
  })

  it("changed token → saved, tokenChanged true, restartLiveEO({force:true}), no token in report", async () => {
    await _approveFirstLogin("expertoption") // T9 gate: approved before first capture
    await seedTradingToken(TOKEN_A)
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B))
    const r = await captureVenue("expertoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.tokenChanged).toBe(true)
    expect(r.reconnectTriggered).toBe(true)
    expect(restartLiveEO).toHaveBeenCalledWith({ force: true })
    // The reference implementation's save is observable on disk and the report
    // body + status surface never carry the token.
    const saved = JSON.parse(readFileSync(CREDS_FILE(), "utf8"))
    expect(saved.expertoptionToken).toBe(TOKEN_B)
    expect(JSON.stringify(r)).not.toContain(TOKEN_A)
    expect(JSON.stringify(r)).not.toContain(TOKEN_B)
    expect(JSON.stringify(headlessSessionStatus())).not.toContain(TOKEN_B)
  })
})

describe("first-login approval gate — real harness (T9 / REQ-E)", () => {
  beforeEach(async () => {
    restartLiveEO.mockClear()
    await _resetHeadlessSessionState() // fresh gate state per test
    await rmSync(CREDS_FILE(), { force: true }) // clean slate for save assertions
  })

  it("the first capture emits a real capture proposal; the browser is NEVER touched", async () => {
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B)) // a logged-in session is RIGHT there — still gated
    const r = await captureVenue("expertoption", { page: p })
    expect(r).toMatchObject({ state: "pending-approval", venue: "expertoption" })
    expect(r.proposalId).toBeTruthy()
    expect(restartLiveEO).not.toHaveBeenCalled()
    // No save happened — the token file is absent or carries no expertoptionToken.
    let file = null
    try {
      file = JSON.parse(readFileSync(CREDS_FILE(), "utf8"))
    } catch {
      /* no file written — also fine */
    }
    expect(file?.expertoptionToken ?? "").not.toBe(TOKEN_B)
    // The proposal sits in the REAL interventions queue, source "capture".
    const { listInterventions } = await import("../services/interventions.mjs")
    const q = listInterventions().proposals.find((x) => x.id === r.proposalId)
    expect(q).toMatchObject({ source: "capture", action: "login", status: "pending" })
  })

  it("approve through the real endpoint → the real capture runs and saves", async () => {
    const first = await captureVenue("expertoption", { page: eoPage() })
    expect(first.state).toBe("pending-approval")
    const { respondIntervention: respond } = await import("../services/interventions.mjs")
    await respond({ id: first.proposalId, decision: "approve" })

    await seedTradingToken(TOKEN_A)
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B))
    const r = await captureVenue("expertoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.loginApproved).toBe(true) // approval echoed honestly in the report
    expect(r.tokenChanged).toBe(true)
    expect(r.saved).toBe(true)
    expect(restartLiveEO).toHaveBeenCalledWith({ force: true })
    const saved = JSON.parse(readFileSync(CREDS_FILE(), "utf8"))
    expect(saved.expertoptionToken).toBe(TOKEN_B)
    expect(JSON.stringify(r)).not.toContain(TOKEN_B)
    expect(JSON.stringify(headlessSessionStatus())).not.toContain(TOKEN_B)
  })

  it("reject → state rejected and the engine ignores a waiting logged-in page", async () => {
    const first = await captureVenue("expertoption", { page: eoPage() })
    const { respondIntervention: respond } = await import("../services/interventions.mjs")
    await respond({ id: first.proposalId, decision: "reject" })

    const p = eoPage()
    p.setEval(scanHits(TOKEN_B)) // live session observed — still not captured
    const r = await captureVenue("expertoption", { page: p })
    expect(r).toMatchObject({ state: "rejected", venue: "expertoption" })
    expect(r.reason).toMatch(/not approved/)
    expect(restartLiveEO).not.toHaveBeenCalled()
    let file = null
    try {
      file = JSON.parse(readFileSync(CREDS_FILE(), "utf8"))
    } catch {
      /* no file written — also fine */
    }
    expect(file?.expertoptionToken ?? "").not.toBe(TOKEN_B)
  })
})

describe("captureVenue — real storageScan path (IQ Option, T11)", () => {
  const VENUE_TOKENS_FILE = () => join(tmp, "trading-venue-tokens.json")

  function iqPage() {
    const p = h.bridges.at(-1).context.pages()[0]
    p.setUrl("https://iqoption.com/en/login")
    return p
  }

  /** Storage-scan hits for the iqoption row's ONE configured key (ssid), with domLoginSignals shape attached (the harness trick). */
  function iqHits(token, { guest = false, active = true } = {}) {
    const hits = [{ source: "cookie", key: "ssid", value: token, score: 0 }]
    hits.guest = guest
    hits.active = active
    hits.email = "iq@example.com"
    hits.name = "IQ Trader"
    hits.wallet = "demo"
    hits.balance = "$987.00"
    return hits
  }

  beforeEach(async () => {
    restartLiveEO.mockClear()
    await _resetHeadlessSessionState()
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    // Vault needs IQ credentials for the vault gate, EO creds for the other describes.
    await writeFile(
      VAULT_FILE(),
      JSON.stringify({
        expertoption: { username: "trader@example.com", password: "pw" },
        iqoption: { username: "iq@example.com", password: "pw" }
      })
    )
    await rmSync(VENUE_TOKENS_FILE(), { force: true }) // clean slate for save assertions
  })

  it("configured ssid cookie present → token saved under venueTokens.iqoption, NO live-leg restart", async () => {
    const p = iqPage()
    p.setEval(iqHits(TOKEN_B))
    const r = await captureVenue("iqoption", { page: p })
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
    expect(restartLiveEO).not.toHaveBeenCalled() // storage-scan venues have no live leg
    // The hook's save is observable on disk — in the DEDICATED venue-tokens
    // file, never inside trading-credentials.json (handlers spread that).
    const saved = JSON.parse(readFileSync(VENUE_TOKENS_FILE(), "utf8"))
    expect(saved.venueTokens?.iqoption).toBe(TOKEN_B)
    // Token never in the report or the status surface.
    expect(JSON.stringify(r)).not.toContain(TOKEN_B)
    expect(JSON.stringify(headlessSessionStatus())).not.toContain(TOKEN_B)
  })

  it("configured key absent on the page → honest error, nothing saved", async () => {
    const p = iqPage()
    p.setEval([]) // an IQ tab with NO ssid cookie anywhere
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/no configured session token/)
    expect(restartLiveEO).not.toHaveBeenCalled()
    let file = null
    try {
      file = JSON.parse(readFileSync(VENUE_TOKENS_FILE(), "utf8"))
    } catch {
      /* no file written — also fine */
    }
    expect(file?.venueTokens?.iqoption ?? "").not.toBe(TOKEN_B)
  })

  it("guest IQ page → reported guest, captured token never saved", async () => {
    const p = iqPage()
    p.setEval(iqHits(TOKEN_B, { guest: true, active: false }))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("guest")
    expect(r.account).toMatchObject({ type: "guest", guest: true })
    expect(restartLiveEO).not.toHaveBeenCalled()
    let file = null
    try {
      file = JSON.parse(readFileSync(VENUE_TOKENS_FILE(), "utf8"))
    } catch {
      /* no file written — also fine */
    }
    expect(file?.venueTokens?.iqoption ?? "").not.toBe(TOKEN_B)
  })

  it("wrong host (an EO tab) → honest host error for iqoption", async () => {
    const p = h.bridges.at(-1).context.pages()[0]
    p.setUrl("https://app.expertoption.com/") // the EO studio — not an IQ tab
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/IQ Option/i) // the venue is named in the honest host error
    expect(restartLiveEO).not.toHaveBeenCalled()
  })

  it("same ssid re-captured → ok, tokenChanged false (flap-guard analog)", async () => {
    await writeFile(VENUE_TOKENS_FILE(), JSON.stringify({ venueTokens: { iqoption: TOKEN_A } }))
    const p = iqPage()
    p.setEval(iqHits(TOKEN_A))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.saved).toBe(true)
    expect(r.tokenChanged).toBe(false)
    expect(r.reconnectTriggered).toBe(false)
    expect(restartLiveEO).not.toHaveBeenCalled()
    expect(JSON.stringify(r)).not.toContain(TOKEN_A)
  })
})