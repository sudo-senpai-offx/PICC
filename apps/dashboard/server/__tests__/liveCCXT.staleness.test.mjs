import { beforeEach, describe, expect, test } from "vitest"
import {
  recordCandles,
  resetCCXTData,
  liveCCXTData,
  ccxtStatus,
  ccxtFeedStatus,
  CCXT_STALE_MS
} from "../services/liveCCXT.mjs"

const now = 1_800_000_000_000

function candleRow(close, i) {
  return { time: Math.floor(now / 1000) - 60 * (50 - i), open: close - 0.1, high: close + 0.2, low: close - 0.2, close }
}

function seedFreshBuffers() {
  const closes = []
  for (let i = 0; i < 40; i++) closes.push(100 + i * 0.1)
  const candles = closes.map((c, i) => candleRow(c, i))
  return recordCandles({ exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", candles })
}

beforeEach(() => {
  resetCCXTData()
})

describe("liveCCXT liveness status (audit §5.3 — no false 'connected')", () => {
  test("empty buffers report idle", () => {
    expect(liveCCXTData().status).toBe("idle")
    expect(ccxtStatus()).toBe("idle")
  })

  test("freshly written buffers report connected", () => {
    seedFreshBuffers()
    expect(liveCCXTData().status).toBe("connected")
    expect(liveCCXTData().assets).toHaveLength(1)
  })

  test("buffers idle past the staleness window report stale, not connected", () => {
    seedFreshBuffers()
    // Real elapsed time is ~0, so simulate by asking for a later snapshot.
    const stale = liveCCXTData({ now: now + CCXT_STALE_MS + 1000 })
    expect(stale.status).toBe("stale")
    expect(stale.assets).toHaveLength(1) // data remains readable — only the claim is honest
  })

  test("ccxtFeedStatus is a pure liveness gate", () => {
    expect(ccxtFeedStatus({ hasAssets: false, maxUpdatedAt: now })).toBe("idle")
    expect(ccxtFeedStatus({ hasAssets: true, maxUpdatedAt: now, now: now + 1000 })).toBe("connected")
    expect(ccxtFeedStatus({ hasAssets: true, maxUpdatedAt: now, now: now + CCXT_STALE_MS - 1 })).toBe("connected")
    expect(ccxtFeedStatus({ hasAssets: true, maxUpdatedAt: now, now: now + CCXT_STALE_MS })).toBe("stale") // at the boundary → stale (strict <)
    expect(ccxtFeedStatus({ hasAssets: true, maxUpdatedAt: 0, now })).toBe("stale")
  })
})
