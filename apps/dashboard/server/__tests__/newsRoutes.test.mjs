import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Route-contract coverage for Task 4.5: an UNSET SERPER_API_KEY must yield a
// 200 honest degraded shape (never fake news, never a 502). No configured-key
// test lives here — that path calls the real Serper network and is deliberately
// excluded; it stays covered by service-level Serper tests with stubbed env.

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

describe("trading news API routes", () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "picc-news-routes-"))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  // Fresh process env + fresh module graph per test. handlers.mjs statically
  // imports the trading/autopilot services, which pin their data dirs at import
  // time, so env must be staged BEFORE the re-import. SERPER_API_KEY is stubbed
  // to "" (not to a key): config.mjs loads apps/dashboard/.env at import, which
  // supplies a real key on this dev machine — leaving it would call the real
  // Serper network. Stubbing "" pins the unconfigured path hermetically.
  async function loadHandlers() {
    vi.stubEnv("PICC_TRADING_DATA_DIR", dir)
    vi.stubEnv("PICC_DATA_DIR", dir)
    vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
    vi.stubEnv("SERPER_API_KEY", "")
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?news-routes-test")
    return { handleApi }
  }

  it("GET ?query=test with a key unset returns the degraded 200 shape", async () => {
    const { handleApi } = await loadHandlers()

    const res = await call(handleApi, "GET", "/api/trading/news?query=test")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.query).toBe("test")
    expect(res.body.source).toBe("serper")
    expect(res.body.items).toEqual([])
    expect(res.body.degraded).toEqual({ reason: "news_api_unconfigured" })
  })

  it("POST {query} with a key unset returns the degraded 200 shape", async () => {
    const { handleApi } = await loadHandlers()

    const res = await call(handleApi, "POST", "/api/trading/news", { query: "test" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      query: "test",
      source: "serper",
      items: [],
      degraded: { reason: "news_api_unconfigured" }
    })
  })
})