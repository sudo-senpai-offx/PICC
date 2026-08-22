import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/llm.mjs", () => ({
  chatText: vi.fn(async () => "APPROVE")
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
  tmp = mkdtempSync(join(tmpdir(), "picc-autopilot-guard-"))
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

describe("demo-only guard (expertoptionDemo)", () => {
  it("refuses to run a tick when the credential store has demo mode off", async () => {
    await trading.saveCredentials({ expertoptionToken: "tok", expertoptionDemo: false })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/demo mode disabled/)
    expect(buy).not.toHaveBeenCalled()
    expect(connectTradingSession).not.toHaveBeenCalled()
  })

  it("refuses manual demo trades when demo mode is off", async () => {
    await trading.saveCredentials({ expertoptionToken: "tok", expertoptionDemo: false })

    await expect(
      autopilot.placeDemoTrade({ assetId: "BTCUSD", type: "call", amount: 10 })
    ).rejects.toThrow(/demo/)
    expect(connectTradingSession).not.toHaveBeenCalled()
    expect(buy).not.toHaveBeenCalled()
  })

  it("proceeds normally when demo mode is on", async () => {
    await trading.saveCredentials({ expertoptionToken: "tok", expertoptionDemo: true })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50, cooldownMs: 10000 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(out.direction).toBe("call")
    expect(buy).toHaveBeenCalledTimes(1)
    expect(connectTradingSession).toHaveBeenCalledTimes(1)
    expect(connectTradingSession.mock.calls[0][0]).toMatchObject({ token: "tok", isDemo: true })
  })

  it("places a manual trade end-to-end when demo mode is on", async () => {
    await trading.saveCredentials({ expertoptionToken: "tok", expertoptionDemo: true })

    const deal = await autopilot.placeDemoTrade({ assetId: "EURUSD", type: "put", amount: 25, duration: 120 })
    expect(deal.serverId).toBe("deal-1")
    expect(buy).toHaveBeenCalledWith(expect.objectContaining({ assetId: "EURUSD", type: "put", amount: 25, duration: 120 }))
  })

  it("cannot be bypassed with a forceLive flag", async () => {
    await trading.saveCredentials({ expertoptionToken: "tok", expertoptionDemo: false })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50, forceLive: true })

    const tick = await autopilot.autopilotTick()
    expect(tick.ok).toBe(false)
    expect(tick.reason).toMatch(/demo mode disabled/)

    await expect(
      autopilot.placeDemoTrade({ assetId: "BTCUSD", type: "call", amount: 10, forceLive: true })
    ).rejects.toThrow(/demo/)
    expect(buy).not.toHaveBeenCalled()
    expect(connectTradingSession).not.toHaveBeenCalled()
  })

  it("reads the credential store, not caller-supplied parameters", async () => {
    await trading.saveCredentials({ expertoptionToken: "tok", expertoptionDemo: false })

    await expect(
      autopilot.placeDemoTrade({
        assetId: "BTCUSD",
        type: "call",
        amount: 10,
        expertoptionDemo: true,
        isDemo: true,
        demo: true
      })
    ).rejects.toThrow(/demo/)
    expect(connectTradingSession).not.toHaveBeenCalled()

    await writeFile(
      join(tmp, "trading-credentials.json"),
      JSON.stringify({ expertoptionToken: "tok", expertoptionDemo: true })
    )

    const deal = await autopilot.placeDemoTrade({ assetId: "BTCUSD", type: "call", amount: 10 })
    expect(deal.serverId).toBe("deal-1")
    expect(buy).toHaveBeenCalledTimes(1)
    expect(connectTradingSession.mock.calls[0][0]).toMatchObject({ isDemo: true })
  })
})
