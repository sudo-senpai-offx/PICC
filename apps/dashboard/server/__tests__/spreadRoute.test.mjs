// The /api/trading/spread route calls round2() on buy/sell prices. round2 was
// never defined in handlers.mjs, so ≥2 live quotes threw ReferenceError -> 500
// and the route returned a 500 instead of a spread. This test exercises the
// round2 path end-to-end with REAL ccxtConnector logic (real toCcxtSymbol +
// fetchTicker) by injecting in-memory exchange objects via getCredentials, and
// mocking liveEO so no network is contacted.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "../config.mjs"

vi.mock("../services/liveEO.mjs", () => ({
  liveEOData: () => ({ assets: [] }),
  fetchAssetCandles: async () => ({ ohlc: [], source: null })
}))

// The spread route's getCredentials comes from ./services/automator.mjs (which
// re-exports it), NOT trading.mjs directly. Override only getCredentials on
// automator: real ccxtConnector runs against these in-memory exchanges, each
// carrying a real fetchTicker method (JSON could never store a function, so the
// creds-file route is bypassed).
vi.mock("../services/automator.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  const exchanges = [
    { id: "exA", fetchTicker: async () => ({ symbol: "BTC/USDT", last: 100.055 }) },
    { id: "exB", fetchTicker: async () => ({ symbol: "BTC/USDT", last: 100.944 }) }
  ]
  return {
    ...actual,
    getCredentials: vi.fn(async () => ({
      expertoptionToken: "",
      ccxtExchanges: [
        { id: "exA", exchange: exchanges[0], symbol: "BTCUSDT" },
        { id: "exB", exchange: exchanges[1], symbol: "BTCUSDT" }
      ]
    }))
  }
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

let handleApi

describe("Trading spread route — round2 rounding", () => {
  beforeAll(async () => {
    // Keep payment env inert for this route.
    env.stripeSecretKey = env.stripeWebhookSecret = env.stripePricePro = env.stripePriceBusiness = ""
    vi.resetModules()
    ;({ handleApi } = await import("../handlers.mjs"))
  })

  afterAll(() => {
    vi.resetModules()
  })

  it("rounds buy/sell prices to 2dp (no ReferenceError) with ≥2 live quotes", async () => {
    const res = await call("POST", "/api/trading/spread", { assetId: "BTCUSD" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.venuesPolled.length).toBeGreaterThanOrEqual(2)
    // The bug: best was never reached because round2 threw -> 500. Now it must be built.
    expect(res.body.best).toBeTruthy()
    // Two venues, prices 100.055 / 100.944 round to 100.06 / 100.94.
    expect([res.body.best.buyPrice, res.body.best.sellPrice].sort((a, b) => a - b)).toEqual([100.06, 100.94])
    expect(typeof res.body.best.buyPrice).toBe("number")
    expect(typeof res.body.best.sellPrice).toBe("number")
  })

  it("round2(null) is guarded — non-finite prices don't poison the payload", async () => {
    // Direct unit check of the module-local helper via a crafted edge: the route
    // never passes a non-finite value, but the helper must tolerate one.
    const { round2 } = await import("../handlers.mjs")
    expect(round2).toBeDefined()
    expect(round2(1.234)).toBe(1.23)
    expect(round2(null)).toBeNull()
    expect(round2(Number.NaN)).toBeNull()
  })
})
