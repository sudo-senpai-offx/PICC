import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { handleApi } from "../handlers.mjs"
import { env } from "../config.mjs"
import { classifySource, collectSourceStatuses, isValidStatus, REQUIRED_SOURCES } from "../services/dataSources.mjs"

vi.mock("../services/liveEO.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, liveEOStats: vi.fn(() => ({ status: "idle", buffers: 0, lastSeen: 0 })) }
})

vi.mock("../services/sentimentEngine.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, sentimentLastUpdate: vi.fn(() => null) }
})

function makeReq(method, url, body) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json" },
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
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}

async function call(method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}

describe("data source honesty classification", () => {
  const now = Date.now()

  it("marks fresh data (< 30s) as live", () => {
    expect(classifySource(now - 5000, now).status).toBe("live")
    expect(classifySource(now - 29900, now).status).toBe("live")
  })

  it("marks computed-but-valid data (30-60s) as local", () => {
    expect(classifySource(now - 30000, now).status).toBe("local")
    expect(classifySource(now - 60000, now).status).toBe("local")
  })

  it("detects stale data (> 60s age)", () => {
    expect(classifySource(now - 61000, now).status).toBe("stale")
    expect(classifySource(now - 300000, now).status).toBe("stale")
  })

  it("marks missing timestamps as unconfigured", () => {
    for (const ts of [null, undefined, 0, -5]) {
      expect(classifySource(ts, now).status).toBe("unconfigured")
    }
  })

  it("reports ISO lastUpdate and integer age", () => {
    const r = classifySource(now - 10000, now)
    expect(r.lastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.age).toBe(10)
  })

  it("only ever produces valid honest statuses", () => {
    for (let s = 0; s <= 200; s += 7) {
      expect(isValidStatus(classifySource(now - s * 1000, now).status)).toBe(true)
    }
    expect(isValidStatus("fabricated")).toBe(false)
  })
})

describe("/api/trading/health source observability", () => {
  let snap
  beforeEach(() => {
    snap = { ...env }
    env.geminiApiKey = env.groqApiKey = env.mistralApiKey = env.cerebrasApiKey = env.openaiApiKey = ""
    env.serperApiKey = ""
    env.btcpayUrl = env.btcpayApiKey = env.btcpayStoreId = ""
    env.ewalletTngNumber = ""
    env.agentsUrl = ""
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
  })
  afterEach(() => {
    for (const k of Object.keys(snap)) env[k] = snap[k]
    vi.unstubAllGlobals()
  })

  it("includes every required source with honest statuses", async () => {
    const res = await call("GET", "/api/trading/health")
    expect(res.status).toBe(200)
    const sources = res.body.sources
    expect(Object.keys(sources).sort()).toEqual([...REQUIRED_SOURCES].sort())
    for (const key of REQUIRED_SOURCES) {
      expect(sources[key]).toHaveProperty("status")
      expect(sources[key]).toHaveProperty("lastUpdate")
      expect(isValidStatus(sources[key].status)).toBe(true)
    }
  })

  it("hermetic environment reports unconfigured feeds, never fabricated ones", async () => {
    const res = await call("GET", "/api/trading/health")
    expect(res.body.sources.candles.status).toBe("unconfigured")
    expect(res.body.sources.sentiment.status).toBe("unconfigured")
  })

  it("flags stale candle feed when liveEO lastSeen ages out", async () => {
    const { liveEOStats } = await import("../services/liveEO.mjs")
    liveEOStats.mockReturnValue({ status: "connected", buffers: 1, lastSeen: Date.now() - 90000 })
    const st = collectSourceStatuses()
    expect(st.candles.status).toBe("stale")
    liveEOStats.mockReturnValue({ status: "idle", buffers: 0, lastSeen: 0 })
  })
})
