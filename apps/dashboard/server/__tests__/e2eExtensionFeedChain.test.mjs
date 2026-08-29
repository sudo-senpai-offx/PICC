// T11 — Extension-feed chain E2E (machine-verified leg).
//
// The spec's T11 acceptance is a Part-B-style manual runbook (reload /
// disable / enable cycles in a real Chrome, broker-tab drag, UI feed-mode
// flips). Those rows need a human at a real browser and are marked UNVERIFIED
// in docs/T11_E2E_MANUAL_LOG.md. This file covers every leg that CAN be
// verified headlessly, through the REAL HTTP chain — ingest endpoint →
// liveEO buffers → real ExpertOption broker adapter → candles endpoint — so
// the manual log's machine rows can just cite the numbers this suite produces.
//
// Chart-correctness contract pinned here:
//  - a tf:5 push (300s bar spacing) cascades into 1m/5m/15m/1h buckets via
//    floor(t/period) * period;
//  - a single bar per bucket is served verbatim (open/close = that bar;
//    high = max lhs, low = min lhs — equal for a lone bar);
//  - every served bar is TAGGED with the SERVED timeframe and resolved:false
//    when the request matched exactly (T5 honesty rules — never relabel);
//  - feed-mode PREFERENCE is honored through the chain (POST
//    /api/trading/feed-mode) while the preferred leg is alive: dropped frames
//    count as seen, not accepted (T4 fallback semantics).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handleApi } from "../handlers.mjs"
import { listBrokers, unregisterBroker } from "../services/brokers/index.mjs"
import { ingestStudioFrame, liveEOStats, setFeedMode, stopLiveEO } from "../services/liveEO.mjs"

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
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}

async function call(method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

/** A 5-second ExpertOption push bar for a given assetId. */
function pushFrame(assetId, t, v) {
  return { action: "candles", message: { assetId, name: "EURUSD", candles: [{ t, tf: 5, v }] } }
}

/** Deterministic OHLC: monotonically walking prices, tight range. */
function vFor(i) {
  const base = 1.08 + i * 0.0001
  return [base, base + 0.0002, base - 0.0002, base + 0.0001]
}

describe("T11 machine-verified chain: ingest → EO adapter → candles endpoint", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))))
    // Isolate the registry to the REAL ExpertOption adapter (registered by the
    // module import below) so no other source can win the bus fan-in.
    for (const b of listBrokers()) {
      if (b.slug !== "expertoption") unregisterBroker(b.slug)
    }
    await import("../services/brokers/expertoption.mjs")
    await stopLiveEO()
    setFeedMode("auto")
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await stopLiveEO()
    setFeedMode("auto")
  })

  it("serves chart-correct bars at 1m/5m/15m/1h from one extension feed (Part-B cross-check leg)", async () => {
    // Nominate the extension leg through the REAL preference endpoint.
    const pref = await call("POST", "/api/trading/feed-mode", { feedMode: "extension" })
    expect(pref.status).toBe(200)
    expect(pref.body.feedMode).toBe("extension")

    // 360 tf:5 bars, 300s apart, epoch-aligned first bar → exactly 360 1m/5m
    // buckets, 120 15m buckets, 30 1h buckets. Each bucket gets ONE bar, so
    // every served candle must equal that bar verbatim.
    const T0 = Math.floor(Date.now() / 1000 / 3600) * 3600 // multiple of all four periods
    const frames = Array.from({ length: 360 }, (_, i) => pushFrame("EURUSD", T0 + i * 300, vFor(i)))

    // The ingest endpoint caps batches at 200 frames (the extension's real
    // batching contract) — mirror the extension and send two batches.
    for (const chunk of [frames.slice(0, 180), frames.slice(180)]) {
      const ingest = await call("POST", "/api/extension/ingest", { frames: chunk })
      expect(ingest.status).toBe(200)
      expect(ingest.body.accepted).toBe(180) // gate accepted every frame
      expect(ingest.body.received).toBe(180)
    }

    for (const tf of [60, 300, 900, 3600]) {
      const res = await call("POST", "/api/trading/candles", { assetId: "EURUSD", timeframe: tf, count: 360 })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.source).toBe("expertoption") // real adapter, not a stub
      expect(res.body.feed).toBe("extension") // the consumed leg is tagged, not guessed
      expect(res.body.requestedTimeframe).toBe(tf)
      expect(res.body.timeframe).toBe(tf) // exact match — no resolution rounding
      expect(res.body.resolved).toBe(false) // honest tag: served == requested
      expect(res.body.stale).toBe(false) // ≥30 bars buffered — full-strength serve

      // Occupied bucket count: a 300s push cadence lands one bar in each 1m/5m
      // bucket, every 3rd 5s bar in a 15m bucket, every 12th in a 1h bucket.
      const expected = tf >= 300 ? (360 * 300) / tf : 360
      expect(res.body.candles.length).toBe(expected)

      const times = res.body.candles.map((c) => c.time)
      expect(times).toEqual([...times].sort((a, b) => a - b)) // ascending — charts need this

      // Aggregation semantics of cascadeBar: a multi-bar bucket OPENS with the
      // first bar (open), folds high=max / low=min / close=last. A lone-bar
      // bucket (1m/5m cadence) is the degenerate case where all four collapse
      // to that bar.
      const step = tf <= 300 ? 1 : tf / 300 // 5s bars per occupied bucket
      for (let j = 0; j < expected; j++) {
        const firstIdx = j * step
        const lastIdx = firstIdx + step - 1 // LAST 5s bar in the bucket
        const vFirst = vFor(firstIdx)
        const vLast = vFor(lastIdx)
        const c = res.body.candles[j]
        expect(c.time).toBe(Math.floor((T0 + lastIdx * 300) / tf) * tf) // bucket-aligned
        expect(c.open).toBe(vFirst[0])
        expect(c.high).toBe(Math.max(...Array.from({ length: step }, (_, k) => vFor(firstIdx + k)[1])))
        expect(c.low).toBe(Math.min(...Array.from({ length: step }, (_, k) => vFor(firstIdx + k)[2])))
        expect(c.close).toBe(vLast[3])
      }
    }
  })

  it("honors the feed-mode preference through the chain in both directions", async () => {
    const asset = "777"

    // 1. Preference extension → the extension frame is consumed; studio frame dropped.
    await call("POST", "/api/trading/feed-mode", { feedMode: "extension" })
    const f1 = await call("POST", "/api/extension/ingest", { frames: [pushFrame(asset, 1000, vFor(0))] })
    expect(f1.body.accepted).toBe(1)
    let candles = await call("POST", "/api/trading/candles", { assetId: asset, timeframe: 60, count: 20 })
    expect(candles.body.candles.at(-1).close).toBe(vFor(0)[3])

    // 2. Flip to studio → studio frame consumed (living leg honored).
    await call("POST", "/api/trading/feed-mode", { feedMode: "studio" })
    expect(ingestStudioFrame(pushFrame(asset, 1300, vFor(1)))).toBe(true)
    candles = await call("POST", "/api/trading/candles", { assetId: asset, timeframe: 60, count: 20 })
    expect(candles.body.candles.at(-1).close).toBe(vFor(1)[3])
    expect(candles.body.feed).toBe("studio") // headless studio leg served it

    // 3. Extension frame while studio is preferred+alive → seen, NOT consumed.
    const dropped = await call("POST", "/api/extension/ingest", { frames: [pushFrame(asset, 1600, vFor(2))] })
    expect(dropped.body.accepted).toBe(0)
    expect(liveEOStats().legs.extension.lastAt).toBeGreaterThan(0) // still counted as seeing frames
    candles = await call("POST", "/api/trading/candles", { assetId: asset, timeframe: 60, count: 20 })
    expect(candles.body.candles.at(-1).close).toBe(vFor(1)[3]) // buffers untouched

    // 4. Flip back to extension → extension frame consumed again.
    await call("POST", "/api/trading/feed-mode", { feedMode: "extension" })
    const f2 = await call("POST", "/api/extension/ingest", { frames: [pushFrame(asset, 1900, vFor(3))] })
    expect(f2.body.accepted).toBe(1)
    candles = await call("POST", "/api/trading/candles", { assetId: asset, timeframe: 60, count: 20 })
    expect(candles.body.candles.at(-1).close).toBe(vFor(3)[3])

    // 5. Studio frame while extension is preferred+alive → seen, NOT consumed.
    expect(ingestStudioFrame(pushFrame(asset, 2200, vFor(4)))).toBe(false)
    candles = await call("POST", "/api/trading/candles", { assetId: asset, timeframe: 60, count: 20 })
    expect(candles.body.candles.at(-1).close).toBe(vFor(3)[3])
  })
})