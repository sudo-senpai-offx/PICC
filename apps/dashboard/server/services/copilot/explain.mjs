// WS-7 T13 — the plain-English explanation layer. PURE, and the LAST thing a
// model is allowed to touch.
//
// §4.2:565 — "explain.mjs  # plain-English layer, provenance-marked".
// §4.1:533 — "The Copilot's decision path is a pure function of market state.
// The model layer sits outside it: the model may contribute the 5% Sentiment
// expert's input and may write prose, and it may do nothing else."
//
// WHY THIS FILE CANNOT IMPORT THE ENGINE. It CONSUMES an engine result and
// quotes it. If it could import `engine.mjs` it would be one refactor away from
// computing a score, and the only thing preventing that would be a convention.
// So the dependency runs the other way: this file imports `routing.mjs` for the
// two provenance literals and nothing else, and a test asserts that the import
// list is exactly `['./routing.mjs']`. Numbers enter as arguments and leave as
// quoted strings.
//
// WHY THE RETURNED OBJECT CARRIES NO DECISION FIELDS. `contracts.ts:121-139`
// draws the line: "A renderer that merged the two would let remote text acquire a
// score, which AC-014 names as a prohibited side effect." The strongest form of
// that guard is that the fields do not exist — a caller reaching for
// `explanation.tier` gets `undefined` rather than a plausible number. The
// forbidden names are exported as data so the list can be widened deliberately.
//
// THE PROSE QUOTES, IT DOES NOT COMPUTE. Every number in the text is stringified
// straight from the engine's own result. If the prose were free to compute, it
// could disagree with the score it is explaining, and a reader would have no way
// to tell which one the system meant.
//
// NO CLOCK. `at` is a caller-supplied argument, for the same reason T16's permit
// store made its timestamp one: a prose timestamp nobody can account for is not
// evidence. `contracts.ts`'s field is `generatedAt`; this module names it `at`
// because it is an input rather than something this module generates, and the
// BS-3 handoff records the rename a renderer must apply.

import { LOCAL_PROVENANCE, REMOTE_PROVENANCE } from "./routing.mjs"

/** `contracts.ts:102`'s `status` union, verbatim. */
export const EXPLANATION_STATUSES = Object.freeze(["ready", "pending", "stale", "unavailable"])

/**
 * Field names that must never appear on an explanation. Exported so the test
 * iterates the same list the module is held to, and so widening it is a
 * deliberate one-line edit rather than an omission.
 */
export const PROSE_FORBIDDEN_KEYS = Object.freeze([
  "score",
  "tier",
  "riskPct",
  "action",
  "vetoes",
  "firedVetoes",
  "automationPermitted",
  "rung",
  "rawDelta",
  "coveragePct",
  "weightPct",
  "regime",
  "confidence",
  "contributions",
  "activeBoosters",
  "conflictOverrides",
  "sentimentInput"
])

const CODES = Object.freeze({
  noResult: "explain:no-result",
  unknownProvenance: "explain:unknown-provenance",
  remoteWithoutModel: "explain:remote-without-model",
  noReason: "explain:no-reason",
  unknownStatus: "explain:unknown-status"
})

/**
 * Decimal places the prose shows for a 0-100 score.
 *
 * The engine's `score` is an UNROUNDED float — the fixture's is
 * `61.777777777777786` — because §4.4:689 requires tier boundaries to be exact
 * and unrounded, and `tiers.mjs` owns that. A plain-English layer that printed
 * the raw float would be quoting arithmetic residue as if it were the score, and
 * would invite a reader to compare `61.777777777777786` against the `85`
 * boundary and draw a conclusion the engine never drew.
 *
 * Two decimals is a PRESENTATION choice, and it is safe only because the tier
 * has already been decided: the prose quotes `tier.tier`, which `tiers.mjs`
 * computed from the unrounded value. The word "about" is not decoration — it
 * marks the number as a rendering of the engine's value rather than the value
 * itself, and the two tests below hold both halves of that.
 */
export const PROSE_SCORE_DECIMALS = 2

/**
 * Explain an engine result in plain English, with provenance.
 *
 * @param {object} params
 * @param {object} params.result An `evaluateCopilot` result. Its `confluence`
 *   and `tier` are QUOTED, never recomputed.
 * @param {"copilot: local"|"copilot: remote"} params.provenance Where the prose
 *   was computed. Required — there is no default, because an unattributed
 *   explanation is indistinguishable from a fabricated one.
 * @param {string|null} [params.model] Which model wrote the prose. Required for
 *   a remote explanation; must be `null`/absent for a local one.
 * @param {number|null} [params.at] Caller-supplied epoch ms. No clock is read.
 * @returns {object} The `contracts.ts` CopilotExplanation shape, minus the two
 *   fields this module does not manage (`cacheExpiresAt`) and with `at` named
 *   for what it is.
 */
export function explainDecision({ result, provenance, model = null, at = null } = {}) {
  const confluence = readConfluence(result)
  const claimed = assertProvenance(provenance, model)
  if (claimed === REMOTE_PROVENANCE) {
    assertModelNamed(model)
  }
  const prose = composeProse(confluence, result.tier, result.firedVetoes ?? [])


  return {
    status: "ready",
    provenance: claimed,
    model: claimed === REMOTE_PROVENANCE ? model : null,
    at,
    reason: null,
    redacted: true,
    text: prose.text,
    // The engine's unrounded value, as a string. A renderer may display it; a
    // computation must not read it, which is why it is not a number.
    exactScore: prose.exactScore
  }
}

/**
 * The honest answer when there is no explanation to give.
 *
 * `contracts.ts:108` requires the reason be shown, and AC-014 requires this be
 * shown. Every non-`ready` status returns `text: null` — a cached paragraph
 * served with `status: "stale"` is prose that looks live, which is the specific
 * dishonesty this shape exists to prevent.
 *
 * @param {object} params
 * @param {string} params.reason Required, non-empty.
 * @param {"pending"|"stale"|"unavailable"} [params.status] Defaults to
 *   `unavailable`.
 * @param {"copilot: local"|"copilot: remote"} [params.provenance]
 * @param {string|null} [params.model]
 * @param {number|null} [params.at]
 */
export function explainUnavailable({ reason, status = "unavailable", provenance = LOCAL_PROVENANCE, model = null, at = null } = {}) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    const err = new Error(
      "explain: a non-ready explanation must carry a non-empty reason. contracts.ts:108 requires it be shown, and an unavailable row with no reason is the fabrication the honesty contract forbids."
    )
    err.code = CODES.noReason
    throw err
  }
  if (!EXPLANATION_STATUSES.includes(status) || status === "ready") {
    const err = new Error(
      `explain: "${String(status)}" is not a non-ready status. Use one of ${EXPLANATION_STATUSES.filter((s) => s !== "ready").join(", ")}.`
    )
    err.code = CODES.unknownStatus
    throw err
  }
  const claimed = assertProvenance(provenance, model)
  if (claimed === REMOTE_PROVENANCE) assertModelNamed(model)

  return {
    status,
    provenance: claimed,
    model: claimed === REMOTE_PROVENANCE ? model : null,
    at,
    reason,
    redacted: true,
    text: null
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Build the prose from the engine's own values.
 *
 * Every number below is `String(...)` of something the engine computed. The
 * unavailable-expert clause is the one that matters most: §4.7:747 requires an
 * unavailable Sentiment to render "as one unavailable expert inside an otherwise
 * valid confluence, with the confidence penalty stated", and a plain-English
 * layer that quietly dropped the sentence would satisfy every other test here
 * while reintroducing the fabrication the sentence exists to prevent.
 */
function composeProse(confluence, tier, firedVetoes) {
  const parts = []
  let exactScore = null

  if (confluence.score === null) {
    parts.push(
      `The confluence engine returned no score for this ${confluence.regime} state, so there is nothing to set up.`
    )
  } else {
    const shown = confluence.score.toFixed(PROSE_SCORE_DECIMALS)
    parts.push(
      `The confluence engine scored this ${confluence.regime} state about ${shown} out of 100 at ${confluence.confidence} confidence, which is tier ${tier.tier}.`
    )
    // The exact value is carried alongside the rounded one so a consumer can
    // show it without this module deciding how. It is a STRING, so it can never
    // be read as a number a renderer might feed back into a computation.
    exactScore = String(confluence.score)
  }

  const missing = confluence.contributions.filter((c) => c.available === false)
  if (missing.length === 0) {
    parts.push("All six experts contributed, so no weight is missing from the confluence.")
  } else {
    const names = missing.map((c) => c.expert).join(", ")
    parts.push(
      `${missing.length} of the six experts did not contribute (${names}). Their share of the confluence is a hole rather than a neutral score, and the ${confluence.confidence} confidence reflects it.`
    )
  }

  const sentiment = confluence.contributions.find((c) => c.expert === "sentiment")
  if (sentiment !== undefined && sentiment.available === false) {
    parts.push(
      `The Sentiment expert is unavailable: ${sentiment.unavailableReason ?? "no reason recorded"}. This is an absence, not a neutral reading.`
    )
  }

  if (firedVetoes.length > 0) {
    parts.push(
      `${firedVetoes.length} veto fired (${firedVetoes.join(", ")}), which overrides the score outright.`
    )
  } else {
    parts.push("No veto fired.")
  }

  if (tier.automationPermitted !== true && tier.tier === "A+") {
    parts.push("This is an A+ setup, but automation is not permitted for the broker, so it is held for your approval rather than executed.")
  }

  return { text: parts.join(" "), exactScore }
}

function readConfluence(result) {
  if (result === null || typeof result !== "object") {
    const err = new Error("explain: an engine result is required; there is nothing to explain without one.")
    err.code = CODES.noResult
    throw err
  }
  const confluence = result.confluence
  if (confluence === null || typeof confluence !== "object" || !Array.isArray(confluence.contributions)) {
    const err = new Error(
      "explain: the engine result has no `confluence` with a `contributions` array. A malformed result is refused rather than explained, because a plausible paragraph about nothing is worse than no paragraph."
    )
    err.code = CODES.noResult
    throw err
  }
  if (result.tier === null || typeof result.tier !== "object" || typeof result.tier.tier !== "string") {
    const err = new Error("explain: the engine result has no `tier`; the prose quotes the tier and will not invent one.")
    err.code = CODES.noResult
    throw err
  }
  return confluence
}

function assertProvenance(provenance, model) {
  if (provenance === LOCAL_PROVENANCE || provenance === REMOTE_PROVENANCE) return provenance
  const err = new Error(
    `explain: ${JSON.stringify(provenance ?? null)} is not a recognised provenance. Use ${LOCAL_PROVENANCE} or ${REMOTE_PROVENANCE} — contracts.ts:99 types only the remote literal, and an unrecognised value would make a local rendering indistinguishable from a provider's.`
  )
  err.code = CODES.unknownProvenance
  throw err
}

function assertModelNamed(model) {
  if (typeof model === "string" && model.trim().length > 0) return
  const err = new Error(
    `explain: a ${REMOTE_PROVENANCE} explanation must name the model that wrote it. T16 refused an unattributed automation grant for exactly this reason, and an unattributed remote claim is the same defect.`
  )
  err.code = CODES.remoteWithoutModel
  throw err
}
