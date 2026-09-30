// captureVenue against the REAL reference implementation (T3 acceptance):
// real browserStudio.captureViaStorageScan (the profile's capture hook)
// driven by the fake-page harness from browserStudio.login.test.mjs, real
// trading.mjs getCredentials/saveCredentials on a tmp data dir.
//
// D2/AC-005: the ExpertOption reference implementation and `services/liveEO.mjs`
// are deleted with the venue, so the `vi.mock("../services/liveEO.mjs")` block
// and the `restartLiveEO` assertions are removed. The revive wiring they pinned
// is gone because NO venue has a live leg now, so the report carries no revive
// field at all and its ABSENCE is asserted directly instead.
//
// Covered: empty vault + logged-in tab → capture still runs (after-login
// workflow, T12.1); no matching tab → honest no-tab; guest session never
// saved; same-token re-capture → no revive (flap guard); changed token →
// observable token save with no revive field on the report; non-venue host → honest
// error with the pinned message; token never in any returned report.
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
// D2/AC-005: iqoption is a storageScan venue, so its token is saved in the
// DEDICATED venue-tokens file (never inside trading-credentials.json). The EO
// reference path used the credentials file; the assertion is re-pointed, not
// dropped, so the save is still proven observable on disk.
const VENUE_TOKENS_FILE = () => join(tmp, "trading-venue-tokens.json")

function seedVault() {
  return writeFile(VAULT_FILE(), JSON.stringify({ iqoption: { username: "trader@example.com", password: "pw" } }))
}

function seedTradingToken(token) {
  return writeFile(VENUE_TOKENS_FILE(), JSON.stringify({ venueTokens: { iqoption: token } }))
}

// D2/AC-005: the venue token lives in the dedicated venue-tokens file, read
// back through the vault (F-02, encrypted at rest) — never raw JSON.parse.
async function readSavedToken() {
  const { readSecretJson } = await import("../services/vault.mjs")
  return (await readSecretJson(VENUE_TOKENS_FILE(), {})).venueTokens?.iqoption ?? null
}

function eoPage() {
  const p = h.bridges.at(-1).context.pages()[0]
  p.setUrl("https://iqoption.com/en/login")
  return p
}

/** Storage-scan hits with domLoginSignals shape attached (the harness trick). */
function scanHits(token, { guest = false, active = true } = {}) {
  const hits = [{ source: "cookie", key: "ssid", value: token, score: 3 }]
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

// D2/AC-005: the top-level `beforeEach(() => { restartLiveEO.mockClear() })` is
// removed with the module. The report's ABSENCE of any revive field is now
// asserted directly on each report, which is the honest signal and does not
// depend on a mock.

describe("captureVenue — real reference path (D2/AC-005: re-pointed from EO to iqoption)", () => {
  it("vault has NO iqoption entry — the logged-in tab alone drives capture (after-login workflow)", async () => {
    // The user logged in by hand in the PICC browser; no username/password was
    // ever pasted into the vault. The vault gate must not block: the REAL session
    // on the open venue tab IS the credential. (Regression: the venue showed
    // "login needed · stale" forever after relogging because the legacy form-fill
    // vault gate stopped the engine before it ever looked at the tab.)
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    await writeFile(VAULT_FILE(), JSON.stringify({})) // no iqoption entry at all
    await seedTradingToken(TOKEN_A)
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.saved).toBe(true)
    expect(r.tokenChanged).toBe(true)
    expect(r).not.toHaveProperty("reconnectTriggered") // D2: no venue has a live leg to restart
    expect(r).not.toHaveProperty("liveLeg")
    expect(await readSavedToken()).toBe(TOKEN_B)
    expect(JSON.stringify(r)).not.toContain(TOKEN_B)
    await seedVault() // restore for the rest of the suite
  })

  it("no matching venue tab → honest no-tab, nothing touched, no revive", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    // The only tracked studio tab points at a non-venue site — the engine must
    // NOT grab the active tab (the user may be looking at anything); it asks
    // for the venue's own tab instead.
    const p = eoPage()
    p.setUrl("https://example.com/")
    const r = await captureVenue("iqoption") // NO page given — host lookup decides
    expect(r.state).toBe("no-tab")
    expect(r.venue).toBe("iqoption")
    expect(r.reason).toMatch(/IQ Option|iqoption/i)
    expect(JSON.stringify(r)).not.toContain(TOKEN_B)
  })

  it("non-venue page → honest error with the pinned host message", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    const p = eoPage()
    p.setUrl("https://example.com/")
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/IQ Option|iqoption/i)
  })

  it("guest session → reported guest, token never saved, no revive", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    await rmSync(VENUE_TOKENS_FILE(), { force: true }) // no good token on disk
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B, { guest: true, active: false }))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("guest")
    expect(r.account).toMatchObject({ type: "guest", guest: true })
    // Guest is never saved — the token file either stays absent or carries no
    // iqoption token (never the captured guest's token).
    let saved = null
    try {
      saved = await readSavedToken()
    } catch {
      /* no file written — also fine */
    }
    expect(saved ?? "").not.toBe(TOKEN_B)
  })

  it("same token re-captured → ok, tokenChanged false, NO restart (flap guard)", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    await seedTradingToken(TOKEN_A)
    const p = eoPage()
    p.setEval(scanHits(TOKEN_A))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.saved).toBe(true)
    expect(r.source).toBe("cookie:ssid")
    expect(r.tokenChanged).toBe(false)
    expect(r.account).toMatchObject({ type: "active", guest: false })
    expect(r).not.toHaveProperty("reconnectTriggered")
    expect(JSON.stringify(r)).not.toContain(TOKEN_A)
  })

  it("changed token → saved, tokenChanged true, no token in report", async () => {
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    await seedTradingToken(TOKEN_A)
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.tokenChanged).toBe(true)
    expect(r).not.toHaveProperty("reconnectTriggered")
    // The reference implementation's save is observable on disk and the report
    // body + status surface never carry the token.
    expect(await readSavedToken()).toBe(TOKEN_B)
    expect(JSON.stringify(r)).not.toContain(TOKEN_A)
    expect(JSON.stringify(r)).not.toContain(TOKEN_B)
    expect(JSON.stringify(headlessSessionStatus())).not.toContain(TOKEN_B)
  })
})

describe("first-login approval gate — real harness (T9 / REQ-E)", () => {
  beforeEach(async () => {
    await _resetHeadlessSessionState() // fresh gate state per test
    await rmSync(VENUE_TOKENS_FILE(), { force: true }) // clean slate for save assertions
  })

  it("the first capture emits a real capture proposal; the browser is NEVER touched", async () => {
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B)) // a logged-in session is RIGHT there — still gated
    const r = await captureVenue("iqoption", { page: p })
    expect(r).toMatchObject({ state: "pending-approval", venue: "iqoption" })
    expect(r.proposalId).toBeTruthy()
    // No save happened — the token file is absent or carries no iqoption token.
    let saved = null
    try {
      saved = await readSavedToken()
    } catch {
      /* no file written — also fine */
    }
    expect(saved ?? "").not.toBe(TOKEN_B)
    // The proposal sits in the REAL interventions queue, source "capture".
    const { listInterventions } = await import("../services/interventions.mjs")
    const q = listInterventions().proposals.find((x) => x.id === r.proposalId)
    expect(q).toMatchObject({ source: "capture", action: "login", status: "pending" })
  })

  it("approve through the real endpoint → the real capture runs and saves", async () => {
    const first = await captureVenue("iqoption", { page: eoPage() })
    expect(first.state).toBe("pending-approval")
    const { respondIntervention: respond } = await import("../services/interventions.mjs")
    await respond({ id: first.proposalId, decision: "approve" })

    await seedTradingToken(TOKEN_A)
    const p = eoPage()
    p.setEval(scanHits(TOKEN_B))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.loginApproved).toBe(true) // approval echoed honestly in the report
    expect(r.tokenChanged).toBe(true)
    expect(r.saved).toBe(true)
    expect(await readSavedToken()).toBe(TOKEN_B)
    expect(JSON.stringify(r)).not.toContain(TOKEN_B)
    expect(JSON.stringify(headlessSessionStatus())).not.toContain(TOKEN_B)
  })

  it("reject → state rejected and the engine ignores a waiting logged-in page", async () => {
    const first = await captureVenue("iqoption", { page: eoPage() })
    const { respondIntervention: respond } = await import("../services/interventions.mjs")
    await respond({ id: first.proposalId, decision: "reject" })

    const p = eoPage()
    p.setEval(scanHits(TOKEN_B)) // live session observed — still not captured
    const r = await captureVenue("iqoption", { page: p })
    expect(r).toMatchObject({ state: "rejected", venue: "iqoption" })
    // Honest non-approval reason: either the persisted "turned off in Settings"
    // path (this harness persists in-memory only) or the classic cooldown text.
    expect(r.reason).toMatch(/not approved|turned off in Settings/)
    let saved = null
    try {
      saved = await readSavedToken()
    } catch {
      /* no file written — also fine */
    }
    expect(saved ?? "").not.toBe(TOKEN_B)
  })
})

describe("captureVenue — real storageScan path (IQ Option, T11)", () => {
  async function readVenueTokens() {
    const { readSecretJson } = await import("../services/vault.mjs")
    return readSecretJson(VENUE_TOKENS_FILE(), {})
  }

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
    await _resetHeadlessSessionState()
    await _approveFirstLogin("iqoption") // T9 gate: approved before first capture
    // Vault entries are vestigial for token-capture venues now (T12.1: the
    // logged-in tab is the credential, not the vault) — seeded for parity with
    // the reference-path describe.
    await writeFile(
      VAULT_FILE(),
      JSON.stringify({
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
      loginApproved: true
    })
    // The hook's save is observable on disk — in the DEDICATED venue-tokens
    // file, never inside trading-credentials.json (handlers spread that).
    const saved = await readVenueTokens()
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
    let file = null
    try {
      file = await readVenueTokens()
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
    let file = null
    try {
      file = await readVenueTokens()
    } catch {
      /* no file written — also fine */
    }
    expect(file?.venueTokens?.iqoption ?? "").not.toBe(TOKEN_B)
  })

  it("wrong host (an unrelated tab) → honest host error for iqoption", async () => {
    const p = h.bridges.at(-1).context.pages()[0]
    p.setUrl("https://example.com/") // not an IQ tab
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("error")
    expect(r.reason).toMatch(/IQ Option/i) // the venue is named in the honest host error
  })

  it("same ssid re-captured → ok, tokenChanged false (flap-guard analog)", async () => {
    await writeFile(VENUE_TOKENS_FILE(), JSON.stringify({ venueTokens: { iqoption: TOKEN_A } }))
    const p = iqPage()
    p.setEval(iqHits(TOKEN_A))
    const r = await captureVenue("iqoption", { page: p })
    expect(r.state).toBe("ok")
    expect(r.saved).toBe(true)
    expect(r.tokenChanged).toBe(false)
    expect(r).not.toHaveProperty("reconnectTriggered")
    expect(JSON.stringify(r)).not.toContain(TOKEN_A)
  })
})