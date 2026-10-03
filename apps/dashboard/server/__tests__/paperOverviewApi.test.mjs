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
// ── WHY THIS HARNESS USED TO BE VACUOUS, AND WHAT CHANGED ──
//
// This file's header used to claim "/api/trading/* is auth-free (localhost)",
// and its `makeReq` supplied `socket: { remoteAddress: "127.0.0.1" }` to match.
// Both were true when written and BOTH BECAME FALSE: the owner ruling in
// 6aa43e6 gated GET /api/trading/paper/overview (and /api/trading/paper/trade,
// which these tests also call). Taking the loopback bypass made every 200 below
// reachable by an anonymous caller that production refuses — so the file could
// not have detected the gate, and its stated reason for being auth-free had
// quietly become a lie a later reader would believe.
//
// The harness now presents a NON-LOOPBACK peer and a real session, which is the
// path production takes, and one test asserts the anonymous caller is refused.
// No existing assertion was weakened or removed.
//
// Hermetic: handlers + trading are imported FRESH per test with the trading +
// auth data dirs pointed at a tmp dir so boot reads/writes never touch the
// real server data dir. The seeded session goes into the HARNESS-owned auth
// store (`PICC_AUTH_DATA_DIR`), which the shared setup empties before each test
// — hence re-seeded per test rather than once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TOKEN = "p".repeat(64)
const USER_ROW = { id: "u1", email: "paper@example.test", name: "Paper", salt: "s", passwordHash: "h", createdAt: 1 }

// TEST-NET-3 (203.0.113.0/24) is reserved and unroutable: non-loopback, which
// is what an attacker is, and inert.
const PEER = "203.0.113.11"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "example.test", "content-type": "application/json", ...headers },
    socket: { remoteAddress: PEER },
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
  await handleApi(makeReq(method, path, body, { authorization: `Bearer ${TOKEN}`, ...headers }), res, path)
  return res
}

/** The same routes with no credential — the anonymous non-loopback caller. */
async function callAnonymous(handleApi, method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
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
    // A session, so the gate has something real to accept. The auth store is
    // emptied by the shared harness before every test, so this is per test.
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [USER_ROW] }))
    writeFileSync(
      join(dir, "sessions.json"),
      JSON.stringify({
        sessions: { [TOKEN]: { userId: USER_ROW.id, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
      })
    )
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

  // The control the 200s below depend on. Without it, "the route answered" is
  // also satisfied by a route that answers EVERYONE, and this file could not
  // have detected the gate that made it vacuous in the first place.
  it("refuses an ANONYMOUS non-loopback reader, so the 200s below mean something", async () => {
    const res = await callAnonymous(handleApi, "GET", "/api/trading/paper/overview")
    expect(res.status).toBe(401)
    // And the refusal carries none of the ledger shape the read returns.
    const flat = JSON.stringify(res.body)
    for (const key of ["starting", "cash", "equity", "openCount", "winRate"]) {
      expect(flat, `a 401 must not leak ${key}`).not.toContain(key)
    }
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