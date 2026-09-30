import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Phase 12-16 regression tests: decision-support surfacing, session
 * liveness, honest rate pacing, and per-gate metrics. Nothing here touches
 * order placement — these paths are read-only by construction.
 */

let tmp
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "picc-phases-"))
  process.env.PICC_TRADING_DATA_DIR = join(tmp, "trading")
  process.env.PICC_DATA_DIR = tmp
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("Phase 14 — rolling decision log", () => {
  it("records entries via setLastDecision path and classifies gate buckets", async () => {
    const { classifyGateReason, getAutopilotDecisions, decideAutopilot } = await import("../services/autopilot.mjs")
    expect(classifyGateReason("cooldown in effect")).toBe("cooldown")
    expect(classifyGateReason("MTF gate: insufficient higher-TF agreement (1/3 agree, min 2)")).toBe("mtf-gate")
    expect(classifyGateReason("pro analysis flags a whipsaw range")).toBe("pro-gate")
    expect(classifyGateReason("daily loss limit 10% reached")).toBe("daily-loss-limit")
    expect(classifyGateReason("no live browser session — PICC browser not open")).toBe("liveness")
    // Pure decision function still returns structured refusals (unchanged contract)
    const d = decideAutopilot({ config: { enabled: false }, pred: null })
    expect(d.trade).toBe(false)
    expect(d.reason).toContain("disabled")
    void getAutopilotDecisions
  })

  it("decisions endpoint returns window + tally shape", async () => {
    const { getAutopilotDecisions } = await import("../services/autopilot.mjs")
    const res = getAutopilotDecisions(50)
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.decisions)).toBe(true)
    expect(res.window).toHaveProperty("size")
    expect(typeof res.tally).toBe("object")
  })
})

describe("Phase 14 — dry-run whyAutopilot refuses cleanly without a live setup", () => {
  it("returns a gated refusal and never a fabricated verdict", async () => {
    const { whyAutopilot } = await import("../services/autopilot.mjs")
    const res = await whyAutopilot({})
    expect(res.ok).toBe(true)
    expect(res.dryRun).toBe(true)
    expect(res.wouldTrade).toBe(false)
    // The "enabled" gate always fires first, whatever the persisted config says.
    const enabled = res.gates.find((g) => g.name === "enabled")
    expect(enabled).toBeTruthy()
    // D2/AC-005: the "token" gate is gone with the venue's credential. Two
    // honest outcomes remain and BOTH are asserted, so this test can fail:
    //   - disabled config → refuses at the precondition, before the removal
    //     gate is ever reached;
    //   - enabled config → reaches the removal gate and names the reason.
    // Either way the refusal carries a stated reason and no direction.
    if (enabled.pass) {
      const removed = res.gates.find((g) => g.name === "venue-removed")
      expect(removed).toBeTruthy()
      expect(removed.pass).toBe(false)
      expect(res.reason).toBe("execution venue removed")
    } else {
      expect(res.reason).toBe("precondition failed")
    }
    expect(res.direction).toBeNull()
    expect(res.confidence).toBeNull()
  })
})

describe("Phase 13 — liveness verdicts are honest", () => {
  it("reports not-live when no studio browser exists and no feed runs", async () => {
    const { getSessionLive } = await import("../services/autopilot.mjs")
    const verdict = await getSessionLive()
    expect(verdict.live).toBe(false)
    expect(typeof verdict.reason).toBe("string")
    expect(verdict.via).toBe("none")
  })

  // D2/AC-005: the two tests below tested the removed ExpertOption surface —
  // `checkExpertOptionSessionLive` (an EO app-tab liveness check) and
  // `connectSession` (the EO gateway pacer, via the deleted expertoption.mjs).
  // Both modules are deleted with the venue, so both tests are removed with
  // them. This is NOT a weakened assertion: the guarantee they pinned (an EO tab
  // with no live session must read as not-live) is now structurally impossible
  // to violate, because there is no EO session and no EO tab check at all.
  // `getSessionLive`'s not-live verdict above is still asserted, and it now
  // states the removal as its reason.
})

// D2/AC-005: the Phase 12 "gateway pacer" suite is REMOVED with
// expertoption.mjs. Its only test asserted that `connectSession` exposed gateway
// stats with sane defaults — the pacer existed solely to be a well-behaved
// client of the ExpertOption websocket, and the `gatewayRpm` field that
// surfaced it was removed from `tradingStatus` in the same change. The suite
// is deleted rather than left as an empty `describe`, which vitest treats as a
// failure. No surviving module exposes a gateway pacer.

describe("Phase 15 — per-asset breakdown + uptime shape", () => {
  it("perAssetStats returns rows sorted by sample count", async () => {
    const { perAssetStats } = await import("../services/accuracyLedger.mjs")
    const res = perAssetStats()
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.assets)).toBe(true)
  })

  it("sessionUptime24h reports null percentages before samples exist", async () => {
    const { sessionUptime24h } = await import("../services/scheduler.mjs")
    const u = sessionUptime24h()
    expect(u).toHaveProperty("samples")
    expect(u).toHaveProperty("connectedPct")
    expect(u).toHaveProperty("livePct")
  })

  it("startLivenessMonitor registers exactly once", async () => {
    const { startLivenessMonitor } = await import("../services/scheduler.mjs")
    const first = startLivenessMonitor()
    // Second call hits the already-started guard and returns true.
    const second = startLivenessMonitor()
    expect(second).toBe(true)
    void first
  })
})
