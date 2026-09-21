// WS-1 M1 — ccxtOrdering.mjs additive `defaultType` instance extension.
// A future Hyperliquid perps adapter builds a SWAP-typed ccxt instance that
// coexists independently with the seam's existing SPOT instances. This suite
// proves the id:type cache key: spot and swap for the same exchange id exist
// simultaneously with different options.defaultType, invalid types are refused
// (never silently coerced), and explicit defaultType:"spot" is identical to
// omitting the param. Existing callers pass no defaultType — they stay spot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeExchange({ balance = {}, tickers = {}, orders = {} } = {}) {
  const calls = { createOrder: [], fetchOrder: [], fetchTicker: [], fetchBalance: 0 }
  const exchange = {
    id: "hyperliquid",
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
    async fetchOrder() {
      throw new Error("fixture: no orders")
    }
  }
  return exchange
}

const HYPERLIQUID_KEYS = {
  PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0x1111111111111111111111111111111111111111",
  PICC_CCXT_PRIVATEKEY_HYPERLIQUID: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}

/** Fixture ccxt lib whose constructor captures the opts it was built with.
 * Each construction returns a FRESH instance derived from the fixture exchange
 * (ccxt builds a new object per `new Ctor(opts)`) so instance identity — and
 * the id:type cache — is observable. */
function captureLib(id, capture, ex) {
  const lib = {}
  lib[id] = function Ctor(opts) {
    capture.push(opts)
    return Object.create(ex)
  }
  return lib
}

describe("ccxtOrdering — defaultType instance extension (M1, id:type cache key)", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ccxt-dt-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/ccxtOrdering.mjs")
    mod._resetCcxtOrderingState()
    Object.assign(process.env, HYPERLIQUID_KEYS) // wallet-key mode, as the future HL adapter uses
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_CCXT_")) delete process.env[k]
    }
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("spot and swap instances for the same exchange id COEXIST — keyed id:type, never one cache entry", async () => {
    const captured = []
    const ex = makeExchange()
    mod._setCcxtLibForTests(captureLib("hyperliquid", captured, ex))
    const spot = await mod.ccxtInstanceFor("hyperliquid")
    const spotAgain = await mod.ccxtInstanceFor("hyperliquid")
    expect(spotAgain).toBe(spot) // spot call 2: cache hit, no re-construction
    const swap = await mod.ccxtInstanceFor("hyperliquid", { defaultType: "swap" })
    expect(swap).not.toBe(spot) // the swap request MUST NOT return the cached spot instance
    expect(Object.getPrototypeOf(swap)).toBe(ex) // a real construction from the fixture, not a cache hit
    const swapAgain = await mod.ccxtInstanceFor("hyperliquid", { defaultType: "swap" })
    expect(swapAgain).toBe(swap) // swap call 2: cache hit, no re-construction
    expect(captured).toHaveLength(2) // exactly two constructions, one per defaultType
    // wallet-key wiring survives the second construction (the T3 adapter path)
    expect(captured[0].walletAddress).toBe(HYPERLIQUID_KEYS.PICC_CCXT_WALLETADDRESS_HYPERLIQUID)
    expect(captured[1].walletAddress).toBe(HYPERLIQUID_KEYS.PICC_CCXT_WALLETADDRESS_HYPERLIQUID)
    // the constructor saw the right market type per leg
    expect(captured[0].options.defaultType).toBe("spot")
    expect(captured[1].options.defaultType).toBe("swap")
  })

  it('explicit defaultType:"spot" is identical to omitting it — one shared spot cache entry', async () => {
    const captured = []
    const ex = makeExchange()
    mod._setCcxtLibForTests(captureLib("hyperliquid", captured, ex))
    const omitted = await mod.ccxtInstanceFor("hyperliquid")
    const explicit = await mod.ccxtInstanceFor("hyperliquid", { defaultType: "spot" })
    expect(explicit).toBe(omitted) // same cached entry — the explicit spot key hits the same slot
    expect(captured).toHaveLength(1)
    expect(captured[0].options.defaultType).toBe("spot")
  })

  it('refuses any defaultType that is neither "spot" nor "swap" — never a silent coercion', async () => {
    const captured = []
    const ex = makeExchange()
    mod._setCcxtLibForTests(captureLib("hyperliquid", captured, ex))
    await expect(mod.ccxtInstanceFor("hyperliquid", { defaultType: "margin" })).rejects.toThrow(/defaultType.*margin/)
    await expect(mod.ccxtInstanceFor("hyperliquid", { defaultType: "future" })).rejects.toThrow(/defaultType/)
    expect(captured).toHaveLength(0) // the refuse happens BEFORE any construction
    // rejection must not corrupt the caches — a normal spot request still works
    const spot = await mod.ccxtInstanceFor("hyperliquid")
    expect(Object.getPrototypeOf(spot)).toBe(ex)
    expect(captured).toHaveLength(1) // exactly the one legit spot construction
  })
})