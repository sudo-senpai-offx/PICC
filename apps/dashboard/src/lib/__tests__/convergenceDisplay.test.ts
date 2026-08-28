import { describe, expect, it } from "vitest"
import {
  convergenceDisplayRows,
  displaySign,
  fmt,
  headerMetric,
  NDA,
  stateTone,
  tfLabel,
  whyText
} from "@/lib/convergenceDisplay"
import type { ConvergencePlane, ConvergenceResult } from "@/lib/liveTrading"

const plane = (overrides: Partial<ConvergencePlane>): ConvergencePlane => ({
  tf: 60,
  label: null,
  source: "live",
  stale: false,
  active: true,
  sign: 1,
  score: 4,
  amplitude: 3,
  adx: 28,
  volatility: 0,
  abstain: null,
  enabledDims: 4,
  votes: {},
  ...overrides
})

describe("convergence display mapping (7c)", () => {
  it("maps a populated payload to matrix rows with live values", () => {
    const r: ConvergenceResult = {
      ok: true,
      assetId: "EURUSD",
      meta: { requested: 2, available: 2, active: 2, aligned: 2, compositeDirection: 1, minBars: 30, dropOpen: false, conservative: false },
      composite: 1,
      compositeDirection: 1,
      score5: 5,
      quality: 10,
      confidence: 80,
      state: "LONG BIAS",
      why: ["strong bull confluence"],
      planes: [
        plane({ tf: 60, label: "entry" }),
        plane({ tf: 1800, label: "bias", source: "aggregate", sign: 1, score: 5, amplitude: 4, adx: 41 })
      ]
    }
    const rows = convergenceDisplayRows(r)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ tfLabel: "1m", role: "entry", sign: "▲", score: "4/5", amplitude: "3", adx: "28", source: "live", stale: false })
    expect(rows[1]).toMatchObject({ tfLabel: "30m", role: "bias", sign: "▲", score: "5/5", source: "aggregate", adx: "41" })
    expect(headerMetric(r.score5, "score")).toBe("5/5")
    expect(headerMetric(r.confidence, "pct")).toBe("80%")
    expect(whyText(r)).toBe("LONG BIAS — strong bull confluence")
  })

  it("renders — for absent reads everywhere (never zeros)", () => {
    const ab: ConvergencePlane = plane({
      active: false,
      sign: 0,
      score: null,
      amplitude: null,
      adx: null,
      source: "none",
      stale: true,
      abstain: "insufficient samples"
    })
    const r: ConvergenceResult = {
      ok: true,
      meta: { requested: 1, available: 0, active: 0, aligned: 0, compositeDirection: 0, minBars: 30, dropOpen: false, conservative: false },
      composite: 0,
      compositeDirection: 0,
      score5: null,
      quality: null,
      confidence: null,
      state: "NO TRADE",
      why: "no data",
      planes: [ab]
    }
    const rows = convergenceDisplayRows(r)
    expect(rows[0]).toMatchObject({ sign: "—", score: NDA, amplitude: NDA, adx: NDA, source: NDA, stale: true })
    expect(headerMetric(r.score5, "score")).toBe(NDA)
    expect(headerMetric(r.quality, "pct")).toBe(NDA)
    expect(whyText(r)).toBe("NO TRADE — no data")
  })

  it("empty snapshot and empty plane list render as —", () => {
    expect(convergenceDisplayRows(null)).toEqual([])
    const r: ConvergenceResult = {
      ok: true,
      meta: { requested: 0, available: 0, active: 0, aligned: 0, compositeDirection: 0, minBars: 30, dropOpen: false, conservative: false },
      composite: 0,
      compositeDirection: 0,
      score5: null,
      quality: null,
      confidence: null,
      state: "NO TRADE",
      why: "no data",
      planes: []
    }
    expect(convergenceDisplayRows(r)).toEqual([])
    expect(whyText(null)).toBe(NDA)
  })

  it("tfLabel formats the ladder compactly", () => {
    expect(tfLabel(60)).toBe("1m")
    expect(tfLabel(300)).toBe("5m")
    expect(tfLabel(900)).toBe("15m")
    expect(tfLabel(1800)).toBe("30m")
    expect(tfLabel(3600)).toBe("1H")
    expect(tfLabel(14400)).toBe("4h")
    expect(tfLabel(86400)).toBe("24h")
  })

  it("sign mapping and state tone stay deterministic", () => {
    expect(displaySign(plane({ active: true, sign: 1 }))).toBe("▲")
    expect(displaySign(plane({ active: true, sign: -1 }))).toBe("▼")
    expect(displaySign(plane({ active: true, sign: 0 }))).toBe("·")
    expect(displaySign(plane({ active: false, sign: 0 }))).toBe("—")
    expect(stateTone("LONG BIAS")).toBe("success")
    expect(stateTone("SHORT WATCH")).toBe("warn")
    expect(stateTone("NO TRADE")).toBe("muted")
    expect(stateTone("WAIT")).toBe("muted")
    expect(fmt(null, 2)).toBe(NDA)
  })
})