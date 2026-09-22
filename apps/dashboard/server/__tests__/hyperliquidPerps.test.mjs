// WS-1 T3 — hyperliquidPerps.mjs: the Hyperliquid perps venue adapter (F2).
// Everything is a fixture exchange injected via the ordering seam's
// _setCcxtLibForTests — CI never talks to a live venue (T8 owns the real
// testnet E2E). This suite proves the refusal surface (rail-off, band, cap,
// isolated, swap-symbol, limit-only, reduceOnly, invalid env), the sandbox
// setup ordering (setSandboxMode BEFORE any order), the deterministic cloid
// mapping, the per-symbol idempotent setup sequence, and the honest observer
// shapes — mirroring the fixture conventions of ccxtOrdering.test.mjs and
// ccxtOrdering.defaultType.test.mjs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeExchange(overrides = {}) {
  const calls = {
    createOrder: [],
    fetchOrder: [],
    fetchBalance: 0,
    fetchPositions: 0,
    fetchFundingRate: [],
    loadMarkets: 0,
    setMarginMode: [],
    setLeverage: [],
    setSandboxMode: 0
  }
  const exchange = {
    id: "hyperliquid",
    calls,
    sandbox: false,
    markets: overrides.markets ?? defaultMarkets(),
    positions: overrides.positions ?? [],
    fundingRate: overrides.fundingRate ?? null,
    balance: overrides.balance ?? {},
    orders: overrides.orders ?? {},
    createOrderImpl: overrides.createOrderImpl ?? null,
    failLoadMarkets: overrides.failLoadMarkets ?? false,
    failSetMarginMode: overrides.failSetMarginMode ?? false,
    failSetLeverage: overrides.failSetLeverage ?? false,
    setSandboxMode(v) {
      calls.setSandboxMode++
      exchange.sandbox = v
    },
    async loadMarkets() {
      calls.loadMarkets++
      if (exchange.failLoadMarkets) throw new Error("fixture: loadMarkets failed")
      return exchange.markets
    },
    async setMarginMode(mode, symbol) {
      calls.setMarginMode.push([mode, symbol])
      if (exchange.failSetMarginMode) throw new Error("fixture: setMarginMode failed")
    },
    async setLeverage(lev, symbol) {
      calls.setLeverage.push([lev, symbol])
      if (exchange.failSetLeverage) throw new Error("fixture: setLeverage failed")
    },
    async fetchPositions() {
      calls.fetchPositions++
      if (exchange.positions instanceof Error) throw exchange.positions
      return exchange.positions
    },
    async fetchFundingRate(symbol) {
      calls.fetchFundingRate.push(symbol)
      if (exchange.fundingRate instanceof Error) throw exchange.fundingRate
      if (exchange.fundingRate == null) throw new Error(`fixture: no funding rate for ${symbol}`)
      return exchange.fundingRate
    },
    async fetchBalance() {
      calls.fetchBalance++
      if (exchange.balance instanceof Error) throw exchange.balance
      return { total: exchange.balance }
    },
    async fetchOrder(id, symbol) {
      calls.fetchOrder.push([id, symbol])
      if (!(id in exchange.orders)) throw new Error(`fixture: order ${id} not found`)
      return exchange.orders[id]
    },
    async createOrder(...args) {
      calls.createOrder.push(args)
      if (exchange.createOrderImpl) return exchange.createOrderImpl(...args)
      return {
        id: "o-hl-1",
        symbol: args[0],
        type: args[1],
        side: args[2],
        amount: args[3],
        price: args[4],
        status: "new",
        timestamp: 1_700_000_000_000
      }
    },
    async fetchTicker() {
      throw new Error("fixture: no ticker")
    }
  }
  return exchange
}

/** ccxt builds a fresh object per construction — mirror the T2 fixture. */
function libFor(ex) {
  return {
    hyperliquid: function Ctor() {
      return Object.create(ex)
    }
  }
}

const SWAP_SYMBOL = "BTC/USDT:USDT"
const SPOT_SYMBOL = "BTC/USDT"

function defaultMarkets() {
  return {
    [SWAP_SYMBOL]: {
      symbol: SWAP_SYMBOL,
      base: "BTC",
      quote: "USDT",
      type: "swap",
      active: true,
      limits: { amount: { min: 0.001 }, cost: { min: 5 } },
      info: { fundingIntervalMillis: 3_600_000 }
    },
    [SPOT_SYMBOL]: {
      symbol: SPOT_SYMBOL,
      base: "BTC",
      quote: "USDT",
      type: "spot",
      active: true,
      limits: { amount: { min: 0.0001 }, cost: { min: 5 } },
      info: {}
    }
  }
}

const HYPERLIQUID_KEYS = {
  PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0x1111111111111111111111111111111111111111",
  PICC_CCXT_PRIVATEKEY_HYPERLIQUID: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}

const RISK_FIELD_BY_KEY = {
  PICC_CCXT_LEVERAGE_MIN: "leverageBandMin",
  PICC_CCXT_LEVERAGE_MAX: "leverageBandMax",
  PICC_CCXT_MARGIN_PER_POSITION_CAP_USD: "marginPerPositionCapUsd",
  PICC_CCXT_PERPS_MAX_OPEN_POSITIONS: "maxOpenPositions",
  PICC_CCXT_FUNDING_STALE_MS: "fundingStaleMs"
}

// margin = 0.001 * 20000 / 4 = 5 — comfortably inside the $10 margin cap.
const HAPPY = {
  symbol: SWAP_SYMBOL,
  side: "buy",
  amount: 0.001,
  price: 20000,
  leverage: 4,
  marginMode: "isolated",
  clientOrderId: "picc-perps-t3-abc"
}

const RAIL_OFF_EXACT =
  "perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)"

const DOGE_MARKETS = {
  "DOGE/USDT:USDT": {
    symbol: "DOGE/USDT:USDT",
    base: "DOGE",
    quote: "USDT",
    type: "swap",
    active: true,
    limits: { amount: { min: 1 }, cost: { min: 1 } },
    info: {}
  }
}

const DOGE_POSITION = {
  symbol: "DOGE/USDT:USDT",
  contracts: 100,
  entryPrice: 0.2,
  notional: 20,
  leverage: 4,
  marginMode: "isolated",
  liquidationPrice: 0.05,
  side: "long",
  timestamp: 1_700_000_000_000
}

describe("hyperliquidPerps — refusal surface + sandbox ordering (fixture ccxt)", () => {
  let dir
  let seam
  let adapter
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-hlp-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    seam = await import("../services/ccxtOrdering.mjs")
    seam._resetCcxtOrderingState()
    Object.assign(process.env, HYPERLIQUID_KEYS)
    adapter = (await import("../services/venues/hyperliquidPerps.mjs")).hyperliquidPerps
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_CCXT_")) delete process.env[k]
    }
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("rail-off: global sandbox off + mainnet absent ⇒ EVERY method refuses with the EXACT reason", async () => {
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const refused = [adapter.submitOrder({ ...HAPPY }), adapter.observeEquity(), adapter.positionView(), adapter.observeFunding({ symbol: SWAP_SYMBOL }), adapter.markets()]
    for (const result of await Promise.all(refused)) {
      expect(result).toEqual({ ok: false, reason: RAIL_OFF_EXACT })
    }
    // verifyFill has no {ok:false} shape — unobserved means null, never a fabricated fill
    expect(await adapter.verifyFill({ symbol: SWAP_SYMBOL, orderId: "o-1" })).toBeNull()
    // the venue was never reached under rail-off
    expect(ex.calls.createOrder).toHaveLength(0)
    expect(ex.calls.setSandboxMode).toBe(0)
  })

  it("rail-off: PICC_CCXT_PERPS_MAINNET_ENABLED alone (sandbox still off) is refused — R6.2, mainnet flag insufficient", async () => {
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const res = await adapter.submitOrder({ ...HAPPY })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/^perps-rail-off: /)
    expect(res.reason).toContain("testnet-only")
    expect(ex.calls.createOrder).toHaveLength(0)
  })

  it("global PICC_CCXT_SANDBOX=1 ⇒ setSandboxMode(true) BEFORE the order; createOrder receives type:limit with the swap symbol", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const res = await adapter.submitOrder({ ...HAPPY })
    expect(res.ok).toBe(true)
    expect(ex.calls.setSandboxMode).toBe(1)
    expect(ex.sandbox).toBe(true)
    expect(ex.calls.createOrder).toHaveLength(1)
    const args = ex.calls.createOrder[0]
    expect(args[0]).toBe(SWAP_SYMBOL)
    expect(args[1]).toBe("limit")
    expect(args[2]).toBe("buy")
    expect(res.order).toMatchObject({
      symbol: SWAP_SYMBOL,
      side: "buy",
      type: "limit",
      amount: 0.001,
      price: 20000,
      leverage: 4,
      reduceOnly: false
    })
    expect(Number(res.order.marginUsd)).toBeCloseTo(5, 9)
  })

  it("leverage 2 and 6 refused with the band-naming reason; leverage 4 accepted", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const low = await adapter.submitOrder({ ...HAPPY, leverage: 2 })
    expect(low).toEqual({ ok: false, reason: "leverage-out-of-band" })
    const high = await adapter.submitOrder({ ...HAPPY, leverage: 6 })
    expect(high).toEqual({ ok: false, reason: "leverage-out-of-band" })
    const ok = await adapter.submitOrder({ ...HAPPY })
    expect(ok.ok).toBe(true)
    expect(ex.calls.createOrder).toHaveLength(1) // only the in-band order reached the venue
  })

  it("margin above the $10 cap refused (margin-exceeds-cap); the 10.00 boundary accepted", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    // margin = 0.01 * 4010 / 4 = 10.025 > 10
    const over = await adapter.submitOrder({ ...HAPPY, amount: 0.01, price: 4010 })
    expect(over).toEqual({ ok: false, reason: "margin-exceeds-cap" })
    // boundary: margin = 0.01 * 4000 / 4 = 10.00 → accepted (never clamped, never refused by FP noise)
    const atBoundary = await adapter.submitOrder({ ...HAPPY, amount: 0.01, price: 4000 })
    expect(atBoundary.ok).toBe(true)
    expect(ex.calls.createOrder).toHaveLength(1) // only the boundary order reached the venue
  })

  it("marginMode cross refused (cross-not-allowed); isolated accepted", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const cross = await adapter.submitOrder({ ...HAPPY, marginMode: "cross" })
    expect(cross).toEqual({ ok: false, reason: "cross-not-allowed" })
    const iso = await adapter.submitOrder({ ...HAPPY })
    expect(iso.ok).toBe(true)
    expect(ex.calls.createOrder).toHaveLength(1)
  })

  it("a spot symbol and an unknown symbol refused (symbol-not-swap-market); the active swap symbol accepted", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const spot = await adapter.submitOrder({ ...HAPPY, symbol: SPOT_SYMBOL })
    expect(spot).toEqual({ ok: false, reason: "symbol-not-swap-market" })
    const unknown = await adapter.submitOrder({ ...HAPPY, symbol: "DOGE/USDT:USDT" })
    expect(unknown).toEqual({ ok: false, reason: "symbol-not-swap-market" })
    const ok = await adapter.submitOrder({ ...HAPPY })
    expect(ok.ok).toBe(true)
    expect(ex.calls.createOrder).toHaveLength(1) // spot/unknown refusals never reached the venue
  })

  it("createOrder always receives type:limit (never market); a rogue request type field is refused (limit-only)", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const rogue = await adapter.submitOrder({ ...HAPPY, type: "market" })
    expect(rogue).toEqual({ ok: false, reason: "limit-only" })
    const ok = await adapter.submitOrder({ ...HAPPY })
    expect(ok.ok).toBe(true)
    expect(ex.calls.createOrder).toHaveLength(1)
    expect(ex.calls.createOrder[0][1]).toBe("limit")
  })

  it("reduceOnly close: reduceOnly:true reaches createOrder; amount ≤ position.size accepted", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({ positions: [DOGE_POSITION], markets: DOGE_MARKETS })
    seam._setCcxtLibForTests(libFor(ex))
    const res = await adapter.submitOrder({
      symbol: "DOGE/USDT:USDT",
      side: "sell",
      amount: 50,
      price: 0.2,
      leverage: 4,
      marginMode: "isolated",
      reduceOnly: true,
      clientOrderId: "picc-perps-close-1"
    })
    expect(res.ok).toBe(true)
    expect(res.order.reduceOnly).toBe(true)
    const params = ex.calls.createOrder[0][5]
    expect(params.reduceOnly).toBe(true)
    expect(params.clientOrderId).toMatch(/^0x[0-9a-f]{32}$/)
  })

  it("reduceOnly close with amount > position.size refused (reduceonly-exceeds-position), never reaching the venue", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({ positions: [DOGE_POSITION], markets: DOGE_MARKETS })
    seam._setCcxtLibForTests(libFor(ex))
    const res = await adapter.submitOrder({
      symbol: "DOGE/USDT:USDT",
      side: "sell",
      amount: 101,
      price: 0.2,
      leverage: 4,
      marginMode: "isolated",
      reduceOnly: true,
      clientOrderId: "picc-perps-close-2"
    })
    expect(res).toEqual({ ok: false, reason: "reduceonly-exceeds-position" })
    expect(ex.calls.createOrder).toHaveLength(0)
  })

  it("cloid mapping: same clientOrderId ⇒ identical 0x-hex ≤ 66 chars; different inputs differ; the record carries the hex cloid", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const a1 = await adapter.submitOrder({ ...HAPPY, clientOrderId: "picc-perps-dup" })
    const a2 = await adapter.submitOrder({ ...HAPPY, clientOrderId: "picc-perps-dup" })
    const b = await adapter.submitOrder({ ...HAPPY, clientOrderId: "picc-perps-other" })
    expect(a1.ok && a2.ok && b.ok).toBe(true)
    const cloid1 = ex.calls.createOrder[0][5].clientOrderId
    const cloid2 = ex.calls.createOrder[1][5].clientOrderId
    const cloid3 = ex.calls.createOrder[2][5].clientOrderId
    expect(cloid1).toBe(cloid2) // deterministic: same input ⇒ same cloid
    expect(cloid1).not.toBe(cloid3) // different input ⇒ different cloid
    expect(cloid1).toMatch(/^0x[0-9a-f]{32}$/)
    expect(cloid1.length).toBeLessThanOrEqual(66)
    expect(a1.order.clientOrderId).toBe(cloid1) // the hex cloid is recorded in the returned order
    expect(a2.order.clientOrderId).toBe(cloid1)
  })

  it("observeEquity maps fetchBalance totals to the contract shape; a throwing balance is equity-unobservable", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({ balance: { USDT: 123, USDC: 5 } })
    seam._setCcxtLibForTests(libFor(ex))
    const ok = await adapter.observeEquity()
    expect(ok.ok).toBe(true)
    expect(Number(ok.equityUsd)).toBeCloseTo(128, 6)
    expect(ok.currency).toBe("USDT")
    expect(typeof ok.at).toBe("string")

    const bad = makeExchange({ balance: new Error("network down") })
    seam._resetCcxtOrderingState()
    seam._setCcxtLibForTests(libFor(bad))
    expect(await adapter.observeEquity()).toEqual({ ok: false, reason: "equity-unobservable" })
  })

  it("positionView maps fetchPositions to contract rows; a successful empty read is []; a throwing read is positions-unobservable", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({
      positions: [{ symbol: SWAP_SYMBOL, contracts: 2, entryPrice: 60000, notional: 120000, leverage: 4, marginMode: "isolated", liquidationPrice: 15000, side: "long", timestamp: 1_700_000_000_000 }]
    })
    seam._setCcxtLibForTests(libFor(ex))
    expect(await adapter.positionView()).toEqual([
      { symbol: SWAP_SYMBOL, side: "long", size: 2, entryPrice: 60000, notional: 120000, leverage: 4, marginMode: "isolated", liquidationPrice: 15000, at: "2023-11-14T22:13:20.000Z" }
    ])

    const empty = makeExchange({ positions: [] })
    seam._resetCcxtOrderingState()
    seam._setCcxtLibForTests(libFor(empty))
    expect(await adapter.positionView()).toEqual([])

    const bad = makeExchange({ positions: new Error("venue down") })
    seam._resetCcxtOrderingState()
    seam._setCcxtLibForTests(libFor(bad))
    expect(await adapter.positionView()).toEqual({ ok: false, reason: "positions-unobservable" })
  })

  it("observeFunding maps fetchFundingRate to the contract shape; a throwing read is funding-unobservable", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({ fundingRate: { fundingRate: 0.0001, interval: "1h", timestamp: 1_700_000_000_000 } })
    seam._setCcxtLibForTests(libFor(ex))
    const ok = await adapter.observeFunding({ symbol: SWAP_SYMBOL })
    expect(ok.ok).toBe(true)
    expect(ok).toMatchObject({ rate: 0.0001, fundingIntervalHrs: 1, symbol: SWAP_SYMBOL })
    expect(typeof ok.at).toBe("string")

    const bad = makeExchange({ fundingRate: new Error("no funding") })
    seam._resetCcxtOrderingState()
    seam._setCcxtLibForTests(libFor(bad))
    expect(await adapter.observeFunding({ symbol: SWAP_SYMBOL })).toEqual({ ok: false, reason: "funding-unobservable" })
  })

  it("missing wallet/key pair ⇒ observers return the honest <step>-unobservable, never a raw rejection", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    delete process.env.PICC_CCXT_WALLETADDRESS_HYPERLIQUID
    delete process.env.PICC_CCXT_PRIVATEKEY_HYPERLIQUID
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    await expect(adapter.observeEquity()).resolves.toEqual({ ok: false, reason: "equity-unobservable" })
    await expect(adapter.positionView()).resolves.toEqual({ ok: false, reason: "positions-unobservable" })
    await expect(adapter.observeFunding({ symbol: SWAP_SYMBOL })).resolves.toEqual({ ok: false, reason: "funding-unobservable" })
  })

  it("invalid env (min>max) reports invalid-environment — never a silent fallback", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    process.env.PICC_CCXT_LEVERAGE_MIN = "7"
    process.env.PICC_CCXT_LEVERAGE_MAX = "3"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const res = await adapter.submitOrder({ ...HAPPY })
    expect(res).toEqual({ ok: false, reason: "invalid-environment: PICC_CCXT_LEVERAGE_MIN=7" })
    expect(ex.calls.createOrder).toHaveLength(0) // the refusal happened before any venue call
  })

  it.each(
    Object.entries(RISK_FIELD_BY_KEY).flatMap(([key, field]) =>
      ["abc", "0", "-1"].map((bad) => ({ key, field, bad }))
    )
  )("invalid env: $key=$bad ⇒ invalid-environment at the riskModel gate and in submitOrder — never a silent fallback", async ({ key, field, bad }) => {
    process.env.PICC_CCXT_SANDBOX = "1"
    process.env[key] = bad
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    // riskModel gate: the lazy getter reflects the raw garbage (NaN/0/negative), never the default
    const view = adapter.riskModel[field]
    if (bad === "abc") expect(Number.isNaN(view)).toBe(true)
    else expect(view).toBe(Number(bad))
    // readRiskModel gate: submitOrder refuses with the exact reason, before any venue call
    await expect(adapter.submitOrder({ ...HAPPY })).resolves.toEqual({
      ok: false,
      reason: `invalid-environment: ${key}=${bad}`
    })
    expect(ex.calls.createOrder).toHaveLength(0)
  })

  it("setup is idempotent per symbol: two orders run loadMarkets/setMarginMode/setLeverage once", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const first = await adapter.submitOrder({ ...HAPPY })
    expect(first.ok).toBe(true)
    const second = await adapter.submitOrder({ ...HAPPY, clientOrderId: "picc-perps-again" })
    expect(second.ok).toBe(true)
    expect(ex.calls.loadMarkets).toBe(1)
    expect(ex.calls.setMarginMode).toEqual([["isolated", SWAP_SYMBOL]])
    expect(ex.calls.setLeverage).toEqual([[4, SWAP_SYMBOL]])
    expect(ex.calls.createOrder).toHaveLength(2)
  })

  it("concurrent first submitOrders for the same symbol share ONE in-flight setup (no double loadMarkets/setMarginMode/setLeverage)", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    const [first, second] = await Promise.all([
      adapter.submitOrder({ ...HAPPY, clientOrderId: "picc-perps-a" }),
      adapter.submitOrder({ ...HAPPY, clientOrderId: "picc-perps-b" })
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(ex.calls.loadMarkets).toBe(1)
    expect(ex.calls.setMarginMode).toEqual([["isolated", SWAP_SYMBOL]])
    expect(ex.calls.setLeverage).toEqual([[4, SWAP_SYMBOL]])
    expect(ex.calls.createOrder).toHaveLength(2)
  })

  it("a failing loadMarkets surfaces honestly as markets-unobservable (symbol validation consumes it before setup)", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({ failLoadMarkets: true })
    seam._setCcxtLibForTests(libFor(ex))
    const res = await adapter.submitOrder({ ...HAPPY })
    expect(res).toEqual({ ok: false, reason: "markets-unobservable" })
    expect(ex.calls.createOrder).toHaveLength(0) // the failed read never reached the order path
  })

  it.each([
    ["setMarginMode", { failSetMarginMode: true }],
    ["setLeverage", { failSetLeverage: true }]
  ])("setup failure names the step: throwing %s ⇒ setup-failed: %s", async (step, override) => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange(override)
    seam._setCcxtLibForTests(libFor(ex))
    const res = await adapter.submitOrder({ ...HAPPY })
    expect(res).toEqual({ ok: false, reason: `setup-failed: ${step}` })
    expect(ex.calls.createOrder).toHaveLength(0) // a failed setup never reaches the order path
  })

  it("markets() maps swap rows to the contract shape and excludes spot", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    expect(await adapter.markets()).toEqual([
      { symbol: SWAP_SYMBOL, base: "BTC", quote: "USDT", type: "swap", minAmount: 0.001, minNotional: 5, isActive: true, fundingTickMs: 3_600_000 }
    ])
  })

  it("markets() reports markets-unobservable when loadMarkets throws", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const bad = makeExchange({ failLoadMarkets: true })
    seam._setCcxtLibForTests(libFor(bad))
    expect(await adapter.markets()).toEqual({ ok: false, reason: "markets-unobservable" })
  })

  it("verifyFill maps a readable order to the honest fill and returns null when unobservable", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({
      orders: {
        "o-hl-1": { id: "o-hl-1", symbol: SWAP_SYMBOL, side: "buy", amount: 0.001, price: 20000, filled: 0.001, average: 19900, fee: { cost: 0.02, currency: "USDC" }, status: "closed", timestamp: 1_700_000_000_000 }
      }
    })
    seam._setCcxtLibForTests(libFor(ex))
    const fill = await adapter.verifyFill({ symbol: SWAP_SYMBOL, orderId: "o-hl-1" })
    expect(fill).toMatchObject({ ok: true, fill: { id: "o-hl-1", symbol: SWAP_SYMBOL, side: "buy", filled: 0.001, average: 19900, fee: 0.02, status: "closed" } })
    seam._resetCcxtOrderingState()
    expect(await adapter.verifyFill({ symbol: SWAP_SYMBOL, orderId: "nope-1" })).toBeNull()
  })

  it("verifyFill keeps average null for an unfilled resting limit — a resting limit price is never presented as a fill price", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange({
      orders: {
        "o-hl-open": { id: "o-hl-open", symbol: SWAP_SYMBOL, side: "sell", amount: 0.001, price: 2050, filled: 0, average: null, fee: null, status: "open", timestamp: 1_700_000_000_000 }
      }
    })
    seam._setCcxtLibForTests(libFor(ex))
    const fill = await adapter.verifyFill({ symbol: SWAP_SYMBOL, orderId: "o-hl-open" })
    expect(fill).toMatchObject({ ok: true, fill: { id: "o-hl-open", filled: 0, average: null, status: "open" } })
    expect(fill.fill.average).not.toBe(2050)
    seam._resetCcxtOrderingState()
  })

  it("the adapter satisfies validateVenueAdapter — the lazy riskModel getter exposes all 7 fields", async () => {
    const contract = await import("../services/venues/venueAdapterContract.mjs")
    expect(contract.validateVenueAdapter(adapter)).toEqual({ ok: true, errors: [] })
    expect(adapter.riskModel).toEqual({
      leverageBandMin: 3,
      leverageBandMax: 5,
      marginPerPositionCapUsd: 10,
      maxOpenPositions: 1,
      fundingStaleMs: 7_200_000,
      isolatedOnly: true,
      testnetOnly: true
    })
  })

  it("riskModel reads env at CALL TIME (defaults when absent; no baked constants)", () => {
    expect(adapter.riskModel.leverageBandMin).toBe(3)
    expect(adapter.riskModel.leverageBandMax).toBe(5)
    expect(adapter.riskModel.marginPerPositionCapUsd).toBe(10)
    process.env.PICC_CCXT_LEVERAGE_MIN = "4"
    process.env.PICC_CCXT_LEVERAGE_MAX = "3"
    process.env.PICC_CCXT_MARGIN_PER_POSITION_CAP_USD = "25"
    expect(adapter.riskModel.leverageBandMin).toBe(4)
    expect(adapter.riskModel.leverageBandMax).toBe(3)
    expect(adapter.riskModel.marginPerPositionCapUsd).toBe(25)
  })

  it("one order per symbol may vary clientOrderId without re-running setup (setup cached per symbol, orders independent)", async () => {
    process.env.PICC_CCXT_SANDBOX = "1"
    const ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
    await adapter.submitOrder({ ...HAPPY, side: "buy" })
    await adapter.submitOrder({ ...HAPPY, side: "buy", clientOrderId: "picc-2" })
    expect(ex.calls.setMarginMode).toHaveLength(1)
    expect(ex.calls.setLeverage).toHaveLength(1)
    expect(ex.calls.createOrder).toHaveLength(2)
  })
})