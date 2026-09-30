# WS-7 T1 — baseline freeze (pre-room-work measurement)

**Date:** 2026-09-26 · **Commit:** `09125f8` (T0) + this record · **Owner:** WS-7+

Purpose: T0 changed files, so any floor quoted from before WS-7 began is stale.
This record re-measures every gate and states each value as OBSERVED now, or
explicitly `UNMEASURED`. **Nothing here is inherited from a prior claim**, including
the WS-6 figures carried in `PICC.md`.

## Measured floor

| Gate | Command | Observed | Verdict |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0, no `error TS` | PASS |
| Unit/integration | `npx vitest run --maxWorkers=1` | **303 files, 3392 passed, 1 skipped**, exit 0 | PASS |
| E2E | `npm run test:e2e --workspace @picc/dashboard` | **5 passed** (2.2m), exit 0 | PASS |
| Audit chain | `verifyAudit()` | `ok: true, brokenAt: null` | PASS |
| Whitespace | `git diff --check` | clean, exit 0 | PASS |
| Security review | diff-scoped scan of `origin/master..HEAD` | 0 exploitable findings | PASS |
| Working tree | `git status --porcelain` | empty | CLEAN |

Test-count context: the floor rose 3133 (WS-5) → 3386 (WS-6) → **3392**. The
`303 files` figure counts `.mjs`/`.ts`/`.tsx` suites under `apps/dashboard`.

## Security review — what was actually checked

Scanned the full WS-7 diff (`origin/master..HEAD`, 6 files, +1793/−11) for
credential-shaped strings and dangerous process invocation:

| Pattern | Result |
| --- | --- |
| `PICC_CCXT_*= <value>` | 1 hit — **not a credential**; the env-var *name* `PICC_CCXT_PERPS_MAINNET_ENABLED=1` inside a PICC.md documentation table |
| `PRIVATE_KEY = <value>` | none |
| `sk-<20+>` | none |
| `Bearer <20+>` | none |
| `child_process` / `execSync` / `spawn(` | none |

The one new executable module, `server/scripts/absence-scope.mjs`, performs **no
network I/O, no subprocess execution, and reads no environment variable or
credential**. Its only IO is recursive `readFileSync`/`readdirSync` over the
server tree, which is what discovery requires.

Scope limit stated honestly: this is a **diff-scoped pattern review**, not a
full application penetration test. It does not cover runtime behaviour, the
previously-identified standing gaps (agents-service `allow_origins=["*"]` with a
plaintext LLM key; plaintext GitHub token in `profile.json`), or anything outside
this diff. Those are tracked as WS-7 tasks, not closed here.

## Defects resolved en route to this floor

Three pre-existing failures were fixed before the floor could be established. All
three were real, and none were introduced by WS-7.

1. **CRLF checkout broke source-pinning tests** (`51bef3a`). Six tests use
   `$`-anchored regexes against source read from disk. In JavaScript `$` anchors to
   end-of-**string**, not end-of-line, so a CRLF line `"...RAIL_OFF_TESTNET_ONLY
   =\r"` could never match `^const RAIL_OFF_TESTNET_ONLY =$`. Invisible in CI
   because the blob was always correct LF; deterministic on Windows because
   `core.autocrlf=true` and the repo had **no `.gitattributes` at all**. Fixed at
   the config layer, not by loosening an assertion.

2. **Registry-count guard was a stale literal** (`90c5d6c`).
   `ws3CeremonySeamGuard.test.mjs` pinned `"39 registry rows"` while the table held
   41 spec rows + 1 `notes/` row and the header counted 42 — three disagreeing
   numbers. Now **derived**: the guard parses the §10 table, excludes `notes/`
   per its own documented convention, and asserts the header matches. Teeth
   verified: header set to `99` fails with `expected 99 to be 41`.

3. **Cross-file env contamination** (diagnosed, then found to be a **false lead**).
   `ws3CeremonySeamGuard.test.mjs` deletes all `PICC_*` vars in `afterEach`. An
   env-snapshot/restore fix was written and **did not change the failure**, so it
   was reverted rather than kept as an unverified change. The real cause was (1).

## Explicitly UNMEASURED at this baseline

| Item | Status | Why |
| --- | --- | --- |
| Direct on-device ARM room-transition sample | **UNMEASURED** | Needs a promoted terminal room; the legacy suite surface has none. Budget B2 rests on a derived 7.18× ratio until T19 checks in the raw probe output. |
| PICC application peak RSS vs the 2 GB ceiling | **UNMEASURED** | Device total/free RAM is not application peak RSS. B10 has no verdict. |
| Perps production `cancel` path | **UNMEASURED** | The adapter has no `cancel` member; a cancel test exercises raw CCXT, not production. T3 adds the member. |
| Guard inventory for the CCXT spot rail | **PARTIALLY UNVERIFIED** | Only `CCXT_HARD_NOTIONAL_CAP_USD = 10` (`:52`) and day-loss (`:432`) were confirmed in source. Other asserted gates live at the calling layer and are re-verified in a later task before any live boundary is relied on. |
| AC-4c two-real-tab lock matrix | **UNMEASURED** | Requires two isolated real browser profiles; not automatable in this harness. |
| Blueprint v4.0 provenance | **UNVERIFIED** | Source document not in repo. |
| ARM64 architecture correctness | **CLOSED** | Real ARM64 execution measured: `android-arm64`, SM6225, Cortex-A53 (`0x801`), 7.18× x86 ratio, jitter p95 4.47ms, deterministic checksum match. |

## Bisect

Documentation-only. This record cannot change runtime behaviour, so it is safe to
revert in isolation.

---

## Re-measurement — 2026-09-29 (appended, prior section left intact)

The section above is the **2026-09-26** baseline and is deliberately **not
overwritten**: it is the historical record of what was true at T1, and rewriting
it would falsify that. T2 then removed the ExpertOption venue, which removed
tests whose subject no longer exists, so the floor legitimately moved. This
appended section is a **separate, later observation**.

Every value below was **measured fresh in this session**. Nothing is inherited
from `PICC.md:477`, from the 2026-09-26 section above, or from any other document.
`PICC.md:477` is a *runbook ladder* (a list of commands to run), not a set of
observed values, so there was nothing numeric there to inherit in the first
place; it is named here only because AC-046 forbids treating it as a measurement.

| # | Gate | Command | Observed now | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Unit/integration | `npm run test --workspace @picc/dashboard` | **327 files, 3947 total, 3946 passed, 1 pending, 0 failed**, exit 0 — run **twice**, byte-identical counts | PASS |
| 2 | Typecheck | `npm run typecheck` | exit 0, **0** occurrences of `error TS` | PASS |
| 3 | Audit chain | `verifyAudit()` | `{"ok":true,"brokenAt":null,"reason":null}` | PASS |
| 4 | E2E | `npm run test:e2e --workspace @picc/dashboard` | **6 passed** — run 1: 2.8m, run 2: 2.6m, both exit 0 | PASS |
| 5 | Security review | diff-scoped scan of `d01debd..HEAD` | **0 executable source files touched, 0 pattern hits**; see the audit finding below | PASS (with finding) |
| 6 | Whitespace | `git diff --check` | clean, exit 0 | PASS |

All six AC-046 items are present and each carries an observed value. **No item is
`UNMEASURED`, and no item is inherited.**

### Notes on individual items

**(1) Unit floor.** 3947 total / 3946 passed / 1 pending is the honest reading;
the "3946 floor" figure is the passed count. The single pending test is a
pre-existing honest skip, not a failure. 327 files carry at least one test. The
global `testTimeout` was **not** raised; no timeout was touched. Both runs were
captured with the JSON reporter so a failure would be nameable rather than
inferred. The 2026-09-26 figure was 303 files / 3392 passed; the rise is WS-7 test
additions net of T2's removals.

**(3) Audit chain — verified non-vacuously.** `verifyAudit()` is a module export,
not a CLI, so it was invoked by importing `auditTrail.mjs` and calling it against
the **real persisted trail** at `apps/dashboard/server/services/data/
command-centre-audit.jsonl`. That file holds **75 entries / 30072 bytes**
(seq 1 `kill-switch` through seq 75 `audit:startup-health`), and `verifyAudit()`
walked all 75 and returned `ok: true`. The entry count is recorded deliberately:
an `ok: true` over an *empty* chain is trivially true and would be worthless as
evidence. This is not that.

One correction worth recording, because it nearly produced a false negative: the
module's default `DATA_DIR` is `new URL("../data", import.meta.url)`, which from
`services/commandCentre/` resolves to `server/services/data/`, **not**
`server/data/`. A first measurement resolved `server/data/` and reported "trail
file absent" while 75 entries were in fact hydrated. The path in the table above
is the resolved one.

**(4) E2E.** 6 passed on both runs, with no flake. `e2e/terminal-perf.spec.ts`
(the known-unrooted flake) **passed on both runs** (1.9m, 1.8m) and did not fire.
The e2e run rewrites the tracked `apps/dashboard/perf/terminal-perf-manifest.json`
(+14969 lines); it was restored with `git checkout --` and is not part of any
commit. `terminal-perf.spec.ts` itself was not modified.

**(5) Security review — scope, and one pre-existing finding.** Diff-scoped
pattern review of `d01debd..HEAD` (the three commits of this session), using the
same pattern table this record documents above so the two reviews are comparable:
`PICC_*` env assignment, `PRIVATE_KEY =`, `sk-<20+>`, `Bearer <20+>`,
`child_process`/`execSync`/`spawn(`, `gh[pousr]_`, `AKIA…`, and PEM private-key
blocks. **Zero hits in added lines.** The diff touches **no executable source
file at all** — two deleted pnpm config files, one spec file (comments and
file-list text only), and two new Markdown records. Same scope limit as above:
this is a diff-scoped pattern review, not an application penetration test.

**Finding, not caused by this session and deliberately not fixed here:**
`npm audit --audit-level=high` exits **1** against the now-authoritative root
lockfile — **1 high, 4 moderate, 0 critical**. The high is **`undici@7.29.0`**
(DoS via unhandled error in WebSocket `permessage-deflate` decompression), pulled
in transitively by **`ccxt`**, one of the three dependencies AC-018 names.

It is **pre-existing and provably so**: the `package-lock.json` blob is
**byte-identical** between the branch base `c407964` and HEAD
(`4c9826a038261807b44e0844ca8a617db96d9b1b`), so the advisory has been in the
authoritative lockfile since before this branch and neither this session nor the
pnpm-lockfile deletion could have introduced or removed it.

Two consequences, stated rather than papered over:

- `ci.yml:72` runs `npm audit --audit-level=high` as a gate, so **that gate is
  currently red** — and was red before T6.
- Fixing it means bumping `undici`/`ccxt`, i.e. a real dependency change. That is
  **out of scope here and was not performed**: T6's bisect note is explicit that
  the lockfile decision must be closed *before* any new dependency install, and
  `npm audit fix --force` would additionally pull `vitest@5.0.2`, which npm itself
  flags as a breaking change. Now that D24 is closed, a targeted bump is
  permissible — it is a separate, deliberately-not-taken task.

This is also the first time the finding is *visible against a single graph*.
Before D24 a reader could have audited the pnpm lockfile and seen a different
answer; that ambiguity was the defect. One source of truth means one audit result,
including this one.

### Still `UNMEASURED` at this re-measurement

Not attempted in this session, and **not** claimed:

| Item | Status | Why |
| --- | --- | --- |
| Direct on-device ARM room-transition sample | **UNMEASURED** | Needs promoted terminal rooms and real ARM64 hardware; no such surface or device here. Unchanged from 2026-09-26. |
| PICC application peak RSS vs the 2 GB ceiling | **UNMEASURED** | Not attempted; the RAM gate script does not exist. Unchanged. |
| Perps production `cancel` path | **UNMEASURED** | T3's work; not in this session's scope. Unchanged. |
| AC-4c two-real-tab lock matrix | **UNMEASURED** | Needs two isolated real browser profiles. Unchanged. |
| `npm audit` remediation for `undici` | **UNMEASURED / NOT ATTEMPTED** | Deliberately not run; see the finding above. |

### T6 observation appended for the record

This session also executed **T6** (one lockfile, npm only). Its effect on the
figures above: **none**. The two pnpm files deleted were not read by any test, no
dependency changed, and the floor is identical before and after — the unit and
E2E counts here are measured **after** the T6 commit. Recorded in
`docs/trading-logic/changelog/entries/0017-ONE_LOCKFILE_NPM_ONLY-v1-to-v2.md`.

A second defect this session introduced and fixed is recorded in
`0018-T0_ABSENCE_SCOPE_PATH_DEVIATION-v1-to-v2.md`: that entry initially omitted
the `reason` field required by the D20 schema guard
(`ws7RegulatoryClaimGuard.test.mjs:627`), which failed one test. The **entry** was
corrected, not the guard. The fix is included in the T1 commit so the history
shows the defect and its repair together.

