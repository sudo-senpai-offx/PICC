import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Pure-logic coverage for the advisory engine. Execution internals were
// removed (PICC is advisory-first); what remains here is the decision
// contract every future notifier/surface depends on.

let tmp
let autopilot

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-autopilot-pure-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  await import("../services/trading.mjs")
  autopilot = await import("../services/autopilot.mjs")
  await autopilot._resetAutopilotData()
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("decideAutopilot (pure decision contract)", () => {
  const config = {
    enabled: true,
    minConfidence: 55,
    cooldownMs: 60000,
    maxConcurrent: 3,
    dailyLossLimitPct: 10
  }
  const strong = { direction: "up", confidence: 70, reason: "momentum" }

  it("approves a strong signal with a call direction", () => {
    const d = autopilot.decideAutopilot({ config, pred: strong, now: 1000000, lastEntryAt: 0 })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("call")
  })

  it("maps down signals to puts", () => {
    const d = autopilot.decideAutopilot({
      config,
      pred: { direction: "down", confidence: 80, reason: "revert" },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("put")
  })

  it("refuses when disabled or flat", () => {
    expect(autopilot.decideAutopilot({ config: { ...config, enabled: false }, pred: strong }).trade).toBe(false)
    expect(autopilot.decideAutopilot({ config, pred: { direction: "flat", confidence: 90 } }).trade).toBe(false)
    expect(autopilot.decideAutopilot({ config, pred: null }).trade).toBe(false)
  })

  it("refuses below the confidence threshold", () => {
    const d = autopilot.decideAutopilot({
      config,
      pred: { direction: "up", confidence: 50, reason: "weak" },
      now: 1000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/below/)
  })

  it("respects cooldown and max concurrent deals", () => {
    expect(
      autopilot.decideAutopilot({ config, pred: strong, now: 1000, lastEntryAt: 900 }).trade
    ).toBe(false)
    const d = autopilot.decideAutopilot({
      config,
      pred: strong,
      now: 200000,
      lastEntryAt: 100000, // 100s gap — cooldown long expired
      openCount: 3
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/max concurrent/)
  })

  it("consensus gate vetoes on matrix disagreement", () => {
    const d = autopilot.decideAutopilot({
      config: { ...config, consensusGate: true, minConsensusAgree: 4 },
      pred: strong,
      consensus: { ok: true, consensus: { direction: "down", agree: 5, total: 7 } },
      now: 500000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/consensus gate/)
  })
})

describe("advisory scope config (multi-asset targets)", () => {
  it("resolves enabled asset targets with legacy single-asset fallback", async () => {
    const legacy = await autopilot.getAutopilotConfig()
    expect(Array.isArray(legacy.assets)).toBe(true)

    await autopilot.saveAutopilotConfig({
      assets: [
        { assetId: "BTCUSD", enabled: true, duration: null, amount: null, minConfidence: null },
        { assetId: "ETHUSD", enabled: false }
      ]
    })
    const cfg = await autopilot.getAutopilotConfig()
    const targets = autopilot.enabledAssetTargets(cfg)
    expect(targets.map((t) => t.assetId)).toEqual(["BTCUSD"])
    // Disabled entries are retained in scope memory.
    expect(cfg.assets.length).toBe(2)
  })

  it("dry-run evaluator reports honest gates without executing anything", async () => {
    // No token configured in this fresh tmp dir → precondition failure, honestly named.
    const why = await autopilot.whyAutopilot({})
    expect(why.dryRun).toBe(true)
    expect(why.wouldTrade).toBe(false)
    expect(why.gates.some((g) => g.name === "token" && g.pass === false)).toBe(true)
  })
})
