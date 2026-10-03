# 0043 - TWO_AXIS_REVIEW_FINDINGS v1 -> v2

Five findings from a two-axis review of the 28 WS-7 commits pushed to `master`
(`857443e..e84f513`). Two are HIGH and both are the same species: a rule that
looked enforced because something measured it, while the thing that actually
mattered was not measured at all. One is MEDIUM, one is an unrecorded deviation
from a frozen spec union, and one is an acceptance criterion that was never
exercised. The substantive change is D26's identity pin; the rest is
de-duplication and disclosure.

rule: TWO_AXIS_REVIEW_FINDINGS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0043-TWO_AXIS_REVIEW_FINDINGS-v1-to-v2.md)
date: 2026-10-03
approvalDate: 2026-10-03
historicalTradesAffected: none
source: >-
  Owner instruction for this task, given 2026-10-03, to fix the findings of a
  two-axis review of the 28 commits on `master` between `857443e` and `e84f513`,
  working alone. Finding 1 [HIGH]: four hand-rolled `stripComments` lexers at
  `importResolutionGuard.test.mjs:206`, `ws7AuthBootstrapGateGuard.test.mjs:109`,
  `ws7RouteAuthCoverageGuard.test.mjs:102` and `scripts/ws7-seam-probe.mjs:109`,
  two of which independently shipped a vacuous-pass bug, to be replaced by ONE
  shared lexer that must be importable from both a vitest file under
  `server/__tests__/` and a plain script under `scripts/`, with the four sites
  proven to resolve to one implementation and every pinned count unchanged
  (statics 72, dynamics 83, `requireAuth` 128, handlers.mjs 6376 lines). Finding 2
  [MEDIUM]: `NON_PRODUCTION` at `importResolutionGuard.test.mjs:92` re-declares
  the directory-skip rule `scripts/ws7-seam-probe.mjs:272`'s `productionFiles()`
  already owns. Finding 3 [UNRECORDED]: `apps/extension-archived/package.json` is
  outside the spec `:73` file-touch union, was edited to drop the unused `plasmo`
  declaration, and entry 0040 disclosed the removal as a "Stated consequence"
  without stating the `:73` position. Finding 4 [HIGH]: D26's amended check is a
  floor (`liveRowCount >= 44`) plus a pin-equality, which together pin the COUNT
  and not the IDENTITY, so deleting a row and adding an unrelated one keeps the
  gate green. Finding 5: `:1185` requires each AC-046 leg measured or an explicit
  `UNMEASURED`, and e2e had not been run in the final session. Owner constraints
  recorded with the task: `:73` may NOT be widened; the AC-036 per-leg rail green
  path, the 62 deferred route verdicts, the `plasmo` decision and entry 0040's
  reasoning are out of scope and must not be touched; the terminal-perf budget may
  NOT be raised; AC-046's e2e floor must be recorded honestly INCLUDING failures;
  `apps/dashboard/perf/terminal-perf-manifest.json` is tracked and must be
  restored after the e2e run; verification must be repeated AFTER committing
  because the guards enumerate via `git ls-files`. Owner is recorded as the
  literal `WS-7+`.

reason: >-
  Findings 1 and 4 are the same failure wearing different clothes, and it is the
  failure this branch has now produced three times: a check that PASSES for a
  reason other than the one it claims. Four lexers meant four chances for one to
  be quietly switched off by an ordinary coding style — and two already were,
  each blanking a legitimate one-line gate from the `//` of a `https://` string
  default and leaving the scan with zero call sites, so every predicate in the
  file passed while measuring nothing. A floor of 44 is the same shape: it is a
  ratchet against BULK loss, not against IDENTITY, so delete row *A*, add
  unrelated row *Z*, and the count is unchanged while a venue PICC chose to list
  has quietly ceased to exist. D26's ORIGINAL second half asserted over named row
  ids and would have caught it; the 2026-10-03 ruling replaced that equality with a
  floor, which was the right call for the reason the ruling gives (T7b made the
  eight-row equality unsatisfiable by ANY state of the repository), but the
  replacement dropped the identity property along with the unsatisfiable form. The
  fix keeps the floor — so a deliberate upward change still does not require this
  gate to be weakened — and restores identity as a separate, frozen ID set. The
  count pin is kept because it catches the other failure: a row removed and its id
  then forgotten here, which would let the set shrink to match. Findings 2 and 3
  are the same theme at lower stakes: a rule in two homes (`NON_PRODUCTION`, which
  had already drifted from the probe's list by four segments), and an edit outside
  a frozen union that was disclosed in substance but not in its spec position.
  Finding 5 is the honesty contract applied to this task's own bookkeeping.

## v1 -> v2

v1 recorded the findings as the review stated them. v2 records the shared lexer's
mechanism, the D26 subset-versus-equality decision and why equality must NOT be
restored, the fixture evidence that the new tests fail against the lexers they
replace, and the AC-046 e2e result with its failures.

## Finding 1 [HIGH] - one comment lexer, not four

Four hand-rolled `stripComments` implementations, in the three WS-7 guard files
and in `scripts/ws7-seam-probe.mjs`. `ws7AuthBootstrapGateGuard.test.mjs` and
`ws7RouteAuthCoverageGuard.test.mjs` were near-identical, duplicated JSDoc
included — a copy, not a shared decision. Each had independently shipped the
vacuous-pass bug its own header describes: a stripper that only knows `//` and
`/*` blanks from the `//` onward INCLUDING text inside a string literal, and
`handlers.mjs` really does put a URL default on the same line as route logic (the
Stripe success/cancel defaults and the 5173 origin default). The one-line gate

    const home = "http://localhost:5173"; if (!(await verifyUser(auth)) && (await hasUsers())) return 401

was blanked from the `//` onward, the scan found ZERO `hasUsers(` sites, and every
predicate in the file passed VACUOUSLY. A guard a legitimate coding style can
switch off is not a guard. The probe's own first cut was worse in a different way:
a regex pair that DELETED real code, losing 24 of the 62 real `owner: "decision"`
rows in `ws7RouteAuthCoverageGuard.test.mjs` because that file contains the literal
source text `two === "/*"`.

**Resolution.** One lexer, `apps/dashboard/server/scripts/guard-primitives.mjs`.
It is T18's precedent applied to a lexer rather than a matcher: T18 imported
`newsSources.mjs`'s matchers into `importResolutionGuard.test.mjs` "rather than
re-declared, so the guard and the decision cannot disagree", and
`ws7AuthBootstrapGateGuard.test.mjs:81` records that rule for its own matcher.

**HOW IT IS REACHABLE FROM BOTH TREES**, by the mechanism
`server/scripts/absence-scope.mjs` already established: a vitest file under
`server/__tests__/` imports `../scripts/guard-primitives.mjs`, and a plain script
under `scripts/` imports `../apps/dashboard/server/scripts/guard-primitives.mjs`.
Both are plain relative ESM specifiers — no build step, no path alias, no
workspace coupling. `absence-scope.mjs` is already consumed by both
(`scripts/ws7-seam-probe.mjs:55` and
`apps/dashboard/server/__tests__/executionAbsenceScope.test.mjs:26`), so this is
an existing pattern in the repository rather than a new one.

**PROOF THAT ALL FOUR RESOLVE TO ONE IMPLEMENTATION**, in
`server/__tests__/sharedCommentLexer.test.mjs`:

- `Object.is` identity between the shared export, `ws7-seam-probe.mjs`'s export and
  `ws7-seam-guard.mjs`'s export. Those two are plain modules and can be imported
  directly, so this is real object identity, not a source-text resemblance.
- The three vitest consumers cannot be imported without re-registering their own
  suites, so for those the proof is (a) NO consumer retains a declaration —
  asserted negatively against `/function\s+stripComments|(?:const|let|var)\s+stripComments\s*=/`,
  which is what would fail if the lexer were pasted back — and (b) each consumer's
  `guard-primitives.mjs` specifier, resolved against its OWN directory, equals the
  shared module's absolute path. Same resolved file, not merely the same name.
  Stated plainly because it is a weaker form of proof than the object identity
  above, and the difference should be visible to a reviewer rather than assumed.

`ws7-seam-guard.mjs` takes `stripComments` from the shared module by a DIRECT
import rather than through the probe, so no chain of re-exports sits between the
definition and a consumer.

**THE FIXTURES, AND PROOF THEY BITE.** A fixture that passes against the old code
proves nothing, so each fixture is the shape that actually broke a lexer. Run
against the three replaced implementations, the shared lexer passes all five and
each old one fails at least one:

| Fixture | old `importResolutionGuard` | old `ws7-seam-probe` | old backward-scan |
|---|---|---|---|
| URL default on a gate line — must keep `hasUsers(`/`verifyUser(` | pass | pass | **FAIL** (loses both) |
| division after a closed string — must keep `requireAuth(` | pass | pass | pass |
| regex body is data; code after it survives | pass | pass | pass |
| `/`-sequence inside a regex cannot open a comment | **FAIL** (loses `const keep = 1`) | **FAIL** (loses `const keep = 1`) | pass |
| a real trailing comment is still blanked | pass | pass | pass |

The string-literal requirement and the regex requirement are therefore both
satisfied and both demonstrated, not merely asserted: a `//` inside a
double-quoted string, a single-quoted string and a template literal each survive
with the code after them intact, and a regex literal is blanked as data WITHOUT
swallowing the rest of the line.

**COUNTS UNCHANGED**, as required: statics 72, dynamics 83, handlers.mjs 6376
lines all still pin green. The `requireAuth` figure of 128 is **prose only** —
`ws7AuthBootstrapGateGuard.test.mjs:1452` states it inside a comment and no
assertion reads it. That is noted here rather than papered over: the figure is
believed still correct, but it is a stated number with nothing behind it, which is
the same class of weakness this entry exists to close elsewhere.

## Finding 2 [MEDIUM] - `NON_PRODUCTION` and `productionFiles()` are now one rule

`importResolutionGuard.test.mjs:92` re-declared the directory-skip rule that
`scripts/ws7-seam-probe.mjs:272`'s `productionFiles()` already owns, and the two
had DRIFTED: the test-side list carried `coverage`, `.next`, `.plasmo` and
`__mocks__`; the probe-side list carried `.playwright-tmp`. A directory added to
one was silently absent from the other, which is finding 1's defect one level
down.

**Resolution.** One frozen `NON_PRODUCTION_SEGMENTS` array plus one
`isNonProductionPath` predicate in `guard-primitives.mjs`, consumed by both. Only
the vocabulary is shared: each caller keeps its own additional conditions, because
only the vocabulary was duplicated. `productionFiles()` additionally excludes
`*.test.*`/`*.spec.*`, excludes the two detector files, and restricts itself to
four trees; `importResolutionGuard.test.mjs` deliberately scans every tracked
source file it can see.

**PROOF THE MERGE MOVED NO SCAN.** Not argued — measured. `sharedCommentLexer`
runs `productionFiles()` over `git ls-files` twice, once with the probe's OLD
literal vocabulary and once with the shared one, and requires the two corpora to be
`toEqual` — same elements, same order. It also asserts that no tracked path sits
under any segment that is NEW to either consumer
(`coverage`, `.next`, `.plasmo`, `__mocks__`, `.playwright-tmp`: zero), and that
`__tests__` IS populated (387 tracked paths) so the neutral-claim is not passing
because the predicate matches nothing at all.

An earlier draft of that assertion tested the whole shared list and FAILED. The
cause was the assertion, not the merge: `__tests__` was in BOTH former lists, so
it cannot change any scan and must not be treated as differential. Recorded here
because the failure is the useful part — it is the same "verify rather than
re-pin" discipline applied to the assertion that was meant to enforce it.

## Finding 3 [UNRECORDED] - the `extension-archived` manifest deviation, now marked

`apps/extension-archived/package.json` is **outside** the spec `:73` file-touch
union, which whitelists only "the workspace root `package.json`/`package-lock.json`"
among manifests and requires "a dated spec amendment" for any path outside the
union. It was edited to remove the unused `plasmo` declaration. Entry 0040
discloses the removal as a "Stated consequence" but **never states the `:73`
position** — no amendment, no in-file marker. That is the same class of edit as
`.github/workflows/ci.yml`, which IS flagged in-file and in entry 0025.

**Resolution — the `ci.yml` handling, applied here. `:73` was NOT widened and this
file was NOT added to it; no amendment was taken, because only the owner can take
one.** What was added:

- an in-file marker at the point of the edit, in
  `apps/extension-archived/package.json` itself, naming the `:73` position and
  stating that no amendment was taken. It is a JSON string array under a `"//"`
  key rather than a `//` comment, because that file is parsed with `JSON.parse` by
  `importResolutionGuard.test.mjs` and by the probe's dependency check; a comment
  would break both. npm ignores unknown keys and this archived tree is not an npm
  workspace (entry 0040 finding 3), so nothing reads it either way.
- this entry, recording the deviation.

## Finding 4 [HIGH] - D26's identity pin, and the churn it now catches

D26's check has five halves. Half A is the claims scan, owned by
`ws7RegulatoryClaimGuard.test.mjs`. Halves B and C are the floor and the
pin-equality. Half D requires a surviving claim to have a factual row. **None of
them pinned WHICH rows survive.** Delete catalog row *A*, add an unrelated row *Z*,
and the count stays 44: half B is green, half C is green, and half D is green too,
because removing *A* orphaned no claim — *A* simply ceased to exist. That is
silent identity churn, and it is exactly what D26's ORIGINAL second half existed to
catch.

**Resolution.** New half `every-approved-catalog-row-still-declared`, over a frozen
44-element `D26_APPROVED_CATALOG_ROW_IDS` read off the live catalog through the
probe's own comment-stripping, so the pin and the measurement cannot come from two
different readings of the file. Provenance travels with it
(`D26_APPROVED_CATALOG_ROW_IDS_PROVENANCE`). The count pin is KEPT: it catches the
complementary failure, a row removed and its id then forgotten here, which would
otherwise let the set quietly shrink to match. The two do different jobs and
neither replaces the other.

**SUBSET, NOT EQUALITY — and this must not be "fixed" into an equality.** An
equality over these 44 ids would break loudly on the next legitimate owner ruling
that adds a row, which is the SAME unsatisfiable-by-construction defect D26 already
suffered once when T7b's removal made its eight-row equality impossible to satisfy
by any state of the repository. A subset keeps the owner's stated intent — a
deliberate upward change must not require this gate to be weakened — and
deletions are not permitted at all. Additions are still caught, by the count pin,
so a human re-pins deliberately. `missingApprovedIds` and `idsAddedSincePin` are
surfaced so a failure NAMES the row that vanished rather than reporting a boolean.

**PROOF THE PIN BITES.** A pin never seen to fail is not a pin. Scratch run:
`plus500`'s row was replaced with an unrelated row `SCRATCH-ZZ-unrelated-row`,
holding the count at exactly 44. Result:

    liveRowCount                      : 44
    floor.count                       : 44
    missingApprovedIds                : ["plus500"]
    idsAddedSincePin                  : ["SCRATCH-ZZ-unrelated-row"]
    no-regulatory-claim               : true
    catalog-not-below-owner-approved-floor : true
    floor-pin-matches-live-count      : true
    every-approved-catalog-row-still-declared : FALSE
    no-claim-outlives-its-row         : true
    verdict fail; 1 failing check(s)   exit 1

All four original halves green, the new half red, and the check names the row.
Before the change this exact state was fully green. Reverted;
`git status` on `streamCatalog.ts` is clean and the catalog is back to 44.

An earlier scratch attempt ADDED a row without removing one, and half C fired
rather than the identity half — correct behaviour for a 45-row catalog, and the
reason the count pin is retained as well. Recorded because the first attempt did
not demonstrate what it was meant to.

## Finding 5 - AC-046's e2e floor, exercised and recorded

Spec `:1185` requires AC-046's measurement recorded — vitest files/tests,
typecheck, `verifyAudit()`, E2E, security-review, `git diff --check` — each with an
observed value or an explicit `UNMEASURED`, with no result inherited from
`PICC.md:477` as if freshly measured. E2E had not been run in the final session.

`npm run test:e2e --workspace @picc/dashboard` was run for this task.
**Result: 6 passed, 0 failed, exit 0, in 1.5m** — including
`terminal-perf.spec.ts:554` ("records throttled-proxy evidence and asserts the
proposed budgets"), which the review expected to fail. It did not fail on this
run. Recording the observation rather than the prediction: a predicted failure that
did not happen is not a pass of the prediction, it is a pass of the run.

**WHAT THAT DOES AND DOES NOT ESTABLISH.** T19 root-caused this leg at roughly 4
failures in 5 runs, on 6% timeout headroom — 48 iterations in 281.7 s against a
300 s budget. One green run does not establish the flake is gone, and nothing in
this task touched the measurement path, so the flake is unchanged and still
expected. **The budget was NOT raised**; that is an e2e assertion and out of scope
either way. The honest characterisation of this leg is therefore: *exercised and
green on this run, known-flaky upstream of any change here, root cause not
addressed by this entry*.

An operational note, recorded because it changed what the run could do:
`playwright.config.ts:6` hardcodes `baseURL = "http://localhost:5173"` and sets
`reuseExistingServer: false`, so playwright must own that port. A leftover vite dev
server — this repository's own, started by `scripts/dev.mjs` before this task
began — was holding it. The first attempt failed with "http://localhost:5173 is
already used". That single listener (pid 11080) was stopped and the run repeated;
no tracked config was edited to work around it, and no other dev process was
touched.

`apps/dashboard/perf/terminal-perf-manifest.json` is tracked and does **not**
survive a run — `terminal-perf` rewrote it even on this green run. It was backed
up and sha256-verified before the run, `git checkout`-restored afterwards, and the
restored file confirmed byte-identical to the backup. `git status` on
`apps/dashboard/perf/` is clean and no `.playwright-tmp/` or `test-results/`
artifact is tracked or left behind.

## Out of scope, and deliberately untouched

- **AC-036's per-leg rail green path.** The consent/risk rails' `not-evaluated`
  branch means all 16 venue×leg pairs refuse at ceremony in production, so the
  green path exists only under `unlockVenueClass` in test. That is correct
  fail-closed design and it is honest. The owner is settling the AC-036
  interpretation question separately.
- **Spec `:73` itself.** No amendment without the owner.
- **The 62 deferred route verdicts, the `plasmo` decision, and entry 0040's
  reasoning.**
- **Three further hand-rolled `stripComments` copies**, in
  `ws6SafetySeamGuard.test.mjs:16`, `ws4LeaderSourcingSeamGuard.test.mjs:39` and
  `orderFlowHonestySeamGuard.test.mjs:17`. These are the same two-line regex pair
  the probe's own header records as having deleted real code, so they are the same
  defect class. They are NOT part of the 28 commits under review, they belong to
  WS-4/WS-6 guards whose pinned counts this task was told not to disturb, and
  consolidating them is a separate piece of work. Recorded here rather than fixed
  silently, because leaving a known copy of a known-bad lexer unmentioned would be
  the same error in a different place.
