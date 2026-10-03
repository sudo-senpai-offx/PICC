import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
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

async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

describe("Browser Studio — site detection", () => {
  it("maps known dashboards to catalog entries", async () => {
    const { detectSite } = await import("../services/browserStudio.mjs")
    expect(detectSite("https://aigen.dev/").id).toBe("aigen")
    // D2/AC-005: the removed venue's host resolves to no catalog entry.
    expect(detectSite("https://app.expertoption.finance/").id).toBeNull()
  }, 15_000)

  it("D20/T7b: all eight venues removed from streamCatalog.ts have NO site profile here either", async () => {
    // Record 0019:87-92 named `browserStudio.mjs:485-492` as a SEPARATE venue catalog
    // that also listed these eight, declared it out of scope for that decision, and
    // recorded the fact. The owner's ruling of 2026-10-03 removed them, so the
    // browser-studio login surface names the same venues the income catalog does.
    // Each host is asserted individually: a table-driven loop that passed because it
    // iterated nothing would assert nothing, so the count is pinned too.
    const { detectSite } = await import("../services/browserStudio.mjs")
    const removed = [
      ["luno", "https://www.luno.com/my"],
      ["mx-global", "https://mxglobal.com.my"],
      ["hata", "https://www.hata.io"],
      ["sinegy", "https://sinegy.com"],
      ["kinetic", "https://kineticdax.com"],
      ["funding-circle", "https://www.fundingsocieties.com.my"],
      ["selangor-kuasa", "https://www.selangorkuasa.com"],
      ["pitik", "https://pitik.ai"]
    ]
    expect(removed).toHaveLength(8)
    for (const [id, url] of removed) {
      expect(detectSite(url).id, `${id} must have no site profile`).toBeNull()
      // The host falls through to the generic unknown-host profile, honestly labelled.
      const site = detectSite(url)
      expect(site.category, `${id} must fall back to the generic profile`).toBe("other")
      expect(site.note).toMatch(/No PICC profile for this site yet/)
    }
  }, 15_000)

  it("returns a generic profile for unknown sites", async () => {
    const { detectSite } = await import("../services/browserStudio.mjs")
    const site = detectSite("https://some-unknown-dashboard.example.com/x")
    expect(site.category).toBe("other")
    expect(site.id).toBeNull()
  })

  it("detectSite tags trading venues with a platform kind", async () => {
    const { detectSite } = await import("../services/browserStudio.mjs")
    // `iqoption` is the surviving binary platform; it held the EO row's role.
    expect(detectSite("https://iqoption.com/").platformKind).toBe("binary")
    expect(detectSite("https://www.binance.com").platformKind).toBe("spot")
    expect(detectSite("https://www.bybit.com").platformKind).toBe("derivatives")
    expect(detectSite("https://aigen.dev/").platformKind).toBeNull()
  })
})

describe("Browser Studio — trading venue redirects (Slice 5 / R5)", () => {
  it("builds verified instrument deep-links for known symbols", async () => {
    const { instrumentUrl, tradingVenues } = await import("../services/browserStudio.mjs")
    expect(instrumentUrl("binance", "BTCUSD").mode).toBe("asset")
    expect(instrumentUrl("binance", "BTCUSD").url).toBe("https://www.binance.com/en/trade/BTCUSDT")
    expect(instrumentUrl("binance", "btcusd").mode).toBe("asset") // canonicalizes inputs
    expect(instrumentUrl("kucoin", "ETHUSD").url).toBe("https://www.kucoin.com/trade/ETH-USDT")
    expect(instrumentUrl("okx", "SOLUSD").url).toBe("https://www.okx.com/trade-spot/SOL-USDT")
    expect(tradingVenues().length).toBeGreaterThan(5)
  })

  it("falls back to the venue root honestly when the symbol is unverifiable", async () => {
    const { instrumentUrl } = await import("../services/browserStudio.mjs")
    // Unknown asset on a deep-linkable venue → venue root, not a fabricated URL.
    const binance = instrumentUrl("binance", "USDJPY=X")
    expect(binance.mode).toBe("venue")
    expect(binance.url).toBe("https://www.binance.com")
    // Venues without instruments (binary platforms) → venue root, pick asset in-app.
    const eo = instrumentUrl("iqoption", "EURUSD")
    expect(eo.mode).toBe("venue")
    expect(eo.url).toBe("https://iqoption.com")
    // Non-trading / unknown sites → no redirection at all.
    expect(instrumentUrl("silencio", "BTCUSD").mode).toBe("none")
    expect(instrumentUrl("whatever", "BTCUSD").mode).toBe("none")
  })

  it("registers the OANDA fxTrade Practice demo venue (free-sources research AS4)", async () => {
    const { detectSite, tradingVenues, instrumentUrl } = await import("../services/browserStudio.mjs")
    const site = detectSite("https://fxtrade.oanda.com/")
    expect(site.id).toBe("oanda")
    expect(site.name).toBe("OANDA (fxTrade Practice)")
    expect(site.category).toBe("trading")
    // No verified capture leg or symbol map yet → honest null kind + root redirect.
    expect(site.platformKind).toBeNull()
    const row = tradingVenues().find((v) => v.id === "oanda")
    expect(row).toBeDefined()
    expect(row.url).toBe("https://fxtrade.oanda.com")
    const link = instrumentUrl("oanda", "EURUSD")
    expect(link.mode).toBe("venue")
    expect(link.url).toBe("https://fxtrade.oanda.com")
  })
})

describe("Browser Studio — credential vault", () => {
  let dir
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "picc-browser-vault-"))
    process.env.PICC_BROWSER_DATA_DIR = dir
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_BROWSER_DATA_DIR
  })

  it("saves, lists, reads and deletes site credentials", async () => {
    const m = await import("../services/browserStudio.mjs?case=vault")
    await m.saveSiteCredentials("ExpertOption", { username: "a@b.c", password: "s3cret" })

    const creds = await m.getSiteCredentials("expertoption")
    expect(creds.username).toBe("a@b.c")
    expect(creds.password).toBe("s3cret")

    expect(await m.getVaultSites()).toEqual(["expertoption"])

    const del = await m.deleteSiteCredentials("expertoption")
    expect(del.deleted).toBe(true)
    expect(await m.getVaultSites()).toEqual([])
  })
})

describe("Browser Studio — settings, permissions and per-source prefs", () => {
  let dir
  let m
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-browser-settings-"))
    process.env.PICC_BROWSER_DATA_DIR = dir
    m = await import("../services/browserStudio.mjs?case=settings")
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_BROWSER_DATA_DIR
  })

  it("returns default browser settings before anything is saved", async () => {
    const s = await m.getBrowserSettings()
    expect(s.stealth).toBe(true)
    expect(s.humanizeInput).toBe(false)
    expect(s.defaultProfile).toBe("studio")
    expect(s.devTools).toBe(false)
    expect(s.tabFreezeMs).toBe(90_000)
    expect(s.suiteDeactivateMs).toBe(600_000)
  })

  it("merges partial settings into the store", async () => {
    await m.saveBrowserSettings({ homepage: "https://app.expertoption.finance", devTools: true })
    const s = await m.getBrowserSettings()
    expect(s.homepage).toBe("https://app.expertoption.finance")
    expect(s.devTools).toBe(true)
    expect(s.stealth).toBe(true) // untouched field preserved
  })

  it("normalizes origins and stores/removes per-site permissions", async () => {
    const set = await m.setSitePermission("https://app.expertoption.finance/x", "notifications", "allow")
    expect(set.origin).toBe("https://app.expertoption.finance")
    await m.setSitePermission("https://app.expertoption.finance", "geolocation", "block")

    const perms = await m.getSitePermissions()
    expect(perms["https://app.expertoption.finance"].notifications).toBe("allow")
    expect(perms["https://app.expertoption.finance"].geolocation).toBe("block")

    const del = await m.removeSitePermissions("https://app.expertoption.finance")
    expect(del.deleted).toBe(true)
    expect(await m.getSitePermissions()).toEqual({})
  })

  it("rejects invalid permission settings", async () => {
    await expect(m.setSitePermission("https://x.com", "camera", "nope")).rejects.toThrow(/allow/)
  })

  it("saves per-source browser preferences (profile/headless/homepage/overlay)", async () => {
    const r = await m.saveBrowserPreference("expertoption", { profile: "eo-studio", headless: false, homepage: "https://app.expertoption.finance", overlay: true })
    expect(r.prefs.profile).toBe("eo-studio")
    expect(r.prefs.headless).toBe(false)
    const all = await m.getBrowserPreferences()
    expect(all.expertoption).toMatchObject({ profile: "eo-studio", homepage: "https://app.expertoption.finance" })
  })

  it("deep-merges overlaySettings including dockables and dockableLayout", async () => {
    await m.saveBrowserPreference("testsite", {
      overlaySettings: {
        enabled: true,
        opacity: 0.8,
        dockables: { "price-ticker": true, "portfolio": false },
        dockableLayout: { "price-ticker": { position: { x: 100, y: 200 }, opacity: 0.9 } }
      }
    })
    const r2 = await m.saveBrowserPreference("testsite", {
      overlaySettings: {
        opacity: 0.5,
        dockables: { "portfolio": true },
        dockableLayout: { "price-ticker": { size: { width: 400, height: 300 } } }
      }
    })
    expect(r2.prefs.overlaySettings.opacity).toBe(0.5)
    expect(r2.prefs.overlaySettings.dockables["price-ticker"]).toBe(true)
    expect(r2.prefs.overlaySettings.dockables["portfolio"]).toBe(true)
    expect(r2.prefs.overlaySettings.dockableLayout["price-ticker"].position).toEqual({ x: 100, y: 200 })
    expect(r2.prefs.overlaySettings.dockableLayout["price-ticker"].size).toEqual({ width: 400, height: 300 })
  })

  it("saves and retrieves suite default presets", async () => {
    const r = await m.saveSuitePreset("trading", {
      enabled: true,
      opacity: 0.75,
      dockables: { "price-ticker": true, "autopilot": false }
    })
    expect(r.ok).toBe(true)
    expect(r.preset.opacity).toBe(0.75)
    const presets = await m.getSuitePresets()
    expect(presets.trading).toBeDefined()
    expect(presets.trading.opacity).toBe(0.75)
    expect(presets.trading.dockables["price-ticker"]).toBe(true)
    expect(presets.trading.dockables["autopilot"]).toBe(false)
  })

  it("exposes the CDP permission catalog", async () => {
    expect(m.PERMISSION_CATALOG.length).toBeGreaterThan(10)
    expect(m.PERMISSION_CATALOG.map((p) => p.name)).toContain("notifications")
  })
})

describe("Browser Studio — API routes", () => {
  let handleApi

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "picc-browser-api-"))
    process.env.PICC_AUTH_DATA_DIR = tmp
    process.env.PICC_BROWSER_DATA_DIR = tmp
    vi.resetModules()
    ;({ handleApi } = await import("../handlers.mjs"))
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it("reports status without launching a browser", async () => {
    const res = await call(handleApi, "GET", "/api/browser/status")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.open).toBe(false)
    expect(res.body.available).toBeTypeOf("boolean")
  })

  it("detects the site for a given URL via /assist", async () => {
    const res = await call(handleApi, "POST", "/api/browser/assist", { url: "https://iqoption.com/" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.site.id).toBe("iqoption")
    expect(res.body.hasSavedCredentials).toBeTypeOf("boolean")
  })

  it("/assist reports no site profile for the removed venue's host", async () => {
    // D2/AC-005: the SITE_INDEX row is gone, so /assist answers with the honest
    // unknown-site shape rather than a venue profile.
    const res = await call(handleApi, "POST", "/api/browser/assist", { url: "https://app.expertoption.finance/" })
    expect(res.status).toBe(200)
    expect(res.body.site.id).toBeNull()
  })

  it("returns 409 when driving a closed browser", async () => {
    const res = await call(handleApi, "POST", "/api/browser/goto", { url: "https://example.com" })
    expect(res.status).toBe(409)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toContain("not open")
  })

  it("reads and writes browser settings over the API", async () => {
    const got = await call(handleApi, "GET", "/api/browser/settings")
    expect(got.status).toBe(200)
    expect(got.body.settings.tabFreezeMs).toBe(90_000)
    expect(got.body.settings.suiteDeactivateMs).toBe(600_000)

    const saved = await call(handleApi, "POST", "/api/browser/settings", { settings: { homepage: "https://aigen.dev", tabFreezeMs: 120_000 } })
    expect(saved.body.settings.homepage).toBe("https://aigen.dev")
    expect(saved.body.settings.tabFreezeMs).toBe(120_000)
  })

  it("manages per-site permissions over the API", async () => {
    const set = await call(handleApi, "POST", "/api/browser/permissions", { origin: "https://aave.com", permission: "camera", setting: "block" })
    expect(set.status).toBe(200)
    expect(set.body.setting).toBe("block")

    const got = await call(handleApi, "GET", "/api/browser/permissions")
    expect(got.body.permissions["https://aave.com"].camera).toBe("block")
    expect(Array.isArray(got.body.catalog)).toBe(true)

    const del = await call(handleApi, "DELETE", "/api/browser/permissions", { origin: "https://aave.com" })
    expect(del.body.deleted).toBe(true)
  })

  it("stores per-source browser preferences over the API", async () => {
    // Re-pointed off `luno` when T7b's eight venue rows were removed: the prefs key is
    // free-form (handlers.mjs:5834 stores whatever `site` it is given), so this test
    // never depended on `luno` being a live site - but using a removed venue as the
    // example would read as an assertion that it still is one.
    const saved = await call(handleApi, "POST", "/api/browser/prefs", { site: "binance", prefs: { profile: "binance-1", headless: false } })
    expect(saved.status).toBe(200)
    expect(saved.body.prefs.profile).toBe("binance-1")

    const got = await call(handleApi, "GET", "/api/browser/prefs")
    expect(got.body.prefs.binance.profile).toBe("binance-1")
  })
})

describe("Browser launch detection", () => {
  let dir

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "picc-browser-detect-"))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("finds per-user Windows installs and never duplicates candidates", async () => {
    vi.stubEnv("LOCALAPPDATA", dir)
    vi.resetModules()
    const { EXE_CANDIDATES } = await import("../services/browserBridge.mjs?case=detect")
    const norm = EXE_CANDIDATES.map((p) => p.replace(/\\/g, "/"))
    expect(norm).toContain(`${dir.replace(/\\/g, "/")}/Google/Chrome/Application/chrome.exe`)
    expect(norm).toContain(`${dir.replace(/\\/g, "/")}/Microsoft/Edge/Application/msedge.exe`)
    expect(new Set(EXE_CANDIDATES).size).toBe(EXE_CANDIDATES.length)
    expect(EXE_CANDIDATES.length).toBeGreaterThan(5)
    vi.unstubAllEnvs()
  })
})
