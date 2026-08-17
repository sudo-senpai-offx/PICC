import { describe, expect, it } from "vitest"
import { cascadeBar, liveSnapshot, mergeLiveCandle, normName } from "../services/liveEO.mjs"

describe("normName", () => {
  it("normalizes platform pair names", () => {
    expect(normName("EUR / USD")).toBe("eurusd")
    expect(normName("GBP / USD")).toBe("gbpusd")
    expect(normName("USD / JPY")).toBe("usdjpy")
  })

  it("strips OTC and punctuation", () => {
    expect(normName("Gold (OTC)")).toBe("gold")
    expect(normName("S&P 500 ETF")).toBe("sp500etf")
    expect(normName("BTC / USD")).toBe("btcusd")
  })

  it("handles empty input", () => {
    expect(normName("")).toBe("")
    expect(normName(null)).toBe("")
  })
})

describe("mergeLiveCandle", () => {
  it("appends a new candle and tracks prevClose", () => {
    const buf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    const prev = mergeLiveCandle(buf, { time: 100, open: 1, high: 1.02, low: 0.99, close: 1.01 })
    expect(prev).toBe(0)
    expect(buf.ohlc).toHaveLength(1)
    // a single bar has no prior bar to measure against
    expect(buf.prevClose).toBe(0)

    const prev2 = mergeLiveCandle(buf, { time: 105, open: 1.01, high: 1.03, low: 1.0, close: 1.02 })
    expect(prev2).toBe(1.01)
    expect(buf.ohlc).toHaveLength(2)
    // baseline for the last bar = close of the bar before it
    expect(buf.prevClose).toBe(1.01)
  })

  it("replaces an in-progress bar with the same timestamp", () => {
    const buf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    mergeLiveCandle(buf, { time: 100, open: 1, high: 1.02, low: 0.99, close: 1.01 })
    mergeLiveCandle(buf, { time: 100, open: 1, high: 1.05, low: 0.98, close: 1.04 })
    expect(buf.ohlc).toHaveLength(1)
    expect(buf.ohlc[0]).toEqual({ time: 100, open: 1, high: 1.05, low: 0.98, close: 1.04 })
  })

  it("ignores out-of-order timestamps", () => {
    const buf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    mergeLiveCandle(buf, { time: 200, open: 5, high: 5.1, low: 4.9, close: 5.05 })
    mergeLiveCandle(buf, { time: 100, open: 1, high: 1, low: 1, close: 1 })
    expect(buf.ohlc).toHaveLength(1)
  })

  it("caps the buffer length", () => {
    const buf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    for (let t = 0; t < 500; t++) {
      mergeLiveCandle(buf, { time: t, open: t, high: t, low: t, close: t })
    }
    expect(buf.ohlc.length).toBe(400)
    expect(buf.ohlc[0].time).toBe(100)
  })
})

describe("cascadeBar (5s bars folded into higher timeframes)", () => {
  it("opens a new bucket bar and keeps prevClose", () => {
    const pbuf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    cascadeBar(pbuf, 300, 10, 12, 9, 11)
    expect(pbuf.ohlc).toHaveLength(1)
    expect(pbuf.ohlc[0]).toEqual({ time: 300, open: 10, high: 12, low: 9, close: 11 })
    expect(pbuf.prevClose).toBe(10)
  })

  it("updates the current bucket bar live", () => {
    const pbuf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    cascadeBar(pbuf, 300, 10, 12, 9, 11)
    cascadeBar(pbuf, 300, 11, 13, 10, 12)
    expect(pbuf.ohlc).toHaveLength(1)
    expect(pbuf.ohlc[0].high).toBe(13)
    expect(pbuf.ohlc[0].low).toBe(9)
    expect(pbuf.ohlc[0].close).toBe(12)
  })

  it("opens a new bar when the bucket advances", () => {
    const pbuf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    cascadeBar(pbuf, 300, 10, 12, 9, 11)
    cascadeBar(pbuf, 600, 11, 11, 10, 10.5)
    expect(pbuf.ohlc).toHaveLength(2)
    expect(pbuf.ohlc[1].time).toBe(600)
    expect(pbuf.prevClose).toBe(11)
  })

  it("aggregates 12 five-second bars into one minute bucket (bucket-aligned start)", () => {
    const pbuf = { ohlc: [], prevClose: 0, tickedAt: 0 }
    for (let i = 0; i < 12; i++) {
      const t = 960 + i * 5
      cascadeBar(pbuf, Math.floor(t / 60) * 60, 100 + i, 100 + i + 1, 99 + i, 100 + i + 0.5)
    }
    expect(pbuf.ohlc).toHaveLength(1)
    expect(pbuf.ohlc[0].time).toBe(960)
    expect(pbuf.ohlc[0].open).toBe(100)
    expect(pbuf.ohlc[0].high).toBe(112)
    expect(pbuf.ohlc[0].low).toBe(99)
    expect(pbuf.ohlc[0].close).toBe(111.5)
  })
})

describe("liveSnapshot", () => {
  it("reports idle before a session starts", () => {
    const snap = liveSnapshot()
    expect(snap.status).toBe("idle")
    expect(snap.mode).toBe("demo")
  })
})
