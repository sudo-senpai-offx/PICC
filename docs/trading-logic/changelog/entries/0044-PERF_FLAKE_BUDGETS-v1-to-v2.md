# 0044 - PERF_FLAKE_BUDGETS v1 -> v2

Execution record for the two owner-approved performance fixes: the WS-7 route-auth
behaviour suite's load-induced timeout, and the WS-6 T10 terminal-performance
harness's wall-clock budget. Both causes were already root-caused by T19 and by
entry 0021 respectively; this entry is the fix and its evidence, not the
diagnosis.

rule: PERF_FLAKE_BUDGETS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0044-PERF_FLAKE_BUDGETS-v1-to-v2.md)
date: 2026-10-03
approvalDate: 2026-10-03
historicalTradesAffected: none
source: >-
  Owner instruction for this task, given 2026-10-03, to fix two approved
  performance flakes working alone. Fix 1: `apps/dashboard/server/__tests__/
  ws7RouteAuthCoverageBehaviour.test.mjs` is ~1-in-3 red under full-suite
  concurrency from a load-induced 5 s timeout, with different tests failing on
  different runs; put the offending test(s) on the file's own `SWEEP_TIMEOUT_MS`
  budget, enumerate every test first, do NOT blanket-apply, verify with at least
  five full-suite runs, and correct the file's comment if the change makes part
  of it wrong. Fix 2: `apps/dashboard/e2e/terminal-perf.spec.ts` fails ~4-in-5 at
  the run level; T19 root-caused it to 48 iterations in 281.7 s of a 300 s budget
  (6% headroom) with one observed run dying at 295.9 s; raise the budget from the
  measured distribution, do not weaken any assertion, and record explicitly that
  this is NOT B1. Verification demanded: typecheck, >=5 unit runs, >=3 e2e runs
  with the tracked perf manifest backed up and restored by sha256 each time, the
  WS-7 seam guard, the cross-room invariant gate, `git diff --check`, and a clean
  `git status` on `apps/dashboard/perf/`. The owner also stated that B1 and B3
  must actually be fixed and that this is NOT that task.

reason: >-
  Both flakes were budget problems rather than behaviour problems, and both
  budgets were demonstrably below the work the artefact had already committed to
  performing. Fix 1's file had already solved the problem for itself for its
  allowlist probes and left every other handler-driving test on vitest's global
  5 s default; Fix 2's harness declared a 300 s envelope around a measurement
  that T19 had measured at 281.7 s complete and 295.9 s incomplete. In both cases
  the honest repair is to widen the budget to the measured work and leave every
  assertion alone, and in both cases the interesting part is proving the new
  number is defensible rather than merely larger.

## Fix 1 - the route-auth behaviour suite's 5 s ceiling

### What was enumerated, and the line actually drawn

Eighteen tests exist in the file: seventeen written by hand and one generated per
`DECLARED_PUBLIC` marker. All eighteen were classified before anything was
changed.

**The line is "does this test load `handlers.mjs`", not "how many requests does
it make".** `beforeEach` ends in `vi.resetModules()` and `call()` re-imports the
handler module on every invocation, so the first request in any such test pays a
cold import of a ~6,375-line module together with its whole static and dynamic
import graph. Measured cold on this host that import is ~428 ms
(`authBootstrapGateFailsClosed.test.mjs:293-295`), but under the suite's parallel
worker pool it has been observed running past 5 s in this very repository.

Twelve tests moved onto the budget, renamed `SWEEP_TIMEOUT_MS` to
`ROUTE_BUDGET_MS` because "sweep" stopped describing its scope:

| Moved | Requests | Note |
| --- | --- | --- |
| `:229` alerts/delete, unreadable store | 1 | the test the flake report names for THIS task |
| `:246` watchlists/delete, unreadable store | 1 | |
| `:258` both deletes refuse | 2 | |
| `:274` alert payload absent from a refusal | 2 | the test the flake report names as "the failing test" |
| `:297` authenticated delete really deletes | 2 | pays the import TWICE (`vi.resetModules()` mid-test) |
| `:359` GET notifications refuses | 1 | |
| `:371` POST clear refuses | 1 | |
| `:386` read / read-all / inject refuse | 3 | |
| `:413` webhook actions stay gated | 2 | |
| `:425` CONTROL authenticated write + clear | 2 | pays the import TWICE, plus two 250 ms settles |
| `:518` metrics Prometheus branch throws | 1 | |
| `:524` metrics JSON branch answers | 1 | |

Five tests were deliberately LEFT at the global 5 s default, because they never
load the module graph and so cannot be slow for this reason: `:326` and `:476`
assert on the seeded files directly, `:333` and `:490` assert on the redirected
directories, and `:688` re-reads the guard file's own source text. The 74
generated allowlist probes keep the same budget they already had, now under the
renamed constant.

**THE INSTRUCTION'S WORDING WAS NARROWER THAN THE DEFECT, AND THE BASELINE SAYS
SO.** The task framed the criterion as "multi-request HTTP work against routes
with declared budgets". Measured against the handler, that clause selects
NOTHING in this file: the two allowlist routes the non-sweep tests touch declare
no handler budget at all - `GET /api/trading/alerts` is `handlers.mjs:3606-3610`
and `GET /api/metrics` is `handlers.mjs:5586-5597`, neither containing a
`withTimeout`. Restricting the fix to the six multi-request tests would therefore
have left the file red. The baseline runs below prove it: with this change
reverted, the failing test in this file is `:229` - a SINGLE-request test - and it
fails in 4 runs out of 4. The class had to be fixed, not the instance. The wider
rule above is what the evidence supports, and it is recorded here so a later
reader can see that it was chosen on measurement rather than convenience.

### The constant's doc comment was corrected, and two other overstatements with it

`SWEEP_TIMEOUT_MS`'s comment claimed the budget "is set on these 98 probes alone".
The allowlist carries **74** markers, so that was false before this change and
became more false after it. Rewritten rather than patched, because the constant
now has two distinct justifications that a reader needs to see separately: the
declared-handler-budget reason that applied to the sweep, and the cold-module-
import reason that applies to the other eleven tests.

Two further prose numbers in the same file were stale and are corrected here,
since the instruction required the comment to describe reality:

- the header's "98-route allowlist sweep" is now expressed as "one probe per
  `DECLARED_PUBLIC` marker", which cannot rot;
- "there are 99 allowlisted routes and no reviewer" became "there is no reviewer
  left to make it by hand on the rest of the allowlist", for the same reason.

**AND ONE PRE-EXISTING ERROR IN THAT COMMENT WAS FOUND WHILE CHECKING IT.** It
read "10s on the two /api/trading/demo reads". There are two demo reads, but only
one declares a budget: `/api/trading/demo/analytics` carries
`withTimeout(demoAnalytics(), 10000)` at `handlers.mjs:3275`, while its sibling
`/api/trading/demo/deals` at `:3283-3290` declares none. Corrected to name the one
route that does. The other figures in that comment were verified individually
against the handler and are correct: 8000 on `/api/trading/status` (`:1427`),
20000 on `/api/crypto/market` (`:1386`), `/api/yields` (`:1408`),
`/api/trading/paper/analytics` (`:3030`) and `/api/trading/watchlist` (`:3330`),
30000 on `/api/trading/assist` (`:3040`).

### The fix took: 4-for-4 red without it, 0-for-10 with it

This is the part that distinguishes a fixed flake from an assumed one. With this
change reverted and the file otherwise untouched, four consecutive full-suite
runs were executed. **All four were red, and all four failed this file**, always
at `:229`, always with `Test timed out in 5000ms`.

| Tree | Run | Result | This file |
| --- | --- | --- | --- |
| base (fix reverted) | 1 | 4 failed / 5427 passed / 1 skipped | **FAILED `:229`** |
| base (fix reverted) | 2 | 4 failed / 5427 passed / 1 skipped | **FAILED `:229`** |
| base (fix reverted) | 3 | 4 failed / 5427 passed / 1 skipped | **FAILED `:229`** |
| base (fix reverted) | 4 | 4 failed / 5427 passed / 1 skipped | **FAILED `:229`** |

With the fix in place, ten consecutive full-suite runs: **this file failed in none
of them.** Note the base rate on this host is far worse than the ~1-in-3 the task
described - it was 4-for-4 - so the measurement below is a stronger result than
the reported flake rate, not a weaker one.

## Fix 2 - the terminal-performance harness's wall-clock budget

`test.setTimeout(300_000)` became `test.setTimeout(900_000)`. Nothing else in the
file changed: no budget value, no tolerance, no sample count, no assertion, no
iteration count. `WARMUP_SAMPLES` is still 4 and `STEADY_SAMPLES` still 12, so the
run is still 3 rates x 16 = 48 iterations.

### The arithmetic

    T19, complete run .............. 48/48 iterations in 281.7 s  ->  5.87 s/iteration
    T19, worst observed elapsed .... 295.9 s, at 32/48 iterations
    old budget ..................... 300 s   (6% headroom over 281.7 s)
    uniform-cost projection of the 295.9 s run to 48 iterations
                                     295.9 x 48/32 = 443.9 s
    repo convention (authBootstrapGateFailsClosed.test.mjs:288-291 rejected
      30 s as "roughly 10x the slowest observed" and settled on ~3x)
                                     3 x 295.9 = 887.7 s
    chosen, rounded UP to a minute . 900 s

900 s is **3.04x** the worst observed elapsed, **2.03x** that run's projection to a
full 48 iterations, and **3.20x** the observed complete run. The 443.9 s figure
is the one that matters and it is a **lower** bound: rate 6 is the slowest of the
three rates, and the 32 iterations completed when the slow run died were rates 1
and 4, so a run as slow as that one finishes the remaining 16 at a higher
per-iteration cost than the average it is projected with.

The round number is not the justification - the three ratios are, and each is
derived from a recorded measurement rather than chosen for looking generous.

### This is NOT B1, and the spec currently depends on B1 breaching

**B1 is the x86 250 ms room-transition budget** (`BUDGETS.roomTransition`,
`terminal-perf.spec.ts:62`) - a per-transition performance budget, currently
`BREACH`, which the owner has separately ruled must actually be fixed. Raising a
test's wall-clock timeout does nothing for it. B1 is compared against a measured
p50/p95 inside `verdict()` and is surfaced only by
`expect(budgetVerdicts.some(v => v.verdict === "BREACH")).toBe(true)` at the end of
the test. **That assertion means this spec currently DEPENDS on B1 breaching and
would go red if B1 were fixed without that assertion being revisited at the
same time.** Anyone closing B1 must handle that line; this change does not touch
it. B3 is likewise untouched. Both remain listed as open non-blocking items by
the WS-7 seam guard (`B1=BREACH, B3=BREACH`).

Confirmed against a post-run manifest snapshot: `budgets` byte-identical to the
committed baseline, `roomTransitionP50@6x` and `roomTransitionP95@6x` still
`BREACH`, 48/48 iterations completed.

### The timeout flake did not recur in five e2e runs

| Run | e2e result | terminal-perf | manifest restored | `perf/` |
| --- | --- | --- | --- | --- |
| 1 | **5 passed / 1 failed**, exit 1 | 6.6 m = 396 s, then failed `:848` | sha256 match | clean |
| 2 | 6 passed / 0 failed, exit 0 | 50.2 s | sha256 match | clean |
| 3 | 6 passed / 0 failed, exit 0 | 38.3 s | sha256 match | clean |
| 4 | 6 passed / 0 failed, exit 0 | 51.7 s | sha256 match | clean |
| 5 | 6 passed / 0 failed, exit 0 | 40.8 s | sha256 match | clean |

**RUN 1 IS THE STRONGEST SINGLE PIECE OF EVIDENCE IN THIS ENTRY.** It executed
for 396 s - 96 s beyond the old 300 s budget - so under the previous figure the
run would have been killed by the timeout at 300 s exactly as T19 described. With
the raised budget it ran the harness to completion and then failed a **different**
assertion: `cold FCP 3748ms exceeded 3000ms at 6x throttle`. That is a different,
pre-existing flake, recorded by entry `0021:272` as run 1 of its five. It is NOT
the timeout flake, it is NOT B1, and it was NOT fixed here because doing so would
require weakening an assertion, which this task forbids. It is reported, not
suppressed.

The other four runs completed the whole spec in 38-52 s, far under either budget,
which is why they prove the flake is gone less directly than run 1 does: they show
the raised envelope is never reached on a quiet host, and run 1 shows that when it
is, there is now room for it.

## The instruction to correct entry 0043 - and why nothing was changed

The task stated that entry `0043` "reported that the changelog schema is
unenforced (`REQUIRED_FIELDS` doesn't exist)" and asked for that false gap claim
to be corrected. **It does not exist, so nothing was changed.** Recorded rather
than silently skipped, because a prediction that did not happen is not a pass of
the prediction.

What was checked, and what was found:

- A search of every tracked file for `REQUIRED_FIELDS` returns exactly two hits,
  both real: its definition at `ws7RegulatoryClaimGuard.test.mjs:697` and its use
  at `:1163`. It exists.
- The enforcement the task describes exists and is real:
  `ws7RegulatoryClaimGuard.test.mjs:1159-1169`, "gives every record all seven
  required fields with non-empty values", iterates `REQUIRED_FIELDS` over every
  file in `entries/` and fails on any missing or empty field.
- Entry `0043` contains no statement about the changelog schema at all. It was
  searched for `REQUIRED_FIELDS`, "changelog schema", "seven", "gap-free",
  "unenforced" and "D20": zero hits in all six.
- The ONLY "unenforced" statement about this schema anywhere in the repository is
  in commit `c4e3102`'s **message**, not in any changelog entry: "The existing
  `ws6SafetySeamGuard.test.mjs` only asserts the changelog directory and the
  README's field NAMES exist, so D20 was in practice unenforced." That is TRUE and
  remains true of `ws6SafetySeamGuard.test.mjs` specifically - `:154-161` asserts
  only that the README mentions `supersededBy`, `date` and
  `historicalTradesAffected`. And `c4e3102` is the very commit that ADDED
  `ws7RegulatoryClaimGuard`, so its sentence describes the state before itself.
- The only in-tree statement about the schema's limits is entry `0033:9-10`:
  "`ws7RegulatoryClaimGuard.test.mjs` validates each entry's seven required header
  fields but does not enforce a gap-free sequence across the directory." Both
  halves are TRUE - the field validation is at `:1159-1169`, and a search for any
  gap-free/contiguity assertion over `entries/` found none (the only `entryFiles`
  use is `:1197`, a claims-corpus join). `0033` is therefore correct as written
  and was not touched either.

Nothing was edited, because editing either record would have introduced the very
defect this repository keeps fighting: a note that no longer describes the code.

## Pre-existing flakes found, NOT fixed, and out of scope

Full-suite runs surfaced three files that flake on this host **identically with
and without this change** - present in all four baseline runs and in 6 of the 10
runs with the fix. They are the same species (a load-induced default-timeout
starvation) but in other files, and each would need its own root-cause and its
own evidence, so none was touched:

| File | Failure | Error |
| --- | --- | --- |
| `server/__tests__/crossRoomInvariantGate.test.mjs:748` | "tierBoundaryFixture.mjs remains the SINGLE tier-boundary authority" | `Test timed out in 5000ms` |
| `server/__tests__/t20rRouteAuthGates.test.mjs:238` | "POST /api/trading/paper/trade refuses" | `Test timed out in 5000ms` |
| `src/terminal/components/__tests__/TerminalShell.test.tsx:112` | "still renders a known room through the normal path" | `vi.waitFor` exhausted; `expected null not to be null` |

`t20rRouteAuthGates.test.mjs` is the closest sibling of the file this entry fixed
- it drives the same `handlers.mjs` graph through the same `vi.resetModules()`
+ `import()` pattern (`t20rRouteAuthGates.test.mjs:195-214` says so explicitly) and
carries no per-test budget. It is the obvious next candidate for the same
treatment and is recorded here so the next owner does not have to rediscover it.

**The suite is therefore NOT reliably green, and this entry does not claim it is.**
The 5431 / 1 / 0 floor was met on 6 of the 16 full-suite runs executed; the other
10 were red on those three pre-existing files.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run test --workspace @picc/dashboard`, fix reverted | 4 runs, all red, all failing `:229` of the target file |
| `npm run test --workspace @picc/dashboard`, fix applied | 10 runs, **target file green in all 10**; full-suite floor 5431 / 1 / 0 met on 6, red on the 3 pre-existing files in 4 |
| `ws7RouteAuthCoverageBehaviour.test.mjs` alone | 91 passed / 0 failed (85.7 s) |
| `npm run test:e2e --workspace @picc/dashboard` | 5 runs; timeout flake absent from all 5; 4 green, 1 failed on the separate cold-FCP assertion |
| `node scripts/ws7-seam-guard.mjs` | `verdict pass; 0 failing check(s)`, exit 0, with `62/74 route-auth-verdicts-deferred` and `B1=BREACH, B3=BREACH` unchanged |
| `node scripts/cross-room-invariant-gate.mjs --facts-file <real facts>` | exit 0, `failing rooms: none`, over the real 22 rooms |
| `git diff --check` | exit 0 |
| `apps/dashboard/perf/terminal-perf-manifest.json` | baseline sha256 `2d03db708b1e7e1154e7d8d148aeba638c8835b549b251c49796c3980a6be103`; restored byte-identically after **all five** e2e runs; rewritten every run (`e647882f`, `6d1962fc`, `a8e4989c`, `e114c8a8`, `4239df40` observed) |
| `git status` on `apps/dashboard/perf/` | clean |
| `apps/dashboard/server/data/`, `.playwright-tmp/` | untouched; nothing written, nothing tracked |
| encoding of both edited files | 0 CRLF, 0 bare CR, 0 U+FFFD, trailing newline present |

Two operational notes. `playwright.config.ts:6` hardcodes
`baseURL = "http://localhost:5173"` with `reuseExistingServer: false`, so port
5173 was checked before every e2e run; it was free on all five, and nothing was
stopped. The `--facts-file` the cross-room gate requires comes from
`collectRoomCompletionFacts()` in `apps/dashboard/src/terminal/domain/
roomCompletionFacts.ts`, which plain `node` cannot load because its import graph is
extensionless TypeScript resolved by vite; it was produced with
`npx vite-node` and `VITEST=1` set (otherwise `vite.config.ts`'s module-scope
`startTradingHud()` / `startLedger()` / `startScheduler()` keep the event loop
alive forever). That emitter was a scratch harness and is **not** checked in,
because adding a file under `server/scripts/` is outside the spec `:73`
file-touch union and no amendment was taken.

## Files changed

- `apps/dashboard/server/__tests__/ws7RouteAuthCoverageBehaviour.test.mjs` - twelve
  tests moved onto the per-test budget; `SWEEP_TIMEOUT_MS` renamed
  `ROUTE_BUDGET_MS` with its doc rewritten to carry both justifications; three
  stale prose figures corrected. **No assertion touched.**
- `apps/dashboard/e2e/terminal-perf.spec.ts` - `test.setTimeout` 300000 ->
  900000, with the arithmetic and the explicit not-B1 statement above it.
  **No assertion, budget, tolerance or sample count touched.**

## Out of scope, and deliberately untouched

- **B1 and B3.** Both remain `BREACH` and both must actually be fixed; that is a
  separate piece of work, and note the dependency recorded above - closing B1
  requires revisiting this spec's `expect(... "BREACH").toBe(true)` line at the
  same time.
- **The three pre-existing flakes** listed above.
- **The cold-FCP flake** (`firstContentfulPaintCold@6x`, 3748 ms against a 3000 ms
  budget) now visible because the timeout no longer masks it. Fixing it means
  changing a budget or a threshold, which this task forbids.
- **The changelog records `0043` and `0033`**, for the reasons given above.
