// WS-6 T1 — sample-key contract (RED).
//
// D8 is a hard lock: the sample bucket identity is the five-part
// (setup, market, timeframe, dataFidelity, regimeClass) tuple, and samples
// are NEVER aggregated across keys. These tests make both executable.
import { describe, expect, it } from "vitest"
import {
  SAMPLE_KEY_PARTS,
  makeSampleKey,
  sampleKeyId,
  sameSampleKey,
  canAggregate
} from "../../domain/sampleKeys"

const base = {
  setup: "london-trend",
  market: "BTCUSDT",
  timeframe: "15m",
  dataFidelity: "ohlcv-bar",
  regimeClass: "trend"
}

describe("sample key — shape", () => {
  it("declares exactly the five locked parts, in order", () => {
    expect(SAMPLE_KEY_PARTS).toEqual(["setup", "market", "timeframe", "dataFidelity", "regimeClass"])
  })

  it("builds a key from the five parts", () => {
    const k = makeSampleKey(base)
    expect(k).toEqual(base)
    expect(Object.keys(k).sort()).toEqual([...SAMPLE_KEY_PARTS].sort())
  })

  it("rejects a blank or missing part rather than defaulting it", () => {
    expect(() => makeSampleKey({ ...base, regimeClass: "" })).toThrow(/regimeClass/i)
    expect(() => makeSampleKey({ ...base, market: "  " })).toThrow(/market/i)
    const { dataFidelity: _dropped, ...missing } = base
    expect(() => makeSampleKey(missing as typeof base)).toThrow(/dataFidelity/i)
  })
})

describe("sample key — identity", () => {
  it("produces a stable id for the same key", () => {
    expect(sampleKeyId(makeSampleKey(base))).toBe(sampleKeyId(makeSampleKey({ ...base })))
  })

  it("gives a different id when dataFidelity differs", () => {
    // The D8 isolation rule: a bar-only and an L2 sample are different
    // hypotheses and must never share a bucket.
    const bar = makeSampleKey(base)
    const l2 = makeSampleKey({ ...base, dataFidelity: "l2-trades" })
    expect(sampleKeyId(bar)).not.toBe(sampleKeyId(l2))
  })

  it("gives a different id when regimeClass differs", () => {
    // Regime is part of the key because session routing makes a
    // london-trend and a tokyo-reversion bar genuinely different hypotheses.
    const trend = makeSampleKey(base)
    const reversion = makeSampleKey({ ...base, regimeClass: "range" })
    expect(sampleKeyId(trend)).not.toBe(sampleKeyId(reversion))
  })

  it("does not collide when parts contain the separator character", () => {
    // A naive join would make these two keys identical.
    const a = makeSampleKey({ ...base, setup: "a::b", market: "c" })
    const b = makeSampleKey({ ...base, setup: "a", market: "b::c" })
    expect(sampleKeyId(a)).not.toBe(sampleKeyId(b))
  })

  it("compares keys structurally, not by string identity", () => {
    expect(sameSampleKey(makeSampleKey(base), makeSampleKey({ ...base }))).toBe(true)
    expect(sameSampleKey(makeSampleKey(base), makeSampleKey({ ...base, timeframe: "1h" }))).toBe(false)
  })
})

describe("sample key — the aggregation prohibition", () => {
  it("permits aggregation only within one identical key", () => {
    const k = makeSampleKey(base)
    expect(canAggregate(k, makeSampleKey({ ...base }))).toBe(true)
  })

  it("refuses aggregation across any differing part", () => {
    const k = makeSampleKey(base)
    for (const part of SAMPLE_KEY_PARTS) {
      const other = makeSampleKey({ ...base, [part]: `${base[part]}-different` })
      expect(canAggregate(k, other), `must not aggregate across ${part}`).toBe(false)
    }
  })
})
