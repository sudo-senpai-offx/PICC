// WS-7 T9 — `GET /api/trading/paper-live/permits` at the HTTP boundary, and the
// producer it serves.
//
// THE GATE IS ASSERTED HERE, NOT LEFT TO THE STATIC SCAN.
// `ws7RouteAuthCoverageGuard` proves a gate call exists in the route's own block;
// this proves the route answers 401 to an anonymous caller and discloses nothing.
// A scan can be satisfied by a gate that never runs — T7R-B's stated reason for
// writing `copilotDecisionRoute.test.mjs` — and this is the assertion that cannot
// be.
//
// GATED, AND DELIBERATELY NOT ALLOWLISTED. The payload names broker ids and every
// refusal reason the permit write path can produce. None of it is declared-public,
// so it gets NO allowlist entry and NO unruled owner entry: the decision entries
// awaiting the owner are not a pool to draw from. That is the T7R-B precedent,
// copied.
//
// THE FIRST TEST IS THE ONE THAT MATTERS MOST. `PAPER_LIVE_BROKER_IDS` in
// `paperLivePermit.mjs` duplicates the slug vocabulary `services/brokers.mjs`
// registers, and a duplication that could rot would mean a broker added there
// silently going unpermitted and unreported. So this file DISCOVERS the slugs by
// actually calling `listBrokers()` and asserts the two sets are equal. The list is
// pinned to a fact about the producer rather than trusted.
//
// Hermetic: booted through the SHARED store-isolation helper, so no store resolves
// to the real `server/data`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"
import {
  D6_LADDER_RUNGS,
  PAPER_LIVE_BROKER_IDS,
  PAPER_LIVE_PERMIT_VERSION,
  paperLivePermit
} from "../services/authority/paperLivePermit.mjs"

const ROUTE = "/api/trading/paper-live/permits"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    // DELIBERATELY NO `socket`. `requireAuth` admits a request outright when
    // `isLocalhostRequest(req)` is true (`handlers.mjs:5854`), and that predicate
    // reads the real TCP peer. An earlier harness supplied
    // `socket: { remoteAddress: "127.0.0.1" }` and therefore took that bypass, so
    // the anonymous caller was admitted. That was a defect in the HARNESS, not in
    // the route — a loopback caller is inside the trust boundary by definition — so
    // an anonymous-caller assertion must present a NON-loopback caller, which is
    // what omitting `socket` does. Same reasoning as `copilotDecisionRoute.test.mjs`
    // and `ministryGovernanceRoute.test.mjs`.
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
const TOKEN = "b".repeat(64)

describe("WS-7 T9 — GET /api/trading/paper-live/permits is gated", () => {
  let dir

  beforeEach(() => {
    // Through the SHARED helper, never `process.env` by hand:
    // `ws7TestStoreIsolation.test.mjs` enumerates via `git ls-files`, so it cannot
    // see an untracked file, and a hand-rolled `process.env.PICC_*_DATA_DIR =` is
    // what that guard exists to refuse.
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
    // A user exists so auth is ENFORCED. With an empty store `requireAuth` takes
    // its first-run bootstrap branch, which admits everyone — pinned explicitly
    // below rather than left to be discovered.
    if (withUser) {
      writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?paper-live-permits-route-test")
    return handleApi
  }

  /** An AUTHENTICATED, non-loopback caller: a user AND a session carrying the token. */
  async function authed() {
    writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
    writeFileSync(
      join(dir, "sessions.json"),
      JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?paper-live-permits-authed")
    return handleApi
  }

  it("refuses an anonymous caller with 401 and discloses nothing", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", ROUTE)

    expect(res.status).toBe(401)
    // The refusal must not echo the readout's vocabulary. An error body naming a
    // broker or a permit would be the disclosure the gate prevents.
    const text = JSON.stringify(res.body ?? {})
    for (const leak of ["permit", "automation", "broker", "rung", "ladder", "authority"]) {
      expect(text.toLowerCase(), `${leak} must not leak through a 401`).not.toContain(leak)
    }
  })

  it("inherits requireAuth's first-run bootstrap, and that is pinned, not assumed", async () => {
    // INHERITED, NOT INTRODUCED. Every `requireAuth` site in handlers.mjs takes
    // this branch when the user store is empty, because `requireAuth` is shared.
    // The room's safety does NOT rest on this route's exposure: the client renders
    // `unknown` for a refused request, which is non-permissive. So the empty-store
    // case is recorded as INHERITED rather than mitigated, and asserted so a change
    // in the shared gate's behaviour shows up here.
    const api = await loadHandlers({ withUser: false })
    const res = await call(api, "GET", ROUTE)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // And once one account exists, the same route refuses. The pair is the claim:
    // the bootstrap branch is the shared gate's, not this route's.
    const populated = await loadHandlers()
    const refused = await call(populated, "GET", ROUTE)
    expect(refused.status).toBe(401)
  })

  it("the route is NOT allowlisted anywhere as an owner decision entry", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "handlers.mjs"), "utf8")
    const idx = src.indexOf(ROUTE)
    expect(idx, `${ROUTE} must be registered in handlers.mjs`).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 1400)
    expect(block, "the route's own block must carry a gate").toMatch(/requireAuth\(/)
    expect(block, "no unruled owner entry").not.toMatch(/owner:\s*"decision"/)
    expect(block, "no declared-public marker").not.toMatch(/declaredPublic/i)
  })

  it("added NO duplicate route over a store that already had one", () => {
    // T8's precedent is a refusal, and this is the assertion that the refusal
    // happened. Ceremony and the command-centre gate set each already had a
    // requireAuth-gated route BEFORE this task; bundling them into the Paper/Live
    // route would put one store behind two routes and give it two answers taken at
    // two moments — the defect T8 declined to create for the ceremony store.
    //
    // Counted on handlers.mjs as a whole rather than inside this file's block,
    // because a second route for the same store would not necessarily be adjacent.
    const src = readFileSync(join(import.meta.dirname, "..", "handlers.mjs"), "utf8")
    const count = (pattern) => src.match(pattern) ?? []

    expect(
      count(/path === "\/api\/command-centre\/ceremony[^"]*"/g),
      "exactly ONE ceremony route — T9 reused the pre-existing one and added no second"
    ).toHaveLength(1)
    expect(
      count(/path === "\/api\/command-centre\/overview[^"]*"/g),
      "exactly ONE command-centre overview route — reused, not duplicated"
    ).toHaveLength(1)
    expect(
      count(/path === "\/api\/trading\/brokers[^"]*"/g),
      "exactly ONE broker-registry route — reused for the current rung, not duplicated"
    ).toHaveLength(1)
    expect(count(/path === "\/api\/trading\/paper-live\/permits[^"]*"/g), "exactly ONE permit route").toHaveLength(1)

    // And the three reused producers are the ones the spec already had gated.
    for (const reused of ["/api/command-centre/ceremony", "/api/command-centre/overview"]) {
      const at = src.indexOf(`path === "${reused}"`)
      const own = src.slice(at, at + 400)
      expect(own, `${reused} must keep its own requireAuth gate`).toMatch(/requireAuth\(/)
    }
  })

  it("did not add a ceremony-ACTION route, so no rung can be advanced from the room", () => {
    // D6 makes crossing a rung a human act with its own ceremony. The producer's own
    // unlock seam refuses outside a test run (`ceremonyState.mjs:189-191`), and this
    // asserts no route was added that could create an enablement record at runtime.
    const src = readFileSync(join(import.meta.dirname, "..", "handlers.mjs"), "utf8")
    for (const forbidden of [
      "/api/command-centre/ceremony/unlock",
      "/api/trading/ceremony",
      "unlockVenueClass",
      "setAutomationPermitted"
    ]) {
      expect(src, `handlers.mjs must not contain ${forbidden} — T9 renders state and enables nothing`).not.toContain(forbidden)
    }
  })
})

describe("WS-7 T9 — the permit readout over REAL broker records (handoff #4)", () => {
  it("the broker id list EQUALS the slugs brokers.mjs actually registers", async () => {
    // The duplication that cannot rot quietly. `listBrokers()` is the real
    // registry producer; this calls it under isolated stores and compares SETS,
    // so a fourth broker added there fails here rather than going unreported.
    useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
    useIsolatedStoreDir("PICC_DATA_DIR")
    const dir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
    try {
      const { listBrokers } = await import("../services/brokers.mjs")
      const registry = await listBrokers()
      const discovered = registry.brokers.map((b) => b.slug).sort()
      expect(
        [...PAPER_LIVE_BROKER_IDS].sort(),
        `PAPER_LIVE_BROKER_IDS must equal the slugs services/brokers.mjs registers. It was discovered as ` +
          `${JSON.stringify(discovered)}. A broker that exists but is not in this list would be neither permitted nor reported.`
      ).toEqual(discovered)
      // And the readout's `brokers` column is exactly that set, one row each.
      const readout = paperLivePermit()
      expect(readout.brokers.map((b) => b.brokerId).sort()).toEqual(discovered)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("reports the D6 ladder as a fixed three-rung vocabulary, in ladder order", () => {
    // The order is load-bearing: "one-directional" is a claim about DIRECTION and
    // a reader cannot check a claim about direction against an unordered set.
    expect(D6_LADDER_RUNGS).toEqual(["paper", "demo", "live"])
    const readout = paperLivePermit()
    expect(readout.ladder.rungs).toEqual(["paper", "demo", "live"])
    expect(readout.ladder.rule).toMatch(/one-directional/i)
  })

  it("every broker reads NOT PERMITTED, and for the reason D5 requires", () => {
    // D5:133 — "The flag defaults to FALSE". The reason each row fails must name
    // the cause, so a reader can tell "nobody granted this" from "this was refused".
    const readout = paperLivePermit()
    expect(readout.ok).toBe(true)
    expect(readout.version).toBe(PAPER_LIVE_PERMIT_VERSION)

    for (const row of readout.brokers) {
      expect(row.automationPermitted, `${row.brokerId} must not read as permitted`).toBe(false)
      expect(row.recordedFlag, `${row.brokerId} must be at D5's false default`).toBe(false)
      expect(row.permitChangedAt, `${row.brokerId} must have no permit timestamp`).toBeNull()
      expect(row.permitChangedByAuthorityId, `${row.brokerId} must have no approving authority`).toBeNull()
      expect(row.ceremonyUnlocked, `${row.brokerId} has no ceremony-unlock producer`).toBe(false)
      expect(row.changeCount).toBe(0)
      expect(row.verdictReason).toMatch(/authority:deny:automation-permit-no-approving-authority/)
    }
    expect(readout.changeCount, "no permit change can be recorded without an authority").toBe(0)
  })

  it("reports the RAW flag BESIDE the gated read, so the provenance gate is visible", () => {
    // The whole point of the provenance gate is that a bare-boolean record does not
    // read as permission. A readout that emitted only the gated boolean would make
    // the gate invisible, so both are present and separately named.
    const readout = paperLivePermit()
    for (const row of readout.brokers) {
      expect(Object.keys(row)).toEqual(expect.arrayContaining(["automationPermitted", "recordedFlag", "provenanceResolves"]))
    }
    expect(readout.residual, "T16's fail-open residual must be carried, not hidden").toMatch(/refused DECLINE/i)
  })

  it("carries the absences that make the falses true rather than assumed", () => {
    const readout = paperLivePermit()
    const whats = readout.absences.map((a) => a.what)
    expect(whats).toContain("NO PRODUCTION AUTHORITY SET")
    expect(whats).toContain("NO CEREMONY-UNLOCK PRODUCER")
    expect(whats).toContain("NO BUILD REGISTRY")
    for (const absence of readout.absences) {
      expect(absence.detail.trim().length, `${absence.what} needs a written reason`).toBeGreaterThan(40)
    }
  })

  it("is frozen, and holds no clock of its own", () => {
    // The permit store takes `at` as a caller-supplied argument
    // (`brokerAutomationPermit.mjs:166-172`), so with no broker ever granted there
    // is no event and no time to invent. Two calls must be byte-identical, which is
    // what "no clock" means operationally.
    expect(Object.isFrozen(paperLivePermit())).toBe(true)
    expect(JSON.stringify(paperLivePermit())).toBe(JSON.stringify(paperLivePermit()))

    const src = readFileSync(join(import.meta.dirname, "..", "services", "authority", "paperLivePermit.mjs"), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    for (const banned of ["Date.now", "new Date", "performance.now", "Math.random", "fetch(", "node:fs", "readFile", "writeFile"]) {
      expect(code, `paperLivePermit.mjs must not contain ${banned} — it opens no clock, no file and no socket`).not.toContain(banned)
    }
  })

  it("emits NO tier and NO action: what a permit means is T11's, not this room's", () => {
    // Plan §3.5 Risk 6 is a duplicated safety boundary. A readout that emitted an
    // `autoExecuteAvailable` boolean would be a second copy of T11's decision, and
    // a wrong `true` in it would be the most dangerous rendering defect in WS-7.
    const readout = paperLivePermit()
    const keys = Object.keys(readout)
    for (const banned of ["tier", "action", "autoExecute", "available", "liveTrading"]) {
      expect(keys, `paperLivePermit must not emit a ${banned} field`).not.toContain(banned)
    }
    for (const row of readout.brokers) {
      for (const banned of ["tier", "action", "autoExecute"]) {
        expect(Object.keys(row), `a broker row must not emit a ${banned} field`).not.toContain(banned)
      }
    }
  })

  it("does NOT duplicate the Ministry readout's permit answer", async () => {
    // Two readouts of the same store would give one store two answers taken at two
    // moments — the defect T8 refused for the ceremony store. The Ministry readout
    // is pinned at `brokers: []` by `ministryGovernanceRoute.test.mjs:244-252`;
    // THIS readout is seeded with real brokers. The two are answering different
    // questions about different stores, and this test states that the Ministry
    // answer is untouched rather than asserting the two agree — because they must
    // NOT agree, and a reader expecting agreement is the reader most likely to get
    // it wrong.
    const { ministryGovernance } = await import("../services/authority/governance.mjs")
    const ministry = ministryGovernance()
    expect(ministry.permits.brokers, "the Ministry readout's store is still empty and still pinned").toEqual([])
    expect(ministry.permits.reason).toMatch(/no broker record is wired/i)

    expect(paperLivePermit().brokers.length).toBeGreaterThan(0)
  })
})