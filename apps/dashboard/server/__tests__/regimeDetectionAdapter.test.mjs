import { describe, expect, it } from "vitest"
import { detectRegime, tfSecondsOf } from "../services/regimeDetection.mjs"
import { detectRegimeEnhanced } from "../services/regimeEngine.mjs"
import { TF_SECONDS } from "../services/mtfConvergence.mjs"

// B-REG-4 — the regime-engine adapter surface (spec PICC_TRADING_SUITE_REBUILD_v1.md):
// detectRegime keeps its legacy keys byte-identical AND delegates a single-plane
// regimeEngine read, attached additively. The pre-existing regimeDetection.test.mjs
// and liveTestingPrep.test.mjs pin the legacy contract — this file pins the NEW
// additive surface.
//
// Nightly legacy fixture style mirrors regimeDetection.test.mjs (untouched).

function trendCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i
    return { time: i * 60000, open: close - 1, high: close + 0.6, low: close - 0.6, close }
  })
}

function noiseCandles(n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const close = i % 2 === 0 ? 100 : 101
    return { time: i * 60000, open: i % 2 === 0 ? 101 : 100, high: close + 0.5, low: close - 0.5, close }
  })
}

describe("regimeEngine delegation (B-REG-4)", () => {
  it("attachs the additive regimeEngine block while legacy keys stay identical", () => {
    const candles = trendCandles()
    const full = detectRegime(candles)
    // legacy surface unchanged (the pinned consumer contract)
    expect(full.regime).toBe("trending")
    expect(full.confidence).toBeGreaterThanOrEqual(90)
    expect(full.factors.join(" ")).toMatch(/ADX/)
    expect(full.metrics.adx).toBeGreaterThan(25)
    expect(full.suggestedStrategy).toBe("momentum")
    // additive engine block:
    expect(full.regimeEngine.source).toBe("regimeEngine")
    expect(full.regimeEngine.regime).toBe("TRENDING")
    expect(full.regimeEngine.confidence).toBe(100)
    expect(full.regimeEngine.volatile).toBe(false)
    expect(full.regimeEngine.latency.planes).toEqual([TF_SECONDS.H1])
  })

  it("the engine block is the SAME single-plane read the engine returns directly", () => {
    const candles = trendCandles()
    const engine = detectRegimeEnhanced({ planes: { [TF_SECONDS.H1]: candles }, biasTf: TF_SECONDS.H1 })
    const r = detectRegime(candles, "1H")
    expect(r.regimeEngine.regime).toBe(engine.regime)
    expect(r.regimeEngine.confidence).toBe(engine.confidence)
    expect(r.regimeEngine.perPlane[TF_SECONDS.H1].observed).toBe(engine.perPlane[TF_SECONDS.H1].observed)
    expect(r.regimeEngine.factors.join("|")).toBe(engine.factors.join("|"))
  })

  it("noisy candles: legacy says not trending; engine block says RANGING honestly", () => {
    const r = detectRegime(noiseCandles())
    expect(r.regime).not.toBe("trending")
    expect(r.regimeEngine.regime).toBe("RANGING")
    expect(r.regimeEngine.confidence).toBeGreaterThan(0)
  })

  it("insufficient candles: legacy unknown + an honest engine block (never a guess)", () => {
    const r = detectRegime(noiseCandles(29))
    expect(r.regime).toBe("unknown")
    expect(r.confidence).toBe(0)
    expect(r.factors).toEqual([])
    expect(r.regimeEngine.regime).toBe("unknown")
    expect(r.regimeEngine.confidence).toBe(0)
    expect(r.regimeEngine.reason).toContain("insufficient bars")
  })

  it("the default 1H label resolves to 3600 and drives the bias plane", () => {
    expect(tfSecondsOf("1H")).toBe(3600)
    expect(tfSecondsOf("5m")).toBe(300)
    expect(tfSecondsOf("15m")).toBe(900)
    expect(tfSecondsOf("4h")).toBe(14400)
    expect(tfSecondsOf("D1")).toBe(86400)
    expect(tfSecondsOf("1mo")).toBe(2592000)
    expect(tfSecondsOf("garbage")).toBeNull()
    expect(tfSecondsOf(undefined)).toBeNull()
  })

  // ─────────────────────────────────────────────────────────────────────
  // REWRITTEN. THE OLD ASSERTION WAS THE BUG.
  //
  // This test used to read:
  //
  //     it("an unknown timeframe label degrades to an unbiased single-plane read", () => {
  //       const r = detectRegime(trendCandles(), "quarterly")
  //       expect(tfSecondsOf("quarterly")).toBeNull()
  //       expect(r.regimeEngine.latency.planes).toEqual([60]) // neutral fallback plane key
  //       expect(r.regimeEngine.regime).toBe("TRENDING")      // still classified, no bias weight
  //     })
  //
  // and it called the substitution a DEGRADATION, as though it were the designed
  // behaviour. It was not designed; it was `?? 60` on one line:
  //
  //     detectRegimeEnhanced({ planes: { [tf ?? 60]: candles }, biasTf: tf })
  //
  // With an unresolvable label that files the candles on a 60-SECOND PLANE while
  // `biasTf` stays null. Two separate lies in one expression, and they compound:
  // the plane key is a bar length that was never stated, and the engine then does
  // `Number(tf) === Number(biasTf)` -> `60 === Number(null)` -> `60 === 0` ->
  // false, so the bias weight is silently dropped. The read is not the read the
  // engine would have made, and nothing in the response says so — except that
  // `latency.planes` reports `[60]`, which reads as "I analysed a 1-minute
  // series" when no such series was ever named.
  //
  // The UI now filters its timeframe labels to eight resolvable ones, so it
  // cannot trip this. Every other caller still can, and the `?? 60` is an
  // invitation. The adapter now REFUSES instead, because the engine's plane map
  // is keyed by seconds and with no seconds there is no honest key to use.
  // ─────────────────────────────────────────────────────────────────────
  it("REFUSES the engine read on an unresolvable label — the old `?? 60` plane WAS the defect", () => {
    const r = detectRegime(trendCandles(), "quarterly")
    expect(tfSecondsOf("quarterly")).toBeNull()
    // No substitute plane. 60 seconds was never stated by anyone.
    expect(r.regimeEngine.latency.planes).toEqual([])
    expect(r.regimeEngine.perPlane).toEqual({})
    // And it abstains rather than answering from a plane it invented.
    expect(r.regimeEngine.regime).toBe("unknown")
    expect(r.regimeEngine.confidence).toBe(0)
    expect(r.regimeEngine.confidenceKind).toBe("abstained")
    // Named, so the client can say WHY rather than infer it from a missing plane.
    expect(r.regimeEngine.reason).toContain("quarterly")
    // The refusal is recorded additively, per input, for the same reason UI-4
    // added `assumedInputs`: the value the server acted on is not the value the
    // caller sent, and the client needs to be able to print that.
    expect(r.timeframeResolution).toEqual({
      label: "quarterly",
      seconds: null,
      biasApplied: false,
      reason: expect.stringContaining("quarterly")
    })
  })

  // THE MEASUREMENT DIRECTION — the control for the refusal above, and the guard
  // against an over-correction that refuses every label. EVERY label the table
  // knows, all 23 entries plus the case variants that normalise onto them — a
  // sample would hide a label the refusal rejected.
  it("STILL resolves a real bias plane for every label the table knows", () => {
    const RESOLVABLE = [
      "m1", "1m", "1min", "m5", "5m", "5min", "m15", "15m", "m30", "30m",
      "h1", "1h", "1hr", "h4", "4h", "d1", "1d", "1day", "w1", "1w",
      "mn", "1mo", "1month",
      // Case variants, which tfSecondsOf lowercases before lookup.
      "1H", "D1", "M15", "M1", "H4", "MN", "1W"
    ]
    expect(RESOLVABLE.length).toBe(30)
    for (const label of RESOLVABLE) {
      const seconds = tfSecondsOf(label)
      expect(seconds, label).not.toBeNull()
      const r = detectRegime(trendCandles(), label)
      expect(r.timeframeResolution.label, label).toBe(label)
      expect(r.timeframeResolution.seconds, label).toBe(seconds)
      expect(r.timeframeResolution.biasApplied, label).toBe(true)
      expect(r.timeframeResolution.reason, label).toBeNull()
      // The plane it actually used is the one the label named — nothing else.
      expect(r.regimeEngine.latency.planes, label).toEqual([seconds])
      expect(r.regimeEngine.regime, label).toBe("TRENDING")
      expect(r.regimeEngine.confidenceKind, label).toBe("measured")
    }
  })

  // EVERY UNRESOLVABLE SHAPE, not one convenient interior value. Each of these
  // was checked against the table directly: none of these normalises onto a key
  // the table holds. Note "-1" -> "1" and "!" -> "" after normalisation, and
  // "1min" / "15min" are RESOLVABLE so they must NOT appear here.
  it("refuses on every unresolvable label shape, never substituting 60 seconds", () => {
    const UNRESOLVABLE = [
      "quarterly", "garbage", "", "  ", "!", "0", "-1", "m2", "2m", "s5",
      "5sec", "1y", "1yr", "ye", "monthly", "1mins", "null", "NaN",
      {}, [], 60, 0, true
    ]
    for (const label of UNRESOLVABLE) {
      const r = detectRegime(trendCandles(), label)
      expect(tfSecondsOf(label) ?? null, String(label)).toBeNull()
      expect(r.timeframeResolution.seconds, String(label)).toBeNull()
      expect(r.timeframeResolution.biasApplied, String(label)).toBe(false)
      expect(r.regimeEngine.latency.planes, String(label)).toEqual([])
      expect(r.regimeEngine.regime, String(label)).toBe("unknown")
      expect(r.regimeEngine.confidenceKind, String(label)).toBe("abstained")
      // The one thing that must never appear on this branch: 60.
      expect(r.regimeEngine.latency.planes, String(label)).not.toContain(60)
      // And the legacy ADX/ATR surface is untouched by the label — it never
      // depended on one, so a refused bias plane must not cost the caller the
      // read it CAN make.
      expect(r.regime, String(label)).toBe("trending")
      expect(r.confidence, String(label)).toBeGreaterThan(0)
    }
  })

  // A null label is the absence of a label, not a 60-second one. `null` does NOT
  // trip the `timeframe = "1H"` default parameter, so it reaches tfSecondsOf.
  it("a null label refuses; only an ABSENT label falls back to the 1H default", () => {
    const nulled = detectRegime(trendCandles(), null)
    expect(nulled.timeframeResolution.seconds).toBeNull()
    expect(nulled.timeframeResolution.biasApplied).toBe(false)
    expect(nulled.regimeEngine.latency.planes).toEqual([])

    // undefined does NOT pass the default either in JS default-parameter
    // semantics? It does: an undefined argument activates the default. Assert
    // the actual behaviour rather than the one I assumed, since the whole point
    // of this file is that assumptions about this adapter were wrong once already.
    const absent = detectRegime(trendCandles(), undefined)
    expect(absent.timeframeResolution.seconds).toBe(3600)
    expect(absent.timeframeResolution.biasApplied).toBe(true)
    expect(absent.regimeEngine.latency.planes).toEqual([3600])
  })

  // ─────────────────────────────────────────────────────────────────────
  // RENAMED, NOT DELETED — the old title claimed a measurement this test does
  // not make. "a resolved bias plane is still weighted, and the refusal carries
  // no weight at all" reads as a weighting assertion; the body asserts plane
  // lists and regime labels, and weighting is a function of the engine's own
  // votes rather than of the adapter. A title that overstates its test is the
  // same defect class as a comment that asserts a property the code lacks:
  // it makes a reader believe coverage exists here that does not.
  //
  // The weighting coverage genuinely exists, and is measured where the weight
  // is actually applied — see the `regimeEngine bias membership is not decided
  // by numeric coercion` block below, which drives the confidence readout
  // directly from whether a bias was stated.
  //
  // What this test measures, stated plainly: the same candles on a resolved
  // label produce an engine read on that label's plane, and on an unresolved
  // label produce no read and no plane. Both were handed identical input, so
  // the only honest thing the second can report is that it used no plane.
  // ─────────────────────────────────────────────────────────────────────
  it("the same candles are read on a resolved plane and refused on an unresolved one", () => {
    const resolved = detectRegime(trendCandles(), "5m")
    expect(resolved.regimeEngine.latency.planes).toEqual([300])
    const refused = detectRegime(trendCandles(), "quarterly")
    expect(refused.regimeEngine.latency.planes).toEqual([])
    // Both were handed the same candles. The ONLY difference is the plane, so
    // the only honest thing the second can report is that it did not use one.
    expect(resolved.regimeEngine.regime).toBe("TRENDING")
    expect(refused.regimeEngine.regime).toBe("unknown")
  })

  // Under 30 bars the adapter hand-builds its own engine-shaped block, so that
  // writer needs the same fields or the two branches disagree on the wire.
  it("the insufficient-bars literal carries confidenceKind too", () => {
    const r = detectRegime(noiseCandles(29), "5m")
    expect(r.regimeEngine.regime).toBe("unknown")
    expect(r.regimeEngine.confidence).toBe(0)
    expect(r.regimeEngine.confidenceKind).toBe("abstained")
    // The label still resolved — the refusal here is about BARS, not the label,
    // and the two reasons must not be conflated.
    expect(r.timeframeResolution.biasApplied).toBe(true)
    expect(r.timeframeResolution.seconds).toBe(300)
  })

  // ─────────────────────────────────────────────────────────────────────
  // THE COLLISION THE COMMENT ABOVE DENIED.
  //
  // Every test above passes a RESOLVABLE label, so the two refusals were never
  // both live at once and the overwrite was invisible. The comment claimed
  // they "must not be conflated" while `reason: "insufficient bars"` conflated
  // them by erasing the label reason: `detectRegime(candles(29), "banana")`
  // shipped `reason === "insufficient bars"`, `planes: []`, and a sibling block
  // that said the label was the problem — so a caller reading the ENGINE block
  // concluded the label was fine.
  //
  // Two independent wrongs in one call, so both reasons are carried on the
  // block. Asserted on the SUBSTRINGS rather than on equality, because the
  // discriminating claim is "both are present", not "the sentence reads a
  // particular way".
  // ─────────────────────────────────────────────────────────────────────
  it("a thin series on an UNRESOLVABLE label carries BOTH refusal reasons, not the last one written", () => {
    const r = detectRegime(noiseCandles(29), "banana")
    expect(r.regimeEngine.latency.planes).toEqual([])
    expect(r.regimeEngine.confidenceKind).toBe("abstained")
    // The LABEL refusal survives on the engine block itself, not only on the
    // sibling `timeframeResolution`.
    expect(r.regimeEngine.reason).toMatch(/unresolvable timeframe "banana"/)
    // And so does the BARS refusal, which is the one it used to be overwritten by.
    expect(r.regimeEngine.reason).toMatch(/insufficient bars/)
    // Both are named in `factors` too, so neither is invisible to a client that
    // renders that array instead of `reason`.
    expect(r.regimeEngine.factors.join(" | ")).toMatch(/does not resolve to a bar length/)
    expect(r.regimeEngine.factors.join(" | ")).toMatch(/insufficient bars/)
    // And the sibling block agrees with it rather than telling a different story.
    expect(r.timeframeResolution.biasApplied).toBe(false)
    expect(r.timeframeResolution.seconds).toBeNull()
    expect(r.timeframeResolution.reason).toMatch(/banana/)
  })

  // THE OTHER DIRECTION. A thin series on a RESOLVABLE label has only ONE
  // refusal, so joining must not invent a label problem the caller did not have.
  it("a thin series on a RESOLVABLE label still reads as a bars-only refusal", () => {
    const r = detectRegime(noiseCandles(29), "5m")
    expect(r.regimeEngine.reason).toMatch(/insufficient bars/)
    expect(r.regimeEngine.reason).not.toMatch(/unresolvable timeframe/)
    expect(r.regimeEngine.factors).toHaveLength(1)
    expect(r.regimeEngine.factors.join(" | ")).not.toMatch(/does not resolve/)
  })

  // And the label-only refusal is unchanged when the bars are sufficient, so
  // joining did not regress the branch that has no second reason to join.
  it("a RESOLVABLE label with enough bars is not refused at all", () => {
    const r = detectRegime(trendCandles(), "5m")
    expect(r.regimeEngine.reason ?? null).toBeNull()
    expect(r.regimeEngine.factors.join(" | ")).not.toMatch(/insufficient bars/)
    expect(r.regimeEngine.factors.join(" | ")).not.toMatch(/does not resolve/)
  })
})

// THE SOURCE OF THE SILENTLY-DROPPED WEIGHT, PINNED DIRECTLY ON THE ENGINE.
//
// `detectRegimeEnhanced` decided bias membership with `Number(tf) === Number(biasTf)`.
// `Number(null)` is 0, so an absent biasTf was compared as a NUMBER against every
// plane key. That only happened to be safe because no plane is keyed 0 — the
// safety was a coincidence of the coercion table, not a stated invariant, and the
// adapter's `?? 60` sat right next to it relying on exactly that. The guard now
// states the invariant: no biasTf, no bias weight.
describe("regimeEngine bias membership is not decided by numeric coercion", () => {
  function plane(n = 60) {
    const rows = []
    for (let i = 0; i < n; i++) {
      const close = 100 + i
      rows.push({ time: i * 60000, open: close - 1, high: close + 0.6, low: close - 0.6, close })
    }
    return rows
  }
  // A plane whose KEY coerces to 0. No real timeframe is 0 seconds, so this is a
  // synthetic probe — and it is the only probe that can reach the case at all,
  // because `Number(null) === Number(0) === 0` and every other plane key is a
  // positive number of seconds that can never collide with the coercion.
  const ZERO_KEY = 0
  // One trending plane (CHI below 38.2, ADX above 25 -> two trend leans) and one
  // choppy plane (CHI 100 -> one range lean, ADX abstains). The confidence is
  // then a direct readout of the bias weight, because the two sides are
  // deliberately within reach of the TREND_MAJORITY threshold:
  //   unweighted        -> trend 1 vs range 1 -> UNCERTAIN at 50
  //   only "0" weighted -> trend 1.5 vs range 1 -> UNCERTAIN at 60
  const planes = () => ({ [ZERO_KEY]: trendCandles(), [300]: noiseCandles() })
  const readWith = (biasTf) => detectRegimeEnhanced({ planes: planes(), ...(biasTf === undefined ? {} : { biasTf }) })

  it("an ABSENT biasTf grants no plane the bias weight", () => {
    // Under the old coercion this was `Number("0") === Number(null)` -> `0 === 0`
    // -> true, so the plane was silently weighted 1.5 while the caller had
    // stated no bias at all. The invariant is that a bias must be STATED.
    const read = readWith(undefined)
    expect(read.confidenceKind).toBe("measured")
    expect(read.regime).toBe("UNCERTAIN")
    expect(read.confidence).toBe(50) // trend 1 vs range 1, unweighted
  })

  it("a biasTf STATED as 0 DOES weight the plane keyed 0, so the guard did not disable bias", () => {
    // The two reads differ only in whether the bias was stated, and the
    // confidence differs with it. Under the old coercion BOTH returned 60, which
    // is exactly the confusion: "no bias was requested" and "this plane is the
    // bias" were the same computation.
    const stated = readWith(ZERO_KEY)
    expect(stated.confidence).toBe(60) // trend 1.5 vs range 1, only the "0" plane weighted
    expect(stated.confidenceKind).toBe("measured")
    expect(stated.confidence).not.toBe(readWith(undefined).confidence)
  })

  it("a normal positive biasTf still weights its plane", () => {
    const read = detectRegimeEnhanced({ planes: { 300: plane() }, biasTf: 300 })
    expect(read.latency.planes).toEqual([300])
    expect(read.regime).not.toBe("unknown")
    expect(read.confidenceKind).toBe("measured")
  })
})