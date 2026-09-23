// WS-3 (T8) no-regression seam guard — pins the validation & unlock ceremony
// contract (spec §8.2 / AC-8) at SOURCE level (real files read from disk) and
// BEHAVIOR level (fresh-module imports under temp-dir fixtures), mirroring
// ws2RiskSeamGuard.test.mjs + ceremonyVenueUnlock.test.mjs:
//   (a) credit path pins the R2.1 honesty contract — a live ledger flush
//       through the T2 resolve-consumer seam credits store counters ONLY for
//       real-provenance rows whose asset is classed; sim rows and untagged
//       assets are NAMED denies (ceremony:deny:sim-row / untagged-class).
//   (b) the perps mainnet branch stays unreachable without a store unlock:
//       PICC_CCXT_PERPS_MAINNET_ENABLED=1 against a locked/absent/unhealthy
//       store returns the EXACT RAIL_OFF_TESTNET_ONLY string at
//       hyperliquidPerps.mjs:57 (source-pinned); a fixture-store unlock is the
//       ONLY way the branch proceeds.
//   (c) the gate floors resolve from ceremonyGates ENV_DEFAULTS with env UNSET:
//       gate1 300, gate3 streak 50 + ratio band [0.7, 1.3], gate4 30 trading
//       days, binary payout floor 85. PICC_CEREMONY_SCALE_MIN_RESOLVES is NOT
//       read by any server gate (scaleResolved is a pure readout) — the 500
//       floor lives in UnlockCeremony.tsx (`scale >= 500`) and is source-pinned.
//   (d) MS-3 floor sanity — on a fully-passing binary class the four core gate
//       ids + the platform id appear EXACTLY once each, in order; a non-binary
//       class carries exactly the four core ids and never a platform entry.
//   PICC.md records the WS-3 land (registry row + methodology note).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIL_OFF_TESTNET_ONLY =
  "perps-rail-off: WS-1 is testnet-only — sandbox mode was not requested (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1); PICC_CCXT_PERPS_MAINNET_ENABLED alone is insufficient until the WS-3 ceremony"

const CEREMONY_ENV = [
  "PICC_CEREMONY_GATE1_MIN_RESOLVES",
  "PICC_CEREMONY_GATE3_STREAK",
  "PICC_CEREMONY_GATE3_RATIO_LO",
  "PICC_CEREMONY_GATE3_RATIO_HI",
  "PICC_CEREMONY_GATE4_TRADING_DAYS"
]

const HYPERLIQUID_KEYS = {
  PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0x1111111111111111111111111111111111111111",
  PICC_CCXT_PRIVATEKEY_HYPERLIQUID: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}

const UNLOCKED_PERPS = {
  "hyperliquid-perps": { unlocked: true, at: "2026-09-23T00:00:00.000Z", by: "test-fixture" }
}

const DAY_MS = 86_400_000
const NOW = Date.UTC(2026, 8, 22, 6, 0, 0)

function source(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
}

function fixtureStore(enablement) {
  return JSON.stringify(
    { version: 1, classes: {}, enablement, platformVerification: { expertoption: null }, assetClasses: {} },
    null,
    2
  )
}

function makeExchange() {
  const calls = { loadMarkets: 0, setSandboxMode: 0 }
  const exchange = {
    id: "hyperliquid",
    calls,
    sandbox: false,
    setSandboxMode(v) {
      calls.setSandboxMode++
      exchange.sandbox = v
    },
    async loadMarkets() {
      calls.loadMarkets++
      return {
        "BTC/USDT:USDT": {
          symbol: "BTC/USDT:USDT",
          base: "BTC",
          quote: "USDT",
          type: "swap",
          active: true,
          limits: { amount: { min: 0.001 }, cost: { min: 5 } },
          info: { fundingIntervalMillis: 3_600_000 }
        }
      }
    }
  }
  return exchange
}

function libFor(ex) {
  return {
    hyperliquid: function Ctor() {
      return Object.create(ex)
    }
  }
}

function makeRow(over = {}) {
  return {
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
  }
}

function creditBalance(store, venueClass = "expertoption") {
  store.setAssetClasses({ "142": venueClass })
  const list = []
  let id = 1
  for (let i = 0; i < 200; i++) {
    list.push(
      makeRow({
        id: id++,
        engine: "legacy",
        result: i % 5 === 0 ? "hit" : "miss",
        entryTs: NOW + (i % 30) * DAY_MS
      })
    )
  }
  for (let i = 0; i < 100; i++) {
    list.push(
      makeRow({
        id: id++,
        engine: "v3.2",
        result: i % 5 < 3 ? "hit" : "miss",
        entryTs: NOW + (i % 30) * DAY_MS
      })
    )
  }
  store.creditResolved(list, { now: NOW })
}

let dir

beforeEach(() => {
  vi.resetModules()
  for (const v of CEREMONY_ENV) delete process.env[v]
  dir = mkdtempSync(join(tmpdir(), "picc-ceremony-seam-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  Object.assign(process.env, HYPERLIQUID_KEYS)
})

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("PICC_")) delete process.env[k]
  }
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

async function freshAdapter(seamFixture = false) {
  let ex = null
  if (seamFixture) {
    const seam = await import("../services/ccxtOrdering.mjs")
    seam._resetCcxtOrderingState()
    ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
  }
  const { hyperliquidPerps } = await import("../services/venues/hyperliquidPerps.mjs")
  return { adapter: hyperliquidPerps, ex }
}

describe("WS-3 validation & unlock ceremony seam guard (T8 no-regression)", () => {
  it("(a) credit path: a live ledger flush credits ONLY real+classed rows; sim + untagged are named denies", async () => {
    const cs = await import("../services/commandCentre/ceremonyState.mjs")
    const led = await import("../services/accuracyLedger.mjs")
    expect(cs.resolveConsumerWired()).toBe(true)
    cs.setAssetClasses({ "142": "ccxt-crypto" })

    const base = Date.now()
    const record = (over = {}) => {
      const e = led.recordDecision({
        verdict: "TRADE",
        expiry: 60,
        assetId: "142",
        asset: "EUR / USD",
        direction: "up",
        winProb: 0.7,
        ...over
      })
      e.entryPrice = 100
      e.entryTs = base - 60_000
      e.expiresAt = base - 10_000
      return e
    }
    const hit = record() // real + classed → must credit
    const untagged = record({ assetId: "999", asset: "GBP / USD" })
    const sim = record({ provenance: "sim" })
    const miss = record()
    const push = record()
    miss.__exit = 90
    push.__exit = 100

    const resolved = led.flushLedger({ now: base, resolve: (e) => e.__exit ?? 105 })
    expect(resolved).toHaveLength(5)
    expect(cs.resolveConsumerWired()).toBe(true)

    const cls = cs.classState("ccxt-crypto")
    expect(cls.spendableResolved).toBe(3)
    expect(cls.byEngine.legacy["60"]).toEqual({ hits: 1, misses: 1, total: 2 })
    expect(cls.streak).toHaveLength(2)

    const denials = cs.recentDenials()
    const simDeny = denials.find((d) => d.reason === "ceremony:deny:sim-row")
    const untaggedDeny = denials.find((d) => d.reason === "ceremony:deny:untagged-class")
    expect(simDeny).toBeTruthy()
    expect(simDeny.seq).toBe(sim.id)
    expect(untaggedDeny).toBeTruthy()
    expect(untaggedDeny.seq).toBe(untagged.id)
    expect(led.ledgerStats().decided).toBe(5)
  })

  it("(b) mainnet unreachable without a store unlock — locked store + env REQUEST ⇒ EXACT RAIL_OFF_TESTNET_ONLY", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), fixtureStore({ "hyperliquid-perps": null }))
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter } = await freshAdapter()
    expect(await adapter.markets()).toEqual({ ok: false, reason: RAIL_OFF_TESTNET_ONLY })
  })

  it("(b) ABSENT store record + env REQUEST ⇒ reads LOCKED — same exact string, never a throw", async () => {
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter } = await freshAdapter()
    expect(await adapter.markets()).toEqual({ ok: false, reason: RAIL_OFF_TESTNET_ONLY })
  })

  it("(b) UNHEALTHY store (unreadable fixture) + env REQUEST ⇒ EXACT RAIL_OFF_TESTNET_ONLY", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), "{not-json")
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter } = await freshAdapter()
    expect(await adapter.markets()).toEqual({ ok: false, reason: RAIL_OFF_TESTNET_ONLY })
  })

  it("(b) env REQUEST + fixture-store unlock is the ONLY way the mainnet branch proceeds", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), fixtureStore(UNLOCKED_PERPS))
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter, ex } = await freshAdapter(true)
    const rows = await adapter.markets()
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    expect(ex.calls.loadMarkets).toBe(1)
  })

  it("(b) source pin — hyperliquidPerps.mjs:57 (RAIL_OFF_TESTNET_ONLY) unchanged and still reachable via the ceremony seam", () => {
    const src = source("../services/venues/hyperliquidPerps.mjs")
    const lines = src.split("\n")
    expect(lines[56]).toBe("const RAIL_OFF_TESTNET_ONLY =")
    expect(src).toContain(RAIL_OFF_TESTNET_ONLY)
    expect(src).toContain("enablementFor as ceremonyEnablementFor")
  })

  it("(c) gate floors resolve from ENV_DEFAULTS with env unset — gate1 300, gate3 streak 50, band [0.7, 1.3], gate4 30", async () => {
    const gates = await import("../services/commandCentre/ceremonyGates.mjs")
    expect(gates.BINARY_PAYOUT_FLOOR_PCT).toBe(85)

    const g1short = gates.ceremonyGate1({ spendableResolved: 299 })
    expect(g1short.pass).toBe(false)
    expect(g1short.reason).toBe("ceremony:deny:gate1-short (have 299, require 300)")
    expect(gates.ceremonyGate1({ spendableResolved: 300 }).pass).toBe(true)

    const short = gates.ceremonyGate3({ streak: Array.from({ length: 49 }, () => ({ result: "hit", winProb: 0.62 })) })
    expect(short.pass).toBe(false)
    expect(short.reason).toBe("ceremony:deny:streak-short (have 49 rows, require 50)")
    const outOfBand = gates.ceremonyGate3({ streak: Array.from({ length: 50 }, () => ({ result: "hit", winProb: 0.2 })) })
    expect(outOfBand.pass).toBe(false)
    expect(outOfBand.reason).toContain("ceremony:deny:streak-out-of-band")
    expect(outOfBand.reason).toContain("band [0.7, 1.3]")
    const inBand = gates.ceremonyGate3({
      streak: Array.from({ length: 50 }, (_, i) => ({ result: i < 31 ? "hit" : "miss", winProb: 0.62 }))
    })
    expect(inBand.pass).toBe(true)
    expect(inBand.reason).toContain("ratio 1")

    const days29 = gates.ceremonyGate4({ tradingDays: Array.from({ length: 29 }, (_, i) => `d${i}`) })
    expect(days29.pass).toBe(false)
    expect(days29.reason).toBe("ceremony:deny:days-short (have 29 trading days, require 30)")
    expect(gates.ceremonyGate4({ tradingDays: Array.from({ length: 30 }, (_, i) => `d${i}`) }).pass).toBe(true)
  })

  it("(c) PICC_CEREMONY_SCALE_MIN_RESOLVES has no server-side gate — the 500 floor is a client readout pinned at UnlockCeremony.tsx", () => {
    const ui = source("../../src/components/UnlockCeremony.tsx")
    expect(ui).toContain("scale >= 500")
    expect(ui).toContain("(< 500)")
  })

  it("(d) MS-3 floor sanity — a passing binary class yields the four core ids + the platform id EXACTLY once each, in order", async () => {
    const store = await import("../services/commandCentre/ceremonyState.mjs")
    const gates = await import("../services/commandCentre/ceremonyGates.mjs")
    creditBalance(store, "expertoption")
    store.setPlatformVerification("expertoption", {
      verified: true,
      by: "op",
      regulator: "reg",
      payoutFloorPct: 90,
      withdrawalTested: true
    })

    const res = gates.evaluateCeremony("expertoption")
    const expected = [
      "gate1-constitution-300",
      "gate-platform-verification-85",
      "gate2-flip-gate-100",
      "gate3-streak-50-ratio",
      "gate4-trading-days-30"
    ]
    expect(res.ok).toBe(true)
    expect(res.gates.map((g) => g.id)).toEqual(expected)
    expect(res.gates.every((g) => g.pass)).toBe(true)
    for (const id of expected) expect(res.gates.filter((g) => g.id === id)).toHaveLength(1)
    expect(res.spendableResolved).toBe(300)
    expect(res.scaleResolved).toBe(res.spendableResolved)
    expect(res.gates.some((g) => g.id.includes("scale"))).toBe(false)
    expect(res.enablement).toBe(null)
  })

  it("(d) a non-binary class carries exactly the four core ids and never a platform entry", async () => {
    const store = await import("../services/commandCentre/ceremonyState.mjs")
    const gates = await import("../services/commandCentre/ceremonyGates.mjs")
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

  it("PICC.md records the WS-3 land (registry row + methodology note), and the spec file itself exists", () => {
    const doc = source("../../../../PICC.md")
    expect(doc).toContain("PICC_TRADING_SUITE_WS3_VALIDATION_AND_UNLOCK_CEREMONY_v1")
    expect(doc).toContain("38 registry rows")
    expect(doc).toContain("WS-3")
    expect(doc).toContain("unlock ceremony")
  })
})