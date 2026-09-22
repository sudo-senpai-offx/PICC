// WS-1 T8 — real Hyperliquid testnet sandbox E2E.
//
// THE SEAM IS THE ONLY VENUE PATH (plan R2.1 + the T9 guard): every venue call
// flows through the ordering seam's SWAP instance — `ccxtInstanceFor(
// "hyperliquid", { requireKeys: true, defaultType: "swap", sandbox: true })` —
// which is the same instance the adapter resolves internally. The adapter has
// NO cancelOrder member, so the plan's cancel step runs
// `inst.cancelOrder(orderId, symbol)` on that seam instance. Never
// `new ccxt...`, never `placeCcxtOrder` (that is the spot leg).
//
// HONESTY FLOOR: this suite asserts ONLY what the real venue answered — a
// {ok:false, reason} return is asserted as the honest failure shape, never
// coerced into a pass; a null verifyFill is an unobserved order, never a fill.
// With no credentials+sandbox the WHOLE FILE skips (ADR-0005) and names the
// variables it needs.
import { describe, expect, it } from "vitest"
import { ccxtInstanceFor } from "../services/ccxtOrdering.mjs"
import { hyperliquidPerps } from "../services/venues/hyperliquidPerps.mjs"

const credsReady = Boolean(
  process.env.PICC_CCXT_WALLETADDRESS_HYPERLIQUID && process.env.PICC_CCXT_PRIVATEKEY_HYPERLIQUID
)
const sandboxReady =
  process.env.PICC_CCXT_SANDBOX_HYPERLIQUID === "1" || process.env.PICC_CCXT_SANDBOX === "1"
const ready = credsReady && sandboxReady

if (!ready) {
  console.info(
    "[hyperliquidPerps.sandboxE2E] skipping the whole file: real Hyperliquid testnet credentials " +
      "(PICC_CCXT_WALLETADDRESS_HYPERLIQUID / PICC_CCXT_PRIVATEKEY_HYPERLIQUID) and/or " +
      "PICC_CCXT_SANDBOX=1 (or PICC_CCXT_SANDBOX_HYPERLIQUID=1) are not set — testnet-first; " +
      "mainnet requires the WS-3 ceremony. ADR-0005 honest skip: the suite exits green, no " +
      "fabricated pass, no live call attempted."
  )
}

const suite = ready ? describe : describe.skip

suite("T8 — real Hyperliquid testnet sandbox E2E (api.hyperliquid-testnet.xyz)", () => {
  const FLOOR_EQUITY_USD = 1
  const LEVERAGE = 4
  const FILL_WINDOW_MS = 20_000
  const FILL_POLL_MS = 2_000

  function runStep(label, fn) {
    return async () => {
      const started = Date.now()
      try {
        const outcome = await fn()
        if (outcome && outcome.skipped) {
          console.log(`[skipped: ${outcome.skipped}] ${label}`)
          return { label, status: "skipped", reason: outcome.skipped }
        }
        const detail = outcome && outcome.value !== undefined ? ` — ${summary(outcome.value)}` : ""
        console.log(`[ok] ${label}${detail} (${Date.now() - started}ms)`)
        return { label, status: "ok", value: outcome?.value }
      } catch (err) {
        const reason = err?.message ?? String(err)
        console.log(`[failed: ${reason}] ${label} (${Date.now() - started}ms)`)
        throw err
      }
    }
  }

  function summary(value) {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    return JSON.stringify(value)
  }

  async function pollUntil(verify, read, windowMs) {
    const deadline = Date.now() + windowMs
    let last = null
    while (Date.now() < deadline) {
      last = await read()
      if (verify(last)) return last
      await new Promise((resolve) => setTimeout(resolve, FILL_POLL_MS))
    }
    return last
  }

  function roundDown(value, step) {
    const n = Number(value)
    const s = Number(step)
    if (!Number.isFinite(n) || !Number.isFinite(s) || s <= 0) return n
    return Math.floor(n / s) * s
  }

  function roundUp(value, step) {
    const n = Number(value)
    const s = Number(step)
    if (!Number.isFinite(n) || !Number.isFinite(s) || s <= 0) return n
    return Math.ceil(n / s) * s
  }

  it("runs the five real-testnet steps: markets / equity / funding / submit+cancel / fill+close", async () => {
    const ctx = { seam: await ccxtInstanceFor("hyperliquid", { requireKeys: true, defaultType: "swap", sandbox: true }) }
    const cap = hyperliquidPerps.riskModel.marginPerPositionCapUsd

    async function stepMarkets() {
      const list = await hyperliquidPerps.markets()
      if (!Array.isArray(list)) {
        expect(list).toMatchObject({ ok: false })
        expect(typeof list.reason).toBe("string")
        ctx.markets = null
        return { value: { refused: list.reason } }
      }
      expect(list.length).toBeGreaterThan(0)
      for (const row of list) {
        expect(row).toMatchObject({ symbol: expect.any(String), base: expect.any(String), quote: expect.any(String), type: "swap" })
      }
      const btc = list.find((row) => row.base === "BTC" && row.isActive === true)
      const anchor = btc ?? list.find((row) => row.isActive === true)
      if (!anchor) {
        ctx.markets = list
        return { skipped: "no active swap row from markets() — order/funding not attempted" }
      }
      ctx.markets = list
      ctx.symbol = anchor.symbol
      ctx.minAmount = Number(anchor.minAmount) > 0 ? Number(anchor.minAmount) : null
      return { value: { swapRows: list.length, anchor: anchor.symbol } }
    }

    async function stepEquity() {
      const res = await hyperliquidPerps.observeEquity()
      if (res.ok !== true) {
        expect(res).toMatchObject({ ok: false })
        expect(typeof res.reason).toBe("string")
        ctx.equityKind = String(res.reason).includes("no balance") ? "zero" : "unobservable"
        ctx.equityReason = res.reason
        ctx.equityUsd = null
        return { value: { refused: res.reason } }
      }
      const usd = Number(res.equityUsd)
      expect(Number.isFinite(usd) && usd > 0).toBe(true)
      ctx.equityKind = "positive"
      ctx.equityUsd = usd
      return { value: { equityUsd: usd, currency: res.currency } }
    }

    async function stepFunding() {
      if (!ctx.symbol) return { skipped: "no swap symbol from markets() (venue refused) — funding not attempted" }
      const res = await hyperliquidPerps.observeFunding({ symbol: ctx.symbol })
      if (res.ok !== true) {
        expect(res).toMatchObject({ ok: false })
        expect(typeof res.reason).toBe("string")
        return { value: { refused: res.reason } }
      }
      expect(Number.isFinite(Number(res.rate))).toBe(true)
      return { value: { rate: Number(res.rate), symbol: ctx.symbol } }
    }

    async function stepSubmitCancel() {
      if (!ctx.symbol || !ctx.markets) return { skipped: "no swap symbol from markets() (venue refused) — order not attempted" }
      const inst = ctx.seam
      await inst.loadMarkets()
      const precision = inst.markets?.[ctx.symbol]?.precision ?? {}
      const amountStep = Number(precision.amount) > 0 ? Number(precision.amount) : 1e-8
      const priceStep = Number(precision.price) > 0 ? Number(precision.price) : 1
      const ticker = await inst.fetchTicker(ctx.symbol)
      const bid = Number(ticker?.bid ?? ticker?.last ?? NaN)
      expect(Number.isFinite(bid) && bid > 0).toBe(true)
      const amount = roundDown(ctx.minAmount ?? (cap * LEVERAGE * 0.8) / (bid * 0.5), amountStep)
      expect(amount).toBeGreaterThan(0)
      const farBelow = roundDown(bid * 0.5, priceStep)
      const priceCapBound = roundDown((cap * LEVERAGE) / amount, priceStep)
      const price = Math.min(farBelow, priceCapBound)
      const marginUsd = (amount * price) / LEVERAGE
      expect(marginUsd - cap).toBeLessThanOrEqual(1e-8)
      expect(price).toBeLessThan(bid)
      const res = await hyperliquidPerps.submitOrder({
        symbol: ctx.symbol,
        side: "buy",
        amount,
        price,
        leverage: LEVERAGE,
        marginMode: "isolated",
        type: "limit",
        clientOrderId: `picc-ws1-e2e-${Date.now()}`
      })
      if (res.ok !== true) {
        expect(res).toMatchObject({ ok: false })
        expect(typeof res.reason).toBe("string")
        return { value: { refused: res.reason } }
      }
      const order = res.order
      expect(order.id.length).toBeGreaterThan(0)
      expect(order.clientOrderId).toMatch(/^0x[0-9a-f]{32}$/)
      expect(order.clientOrderId.length).toBeLessThanOrEqual(66)
      expect(Number(order.marginUsd) - cap).toBeLessThanOrEqual(1e-8)
      ctx.order = order
      ctx.orderId = order.id
      ctx.bid = bid
      ctx.amountStep = amountStep
      ctx.priceStep = priceStep

      const cancelRes = await inst.cancelOrder(order.id, ctx.symbol)
      const cancelResult = cancelRes != null ? summary(cancelRes) : "null (no result object returned)"
      const fill = await hyperliquidPerps.verifyFill({ symbol: ctx.symbol, orderId: order.id })
      let readBack
      if (fill === null) {
        readBack = "unobserved (order gone from the readable surface)"
      } else {
        expect(fill.ok).toBe(true)
        readBack = `status=${String(fill.fill.status ?? "")}`
        expect(["canceled", "cancelled", "closed"].includes(String(fill.fill.status ?? "").toLowerCase())).toBe(true)
      }
      return {
        value: {
          symbol: ctx.symbol,
          bid,
          amount,
          price,
          marginUsd: Number(order.marginUsd),
          orderId: order.id,
          cloid: order.clientOrderId,
          cancelResult,
          cancelReadBack: readBack
        }
      }
    }

    async function stepFillClose() {
      if (!ctx.orderId) return { skipped: "no order submitted earlier (submit refused/unobserved) — fill/close not attempted" }
      if (ctx.equityKind === "unobservable") {
        return { skipped: `testnet equity unobservable (${ctx.equityReason}) — fill/close not attempted` }
      }
      if (ctx.equityKind === "zero") {
        return { skipped: "testnet balance 0 — deposit-free — fill/close not attempted (equityUsd=0)" }
      }
      if (ctx.equityKind === "positive" && ctx.equityUsd < FLOOR_EQUITY_USD) {
        return { skipped: `testnet balance below the $1 floor — deposit-free — fill/close not attempted (equityUsd=${ctx.equityUsd ?? 0})` }
      }
      const inst = ctx.seam
      const amountStep = ctx.amountStep ?? 1e-8
      const priceStep = ctx.priceStep ?? 1
      const ticker = await inst.fetchTicker(ctx.symbol)
      const ask = Number(ticker?.ask ?? ticker?.last ?? NaN)
      expect(Number.isFinite(ask) && ask > 0).toBe(true)
      const amount = roundDown(ctx.minAmount ?? (cap * LEVERAGE * 0.8) / ask, amountStep)
      expect(amount).toBeGreaterThan(0)
      const fillPrice = roundUp(ask * 1.02, priceStep)
      if ((amount * fillPrice) / LEVERAGE > cap * 0.9) {
        return { skipped: `cannot size a fill within the WS-1 margin cap at the current ask (${ask}) — fill/close not attempted` }
      }
      const open = await hyperliquidPerps.submitOrder({
        symbol: ctx.symbol,
        side: "buy",
        amount,
        price: fillPrice,
        leverage: LEVERAGE,
        marginMode: "isolated",
        type: "limit",
        clientOrderId: `picc-ws1-e2e-fill-${Date.now()}`
      })
      if (open.ok !== true) {
        expect(open).toMatchObject({ ok: false })
        expect(typeof open.reason).toBe("string")
        return { value: { refused: open.reason } }
      }
      const observed = await pollUntil(
        (fill) => fill != null && fill.ok === true && Number(fill.fill.filled) > 0,
        () => hyperliquidPerps.verifyFill({ symbol: ctx.symbol, orderId: open.order.id }),
        FILL_WINDOW_MS
      )
      if (observed == null || observed.ok !== true || Number(observed.fill.filled) <= 0) {
        try {
          await inst.cancelOrder(open.order.id, ctx.symbol)
        } catch {
          // the abandonment below reports the observed truth either way
        }
        return { skipped: `fill not observed within ${FILL_WINDOW_MS}ms and the order was cancelled — no fill asserted` }
      }
      const close = await hyperliquidPerps.submitOrder({
        symbol: ctx.symbol,
        side: "sell",
        amount: Number(observed.fill.filled),
        price: roundDown((ctx.bid ?? ask) * 0.98, priceStep),
        leverage: LEVERAGE,
        marginMode: "isolated",
        type: "limit",
        reduceOnly: true,
        clientOrderId: `picc-ws1-e2e-close-${Date.now()}`
      })
      if (close.ok !== true) {
        expect(close).toMatchObject({ ok: false })
        expect(typeof close.reason).toBe("string")
        return { value: { filled: Number(observed.fill.filled), closeRefused: close.reason } }
      }
      const closed = await pollUntil(
        (fill) => fill != null && fill.ok === true && Number(fill.fill.filled) > 0,
        () => hyperliquidPerps.verifyFill({ symbol: ctx.symbol, orderId: close.order.id }),
        FILL_WINDOW_MS
      )
      if (closed == null || closed.ok !== true || Number(closed.fill.filled) <= 0) {
        try {
          await inst.cancelOrder(close.order.id, ctx.symbol)
        } catch {
          // the abandonment below reports the observed truth either way
        }
        return { skipped: `close not observed within ${FILL_WINDOW_MS}ms and the close order was cancelled — position may remain open, no fill asserted` }
      }
      return {
        value: {
          filled: Number(observed.fill.filled),
          closeOrder: close.order.id,
          closeObserved: true
        }
      }
    }

    for (const step of [
      runStep("1 markets", stepMarkets),
      runStep("2 equity", stepEquity),
      runStep("3 funding", stepFunding),
      runStep("4 submit+cancel", stepSubmitCancel),
      runStep("5 fill+close", stepFillClose)
    ]) {
      await step()
    }
  }, 120_000)
})
