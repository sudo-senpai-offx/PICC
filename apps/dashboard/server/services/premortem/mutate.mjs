// Pre-mortem planner — the mutation tier (W3-05, Task 4).
//
// WHAT THIS IS. The half of the planner that asks whether a guard BITES.
// `verify.mjs` answers "does a guard exist, is it tracked, is it registered, and
// does it carry real assertions"; this module answers the only question that
// distinguishes a guard from a guard-shaped file: run it against a deliberately
// broken implementation and see whether it fails. The design spec keeps them
// apart — section 4, rule 4: "Structural verification is not biting. Where
// mutation has not run, the output says so."
//
// WHY A SEPARATE TIER EXISTS RATHER THAN A STRICTER INVENTORY. This program
// shipped GUARD-1: a guard that looked like coverage and was not. Every property
// `inventory.mjs` measures was TRUE of it — the file existed, was tracked, and
// contained `expect(` calls — so no amount of structural reading could have
// found it. Only breaking the implementation and watching the guard stay green
// could. That is the whole reason this file exists, and it is why `bites` is the
// one verdict here that UPGRADES a guard's standing.
//
// THREE VERDICTS, AND THERE IS NO FOURTH.
//
//   bites          the guard FAILED against a deliberately broken implementation
//   does-not-bite  the guard PASSED against it — a real, damning finding
//   not-run        nothing was measured. The default. Never upgraded.
//
// `not-run` is the default and is never upgraded from structural evidence. That
// is rule 4 turned into code rather than left as a paragraph: no amount of this
// entry looking guarded can move a `not-run`.
//
// THE ASYMMETRY BETWEEN THE TWO PESSIMISTIC VERDICTS IS THE DESIGN, not an
// oversight, and it is worth stating plainly because it is counter-intuitive.
// `does-not-bite` is a DAMNING finding — a guard that passes against broken code
// is a defect in the guard, a false negative, and it is precisely what this tier
// was built to find. `not-run` is the SAFE default because it asserts nothing at
// all. So the verdict that reports a defect is NOT the pessimistic one, and the
// pessimistic one is not a defect report. Collapsing them would mean either
// reporting every crashed runner as a damning failure, or — the direction this
// module must never point — reading a crash as coverage.
//
// SIX `not-run` REASONS, BECAUSE "DID NOT RUN" IS NOT ONE FACT. A malformed entry,
// an entry the catalog never marked for mutation, an entry that marks itself for
// mutation without naming a guard, a caller that wired no runner, a runner that
// crashed, and a runner that returned something which is not a measurement are
// six different facts about six different owners, and each needs a different
// repair. Merging them into one reason would leave a known defect unreported —
// and the most common way a diagnostic disappears is by being folded into a
// neighbour that reads as more general. (The same argument as one-finding-per-
// defect in `verify.mjs`.)
//
// THE BOUNDARY, AND IT IS THE MOST IMPORTANT PARAGRAPH IN THIS FILE. This module
// NEVER RUNS VITEST ITSELF. Every byte of execution is delegated to an injected
// `runGuard`, which is asked to run a guard against a broken implementation and
// report whether that guard failed. Nothing here touches the filesystem, spawns a
// subprocess, reads the clock, reads the environment, opens a store or reaches
// the network.
//
// That delegation is what makes this module a READOUT rather than a DANGEROUS
// one. A module that broke source files to see whether a test noticed, reachable
// from an advisory GET route, would be a way to corrupt the repository through an
// endpoint whose entire job is to tell the reader what is and is not safe. So the
// running is somebody else's decision and somebody else's blast radius; this file
// only reads the answer.
//
// ONE IMPORT, AND IT IS THE SHARED ONE. `splitClaim` comes from `inventory.mjs`
// because a catalog `claim` is `"<path>"` optionally followed by the claim
// separator and a `describe`/`it` title, and `runGuard` must be handed the FILE —
// handing it the whole claim string would ask a runner to open a path with a test
// title glued to the end of it, which is a file that does not exist.
//
// THE SPLIT IS NOT REWRITTEN HERE, AND THAT IS THE POINT. `inventory.mjs` defines
// it, `verify.mjs` consumes it, and this file consumes it. A third implementation
// of the same split would be catalog entry SHIP-5 in miniature — two evidence
// piles drifting apart because each re-implemented one predicate — which is the
// precise defect this planner exists to catch. So the separator appears in this
// file only as a named thing; the test asserts its absence from this module's
// source, code and prose alike, because a comment carrying the literal invites
// the next reader to copy it.
//
// WHY THE SPLIT IS LOAD-BEARING HERE RATHER THAN THEORETICAL: measured over the
// catalog, all 4 of the 11 entries marked for mutation — SHIP-1, SHIP-2, SHIP-5
// and SHIP-6 — carry a SUFFIXED claim. Every entry the catalog currently marks
// for this tier names a specific title, so handing the runner the raw claim
// string would be wrong every time rather than almost always.
//
// A THROWN ERROR IS A WORSE OUTCOME THAN A PESSIMISTIC VERDICT. Every untrusted
// input here — the entry, the runner, the runner's result — resolves to a
// verdict. None of them escapes, because an exception thrown out of one entry's
// readout takes the whole overview down instead of reporting one entry honestly,
// and Task 5 serves this object over HTTP where a throw becomes a 500 for the
// entire response.

import { splitClaim } from "./inventory.mjs"

/**
 * The verdict vocabulary, frozen. Three entries, and the count is the claim.
 *
 * Exported rather than merely written as literals so Task 5's route can
 * validate against the same closed set this module emits into, instead of
 * retyping three strings and hoping they still match.
 *
 * @type {ReadonlyArray<string>}
 */
export const MUTATION_VERDICTS = Object.freeze(["bites", "does-not-bite", "not-run"])

/**
 * One result, built by a helper so every branch carries the same three keys.
 *
 * `evidence` is where the REASON lives, and the reason is not decoration. The
 * two pessimistic verdicts mean opposite things, so a consumer able to see only
 * `verdict` is being told less than a consumer that can also see why — which is
 * the whole argument for keeping them as separate strings rather than one
 * `not-run` with a cause field nobody renders.
 *
 * @param {object} input
 * @param {string|null} input.id the catalog entry's own id, so a caller can line
 *   a row up against `FAILURE_MODES` without re-deriving which entry produced it
 * @param {string} input.verdict
 * @param {object} input.evidence
 * @returns {object} one frozen result
 */
function outcome({ id, verdict, evidence }) {
  return Object.freeze({ id, verdict, evidence: Object.freeze(evidence) })
}

/**
 * What the runner actually MEASURED: `true`, `false`, or `null` for "nothing
 * usable came back".
 *
 * ONLY A GENUINE BOOLEAN COUNTS. `{failed: 1}` and `{failed: "true"}` are
 * truthy, and reading them as a measurement would upgrade a guard's standing on
 * the strength of a value nobody converted to a boolean — which is exactly the
 * "truthiness is not a measurement" rule. A boxed `new Boolean(true)` is
 * refused for the same reason: it is an object, and an object is not a
 * measurement.
 *
 * A NON-OBJECT RESULT IS REFUSED RATHER THAN COERCED. `null`, a bare `true`, a
 * bare string and an array all read as no measurement, because reading `.failed`
 * off any of them either says nothing or throws. A throw here would escape
 * `mutationCheck` and take the whole readout down over one bad return value.
 *
 * @param {unknown} result whatever `runGuard` resolved to
 * @returns {true|false|null}
 */
function observedFailure(result) {
  if (result === null || typeof result !== "object") return null
  if (result.failed === true) return true
  if (result.failed === false) return false
  return null
}

/**
 * Run one catalog entry's guard against a broken implementation and report
 * whether it bites.
 *
 * DECISION PATH, IN ORDER, AND THE ORDER IS THE POLICY — each branch is asked
 * before the next because each can make the rest irrelevant, and because the
 * earlier a question is asked the less machinery has to be trusted to answer it.
 *
 *  1. The entry is not a usable object            -> `not-run`. Nothing was named.
 *  2. The entry is not marked `mutation: true`     -> `not-run`. This tier is
 *     opt-in and membership is declared in the catalog, never inferred: spec
 *     section 2, owner decision 3. A structural readout is not a reason to run
 *     anything, and rule 4 is what forbids it.
 *  3. The claim resolves to no file                -> `not-run`. The entry claims a
 *     mutation it does not describe. No path is invented and the runner is not
 *     called at all.
 *  4. No usable `runGuard` was supplied            -> `not-run`. Nothing ran.
 *  5. The runner THREW                             -> `not-run`. A crash is not a
 *     measurement, in either direction.
 *  6. The runner returned no usable boolean        -> `not-run`. Same reason.
 *  7. `failed === true`                            -> `bites`.
 *  8. `failed === false`                           -> `does-not-bite`.
 *
 * Step 6 sits BETWEEN the two verdicts and not after them, because that ordering
 * is what makes `not-run` unreachable-from-success rather than merely
 * unlikely: there is no input to steps 7 and 8 that did not pass step 6, and
 * step 6 accepts nothing but a real boolean.
 *
 * A THROWN RUNNER IS SWALLOWED, and the thrown value is deliberately NOT carried
 * into the evidence. Task 5 serialises this object into an HTTP response, and an
 * arbitrary error object on a route is neither serialisable nor content this
 * readout has any business emitting. The reason string says what happened; the
 * detail is the runner owner's to keep.
 *
 * THE RUNNER IS HANDED THE FILE AND ONE ARGUMENT ONLY. A claim's title narrows
 * which test in the file the mutation is about; narrowing the run is the runner's
 * business, and passing a second argument here would be inventing a runner
 * protocol no caller has agreed to. The title is still carried into the evidence,
 * so a renderer can show which test was claimed.
 *
 * @param {object} input
 * @param {object} input.entry a catalog entry; `mutation` must be the boolean
 *   `true` and `claim` must name a guard
 * @param {(file: string) => Promise<unknown>} [input.runGuard] the ONLY way this
 *   module runs anything. A missing or non-function value is read as NO RUNNER,
 *   which is a distinct fact from a runner that was wired and crashed.
 * @returns {Promise<{id: string|null, verdict: string, evidence: object}>}
 */
export async function mutationCheck({ entry, runGuard } = {}) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return outcome({ id: null, verdict: "not-run", evidence: { reason: "entry-is-not-an-object" } })
  }

  if (entry.mutation !== true) {
    return outcome({
      id: entry.id ?? null,
      verdict: "not-run",
      evidence: { reason: "entry-not-marked-for-mutation" }
    })
  }

  // THE ONE PLACE THE SEPARATOR IS USED, and it is USED rather than spelled.
  const { file, title } = splitClaim(entry.claim)

  if (file === null) {
    return outcome({
      id: entry.id ?? null,
      verdict: "not-run",
      evidence: { reason: "entry-claims-no-guard-path", claimPath: null, claimTitle: null }
    })
  }

  const named = { claimPath: file, claimTitle: title }

  if (typeof runGuard !== "function") {
    return outcome({
      id: entry.id ?? null,
      verdict: "not-run",
      evidence: { reason: "no-runner-supplied", ...named }
    })
  }

  let result
  try {
    result = await runGuard(file)
  } catch {
    return outcome({
      id: entry.id ?? null,
      verdict: "not-run",
      evidence: { reason: "guard-run-threw", ...named }
    })
  }

  // READ ONCE. Three calls to a pure helper agree with one on every input, so no
  // behavioural test can tell them apart — which is exactly why the single
  // derivation is asserted against this module's source instead.
  const failed = observedFailure(result)

  if (failed === null) {
    return outcome({
      id: entry.id ?? null,
      verdict: "not-run",
      evidence: { reason: "guard-result-not-a-boolean", ...named, failed: null }
    })
  }

  return outcome({
    id: entry.id ?? null,
    verdict: failed ? "bites" : "does-not-bite",
    evidence: {
      reason: failed ? "guard-failed-on-broken-implementation" : "guard-passed-on-broken-implementation",
      ...named,
      failed
    }
  })
}