import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Wealth keyed leg readers (Task 3): hermetic — no network, no keys.
// Module under test: ../services/wealth/legsKeyed.mjs
// - readCcxtSpotLeg / readHyperliquidLeg / readBtcpayLeg → leg records with
//   LIVE<90s / STALE<5min / ABSENT-beyond status (spec decision 10).
// - Absent creds → ABSENT with exact seeded reasons (matches store.mjs seeds).
// - BTCPay reads confirmedBalance only; unconfirmed noted, never summed.
// - yahooQuote / ccxtQuote → { rate, quotedAt } | null (null when unobservable).

const ENV_KEYS = [
  "PICC_BTCPAY_URL",
  "PICC_BTCPAY_API_KEY",
  "PICC_BTCPAY_STORE_ID",
  "PICC_BTCPAY_PAYMENT_METHOD_ID",
  "BTCPAY_URL",
  "BTCPAY_API_KEY",
  "BTCPAY_STORE_ID",
  "PICC_CCXT_APIKEY_BINANCE",
  "PICC_CCXT_SECRET_BINANCE",
  "PICC_CCXT_WALLETADDRESS_HYPERLIQUID",
  "PICC_CCXT_PRIVATEKEY_HYPERLIQUID",
  "PICC_CCXT_APIKEY_HYPERLIQUID",
  "PICC_CCXT_SECRET_HYPERLIQUID"
]

describe("wealth keyed legs", () => {
  let mod
  let realFetch

  beforeEach(async () => {
    for (const k of ENV_KEYS) delete process.env[k]
    vi.resetModules()
    realFetch = globalThis.fetch
    mod = await import("../services/wealth/legsKeyed.mjs")
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    for (const k of ENV_KEYS) delete process.env[k]
    vi.restoreAllMocks()
  })

  it("ccxt-spot is ABSENT ccxt-keys-unset without keys", async () => {
    const leg = await mod.readCcxtSpotLeg()
    expect(leg.id).toBe("ccxt-spot")
    expect(leg.status).toBe("ABSENT")
    expect(leg.reason).toBe("ccxt-keys-unset")
    expect(leg.amount).toBe(null)
  })

  it("hyperliquid is ABSENT hyperliquid-credentials-unset without creds", async () => {
    const leg = await mod.readHyperliquidLeg()
    expect(leg.id).toBe("hyperliquid")
    expect(leg.status).toBe("ABSENT")
    expect(leg.reason).toBe("hyperliquid-credentials-unset")
    expect(leg.amount).toBe(null)
  })

  it("btcpay is ABSENT btcpay-unconfigured unless URL+key+storeId all set", async () => {
    expect((await mod.readBtcpayLeg()).reason).toBe("btcpay-unconfigured")
    process.env.PICC_BTCPAY_URL = "https://btcpay.example"
    expect((await mod.readBtcpayLeg()).reason).toBe("btcpay-unconfigured")
    process.env.PICC_BTCPAY_API_KEY = "k"
    expect((await mod.readBtcpayLeg()).reason).toBe("btcpay-unconfigured")
    process.env.PICC_BTCPAY_STORE_ID = "store1"
    globalThis.fetch = vi.fn(async () => {
      throw new Error("must-be-mocked-per-case")
    })
    const leg = await mod.readBtcpayLeg()
    // Fully configured: no longer "unconfigured" — the failure names itself.
    expect(leg.reason).not.toBe("btcpay-unconfigured")
  })

  it("btcpay maps confirmedBalance to amount, unconfirmed noted never summed", async () => {
    process.env.PICC_BTCPAY_URL = "https://btcpay.example"
    process.env.PICC_BTCPAY_API_KEY = "k"
    process.env.PICC_BTCPAY_STORE_ID = "store1"
    globalThis.fetch = vi.fn(async (url, opts) => {
      expect(String(url)).toContain("/api/v1/stores/store1/payment-methods/BTC/wallet")
      expect(opts.headers.Authorization).toBe("token k")
      expect(String(url)).not.toMatch(/[?&](key|token)=/i)
      return {
        ok: true,
        json: async () => ({
          balance: "0.06",
          confirmedBalance: "0.05",
          unconfirmedBalance: "0.01"
        })
      }
    })
    const leg = await mod.readBtcpayLeg()
    expect(leg.status).toBe("LIVE")
    expect(leg.ccy).toBe("BTC")
    expect(leg.amount).toBeCloseTo(0.05)
    expect(leg.unconfirmed).toBeCloseTo(0.01)
    expect(leg.amount).not.toBeCloseTo(0.06)
  })

  it("btcpay HTTP failure returns ABSENT with a named reason, secret never logged", async () => {
    process.env.PICC_BTCPAY_URL = "https://btcpay.example"
    process.env.PICC_BTCPAY_API_KEY = "super-secret-key"
    process.env.PICC_BTCPAY_STORE_ID = "store1"
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    const leg = await mod.readBtcpayLeg()
    expect(leg.status).toBe("ABSENT")
    expect(typeof leg.reason).toBe("string")
    expect(leg.reason).toMatch(/btcpay/)
    expect(leg.reason).not.toContain("super-secret-key")
  })

  it("yahooQuote returns null when unobservable", async () => {
    const q = await mod.yahooQuote("XXX", { fetchImpl: async () => { throw new Error("nope") } })
    expect(q).toBe(null)
  })

  it("ccxtQuote returns null when unobservable", async () => {
    const q = await mod.ccxtQuote("XXX", { referencePrice: async () => null })
    expect(q).toBe(null)
  })

  it("yahooQuote parses a chart payload to { rate, quotedAt }", async () => {
    const q = await mod.yahooQuote(
      "MYR",
      {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            chart: {
              result: [{
                meta: { regularMarketPrice: 0.22, symbol: "MYRUSD=X" },
                timestamp: [1728285600]
              }]
            }
          })
        })
      }
    )
    expect(q.rate).toBeCloseTo(0.22)
    expect(typeof q.quotedAt).toBe("string")
  })
})
