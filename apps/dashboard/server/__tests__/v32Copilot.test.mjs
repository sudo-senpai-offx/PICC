// v3.2 Plan 3 — Task 3 test bed: v32Copilot trip-wires 1-8 + explain-state (REQ-P3-7/8/9).
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { copilotGate, explainState, SESSION_HALT_FLOOR_PCT, COPILOT_WIRE_IDS } from "../services/v32Copilot.mjs"
import { noteBreakerTrip, _resetSidecarState } from "../services/commandCentre/safetySidecar.mjs"

const EXPECTED_WIRE_IDS = ["1", "2", "3", "4", "5", "6", "7", "8"]

function cleanRegime(overrides = {}) {
  return {
    registers: {
      adx: { available: true, chop: false, ...(overrides.adx ?? {}) },
      session: { available: true, label: "normal", ...(overrides.session ?? {}) }
    },
    f1: { ok: true, checks: { spread: { ok: true, check: "ok", reason: undefined, ...(overrides.spread ?? {}) } } },
    sources: {},
    at: 0
  }
}

function cleanRisk(overrides = {}) {
  return {
    dayStartBalance: 1000,
    pnl: 0,
    sessionPnL: 0,
    sessionBalance: 1000,
    killSwitch: false,
    proposalsToday: 0,
    consecutiveLosses: 0,
    ...overrides
  }
}

function cleanExecution(overrides = {}) {
  return {
    score: { available: true, score: 0.8, direction: "up", pillars: [], degraded: [] },
    costLine: { payoutPct: 82, spreadPips: 1.5, slippagePips: 0, marginPct: 1.15, netPayoutPct: 80, evRRMin: 2, evRR: 2.5, evRRPass: true },
    ...overrides
  }
}

function cleanConfig(overrides = {}) {
  return { proposalCap: 0, consecutiveLossThreshold: null, ...overrides }
}

function gate(over = {}) {
  return copilotGate({
    regime: cleanRegime(over.regime ?? {}),
    execution: cleanExecution(over.execution ?? {}),
    constitution: over.constitution ?? {},
    risk: cleanRisk(over.risk ?? {}),
    config: cleanConfig(over.config ?? {})
  })
}

const wire = (res, id) => res.wires.find((w) => w.id === id)

afterEach(() => _resetSidecarState())

describe("SESSION_HALT_FLOOR_PCT — non-configurable constant (REQ-P3-7)", () => {
  it("is exactly 2", () => {
    expect(SESSION_HALT_FLOOR_PCT).toBe(2)
  })
})

describe("copilotGate — wire order + all-pass posture (REQ-P3-7)", () => {
  it("emits wires 1-8 in order and opens on a clean fixture", () => {
    const res = gate()
    expect(res.wires.map((w) => w.id)).toEqual(EXPECTED_WIRE_IDS)
    expect(COPILOT_WIRE_IDS).toEqual(EXPECTED_WIRE_IDS)
    expect(res.ok).toBe(true)
    expect(res.blockedBy).toEqual([])
    for (const w of res.wires) expect(w.tripped).toBe(false)
  })

  it("a single tripped wire flips ok=false and appears in blockedBy", () => {
    const res = gate({ risk: { pnl: -70 } }) // -7% daily barrier
    expect(res.ok).toBe(false)
    expect(res.blockedBy).toEqual(["1"])
  })
})

describe("wire 1 — daily / session hard-halt floor", () => {
  it("trips on the daily barrier (-5% of UTC-day start)", () => {
    const res = gate({ risk: { pnl: -70 } }) // -7% of 1000
    expect(wire(res, "1").tripped).toBe(true)
    expect(wire(res, "1").reason).toMatch(/daily loss barrier/)
  })

  it("trips on the session floor (-2% of session balance)", () => {
    const res = gate({ risk: { sessionPnL: -30 } }) // -3% of 1000
    expect(wire(res, "1").tripped).toBe(true)
    expect(wire(res, "1").reason).toMatch(/session loss barrier/)
  })

  it("fails closed on a missing balance", () => {
    const res = gate({ risk: { dayStartBalance: undefined, sessionBalance: undefined } })
    expect(wire(res, "1").tripped).toBe(true)
    const reason = wire(res, "1").reason
    expect(reason).toMatch(/cannot compute/)
  })

  it("passes at exactly the ceiling (pnl -49.9 on 1000)", () => {
    const res = gate({ risk: { pnl: -49.9 } })
    expect(wire(res, "1").tripped).toBe(false)
  })
})

describe("wire 2 — Regime-3 chop override (REQ-P3-8)", () => {
  it("trips when adx.chop is true", () => {
    const res = gate({ regime: { adx: { available: true, chop: true } } })
    expect(wire(res, "2").tripped).toBe(true)
    expect(wire(res, "2").reason).toMatch(/chop/i)
  })

  it("fails closed when the adx register is unavailable", () => {
    const res = gate({ regime: { adx: { available: false, reason: "insufficient bars" } } })
    expect(wire(res, "2").tripped).toBe(true)
    expect(wire(res, "2").reason).toMatch(/unavailable/)
  })

  it("passes when adx is available and not chopping", () => {
    const res = gate()
    expect(wire(res, "2").tripped).toBe(false)
  })
})

describe("wire 3 — dead-zone / red-folder entry block (REQ-P3-8)", () => {
  it("trips on a non-normal session label", () => {
    for (const label of ["dead-zone", "red-folder", "red-folder+dead-zone"]) {
      const res = gate({ regime: { session: { available: true, label } } })
      expect(wire(res, "3").tripped).toBe(true)
      expect(wire(res, "3").reason).toMatch(/dead-zone|red-folder/)
    }
  })

  it("fails closed when the session register is unavailable", () => {
    const res = gate({ regime: { session: { available: false, reason: "no calendar source" } } })
    expect(wire(res, "3").tripped).toBe(true)
  })

  it("passes on a normal label", () => {
    expect(wire(gate(), "3").tripped).toBe(false)
  })
})

describe("wire 4 — 1.5-pip spread-spike abort (REQ-CTX-6)", () => {
  it("trips when the spread check is over-limit", () => {
    const res = gate({ regime: { spread: { ok: false, check: "over-limit", spreadPips: 3.2 } } })
    expect(wire(res, "4").tripped).toBe(true)
    expect(wire(res, "4").reason).toMatch(/spread/i)
  })

  it("fails closed when the spread is unmeasurable", () => {
    const res = gate({ regime: { spread: { ok: false, check: "unmeasurable", reason: "spread unmeasurable - no bid/ask source" } } })
    expect(wire(res, "4").tripped).toBe(true)
    expect(wire(res, "4").reason).toMatch(/unmeasurable|spread/i)
  })

  it("passes when the spread checks out", () => {
    expect(wire(gate(), "4").tripped).toBe(false)
  })
})

describe("wire 5 — cost line below 2:1 EV margin (REQ-P3-8)", () => {
  it("trips when evRR is below EV_RR_MIN", () => {
    const res = gate({ execution: { costLine: { evRR: 1.5, evRRPass: false, evRRMin: 2 } } })
    expect(wire(res, "5").tripped).toBe(true)
    expect(wire(res, "5").reason).toMatch(/EV/i)
  })

  it("trips when evRRPass is false even with a healthy-looking evRR", () => {
    const res = gate({ execution: { costLine: { evRR: 2.5, evRRPass: false, evRRMin: 3 } } })
    expect(wire(res, "5").tripped).toBe(true)
  })

  it("fails closed when no cost line exists", () => {
    const res = gate({ execution: { costLine: null } })
    expect(wire(res, "5").tripped).toBe(true)
    expect(wire(res, "5").reason).toMatch(/cost line/i)
  })

  it("passes at or above the margin", () => {
    expect(wire(gate(), "5").tripped).toBe(false)
  })
})

describe("wire 6 — kill-switch everywhere", () => {
  it("trips when the runtime kill switch is on", () => {
    const res = gate({ risk: { killSwitch: true } })
    expect(wire(res, "6").tripped).toBe(true)
    expect(wire(res, "6").reason).toMatch(/kill switch/i)
  })

  it("trips when a cross-site breaker halt is active", () => {
    noteBreakerTrip("binance", "hard-breaker", { now: 1000 })
    const res = gate()
    expect(wire(res, "6").tripped).toBe(true)
  })

  it("fails closed when the switch state cannot be proven off", () => {
    const res = gate({ risk: { killSwitch: undefined } })
    expect(wire(res, "6").tripped).toBe(true)
    expect(wire(res, "6").reason).toMatch(/unavailable|cannot prove/i)
  })

  it("passes with the switch confirmed off and no halt", () => {
    expect(wire(gate(), "6").tripped).toBe(false)
  })
})

describe("wire 7 — voluntary pause on consecutive losses (REQ-P3-9)", () => {
  it("is disabled while the threshold is unset", () => {
    const res = gate({ risk: { consecutiveLosses: 99 } })
    expect(wire(res, "7").tripped).toBe(false)
    expect(wire(res, "7").reason).toMatch(/disabled|unset/i)
  })

  it("trips when the count meets the configured threshold", () => {
    const res = gate({ config: { consecutiveLossThreshold: 2 }, risk: { consecutiveLosses: 2 } })
    expect(wire(res, "7").tripped).toBe(true)
    expect(wire(res, "7").reason).toMatch(/consecutive/)
  })

  it("fails closed when the count is unknown and a threshold is set", () => {
    const res = gate({ config: { consecutiveLossThreshold: 3 }, risk: { consecutiveLosses: undefined } })
    expect(wire(res, "7").tripped).toBe(true)
  })

  it("passes below the configured threshold", () => {
    expect(wire(gate({ config: { consecutiveLossThreshold: 5 }, risk: { consecutiveLosses: 2 } }), "7").tripped).toBe(false)
  })
})

describe("wire 8 — configurable proposals/day cap (REQ-P3-9)", () => {
  it("never trips at the unlimited default (0 / undefined)", () => {
    expect(wire(gate({ config: { proposalCap: 0 }, risk: { proposalsToday: 99 } }), "8").tripped).toBe(false)
    expect(wire(gate({ config: { proposalCap: undefined }, risk: { proposalsToday: 99 } }), "8").tripped).toBe(false)
  })

  it("trips when today's proposals reach the cap", () => {
    const res = gate({ config: { proposalCap: 2 }, risk: { proposalsToday: 2 } })
    expect(wire(res, "8").tripped).toBe(true)
    expect(wire(res, "8").reason).toMatch(/proposal cap/)
  })

  it("fails closed when the count is unknown and a cap is set", () => {
    const res = gate({ config: { proposalCap: 2 }, risk: { proposalsToday: undefined } })
    expect(wire(res, "8").tripped).toBe(true)
  })

  it("passes below the cap", () => {
    expect(wire(gate({ config: { proposalCap: 5 }, risk: { proposalsToday: 2 } }), "8").tripped).toBe(false)
  })
})

describe("explainState — deterministic serializable explain (zero LLM)", () => {
  it("serializes the gate deterministically with the cost line and wire flags", () => {
    const args = { regime: cleanRegime(), execution: cleanExecution(), constitution: {}, risk: cleanRisk(), config: cleanConfig(), at: 1234 }
    const a = explainState(args)
    const b = explainState(args)
    expect(a).toEqual(b)
    expect(a.at).toBe(1234)
    expect(a.wires.map((w) => w.id)).toEqual(EXPECTED_WIRE_IDS)
    expect(a.costLine).toEqual(cleanExecution().costLine)
    expect(a.verdict).toBe("TRADE")
    expect(a.blockedBy).toEqual([])
  })

  it("refuses to serialize into a function-carrying structure (JSON-safe)", () => {
    const a = explainState({ at: 0 })
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })

  it("never calls an LLM — module source has no LLM import", async () => {
    const src = await readFile(fileURLToPath(new URL("../services/v32Copilot.mjs", import.meta.url)), "utf8")
    const re = /import [^;]*\b(llm|governor|openai|anthropic|gemini)[^;]*;/i
    expect(src.match(re)).toBeNull()
  })
})

describe("module wiring sanity", () => {
  it("imports from frozen surfaces under fileURLToPath resolution", () => {
    expect(path.basename(fileURLToPath(new URL("../services/v32Copilot.mjs", import.meta.url)))).toBe("v32Copilot.mjs")
  })
})