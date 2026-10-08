// Wave 1.4 — notification prefs API (GET read + PATCH write, both gated).
//
// Hermetic: stores redirected through the SHARED `useIsolatedStoreDir`
// helper (never by assigning `process.env`); handlers re-imported fresh per
// test so `notifier.mjs` loadState() sees the seeded file. No `socket` on the
// request — a remote caller, so every 401 below is a real gate refusal (the
// `isLocalhostRequest` bypass reads the TCP peer, which this harness leaves
// absent) and a seeded user keeps `requireAuth` off its first-run branch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const TOKEN = "d".repeat(64)
const USER_ROW = { id: "u1", email: "notif-prefs@example.test", name: "NP", salt: "s", passwordHash: "h", createdAt: 1 }

function makeReq(method, url, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
    // NO `socket` — remote caller by construction.
    headers: { host: "picc.example.test", "content-type": "application/json", ...headers },
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

let dirs = []

function redirect(name, prefix) {
  const dir = useIsolatedStoreDir(name, { prefix })
  dirs.push(dir)
  return dir
}

function redirectStores() {
  redirect("PICC_AUTH_DATA_DIR", "notifprefs-auth")
  return redirect("PICC_NOTIFICATION_DATA_DIR", "notifprefs-notify")
}

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value), "utf8")
}

function seedUser(authDir) {
  writeJson(authDir, "sessions.json", { sessions: {} })
  writeJson(authDir, "users.json", { users: [USER_ROW] })
}

function seedSession(authDir) {
  seedUser(authDir)
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } }
  })
}

async function loadHandlersFresh() {
  // vi.resetModules() busts the registry, so this static import re-evaluates
  // handlers (and notifier's loadState) against the freshly seeded dirs.
  vi.resetModules()
  const { handleApi } = await import("../handlers.mjs")
  return handleApi
}

const authHeaders = () => ({ authorization: `Bearer ${TOKEN}` })

describe("notification prefs API (Wave 1.4)", () => {
  let authDir
  let notifyDir

  beforeEach(() => {
    dirs = []
    redirectStores()
    authDir = dirs[0]
    notifyDir = dirs[1]
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("anonymous GET /api/notifications/prefs is refused", async () => {
    seedUser(authDir)
    const api = await loadHandlersFresh()
    const res = await call(api, "GET", "/api/notifications/prefs")
    expect(res.status).toBe(401)
    expect(res.body?.ok).not.toBe(true)
  })

  it("anonymous PATCH /api/notifications/prefs is refused", async () => {
    seedUser(authDir)
    const api = await loadHandlersFresh()
    const res = await call(api, "PATCH", "/api/notifications/prefs", { minConfidence: 80 })
    expect(res.status).toBe(401)
    expect(res.body?.ok).not.toBe(true)
  })

  it("authed GET returns the prefs shape with the four live channels", async () => {
    seedSession(authDir)
    const api = await loadHandlersFresh()
    const res = await call(api, "GET", "/api/notifications/prefs", null, authHeaders())
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
    const prefs = res.body?.prefs
    expect(prefs?.minConfidence).toBe(65)
    expect(prefs?.leadMinutes).toBe(3)
    expect(prefs?.windowMinutes).toBe(15)
    expect(Object.keys(prefs?.channels ?? {}).sort()).toEqual(["inApp", "telegram", "webhook", "webpush"])
  })

  it("PATCH clamps through setPrefs and the write sticks for a later GET", async () => {
    seedSession(authDir)
    const api = await loadHandlersFresh()
    const res = await call(
      api,
      "PATCH",
      "/api/notifications/prefs",
      { minConfidence: 5, leadMinutes: 999, windowMinutes: 0, channels: { webpush: false } },
      authHeaders()
    )
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
    // setPrefs clamps: 30 floor, 60 ceiling, 1 floor.
    expect(res.body?.prefs?.minConfidence).toBe(30)
    expect(res.body?.prefs?.leadMinutes).toBe(60)
    expect(res.body?.prefs?.windowMinutes).toBe(1)
    expect(res.body?.prefs?.channels?.webpush).toBe(false)
    expect(res.body?.prefs?.channels?.inApp).toBe(true)

    const reread = await call(api, "GET", "/api/notifications/prefs", null, authHeaders())
    expect(reread.status).toBe(200)
    expect(reread.body?.prefs?.minConfidence).toBe(30)
    expect(reread.body?.prefs?.channels?.webpush).toBe(false)
  })

  it("a stale email channel key is migrated away on read, not preserved", async () => {
    writeJson(notifyDir, "notifications.json", {
      prefs: {
        minConfidence: 70,
        leadMinutes: 3,
        windowMinutes: 15,
        channels: { inApp: true, webpush: true, webhook: true, telegram: true, email: true }
      },
      subscriptions: [],
      recent: [],
      snoozes: {}
    })
    seedSession(authDir)
    const api = await loadHandlersFresh()
    const res = await call(api, "GET", "/api/notifications/prefs", null, authHeaders())
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.prefs?.minConfidence).toBe(70)
    expect(res.body?.prefs?.channels?.email).toBeUndefined()
    expect(Object.keys(res.body?.prefs?.channels ?? {}).sort()).toEqual(["inApp", "telegram", "webhook", "webpush"])
  })
})
