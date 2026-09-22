// WS-2 T6 — spread-feed provider seam (spec §3.6 / AC-8, R6). Failure doctrine:
// empty registry → honest null; an invalid read → null; a measured spread only
// ever unlocks a class when it is ≤ the class's configured maxSpreadPips; every
// consumer (spreadGateF1 / f1 gate register) stays fail-closed on null. No
// fabricated feed — the fixture providers below are explicit test doubles.
import { describe, it, expect, afterEach } from "vitest"
import { U4FA_DEFAULTS, loadU4faConfig, resolveAssetConfig } from "../services/u4faConfig.mjs"
import { spreadFeedFor, spreadSnapshotFor, resolveSpreadReading, validateSpreadReading } from "../services/spreadFeedSeam.mjs"
import { spreadGateF1 } from "../services/fourFactor.mjs"
import { f1GateRegister } from "../services/v32Context.mjs"

const ENV = "PICC_SPREAD_FEED_PROVIDER"
const nowMs = () => Date.now()

function fixtureProvider(overrides = {}) {
  return {
    read(assetClass) {
      if (assetClass === "forex") return { spreadPips: 1.2, source: "fx-fixture", at: nowMs(), ...overrides }
      if (assetClass === "gold") return { spreadPips: 0.8, source: "gold-fixture", at: nowMs(), ...overrides }
      return null
    }
  }
}

async function fixtureConfig(provider) {
  const { config } = await loadU4faConfig({ file: "spread-fixture.json", config: { spreadProviders: { fixture: provider } } })
  return config
}

afterEach(() => {
  delete process.env[ENV]
})

describe("spreadFeedSeam — empty registry fails honest (AC-8 first half)", () => {
  it("returns honest null for every class with no provider configured", async () => {
    expect(await spreadFeedFor("forex", { config: U4FA_DEFAULTS })).toBeNull()
    const snapshot = await spreadSnapshotFor(U4FA_DEFAULTS)
    for (const cls of Object.keys(snapshot)) expect(snapshot[cls]).toBeNull()
    expect(U4FA_DEFAULTS.spreadProviders).toEqual({})
  })

  it("a configured provider is only consulted when the env names it (absent = none)", async () => {
    const config = await fixtureConfig(fixtureProvider())
    delete process.env[ENV]
    expect(await spreadFeedFor("forex", { config })).toBeNull()
    process.env[ENV] = "other-key"
    expect(await spreadFeedFor("forex", { config })).toBeNull()
    process.env[ENV] = "fixture"
    expect(await spreadFeedFor("forex", { config })).not.toBeNull()
  })
})

describe("spreadFeedSeam — measured reading vs per-class maxSpreadPips (AC-8 second half)", () => {
  it("a conforming fixture registering → a class whose measured spread ≤ maxSpreadPips passes", async () => {
    process.env[ENV] = "fixture"
    const config = await fixtureConfig(fixtureProvider())
    const reading = await spreadFeedFor("forex", { config })
    expect(reading).toEqual({ spreadPips: 1.2, source: "fx-fixture", at: expect.any(Number) })
    const max = config.calibration.forex.maxSpreadPips
    expect(max).toBe(1.5)
    expect(reading.spreadPips).toBeLessThanOrEqual(max)
    expect(spreadGateF1(reading, max, nowMs()).ok).toBe(true)
    expect(spreadGateF1(reading, max, nowMs()).check).toBe("ok")
  })

  it("a measured spread above maxSpreadPips fails (over-limit) — the class stays blocked", async () => {
    process.env[ENV] = "fixture"
    const config = await fixtureConfig(fixtureProvider({ spreadPips: 1.8 }))
    const reading = await spreadFeedFor("forex", { config })
    expect(reading.spreadPips).toBe(1.8)
    const gate = spreadGateF1(reading, config.calibration.forex.maxSpreadPips, nowMs())
    expect(gate.ok).toBe(false)
    expect(gate.check).toBe("over-limit")
  })

  it("non-finite or negative spreads are unmeasurable nulls, never a number", async () => {
    process.env[ENV] = "fixture"
    const config = await fixtureConfig(fixtureProvider({ spreadPips: NaN }))
    expect(await spreadFeedFor("forex", { config })).toBeNull()
    expect(validateSpreadReading({ spreadPips: -0.5, source: "s", at: nowMs() })).toBeNull()
    expect(validateSpreadReading({ spreadPips: Infinity, source: "s", at: nowMs() })).toBeNull()
    expect(validateSpreadReading({ spreadPips: 1, source: "", at: nowMs() })).toBeNull()
    expect(validateSpreadReading({ spreadPips: 1, source: "s", at: NaN })).toBeNull()
  })

  it("a throwing provider degrades to honest null (fail-closed, never a crash)", async () => {
    process.env[ENV] = "fixture"
    const config = await fixtureConfig({ read() { throw new Error("feed down") } })
    expect(await spreadFeedFor("forex", { config })).toBeNull()
  })
})

describe("spreadFeedSeam — calibration untouched + consumer fail-closed (R6)", () => {
  it("commodities eligibility:'avoid' and maxSpreadPips null are unchanged by the seam", async () => {
    process.env[ENV] = "fixture"
    const config = await fixtureConfig(fixtureProvider())
    const snapshot = await spreadSnapshotFor(config)
    expect(config.calibration.commodities.eligibility).toBe("avoid")
    expect(config.calibration.commodities.maxSpreadPips).toBeNull()
    expect(snapshot.commodities).toBeNull()
    expect(resolveAssetConfig("OIL", config).accessibility).toBe("refused")
    expect(U4FA_DEFAULTS.calibration.commodities.eligibility).toBe("avoid")
  })

  it("the consumer path stays fail-closed on null: spreadGateF1 + f1 gate register", () => {
    const f1 = f1GateRegister({
      assetId: "EURUSD",
      spread: null,
      maxSpreadPips: 1.5,
      session: { ok: true },
      nowMs: nowMs()
    })
    expect(f1.checks.spread.check).toBe("unmeasurable")
    expect(f1.ok).toBe(false)
    expect(f1.reasons.join(" ")).toMatch(/unmeasurable/)

    const gate = spreadGateF1(null, 1.5, nowMs())
    expect(gate.ok).toBe(false)
    expect(gate.check).toBe("unmeasurable")
    expect(gate.reason).toBe("spread unmeasurable — no bid/ask source")
    expect(spreadGateF1({ spreadPips: NaN, source: "x", at: nowMs() }, 1.5, nowMs()).check).toBe("unmeasurable")
  })

  it("the f1 register stays open on a valid measured spread (not over-blocking)", async () => {
    process.env[ENV] = "fixture"
    const config = await fixtureConfig(fixtureProvider())
    const reading = await spreadFeedFor("forex", { config })
    const f1 = f1GateRegister({
      assetId: "EURUSD",
      spread: reading,
      maxSpreadPips: config.calibration.forex.maxSpreadPips,
      session: { ok: true },
      nowMs: nowMs()
    })
    expect(f1.checks.spread.ok).toBe(true)
    expect(f1.ok).toBe(true)
  })
})

describe("spreadFeedSeam — live-cycle snapshot + per-class resolution", () => {
  it("a per-class snapshot carries readings only where measured, and resolveSpreadReading picks by class", async () => {
    process.env[ENV] = "fixture"
    const config = await fixtureConfig(fixtureProvider())
    const snapshot = await spreadSnapshotFor(config)
    expect(snapshot.forex.spreadPips).toBe(1.2)
    expect(snapshot.gold.spreadPips).toBe(0.8)
    expect(snapshot.crypto).toBeNull()
    expect(snapshot.indices).toBeNull()
    expect(resolveSpreadReading(snapshot, "forex")).toBe(snapshot.forex)
    expect(resolveSpreadReading(snapshot, "crypto")).toBeNull()
  })

  it("single-reading shapes (test fixtures) and null pass through unchanged", () => {
    const single = { spreadPips: 1.2, source: "fixture", at: 0 }
    expect(resolveSpreadReading(single, "forex")).toBe(single)
    expect(resolveSpreadReading(single, "gold")).toBe(single)
    expect(resolveSpreadReading(null, "forex")).toBeNull()
    expect(resolveSpreadReading(undefined, "forex")).toBeNull()
  })
})