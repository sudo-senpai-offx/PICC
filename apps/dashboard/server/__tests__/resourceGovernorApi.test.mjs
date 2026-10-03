// G3 — PICC_RESOURCE_GOVERNOR_v1.md §7: GET /api/settings/llm/resource is the
// Resource tab's data source — governorStats() + configurable budgets + the
// bounded ledger rows + an honest `enabled` flag.
//
// Honesty contract under test:
//   - empty ledger → observed zeros + rows [], never a fabricated row
//   - `enabled` reflects the REAL process flag at request time (not cached)
//   - rows never carry prompt content (Q5 privacy crosses the API boundary)
//   - budgets are the configurable ceilings actually in force (owner §8.5)
//   - the route is GATED, so these 200s are only meaningful WITH a session
//
// ── WHY THIS HARNESS USED TO BE VACUOUS, AND WHAT CHANGED ──
//
// The owner ruling in 6aa43e6 gated GET /api/settings/llm/resource. Until then
// this file's `makeReq` supplied `socket: { remoteAddress: "127.0.0.1" }`, which
// takes the loopback bypass in `requireAuth`, so every 200 below was produced
// for an ANONYMOUS caller that a real deployment would have refused. The tests
// were not wrong about the governor's shape; they were unable to detect that
// the route had become gated at all — the same blindness that let
// NotificationCenter's unauthenticated poll stay green.
//
// So the harness now presents a NON-LOOPBACK peer and a real session, which is
// the path production takes, and one test asserts the anonymous non-loopback
// caller is refused. No existing assertion was weakened or removed: the governor
// shape is still asserted in full, now over the authenticated request.
//
// Hermetic: PICC_DATA_DIR → tmp dir, handlers imported fresh so the ledger
// store can never touch the real server data dir. The seeded session goes into
// the HARNESS-owned auth store (`PICC_AUTH_DATA_DIR`), which the shared setup
// file empties before each test — hence re-seeded per test, not once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TOKEN = "g".repeat(64)
const USER_ROW = { id: "u1", email: "governor@example.test", name: "Governor", salt: "s", passwordHash: "h", createdAt: 1 }

// TEST-NET-3 (203.0.113.0/24) is reserved and unroutable, so it is both
// non-loopback — which is what an attacker is — and inert.
const PEER = "203.0.113.7"

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

async function call(handleApi, method, path) {
  const res = makeRes()
  await handleApi(makeReq(method, path, undefined, { authorization: `Bearer ${TOKEN}` }), res, path)
  return res
}

/** The same route with no credential — the anonymous non-loopback caller. */
async function callAnonymous(handleApi, method, path) {
  const res = makeRes()
  await handleApi(makeReq(method, path), res, path)
  return res
}

describe("GET /api/settings/llm/resource (G3)", () => {
  let dir
  let handleApi
  let gov

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-gov-api-"))
    process.env.PICC_DATA_DIR = dir
    delete process.env.PICC_RESOURCE_GOVERNOR
    // A session, so the gate has something real to accept. Written into the
    // HARNESS-owned auth store, which the shared setup empties before every
    // test — so this has to run per test, not once at module scope.
    const authDir = process.env.PICC_AUTH_DATA_DIR
    writeFileSync(join(authDir, "users.json"), JSON.stringify({ users: [USER_ROW] }))
    writeFileSync(
      join(authDir, "sessions.json"),
      JSON.stringify({
        sessions: { [TOKEN]: { userId: USER_ROW.id, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
      })
    )
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    gov = await import("../services/resourceGovernor.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    delete process.env.PICC_RESOURCE_GOVERNOR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  // The control the 200s below depend on. Without it, "the route answered" is
  // also satisfied by a route that answers EVERYONE, and this file would again
  // be unable to tell a gated route from an open one.
  it("refuses an ANONYMOUS non-loopback caller, so the 200s below mean something", async () => {
    const res = await callAnonymous(handleApi, "GET", "/api/settings/llm/resource")
    expect(res.status).toBe(401)
    // And the refusal carries none of the shape the authenticated read returns.
    const flat = JSON.stringify(res.body)
    expect(flat).not.toContain("budgets")
    expect(flat).not.toContain("ledger")
  })

  it("returns the full Resource-tab shape", async () => {
    const res = await call(handleApi, "GET", "/api/settings/llm/resource")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.enabled).toBe("boolean")
    expect(res.body.budgets).toMatchObject({
      t0ConfidenceThreshold: expect.any(Number),
      t1MaxTokens: expect.any(Number),
      t2BurstPerHour: expect.any(Number),
      maxLedgerEntriesPerDay: expect.any(Number)
    })
    expect(res.body.verdicts).toEqual({ accepted: 0, throttled: 0, failed: 0 })
    expect(res.body.perTier.T0.calls).toBe(0)
    expect(res.body.burst.T2).toMatchObject({ callsThisHour: 0, limitPerHour: expect.any(Number) })
    expect(res.body.ledger.entriesToday).toBe(0)
    expect(res.body.rows).toEqual([])
  })

  it("reports `enabled` from the real process flag at request time", async () => {
    let res = await call(handleApi, "GET", "/api/settings/llm/resource")
    expect(res.body.enabled).toBe(false)

    process.env.PICC_RESOURCE_GOVERNOR = "on"
    res = await call(handleApi, "GET", "/api/settings/llm/resource")
    expect(res.body.enabled).toBe(true)
  })

  it("surfaces recorded rows + aggregates once calls are logged", async () => {
    await gov.recordCall({ feature: "news-digest", tier: "T1", model: "llama3.2:3b", tokens: 200, latencyMs: 400, verdict: "accepted" })
    await gov.recordCall({ feature: "strategy-brief", tier: "T2", model: "qwen2.5:7b", tokens: 1500, latencyMs: 4200, verdict: "throttled", degraded: true })

    const res = await call(handleApi, "GET", "/api/settings/llm/resource")
    expect(res.body.verdicts).toEqual({ accepted: 1, throttled: 1, failed: 0 })
    expect(res.body.perTier.T2.verdicts.throttled).toBe(1)
    expect(res.body.ledger.entriesToday).toBe(2)
    expect(res.body.rows.length).toBe(2)
    expect(res.body.rows[0].feature).toBe("strategy-brief")
    expect(res.body.rows[0].degraded).toBe(true)
  })

  it("never exposes prompt content across the API boundary (Q5)", async () => {
    await gov.recordCall({ feature: "brief", tier: "T2", tokens: 900, verdict: "accepted", prompt: "top secret thesis", context: "private context" })
    const res = await call(handleApi, "GET", "/api/settings/llm/resource")
    const flat = JSON.stringify(res.body)
    expect(flat).not.toContain("top secret")
    expect(flat).not.toContain("private context")
  })

  it("budgets reflect the configurable ceilings actually in force (owner §8.5)", async () => {
    process.env.PICC_GOV_T2_BURST_PER_HOUR = "3"
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    const res = await call(handleApi, "GET", "/api/settings/llm/resource")
    expect(res.body.budgets.t2BurstPerHour).toBe(3)
    expect(res.body.burst.T2.limitPerHour).toBe(3)
    delete process.env.PICC_GOV_T2_BURST_PER_HOUR
  })
})
