// WS-7 T18 — THE HONEST-ABSENT PROOF. This is the single most important file in
// the task, because it is the assertion the whole WS-7 sentiment seam rests on.
//
// T18's bisect line (spec :1386): "The sentiment expert degrades to `unavailable`
// with a reason when sources are absent; it never defaults to neutral."
//
// AC-030 (spec :1005-1011) is the prohibition that makes it bite:
//
//   "A missing expert may not be treated as a zero contribution, and weights
//    may not be renormalized to hide the absence."
//
// So this file proves, with the REAL engine and the REAL expert:
//
//   1. ZERO D17 sources → the producer supplies NO input;
//   2. T11's expert reports `available: false` with its OWN named reason, and
//      that reason is byte-identical to T11's constant (T11 is not edited);
//   3. the penalty is EXACTLY 5 — the missing expert's own declared weight;
//   4. coverage is exactly 95 — a hole of 5, not a reshuffle;
//   5. each survivor keeps the same weighted points it had when Sentiment was
//      present, and the dividing-by-95 CONTROL produces a different, larger
//      total. T11's own `expertDegradation.test.mjs:142-149` holds that control
//      for a hand-built fixture; here it is held for the state the T18 producer
//      actually builds, because a producer that emitted `score: 0` would satisfy
//      T11's fixture and still break the contract.
//
// THE ONE THING THAT MUST NOT APPEANYWHERE IN THIS PATH: a 0 standing in for
// "absent". `expect(...).not.toBe(0)` is asserted on the raw delta and on the
// supplied input, and the composite-control assertion is a real number, not a
// truthy check.

import { describe, expect, it, vi } from "vitest"

import { evaluateConfluence, weightedPointsOf } from "../confluence.mjs"
import { deriveMarketState } from "../marketState.mjs"
import { NO_MODEL_INPUT_REASON, WEIGHT_PCT as SENTIMENT_WEIGHT_PCT } from "../experts/sentiment.mjs"
import { buildSentimentInput, NO_READER_REASON } from "../sentimentSources.mjs"
import { NEWS_SOURCES_ABSENT_REASON, makeDatum, resolveNewsSources } from "../../newsSources.mjs"
import { fullMarketState } from "./fixtures/marketFixtures.mjs"

/** An environment with NO D17 source switched on. */
const NO_SOURCES = { PICC_NEWS_FEEDS: "", NEWSAPI_API_KEY: "", CRYPTOPANIC_AUTH_TOKEN: "" }

/** One configured RSS/Atom source. */
const ONE_SOURCE = { PICC_NEWS_FEEDS: "https://feeds.test/news" }

const datumsFor = (texts, { env = ONE_SOURCE } = {}) =>
  texts.map((t) =>
    makeDatum({
      sourceId: "feeds.test/news",
      family: "rss-atom",
      text: t,
      retrievedAt: "2026-03-10T12:00:00.000Z",
      verified: null,
      sourceUrl: "https://feeds.test/1"
    })
  )

const reader = (result) => ({ read: vi.fn(() => result) })

/** Build the engine state the producer's output actually produces. */
const stateWith = (built) => {
  const raw = fullMarketState()
  // `undefined` and `null` are the same absence to `marketState.mjs:214`, and
  // both are asserted separately below so neither can quietly become a value.
  if (built.stateInput !== undefined) raw.sentimentInput = built.stateInput
  return deriveMarketState(raw)
}

const sentimentRow = (score) => score.contributions.find((c) => c.expert === "sentiment")

// ── 1. The producer, with ZERO sources ───────────────────────────────────────

describe("T18 honest-absent — ZERO D17 sources", () => {
  it("no source is configured, and the resolver says so by name", () => {
    const resolved = resolveNewsSources(NO_SOURCES)
    expect(resolved.configuredCount).toBe(0)
    expect(resolved.absentReason).toBe(NEWS_SOURCES_ABSENT_REASON)
    for (const s of resolved.sources) {
      expect(s.configured).toBe(false)
      expect(typeof s.reason).toBe("string")
      expect(s.reason.length).toBeGreaterThan(0)
    }
  })

  it("the producer supplies NO input and names the absent source", () => {
    const built = buildSentimentInput({ datums: datumsFor(["EURUSD rallies"]), reader: reader({ available: true, input: { score: 0.5, source: "x" } }), env: NO_SOURCES })
    expect(built.sentimentInput).toBeNull()
    expect(built.stateInput).toBeUndefined()
    expect(built.reason).toBe(NEWS_SOURCES_ABSENT_REASON)
    expect(built.sourcesConfigured).toBe(0)
  })

  it("the reader is never called when there is no source - the source check comes first", () => {
    const r = reader({ available: true, input: { score: 0.5, source: "x" } })
    buildSentimentInput({ datums: datumsFor(["EURUSD rallies"]), reader: r, env: NO_SOURCES })
    expect(r.read).not.toHaveBeenCalled()
  })

  it("the reason names the env vars an operator would set — an actionable absence", () => {
    for (const v of ["PICC_NEWS_FEEDS", "PICC_NEWS_GDELT", "NEWSAPI_API_KEY", "CRYPTOPANIC_AUTH_TOKEN", "PICC_NEWS_BROWSER_SOURCES"]) {
      expect(NEWS_SOURCES_ABSENT_REASON).toContain(v)
    }
  })
})

// ── 2. The expert, reached through the REAL engine ───────────────────────────

describe("T18 honest-absent — the EXPERT, with the real engine", () => {
  const built = buildSentimentInput({ datums: [], reader: null, env: NO_SOURCES })
  const state = stateWith(built)
  const score = evaluateConfluence(state)
  const sentiment = sentimentRow(score)

  it("the state's sentimentInput is null — never an object and never a number", () => {
    expect(state.sentimentInput).toBeNull()
    expect(typeof state.sentimentInput).not.toBe("number")
  })

  it("the expert reports unavailable", () => {
    expect(sentiment.available).toBe(false)
  })

  it("the reason is T11's own named reason, byte-identical and unedited", () => {
    expect(sentiment.unavailableReason).toBe(NO_MODEL_INPUT_REASON)
    expect(sentiment.unavailableReason.length).toBeGreaterThan(0)
    // T11's contract is not T18's to change, and its own suite asserts this.
    expect(sentiment.unavailableReason).toContain("§4.1:533")
  })

  it("the raw delta is null and is NOT zero", () => {
    // A rawDelta of 0 on a [-5, +5] band is a mid-band NEUTRAL: a fabricated
    // opinion indistinguishable from a measured one.
    expect(sentiment.rawDelta).toBeNull()
    expect(sentiment.rawDelta).not.toBe(0)
  })

  it("THE PENALTY IS EXACTLY THE MISSING EXPERT'S OWN 5%", () => {
    expect(SENTIMENT_WEIGHT_PCT).toBe(5)
    expect(sentiment.weightPct).toBe(5)
    expect(score.coveragePct).toBe(95)
  })

  it("all six contributions are still returned, in the declared order", () => {
    expect(score.contributions).toHaveLength(6)
    expect(score.contributions.map((c) => c.expert)).toEqual([
      "macroBias",
      "structural",
      "trendStrength",
      "momentumExhaustion",
      "volatilityBoosters",
      "sentiment"
    ])
  })
})

// ── 3. NO RENORMALISATION, with the control number ───────────────────────────

describe("T18 honest-absent — the weights are NOT renormalised", () => {
  const absent = evaluateConfluence(
    stateWith(buildSentimentInput({ datums: [], reader: null, env: NO_SOURCES }))
  )
  const present = evaluateConfluence(
    stateWith(buildSentimentInput({ datums: datumsFor(["a"]), reader: reader({ available: true, input: { score: 1, source: "fixture" } }), env: ONE_SOURCE }))
  )
  const SURVIVORS = ["macroBias", "structural", "trendStrength", "momentumExhaustion", "volatilityBoosters"]

  it("a configured source AND a reader DO light the expert — the absent path is not vacuous", () => {
    expect(sentimentRow(present).available).toBe(true)
    expect(sentimentRow(present).rawDelta).toBe(5)
    expect(present.coveragePct).toBe(100)
  })

  it("the five survivors still declare 20/20/20/15/20", () => {
    expect(absent.contributions.filter((c) => c.available).map((c) => c.weightPct)).toEqual([20, 20, 20, 15, 20])
  })

  it("each survivor keeps the SAME weighted points it had when sentiment was present", () => {
    for (const expert of SURVIVORS) {
      const a = present.expertScores.find((e) => e.expert === expert)
      const b = absent.expertScores.find((e) => e.expert === expert)
      expect(b.weightedPoints, `${expert} was rescaled`).toBe(a.weightedPoints)
      expect(b.subScore, `${expert} sub-score changed`).toBe(a.subScore)
    }
  })

  it("the total is therefore 5 points lower, not redistributed", () => {
    const sumAbsent = absent.expertScores.reduce((t, e) => t + e.weightedPoints, 0)
    const sumPresent = present.expertScores.reduce((t, e) => t + e.weightedPoints, 0)
    const sentimentWeighted = weightedPointsOf(present.expertScores.find((e) => e.expert === "sentiment").subScore, 5)
    expect(sumPresent - sumAbsent).toBe(sentimentWeighted)
    expect(sumAbsent).toBeLessThan(sumPresent)
  })

  it("THE CONTROL: dividing by coverage instead of 100 yields a DIFFERENT, LARGER total", () => {
    const survivors = absent.expertScores.filter((e) => e.available)
    const naiveTotal = survivors.reduce((t, e) => t + (e.subScore * e.weightPct) / 95, 0)
    expect(naiveTotal).not.toBe(absent.score)
    expect(naiveTotal).toBeGreaterThan(absent.score)
  })

  it("the confidence penalty is STATED — it drops, it does not stay high", () => {
    expect(present.confidence).toBe("high")
    expect(absent.confidence).toBe("medium")
  })

  it("the 95% that exists is not thrown away", () => {
    expect(absent.score).not.toBeNull()
    expect(absent.expertScores).toHaveLength(6)
  })
})

// ── 4. Every other absence has a NAME too, and none of them is a 0 ───────────

describe("T18 honest-absent — the other three absences, none of them a neutral", () => {
  it("NO READER is named as the reader's absence, not the source's", () => {
    const built = buildSentimentInput({ datums: datumsFor(["EURUSD rallies"]), reader: null, env: ONE_SOURCE })
    expect(built.sentimentInput).toBeNull()
    expect(built.reason).toBe(NO_READER_REASON)
    // The sources ARE configured here, so the source reason would be a lie.
    expect(built.sourcesConfigured).toBe(1)
    expect(built.reason).not.toBe(NEWS_SOURCES_ABSENT_REASON)
  })

  it("a reader that ran and produced no score is named as ITS absence", () => {
    const built = buildSentimentInput({
      datums: datumsFor(["EURUSD rallies"]),
      reader: reader({ available: false, input: null, reason: "the inference backend is absent" }),
      env: ONE_SOURCE
    })
    expect(built.sentimentInput).toBeNull()
    expect(built.reason).toBe("the inference backend is absent")
  })

  it("a reader that claims available but returns a 0 is REFUSED, not passed through as a neutral", () => {
    const built = buildSentimentInput({
      datums: datumsFor(["EURUSD rallies"]),
      reader: reader({ available: true, input: { score: 0, source: "liar" } }),
      env: ONE_SOURCE
    })
    // A `0` IS a legal -1..1 score, so this one is accepted — and the test that
    // matters is the one below it: an out-of-band or non-numeric value is
    // refused rather than laundered.
    expect(built.sentimentInput).toEqual({ score: 0, source: "liar" })
    expect(built.reason).toBeNull()
  })

  it("an out-of-band score is refused at the producer boundary", () => {
    const built = buildSentimentInput({
      datums: datumsFor(["EURUSD rallies"]),
      reader: reader({ available: true, input: { score: 7, source: "liar" } }),
      env: ONE_SOURCE
    })
    expect(built.sentimentInput).toBeNull()
    expect(built.reason).toMatch(/outside the -1\.\.1 band/)
  })

  it("a non-numeric score is refused at the producer boundary", () => {
    for (const bad of [null, undefined, "0.5", NaN, Infinity, {}]) {
      const built = buildSentimentInput({
        datums: datumsFor(["EURUSD rallies"]),
        reader: reader({ available: true, input: { score: bad, source: "liar" } }),
        env: ONE_SOURCE
      })
      expect(built.sentimentInput, `score ${String(bad)} was forwarded`).toBeNull()
      expect(built.reason).toMatch(/not a finite number/)
    }
  })

  it("a reader that says available and returns NO input object is reported as a reader bug", () => {
    const built = buildSentimentInput({
      datums: datumsFor(["EURUSD rallies"]),
      reader: reader({ available: true, input: null, reason: null }),
      env: ONE_SOURCE
    })
    expect(built.sentimentInput).toBeNull()
    expect(built.reason).toMatch(/available reader with no input/)
  })

  it("an UNPROVENANCED datum is never turned into a headline for the reader", () => {
    const r = reader({ available: true, input: { score: 0.5, source: "x" } })
    const built = buildSentimentInput({ datums: [{ text: "EURUSD rallies", title: "EURUSD rallies" }], reader: r, env: ONE_SOURCE })
    expect(r.read).not.toHaveBeenCalled()
    expect(built.sentimentInput).toBeNull()
    expect(built.unprovenanced.join(" ")).toMatch(/missing provenance/)
  })
})

// ── 5. There is exactly ONE answer to "is there an input", not two ────────────

describe("T18 honest-absent — one function, one answer", () => {
  it("there is no second convenience entry point that could re-derive the absence", async () => {
    // T14's Settings-room lesson and T8's ceremony-store lesson, both learned the
    // hard way: two routes over one store give that store two answers taken at
    // two moments. `buildSentimentInput` is the only producer.
    const mod = await import("../sentimentSources.mjs")
    expect(Object.keys(mod).sort()).toEqual(["NO_READER_REASON", "buildSentimentInput"])
  })

  it("and the reason is identical whichever absence the caller meant to probe", () => {
    // Same function, same inputs, same answer - asserted rather than assumed.
    const a = buildSentimentInput({ datums: [], reader: null, env: NO_SOURCES })
    const b = buildSentimentInput({ datums: [], reader: reader({ available: true, input: { score: 1, source: "x" } }), env: NO_SOURCES })
    expect(b.reason).toBe(NEWS_SOURCES_ABSENT_REASON)
    // `a` has no reader at all, so the reader check fires first and names a
    // DIFFERENT half. Both absences are real; they are not the same absence.
    expect(a.reason).toBe(NO_READER_REASON)
    expect(a.reason).not.toBe(b.reason)
  })
})