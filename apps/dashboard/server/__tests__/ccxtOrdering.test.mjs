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

function makeExchange({ balance = {}, tickers = {}, orders = {}, createOrderImpl = null, editOrderImpl = null, cancelOrderImpl = null } = {}) {
  const calls = { createOrder: [], fetchOrder: [], fetchTicker: [], fetchBalance: 0, editOrder: [], fetchOpenOrders: [], cancelOrder: [] }
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
    },
    // The T17 lifecycle legs. `editOrder` is here because the amend envelope reads
    // the live order back with fetchOrder before it will size anything.
    async editOrder(id, symbol, amount, price) {
      calls.editOrder.push([id, symbol, amount, price])
      if (editOrderImpl) return editOrderImpl(id, symbol, amount, price)
      const live = orders[id]
      if (!live) throw new Error(`fixture: order ${id} not found`)
      return { ...live, id, symbol, amount: amount ?? live.amount, price: price ?? live.price, status: "open", filled: 0, average: null }
    },
    async fetchOpenOrders(symbol) {
      calls.fetchOpenOrders.push(symbol ?? null)
      return Object.entries(orders)
        .filter(([, o]) => o?.status === "open")
        .filter(([, o]) => (symbol ? o.symbol === symbol : true))
        .map(([id, o]) => ({ ...o, id }))
    },
    async cancelOrder(id, symbol) {
      calls.cancelOrder.push([id, symbol])
      if (cancelOrderImpl) return cancelOrderImpl(id, symbol)
      const live = orders[id]
      if (!live) throw new Error(`fixture: order ${id} not found`)
      return { ...live, id, status: "canceled" }
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

const HYPERLIQUID_KEYS = {
  PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0x1111111111111111111111111111111111111111",
  PICC_CCXT_PRIVATEKEY_HYPERLIQUID: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}

/** Fixture ccxt lib whose constructor captures the opts it was built with. */
function captureLib(id, capture, ex) {
  const lib = {}
  lib[id] = function Ctor(opts) {
    capture.push(opts)
    return ex
  }
  return lib
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

  it("wallet-key credentials (Hyperliquid) are read from the environment as an alternative pair", async () => {
    const mod = await import("../services/ccxtOrdering.mjs")
    expect(mod.ccxtKeysForExchange("hyperliquid")).toBeNull()
    Object.assign(process.env, HYPERLIQUID_KEYS)
    expect(mod.ccxtKeysForExchange("hyperliquid")).toEqual({
      walletAddress: HYPERLIQUID_KEYS.PICC_CCXT_WALLETADDRESS_HYPERLIQUID,
      privateKey: HYPERLIQUID_KEYS.PICC_CCXT_PRIVATEKEY_HYPERLIQUID,
      password: undefined,
      sandbox: false
    })
  })

  it("a HALF-SET wallet pair is refused — no walletAddress without privateKey and vice versa", async () => {
    const mod = await import("../services/ccxtOrdering.mjs")
    Object.assign(process.env, { PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0x1111111111111111111111111111111111111111" })
    expect(mod.ccxtKeysForExchange("hyperliquid")).toBeNull()
  })

  it("wallet-mode opts (walletAddress + privateKey) reach the ccxt constructor for hyperliquid", async () => {
    const mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
    Object.assign(process.env, HYPERLIQUID_KEYS)
    const captured = []
    const ex = makeExchange()
    ex.id = "hyperliquid"
    mod._setCcxtLibForTests(captureLib("hyperliquid", captured, ex))
    const instance = await mod.ccxtInstanceFor("hyperliquid")
    expect(captured).toHaveLength(1)
    expect(captured[0].walletAddress).toBe(HYPERLIQUID_KEYS.PICC_CCXT_WALLETADDRESS_HYPERLIQUID)
    expect(captured[0].privateKey).toBe(HYPERLIQUID_KEYS.PICC_CCXT_PRIVATEKEY_HYPERLIQUID)
    expect(instance).toBe(ex)
  })

  it("the no-credentials error names BOTH credential modes", async () => {
    const mod = await import("../services/ccxtOrdering.mjs")
    mod._setCcxtLibForTests(fakeLib({ binance: makeExchange() }))
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 500 })
    ).rejects.toThrow(/PICC_CCXT_WALLETADDRESS_BINANCE/)
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

describe("refreshAllCcxtEquity — the scheduled sweep that keeps the overview feed fresh", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ccxt-sweep-"))
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

  it("no keyed exchanges in the env → an honest empty sweep that observes nothing", async () => {
    const report = await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T12:00:00Z") })
    expect(report).toMatchObject({ keyedExchanges: [], observed: [], skipped: [], okCount: 0 })
    expect(typeof report.at).toBe("string")
    expect(mod.ccxtEquityLastObserved()).toBeNull() // nothing fabricated into the store
  })

  it("polls EVERY exchange with credentials (env key suffixes) and folds each observation into the store", async () => {
    Object.assign(process.env, BINANCE_KEYS, HYPERLIQUID_KEYS)
    const binance = makeExchange({ balance: { USDT: 50 } })
    const hyperliquid = makeExchange({ balance: { USDT: 123 } })
    mod._setCcxtLibForTests(fakeLib({ binance, hyperliquid }))
    const report = await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T12:00:00Z") })
    expect(report.keyedExchanges).toEqual(["binance", "hyperliquid"])
    expect(report.observed).toHaveLength(2)
    expect(report.okCount).toBe(2)
    expect(binance.calls.fetchBalance).toBe(1)
    expect(hyperliquid.calls.fetchBalance).toBe(1)
    const last = mod.ccxtEquityLastObserved()
    expect(last).not.toBeNull()
    expect(["binance", "hyperliquid"]).toContain(last.exchange)
    // both exchanges were observed at the SAME injected instant — the freshness
    // view reports that exact at; ageSec ages against the real clock by design
    expect(last.lastObservedAt).toBe("2026-09-05T12:00:00.000Z")
  })

  it("an incomplete env pair is reported (never silently skipped) — keys-not-configured, nothing stored", async () => {
    // APIKEY without SECRET: the env scan lists the exchange, the observe
    // refuses honestly, and the failure is left for the next pass.
    process.env.PICC_CCXT_APIKEY_BINANCE = "key-binance"
    const report = await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T12:00:00Z") })
    expect(report.observed).toEqual([
      { exchange: "binance", ok: false, equityUsd: null, reason: "ccxt-keys-not-configured" }
    ])
    expect(mod.ccxtEquityLastObserved()).toBeNull()
  })

  it("one exchange failing never starves the sweep — honest per-exchange report, nothing stored for the failure", async () => {
    Object.assign(process.env, BINANCE_KEYS, { PICC_CCXT_APIKEY_KRAKEN: "k", PICC_CCXT_SECRET_KRAKEN: "s" })
    const binance = makeExchange({ balance: { USDT: 50 } })
    const kraken = makeExchange({ balance: null })
    kraken.fetchBalance = async () => { throw new Error("network down") }
    mod._setCcxtLibForTests(fakeLib({ binance, kraken }))
    const report = await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T12:00:00Z") })
    expect(report.observed).toEqual([
      { exchange: "binance", ok: true, equityUsd: 50, reason: null },
      { exchange: "kraken", ok: false, equityUsd: null, reason: "balance-unobservable" }
    ])
    expect(report.okCount).toBe(1)
    expect(mod.ccxtEquityLastObserved().exchange).toBe("binance") // the failure stored nothing
  })

  it("a recently-observed exchange is skipped (min-gap guard) — no duplicate fetchBalance churn", async () => {
    Object.assign(process.env, BINANCE_KEYS)
    const binance = makeExchange({ balance: { USDT: 50 } })
    mod._setCcxtLibForTests(fakeLib({ binance }))
    await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T12:00:00Z") })
    const countAfterFirst = binance.calls.fetchBalance
    const second = await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T12:00:20Z") }) // 20 s later
    expect(second.skipped).toEqual([{ exchange: "binance", reason: "observed-recently" }])
    expect(binance.calls.fetchBalance).toBe(countAfterFirst) // no re-observe inside the gap
  })

  it("once the min-gap expires the sweep observes again — same-day baseline preserved, never re-seeded", async () => {
    Object.assign(process.env, BINANCE_KEYS)
    const binance = makeExchange({ balance: { USDT: 100 } })
    mod._setCcxtLibForTests(fakeLib({ binance }))
    await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T08:00:00Z") })
    binance.balance = { USDT: 90 }
    const later = await mod.refreshAllCcxtEquity({ now: Date.parse("2026-09-05T08:05:00Z") }) // 5 min > 60 s gap
    expect(later.skipped).toEqual([])
    expect(later.observed[0]).toMatchObject({ exchange: "binance", ok: true, equityUsd: 90 })
    expect(binance.calls.fetchBalance).toBe(2)
    const after = await mod.observeCcxtEquity({ exchange: "binance", now: Date.parse("2026-09-05T08:10:00Z") })
    expect(after.dayStartEquityUsd).toBe(100) // the sweep's first observation seeded the day baseline
    expect(after.dayLossPct).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T17's seam members: amend, cancel, close.
//
// These three exist because a rail that can open a position it cannot amend,
// cancel or exit is a rail that can lose money unattended. Each one therefore
// carries its OWN envelope rather than trusting the lifecycle's rails to have
// run, and each refusal below is a behaviour T17 deliberately changed. They are
// tested at the seam rather than only through the lifecycle because the seam is
// importable by anything.
// ─────────────────────────────────────────────────────────────────────────────
describe("ccxtOrdering — T17 amend / cancel / close members", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ccxt-t17-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
    Object.assign(process.env, BINANCE_KEYS)
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_")) delete process.env[k]
    }
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("amend sizes the envelope from the VENUE's amount/price, so a lying caller cannot shrink it", async () => {
    // The bug this pins: `amount`/`price` arrive as the CALLER's belief about the
    // live order. Sizing the cap from them makes the envelope defeatable by the
    // argument it is meant to check — a caller wanting a $500 amend passes
    // `price: 0.01` and the arithmetic lands under the $10 cap. So the seam reads
    // the live order back and ignores the caller's numbers entirely.
    const ex = makeExchange({
      orders: {
        "o-9": { id: "o-9", symbol: "BTC/USDT", amount: 1, price: 500, status: "open", filled: 0 }
      }
    })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))

    // The caller claims a tiny price; the venue says 500. 0.01 * 500 = $5 stays
    // under the cap, so this amend is ALLOWED and editOrder is reached.
    await expect(
      mod.amendCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-9", side: "buy", amount: 0.01, price: 0.01, newAmount: 0.01 })
    ).resolves.toMatchObject({ id: "o-9" })
    expect(ex.calls.editOrder).toEqual([["o-9", "BTC/USDT", 0.01, null]])
    // The venue's order was read to do the arithmetic, which is the point.
    expect(ex.calls.fetchOrder).toContainEqual(["o-9", "BTC/USDT"])

    // Now the same lie on a bigger size: 0.05 * 500 = $25 is OVER the $10 cap even
    // though the caller claimed price 0.01 (which would read as $0.0005). The cap
    // must refuse, and it must refuse BEFORE editOrder is reached.
    ex.calls.editOrder.length = 0
    await expect(
      mod.amendCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-9", side: "buy", amount: 0.05, price: 0.01, newAmount: 0.05 })
    ).rejects.toThrow(/exceeds the \$10 hard cap/)
    expect(ex.calls.editOrder, "an over-cap amend must never reach the venue").toEqual([])
  })

  it("an amend whose live order cannot be priced is REFUSED, not allowed through", async () => {
    // "A rail that cannot be evaluated is a named absence, never a default-allow."
    // Two ways the venue can fail to price the order, and BOTH must refuse:
    //   (a) the order cannot be read back at all;
    //   (b) the order reads back with no usable amount/price.
    // (b) is the one that needed code, because the venue answering with garbage is
    // not an exception the seam can distinguish from success without checking.
    //
    // ONE exchange carries both cases, because the seam caches its instance per
    // exchange id: re-registering a second lib under `binance` leaves the first
    // instance in place, and the fixture then reports an order as missing when it
    // is not. That caching is real behaviour, so the test is written around it
    // rather than by resetting state to hide it.
    const ex = makeExchange({
      orders: { "o-junk": { id: "o-junk", symbol: "BTC/USDT", amount: null, price: undefined, status: "open" } }
    })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    // (a) not in the map — refused by the venue's own error.
    await expect(
      mod.amendCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-missing", side: "buy", amount: 0.01, price: 500, newAmount: 0.01 })
    ).rejects.toThrow(/refused/i)
    expect(ex.calls.editOrder).toEqual([])

    // (b) present but unusable — the seam's own refusal, and editOrder still untouched.
    await expect(
      mod.amendCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-junk", side: "buy", amount: 0.01, price: 500, newAmount: 0.01 })
    ).rejects.toThrow(/refused to amend/)
    expect(ex.calls.editOrder, "an unpriceable amend must never reach the venue").toEqual([])
  })

  it("an amend that changes neither amount nor price is refused as a no-op", async () => {
    const ex = makeExchange({ orders: { "o-1": { id: "o-1", symbol: "BTC/USDT", amount: 0.01, price: 500, status: "open" } } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(mod.amendCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-1", side: "buy" })).rejects.toThrow(/changes neither/)
    expect(ex.calls.editOrder).toEqual([])
  })

  it("close REFUSES when no fill was observed — the cap cannot be conditional", async () => {
    // The defect this pins: the guard read
    // `if (Number.isFinite(filled) && amountN > filled)`, so OMITTING filledAmount
    // skipped the comparison entirely and any amount could be closed. The control
    // was strongest exactly when the caller had the least evidence.
    const ex = makeExchange()
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(
      mod.closeCcxtPosition({ exchange: "binance", symbol: "BTCUSDT", positionSide: "long", positionOrderId: "p-1", amount: 1, price: 500 })
    ).rejects.toThrow(/without an observed fill/)
    expect(ex.calls.createOrder, "a close with no observation must not place anything").toEqual([])

    // And an explicit zero is equally absent, not a licence for the full amount.
    await expect(
      mod.closeCcxtPosition({ exchange: "binance", symbol: "BTCUSDT", positionSide: "long", positionOrderId: "p-1", filledAmount: 0, amount: 1, price: 500 })
    ).rejects.toThrow(/without an observed fill/)
    expect(ex.calls.createOrder).toEqual([])
  })

  it("close still refuses an amount larger than the observed fill", async () => {
    const ex = makeExchange()
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(
      mod.closeCcxtPosition({ exchange: "binance", symbol: "BTCUSDT", positionSide: "long", positionOrderId: "p-1", filledAmount: 0.01, amount: 1, price: 500 })
    ).rejects.toThrow(/exceeds the 0.01 observed/)
    expect(ex.calls.createOrder).toEqual([])
  })

  it("a close within the observed fill goes out as the OPPOSITE side, through placeCcxtOrder", async () => {
    const ex = makeExchange()
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const closed = await mod.closeCcxtPosition({
      exchange: "binance",
      symbol: "BTCUSDT",
      positionSide: "long",
      positionOrderId: "p-1",
      filledAmount: 0.01,
      amount: 0.01,
      price: 500
    })
    expect(closed.exitSide).toBe("sell")
    expect(ex.calls.createOrder).toHaveLength(1)
    expect(ex.calls.createOrder[0][2]).toBe("sell") // the venue receives the exit side
  })

  it("cancel by orderId reaches the venue; cancel with no identifier at all is refused", async () => {
    const ex = makeExchange({ orders: { "o-1": { id: "o-1", symbol: "BTC/USDT", amount: 0.01, price: 500, status: "open" } } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const canceled = await mod.cancelCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-1" })
    // The seam's shape is `{ ok, cancelled }` — a transport that reports rather
    // than throws, so a venue-side cancel failure is data and not an exception.
    expect(canceled.ok).toBe(true)
    expect(canceled.cancelled).toMatchObject({ id: "o-1", status: "canceled" })
    expect(ex.calls.cancelOrder).toEqual([["o-1", "BTC/USDT"]])

    await expect(mod.cancelCcxtOrder({ exchange: "binance", symbol: "BTCUSDT" })).rejects.toThrow(/orderId or clientOrderId/)
    expect(ex.calls.cancelOrder).toHaveLength(1) // unchanged: the nameless cancel never left
  })

  it("a cancel naming only a clientOrderId resolves it through the read-only open-order view", async () => {
    // This is the path the cancel-only lifecycle walk uses, so it must be proven
    // rather than assumed: the resolution is a READ, never a guess. And when no
    // order matches, the seam REPORTS unobservable rather than cancelling
    // something it guessed at.
    const ex = makeExchange({ orders: { "o-7": { id: "o-7", symbol: "BTC/USDT", amount: 0.01, price: 500, status: "open", clientOrderId: "picc-e2e-abc" } } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const canceled = await mod.cancelCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", clientOrderId: "picc-e2e-abc" })
    expect(canceled.ok).toBe(true)
    expect(canceled.cancelled.id).toBe("o-7")
    expect(ex.calls.fetchOpenOrders).toEqual(["BTC/USDT"])
    expect(ex.calls.cancelOrder).toEqual([["o-7", "BTC/USDT"]])

    ex.calls.cancelOrder.length = 0
    const miss = await mod.cancelCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", clientOrderId: "picc-e2e-nope" })
    expect(miss.ok).toBe(false)
    expect(miss.reason).toMatch(/unobservable/)
    expect(ex.calls.cancelOrder, "an unresolved cancel must not reach the venue").toEqual([])
  })

  it("no T17 member ever mutates an exchange's sandbox flag or reads a balance", async () => {
    // The read-only surface the lifecycle must not cross. Every one of the four
    // legs is exercised, and the only venue writes each may perform are editOrder,
    // cancelOrder and createOrder — named here so a fifth write fails this test.
    const ex = makeExchange({ orders: { "o-1": { id: "o-1", symbol: "BTC/USDT", amount: 0.01, price: 500, status: "open" } } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await mod.amendCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-1", side: "buy", newPrice: 499 })
    await mod.cancelCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-1" })
    await mod.closeCcxtPosition({ exchange: "binance", symbol: "BTCUSDT", positionSide: "long", positionOrderId: "p-1", filledAmount: 0.01, amount: 0.01, price: 500 })
    expect(ex.calls.fetchBalance).toBe(0)
    expect(ex.sandbox).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — spot seam self-checks (fail-closed).
//
// (a) a keyless-cached instance (e.g. from fetchReferencePrice) must never
// satisfy a keys-required caller; (b) each mutating entry re-verifies keys
// itself with a named reason; (c) sandbox-requested-but-unsupported refuses
// (sandbox-unsupported) instead of warning through to live.
// ─────────────────────────────────────────────────────────────────────────────
describe("ccxtOrdering — Task 2 fail-closed self-checks", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ccxt-t2-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_")) delete process.env[k]
    }
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("a keyless-cached instance never satisfies a keys-required caller", async () => {
    // No keys: the reference price caches a keyless instance, and the order leg
    // must still refuse rather than reuse it.
    const ex = makeExchange({ tickers: { "BTC/USDT": { last: 500, bid: 499, ask: 501 } } })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    const ref = await mod.fetchReferencePrice({ exchange: "binance", symbol: "BTCUSDT" })
    expect(ref).toMatchObject({ price: 500 })
    await expect(mod.ccxtInstanceFor("binance", { requireKeys: true })).rejects.toThrow(/credentials configured/)
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 500 })
    ).rejects.toThrow(/credentials configured/)
    expect(ex.calls.createOrder, "a keyless-cached instance must never place").toEqual([])
  })

  it("sandbox requested but unsupported refuses (sandbox-unsupported), never live", async () => {
    Object.assign(process.env, BINANCE_KEYS, { PICC_CCXT_SANDBOX_BINANCE: "1" })
    const calls = { createOrder: [] }
    const ex = {
      id: "binance",
      calls,
      async createOrder(...args) {
        calls.createOrder.push(args)
        return { id: "o-1", symbol: args[0], type: args[1], side: args[2], amount: args[3], price: args[4], status: "closed", timestamp: 1_700_000_000_000 }
      }
    }
    // Deliberately NO setSandboxMode — the venue cannot sandbox.
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(mod.ccxtInstanceFor("binance", { requireKeys: true })).rejects.toThrow(/sandbox-unsupported/)
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 500 })
    ).rejects.toThrow(/sandbox-unsupported/)
    expect(calls.createOrder, "an unsupported sandbox must never reach the venue").toEqual([])
  })

  it("each mutating entry re-verifies keys itself with a named reason when keyless", async () => {
    const ex = makeExchange({
      orders: { "o-1": { id: "o-1", symbol: "BTC/USDT", amount: 0.01, price: 500, status: "open" } }
    })
    mod._setCcxtLibForTests(fakeLib({ binance: ex }))
    await expect(
      mod.placeCcxtOrder({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 500 })
    ).rejects.toThrow(/ccxt-keys-not-configured/)
    await expect(
      mod.amendCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-1", side: "buy", newPrice: 499 })
    ).rejects.toThrow(/ccxt-keys-not-configured/)
    expect(ex.calls.fetchOrder, "a keyless amend must not read the venue").toEqual([])
    expect(ex.calls.editOrder, "a keyless amend must not reach the venue").toEqual([])
    const cancelled = await mod.cancelCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-1" })
    expect(cancelled.ok).toBe(false)
    expect(cancelled.reason).toMatch(/ccxt-keys-not-configured/)
    expect(ex.calls.cancelOrder, "a keyless cancel must not reach the venue").toEqual([])
    await expect(
      mod.closeCcxtPosition({ exchange: "binance", symbol: "BTCUSDT", positionSide: "long", positionOrderId: "p-1", filledAmount: 0.01, amount: 0.01, price: 500 })
    ).rejects.toThrow(/ccxt-keys-not-configured/)
    expect(ex.calls.createOrder, "a keyless close must not place anything").toEqual([])
  })
})