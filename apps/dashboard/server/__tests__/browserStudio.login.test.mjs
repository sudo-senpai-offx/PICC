import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Login-state detection — generic per-site sign-in awareness. PICC must know
// what is actually signed in across the studio tabs (so the trading bridge can
// revive itself the moment an ExpertOption login lands). These tests pin the
// URL / DOM / cookie heuristics and the public refreshLoginStates() refresh.
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
let m

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-browser-login-"))
  process.env.PICC_BROWSER_DATA_DIR = tmp
  process.env.PICC_TRADING_DATA_DIR = tmp
  m = await import("../services/browserStudio.mjs")
  await m.openStudio({ headless: true, homepage: "" })
})

afterAll(async () => {
  try {
    await m.closeStudio()
  } catch {
    /* ignore */
  }
  rmSync(tmp, { recursive: true, force: true })
  delete process.env.PICC_BROWSER_DATA_DIR
  delete process.env.PICC_TRADING_DATA_DIR
})

function page() {
  return h.bridges.at(-1).context.pages()[0]
}

describe("detectLoginState — heuristics", () => {
  it("flags a /login URL as signed out with high confidence", async () => {
    const p = page()
    p.setUrl("https://app.example.com/login?next=dashboard")
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(false)
    expect(auth.confidence).toBe("high")
    expect(auth.method).toBe("url")
  })

  it("detects a logout control as signed in (high)", async () => {
    const p = page()
    p.setUrl("https://app.example.com/dashboard")
    p.setEval({ logoutControl: true, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: false })
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(true)
    expect(auth.confidence).toBe("high")
    expect(auth.method).toBe("dom")
  })

  it("detects a login form (password field) as signed out (high)", async () => {
    const p = page()
    p.setUrl("https://app.example.com/")
    p.setEval({ logoutControl: false, hasPassword: true, hasLoginForm: true, loginButton: false, accountMenu: false, avatar: false })
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(false)
    expect(auth.confidence).toBe("high")
  })

  it("uses an account menu as a medium-confidence signed-in signal", async () => {
    const p = page()
    p.setUrl("https://app.example.com/home")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: true, avatar: false })
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(true)
    expect(auth.confidence).toBe("medium")
  })

  it("a lone sign-in button with no other signal reads signed out (low)", async () => {
    const p = page()
    p.setUrl("https://app.example.com/welcome")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: true, accountMenu: false, avatar: false })
    h.setCookies([])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(false)
    expect(auth.confidence).toBe("low")
  })

  it("D2/AC-005: the removed venue has no site profile, so a bare `token` cookie takes the GENERIC rule", async () => {
    // The EO row carried `cookieAuth: false` because guests hold that cookie too,
    // which suppressed cookie-based detection for the venue. With the row gone the
    // host is unrecognised, so the generic rule applies: `token` matches
    // GENERIC_AUTH_COOKIE_RE and reads as MEDIUM confidence — never "high", and
    // never a site-scoped claim. This asserts the suppression is gone rather than
    // pretending it still applies.
    const p = page()
    p.setUrl("https://app.expertoption.com/")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: false })
    h.setCookies([{ name: "token", value: "0123456789abcdef0123456789abcdef" }])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(true)
    expect(auth.confidence).toBe("medium")
    expect(auth.method).toBe("cookie")
    expect(auth.detail).toMatch(/auth cookies: token/)
  })

  it("D20/T7b: all eight removed venues are CONFIDENCE-NEUTRAL, asserted per venue rather than assumed", async () => {
    // The question this pins: removing the eight SITE_INDEX rows drops whatever
    // login-hint suppression each of them carried. MEASURED, the answer is that none
    // of them carried any, so nothing was lost - and that is a property of
    // `LOGIN_HINTS` being `{}` (D2/AC-005 removed its only entry), not a coincidence.
    //
    // The mechanism, so the "no change" claim is checkable rather than asserted:
    //   `hint = site?.id ? LOGIN_HINTS[site.id] : null`
    //   - row PRESENT -> site.id is the slug -> hint is `undefined` (map is empty)
    //   - row REMOVED -> site.id is null    -> hint is `null`
    //   `hint?.cookieAuth !== false` is TRUE in both cases, so the cookie branch is
    //   entered either way; and `hintHits` is `[]` in both cases, so the site-scoped
    //   HIGH-confidence cookie branch (`out.confidence = "high"` under `hintHits`)
    //   was ALREADY unreachable for every site in the tree. A bare `token` cookie
    //   therefore reads as MEDIUM either way.
    //
    // So for all eight: site recognition is gone (that IS the change), and login
    // confidence is identical to a still-recognised venue on the same signals.
    const p = page()
    const REMOVED = [
      ["luno", "https://www.luno.com/my"],
      ["mx-global", "https://mxglobal.com.my"],
      ["hata", "https://www.hata.io"],
      ["sinegy", "https://sinegy.com"],
      ["kinetic", "https://kineticdax.com"],
      ["funding-circle", "https://www.fundingsocieties.com.my"],
      ["selangor-kuasa", "https://www.selangorkuasa.com"],
      ["pitik", "https://pitik.ai"]
    ]
    // The control: a venue whose row SURVIVED, so "unchanged" has something to be
    // unchanged FROM. If the removed set behaved differently from this, the loop below
    // would be asserting a difference rather than an equality.
    const CONTROL = ["binance", "https://www.binance.com"]
    expect(REMOVED).toHaveLength(8)

    const probe = async (url) => {
      p.setUrl(url)
      p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: false })
      h.setCookies([{ name: "token", value: "0123456789abcdef0123456789abcdef" }])
      return m.detectLoginState(p, {})
    }

    const [controlId, controlUrl] = CONTROL
    const control = await probe(controlUrl)
    expect(control.site, "the control must actually be a recognised site").toBe(controlId)
    expect(control.loggedIn).toBe(true)
    expect(control.confidence).toBe("medium")
    expect(control.method).toBe("cookie")

    for (const [id, url] of REMOVED) {
      const auth = await probe(url)
      // THE CHANGE: the host is no longer recognised.
      expect(auth.site, `${id}: site recognition must be gone`).toBeNull()
      // NO CHANGE: identical verdict, confidence, method and detail shape.
      expect(auth.loggedIn, `${id}: signed-in verdict must be unchanged`).toBe(control.loggedIn)
      expect(auth.confidence, `${id}: confidence must be unchanged`).toBe(control.confidence)
      expect(auth.method, `${id}: method must be unchanged`).toBe(control.method)
      expect(auth.detail, `${id}: detail must be unchanged`).toBe(control.detail)
      // Explicitly: the generic rule is MEDIUM and never HIGH, exactly as for a
      // still-recognised venue with no hint. A "high" here would mean a
      // site-auth-cookie path had become reachable.
      expect(auth.confidence).not.toBe("high")
      expect(auth.detail).toMatch(/auth cookies: token/)
      // No connector was mapped for any of the eight, before or after.
      expect(m.siteToConnectorSlug(auth.site)).toBeNull()
    }
  }, 60_000)

  it("D20/T7b: the removed venues' vault lookup key moves from display name to hostname - for SEVEN of the eight", () => {
    // The one real capability consequence, asserted per venue rather than left to
    // surprise a user. `studioLogin` derives its vault key from `detected?.name`
    // and then lower-cases it, so:
    //
    //   key BEFORE = displayName.toLowerCase()   key AFTER = hostname
    //
    // Seven of the eight keys MOVE. PITIK'S DOES NOT, and pretending otherwise would
    // be a false claim: its display name was `Pitik.ai`, which lower-cases to exactly
    // its own hostname `pitik.ai`, so a user whose credentials are filed under
    // `pitik.ai` finds them still there. It is the one venue of the eight whose
    // one-tap login is genuinely unaffected, and that is asserted as its own case.
    const FORMER = [
      ["luno", "https://www.luno.com/my", "Luno", true],
      ["mx-global", "https://mxglobal.com.my", "MX Global", true],
      ["hata", "https://www.hata.io", "HATA Digital", true],
      ["sinegy", "https://sinegy.com", "SINEGY DAX", true],
      ["kinetic", "https://kineticdax.com", "Kinetic DAX", true],
      ["funding-circle", "https://www.fundingsocieties.com.my", "Funding Societies", true],
      ["selangor-kuasa", "https://www.selangorkuasa.com", "Selangor Kuasa (SKS)", true],
      // display name lower-cases to its own hostname -> key unchanged
      ["pitik", "https://pitik.ai", "Pitik.ai", false]
    ]
    expect(FORMER).toHaveLength(8)
    for (const [id, url, formerName, keyMoves] of FORMER) {
      const hostname = new URL(url).hostname.replace(/^www\./, "")
      const keyBefore = formerName.toLowerCase()
      const keyAfter = m.detectSite(url).name.toLowerCase()
      // `detectSite` no longer knows the display name at all.
      expect(m.detectSite(url).name, `${id} must resolve to the hostname now`).toBe(hostname)
      expect(keyAfter).toBe(hostname.toLowerCase())
      if (keyMoves) {
        expect(keyAfter, `${id}: vault key must move off the display name`).not.toBe(keyBefore)
      } else {
        // The honest exception, pinned so a future edit cannot quietly change it.
        expect(keyAfter, `${id}: key is unchanged because its display name WAS its hostname`).toBe(keyBefore)
      }
    }
    // Exactly one of the eight is the exception. If a future row breaks this
    // coincidence the count moves, which is the signal to re-read the ruling.
    expect(FORMER.filter(([, , , moves]) => !moves).map(([id]) => id)).toEqual(["pitik"])
  })

  it("still refuses a lone Sign in button with no other signal (weak negative)", async () => {
    // D2/AC-005: this used to be the ExpertOption guest-session assertion, which
    // read `dom.guest` through the removed venue's account-model branch. The
    // generic weak-negative branch is what every other site gets, and it is what
    // remains. No cookies are set, so the cookie rule cannot pre-empt it.
    const p = page()
    p.setUrl("https://iqoption.com/")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: true, accountMenu: false, avatar: false })
    h.setCookies([])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(false)
    expect(auth.confidence).toBe("low")
    expect(auth.method).toBe("dom")
    expect(auth.detail).toMatch(/sign-in button present/i)
  })

  it("an avatar is a MEDIUM positive and attaches NO venue account payload", async () => {
    // D2/AC-005: the removed venue's branch attached an `account` object
    // (type/email/name/wallet/balance) read from the content window. No surviving
    // branch does, so a signed-in tab is reported by signal strength alone and
    // never carries identity fields PICC has no site knowledge to interpret.
    const p = page()
    p.setUrl("https://iqoption.com/")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: true, guest: false, active: true, wallet: "demo", email: "trader@example.com", name: "Trader", balance: "$1,234.50" })
    h.setCookies([])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(true)
    expect(auth.confidence).toBe("medium")
    expect(auth.method).toBe("dom")
    expect(auth.detail).toMatch(/avatar present/i)
    expect(auth.account).toBeNull()
  })

  it("proves sign-in via a generic auth cookie (medium)", async () => {
    const p = page()
    p.setUrl("https://somebank.example/accounts")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: false })
    h.setCookies([{ name: "session_token", value: "abc123" }])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(true)
    expect(auth.confidence).toBe("medium")
  })

  it("ignores anonymous session cookies (PHPSESSID etc.)", async () => {
    const p = page()
    p.setUrl("https://shop.example/catalog")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: false })
    h.setCookies([{ name: "PHPSESSID", value: "x" }, { name: "_ga", value: "x" }])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(null)
    expect(auth.detail).toBe("no auth signal found")
  })

  it("returns unknown for non-web pages and empty pages", async () => {
    const p = page()
    p.setUrl("about:blank")
    h.setCookies([])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(null)
    expect(auth.detail).toMatch(/not a web page/)
  })

  it("surfaces per-tab auth in studioStatus after refreshLoginStates", async () => {
    const p = page()
    p.setUrl("https://app.expertoption.com/")
    p.setEval({ logoutControl: true, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: false })
    const res = await m.refreshLoginStates()
    expect(res.ok).toBe(true)
    expect(res.results.length).toBeGreaterThan(0)
    const status = m.studioStatus()
    expect(status.tabs.every((t) => Object.prototype.hasOwnProperty.call(t, "auth"))).toBe(true)
    const withAuth = status.tabs.filter((t) => t.auth?.loggedIn === true)
    expect(withAuth.length).toBeGreaterThan(0)
    expect(withAuth[0].auth.confidence).toBe("high")
    expect(status.currentAuth).toBeTruthy()
  })

  // D2/AC-005: `captureExpertOptionSession` is deleted with the venue. The
  // surviving capture hook is the generic `captureViaStorageScan`, which is
  // CONFIG-driven: the profile supplies the exact keys and host to look for. The
  // guarantees below (full token, never the masked form; the highest-scoring
  // configured key wins; guest tagging; honest host refusal) are properties of
  // the hook, so they are re-asserted against it with the iqoption profile's
  // real config rather than dropped.
  const IQ_CFG = {
    name: "IQ Option",
    hostRe: "iqoption\\.com",
    storageScan: [{ type: "cookie", key: "ssid", verified: false }]
  }

  it("captures the FULL session token (never the masked display form)", async () => {
    const p = page()
    p.setUrl("https://iqoption.com/en/login")
    p.setEval([{ source: "cookie", key: "ssid", value: "0123456789abcdef0123456789abcdef", score: 0 }])
    const r = await m.captureViaStorageScan(p, IQ_CFG)
    expect(r.ok).toBe(true)
    expect(r.token).toBe("0123456789abcdef0123456789abcdef")
    expect(r.source).toBe("cookie:ssid")
    expect(m.maskToken(r.token)).toBe("0123456789abcdef…")
  })

  it("captures only the CONFIGURED key — an unconfigured cookie is ignored", async () => {
    const p = page()
    p.setUrl("https://iqoption.com/en/login")
    p.setEval([
      { source: "cookie", key: "ssid", value: "0123456789abcdef0123456789abcdef", score: 0 },
      { source: "cookie", key: "other", value: "1", score: 0 }
    ])
    const r = await m.captureViaStorageScan(p, IQ_CFG)
    expect(r.ok).toBe(true)
    expect(r.token).toBe("0123456789abcdef0123456789abcdef")
    expect(r.source).toBe("cookie:ssid")
  })

  it("prefers the highest-scoring configured hit over a stale web-storage mirror", async () => {
    // The scoring rule: score is the position in the CONFIGURED key list, so the
    // first configured key wins and a web-storage mirror cannot outrank it. This
    // is the surviving form of the old "prefer the live cookie over a stale
    // tokenDemo/storage mirror" guarantee.
    const p = page()
    p.setUrl("https://iqoption.com/en/login")
    const live = "8b36ae2b603b5975c9695d801f8fa543"
    const stale = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    p.setEval([
      { source: "cookie", key: "ssid", value: live, score: 0 },
      { source: "localStorage", key: "ssid", value: stale, score: 0 }
    ])
    const r = await m.captureViaStorageScan(p, {
      ...IQ_CFG,
      storageScan: [
        { type: "cookie", key: "ssid", verified: false },
        { type: "localStorage", key: "ssid", verified: false }
      ]
    })
    expect(r.ok).toBe(true)
    expect(r.token).toBe(live) // cookie (first configured) beats the localStorage mirror
    expect(r.source).toBe("cookie:ssid")
  })

  it("maskToken passes through short or empty values untouched", () => {
    expect(m.maskToken("")).toBe("")
    expect(m.maskToken(null)).toBe("")
    expect(m.maskToken("tok")).toBe("tok")
  })

  it("tags a captured session as guest when the page shows only a Log in header", async () => {
    const p = page()
    p.setUrl("https://iqoption.com/en/login")
    const hits = [{ source: "cookie", key: "ssid", value: "0123456789abcdef0123456789abcdef", score: 0 }]
    hits.loginButton = true
    hits.guest = true
    hits.active = false
    p.setEval(hits)
    const r = await m.captureViaStorageScan(p, IQ_CFG)
    expect(r.ok).toBe(true)
    expect(r.guest).toBe(true)
    expect(r.saved).toBe(false)
    expect(r.account).toMatchObject({ type: "guest", guest: true })
  })

  it("refuses to capture from a page outside the configured host", async () => {
    const p = page()
    p.setUrl("https://example.com/")
    await expect(m.captureViaStorageScan(p, IQ_CFG)).rejects.toThrow(/IQ Option/i)
  })

  it("D2/AC-005: the removed captureExpertOptionSession is gone from the module", () => {
    // The absence is pinned, not assumed: a resurrected EO hook would be a new
    // capability with no caller and no profile row.
    expect(m.captureExpertOptionSession).toBeUndefined()
  })
})
