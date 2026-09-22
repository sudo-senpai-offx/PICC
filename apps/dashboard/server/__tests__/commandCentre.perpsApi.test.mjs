// Command Centre slice 6b — the trading:perps rail API (T7 M3): a proposal-
// powered live order lifecycle for the Hyperliquid perps venue, mirroring the
// ccxt orders rail (handlers.mjs:1618-1757) with the perps 5-gate chain on top.
//
// Hermetic: handlers is imported FRESH per test with the data dirs pointed at
// a tmp dir and the hyperliquid adapter mocked (the only venue this rail
// serves). The sidecar / audit / execution seam are the REAL ones, reset via
// the perpsExecution.test.mjs fixture discipline, so the audit sequence each
// test asserts is the durable chain, not a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/venues/hyperliquidPerps.mjs", () => {
  return {
    hyperliquidPerps: {
      id: "hyperliquid",
      label: "Hyperliquid perps (testnet)",
      markets: vi.fn(),
      submitOrder: vi.fn(),
      // contract-faithful venue mock (hyperliquidPerps.mjs:358-360): null when
      // symbol or orderId is absent, nested { ok:true, fill } on success — the
      // unwrap is the adapter seam's job, never the venue's
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

const ORDER = {
  exchange: "hyperliquid",
  symbol: "ETH/USDT",
  side: "buy",
  amount: 0.005, // notional 10, margin 2.5 at 4x leverage — inside the $10 cap
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

// The venue's view of that same position (reconcile matches by symbol+side).
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

describe("Command Centre slice 6b — perps rail API (trading:perps)", () => {
  let dir
  let handleApi
  let audit
  let perps

  async function rebootHandlers() {
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    audit = await import("../services/commandCentre/auditTrail.mjs")
    perps = await import("../services/venues/hyperliquidPerps.mjs")
    const a = perps.hyperliquidPerps
    vi.mocked(a.observeEquity).mockReset().mockResolvedValue({ ok: true, equityUsd: 100, at: new Date().toISOString() })
    vi.mocked(a.observeFunding).mockReset().mockResolvedValue({ ok: true, rate: 0.0001, at: Date.now() - 60_000 })
    vi.mocked(a.positionView).mockReset().mockResolvedValue([])
    vi.mocked(a.submitOrder).mockClear().mockResolvedValue({ ok: true, id: "venue-order-1", status: "open", receivedTime: new Date().toISOString() })
    vi.mocked(a.verifyFill).mockClear()
    vi.mocked(a.markets).mockClear()
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-cc-perps-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    process.env.PICC_AUTOMATOR_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
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

  it("GET positions returns the honest list + perps proposals for parity with /orders", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/perps/positions")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.positions).toEqual([])
    expect(res.body.proposals).toEqual([])
    expect(res.body.reconcile.ok).toBe(true)
  })

  it("POST propose green: FULL gate chain passes, the durable proposal is recorded, venue untouched", async () => {
    const res = await call(handleApi, "POST", "/api/command-centre/perps/propose", ORDER)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.gate.allow).toBe(true)
    expect(res.body.gate.blockedBy).toBeNull()
    expect(res.body.clientOrderId).toMatch(/^picc-/)
    expect(res.body.idempotencyKey).toMatch(/^perps:order:hyperliquid:/)
    expect(res.body.order).toMatchObject({
      exchange: "hyperliquid",
      symbol: "ETH/USDT",
      side: "buy",
      amount: 0.005,
      price: 2000,
      notionalUsd: 10,
      marginUsd: 2.5,
      clamped: false,
      leverage: 4,
      marginMode: "isolated"
    })
    expect(res.body.order.amount * 2000).toBeLessThanOrEqual(10)
    // propose NEVER reaches the venue — submitOrder is the execute-only seam
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
    const trail = audit.readAudit()
    const created = trail.find((e) => e.kind === "proposal:created")
    expect(created).toMatchObject({
      site: "trading:perps",
      data: {
        kind: "open",
        power: "proposals",
        exchange: "hyperliquid",
        marginUsd: 2.5,
        idempotencyKey: `perps:order:hyperliquid:${res.body.clientOrderId}`
      }
    })
    expect(created.data.consentBy).toBe("default")
    // the two gate fns each audit their own allow, then the proposal anchor
    const kinds = trail.map((e) => e.kind)
    expect(kinds.filter((k) => k === "safety-gate:allow")).toHaveLength(2)
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("POST propose CLAMPS an over-cap margin to the 5D ceiling — the order the rail records is the sized one", async () => {
    const res = await call(handleApi, "POST", "/api/command-centre/perps/propose", {
      ...ORDER,
      amount: 0.05, // gross $100 notional = $25 margin at 4x → clamped to the $10 margin cap
      price: 2000
    })
    expect(res.body.ok).toBe(true)
    expect(res.body.order.clamped).toBe(true)
    expect(res.body.order.amount).toBeCloseTo(0.02, 8) // 10×4 / 2000
    expect(res.body.order.marginUsd).toBeLessThanOrEqual(10) // margin cap, never exceeded
    expect(res.body.order.notionalUsd).toBeCloseTo(40, 6) // 0.02×2000 — cap is on MARGIN, not notional
  })

  it("POST propose sanitizes perps inputs: exchange/symbol/side/amount/price/leverage/marginMode are each validated", async () => {
    const badExchange = await call(handleApi, "POST", "/api/command-centre/perps/propose", { ...ORDER, exchange: "bybit" })
    expect(badExchange.status).toBe(400)
    expect(badExchange.body.error).toContain("exchange must be hyperliquid")
    const badSymbol = await call(handleApi, "POST", "/api/command-centre/perps/propose", { ...ORDER, symbol: "ETHUSDT" })
    expect(badSymbol.status).toBe(400)
    expect(badSymbol.body.error).toContain("symbol is required")
    const badSide = await call(handleApi, "POST", "/api/command-centre/perps/propose", { ...ORDER, side: "hold" })
    expect(badSide.status).toBe(400)
    const badAmount = await call(handleApi, "POST", "/api/command-centre/perps/propose", { ...ORDER, amount: -1 })
    expect(badAmount.status).toBe(400)
    const badPrice = await call(handleApi, "POST", "/api/command-centre/perps/propose", { ...ORDER, price: 0 })
    expect(badPrice.status).toBe(400)
    const badLeverage = await call(handleApi, "POST", "/api/command-centre/perps/propose", { ...ORDER, leverage: "high" })
    expect(badLeverage.status).toBe(400)
    expect(badLeverage.body.error).toContain("leverage must be a finite positive number")
    const badMargin = await call(handleApi, "POST", "/api/command-centre/perps/propose", { ...ORDER, marginMode: "spot" })
    expect(badMargin.status).toBe(400)
    expect(badMargin.body.error).toContain("marginMode must be isolated or cross")
  })

  it("POST propose DENIES on an unobservable funding read — gate 15, no phantom proposal", async () => {
    vi.mocked(perps.hyperliquidPerps.observeFunding).mockResolvedValueOnce({ ok: false, reason: "funding-unobservable" })
    const res = await call(handleApi, "POST", "/api/command-centre/perps/propose", ORDER)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.gate.allow).toBe(false)
    expect(res.body.gate.blockedBy).toBe("perps-funding-fresh")
    expect(audit.readAudit().some((e) => e.kind === "proposal:created")).toBe(false)
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
  })

  it("POST execute replays the DURABLE proposal — a body price is never re-trusted", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/perps/propose", ORDER)
    expect(propose.body.ok).toBe(true)
    const res = await call(handleApi, "POST", "/api/command-centre/perps/execute", {
      clientOrderId: propose.body.clientOrderId,
      price: 999999 // must be IGNORED — the durable proposal's price decides
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.gate.allow).toBe(true)
    expect(res.body.execution).toMatchObject({
      status: "executed",
      idempotencyKey: `perps:order:hyperliquid:${propose.body.clientOrderId}:exec`
    })
    expect(perps.hyperliquidPerps.submitOrder).toHaveBeenCalledTimes(1)
    const submitted = vi.mocked(perps.hyperliquidPerps.submitOrder).mock.calls[0][0]
    expect(submitted).toMatchObject({
      symbol: "ETH/USDT",
      side: "buy",
      amount: 0.005,
      price: 2000,
      leverage: 4,
      marginMode: "isolated",
      reduceOnly: false,
      clientOrderId: propose.body.clientOrderId
    })
    // green open execute sequence: perps allow → sidecar allow → executed
    const kinds = audit.readAudit().map((e) => e.kind)
    expect(kinds.slice(-3)).toEqual(["safety-gate:allow", "safety-gate:allow", "execution:executed"])
    expect(audit.readAudit().find((e) => e.kind === "execution:executed").data.action).toBe("perps:open-order")
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("POST execute 404 on an unknown clientOrderId, 400 when it is missing", async () => {
    const missing = await call(handleApi, "POST", "/api/command-centre/perps/execute", {})
    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain("clientOrderId is required")
    const unknown = await call(handleApi, "POST", "/api/command-centre/perps/execute", { clientOrderId: "picc-never-proposed" })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error).toContain("unknown proposal")
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
  })

  it("POST verify (carrier B) wires trackOpen on a verified open fill — the venue order id becomes the position", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/perps/propose", ORDER)
    expect(propose.body.ok).toBe(true)
    vi.mocked(perps.hyperliquidPerps.verifyFill).mockResolvedValue({
      ok: true,
      fill: { status: "closed", filled: 0.005, average: 2050, at: new Date().toISOString() }
    })
    const res = await call(handleApi, "POST", "/api/command-centre/perps/verify", {
      clientOrderId: propose.body.clientOrderId,
      orderId: "venue-9"
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.kind).toBe("perps-verify:filled")
    // FIX 1 pin: the venue read is keyed by symbol AND orderId — with only the
    // order id the real adapter returns null (hyperliquidPerps.mjs:358-360)
    expect(perps.hyperliquidPerps.verifyFill).toHaveBeenCalledWith({ symbol: "ETH/USDT", orderId: "venue-9" })
    // the venue was NOT asked to submit again — only the read-only fill verify
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
    const positions = (await import("../services/livePositionManager.mjs")).openPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({
      id: "venue-9",
      symbol: "ETH/USDT",
      side: "long",
      size: 0.005,
      entryPrice: 2050,
      leverage: 4,
      marginUsd: 2.5,
      marginMode: "isolated",
      openOrderId: "venue-9",
      source: "persisted"
    })
  })

  it("GET positions honesty: a persisted position the venue no longer holds is closed-unobserved with pnl null", async () => {
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [POSITION] }))
    await rebootHandlers()
    vi.mocked(perps.hyperliquidPerps.positionView).mockResolvedValue([])
    const res = await call(handleApi, "GET", "/api/command-centre/perps/positions")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.reconcile.ok).toBe(true)
    expect(res.body.positions).toHaveLength(1)
    expect(res.body.positions[0]).toMatchObject({
      positionId: "pos-1",
      source: "closed-unobserved",
      pnl: null
    })
    expect(res.body.positions[0].reason).toContain("pos-1")
  })

  it("GET positions honesty: a THROWN venue view is positions-unobservable — persisted view returned, no fabricated labels", async () => {
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [POSITION] }))
    await rebootHandlers()
    vi.mocked(perps.hyperliquidPerps.positionView).mockRejectedValueOnce(new Error("network down"))
    const res = await call(handleApi, "GET", "/api/command-centre/perps/positions")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.reason.startsWith("positions-unobservable")).toBe(true)
    // the persisted view comes back exactly as recorded — source label intact, nothing invented
    expect(res.body.positions).toHaveLength(1)
    expect(res.body.positions[0]).toMatchObject({ id: "pos-1", source: "persisted" })
  })

  it("POST close replays the POSITION record with a reduce-only submit; the close-verify wires recordClose", async () => {
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [POSITION] }))
    await rebootHandlers()
    // the venue still holds the position, so the boot reconcile keeps it as "reconciled"
    vi.mocked(perps.hyperliquidPerps.positionView).mockResolvedValue(VENUE_VIEW)

    const ian = await call(handleApi, "POST", "/api/command-centre/perps/close", { positionId: "pos-1", price: 2050 })
    expect(ian.status).toBe(200)
    expect(ian.body.ok).toBe(true)
    expect(ian.body.gate.allow).toBe(true)
    expect(ian.body.execution.status).toBe("executed")
    // the order the venue received is REPLAYED from the durable position record
    expect(perps.hyperliquidPerps.submitOrder).toHaveBeenCalledTimes(1)
    const submitted = vi.mocked(perps.hyperliquidPerps.submitOrder).mock.calls[0][0]
    expect(submitted).toMatchObject({
      symbol: "ETH/USDT",
      side: "sell", // closing the LONG
      amount: 0.005,
      price: 2050,
      leverage: 4,
      marginMode: "isolated",
      reduceOnly: true,
      position: expect.objectContaining({ id: "pos-1" })
    })
    // the close anchor exists (kind:close) and the position is STILL open (recording happens on verify)
    const closeAnchor = audit.readAudit().find((e) => e.kind === "proposal:created" && e.data?.kind === "close")
    expect(closeAnchor).toMatchObject({ site: "trading:perps", data: { action: "perps:close-order", reduceOnly: true, positionId: "pos-1" } })
    const manager1 = await import("../services/livePositionManager.mjs")
    expect(manager1.openPositions()).toHaveLength(1)

    // close-verify filled ⇒ recordClose runs (the ONLY place the close is recorded)
    vi.mocked(perps.hyperliquidPerps.verifyFill).mockResolvedValue({
      ok: true,
      fill: { status: "closed", filled: 0.005, average: 2050, at: new Date().toISOString() }
    })
    const verify = await call(handleApi, "POST", "/api/command-centre/perps/verify", {
      clientOrderId: closeAnchor.data.clientOrderId,
      orderId: "venue-close-1"
    })
    expect(verify.status).toBe(200)
    expect(verify.body.kind).toBe("perps-verify:filled")
    expect(manager1.openPositions()).toHaveLength(0)
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("POST close 404 on an unknown positionId — nothing durable to close", async () => {
    const res = await call(handleApi, "POST", "/api/command-centre/perps/close", { positionId: "pos-ghost", price: 2050 })
    expect(res.status).toBe(404)
    expect(res.body.error).toContain("unknown position")
    expect(perps.hyperliquidPerps.submitOrder).not.toHaveBeenCalled()
  })

  it("all five perps routes are authenticated like the rest of the surface", async () => {
    const auth = await import("../services/auth.mjs")
    await auth.createAccount({ email: "cc-perps@example.com", password: "correct-horse-battery", name: "Perps" })
    for (const [method, path, body] of [
      ["GET", "/api/command-centre/perps/positions", undefined],
      ["POST", "/api/command-centre/perps/propose", ORDER],
      ["POST", "/api/command-centre/perps/execute", { clientOrderId: "picc-x" }],
      ["POST", "/api/command-centre/perps/close", { positionId: "pos-x", price: 1000 }],
      ["POST", "/api/command-centre/perps/verify", { clientOrderId: "picc-x", orderId: "v1" }]
    ]) {
      const req = makeReq(method, path, body)
      req.socket = { remoteAddress: "203.0.113.5" } // NOT localhost
      const res = makeRes()
      await handleApi(req, res, path)
      expect(res.status).toBe(401)
    }
  })
})