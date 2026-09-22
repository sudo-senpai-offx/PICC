// Command Centre slice 6 — orders rail API: GET/POST /api/command-centre/orders,
// POST .../orders/execute (carrier A), POST .../orders/verify (carrier B).
// ccxtOrdering (the venue seam) is vi.mocked — the route-level tests exercise
// the REAL gate chain + REAL audit trail + REAL proposal replay, while the
// venue step stays a fixture (spec testing decision, same as the slice-5
// execute-route mock of interventions).
//
// Hermetic: handlers is imported FRESH per test with the data dirs in a tmp
// dir, so boot reads + persisted state can never touch the real server data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

const ORDER = { exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000 }

describe("Command Centre slice 6 — orders rail API (ccxt)", () => {
  let dir
  let handleApi
  let audit
  let ordering

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-cc-orders-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    process.env.PICC_AUTOMATOR_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
    // WS-2: the rail's risk gates (16-19) resolve from these venue stores, so a
    // hermetic data dir must seed them GREEN — the aggregate then reads day loss
    // 0% / no drawdown and heat 0, letting the routes test their own layer.
    const dayKey = new Date().toISOString().slice(0, 10)
    const at = new Date().toISOString()
    writeFileSync(join(dir, "ccxt-equity.json"), JSON.stringify({ binance: { exchange: "binance", dayKey, at, equityUsd: 100, dayStartEquityUsd: 100 } }))
    writeFileSync(join(dir, "ccxt-perps-risk.json"), JSON.stringify({ version: 1, exchange: "hyperliquid", dayKey, equityAt: at, equityUsd: 100, dayStartEquityUsd: 100 }))
    writeFileSync(join(dir, "ccxt-perps-positions.json"), JSON.stringify({ version: 1, positions: [] }))
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    audit = await import("../services/commandCentre/auditTrail.mjs")
    ordering = await import("../services/ccxtOrdering.mjs")
    // restore the fixture defaults every test (vi.mock factories persist impls)
    vi.mocked(ordering.observeCcxtEquity).mockResolvedValue({
      ok: true,
      exchange: "binance",
      equityUsd: 100,
      dayStartEquityUsd: 100,
      dayLossPct: 0,
      baselineSeeded: true
    })
    vi.mocked(ordering.fetchReferencePrice).mockResolvedValue({ exchange: "binance", symbol: "BTC/USDT", price: 1000 })
    vi.mocked(ordering.placeCcxtOrder).mockClear()
    vi.mocked(ordering.placeCcxtOrder).mockResolvedValue({ ok: true, id: "fixture-venue-order" })
    vi.mocked(ordering.verifyCcxtFill).mockClear()
    vi.mocked(ordering.verifyCcxtFill).mockResolvedValue(null)
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

  it("GET orders starts empty and lists durable proposals after one propose", async () => {
    const empty = await call(handleApi, "GET", "/api/command-centre/orders")
    expect(empty.status).toBe(200)
    expect(empty.body.orders).toEqual([])

    const propose = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    expect(propose.body.ok).toBe(true)
    const list = await call(handleApi, "GET", "/api/command-centre/orders")
    expect(list.body.orders).toHaveLength(1)
    const row = list.body.orders[0]
    expect(row).toMatchObject({
      clientOrderId: propose.body.clientOrderId,
      idempotencyKey: `ccxt:order:binance:${propose.body.clientOrderId}`,
      exchange: "binance",
      symbol: "BTC/USDT",
      side: "buy",
      amount: 0.01,
      price: 1000,
      notionalUsd: 10,
      status: "open",
      proposedBy: "default"
    })
    expect(row.rationale.length).toBeGreaterThanOrEqual(12)
    expect(row.rationale).toContain("human-approved per-action")
  })

  it("POST propose runs the FULL gate chain at propose time: consent recorded, no venue touched", async () => {
    const res = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.gate.allow).toBe(true)
    expect(res.body.gate.blockedBy).toBeNull()
    expect(res.body.clientOrderId).toMatch(/^picc-/)
    // propose never reaches the venue — placeCcxtOrder is the execute-only seam
    expect(ordering.placeCcxtOrder).not.toHaveBeenCalled()
    const trail = audit.readAudit()
    expect(trail.some((e) => e.kind === "safety-gate:allow")).toBe(true)
    expect(trail.some((e) => e.kind === "proposal:created")).toBe(true)
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("POST propose CLAMPS the notional to the envelope ceiling — the order the rail records is the sized one", async () => {
    const res = await call(handleApi, "POST", "/api/command-centre/orders", {
      ...ORDER,
      amount: 0.1,
      price: 200 // gross $20 → clamped into the $10 envelope
    })
    expect(res.body.ok).toBe(true)
    expect(res.body.order.clamped).toBe(true)
    expect(res.body.order.notionalUsd).toBeLessThanOrEqual(10)
    expect(res.body.order.amount * 200).toBeLessThanOrEqual(10)
  })

  it("POST propose with an UNOBSERVABLE balance is honestly denied (5E) — no phantom proposal", async () => {
    vi.mocked(ordering.observeCcxtEquity).mockResolvedValueOnce({ ok: false, exchange: "binance", reason: "balance-unobservable", fresh: false })
    const res = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    expect(res.body.ok).toBe(false)
    expect(res.body.gate.blockedBy).toBe("fresh-data")
    expect(res.body.gate.reason).toContain("ccxt-equity")
    expect(audit.readAudit().some((e) => e.kind === "proposal:created")).toBe(false)
  })

  it("POST propose sanitizes its inputs: exchange/symbol/side/amount/price are each validated", async () => {
    const missing = await call(handleApi, "POST", "/api/command-centre/orders", { ...ORDER, exchange: "" })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain("exchange")
    const badSymbol = await call(handleApi, "POST", "/api/command-centre/orders", { ...ORDER, symbol: "BTCUSDT" })
    expect(badSymbol.status).toBe(400)
    const badSide = await call(handleApi, "POST", "/api/command-centre/orders", { ...ORDER, side: "hold" })
    expect(badSide.status).toBe(400)
    const badAmount = await call(handleApi, "POST", "/api/command-centre/orders", { ...ORDER, amount: -1 })
    expect(badAmount.status).toBe(400)
  })

  it("POST execute (carrier A) replays the DURABLE proposal, passes the full chain, reaches the venue EXACTLY once", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    expect(propose.body.ok).toBe(true)
    const res = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.gate.allow).toBe(true)
    expect(res.body.execution).toMatchObject({
      status: "executed",
      idempotencyKey: `ccxt:order:binance:${propose.body.clientOrderId}:exec`
    })
    // the order the venue received is the proposal's (clamped, exchange-tag, venue order id)
    expect(ordering.placeCcxtOrder).toHaveBeenCalledTimes(1)
    const placed = vi.mocked(ordering.placeCcxtOrder).mock.calls[0][0]
    expect(placed).toMatchObject({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: 0.01, price: 1000, clientOrderId: propose.body.clientOrderId })
    // the durable trail records allow + executed; the list flips to executed
    const trail = audit.readAudit()
    expect(trail.some((e) => e.kind === "execution:executed")).toBe(true)
    expect(audit.verifyAudit().ok).toBe(true)
    const list = await call(handleApi, "GET", "/api/command-centre/orders")
    expect(list.body.orders[0].status).toBe("executed")
  })

  it("POST execute with an UNKNOWN clientOrderId is a 404 — nothing durable to execute", async () => {
    const res = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: "picc-never-proposed"
    })
    expect(res.status).toBe(404)
    expect(res.body.error).toContain("unknown proposal")
    expect(ordering.placeCcxtOrder).not.toHaveBeenCalled()
  })

  it("POST execute DENIES before the venue when the approved limit is stale vs the FRESH market (5E)", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    expect(propose.body.ok).toBe(true)
    // the market moved: fresh reference is now 950 — a 1000 BUY limit rests 5.3% above it
    vi.mocked(ordering.fetchReferencePrice).mockResolvedValue({ exchange: "binance", symbol: "BTC/USDT", price: 950 })
    const res = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.blockedBeforeVenue).toBe(true)
    expect(res.body.gate.blockedBy).toBe("fresh-data")
    expect(res.body.gate.reason).toContain("ABOVE the fresh reference")
    expect(res.body.execution).toBeNull()
    expect(ordering.placeCcxtOrder).not.toHaveBeenCalled()
  })

  it("POST execute is IDEMPOTENT (5G): a re-click is denied before the venue — it is reached exactly once", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    const first = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId
    })
    expect(first.body.ok).toBe(true)
    const second = await call(handleApi, "POST", "/api/command-centre/orders/execute", {
      clientOrderId: propose.body.clientOrderId
    })
    expect(second.body.ok).toBe(false)
    expect(second.body.gate.blockedBy).toBe("idempotent")
    expect(ordering.placeCcxtOrder).toHaveBeenCalledTimes(1)
  })

  it("POST verify (carrier B) records the honest READ-ONLY fill and flips the list row", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    vi.mocked(ordering.verifyCcxtFill).mockResolvedValue({ id: "venue-99", status: "closed", filled: 0.01, average: 999, at: 1700000000000 })
    const res = await call(handleApi, "POST", "/api/command-centre/orders/verify", {
      clientOrderId: propose.body.clientOrderId,
      orderId: "venue-99"
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.kind).toBe("ccxt-verify:filled")
    expect(audit.readAudit().some((e) => e.kind === "ccxt-verify:filled")).toBe(true)
    const list = await call(handleApi, "GET", "/api/command-centre/orders")
    expect(list.body.orders[0].status).toBe("verified-filled")
  })

  it("POST verify NEVER fabricates a fill: an unobserved venue is recorded as unobserved", async () => {
    const propose = await call(handleApi, "POST", "/api/command-centre/orders", ORDER)
    vi.mocked(ordering.verifyCcxtFill).mockResolvedValue(null)
    const res = await call(handleApi, "POST", "/api/command-centre/orders/verify", {
      clientOrderId: propose.body.clientOrderId,
      orderId: "venue-100"
    })
    expect(res.body.ok).toBe(false)
    expect(res.body.kind).toBe("ccxt-verify:unobserved")
    const list = await call(handleApi, "GET", "/api/command-centre/orders")
    expect(list.body.orders[0].status).toBe("verify-unobserved")
  })

  it("POST verify sanitizes: clientOrderId + venue orderId required; unknown proposal is a 404", async () => {
    const missing = await call(handleApi, "POST", "/api/command-centre/orders/verify", { clientOrderId: "x" })
    expect(missing.status).toBe(400)
    const unknown = await call(handleApi, "POST", "/api/command-centre/orders/verify", {
      clientOrderId: "picc-ghost",
      orderId: "venue-1"
    })
    expect(unknown.status).toBe(404)
  })

  it("all four orders routes are authenticated like the rest of the surface", async () => {
    const auth = await import("../services/auth.mjs")
    await auth.createAccount({ email: "cc-orders@example.com", password: "correct-horse-battery", name: "Orders" })
    for (const [method, path, body] of [
      ["GET", "/api/command-centre/orders", undefined],
      ["POST", "/api/command-centre/orders", ORDER],
      ["POST", "/api/command-centre/orders/execute", { clientOrderId: "picc-x" }],
      ["POST", "/api/command-centre/orders/verify", { clientOrderId: "picc-x", orderId: "v1" }]
    ]) {
      const req = makeReq(method, path, body)
      req.socket = { remoteAddress: "203.0.113.5" } // NOT localhost
      const res = makeRes()
      await handleApi(req, res, path)
      expect(res.status).toBe(401)
    }
  })
})