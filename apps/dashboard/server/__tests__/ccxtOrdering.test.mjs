// Command Centre slice 6 — ccxtOrdering.mjs: the deliberate createOrder
// exception seam. EVERY venue call is a fixture exchange injected through
// _setCcxtLibForTests: CI never talks to a live exchange (venue-touching code
// is never exercised live in the suite). The honest failure shapes (missing
// keys, venue refusal, unobservable balance, unpriced assets) are asserted
// exactly — the seam refuses over-cap orders, never silently shrinks, and the
// equity math never fabricates a number it cannot price.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeExchange({ balance = {}, tickers = {}, orders = {}, createOrderImpl = null } = {}) {
  const calls = { createOrder: [], fetchOrder: [], fetchTicker: [], fetchBalance: 0 }
  const exchange = {
    id: "binance",
    calls,
    balance,
    tickers,
    sandbox: false,
    setSandboxMode(v) {
      exchange.sandbox = v
    },
    async fetchBalance() {
      calls.fetchBalance++
      return { total: exchange.balance }
    },
    async fetchTicker(symbol) {
      calls.fetchTicker.push(symbol)
      if (!(symbol in exchange.tickers)) throw new Error(`fixture: unknown ticker ${symbol}`)
      return exchange.tickers[symbol]
    },
    async createOrder(...args) {
      calls.createOrder.push(args)
      if (createOrderImpl) return createOrderImpl(...args)
      return {
        id: "o-1",
        symbol: args[0],
        type: args[1],
        side: args[2],
        amount: args[3],
        price: args[4],
        filled: args[3],
        average: args[4],
        status: "closed",
        timestamp: 1_700_000_000_000
      }
    },
    async fetchOrder(id, symbol) {
      calls.fetchOrder.push([id, symbol])
      if (!(id in orders)) throw new Error(`fixture: order ${id} not found`)
      return orders[id]
    }
  }
  return exchange
}

function fakeLib(exchanges) {
  const lib = {}
  for (const [id, ex] of Object.entries(exchanges)) {
    lib[id] = function Ctor() {
      return ex
    }
  }
  return lib
}

const BINANCE_KEYS = {
  PICC_CCXT_APIKEY_BINANCE: "key-binance",
  PICC_CCXT_SECRET_BINANCE: "secret-binance"
}

describe("ccxtOrdering — credentials", () => {
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_CCXT_")) delete process.env[k]
    }
  })

  it("keys are read from the process environment per exchange", async () => {
    const mod = await import("../services/ccxtOrdering.mjs")
    expect(mod.ccxtKeysForExchange("binance")).toBeNull()
    Object.assign(process.env, BINANCE_KEYS)
    expect(mod.ccxtKeysForExchange("binance")).toEqual({
      apiKey: "key-binance",
      secret: "secret-binance",
      password: undefined,
      sandbox: false
    })
  })

  it("never returns key material in any error message", async () => {
    const mod = await import("../services/ccxtOrdering.mjs")
    Object.assign(process.env, BINANCE_KEYS)
    const ex = makeExchange({ createOrderImpl: () => { throw new Error("KRAKEN secret-binance leaked") } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000 })
    ).rejects.toThrow("secret-binance")
  })

  it("a per-exchange sandbox env flag is honored BEFORE any order can exist", async () => {
    const mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
    Object.assign(process.env, BINANCE_KEYS, { PICC_CCXT_SANDBOX_BINANCE: "1" })
    const ex = makeExchange()
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000 })
    expect(ex.sandbox).toBe(true)
  })
})

describe("ccxtOrdering — placeCcxtOrder (the ONLY createOrder caller)", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ccxt-order-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
    Object.assign(process.env, BINANCE_KEYS)
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_CCXT_")) delete process.env[k]
    }
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("places a LIMIT order through the venue with the clientOrderId idempotency param", async () => {
    const ex = makeExchange()
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const order = await mod.placeCcxtOrder({
      exchange: "binance",
      symbol: "BTCUSDT",
      side: "buy",
      amount: 0.01,
      price: 500,
      clientOrderId: "picc-cc-abc"
    })
    expect(ex.calls.createOrder).toHaveLength(1)
    // never a market order: the type is structurally hardcoded to "limit"
    expect(ex.calls.createOrder[0][1]).toBe("limit")
    expect(ex.calls.createOrder[0][0]).toBe("BTC/USDT")
    expect(ex.calls.createOrder[0][3]).toBe(0.01)
    expect(ex.calls.createOrder[0][4]).toBe(500)
    expect(ex.calls.createOrder[0][5]).toEqual({ clientOrderId: "picc-cc-abc" })
    expect(order).toMatchObject({ id: "o-1", symbol: "BTC/USDT", side: "buy", status: "closed", filled: 0.01 })
  })

  it("REFUSES a notional over the hard cap — the venue is never reached (envelope defense-in-depth)", async () => {
    const ex = makeExchange()
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 2, price: 100 })
    ).rejects.toThrow("hard cap")
    expect(ex.calls.createOrder).toHaveLength(0)
  })

  it("throws when no credentials are configured — the leg is honestly inoperable, never keyless", async () => {
    delete process.env.PICC_CCXT_APIKEY_BINANCE
    delete process.env.PICC_CCXT_SECRET_BINANCE
    mod._setCcxtLibForTests(fakeLib({ binance: makeExchange() }))
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 500 })
    ).rejects.toThrow("no BINANCE credentials configured")
  })

  it("rejects malformed inputs before any venue call", async () => {
    mod._setCcxtLibForTests(fakeLib({ binance: makeExchange() }))
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "hodl", amount: 0.01, price: 500 })
    ).rejects.toThrow("side must be buy or sell")
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: -1, price: 500 })
    ).rejects.toThrow("amount must be a positive number")
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 0 })
    ).rejects.toThrow("price must be a positive number")
  })

  it("a venue refusal surfaces as an honest wrapped error — never a partial-success claim", async () => {
    const ex = makeExchange({ createOrderImpl: () => { throw new Error("insufficient funds") } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 500 })
    ).rejects.toThrow(/ccxt order refused by binance \(buy BTC\/USDT limit 0.01 @ 500\): insufficient funds/)
  })
})

describe("ccxtOrdering — read-only verification + reference price", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ccxt-rw-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_CCXT_")) delete process.env[k]
    }
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("verifyCcxtFill reads the order READ-ONLY with the normalized symbol", async () => {
    Object.assign(process.env, BINANCE_KEYS)
    const ex = makeExchange({
      orders: {
        "venue-77": { id: "venue-77", symbol: "BTC/USDT", side: "buy", type: "limit", amount: 0.01, price: 500, filled: 0.005, average: 495, status: "partially_filled", timestamp: 1_700_000_000_000 }
      }
    })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const fill = await mod.verifyCcxtFill({ exchange: "binance", symbol: "BTCUSDT", orderId: "venue-77" })
    expect(ex.calls.fetchOrder).toEqual([["venue-77", "BTC/USDT"]])
    expect(fill).toMatchObject({ id: "venue-77", symbol: "BTC/USDT", filled: 0.005, average: 495, status: "partially_filled" })
  })

  it("verifyCcxtFill returns null — never a fabricated fill — when keys or the venue are absent", async () => {
    const fill = await mod.verifyCcxtFill({ exchange: "binance", symbol: "BTC/USDT", orderId: "venue-77" })
    expect(fill).toBeNull()
    Object.assign(process.env, BINANCE_KEYS)
    const ex = makeExchange({ orders: {} }) // fetchOrder throws "not found"
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const missing = await mod.verifyCcxtFill({ exchange: "binance", symbol: "BTC/USDT", orderId: "nope" })
    expect(missing).toBeNull()
  })

  it("fetchReferencePrice is keyless and null on venue failure", async () => {
    const ex = makeExchange({ tickers: { "BTC/USDT": { last: 60_500, bid: 60_490, ask: 60_510 } } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const ref = await mod.fetchReferencePrice({ exchange: "binance", symbol: "BTCUSDT" })
    expect(ref).toMatchObject({ exchange: "binance", symbol: "BTC/USDT", price: 60_500, bid: 60_490, ask: 60_510 })
    const failing = await mod.fetchReferencePrice({ exchange: "binance", symbol: "DOGE/USDT" })
    expect(failing).toBeNull()
  })
})

describe("ccxtOrdering — equity observation + persisted day baseline", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ccxt-eq-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
    Object.assign(process.env, BINANCE_KEYS)
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_CCXT_")) delete process.env[k]
    }
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("stablecoin wallet → USDT-terms equity, dayLossPct 0 on the first (baseline-seeding) observation", async () => {
    const ex = makeExchange({ balance: { USDT: 100, USDC: 5 } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const obs = await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T12:00:00Z") })
    expect(obs).toMatchObject({ ok: true, equityUsd: 105, dayStartEquityUsd: 105, dayLossPct: 0, baselineSeeded: true })
  })

  it("a later same-day observation measures REAL day P/L from the seeded baseline", async () => {
    const ex = makeExchange({ balance: { USDT: 100 } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T08:00:00Z") })
    ex.calls.fetchBalance = 0
    ex.balance = { USDT: 95 }
    const obs = await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T12:00:00Z") })
    expect(obs.ok).toBe(true)
    expect(obs.equityUsd).toBe(95)
    expect(obs.dayStartEquityUsd).toBe(100)
    expect(obs.baselineSeeded).toBe(false)
    expect(obs.dayLossPct).toBe(5)
  })

  it("a UTC day rollover SEEDS A NEW baseline — today's loss starts at zero again", async () => {
    const ex = makeExchange({ balance: { USDT: 100 } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T23:00:00Z") })
    ex.balance = { USDT: 90 }
    const nextDay = await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-06T01:00:00Z") })
    expect(nextDay.baselineSeeded).toBe(true)
    expect(nextDay.dayStartEquityUsd).toBe(90)
    expect(nextDay.dayLossPct).toBe(0)
  })

  it("unpriced assets make the observation HONESTLY unobservable — never a fabricated equity", async () => {
    const ex = makeExchange({ balance: { USDT: 50, SHIBA: 1_000_000 } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const obs = await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T12:00:00Z") })
    expect(obs.ok).toBe(false)
    expect(obs.reason).toContain("unpriced assets: SHIBA")
    expect(obs.fresh).toBe(false)
  })

  it("a NON-quote asset IS priced live when the venue serves its ticker", async () => {
    const ex = makeExchange({
      balance: { USDT: 50, BTC: 0.001 },
      tickers: { "BTC/USDT": { last: 60_000 } }
    })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const obs = await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T12:00:00Z") })
    expect(obs.ok).toBe(true)
    expect(obs.equityUsd).toBe(50 + 0.001 * 60_000)
    expect(ex.calls.fetchTicker).toContain("BTC/USDT")
  })

  it("missing keys or an unobservable balance are honest failures — not zeros", async () => {
    delete process.env.PICC_CCXT_APIKEY_BINANCE
    delete process.env.PICC_CCXT_SECRET_BINANCE
    const noKeys = await mod.observeCcxtEquity({ exchange: "binance" })
    expect(noKeys).toMatchObject({ ok: false, reason: "ccxt-keys-not-configured" })
    Object.assign(process.env, BINANCE_KEYS)
    const ex = makeExchange({ balance: null })
    ex.fetchBalance = async () => { throw new Error("network down") }
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const down = await mod.observeCcxtEquity({ exchange: "binance" })
    expect(down).toMatchObject({ ok: false, reason: "balance-unobservable" })
  })

  it("the day baseline SURVIVES a restart (persisted equity file)", async () => {
    const ex = makeExchange({ balance: { USDT: 100 } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T08:00:00Z") })
    // "restart": the module is loaded fresh and boots its equity store from disk
    ex.balance = { USDT: 95 }
    vi.resetModules()
    const fresh = await import("../services/ccxtOrdering.mjs")
    fresh._setCcxtLibForTests(fakeLib({ binance: ex }))
    const after = await fresh.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T12:00:00Z") })
    expect(after.ok).toBe(true)
    expect(after.dayStartEquityUsd).toBe(100) // the pre-restart baseline, NOT a reset to 95
    expect(after.dayLossPct).toBe(5)
  })

  it("ccxtEquityLastObserved reports the FRESHEST observation across exchanges — null before anything is observed", async () => {
    expect(mod.ccxtEquityLastObserved()).toBeNull() // nothing observed yet → not-wired surface
    const binance = makeExchange({ balance: { USDT: 100 } })
    mod._setCcxtLibForTests(fakeLib({ binance }))
    await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T12:00:00Z") })
    const last = mod.ccxtEquityLastObserved()
    expect(last.exchange).toBe("binance")
    expect(last.lastObservedAt).toBe("2026-09-05T12:00:00.000Z")
    expect(typeof last.ageSec).toBe("number")
    // an OLDER observation elsewhere never shadows the freshest one
    Object.assign(process.env, BINANCE_KEYS, { PICC_CCXT_APIKEY_KRAKEN: "k", PICC_CCXT_SECRET_KRAKEN: "s" })
    const kraken = makeExchange({ balance: { USDT: 40 } })
    mod._setCcxtLibForTests(fakeLib({ binance, kraken }))
    await mod.observeCcxtEquity({ exchange: "kraken", now: Date.parse("2026-09-05T09:00:00Z") })
    expect(mod.ccxtEquityLastObserved().exchange).toBe("binance")
  })
})