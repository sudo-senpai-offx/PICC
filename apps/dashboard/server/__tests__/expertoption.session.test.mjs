import { describe, expect, it, afterEach } from "vitest"
import { connectSession, connectTradingSession, candlesFrom } from "../services/expertoption.mjs"
import { createMockExpertOptionServer } from "./helpers/mockExpertOption.mjs"

const servers = []
afterEach(async () => {
  while (servers.length) await servers.pop().stop()
})

async function startMock(opts) {
  const s = createMockExpertOptionServer(opts)
  await s.start()
  servers.push(s)
  return s
}

async function waitFor(fn, timeoutMs = 3000, intervalMs = 25) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error("condition not met in time")
}

describe("connectSession (read-only)", () => {
  it("connects, reads balance, assets and candles", async () => {
    const mock = await startMock()
    const session = await connectSession({ token: "tok-read", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      const balance = await session.balance()
      expect(balance).toMatchObject({ balance: 10000, currency: "USD", demo: true })

      const payload = await session.assets()
      expect(payload.assets).toHaveLength(2)
      expect(payload.assets[0]).toMatchObject({ id: 142, name: "EUR/USD" })

      const candles = await session.candles("EURUSD", 60, 30)
      const { closes, count } = candlesFrom(candles)
      expect(count).toBeGreaterThanOrEqual(30)
      expect(closes.every((c) => Number.isFinite(c) && c > 0)).toBe(true)
    } finally {
      session.close()
    }
  })

  it("resolves a symbol through the live asset list", async () => {
    const mock = await startMock()
    const session = await connectSession({ token: "tok-read", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      // BTCUSD is not in STATIC_ASSETS-served list here but is in the live assets payload
      const candles = await session.candles("BTC/USD", 60, 5)
      expect(candlesFrom(candles).count).toBeGreaterThanOrEqual(5)
    } finally {
      session.close()
    }
  })

  it("rejects when the server rejects the token", async () => {
    const mock = await startMock({ rejectToken: true })
    await expect(
      connectSession({ token: "bad-token", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 3000 })
    ).rejects.toThrow(/INCORRECT_TOKEN/)
  })

  it("flips to the real context when the demo context is rejected (CONTEXT_ONLY_FOR_REAL_USER)", async () => {
    const mock = await startMock({ contextRejectDemo: true })
    const session = await connectSession({ token: "tok-real", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      // First setContext asked for the demo context (is_demo: 1) and was refused;
      // the client retried once with the real context (is_demo: 0) and it landed.
      const contexts = mock.received.filter((m) => m.action === "setContext").map((m) => m.message?.is_demo)
      expect(contexts).toEqual([1, 0])
      expect(session.isDemo).toBe(false)
      const balance = await session.balance()
      expect(balance).toMatchObject({ balance: 20000, currency: "USD", demo: false })
    } finally {
      session.close()
    }
  })

  it("streams live candles via subscribeCandles / onCandles", async () => {
    const mock = await startMock()
    const session = await connectSession({ token: "tok-read", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      const frames = []
      const off = session.onCandles((c) => frames.push(c))

      const sub = await session.subscribeCandles("EURUSD", 60)
      expect(sub).toMatchObject({ assetId: 142, period: 60 })
      await waitFor(() => mock.activeCandleSubs.has(142))

      mock.pushCandles(142, 60, [{ t: 1700000000, v: [1.2, 1.21, 1.19, 1.205] }])
      await waitFor(() => frames.length === 1)

      expect(frames[0]).toMatchObject({ assetId: "142", timeframe: 60 })
      expect(frames[0].candles[0]).toMatchObject({ time: 1700000000, open: 1.2, high: 1.21, low: 1.19, close: 1.205, timeframe: 60 })

      off()
      const before = frames.length
      mock.pushCandles(142, 60)
      await new Promise((r) => setTimeout(r, 60))
      expect(frames.length).toBe(before)

      await session.unsubscribeCandles("EURUSD")
      await waitFor(() => mock.received.some((m) => m.action === "unsubscribeCandles"))
    } finally {
      session.close()
    }
  })


  it("fails cleanly when the endpoint is unreachable", async () => {
    await expect(
      connectSession({ token: "tok", isDemo: true, wsUrl: "ws://127.0.0.1:1", regionUrls: [], timeoutMs: 1500 })
    ).rejects.toThrow()
  })
})

describe("connectTradingSession (demo)", () => {
  it("refuses live (non-demo) accounts before connecting", async () => {
    await expect(
      connectTradingSession({ token: "tok", isDemo: false, wsUrl: "ws://127.0.0.1:1", regionUrls: [], timeoutMs: 1500 })
    ).rejects.toThrow(/live trading is disabled/)
  })

  it("buys, tracks open deals, settles them and emits events", async () => {
    const mock = await startMock({ win: true, payout: 85, settlementDelayMs: 150 })
    const session = await connectTradingSession({ token: "tok-demo", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      const events = []
      const off = session.onDeal((kind, deal) => events.push({ kind, deal }))

      expect(session.isDemo).toBe(true)
      const balance = await session.balance()
      expect(balance.balance).toBe(10000)

      const deal = await session.buy({ assetId: "EURUSD", type: "call", amount: 10, duration: 60 })
      expect(deal.serverId).toBe("deal-1")
      expect(deal.assetId).toBe("142")
      expect(deal.type).toBe("call")
      expect(deal.amount).toBe(10)
      expect(deal.payout).toBe(85)

      // the wire payload used the reference protocol shape
      const buyFrame = mock.received.find((m) => m.action === "buyOption")
      expect(buyFrame.message).toMatchObject({ type: "call", amount: 10, assetid: 142, is_demo: 1 })
      expect(Number.isInteger(buyFrame.message.expiration_shift)).toBe(true)
      expect(buyFrame.message.strike_time).toBeGreaterThan(0)

      expect(session.deals()).toHaveLength(1)
      expect(session.livePrice("deal-1")).toBeNull()

      await waitFor(() => session.settled().length === 1)
      const settled = session.settled()[0]
      expect(settled.result).toBe("win")
      expect(settled.profit).toBe(8.5) // 10 * 85% paid as win_amount - amount
      expect(settled.status).toBe("closed")
      expect(session.deals()).toHaveLength(0)

      const kinds = events.map((e) => e.kind)
      expect(kinds).toContain("opened")
      expect(kinds).toContain("settled")
      const opened = events.find((e) => e.kind === "opened").deal
      expect(opened.serverId).toBe("deal-1")

      off()
    } finally {
      session.close()
    }
  })

  it("settles losses and corrects the profit sign", async () => {
    const mock = await startMock({ win: false, payout: 85, settlementDelayMs: 120 })
    const session = await connectTradingSession({ token: "tok-demo", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      await session.buy({ assetId: "EURUSD", type: "put", amount: 25 })
      await waitFor(() => session.settled().length === 1)
      const settled = session.settled()[0]
      expect(settled.result).toBe("loss")
      expect(settled.profit).toBe(-25)
    } finally {
      session.close()
    }
  })

  it("validates amounts and unknown assets", async () => {
    const mock = await startMock()
    const session = await connectTradingSession({ token: "tok-demo", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      await expect(session.buy({ assetId: "EURUSD", type: "call", amount: 0.5 })).rejects.toThrow(/minimum/)
      await expect(session.buy({ assetId: "NOT_A_REAL_SYMBOL", type: "call", amount: 10 })).rejects.toThrow(/unknown/)
      await expect(session.buy({ assetId: "EURUSD", type: "call", amount: 10, duration: 2 })).rejects.toThrow(/duration/)
    } finally {
      session.close()
    }
  })

  it("streams live candles on a trading session", async () => {
    const mock = await startMock()
    const session = await connectTradingSession({ token: "tok-demo", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
    try {
      const frames = []
      session.onCandles((c) => frames.push(c))
      await session.subscribeCandles("EURUSD", 60)
      mock.pushCandles(142, 60, [{ t: 1700000060, v: [1.3, 1.31, 1.29, 1.305] }])
      await waitFor(() => frames.length === 1)
      expect(frames[0].candles[0].close).toBe(1.305)
    } finally {
      session.close()
    }
  })
})

