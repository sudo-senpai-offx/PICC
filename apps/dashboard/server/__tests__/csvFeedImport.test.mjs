// WS-4 T3 — F4 CSV/JSON importer (WS-4 R3.2/R3.3/AC-3). Parse → validate rows
// against the R2.1 shape → reject cost-unaccounted feeds → run qualification →
// write store + audit leader:import:{id}. A feed that does not account costs can
// never qualify; an import NEVER sets platformTrust and NEVER marks anything
// followed; re-import re-evaluates.
import { afterEach, expect, test, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir = null

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)

const row = (i, over = {}) => ({
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

const feed300 = () => Array.from({ length: 300 }, (_, i) => row(i))

let importer = null
let store = null

const boot = async () => {
  dir = await mkdtemp(join(tmpdir(), "picc-import-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  vi.resetModules()
  importer = await import("../services/copytrade/csvFeedImport.mjs")
  store = await import("../services/commandCentre/leaderIdeasState.mjs")
}

afterEach(async () => {
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  vi.resetModules()
})

test("a valid 300-trade feed lands the store as qualified + audits leader:import:{id}", async () => {
  await boot()
  const events = []
  const r = importer.importLeaderFeed({ label: "TradeWise Alpha", source: "csv", rows: feed300() }, { now: NOW, audit: (e) => events.push(e) })
  expect(r.ok).toBe(true)
  expect(r.leaderId).toBe("leader-tradewise-alpha")
  expect(r.qualification).toEqual({ verdict: "qualified", deny: null })
  const rec = store.findLeader("leader-tradewise-alpha")
  expect(rec.label).toBe("TradeWise Alpha")
  expect(rec.source).toBe("csv")
  expect(rec.qualification.verdict).toBe("qualified")
  expect(rec.ideas).toHaveLength(300)
  expect(events.map((e) => e.kind)).toEqual(["leader:import:leader-tradewise-alpha"])
})

test("an explicit leaderId (re-import target) is honored, label/source pass through, lastPositionAt rides the max closedAt", async () => {
  await boot()
  const events = []
  const rows = [
    row(0, { id: "a", closedAt: "2026-09-10T10:00:00.000Z", at: "2026-09-09T10:00:00.000Z" }),
    row(1, { id: "b", closedAt: "2026-09-12T10:00:00.000Z", at: "2026-09-11T10:00:00.000Z" }),
    row(2, { id: "c", closedAt: "2026-09-11T10:00:00.000Z", at: "2026-09-10T10:00:00.000Z" })
  ]
  const r = importer.importLeaderFeed({ label: "Signal Co", source: "manual", leaderId: "leader-7", rows }, { now: NOW, audit: (e) => events.push(e) })
  expect(r.ok).toBe(true)
  expect(r.leaderId).toBe("leader-7")
  const rec = store.findLeader("leader-7")
  expect(rec.source).toBe("manual")
  expect(rec.lastPositionAt).toBe("2026-09-12T10:00:00.000Z")
  expect(events.some((e) => e.kind === "leader:import:leader-7")).toBe(true)
})

test("row missing feesUsd → leader:deny:costs-unaccounted; feed rejected; store unchanged; no audit", async () => {
  await boot()
  const events = []
  const rows = [row(0), row(1, { feesUsd: undefined }), ...feed300().slice(2)]
  const r = importer.importLeaderFeed({ label: "A", rows }, { now: NOW, audit: (e) => events.push(e) })
  expect(r).toEqual({ ok: false, deny: "leader:deny:costs-unaccounted" })
  expect(store.listLeaders()).toEqual([])
  expect(events).toEqual([])
})

test("row with null pnlAfterCosts → leader:deny:costs-unaccounted (costs must be accounted before qualification)", async () => {
  await boot()
  const r = importer.importLeaderFeed({ label: "B", rows: feed300().map((x, i) => (i === 0 ? { ...x, pnlAfterCosts: null } : x)) }, { now: NOW })
  expect(r).toEqual({ ok: false, deny: "leader:deny:costs-unaccounted" })
  expect(store.listLeaders()).toEqual([])
})

test("unknown asset id → leader:deny:unknown-asset (never a silent skip)", async () => {
  await boot()
  const r = importer.importLeaderFeed({ label: "C", rows: [row(0, { asset: "   " }), ...feed300().slice(1)] }, { now: NOW })
  expect(r).toEqual({ ok: false, deny: "leader:deny:unknown-asset" })
  expect(store.listLeaders()).toEqual([])
})

test("malformed row (missing id) → leader:deny:malformed-row; store unchanged", async () => {
  await boot()
  const r = importer.importLeaderFeed({ label: "D", rows: [row(0, { id: undefined }), ...feed300().slice(1)] }, { now: NOW })
  expect(r).toEqual({ ok: false, deny: "leader:deny:malformed-row" })
  expect(store.listLeaders()).toEqual([])
})

test("non-array rows / empty feed → named denies; store unchanged", async () => {
  await boot()
  expect(importer.importLeaderFeed({ label: "E", rows: "nope" }, { now: NOW })).toEqual({ ok: false, deny: "leader:deny:malformed-feed" })
  expect(importer.importLeaderFeed({ label: "F", rows: [] }, { now: NOW })).toEqual({ ok: false, deny: "leader:deny:empty-feed" })
  expect(store.listLeaders()).toEqual([])
})

test("an import NEVER sets platformTrust and NEVER marks anything followed", async () => {
  await boot()
  importer.importLeaderFeed({ label: "G", leaderId: "leader-g", rows: feed300() }, { now: NOW })
  const rec = store.findLeader("leader-g")
  expect(rec.followedAt).toBeNull()
  expect(rec.platformTrust).toEqual({ value: "UNVERIFIED", at: null, by: null, evidence: null })
  store.setPlatformTrust("leader-g", { value: "VERIFIED", by: "auditor", evidence: "reg-idx-1", now: NOW })
  store.followLeader("leader-g", { now: NOW })
  importer.importLeaderFeed({ label: "G2", leaderId: "leader-g", rows: feed300() }, { now: NOW })
  const rec2 = store.findLeader("leader-g")
  expect(rec2.platformTrust).toEqual({ value: "VERIFIED", at: new Date(NOW).toISOString(), by: "auditor", evidence: "reg-idx-1" })
  expect(rec2.followedAt).toBe(new Date(NOW).toISOString())
})

test("re-import re-evaluates: a short feed overwrites a previously qualified leader with the trades-short deny", async () => {
  await boot()
  const r1 = importer.importLeaderFeed({ label: "H", leaderId: "leader-h", rows: feed300() }, { now: NOW })
  expect(r1.qualification.verdict).toBe("qualified")
  const r2 = importer.importLeaderFeed({ label: "H", leaderId: "leader-h", rows: [row(0), row(1)] }, { now: NOW })
  expect(r2.qualification).toEqual({ verdict: "denied", deny: "leader:deny:trades-short (have 2, require 300)" })
  expect(store.findLeader("leader-h").qualification).toEqual(r2.qualification)
  expect(store.findLeader("leader-h").ideas).toHaveLength(2)
})

test("a feed that nets positive after costs qualifies and the auditor chain stays intact across two imports", async () => {
  await boot()
  const events = []
  const r1 = importer.importLeaderFeed({ label: "I", rows: feed300() }, { now: NOW, audit: (e) => events.push(e) })
  expect(r1.ok).toBe(true)
  const r2 = importer.importLeaderFeed({ label: "I2", rows: [row(0), row(1)] }, { now: NOW, audit: (e) => events.push(e) })
  expect(r2.ok).toBe(true)
  expect(events.map((e) => e.kind)).toEqual(["leader:import:leader-i", "leader:import:leader-i2"])
})