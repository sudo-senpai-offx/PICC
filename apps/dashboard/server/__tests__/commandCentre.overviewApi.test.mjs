// Command Centre slice 4 — GET /api/command-centre/overview + POST
// /api/command-centre/kill-switch. The surface must read the SAME observed
// state the enforcement layer reads: every cell is observed or an explicit
// "not-wired" label, the verdict is the real engine's, and the kill switch
// shown on a card is the one the sidecar gate consults.
//
// Hermetic: handlers is imported FRESH per test with the data dirs pointed at
// a tmp dir (auth + metrics + command-centre store), so boot reads + kill
// persistence can never touch the real server data dir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeReq(method, url, body, headers = {}) {
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

describe("Command Centre overview + kill-switch API (slice 4)", () => {
  let dir
  let handleApi
  let runtime
  let audit

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-cc-api-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    process.env.PICC_AUTOMATOR_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    runtime = await import("../services/commandCentre/commandCentreRuntime.mjs")
    audit = await import("../services/commandCentre/auditTrail.mjs")
    // Slice 5: bandwidth's mandatory feed (presence heartbeat) is OBSERVED by
    // the overview/execute handlers — a fresh node keeps bandwidth honest-fresh
    // by default; staleness tests overwrite the presence file explicitly.
    const automator = await import("../services/automator.mjs")
    await automator.recordPresence("test-node")
  })

  afterEach(() => {
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    delete process.env.PICC_CAPTURE_CONFIG_DATA_DIR
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    delete process.env.PICC_AUTOMATOR_DATA_DIR
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET overview: every catalog site has a row with the real engine verdict + full 10-gate rail", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/overview")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.killSwitch).toEqual({ global: false, sites: {} })
    expect(res.body.sites.map((s) => s.site)).toEqual([
      "trading:ccxt",
      "bandwidth:browser",
      "expertoption"
    ])
    for (const row of res.body.sites) {
      expect(row.gates).toHaveLength(10)
      expect(row.gates.map((g) => g.gate)).toEqual([
        "kill-switch",
        "cross-site-day-halt",
        "human-takeover",
        "per-site-opt-in",
        "hard-breakers",
        "fresh-data",
        "toS-survival",
        "envelope-within-ceiling",
        "rationale-renderable",
        "idempotent"
      ])
      expect(["BLOCKED", "HOLD", "COPILOT", "AUTOPILOT_DEMO", "AUTOPILOT"]).toContain(row.mode)
      expect(Array.isArray(row.reasons)).toBe(true)
    }
  })

  it("verbose honesty: not-wired cells carry the explicit label — never a silent OK", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/overview")
    const ccxt = res.body.sites.find((r) => r.site === "trading:ccxt")
    // opt-in is a DECISION, not an approval — nothing has ever been granted
    expect(ccxt.inputs.optIn.status).toBe("not-decided")
    expect(ccxt.inputs.deliberation).toBe("not-yet-available")
    expect(ccxt.inputs.workability.value).toBeNull()
    expect(ccxt.inputs.workability.note).toContain("not-wired")
    const optIn = ccxt.gates.find((g) => g.gate === "per-site-opt-in")
    expect(optIn.status).toBe("not-decided")
    // Slice 6: the ccxt order leg is wired UNCONDITIONALLY — its envelope cell is
    // observed (0 in-flight of the 2-concurrent ceiling; $10 per-action cap), not
    // "arrives with execution" any more.
    const envelope = ccxt.gates.find((g) => g.gate === "envelope-within-ceiling")
    expect(envelope.status).toBe("pass")
    expect(envelope.note).toContain("market exposure capped at $10 per action (5D)")
    expect(ccxt.executionLeg).toMatchObject({
      leg: "proposals",
      action: "ccxt:spot-order",
      inFlight: 0,
      lastExecutedAt: null
    })
    // NO equity observation has ever happened → the mandatory 5E feed is
    // UNDECLARED → fresh-data honest not-wired (the seam decides, never us)
    const fresh = ccxt.gates.find((g) => g.gate === "fresh-data")
    expect(fresh.status).toBe("not-wired")
    // expertoption has a capture profile (idle) → observable, not not-wired
    const eo = res.body.sites.find((r) => r.site === "expertoption")
    expect(eo.gates.find((g) => g.gate === "fresh-data").status).toBe("pass")
    expect(eo.metrics.source).toBe("not-observed")
  })

  it("the FIRST equity observation wires ccxt fresh-data: within cadence → pass, floor-mode unchanged", async () => {
    // Seed the seam's persisted equity store (the same file observeCcxtEquity
    // writes) and reboot handlers so the overview reads the OBSERVED feed.
    // A fresh observation is by definition within CCXT_EQUITY_STALE_MS.
    writeFileSync(
      join(dir, "ccxt-equity.json"),
      JSON.stringify({
        binance: {
          exchange: "binance",
          dayKey: new Date().toISOString().slice(0, 10),
          at: new Date().toISOString(),
          equityUsd: 100,
          dayStartEquityUsd: 100
        }
      })
    )
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    const res = await call(handleApi, "GET", "/api/command-centre/overview")
    const ccxt = res.body.sites.find((r) => r.site === "trading:ccxt")
    const fresh = ccxt.gates.find((g) => g.gate === "fresh-data")
    expect(fresh.status).toBe("pass")
    expect(fresh.note).toContain("within cadence")
    expect(ccxt.mode).toBe("COPILOT")
  })

  it("no fabricated execution power: workability 0 feeds a real COPILOT cap — verdict matches the engine", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/overview")
    const ccxt = res.body.sites.find((r) => r.site === "trading:ccxt")
    // sanctioned + no opt-in + workability 0 → the engine says COPILOT at most
    expect(ccxt.mode).toBe("COPILOT")
    expect(ccxt.executionPower).toBe("proposals")
    expect(ccxt.reasons.some((r) => r.includes("below floor"))).toBe(true)
  })

  it("a per-site kill flips THAT row's verdict, gate rail, and switch input — never the siblings", async () => {
    const post = await call(handleApi, "POST", "/api/command-centre/kill-switch", {
      scope: "trading:ccxt",
      kill: true
    })
    expect(post.status).toBe(200)
    expect(post.body.state.sites).toEqual({ "trading:ccxt": true })

    const res = await call(handleApi, "GET", "/api/command-centre/overview")
    const ccxt = res.body.sites.find((r) => r.site === "trading:ccxt")
    expect(ccxt.inputs.killSwitch).toBe(true)
    expect(ccxt.mode).toBe("BLOCKED")
    expect(ccxt.gates.find((g) => g.gate === "kill-switch").status).toBe("block")
    const bandwidth = res.body.sites.find((r) => r.site === "bandwidth:browser")
    expect(bandwidth.inputs.killSwitch).toBe(false)
    expect(bandwidth.mode).toBe("COPILOT")
  })

  it("the GLOBAL kill blocks every site and clears when the human rearms", async () => {
    await call(handleApi, "POST", "/api/command-centre/kill-switch", { scope: "global", kill: true })
    let res = await call(handleApi, "GET", "/api/command-centre/overview")
    expect(res.body.killSwitch.global).toBe(true)
    for (const row of res.body.sites) {
      expect(row.mode).toBe("BLOCKED")
      expect(row.gates.find((g) => g.gate === "kill-switch").status).toBe("block")
    }
    await call(handleApi, "POST", "/api/command-centre/kill-switch", { scope: "global", kill: false })
    res = await call(handleApi, "GET", "/api/command-centre/overview")
    expect(res.body.killSwitch.global).toBe(false)
  })

  it("kill-switch transitions are audited in the shared chain", async () => {
    const post = await call(handleApi, "POST", "/api/command-centre/kill-switch", {
      scope: "expertoption",
      kill: true
    })
    expect(post.status).toBe(200)
    const trail = audit.readAudit()
    const event = trail.find((e) => e.kind === "kill-switch")
    expect(event).toMatchObject({ site: "expertoption", data: { kill: true } })
    expect(audit.verifyAudit().ok).toBe(true)
  })

  it("POST sanitizes scope and kill: unknown scope and non-boolean are 400s that mutate nothing", async () => {
    const unknown = await call(handleApi, "POST", "/api/command-centre/kill-switch", {
      scope: "somewhere:else",
      kill: true
    })
    expect(unknown.status).toBe(400)
    const nonBool = await call(handleApi, "POST", "/api/command-centre/kill-switch", {
      scope: "trading:ccxt",
      kill: "yes"
    })
    expect(nonBool.status).toBe(400)
    expect(runtime.killSwitchState()).toEqual({ global: false, sites: {} })
  })

  it("?stream=trading filters rows to the trading stream only", async () => {
    const res = await call(handleApi, "GET", "/api/command-centre/overview?stream=trading")
    expect(res.body.stream).toBe("trading")
    expect(res.body.sites.map((s) => s.site)).toEqual(["trading:ccxt", "expertoption"])
    const bad = await call(handleApi, "GET", "/api/command-centre/overview?stream=definitely")
    expect(bad.status).toBe(200)
    expect(bad.body.ok).toBe(false)
  })

  it("overview + kill-switch are authenticated: a remote caller without a session gets 401", async () => {
    const auth = await import("../services/auth.mjs")
    await auth.createAccount({ email: "cc@example.com", password: "correct-horse-battery", name: "CC" })
    const remote = makeReq("GET", "/api/command-centre/overview")
    remote.socket = { remoteAddress: "203.0.113.5" } // NOT localhost
    const res = makeRes()
    await handleApi(remote, res, "/api/command-centre/overview")
    expect(res.status).toBe(401)
    const remote2 = makeReq("POST", "/api/command-centre/kill-switch", { scope: "global", kill: true })
    remote2.socket = { remoteAddress: "203.0.113.5" }
    const res2 = makeRes()
    await handleApi(remote2, res2, "/api/command-centre/kill-switch")
    expect(res2.status).toBe(401)
  })

  // ---- Slice 5: the FIRST live execution leg (bandwidth payout claims).
  // The overview now reports the observed claim leg + mandatory-feed freshness;
  // the claims list surfaces scheduler payout_ready rows; the execute route runs
  // the full gate chain and only then touches the venue (workflow engine), which
  // fails honestly with BROWSER_CLOSED in CI — the happy path is fixture-tested
  // at the seam (commandCentre.execution.test.mjs) and mocked at the route in
  // commandCentre.executeApi.test.mjs.
  describe("Command Centre slice 5 — claims leg (overview wired to observed feeds + execution)", () => {
    it("bandwidth row reports the OBSERVED claims leg: fresh-data/envelope/rationale pass, executionLeg present", async () => {
      const res = await call(handleApi, "GET", "/api/command-centre/overview")
      const bw = res.body.sites.find((r) => r.site === "bandwidth:browser")
      expect(bw.executionLeg).toMatchObject({
        leg: "proposals",
        action: "bandwidth:payout-claim",
        inFlight: 0,
        lastExecutedAt: null
      })
      expect(bw.gates.find((g) => g.gate === "fresh-data").status).toBe("pass")
      expect(bw.gates.find((g) => g.gate === "envelope-within-ceiling").status).toBe("pass")
      expect(bw.gates.find((g) => g.gate === "rationale-renderable").status).toBe("pass")
      expect(bw.mode).toBe("COPILOT")
      // consent ≠ opt-in: the leg runs on fresh per-action consent, NOT a standing opt-in
      const optIn = bw.gates.find((g) => g.gate === "per-site-opt-in")
      expect(optIn.status).toBe("not-decided")
      expect(optIn.note).toContain("explicitly NOT an automation opt-in")
    })

    it("stale presence-heartbeat blocks the bandwidth leg honestly (5E) — no 'probably up'", async () => {
      writeFileSync(
        join(dir, "presence.json"),
        JSON.stringify({
          devices: { "test-node": new Date(Date.now() - 20 * 60 * 1000).toISOString() },
          updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString()
        })
      )
      const res = await call(handleApi, "GET", "/api/command-centre/overview")
      const bw = res.body.sites.find((r) => r.site === "bandwidth:browser")
      const fresh = bw.gates.find((g) => g.gate === "fresh-data")
      expect(fresh.status).toBe("block")
      expect(fresh.note).toContain("presence-heartbeat")
      expect(bw.mode).toBe("HOLD")
    })

    it("GET claims lists scheduler payout_ready rows as ready with a durable idempotency key (5G)", async () => {
      const store = await import("../services/localstore.mjs")
      await store.appendRow("agent_logs", {
        kind: "payout_ready",
        source: "scheduler",
        level: "info",
        platform: "Traffmonetizer",
        balance: 12.4,
        payoutThreshold: 10,
        note: "Balance 12.4 meets the 10 payout threshold"
      })
      const res = await call(handleApi, "GET", "/api/command-centre/claims")
      expect(res.status).toBe(200)
      expect(res.body.claims).toHaveLength(1)
      const c = res.body.claims[0]
      const day = new Date().toISOString().slice(0, 10)
      expect(c).toMatchObject({
        platform: "Traffmonetizer",
        balance: 12.4,
        payoutThreshold: 10,
        ref: day,
        status: "ready",
        idempotencyKey: `bandwidth:claim:Traffmonetizer:${day}`
      })
    })

    it("a claim already in the audit trail shows claimed — the durable trail is the 5G source", async () => {
      const store = await import("../services/localstore.mjs")
      await store.appendRow("agent_logs", {
        kind: "payout_ready",
        source: "scheduler",
        level: "info",
        platform: "Traffmonetizer",
        balance: 12.4,
        payoutThreshold: 10
      })
      const key = `bandwidth:claim:Traffmonetizer:${new Date().toISOString().slice(0, 10)}`
      audit.appendAudit({
        site: "bandwidth:browser",
        kind: "execution:executed",
        data: { action: "bandwidth:payout-claim", idempotencyKey: key, power: "proposals" }
      })
      const res = await call(handleApi, "GET", "/api/command-centre/claims")
      expect(res.body.claims[0].status).toBe("claimed")
    })

    it("POST execute: gate passes, then the venue step fails honestly with BROWSER_CLOSED (no browser in CI)", async () => {
      const res = await call(handleApi, "POST", "/api/command-centre/execute", {
        platform: "Traffmonetizer",
        balance: 12.4,
        threshold: 10,
        claimWorkflowId: "wf-payout-claim"
      })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(false)
      expect(res.body.consentBy).toBe("default")
      // the gate chain ALLOWED the claim (fresh presence, no kill, etc.)
      expect(res.body.gate.allow).toBe(true)
      expect(res.body.gate.blockedBy).toBeNull()
      // ...and the venue-touching executor reported its real state: browser closed
      expect(res.body.execution.status).toBe("failed")
      expect(res.body.execution.error).toContain("browser is not open")
      // every denial AND every failure is on the durable audit trail (5A)
      const trail = audit.readAudit()
      expect(trail.some((e) => e.kind === "safety-gate:allow")).toBe(true)
      expect(trail.some((e) => e.kind === "execution:failed")).toBe(true)
      expect(audit.verifyAudit().ok).toBe(true)
    })

    it("POST execute with stale presence-heartbeat is DENIED before the venue — 5E block (5E)", async () => {
      writeFileSync(
        join(dir, "presence.json"),
        JSON.stringify({
          devices: { "test-node": new Date(Date.now() - 20 * 60 * 1000).toISOString() },
          updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString()
        })
      )
      const res = await call(handleApi, "POST", "/api/command-centre/execute", {
        platform: "Traffmonetizer",
        balance: 12.4,
        threshold: 10,
        claimWorkflowId: "wf-payout-claim"
      })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(false)
      expect(res.body.gate.allow).toBe(false)
      expect(res.body.gate.blockedBy).toBe("fresh-data")
      expect(res.body.execution).toBeNull()
    })

    it("POST execute validates its inputs: platform, finite balance/threshold, and a claim workflow id are required", async () => {
      const missingPlatform = await call(handleApi, "POST", "/api/command-centre/execute", {
        balance: 12.4,
        threshold: 10,
        claimWorkflowId: "wf"
      })
      expect(missingPlatform.status).toBe(400)
      expect(missingPlatform.body.error).toContain("platform")

      const badNumbers = await call(handleApi, "POST", "/api/command-centre/execute", {
        platform: "Traffmonetizer",
        balance: "lots",
        threshold: 10,
        claimWorkflowId: "wf"
      })
      expect(badNumbers.status).toBe(400)
      expect(badNumbers.body.error).toContain("finite")

      const noWorkflow = await call(handleApi, "POST", "/api/command-centre/execute", {
        platform: "Traffmonetizer",
        balance: 12.4,
        threshold: 10
      })
      expect(noWorkflow.status).toBe(400)
      expect(noWorkflow.body.error).toContain("claimWorkflowId")
    })

    it("claims + execute are authenticated like the rest of the surface", async () => {
      // a user must exist for the remote-auth rule to bite (no users = bootstrap)
      const auth = await import("../services/auth.mjs")
      await auth.createAccount({ email: "cc2@example.com", password: "correct-horse-battery", name: "CC2" })
      const remote = makeReq("GET", "/api/command-centre/claims")
      remote.socket = { remoteAddress: "203.0.113.5" }
      const res = makeRes()
      await handleApi(remote, res, "/api/command-centre/claims")
      expect(res.status).toBe(401)
      const remote2 = makeReq("POST", "/api/command-centre/execute", { platform: "x", balance: 1, threshold: 1, claimWorkflowId: "wf" })
      remote2.socket = { remoteAddress: "203.0.113.5" }
      const res2 = makeRes()
      await handleApi(remote2, res2, "/api/command-centre/execute")
      expect(res2.status).toBe(401)
    })
  })
})