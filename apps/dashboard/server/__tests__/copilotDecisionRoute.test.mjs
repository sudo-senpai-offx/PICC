// WS-7 T7R-B — `/api/trading/copilot` at the HTTP boundary.
//
// The gate is asserted HERE, at the route, rather than left to
// `ws7RouteAuthCoverageGuard.test.mjs`'s static scan alone. The scan proves a
// gate call exists in the route's own block; this proves the route actually
// answers 401 to an anonymous caller and discloses nothing. A scan can be
// satisfied by a gate that never runs, and this is the assertion that cannot.
//
// The route is GATED and deliberately NOT allowlisted. It exposes live engine
// state — regime, score, per-expert contributions, the six vetoes with their
// unevaluated reasons, and T12's conflict resolutions — and none of it is
// declared-public. The 86 unruled `owner: "decision"` entries awaiting the owner
// are not a pool this route draws from.
//
// The handler is driven through the same fake req/res seam the sibling route
// tests use (see `autopilotRoutes.test.mjs`), in a hermetic data root with no
// users and no credentials. Nothing here stubs the engine or the gate: the gate
// IS what is under test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const ROUTE = "/api/trading/copilot"

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

async function call(api, method, path, body, headers) {
  const res = makeRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

describe("WS-7 T7R-B — POST /api/trading/copilot is gated", () => {
  let dir

  beforeEach(() => {
    // Through the SHARED helper, not `process.env` by hand.
    // `ws7TestStoreIsolation.test.mjs` refuses a hand-rolled
    // `process.env.PICC_*_DATA_DIR =` outside its inventoried legacy set, and
    // the helper is why: it mints the directory, canonicalises it, asserts it
    // is NOT the real `server/data`, and throws on a variable name the contract
    // does not know — so a misspelling fails loudly instead of silently
    // redirecting nothing. Three variables are needed because this route boots
    // the whole handler, which reads the trading, root and auth stores.
    useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
    useIsolatedStoreDir("PICC_DATA_DIR")
    dir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  async function loadHandlers({ withUser = true } = {}) {
    // A user exists so auth is ENFORCED. With an empty store `requireAuth`
    // takes its first-run bootstrap branch (`firstRunBootstrapAllowed`), which
    // admits everyone — see the dedicated test below, which pins that rather
    // than leaving it to be discovered.
    if (withUser) {
      writeFileSync(
        join(dir, "users.json"),
        JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] })
      )
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?copilot-route-test")
    return handleApi
  }

  it("refuses an anonymous caller with 401 and discloses nothing", async () => {
    const api = await loadHandlers()
    const res = await call(api, "POST", ROUTE, { assetId: "EURUSD" })

    expect(res.status).toBe(401)
    // The refusal must not echo the engine's vocabulary. An error body naming
    // the regime or the vetoes would be the disclosure the gate prevents.
    const text = JSON.stringify(res.body ?? {})
    for (const leak of ["regime", "hypertrend", "veto", "confluence", "score", "conflict"]) {
      expect(text.toLowerCase(), `${leak} must not leak through a 401`).not.toContain(leak)
    }
  })

  it("inherits requireAuth's first-run bootstrap, and that is pinned, not assumed", async () => {
    // INHERITED, NOT INTRODUCED. Every one of the ~97 `requireAuth` sites in
    // handlers.mjs takes this branch when the user store is empty, because
    // `firstRunBootstrapAllowed` admits a first-run install. This route is not
    // special-cased and does not tighten or loosen it.
    //
    // It is pinned here for a specific reason: the consequence is that a
    // fresh install with no accounts exposes live engine state. That is a
    // property of the shared gate, so the honest place to change it is the gate
    // — and the honest place to NOTICE it is a test that says so out loud.
    // Silently relying on it would be the unflagged claim this repo forbids.
    const api = await loadHandlers({ withUser: false })
    const res = await call(api, "POST", ROUTE, { assetId: "EURUSD" })

    // It genuinely answers, because the bootstrap branch admitted it. Asserted so
    // that a future change to the shared gate shows up HERE as a deliberate diff
    // rather than as a surprise in a security review.
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // ...and the same request is refused the moment one account exists. That
    // contrast IS the gate.
    const gated = await loadHandlers({ withUser: true })
    const after = await call(gated, "POST", ROUTE, { assetId: "EURUSD" })
    expect(after.status).toBe(401)
  })

  it("refuses BEFORE the assetId precondition", async () => {
    // Order matters. A 400 for a missing assetId ahead of the gate would let an
    // anonymous caller distinguish "the route exists" from "the route does not",
    // which is a route-existence oracle.
    const api = await loadHandlers()
    const res = await call(api, "POST", ROUTE, {})
    expect(res.status).toBe(401)
  })

  it("is registered as a route at all — the gate is not answering a 404", async () => {
    const api = await loadHandlers()
    const res = await call(api, "POST", ROUTE, { assetId: "EURUSD" })
    // 401, never 404. Proving the route EXISTS is what makes the gate meaningful:
    // a 404 would pass "no disclosure" while testing nothing.
    expect(res.status).not.toBe(404)
    expect(res.status).toBe(401)
  })

  it("refuses on GET as well, so the decision has no read-only shadow", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", ROUTE, undefined)
    expect(res.status).not.toBe(200)
  })

  it("the gate runs on EVERY method the route answers", async () => {
    const api = await loadHandlers()
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      const res = await call(api, method, ROUTE, { assetId: "EURUSD" })
      expect(res.status, `${method} must not answer 200 anonymously`).not.toBe(200)
    }
  })

  it("the route is NOT allowlisted anywhere as an owner: \"decision\" entry", async () => {
    // The static assertion behind the owner's constraint. `handlers.mjs` is the
    // only place a route could be allowlisted, and it is not there.
    const src = readFileSync(join(import.meta.dirname, "..", "handlers.mjs"), "utf8")
    const idx = src.indexOf(ROUTE)
    expect(idx, `${ROUTE} must be registered in handlers.mjs`).toBeGreaterThan(-1)

    // The route's own block carries a gate, not an allowlist marker.
    const block = src.slice(idx, idx + 1400)
    expect(block).toMatch(/requireAuth\(/)
    expect(block).not.toMatch(/owner:\s*"decision"/)
    expect(block).not.toMatch(/declaredPublic/i)
  })
})

/**
 * The other half of the same claim: gated AND working. An authentication test
 * that never exercises the success path can pass on a route that always 401s,
 * which would satisfy "gated" while proving nothing about the decision.
 *
 * The broker is the only injected leaf — `marketDataBus.mjs`, via `vi.doMock`.
 * The route, the gate, `decision.mjs`, `deriveMarketState`, `evaluateCopilot`,
 * `evaluateConflicts` and `atrStop` are all the real implementations.
 */
describe("WS-7 T7R-B — POST /api/trading/copilot returns a REAL decision", () => {
  let dir
  const AT = Date.UTC(2023, 10, 14, 13, 0, 0)

  beforeEach(() => {
    // Same shared helper as the suite above; see the note there for why.
    useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
    dir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
    vi.doMock("../services/marketDataBus.mjs", () => ({
      getBestCandles: async (_id, { timeframe }) => {
        if (timeframe === 14400) return { candles: ramp(200, AT), source: "test-broker" }
        if (timeframe === 86400) return { candles: ramp(420, AT, 0.002), source: "test-broker" }
        return { candles: ramp(240, AT), source: "test-broker" }
      },
      listAvailableSources: async () => []
    }))
  })

  afterEach(() => {
    vi.doUnmock("../services/marketDataBus.mjs")
    vi.unstubAllEnvs()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  function ramp(n, at, step = 0.0004) {
    const out = []
    for (let i = 0; i < n; i++) {
      const close = 1.08 + step * i
      const open = close - step / 2
      out.push({
        time: at - (n - 1 - i) * 60_000,
        open,
        high: close + Math.abs(step),
        low: close - Math.abs(step),
        close,
        volume: 1000
      })
    }
    return out
  }

  function req(body, token) {
    const raw = JSON.stringify(body)
    return {
      method: "POST",
      url: ROUTE,
      headers: { host: "localhost", "content-type": "application/json", authorization: `Bearer ${token}` },
      raw,
      on(evt, cb) {
        if (evt === "data") cb(raw)
        if (evt === "end") cb()
      }
    }
  }
  function res() {
    return {
      status: null,
      body: null,
      writeHead(s) {
        this.status = s
      },
      end(b) {
        this.body = b ? JSON.parse(b) : null
      }
    }
  }

  async function authed(assetId) {
    const token = "b".repeat(64)
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
    writeFileSync(
      join(dir, "sessions.json"),
      JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?copilot-e2e")
    const r = res()
    await handleApi(req({ assetId }, token), r, ROUTE)
    return r
  }

  it("answers an authenticated caller with the engine's own score", async () => {
    const r = await authed("EURUSD")

    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)

    // THE POINT OF THE TASK: the engine ran. `confluence` was null in this repo
    // until now, and every `evaluateCopilot` reference was a definition or a test.
    expect(r.body.confluence).not.toBeNull()
    expect(typeof r.body.confluence.score).toBe("number")
    expect(Number.isFinite(r.body.confluence.score)).toBe(true)
    expect(r.body.engineVersion).toMatch(/^copilot-engine\//)
    expect(r.body.decisionVersion).toMatch(/^copilot-decision\//)

    // T7's acceptance line: the score, per-expert contributions, fired vetoes.
    expect(r.body.confluence.contributions).toHaveLength(6)
    expect(Array.isArray(r.body.vetoes)).toBe(true)
    expect(r.body.vetoes.length).toBeGreaterThan(0)
    expect(Array.isArray(r.body.firedVetoes)).toBe(true)
    expect(r.body.firedVetoes.length).toBeGreaterThan(0)

    // Fail closed on the two authority inputs.
    expect(r.body.tier.automationPermitted).toBe(false)
    expect(r.body.tier.rung).toBe("paper")

    // The conflicts were ASKED for, so all three rules are reported.
    expect(r.body.conflicts.resolutions.map((x) => x.rule).sort()).toEqual(["C1", "C2", "C3"])
  })

  it("computes at the newest bar's own time, not at the wall clock", async () => {
    const r = await authed("EURUSD")
    // The mock's bars are stamped 2023-11-14T13:00Z. A route reading its own
    // clock would return ~1.7e12 today instead, and `sessionOpen` would move.
    expect(r.body.computedAt).toBe(AT)
    expect(r.body.coverage.workingBars).toBe(240)
    expect(r.body.coverage.source.working).toBe("test-broker")
  })

  it("returns an honest absence, not a 502, when the broker has no history", async () => {
    vi.doMock("../services/marketDataBus.mjs", () => ({
      getBestCandles: async () => ({ candles: [], source: "none" }),
      listAvailableSources: async () => []
    }))
    const r = await authed("NOSUCH")
    // A 502 would tell the client the service is broken; the truth is that the
    // asset has no bars. The difference matters to the room, which renders a named
    // unavailable row rather than an error boundary.
    expect(r.status).toBe(200)
    expect(r.body.confluence).toBeNull()
    expect(r.body.unavailable.length).toBeGreaterThan(0)
    expect(r.body.unavailable[0].leg).toBeTruthy()
    expect(r.body.unavailable[0].reason).toBeTruthy()
  })

  it("400s a missing assetId for an AUTHENTICATED caller only", async () => {
    // The gate runs first, so this is reachable only by someone already allowed
    // in. Anonymous callers still get 401 — see the suite above.
    const token = "c".repeat(64)
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
    writeFileSync(
      join(dir, "sessions.json"),
      JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?copilot-e2e-400")
    const r = res()
    await handleApi(req({}, token), r, ROUTE)
    expect(r.status).toBe(400)
  })
})
