// WS-4 (T6 / F7) AC-7 seam guard — source + behavior pins: no-execution-path reachable from F1–F5, platformTrust default UNVERIFIED with trust-POST-only writes, qualification floors 300/15/5 with env unset, overview/aggregate compose byte-identical, HIP stub reason exact (D8 string), GET read-only, cost-blind feed can never qualify.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const MODULES = {
  leaderIdeasState: "../services/commandCentre/leaderIdeasState.mjs",
  leaderFeedContract: "../services/copytrade/leaderFeedContract.mjs",
  leaderQualification: "../services/copytrade/leaderQualification.mjs",
  csvFeedImport: "../services/copytrade/csvFeedImport.mjs",
  leaderGuard: "../services/copytrade/leaderGuard.mjs"
}

const HANDLERS = "../handlers.mjs"
const OVERVIEW = "../services/commandCentre/commandCentreOverview.mjs"
const VENUES_DIR = "../services/venues/"

const D8_HIP_EXACT = "leader:deny:hip-not-wired — endpoint contract unverified"
const HIP_SHORT = "leader:deny:hip-not-wired"

const BANNED_BASENAMES = new Set([
  "ccxtExecution.mjs",
  "hyperliquidPerps.mjs",
  "livePositionManager.mjs",
  "positionManager.mjs",
  "autopilot.mjs",
  "brokerRegistry.mjs"
])

const BANNED_EXEC =
  /(?:\b(?:placeOrder|mirrorOrder|copyOrder|copyTrade|submitOrder|createOrder|openOrder|closeOrder|execute)\b)|(?:proposeCcxtOrder|executeCcxtOrder|autopilot|hyperliquidPerps|ccxtExecution|positionManager)/i

const source = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")

const importSpecifiers = (code) => {
  const out = []
  const re = /(?:import(?:[\s\S]*?from\s*)?|export[\s\S]*?from\s*)['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(code)) !== null) out.push(m[1])
  return out
}

const hasVenueSegment = (abs) => abs.split(/[\\/]/).includes("venues")

const reachableFrom = (rootRel) => {
  const reachable = new Set()
  const queue = [fileURLToPath(new URL(rootRel, import.meta.url))]
  while (queue.length > 0) {
    const abs = queue.shift()
    if (reachable.has(abs)) continue
    reachable.add(abs)
    for (const spec of importSpecifiers(readFileSync(abs, "utf8"))) {
      if (!spec.startsWith(".")) continue
      let target = resolve(dirname(abs), spec)
      if (!/\.[a-z]+$/i.test(target)) target += ".mjs"
      queue.push(target)
    }
  }
  return [...reachable]
}

const exportNamesOf = async (rel) => Object.keys(await import(new URL(rel, import.meta.url).href)).sort()

const NO_ENV = ["PICC_LEADER_AUTO_UNFOLLOW_DAYS", "PICC_LEADER_7D_STOP_PCT"]

let dir

beforeEach(() => {
  for (const v of NO_ENV) delete process.env[v]
  dir = mkdtempSync(join(tmpdir(), "picc-ws4-seam-"))
  process.env.PICC_AUTH_DATA_DIR = dir
  process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
  process.env.PICC_CAPTURE_CONFIG_DATA_DIR = dir
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  process.env.PICC_DATA_DIR = dir
  vi.resetModules()
})

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("PICC_")) delete process.env[k]
  }
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

const idea = (i, over = {}) => ({
  id: `i${i}`,
  at: new Date(Date.UTC(2026, 8, (i % 20) + 1, 12)).toISOString(),
  asset: "BTC / USD",
  direction: "long",
  sizeUsd: 1000,
  entryPrice: 60000 + i,
  exitPrice: 61000 + i,
  closedAt: new Date(Date.UTC(2026, 8, (i % 20) + 1, 13)).toISOString(),
  pnlAfterCosts: 1,
  feesUsd: 0,
  ts: Date.UTC(2026, 8, (i % 20) + 1, 12),
  ...over
})

const feed300 = () => Array.from({ length: 300 }, (_, i) => idea(i))

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const DAY_MS = 86400000
const isoOf = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toISOString()

describe("WS-4 AC-7 (a) — no execution path reachable from the WS-4 modules", () => {
  it("F1–F5 source imports never reference the execution venue adapters (services/venues/*)", () => {
    for (const rel of Object.values(MODULES)) {
      const src = source(rel)
      const specifiers = importSpecifiers(src)
      expect(specifiers.some((s) => s.includes("venues"))).toBe(false)
      expect(specifiers.some((s) => s.includes(VENUES_DIR))).toBe(false)
      expect(src.includes(VENUES_DIR)).toBe(false)
    }
  })

  it("F1–F5 stripped source carries no place/mirror/execute-style identifier", () => {
    for (const [name, rel] of Object.entries(MODULES)) {
      const stripped = stripComments(source(rel))
      expect(stripped, `${name} contains a banned execution identifier`).not.toMatch(BANNED_EXEC)
    }
  })

  it("the transitive import closure of F1–F5 resolves only to pure/reference modules — never a venues adapter or an execution module", () => {
    const reached = new Set()
    for (const rel of Object.values(MODULES)) {
      for (const abs of reachableFrom(rel)) reached.add(abs)
    }
    const basenames = [...reached].map((p) => p.split(/[\\/]/).pop())
    for (const abs of reached) {
      expect(hasVenueSegment(abs)).toBe(false)
      expect(BANNED_BASENAMES.has(abs.split(/[\\/]/).pop())).toBe(false)
    }
    for (const basename of ["auditTrail.mjs", "analytics.mjs", "u4faRisk.mjs", "leaderIdeasState.mjs", "leaderFeedContract.mjs", "leaderQualification.mjs", "csvFeedImport.mjs", "leaderGuard.mjs"]) {
      expect(basenames).toContain(basename)
    }
  })

  it("the closure's combined stripped source carries no execution identifier (reachability scan)", () => {
    const combined = []
    for (const rel of Object.values(MODULES)) {
      for (const abs of reachableFrom(rel)) combined.push(stripComments(readFileSync(abs, "utf8")))
    }
    expect(combined.join("\n")).not.toMatch(BANNED_EXEC)
  })

  it("none of F1–F5 exports an order-mirroring/execution symbol", async () => {
    const bannedNames = /^(?:placeOrder|mirror|mirrorOrder|copyOrder|copyTrade|submitOrder|createOrder|openOrder|closeOrder|execute\w*)$/i
    for (const rel of Object.values(MODULES)) {
      const names = await exportNamesOf(rel)
      for (const n of names) expect(n).not.toMatch(bannedNames)
    }
  })

  it("the WS-4 handler plumbing imports only the four leader modules and its route window never executes orders", () => {
    const src = source(HANDLERS)
    for (const imp of [
      "./services/commandCentre/leaderIdeasState.mjs",
      "./services/copytrade/csvFeedImport.mjs",
      "./services/copytrade/leaderGuard.mjs",
      "./services/copytrade/leaderFeedContract.mjs"
    ]) {
      expect(src, `handlers must import ${imp}`).toContain(imp)
    }
    const start = src.indexOf('path === "/api/command-centre/leader-ideas/import"')
    const end = src.indexOf('path === "/api/command-centre/kill-switch"')
    const window = src.slice(start, end)
    expect(window).not.toMatch(BANNED_EXEC)
    expect(window).not.toContain("ccxtExecution")
    expect(window).not.toContain("proposeCcxtOrder")
  })
})

describe("WS-4 AC-7 (b) — platformTrust defaults UNVERIFIED and only the trust store-write flips it", () => {
  it("source pin — the store's only UNVERIFIED record literal and single setPlatformTrust writer", () => {
    const src = source(MODULES.leaderIdeasState)
    expect(src).toContain('value: "UNVERIFIED", at: null, by: null, evidence: null')
    expect(src).toContain("platformTrust: existing ? { ...existing.platformTrust } : { ...UNVERIFIED },")
    expect(src).toContain("rec.platformTrust = { value, at, by, evidence }")
    expect((src.match(/export function setPlatformTrust/g) ?? [])).toHaveLength(1)
    expect((src.match(/rec\.platformTrust = /g) ?? [])).toHaveLength(1)
    const importFn = src.slice(src.indexOf("export function importLeaderRecord"), src.indexOf("export function followLeader"))
    expect(importFn).not.toMatch(/["'](?:VERIFIED|ADVERSARIAL)["']/)
  })

  it("source pin — handlers call the trust writer only inside the trusted POST /trust route (auth'd)", () => {
    const src = source(HANDLERS)
    expect(src.match(/leaderSetPlatformTrust\(/g) ?? []).toHaveLength(1)
    const trustIdx = src.indexOf('"/api/command-centre/leader-ideas/trust"')
    const callIdx = src.indexOf("leaderSetPlatformTrust(")
    expect(callIdx).toBeGreaterThan(trustIdx)
    const trustBlock = src.slice(trustIdx, src.indexOf('path === "/api/command-centre/kill-switch"'))
    expect(trustBlock).toContain("requireAuth")
  })

  it("behavior — a fresh import stores UNVERIFIED/null and re-import preserves it; only setPlatformTrust flips", async () => {
    const store = await import("../services/commandCentre/leaderIdeasState.mjs")
    store.importLeaderRecord(
      { id: "leader-1", label: "A", source: "csv", qualification: { verdict: "qualified", deny: null } },
      { now: NOW, audit: () => {} }
    )
    expect(store.findLeader("leader-1").platformTrust).toEqual({ value: "UNVERIFIED", at: null, by: null, evidence: null })
    store.importLeaderRecord(
      { id: "leader-1", label: "B", source: "csv", qualification: { verdict: "qualified", deny: null } },
      { now: NOW, audit: () => {} }
    )
    expect(store.findLeader("leader-1").platformTrust.value).toBe("UNVERIFIED")
    store.setPlatformTrust("leader-1", { value: "VERIFIED", by: "auditor", evidence: "idx-1", now: NOW, audit: () => {} })
    expect(store.findLeader("leader-1").platformTrust.value).toBe("VERIFIED")
    store.importLeaderRecord(
      { id: "leader-1", label: "C", source: "csv", qualification: { verdict: "qualified", deny: null } },
      { now: NOW, audit: () => {} }
    )
    expect(store.findLeader("leader-1").platformTrust).toEqual({
      value: "VERIFIED",
      at: new Date(NOW).toISOString(),
      by: "auditor",
      evidence: "idx-1"
    })
  })

  it("behavior via routes — GET never writes trust; the trust POST is the only writer", async () => {
    const store = await import("../services/commandCentre/leaderIdeasState.mjs")
    store.importLeaderRecord(
      { id: "leader-r", label: "Route Co", source: "csv", lastPositionAt: isoOf(1), qualification: { verdict: "qualified", deny: null }, ideas: [idea(0), idea(1)] },
      { now: NOW, audit: () => {} }
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs")
    const res = await callRoute(handleApi, "GET", "/api/command-centre/leader-ideas")
    expect(res.body.leaders[0].platformTrust.value).toBe("UNVERIFIED")
    const store2 = await import("../services/commandCentre/leaderIdeasState.mjs")
    expect(store2.findLeader("leader-r").platformTrust.value).toBe("UNVERIFIED")
    const post = await callRoute(handleApi, "POST", "/api/command-centre/leader-ideas/trust", { leaderId: "leader-r", value: "VERIFIED", evidence: "idx-9" })
    expect(post.body.platformTrust.value).toBe("VERIFIED")
    const store3 = await import("../services/commandCentre/leaderIdeasState.mjs")
    expect(store3.findLeader("leader-r").platformTrust.value).toBe("VERIFIED")
  })
})

describe("WS-4 AC-7 (c) — qualification floors are the locked defaults with env unset", () => {
  it("the 300/15 floors are exported constants and the qualifier has no env override", async () => {
    const q = await import("../services/copytrade/leaderQualification.mjs")
    expect(q.LEADER_MIN_TRADES).toBe(300)
    expect(q.LEADER_MAX_MDD_PCT).toBe(15)
    expect(source(MODULES.leaderQualification)).not.toContain("process.env")
  })

  it("verbatim deny strings: trades-short 299, mdd-over exactly 15%, expectancy-nonpositive exactly 0", async () => {
    const { qualifyLeader } = await import("../services/copytrade/leaderQualification.mjs")
    expect(qualifyLeader(Array.from({ length: 299 }, () => ({ pnlAfterCosts: 1, closedAt: isoOf(0) })))).toEqual({
      verdict: "denied",
      deny: "leader:deny:trades-short (have 299, require 300)"
    })
    const mddRows = []
    for (let i = 0; i < 250; i += 1) mddRows.push({ pnlAfterCosts: 400, closedAt: isoOf(0) })
    for (let i = 0; i < 50; i += 1) mddRows.push({ pnlAfterCosts: -300, closedAt: isoOf(0) })
    expect(qualifyLeader(mddRows)).toEqual({ verdict: "denied", deny: "leader:deny:mdd-over (have 15%, require <15)" })
    expect(qualifyLeader(Array.from({ length: 300 }, () => ({ pnlAfterCosts: 0, closedAt: isoOf(0) })))).toEqual({
      verdict: "denied",
      deny: "leader:deny:expectancy-nonpositive (have 0)"
    })
  })

  it("guard defaults with env unset: auto-unfollow 21 UTC days and 7-day stop 5% floor", async () => {
    const { autoUnfollow, sevenDayStop } = await import("../services/copytrade/leaderGuard.mjs")
    expect(autoUnfollow({ lastPositionAt: isoOf(22) }, { now: NOW })).toEqual({ active: true, reason: "leader:auto-unfollow:no-positions-21d" })
    expect(autoUnfollow({ lastPositionAt: isoOf(20) }, { now: NOW })).toEqual({ active: false, reason: null })
    const stop = sevenDayStop(
      [
        { id: "s1", closedAt: isoOf(1), pnlAfterCosts: -30 },
        { id: "s2", closedAt: isoOf(2), pnlAfterCosts: -30 }
      ],
      1000,
      { now: NOW }
    )
    expect(stop).toMatchObject({ active: true, reason: "leader:idea-suppressed:7d-stop", lossPct: 6, windowDays: 7 })
  })

  it("a bad env value is a named invalid-environment, never a silently loosened floor", async () => {
    process.env.PICC_LEADER_AUTO_UNFOLLOW_DAYS = "1"
    process.env.PICC_LEADER_7D_STOP_PCT = "1"
    const { autoUnfollow, sevenDayStop } = await import("../services/copytrade/leaderGuard.mjs")
    process.env.PICC_LEADER_AUTO_UNFOLLOW_DAYS = "banana"
    process.env.PICC_LEADER_7D_STOP_PCT = "banana"
    expect(autoUnfollow({ lastPositionAt: isoOf(0) }, { now: NOW }).reason).toBe(
      "leader:deny:invalid-environment (PICC_LEADER_AUTO_UNFOLLOW_DAYS=banana)"
    )
    expect(sevenDayStop([idea(0, { pnlAfterCosts: -60 })], 1000, { now: NOW }).reason).toBe(
      "leader:deny:invalid-environment (PICC_LEADER_7D_STOP_PCT=banana)"
    )
  })
})

describe("WS-4 AC-7 (d) — overview/aggregate compose byte-identical (additive)", () => {
  it("behavior — compose output shape unchanged: ok/at/stream/killSwitch/risk/sites, never a leaders key", async () => {
    const { composeCommandCentreOverview } = await import("../services/commandCentre/commandCentreOverview.mjs")
    const out = composeCommandCentreOverview({ now: NOW })
    expect(out.ok).toBe(true)
    expect(out.at).toBe(new Date(NOW).toISOString())
    expect(out.stream).toBe("all")
    expect(out.killSwitch).toEqual({ global: false, sites: {} })
    expect(out.risk).toBeNull()
    expect(Object.keys(out).sort()).toEqual(["at", "killSwitch", "ok", "risk", "sites", "stream"])
    expect(out.sites).toHaveLength(3)
    expect(out.sites.map((s) => s.site)).toEqual(["trading:ccxt", "expertoption", "trading:perps"])
    for (const row of out.sites) {
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
    }
    expect(out.sites.find((s) => s.site === "trading:ccxt").mode).toBe("COPILOT")
    expect(out.sites.find((s) => s.site === "trading:ccxt").executionPower).toBe("proposals")
  })

  it("source pin — commandCentreOverview.mjs carries no WS-4 symbol and no WS-4 import", () => {
    const src = source(OVERVIEW)
    expect(src).not.toContain("leaderIdeasState")
    expect(src).not.toContain("copytrade")
    expect(src).not.toContain("platformTrust")
    expect(src).not.toContain("autoUnfollow")
    expect(src).not.toContain("sevenDayStop")
    expect(src).not.toContain("hip-stub")
    expect(importSpecifiers(src).some((s) => s.includes("copytrade") || s.includes("leaderIdeas"))).toBe(false)
    expect(src).toContain('const NOT_WIRED = "not-wired — arrives with execution (slice 5+)"')
    expect(src).toContain("export function composeCommandCentreOverview")
  })

  it("source pin — the GET overview handler never consults the leader store", () => {
    const src = source(HANDLERS)
    const start = src.indexOf('path === "/api/command-centre/overview"')
    const end = src.indexOf('path === "/api/command-centre/ceremony"')
    const window = src.slice(start, end)
    expect(window).not.toContain("leaderIdeas")
    expect(window).not.toContain("platformTrust")
    expect(window).not.toContain("setPlatformTrust")
    expect(window).not.toContain("autoUnfollow")
  })
})

describe("WS-4 AC-7 (e) — HIP stub reason exact (D8)", () => {
  it("the HIP_NOT_WIRED constant equals the D8-exact reason string", async () => {
    const { HIP_NOT_WIRED } = await import("../services/copytrade/leaderFeedContract.mjs")
    expect(HIP_NOT_WIRED, `D8 requires ${D8_HIP_EXACT}`).toBe(D8_HIP_EXACT)
  })

  it("the HIP stub fetchIdeas/fetchPositions deny equals the D8-exact reason string", async () => {
    const { hipStub } = await import("../services/copytrade/leaderFeedContract.mjs")
    expect((await hipStub.fetchIdeas("leader-x")).deny, `D8 requires ${D8_HIP_EXACT}`).toBe(D8_HIP_EXACT)
    expect((await hipStub.fetchPositions("leader-x")).deny, `D8 requires ${D8_HIP_EXACT}`).toBe(D8_HIP_EXACT)
  })

  it("a hip-source leader reads out with the D8-exact deny on the source", async () => {
    const store = await import("../services/commandCentre/leaderIdeasState.mjs")
    store.importLeaderRecord(
      { id: "leader-hip", label: "HIP Co", source: "hip", lastPositionAt: isoOf(1), qualification: { verdict: "qualified", deny: null }, ideas: [idea(0)] },
      { now: NOW, audit: () => {} }
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs")
    const res = await callRoute(handleApi, "GET", "/api/command-centre/leader-ideas")
    const l = res.body.leaders.find((x) => x.id === "leader-hip")
    expect(l.deny, `D8 requires ${D8_HIP_EXACT}, got ${l.deny}`).toBe(D8_HIP_EXACT)
    expect(l.ideas).toEqual([])
  })
})

describe("WS-4 AC-7 — risk 2 and risk 3 pins (cost-blind feed, GET read-only)", () => {
  it("risk 2 — a feed that does not account costs can never qualify, regardless of row count", async () => {
    const importer = await import("../services/copytrade/csvFeedImport.mjs")
    const store = await import("../services/commandCentre/leaderIdeasState.mjs")
    const events = []
    const rowsMissingFees = feed300().map((r, i) => (i === 0 ? { ...r, feesUsd: null } : r))
    const missingPnl = feed300().map((r, i) => (i === 1 ? { ...r, pnlAfterCosts: null } : r))
    const a = importer.importLeaderFeed({ label: "A", leaderId: "leader-a", rows: rowsMissingFees }, { now: NOW, audit: (e) => events.push(e) })
    expect(a).toEqual({ ok: false, deny: "leader:deny:costs-unaccounted" })
    const b = importer.importLeaderFeed({ label: "B", leaderId: "leader-b", rows: missingPnl }, { now: NOW, audit: (e) => events.push(e) })
    expect(b).toEqual({ ok: false, deny: "leader:deny:costs-unaccounted" })
    expect(store.listLeaders()).toEqual([])
    expect(events).toEqual([])
  })

  it("risk 3 — GET readout is proven read-only: the store file is byte-identical and not created when absent", async () => {
    const leaderFile = join(dir, "leader-ideas.json")
    expect(existsSync(leaderFile)).toBe(false)
    const store = await import("../services/commandCentre/leaderIdeasState.mjs")
    store.importLeaderRecord(
      { id: "leader-ro", label: "Read Only", source: "csv", lastPositionAt: isoOf(1), qualification: { verdict: "qualified", deny: null }, ideas: [idea(0)] },
      { now: NOW, audit: () => {} }
    )
    const before = readFileSync(leaderFile, "utf8")
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs")
    const r1 = await callRoute(handleApi, "GET", "/api/command-centre/leader-ideas")
    const r2 = await callRoute(handleApi, "GET", "/api/command-centre/leader-ideas")
    const r3 = await callRoute(handleApi, "GET", "/api/command-centre/overview")
    expect(readFileSync(leaderFile, "utf8")).toBe(before)
    expect(r1.body.ok).toBe(true)
    expect(r2.body.leaders[0].id).toBe("leader-ro")
  })
})

function makeReq(method, url, body) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json" },
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

async function callRoute(handleApi, method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}