// Task 7 — GET /api/costs/overview + costs-refresh record job at the boundary.
//
// THE GATE IS ASSERTED HERE, NOT LEFT TO THE STATIC SCAN (wealthApi precedent).
// `ws7RouteAuthCoverageGuard` proves a gate call exists in the route's own block;
// this proves the route answers 401 to an anonymous caller.
//
// PAPER READ-ONLY IS ASSERTED HERE, NOT TRUSTED (wealthApi precedent).
// The paper read path (readPaperCloses -> paperHistory + paperOverview) must
// never reach the auto-closing paperAnalytics path: a seeded tripped-TP position
// is byte-identical on disk after the call. The route's own source must contain
// none of close/mark/write/getLedger/paperPositions (grep-verified pre-commit).
//
// JOB HONESTY: each step is named-absence-tolerant — success records + rolls up
// closed days only (Task 5 contract: same-day rollups would double-count the day
// window built from live fills), empty/throwing/absent readers yield named
// reasons, never throws, never zeros.
//
// Hermetic: booted through the SHARED store-isolation helper, so no store
// resolves to the real `server/data`. No `process.env` assignment by hand.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const OVERVIEW = "/api/costs/overview"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    // DELIBERATELY NO `socket` (wealthApi precedent): requireAuth admits a
    // loopback peer outright, so omitting it presents a non-loopback caller.
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

async function call(api, method, path, body, headers) {
  const res = makeRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

/** A bearer token whose value is irrelevant to the assertions below. */
const TOKEN = "d".repeat(64)

const PROVENANCE = new Set(["measured", "modeled", "modeled-with-calibrated-inputs"])

describe("costs API (Task 7) — overview route, read-only paper drag", () => {
  let costsDir
  let authDir
  let tradingDir

  beforeEach(() => {
    // Through the SHARED helper, never `process.env` by hand.
    costsDir = useIsolatedStoreDir("PICC_COSTS_DATA_DIR")
    authDir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
    tradingDir = useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of [costsDir, authDir, tradingDir]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  async function loadHandlers({ withUser = true } = {}) {
    if (withUser) {
      writeFileSync(
        join(authDir, "users.json"),
        JSON.stringify({ users: [{ id: "u1", email: "costs@example.test", password: "x", salt: "y" }] })
      )
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?costs-api-test")
    return handleApi
  }

  /** An AUTHENTICATED, non-loopback caller: a user AND a session carrying the token. */
  async function authed() {
    writeFileSync(
      join(authDir, "users.json"),
      JSON.stringify({ users: [{ id: "u1", email: "costs@example.test", password: "x", salt: "y" }] })
    )
    writeFileSync(
      join(authDir, "sessions.json"),
      JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?costs-api-authed")
    return { api: handleApi, headers: { authorization: `Bearer ${TOKEN}` } }
  }

  it("GET overview refuses an anonymous caller with 401", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", OVERVIEW)
    expect(res.status).toBe(401)
  })

  it("GET overview returns the scorecard shape with provenance on every number", async () => {
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // Scorecard core (Task 5 shape): venues + provenance + incomplete.
    expect(Array.isArray(res.body.venues)).toBe(true)
    expect(typeof res.body.incomplete).toBe("boolean")
    // Empty isolated store: honest null total + named reason, never a zero.
    expect(res.body.venues).toEqual([])
    expect(res.body.totalUsd).toBeNull()
    expect(typeof res.body.reason).toBe("string")
    for (const row of res.body.venues) {
      for (const leg of [...(row.day?.byKind ?? []), ...(row.allTime?.byKind ?? [])]) {
        expect(PROVENANCE.has(leg.provenance)).toBe(true)
      }
    }
    // Paper drag panel: labeled modeled, series present even with no closes.
    expect(res.body.paper.label).toBe("drag-adjusted (modeled)")
    expect(Array.isArray(res.body.paper.series)).toBe(true)
    expect(Array.isArray(res.body.paper.lines)).toBe(true)
  })

  it("GET overview cannot mark or close paper positions (byte-identical ledger)", async () => {
    const ledgerFile = join(tradingDir, "trading-ledger.json")
    writeFileSync(
      ledgerFile,
      JSON.stringify({
        positions: [
          { id: "p1", symbol: "BTCUSD", side: "up", amount: 100, entry: 50000, takeProfit: 1, stopLoss: 1000000 }
        ],
        closed: [],
        signals: []
      })
    )
    const before = readFileSync(ledgerFile, "utf8")
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(readFileSync(ledgerFile, "utf8"), "overview must not write the paper ledger").toBe(before)
  })

  it("paper drag lines destructure { lines } and align oldest-first with the curve", async () => {
    // Seed two closes oldest-first in ledger order; paperHistory serves them
    // newest-first, so the route must re-order before curve + overlay (F3).
    const ledgerFile = join(tradingDir, "trading-ledger.json")
    writeFileSync(
      ledgerFile,
      JSON.stringify({
        positions: [],
        closed: [
          { id: "c1", symbol: "BTCUSD", side: "up", amount: 1000, entry: 50000, exit: 50100, pnl: 2, closedAt: "2026-09-01T10:00:00.000Z" },
          { id: "c2", symbol: "BTCUSD", side: "up", amount: 2000, entry: 50000, exit: 49900, pnl: -4, closedAt: "2026-09-02T10:00:00.000Z" }
        ],
        signals: []
      })
    )
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    const { lines, series } = res.body.paper
    expect(lines.map((l) => l.closeId)).toEqual(["c1", "c2"])
    for (const line of lines) {
      expect(line.provenance).toBe("modeled")
    }
    // Seed point + one point per close, same timestamps, drag at or below equity.
    expect(series).toHaveLength(3)
    expect(series[0].cumulativeCostUsd).toBe(0)
    expect(series[1].cumulativeCostUsd).toBeGreaterThan(0)
    expect(series[2].cumulativeCostUsd).toBeGreaterThanOrEqual(series[1].cumulativeCostUsd)
    expect(series[1].t).toBe("2026-09-01T10:00:00.000Z")
    expect(series[2].t).toBe("2026-09-02T10:00:00.000Z")
  })

  it("inherits requireAuth's first-run bootstrap, and that is pinned, not assumed", async () => {
    const api = await loadHandlers({ withUser: false })
    const res = await call(api, "GET", OVERVIEW)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe("costs-refresh job (Task 7) — record + closed-day rollups", () => {
  let costsDir

  beforeEach(() => {
    costsDir = useIsolatedStoreDir("PICC_COSTS_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    rmSync(costsDir, { recursive: true, force: true })
  })

  async function loadJob() {
    vi.resetModules()
    return import("../services/jobs/costs-refresh.mjs")
  }

  const feeFill = (over = {}) => ({
    venue: "hyperliquid",
    route: "close",
    fee: { cost: 0.01, currency: "USDT" },
    observedAt: "2026-09-01T10:00:00.000Z",
    ...over
  })

  it("records measured fills and rolls up closed days only", async () => {
    const job = await loadJob()
    const now = Date.parse("2026-10-08T12:00:00+08:00")
    const out = await job.run({
      now,
      listFills: async () => [
        feeFill({ observedAt: "2026-09-01T10:00:00+08:00" }),
        feeFill({ observedAt: "2026-09-01T11:00:00+08:00" }),
        feeFill({ observedAt: new Date(now).toISOString() })
      ]
    })
    expect(out.ok).toBe(true)
    expect(out.recorded).toBe(3)
    // Closed day rolled up with summed totals; today's fills stay live (no
    // same-day rollup — Task 5 contract, would double-count the day window).
    const days = out.rollups.map((r) => r.tzDate)
    expect(days).toContain("2026-09-01")
    const store = await import("../services/costs/store.mjs")
    const todayTz = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date(now))
    expect(days).not.toContain(todayTz)
    expect(store.listFillCosts({}).length).toBe(3)
  })

  it("empty fills read as absence with a reason, never a throw or a zero", async () => {
    const job = await loadJob()
    const out = await job.run({ listFills: async () => [] })
    expect(out.ok).toBe(true)
    expect(out.recorded).toBe(0)
    expect(typeof out.reason).toBe("string")
    expect(out.rollups).toEqual([])
  })

  it("a throwing reader yields a named failure, never an escaped throw", async () => {
    const job = await loadJob()
    const out = await job.run({
      listFills: async () => {
        throw new Error("venue down")
      }
    })
    expect(out.ok).toBe(false)
    expect(typeof out.reason).toBe("string")
  })

  it("no venue reader reads as named absence (fills-unobserved), never fabricated fills", async () => {
    const job = await loadJob()
    const out = await job.run({})
    expect(out.ok).toBe(true)
    expect(out.recorded).toBe(0)
    expect(String(out.reason)).toMatch(/fills-unobserved/)
  })
})
