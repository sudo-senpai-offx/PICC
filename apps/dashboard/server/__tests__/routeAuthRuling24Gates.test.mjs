// WS-7 owner ruling — the 24 routes gated when the deferred route-auth set was closed.
//
// WHY THIS FILE EXISTS, and it is the same reason `t20rRouteAuthGates.test.mjs` exists:
// a static scan proves a gate call is PRESENT in a route's own block, before that route
// answers. It cannot prove the gate RUNS. A gate that is present, correctly spelled, and
// unreachable satisfies `ws7RouteAuthCoverageGuard` perfectly. So every route gated here
// gets a real request against the real handler and a real 401 back.
//
// THE FINDING THAT MOTIVATED THE RULING, so the shape of these tests is not arbitrary:
// an ANONYMOUS `GET /api/trading/paper/analytics` closed an open paper position and wrote
// the trade into `trading-ledger.json`, at a price derived from a live quote. Proven by
// execution, not inferred. It survived the previous pass because it was classified as a
// "read". The gate is on the ROUTE and the TP/SL auto-close is KEPT — the auto-close is
// convergence the engine should still perform, and `paperAnalyticsAutoClose.test.mjs`
// pins both halves of that claim with a ledger hash.
//
// EVERY TEST HERE ASSERTS TWO THINGS, and the second is the one a status-only check
// misses: a 401, and that the refusal carries NO fragment of the payload the route would
// otherwise return. A 401 that echoed the data would be the leak wearing a status code.
//
// ── THE HARNESS DETAIL THAT DECIDES WHETHER THESE TESTS MEAN ANYTHING ──
//
//   * NO `socket` on the request. `requireAuth` admits a request outright when
//     `isLocalhostRequest(req)` is true (handlers.mjs:6053), and that predicate reads the
//     real TCP peer. A harness supplying `socket: { remoteAddress: "127.0.0.1" }` takes
//     that bypass, so the "anonymous" caller is inside the trust boundary and the route
//     answers 200 — and the 401 assertion fails for the wrong reason. Omitting `socket`
//     presents a NON-loopback caller, which is what an attacker is.
//
//   * A SEEDED USER. With an empty user store `requireAuth` takes its first-run bootstrap
//     branch and admits everyone. These tests therefore seed one account, so auth is
//     genuinely enforced.
//
// ONE MODULE LOAD FOR ALL 24, deliberately. The claim here is about STATUS and about the
// ABSENCE of a payload, and neither depends on having re-read a store between calls, so
// re-importing handlers.mjs twenty-four times would buy nothing and cost the suite about
// twenty seconds of cold module graph. `t20rRouteAuthGates.test.mjs` pays that cost per
// route because it also asserts per-route MUTATION outcomes; this file does not, and
// `paperAnalyticsAutoClose.test.mjs` is where the write-side claim is proved.
//
// Hermetic: every store is redirected through the SHARED `useIsolatedStoreDir` helper,
// never by assigning `process.env` — `ws7TestStoreIsolation.test.mjs` enumerates the suite
// via `git ls-files` and refuses a hand-rolled assignment. Nothing here resolves to the
// real `apps/dashboard/server/data/`.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const TOKEN = "c".repeat(64)
const USER_ROW = { id: "u1", email: "ruling24@example.test", name: "Ruling24", salt: "s", passwordHash: "h", createdAt: 1 }

/**
 * The 24 routes the owner gated, in the three groups the ruling named.
 *
 * `leaks` is the payload-fragment guard: field names that must NOT appear anywhere in a
 * refusal body. It is carried per route rather than as one global list because a global
 * list is either too weak (only the obvious keys) or unreadable (every key of every
 * route). These are the keys each route's own handler would have put in the response.
 */
const GATED = [
  // ── Group M — the 4 proven trading-ledger writers ─────────────────────────
  {
    group: "M",
    method: "GET",
    path: "/api/trading/paper/analytics",
    why: "it closed an open position and wrote trading-ledger.json on an anonymous GET",
    body: null,
    leaks: ["autoClosed", "overview", "realizedPnl", "unrealizedPnl", "equity", "starting", "cash", "openCount", "metrics", "winRate"]
  },
  { group: "M", method: "GET", path: "/api/trading/signals", why: "it reads the engine's signal ledger", body: null, leaks: ["signals", "signal", "assetId", "direction", "confidence"] },
  {
    group: "M",
    method: "GET",
    path: "/api/trading/accuracy",
    why: "GET and POST are byte-identical; both run the stale-signal flush",
    body: null,
    leaks: ["winRate", "accuracy", "trades", "profitFactor", "balance"]
  },
  {
    group: "M",
    method: "POST",
    path: "/api/trading/risk-of-ruin",
    why: "its defaults fall back to the aggregate accuracy ledger",
    body: {},
    leaks: ["riskOfRuin", "winRate", "avgPayout", "riskPct", "balance", "ruin", "expectancy"]
  },

  // ── Group S-a — the 7 LLM-budget routes ───────────────────────────────────
  { group: "S-a", method: "POST", path: "/api/twin/run", why: "paid inference an anonymous caller can drive", body: {}, leaks: ["projection", "simulations", "twin", "percentile"] },
  { group: "S-a", method: "POST", path: "/api/listing/analyze", why: "paid inference", body: {}, leaks: ["analysis", "suggestions", "asin", "title", "bullets"] },
  { group: "S-a", method: "POST", path: "/api/listing/keywords", why: "paid inference", body: {}, leaks: ["keywords", "keyword", "term", "score"] },
  { group: "S-a", method: "POST", path: "/api/listing/rewrite", why: "paid inference", body: {}, leaks: ["rewrite", "title", "description", "bullets", "variant"] },
  { group: "S-a", method: "POST", path: "/api/content/generate", why: "paid inference", body: {}, leaks: ["draft", "headline", "script", "tags", "cta", "research"] },
  { group: "S-a", method: "POST", path: "/api/trading/assist", why: "paid inference", body: {}, leaks: ["answer", "advice", "assistant", "reasoning"] },
  { group: "S-a", method: "POST", path: "/api/trading/pro/narrative", why: "paid inference over a caller-supplied report", body: {}, leaks: ["narrative", "summary", "report"] },

  // ── Group C-b — the 13 per-user / operator reads ───────────────────────────
  {
    group: "C-b",
    method: "GET",
    path: "/api/trading/status",
    why: "it returns the paper balance sheet from trading-credentials.json + trading-ledger.json",
    body: null,
    leaks: ["starting", "cash", "committed", "realizedPnl", "winRate", "best", "worst", "balance"]
  },
  { group: "C-b", method: "POST", path: "/api/trading/portfolio/aggregate", why: "it folds in trading-ledger.json and the demo deals", body: {}, leaks: ["todayPnl", "riskCheck", "exposure", "positions", "pnl"] },
  {
    group: "C-b",
    method: "GET",
    path: "/api/notifications/status",
    why: "it serves `recent` — the last 20 alert records with titles and bodies",
    body: null,
    leaks: ["recent", "title", "body", "channels", "subscriptions", "endpoint", "p256dh"]
  },
  { group: "C-b", method: "GET", path: "/api/settings/llm/resource", why: "the 50 most recent governor ledger rows", body: null, leaks: ["budgets", "rows", "stats", "tokens", "prompt", "completion"] },
  { group: "C-b", method: "GET", path: "/api/streams/snapshot", why: "the dashboard's income snapshot", body: null, leaks: ["rows", "snapshot", "income", "earnings", "stream"] },
  { group: "C-b", method: "GET", path: "/api/trading/paper/positions", why: "real open paper positions", body: null, leaks: ["positions", "symbol", "side", "entry", "amount", "openedAt", "takeProfit", "stopLoss"] },
  { group: "C-b", method: "GET", path: "/api/trading/paper/overview", why: "cash, equity and P&L", body: null, leaks: ["starting", "cash", "equity", "openCount", "closedCount", "winRate"] },
  { group: "C-b", method: "GET", path: "/api/trading/paper/history", why: "the operator's own closed trades", body: null, leaks: ["closed", "exit", "pnl", "closedAt", "symbol", "side"] },
  { group: "C-b", method: "GET", path: "/api/trading/demo/analytics", why: "the operator's own demo analytics", body: null, leaks: ["analytics", "trades", "winRate", "profitFactor"] },
  { group: "C-b", method: "GET", path: "/api/trading/demo/deals", why: "the operator's own demo deal history", body: null, leaks: ["deals", "symbol", "entry", "exit", "pnl", "volume"] },
  {
    group: "C-b",
    method: "GET",
    path: "/api/trading/export",
    why: "the whole trading record: decision log plus resolved ledger plus per-asset stats",
    body: null,
    leaks: ["decisions", "ledger", "perAsset", "exportedAt", "outcome", "confidence"]
  },
  { group: "C-b", method: "GET", path: "/api/trading/alerts", why: "registry rows carry a userId", body: null, leaks: ["alerts", "stats", "userId", "condition", "symbol", "recurring"] },
  { group: "C-b", method: "GET", path: "/api/trading/alerts/history", why: "the fired-alert history", body: null, leaks: ["history", "alert", "fired", "condition", "symbol"] }
]

// ── harness ─────────────────────────────────────────────────────────────────

function makeReq(method, url, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
    // NO `socket` — see the file header. This is what makes the caller remote.
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
  const bare = path.split("?")[0]
  await handleApi(makeReq(method, bare, body, headers), res, bare)
  return res
}

let dirs = []
function redirect(name, prefix) {
  const dir = useIsolatedStoreDir(name, { prefix })
  dirs.push(dir)
  return dir
}

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value), "utf8")
}

function redirectAll() {
  for (const [name, prefix] of [
    ["PICC_AUTH_DATA_DIR", "ruling24-auth"],
    ["PICC_TRADING_DATA_DIR", "ruling24-trading"],
    ["PICC_DATA_DIR", "ruling24-data"],
    ["PICC_ALERTS_DATA_DIR", "ruling24-alerts"],
    ["PICC_WATCHLIST_DATA_DIR", "ruling24-watchlist"],
    ["PICC_NOTIFICATION_DATA_DIR", "ruling24-notify"],
    ["PICC_JOURNAL_DATA_DIR", "ruling24-journal"],
    ["PICC_PROFILE_DATA_DIR", "ruling24-profile"]
  ]) {
    redirect(name, prefix)
  }
}

/** Seed ONE account AND a live session carrying TOKEN. */
function seedSession(authDir) {
  mkdirSync(authDir, { recursive: true })
  writeJson(authDir, "users.json", { users: [USER_ROW] })
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
  })
}

// ONE MODULE LOAD FOR ALL 24, deliberately. The claim here is about STATUS and about the
// ABSENCE of a payload, and neither depends on having re-read a store between calls, so
// re-importing handlers.mjs twenty-four times would buy nothing and cost the suite about
// twenty seconds of cold module graph. `t20rRouteAuthGates.test.mjs` pays that cost per
// route because it also asserts per-route MUTATION outcomes; this file does not, and
// `paperAnalyticsAutoClose.test.mjs` is where the write-side claim is proved.
//
// THE SEED IS PER TEST, NOT PER FILE, and that is forced by the shared harness rather
// than chosen. `vitestStoreIsolation.setup.mjs` EMPTIES every helper-minted scratch
// directory in its own `beforeEach` (it does so for the ~85 files that redirect through
// `useIsolatedStoreDir`), and its hook runs before this file's. So a user seeded once in
// `beforeAll` is gone before the first test body executes, the store reads empty, and
// `requireAuth` takes its FIRST-RUN branch and admits every caller — which would make
// all 24 negative tests pass for the wrong reason if they asserted anything weaker, and
// fail here for a reason that has nothing to do with the gates. Seeding per test is what
// keeps the anonymous caller genuinely anonymous. The module is loaded once in
// `beforeAll` and reused, because the seeded store's PATH never changes — only its
// contents are cleared and rewritten.
const HANDLERS_QUERY = "?route-auth-ruling24"
let api = null
let authDir = null

beforeAll(async () => {
  dirs = []
  redirectAll()
  authDir = dirs[0]
  seedSession(authDir)
  const mod = await import("../handlers.mjs" + HANDLERS_QUERY)
  api = mod.handleApi
})

beforeEach(() => {
  // Re-seed AFTER the shared harness has emptied the directory. See the note above.
  seedSession(authDir)
})

afterAll(() => {
  for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE NEGATIVE HALF — every one of the 24 refuses an anonymous caller
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 owner ruling — each of the 24 gated routes answers 401 to an anonymous caller", () => {
  for (const route of GATED) {
    it(`${route.method} ${route.path} refuses, and leaks nothing — ${route.why}`, async () => {
      const res = await call(api, route.method, route.path, route.body)

      expect(res.status, `expected a 401, got ${JSON.stringify(res.body)}`).toBe(401)
      expect(res.body?.ok, "a refusal must never report success").not.toBe(true)

      // THE PAYLOAD-FRAGMENT HALF. A 401 that echoed the payload would be the leak
      // wearing a status code, and a status-only assertion would never see it. The
      // comparison is case-insensitive because JSON keys are, and a route is free to
      // capitalise a field name.
      const text = JSON.stringify(res.body ?? {}).toLowerCase()
      for (const key of route.leaks) {
        expect(text, `"${key}" must not leak through a 401 on ${route.method} ${route.path}`).not.toContain(key.toLowerCase())
      }
      // And the ledger-shaped values themselves: the numbers a paper balance sheet
      // would carry must not appear either, in case a route returned them under a name
      // this table did not guess.
      expect(text, `${route.path} must not leak a balance-sheet value in a refusal`).not.toMatch(/"(starting|cash|equity|balance)"\s*:\s*-?\d/)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE CONTROL — the gates admit a REAL session
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 owner ruling — the control: none of the 24 gates refuses a REAL session", () => {
  it("every one of the 24 admits an authenticated caller", async () => {
    const refused = []
    const other = []
    for (const route of GATED) {
      const res = await call(api, route.method, route.path, route.body, { authorization: `Bearer ${TOKEN}` })
      if (res.status === 401) refused.push(`${route.method} ${route.path} -> 401 ${JSON.stringify(res.body)}`)
      // A non-401 answer is fine and expected — most of these reach their handler and
      // answer 200, some 400 on the empty body, some 502 when an upstream is absent.
      // What must NOT happen is a refusal.
      else other.push(`${route.method} ${route.path} -> ${res.status}`)
    }
    expect(
      refused,
      "a gate that refuses a REAL session is broken. A route that 401d unconditionally would pass all 24 " +
        "negative tests above and be entirely non-functional."
    ).toEqual([])
    expect(other.length, "the control must actually have exercised all 24 routes").toBe(GATED.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE TABLE MATCHES THE RULING, AND THE GATES ARE WHERE THEY MUST BE
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 owner ruling — the table is the ruling, and each gate is the FIRST statement", () => {
  it("carries exactly the 24 routes the owner named, in the three groups named", () => {
    expect(GATED.length, "the gated set").toBe(24)
    expect(GATED.filter((r) => r.group === "M").length, "group M, the proven trading-ledger writers").toBe(4)
    expect(GATED.filter((r) => r.group === "S-a").length, "group S-a, the LLM-budget routes").toBe(7)
    expect(GATED.filter((r) => r.group === "C-b").length, "group C-b, the per-user/operator reads").toBe(13)
    // No duplicates: a repeated route would silently weaken the count.
    expect(new Set(GATED.map((r) => `${r.method} ${r.path}`)).size, "each route appears once").toBe(GATED.length)
  })

  it("every gate is requireAuth as the FIRST statement of its own branch", () => {
    // The static half, and it is the half that can be satisfied by a gate which never
    // runs — which is why section 1 exists. What this catches is PLACEMENT: a gate
    // below a `validateOr400` or below a 503 is dead code, and the routing guard's own
    // `isGated` rejects exactly that with "the route answers BEFORE its gate".
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const lines = src.split("\n")
    const misplaced = []
    for (const route of GATED) {
      const literal = `path === "${route.path}"`
      const at = lines.findIndex((l) => l.includes(literal) && l.includes(`"${route.method}"`))
      expect(at, `${route.path} must still be dispatched on ${route.method}`).toBeGreaterThan(-1)
      const indent = (lines[at].match(/^\s*/) ?? [""])[0].length
      // The first line of real code inside the branch.
      let first = null
      for (let k = at + 1; k < lines.length; k++) {
        const ind = (lines[k].match(/^\s*/) ?? [""])[0].length
        const trimmed = lines[k].trim()
        if (trimmed === "") continue
        if (ind <= indent) break
        first = trimmed
        break
      }
      if (first === null || !first.includes("requireAuth(req, res)")) {
        misplaced.push(`${route.path} @${at + 1}: first statement is ${JSON.stringify(first)}`)
      }
    }
    expect(misplaced, "a gate that is not the FIRST statement of its branch is dead code").toEqual([])
  })

  it("none of the 24 is still in the declared-public allowlist", () => {
    // The pairing that makes deletion non-optional: a gated route with a surviving
    // allowlist row reads as coverage while excusing nothing, and the routing guard
    // asserts they cannot coexist. Asserting it here as well means the failure names the
    // ROUTE rather than arriving as a generic allowlist conflict.
    const guardFile = readFileSync(new URL("./ws7RouteAuthCoverageGuard.test.mjs", import.meta.url), "utf8")
    const start = guardFile.indexOf("const DECLARED_PUBLIC = [")
    const end = guardFile.indexOf("\n/** Marker -> entry")
    expect(start, "DECLARED_PUBLIC must be locatable in the guard").toBeGreaterThan(-1)
    expect(end, "DECLARED_PUBLIC must be locatable in the guard").toBeGreaterThan(-1)
    const slice = guardFile.slice(start, end)
    const still = GATED.filter((r) => slice.includes(`path === "${r.path}"`)).map((r) => r.path)
    expect(still, "these gated routes still have a DECLARED_PUBLIC row; delete the row, do not reword it").toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE THREE BORDERLINE ROUTES — left public, and flagged, NOT silently gated
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The ruling named 24 routes. These three were classified as outbound-spend but have
 * per-user characteristics, and gating them was NOT what the owner asked for. They are
 * pinned PUBLIC here so a later pass cannot quietly close them without noticing, and
 * their allowlist reasons record that each needs a follow-up ruling.
 */
const BORDERLINE_STILL_PUBLIC = [
  // GET, not POST: T20R already gated POST /api/trading/watchlists as a write, so the
  // read is the half that is still public. Asserting the POST here would contradict
  // t20rRouteAuthGates.test.mjs, which asserts that POST is 401.
  { method: "GET", path: "/api/trading/watchlists", why: "returns a userId per entry, so it reads as a per-user route — NEEDS A FOLLOW-UP RULING" },
  { method: "POST", path: "/api/trading/candles", why: "reads the per-user chart-prefs.json — NEEDS A FOLLOW-UP RULING" },
  { method: "POST", path: "/api/trading/scan", why: "falls back to getWatchlist() when the caller passes no symbols — NEEDS A FOLLOW-UP RULING" }
]

describe("WS-7 owner ruling — the three borderline routes were NOT silently gated", () => {
  for (const route of BORDERLINE_STILL_PUBLIC) {
    it(`${route.method} ${route.path} is still public — ${route.why}`, async () => {
      const res = await call(api, route.method, route.path, {})
      expect(res.status, `${route.path} answered ${JSON.stringify(res.body)} — it must NOT be 401`).not.toBe(401)
    })
  }

  it("all three are named as needing a follow-up ruling in the allowlist, not just left public", () => {
    // Leaving a route public is defensible; leaving it public with a reason that still
    // reads as an open question is how the next pass inherits an undocumented decision.
    const guardFile = readFileSync(new URL("./ws7RouteAuthCoverageGuard.test.mjs", import.meta.url), "utf8")
    const missing = BORDERLINE_STILL_PUBLIC.filter((r) => !guardFile.includes(`"${r.path}"`) || !/FOLLOW-UP RULING/i.test(guardFile.slice(guardFile.indexOf(r.path) - 2600, guardFile.indexOf(r.path) + 2600)))
      .map((r) => r.path)
    expect(missing, "each borderline route's allowlist entry must say it needs a follow-up ruling").toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE TWO SIGNED ROUTES — standing records, and still not session-gated
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 owner ruling — the two signed routes stay public, as standing records", () => {
  it("neither is session-gated, and both say so as a standing record", async () => {
    const guardFile = readFileSync(new URL("./ws7RouteAuthCoverageGuard.test.mjs", import.meta.url), "utf8")
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    for (const path of ["/api/stripe/webhook", "/api/profile/github/callback"]) {
      // The route must still exist and still be ungated: a gate here would reject every
      // real Stripe delivery and 401 the OAuth callback outright.
      const at = src.split("\n").findIndex((l) => l.includes(`path === "${path}"`))
      expect(at, `${path} must still be dispatched`).toBeGreaterThan(-1)
      const branch = src.split("\n").slice(at, at + 4).join("\n")
      expect(branch, `${path} must NOT carry requireAuth`).not.toContain("requireAuth(req, res)")
      // And the allowlist must record it as a decision that was MADE.
      const idx = guardFile.indexOf(`path === "${path}"`)
      expect(idx, `${path} must still have an allowlist row`).toBeGreaterThan(-1)
      expect(
        guardFile.slice(idx, idx + 3000),
        `${path}'s reason must record the ruling as a standing record, not an open question`
      ).toMatch(/STANDING RECORD|ACCEPTED/i)
    }
  })
})
