import { afterEach, expect, test, vi } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CEREMONY_FILE = "ceremony-state.json"

let dir = null

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0)
const NEXT_DAY = Date.UTC(2026, 8, 23, 12, 0, 0)
const DAY1 = "2026-09-22"
const DAY2 = "2026-09-23"

const row = (over) => ({
  id: 1,
  assetId: "142",
  asset: "EUR / USD",
  provenance: "real",
  result: "hit",
  engine: "legacy",
  expirySec: 60,
  winProb: 0.62,
  entryTs: NOW,
  ...over
})

const boot = async ({ corrupt = null, version = null } = {}) => {
  dir = await mkdtemp(join(tmpdir(), "picc-ceremony-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  let raw = null
  if (corrupt) raw = corrupt
  else if (version != null) raw = JSON.stringify({ version, classes: {} }, null, 2)
  if (raw != null) await writeFile(join(dir, CEREMONY_FILE), raw)
  vi.resetModules()
  return import("../services/commandCentre/ceremonyState.mjs")
}

const bootMem = async () => {
  vi.resetModules()
  return import("../services/commandCentre/ceremonyState.mjs")
}

const restart = async () => {
  vi.resetModules()
  return import("../services/commandCentre/ceremonyState.mjs")
}

afterEach(async () => {
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  vi.resetModules()
})

test("fresh boot is healthy, version 1, defaults: enablement null per class, expertoption platform record null, assetClasses empty", async () => {
  const m = await bootMem()
  expect(m.storeHealth()).toEqual({ ok: true })
  const s = m.ceremonyState()
  expect(s.version).toBe(1)
  expect(s.classes).toEqual({})
  expect(m.enablement()).toEqual({ "ccxt-crypto": null, "hyperliquid-perps": null, "expertoption": null })
  expect(m.platformVerification()).toEqual({ expertoption: null })
  expect(m.assetClasses()).toEqual({})
})

test("unreadable ceremony state file → UNHEALTHY; mutations refuse; enablement reads locked; file preserved", async () => {
  const m = await boot({ corrupt: "{\n  \"version\": 1,\n  \"classes\":" })
  expect(m.storeHealth().ok).toBe(false)
  expect(m.storeHealth().reason).toBe("ceremony-state-store-unreadable")
  const r = m.creditResolved([row()], { now: NOW })
  expect(r.ok).toBe(false)
  expect(r.reason).toBe("ceremony-state-store-unreadable")
  expect(m.enablement()).toEqual({ locked: true, reason: "ceremony-state-store-unreadable" })
  expect(m.enablementFor("ccxt-crypto")).toEqual({ locked: true, reason: "ceremony-state-store-unreadable" })
  expect(() => m.unlockVenueClass("ccxt-crypto", "t", { now: NOW })).toThrow(/ceremony-state-store-unreadable/)
  expect(() => m.setPlatformVerification("expertoption", { verified: true })).toThrow(/ceremony-state-store-unreadable/)
  expect(() => m.setAssetClasses({})).toThrow(/ceremony-state-store-unreadable/)
  expect(await readFile(join(dir, CEREMONY_FILE), "utf8")).toBe("{\n  \"version\": 1,\n  \"classes\":")
})

test("version ≠ 1 → UNHEALTHY version-mismatch; enablement reads locked; never unlocks", async () => {
  const m = await boot({ version: 2 })
  expect(m.storeHealth().ok).toBe(false)
  expect(m.storeHealth().reason).toBe("ceremony-state-store-version-mismatch")
  expect(m.enablement()).toEqual({ locked: true, reason: "ceremony-state-store-version-mismatch" })
  expect(m.creditResolved([row()], { now: NOW }).ok).toBe(false)
})

test("a real+classed row is credited: spendableResolved, windowOpenedAt, lastCreditAt, tradingDays", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  const r = m.creditResolved([row({ id: 7 })], { now: NOW })
  expect(r.ok).toBe(true)
  expect(r.credited).toEqual([{ ledgerSeq: 7, venueClass: "ccxt-crypto", verdict: "hit", dayKey: DAY1 }])
  expect(r.denied).toEqual([])
  const cs = m.classState("ccxt-crypto")
  expect(cs.spendableResolved).toBe(1)
  expect(cs.windowOpenedAt).toBe(new Date(NOW).toISOString())
  expect(cs.lastCreditAt).toBe(new Date(NOW).toISOString())
  expect(cs.tradingDays).toEqual([DAY1])
})

test("decided rows incl. push bump spendableResolved; pushes are excluded from byEngine and streak (correctlyAnswered semantics)", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  const r = m.creditResolved([row({ id: 1, result: "hit" }), row({ id: 2, result: "miss" }), row({ id: 3, result: "push" })], { now: NOW })
  expect(r.credited).toHaveLength(3)
  const cs = m.classState("ccxt-crypto")
  expect(cs.spendableResolved).toBe(3)
  expect(cs.byEngine).toEqual({ legacy: { "60": { hits: 1, misses: 1, total: 2 } } })
  expect(cs.streak.map((e) => e.result)).toEqual(["hit", "miss"])
})

test("hit/miss bucket byEngine by engine and expiry; engine defaults to legacy; totals mirror push exclusion", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto", "BTC": "ccxt-crypto" })
  m.creditResolved(
    [
      row({ id: 1, result: "hit", engine: "legacy", expirySec: 60 }),
      row({ id: 2, result: "hit", engine: "v3.2", expirySec: 120, assetId: "BTC" }),
      row({ id: 3, result: "miss", engine: "v3.2", expirySec: 120, assetId: "BTC" }),
      row({ id: 4, result: "push", engine: "legacy", expirySec: 60 })
    ],
    { now: NOW }
  )
  const cs = m.classState("ccxt-crypto")
  expect(cs.spendableResolved).toBe(4)
  expect(cs.byEngine).toEqual({
    legacy: { "60": { hits: 1, misses: 0, total: 1 } },
    "v3.2": { "120": { hits: 1, misses: 1, total: 2 } }
  })
  expect(cs.streak).toHaveLength(3)
})

test("streak ring is capped at 50 and keeps the newest hit/miss rows", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  const list = []
  for (let i = 1; i <= 60; i++) list.push(row({ id: i }))
  m.creditResolved(list, { now: NOW })
  const cs = m.classState("ccxt-crypto")
  expect(cs.spendableResolved).toBe(60)
  expect(cs.streak).toHaveLength(50)
  expect(cs.streak[0].ledgerSeq).toBe(11)
  expect(cs.streak[49].ledgerSeq).toBe(60)
})

test("tradingDays holds distinct UTC dayKeys (one per day, duplicates never repeat)", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  m.creditResolved(
    [
      row({ id: 1, entryTs: NOW }),
      row({ id: 2, entryTs: NOW + 60_000 }),
      row({ id: 3, entryTs: NEXT_DAY }),
      row({ id: 4, entryTs: NEXT_DAY + 60_000 })
    ],
    { now: NOW }
  )
  const cs = m.classState("ccxt-crypto")
  expect(cs.tradingDays).toEqual([DAY1, DAY2])
  expect(cs.spendableResolved).toBe(4)
})

test("sim rows are never credited and record the named sim-row denial", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  const r = m.creditResolved([row({ id: 9, provenance: "sim" }), row({ id: 10 })], { now: NOW })
  expect(r.credited).toHaveLength(1)
  expect(r.credited[0].ledgerSeq).toBe(10)
  expect(r.denied).toEqual([{ seq: 9, reason: "ceremony:deny:sim-row" }])
  expect(m.recentDenials().some((d) => d.reason === "ceremony:deny:sim-row" && d.seq === 9)).toBe(true)
  expect(m.classState("ccxt-crypto").spendableResolved).toBe(1)
})

test("untagged rows are never credited: empty map and an asset absent from a populated map both name untagged-class", async () => {
  const mEmpty = await bootMem()
  const rEmpty = mEmpty.creditResolved([row({ id: 1 })], { now: NOW })
  expect(rEmpty.credited).toEqual([])
  expect(rEmpty.denied).toEqual([{ seq: 1, reason: "ceremony:deny:untagged-class" }])

  const mPop = await bootMem()
  mPop.setAssetClasses({ "142": "ccxt-crypto" })
  const rPop = mPop.creditResolved([row({ id: 2, assetId: "999" })], { now: NOW })
  expect(rPop.credited).toEqual([])
  expect(rPop.denied).toEqual([{ seq: 2, reason: "ceremony:deny:untagged-class" }])
  expect(mPop.classState("ccxt-crypto")).toBe(null)
})

test("enablement: default null for every class; the credit path never writes it; only a ceremony write unlocks", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  m.creditResolved([row({ id: 1 })], { now: NOW })
  expect(m.enablement()).toEqual({ "ccxt-crypto": null, "hyperliquid-perps": null, "expertoption": null })
  expect(m.enablementFor("ccxt-crypto")).toBe(null)
  const rec = m.unlockVenueClass("hyperliquid-perps", "owner-1", { now: NOW })
  expect(rec).toEqual({ unlocked: true, at: new Date(NOW).toISOString(), by: "owner-1" })
  expect(m.enablementFor("hyperliquid-perps")).toEqual(rec)
  expect(m.enablementFor("ccxt-crypto")).toBe(null)
  expect(m.classState("ccxt-crypto").spendableResolved).toBe(1)
})

test("unlockVenueClass refuses outside VITEST with a ceremony-action-direct deny and rejects unknown classes", async () => {
  const m = await bootMem()
  const prev = process.env.VITEST
  try {
    process.env.VITEST = "false"
    expect(() => m.unlockVenueClass("ccxt-crypto", "x", { now: NOW })).toThrow(/ceremony:deny:ceremony-action-unreachable/)
    expect(m.enablementFor("ccxt-crypto")).toBe(null)
  } finally {
    process.env.VITEST = prev
  }
  expect(() => m.unlockVenueClass("mystery", "x", { now: NOW })).toThrow(/ceremony:reject:unknown-venue-class/)
})

test("platformVerification: default null; a deliberate write records the full evidence record", async () => {
  const m = await bootMem()
  expect(m.platformVerification().expertoption).toBe(null)
  const rec = m.setPlatformVerification("expertoption", {
    verified: true,
    by: "operator-a",
    regulator: "public-register-42",
    payoutFloorPct: 90,
    withdrawalTested: true
  })
  expect(rec.verified).toBe(true)
  expect(rec.by).toBe("operator-a")
  expect(rec.regulator).toBe("public-register-42")
  expect(rec.payoutFloorPct).toBe(90)
  expect(rec.withdrawalTested).toBe(true)
  expect(rec.at).toBeTruthy()
  expect(m.platformVerification().expertoption).toMatchObject({ verified: true, payoutFloorPct: 90 })
})

test("platformVerification flags payoutFloorPct below 85 as payoutUnderFloor and stays clean at/above 85", async () => {
  const m = await bootMem()
  const low = m.setPlatformVerification("expertoption", { verified: true, payoutFloorPct: 80, by: "op" })
  expect(low.payoutUnderFloor).toBe(true)
  const high = m.setPlatformVerification("expertoption", { verified: true, payoutFloorPct: 92, by: "op" })
  expect(high.payoutUnderFloor).toBe(false)
  expect(m.platformVerification().expertoption.payoutFloorPct).toBe(92)
})

test("platformVerification: unknown venue-class and malformed records are named rejects", async () => {
  const m = await bootMem()
  expect(() => m.setPlatformVerification("mystery", { verified: true })).toThrow(/ceremony:reject:unknown-venue-class/)
  expect(() => m.setPlatformVerification("expertoption", { verified: false })).toThrow(/ceremony:reject:malformed-platform-verification/)
  expect(() => m.setPlatformVerification("expertoption", { verified: true, payoutFloorPct: "high" })).toThrow(/ceremony:reject:malformed-platform-verification/)
  expect(m.platformVerification().expertoption).toBe(null)
})

test("assetClasses: unknown asset keys and unknown venue-class values are named rejects; valid map round-trips", async () => {
  const m = await bootMem()
  expect(() => m.setAssetClasses({ "": "ccxt-crypto" })).toThrow(/ceremony:reject:unknown-asset/)
  expect(() => m.setAssetClasses(null)).toThrow(/ceremony:reject:malformed-asset-classes/)
  expect(() => m.setAssetClasses({ "142": "mystery" })).toThrow(/ceremony:reject:unknown-venue-class/)
  const ok = m.setAssetClasses({ "142": "ccxt-crypto", "BTC": "hyperliquid-perps" })
  expect(ok).toEqual({ "142": "ccxt-crypto", "BTC": "hyperliquid-perps" })
  expect(m.assetClasses()).toEqual({ "142": "ccxt-crypto", "BTC": "hyperliquid-perps" })
})

test("the store survives a re-boot: credits, unlock, verification and the asset map persist to ceremony-state.json", async () => {
  const m1 = await boot()
  m1.setAssetClasses({ "142": "ccxt-crypto" })
  m1.creditResolved(
    [
      row({ id: 1, entryTs: NOW }),
      row({ id: 2, entryTs: NOW }),
      row({ id: 3, result: "miss", entryTs: NEXT_DAY })
    ],
    { now: NOW }
  )
  m1.unlockVenueClass("hyperliquid-perps", "owner-1", { now: NOW })
  m1.setPlatformVerification("expertoption", { verified: true, by: "op", regulator: "reg", payoutFloorPct: 88, withdrawalTested: true })

  const m2 = await restart()
  expect(m2.storeHealth()).toEqual({ ok: true })
  expect(m2.ceremonyState().version).toBe(1)
  const cs = m2.classState("ccxt-crypto")
  expect(cs.spendableResolved).toBe(3)
  expect(cs.windowOpenedAt).toBe(new Date(NOW).toISOString())
  expect(cs.tradingDays).toEqual([DAY1, DAY2])
  expect(cs.byEngine).toEqual({ legacy: { "60": { hits: 2, misses: 1, total: 3 } } })
  expect(cs.streak).toHaveLength(3)
  expect(m2.enablementFor("hyperliquid-perps")).toMatchObject({ unlocked: true, by: "owner-1" })
  expect(m2.enablementFor("ccxt-crypto")).toBe(null)
  expect(m2.platformVerification().expertoption).toMatchObject({ verified: true, payoutFloorPct: 88, withdrawalTested: true, payoutUnderFloor: false })
  expect(m2.assetClasses()).toEqual({ "142": "ccxt-crypto" })
  const onDisk = JSON.parse(await readFile(join(dir, CEREMONY_FILE), "utf8"))
  expect(onDisk.version).toBe(1)
  expect(onDisk.classes["ccxt-crypto"].spendableResolved).toBe(3)
})

test("resetCeremonyState wipes in-memory state and the file", async () => {
  const m = await boot()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  m.creditResolved([row({ id: 1 })], { now: NOW })
  m.unlockVenueClass("ccxt-crypto", "owner", { now: NOW })
  expect(m.classState("ccxt-crypto").spendableResolved).toBe(1)
  m.resetCeremonyState()
  expect(m.classState("ccxt-crypto")).toBe(null)
  expect(m.enablement()).toEqual({ "ccxt-crypto": null, "hyperliquid-perps": null, "expertoption": null })
  expect(m.assetClasses()).toEqual({})
  expect(m.platformVerification()).toEqual({ expertoption: null })
  expect(m.ceremonyState().version).toBe(1)
  const onDisk = JSON.parse(await readFile(join(dir, CEREMONY_FILE), "utf8"))
  expect(onDisk.classes).toEqual({})
  expect(onDisk.assetClasses).toEqual({})
})

test("self-wire: the resolve consumer is registered on the ledger and ledger flushes credit the store", async () => {
  const dir2 = await mkdtemp(join(tmpdir(), "picc-ceremony-wire-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir2
  vi.resetModules()
  dir = dir2
  const m = await import("../services/commandCentre/ceremonyState.mjs")
  const led = await import("../services/accuracyLedger.mjs")
  expect(m.resolveConsumerWired()).toBe(true)
  led.resetLedger()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  const base = Date.now()
  const mk = (extra = {}) => {
    const e = led.recordDecision({ assetId: "142", asset: "EUR / USD", verdict: "TRADE", direction: "up", expiry: 60, winProb: 0.62, ...extra })
    e.entryPrice = 100
    e.entryTs = base - 90_000
    e.expiresAt = base - 30_000
    return e
  }
  mk({ direction: "up" })
  mk({ direction: "down" })
  led.flushLedger({ now: base, resolve: () => 105 })
  const cs = m.classState("ccxt-crypto")
  expect(cs.spendableResolved).toBe(2)
  expect(cs.byEngine).toEqual({ legacy: { "60": { hits: 1, misses: 1, total: 2 } } })
})

test("reconcileWithLedger: credits match the live ledger, missing credits are mismatches, store-only credits are listed not flagged", async () => {
  const m = await bootMem()
  m.setAssetClasses({ "142": "ccxt-crypto" })
  const rows = [row({ id: 1 }), row({ id: 2, result: "miss" }), row({ id: 3, result: "push" })]
  m.creditResolved(rows, { now: NOW })
  const clean = m.reconcileWithLedger(rows)
  expect(clean.ok).toBe(true)
  expect(clean.seen).toBe(3)
  expect(clean.credited).toEqual([
    { ledgerSeq: 1, venueClass: "ccxt-crypto", verdict: "hit" },
    { ledgerSeq: 2, venueClass: "ccxt-crypto", verdict: "miss" },
    { ledgerSeq: 3, venueClass: "ccxt-crypto", verdict: "push" }
  ])
  expect(clean.mismatches).toEqual([])

  const stale = m.reconcileWithLedger([...rows, row({ id: 4, result: "hit", entryTs: NEXT_DAY })])
  expect(stale.ok).toBe(false)
  expect(stale.mismatches).toEqual([{ type: "expected-credit-missing", ledgerSeq: 4, venueClass: "ccxt-crypto", verdict: "hit" }])

  const gone = m.reconcileWithLedger([])
  expect(gone.ok).toBe(true)
  expect(gone.mismatches).toEqual([])
  expect(new Set(gone.persistedOnly.map((p) => p.ledgerSeq))).toEqual(new Set([1, 2, 3]))
})