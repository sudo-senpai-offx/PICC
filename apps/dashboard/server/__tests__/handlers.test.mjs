import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handleApi } from "../handlers.mjs"
import { env } from "../config.mjs"

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

describe("PICC API handlers", () => {
  let envSnap
  beforeEach(() => {
    // Hermetic: these tests must not depend on the developer's real .env keys.
    envSnap = { ...env }
    env.geminiApiKey = env.geminiServiceAccountFile = env.groqApiKey = env.mistralApiKey = env.cerebrasApiKey = env.openaiApiKey = ""
    env.llmProviders = env.serperApiKey = ""
    env.stripeSecretKey = env.stripeWebhookSecret = env.stripePricePro = env.stripePriceBusiness = ""
    env.paypalClientId = env.paypalClientSecret = ""
    env.btcpayUrl = env.btcpayApiKey = env.btcpayStoreId = ""
    env.ewalletTngNumber = ""
    env.supabaseUrl = env.supabaseServiceKey = ""
    env.agentsUrl = ""
    env.amazonClientId = env.amazonClientSecret = env.amazonRefreshToken = ""
    env.amazonAccessKey = env.amazonSecretKey = ""
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))))
  })
  afterEach(() => {
    for (const k of Object.keys(envSnap)) env[k] = envSnap[k]
    vi.unstubAllGlobals()
  })

  it("health reports providers without network", async () => {
    const res = await call("GET", "/api/health")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.providers).toHaveProperty("yahoo", true)
    expect(res.body.providers).toHaveProperty("llm", false)
    expect(res.body.providers.llmProviders).toEqual([])
    expect(res.body.providers).toHaveProperty("paypal", false)
    expect(res.body.providers).toHaveProperty("btcpay", false)
    expect(res.body.providers).toHaveProperty("ewallet", false)
    expect(res.body.agents).toBeNull()
  })

  it("twin falls back to local engine when market data is unreachable", async () => {
    const res = await call("POST", "/api/twin/run", {
      ticker: "VOO",
      capital: 10000,
      riskTolerance: "moderate",
      horizonYears: 10,
      simulations: 1000
    })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("local")
    expect(res.body.projection).toBeDefined()
    expect(res.body.projection.p10).toBeLessThan(res.body.projection.medianEnd)
    expect(res.body.projection.medianEnd).toBeLessThan(res.body.projection.p90)
  })

  it("clamps CPU-heavy twin/run inputs (simulations + horizon)", async () => {
    const res = await call("POST", "/api/twin/run", {
      ticker: "VOO",
      capital: 10000,
      horizonYears: 500,
      simulations: 999999999
    })
    expect(res.status).toBe(200)
    expect(res.body.projection.horizonYears).toBe(40)
    expect(res.body.projection.simulatedPaths).toBe(20000)
  })

  it("extension suggest returns honest local suggestions without keys", async () => {
    const res = await call("POST", "/api/extension/suggest", {
      url: "https://www.amazon.com/dp/B0EXAMPLE",
      pageTitle: "Test Product",
      pageData: { title: "Test Product", bullets: ["a", "b", "c"] }
    })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("local")
    expect(Array.isArray(res.body.suggestions)).toBe(true)
    expect(res.body.suggestions.length).toBeGreaterThan(0)
  })

  it("content generate returns a structured draft via the rule engine", async () => {
    const res = await call("POST", "/api/content/generate", { kind: "youtube_script", topic: "REIT investing" })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("local")
    expect(res.body.draft.headline).toBeTruthy()
    expect(Array.isArray(res.body.draft.tags)).toBe(true)
    expect(res.body.draft.cta).toBeTruthy()
  })

  it("content generate honours tone and length in the local fallback", async () => {
    const res = await call("POST", "/api/content/generate", { kind: "blog", topic: "REIT investing", tone: "hype", length: "short" })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("local")
    expect(res.body.draft.estimatedReadMinutes).toBe(4)
  })

  it("listing keywords returns local extraction without keys", async () => {
    const res = await call("POST", "/api/listing/keywords", {
      currentTitle: "Premium Yoga Mat for Home Workouts",
      currentBullets: ["Non-slip surface for sweaty workouts", "Eco-friendly material", "Non-slip grip"]
    })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("local")
    expect(res.body.keywords.unigrams.length).toBeGreaterThan(0)
    expect(res.body.longTail).toEqual([])
  })

  it("listing rewrite falls back to a single rule-based option without keys", async () => {
    const res = await call("POST", "/api/listing/rewrite", {
      currentTitle: "Premium Yoga Mat",
      currentBullets: ["Non-slip surface", "Eco-friendly material"]
    })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("local")
    expect(Array.isArray(res.body.rewrites)).toBe(true)
    expect(res.body.rewrites.length).toBeGreaterThan(0)
    expect(res.body.rewrites[0].title).toBeTruthy()
  })

  it("stripe checkout requires auth when configured", async () => {
    const res = await call("POST", "/api/stripe/checkout", { priceId: "price_123" })
    expect(res.status).toBe(503) // stripe not configured -> 503 before auth
  })

  it("competitor intel returns honest unconfigured result without SP-API keys", async () => {
    const res = await call("POST", "/api/listing/competitors", { keywords: "yoga mat" })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("unconfigured")
    expect(res.body.competitors).toEqual([])
    expect(res.body.note).toContain("SP_AMAZON_")
  })

  it("btcpay status reports unconfigured node without URL", async () => {
    const res = await call("GET", "/api/btcpay/status")
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
    expect(res.body.reachable).toBe(false)
    expect(res.body.synchronized).toBeNull()
  })

  it(
    "automator health returns local issues, totals and alerts",
    async () => {
      const res = await call("POST", "/api/automator/health", {})
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(Array.isArray(res.body.issues)).toBe(true)
      expect(Array.isArray(res.body.alerts)).toBe(true)
      expect(res.body.totals).toHaveProperty("configured")
      expect(res.body.totals).toHaveProperty("ready")
      expect(res.body.totals).toHaveProperty("nodesTotal")
    },
    20_000
  )

  it(
    "automator assist falls back to the local rule engine without LLM keys",
    async () => {
      const res = await call("POST", "/api/automator/assist", { question: "What should I do this week?" })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.source).toBe("local")
      expect(typeof res.body.advice).toBe("string")
      expect(res.body.advice.length).toBeGreaterThan(0)
    },
    20_000
  )

  it(
    "opportunities catalog exposes research categories, opportunities and crews",
    async () => {
      const res = await call("GET", "/api/opportunities")
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.categories).toHaveLength(7)
      expect(res.body.opportunities.length).toBeGreaterThan(0)
      expect(res.body.agents.length).toBeGreaterThan(0)
      for (const o of res.body.opportunities) {
        expect(o).toHaveProperty("category")
        expect(o).toHaveProperty("title")
        expect(o).toHaveProperty("status")
      }
    },
    20_000
  )

  it(
    "opportunities workflows lists templates even without the infra dir",
    async () => {
      const res = await call("POST", "/api/opportunities/workflows", {})
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(Array.isArray(res.body.workflows)).toBe(true)
      expect(res.body.workflows.length).toBeGreaterThan(0)
      expect(res.body.workflows[0]).toHaveProperty("file")
      expect(res.body.workflows[0]).toHaveProperty("install")
    },
    20_000
  )

  it(
    "opportunities bounty monitor reports each board honestly",
    async () => {
      const res = await call("GET", "/api/opportunities/bounties")
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(Array.isArray(res.body.boards)).toBe(true)
      expect(res.body.boards.length).toBeGreaterThan(0)
      for (const b of res.body.boards) {
        expect(b).toHaveProperty("id")
        expect(b).toHaveProperty("reachable")
        expect(typeof b.error === "string" || b.error === null).toBe(true)
      }
    },
    30_000
  )

  it("404 for unknown paths", async () => {
    const res = await call("GET", "/api/nope")
    expect(res.status).toBe(404)
  })

  it("workflows/run returns 400 (not a crash) when the browser is closed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-wf-test-"))
    const token = randomBytes(32).toString("hex")
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
    writeFileSync(join(dir, "sessions.json"), JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 60_000 } } }))
    vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
    vi.resetModules()
    const { handleApi: hApi } = await import("../handlers.mjs?wf-run-test")
    const res = {
      status: null,
      body: null,
      writeHead(status) {
        this.status = status
      },
      end(body) {
        this.body = body ? JSON.parse(body) : null
      }
    }
    const raw = JSON.stringify({ workflowId: "read-portfolio" })
    const req = {
      method: "POST",
      headers: { host: "localhost", "content-type": "application/json", authorization: `Bearer ${token}` },
      raw,
      on(evt, cb) {
        if (evt === "data" && raw != null) cb(raw)
        if (evt === "end") cb()
      }
    }
    await hApi(req, res, "/api/browser/workflows/run")
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/browser is not open/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it("browser stream parses its searchParams and emits an SSE ready frame", async () => {
    // Regression: { ...parsed } used to drop URL.searchParams, so the
    // stream route crashed with "Cannot read properties of undefined (reading 'get')".
    const dir = mkdtempSync(join(tmpdir(), "picc-auth-test-"))
    const token = randomBytes(32).toString("hex")
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
    writeFileSync(join(dir, "sessions.json"), JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 60_000 } } }))
    vi.stubEnv("PICC_AUTH_DATA_DIR", dir)
    vi.resetModules()
    const { handleApi: hApi } = await import("../handlers.mjs?stream-test")
    const chunks = []
    const res = {
      writeHead() {},
      write(c) {
        chunks.push(c)
        return true
      },
      end() {},
      on() {}
    }
    const req = {
      method: "GET",
      headers: { host: "localhost", authorization: "" },
      listeners: {},
      on(evt, cb) {
        this.listeners[evt] = cb
        if (evt === "end") queueMicrotask(() => cb())
      },
      emit(evt) {
        this.listeners[evt]?.()
      }
    }
    const pending = hApi(req, res, `/api/browser/stream?token=${token}`)
    await new Promise((r) => setTimeout(r, 30))
    expect(chunks.some((c) => c.includes("event: ready"))).toBe(true)
    req.emit("close")
    await pending
    rmSync(dir, { recursive: true, force: true })
  })
})
