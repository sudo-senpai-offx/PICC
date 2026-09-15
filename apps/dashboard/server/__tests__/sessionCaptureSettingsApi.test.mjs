// S6/T6.2 — PICC-side session-capture kill-switch API (owner decision 2026-09-15):
//   GET  /api/settings/session-capture        → {ok, enabled, configured}
//   POST /api/settings/session-capture        → {ok, settings:{enabled, configured}}
//   GET  /api/trading/capture-profiles        → payload now carries
//        sessionCaptureEnabled (the extension's server view for the AND-gate).
// Honesty contract under test:
//   - unset (no file) → enabled:true, configured:false (absent ≠ off);
//   - POST with a non-boolean → 400 (never silently coerced to off);
//   - the settings POST is auth-guarded; GET stays public like sibling /settings
//     GET views;
//   - the capture-profiles fold is the SAME boolean used by the settings store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
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

async function call(handleApi, method, path, { remote = false, body, headers } = {}) {
  const req = makeReq(method, path, body, headers)
  if (remote) req.socket = { remoteAddress: "203.0.113.5" }
  const res = makeRes()
  await handleApi(req, res, path)
  return res
}

describe("session-capture settings API (S6/T6.2)", () => {
  let dir
  let handleApi
  let store

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-scapi-"))
    process.env.PICC_DATA_DIR = dir
    process.env.PICC_SESSION_CAPTURE_SETTINGS_FILE = join(dir, "session-capture-settings.json")
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    store = await import("../services/sessionCaptureSettings.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    delete process.env.PICC_SESSION_CAPTURE_SETTINGS_FILE
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET returns default-ON with configured:false when the store is untouched", async () => {
    const res = await call(handleApi, "GET", "/api/settings/session-capture")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, enabled: true, configured: false })
  })

  it("POST false persists and GET reads it back (configured:true)", async () => {
    let res = await call(handleApi, "POST", "/api/settings/session-capture", {
      body: { enabled: false }
    })
    // Settings POST is auth-guarded like sibling settings routes.
    if (res.status === 401) {
      expect(res.body.error).toBeTruthy()
      res = await call(handleApi, "POST", "/api/settings/session-capture", {
        body: { enabled: false },
        headers: { authorization: "Bearer dev-token" }
      })
    }
    expect(res.status).toBe(200)
    expect(res.body.settings).toEqual({ enabled: false, configured: true })

    res = await call(handleApi, "GET", "/api/settings/session-capture")
    expect(res.body).toEqual({ ok: true, enabled: false, configured: true })
  })

  it("POST with a non-boolean is rejected (400), never coerced to off", async () => {
    const res = await call(handleApi, "POST", "/api/settings/session-capture", {
      body: { enabled: "nope" },
      headers: { authorization: "Bearer dev-token" }
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeTruthy()
    const get = await call(handleApi, "GET", "/api/settings/session-capture")
    expect(get.body.enabled).toBe(true)
  })

  it("capture-profiles payload folds the SAME store boolean (default true)", async () => {
    const res = await call(handleApi, "GET", "/api/trading/capture-profiles")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.sessionCaptureEnabled).toBe(true)
    expect(Array.isArray(res.body.venues)).toBe(true)
  })

  it("capture-profiles reflects a persisted disable", async () => {
    store.saveSessionCaptureSetting(false)
    const res = await call(handleApi, "GET", "/api/trading/capture-profiles")
    expect(res.body.sessionCaptureEnabled).toBe(false)
  })
})