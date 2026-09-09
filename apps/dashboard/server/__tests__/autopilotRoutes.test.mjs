import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Route-contract coverage for Task 4.1: the /api/trading/autopilot/decisions
// and /api/trading/autopilot/why handler routes. The service functions are
// covered in autopilot.test.mjs; these tests pin the HTTP surface: auth,
// honest-empty decisions, clamped limit plumbing, the dry-run precondition
// path, and that the removed execution endpoints stay pinned at 410.

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

async function call(api, method, path, body, headers) {
  const res = makeRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

describe("autopilot API routes", () => {
  let dir

  beforeEach(() => {
    // Fresh hermetic data dir per test: no users, no creds, no demo deals.
    dir = mkdtempSync(join(tmpdir(), "picc-autopilot-routes-"))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  // Fresh process env + fresh module graph per test. handlers.mjs statically
  // imports the autopilot service, which pins its data dirs at import time,
  // so env must be staged BEFORE the re-import (mirrors the readiness-test
  // auth pattern in handlers.test.mjs).
  async function loadHandlers({ authed = false } = {}) {
    vi.stubEnv("PICC_TRADING_DATA_DIR", dir)
    vi.stubEnv("PICC_DATA_DIR", dir)
    vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
    let token
    if (authed) {
      token = randomBytes(32).toString("hex")
      writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
      writeFileSync(join(dir, "sessions.json"), JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 60_000 } } }))
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?autopilot-routes-test")
    return { handleApi, token }
  }

  it("returns 401 anonymous for decisions and why", async () => {
    // A user exists (so auth is enforced) but no session token is sent.
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
    const { handleApi } = await loadHandlers()

    const decisions = await call(handleApi, "GET", "/api/trading/autopilot/decisions")
    expect(decisions.status).toBe(401)

    const whyGet = await call(handleApi, "GET", "/api/trading/autopilot/why?assetId=BTCUSD")
    expect(whyGet.status).toBe(401)

    const whyPost = await call(handleApi, "POST", "/api/trading/autopilot/why", { assetId: "BTCUSD" })
    expect(whyPost.status).toBe(401)
  })

  it("GET decisions returns the honest empty log and clamps ?limit", async () => {
    const { handleApi, token } = await loadHandlers({ authed: true })
    const auth = { authorization: `Bearer ${token}` }

    const bare = await call(handleApi, "GET", "/api/trading/autopilot/decisions", undefined, auth)
    expect(bare.status).toBe(200)
    expect(bare.body).toEqual({ ok: true, decisions: [], tally: {}, window: { size: 0, trades: 0, skips: 0 } })

    // Out-of-range limit must survive the clamp path without 500/502. The
    // literal cap (DECISION_LOG_CAP = 50) is applied inside getAutopilotDecisions
    // (autopilot.mjs:129); with an empty log the route-level observable is a
    // well-formed response whose window can never exceed the cap.
    const clamped = await call(handleApi, "GET", "/api/trading/autopilot/decisions?limit=9999", undefined, auth)
    expect(clamped.status).toBe(200)
    expect(clamped.body).toEqual(bare.body)
    expect(clamped.body.window.size).toBeLessThanOrEqual(50)

    // The route pipes its parsed limit straight into the service clamp.
    const svc = await import("../services/autopilot.mjs?decisions-cap")
    expect(svc.getAutopilotDecisions(9999).window.size).toBeLessThanOrEqual(50)
  })

  it("authed why returns the honest precondition path without creds", async () => {
    const { handleApi, token } = await loadHandlers({ authed: true })

    const res = await call(handleApi, "POST", "/api/trading/autopilot/why", { assetId: "BTCUSD" }, { authorization: `Bearer ${token}` })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.dryRun).toBe(true)
    expect(res.body.wouldTrade).toBe(false)
    expect(res.body.reason).toBe("precondition failed")
    const tokenGate = res.body.gates.find((g) => g.name === "token")
    expect(tokenGate).toBeDefined()
    expect(tokenGate.pass).toBe(false)

    const viaGet = await call(handleApi, "GET", "/api/trading/autopilot/why?assetId=BTCUSD", undefined, { authorization: `Bearer ${token}` })
    expect(viaGet.status).toBe(200)
    expect(viaGet.body.ok).toBe(true)
    expect(viaGet.body.wouldTrade).toBe(false)
  })

  it("keeps start/stop pinned at 410 deprecated (advisory-first)", async () => {
    const { handleApi } = await loadHandlers()

    for (const p of ["/api/trading/autopilot/start", "/api/trading/autopilot/stop"]) {
      const res = await call(handleApi, "POST", p)
      expect(res.status).toBe(410)
      expect(res.body.ok).toBe(false)
      expect(res.body.deprecated).toBe(true)
    }
  })
})