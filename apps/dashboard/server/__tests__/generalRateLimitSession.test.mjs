// Wave3+ slice 05 — per-session general buckets + read single-flight (TDD).
//
// Premise under test (PICC.md §20.1, handlers.mjs general limiter): the shared
// per-IP `general:<ip>` bucket (60 POST/PUT/PATCH per 60s) can 429 a busy
// multi-panel suite session, because semantically-read POSTs (candles, levels)
// cost budget. Fix pinned here:
//   1. a VERIFIED session gets its own general bucket keyed by session token,
//      so tabs/sessions behind one IP stop spending each other's budget;
//   2. identical in-flight read POSTs (candles, levels) coalesce onto one
//      upstream fan-in call (single-flight per key).
// What is deliberately NOT pinned: an UNVERIFIED bearer must fall back to the
// per-IP bucket — otherwise any caller could mint unlimited budgets by varying
// one header, the same bypass class X-Forwarded-For spoofing would be.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

useIsolatedStoreDir("PICC_DATA_DIR", { prefix: "picc-general-session" })

let handleApi
let registerBroker

function synthCandles(n, base = 100) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 60,
    open: base + i * 0.1,
    high: base + i * 0.1 + 0.5,
    low: base + i * 0.1 - 0.5,
    close: base + i * 0.1
  }))
}

function makeReq(method, path, { ip = "198.51.100.7", token = null, body = {} } = {}) {
  const raw = JSON.stringify(body)
  const headers = { host: "localhost", "content-type": "application/json" }
  if (token) headers.authorization = `Bearer ${token}`
  return {
    method,
    url: path,
    headers,
    socket: { remoteAddress: ip },
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

async function call(method, path, opts = {}) {
  const res = makeRes()
  await handleApi(makeReq(method, path, opts), res, path)
  return res
}

async function burst(method, path, opts, n) {
  let last
  for (let i = 0; i < n; i += 1) last = await call(method, path, opts)
  return last
}

// A fresh module graph per test: rateBuckets is module-scope state, so only a
// re-import gives each case an empty general budget.
beforeEach(async () => {
  vi.resetModules()
  handleApi = (await import("../handlers.mjs")).handleApi
  registerBroker = (await import("../services/brokers/index.mjs")).registerBroker
  registerBroker({
    slug: "sess-candles",
    label: "session-bucket fixture",
    weight: 100,
    isAlive: () => true,
    availableTimeframes: () => [60],
    getCandles: (_id, opts) => (opts?.timeframe === 60 ? synthCandles(90) : [])
  })
})

afterEach(() => {
  vi.resetModules()
})

describe("general limiter — verified sessions are isolated per session token", () => {
  it("a second session behind the same IP keeps its own 60-request budget", async () => {
    const { createAccount } = await import("../services/auth.mjs")
    const a = await createAccount({ email: "sess-a@example.test", password: "session-pass-a1", name: "A" })
    const b = await createAccount({ email: "sess-b@example.test", password: "session-pass-b1", name: "B" })
    expect(a?.token, "seed account A must exist").toBeTruthy()
    expect(b?.token, "seed account B must exist").toBeTruthy()
    const ip = "198.51.100.7"
    const body = { assetId: "EURUSD", timeframe: 60, count: 50 }

    for (let i = 0; i < 60; i += 1) {
      const r = await call("POST", "/api/trading/candles", { ip, token: a.token, body })
      expect(r.status, `session A request ${i} must be inside its own budget`).toBe(200)
    }
    expect((await call("POST", "/api/trading/candles", { ip, token: a.token, body })).status).toBe(429)
    // Session B shares the IP but not the budget.
    expect(
      (await call("POST", "/api/trading/candles", { ip, token: b.token, body })).status,
      "session B's first request must not be spent by session A's 60"
    ).toBe(200)
  })

  it("an UNVERIFIED bearer falls back to the per-IP bucket (no header-minted bypass)", async () => {
    const ip = "198.51.100.8"
    const body = { assetId: "EURUSD", timeframe: 60, count: 50 }
    for (let i = 0; i < 60; i += 1) {
      const r = await call("POST", "/api/trading/candles", { ip, body })
      expect(r.status, `anonymous request ${i} must be inside the IP budget`).toBe(200)
    }
    expect(
      (await call("POST", "/api/trading/candles", { ip, token: "forged-token-value", body })).status,
      "a forged bearer must share the IP bucket, not mint a fresh one"
    ).toBe(429)
  })

  it("CONTROL: a normal single-panel session stays far from the ceiling", async () => {
    const { createAccount } = await import("../services/auth.mjs")
    const a = await createAccount({ email: "sess-c@example.test", password: "session-pass-c1", name: "C" })
    const ip = "198.51.100.9"
    // One chart mount costs ~2 POSTs (candles + levels); five mounts ≈ 10.
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await call("POST", "/api/trading/candles", { ip, token: a.token, body: { assetId: "EURUSD", timeframe: 60, count: 50 } })).status
      ).toBe(200)
      expect(
        (await call("POST", "/api/trading/levels", { ip, token: a.token, body: { assetId: "EURUSD", timeframe: 60, count: 200 } })).status
      ).toBe(200)
    }
  })
})

describe("read single-flight — identical in-flight POSTs share one upstream call", () => {
  it("concurrent identical candles POSTs invoke the broker once", async () => {
    let brokerCalls = 0
    registerBroker({
      slug: "sess-count",
      label: "counting fixture",
      weight: 200,
      isAlive: () => true,
      availableTimeframes: () => [60],
      getCandles: async (_id, opts) => {
        brokerCalls += 1
        await new Promise((r) => setTimeout(r, 25))
        return opts?.timeframe === 60 ? synthCandles(90) : []
      }
    })
    const body = { assetId: "EURUSD", timeframe: 60, count: 50 }
    const results = await Promise.all(
      Array.from({ length: 6 }, () => call("POST", "/api/trading/candles", { ip: "198.51.100.21", body }))
    )
    for (const r of results) expect(r.status).toBe(200)
    expect(brokerCalls, "six identical in-flight reads must share one broker call").toBe(1)
  })

  it("concurrent identical levels POSTs invoke the broker once", async () => {
    let brokerCalls = 0
    registerBroker({
      slug: "sess-count-lv",
      label: "counting fixture (levels)",
      weight: 300,
      isAlive: () => true,
      availableTimeframes: () => [60],
      getCandles: async (_id, opts) => {
        brokerCalls += 1
        await new Promise((r) => setTimeout(r, 25))
        return opts?.timeframe === 60 ? synthCandles(200) : []
      }
    })
    const body = { assetId: "EURUSD", timeframe: 60, count: 200 }
    const results = await Promise.all(
      Array.from({ length: 4 }, () => call("POST", "/api/trading/levels", { ip: "198.51.100.22", body }))
    )
    for (const r of results) expect(r.status).toBe(200)
    expect(brokerCalls, "four identical in-flight levels reads must share one broker call").toBe(1)
  })
})
