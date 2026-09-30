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

  it("does NOT treat the ExpertOption token cookie alone as sign-in (guests have it too)", async () => {
    const p = page()
    p.setUrl("https://app.expertoption.com/")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: false })
    h.setCookies([{ name: "token", value: "0123456789abcdef0123456789abcdef" }])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(null)
    expect(auth.detail).toBe("no auth signal found")
  })

  it("flags an ExpertOption guest session when a Log in header is present", async () => {
    const p = page()
    p.setUrl("https://app.expertoption.com/")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: true, accountMenu: false, avatar: false, guest: true, active: false })
    h.setCookies([{ name: "token", value: "0123456789abcdef0123456789abcdef" }])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(false)
    expect(auth.confidence).toBe("high")
    expect(auth.method).toBe("dom")
    expect(auth.detail).toMatch(/guest session/i)
    expect(auth.account).toMatchObject({ type: "guest", guest: true })
  })

  it("marks an ExpertOption active account with its wallet from the content window", async () => {
    const p = page()
    p.setUrl("https://app.expertoption.com/")
    p.setEval({ logoutControl: false, hasPassword: false, hasLoginForm: false, loginButton: false, accountMenu: false, avatar: true, guest: false, active: true, wallet: "demo", email: "trader@example.com", name: "Trader", balance: "$1,234.50" })
    h.setCookies([{ name: "token", value: "0123456789abcdef0123456789abcdef" }])
    const auth = await m.detectLoginState(p, {})
    expect(auth.loggedIn).toBe(true)
    expect(auth.method).toBe("dom")
    expect(auth.account).toMatchObject({ type: "active", guest: false, wallet: "demo", email: "trader@example.com", balance: "$1,234.50" })
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
