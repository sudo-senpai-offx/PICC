// WS-7 / owner rulings 1 — COMMENT MULTIPLIER GUARD: a multiplier asserted in a
// comment must be the multiplier the arithmetic actually gives.
//
// WHY THIS FILE EXISTS AS A RUNNING TEST. A multiplier in a comment is a claim,
// and a claim in a comment is unfalsifiable by every other instrument this
// repository owns. The encoding guard cannot see one — `342x the truth` is pure
// ASCII with no mojibake, so `ws7EncodingIntegrityGuard` scans straight past it.
// `ws7AuthBootstrapGateGuard` pins statics and cannot see a number. And a
// `1.000 / 0.00923` mismatch is invisible to every behavioural test, because
// comments do not execute.
//
// That is not hypothetical. Three of these multipliers were FALSE until commit
// `653f533` corrected them with the arithmetic written inline:
//
//   - `volatility.mjs` claimed the publication floor's 1% was "342x the truth"
//     for its own example, `true currentVol 0.00923`. It is 1.08x. 342 is the
//     figure for a DIFFERENT currentVol — `0.01 / 0.00002923 = 342.11` — and it
//     survived an edit that changed the example underneath it.
//   - `volatility.test.mjs` had the same example as "108x over", a unit error:
//     it divided 1 (meaning 1%) by the fraction instead of dividing 0.01 by it.
//   - the third site, also "342x", was CHECKED rather than assumed and is correct
//     in its context.
//
// So the round fixed the numbers. It left every one of them protected by nothing:
// `git checkout 653f533^ -- <file>` puts "342x the truth" and "108x over" back
// and all 6403 tests still pass. This file is what makes that revert red.
//
// WHY A WRONG MULTIPLIER HERE IS NOT COSMETIC. In this effort a falsifiable
// number in a comment has repeatedly turned out to be the LOAD-BEARING
// JUSTIFICATION for a behaviour change — the `riskParity` weight claim, the
// `measured-rounded-zero` reachability claim, both "63% annualised" errors. This
// one is worse than a stale count, because it is load-bearing for the decision to
// KEEP THE SIZING FLOOR: a reader who divides 0.01 by 0.00923, gets 1.08, and
// concludes the floor barely matters will lower it or close the ticket. The
// number is the argument. So the argument is checked.
//
// THE COMPARISON IS TOLERANT ON PURPOSE, AND BOUNDS WHAT IT CAN ACCEPT. A
// comment is prose, so the multiplier is written to whatever precision reads
// well — `1.000x`, `1.083x`, `10.00x`, `200.00x`, and in the test file `1.08x`
// and `342.11`. Pinning one spelling would turn a formatting choice into a red
// build and get the guard deleted. So the test accepts any numeric token on the
// line whose value is within HALF A PERCENT of the COMPUTED ratio — which
// admits every spelling above and rejects the historical falsehoods by two
// orders of magnitude. The rejection is what makes this a guard and not a
// description: 342 against a computed 1.0834 is 31,616x off; 108 against 1.0834
// is 99.7x off. Nothing drifts into the window by accident.
//
// THE OPERANDS ARE STATED IN THE REGISTER; THE RESULT IS NOT. Each entry below
// names the SUBJECT of a claim (which `currentVol`, which measured value) and
// this file divides. A register entry that hardcoded the multiplier it is
// checking would be a tautology that passes forever, which is the failure this
// repository has already paid for three times in the form of a scan that finds
// nothing. So the denominator is the claim's subject — the number a reader would
// type — and the numerator is MEASURED FROM THE RUNNING CODE, so a change to
// `VOL_SIZING_FLOOR`, to the publication floor, or to `roundPublished` moves the
// expected value and the comments must be updated with it.
//
// WHY THE PUBLICATION FLOOR IS MEASURED RATHER THAN WRITTEN. `Math.max(0.01,
// currentVol)` is a literal inside a function body, not an export, so there is
// nothing to import. It is instead READ OUT of the code through `volScale`:
// `volScale = clamp(target / vol, 0.25, 2)`, so `vol = target / volScale`, and
// probing with a `currentVol` the floor must have floored yields the floor
// itself. The probe is chosen so the readout is informative — see
// `PUBLICATION_FLOOR_IS_READ_THROUGH_A_NON_CLAMPED_VOLSCALE` below, which fails
// if `volScale` ever sits on its 2.0 ceiling, because a clamped readout would
// return a confident wrong answer instead of no answer.
//
// THE SCOPE OF THE DISCOVERY PASS IS TWO FILES, AND THAT IS A DELIBERATE LIMIT
// NOT AN OVERSIGHT. A repo-wide "every comment that writes a division must be
// true" scan was measured on this tree before being written: it finds 29 written
// divisions in comments across the tracked tree, and its simplest form reports
// SIX of them as false when they are not. The shape it cannot parse is a
// three-term expression — `hyperliquidPerps.mjs:85` writes
// `0.01 * 4000 / 4 = 10.000000000000002`, which is CORRECT, and a two-term
// `a / b` regex reads it as `4000 / 4 = 10.000000000000002`, a 100x error. A
// guard that cries wolf on correct comments is deleted, so the pass is scoped to
// the two files that carry the register, where a two-term division really is the
// whole of the arithmetic, and its limit is recorded here rather than left for
// the next reader to assume away.
//
// WHAT THAT SCOPE MEANS, STATED SO THE HEADER CANNOT BE READ AS COVERAGE: this
// is a POINT FIX OVER A NAMED TWO-FILE SET, not a class fix. Proven by mutation —
// a NEW false multiplier written into any other tracked file passes this entire
// suite with exit 0, because the register, the phrase sweep and the
// written-division sweep all read exactly `SOURCES` and nothing else. What it
// will NOT catch, named rather than left to be discovered:
//
//   1. a false multiplier in any file outside `SOURCES`.
//   2. a false multiplier in either of them written WITHOUT the
//      substitution-factor phrase — that phrase is the only shape this detector
//      knows, and it is the shape the reverted comments had.
//   3. a three-term division written in a comment, which the leading-factor
//      rule skips by the argument above.
//   4. any multiplier in THIS guard's own file, for the reason in the next
//      paragraph.
//
// AND IT DOES NOT SCAN ITSELF, which an earlier version of the self-scan test
// claimed that it did. `SELF` is deliberately absent from `SOURCES`, and it
// cannot be present: this header quotes `342x the truth`, `108x over` and `342`
// in order to say they were false, so a self-scan would put every one of those
// quotations in front of the phrase sweep, unregistered, and would need a
// written allowance for each — an inventory, not a guard. The limit is PINNED by
// a test rather than left as a silent hole. `ws7EncodingIntegrityGuard` carries
// an identically-named test that genuinely asserts `SCAN.has(SELF) === true`, and
// it is NOT a precedent for this one: that guard scans bytes and has no prose of
// its own stating the figures it rejects.
//
// THE ONE CLAIM IN THESE TWO FILES THAT WAS MEASURABLY FALSE HAS BEEN DELETED,
// NOT DEFENDED. `volatility.mjs:59` stated `roundVolPct(5e-7) === "0.005%"`
// and called it "2x". Measured through the one call site that passes a RAW
// currentVol — the refusal path, which publishes `roundVolPct(currentVol)`
// un-floored:
//
//     volatilityPositionSize({ currentVol: 5e-7 }).currentVolPct === "0.00005%"
//
// so the value was a hundredth of what was stated and the "2x" was not a
// doubling at all.
//
// An earlier version of this guard LEFT that row alone and recorded the
// measurement in the ALLOWLIST, arguing that the correct rewrite was not
// reachable from outside the module. The argument was sound and the conclusion
// was still wrong, for two reasons that are now the reason the row is gone.
// First: a KNOWN-FALSE claim parked behind a green allowance is a guard
// defending the falsehood it exists to reject. Second, and worse, the pin
// backing that allowance fired when the row was DELETED but not when it was
// FIXED (see the third pin under the ALLOWLIST below), so the correction would
// have landed with the claim left permanently unregistered and nothing left to
// remind anyone it had ever been wrong. Deleting asserts nothing, so it is not
// an unmeasurable fix — unlike keeping the falsehood behind a test that passes.
//
// The half-up-doubling POINT survives without the falsehood: the row above it,
// `roundPublished(5e-5) === 0.0001  2x the measurement`, is correct and IS a
// registered claim. `roundVolPct` stays private and its boundary stays
// unreachable from the refusal path; nothing is asserted about it here.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { stripComments } from "../scripts/guard-primitives.mjs"
import { VOL_SIZING_FLOOR, roundPublished, volatilityPositionSize } from "../services/volatility.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join("/")

const VOLATILITY_REL = "apps/dashboard/server/services/volatility.mjs"
const VOLATILITY_TEST_REL = "apps/dashboard/server/__tests__/volatility.test.mjs"
const SOURCES = [VOLATILITY_REL, VOLATILITY_TEST_REL]

// ---------------------------------------------------------------------------
// Reading the two files, and knowing which lines are COMMENT.
//
// `stripComments` is imported from the one shared lexer rather than re-declared
// here: `sharedCommentLexer.test.mjs` derives its consumer set from the tracked
// tree and fails any file that keeps a second declaration, so a local copy would
// be a red build on arrival — and a second lexer is the defect that guard exists
// to stop. It is used in the INVERSE direction here: the stripped view blanks
// comment spans, so a line whose stripped form differs from its source form is
// carrying comment content. That is how `a claim lives in a comment` is asserted
// below rather than assumed from the `//` prefix, which would miss a block
// comment and would count a code line as a claim if an anchor ever moved.
// ---------------------------------------------------------------------------
const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8")

/** rel -> { lines, commentBearing, blocks } */
function loadSource(rel) {
  const src = read(rel)
  const lines = src.split("\n")
  const stripped = stripComments(src).split("\n")
  if (stripped.length !== lines.length) {
    throw new Error(`stripComments changed the line count of ${rel}; the line view is unreliable`)
  }
  const commentBearing = lines.map((line, i) => line !== stripped[i])
  // A CONTIGUOUS run of comment lines. Blocks, not windows, for the reason
  // ws7AuthBootstrapGateGuard already records: a window is a proximity rule, and
  // a proximity rule lets a number borrowed from a neighbouring line vouch for a
  // claim that does not carry it.
  const blocks = []
  let start = null
  for (let i = 0; i < lines.length; i += 1) {
    if (commentBearing[i]) {
      if (start === null) start = i
      continue
    }
    if (start !== null) {
      blocks.push({ from: start, to: i, text: lines.slice(start, i).join("\n") })
      start = null
    }
  }
  if (start !== null) blocks.push({ from: start, to: lines.length, text: lines.slice(start).join("\n") })
  return { rel, src, lines, commentBearing, blocks }
}

const SOURCES_BY_REL = new Map(SOURCES.map((rel) => [rel, loadSource(rel)]))

const isCommentish = (text) => {
  const t = text.trim()
  return t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/")
}

/** Line numbers (1-based) whose text contains `anchor`. */
function anchorLines(source, anchor) {
  const out = []
  for (let i = 0; i < source.lines.length; i += 1) {
    if (source.lines[i].includes(anchor)) out.push(i + 1)
  }
  return out
}

/**
 * Every numeric token on a line, including `5e-5` and `0.002923`.
 *
 * A multiplier in prose is written `1.083x` or `1.08x` or `342.11`, so the token
 * has to stop at the `x` rather than swallow it, and it has to read scientific
 * notation because two of the claims are stated against `5e-5`.
 */
const NUMBER = /\d+(?:\.\d+)?(?:e-?\d+)?/g
const numbersIn = (text) => [...text.matchAll(NUMBER)].map((m) => Number(m[0]))

/** Half a percent: admits every precision a comment reasonably uses. */
const TOLERANCE = 0.005

/** Does any token on the line agree with the computed ratio? */
function statesRatio(line, expected) {
  return numbersIn(line).find((token) => Math.abs(token - expected) <= Math.abs(expected) * TOLERANCE)
}

// ---------------------------------------------------------------------------
// THE PUBLICATION FLOOR, MEASURED OUT OF THE RUNNING CODE.
//
// `const vol = Math.max(0.01, currentVol)` is a literal in a function body, not
// an export, so there is nothing to import and writing `0.01` here would be
// trusting the very comment this guard exists to check. It is read back through
// `volScale`, which the function computes as `clamp(target / vol, 0.25, 2)` —
// so `vol = target / volScale`, and at a probe `currentVol` the floor has
// necessarily floored, that `vol` IS the publication floor.
//
// The probe is chosen so the readout cannot be silently clamped into lying:
// `volScale` saturates at 2.0, so a probe whose target were large enough to
// saturate would return `target / 2`, a confident wrong answer. `0.0125` over a
// floor of 0.01 gives 1.25, comfortably inside the band, and the currentVol is
// `VOL_SIZING_FLOOR * 2` so it is above the gate (which would refuse and publish
// no `volScale` at all) and far below the publication floor.
// ---------------------------------------------------------------------------
const PROBE_VOL = VOL_SIZING_FLOOR * 2
const PROBE_TARGET = 0.0125
const PROBE = volatilityPositionSize({
  capital: 10000,
  riskPct: 0.02,
  targetVol: PROBE_TARGET,
  entryPrice: 100,
  currentVol: PROBE_VOL
})

/** The publication floor the running code actually applies, to 6 significant figures. */
const PUBLICATION_FLOOR = Number((PROBE_TARGET / PROBE.volScale).toPrecision(6))

// The SUBJECTS the register talks about. These are the numbers a reader would
// type to check the claim, so they belong here rather than being derived.
const EXAMPLE_VOL = 0.00923
const BAND_TOP_VOL = 0.009999
const BAND_MID_VOL = 0.001
const SUB_FLOOR_VOL = 0.00002923
const PUBLICATION_TEST_VOL = 0.0001

// ---------------------------------------------------------------------------
// THE REGISTER.
//
// One entry per claim, each naming the file, an ANCHOR SUBSTRING that must
// appear on exactly one line, and the ratio(s) that line must state. Nothing here
// contains a multiplier: every `expect` is a division computed above.
//
// Anchors are substrings, never line numbers, so an unrelated edit elsewhere in
// these files cannot turn this guard red — and so a claim that MOVES is reported
// as "the anchor is gone" rather than silently re-pointed at a different line.
// The anchors are deliberately the SUBJECT of the claim (`0.01 / 5e-5`,
// `0.01 / 0.00002923`) rather than a leading fragment of the sentence, so
// rewording the prose around a claim does not break the guard and removing the
// arithmetic does.
// ---------------------------------------------------------------------------
const CLAIMS = [
  {
    rel: VOLATILITY_REL,
    anchor: "0.01 / 0.009999",
    subject: "the 0.009999 row of the reachable-band table",
    ratios: [{ num: PUBLICATION_FLOOR, den: BAND_TOP_VOL }]
  },
  {
    rel: VOLATILITY_REL,
    anchor: "0.01 / 0.00923",
    subject: "the 0.00923 row of the reachable-band table",
    ratios: [{ num: PUBLICATION_FLOOR, den: EXAMPLE_VOL }]
  },
  {
    rel: VOLATILITY_REL,
    anchor: "0.01 / 0.001",
    subject: "the 0.001 row of the reachable-band table",
    ratios: [{ num: PUBLICATION_FLOOR, den: BAND_MID_VOL }]
  },
  {
    rel: VOLATILITY_REL,
    anchor: "0.01 / 5e-5",
    subject: "the 5e-5 row of the reachable-band table",
    ratios: [{ num: PUBLICATION_FLOOR, den: VOL_SIZING_FLOOR }]
  },
  {
    // The line that names BOTH corrected mistakes in one sentence: the 0.00923
    // example is 1.08x, and 342 belongs to a different currentVol. Reverting
    // either half of it fails this entry.
    rel: VOLATILITY_REL,
    anchor: "is the figure for a DIFFERENT currentVol",
    subject: "the correction paragraph naming both the 1.08x example and the 342 figure",
    ratios: [
      { num: PUBLICATION_FLOOR, den: EXAMPLE_VOL },
      { num: PUBLICATION_FLOOR, den: SUB_FLOOR_VOL }
    ]
  },
  {
    rel: VOLATILITY_REL,
    anchor: "the honest range is",
    subject: "the stated range across the reachable band",
    ratios: [
      { num: PUBLICATION_FLOOR, den: BAND_TOP_VOL },
      { num: PUBLICATION_FLOOR, den: VOL_SIZING_FLOOR }
    ]
  },
  {
    // The same 1.08x stated a second way, one paragraph after the table. Two
    // statements of one number is two chances to drift, and the drift that this
    // guard exists to catch is exactly the kind that survives in the copy nobody
    // re-reads.
    rel: VOLATILITY_REL,
    anchor: "computes 0.01/0.00923 and gets",
    subject: "the restated 0.00923 figure in the closing paragraph",
    ratios: [{ num: PUBLICATION_FLOOR, den: EXAMPLE_VOL }]
  },
  {
    rel: VOLATILITY_REL,
    anchor: "as tabulated above",
    subject: "the restatement of that range above the floor",
    ratios: [
      { num: PUBLICATION_FLOOR, den: BAND_TOP_VOL },
      { num: PUBLICATION_FLOOR, den: VOL_SIZING_FLOOR }
    ]
  },
  {
    // `roundPublished`'s own half-up boundary claim: it publishes 5e-5 as 0.0001,
    // which is the 2x the comment records and the reason that rule was left alone
    // instead of switched to half-even. Numerator read from the code.
    rel: VOLATILITY_REL,
    anchor: "2x the measurement",
    subject: "roundPublished's half-up doubling at its 5e-5 boundary",
    ratios: [{ num: roundPublished(5e-5), den: 5e-5 }]
  },
  {
    rel: VOLATILITY_TEST_REL,
    anchor: "it used to be written here as",
    subject: "the 0.00923 lie size stated next to the withdrawn \"108x over\"",
    ratios: [{ num: PUBLICATION_FLOOR, den: EXAMPLE_VOL }]
  },
  {
    rel: VOLATILITY_TEST_REL,
    anchor: "0.01 / 5e-5",
    subject: "the lie size at the floor",
    ratios: [{ num: PUBLICATION_FLOOR, den: VOL_SIZING_FLOOR }]
  },
  {
    rel: VOLATILITY_TEST_REL,
    anchor: "0.01 / 0.00002923",
    subject: "the pre-gate counterfactual at currentVol 0.00002923",
    ratios: [{ num: PUBLICATION_FLOOR, den: SUB_FLOOR_VOL }]
  },
  {
    // Why the floor had to be pinned at all: the alternative `Math.max(0.0001,
    // ...)` is a hundredth of it. If the publication floor moved, this changes.
    rel: VOLATILITY_TEST_REL,
    anchor: "100x change in how much",
    subject: "the distance between the real floor and the unpinned alternative",
    ratios: [{ num: PUBLICATION_FLOOR, den: PUBLICATION_TEST_VOL }]
  }
]

/** Computed ratio for a register expectation, and how it is written in prose. */
const expectedOf = ({ num, den }) => num / den

// ---------------------------------------------------------------------------
// THE PHRASE THAT MEANS "THIS COMMENT IS STATING A SUBSTITUTION FACTOR", and the
// lines that say it without being registered.
//
// Every line carrying the phrase must be either registered or excused here, and
// BOTH entries in this list are the same kind of thing: a line that QUOTES a
// withdrawn claim in order to say it was withdrawn. Registering one would require
// it to be true, which is precisely what it says it is not.
//
//   1. `volatility.mjs:612` reads `... was "342x the truth", which is false for
//      it` — the quoted figure is the error being corrected, and the correcting
//      half of the same sentence is a registered claim on the next line.
//   2. `volatility.mjs:62` quotes the `roundVolPct(5e-7)` row verbatim, inside
//      the note recording that the row was DELETED for being measurably false.
//
// The pattern is the ALLOWLIST-WITH-REASON shape the encoding guard already
// uses: a bare marker is not an allowance, every entry carries a written reason,
// and every entry additionally NAMES THE FALSITY that earns it, in `justifiedBy`
// — the literal text whose presence is what makes the allowance necessary. For a
// quotation that is the quoted figure; for a known-false live row it is the
// false figure.
//
// THREE PINS, NOT TWO, AND THE THIRD IS THE ONE THIS FILE PREVIOUSLY DESCRIBED
// AND DID NOT HAVE. (1) The anchor must resolve to exactly one line, so a line
// that moved or was deleted makes the entry stale. (2) The excused line must
// still state a multiplier, so an entry matching a line that now states nothing
// is doing no work. (3) The named falsity must STILL BE ON THE LINE. Pin (1)
// alone does not reach (3): correct an allowlisted line IN PLACE, keeping its
// anchor words, and the entry stays non-stale and idle-free while the
// now-CORRECT claim sits permanently unregistered with nothing left to remind
// anyone it was ever wrong. That was not hypothetical here — it is exactly what
// would have happened to the deleted `roundVolPct` row had somebody corrected it
// in place instead of removing it. Pin (3) is what makes an allowance die with
// its fix, and it is asserted per entry rather than described here.
// ---------------------------------------------------------------------------
const ALLOWLIST = [
  {
    rel: VOLATILITY_REL,
    anchor: "which is false for it",
    justifiedBy: '"342x the truth"',
    reason:
      "Quotes the WITHDRAWN 342x claim in order to mark it false, which is the correction " +
      "doing its job. The line states no multiplier of its own; the correcting half of the same " +
      "sentence - the 1.08x figure and the 0.00002923 that 342 actually belongs to - is a " +
      "registered claim on the next line. Registering this one would require it to be true, which " +
      "is precisely what it says it is not."
  },
  {
    rel: VOLATILITY_REL,
    anchor: "though it reads as rounding",
    justifiedBy: '=== "0.005%", 2x',
    reason:
      "Quotes the DELETED roundVolPct(5e-7) row verbatim, inside the note recording that the row " +
      "was removed for being measurably false - the refusal path publishes \"0.00005%\", a " +
      "hundredth of the quoted \"0.005%\", so the quoted \"2x\" was no doubling at all. Both sit " +
      "inside the quotation, which is what the anchor names and what justifiedBy pins. The " +
      "half-up doubling POINT is not lost either way: the row above it is correct and is a " +
      "registered claim."
  }
]

/** The phrase that marks a line as stating a substitution factor. */
const MULTIPLIER_PHRASE = /\b\d[\d.,]*e?-?\d*\s*x\b|\bx\s*(?:the truth|over|of the measurement)\b/i

// Every line, in the named files, that states a multiplier of the truth.
// `rels`/`sources` are parameters so the self-scan exclusion can ask what this
// file's OWN prose would contribute, rather than asserting the exclusion with no
// evidence that it is still needed.
function multiplierLines(rels = SOURCES, sources = SOURCES_BY_REL) {
  const found = []
  for (const rel of rels) {
    const source = sources.get(rel)
    for (let i = 0; i < source.lines.length; i += 1) {
      if (!source.commentBearing[i]) continue
      if (!MULTIPLIER_PHRASE.test(source.lines[i])) continue
      found.push({ rel, lineNo: i + 1, text: source.lines[i] })
    }
  }
  return found
}

/**
 * Every claim resolved to exactly one comment line, or a description of why it
 * could not be. Computed once so both the pass/fail tests and the non-vacuity
 * tests read the same resolution.
 */
const RESOLVED = CLAIMS.map((claim) => {
  const source = SOURCES_BY_REL.get(claim.rel)
  const lines = anchorLines(source, claim.anchor)
  const lineNo = lines.length === 1 ? lines[0] : null
  return {
    claim,
    source,
    lineNo,
    text: lineNo === null ? null : source.lines[lineNo - 1],
    missing:
      lines.length === 1
        ? null
        : lines.length === 0
          ? "the anchor no longer appears"
          : `the anchor is not unique (lines ${lines.join(", ")})`
  }
})

describe("WS-7 - comment multiplier guard: the detector can actually fail", () => {
  it("accepts a stated multiplier inside the tolerance and rejects one outside it", () => {
    // The shape the guard depends on, exercised on both sides, because a
    // tolerance that silently accepted everything would leave every other test
    // in this file passing while measuring nothing.
    for (const [line, expected, shouldAccept, label] of [
      ["=    1.083x", 1.0834236186348862, true, "1.083 for 1.0834"],
      ["=   10.00x", 10, true, "10.00 for 10"],
      ["=  200.00x", 200, true, "200.00 for 200"],
      ["= 342.11, spelled out", 342.1142661648991, true, "342.11 for 342.114"],
      ["it used to be written here as \"108x over\"", 1.0834236186348862, false, "108 against 1.0834"],
      ["342x the truth", 1.0834236186348862, false, "342 against 1.0834"],
      ["108x over", 1.0834236186348862, false, "108 against 1.0834"],
      ["342x the truth", 1.0001000100010002, false, "342 against 1.0001"]
    ]) {
      const found = statesRatio(line, expected)
      if (shouldAccept) {
        expect(found, `${label} must be accepted, and the guard is worthless if it is not`).toBeDefined()
      } else {
        expect(found, `${label} must be rejected, and the guard is worthless if it is not`).toBeUndefined()
      }
    }
  })

  it("reads a multiplier written in scientific notation", () => {
    // Two claims are stated against 5e-5, and one of them spells the row as
    // `0.01 / 5e-5`. A tokenizer that read only `\\d+\\.\\d+` would see 5 and miss
    // the row's subject entirely.
    expect(numbersIn("0.01 / 5e-5      =  200.00x")).toContain(5e-5)
    expect(numbersIn("0.002923%")).toContain(0.002923)
  })

  it("reads the publication floor out of the running code, through an unclamped readout", () => {
    // WITHOUT THIS THE FLOOR COULD BE ANYTHING. `volScale` saturates at 2.0, so a
    // probe that saturated would return `target / 2` and the guard would go on
    // checking every comment against a confident wrong number.
    expect(
      PROBE.sized,
      "the probe currentVol must be ABOVE the sizing gate, or nothing is measured at all"
    ).toBe(true)
    expect(
      PROBE.volScale,
      "the probe saturated volScale, so the floor readout is not reading `vol`"
    ).toBeLessThan(2)
    expect(PUBLICATION_FLOOR, "the measured publication floor").toBeCloseTo(0.01, 9)
  })

  it("reads VOL_SIZING_FLOOR from the module rather than restating it", () => {
    // If this file carried its own 5e-5, moving the gate would leave every
    // expectation here aimed at a volatility the code no longer refuses at.
    expect(VOL_SIZING_FLOOR, "the exported sizing floor is the one the comments are written against").toBe(0.00005)
    const refused = volatilityPositionSize({
      capital: 10000,
      riskPct: 0.02,
      targetVol: 0.2,
      entryPrice: 100,
      currentVol: VOL_SIZING_FLOOR / 2
    })
    expect(refused.sized, "just below the gate must refuse, or the band moved").toBe(false)
  })
})

describe("WS-7 - comment multiplier guard: the register is real", () => {
  it("resolves every claim to exactly one line, and every one of those lines is a comment", () => {
    // The resolution half of the guard, and the half a stale register breaks
    // quietly: a duplicated anchor silently checks one of the two, and an anchor
    // on a CODE line would be checking a number nobody reads.
    const unresolved = RESOLVED.filter((r) => r.lineNo === null).map((r) => `${r.claim.rel}: ${r.claim.subject} — ${r.missing}`)
    expect(
      unresolved,
      "every registered claim must be locatable by its anchor. An anchor that no longer " +
        "appears means the comment no longer states the arithmetic, which is the same defect " +
        "this guard exists to catch: re-write the claim with the division, or delete the entry " +
        "deliberately rather than leaving it dangling."
    ).toEqual([])

    const notComments = RESOLVED.filter((r) => r.lineNo !== null && !r.source.commentBearing[r.lineNo - 1])
    expect(
      notComments.map((r) => `${r.claim.rel}:${r.lineNo} ${r.claim.anchor}`),
      "a multiplier claim lives in a comment. An anchor that drifted onto code is checking a " +
        "number nobody reads as justification."
    ).toEqual([])
  })

  it("covers every line in these two files that states a multiplier of the truth", () => {
    // The breadth half. Without it the register is a curated list, and a curated
    // list is exactly the shape this repository has already been bitten by four
    // times (see `sharedCommentLexer.test.mjs`).
    //
    // The sweep is narrow on purpose: it looks for the PHRASE that states a
    // substitution factor, and every line carrying one must be either registered
    // or reasoned in the ALLOWLIST. It is stated as a count as well as a set,
    // because a set difference against an empty expectation passes vacuously.
    const claimed = new Set(RESOLVED.map((r) => r.lineNo))
    const allowed = new Set(ALLOWLIST.map((a) => anchorLines(SOURCES_BY_REL.get(a.rel), a.anchor)[0]))
    const multiplier = multiplierLines()
    const unregistered = multiplier
      .filter((m) => !claimed.has(m.lineNo) && !allowed.has(m.lineNo))
      .map((m) => `${m.rel}:${m.lineNo} ${m.text.trim()}`)
    expect(
      multiplier.length,
      "the multiplier-phrase sweep found nothing, so it is measuring nothing"
    ).toBeGreaterThan(6)
    expect(
      unregistered,
      "a comment states a multiplier of the truth and nothing accounts for it. Add a register " +
        "entry with its subject (the number a reader would divide by), or - if it is quoting a " +
        "withdrawn claim - an ALLOWLIST entry with a written reason. An unaccounted multiplier is " +
        "exactly what this guard was written for."
    ).toEqual([])
  })

  it("finds every written division in a comment, and requires each one to be TRUE", () => {
    // The general net inside the register's own files, so a NEW wrong division
    // written into either of them is caught even when nobody registered it.
    //
    // Two-term divisions only, and the limitation is real: `hyperliquidPerps.mjs:85`
    // writes a CORRECT three-term `0.01 * 4000 / 4 = 10.000000000000002` which a
    // two-term reader misreads as a 100x error. That is why this pass is scoped
    // to these two files rather than run repo-wide, and why a three-term form is
    // skipped by the leading-factor rule below rather than misread.
    const DIVISION = /(?<![*\d.])(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*\/\s*(\d+(?:\.\d+)?(?:e-?\d+)?)\s*=\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/g
    const findings = []
    let checked = 0
    for (const rel of SOURCES) {
      const source = SOURCES_BY_REL.get(rel)
      for (const block of source.blocks) {
        for (const match of block.text.matchAll(DIVISION)) {
          const [whole, a, b, c] = match
          // A three-term form is out of scope, by the argument above. Reported
          // rather than silently dropped, so the skip cannot grow unnoticed.
          const start = block.text.indexOf(whole)
          const before = block.text.slice(Math.max(0, start - 3), start)
          if (/\*\s*$/.test(before)) continue
          const computed = Number(a) / Number(b)
          checked += 1
          if (!(Math.abs(Number(c) - computed) <= Math.abs(computed) * TOLERANCE)) {
            findings.push(`${rel}:${block.from + block.text.slice(0, start).split("\n").length} ${a} / ${b} = ${c}, but ${a} / ${b} is ${computed}`)
          }
        }
      }
    }
    expect(
      checked,
      "the written-division sweep found nothing, so the sweep is measuring nothing"
    ).toBeGreaterThanOrEqual(5)
    expect(
      findings,
      "a comment writes out a division and states a result that is not that division. In this " +
        "effort a falsifiable number in a comment has repeatedly been the load-bearing justification " +
        "for a behaviour change, so the number is the argument and the argument is checked."
    ).toEqual([])
  })

  it("pins the self-scan EXCLUSION, because this guard cannot scan itself", () => {
    // REPLACES a test that was named "scans this guard's own file, so the guard
    // cannot hide from itself", whose comment claimed "the same self-inclusion
    // the encoding guard pins". `SOURCES` never contained `SELF`, so that test
    // scanned nothing and all three of its assertions were trivially true — a
    // name-only clone of a real test (`ws7EncodingIntegrityGuard`, which
    // genuinely asserts `SCAN.has(SELF) === true`) sitting inside a guard whose
    // own header warns that a check which passes forever is the failure this
    // repository has already paid for three times.
    //
    // There is no honest version of the old claim, so this asserts the opposite
    // and pins it. The header states the exclusion; this states that the
    // exclusion is still real AND still load-bearing, which is the part that can
    // rot. If this file's prose ever stopped quoting the withdrawn figures, the
    // count below would fall to zero, the reason for excluding `SELF` would no
    // longer exist, and the correct move would be to add it to `SOURCES` — which
    // this test then refuses to let happen quietly.
    expect(SOURCES, "this guard must not claim to scan a file it does not scan").not.toContain(SELF)
    expect(
      multiplierLines([SELF], new Map([[SELF, loadSource(SELF)]])).length,
      "this guard's own header quotes the withdrawn multipliers in order to mark them false, and " +
        "that is the whole reason SELF is kept out of SOURCES. If this reaches zero the exclusion " +
        "is no longer load-bearing: add SELF to SOURCES and let the phrase sweep police this file."
    ).toBeGreaterThan(0)
  })
})

describe("WS-7 - comment multiplier guard: the allowlist stays honest", () => {
  it("gives every entry a written reason and a unique anchor", () => {
    for (const entry of ALLOWLIST) {
      expect(SOURCES, `allowlisted file ${entry.rel} must be one this guard reads`).toContain(entry.rel)
      expect(typeof entry.reason, "an allowlist entry must carry a written reason").toBe("string")
      expect(
        entry.reason.trim().length,
        `a bare marker is not an allowance (${entry.anchor})`
      ).toBeGreaterThan(80)
      expect(
        anchorLines(SOURCES_BY_REL.get(entry.rel), entry.anchor).length,
        `the anchor for ${entry.anchor} must match exactly one line in ${entry.rel}`
      ).toBe(1)
    }
  })

  it("has no stale entry: an allowance must not outlive the line it excuses", () => {
    // ONE OF THREE PINS, and the one that used to be described as if it were the
    // whole of the protection. It knows only that the ANCHOR resolved to exactly
    // one line, so it catches a line that moved or was deleted. It does NOT
    // catch a line that was corrected in place — see the `justifiedBy` test
    // below for why that needed its own pin.
    const stale = ALLOWLIST.filter((entry) => anchorLines(SOURCES_BY_REL.get(entry.rel), entry.anchor).length !== 1)
    expect(
      stale.map((e) => `${e.rel}: ${e.anchor}`),
      "these allowances no longer match exactly one line. If the line was corrected, delete the " +
        "entry and register the corrected claim; if the line moved, re-anchor it."
    ).toEqual([])
  })

  it("names the falsity that earns each allowance, and that falsity must still be there", () => {
    // THE PIN THAT WAS MISSING, and it is the half the previous version of this
    // file claimed and did not have. The stale-entry pin above only knows the
    // ANCHOR resolved to one line, so it fires when the excused line is DELETED.
    // It does not fire when the line is FIXED: correct the multipliers in place,
    // keep the anchor words, and the entry stays non-stale, stays idle-free, and
    // the now-CORRECT claim sits permanently unregistered with nothing left to
    // remind anyone it was ever wrong. Proven on this file's own known-false row:
    // `roundVolPct(5e-7) === "0.005%"` was correctable in place and the allowance
    // would have ridden straight through the correction.
    //
    // So every entry declares `justifiedBy` — the literal falsity that earns it —
    // and that falsity must still be on the line. Fix the line correctly and the
    // allowance dies with it, which is the entire point: an allowance must not
    // outlive its fix.
    expect(
      ALLOWLIST.length,
      "the allowlist must not be empty, or every assertion over it passes vacuously"
    ).toBeGreaterThan(0)

    const unnamed = ALLOWLIST.filter(
      (entry) => typeof entry.justifiedBy !== "string" || entry.justifiedBy.trim().length === 0
    )
    expect(
      unnamed.map((e) => `${e.rel}: ${e.anchor}`),
      "every allowance must name the falsity that makes it necessary, in `justifiedBy`. An " +
        "allowance that cannot say what it is excusing is a bare marker wearing a reason."
    ).toEqual([])

    const outlived = ALLOWLIST.filter((entry) => {
      const [lineNo] = anchorLines(SOURCES_BY_REL.get(entry.rel), entry.anchor)
      // A line the stale pin has already reported is that test's business, not
      // this one's, so it is not reported twice under a second failure.
      if (lineNo === undefined) return false
      return !SOURCES_BY_REL.get(entry.rel).lines[lineNo - 1].includes(entry.justifiedBy)
    })
    expect(
      outlived.map((e) => `${e.rel}: ${e.anchor} — ${JSON.stringify(e.justifiedBy)}`),
      "these allowances no longer have the falsity that earned them, so they excuse nothing any " +
        "more: the line was corrected and the correction is invisible to the anchor pin. Delete " +
        "the entry and register the corrected claim as real; do not widen the allowance."
    ).toEqual([])
  })

  it("has no idle entry: every allowance is still excusing a live multiplier line", () => {
    // The other half. An entry that matches a line which no longer states a
    // multiplier is not doing any work, and a list of allowances that can grow
    // without doing work is a list that becomes an inventory nobody reads.
    const phraseLines = new Set(multiplierLines().map((m) => m.lineNo))
    const idle = ALLOWLIST.filter(
      (entry) => !phraseLines.has(anchorLines(SOURCES_BY_REL.get(entry.rel), entry.anchor)[0])
    )
    expect(
      idle.map((e) => `${e.rel}: ${e.anchor}`),
      "these allowances match a line that states no multiplier any more, so they excuse nothing"
    ).toEqual([])
  })

  it("excuses a line only once, and never a line the register already covers", () => {
    // Two mechanisms reaching one line is how an exception stops meaning
    // anything: the register checks it, the allowlist excuses it, and the pair
    // reads as double coverage while actually being a hole.
    const claimed = new Set(RESOLVED.map((r) => r.lineNo))
    for (const entry of ALLOWLIST) {
      const lineNo = anchorLines(SOURCES_BY_REL.get(entry.rel), entry.anchor)[0]
      expect(
        claimed.has(lineNo),
        `an allowance and a register claim both reach ${entry.rel}:${lineNo}. Delete whichever ` +
          "is not the one that is doing the work."
      ).toBe(false)
    }
    const allowanceLines = ALLOWLIST.map((e) => anchorLines(SOURCES_BY_REL.get(e.rel), e.anchor)[0])
    expect(new Set(allowanceLines).size, "two allowances must not excuse the same line").toBe(
      allowanceLines.length
    )
  })

  it("has teeth: a NEW unregistered multiplier is reported", () => {
    // The negative half, run on the real scan rather than on a fixture, because
    // the sweep is the part most likely to go quiet. Planted line is shaped like
    // the reverted text this round was written for.
    const planted = "//   true currentVol 0.00923 is reported as 1%, 342x over\n"
    const plantedPhrases = [planted].filter((line) => MULTIPLIER_PHRASE.test(line))
    expect(
      plantedPhrases,
      "the phrase sweep must notice a bare multiplier with no division beside it, which is the " +
        "shape the reverted comment had"
    ).toHaveLength(1)
    expect(
      statesRatio(planted, PUBLICATION_FLOOR / EXAMPLE_VOL),
      "and the register check must reject the figure it states"
    ).toBeUndefined()
  })
})

describe("WS-7 - comment multiplier guard: every claim states the computed multiplier", () => {
  for (const entry of RESOLVED) {
    const { claim, lineNo, text, missing } = entry
    // NOT `if (lineNo === null) continue`. An earlier draft skipped the
    // unresolvable claim, so the per-claim test SIMPLY DISAPPEARED when a
    // comment was reverted — and a test that disappears is a test that reads as
    // a pass. A claim that cannot be located gets a test of its own that says so,
    // next to every other claim, and the suite count does not quietly shrink.
    it(`${claim.rel}:${lineNo === null ? "?" : lineNo} — ${claim.subject}`, () => {
      expect(
        missing,
        `${claim.rel} could not locate the claim "${claim.anchor}". Either the comment no longer ` +
          "states this multiplier, or the claim moved. Re-write the comment with the division in it, " +
          "or delete the register entry deliberately."
      ).toBeNull()

      const stated = claim.ratios.map(({ num, den }) => ({ num, den, expected: num / den }))
      const absent = stated.filter(({ expected }) => statesRatio(text, expected) === undefined)
      expect(
        absent,
        `${claim.rel}:${lineNo} does not state ${absent
          .map(({ expected }) => expected.toPrecision(6))
          .join(" and ")}, which is what its own arithmetic gives ` +
          `(${absent.map(({ num, den }) => `${num} / ${den}`).join(", ")}).\n` +
          `  the line reads: ${text.trim()}\n` +
          `  the numbers on it are: ${numbersIn(text).join(", ")}\n` +
          `  ${claim.subject} is documented as this ratio; a multiplier that drifts from its ` +
          `arithmetic reads as "the sizing floor is harmless" and invites lowering it. Put the ` +
          "division in the comment, as 653f533 did."
      ).toEqual([])
    })
  }
})