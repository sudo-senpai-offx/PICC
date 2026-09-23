import { describe, it, expect, afterEach } from "vitest"
import { evaluatePillarGate, resolvePillarMin, PILLAR_MIN_DEFAULT } from "../services/v32PillarGate.mjs"

const afterEachEnv = () => { delete process.env.PICC_V32_PILLAR_MIN }
afterEach(afterEachEnv)

function agree(reason = "fixture agrees") {
  return { available: true, agrees: true, reason }
}

function stand(reason = "fixture reads but does not align") {
  return { available: true, agrees: false, reason }
}

function unmeasured(reason = "fixture unmeasured") {
  return { available: false, agrees: false, reason }
}

const FIVE = {
  htfbias: agree("HTF bias up"),
  vwap: agree("price above cumulative VWAP"),
  ema921: agree("EMA 9/21 long"),
  volumedelta: agree("delta +38"),
  cvd: agree("CVD +38")
}

const FOUR = { htfbias: FIVE.htfbias, vwap: FIVE.vwap, ema921: FIVE.ema921, volumedelta: FIVE.volumedelta }

describe("evaluatePillarGate — 5-of-7 counting (R7.1/AC-9)", () => {
  it("five agreeing pillars pass at the default N of 5", () => {
    const gate = evaluatePillarGate({ pillars: FIVE })
    expect(gate).toEqual(expect.objectContaining({ ok: true, agreed: 5, needed: PILLAR_MIN_DEFAULT }))
  })

  it("four agreeing pillars fail at the default N of 5", () => {
    const gate = evaluatePillarGate({ pillars: FOUR })
    expect(gate.ok).toBe(false)
    expect(gate.agreed).toBe(4)
    expect(gate.needed).toBe(5)
  })

  it("min=1 passes on one agreeing pillar while the rest honest-fail", () => {
    const gate = evaluatePillarGate({ pillars: { vwap: agree() }, v32Config: { pillarMin: 1 } })
    expect(gate.ok).toBe(true)
    expect(gate.agreed).toBe(1)
    expect(gate.needed).toBe(1)
  })

  it("the oscillator row is only added when the optional group is supplied", () => {
    const without = evaluatePillarGate({ pillars: FIVE })
    expect(without.rows).toHaveLength(7)
    expect(without.rows.some((r) => r.id === "oscillator")).toBe(false)
    const withGroup = evaluatePillarGate({ pillars: { ...FOUR, oscillator: { rsi: stand() } } })
    expect(withGroup.rows).toHaveLength(8)
  })
})

describe("redundancy classifier — RSI/StochRSI/Stochastic/CCI pack to ONE vote (R7.2)", () => {
  it("RSI + CCI double-agreement counts once, not twice", () => {
    const gate = evaluatePillarGate({
      pillars: {
        htfbias: agree(),
        vwap: agree(),
        ema921: agree(),
        cvd: agree(),
        oscillator: { rsi: agree(), stochRSI: unmeasured(), stochastic: stand(), cci: agree() }
      }
    })
    expect(gate.rows.filter((r) => r.id === "oscillator")).toHaveLength(1)
    expect(gate.agreed).toBe(5)
    expect(gate.ok).toBe(true)
  })

  it("even when all four oscillators agree they still count as one vote", () => {
    const gate = evaluatePillarGate({
      pillars: {
        htfbias: agree(),
        vwap: agree(),
        ema921: agree(),
        cvd: agree(),
        oscillator: { rsi: agree(), stochRSI: agree(), stochastic: agree(), cci: agree() }
      }
    })
    expect(gate.rows).toHaveLength(8)
    expect(gate.agreed).toBe(5)
    expect(gate.needed).toBe(5)
    expect(gate.ok).toBe(true)
  })

  it("a standing oscillator family votes once and does not agree", () => {
    const gate = evaluatePillarGate({
      pillars: { ...FOUR, oscillator: { rsi: stand(), cci: stand() } }
    })
    const osc = gate.rows.find((r) => r.id === "oscillator")
    expect(osc.available).toBe(true)
    expect(osc.agrees).toBe(false)
    expect(osc.reason).toMatch(/packed to ONE vote/)
    expect(gate.agreed).toBe(4)
    expect(gate.ok).toBe(false)
  })
})

describe("unavailable pillars never count and carry honest reasons (R7.3)", () => {
  it("unavailable pillars are excluded from agreed and keep their reason", () => {
    const gate = evaluatePillarGate({
      pillars: {
        htfbias: unmeasured("no TF inputs supplied"),
        vwap: agree(),
        ema921: agree(),
        volumedelta: unmeasured("no trades feed"),
        cvd: agree()
      }
    })
    expect(gate.agreed).toBe(3)
    const vd = gate.rows.find((r) => r.id === "volumedelta")
    expect(vd).toEqual(expect.objectContaining({ available: false, agrees: false, reason: "no trades feed" }))
  })

  it("missing pillar inputs honest-fail as not supplied", () => {
    const gate = evaluatePillarGate({ pillars: { vwap: agree() } })
    const row = gate.rows.find((r) => r.id === "htfbias")
    expect(row.available).toBe(false)
    expect(row.agrees).toBe(false)
    expect(row.reason).toBe("pillar input not supplied")
  })

  it("unknown pillar keys are ignored — no invented rows", () => {
    const gate = evaluatePillarGate({ pillars: { ...FIVE, oracle: agree("fake"), signal: agree("fake") } })
    expect(gate.rows.map((r) => r.id)).not.toContain("oracle")
    expect(gate.rows.map((r) => r.id)).not.toContain("signal")
    expect(gate.agreed).toBe(5)
  })
})

describe("external-clear honest-fails with zero code (R7.3)", () => {
  it("a claimed external-clear source is forced to available:false and never counts", () => {
    const gate = evaluatePillarGate({
      pillars: { ...FOUR, externalclear: { available: true, agrees: true, reason: "fabricated broker clear" } }
    })
    expect(gate.ok).toBe(false)
    expect(gate.agreed).toBe(4)
    const row = gate.rows.find((r) => r.id === "externalclear")
    expect(row.available).toBe(false)
    expect(row.agrees).toBe(false)
    expect(row.reason).toMatch(/external-clear/)
  })

  it("external-clear never blocks a legitimate pass — it is simply absent", () => {
    const gate = evaluatePillarGate({ pillars: { ...FIVE, externalclear: { available: true, agrees: true } } })
    expect(gate.ok).toBe(true)
    expect(gate.agreed).toBe(5)
  })
})

describe("N config — env, config, then default 5 (R7.1/§3.8)", () => {
  it("PICC_V32_PILLAR_MIN raises the floor over the default", () => {
    process.env.PICC_V32_PILLAR_MIN = "6"
    const gate = evaluatePillarGate({ pillars: FIVE })
    expect(gate.needed).toBe(6)
    expect(gate.ok).toBe(false)
  })

  it("a lower env floor passes the same five", () => {
    process.env.PICC_V32_PILLAR_MIN = "4"
    const gate = evaluatePillarGate({ pillars: FIVE })
    expect(gate.needed).toBe(4)
    expect(gate.ok).toBe(true)
  })

  it("v32Config.pillarMin is the fallback when env is absent", () => {
    const gate = evaluatePillarGate({ pillars: FOUR, v32Config: { pillarMin: 4 } })
    expect(gate.needed).toBe(4)
    expect(gate.ok).toBe(true)
    const gate5 = evaluatePillarGate({ pillars: FOUR, v32Config: { pillarMin: 5 } })
    expect(gate5.needed).toBe(5)
    expect(gate5.ok).toBe(false)
  })

  it("an explicit min beats env and config", () => {
    process.env.PICC_V32_PILLAR_MIN = "3"
    const gate = evaluatePillarGate({ pillars: FOUR, min: 5, v32Config: { pillarMin: 4 } })
    expect(gate.needed).toBe(5)
    expect(gate.ok).toBe(false)
  })

  it("an invalid env N is an honest-fail gate naming it, never a throw and never a silent fallback", () => {
    process.env.PICC_V32_PILLAR_MIN = "six"
    const gate = evaluatePillarGate({ pillars: FIVE })
    expect(gate.ok).toBe(false)
    expect(gate.agreed).toBe(0)
    expect(gate.needed).toBe(0)
    expect(gate.rows).toEqual([expect.objectContaining({ id: "config", label: "Pillar minimum", available: false, agrees: false })])
    expect(gate.rows[0].reason).toContain("invalid-environment")
    expect(gate.rows[0].reason).toContain("PICC_V32_PILLAR_MIN")
    const resolved = resolvePillarMin({ env: process.env })
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toContain("PICC_V32_PILLAR_MIN")
  })

  it("an invalid config N is an honest-fail gate naming v32Config.pillarMin", () => {
    const gate = evaluatePillarGate({ pillars: FIVE, v32Config: { pillarMin: 0 } })
    expect(gate.ok).toBe(false)
    expect(gate.agreed).toBe(0)
    expect(gate.needed).toBe(0)
    expect(gate.rows[0].reason).toContain("invalid-environment")
    expect(gate.rows[0].reason).toContain("v32Config.pillarMin")
  })

  it("an invalid explicit min is an honest-fail gate naming the min argument", () => {
    const gate = evaluatePillarGate({ pillars: FIVE, min: 1.5 })
    expect(gate.ok).toBe(false)
    expect(gate.rows[0].reason).toContain("invalid-environment")
    expect(gate.rows[0].reason).toContain("min")
  })
})

describe("per-row reasons reflect the gap on failures (R7.4)", () => {
  it("every failing pillar row carries a non-empty reason and the count reflects it", () => {
    const gate = evaluatePillarGate({
      pillars: {
        htfbias: agree(),
        vwap: stand("price below cumulative VWAP"),
        ema921: unmeasured("insufficient bars for EMA 9/21"),
        volumedelta: unmeasured("no trades feed")
      }
    })
    expect(gate.ok).toBe(false)
    expect(gate.agreed).toBe(1)
    expect(gate.needed).toBe(5)
    for (const row of gate.rows) {
      expect(typeof row.reason).toBe("string")
      expect(row.reason.length).toBeGreaterThan(0)
    }
    const failing = gate.rows.filter((r) => r.agrees !== true)
    expect(failing.length).toBeGreaterThanOrEqual(6)
    expect(failing.map((r) => r.id)).toEqual(expect.arrayContaining(["vwap", "ema921", "externalclear"]))
  })

  it("a passing row is reported available + agreeing with its reading reason", () => {
    const gate = evaluatePillarGate({ pillars: { vwap: agree("price above cumulative VWAP") } })
    const row = gate.rows.find((r) => r.id === "vwap")
    expect(row).toEqual(expect.objectContaining({ available: true, agrees: true, reason: "price above cumulative VWAP" }))
  })
})