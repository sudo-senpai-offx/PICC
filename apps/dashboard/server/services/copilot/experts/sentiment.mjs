// WS-7 T11 — expert 6 of 6: SENTIMENT. Weight 5% (spec §4.4:687).
//
// §4.2:548 — "sentiment.mjs  # 5%  - MODEL INPUT ONLY"
// §4.4:687 — "Sentiment | 5% | news NLP | +5 / −5"
//
// THIS IS THE MODEL SEAM AND T11 DOES NOT FILL IT.
//
// §4.1:533 is the binding rule: "If the model is unavailable, the Sentiment
// expert reports unavailable and the remaining 95% still produces a score with
// an honest confidence penalty — never a fabricated sentiment and never a
// silent renormalization that hides the gap."
//
// So in T11 this expert is STRUCTURALLY UNAVAILABLE: there is no model on this
// path (spec :1292, "No model on this path"), and the honest output is the
// unavailable one. That is not a stub pretending to work — it is the state the
// spec asks T11 to ship, and it is what makes T13's bisect line (spec :1316)
// true by construction: removing the model layer leaves the engine scoring.
//
// WHAT THIS MODULE MUST NEVER DO:
//   - invent a neutral 0 (that is a fabricated sentiment reading as a middle);
//   - read a model, import a model, or reach the network;
//   - accept a caller-supplied number without the provenance that says where it
//     came from.
//
// The input is consumed, not produced. `evaluate()` takes the value the model
// layer put on `state.sentimentInput` and validates its shape; T13 wires the
// producer. T11's own tests supply a stub to prove the AVAILABLE path works,
// which is why the seam is complete rather than merely absent.
//
// BAND: [−5, +5] straight from §4.4:687.

import { bandToScore } from "../confluence.mjs"

export const EXPERT_ID = "sentiment"
export const WEIGHT_PCT = 5

export const BAND = Object.freeze({ min: -5, max: 5 })

/**
 * The reason reported whenever no model input is present. Named and constant
 * so a room can grep for it, and so the T13 owner sees exactly what T11 left.
 */
export const NO_MODEL_INPUT_REASON =
  "no model sentiment input on this state — WS-7 T11 ships the seam without a model (spec §4.1:533); T13 supplies the 5% input"

/**
 * @param {object} state A frozen state from `deriveMarketState`.
 * @returns {{rawDelta: number|null, available: boolean, unavailableReason: string|null,
 *            subScore: number|null, legs: object|null}}
 */
export function evaluate(state, _context = {}) {
  const input = state.sentimentInput

  if (input === null || input === undefined) {
    return unavailable(NO_MODEL_INPUT_REASON)
  }
  if (typeof input !== "object") {
    return unavailable(`sentimentInput must be an object with { score, source }; received ${typeof input}`)
  }

  const { score, source } = input

  if (score === null || score === undefined) {
    // The model ran and produced nothing. That is a DIFFERENT fact from the
    // model not running, and the reason says so — collapsing them would hide
    // a model that is answering "no signal" behind one that is absent.
    return unavailable(
      `the model sentiment input reported no score (source: ${String(source ?? "unnamed")}) — absent is not neutral`
    )
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return unavailable(`sentimentInput.score must be a finite number; received ${String(score)}`)
  }
  if (score < -1 || score > 1) {
    return unavailable(`sentimentInput.score must be within -1..1; received ${score}`)
  }

  // -1..1 mapped onto the spec's ±5 band.
  const rawDelta = score * 5

  return {
    rawDelta,
    available: true,
    unavailableReason: null,
    subScore: bandToScore(rawDelta, BAND),
    legs: { sentiment: { delta: rawDelta, score, source: String(source ?? "unnamed") } }
  }
}

function unavailable(reason) {
  return { rawDelta: null, available: false, unavailableReason: reason, subScore: null, legs: null }
}
