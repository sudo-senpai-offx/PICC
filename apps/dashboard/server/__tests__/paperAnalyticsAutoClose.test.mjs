// WS-7 owner ruling — /api/trading/paper/analytics: the finding is closed, and the
// auto-close is still there.
//
// THE FINDING. An ANONYMOUS `GET /api/trading/paper/analytics` closed an open paper
// position and wrote the trade into `trading-ledger.json`, at a price derived from a live
// quote. Proven by EXECUTION, not inferred: the probe drove the route with no
// Authorization header and the ledger changed. An unauthenticated caller could mutate the
// operator's trading record with a plain GET. It survived the previous pass because it was
// classified as a "read".
//
// THE RULING WAS "GATE THE ROUTE, KEEP THE AUTO-CLOSE", and this file exists because
// those are two different claims and only one of them is the obvious one. Gating a route
// is easy to do and easy to verify. NOT removing a behaviour is easy to do BY ACCIDENT —
// "fix" the finding by deleting the TP/SL convergence, ship a green suite, and the
// operator silently loses the engine closing their positions at live marks. So the
// auto-close is pinned here as a first-class requirement, not left as an absence.
//
// THE TWO HALVES, AND WHY THEY ARE IN ONE FILE WITH ONE SEED. The claim is comparative:
// the SAME seeded position, the SAME module, the SAME quote, differing only in whether a
// session is presented. Split across two files, each half would pass on its own — the
// anonymous half passes whenever the route is gated, and the authenticated half passes
// whenever the auto-close exists — and a regression that broke both at once (a gate that
// swallowed the handler, or an auto-close deleted "for safety") would have to be caught
// by noticing that BOTH passed for the wrong reason. Here the ledger hash is the hinge:
// it must be IDENTICAL across the anonymous call and DIFFERENT across the authenticated
// one.
//
// A HASH, NOT A FIELD CHECK, because the finding was a WRITE. `expect(ledger.closed).toHaveLength(0)`
// would pass if the route rewrote every other field; only a byte-level comparison can say
// the file was not touched at all.
//
// Hermetic: `../services/yahoo.mjs` is mocked so the quote is deterministic and no
// network is touched, and every store is redirected through the shared
// `useIsolatedStoreDir` helper so nothing resolves to the real `server/data/`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

// THE QUOTE. 200 is chosen so it is unambiguously BELOW the stop-loss seeded below (250)
// and unambiguously ABOVE nothing else, so the only exit the engine can take is `sl`.
// All six exports handlers.mjs imports are provided, because a partial mock would break
// its module-scope `import` at handlers.mjs:28 — the mock replaces the whole module, not
// one binding of it.
vi.mock("../services/yahoo.mjs", () => ({
  getHistory: vi.fn(async (symbol) => ({
    symbol: String(symbol).toUpperCase(),
    name: "Stub",
    currency: "USD",
    lastPrice: 200,
    closes: Array.from({ length: 60 }, () => 200)
  })),
  getQuote: vi.fn(async (symbol) => ({ symbol: String(symbol).toUpperCase(), lastPrice: 200 })),
  statsFromHistory: vi.fn(() => ({})),
  downsample: vi.fn((rows) => rows),
  clampDrift: vi.fn(() => 0),
  clampVol: vi.fn(() => 0),
  normalizeYahooSymbol: vi.fn((s) => s)
}))

const TOKEN = "d".repeat(64)
const USER_ROW = { id: "u1", email: "autoclose@example.test", name: "AutoClose", salt: "s", passwordHash: "h", createdAt: 1 }

const HANDLERS_QUERY = "?paper-analytics-autoclose"

// ── harness ─────────────────────────────────────────────────────────────────

function makeReq(method, url, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
    // NO `socket`: `requireAuth` admits loopback outright (handlers.mjs:6053), so a
    // loopback harness would make the "anonymous" caller authenticated and every
    // assertion below meaningless.
    headers: { host: "picc.example.test", "content-type": "application/json", ...headers },
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

let dirs = []
let authDir = null
let tradingDir = null

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value), "utf8")
}

/** Seed ONE account AND a live session carrying TOKEN. */
function seedSession() {
  writeJson(authDir, "users.json", { users: [USER_ROW] })
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
  })
}

const ledgerPath = () => join(tradingDir, "trading-ledger.json")

/** The byte-level fingerprint of the ledger. Absent file hashes to a fixed sentinel. */
function ledgerHash() {
  const p = ledgerPath()
  if (!existsSync(p)) return "ABSENT"
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}

const ledger = () => JSON.parse(readFileSync(ledgerPath(), "utf8"))

/**
 * Open the position the auto-close will trip, and return its id.
 *
 * Entry 300 against a quote of 200 with a stop-loss at 250 means the mark is below the
 * stop, so the engine MUST auto-close on the next analytics run. If this seed failed to
 * arm, the authenticated half of this file would pass for the wrong reason (nothing to
 * close), which is why `openPaperTrade`'s stored levels are asserted here and not only
 * in the test that depends on them.
 */
async function seedTrippedPosition(trading) {
  const pos = await trading.openPaperTrade({
    symbol: "EURUSD",
    side: "up",
    entry: 300,
    amount: 100,
    stopLoss: 250
  })
  expect(pos.stopLoss, "the seed must arm a stop-loss for the quote to trip").toBe(250)
  expect(pos.takeProfit, "no take-profit, so `sl` is the only exit the engine can take").toBeNull()
  return pos
}

beforeEach(async () => {
  dirs = []
  for (const [name, prefix] of [
    ["PICC_AUTH_DATA_DIR", "autoclose-auth"],
    ["PICC_TRADING_DATA_DIR", "autoclose-trading"],
    ["PICC_DATA_DIR", "autoclose-data"],
    ["PICC_ALERTS_DATA_DIR", "autoclose-alerts"],
    ["PICC_WATCHLIST_DATA_DIR", "autoclose-watchlist"],
    ["PICC_NOTIFICATION_DATA_DIR", "autoclose-notify"],
    ["PICC_JOURNAL_DATA_DIR", "autoclose-journal"],
    ["PICC_PROFILE_DATA_DIR", "autoclose-profile"]
  ]) {
    dirs.push(useIsolatedStoreDir(name, { prefix }))
  }
  authDir = dirs[0]
  tradingDir = dirs[1]
  // Seeded HERE, in beforeEach, not in beforeAll: the shared harness
  // (vitestStoreIsolation.setup.mjs) empties helper-minted scratch directories in its own
  // beforeEach, and its hook runs first.
  seedSession()
  vi.resetModules()
})

afterEach(() => {
  vi.resetModules()
  for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

async function load() {
  const handlers = await import("../handlers.mjs" + HANDLERS_QUERY)
  const trading = await import("../services/trading.mjs" + HANDLERS_QUERY)
  return { handleApi: handlers.handleApi, trading }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CLOSE OF THE FINDING
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 owner ruling — an anonymous GET cannot move the paper ledger", () => {
  it("refuses with 401, leaks nothing, and leaves trading-ledger.json BYTE-IDENTICAL", async () => {
    const { handleApi, trading } = await load()
    const pos = await seedTrippedPosition(trading)

    const before = ledgerHash()
    const beforeState = ledger()
    expect(beforeState.positions.map((p) => p.id), "the seeded position must be OPEN before the call").toContain(pos.id)

    const res = await call(handleApi, "GET", "/api/trading/paper/analytics", null)

    expect(res.status, `expected a 401, got ${JSON.stringify(res.body)}`).toBe(401)
    expect(res.body?.ok, "a refusal must never report success").not.toBe(true)

    // NO PAYLOAD FRAGMENT. The route's own response carries an overview, open positions
    // and auto-closed trades; none of it may ride out on the refusal.
    const text = JSON.stringify(res.body ?? {}).toLowerCase()
    for (const key of ["autoclose", "overview", "realizedpnl", "unrealizedpnl", "equity", "starting", "cash", "openCount", "metrics", "winRate", "positions"]) {
      expect(text, `"${key}" must not leak through the 401`).not.toContain(key.toLowerCase())
    }

    // THE PROOF. Byte-identical, not merely "still empty".
    const after = ledgerHash()
    expect(after, "an anonymous GET changed trading-ledger.json — the finding is NOT closed").toBe(before)
    const afterState = ledger()
    expect(afterState.positions.map((p) => p.id), "the position must still be open").toContain(pos.id)
    expect(afterState.closed, "nothing may have been written to the closed ledger").toEqual([])
  })

  it("POST is refused identically — the branch is one `GET || POST` dispatch", async () => {
    const { handleApi, trading } = await load()
    await seedTrippedPosition(trading)
    const before = ledgerHash()

    const res = await call(handleApi, "POST", "/api/trading/paper/analytics", {})

    expect(res.status, `expected a 401 on POST too, got ${JSON.stringify(res.body)}`).toBe(401)
    expect(ledgerHash(), "an anonymous POST changed trading-ledger.json").toBe(before)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AND THE BEHAVIOUR THAT WAS *NOT* REMOVED
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 owner ruling — the TP/SL auto-close STILL runs for an authenticated caller", () => {
  it("closes the tripped position at the stop, writes it to the ledger, and reports it", async () => {
    const { handleApi, trading } = await load()
    const pos = await seedTrippedPosition(trading)

    const before = ledgerHash()
    expect(before, "the ledger must exist and differ afterwards, or this test proves nothing").not.toBe("ABSENT")

    const res = await call(handleApi, "GET", "/api/trading/paper/analytics", null, {
      authorization: `Bearer ${TOKEN}`
    })

    // It is a 200, and it is the ANALYTICS ANSWER — not a refusal dressed as one. A gate
    // that returned early for everyone would satisfy "not 401" while deleting the feature.
    expect(res.status, `the authenticated caller must reach the handler, got ${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body?.ok).toBe(true)

    // THE AUTO-CLOSE, asserted on its own terms.
    expect(Array.isArray(res.body.autoClosed), "the response must still carry autoClosed").toBe(true)
    expect(res.body.autoClosed, "the tripped stop-loss must still auto-close").toHaveLength(1)
    expect(res.body.autoClosed[0].reason).toBe("sl")
    expect(res.body.autoClosed[0].exit, "it closes at the stop level, not at the quote").toBe(250)
    expect(res.body.autoClosed[0].exitSource, "and it records that the exit came from the mark").toBe("mark")
    expect(res.body.overview.closedCount).toBe(1)
    expect(res.body.overview.openCount).toBe(0)

    // AND THE WRITE ACTUALLY HAPPENED. Same comparison as the refusal half, inverted.
    const after = ledgerHash()
    expect(after, "the authenticated call did NOT change the ledger — the auto-close is gone").not.toBe(before)
    const state = ledger()
    expect(state.positions.map((p) => p.id), "the position must have left the open book").not.toContain(pos.id)
    expect(state.closed.map((c) => c.id)).toContain(pos.id)
    expect(state.closed.find((c) => c.id === pos.id).reason).toBe("sl")
  })

  it("the contrast that makes both halves meaningful, in one test", async () => {
    // Anonymous then authenticated, on the SAME seed, with the ledger hash as the hinge.
    // Either half alone passes for the wrong reason; the pair cannot.
    const { handleApi, trading } = await load()
    const pos = await seedTrippedPosition(trading)

    const start = ledgerHash()
    const anon = await call(handleApi, "GET", "/api/trading/paper/analytics", null)
    const afterAnon = ledgerHash()
    expect(anon.status).toBe(401)
    expect(afterAnon, "the anonymous half must not have moved the ledger").toBe(start)

    const authed = await call(handleApi, "GET", "/api/trading/paper/analytics", null, {
      authorization: `Bearer ${TOKEN}`
    })
    const afterAuthed = ledgerHash()
    expect(authed.status).toBe(200)
    expect(afterAuthed, "the authenticated half MUST move the ledger — if this fails the auto-close was removed").not.toBe(start)
    expect(ledger().positions.map((p) => p.id)).not.toContain(pos.id)
  })

  it("the underlying convergence is untouched: a fresh-run with no session would still close it", async () => {
    // The last line of defence against "the fix was to delete the feature". This calls the
    // SERVICE directly, with no HTTP layer and no session anywhere in sight, and asserts
    // the auto-close still happens. If someone later removes the convergence from
    // `paperAnalytics` to make a 401 test simpler, this fails — and it fails for the right
    // reason, which is that the engine stopped doing its job.
    const { trading } = await load()
    const pos = await trading.openPaperTrade({ symbol: "EURUSD", side: "up", entry: 300, amount: 100, stopLoss: 250 })
    const report = await trading.paperAnalytics()
    expect(report.autoClosed).toHaveLength(1)
    expect(report.autoClosed[0].reason).toBe("sl")
    expect(report.overview.closedCount).toBe(1)
    expect(report.overview.openCount).toBe(0)
    expect(ledger().closed.map((c) => c.id)).toContain(pos.id)
  })
})
