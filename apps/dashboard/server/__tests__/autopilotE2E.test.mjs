import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import "../../extensions/picc-overlay/autopilotPanel.js"

const brokerFactory = vi.hoisted(() => {
  function makeCandles({ count = 120, base = 64000, step = 12, timeframe = 60 } = {}) {
    const endSec = Math.floor(Date.now() / 1000)
    const startSec = endSec - count * timeframe
    const rows = []
    for (let i = 0; i < count; i++) {
      const time = startSec + i * timeframe
      const open = Math.round((base + i * step) * 100) / 100
      const close = Math.round((open + step * 0.8) * 100) / 100
      rows.push({ time, open, close, high: Math.max(open, close) + 4, low: Math.min(open, close) - 4 })
    }
    return rows
  }

  function createBroker() {
    const log = { connects: [], candleCalls: [], buys: [], closedTrades: [] }
    const handlers = new Set()
    const active = new Map()
    let cfg = {}
    let dealSeq = 0
    let connected = false
    let sessionSeq = 0
    let liveSession = 0

    function settle(deal, result, closePrice) {
      if (!active.has(deal.serverId)) return null
      active.delete(deal.serverId)
      const closed = {
        ...deal,
        status: "closed",
        result,
        closePrice,
        profit:
          result === "win"
            ? Math.round(deal.amount * (Number(cfg.payout) || 0.85) * 100) / 100
            : result === "loss"
              ? -deal.amount
              : 0,
        closedAt: new Date().toISOString()
      }
      log.closedTrades.push(closed)
      for (const cb of [...handlers]) {
        try {
          cb("settled", closed)
        } catch {}
      }
      return closed
    }

    async function connectTradingSession(connectArgs) {
      log.connects.push({ ...(connectArgs ?? {}) })
      if (!connectArgs?.token) throw new Error("expertoption token required")
      if (connectArgs.isDemo !== true) throw new Error("live trading is disabled — demo accounts only")
      connected = true
      const sessionId = ++sessionSeq
      liveSession = sessionId
      const isLive = () => liveSession === sessionId && connected
      return {
        get connected() {
          return connected
        },
        isDemo: true,
        balance: async () => ({ balance: Number(cfg.balance) || 10000, currency: "USD", demo: true }),
        assets: async () => ({ assets: [{ id: "160", name: String(cfg.assetId || "BTCUSD") }] }),
        candles: async (assetId, period, count) => {
          log.candleCalls.push({ assetId, period, count })
          const rows = Array.isArray(cfg.candles) ? cfg.candles : []
          return { candles: rows.slice(-Math.max(1, count)) }
        },
        buy: async (req) => {
          const rows = Array.isArray(cfg.candles) ? cfg.candles : []
          const openPrice = Number(rows[rows.length - 1]?.close) || 1
          const serverId = `mock-deal-${++dealSeq}`
          const expiryMs = Math.max(20, Number(cfg.expiryMs) || 150)
          const deal = {
            serverId,
            requestId: serverId,
            assetId: "160",
            asset: String(req.assetId),
            type: req.type === "put" ? "put" : "call",
            amount: Math.round(Number(req.amount) * 100) / 100,
            openPrice,
            payout: 85,
            status: "active",
            duration: Math.round(Number(req.duration) || 60),
            openedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + expiryMs).toISOString()
          }
          active.set(serverId, deal)
          log.buys.push({ ...req, serverId, at: Date.now() })
          setTimeout(() => {
            if (!isLive()) return
            const closePrice = Math.round(openPrice * (Number(cfg.closePriceFactor) || 1.01) * 100) / 100
            const diff = closePrice - openPrice
            const result = deal.type === "call" ? (diff > 0 ? "win" : "loss") : diff < 0 ? "win" : "loss"
            settle(deal, result, closePrice)
          }, expiryMs)
          return { ...deal }
        },
        deals: () => [...active.values()],
        settled: () => [...log.closedTrades],
        livePrice: (serverId) => active.get(String(serverId))?.openPrice ?? null,
        closeTrade: async (serverId) => {
          const deal = active.get(String(serverId))
          if (!deal) throw new Error(`unknown deal ${serverId}`)
          settle(deal, "draw", deal.openPrice)
          return { serverId: deal.serverId, status: "closed" }
        },
        onDeal: (cb) => {
          handlers.add(cb)
          return () => handlers.delete(cb)
        },
        close: () => {
          connected = false
        }
      }
    }

    return {
      connectTradingSession,
      log,
      configure(options = {}) {
        cfg = {
          assetId: "BTCUSD",
          balance: 10000,
          candles: makeCandles(),
          expiryMs: 60,
          payout: 0.85,
          closePriceFactor: 1.01,
          ...options
        }
        log.connects.length = 0
        log.candleCalls.length = 0
        log.buys.length = 0
        log.closedTrades.length = 0
        active.clear()
        handlers.clear()
        dealSeq = 0
        connected = false
        liveSession = 0
      }
    }
  }

  return { createBroker, makeCandles }
})

const broker = brokerFactory.createBroker()

vi.mock("../services/expertoption.mjs", async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, connectTradingSession: broker.connectTradingSession }
})

let tmp
let trading
let autopilot
let handlers

const UPTREND = brokerFactory.makeCandles({ step: 12 })
const DOWNTREND = brokerFactory.makeCandles({ step: -12 })
const FLAT = brokerFactory.makeCandles({ step: 0, base: 100 })

function armConfig(overrides = {}) {
  return autopilot.saveAutopilotConfig({
    enabled: true,
    minConfidence: 50,
    cooldownMs: 10000,
    humanReviewMs: 0,
    ...overrides
  })
}

function armBroker(candles, overrides = {}) {
  broker.configure({ candles, ...overrides })
}

async function waitFor(check, ms = 2500) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const value = await check()
    if (value) return value
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error("timed out waiting for condition")
}

async function seedDeals(deals) {
  await writeFile(join(tmp, "trading-demo-deals.json"), JSON.stringify({ deals }), "utf8")
}

function dayOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-autopilot-e2e-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  process.env.PICC_AUTH_DATA_DIR = tmp
  trading = await import("../services/trading.mjs")
  autopilot = await import("../services/autopilot.mjs")
  handlers = await import("../handlers.mjs")
})

beforeEach(async () => {
  broker.configure({ candles: UPTREND })
  await trading._resetTradingData()
  await autopilot._resetAutopilotData()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await autopilot._closeSession()
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  delete process.env.PICC_AUTH_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("demo autopilot end-to-end (mock broker, real engine)", () => {
  it("connects using the stored demo credentials and reports a healthy session", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig()
    armBroker(UPTREND)

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(broker.log.connects).toHaveLength(1)
    expect(broker.log.connects[0]).toMatchObject({ token: "e2e-token", isDemo: true })
    expect(String(broker.log.connects[0].wsUrl)).toMatch(/^wss:\/\//)

    const status = await autopilot.demoStatus()
    expect(status.connected).toBe(true)
    expect(status.demo).toBe(true)
    expect(status.sessionError).toBeNull()
    expect(status.autopilot.running).toBe(false)
  })

  it("refuses to connect a live account through the mock broker", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig()
    armBroker(UPTREND)
    await autopilot._closeSession()

    await expect(broker.connectTradingSession({ token: "e2e-token", isDemo: false })).rejects.toThrow(
      /live trading is disabled/
    )
  })

  it("fetches OHLC candles for the configured asset, timeframe and count", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig({ assetId: "BTCUSD", timeframe: 60, count: 120 })
    armBroker(UPTREND)

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(broker.log.candleCalls).toHaveLength(1)
    expect(broker.log.candleCalls[0]).toEqual({ assetId: "BTCUSD", period: 60, count: 120 })
    expect(broker.log.candleCalls[0].count).toBeLessThanOrEqual(UPTREND.length)
    const last = UPTREND[UPTREND.length - 1]
    expect(last.high).toBeGreaterThanOrEqual(last.close)
    expect(last.low).toBeLessThanOrEqual(last.open)
  })

  it("computes BUY from the real decision engine on uptrend candles and places a demo call", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig()
    armBroker(UPTREND)

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(out.reason).toMatch(/backtested/i)
    expect(out.direction).toBe("call")
    expect(out.amount).toBeGreaterThanOrEqual(1)
    expect(out.amount).toBeLessThanOrEqual(1000)
    expect(broker.log.buys).toHaveLength(1)
    expect(broker.log.buys[0]).toMatchObject({ assetId: "BTCUSD", type: "call", duration: 60 })
    expect(out.deal.serverId).toBe(broker.log.buys[0].serverId)
    expect(out.deal.status).toBe("active")

    const status = await autopilot.demoStatus()
    expect(status.autopilot.lastRun.ok).toBe(true)
    expect(status.autopilot.lastRun.direction).toBe("call")
    expect(status.autopilot.lastDecision).toMatch(/call/)
  })

  it("computes SELL from the real decision engine on downtrend candles and places a demo put", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig()
    armBroker(DOWNTREND)

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(out.direction).toBe("put")
    expect(broker.log.buys).toHaveLength(1)
    expect(broker.log.buys[0].type).toBe("put")
  })

  it("holds on flat candles — the real engine produces no directional signal", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig({ minConfidence: 30 })
    armBroker(FLAT)

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/directional signal/)
    expect(broker.log.buys).toHaveLength(0)
  })

  it("auto-closes the demo trade after expiry and records the settled deal plus feedback", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig()
    armBroker(UPTREND, { expiryMs: 150, closePriceFactor: 1.02 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    const boughtAt = broker.log.buys[0].at

    const settled = await waitFor(async () => {
      const { deals } = await autopilot.demoDeals()
      return deals.find((d) => d.serverId === out.deal.serverId) ?? null
    })
    expect(settled.serverId).toBe(out.deal.serverId)
    expect(settled.status).toBe("closed")
    expect(settled.result).toBe("win")
    expect(settled.profit).toBeGreaterThan(0)
    expect(settled.closePrice).toBeGreaterThan(settled.openPrice)
    expect(Date.parse(settled.closedAt)).toBeGreaterThanOrEqual(boughtAt + 140)

    const status = await autopilot.demoStatus()
    expect(status.todayPnl).toBeGreaterThan(0)
    expect(status.todayTrades).toBe(1)

    const acc = await waitFor(async () => {
      const a = await trading.signalAccuracy()
      return a.total === 1 ? a : null
    })
    expect(acc.wins).toBe(1)
    const sig = (await trading.recentSignals())[0]
    expect(sig.source).toBe("autopilot")
    expect(sig.status).toBe("resolved")
    expect(sig.resolution).toBe("win")
  })

  it("supports explicit close requests through the broker session", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig()
    armBroker(UPTREND, { expiryMs: 5000 })

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    const status = await autopilot.demoStatus()
    expect(status.openDeals).toHaveLength(1)

    const session = await broker.connectTradingSession({ token: "e2e-token", isDemo: true })
    const closed = await session.closeTrade(out.deal.serverId)
    expect(closed.status).toBe("closed")

    await waitFor(async () => {
      const s = await autopilot.demoStatus()
      return s.openDeals.length === 0 ? s : null
    })
  })

  it("schedules the full 5-second human-review window before execution", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await autopilot.saveAutopilotConfig({ enabled: true, minConfidence: 50, cooldownMs: 10000 })
    armBroker(UPTREND)

    const cfg = await autopilot.getAutopilotConfig()
    expect(cfg.humanReviewMs).toBe(5000)

    const scheduled = []
    const realSetTimeout = globalThis.setTimeout.bind(globalThis)
    globalThis.setTimeout = (fn, ms, ...rest) => {
      scheduled.push({ ms: Number(ms), at: Date.now() })
      return realSetTimeout(fn, 0, ...rest)
    }
    try {
      const out = await autopilot.autopilotTick()
      expect(out.ok).toBe(true)
      const review = scheduled.find((s) => s.ms === cfg.humanReviewMs)
      expect(review).toBeDefined()
      expect(broker.log.buys).toHaveLength(1)
      expect(review.at).toBeLessThanOrEqual(broker.log.buys[0].at)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  it("waits the configured review period in real time before placing the trade", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig({ humanReviewMs: 250 })
    armBroker(UPTREND)

    const t0 = Date.now()
    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    const elapsedToBuy = broker.log.buys[0].at - t0
    expect(elapsedToBuy).toBeGreaterThanOrEqual(240)
  })
})

describe("safety limits", () => {
  it("enforces the max daily trades limit across consecutive ticks", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig({ maxDailyTrades: 2 })
    armBroker(UPTREND)

    const first = await autopilot.autopilotTick()
    expect(first.ok).toBe(true)
    await waitFor(async () => (await autopilot.demoStatus()).todayTrades >= 1)
    await autopilot.saveAutopilotConfig({ lastEntryAt: 0 })

    const second = await autopilot.autopilotTick()
    expect(second.ok).toBe(true)
    await waitFor(async () => (await autopilot.demoStatus()).todayTrades >= 2)
    await autopilot.saveAutopilotConfig({ lastEntryAt: 0 })

    const third = await autopilot.autopilotTick()
    expect(third.ok).toBe(false)
    expect(third.reason).toMatch(/cap 2 reached/)
    expect(broker.log.buys).toHaveLength(2)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/\[picc-autopilot\] safety limit engaged — daily trade cap 2 reached/))
  })

  it("stops trading once the daily loss limit is hit and logs a clear warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    await armConfig({ dailyLossLimitPct: 10 })
    armBroker(UPTREND)

    const first = await autopilot.autopilotTick()
    expect(first.ok).toBe(true)
    await waitFor(async () => (await autopilot.demoStatus()).todayTrades >= 1)
    const cfg = await autopilot.getAutopilotConfig()
    expect(cfg.dayKey).toBe(dayOffset(0))
    expect(cfg.dayStartBalance).toBe(10000)

    const file = JSON.parse(await readFile(join(tmp, "trading-demo-deals.json"), "utf8"))
    file.deals.unshift({
      serverId: "seeded-loss",
      assetId: "BTCUSD",
      type: "put",
      amount: 2000,
      result: "loss",
      profit: -2000,
      recordAt: `${dayOffset(0)}T09:00:00.000Z`,
      closedAt: `${dayOffset(0)}T09:01:00.000Z`
    })
    await seedDeals(file.deals)
    await autopilot.saveAutopilotConfig({ lastEntryAt: 0 })

    const second = await autopilot.autopilotTick()
    expect(second.ok).toBe(false)
    expect(second.reason).toMatch(/loss limit 10% reached/)
    expect(broker.log.buys).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/safety limit engaged — daily loss limit/))

    const status = await autopilot.demoStatus()
    expect(status.todayPnl).toBeLessThanOrEqual(-1000)
  })

  it("resets safety limits on a new day — stale caps and losses never carry over", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    armBroker(UPTREND)
    const yesterday = dayOffset(-1)
    await writeFile(
      join(tmp, "trading-autopilot.json"),
      JSON.stringify({
        enabled: true,
        minConfidence: 50,
        cooldownMs: 10000,
        humanReviewMs: 0,
        maxDailyTrades: 1,
        dailyLossLimitPct: 10,
        dayKey: yesterday,
        dayStartBalance: 10000
      }),
      "utf8"
    )
    await seedDeals([
      { serverId: "old-1", assetId: "BTCUSD", type: "call", amount: 100, result: "loss", profit: -3000, recordAt: `${yesterday}T10:00:00.000Z`, closedAt: `${yesterday}T10:01:00.000Z` },
      { serverId: "old-2", assetId: "BTCUSD", type: "put", amount: 100, result: "loss", profit: -3000, recordAt: `${yesterday}T11:00:00.000Z`, closedAt: `${yesterday}T11:01:00.000Z` },
      { serverId: "old-3", assetId: "BTCUSD", type: "call", amount: 100, result: "loss", profit: -3000, recordAt: `${yesterday}T12:00:00.000Z`, closedAt: `${yesterday}T12:01:00.000Z` }
    ])

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(true)
    expect(broker.log.buys).toHaveLength(1)

    await waitFor(async () => (await autopilot.demoStatus()).todayTrades >= 1)
    const cfg = await autopilot.getAutopilotConfig()
    expect(cfg.dayKey).toBe(dayOffset(0))
    expect(cfg.dayStartBalance).toBe(10000)
    const status = await autopilot.demoStatus()
    expect(status.todayPnl).toBeGreaterThan(0)
    expect(status.todayTrades).toBe(1)
  })

  it("stores safety limits through the settings endpoint and enforces them at runtime", async () => {
    await trading.saveCredentials({ expertoptionToken: "e2e-token", expertoptionDemo: true })
    armBroker(UPTREND)

    function makeReq(method, url, body) {
      const raw = body !== undefined ? JSON.stringify(body) : null
      return {
        method,
        url,
        headers: { host: "localhost", "content-type": "application/json" },
        raw,
        on(evt, cb) {
          if (evt === "data" && raw != null) cb(raw)
          if (evt === "end") cb()
        }
      }
    }
    async function call(method, path, body) {
      const res = {
        status: null,
        body: null,
        writeHead(status) {
          this.status = status
        },
        end(payload) {
          this.body = payload ? JSON.parse(payload) : null
        }
      }
      await handlers.handleApi(makeReq(method, path, body), res, path)
      return res
    }

    const post = await call("POST", "/api/trading/autopilot", {
      enabled: true,
      minConfidence: 50,
      cooldownMs: 10000,
      humanReviewMs: 0,
      maxDailyTrades: 4,
      dailyLossLimitPct: 7
    })
    expect(post.status).toBe(200)
    expect(post.body.ok).toBe(true)
    expect(post.body.config.maxDailyTrades).toBe(4)
    expect(post.body.config.dailyLossLimitPct).toBe(7)
    expect(post.body.config.enabled).toBe(true)

    const get = await call("GET", "/api/trading/autopilot")
    expect(get.status).toBe(200)
    expect(get.body.config.maxDailyTrades).toBe(4)
    expect(get.body.config.dailyLossLimitPct).toBe(7)

    const today = dayOffset(0)
    await seedDeals([
      { serverId: "ep-1", assetId: "BTCUSD", type: "call", amount: 10, result: "draw", profit: 0, recordAt: `${today}T09:00:00.000Z`, closedAt: `${today}T09:01:00.000Z` },
      { serverId: "ep-2", assetId: "BTCUSD", type: "call", amount: 10, result: "draw", profit: 0, recordAt: `${today}T09:05:00.000Z`, closedAt: `${today}T09:06:00.000Z` },
      { serverId: "ep-3", assetId: "BTCUSD", type: "call", amount: 10, result: "draw", profit: 0, recordAt: `${today}T09:10:00.000Z`, closedAt: `${today}T09:11:00.000Z` },
      { serverId: "ep-4", assetId: "BTCUSD", type: "call", amount: 10, result: "draw", profit: 0, recordAt: `${today}T09:15:00.000Z`, closedAt: `${today}T09:16:00.000Z` }
    ])

    const out = await autopilot.autopilotTick()
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/cap 4 reached/)
    expect(broker.log.buys).toHaveLength(0)
  })
})

describe("overlay autopilot panel", () => {
  const render = (auto, demo) => globalThis.piccRenderAutopilotPanel({ auto, demo })

  it("shows the current state: idle, running, or paused by a safety limit", () => {
    expect(render({}, {})).toContain("Idle")

    const running = render({ enabled: true }, {})
    expect(running).toContain("Running")
    expect(running).not.toContain("Paused")

    const paused = render(
      { enabled: true },
      { todayTrades: 5, autopilot: { maxDailyTrades: 5 } }
    )
    expect(paused).toContain("Paused")
    expect(paused).toContain("safety limit")
  })

  it("flags demo mode with a DEMO/LIVE badge", () => {
    expect(render({}, { demo: true })).toContain("DEMO")
    const live = render({}, { demo: false })
    expect(live).toContain("LIVE")
  })

  it("shows the last trade signal with direction, confidence and time", () => {
    const html = render(
      {},
      {
        autopilot: {
          lastRun: { at: "2026-08-23T10:11:12.000Z", direction: "call", confidence: 72 },
          lastDecision: "call 72%"
        }
      }
    )
    expect(html).toContain("Last signal")
    expect(html).toContain("CALL")
    expect(html).toContain("72%")
    expect(html).toContain("10:11:12")
    expect(html).toContain("Last: call 72%")
  })

  it("shows safety-limit status: trades remaining and loss remaining", () => {
    const html = render(
      {},
      {
        currency: "USD",
        todayTrades: 2,
        todayPnl: -400,
        autopilot: { maxDailyTrades: 5, dailyLossLimitPct: 10, dayStartBalance: 10000 }
      }
    )
    expect(html).toContain("Safety \u00b7 trades")
    expect(html).toContain("2/5")
    expect(html).toContain("3 left")
    expect(html).toContain("Safety \u00b7 loss")
    expect(html).toContain("$600.00 left")
    expect(html).toContain("10% cap")
  })

  it("shows session health: connected, disconnected, or expired", () => {
    expect(render({}, { connected: true })).toContain("Connected")

    const disconnected = render({}, { connected: false })
    expect(disconnected).toContain("Disconnected")

    const expired = render(
      {},
      { connected: false, sessionError: "ExpertOption rejected the session token (auth failed)" }
    )
    expect(expired).toContain("Expired")
  })

  it("renders through the same dockable renderer used by content.js", () => {
    const auto = { enabled: true, assetId: "BTCUSD", minConfidence: 55 }
    const demo = {
      demo: true,
      connected: true,
      currency: "USD",
      todayPnl: 42.5,
      todayTrades: 1,
      autopilot: { maxDailyTrades: 3, dailyLossLimitPct: 10, dayStartBalance: 10000 }
    }
    const html = render(auto, demo)
    expect(html).toContain("Running")
    expect(html).toContain("BTCUSD")
    expect(html).toContain("Min confidence")
    expect(html).toContain("Today PnL")
    expect(html).toContain("$42.50")
    expect(html).toContain("1/3")
  })
})
