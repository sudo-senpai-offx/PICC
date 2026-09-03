import { describe, expect, it, vi } from "vitest"
import { canonicalIndicatorTimeframe, handleApi } from "../handlers.mjs"

// A4 (ledger F5): /api/trading/indicators must 400 on timeframes it cannot
// serve honestly instead of silently falling through to a Yahoo DAILY
// series. The whitelist vocabulary = liveEO watch-period buffers (seconds
// keys or short labels) + the daily family. Everything else is a hard 400.

// Deterministic Yahoo stand-in so the accept-path never touches the network:
// no liveEO buffers exist in the test env, so any valid timeframe falls back
// through this stub and must still 200 with real candle data.
vi.mock("../services/yahoo.mjs", () => ({
  async getHistory() {
    const closes = []
    const opens = []
    const highs = []
    const lows = []
    const volumes = []
    const dates = []
    let prev = 100
    const t0 = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 80; i++) {
      const close = prev + 0.4 + (i % 3) * 0.1
      opens.push(prev)
      highs.push(Math.max(prev, close) + 0.5)
      lows.push(Math.min(prev, close) - 0.5)
      closes.push(close)
      volumes.push(1000 + i)
      dates.push(t0 + i * 86_400_000)
      prev = close
    }
    return { dates, opens, highs, lows, closes, volumes }
  },
  async getQuote() {
    return null
  },
  normalizeYahooSymbol: (s) => s,
  statsFromHistory: () => ({ returns: [], vol: 0 }),
  downsample: (d, c) => ({ dates: d, closes: c }),
  clampDrift: (d) => d,
  clampVol: (v) => v,
  _clearCache: () => {}
}))


vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests") }))

function makeReq(method, url) {
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json" },
    socket: { remoteAddress: "127.0.0.1" },
    on(evt, cb) {
      // handleApi always awaits readBody, which needs the end event.
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

async function callIndicators(timeframeParam) {
  const qs = timeframeParam == null ? "" : `&timeframe=${encodeURIComponent(timeframeParam)}`
  const res = makeRes()
  await handleApi(makeReq("GET", `/api/trading/indicators?assetId=EURUSD${qs}`), res, `/api/trading/indicators?assetId=EURUSD${qs}`)
  return res
}

describe("canonicalIndicatorTimeframe (whitelist unit)", () => {
  it("accepts the daily family and canonicalizes it to daily", () => {
    expect(canonicalIndicatorTimeframe("daily")).toBe("daily")
    expect(canonicalIndicatorTimeframe("1d")).toBe("daily")
    expect(canonicalIndicatorTimeframe("86400")).toBe("daily")
  })

  it("accepts liveEO watch-period keys and short labels", () => {
    expect(canonicalIndicatorTimeframe("60")).toBe("60")
    expect(canonicalIndicatorTimeframe("300")).toBe("300")
    expect(canonicalIndicatorTimeframe("900")).toBe("900")
    expect(canonicalIndicatorTimeframe("3600")).toBe("3600")
    expect(canonicalIndicatorTimeframe("1m")).toBe("60")
    expect(canonicalIndicatorTimeframe("5m")).toBe("300")
    expect(canonicalIndicatorTimeframe("15m")).toBe("900")
    expect(canonicalIndicatorTimeframe("1h")).toBe("3600")
  })

  it("rejects every key with no honest serving path", () => {
    for (const bogus of ["4h", "30m", "1wk", "1mo", "monthly", "7h", "bogus", "0", "14400", "60s", "5M"]) {
      expect(canonicalIndicatorTimeframe(bogus), bogus).toBeNull()
    }
  })
})

describe("GET /api/trading/indicators timeframe validation (A4)", () => {
  it("400s unknown and unservable timeframes before touching any data path", async () => {
    for (const bogus of ["4h", "30m", "1wk", "7h", "bogus"]) {
      const res = await callIndicators(bogus)
      expect(res.status, bogus).toBe(400)
      expect(res.body?.error, bogus).toBe("unsupported timeframe")
    }
  })

  it("still serves every whitelisted timeframe (daily family)", async () => {
    for (const tf of ["daily", "1d", "86400"]) {
      const res = await callIndicators(tf)
      expect(res.status, tf).toBe(200)
      expect(res.body?.ok, tf).toBe(true)
      expect(Number.isFinite(Number(res.body?.last)), tf).toBe(true)
    }
  })

  it("still serves every whitelisted liveEO watch-period key and label", async () => {
    for (const [tf, canonical] of [["60", "60"], ["300", "300"], ["900", "900"], ["3600", "3600"], ["1m", "60"], ["5m", "300"], ["15m", "900"], ["1h", "3600"]]) {
      const res = await callIndicators(tf)
      expect(res.status, tf).toBe(200)
      expect(res.body?.ok, tf).toBe(true)
      expect(res.body?.timeframe, tf).toBe(canonical)
    }
  })

  it("defaults to daily when the param is absent", async () => {
    const res = await callIndicators(null)
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.timeframe).toBe("daily")
  })
})
