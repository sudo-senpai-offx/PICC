// S3/T3.1 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: the GLOBAL PICC webfetch
// capability's fair-use surface. GET /api/webfetch/limits reads the honest
// observed limiter state (rate limited, like sibling read routes); POST
// /api/webfetch/limits/reset clears the in-memory windows and is auth-gated
// (remote caller without a session → 401 — resetting a limiter is
// administrative, never anonymous).
//
// Honesty contract under test:
//   - counts are observed: hosts with zero traffic simply don't appear;
//   - the reset is honest: after it, stats show a fresh sinceReset stamp and
//     cleared windows — the body never claims a reset it did not perform.
// Hermetic: PICC_DATA_DIR → tmp dir, handlers imported fresh. No network.
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

async function call(handleApi, method, path, { remote = false } = {}) {
  const req = makeReq(method, path)
  if (remote) req.socket = { remoteAddress: "203.0.113.5" }
  const res = makeRes()
  await handleApi(req, res, path)
  return res
}

describe("webfetch fair-use surface (S3)", () => {
  let dir
  let handleApi
  let wf

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-webfetch-api-"))
    process.env.PICC_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    wf = await import("../services/webfetch.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET /api/webfetch/limits → conservative limits + honest observed stats", async () => {
    const res = await call(handleApi, "GET", "/api/webfetch/limits")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.limits.maxRpm).toBeGreaterThanOrEqual(1)
    expect(res.body.limits.windowMs).toBe(60_000)
    expect(res.body.stats).toMatchObject({ hosts: {}, sinceReset: expect.any(String) })
  })

  it("observed traffic surfaces in stats; zero-traffic hosts do not appear", async () => {
    wf.recordHit("www.example.com")
    wf.recordLimited("www.example.com")
    const res = await call(handleApi, "GET", "/api/webfetch/limits")
    expect(res.body.stats.hosts).toMatchObject({
      "www.example.com": { inWindow: 1, limited: 1 }
    })
    expect(Object.keys(res.body.stats.hosts)).toHaveLength(1)
    wf.resetWebFetchLimits()
  })

  it("GET is rate limited (429) beyond 30 reads per 60s", async () => {
    let last
    for (let i = 0; i < 31; i++) {
      last = await call(handleApi, "GET", "/api/webfetch/limits")
    }
    expect(last.status).toBe(429)
    expect(last.body.error).toBe("rate limited")
  })

  it("POST reset is auth-gated: a remote caller without a session gets 401", async () => {
    const { createAccount } = await import("../services/auth.mjs")
    await createAccount({ email: "bob@example.com", password: "correct-horse-battery", name: "Bob" })
    const res = await call(handleApi, "POST", "/api/webfetch/limits/reset", { remote: true })
    expect(res.status).toBe(401)
  })

  it("POST reset (localhost) clears windows and stamps a fresh sinceReset — honesty intact", async () => {
    wf.recordHit("www.example.com")
    const before = await call(handleApi, "GET", "/api/webfetch/limits")
    expect(Object.keys(before.body.stats.hosts)).toHaveLength(1)

    const res = await call(handleApi, "POST", "/api/webfetch/limits/reset")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.stats.hosts).toEqual({})

    const after = await call(handleApi, "GET", "/api/webfetch/limits")
    expect(after.body.stats.hosts).toEqual({})
    expect(after.body.stats.sinceReset).not.toBe(before.body.stats.sinceReset)
  })
})