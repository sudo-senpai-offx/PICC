// WS-2 consent payload-lock (spec §3.5 / R5): the execute/close routes require
// the client to resubmit the FULL D5 payload, the server re-hashes it AND
// field-compares against the durable replay — a missing payload or any mismatch
// is a 409 consent-payload-mismatch WITHOUT any venue touch. This file pins the
// lock at the route level for BOTH rails (spot + perps open + perps close) and
// the D5 hash determinism at the rail level. Hermetic: handlers imported FRESH
// per test with both venue seams mocked and the risk stores seeded green.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/ccxtOrdering.mjs", () => ({
  CCXT_HARD_NOTIONAL_CAP_USD: 10,
  CCXT_EQUITY_STALE_MS: 5 * 60 * 1000,
  ccxtEquityLastObserved: vi.fn(() => null),
  observeCcxtEquity: vi.fn(async () => ({
    ok: true,
    exchange: "binance",
    equityUsd: 100,
    dayStartEquityUsd: 100,
    dayLossPct: 0,
    baselineSeeded: true
  })),
  fetchReferencePrice: vi.fn(async () => ({ exchange: "binance", symbol: "BTC/USDT", price: 1000 })),
  placeCcxtOrder: vi.fn(async () => ({ ok: true, id: "fixture-venue-order" })),
  verifyCcxtFill: vi.fn(async () => null)
}))

vi.mock("../services/venues/hyperliquidPerps.mjs", () => {
  return {
    hyperliquidPerps: {
      id: "hyperliquid",
      label: "Hyperliquid perps (testnet)",
      markets: vi.fn(),
      submitOrder: vi.fn(),
      verifyFill: vi.fn(async (p = {}) => {
        if (!p?.symbol || !p?.orderId) return null
        return { ok: true, fill: { status: "closed", filled: 0.005, average: 2050, at: new Date().toISOString() } }
      }),
      observeEquity: vi.fn(),
      observeFunding: vi.fn(),
      positionView: vi.fn()
    }
  }
})

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

const SPOT_ORDER = { exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000 }

const PERPS_ORDER = {
  exchange: "hyperliquid",
  symbol: "ETH/USDT",
  side: "buy",
  amount: 0.005,
  price: 2000,
  leverage: 4,
  marginMode: "isolated"
}

const POSITION = {
  id: "pos-1",
  symbol: "ETH/USDT",
  side: "long",
  size: 0.005,
  entryPrice: 2000,
  leverage: 4,
  marginUsd: 2.5,
  marginMode: "isolated",
  openedAt: new Date(Date.now() - 60_000).toISOString(),
  openOrderId: "venue-1",
  source: "persisted"
}

const VENUE_VIEW = [
  {
    symbol: "ETH/USDT",
    side: "long",
    size: 0.005,
    entryPrice: 2000,
    at: new Date(Date.now() - 60_000).toISOString(),
    leverage: 4,
    marginUsd: 2.5
  }
]

const spotPayloadFor = (propose, overrides = {}) => ({
  exchange: "binance",
  symbol: "BTC/USDT",
  side: "buy",
  amount: 0.01,
  price: 1000,
  clientOrderId: propose.body.clientOrderId,
  ...overrides
})

const perpsOpenPayloadFor = (propose, overrides = {}) => ({
  action: "open",
  exchange: "hyperliquid",
  symbol: "ETH/USDT",
  side: "buy",
  amount: 0.005,
  price: 2000,
  leverage: 4,
  marginMode: "isolated",
  clientOrderId: propose.body.clientOrderId,
  ...overrides
})

const perpsClosePayloadFor = (overrides = {}) => ({
  action: "close",
  exchange: "hyperliquid",
  symbol: "ETH/USDT",
  positionId: "pos-1",
  price: 2050,
  side: "sell",
  amount: 0.005,
  leverage: 4,
  ...overrides
})

describe("WS-2 consent payload-lock (R5) — both rails, route level", () => {
  let dir
  let handleApi
  let audit
  let ordering
  let perps

  async function rebootHandlers() {
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    audit = await import("../services/commandCentre/auditTrail.mjs")
    ordering = await import("../services/ccxtOrdering.mjs")
    perps = await import("../services/venues/hyperliquidPerps.mjs")
    vi.mocked(ordering.observeCcxtEquity).mockResolvedValue({
      ok: true,
      exchange: "binance",
      equityUsd: 100,
      dayStartEquityUsd: 100,
      dayLossPct: 0,
      baselineSeeded: true
    })
    vi.mocked(ordering.fetchReferencePrice).mockResolvedValue({ exchange: "binance", symbol: "BTC/USDT", price: 1000 })
    vi.mocked(ordering.placeCcxtOrder).mockClear().mockResolvedValue({ ok: true, id: "fixture-venue-order" })
    const a = perps.hyperliquidPerps
    vi.mocked(a.observeEquity).mockReset().mockResolvedValue({ ok: true, equityUsd: 100, at: new Date().toISOString() })
    vi.mocked(a.observeFunding).mockReset().mockResolvedValue({ ok: true, rate: 0.0001, at: Date.now() - 60_000 })
    vi.mocked(a.positionView).mockReset().mockResolvedValue([])
    vi.mocked(a.submitOrder).mockClear().mockResolvedValue({ ok: true, id: "venue-order-1", status: "open", receivedTime: new Date().toISOString() })
    vi.mocked(a.verifyFill).mockClear()
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-cc-consent-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    process.env.PICC_AUTOMATOR_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
    const dayKey = new Date().toISOString().slice(0, 10)
    const at = new Date().toISOString()
    writeFileSync(join(dir, "ccxt-equity.json"), JSON.stringify({ binance: { exchange: "binance", dayKey, at, equityUsd: 100, dayStartEquityUsd: 100 } }))
    writeFileSync(join(dir, "ccxt-perps-risk.json"), JSON.stringify({ version: 1, exchange: "hyperliquid", dayKey, equityAt: at, equityUsd: 100, dayStartEquityUsd: 100 }))
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [] }))
    await rebootHandlers()
  })

  afterEach(() => {
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    delete process.env.PICC_CAPTURE_CONFIG_DATA_DIR
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    delete process.env.PICC_AUTOMATOR_DATA_DIR
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("spot execute WITHOUT a payload is a 409 consent-payload-mismatch, consent:denied, venue never touched", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", SPOT_ORDER)
    expect(propose.body.ok).toBe(true)
    const res = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    expect(ordering.placeCcxtOrder).not.toHaveBeenCalled()
    const trail = audit.readAudit()
    const denied = trail.find((e) => e.kind === "consent:denied")
    expect(denied).toMatchObject({ site: "trading:ccxt", data: { clientOrderId: propose.body.clientOrderId } })
    expect(denied.data.reason).toContain("payload missing")
    expect(trail[trail.length - 1].kind).toBe("consent:denied")
    expect(trail.some((e) => e.kind === "consent:reconfirmed")).toBe(false)
    expect(trail.some((e) => e.kind === "execution:executed")).toBe(false)
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("spot execute with a MUTATED D5 field is a 409 before the venue", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", SPOT_ORDER)
    const res = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId,
      payload: spotPayloadFor(propose, { amount: 0.02 })
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("consent-payload-mismatch")
    expect(ordering.placeCcxtOrder).not.toHaveBeenCalled()
    const denied = audit.readAudit().find((e) => e.kind === "consent:denied")
    expect(denied.data.reason).toContain("field:amount")
    expect(audit.readAudit().some((e) => e.kind === "execution:executed")).toBe(false)
  })

  it("spot execute with a D5 field MISSING from the payload is a 409", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", SPOT_ORDER)
    const payloadMissingClientOrderId = spotPayloadFor(propose)
    delete payloadMissingClientOrderId.clientOrderId
    const res = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId,
      payload: payloadMissingClientOrderId
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("consent-payload-mismatch")
    expect(ordering.placeCcxtOrder).not.toHaveBeenCalled()
  })

  it("spot execute with the EXACT D5 payload consents: consent:reconfirmed precedes execution:executed, hash-locked", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", SPOT_ORDER)
    const activate = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId,
      payload: spotPayloadFor(propose)
    })
    expect(activate.status).toBe(200)
    expect(activate.body.ok).toBe(true)
    expect(ordering.placeCcxtOrder).toHaveBeenCalledTimes(1)
    const trail = audit.readAudit()
    const kinds = trail.map((e) => e.kind)
    const iRe = kinds.indexOf("consent:reconfirmed")
    const iEx = kinds.indexOf("execution:executed")
    expect(iRe).toBeGreaterThanOrEqual(0)
    expect(iEx).toBeGreaterThan(iRe)
    const reconfirmed = trail.find((e) => e.kind === "consent:reconfirmed")
    expect(reconfirmed.data).toMatchObject({ clientOrderId: propose.body.clientOrderId })
    expect(reconfirmed.data.consentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("the spot proposal:created anchor carries the D5 hash of the EXACT recorded open set", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", SPOT_ORDER)
    const anchor = audit.readAudit().find((e) => e.kind === "proposal:created")
    const { consentPayloadHash, spotOpenConsent } = await import("../services/commandCentre/ccxtExecution.mjs")
    expect(anchor.data.consentHash).toBe(
      consentPayloadHash(
        spotOpenConsent({
          exchange: anchor.data.exchange,
          symbol: anchor.data.symbol,
          side: anchor.data.side,
          amount: anchor.data.amount,
          price: anchor.data.price,
          clientOrderId: anchor.data.clientOrderId
        })
      )
    )
    expect(anchor.data.consentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(propose.body.clientOrderId).toBe(anchor.data.clientOrderId)
  })

  it("perps OPEN execute without a payload is a 409, consent:denied, venue never touched", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/perps/propose", PERPS_ORDER)
    expect(propose.body.ok).toBe(true)
    const res = await call(handleApi, "POST", "/api/command-centre/perps/execute", {
      clientOrderId: propose.body.clientOrderId
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
    const denied = audit.readAudit().find((e) => e.kind === "consent:denied")
    expect(denied).toMatchObject({ site: "trading:perps", data: { clientOrderId: propose.body.clientOrderId } })
    expect(audit.readAudit().some((e) => e.kind === "execution:executed")).toBe(false)
  })

  it("perps OPEN execute with a DIVERGENT payload price is a 409 — the D5 price is locked, never re-trusted", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/perps/propose", PERPS_ORDER)
    const res = await call(handleApi, "POST", "/api/command-centre/perps/execute", {
      clientOrderId: propose.body.clientOrderId,
      payload: perpsOpenPayloadFor(propose, { price: 999999 })
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("consent-payload-mismatch")
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
    const denied = audit.readAudit().find((e) => e.kind === "consent:denied")
    expect(denied.data.reason).toContain("field:price")
  })

  it("perps OPEN execute with the EXACT D5 payload consents and reaches the venue once", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/perps/propose", PERPS_ORDER)
    const res = await call(handleApi, "POST", "/api/command-centre/perps/execute", {
      clientOrderId: propose.body.clientOrderId,
      payload: perpsOpenPayloadFor(propose)
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(perps.hyperliquidPerps.submitOrder).toHaveBeenCalledTimes(1)
    const trail = audit.readAudit()
    const iRe = trail.findIndex((e) => e.kind === "consent:reconfirmed")
    const iEx = trail.findIndex((e) => e.kind === "execution:executed")
    expect(iRe).toBeGreaterThanOrEqual(0)
    expect(iEx).toBeGreaterThan(iRe)
    expect(trail.find((e) => e.kind === "consent:reconfirmed").data.consentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("the perps OPEN proposal:created anchor carries the D5 hash of the EXACT recorded open set", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/perps/propose", PERPS_ORDER)
    const anchor = audit.readAudit().find((e) => e.kind === "proposal:created")
    const { consentPayloadHash, perpsOpenConsent } = await import("../services/commandCentre/ccxtExecution.mjs")
    expect(anchor.data.consentHash).toBe(
      consentPayloadHash(
        perpsOpenConsent({
          action: "open",
          exchange: anchor.data.exchange,
          symbol: anchor.data.symbol,
          side: anchor.data.side,
          amount: anchor.data.amount,
          price: anchor.data.price,
          leverage: anchor.data.leverage,
          marginMode: anchor.data.marginMode,
          clientOrderId: anchor.data.clientOrderId
        })
      )
    )
  })

  it("perps close WITHOUT a payload is a 409, consent:denied keyed to the derived close clientOrderId, venue untouched", async () => {
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [POSITION] }))
    await rebootHandlers()
    vi.mocked(perps.hyperliquidPerps.positionView).mockResolvedValue(VENUE_VIEW)
    const res = await call(handleApi, "POST", "/api/command-centre/perps/close", { positionId: "pos-1", price: 2050 })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, error: "consent-payload-mismatch", blockedBeforeVenue: true })
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
    const denied = audit.readAudit().find((e) => e.kind === "consent:denied")
    const { closeClientOrderIdFor } = await import("../services/commandCentre/perpsExecution.mjs")
    expect(denied.data.clientOrderId).toBe(closeClientOrderIdFor("pos-1"))
    expect(audit.readAudit().some((e) => e.kind === "execution:executed")).toBe(false)
  })

  it("perps close with the FRESH exit price NOT locked into the payload is a 409 (body price vs payload price)", async () => {
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [POSITION] }))
    await rebootHandlers()
    vi.mocked(perps.hyperliquidPerps.positionView).mockResolvedValue(VENUE_VIEW)
    const res = await call(handleApi, "POST", "/api/command-centre/perps/close", {
      positionId: "pos-1",
      price: 2050,
      payload: perpsClosePayloadFor({ price: 2000 }) // the human's modal shows 2000, the route price is 2050
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("consent-payload-mismatch")
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
    const denied = audit.readAudit().find((e) => e.kind === "consent:denied")
    expect(denied.data.reason).toContain("field:price")
  })

  it("perps close with the EXACT D5 payload consents, executes the locked exit price, and the close anchor hash-locks it", async () => {
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [POSITION] }))
    await rebootHandlers()
    vi.mocked(perps.hyperliquidPerps.positionView).mockResolvedValue(VENUE_VIEW)
    const payload = perpsClosePayloadFor()
    const res = await call(handleApi, "POST", "/api/command-centre/perps/close", {
      positionId: "pos-1",
      price: 2050,
      payload
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(perps.hyperliquidPerps.submitOrder).toHaveBeenCalledTimes(1)
    const submitted = vi.mocked(perps.hyperliquidPerps.submitOrder).mock.calls[0][0]
    expect(submitted).toMatchObject({ side: "sell", amount: 0.005, price: 2050, leverage: 4, reduceOnly: true })
    const trail = audit.readAudit()
    const iRe = trail.findIndex((e) => e.kind === "consent:reconfirmed")
    const iEx = trail.findIndex((e) => e.kind === "execution:executed")
    expect(iRe).toBeGreaterThanOrEqual(0)
    expect(iEx).toBeGreaterThan(iRe)
    const { consentPayloadHash, perpsCloseConsent } = await import("../services/commandCentre/ccxtExecution.mjs")
    const anchor = trail.find((e) => e.kind === "proposal:created" && e.data?.kind === "close")
    expect(anchor.data.consentHash).toBe(consentPayloadHash(perpsCloseConsent(payload)))
    expect(trail.find((e) => e.kind === "consent:reconfirmed").data.consentHash).toBe(anchor.data.consentHash)
    expect(anchor.data.price).toBe(2050)
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("the D5 hash is canonical: key order is irrelevant and the vector matches sorted sha-256", async () => {
    const { consentPayloadHash } = await import("../services/commandCentre/ccxtExecution.mjs")
    const fields = { exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000, clientOrderId: "picc-abc" }
    const shuffled = { clientOrderId: "picc-abc", price: 1000, amount: 0.01, side: "buy", symbol: "BTC/USDT", exchange: "binance" }
    const sorted = { amount: 0.01, clientOrderId: "picc-abc", exchange: "binance", price: 1000, side: "buy", symbol: "BTC/USDT" }
    expect(consentPayloadHash(fields)).toBe(consentPayloadHash(shuffled))
    expect(consentPayloadHash(fields)).toBe(createHash("sha256").update(JSON.stringify(sorted)).digest("hex"))
  })
})