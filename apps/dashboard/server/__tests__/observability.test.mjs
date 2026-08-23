import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { handleApi } from "../handlers.mjs"
import { env } from "../config.mjs"
import { classifySource, collectSourceStatuses, isValidStatus, REQUIRED_SOURCES } from "../services/dataSources.mjs"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const CONTENT_SRC = readFileSync(join(__dirname, "..", "..", "extensions", "picc-overlay", "content.js"), "utf8")

vi.mock("../services/liveEO.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, liveEOStats: vi.fn(() => ({ status: "idle", buffers: 0, lastSeen: 0 })) }
})

vi.mock("../services/sentimentEngine.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, sentimentLastUpdate: vi.fn(() => null) }
})

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

async function call(method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

describe("data source honesty classification", () => {
  const now = Date.now()

  it("marks fresh data (< 30s) as live", () => {
    expect(classifySource(now - 5000, now).status).toBe("live")
    expect(classifySource(now - 29900, now).status).toBe("live")
    expect(classifySource(now - 29900, now).age).toBe(29)
  })

  it("marks computed-but-valid data (30-60s) as local", () => {
    expect(classifySource(now - 30000, now).status).toBe("local")
    expect(classifySource(now - 31000, now).status).toBe("local")
    expect(classifySource(now - 60000, now).status).toBe("local")
  })

  it("detects stale data (> 60s age)", () => {
    expect(classifySource(now - 60001, now).status).toBe("stale")
    expect(classifySource(now - 61000, now).age).toBe(61)
    expect(classifySource(now - 300000, now).status).toBe("stale")
  })

  it("marks missing timestamps as unconfigured", () => {
    for (const ts of [null, undefined, 0, -5, Number.NaN]) {
      expect(classifySource(ts, now).status).toBe("unconfigured")
      expect(classifySource(ts, now).lastUpdate).toBeNull()
      expect(classifySource(ts, now).age).toBeNull()
    }
  })

  it("reports ISO lastUpdate and integer age in seconds", () => {
    const r = classifySource(now - 10000, now)
    expect(r.lastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(Number.isInteger(r.age)).toBe(true)
    expect(r.age).toBe(10)
  })

  it("only ever produces the four honest status values", () => {
    for (let s = 0; s <= 200; s += 7) {
      expect(isValidStatus(classifySource(now - s * 1000, now).status)).toBe(true)
    }
    expect(isValidStatus("fabricated")).toBe(false)
  })

  it("derives orderflow/regime/expiry honesty from the candle feed", () => {
    const statuses = collectSourceStatuses(now)
    expect(statuses.orderflow.status).toBe(statuses.candles.status)
    expect(statuses.regime.status).toBe(statuses.candles.status)
    expect(statuses.expiry.status).toBe(statuses.candles.status)
  })
})

describe("/api/trading/health source observability", () => {
  let envSnap
  beforeEach(() => {
    envSnap = { ...env }
    env.geminiApiKey = env.geminiServiceAccountFile = env.groqApiKey = env.mistralApiKey = env.cerebrasApiKey = env.openaiApiKey = ""
    env.llmProviders = env.serperApiKey = ""
    env.stripeSecretKey = env.stripeWebhookSecret = env.stripePricePro = env.stripePriceBusiness = ""
    env.paypalClientId = env.paypalClientSecret = ""
    env.btcpayUrl = env.btcpayApiKey = env.btcpayStoreId = ""
    env.ewalletTngNumber = ""
    env.supabaseUrl = env.supabaseServiceKey = ""
    env.agentsUrl = ""
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))))
  })
  afterEach(() => {
    for (const k of Object.keys(envSnap)) env[k] = envSnap[k]
    vi.unstubAllGlobals()
  })

  it("includes a sources object covering every required data source", async () => {
    const res = await call("GET", "/api/trading/health")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const sources = res.body.sources
    expect(sources).toBeTruthy()
    expect(Object.keys(sources).sort()).toEqual([...REQUIRED_SOURCES].sort())
  })

  it("gives every source a status, lastUpdate and age field", async () => {
    const res = await call("GET", "/api/trading/health")
    for (const key of REQUIRED_SOURCES) {
      const info = res.body.sources[key]
      expect(info, `source ${key} missing`).toBeTruthy()
      expect(info).toHaveProperty("status")
      expect(info).toHaveProperty("lastUpdate")
      expect(info).toHaveProperty("age")
    }
  })

  it("only reports valid honesty statuses (live/local/stale/unconfigured)", async () => {
    const res = await call("GET", "/api/trading/health")
    for (const [key, info] of Object.entries(res.body.sources)) {
      expect(isValidStatus(info.status), `${key} has invalid status ${info.status}`).toBe(true)
    }
  })

  it("honestly reports unconfigured feeds in a hermetic offline environment", async () => {
    const res = await call("GET", "/api/trading/health")
    expect(res.body.sources.candles.status).toBe("unconfigured")
    expect(res.body.sources.sentiment.status).toBe("unconfigured")
    expect(res.body.sources.kelly.status).toBe("unconfigured")
  })

  it("reports sentiment freshness from the sentiment cache timestamps", async () => {
    const { sentimentLastUpdate } = await import("../services/sentimentEngine.mjs")
    sentimentLastUpdate.mockReturnValue(Date.now() - 10000)
    try {
      expect(collectSourceStatuses().sentiment.status).toBe("live")
      expect(collectSourceStatuses(Date.now() + 45000).sentiment.status).toBe("local")
      expect(collectSourceStatuses(Date.now() + 120000).sentiment.status).toBe("stale")
    } finally {
      sentimentLastUpdate.mockReturnValue(null)
    }
  })

  it("flags stale candle feed once lastSeen exceeds 60s", async () => {
    const { liveEOStats } = await import("../services/liveEO.mjs")
    liveEOStats.mockReturnValue({ status: "connected", buffers: 2, lastSeen: Date.now() - 90000 })
    try {
      const statuses = collectSourceStatuses()
      expect(statuses.candles.status).toBe("stale")
      expect(statuses.candles.age).toBeGreaterThanOrEqual(60)
      for (const key of ["orderflow", "regime", "expiry"]) {
        expect(statuses[key].status).toBe("stale")
        expect(statuses[key].age).toBe(statuses.candles.age)
      }
    } finally {
      liveEOStats.mockReturnValue({ status: "idle", buffers: 0, lastSeen: 0 })
    }
  })

  it("marks a fresh candle feed as live across the derived sources", async () => {
    const { liveEOStats } = await import("../services/liveEO.mjs")
    liveEOStats.mockReturnValue({ status: "connected", buffers: 2, lastSeen: Date.now() - 2000 })
    try {
      const statuses = collectSourceStatuses()
      expect(statuses.candles.status).toBe("live")
      expect(statuses.orderflow.status).toBe("live")
      expect(statuses.regime.status).toBe("live")
      expect(statuses.expiry.status).toBe("live")
    } finally {
      liveEOStats.mockReturnValue({ status: "idle", buffers: 0, lastSeen: 0 })
    }
  })
})

function extractFunction(name, src) {
  const marker = `function ${name}`
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`${name} not found`)
  let depth = 0
  let opened = false
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") { depth++; opened = true }
    else if (src[i] === "}") {
      depth--
      if (opened && depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`${name} braces unbalanced`)
}

describe("data-sources overlay dockable", () => {
  function buildRenderer() {
    const fnSrc = extractFunction("renderDataSources", CONTENT_SRC)
    return new Function(
      "tradingState",
      "serverOnline",
      "isTimedOut",
      "offlineBanner",
      "staleLabel",
      "sourceLabel",
      `${fnSrc}; return renderDataSources()`
    )
  }

  const isTimedOut = () => false
  const offlineBanner = () => '<div data-test="offline"></div>'
  const staleLabel = () => '<div data-test="stale-label"></div>'
  const sourceLabel = (t) => `<div data-test="source-label">${t}</div>`

  const sampleSources = () => ({
    candles: { status: "live", lastUpdate: new Date(Date.now() - 3000).toISOString(), age: 3 },
    sentiment: { status: "local", lastUpdate: new Date(Date.now() - 40000).toISOString(), age: 40 },
    orderflow: { status: "local", lastUpdate: new Date(Date.now() - 3000).toISOString(), age: 3 },
    regime: { status: "local", lastUpdate: new Date(Date.now() - 3000).toISOString(), age: 3 },
    expiry: { status: "stale", lastUpdate: new Date(Date.now() - 90000).toISOString(), age: 90 },
    kelly: { status: "unconfigured", lastUpdate: null, age: null }
  })

  it("is registered as a trading-suite dockable preset and wired into the panel map", () => {
    expect(CONTENT_SRC.includes('id: "data-sources"')).toBe(true)
    expect(CONTENT_SRC.includes("function renderDataSources")).toBe(true)
    expect(CONTENT_SRC.includes('"data-sources": renderDataSources')).toBe(true)
  })

  it("renders every source with its colored badge, update time and age", () => {
    const html = buildRenderer()({ sources: sampleSources() }, true, isTimedOut, offlineBanner, staleLabel, sourceLabel)
    expect(html).toContain("LIVE")
    expect(html).toContain("LOCAL")
    expect(html).toContain("STALE")
    expect(html).toContain("UNCONFIGURED")
    for (const name of REQUIRED_SOURCES) expect(html).toContain(name)
    expect(html).toContain("\u00b7 3s")
    expect(html).toContain("\u00b7 90s")
    expect(html).toContain("never")
    expect(html).toContain(staleLabel())
  })

  it("shows actionable hints for stale and unconfigured sources", () => {
    const html = buildRenderer()({ sources: sampleSources() }, true, isTimedOut, offlineBanner, staleLabel, sourceLabel)
    expect(html).toContain("Derived from stale candles")
    expect(html).toContain("Close paper trades to calibrate sizing")
  })

  it("computes overall health green/yellow/red from the per-source statuses", () => {
    const render = buildRenderer()
    const healthy = render(
      { sources: Object.fromEntries(REQUIRED_SOURCES.map((k) => [k, { status: "live", lastUpdate: new Date().toISOString(), age: 2 }])) },
      true, isTimedOut, offlineBanner, staleLabel, sourceLabel
    )
    expect(healthy).toContain("#4ade80")
    expect(healthy).toContain("All feeds healthy")
    const degraded = render(
      { sources: Object.fromEntries(REQUIRED_SOURCES.map((k) => [k, { status: "stale", lastUpdate: new Date(Date.now() - 120000).toISOString(), age: 120 }])) },
      true, isTimedOut, offlineBanner, staleLabel, sourceLabel
    )
    expect(degraded).toContain("#ff6b6b")
    expect(degraded).toContain("System degraded")
    const partial = render({ sources: sampleSources() }, true, isTimedOut, offlineBanner, staleLabel, sourceLabel)
    expect(partial).toContain("#f59e0b")
    expect(partial).toContain("Partial degradation")
  })

  it("falls back to waiting/offline states when no report exists yet", () => {
    const render = buildRenderer()
    expect(render({ sources: null }, true, isTimedOut, offlineBanner, staleLabel, sourceLabel)).toContain("Checking data source health")
    expect(render({ sources: null }, false, isTimedOut, offlineBanner, staleLabel, sourceLabel)).toContain(offlineBanner())
  })

  it("fetches /api/trading/health inside fetchTradingData on a throttled cadence", () => {
    expect(CONTENT_SRC.includes('serverFetch("/api/trading/health")')).toBe(true)
    expect(CONTENT_SRC.includes("sourcesFetchedAt")).toBe(true)
  })
})
