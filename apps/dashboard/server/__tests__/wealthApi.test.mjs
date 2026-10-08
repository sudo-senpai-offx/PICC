// W3-01 Task 9 — GET /api/wealth/overview + POST /api/wealth/transfers at the
// HTTP boundary.
//
// THE GATE IS ASSERTED HERE, NOT LEFT TO THE STATIC SCAN.
// `ws7RouteAuthCoverageGuard` proves a gate call exists in each route's own
// block; this proves both routes answer 401 to an anonymous caller.
// A scan can be satisfied by a gate that never runs — T7R-B's stated reason
// for writing `copilotDecisionRoute.test.mjs` — and these are the assertions
// that cannot be.
//
// PAPER READ-ONLY IS ASSERTED HERE, NOT TRUSTED.
// `paperAnalytics()` (the producer behind GET /api/trading/paper/analytics)
// auto-closes TP/SL hits on its default path — that write is KEPT by owner
// ruling and pinned in `paperAnalyticsAutoClose.test.mjs`. The wealth overview
// must NEVER take that path: it builds its paper block from `paperOverview()`
// (two readJSON calls + pure math), so a seeded open position with a tripped
// TP must be byte-identical on disk after the call. A field check would pass
// if the route rewrote every other field; only a byte-level comparison can
// say the file was not touched at all.
//
// Hermetic: booted through the SHARED store-isolation helper, so no store
// resolves to the real `server/data`. No `process.env` assignment by hand:
// `ws7TestStoreIsolation.test.mjs` enumerates via `git ls-files` and refuses
// a hand-rolled redirect, and the helper leaves no such literal.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const OVERVIEW = "/api/wealth/overview"
const TRANSFERS = "/api/wealth/transfers"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    // DELIBERATELY NO `socket`. `requireAuth` admits a request outright when
    // `isLocalhostRequest(req)` is true, and that predicate reads the real TCP
    // peer. Omitting `socket` presents a NON-loopback caller, which is what an
    // attacker is. Same reasoning as `paperLivePermitRoute.test.mjs` and
    // `copilotDecisionRoute.test.mjs`.
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
const TOKEN = "c".repeat(64)

describe("wealth API (Task 9) — overview route, transfer route, read-only paper", () => {
  let wealthDir
  let authDir
  let tradingDir
  let dataDir

  beforeEach(() => {
    // Through the SHARED helper, never `process.env` by hand.
    wealthDir = useIsolatedStoreDir("PICC_WEALTH_DATA_DIR")
    authDir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
    tradingDir = useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
    dataDir = useIsolatedStoreDir("PICC_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of [wealthDir, authDir, tradingDir, dataDir]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  async function loadHandlers({ withUser = true } = {}) {
    // A user exists so auth is ENFORCED. With an empty store `requireAuth`
    // takes its first-run bootstrap branch, which admits everyone — pinned
    // explicitly below rather than left to be discovered.
    if (withUser) {
      writeFileSync(
        join(authDir, "users.json"),
        JSON.stringify({ users: [{ id: "u1", email: "wealth@example.test", password: "x", salt: "y" }] })
      )
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?wealth-api-test")
    return handleApi
  }

  /** An AUTHENTICATED, non-loopback caller: a user AND a session carrying the token. */
  async function authed() {
    writeFileSync(
      join(authDir, "users.json"),
      JSON.stringify({ users: [{ id: "u1", email: "wealth@example.test", password: "x", salt: "y" }] })
    )
    writeFileSync(
      join(authDir, "sessions.json"),
      JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?wealth-api-authed")
    return { api: handleApi, headers: { authorization: `Bearer ${TOKEN}` } }
  }

  it("GET overview refuses an anonymous caller with 401", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", OVERVIEW)
    expect(res.status).toBe(401)
  })

  it("GET overview returns the partial-total shape with seeded ABSENT legs", async () => {
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // Nothing convertible on a fresh isolated store (seeded ABSENT shells,
    // no manual entries, no keys): honest null, never a confident zero.
    expect(res.body.totalUsd).toBe(null)
    expect(res.body.incomplete).toBe(true)
    expect(Array.isArray(res.body.legs)).toBe(true)
    for (const leg of res.body.legs) {
      expect(typeof leg.id).toBe("string")
      expect(["LIVE", "STALE", "ABSENT", "ENTERED"]).toContain(leg.status)
    }
    // Paper block: exactly the five summary fields, never converted, never summed.
    expect(Object.keys(res.body.paper).sort()).toEqual(["cash", "closed", "committed", "equity", "open"])
    expect(Array.isArray(res.body.transfers)).toBe(true)
    expect(Array.isArray(res.body.snapshots)).toBe(true)
    expect(Array.isArray(res.body.suggestions)).toBe(true)
  })

  it("GET overview cannot mark or close paper positions (byte-identical ledger)", async () => {
    // A position whose TP is tripped by ANY live quote: the paper-analytics
    // default path would close it. The overview must not.
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
    expect(res.body.paper.open).toBe(1)
    expect(res.body.paper.closed).toBe(0)
    expect(readFileSync(ledgerFile, "utf8"), "overview must not write the paper ledger").toBe(before)
  })

  it("POST transfers refuses an anonymous caller with 401", async () => {
    const api = await loadHandlers()
    const res = await call(api, "POST", TRANSFERS, {
      fromLeg: "hyperliquid",
      toLeg: "ccxt-spot",
      ccy: "USD",
      amount: 100,
      at: new Date().toISOString()
    })
    expect(res.status).toBe(401)
  })

  it("POST transfers validates (AWAITED) then writes through the store", async () => {
    const { api, headers } = await authed()
    const at = new Date().toISOString()
    const res = await call(
      api,
      "POST",
      TRANSFERS,
      { fromLeg: "hyperliquid", toLeg: "ccxt-spot", ccy: "USD", amount: 100, at, note: "rebalance" },
      headers
    )
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.transfer.fromLeg).toBe("hyperliquid")
    expect(res.body.transfer.toLeg).toBe("ccxt-spot")
    // And the write is durable: the overview carries it as evidence.
    const ov = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(ov.body.transfers).toHaveLength(1)
    expect(ov.body.transfers[0].note).toBe("rebalance")
  })

  it("POST transfers rejects a missing at with its named reason (async validation ran)", async () => {
    const { api, headers } = await authed()
    const res = await call(
      api,
      "POST",
      TRANSFERS,
      { fromLeg: "hyperliquid", toLeg: "ccxt-spot", ccy: "USD", amount: 100 },
      headers
    )
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
    // A bare Promise has no `.reason`: this exact string proves the async
    // validateTransfer was AWAITED rather than truthiness-checked.
    expect(res.body.reason).toBe("transfer-at-required")
  })

  it("POST transfers rejects a same-leg transfer with its named reason", async () => {
    const { api, headers } = await authed()
    const res = await call(
      api,
      "POST",
      TRANSFERS,
      { fromLeg: "hyperliquid", toLeg: "hyperliquid", ccy: "USD", amount: 100, at: new Date().toISOString() },
      headers
    )
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
    expect(res.body.reason).toBe("transfer-same-leg")
  })

  it("POST transfers rejects an unknown leg with its named reason", async () => {
    const { api, headers } = await authed()
    const res = await call(
      api,
      "POST",
      TRANSFERS,
      { fromLeg: "hyperliquid", toLeg: "ghost-venue", ccy: "USD", amount: 100, at: new Date().toISOString() },
      headers
    )
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
    expect(String(res.body.reason)).toMatch(/transfer-unknown-leg/)
  })

  it("suggestions surface as unconfirmed candidates and never auto-confirm", async () => {
    const { api, headers } = await authed()
    const store = await import("../services/wealth/store.mjs")
    const now = new Date().toISOString()
    // Two bare sightings: same ccy, amounts within 1%, close in time.
    expect(store.upsertLeg({ id: "jar-a", kind: "manual", ccy: "USD", amount: 100, asOf: now, observedAt: now }).ok).toBe(true)
    expect(store.upsertLeg({ id: "jar-b", kind: "manual", ccy: "USD", amount: 100.5, asOf: now, observedAt: now }).ok).toBe(true)
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(res.body.suggestions.length).toBeGreaterThan(0)
    for (const s of res.body.suggestions) {
      expect(s.confidence).toBe("candidate")
      expect(s.status).toBe("unconfirmed")
    }
    // Nothing auto-wrote: the transfer log is still empty.
    expect(res.body.transfers).toHaveLength(0)
  })

  it("inherits requireAuth's first-run bootstrap, and that is pinned, not assumed", async () => {
    // INHERITED, NOT INTRODUCED. Every `requireAuth` site in handlers.mjs takes
    // this branch when the user store is empty, because `requireAuth` is shared.
    // Recorded as INHERITED rather than mitigated, and asserted so a change in
    // the shared gate's behaviour shows up here.
    const api = await loadHandlers({ withUser: false })
    const res = await call(api, "GET", OVERVIEW)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})
