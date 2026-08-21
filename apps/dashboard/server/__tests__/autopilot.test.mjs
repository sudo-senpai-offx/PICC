import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/llm.mjs", () => ({
  chatText: vi.fn(async () => "REJECT")
}))
vi.mock("../config.mjs", () => ({
  llmConfigured: vi.fn(() => false),
  env: {}
}))
vi.mock("../services/expertoption.mjs", async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, connectTradingSession: vi.fn() }
})
vi.mock("../services/prediction.mjs", async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, predictDirection: vi.fn() }
})

let tmp
let trading
let autopilot
let connectTradingSession
let predictDirection

const buy = vi.fn()
const fakeSession = {
  connected: true,
  balance: async () => ({ balance: 10000, currency: "USD", demo: true }),
  deals: () => [],
  candles: async () => ({
    candles: Array.from({ length: 100 }, (_, i) => ({ time: i, open: 100 + i, close: 101 + i, high: 102 + i, low: 99 + i }))
  }),
  buy,
  close: () => {},
  onDeal: () => () => {}
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-autopilot-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  trading = await import("../services/trading.mjs")
  autopilot = await import("../services/autopilot.mjs")
  const eo = await import("../services/expertoption.mjs")
  const pred = await import("../services/prediction.mjs")
  connectTradingSession = eo.connectTradingSession
  predictDirection = pred.predictDirection
})

beforeEach(async () => {
  buy.mockReset()
  buy.mockResolvedValue({ serverId: "deal-1", type: "call", amount: 200, status: "active" })
  connectTradingSession.mockReset()
  connectTradingSession.mockResolvedValue(fakeSession)
  predictDirection.mockReset()
  predictDirection.mockReturnValue({ direction: "up", confidence: 70, models: {}, reason: "momentum" })
  await trading._resetTradingData()
  await autopilot._resetAutopilotData()
})

afterEach(async () => {
  await autopilot._closeSession()
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("decideAutopilot (pure logic)", () => {
  const config = {
    enabled: true,
    minConfidence: 55,
    cooldownMs: 60000,
    maxConcurrent: 3,
    dailyLossLimitPct: 10
  }
  const strong = { direction: "up", confidence: 70, reason: "momentum" }

  it("approves a strong signal with a call direction", () => {
    const d = autopilot.decideAutopilot({ config, pred: strong, now: 1000000, lastEntryAt: 0 })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("call")
  })

  it("maps down signals to puts", () => {
    const d = autopilot.decideAutopilot({
      config,
      pred: { direction: "down", confidence: 80, reason: "revert" },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("put")
  })

  it("refuses when disabled or flat", () => {
    expect(autopilot.decideAutopilot({ config: { ...config, enabled: false }, pred: strong }).trade).toBe(false)
    expect(autopilot.decideAutopilot({ config, pred: { direction: "flat", confidence: 90 } }).trade).toBe(false)
    expect(autopilot.decideAutopilot({ config, pred: null }).trade).toBe(false)
  })

  it("refuses below the confidence threshold", () => {
    const d = autopilot.decideAutopilot({
      config,
      pred: { direction: "up", confidence: 50, reason: "weak" },
      now: 1000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/below/)
  })

  it("respects cooldown and max concurrent deals", () => {
    expect(
      autopilot.decideAutopilot({ config, pred: strong, now: 1000, lastEntryAt: 500 }).trade
    ).toBe(false)
    expect(
      autopilot.decideAutopilot({ config, pred: strong, now: 1000000, lastEntryAt: 0, openCount: 3 }).trade
    ).toBe(false)
  })

  it("honors the AI gate veto", () => {
    const d = autopilot.decideAutopilot({ config, pred: strong, now: 1000000, lastEntryAt: 0, aiVeto: true })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/veto/i)
  })

  it("refuses once the daily trade cap is reached (0 = unlimited)", () => {
    const d = autopilot.decideAutopilot({
      config: { ...config, maxDailyTrades: 5 },
      pred: strong,
      now: 1000000,
      lastEntryAt: 0,
      todayTrades: 5
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/cap 5 reached/)
    const under = autopilot.decideAutopilot({
      config: { ...config, maxDailyTrades: 5 },
      pred: strong,
      now: 1000000,
      lastEntryAt: 0,
      todayTrades: 4
    })
    expect(under.trade).toBe(true)
    const unlimited = autopilot.decideAutopilot({
      config: { ...config, maxDailyTrades: 0 },
      pred: strong,
      now: 1000000,
      lastEntryAt: 0,
      todayTrades: 999
    })
    expect(unlimited.trade).toBe(true)
  })

  it("refuses when the pro gate is on and pro analysis is unavailable", () => {
    const d = autopilot.decideAutopilot({ config: { ...config, proGate: true }, pred: strong })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/pro analysis unavailable/)
  })

  it("refuses when the pro gate is on and the verdict is NEUTRAL", () => {
    const pro = { confluence: { verdict: "NEUTRAL", confidence: 50 } }
    const d = autopilot.decideAutopilot({ config: { ...config, proGate: true }, pred: strong, pro })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/NEUTRAL/)
  })

  it("refuses when the pro direction disagrees with the ensemble", () => {
    const pro = { confluence: { verdict: "SELL", confidence: 70 }, bias: { direction: "down" } }
    const d = autopilot.decideAutopilot({ config: { ...config, proGate: true }, pred: strong, pro })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/disagree/)
  })

  it("refuses a whipsaw range even when directions agree", () => {
    const pro = { confluence: { verdict: "BUY", confidence: 70 }, bias: { direction: "up" }, phase: { phase: "volatile_range" } }
    const d = autopilot.decideAutopilot({ config: { ...config, proGate: true }, pred: strong, pro })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/whipsaw/)
  })

  it("approves when the pro gate agrees and reports pro confidence", () => {
    const pro = { confluence: { verdict: "BUY", confidence: 75 }, bias: { direction: "up" } }
    const d = autopilot.decideAutopilot({
      config: { ...config, proGate: true },
      pred: strong,
      pro,
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("call")
    expect(d.proConfidence).toBe(75)
  })

  it("stops trading once the daily loss limit is reached", () => {
    const d = autopilot.decideAutopilot({
      config,
      pred: strong,
      now: 1000000,
      lastEntryAt: 0,
      dailyPnl: -1001,
      dayStartBalance: 10000
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/loss limit/)
  })
})

describe("autopilotTick (integration with mocked broker)", () => {
  it("does nothing when the autopilot is disabled", async () => {
    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(buy).not.toHaveBeenCalled()
    expect(connectTradingSession).not.toHaveBeenCalled()
  })

  it("places a demo trade on a strong signal", async () => {
    await trading.saveCredentials({ expertoptionToken: "demo-token", expertoptionDemo: true })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50, cooldownMs: 10000 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(out.direction).toBe("call")
    expect(buy).toHaveBeenCalledTimes(1)
    const [args] = buy.mock.calls[0]
    expect(args).toMatchObject({ assetId: "BTCUSD", type: "call" })
    expect(args.amount).toBeGreaterThanOrEqual(1)
    expect(args.amount).toBeLessThanOrEqual(1000)
  })

  it("does not buy below the confidence threshold", async () => {
    predictDirection.mockReturnValue({ direction: "up", confidence: 40, models: {}, reason: "weak" })
    await trading.saveCredentials({ expertoptionToken: "demo-token", expertoptionDemo: true })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50, cooldownMs: 10000 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/below/)
    expect(buy).not.toHaveBeenCalled()
  })

  it("stops trading for the day once the daily trade cap is hit", async () => {
    await trading.saveCredentials({ expertoptionToken: "demo-token", expertoptionDemo: true })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50, cooldownMs: 10000, maxDailyTrades: 1 })
    // Seed the deals file with one deal settled today so todayTradeCount() = 1.
    const today = new Date().toISOString().slice(0, 10)
    await writeFile(
      join(tmp, "trading-demo-deals.json"),
      JSON.stringify({
        deals: [
          { serverId: "deal-today", assetId: "BTCUSD", type: "call", amount: 10, result: "loss", profit: -10, recordAt: `${today}T12:00:00.000Z`, closedAt: `${today}T12:00:00.000Z` }
        ]
      })
    )

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/cap 1 reached/)
    expect(buy).not.toHaveBeenCalled()

    const status = await autopilot.demoStatus()
    expect(status.todayTrades).toBe(1)
  })

  it("stops itself when demo mode is disabled", async () => {
    await trading.saveCredentials({ expertoptionToken: "demo-token", expertoptionDemo: false })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    const config = await autopilot.getAutopilotConfig()
    expect(config.enabled).toBe(false)
  })
})

describe("placeDemoTrade validations", () => {
  it("requires a configured token", async () => {
    await autopilot.saveAutopilotConfig({ enabled: true })
    await expect(autopilot.placeDemoTrade({ assetId: "EURUSD", type: "call", amount: 10 })).rejects.toThrow(/token/)
    expect(connectTradingSession).not.toHaveBeenCalled()
  })

  it("refuses when demo mode is off", async () => {
    await trading.saveCredentials({ expertoptionToken: "tok", expertoptionDemo: false })
    await expect(autopilot.placeDemoTrade({ assetId: "EURUSD", type: "call", amount: 10 })).rejects.toThrow(/demo/)
  })

  it("places a manual demo trade", async () => {
    await trading.saveCredentials({ expertoptionToken: "demo-token", expertoptionDemo: true })
    buy.mockResolvedValue({ serverId: "deal-9", type: "put", amount: 15, status: "active" })
    const deal = await autopilot.placeDemoTrade({ assetId: "EURUSD", type: "put", amount: 15, duration: 60 })
    expect(deal.serverId).toBe("deal-9")
    const [args] = buy.mock.calls[0]
    expect(args).toMatchObject({ assetId: "EURUSD", type: "put", amount: 15, duration: 60 })
  })
})

describe("feedback loop + demo analytics", () => {
  // Settled frames are persisted fire-and-forget; poll briefly for the file
  // to catch up before asserting on the ledger / deals store.
  async function waitFor(check, ms = 1500) {
    const start = Date.now()
    while (Date.now() - start < ms) {
      const value = await check()
      if (value) return value
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error("timed out waiting for async settle persistence")
  }

  async function sessionWithSettleHandler() {
    const handlers = []
    const session = { ...fakeSession, onDeal: (cb) => {
      handlers.push(cb)
      return () => {}
    } }
    connectTradingSession.mockResolvedValue(session)
    await trading.saveCredentials({ expertoptionToken: "demo-token", expertoptionDemo: true })
    await autopilot.placeDemoTrade({ assetId: "BTCUSD", type: "call", amount: 10 })
    return handlers
  }

  it("records and resolves a signal for each settled demo deal", async () => {
    const handlers = await sessionWithSettleHandler()
    expect(handlers).toHaveLength(1)
    await handlers[0]("settled", {
      serverId: "deal-1",
      asset: "BTCUSD",
      type: "call",
      amount: 100,
      openPrice: 100,
      closePrice: 110,
      result: "win",
      profit: 85,
      duration: 60,
      closedAt: new Date().toISOString()
    })

    const acc = await waitFor(async () => {
      const a = await trading.signalAccuracy()
      return a.total === 1 ? a : null
    })
    expect(acc.total).toBe(1)
    expect(acc.wins).toBe(1)
    const sig = (await trading.recentSignals())[0]
    expect(sig.direction).toBe("up")
    expect(sig.status).toBe("resolved")
    expect(sig.resolution).toBe("win")
  })

  it("skips feedback for deals without usable prices", async () => {
    const handlers = await sessionWithSettleHandler()
    await handlers[0]("settled", {
      serverId: "deal-2",
      asset: "BTCUSD",
      type: "put",
      amount: 100,
      openPrice: 0,
      closePrice: 0,
      result: "loss",
      profit: -100,
      duration: 60,
      closedAt: new Date().toISOString()
    })
    await new Promise((r) => setTimeout(r, 30))
    const acc = await trading.signalAccuracy()
    expect(acc.total).toBe(0)
  })

  it("demoAnalytics reports metrics and a call/put breakdown", async () => {
    const handlers = await sessionWithSettleHandler()
    const t = new Date().toISOString()
    await handlers[0]("settled", { serverId: "d1", asset: "BTCUSD", type: "call", amount: 100, openPrice: 100, closePrice: 110, result: "win", profit: 85, duration: 60, closedAt: t })
    await handlers[0]("settled", { serverId: "d2", asset: "BTCUSD", type: "put", amount: 100, openPrice: 110, closePrice: 100, result: "loss", profit: -100, duration: 60, closedAt: t })

    const report = await waitFor(async () => {
      const r = await autopilot.demoAnalytics()
      return r.overview.deals === 2 ? r : null
    })
    expect(report.overview.netProfit).toBe(-15)
    expect(report.overview.winRate).toBe(50)
    expect(report.metrics.grossProfit).toBe(85)
    expect(report.metrics.grossLoss).toBe(100)
    expect(report.metrics.profitFactor).toBeCloseTo(0.85, 2)
    const call = report.byType.find((b) => b.type === "call")
    const put = report.byType.find((b) => b.type === "put")
    expect(call.wins).toBe(1)
    expect(call.pnl).toBe(85)
    expect(put.pnl).toBe(-100)
  })

  it("demoDeals lists the newest deals first", async () => {
    const handlers = await sessionWithSettleHandler()
    const t = new Date().toISOString()
    await handlers[0]("settled", { serverId: "dA", asset: "BTCUSD", type: "call", amount: 100, openPrice: 100, closePrice: 110, result: "win", profit: 85, duration: 60, closedAt: t })
    await handlers[0]("settled", { serverId: "dB", asset: "BTCUSD", type: "put", amount: 100, openPrice: 110, closePrice: 100, result: "loss", profit: -100, duration: 60, closedAt: t })
    const { deals } = await waitFor(async () => {
      const d = await autopilot.demoDeals()
      return d.deals.length === 2 ? d : null
    })
    expect(deals[0].serverId).toBe("dB") // newest first
    expect(deals[1].serverId).toBe("dA")
  })
})
