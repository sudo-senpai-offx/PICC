// WS-7 T11 — the SHARED tier boundary fixture.
//
// AC-023:952 is the authority for the boundary itself:
//   "85+ → A+ (1% risk); 70–84 → B (0.5%, notify for approval); <70 → ignore,
//    stay in cash. No interpolation band exists."
// AC-023:953 prohibits "a value between 84 and 85" being rounded or
// interpolated into A+, and the verification is "a table-driven boundary
// test".
//
// WHY A SEPARATE FIXTURE FILE (plan v1 §2, Risk 6). The server engine
// (`tiers.mjs`) is AUTHORITATIVE for `ExecutionTier`. The client projection at
// `src/terminal/domain/copilotDecision.ts:122-127` must produce the same tier
// for the same score. Two copies of a safety boundary drift, so both copies are
// pinned against THIS ONE fixture rather than against each other's prose.
//
// The cases are split into two tables because they assert two different
// things, and conflating them is how a "≥85" quietly becomes ">85":
//
//   BOUNDARY_CASES  — the integers AC-023:950 names (69, 70, 84, 85, 86).
//                     These pin WHICH side of each boundary the value falls.
//   NO_ROUNDING_CASES — 84.4 / 84.5 / 84.9 (plan v1 §3.1 item 4). These pin
//                     that the engine does not round a value that is above 84
//                     but below 85 up into A+.
//
// Frozen, and in declared order: the engine's own iteration over this file is
// an observable order, so AC-021 forbids it being unordered.

/** The AC-023 band definitions, as data. `atOrAbove` is exact and exclusive-of-nothing. */
export const TIER_BOUNDARIES = Object.freeze([
  Object.freeze({ tier: "A+", minScore: 85, riskPct: 0.01 }),
  Object.freeze({ tier: "B", minScore: 70, riskPct: 0.005 }),
  Object.freeze({ tier: "ignore", minScore: null, riskPct: 0 })
])

/** A+ starts at 85 exactly (AC-023:952). Named so the magic number has an owner. */
export const APLUS_MIN_SCORE = 85

/** B starts at 70 exactly (AC-023:952). */
export const B_MIN_SCORE = 70

/**
 * The `null` case, pinned as data rather than left to a reader of the code.
 *
 * `null` is "the engine could not score this", which is a DIFFERENT fact from
 * a score of 0. 0 is a legitimate confluence result meaning "the engine looked
 * and found nothing". Conflating them is the exact failure the availability
 * contract exists to prevent — and it is why AC-023 lists `<70 → ignore` and
 * not `≤0 → ignore`.
 */
export const UNSCOREABLE_CASE = Object.freeze({
  label: "null score is unscoreable, not zero",
  score: null,
  tier: "ignore",
  riskPct: 0
})

/** A real zero IS a real score and must map to `ignore` on its own merits. */
export const ZERO_CASE = Object.freeze({
  label: "a score of 0 is a real result, not an absence",
  score: 0,
  tier: "ignore",
  riskPct: 0
})

/** The integers AC-023:950 names, verbatim. */
export const BOUNDARY_CASES = Object.freeze([
  Object.freeze({ label: "69 is below 70", score: 69, tier: "ignore", riskPct: 0 }),
  Object.freeze({ label: "70 is the first B", score: 70, tier: "B", riskPct: 0.005 }),
  Object.freeze({ label: "84 is the last whole B", score: 84, tier: "B", riskPct: 0.005 }),
  Object.freeze({ label: "85 is the first A+", score: 85, tier: "A+", riskPct: 0.01 }),
  Object.freeze({ label: "86 is comfortably A+", score: 86, tier: "A+", riskPct: 0.01 })
])

/**
 * AC-023:953's prohibited side effect, as executable data. Each of these is
 * above 84 and below 85, and every one of them must stay `B`. A `>= 85`
 * boundary passes all three. A `> 84` boundary, or any rounding to a whole
 * number, fails them.
 */
export const NO_ROUNDING_CASES = Object.freeze([
  Object.freeze({ label: "84.4 does not round up into A+", score: 84.4, tier: "B", riskPct: 0.005 }),
  Object.freeze({ label: "84.5 does not round up into A+", score: 84.5, tier: "B", riskPct: 0.005 }),
  Object.freeze({ label: "84.9 does not round up into A+", score: 84.9, tier: "B", riskPct: 0.005 })
])

/**
 * Everything AC-023 requires the boundary to do, in one ordered table. The
 * parity test and the server boundary test both iterate exactly this.
 */
export const ALL_BOUNDARY_CASES = Object.freeze([
  UNSCOREABLE_CASE,
  ZERO_CASE,
  ...BOUNDARY_CASES,
  ...NO_ROUNDING_CASES
])

/**
 * Scores outside every named boundary, so the table also proves the top and
 * bottom of the range behave and that `clamp` did not leak out.
 */
export const EXTREME_CASES = Object.freeze([
  Object.freeze({ label: "0 is the floor of the range", score: 0, tier: "ignore", riskPct: 0 }),
  Object.freeze({ label: "100 is the ceiling and is A+", score: 100, tier: "A+", riskPct: 0.01 })
])
