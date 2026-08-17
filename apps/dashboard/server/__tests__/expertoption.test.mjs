import { describe, expect, it } from "vitest"
import {
  parseMessage,
  dataToText,
  balanceFrom,
  accountFrom,
  mergeBalanceIntoAccount,
  assetsFrom,
  candlesFrom,
  liveCandlesFrom,
  expirationShift,
  buyPayload,
  fingerprintKey,
  openDealFrom,
  settlementsFrom
} from "../services/expertoption.mjs"

describe("parseMessage", () => {
  it("parses a JSON frame with a message payload", () => {
    const f = parseMessage('{"action":"profile","msg":"getBalance","id":"p1","message":{"balance":1234.5}}')
    expect(f.ok).toBe(true)
    expect(f.action).toBe("profile")
    expect(f.msg).toBe("getBalance")
    expect(f.id).toBe("p1")
    expect(f.payload.balance).toBe(1234.5)
  })

  it("treats non-JSON frames as failures", () => {
    expect(parseMessage("not json").ok).toBe(false)
    expect(parseMessage("").ok).toBe(false)
    expect(parseMessage(null).ok).toBe(false)
  })

  it("handles success flags and errors", () => {
    const f = parseMessage('{"id":"x","success":false,"error":"bad token"}')
    expect(f.success).toBe(false)
    expect(f.error).toBe("bad token")
  })
})

describe("dataToText", () => {
  it("passes strings through", async () => {
    expect(await dataToText('{"a":1}')).toBe('{"a":1}')
  })

  it("decodes an ArrayBuffer payload", async () => {
    const buf = new TextEncoder().encode('{"a":1}').buffer
    expect(await dataToText({ arrayBuffer: async () => buf })).toBe('{"a":1}')
  })

  it("stringifies anything else", async () => {
    expect(await dataToText(123)).toBe("123")
  })
})

describe("balanceFrom", () => {
  it("reads balance from the top-level field", () => {
    expect(balanceFrom({ balance: 250.5, currency: "EUR" })).toEqual({ balance: 250.5, currency: "EUR", demo: false })
  })

  it("falls back to nested profile balance", () => {
    expect(balanceFrom({ profile: { balance: 42 } })).toEqual({ balance: 42, currency: "USD", demo: false })
  })

  it("defaults to zero", () => {
    expect(balanceFrom({})).toEqual({ balance: 0, currency: "USD", demo: false })
  })
})

describe("accountFrom (dual-wallet model)", () => {
  it("carries BOTH wallets regardless of the active context (demo)", () => {
    const a = accountFrom({
      profile: {
        demo_balance: 100075.25,
        real_balance: 0,
        currency: "USD",
        is_demo: 1,
        email: "a@b.c",
        name: "Sharvin",
        surname: "Workspace"
      }
    })
    expect(a.demoWallet).toEqual({ balance: 100075.25, currency: "USD" })
    expect(a.realWallet).toEqual({ balance: 0, currency: "USD" })
    expect(a.active).toBe("demo")
    expect(a.balance).toBe(100075.25)
    expect(a.demo).toBe(true)
    expect(a.email).toBe("a@b.c")
    expect(a.name).toBe("Sharvin Workspace")
  })

  it("carries BOTH wallets and prefers the real wallet when the context is real", () => {
    const a = accountFrom({
      profile: { demo_balance: 100075.25, real_balance: 432.1, currency: "USD", is_demo: 0 }
    })
    expect(a.active).toBe("real")
    expect(a.balance).toBe(432.1)
    expect(a.demo).toBe(false)
    expect(a.realWallet.balance).toBe(432.1)
    expect(a.demoWallet.balance).toBe(100075.25)
  })

  it("keeps the legacy single-balance fallback for context-less payloads", () => {
    const a = accountFrom({ balance: 250.5, currency: "EUR" })
    expect(a.balance).toBe(250.5)
    expect(a.demo).toBe(false)
    expect(a.currency).toBe("EUR")
  })
})

describe("mergeBalanceIntoAccount (dual-wallet stays intact after a balance refresh)", () => {
  const account = accountFrom({
    profile: { demo_balance: 100075.25, real_balance: 432.1, currency: "USD", is_demo: 1, email: "a@b.c", name: "T" }
  })

  it("refreshes the active (demo) wallet and preserves the real wallet", () => {
    const next = mergeBalanceIntoAccount(account, { balance: 100101.5, currency: "USD", demo: true })
    expect(next.demoWallet).toEqual({ balance: 100101.5, currency: "USD" })
    expect(next.realWallet).toEqual({ balance: 432.1, currency: "USD" })
    expect(next.active).toBe("demo")
    expect(next.balance).toBe(100101.5)
    expect(next.email).toBe("a@b.c")
  })

  it("keeps demoWallet/realWallet even when the balance view is the only input", () => {
    const next = mergeBalanceIntoAccount(null, { balance: 999, currency: "USD", demo: true })
    expect(next.demoWallet.balance).toBe(999)
    expect(next.realWallet.balance).toBe(0)
    expect(next.active).toBe("demo")
  })
})

describe("assetsFrom", () => {
  it("handles plain string arrays", () => {
    const a = assetsFrom({ assets: ["EURUSD", "GBPUSD"] })
    expect(a).toHaveLength(2)
    expect(a[0]).toMatchObject({ id: "EURUSD", name: "EURUSD" })
  })

  it("handles object arrays with id/name/type", () => {
    const a = assetsFrom({
      assets: [
        { id: 13, name: "EUR/USD", type: "currency", currency: "EUR" },
        { id: 7, name: "BTC/USD", type: "crypto" }
      ]
    })
    expect(a[0]).toMatchObject({ id: "13", name: "EUR/USD", type: "currency", currency: "EUR" })
    expect(a[1].id).toBe("7")
  })

  it("drops entries without an id", () => {
    expect(assetsFrom({ assets: [{ type: "x" }] })).toEqual([])
  })

  it("returns empty for missing payloads", () => {
    expect(assetsFrom({})).toEqual([])
  })
})

describe("candlesFrom", () => {
  it("parses server-style arrays [time, open, close, high, low]", () => {
    const { closes, ohlc, count } = candlesFrom({
      candles: [
        [1700000000, 1.1, 1.11, 1.12, 1.09],
        [1700000060, 1.11, 1.115, 1.12, 1.1]
      ]
    })
    expect(count).toBe(2)
    expect(closes).toEqual([1.11, 1.115])
    expect(ohlc[0]).toMatchObject({ time: 1700000000, open: 1.1, close: 1.11, high: 1.12, low: 1.09 })
  })

  it("parses object-style candles", () => {
    const { closes } = candlesFrom({
      data: [
        { time: 1, open: 10, close: 11, high: 12, low: 9 },
        { t: 2, o: 11, c: 10.5, h: 11.5, l: 10 }
      ]
    })
    expect(closes).toEqual([11, 10.5])
  })

  it("ignores non-positive closes and missing payloads", () => {
    expect(candlesFrom({ candles: [[1, 0, -1, 2, 3]] }).count).toBe(0)
    expect(candlesFrom({}).count).toBe(0)
  })

  it("handles a bare array payload (server pushes candles as arrays)", () => {
    const { count } = candlesFrom([
      { time: 1, open: 10, close: 11, high: 12, low: 9 },
      { time: 2, open: 11, close: 10.5, high: 11.5, low: 10 }
    ])
    expect(count).toBe(2)
  })
})

describe("liveCandlesFrom", () => {
  it("parses a live subscription push into normalized candles", () => {
    const frame = {
      action: "candles",
      message: {
        assetId: 142,
        timeframe: 60,
        candles: [{ t: 1700000000, tf: 60, v: [1.2, 1.21, 1.19, 1.205] }]
      }
    }
    const parsed = liveCandlesFrom(frame)
    expect(parsed).toMatchObject({ assetId: "142", timeframe: 60 })
    expect(parsed.candles).toHaveLength(1)
    expect(parsed.candles[0]).toMatchObject({ time: 1700000000, open: 1.2, high: 1.21, low: 1.19, close: 1.205, timeframe: 60 })
  })

  it("returns null for non-candle pushes or empty payloads", () => {
    expect(liveCandlesFrom({ action: "candles", message: {} })).toBeNull()
    expect(liveCandlesFrom({ action: "profile" })).toBeNull()
    expect(liveCandlesFrom(null)).toBeNull()
    expect(liveCandlesFrom({ action: "candles", message: { assetId: 1, candles: [] } })).toBeNull()
  })
})

describe("expirationShift", () => {
  it("aligns minute-boundary assets to the 60s step minus the purchase window", () => {
    // EURUSD (142) is a minute-boundary asset. now % 60 = 30 -> shift = 55 - 30
    expect(expirationShift({ duration: 60, assetId: 142, now: 30 })).toBe(25)
    // placed in the last seconds of a minute rolls to the next boundary
    expect(expirationShift({ duration: 60, assetId: 142, now: 55 })).toBe(60)
    expect(expirationShift({ duration: 60, assetId: 142, now: 58 })).toBe(57)
    // longer durations keep the same boundary logic
    expect(expirationShift({ duration: 120, assetId: 142, now: 10 })).toBe(105)
  })

  it("uses the 5s step for other assets", () => {
    // now % 5 = 2, duration 60 -> duration_shift 55 -> 55 - 2
    expect(expirationShift({ duration: 60, assetId: 999, now: 92 })).toBe(53)
  })

  it("never returns a non-positive shift", () => {
    expect(expirationShift({ duration: 60, assetId: 142, now: 60 })).toBeGreaterThan(0)
  })
})

describe("buyPayload", () => {
  it("builds the wire message in the protocol shape", () => {
    const payload = buyPayload({
      token: "tok",
      assetId: 160,
      type: "call",
      amount: 10,
      duration: 60,
      isDemo: true,
      now: 1700000000,
      ns: "p1"
    })
    expect(payload.action).toBe("buyOption")
    expect(payload.ns).toBe("p1")
    expect(payload.token).toBe("tok")
    expect(payload.message).toMatchObject({
      type: "call",
      amount: 10,
      assetid: 160,
      strike_time: 1700000000,
      is_demo: 1,
      ratePosition: 0
    })
    expect(payload.message.expiration_shift).toBeGreaterThan(0)
  })

  it("rounds amounts and switches direction for puts", () => {
    const put = buyPayload({ token: "t", assetId: 142, type: "put", amount: 10.005, duration: 60, now: 30, ns: "n" })
    expect(put.message.type).toBe("put")
    expect(put.message.amount).toBe(10.01)
  })
})

describe("fingerprintKey", () => {
  it("encodes direction, amount and strike time", () => {
    expect(fingerprintKey(160, "call", 10, 1700000000)).toBe("160|0|10|1700000000")
    expect(fingerprintKey(142, "put", 9.5, 5)).toBe("142|1|9.5|5")
  })
})

describe("openDealFrom", () => {
  it("normalizes a buySuccessful trade", () => {
    const deal = openDealFrom({
      trade: {
        id: 42,
        asset_id: 160,
        type: "call",
        amount: 10,
        strike_time: 1700000000,
        strike_rate: 60000,
        exp_time: 1700000060,
        profit: 85
      }
    })
    expect(deal).toMatchObject({
      serverId: "42",
      assetId: "160",
      type: "call",
      amount: 10,
      openPrice: 60000,
      payout: 85,
      status: "active"
    })
    expect(deal.expiresAt).toBe("2023-11-14T22:14:20.000Z")
  })

  it("returns null for empty payloads", () => {
    expect(openDealFrom({})).toBeNull()
    expect(openDealFrom(null)).toBeNull()
  })
})

describe("settlementsFrom", () => {
  const active = [
    {
      serverId: "42",
      assetId: "160",
      type: "call",
      amount: 10,
      openPrice: 100,
      payout: 85,
      status: "active"
    }
  ]

  it("resolves explicit wins with net profit", () => {
    const out = settlementsFrom(
      { deals: [{ id: "42", status: "win", amount: 10, win_amount: 18.5, open_rate: 100, close_rate: 105 }] },
      active
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ result: "win", profit: 8.5, closePrice: 105, status: "closed" })
  })

  it("resolves losses", () => {
    const out = settlementsFrom(
      { deals: [{ id: "42", status: "loss", amount: 10, win_amount: 0, open_rate: 100, close_rate: 95 }] },
      active
    )
    expect(out[0].result).toBe("loss")
    expect(out[0].profit).toBe(-10)
  })

  it("resolves draws", () => {
    const out = settlementsFrom({ deals: [{ id: "42", status: "draw" }] }, active)
    expect(out[0].result).toBe("draw")
    expect(out[0].profit).toBe(0)
  })

  it("infers the result from close vs open when no status is given", () => {
    const win = settlementsFrom({ rows: [{ id: "42", close_rate: 110 }] }, active)
    expect(win[0].result).toBe("win")
    expect(win[0].profit).toBe(8.5)
    const loss = settlementsFrom({ rows: [{ id: "42", close_rate: 90 }] }, active)
    expect(loss[0].result).toBe("loss")
  })

  it("ignores settlements for unknown deals", () => {
    expect(settlementsFrom({ deals: [{ id: "nope", status: "win" }] }, active)).toEqual([])
  })
})
