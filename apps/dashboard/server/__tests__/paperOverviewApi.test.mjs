// Verified-fix tests for the paper venue's broker shape + API surface:
//
// 1. GET /api/trading/paper/overview — the paperOverview() function (real
//    cash / PnL / win-rate from the paper ledger) previously had NO HTTP
//    route, so the frontend could never read it.
// 2. paperAdapter.getAccountState() — previously returned the ledger's raw
//    fields (cash, starting, ...) instead of the { balance, demo, real,
//    currency } shape every other adapter returns; a venue-agnostic reader of
//    state.balance silently got undefined for the paper venue only. Now
//    normalized to balance = ledger cash, demo = true.
//
// Hermetic: handlers + trading are imported FRESH per test with the trading +
// auth data dirs pointed at a tmp dir so boot reads/writes never touch the
// real server data dir. /api/trading/* is auth-free (localhost), same as the
// account-metrics API suite.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

describe("paper overview API + adapter shape (finance-tracker fixes)", () => {
  let dir
  let handleApi
  let trading

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-paper-overview-"))
    process.env.PICC_TRADING_DATA_DIR = dir
    process.env.PICC_AUTH_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    trading = await import("../services/trading.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_TRADING_DATA_DIR
    delete process.env.PICC_AUTH_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET /api/trading/paper/overview returns the real ledger overview", async () => {
    const res = await call(handleApi, "GET", "/api/trading/paper/overview")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // Default paper starting balance with an empty ledger.
    expect(res.body.starting).toBe(10000)
    expect(res.body.cash).toBe(10000)
    expect(res.body.openCount).toBe(0)
    expect(res.body.closedCount).toBe(0)
    expect(res.body.winRate).toBeNull()
  })

  it("overview reflects an open paper position end to end through HTTP", async () => {
    const open = await call(handleApi, "POST", "/api/trading/paper/trade", {
      symbol: "EURUSD",
      side: "up",
      entry: 1.1,
      amount: 100
    })
    expect(open.body.ok).toBe(true)
    expect(open.body.position.status).toBe("open")

    const res = await call(handleApi, "GET", "/api/trading/paper/overview")
    expect(res.body.cash).toBeCloseTo(9900, 2)
    expect(res.body.openCount).toBe(1)
  })

  it("paper getAccountState returns the normalized broker shape, not the raw ledger", async () => {
    const { getBroker } = await import("../services/brokers/index.mjs")
    await import("../services/brokers/paperAdapter.mjs") // self-registers the adapter
    const paper = getBroker("paper")
    expect(paper).not.toBeNull()
    const state = await paper.getAccountState()
    expect(state).toMatchObject({ balance: 10000, demo: true, real: false, currency: "USD" })
    expect(state.balance).toBe(await trading.paperOverview().then((o) => o.cash))
  })
})