import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Deterministic LLM behavior so tests never hit the network.
vi.mock("../services/llm.mjs", () => ({
  chatText: vi.fn(async () => "LLM mock advice"),
  llmConfigured: () => false
}))
vi.mock("../config.mjs", () => ({
  env: {}
}))

let tmp
let mod

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-trading-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  mod = await import("../services/trading.mjs")
})

beforeEach(async () => {
  await mod._resetTradingData()
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("paper ledger", () => {
  it("opens a position and reports cash reduction", async () => {
    const before = await mod.paperOverview()
    const pos = await mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 100 })
    expect(pos.status).toBe("open")
    expect(pos.symbol).toBe("EURUSD")
    const after = await mod.paperOverview()
    expect(after.openCount).toBe(1)
    expect(after.cash).toBeCloseTo(before.cash - 100, 2)
    expect(after.committed).toBeCloseTo(100, 2)
  })

  it("computes PnL on close for up and down sides", async () => {
    const up = await mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 100, amount: 100 })
    const upResult = await mod.closePaperTrade({ id: up.id, exit: 110 })
    expect(upResult.pnl).toBeCloseTo(10, 2)

    const down = await mod.openPaperTrade({ symbol: "EURUSD", side: "down", entry: 100, amount: 100 })
    const downResult = await mod.closePaperTrade({ id: down.id, exit: 90 })
    expect(downResult.pnl).toBeCloseTo(10, 2)

    const overview = await mod.paperOverview()
    expect(overview.realizedPnl).toBeCloseTo(20, 2)
    expect(overview.winRate).toBe(100)
    expect(overview.openCount).toBe(0)
  })

  it("enforces the risk cap per trade", async () => {
    await expect(
      mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 500 })
    ).rejects.toThrow(/risk cap/)
  })

  it("rejects trades beyond available cash", async () => {
    // Starting 1000 with a 20% risk cap: five $180 trades tie up $900 of cash,
    // leaving $100 — a sixth $180 trade must fail the cash check (not the cap).
    await mod.saveCredentials({ paperStartingBalance: 1000, riskPerTradePct: 20 })
    for (let i = 0; i < 5; i++) {
      await mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 180 })
    }
    await expect(
      mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 180 })
    ).rejects.toThrow(/insufficient paper cash/)
  })

  it("cannot close a position twice or close unknown ids", async () => {
    const pos = await mod.openPaperTrade({ symbol: "BTCUSD", side: "up", entry: 50, amount: 50 })
    await mod.closePaperTrade({ id: pos.id, exit: 60 })
    await expect(mod.closePaperTrade({ id: pos.id, exit: 70 })).rejects.toThrow(/not found/)
    await expect(mod.closePaperTrade({ id: "nope", exit: 70 })).rejects.toThrow(/not found/)
  })

  it("serializes concurrent ledger writes so no trade is lost", async () => {
    const results = await Promise.all([
      mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 100 }),
      mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 100 }),
      mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 100 })
    ])
    expect(results).toHaveLength(3)
    const overview = await mod.paperOverview()
    expect(overview.openCount).toBe(3)
    expect(overview.cash).toBeCloseTo(overview.starting - 300, 2)
  })
})

describe("credentials", () => {
  it("round-trips credentials", async () => {
    await mod.saveCredentials({ expertoptionToken: "tok-123", riskPerTradePct: 5 })
    const creds = await mod.getCredentials()
    expect(creds.expertoptionToken).toBe("tok-123")
    expect(creds.riskPerTradePct).toBe(5)
    expect(creds.paperStartingBalance).toBe(10000)
  })

  it("clamps risk and balance to sane ranges", async () => {
    await mod.saveCredentials({ riskPerTradePct: 500, paperStartingBalance: 1 })
    const creds = await mod.getCredentials()
    expect(creds.riskPerTradePct).toBe(20)
    expect(creds.paperStartingBalance).toBe(100)
  })

  it("keeps the saved token when a blank token is submitted", async () => {
    await mod.saveCredentials({ expertoptionToken: "tok-abc" })
    await mod.saveCredentials({ riskPerTradePct: 5 })
    const creds = await mod.getCredentials()
    expect(creds.expertoptionToken).toBe("tok-abc")
    expect(creds.riskPerTradePct).toBe(5)
  })
})

describe("status + signals", () => {
  it("reports paper mode and expertoption configuration", async () => {
    const status = await mod.tradingStatus()
    expect(status.mode).toBe("paper")
    expect(status.expertOption.configured).toBe(false)
    expect(status.paper.starting).toBe(10000)
  })

  it("records and lists signals", async () => {
    await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 62 })
    const signals = await mod.recentSignals()
    expect(signals).toHaveLength(1)
    expect(signals[0].direction).toBe("up")
  })

  it("assist falls back to local guidance without an LLM", async () => {
    const r = await mod.tradingAssist("Should I risk 50%?")
    expect(r.ok).toBe(true)
    expect(r.source).toBe("local")
    expect(r.advice).toMatch(/risk|balance/i)
  })
})
