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
    expect(detectSite("https://dashboard.honeygain.com/").id).toBe("honeygain")
    expect(detectSite("https://www.luno.com/my").id).toBe("luno")
    expect(detectSite("https://aigen.dev/").id).toBe("aigen")
    expect(detectSite("https://app.pawns.app").name).toContain("Pawns")
  }, 15_000)

  it("returns a generic profile for unknown sites", async () => {
    const { detectSite } = await import("../services/browserStudio.mjs")
    const site = detectSite("https://some-unknown-dashboard.example.com/x")
    expect(site.category).toBe("other")
    expect(site.id).toBeNull()
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
    await m.saveSiteCredentials("Honeygain", { username: "a@b.c", password: "s3cret" })

    const creds = await m.getSiteCredentials("honeygain")
    expect(creds.username).toBe("a@b.c")
    expect(creds.password).toBe("s3cret")

    expect(await m.getVaultSites()).toEqual(["honeygain"])

    const del = await m.deleteSiteCredentials("honeygain")
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
    expect(s.humanizeInput).toBe(true)
    expect(s.defaultProfile).toBe("studio")
    expect(s.devTools).toBe(false)
    expect(s.tabFreezeMs).toBe(90_000)
    expect(s.suiteDeactivateMs).toBe(600_000)
  })

  it("merges partial settings into the store", async () => {
    await m.saveBrowserSettings({ homepage: "https://dashboard.honeygain.com", devTools: true })
    const s = await m.getBrowserSettings()
    expect(s.homepage).toBe("https://dashboard.honeygain.com")
    expect(s.devTools).toBe(true)
    expect(s.stealth).toBe(true) // untouched field preserved
  })

  it("normalizes origins and stores/removes per-site permissions", async () => {
    const set = await m.setSitePermission("https://dashboard.honeygain.com/x", "notifications", "allow")
    expect(set.origin).toBe("https://dashboard.honeygain.com")
    await m.setSitePermission("https://dashboard.honeygain.com", "geolocation", "block")

    const perms = await m.getSitePermissions()
    expect(perms["https://dashboard.honeygain.com"].notifications).toBe("allow")
    expect(perms["https://dashboard.honeygain.com"].geolocation).toBe("block")

    const del = await m.removeSitePermissions("https://dashboard.honeygain.com")
    expect(del.deleted).toBe(true)
    expect(await m.getSitePermissions()).toEqual({})
  })

  it("rejects invalid permission settings", async () => {
    await expect(m.setSitePermission("https://x.com", "camera", "nope")).rejects.toThrow(/allow/)
  })

  it("saves per-source browser preferences (profile/headless/homepage/overlay)", async () => {
    const r = await m.saveBrowserPreference("honeygain", { profile: "honey", headless: false, homepage: "https://dashboard.honeygain.com", overlay: true })
    expect(r.prefs.profile).toBe("honey")
    expect(r.prefs.headless).toBe(false)
    const all = await m.getBrowserPreferences()
    expect(all.honeygain).toMatchObject({ profile: "honey", homepage: "https://dashboard.honeygain.com" })
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
    const res = await call(handleApi, "POST", "/api/browser/assist", { url: "https://dashboard.honeygain.com/" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.site.id).toBe("honeygain")
    expect(res.body.hasSavedCredentials).toBeTypeOf("boolean")
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
    const saved = await call(handleApi, "POST", "/api/browser/prefs", { site: "luno", prefs: { profile: "luno-1", headless: false } })
    expect(saved.status).toBe(200)
    expect(saved.body.prefs.profile).toBe("luno-1")

    const got = await call(handleApi, "GET", "/api/browser/prefs")
    expect(got.body.prefs.luno.profile).toBe("luno-1")
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
