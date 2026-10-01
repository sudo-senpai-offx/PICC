// WS-7 T13 — the PRODUCER for T11's sentiment seam. T11 left this unfilled on
// purpose; T13 fills it, and T11's `experts/sentiment.mjs` is not modified.
//
// T11's own header, `experts/sentiment.mjs:6-28` — "THIS IS THE MODEL SEAM AND
// T11 DOES NOT FILL IT [...] `evaluate()` takes the value the model layer put on
// `state.sentimentInput` and validates its shape; T13 wires the producer."
//
// §4.1:533 — "If the model is unavailable, the Sentiment expert reports
// unavailable and the remaining 95% still produces a score with an honest
// confidence penalty — never a fabricated sentiment and never a silent
// renormalization that hides the gap."
//
// EVERY UNAVAILABLE PATH RETURNS `input: null`, NEVER A NUMBER. That is the whole
// contract. A `0` here would map onto the middle of the ±5 band and be
// indistinguishable from a measured neutral, which is the fabrication §4.1:533
// names first. T11's expert would then report `available: true` and the
// confidence penalty would silently disappear.
//
// VERIFY BEFORE INFER. `read()` runs the same gate `scripts/model-digest-gate.mjs`
// runs, and it does so BEFORE it will call the backend. The ordering is the
// control: a reader that inferred first and verified afterwards would already
// have executed the artifact's contents by the time D15's check ran, making the
// check a receipt rather than a gate. Tests assert `backend.calls` is empty on
// every verification failure.
//
// THE BACKEND IS INJECTED AND ITS ABSENCE IS THE DEFAULT. Needle 3 is a
// Cactus-proprietary runtime with no npm package, and its published repository
// carries `linux-*`, `macos-*`, `android-*`, `ios-*`, `tvos-*` and `wasm` builds
// and NO `windows-*` build (`modelManifest.mjs`, the `needle3` ARM64 row). There
// is therefore no in-process runtime available to this repository's dev host.
// Rather than ship a stub that returns 0 — a fabricated neutral wearing the
// costume of a working model — the default backend is `null` and
// `defaultBackendAbsenceReason()` says precisely what is missing.
//
// NO CLOCK, NO RANDOMNESS. A sentiment reading is a pure function of (verified
// artifact, headlines, backend).

import { runGate } from "./digestGate.mjs"
import { manifest as buildManifest } from "./modelManifest.mjs"

const CODES = Object.freeze({
  noRequest: "sentiment:no-request",
  noBackend: "sentiment:no-backend"
})

export { CODES as SENTIMENT_CODES }

/**
 * The reason reported when no backend is supplied. Named and exported so a room
 * or a runbook can match on it, and so a test can assert the layer is honest
 * about WHICH half is missing.
 */
export function defaultBackendAbsenceReason() {
  return (
    "the model artifact is present and verified, but no inference backend is registered for it. " +
    "Needle 3 is a Cactus-proprietary runtime with no npm distribution, and its published repository " +
    "carries linux/macos/android/ios/tvos/wasm builds and no windows build, so no in-process runtime is " +
    "available on this host. This is an ABSENCE, not a neutral reading: supply a backend, or run with the " +
    "model layer disabled and let the 95% score with its honest confidence penalty (spec §4.1:533)."
  )
}

/**
 * Build a sentiment reader.
 *
 * @param {object} params
 * @param {string} params.modelDir The artifact directory. Absolute.
 * @param {object} [params.manifest] Defaults to the committed manifest.
 * @param {{id: string, sentimentOf(texts: string[]): number}} [params.backend]
 *   The inference runtime. Its return value must be a finite number in -1..1.
 *   `null`/omitted is the honest default and yields an unavailable reading.
 * @param {boolean} [params.enabled] Default `true`. `false` makes the layer
 *   fully disableable — T13:1316's bisect line — without touching the artifact
 *   or the backend.
 * @returns {{read: (request: object) => object, enabled: boolean, backendId: string|null}}
 */
export function createSentimentReader({ modelDir, manifest = buildManifest(), backend = null, enabled = true } = {}) {
  if (typeof modelDir !== "string" || modelDir.length === 0) {
    const err = new Error("sentiment: a model directory is required; there is nowhere to verify an artifact.")
    err.code = CODES.noRequest
    throw err
  }

  return Object.freeze({
    enabled: enabled === true,
    backendId: backend === null || typeof backend !== "object" ? null : String(backend.id ?? "unnamed"),
    read(request) {
      return readOnce({ request, modelDir, manifest, backend, enabled })
    }
  })
}

// ---------------------------------------------------------------------------

function readOnce({ request, modelDir, manifest, backend, enabled }) {
  // 1. Is the layer switched on? Checked first, so a disabled layer costs
  //    nothing and touches nothing.
  if (enabled !== true) {
    return unavailable(
      "the Copilot model layer is disabled for this evaluation. T13:1316 requires it to be fully disableable: with it off the deterministic engine still scores, with Sentiment unavailable and an honest confidence penalty."
    )
  }

  // 2. A caller bug is a throw; a model that cannot answer is a reading. The
  //    same distinction `marketState.mjs:17-23` draws for a malformed candle.
  if (request === null || request === undefined || typeof request !== "object" || Array.isArray(request)) {
    const err = new Error(
      `sentiment: read() needs a { headlines: string[] } request; received ${request === null ? "null" : Array.isArray(request) ? "an array" : typeof request}.`
    )
    err.code = CODES.noRequest
    throw err
  }

  const headlines = request.headlines
  if (!Array.isArray(headlines) || headlines.length === 0 || !headlines.every((h) => typeof h === "string")) {
    return unavailable(
      `the sentiment request must carry a non-empty array of headline strings; received ${describeHeadlines(headlines)}. ` +
        `T18 owns the digest's sources and provenance (D17); T13 supplies no source of its own and will not infer over an empty input.`
    )
  }

  // 3. VERIFY, THEN INFER. The gate is the same one CI runs.
  const gate = runGate({ modelDir, manifest })
  if (!gate.ok) {
    return unavailable(
      `the model artifact failed D15's supply-chain gate, so it was not loaded and nothing was inferred: ${summariseGate(gate)}`
    )
  }

  // 4. Only now is the backend reachable.
  if (backend === null || typeof backend.sentimentOf !== "function") {
    return unavailable(defaultBackendAbsenceReason())
  }

  const score = backend.sentimentOf(headlines)
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return unavailable(
      `the inference backend "${String(backend.id ?? "unnamed")}" returned ${JSON.stringify(score ?? null)}, which is not a finite number. ` +
        `A backend returning anything other than a number in -1..1 is not a sentiment model, and its output may not reach the 5% band.`
    )
  }
  if (score < -1 || score > 1) {
    return unavailable(
      `the inference backend "${String(backend.id ?? "unnamed")}" returned ${score}, which is outside -1..1. ` +
        `T11's expert maps -1..1 onto the ±5 band and would clamp a larger value into a confident opinion the model did not express.`
    )
  }

  return {
    available: true,
    input: {
      score,
      source: `${String(backend.id ?? "unnamed")} via needle3.cact (sha256-verified, D15)`
    },
    reason: null
  }
}

function unavailable(reason) {
  return { available: false, input: null, reason }
}

function describeHeadlines(headlines) {
  if (headlines === undefined) return "nothing"
  if (!Array.isArray(headlines)) return `a ${typeof headlines}`
  if (headlines.length === 0) return "an empty array"
  return `an array of ${headlines.length} entries, at least one of which is not a string`
}

/**
 * The gate's failures, compressed to what an operator acts on. The detected
 * FORMAT is included because "the gate failed" does not tell anyone whether the
 * problem was a digest, a missing file, or a pickle renamed to look safe — and
 * the last of those is the one D15 exists for.
 */
function summariseGate(gate) {
  return gate.failures
    .map((f) => `[${f.code}] ${f.subject}${f.format ? ` (content reads as ${f.format})` : ""}`)
    .join("; ")
}
