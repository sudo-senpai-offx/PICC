import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { writeFile as asyncWriteFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/llm.mjs", () => ({
  chatText: vi.fn(async () => "APPROVE"),
  llmConfigured: vi.fn(() => false)
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
let notificationCenter
let dataSources
let connectTradingSession
let predictDirection

function goodCandles({ count = 120, base = 100, step = 0.5, ageSec = 0 } = {}) {
  const endSec = Math.floor(Date.now() / 1000) - ageSec
  return Array.from({ length: count }, (_, i) => {
    const open = Math.round((base + i * step) * 100) / 100
    const close = Math.round((open + step * 0.8) * 100) / 100
    return {
      time: endSec - (count - 1 - i) * 60,
      open,
      close,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1
    }
  })
}

function makeSession({
  candles = goodCandles(),
  candleError = null,
  candleDelayMs = 0,
  balance = 10000,
  openDeals = []
} = {}) {
  const buy = vi.fn(async (req) => {
    const deal = {
      serverId: `chaos-${Math.random().toString(16).slice(2, 8)}`,
      assetId: req.assetId,
      type: req.type,
      amount: req.amount,
      duration: req.duration,
      status: "active",
      openedAt: new Date().toISOString()
    }
    openDeals.push(deal)
    return deal
  })
  const session = {
    connected: true,
    balance: async () => ({ balance, currency: "USD", demo: true }),
    deals: () => openDeals,
    candles: async () => {
      if (candleDelayMs) await new Promise((r) => setTimeout(r, candleDelayMs))
      if (candleError) {
        session.connected = false
        throw candleError
      }
      return typeof candles === "function" ? candles() : candles
    },
    buy,
    close: () => {},
    onDeal: () => () => {}
  }
  return { session, buy }
}

async function armAutopilot(overrides = {}) {
  await trading.saveCredentials({ expertoptionToken: "chaos-token", expertoptionDemo: true })
  await autopilot.saveAutopilotConfig({
    enabled: true,
    minConfidence: 50,
    cooldownMs: 10000,
    humanReviewMs: 0,
    ...overrides
  })
}

async function seedLedgerLosses(count) {
  for (let i = 0; i < count; i++) {
    const sig = await trading.recordSignal({
      symbol: "BTCUSD",
      direction: "up",
      confidence: null,
      horizonDays: 3,
      entry: 100,
      source: "autopilot"
    })
    await trading.resolveSignal({ id: sig.id, resultPrice: 90 })
  }
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-chaos-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_NOTIFICATION_DATA_DIR = tmp
  trading = await import("../services/trading.mjs")
  autopilot = await import("../services/autopilot.mjs")
  notificationCenter = await import("../services/notificationCenter.mjs")
  dataSources = await import("../services/dataSources.mjs")
  const eo = await import("../services/expertoption.mjs")
  const pred = await import("../services/prediction.mjs")
  connectTradingSession = eo.connectTradingSession
  predictDirection = pred.predictDirection
})

beforeEach(async () => {
  connectTradingSession.mockReset()
  predictDirection.mockReset()
  predictDirection.mockReturnValue({ direction: "up", confidence: 70, models: {}, reason: "momentum" })
  await trading._resetTradingData()
  await autopilot._resetAutopilotData()
  await notificationCenter.saveWebhookSettings({ webhookUrl: "", webhookEvents: [] })
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await autopilot._closeSession()
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_NOTIFICATION_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("chaos: WS disconnect mid-tick", () => {
  it("survives a dropped socket during the candle fetch, flags stale data, and recovers", async () => {
    const failing = makeSession({ candleError: new Error("WebSocket closed during candle fetch (1006)") })
    connectTradingSession.mockResolvedValue(failing.session)
    await armAutopilot()

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.stale).toBe(true)
    expect(out.reason).toMatch(/candle fetch failed/i)
    expect(failing.buy).not.toHaveBeenCalled()

    const status = await autopilot.demoStatus()
    expect(status.autopilot.dataHealth).toBe("stale")

    await autopilot._closeSession()
    const healthy = makeSession()
    connectTradingSession.mockResolvedValue(healthy.session)
    const recovered = await autopilot.autopilotTick()
    expect(recovered.ok).toBe(true)
    expect(healthy.buy).toHaveBeenCalledTimes(1)
    const healed = await autopilot.demoStatus()
    expect(healed.autopilot.dataHealth).toBe("live")
  })

  it("survives a balance fetch failure without crashing the loop", async () => {
    const { session, buy } = makeSession()
    session.balance = async () => {
      throw new Error("connection reset while waiting for balance frame")
    }
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot()

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.stale).toBe(true)
    expect(out.reason).toMatch(/session unreachable/)
    expect(buy).not.toHaveBeenCalled()
  })
})

describe("chaos: malformed candle data", () => {
  it("filters broken rows out of the normalized candle stream", async () => {
    const eo = await import("../services/expertoption.mjs")
    const mixed = [
      ...goodCandles({ count: 90 }),
      null,
      {},
      { close: Number.NaN },
      { close: "not-a-number" },
      { time: 1700000000, close: -42 },
      { time: 1700000001 },
      [1700000002, 100, "bad"],
      { close: Number.POSITIVE_INFINITY },
      { time: "yesterday", close: 123 }
    ]
    const { closes, ohlc } = eo.candlesFrom({ candles: mixed })
    expect(closes.length).toBeGreaterThanOrEqual(30)
    expect(closes.every((c) => Number.isFinite(c) && c > 0)).toBe(true)
    expect(ohlc.length).toBe(closes.length)
    expect(ohlc.every((c) => Number.isFinite(c.high) && Number.isFinite(c.low))).toBe(true)
  })

  it("runs a full tick on garbage-laced candles without crashing and places at most one sane trade", async () => {
    const mixed = [
      ...goodCandles({ count: 90 }),
      null,
      {},
      { close: Number.NaN },
      { time: 1700000000, close: -42 },
      { time: 1700000001 }
    ]
    const { session, buy } = makeSession({ candles: mixed })
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot()

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(buy).toHaveBeenCalledTimes(1)
    const amount = Number(buy.mock.calls[0][0].amount)
    expect(Number.isFinite(amount)).toBe(true)
    expect(amount).toBeGreaterThanOrEqual(1)
    expect(amount).toBeLessThanOrEqual(1000)
  })
})

describe("chaos: empty responses", () => {
  it("reports an empty exchange response gracefully instead of crashing", async () => {
    const { session, buy } = makeSession({ candles: [] })
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot()

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/not enough candles/)
    expect(buy).not.toHaveBeenCalled()
    const status = await autopilot.demoStatus()
    expect(status.ok).toBe(true)
  })

  it("classifies never-updated sources as unconfigured and old sources as stale", () => {
    expect(dataSources.classifySource(null)).toMatchObject({ status: "unconfigured" })
    expect(dataSources.classifySource(0)).toMatchObject({ status: "unconfigured" })
    expect(dataSources.classifySource(Date.now())).toMatchObject({ status: "live" })
    expect(dataSources.classifySource(Date.now() - 61_000)).toMatchObject({ status: "stale" })
    const statuses = dataSources.collectSourceStatuses()
    expect(statuses.candles.status).toBe("unconfigured")
  })
})

describe("chaos: concurrent access", () => {
  it("serializes overlapping ticks with no crashes and no duplicate trades", async () => {
    const { session, buy } = makeSession({ candleDelayMs: 150 })
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot()

    const results = await Promise.allSettled([
      autopilot.autopilotTick(),
      autopilot.autopilotTick(),
      autopilot.autopilotTick(),
      autopilot.autopilotTick(),
      autopilot.autopilotTick()
    ])

    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    const values = results.map((r) => r.value)
    expect(values.filter((v) => v.ok === true)).toHaveLength(1)
    expect(values.filter((v) => /tick already in flight/.test(String(v.reason)))).toHaveLength(4)
    expect(buy).toHaveBeenCalledTimes(1)

    const status = await autopilot.demoStatus()
    expect(status.openDeals).toHaveLength(1)
  })
})

describe("chaos: credential store corruption", () => {
  it("degrades to safe defaults on invalid JSON and refuses to trade", async () => {
    await asyncWriteFile(join(tmp, "trading-credentials.json"), "{{{ definitely not json !!!", "utf8")

    const creds = await trading.getCredentials()
    expect(creds.expertoptionToken).toBe("")
    expect(creds.expertoptionDemo).toBe(true)

    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toBe("no token")
    await expect(
      autopilot.placeDemoTrade({ assetId: "BTCUSD", type: "call", amount: 10 })
    ).rejects.toThrow(/not configured/)

    await trading.saveCredentials({ expertoptionToken: "healed-token", expertoptionDemo: true })
    const healed = await trading.getCredentials()
    expect(healed.expertoptionToken).toBe("healed-token")
    expect(healed.expertoptionDemo).toBe(true)
  })
})

describe("chaos: network timeout", () => {
  it("aborts a hanging webhook delivery, retries once, and leaves the process healthy", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi.fn(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Error("aborted by timeout")))
        })
    )
    vi.stubGlobal("fetch", fetchMock)
    await notificationCenter.saveWebhookSettings({
      webhookUrl: "https://hooks.example.test/picc",
      webhookEvents: ["connector.stale"]
    })

    const result = await notificationCenter.emitEvent(
      "connector.stale",
      { connector: "expertoption", lastTickAgeSec: 95 },
      { timeoutMs: 30, retryDelayMs: 25 }
    )
    expect(result.queued).toBe(true)

    await new Promise((r) => setTimeout(r, 200))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(payload.event).toBe("connector.stale")
    expect(typeof payload.timestamp).toBe("string")
    expect(payload.data.lastTickAgeSec).toBe(95)

    const statuses = dataSources.collectSourceStatuses(Date.now() + 61_000 * 1000)
    expect(statuses.candles.status).toBe("unconfigured")
    expect(warnSpy).toHaveBeenCalled()
  })

  it("skips delivery entirely for unsubscribed events", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    await notificationCenter.saveWebhookSettings({
      webhookUrl: "https://hooks.example.test/picc",
      webhookEvents: ["autopilot.start"]
    })

    const skipped = await notificationCenter.emitEvent("connector.expired", {})
    expect(skipped.skipped).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()

    const delivered = await notificationCenter.emitEvent("autopilot.start", { assetId: "BTCUSD" })
    expect(delivered.queued).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("chaos: stale data trading", () => {
  it("refuses to trade when candle data is more than 60s old", async () => {
    const { session, buy } = makeSession({ candles: goodCandles({ ageSec: 300 }) })
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot()

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/stale/i)
    expect(out.stale).toBe(true)
    expect(buy).not.toHaveBeenCalled()
  })

  it("trades normally on fresh candles (control)", async () => {
    const { session, buy } = makeSession({ candles: goodCandles({ ageSec: 0 }) })
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot()

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(buy).toHaveBeenCalledTimes(1)
  })

  it("honors a custom maxCandleAgeSec from the settings endpoint", async () => {
    const { session, buy } = makeSession({ candles: goodCandles({ ageSec: 90 }) })
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot({ maxCandleAgeSec: 3600 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(buy).toHaveBeenCalledTimes(1)
  })
})

describe("circuit breaker: consecutive losses", () => {
  it("evaluates streaks, windows and wins as a pure function", () => {
    const now = Date.now()
    const lossAt = (msAgo) => ({ resolution: "loss", resolvedAt: new Date(now - msAgo).toISOString() })
    const winAt = (msAgo) => ({ resolution: "win", resolvedAt: new Date(now - msAgo).toISOString() })

    const inside = [lossAt(1000), lossAt(2000), lossAt(3000)]
    const tripped = autopilot.evaluateLossBreaker(inside, { limit: 3, windowMs: 30 * 60_000, now })
    expect(tripped.tripped).toBe(true)
    expect(tripped.streak).toBe(3)
    expect(tripped.until).toBeGreaterThan(now)

    const agedOut = [lossAt(31 * 60_000), lossAt(32 * 60_000), lossAt(33 * 60_000)]
    expect(autopilot.evaluateLossBreaker(agedOut, { limit: 3, windowMs: 30 * 60_000, now }).tripped).toBe(false)

    const winBreaksStreak = [lossAt(1000), lossAt(2000), winAt(3000), lossAt(4000), lossAt(5000)]
    expect(autopilot.evaluateLossBreaker(winBreaksStreak, { limit: 3, windowMs: 30 * 60_000, now }).tripped).toBe(false)

    const undated = [{ resolution: "loss" }, { resolution: "loss" }, { resolution: "loss" }]
    const fallback = autopilot.evaluateLossBreaker(undated, { limit: 3, windowMs: 30 * 60_000, now })
    expect(fallback.tripped).toBe(true)
    expect(fallback.until).toBeGreaterThan(now)
  })

  it("pauses entries after 3 straight ledger losses and resumes on manual reset", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { session, buy } = makeSession()
    connectTradingSession.mockResolvedValue(session)
    await seedLedgerLosses(3)
    await armAutopilot({ consecutiveLossLimit: 3 })

    const refused = await autopilot.autopilotTick()
    expect(refused.ok).toBe(false)
    expect(refused.reason).toMatch(/consecutive-loss breaker/)
    expect(buy).not.toHaveBeenCalled()

    let status = await autopilot.demoStatus()
    expect(status.autopilot.breakers.lossBreaker.tripped).toBe(true)

    autopilot.resetBreakers()
    const resumed = await autopilot.autopilotTick()
    expect(resumed.ok).toBe(true)
    expect(buy).toHaveBeenCalledTimes(1)
    status = await autopilot.demoStatus()
    expect(status.autopilot.breakers.lossBreaker.tripped).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/BREAKER TRIPPED/))
  })

  it("does not trip below the configured limit or when a draw breaks the streak", async () => {
    const { session, buy } = makeSession()
    connectTradingSession.mockResolvedValue(session)
    await seedLedgerLosses(2)
    await armAutopilot({ consecutiveLossLimit: 3 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(buy).toHaveBeenCalledTimes(1)
  })
})

describe("circuit breaker: regime shift", () => {
  it("pauses on transition and resumes after two consecutive stable readings", () => {
    autopilot.resetBreakers()
    const t0 = Date.now()

    let st = autopilot.updateRegimeBreaker("trending", t0)
    expect(st.paused).toBe(false)
    st = autopilot.updateRegimeBreaker("trending", t0 + 1)
    expect(st.stable).toBe("trending")
    expect(st.paused).toBe(false)

    st = autopilot.updateRegimeBreaker("ranging", t0 + 2)
    expect(st.paused).toBe(true)
    expect(st.candidate).toBe("ranging")
    expect(st.lastTransition.from).toBe("trending")
    expect(st.lastTransition.to).toBe("ranging")

    st = autopilot.updateRegimeBreaker("volatile", t0 + 3)
    expect(st.paused).toBe(true)
    expect(st.candidate).toBe("volatile")

    st = autopilot.updateRegimeBreaker("volatile", t0 + 4)
    expect(st.paused).toBe(false)
    expect(st.stable).toBe("volatile")
    expect(st.candidate).toBeNull()

    st = autopilot.updateRegimeBreaker("unknown", t0 + 5)
    expect(st.stable).toBe("volatile")
  })

  it("keeps trading open while the initial regime stabilizes", () => {
    autopilot.resetBreakers()
    const first = autopilot.updateRegimeBreaker("trending", Date.now())
    expect(first.paused).toBe(false)
    expect(first.stable).toBeNull()
  })

  it("is bypassed entirely when regimeShiftPause is disabled", async () => {
    autopilot.resetBreakers()
    autopilot.updateRegimeBreaker("trending", Date.now())
    autopilot.updateRegimeBreaker("trending", Date.now())
    autopilot.updateRegimeBreaker("ranging", Date.now())

    const { session, buy } = makeSession()
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot({ regimeShiftPause: false })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(buy).toHaveBeenCalledTimes(1)
  })

  it("blocks a full tick while a regime transition is pending", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { session, buy } = makeSession()
    connectTradingSession.mockResolvedValue(session)
    await armAutopilot({ regimeShiftPause: true })

    predictDirection.mockReturnValue({ direction: "up", confidence: 70, models: {}, reason: "momentum" })
    autopilot.updateRegimeBreaker("ranging", Date.now())
    autopilot.updateRegimeBreaker("ranging", Date.now())
    autopilot.updateRegimeBreaker("volatile", Date.now())

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/regime-shift breaker/)
    expect(out.stale).toBeUndefined()
    expect(buy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/BREAKER PAUSED/))
  })
})

describe("webhook outbound events", () => {
  it("delivers autopilot start/stop events with event type and timestamp", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    await notificationCenter.saveWebhookSettings({
      webhookUrl: "https://hooks.example.test/picc",
      webhookEvents: ["autopilot.start", "autopilot.stop", "autopilot.kill"]
    })

    await autopilot.startAutopilot()
    await autopilot.stopAutopilot("kill switch pressed")

    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const started = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(started.event).toBe("autopilot.start")
    expect(typeof started.timestamp).toBe("string")
    expect(started.data.assetId).toBeTruthy()
    const stopped = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(stopped.event).toBe("autopilot.kill")
    expect(stopped.data.reason).toMatch(/kill/)
    await autopilot._closeSession()
  })

  it("fires risk.dailyLossApproached at 80 percent of the limit once per day", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    await notificationCenter.saveWebhookSettings({
      webhookUrl: "https://hooks.example.test/picc",
      webhookEvents: ["risk.dailyLossApproached", "risk.dailyLossHit"]
    })
    const today = new Date().toISOString().slice(0, 10)
    await asyncWriteFile(
      join(tmp, "trading-autopilot.json"),
      JSON.stringify({
        enabled: true,
        minConfidence: 50,
        cooldownMs: 10000,
        humanReviewMs: 0,
        dailyLossLimitPct: 10,
        dayKey: today,
        dayStartBalance: 10000
      }),
      "utf8"
    )
    await asyncWriteFile(
      join(tmp, "trading-demo-deals.json"),
      JSON.stringify({
        deals: [
          {
            serverId: "risk-seed",
            assetId: "BTCUSD",
            type: "put",
            amount: 850,
            result: "loss",
            profit: -850,
            recordAt: `${today}T09:00:00.000Z`,
            closedAt: `${today}T09:01:00.000Z`
          }
        ]
      }),
      "utf8"
    )
    await trading.saveCredentials({ expertoptionToken: "chaos-token", expertoptionDemo: true })

    const { session } = makeSession()
    connectTradingSession.mockResolvedValue(session)
    await autopilot.autopilotTick()

    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.event).toBe("risk.dailyLossApproached")
    expect(body.data.thresholdPct).toBe(80)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringMatching(/BREAKER/))
  })

  it("round-trips settings through the notifications endpoint", async () => {
    const saved = await notificationCenter.saveWebhookSettings({
      webhookUrl: "https://hooks.example.test/picc",
      webhookEvents: ["autopilot.start", "bogus.event"]
    })
    expect(saved.webhookUrl).toBe("https://hooks.example.test/picc")
    expect(saved.webhookEvents).toEqual(["autopilot.start"])

    const cleared = await notificationCenter.saveWebhookSettings({ webhookUrl: "ftp://nope" })
    expect(cleared.webhookUrl).toBe("")
    expect(cleared.webhookEvents).toEqual(["autopilot.start"])
  })
})
