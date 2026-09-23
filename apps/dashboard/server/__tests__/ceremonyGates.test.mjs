import { afterEach, expect, test, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ENV_VARS = [
  "PICC_CEREMONY_GATE1_MIN_RESOLVES",
  "PICC_CEREMONY_GATE3_STREAK",
  "PICC_CEREMONY_GATE3_RATIO_LO",
  "PICC_CEREMONY_GATE3_RATIO_HI",
  "PICC_CEREMONY_GATE4_TRADING_DAYS"
]

let dir = null

const DAY_MS = 86_400_000
const NOW = Date.UTC(2026, 8, 22, 6, 0, 0)
const WINPROB = 0.62

const row = (over) => ({
  id: 1,
  assetId: "142",
  asset: "EUR / USD",
  provenance: "real",
  result: "hit",
  engine: "legacy",
  expirySec: 60,
  winProb: WINPROB,
  entryTs: NOW,
  ...over
})

const boot = async ({ corrupt = null } = {}) => {
  if (corrupt != null) {
    dir = await mkdtemp(join(tmpdir(), "picc-ceremony-gates-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    await writeFile(join(dir, "ceremony-state.json"), corrupt)
  }
  vi.resetModules()
  const store = await import("../services/commandCentre/ceremonyState.mjs")
  const gates = await import("../services/commandCentre/ceremonyGates.mjs")
  return { store, gates }
}

afterEach(async () => {
  for (const v of ENV_VARS) delete process.env[v]
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  dir = null
  vi.resetModules()
})

const creditRing = (store, { n = 0, hits = 0, winProb = WINPROB, missingRow = -1, venueClass = "ccxt-crypto" } = {}) => {
  store.setAssetClasses({ "142": venueClass })
  const list = []
  for (let i = 0; i < n; i++) {
    list.push(row({ id: i + 1, result: i < hits ? "hit" : "miss", winProb: i === missingRow ? null : winProb }))
  }
  store.creditResolved(list, { now: NOW })
  return store.classState(venueClass)
}

const creditDays = (store, n, { venueClass = "ccxt-crypto" } = {}) => {
  store.setAssetClasses({ "142": venueClass })
  const list = []
  for (let i = 1; i <= n; i++) list.push(row({ id: i, entryTs: NOW + (i - 1) * DAY_MS }))
  store.creditResolved(list, { now: NOW })
  return store.classState(venueClass)
}

const creditBalance = (store, venueClass = "expertoption") => {
  store.setAssetClasses({ "142": venueClass })
  const list = []
  let id = 1
  for (let i = 0; i < 200; i++) {
    list.push(row({ id: id++, engine: "legacy", result: i % 5 === 0 ? "hit" : "miss", winProb: WINPROB, entryTs: NOW + (i % 30) * DAY_MS }))
  }
  for (let i = 0; i < 100; i++) {
    list.push(row({ id: id++, engine: "v3.2", result: i % 5 < 3 ? "hit" : "miss", winProb: WINPROB, entryTs: NOW + (i % 30) * DAY_MS }))
  }
  store.creditResolved(list, { now: NOW })
}

const verifyPlatform = (store, over = {}) =>
  store.setPlatformVerification("expertoption", { verified: true, by: "op", regulator: "reg", payoutFloorPct: 90, withdrawalTested: true, ...over })

// --- gate-3 cases FIRST (spec T4: gate-3/gate-4 listed first) -----------------

test("gate-3 denies on a short streak — the trailing ring has fewer rows than PICC_CEREMONY_GATE3_STREAK", async () => {
  const { store, gates } = await boot()
  const cls = creditRing(store, { n: 30, hits: 20 })
  const g = gates.ceremonyGate3(cls)
  expect(g.pass).toBe(false)
  expect(g.id).toBe("gate3-streak-50-ratio")
  expect(g.reason).toContain("ceremony:deny:streak-short")
  expect(g.reason).toContain("have 30")
  expect(g.reason).toContain("require 50")
})

test("gate-3 denies streak-winprob-missing when any window row lacks a winProb", async () => {
  const { store, gates } = await boot()
  const cls = creditRing(store, { n: 50, hits: 25, missingRow: 49 })
  const g = gates.ceremonyGate3(cls)
  expect(g.pass).toBe(false)
  expect(g.reason).toContain("ceremony:deny:streak-winprob-missing")
})

test("gate-3 denies streak-out-of-band below the low side of the calibration band", async () => {
  const { store, gates } = await boot()
  const cls = creditRing(store, { n: 50, hits: 20 })
  const g = gates.ceremonyGate3(cls)
  expect(g.pass).toBe(false)
  expect(g.reason).toContain("ceremony:deny:streak-out-of-band")
  expect(g.reason).toContain("band [0.7, 1.3]")
})

test("gate-3 denies streak-out-of-band above the high side of the calibration band", async () => {
  const { store, gates } = await boot()
  const cls = creditRing(store, { n: 50, hits: 45 })
  const g = gates.ceremonyGate3(cls)
  expect(g.pass).toBe(false)
  expect(g.reason).toContain("ceremony:deny:streak-out-of-band")
})

test("gate-3 passes when observed/expected sits inside [0.7, 1.3]", async () => {
  const { store, gates } = await boot()
  const cls = creditRing(store, { n: 50, hits: 31 })
  const g = gates.ceremonyGate3(cls)
  expect(g.pass).toBe(true)
  expect(g.reason).toContain("ratio 1")
})

// --- gate-4 cases (trading-day window) ----------------------------------------

test("gate-4 denies days-short below PICC_CEREMONY_GATE4_TRADING_DAYS", async () => {
  const { store, gates } = await boot()
  const cls = creditDays(store, 29)
  expect(cls.tradingDays.length).toBe(29)
  const g = gates.ceremonyGate4(cls)
  expect(g.pass).toBe(false)
  expect(g.id).toBe("gate4-trading-days-30")
  expect(g.reason).toBe("ceremony:deny:days-short (have 29 trading days, require 30)")
})

test("gate-4 passes at 30 distinct trading days (same-day duplicates count once)", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "ccxt-crypto" })
  const list = []
  for (let i = 1; i <= 60; i++) list.push(row({ id: i, entryTs: NOW + (i % 30) * DAY_MS }))
  store.creditResolved(list, { now: NOW })
  const cls = store.classState("ccxt-crypto")
  expect(cls.tradingDays.length).toBe(30)
  const g = gates.ceremonyGate4(cls)
  expect(g.pass).toBe(true)
})

// --- gate-1 constitution floor -------------------------------------------------

test("gate-1 short per class — ccxt-crypto and expertoption each deny below 300", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "ccxt-crypto", "998": "expertoption" })
  const list = []
  for (let i = 1; i <= 10; i++) list.push(row({ id: i, assetId: "142" }))
  for (let i = 11; i <= 20; i++) list.push(row({ id: i, assetId: "998" }))
  store.creditResolved(list, { now: NOW })
  const ccxt = gates.ceremonyGate1(store.classState("ccxt-crypto"))
  const exp = gates.ceremonyGate1(store.classState("expertoption"))
  expect(ccxt.pass).toBe(false)
  expect(ccxt.reason).toBe("ceremony:deny:gate1-short (have 10, require 300)")
  expect(exp.pass).toBe(false)
  expect(exp.reason).toBe("ceremony:deny:gate1-short (have 10, require 300)")
})

test("gate-1 passes at the 300 floor and stays locked at 299", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "ccxt-crypto" })
  const list = []
  for (let i = 1; i <= 299; i++) list.push(row({ id: i }))
  store.creditResolved(list, { now: NOW })
  const short = gates.ceremonyGate1(store.classState("ccxt-crypto"))
  expect(short.pass).toBe(false)
  expect(short.reason).toBe("ceremony:deny:gate1-short (have 299, require 300)")
  store.creditResolved([row({ id: 300 })], { now: NOW })
  const pass = gates.ceremonyGate1(store.classState("ccxt-crypto"))
  expect(pass.pass).toBe(true)
  expect(pass.reason).toContain("300")
})

// --- gate-2 flip gate over the store's byEngine buckets ------------------------

test("gate-2 denies flip-unmet when the store buckets do not meet flipGate (candidate under 100)", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "ccxt-crypto" })
  const list = []
  for (let i = 1; i <= 120; i++) list.push(row({ id: i, engine: "legacy" }))
  for (let i = 121; i <= 170; i++) list.push(row({ id: i, engine: "v3.2" }))
  store.creditResolved(list, { now: NOW })
  const g = gates.ceremonyGate2(store.classState("ccxt-crypto"))
  expect(g.pass).toBe(false)
  expect(g.id).toBe("gate2-flip-gate-100")
  expect(g.reason).toContain("ceremony:deny:flip-unmet")
  expect(g.reason).toContain("candidate under 100 paper trades")
})

test("gate-2 passes with a seeded candidate+legacy pool at ≥100 each and candidate expectancy ≥ legacy", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "ccxt-crypto" })
  const list = []
  for (let i = 1; i <= 100; i++) list.push(row({ id: i, engine: "legacy" }))
  for (let i = 101; i <= 200; i++) list.push(row({ id: i, engine: "v3.2" }))
  store.creditResolved(list, { now: NOW })
  const g = gates.ceremonyGate2(store.classState("ccxt-crypto"))
  expect(g.pass).toBe(true)
  expect(g.reason).toContain("≥ 100 paper trades")
})

// --- evaluateCeremony AND-composition ------------------------------------------

test("evaluateCeremony AND-orders: a gate-1 shortfall stops before any later gate is evaluated", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "ccxt-crypto" })
  const list = []
  for (let i = 1; i <= 10; i++) list.push(row({ id: i }))
  store.creditResolved(list, { now: NOW })
  const res = gates.evaluateCeremony("ccxt-crypto")
  expect(res.ok).toBe(false)
  expect(res.gates).toHaveLength(1)
  expect(res.gates[0].id).toBe("gate1-constitution-300")
  expect(res.gates[0].pass).toBe(false)
  expect(res.gates[0].reason).toContain("ceremony:deny:gate1-short")
  expect(res.spendableResolved).toBe(10)
})

test("evaluateCeremony composes past passes and stops with ONE reason at the first deny", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "ccxt-crypto" })
  const list = []
  for (let i = 1; i <= 300; i++) list.push(row({ id: i, engine: "legacy" }))
  store.creditResolved(list, { now: NOW })
  const res = gates.evaluateCeremony("ccxt-crypto")
  expect(res.ok).toBe(false)
  expect(res.gates.map((g) => g.id)).toEqual(["gate1-constitution-300", "gate2-flip-gate-100"])
  expect(res.gates[0].pass).toBe(true)
  expect(res.gates[1].pass).toBe(false)
  expect(res.gates[1].reason).toContain("ceremony:deny:flip-unmet")
})

// --- platform verification gate (binary-options classes only) -------------------

test("platform gate: a binary-options class with no platformVerification is blocked platform-unverified", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "expertoption" })
  const list = []
  for (let i = 1; i <= 300; i++) list.push(row({ id: i, engine: "legacy" }))
  store.creditResolved(list, { now: NOW })
  const res = gates.evaluateCeremony("expertoption")
  expect(res.ok).toBe(false)
  expect(res.gates).toHaveLength(2)
  expect(res.gates[1].id).toBe("gate-platform-verification-85")
  expect(res.gates[1].pass).toBe(false)
  expect(res.gates[1].reason).toBe("ceremony:deny:platform-unverified")
})

test("platform gate: a verified binary class with payout below the 85 floor is blocked payout-below-floor", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "expertoption" })
  const list = []
  for (let i = 1; i <= 300; i++) list.push(row({ id: i, engine: "legacy" }))
  store.creditResolved(list, { now: NOW })
  verifyPlatform(store, { payoutFloorPct: 80 })
  const res = gates.evaluateCeremony("expertoption")
  expect(res.ok).toBe(false)
  expect(res.gates[1].pass).toBe(false)
  expect(res.gates[1].reason).toBe("ceremony:deny:payout-below-floor")
})

test("platform gate: a verified binary class passes and evaluation proceeds to gate-2", async () => {
  const { store, gates } = await boot()
  store.setAssetClasses({ "142": "expertoption" })
  const list = []
  for (let i = 1; i <= 300; i++) list.push(row({ id: i, engine: "legacy" }))
  store.creditResolved(list, { now: NOW })
  verifyPlatform(store)
  const res = gates.evaluateCeremony("expertoption")
  expect(res.ok).toBe(false)
  expect(res.gates).toHaveLength(3)
  expect(res.gates[1].pass).toBe(true)
  expect(res.gates[2].pass).toBe(false)
  expect(res.gates[2].reason).toContain("ceremony:deny:flip-unmet")
})

test("platform gate: a non-binary class is unaffected — exactly the four core gate ids, never a platform entry", async () => {
  const { store, gates } = await boot()
  creditBalance(store, "ccxt-crypto")
  const res = gates.evaluateCeremony("ccxt-crypto")
  expect(res.ok).toBe(true)
  expect(res.gates.map((g) => g.id)).toEqual([
    "gate1-constitution-300",
    "gate2-flip-gate-100",
    "gate3-streak-50-ratio",
    "gate4-trading-days-30"
  ])
  expect(res.gates.every((g) => g.pass)).toBe(true)
  expect(res.gates.some((g) => g.id.includes("platform"))).toBe(false)
  expect(res.platformVerification).toBe(null)
})

// --- store health + env validation ----------------------------------------------

test("evaluateCeremony: an UNHEALTHY store denies every gate with store-unhealthy, never a pass", async () => {
  const { gates } = await boot({ corrupt: "{\n  \"version\": 1,\n  \"classes\":" })
  for (const venueClass of ["ccxt-crypto", "expertoption"]) {
    const res = gates.evaluateCeremony(venueClass)
    expect(res.ok).toBe(false)
    expect(res.gates).toHaveLength(4)
    expect(res.gates.every((g) => g.pass === false)).toBe(true)
    expect(res.gates.every((g) => g.reason === "ceremony:deny:store-unhealthy")).toBe(true)
    expect(res.spendableResolved).toBe(null)
  }
})

test("invalid env numbers → named invalid-environment deny on the owning gate", async () => {
  const { store, gates } = await boot()
  process.env.PICC_CEREMONY_GATE1_MIN_RESOLVES = "abc"
  const res = gates.evaluateCeremony("ccxt-crypto")
  expect(res.gates[0].pass).toBe(false)
  expect(res.gates[0].id).toBe("gate1-constitution-300")
  expect(res.gates[0].reason).toBe("invalid-environment: PICC_CEREMONY_GATE1_MIN_RESOLVES=abc")
  expect(res.ok).toBe(false)

  process.env.PICC_CEREMONY_GATE3_RATIO_HI = "-1"
  const g3 = gates.ceremonyGate3({ streak: [] })
  expect(g3.pass).toBe(false)
  expect(g3.reason).toBe("invalid-environment: PICC_CEREMONY_GATE3_RATIO_HI=-1")

  process.env.PICC_CEREMONY_GATE4_TRADING_DAYS = "thirty"
  const g4 = gates.ceremonyGate4({ tradingDays: [] })
  expect(g4.pass).toBe(false)
  expect(g4.reason).toBe("invalid-environment: PICC_CEREMONY_GATE4_TRADING_DAYS=thirty")

  process.env.PICC_CEREMONY_GATE3_STREAK = "0"
  const g3zero = gates.ceremonyGate3({ streak: [] })
  expect(g3zero.pass).toBe(false)
  expect(g3zero.reason).toBe("invalid-environment: PICC_CEREMONY_GATE3_STREAK=0")
})

// --- full pass -------------------------------------------------------------------

test("evaluateCeremony full pass on a binary class: gate1 → platform → gate2 → gate3 → gate4 together with the readout fields", async () => {
  const { store, gates } = await boot()
  creditBalance(store, "expertoption")
  const verification = verifyPlatform(store)
  const res = gates.evaluateCeremony("expertoption")
  expect(res.ok).toBe(true)
  expect(res.gates.map((g) => g.id)).toEqual([
    "gate1-constitution-300",
    "gate-platform-verification-85",
    "gate2-flip-gate-100",
    "gate3-streak-50-ratio",
    "gate4-trading-days-30"
  ])
  expect(res.gates.every((g) => g.pass)).toBe(true)
  expect(res.spendableResolved).toBe(300)
  expect(res.scaleResolved).toBe(300)
  expect(res.enablement).toBe(null)
  expect(res.platformVerification).toMatchObject({ verified: true, payoutFloorPct: 90 })
  expect(res.lastCreditAt).toBeTruthy()
  expect(res.gates[4].reason).toContain("30 distinct trading days")
  expect(verification.withdrawalTested).toBe(true)
})