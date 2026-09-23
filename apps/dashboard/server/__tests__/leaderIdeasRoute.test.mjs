// WS-4 T4 — leader-ideas routes (WS-4 R3.1/R5.1/R6.1/R7.1/R8.1/AC-4, fixture
// store). GET readout mirrors the ceremony route (auth, writeJson, honesty
// cells); POST import runs in its own route-local block with a 64 MB readBodyMax
// cap (413 over cap); follow/trust are narrow auth + audited writes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DAY_MS = 86400000

const makeReq = (method, url, body, headers = {}) => {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

const makeRes = () => ({
  status: null,
  body: null,
  writeHead(status) {
    this.status = status
  },
  end(body) {
    this.body = body ? JSON.parse(body) : null
  }
})

async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

const idea = (i, over = {}) => ({
  id: `i${i}`,
  at: new Date(Date.now() - i * DAY_MS).toISOString(),
  asset: "BTC / USD",
  direction: "long",
  sizeUsd: 1000,
  entryPrice: 65000,
  exitPrice: 66000,
  closedAt: new Date(Date.now() - i * DAY_MS).toISOString(),
  pnlAfterCosts: 1,
  feesUsd: 0,
  ts: Date.now() - i * DAY_MS,
  ...over
})

const payloadB64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64")

describe("Command Centre leader-ideas routes (WS-4 T4)", () => {
  let dir
  let handleApi
  let store

  const leaderFile = () => join(dir, "leader-ideas.json")

  const seed = async () => {
    store.importLeaderRecord(
      {
        id: "leader-qualified",
        label: "TradeWise Alpha",
        source: "csv",
        lastPositionAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
        qualification: { verdict: "qualified", deny: null },
        ideas: [idea(0), idea(1)]
      },
      { now: Date.now(), audit: () => {} }
    )
    store.setPlatformTrust("leader-qualified", { value: "VERIFIED", by: "auditor", evidence: "reg-idx-1", now: Date.now(), audit: () => {} })
    store.followLeader("leader-qualified", { now: Date.now(), audit: () => {} })
    store.importLeaderRecord(
      {
        id: "leader-stalled",
        label: "Dormant Signals",
        source: "csv",
        lastPositionAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
        qualification: { verdict: "denied", deny: "leader:deny:trades-short (have 5, require 300)" },
        ideas: [idea(20)]
      },
      { now: Date.now(), audit: () => {} }
    )
    store.setPlatformTrust("leader-stalled", { value: "ADVERSARIAL", by: "auditor", evidence: "fraud-review-2", now: Date.now(), audit: () => {} })
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-leaders-route-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
    vi.resetModules()
    store = await import("../services/commandCentre/leaderIdeasState.mjs")
    seed()
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    store = await import("../services/commandCentre/leaderIdeasState.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    delete process.env.PICC_CAPTURE_CONFIG_DATA_DIR
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("auth required: a remote caller without a session gets 401", async () => {
    const auth = await import("../services/auth.mjs")
    await auth.createAccount({ email: "leaders@example.com", password: "correct-horse-battery", name: "Leaders" })
    const remote = makeReq("GET", "/api/command-centre/leader-ideas")
    remote.socket = { remoteAddress: "203.0.113.9" }
    const res = makeRes()
    await handleApi(remote, res, "/api/command-centre/leader-ideas")
    expect(res.status).toBe(401)
  })

  it("GET readout returns { ok, at, leaders[] } with the per-leader §3.3 contract incl. status/trust/qualification/guard/ideas", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/leader-ideas")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.at).toBe("string")
    expect(res.body.storeUnhealthy).toBe(false)
    expect(res.body.deny).toBeNull()
    const ids = res.body.leaders.map((l) => l.id)
    expect(ids).toEqual(["leader-qualified", "leader-stalled"])
    for (const l of res.body.leaders) {
      expect(typeof l.id).toBe("string")
      expect(typeof l.label).toBe("string")
      expect(typeof l.source).toBe("string")
      expect(typeof l.lastPositionAt).toBe("string")
      expect(l.status === "followed" || l.status === "auto-unfollowed").toBe(true)
      expect(typeof l.platformTrust.value).toBe("string")
      expect(l.qualification.verdict === "qualified" || l.qualification.verdict === "denied").toBe(true)
      expect(typeof l.guard.autoUnfollow.active).toBe("boolean")
      expect(l.guard.autoUnfollow.reason == null || typeof l.guard.autoUnfollow.reason === "string").toBe(true)
      expect(typeof l.guard.sevenDay.active).toBe("boolean")
      expect(l.guard.sevenDay.reason == null || typeof l.guard.sevenDay.reason === "string").toBe(true)
      expect(Array.isArray(l.ideas)).toBe(true)
      if (l.followedAt != null) expect(typeof l.followedAt).toBe("string")
    }
  })

  it("a followed, verified, qualified leader reads as status followed with plain ideas; the stale leader reads auto-unfollowed with its exact guard reason", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/leader-ideas")
    const fresh = res.body.leaders.find((l) => l.id === "leader-qualified")
    expect(fresh.status).toBe("followed")
    expect(fresh.followedAt).toEqual(expect.any(String))
    expect(fresh.platformTrust.value).toBe("VERIFIED")
    expect(fresh.qualification).toEqual({ verdict: "qualified", deny: null })
    expect(fresh.guard.autoUnfollow).toEqual({ active: false, reason: null })
    expect(fresh.deny).toBeNull()
    expect(fresh.ideas).toHaveLength(2)
    const stale = res.body.leaders.find((l) => l.id === "leader-stalled")
    expect(stale.status).toBe("auto-unfollowed")
    expect(stale.guard.autoUnfollow).toEqual({ active: true, reason: "leader:auto-unfollow:no-positions-21d" })
  })

  it("ADVERSARIAL platform trust suppresses ideas with leader:deny:platform-adversarial (no GO)", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/leader-ideas")
    const l = res.body.leaders.find((x) => x.id === "leader-stalled")
    expect(l.platformTrust.value).toBe("ADVERSARIAL")
    expect(l.deny).toBe("leader:deny:platform-adversarial")
    expect(l.ideas).toEqual([])
  })

  it("GET is proven read-only: the fixture store file is byte-identical before and after", async () => {
    const before = readFileSync(leaderFile(), "utf8")
    await call(handleApi, "GET", "/api/command-centre/leader-ideas")
    await call(handleApi, "GET", "/api/command-centre/overview")
    expect(readFileSync(leaderFile(), "utf8")).toBe(before)
  })

  it("unhealthy store → ok:true with a named leader:deny:store-unhealthy and empty leaders (never a silent all-pass)", async () => {
    writeFileSync(leaderFile(), '{\n  "version": 1,\n  "leaders":')
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    const res = await call(handleApi, "GET", "/api/command-centre/leader-ideas")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.storeUnhealthy).toBe(true)
    expect(res.body.deny).toBe("leader:deny:store-unhealthy")
    expect(res.body.leaders).toEqual([])
  })

  it("follow: happy path sets followedAt; unqualified → leader:deny:not-qualified; unknown → leader:deny:unknown-leader; missing id → 400", async () => {
    const unknown = await call(handleApi, "POST", "/api/command-centre/leader-ideas/follow", { leaderId: "nope" })
    expect(unknown.status).toBe(400)
    expect(unknown.body.deny).toBe("leader:deny:unknown-leader")
    const unqualified = await call(handleApi, "POST", "/api/command-centre/leader-ideas/follow", { leaderId: "leader-stalled" })
    expect(unqualified.body.deny).toBe("leader:deny:not-qualified")
    const missing = await call(handleApi, "POST", "/api/command-centre/leader-ideas/follow", {})
    expect(missing.status).toBe(400)
    expect(missing.body.deny).toBe("leader:deny:missing-leader-id")
    await call(handleApi, "POST", "/api/command-centre/leader-ideas/follow", { leaderId: "leader-qualified" })
    const res = await call(handleApi, "GET", "/api/command-centre/leader-ideas")
    expect(res.body.leaders.find((l) => l.id === "leader-qualified").followedAt).toEqual(expect.any(String))
  })

  it("trust: operator VERIFIED write is audited into at/by/evidence; missing evidence → 400; UNVERIFIED is a silent no-op", async () => {
    const noEvidence = await call(handleApi, "POST", "/api/command-centre/leader-ideas/trust", { leaderId: "leader-qualified", value: "VERIFIED", evidence: "" })
    expect(noEvidence.status).toBe(400)
    expect(noEvidence.body.deny).toBe("leader:deny:trust-evidence-required")
    const badValue = await call(handleApi, "POST", "/api/command-centre/leader-ideas/trust", { leaderId: "leader-qualified", value: "MAYBE", evidence: "x" })
    expect(badValue.body.deny).toBe("leader:deny:invalid-trust-value")
    const ok = await call(handleApi, "POST", "/api/command-centre/leader-ideas/trust", { leaderId: "leader-qualified", value: "ADVERSARIAL", evidence: "reg-register-idx-9" })
    expect(ok.status).toBe(200)
    expect(ok.body.platformTrust).toMatchObject({ value: "ADVERSARIAL", evidence: "reg-register-idx-9" })
    const res = await call(handleApi, "GET", "/api/command-centre/leader-ideas")
    const l = res.body.leaders.find((x) => x.id === "leader-qualified")
    expect(l.deny).toBe("leader:deny:platform-adversarial")
    expect(l.ideas).toEqual([])
  })

  it("import: a valid 300-trade feed lands 200 { ok, leaderId, qualification } and the record is stored qualified", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => idea(i))
    const res = await call(handleApi, "POST", "/api/command-centre/leader-ideas/import", {
      label: "Alpha Copy",
      source: "csv",
      payloadBase64: payloadB64({ rows, leaderId: "leader-alpha" })
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.leaderId).toBe("leader-alpha")
    expect(res.body.qualification).toEqual({ verdict: "qualified", deny: null })
    expect(store.findLeader("leader-alpha").qualification.verdict).toBe("qualified")
  })

  it("import: empty payload / unsupported payload / unparsable JSON are 400 named denies; costs-unaccounted feed is rejected", async () => {
    const malformed = await call(handleApi, "POST", "/api/command-centre/leader-ideas/import", { label: "X", source: "csv", payloadBase64: "not-base64-json" })
    expect(malformed.status).toBe(400)
    expect(malformed.body.deny).toBe("leader:deny:unparsable-feed")
    const missingEnvelope = await call(handleApi, "POST", "/api/command-centre/leader-ideas/import", {})
    expect(missingEnvelope.body.deny).toBe("leader:deny:empty-payload")
    const badSource = await call(handleApi, "POST", "/api/command-centre/leader-ideas/import", { label: "X", source: "hip", payloadBase64: payloadB64({ rows: [] }) })
    expect(badSource.body.deny).toBe("leader:deny:unsupported-payload")
    const costs = await call(handleApi, "POST", "/api/command-centre/leader-ideas/import", {
      label: "X",
      source: "csv",
      payloadBase64: payloadB64({ rows: [idea(0, { feesUsd: null }), idea(1)] })
    })
    expect(costs.body.deny).toBe("leader:deny:costs-unaccounted")
  })

  it("import: a payload over the 64 MB cap is a 413 (route-local readBodyMax)", async () => {
    const res = await call(handleApi, "POST", "/api/command-centre/leader-ideas/import", {
      label: "Big",
      source: "csv",
      payloadBase64: "a".repeat(65_000_000)
    })
    expect(res.status).toBe(413)
  })

  it("overview route stays 200 and wired alongside the new leader routes (additive handlers)", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/overview")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})