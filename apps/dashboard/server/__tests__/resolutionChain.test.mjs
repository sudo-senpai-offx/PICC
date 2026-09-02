// T5 — Resolution honesty chain.
//
// A requested timeframe may not be exactly servable: a 5s request against an
// EO-style source must come back as honest 1m bars TAGGED 60 (never "5s"),
// and a 4h request against a 1h-capped source must be DECLINED (null → next
// broker or source:"none") — never silently relabeled. These tests pin the
// broker contract default, the bus tag, and the /api/trading/candles response.

import { afterEach, describe, expect, it } from "vitest"
import { handleApi } from "../handlers.mjs"
import { getBestCandles, listAvailableSources } from "../services/marketDataBus.mjs"
import { registerBroker, unregisterBroker, resolveTimeframeFor } from "../services/brokers/index.mjs"
import { stopLiveEO } from "../services/liveEO.mjs"

function makeReq(method, url, body) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json" },
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
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}

async function call(method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}

function synthCandles(n, base = 100) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 60,
    open: base + i * 0.1,
    high: base + i * 0.1 + 0.5,
    low: base + i * 0.1 - 0.5,
    close: base + i * 0.1
  }))
}

const testBrokerSlugs = []
function registerTestBroker(adapter) {
  testBrokerSlugs.push(adapter.slug)
  try {
    registerBroker(adapter)
  } catch { /* already registered */ }
}

afterEach(async () => {
  for (const slug of testBrokerSlugs) unregisterBroker(slug)
  testBrokerSlugs.length = 0
  await stopLiveEO()
})

describe("resolveTimeframeFor (broker contract default)", () => {
  it("rounds an in-range request UP to the nearest available bar", () => {
    expect(resolveTimeframeFor(5, [60, 300, 900, 3600])).toBe(60)
    expect(resolveTimeframeFor(180, [60, 300, 900, 3600])).toBe(300)
    expect(resolveTimeframeFor(300, [60, 300, 900, 3600])).toBe(300)
  })

  it("rounds a below-range request UP to the smallest available bar", () => {
    expect(resolveTimeframeFor(1, [60, 300, 900, 3600])).toBe(60)
    expect(resolveTimeframeFor(14400, [86400, 604800, 2592000])).toBe(86400)
  })

  it("DECLINES an above-range request with null — never relabels coarser bars", () => {
    expect(resolveTimeframeFor(14400, [60, 300, 900, 3600])).toBeNull()
    expect(resolveTimeframeFor(2592000, [60, 300, 900, 3600])).toBeNull()
  })

  it("treats a missing/garbage timeframe as the smallest available", () => {
    expect(resolveTimeframeFor(undefined, [60, 300, 900, 3600])).toBe(60)
    expect(resolveTimeframeFor("banana", [60, 300, 900, 3600])).toBe(60)
  })
})

describe("market data bus resolution tags", () => {
  it("serves EO-style bars for a 5s request and TAGS them 60 with resolved:true", async () => {
    registerTestBroker({
      slug: "tf-eo-curve",
      label: "TF EO curve",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 900, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    const out = await getBestCandles("BTCUSD", { timeframe: 5, count: 50 })
    expect(out.source).toBe("tf-eo-curve")
    expect(out.timeframe).toBe(60) // SERVED resolution, not the request
    expect(out.resolved).toBe(true)
    expect(out.candles.length).toBe(50)
  })

  it("DECLINES a 4h request against a 1h-capped broker — source none, not relabeled", async () => {
    registerTestBroker({
      slug: "tf-eo-only",
      label: "TF EO only",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 900, 3600],
      getCandles: () => synthCandles(120) // would serve ANY timeframe if asked
    })
    const out = await getBestCandles("BTCUSD", { timeframe: 14400, count: 50 })
    // The broker was never even asked: resolving 14400 → null skipped it.
    expect(out.source).toBe("none")
    expect(out.candles).toEqual([])
    expect(out.timeframe).toBe(14400) // requested — nothing was served
    expect(out.resolved).toBe(false)
  })

  it("tags honest 1h bars TAGGED 3600 when a broker resolves its cap down for 4h", async () => {
    registerTestBroker({
      slug: "tf-cap-resolver",
      label: "TF cap resolver",
      weight: 100,
      isAlive: () => true,
      // Broker-specific override: requests above its 1h cap are served from
      // the 1h buffer (a deliberate resolution strategy — accepted because
      // the SERVED timeframe is still tagged truthfully).
      resolveTimeframe: (tf) => (tf >= 14400 ? 3600 : tf <= 5 ? 60 : tf),
      getCandles: (id, opts) => (opts?.timeframe === 3600 ? synthCandles(80) : [])
    })
    const out = await getBestCandles("BTCUSD", { timeframe: 14400, count: 40 })
    expect(out.source).toBe("tf-cap-resolver")
    expect(out.timeframe).toBe(3600) // honest 1h bars, tagged 3600
    expect(out.resolved).toBe(true)
    expect(out.candles.length).toBe(40)
  })

  it("default contract is identity for a full-range broker (no behavior change)", async () => {
    registerTestBroker({
      slug: "tf-full-range",
      label: "TF full range",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    const out = await getBestCandles("BTCUSD", { timeframe: 60, count: 50 })
    expect(out.timeframe).toBe(60)
    expect(out.resolved).toBe(false)
    expect(out.source).toBe("tf-full-range")
  })
})

describe("POST /api/trading/candles resolution response", () => {
  it("exposes requestedTimeframe + served timeframe + resolved flag (R1 acceptance)", async () => {
    registerTestBroker({
      slug: "tf-endpoint-eo",
      label: "TF endpoint EO",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 900, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    const res = await call("POST", "/api/trading/candles", { assetId: "BTCUSD", timeframe: 5, count: 50 })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.source).toBe("tf-endpoint-eo")
    expect(res.body.timeframe).toBe(60) // served — the honest tag
    expect(res.body.requestedTimeframe).toBe(5) // what the client asked
    expect(res.body.resolved).toBe(true) // warning path for the UI
    expect(res.body.candles.length).toBe(50)
  })

  it("relaxes the clamp so a 4h request is not force-shifted before resolution", async () => {
    registerTestBroker({
      slug: "tf-endpoint-eo-only",
      label: "TF endpoint EO only",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 900, 3600],
      getCandles: () => synthCandles(120)
    })
    const res = await call("POST", "/api/trading/candles", { assetId: "BTCUSD", timeframe: 14400, count: 50 })
    expect(res.status).toBe(200)
    // Not force-clamped to 3600 server-side: the broker was asked about 14400,
    // declined (above its 1h cap), and nothing was served.
    expect(res.body.timeframe).toBe(14400)
    expect(res.body.resolved).toBe(false)
    expect(res.body.source).toBe("none")
    expect(res.body.candles).toEqual([])
  })
})

// T6 — Source dropdown: getBestCandles source override + listAvailableSources +
// /api/trading/candles additive availableSources response.
describe("T6 source override (getBestCandles)", () => {
  it("fetches from the named broker ONLY when source is a valid slug", async () => {
    registerTestBroker({
      slug: "t6-pinned",
      label: "T6 Pinned",
      weight: 50,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    registerTestBroker({
      slug: "t6-other",
      label: "T6 Other",
      weight: 100, // higher weight — would win in auto mode
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    // Without pin: t6-other wins (higher weight, more bars)
    const auto = await getBestCandles("EURUSD", { timeframe: 60, count: 50 })
    expect(auto.source).toBe("t6-other")
    // With pin: t6-pinned is fetched (lower weight, fewer bars — but user asked)
    const pinned = await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "t6-pinned" })
    expect(pinned.source).toBe("t6-pinned")
    expect(pinned.stale).toBe(false)
  })

  it("declines (honest emptiness) when the pinned source can't serve the resolution", async () => {
    registerTestBroker({
      slug: "t6-1h-only",
      label: "T6 1h only",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 900, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 14400, count: 50, source: "t6-1h-only" })
    // Above its 1h cap — resolveTimeframe returns null — honest emptiness.
    expect(out.source).toBe("t6-1h-only")
    expect(out.candles).toEqual([])
    expect(out.stale).toBe(true)
  })

  it("falls back to auto fan-in for an unknown source slug", async () => {
    registerTestBroker({
      slug: "t6-auto-fallback",
      label: "T6 auto fallback",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "bogus-source" })
    expect(out.source).toBe("t6-auto-fallback")
  })

  it("source:'auto' behaves identically to omitting source (no regression)", async () => {
    registerTestBroker({
      slug: "t6-auto-exact",
      label: "T6 auto exact",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    const out = await getBestCandles("EURUSD", { timeframe: 60, count: 50, source: "auto" })
    expect(out.source).toBe("t6-auto-exact")
  })
})

describe("T6 listAvailableSources", () => {
  it("returns registered brokers with serves:true when their curve covers the resolution", async () => {
    registerTestBroker({
      slug: "t6-src-full",
      label: "T6 Full",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600]
    })
    registerTestBroker({
      slug: "t6-src-1h",
      label: "T6 1h cap",
      weight: 50,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 900, 3600]
    })
    registerTestBroker({
      slug: "paper",
      label: "Paper",
      weight: 10,
      isAlive: () => true,
      availableTimeframes: () => [60, 300]
    })
    const sources = await listAvailableSources("EURUSD", { timeframe: 60 })
    // Paper excluded
    expect(sources.find((s) => s.slug === "paper")).toBeUndefined()
    // Both non-paper sources can serve 60s
    const full = sources.find((s) => s.slug === "t6-src-full")
    const capped = sources.find((s) => s.slug === "t6-src-1h")
    expect(full).toBeDefined()
    expect(full.serves).toBe(true)
    expect(capped).toBeDefined()
    expect(capped.serves).toBe(true)
    // Order by weight DESC (100 > 50)
    expect(sources[0].slug).toBe("t6-src-full")
  })

  it("marks serves:false when the resolution is above a source's cap", async () => {
    registerTestBroker({
      slug: "t6-src-capped",
      label: "T6 capped",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 900, 3600]
    })
    const sources = await listAvailableSources("EURUSD", { timeframe: 14400 })
    const src = sources.find((s) => s.slug === "t6-src-capped")
    expect(src).toBeDefined()
    expect(src.serves).toBe(false)
  })

  it("returns an empty array when no brokers are registered", async () => {
    const sources = await listAvailableSources("EURUSD", { timeframe: 60 })
    expect(sources).toEqual([])
  })
})

describe("POST /api/trading/candles T6 source override", () => {
  it("accepts source in request body and passes it through to getBestCandles", async () => {
    registerTestBroker({
      slug: "t6-ep-pinned",
      label: "T6 EP pinned",
      weight: 50,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    registerTestBroker({
      slug: "t6-ep-other",
      label: "T6 EP other",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(120) : [])
    })
    const res = await call("POST", "/api/trading/candles", {
      assetId: "EURUSD",
      timeframe: 60,
      count: 50,
      source: "t6-ep-pinned"
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.source).toBe("t6-ep-pinned")
  })

  it("returns availableSources (additive) in the response", async () => {
    registerTestBroker({
      slug: "t6-ep-a",
      label: "T6 EP A",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    const res = await call("POST", "/api/trading/candles", {
      assetId: "EURUSD",
      timeframe: 60,
      count: 50
    })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.availableSources)).toBe(true)
    const a = res.body.availableSources.find((s) => s.slug === "t6-ep-a")
    expect(a).toBeDefined()
    expect(a.serves).toBe(true)
    expect(a.label).toBe("T6 EP A")
  })

  it("defaults source to 'auto' when omitted (backward compat)", async () => {
    registerTestBroker({
      slug: "t6-ep-default",
      label: "T6 EP default",
      weight: 100,
      isAlive: () => true,
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(80) : [])
    })
    const res = await call("POST", "/api/trading/candles", {
      assetId: "EURUSD",
      timeframe: 60,
      count: 50
    })
    expect(res.body.source).toBe("t6-ep-default")
  })
})