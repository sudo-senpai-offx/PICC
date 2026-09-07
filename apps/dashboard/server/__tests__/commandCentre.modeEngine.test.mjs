import { describe, expect, test } from "vitest"
import {
  AUTOPILOT_WORKABILITY_FLOOR,
  EXECUTION_POWER,
  MODES,
  MODE_RANK,
  renderVerdict
} from "../services/commandCentre/modeEngine.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"

/** All-green inputs for a sanctioned site — every gate starts open. */
function greenInputs(overrides = {}) {
  return {
    killSwitch: false,
    optIn: true,
    breakers: { dailyLossHalted: false, regimeHalted: false, siteCapped: false },
    staleFeeds: [],
    workability: 1,
    deliberation: null,
    advisory: null,
    demoActive: false,
    ...overrides
  }
}

const ccxt = () => templateForSite("trading:ccxt")
const expertoption = () => templateForSite("expertoption")
/** The gray truth-table row left the shipped catalog with the bandwidth suite;
 * the mode engine still guards gray venues — pinned via a synthetic template. */
const gray = () => ({ ...ccxt(), site: "test:gray", automationPermission: "gray", demoOnly: false })

describe("Command Centre — Mode Engine vocabulary", () => {
  test("mode set and rank order are fixed (BLOCKED < HOLD < COPILOT < AUTOPILOT_DEMO < AUTOPILOT)", () => {
    expect(MODES).toEqual(["BLOCKED", "HOLD", "COPILOT", "AUTOPILOT_DEMO", "AUTOPILOT"])
    expect(MODE_RANK.BLOCKED).toBe(0)
    expect(MODE_RANK.HOLD).toBe(1)
    expect(MODE_RANK.COPILOT).toBe(2)
    expect(MODE_RANK.AUTOPILOT_DEMO).toBe(3)
    expect(MODE_RANK.AUTOPILOT).toBe(4)
  })

  test("executionPower maps each mode to the honest execution surface", () => {
    expect(EXECUTION_POWER).toEqual({
      BLOCKED: "none",
      HOLD: "none",
      COPILOT: "proposals",
      AUTOPILOT_DEMO: "liveDemo",
      AUTOPILOT: "live"
    })
  })

  test("unknown site → structured error, never a fabricated verdict", () => {
    expect(renderVerdict("definitely:not-a-site", greenInputs())).toEqual({
      ok: false,
      error: "unknown site template: definitely:not-a-site"
    })
  })
})

describe("Command Centre — Mode Engine verdict matrix (gate × mode)", () => {
  test("default inputs on a sanctioned template: no opt-in → COPILOT, never silent live", () => {
    const v = renderVerdict(ccxt(), {})
    expect(v.mode).toBe("COPILOT")
    expect(v.executionPower).toBe("proposals")
    expect(v.reason.some((r) => r.includes("opt-in"))).toBe(true)
  })

  test("kill switch → BLOCKED, audited, reason surfaced", () => {
    const v = renderVerdict(ccxt(), greenInputs({ killSwitch: true }))
    expect(v.mode).toBe("BLOCKED")
    expect(v.executionPower).toBe("none")
    expect(v.reason.some((r) => r.includes("kill switch"))).toBe(true)
    expect(v.audit.some((a) => a.kind === "kill-switch")).toBe(true)
  })

  test("each risk-manager breaker → BLOCKED with the breaker named", () => {
    for (const [flag, name] of [
      ["dailyLossHalted", "daily-loss"],
      ["regimeHalted", "regime-shift"],
      ["siteCapped", "site risk cap"]
    ]) {
      const v = renderVerdict(ccxt(), greenInputs({ breakers: { [flag]: true } }))
      expect(v.mode).toBe("BLOCKED")
      expect(v.reason.some((r) => r.includes(name))).toBe(true)
    }
  })

  test("stale mandatory feed → forced HOLD with the feed named (5E)", () => {
    const v = renderVerdict(
      ccxt(),
      greenInputs({ staleFeeds: [{ name: "price", ageSec: 300, maxAgeSec: 120 }] })
    )
    expect(v.mode).toBe("HOLD")
    expect(v.reason.some((r) => r.includes("price") && r.includes("5E"))).toBe(true)
  })

  test("stale feed without a comparable cap never trips staleness (absent ≠ stale)", () => {
    const v = renderVerdict(
      ccxt(),
      greenInputs({ staleFeeds: [{ name: "unknown-cadence", ageSec: 99999 }] })
    )
    expect(v.mode).toBe("AUTOPILOT")
  })

  test("forbidden venue (expertoption truth table) → BLOCKED even fully green; demo allowed", () => {
    const v = renderVerdict(expertoption(), greenInputs())
    expect(v.mode).toBe("BLOCKED")
    expect(v.reason.some((r) => r.includes("5C"))).toBe(true)
    expect(v.demoAllowed).toBe(true)
    expect(v.executionPower).toBe("none")
  })

  test("gray venue can never autopilot — COPILOT even with opt-in and full workability", () => {
    const v = renderVerdict(gray(), greenInputs())
    expect(v.mode).toBe("COPILOT")
    expect(v.reason.some((r) => r.includes("gray"))).toBe(true)
  })

  test("workability below the deterministic floor caps at COPILOT", () => {
    const v = renderVerdict(ccxt(), greenInputs({ workability: AUTOPILOT_WORKABILITY_FLOOR - 0.01 }))
    expect(v.mode).toBe("COPILOT")
    expect(v.reason.some((r) => r.includes("workability"))).toBe(true)
  })

  test("workability exactly at the floor is sufficient for autopilot", () => {
    const v = renderVerdict(ccxt(), greenInputs({ workability: AUTOPILOT_WORKABILITY_FLOOR }))
    expect(v.mode).toBe("AUTOPILOT")
  })

  test("all green + sanctioned + opt-in + fresh → AUTOPILOT (live)", () => {
    const v = renderVerdict(ccxt(), greenInputs())
    expect(v.mode).toBe("AUTOPILOT")
    expect(v.executionPower).toBe("live")
  })

  test("demo active on a demo-only suite → AUTOPILOT_DEMO on the demo surface", () => {
    const demo = { ...ccxt(), demoOnly: true }
    const v = renderVerdict(demo, greenInputs({ demoActive: true }))
    expect(v.mode).toBe("AUTOPILOT_DEMO")
    expect(v.executionPower).toBe("liveDemo")
  })

  test("demo active on expertoption: live layer stays BLOCKED, demo surface flagged allowed", () => {
    const v = renderVerdict(expertoption(), greenInputs({ demoActive: true }))
    expect(v.mode).toBe("BLOCKED")
    expect(v.demoAllowed).toBe(true)
  })

  test("demo active without demoAllowed permission never fabricates a demo mode", () => {
    const v = renderVerdict(gray(), greenInputs({ demoActive: true }))
    expect(v.mode).toBe("COPILOT") // the gray template is not demoOnly
    expect(v.demoAllowed).toBe(false)
  })

  test("stale caps even a would-be demo run — never trade on stale input", () => {
    const demo = { ...ccxt(), demoOnly: true }
    const v = renderVerdict(
      demo,
      greenInputs({ demoActive: true, staleFeeds: [{ name: "price", ageSec: 300, maxAgeSec: 60 }] })
    )
    expect(v.mode).toBe("HOLD")
  })
})

describe("Command Centre — Mode Engine 5H (LLM/advisory downgrade-only)", () => {
  test("advisory downgrade lowers AUTOPILOT to COPILOT and is audited with before/after", () => {
    const v = renderVerdict(
      ccxt(),
      greenInputs({ advisory: { direction: "down", reason: "turbulence spike" } })
    )
    expect(v.mode).toBe("COPILOT")
    expect(v.reason.some((r) => r.includes("advisory downgrade"))).toBe(true)
    expect(v.audit).toContainEqual(
      expect.objectContaining({ kind: "advisory-downgrade", from: "AUTOPILOT", to: "COPILOT" })
    )
  })

  test("advisory upgrade attempt is REJECTED — mode never rises, attempt is audited", () => {
    const v = renderVerdict(
      ccxt(),
      greenInputs({ workability: AUTOPILOT_WORKABILITY_FLOOR - 0.01, advisory: { direction: "up", reason: "LLM is confident" } })
    )
    expect(v.mode).toBe("COPILOT") // unchanged by the upgrade attempt
    expect(v.reason.some((r) => r.includes("rejected"))).toBe(true)
    expect(v.audit.some((a) => a.kind === "advisory-upgrade-REJECTED")).toBe(true)
  })

  test("advisory outage leaves the deterministic verdict bit-for-bit unchanged (5H proof)", () => {
    const base = renderVerdict(ccxt(), greenInputs({ advisory: null, advisoryUnavailable: false }))
    const outage = renderVerdict(ccxt(), greenInputs({ advisory: null, advisoryUnavailable: true }))
    expect(outage.mode).toBe(base.mode)
    expect(outage.executionPower).toBe(base.executionPower)
    expect(outage.reason.some((r) => r.includes("unavailable"))).toBe(true)
  })

  test("advisory input on an already-BLOCKED site changes nothing", () => {
    const v = renderVerdict(
      ccxt(),
      greenInputs({ killSwitch: true, advisory: { direction: "down", reason: "whatever" } })
    )
    expect(v.mode).toBe("BLOCKED")
  })
})

describe("Command Centre — Mode Engine honesty surfaces", () => {
  test("slice-2 deliberation is reported not-yet-available, never fabricated", () => {
    const v = renderVerdict(ccxt(), greenInputs())
    expect(v.deliberation).toBe("not-yet-available")
    expect(v.reason.some((r) => r.includes("deterministic-only"))).toBe(true)
  })

  test("breadcrumbs pass through agent findings for the UI (slice 3 feeds them)", () => {
    const crumbs = [{ agent: "consensus", verdict: "up", weight: 0.8 }]
    const v = renderVerdict(ccxt(), greenInputs({ breadcrumbs: crumbs }))
    expect(v.breadcrumbs).toEqual(crumbs)
  })

  test("verdict shape is stable and complete", () => {
    const v = renderVerdict(ccxt(), greenInputs())
    expect(Object.keys(v).sort()).toEqual(
      ["audit", "breadcrumbs", "deliberation", "demoAllowed", "executionPower", "mode", "ok", "reason", "site"].sort()
    )
    expect(v.site).toBe("trading:ccxt")
  })
})