// WS-4 T0 — F1 follower store (WS-4 R1.1 / R1.2). The store mirrors the
// ceremony/risk-store persistence convention (same PICC_COMMAND_CENTRE_DATA_DIR,
// version 1, boot health, canTouchDisk, write-through + audit). It owns the
// leader-ideas.json file and remembers nothing on its own — one leader is ever
// followed by an operator action only.
import { afterEach, expect, test, vi } from "vitest"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const LEADER_FILE = "leader-ideas.json"

let dir = null

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const NOW_ISO = new Date(NOW).toISOString()

const qualified = (over = {}) => ({ verdict: "qualified", deny: null, ...over })

const row = (over = {}) => ({
  id: "i1",
  at: "2026-09-28T14:30:00.000Z",
  asset: "BTC / USD",
  direction: "long",
  sizeUsd: 1000,
  entryPrice: 65000,
  feesUsd: 0,
  pnlAfterCosts: 0,
  closedAt: "2026-09-28T14:30:00.000Z",
  ts: Date.UTC(2026, 8, 28, 14, 30, 0),
  ...over
})

const recordIn = (over = {}) => ({
  id: "leader-1",
  label: "TradeWise Alpha",
  source: "csv",
  lastPositionAt: "2026-09-28T14:30:00.000Z",
  qualification: qualified(),
  ideas: [row()],
  ...over
})

const boot = async ({ corrupt = null, version = null, healthy = null } = {}) => {
  dir = await mkdtemp(join(tmpdir(), "picc-leaders-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  let raw = null
  if (corrupt) raw = corrupt
  else if (version != null) raw = JSON.stringify({ version, leaders: [] }, null, 2)
  else if (healthy != null) raw = JSON.stringify({ version: 1, leaders: [healthy] }, null, 2)
  if (raw != null) await writeFile(join(dir, LEADER_FILE), raw)
  vi.resetModules()
  return import("../services/commandCentre/leaderIdeasState.mjs")
}

const bootMem = async () => {
  vi.resetModules()
  return import("../services/commandCentre/leaderIdeasState.mjs")
}

const restart = async () => {
  vi.resetModules()
  return import("../services/commandCentre/leaderIdeasState.mjs")
}

afterEach(async () => {
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  vi.resetModules()
})

test("fresh boot is healthy, version 1, and defaults to an empty follower set (leaders: [])", async () => {
  const m = await bootMem()
  expect(m.storeHealth()).toEqual({ ok: true })
  const s = m.leaderIdeas()
  expect(s.version).toBe(1)
  expect(s.leaders).toEqual([])
  expect(m.listLeaders()).toEqual([])
})

test("unreadable leader-ideas file → UNHEALTHY; read surfaces null; follow/trust/import all refuse with leader:deny:store-unhealthy; file preserved", async () => {
  const m = await boot({ corrupt: '{\n  "version": 1,\n  "leaders":' })
  expect(m.storeHealth().ok).toBe(false)
  expect(m.storeHealth().reason).toBe("leader-ideas-store-unreadable")
  expect(m.leaderIdeas()).toBeNull()
  expect(m.followLeader("leader-1", { now: NOW })).toEqual({ ok: false, deny: "leader:deny:store-unhealthy" })
  expect(m.setPlatformTrust("leader-1", { value: "VERIFIED", by: "operator", evidence: "idx-1" })).toEqual({
    ok: false,
    deny: "leader:deny:store-unhealthy"
  })
  expect(m.importLeaderRecord(recordIn(), { now: NOW }).ok).toBe(false)
  expect(await readFile(join(dir, LEADER_FILE), "utf8")).toBe('{\n  "version": 1,\n  "leaders":')
})

test("version ≠ 1 → UNHEALTHY version-mismatch; mutations refuse", async () => {
  const m = await boot({ version: 2 })
  expect(m.storeHealth().ok).toBe(false)
  expect(m.storeHealth().reason).toBe("leader-ideas-store-version-mismatch")
  expect(m.importLeaderRecord(recordIn(), { now: NOW }).ok).toBe(false)
  expect(m.followLeader("leader-1", { now: NOW })).toEqual({ ok: false, deny: "leader:deny:store-unhealthy" })
})

test("import stores a full §3.2 record: default platformTrust UNVERIFIED, followedAt null, lastPositionAt, qualification, ideas; updatedAt set", async () => {
  const m = await bootMem()
  const events = []
  const r = m.importLeaderRecord(recordIn(), { now: NOW, audit: (e) => events.push(e) })
  expect(r.ok).toBe(true)
  const rec = m.findLeader("leader-1")
  expect(rec.label).toBe("TradeWise Alpha")
  expect(rec.source).toBe("csv")
  expect(rec.followedAt).toBeNull()
  expect(rec.lastPositionAt).toBe("2026-09-28T14:30:00.000Z")
  expect(rec.platformTrust).toEqual({ value: "UNVERIFIED", at: null, by: null, evidence: null })
  expect(rec.qualification).toEqual(qualified())
  expect(rec.ideas).toEqual([row()])
  expect(rec.updatedAt).toBe(NOW_ISO)
  expect(events.map((e) => e.kind)).toEqual(["leader:import:leader-1"])
  expect(events[0].data).toEqual({ leaderId: "leader-1", label: "TradeWise Alpha", source: "csv", qualification: qualified() })
})

test("a stored record is returned deep-copied: mutating the readout never mutates the store", async () => {
  const m = await bootMem()
  m.importLeaderRecord(recordIn(), { now: NOW, audit: () => {} })
  const rec = m.findLeader("leader-1")
  rec.ideas.push({ id: "junk" })
  rec.platformTrust.value = "ADVERSARIAL"
  expect(m.findLeader("leader-1").ideas).toEqual([row()])
  expect(m.findLeader("leader-1").platformTrust.value).toBe("UNVERIFIED")
})

test("re-import of the same id replaces the feed, preserving platformTrust and followedAt (an import never sets trust/follow), and re-audits", async () => {
  const m = await bootMem()
  const events = []
  const audit = (e) => events.push(e)
  m.importLeaderRecord(recordIn(), { now: NOW, audit })
  m.setPlatformTrust("leader-1", { value: "VERIFIED", by: "auditor", evidence: "reg-register-idx-7", now: NOW, audit })
  m.followLeader("leader-1", { now: NOW, audit })
  const r2 = m.importLeaderRecord(recordIn({ qualification: { verdict: "denied", deny: "leader:deny:trades-short (have 0, require 300)" } }), { now: NOW, audit })
  expect(r2.ok).toBe(true)
  const rec = m.findLeader("leader-1")
  expect(rec.qualification.deny).toBe("leader:deny:trades-short (have 0, require 300)")
  expect(rec.platformTrust).toEqual({ value: "VERIFIED", at: NOW_ISO, by: "auditor", evidence: "reg-register-idx-7" })
  expect(rec.followedAt).toBe(NOW_ISO)
  const kinds = events.filter((e) => e.kind.startsWith("leader:")).map((e) => e.kind)
  expect(kinds.filter((k) => k === "leader:import:leader-1")).toHaveLength(2)
})

test("import is idempotent for the store shape: missing id → leader:deny:import-missing-id; never followed", async () => {
  const m = await bootMem()
  const r = m.importLeaderRecord(recordIn({ id: undefined }), { now: NOW, audit: () => {} })
  expect(r.ok).toBe(false)
  expect(r.deny).toBe("leader:deny:import-missing-id")
  expect(m.listLeaders()).toEqual([])
})

test("follow: unknown leader → leader:deny:unknown-leader; unqualified leader → leader:deny:not-qualified; never followed", async () => {
  const m = await bootMem()
  expect(m.followLeader("nope", { now: NOW })).toEqual({ ok: false, deny: "leader:deny:unknown-leader" })
  m.importLeaderRecord(recordIn({ qualification: { verdict: "denied", deny: "leader:deny:trades-short (have 0, require 300)" } }), { now: NOW, audit: () => {} })
  expect(m.followLeader("leader-1", { now: NOW })).toEqual({ ok: false, deny: "leader:deny:not-qualified" })
  expect(m.findLeader("leader-1").followedAt).toBeNull()
})

test("follow: qualified leader → followedAt = now ISO, persisted + audited leader:follow:{id}", async () => {
  const m = await bootMem()
  const events = []
  m.importLeaderRecord(recordIn(), { now: NOW, audit: (e) => events.push(e) })
  const r = m.followLeader("leader-1", { now: NOW, audit: (e) => events.push(e) })
  expect(r.ok).toBe(true)
  expect(m.findLeader("leader-1").followedAt).toBe(NOW_ISO)
  expect(events[events.length - 1]).toEqual({ kind: "leader:follow:leader-1", data: { leaderId: "leader-1", at: NOW_ISO } })
})

test("follow on an already-followed leader is a no-op (no transition, no re-audit)", async () => {
  const m = await bootMem()
  const events = []
  const audit = (e) => events.push(e)
  m.importLeaderRecord(recordIn(), { now: NOW, audit })
  m.followLeader("leader-1", { now: NOW, audit })
  const r = m.followLeader("leader-1", { now: Date.UTC(2026, 9, 2, 12, 0, 0), audit })
  expect(r.ok).toBe(true)
  expect(m.findLeader("leader-1").followedAt).toBe(NOW_ISO)
  expect(events.filter((e) => e.kind === "leader:follow:leader-1")).toHaveLength(1)
})

test("trust: invalid value → leader:deny:invalid-trust-value; missing evidence → leader:deny:trust-evidence-required; now ranked exactly", async () => {
  const m = await bootMem()
  m.importLeaderRecord(recordIn(), { now: NOW, audit: () => {} })
  expect(m.setPlatformTrust("leader-1", { value: "MAYBE", by: "operator", evidence: "x" })).toEqual({ ok: false, deny: "leader:deny:invalid-trust-value" })
  expect(m.setPlatformTrust("leader-1", { value: "VERIFIED", by: "operator", evidence: "" })).toEqual({ ok: false, deny: "leader:deny:trust-evidence-required" })
  expect(m.findLeader("leader-1").platformTrust.value).toBe("UNVERIFIED")
})

test("trust: operator store-write VERIFIED/ADVERSARIAL persists at/by/evidence and audits leader:trust:{id}; only a store-write flips it", async () => {
  const m = await bootMem()
  const events = []
  const audit = (e) => events.push(e)
  m.importLeaderRecord(recordIn(), { now: NOW, audit })
  const r = m.setPlatformTrust("leader-1", { value: "VERIFIED", by: "auditor", evidence: "reg-register-idx-7", now: NOW, audit })
  expect(r.ok).toBe(true)
  expect(r.platformTrust).toEqual({ value: "VERIFIED", at: NOW_ISO, by: "auditor", evidence: "reg-register-idx-7" })
  const r2 = m.setPlatformTrust("leader-1", { value: "ADVERSARIAL", by: "auditor", evidence: "fraud-review-3", now: NOW, audit })
  expect(r2.platformTrust.value).toBe("ADVERSARIAL")
  expect(events.map((e) => e.kind)).toEqual(["leader:import:leader-1", "leader:trust:leader-1", "leader:trust:leader-1"])
})

test("trust: UNVERIFIED re-write is a silent no-op (never audited)", async () => {
  const m = await bootMem()
  const events = []
  const audit = (e) => events.push(e)
  m.importLeaderRecord(recordIn(), { now: NOW, audit })
  m.setPlatformTrust("leader-1", { value: "UNVERIFIED", by: "operator", evidence: "x", now: NOW, audit })
  expect(events.map((e) => e.kind)).toEqual(["leader:import:leader-1"])
  expect(m.findLeader("leader-1").platformTrust).toEqual({ value: "UNVERIFIED", at: null, by: null, evidence: null })
})

test("persistence: import survives a restart from the same data dir", async () => {
  const m = await boot({})
  m.importLeaderRecord(recordIn(), { now: NOW, audit: () => {} })
  const m2 = await restart()
  const rec = m2.findLeader("leader-1")
  expect(rec.label).toBe("TradeWise Alpha")
  expect(rec.qualification).toEqual(qualified())
  expect(rec.platformTrust).toEqual({ value: "UNVERIFIED", at: null, by: null, evidence: null })
})

test("a persisted leader record is hydrated with defaults when fields are sparse", async () => {
  const sparse = { id: "leader-9", label: "Sparse", source: "manual", qualification: qualified() }
  const m = await boot({ healthy: sparse })
  expect(m.storeHealth()).toEqual({ ok: true })
  const rec = m.findLeader("leader-9")
  expect(rec.followedAt).toBeNull()
  expect(rec.lastPositionAt).toBeNull()
  expect(rec.platformTrust).toEqual({ value: "UNVERIFIED", at: null, by: null, evidence: null })
  expect(rec.ideas).toEqual([])
})

test("resetLeaderIdeasState wipes to a healthy empty store and persists (test seam)", async () => {
  const m = await boot({})
  m.importLeaderRecord(recordIn(), { now: NOW, audit: () => {} })
  m.resetLeaderIdeasState()
  expect(m.storeHealth()).toEqual({ ok: true })
  expect(m.listLeaders()).toEqual([])
  const m2 = await restart()
  expect(m2.leaderIdeas().leaders).toEqual([])
})

test("VITEST memory mode writes no file and still serves the store", async () => {
  const m = await bootMem()
  m.importLeaderRecord(recordIn(), { now: NOW, audit: () => {} })
  expect(m.findLeader("leader-1").id).toBe("leader-1")
  const dataDir = process.env.PICC_COMMAND_CENTRE_DATA_DIR
  expect(dataDir).toBeUndefined()
  expect(existsSync(join(process.cwd(), "server", "services", "data", LEADER_FILE))).toBe(false)
})