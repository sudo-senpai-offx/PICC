import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// GET /api/income/overview — the unified income surface (Q5, Task 11).
// Exercises per-user row scoping, snapshot merging, and the honesty contract
// (unobservable figures are null/empty, never fabricated zeros).

let tmp
let handleApi
let createAccount

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
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

async function call(method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

function seedSnapshots(entries) {
  writeFileSync(join(tmp, "connector_latest.json"), JSON.stringify(entries))
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-income-"))
  process.env.PICC_CONNECTOR_DATA_DIR = tmp
  process.env.PICC_AUTOMATOR_DATA_DIR = tmp
  process.env.PICC_AUTH_DATA_DIR = tmp
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  vi.resetModules()
  ;({ handleApi } = await import("../handlers.mjs"))
  ;({ createAccount } = await import("../services/auth.mjs"))
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("GET /api/income/overview", () => {
  it("requires auth", async () => {
    const acct = await createAccount({ email: "iv-a@x.com", password: "password123", name: "IVA" })
    expect(acct.token).toBeTruthy()

    const noAuth = await call("GET", "/api/income/overview")
    expect(noAuth.status).toBe(401)

    const authed = await call("GET", "/api/income/overview", undefined, {
      authorization: `Bearer ${acct.token}`
    })
    expect(authed.status).toBe(200)
  })

  it("only exposes streams/holdings owned by the requesting user", async () => {
    const a = await createAccount({ email: "iv-a2@x.com", password: "password123", name: "A" })
    const b = await createAccount({ email: "iv-b@x.com", password: "password123", name: "B" })
    const authA = { authorization: `Bearer ${a.token}` }
    const authB = { authorization: `Bearer ${b.token}` }

    const created = await call("POST", "/api/data/income_streams/upsert", {
      platform: "expertoption",
      category: "trading",
      name: "ExpertOption",
      status: "active",
      balance: 10,
      payoutThreshold: 20,
      estimatedDaily: 0.5,
      totalEarned: 25
    }, authA)
    expect(created.status).toBe(200)
    const id = created.body.row.id

    // A holding owned by A must group under holdings.nft only for A.
    const nft = await call("POST", "/api/data/nft_holdings/upsert", {
      name: "Bored Ape #1", valueUsd: 120, platform: "opensea"
    }, authA)
    expect(nft.status).toBe(200)
    const nftId = nft.body.row.id

    const owned = await call("GET", "/api/income/overview", undefined, authA)
    expect(owned.status).toBe(200)
    expect(owned.body.streams.map((s) => s.id)).toContain(id)
    expect(owned.body.summary.activeCount).toBe(1)
    expect(owned.body.holdings.nft.map((r) => r.id)).toContain(nftId)

    const other = await call("GET", "/api/income/overview", undefined, authB)
    expect(other.status).toBe(200)
    expect(other.body.streams.map((s) => s.id)).not.toContain(id)
    expect(other.body.summary.activeCount).toBe(0)
    expect(other.body.holdings.nft.map((r) => r.id)).not.toContain(nftId)
  })

  it("merges connector snapshots and reports honest summary", async () => {
    const acct = await createAccount({ email: "iv-c@x.com", password: "password123", name: "C" })
    const auth = { authorization: `Bearer ${acct.token}` }

    await call("POST", "/api/data/income_streams/upsert", {
      platform: "mysterium",
      category: "depin",
      name: "Mysterium",
      status: "active",
      balance: 5,
      payoutThreshold: 10,
      estimatedDaily: 1.2,
      totalEarned: 30
    }, auth)
    await call("POST", "/api/data/income_streams/upsert", {
      platform: "idle",
      category: "depin",
      name: "Idle",
      status: "paused", // not active — must stay out of cashout/active maths
      balance: 999,
      payoutThreshold: 0,
      estimatedDaily: 0,
      totalEarned: 0
    }, auth)

    seedSnapshots({
      mysterium: { provider: "mysterium", lifetime: 30, today: 1.2, status: "ok", lastChecked: 123 },
      aave: { provider: "aave", lifetime: 44.5, today: 0.75, status: "ok", lastChecked: 456 }
    })

    const res = await call("GET", "/api/income/overview", undefined, auth)
    expect(res.status).toBe(200)

    // Snapshots flow through the merged surface — keyed by provider slug (§4).
    const providers = Object.keys(res.body.snapshots).sort()
    expect(providers).toEqual(["aave", "mysterium"])

    // Holdings arrive grouped by table (§4), all scoped to this user.
    expect(Object.keys(res.body.holdings).sort()).toEqual(["depin", "financial", "nft", "transactions"])
    expect(res.body.holdings.transactions).toEqual([])

    // Lifetime summed across snapshots (authoritative server earnings signal).
    expect(res.body.summary.lifetime).toBe(74.5)
    expect(res.body.summary.today).toBe(1.95)

    // Only the one active stream counts; at its balance/threshold it's NOT
    // cashout-ready (5 < 10).
    expect(res.body.summary.activeCount).toBe(1)
    expect(res.body.summary.cashoutReady).toEqual([])
    expect(res.body.summary.projectedAnnual).toBeCloseTo(1.2 * 365)

    // No per-day series server-side → honest empty/null, not fabricated zeros.
    expect(res.body.summary.daily).toEqual([])
    expect(res.body.summary.monthly).toBeNull()
  })

  it("keeps error snapshots as errors, never a zero row in the aggregate", async () => {
    const acct = await createAccount({ email: "iv-e@x.com", password: "password123", name: "E" })
    const auth = { authorization: `Bearer ${acct.token}` }

    seedSnapshots({
      okSource: { provider: "okSource", lifetime: 20, today: 1, status: "ok" },
      broken: { provider: "broken", lifetime: 9999, today: 0, status: "error", error: "unauthorized" }
    })

    const res = await call("GET", "/api/income/overview", undefined, auth)
    expect(res.status).toBe(200)
    // The error snapshot is present with its honest status for the UI to badge...
    expect(res.body.snapshots.broken.status).toBe("error")
    // ...and is excluded from the lifetime aggregate (never summed as a 0 row).
    expect(res.body.summary.lifetime).toBe(20)
  })

  it("renders absent-fields-null when no snapshots exist", async () => {
    const acct = await createAccount({ email: "iv-d@x.com", password: "password123", name: "D" })
    const auth = { authorization: `Bearer ${acct.token}` }

    // No connector snapshots seeded for THIS request (drop any leftover file).
    rmSync(join(tmp, "connector_latest.json"), { force: true })
    const res = await call("GET", "/api/income/overview", undefined, auth)
    expect(res.status).toBe(200)
    expect(res.body.snapshots).toEqual({})
    expect(res.body.summary.lifetime).toBeNull()
    expect(res.body.summary.today).toBeNull()
    expect(res.body.summary.monthly).toBeNull()
    expect(res.body.summary.daily).toEqual([])
  })

  it("reports 401 when a bearer token is invalid", async () => {
    const res = await call("GET", "/api/income/overview", undefined, {
      authorization: "Bearer definitely-not-a-real-token"
    })
    expect(res.status).toBe(401)
  })

  it("keeps paper-ledger PnL out of the income summary (B-PAP-3)", async () => {
    const acct = await createAccount({ email: "iv-pap@x.com", password: "password123", name: "PAP" })
    const auth = { authorization: `Bearer ${acct.token}` }

    // A trading-category stream row renders as a real-venue/user stream...
    await call("POST", "/api/data/income_streams/upsert", {
      platform: "expertoption",
      category: "trading",
      name: "ExpertOption",
      status: "active",
      balance: 10,
      payoutThreshold: 20,
      estimatedDaily: 0.5,
      totalEarned: 25
    }, auth)

    seedSnapshots({
      mysterium: { provider: "mysterium", lifetime: 30, today: 1.2, status: "ok", lastChecked: 123 }
    })
    await writeFile(join(tmp, "trading-ledger.json"), JSON.stringify({
      positions: [],
      closed: [
        // A fat paper-ledger delta today: +$4,999 then -$98 on simulated money.
        { pnl: 4999, closedAt: new Date().toISOString() },
        { pnl: -98, closedAt: new Date().toISOString() }
      ],
      signals: []
    }), "utf8")

    const res = await call("GET", "/api/income/overview", undefined, auth)
    expect(res.status).toBe(200)

    // The trading-category stream is present as a user row (real-venue data)...
    expect(res.body.streams.some((s) => s.category === "trading" && s.platform === "expertoption")).toBe(true)
    expect(res.body.summary.activeCount).toBe(1)
    // ...but the paper ledger delta does NOT move the summary at all:
    // lifetime/today are snapshot-driven, monthly is unobservable -> null.
    expect(res.body.summary.lifetime).toBe(30)
    expect(res.body.summary.today).toBe(1.2)
    expect(res.body.summary.monthly).toBeNull()
    // No snapshot was derived from the paper ledger's closed trades.
    expect(Object.keys(res.body.snapshots).sort()).toEqual(["mysterium"])

    // Clean up so later runs in this file start without a paper ledger.
    await rm(join(tmp, "trading-ledger.json"), { force: true }).catch(() => {})
  })
})
