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

// Broker feed stub: trading.mjs reads candle data through dynamic imports of
// brokers/index.mjs. The hoisted mutable array lets the calibration tests
// feed a synthetic series that the model matrix can actually vote on.
const brokerFeed = vi.hoisted(() => ({ assets: [] }))
vi.mock("../services/brokers/index.mjs", () => ({
  getBrokerData: () => ({ assets: brokerFeed.assets }),
  getBrokerStats: () => ({})
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

describe("venue tokens (T11 storage-scan captures)", () => {
  it("round-trips a per-venue token in ITS OWN file — never inside getCredentials()", async () => {
    expect(await mod.getVenueToken("iqoption")).toBeNull()
    expect(await mod.saveVenueToken("iqoption", "ssid-tok-1")).toBe("ssid-tok-1")
    expect(await mod.getVenueToken("iqoption")).toBe("ssid-tok-1")
    // The creds object (spread into API responses by handlers.mjs) must NOT
    // carry venue tokens — that path would leak raw tokens to the UI.
    const creds = await mod.getCredentials()
    expect(creds.venueTokens).toBeUndefined()
    // The tokens file stays a separate, clearly-named artifact.
  })

  it("venue ids are lowercased and blank tokens never overwrite a saved one", async () => {
    await mod.saveVenueToken("IQOPTION", "ssid-tok-2")
    expect(await mod.getVenueToken("iqoption")).toBe("ssid-tok-2")
    await mod.saveVenueToken("iqoption", "   ")
    expect(await mod.getVenueToken("iqoption")).toBe("ssid-tok-2")
  })

  it("saving a new venue never clobbers another venue's token", async () => {
    await mod.saveVenueToken("iqoption", "ssid-tok-iq")
    await mod.saveVenueToken("binance", "ses-tok-bn")
    expect(await mod.getVenueToken("iqoption")).toBe("ssid-tok-iq")
    expect(await mod.getVenueToken("binance")).toBe("ses-tok-bn")
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

  describe("stale pending signal flush", () => {
    it("marks pending signals past the cap as unresolved — never guessed as wins/losses", async () => {
      const MAX = mod.MAX_SIGNAL_PENDING_MS
      await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 62 })
      const fresh = await mod.recordSignal({ symbol: "GBPUSD", direction: "down", confidence: 70 })
      // Back-date the fresh one past the cap, same as accuracyLedger's approach.
      const now = Date.now()
      const stale = { ...fresh, createdAt: new Date(now - MAX - 60_000).toISOString() }
      await mod._overwriteSignals([stale])
      const flushed = await mod.flushStaleSignals({ now })
      expect(flushed).toBe(1)
      const signals = await mod.recentSignals()
      const staleRow = signals.find((s) => s.id === fresh.id)
      expect(staleRow.status).toBe("unresolved")
      expect(staleRow.resolution).toBe("unresolved")
      expect(staleRow.resolvedAt).toBeTruthy()
      // The honest contract: an unresolved signal never fabricates a result.
      expect(staleRow.resolution).not.toBe("win")
      expect(staleRow.resolution).not.toBe("loss")
    })

    it("explains WHY it could not resolve: signals without an entry price can never be resolved", async () => {
      const MAX = mod.MAX_SIGNAL_PENDING_MS
      await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 62 })
      const signals = await mod.recentSignals()
      const now = Date.now()
      // Simulate the adaptive-confluence case: no entry price was ever captured.
      await mod._overwriteSignals([
        { ...signals[0], createdAt: new Date(now - MAX - 60_000).toISOString() }
      ])
      await mod.flushStaleSignals({ now })
      const after = await mod.recentSignals()
      expect(after[0].status).toBe("unresolved")
      expect(after[0].flushReason).toMatch(/no entry price/i)
    })

    it("keeps signals inside the cap pending — flush touches only what aged out", async () => {
      await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 62 })
      const now = Date.now()
      expect(await mod.flushStaleSignals({ now })).toBe(0)
      const signals = await mod.recentSignals()
      expect(signals).toHaveLength(1)
      expect(signals[0].status).toBe("pending")
    })

    it("recentSignals and signalAccuracy flush stale entries on read — the surface is always honest", async () => {
      const MAX = mod.MAX_SIGNAL_PENDING_MS
      const now = Date.now()
      const fresh = await mod.recordSignal({ symbol: "EURUSD", direction: "up", confidence: 62 })
      await mod._overwriteSignals([
        { ...fresh, createdAt: new Date(now - MAX - 60_000).toISOString() }
      ])
      // recentSignals itself ages the entry out before returning it.
      const listed = await mod.recentSignals()
      expect(listed).toHaveLength(1)
      expect(listed[0].status).toBe("unresolved")
      // signalAccuracy excludes it from the win/loss math (honest denominator).
      const acc = await mod.signalAccuracy()
      expect(acc.total).toBe(0)
      expect(acc.wins).toBe(0)
      expect(acc.losses).toBe(0)
    })
  })

  it("assist falls back to local guidance without an LLM", async () => {
    const r = await mod.tradingAssist("Should I risk 50%?")
    expect(r.ok).toBe(true)
    expect(r.source).toBe("local")
    expect(r.advice).toMatch(/risk|balance/i)
  })
})

describe("model-matrix calibration (6c)", () => {
  /** localStore loads files asynchronously on first access — prime the cache
   *  and let the load land before any snapshot so tests never read defaults. */
  async function primeWeights() {
    const matrix = await import("../services/modelMatrix.mjs")
    matrix.getModelWeights()
    await new Promise((r) => setTimeout(r, 40))
    return matrix
  }

  it("records model outcomes when a paper trade carries entry votes", async () => {
    const matrix = await primeWeights()
    const before = matrix.getModelWeights().trend
    const beforeSamples = before?.samples ?? 0
    const beforeAccuracy = before?.accuracy ?? 50

    // Strongly rising series → the trend model must vote "up" at entry.
    const candles = Array.from({ length: 120 }, (_, i) => {
      const close = 100 + i * 0.3
      return { time: i, open: close - 0.1, high: close + 0.2, low: close - 0.3, close }
    })
    brokerFeed.assets = [{ id: "SYNTH", name: "SYNTH", periods: { 60: candles } }]

    const pos = await mod.openPaperTrade({ symbol: "SYNTH", side: "up", entry: 135.7, amount: 100 })
    expect(Array.isArray(pos.modelVotes)).toBe(true)
    expect(pos.modelVotes.length).toBeGreaterThan(0)
    const trend = pos.modelVotes.find((v) => v.short === "trend")
    expect(trend?.direction).toBe("up")

    const closed = await mod.closePaperTrade({ id: pos.id, exit: 142 })
    expect(closed.pnl).toBeGreaterThan(0)

    // The resolved win must land in the trend model's EMA win-rate exactly once.
    const after = matrix.getModelWeights().trend
    expect(after.samples).toBe(beforeSamples + 1)
    expect(after.accuracy).toBeGreaterThanOrEqual(beforeAccuracy)

    brokerFeed.assets = []
  })

  it("records nothing when the broker feed has no candles (honest null)", async () => {
    brokerFeed.assets = []
    const matrix = await primeWeights()
    const before = matrix.getModelWeights().trend?.samples ?? 0

    const pos = await mod.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 1.1, amount: 100 })
    expect(pos.modelVotes).toBeNull()
    await mod.closePaperTrade({ id: pos.id, exit: 1.2 })

    const after = matrix.getModelWeights().trend
    expect(after.samples).toBe(before)
  })
})
