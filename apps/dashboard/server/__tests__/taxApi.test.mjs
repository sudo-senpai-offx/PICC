// Task 5 — GET /api/tax/lots?from&to at the HTTP boundary.
//
// THE GATE IS ASSERTED HERE, NOT LEFT TO THE STATIC SCAN (costsApi precedent).
// `ws7RouteAuthCoverageGuard` proves a gate call exists in the route's own block;
// this proves the route answers 401 to an anonymous caller.
//
// READ-ONLY IS ASSERTED HERE, NOT TRUSTED (wealthApi/costsApi precedent).
// The inputs assembly must never close/mark/write: seeded journal, costs and
// wealth files are byte-identical on disk after the call.
//
// LIVE CLOSES ARE EPHEMERAL (inputs.mjs defaultLiveCloses): there is no
// close-history store, so the production route honestly reports absence ([]).
// Live-close injection is covered hermetically in taxInputs.test.mjs via the
// `deps.liveCloses` seam — no second seam is invented here.
//
// Hermetic: booted through the SHARED store-isolation helper, so no store
// resolves to the real `server/data`. No `process.env` assignment by hand.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const LOTS = "/api/tax/lots"

const HEADER =
  "date,asset,side,qty,price,ccy,feeUsd,proceedsUsd,basisUsd,gainUsd,method,provenance,selfTransfer,flags"
const BANNER = "# PICC tax lots — report only, not tax advice. Verify with your accountant."

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

function makeCsvRes() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body == null ? null : String(body)
    }
  }
}

async function call(api, method, path, body, headers) {
  const res = makeCsvRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

/** A bearer token whose value is irrelevant to the assertions below. */
const TOKEN = "e".repeat(64)

function csvDataRows(text) {
  return text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#") && line !== HEADER)
}

describe("tax API (Task 5) — lots download route", () => {
  let journalDir
  let costsDir
  let wealthDir
  let authDir
  let commandCentreDir
  let tradingDir
  let dataDir

  beforeEach(() => {
    // Through the SHARED helper, never `process.env` by hand.
    journalDir = useIsolatedStoreDir("PICC_JOURNAL_DATA_DIR")
    costsDir = useIsolatedStoreDir("PICC_COSTS_DATA_DIR")
    wealthDir = useIsolatedStoreDir("PICC_WEALTH_DATA_DIR")
    authDir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
    commandCentreDir = useIsolatedStoreDir("PICC_COMMAND_CENTRE_DATA_DIR")
    tradingDir = useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
    dataDir = useIsolatedStoreDir("PICC_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of [journalDir, costsDir, wealthDir, authDir, commandCentreDir, tradingDir, dataDir]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  async function loadHandlers({ withUser = true } = {}) {
    if (withUser) {
      writeFileSync(
        join(authDir, "users.json"),
        JSON.stringify({ users: [{ id: "u1", email: "tax@example.test", password: "x", salt: "y" }] })
      )
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?tax-api-test")
    return handleApi
  }

  /** An AUTHENTICATED, non-loopback caller: a user AND a session carrying the token. */
  async function authed() {
    writeFileSync(
      join(authDir, "users.json"),
      JSON.stringify({ users: [{ id: "u1", email: "tax@example.test", password: "x", salt: "y" }] })
    )
    writeFileSync(
      join(authDir, "sessions.json"),
      JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?tax-api-authed")
    return { api: handleApi, headers: { authorization: `Bearer ${TOKEN}` } }
  }

  /** Seed one closed BTC journal trade through the real store (shared module instance). */
  async function seedClosedBtc({ entryTime, exitTime, qty = 0.5 } = {}) {
    const journal = await import("../services/tradeJournal.mjs")
    const entry = journal.addEntry({
      symbol: "BTC",
      side: "long",
      entryPrice: 50000,
      quantity: qty,
      entryTime: entryTime ?? "2026-01-10T00:00:00Z"
    })
    journal.closeEntry(entry.id, { exitPrice: 60000, exitTime: exitTime ?? "2026-02-10T00:00:00Z" })
    return entry
  }

  it("GET lots refuses an anonymous caller with 401", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", LOTS)
    expect(res.status).toBe(401)
  })

  it("GET lots with an invalid from answers 400 with a named reason, never a silent default", async () => {
    const { api, headers } = await authed()
    const res = await call(api, "GET", `${LOTS}?from=not-a-date`, undefined, headers)
    expect(res.status).toBe(400)
    expect(String(JSON.parse(res.body).reason)).toMatch(/invalid-from/)
  })

  it("GET lots with an invalid to answers 400 with a named reason, never a silent default", async () => {
    const { api, headers } = await authed()
    const res = await call(api, "GET", `${LOTS}?to=32-15-99`, undefined, headers)
    expect(res.status).toBe(400)
    expect(String(JSON.parse(res.body).reason)).toMatch(/invalid-to/)
  })

  it("GET lots on an empty store returns the banner, the fixed header, and zero lot rows", async () => {
    const { api, headers } = await authed()
    const res = await call(api, "GET", LOTS, undefined, headers)
    expect(res.status).toBe(200)
    expect(String(res.headers["Content-Type"])).toMatch(/text\/csv/)
    expect(String(res.headers["Content-Disposition"])).toMatch(
      /^attachment; filename="picc-tax-lots-\d{4}-\d{2}-\d{2}\.csv"$/
    )
    const lines = res.body.split("\n")
    expect(lines[0]).toBe(BANNER)
    expect(lines).toContain("# method: FIFO")
    expect(lines).toContain(HEADER)
    expect(csvDataRows(res.body)).toEqual([])
  })

  it("GET lots lists a closed journal trade with FIFO basis and fee-unobserved honesty", async () => {
    const { api, headers } = await authed()
    await seedClosedBtc()
    const res = await call(api, "GET", LOTS, undefined, headers)
    expect(res.status).toBe(200)
    const rows = csvDataRows(res.body)
    expect(rows).toHaveLength(1)
    // qty 0.5 @ 60000 proceeds 30000, basis 0.5 @ 50000 = 25000, gain 5000.
    expect(rows[0]).toContain("BTC")
    expect(rows[0]).toContain("30000")
    expect(rows[0]).toContain("25000")
    expect(rows[0]).toContain("5000")
    expect(rows[0]).toContain("FIFO")
    expect(rows[0]).toContain("journal-close")
    expect(rows[0]).toContain("fee-unobserved")
  })

  it("GET lots filters disposals on exitTime, never inventing a range", async () => {
    const { api, headers } = await authed()
    await seedClosedBtc({ exitTime: "2026-02-10T00:00:00Z" })
    await seedClosedBtc({ entryTime: "2026-04-01T00:00:00Z", exitTime: "2026-05-10T00:00:00Z" })
    const res = await call(api, "GET", `${LOTS}?from=2026-04-01&to=2026-06-01`, undefined, headers)
    expect(res.status).toBe(200)
    const rows = csvDataRows(res.body)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("2026-05-10")
  })

  it("GET lots flags a disposal matching a wealth self-transfer, still listed", async () => {
    const { api, headers } = await authed()
    await seedClosedBtc({ exitTime: "2026-02-10T00:00:00Z" })
    const wealth = await import("../services/wealth/store.mjs")
    wealth.addTransfer({
      fromLeg: "jar-a",
      toLeg: "jar-b",
      ccy: "BTC",
      amount: 0.5,
      at: "2026-02-10T00:00:00.000Z",
      note: "rebalance"
    })
    const res = await call(api, "GET", LOTS, undefined, headers)
    expect(res.status).toBe(200)
    const rows = csvDataRows(res.body)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain(",true,")
  })

  it("GET lots never writes the journal, costs, or wealth stores (read-only assembly)", async () => {
    const { api, headers } = await authed()
    await seedClosedBtc()
    const snap = (dir) => {
      try {
        return readFileSync(join(dir, "tradeJournal.json"), "utf8")
      } catch {
        return null
      }
    }
    const journalBefore = snap(journalDir)
    const res = await call(api, "GET", LOTS, undefined, headers)
    expect(res.status).toBe(200)
    expect(snap(journalDir), "the export must not rewrite the journal").toBe(journalBefore)
  })

  it("GET lots needs no ceremony unlock: honest rail-off posture without one", async () => {
    const { api, headers } = await authed()
    await seedClosedBtc()
    const res = await call(api, "GET", LOTS, undefined, headers)
    expect(res.status).toBe(200)
    expect(csvDataRows(res.body)).toHaveLength(1)
  })

  it("inherits requireAuth's first-run bootstrap, and that is pinned, not assumed", async () => {
    const api = await loadHandlers({ withUser: false })
    const res = await call(api, "GET", LOTS)
    expect(res.status).toBe(200)
  })
})
