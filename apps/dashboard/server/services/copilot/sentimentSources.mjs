// WS-7 T18 — THE PRODUCER for T11's sentiment seam, and for T13's reader.
//
// ---------------------------------------------------------------------------
// THE HANDOFF THIS CLOSES, VERBATIM
// ---------------------------------------------------------------------------
//
// T13 entry 0025 handoff #6: "No caller of the sentiment reader."
// T13's own reader says the same from the other end
// (`modelLayer/sentimentModel.mjs:114-120`): "T18 owns the digest's sources and
// provenance (D17); T13 supplies no source of its own and will not infer over
// an empty input."
//
// T11's expert (`experts/sentiment.mjs:6-28`) is deliberately a seam that
// CONSUMES a supplied input and never produces one, and its own header says
// "`evaluate()` takes the value the model layer put on `state.sentimentInput`
// and validates its shape; T13 wires the producer."
//
// This file is that producer. It does not modify T11's expert or T13's reader;
// it feeds them.
//
// ---------------------------------------------------------------------------
// THE ABSENCE IS NAMED TWICE, ON PURPOSE, AND NEITHER NAME IS SUBSTITUTED
// ---------------------------------------------------------------------------
//
// With zero D17 sources configured, two things are true and both are reported:
//
//   1. `sentimentInput` is null, so T11's expert reports `available: false` with
//      its own constant `NO_MODEL_INPUT_REASON`. That reason is T11's contract
//      and its test asserts on it verbatim; this file neither edits it nor works
//      around it.
//
//   2. The SOURCE-layer reason — which env var is unset, which source is
//      unconfigured — is returned beside it in `reason`. A reader who wants to
//      know WHY the expert is cold gets the actionable half, and a reader who
//      wants the engine's contract gets T11's.
//
// Collapsing them would be the failure this whole branch keeps closing: one
// generic "no data" string that reads identically whether a source was never
// configured, was configured and failed, or was read and returned nothing.
// Those are three facts and the room can act on two of them differently.
//
// ---------------------------------------------------------------------------
// NO NEUTRAL DEFAULT, NO RENORMALISATION, NO CLOCK
// ---------------------------------------------------------------------------
//
// There is no code path here that produces `score: 0`, `rawDelta: 0`, or
// `sentimentInput: { score: 0 }`. A `0` on the [-1, +1] input T11 maps onto its
// ±5 band is a mid-band neutral: a fabricated opinion indistinguishable from a
// measured one, and AC-030's prohibition verbatim.
//
// Nothing here renormalises the remaining 95 either. The penalty is computed by
// `confluence.mjs` from the missing expert's OWN declared 5%, which T11's
// `expertDegradation.test.mjs:119-149` pins against a dividing-by-95 control.
// This file's only job on the scoring side is to decide whether the expert has
// an input at all.
//
// `now` is a parameter, never `Date.now()` inside a decision: the reading is
// reproducible from its inputs, and `retrievedAt` on each datum is the digest's
// own timestamp rather than a second clock read here.

import {
  NEWS_SOURCES_ABSENT_REASON,
  headlinesFrom,
  provenanceGap,
  resolveNewsSources
} from "../newsSources.mjs"

/**
 * The reason reported when no reader is supplied at all. Named and exported so
 * a test can assert the engine's seam is still cold for THIS reason rather than
 * for a generic one, and so a runbook can tell "no model layer wired" apart from
 * "no news source configured".
 */
export const NO_READER_REASON =
  "no sentiment reader was supplied, so nothing was inferred. T13's model layer is the reader " +
  "(services/copilot/modelLayer/sentimentModel.mjs) and it is absent by default because Needle 3 has " +
  "no in-process runtime on this host. This is an ABSENCE of the reader, not a neutral reading."

/**
 * Build the 5% Sentiment expert's input from D17's provenanced datums.
 *
 * The order of the checks is the design, and it is ordered by HOW ACTIONABLE the
 * resulting reason is: the reader's absence is reported before the source's,
 * because a missing reader explains a cold expert even when sources exist, and a
 * named missing source explains it even when the reader would have answered.
 *
 * @param {object} [params]
 * @param {ReadonlyArray<object>} [params.datums] Digest items. Each must already
 *   satisfy `hasProvenance`; one that does not is reported, never scored.
 * @param {{read: (req: object) => object}} [params.reader] T13's reader. Absent
 *   is the honest default and yields no input.
 * @param {Record<string,string|undefined>} [params.env]
 * @returns {{sentimentInput: {score: number, source: string}|null,
 *            stateInput: object|undefined,
 *            reason: string|null,
 *            headlines: string[],
 *            provenance: object[],
 *            unprovenanced: string[],
 *            sourcesConfigured: number}}
 */
export function buildSentimentInput({ datums = [], reader = null, env = process.env } = {}) {
  const sourcesConfigured = resolveNewsSources(env).configuredCount

  const base = {
    sentimentInput: null,
    // `undefined`, not `null`: `marketState.mjs:214` turns `undefined` into the
    // state's `null` and `raw.sentimentInput ?? null` distinguishes "never
    // supplied" from a supplied value. Supplying `null` explicitly would read
    // the same, which is fine, but `undefined` is what an omitted key means and
    // omission is the honest verb here.
    stateInput: undefined,
    reason: null,
    headlines: [],
    provenance: [],
    unprovenanced: [],
    sourcesConfigured
  }

  // 1. THE READER. Checked first: without it nothing downstream is reachable,
  //    and saying "no news source configured" when a source IS configured and
  //    the reader is missing would name the wrong half.
  if (reader === null || typeof reader?.read !== "function") {
    return { ...base, reason: NO_READER_REASON }
  }

  // 2. THE SOURCE. A reader with no input is T13's designed refusal
  //    (`sentimentModel.mjs:114-120`), and the SOURCE-level reason names which
  //    configuration is missing.
  if (sourcesConfigured === 0) {
    return { ...base, reason: NEWS_SOURCES_ABSENT_REASON }
  }

  // 3. THE DATUMS. Provenance-filtered, never scored blind. `unprovenanced`
  //    travels out so a caller can report them rather than lose them.
  const { headlines, datums: usable, unprovenanced } = headlinesFrom(datums)
  if (headlines.length === 0) {
    return {
      ...base,
      unprovenanced,
      reason:
        unprovenanced.length > 0
          ? `${sourcesConfigured} D17 source(s) are configured and ${unprovenanced.length} datum/datum-leg(s) arrived, but none carried full provenance (${unprovenanced[0]}). A datum that cannot be provenanced is not scored.`
          : `${sourcesConfigured} D17 source(s) are configured but the digest returned no provenanced datum. T13's reader refuses an empty headline list rather than inferring over nothing, and this producer does not invent one.`
    }
  }

  // 4. READ. T13 verifies the artifact's D15 digest before inferring and
  //    returns `{available, input, reason}`; its `input` is `null` on every
  //    unavailable path, so there is nothing here to reinterpret.
  const reading = reader.read({ headlines })

  if (reading === null || reading === undefined || typeof reading !== "object") {
    return { ...base, headlines, provenance: usable, unprovenanced, reason: "the sentiment reader returned no reading object at all" }
  }
  if (reading.available !== true) {
    return {
      ...base,
      headlines,
      provenance: usable,
      unprovenanced,
      // The reader's own reason is preserved verbatim: it knows about digest
      // gates and backends, and this layer knows about sources. Neither can
      // speak for the other.
      reason: String(reading.reason ?? "the sentiment reader reported unavailable without a reason")
    }
  }

  const input = reading.input
  if (input === null || input === undefined || typeof input !== "object") {
    return {
      ...base,
      headlines,
      provenance: usable,
      unprovenanced,
      reason: "the sentiment reader reported itself available but returned no input object. An available reader with no input is a reader bug, and it is reported as one rather than read as a neutral."
    }
  }

  // 5. VALIDATE ONCE MORE AT THE BOUNDARY. T11's expert re-validates
  //    (`experts/sentiment.mjs:71-77`), and this producer does not depend on
  //    that: a producer that hands T11 a number T11 will reject has already
  //    wasted the seam.
  const gaps = provenanceGap(input) === null ? [] : [provenanceGap(input)]
  if (typeof input.score !== "number" || !Number.isFinite(input.score)) {
    return {
      ...base,
      headlines,
      provenance: usable,
      unprovenanced,
      reason: `the sentiment reader returned ${JSON.stringify(input.score ?? null)} as its score, which is not a finite number. It is refused here rather than forwarded.`
    }
  }
  if (input.score < -1 || input.score > 1) {
    return {
      ...base,
      headlines,
      provenance: usable,
      unprovenanced,
      reason: `the sentiment reader returned ${input.score}, outside the -1..1 band T11's expert maps onto its ±5 band. Forwarding it would have T11 clamp a confident opinion the model did not express.`
    }
  }

  return {
    sentimentInput: Object.freeze({
      score: input.score,
      // The retrieval chain, so the score names HOW it was obtained and not
      // merely which model produced it. The modes are the D17 labels.
      source: String(input.source ?? "unnamed")
    }),
    stateInput: Object.freeze({ score: input.score, source: String(input.source ?? "unnamed") }),
    reason: null,
    headlines,
    provenance: usable,
    unprovenanced: [...unprovenanced, ...gaps],
    sourcesConfigured
  }
}

// ---------------------------------------------------------------------------
// ONE ANSWER, NOT TWO
// ---------------------------------------------------------------------------
//
// There is deliberately no `absentSentimentInput()` convenience wrapper beside
// `buildSentimentInput()`. A second entry point that re-derives the absence is
// a second store over one fact, and the branch has already had that argument
// twice — the Settings room's notification form (T14) and the ceremony store
// (T8). A test that wants the honest-absent path calls `buildSentimentInput`
// with the reader it means, exactly as production does.