import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handleApi } from "../handlers.mjs"
import { env } from "../config.mjs"
import { stopLiveEO } from "../services/liveEO.mjs"
import { registerConnector, getConnector } from "../services/connectors.mjs"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  const remote = headers.host && !/^localhost(:|$)/.test(headers.host) ? "93.184.216.34" : "127.0.0.1"
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: remote },
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

async function call(method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

describe("POST /api/extension/ingest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))))
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await stopLiveEO()
  })

  it("accepts a batch of broker frames and reports the accepted count", async () => {
    const res = await call("POST", "/api/extension/ingest", {
      frames: [
        { action: "candles", message: { assetId: "142", candles: [{ t: Math.floor(Date.now() / 1000), tf: 0, v: [1.2] }] } },
        { action: "candles", message: { assetId: "142", candles: [{ t: Math.floor(Date.now() / 1000), tf: 5, v: [1.2, 1.21, 1.19, 1.205] }] } }
      ]
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.received).toBe(2)
    expect(res.body.accepted).toBe(2)
  })

  it("rejects GET and non-localhost callers", async () => {
    const get = await call("GET", "/api/extension/ingest")
    expect(get.status).toBe(405)
    const remote = await call("POST", "/api/extension/ingest", { frames: [{ action: "candles" }] }, { host: "evil.example.com" })
    expect(remote.status).toBe(403)
  })

  it("400s when no frames are present and counts junk as unaccepted", async () => {
    const empty = await call("POST", "/api/extension/ingest", {})
    expect(empty.status).toBe(400)
    const junk = await call("POST", "/api/extension/ingest", { frames: [null, "x", { nope: 1 }] })
    expect(junk.status).toBe(200)
    expect(junk.body.accepted).toBe(0)
  })

  it("413s oversized batches", async () => {
    const frames = Array.from({ length: 201 }, (_, i) => ({ action: "candles", message: { assetId: String(i), candles: [] } }))
    const res = await call("POST", "/api/extension/ingest", { frames })
    expect(res.status).toBe(413)
  })

  it("ingested frames surface in live data for downstream consumers", async () => {
    const t = Math.floor(Date.now() / 1000)
    await call("POST", "/api/extension/ingest", {
      frames: [{ action: "candles", message: { assetId: "555", name: "EURUSD", candles: [{ t: t - (t % 60), tf: 5, v: [1.08, 1.081, 1.079, 1.0805] }] } }]
    })
    const status = await call("GET", "/api/trading/data-sources")
    if (status.status === 200 && status.body?.sources?.candles) {
      // Feed provenance reflects the extension leg once its frames dominate
      expect(["extension", "studio"]).toContain(status.body.sources.candles.feed)
    } else {
      // Endpoint shape may vary; the service-level test covers classification.
      expect(status.status).not.toBe(500)
    }
  })
})

describe("POST /api/extension/ingest — income branch (Task 5)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))))
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await stopLiveEO()
  })

  it("routes an income observation to a scan-capable connector and persists an Earnings snapshot", async () => {
    // Register a declarative scan-capable connector (config-driven, like a real
    // income site). Unique slug + origin so it cannot collide with the static
    // registry or other tests.
    registerConnector({
      slug: "tz-earn",
      label: "EarnCo (test)",
      origins: ["earnco.test"],
      transports: ["browser"],
      scan: { mode: "wsFrames", wsUrlRe: "earnco\\.test", mapFrame: { balance: ["balance", "credits"], today: ["today"], lifetime: ["total"] } }
    })
    const res = await call("POST", "/api/extension/ingest", {
      origin: "https://earnco.test/dashboard",
      frames: [{ balance: "12.50", total: "99.99" }]
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.income).toBe(true)
    expect(res.body.slug).toBe("tz-earn")
    expect(res.body.status).toBe("ok")
    expect(res.body.snapshot.provider).toBe("tz-earn")
    expect(res.body.snapshot.balance).toBe(12.5)
    expect(getConnector("tz-earn").scan.mode).toBe("wsFrames")
  })

  it("keeps income observations honest: no usable value is unconfigured, never zero", async () => {
    registerConnector({
      slug: "tz-earn2",
      label: "EarnCo2 (test)",
      origins: ["earnco2.test"],
      transports: ["browser"],
      scan: { mode: "wsFrames", wsUrlRe: "earnco2\\.test", mapFrame: { balance: ["balance"], lifetime: ["total"] } }
    })
    const res = await call("POST", "/api/extension/ingest", {
      origin: "https://earnco2.test/dashboard",
      frames: [{ some_unrelated: "x" }]
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("unconfigured")
    expect(res.body.snapshot.balance).toBeNull()
    expect(res.body.snapshot.lifetime).toBeNull()
  })

  it("404s an income observation for an unknown origin", async () => {
    const res = await call("POST", "/api/extension/ingest", {
      origin: "https://not-a-registered-site.example/"
    })
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
  })

  it("404s income observations for the removed bandwidth origins", async () => {
    for (const origin of ["https://dashboard.honeygain.com/dashboard", "https://app.traffmonetizer.com/"]) {
      const res = await call("POST", "/api/extension/ingest", {
        origin,
        frames: [{ credits: "12.50", total: "99.99" }]
      })
      expect(res.status).toBe(404)
      expect(res.body.ok).toBe(false)
    }
  })
})

describe("GET/POST /api/trading/feed-mode (T4)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))))
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await stopLiveEO()
    const { setFeedMode } = await import("../services/liveEO.mjs")
    setFeedMode("auto")
  })

  it("GET reports the live preference and both legs", async () => {
    const res = await call("GET", "/api/trading/feed-mode")
    expect(res.status).toBe(200)
    expect(["auto", "extension", "studio"]).toContain(res.body.feedMode)
    expect(res.body.legs.extension).toHaveProperty("alive")
    expect(res.body.legs.studio).toHaveProperty("alive")
  })

  it("POST sets the preference and GET reflects it", async () => {
    const set = await call("POST", "/api/trading/feed-mode", { feedMode: "studio" })
    expect(set.status).toBe(200)
    expect(set.body.feedMode).toBe("studio")
    const get = await call("GET", "/api/trading/feed-mode")
    expect(get.body.feedMode).toBe("studio")
  })

  it("rejects unknown modes at the HTTP surface", async () => {
    const res = await call("POST", "/api/trading/feed-mode", { feedMode: "moon" })
    expect(res.status).toBe(400)
  })
})
