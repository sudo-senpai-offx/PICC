# 0045 - PERF_FLAKE_BUDGETS v2 -> v3

Execution record for the three owner-approved timeout fixes that entry 0044
explicitly left out of scope as "THREE PRE-EXISTING FLAKES FOUND, NOT FIXED",
plus the investigation of the fourth mode it recorded. Three files, three
different mechanisms, and one of the three was not a timeout at all.

rule: PERF_FLAKE_BUDGETS
version: v2
supersededBy: v3 (this record: docs/trading-logic/changelog/entries/0045-PERF_FLAKE_BUDGETS-v2-to-v3.md)
date: 2026-10-03
approvalDate: 2026-10-03
historicalTradesAffected: none
source: >-
  Owner instruction for this task, given 2026-10-03, to fix the three remaining
  timeout flakes left out of scope by commit 0dc9989, working alone. The brief
  named `apps/dashboard/server/__tests__/crossRoomInvariantGate.test.mjs:748`,
  `apps/dashboard/server/__tests__/t20rRouteAuthGates.test.mjs:238` and
  `apps/dashboard/src/terminal/components/__tests__/TerminalShell.test.tsx:112`,
  and required that every test in each file be enumerated first, that only the
  tests slow for the identified reason be moved onto a budget, and that a blanket
  across a whole file be treated as an anti-goal. It directed that 0dc9989's real
  discriminator - "does the test load the handler module graph", not "is it
  multi-request" - be reused. It flagged that the TerminalShell symptom was a
  `vi.waitFor` exhaustion rather than a vitest timeout, asked what it was actually
  waiting on before deciding whether a budget was even the right fix, and said
  explicitly that it might not be. It asked for the vitest worker
  `onTaskUpdate` transport error to be investigated and fixed "only if the fix is
  safe and principled". It forbade touching the `firstContentfulPaintCold@6x`
  budget, the B1 and B3 verdicts, any perf threshold, and any assertion strength,
  on the grounds that the first is the owner's separate decision and the second
  and third are not this task. Verification demanded: typecheck, at least eight
  full unit runs each reported individually, the WS-7 seam guard, the cross-room
  invariant gate over 22 rooms, `npm audit --audit-level=high`, and `git diff
  --check`. E2E was explicitly not needed.

reason: >-
  Two of the three were budget problems of exactly the kind 0044 fixed, and the
  third was a different defect wearing the same costume. The honest repair in
  every case was to widen one budget to the measured work and leave every
  assertion alone, with one exception: for TerminalShell the budget that had to
  move was `vi.waitFor`'s own deadline and not the test's, because `vi.waitFor`
  never consults `testTimeout`, so the obvious fix would have changed nothing and
  left the test red.

## What was enumerated, and the line actually drawn in each file

The three files were classified from their source and from measured timings
before anything was changed. The 0dc9989 discriminator was tried first and is
what settled `t20rRouteAuthGates.test.mjs`. It settles nothing in the other two,
and saying so is part of the record:

| File | Tests | `loadHandlers()` / handler-import | Bulk filesystem work | Process spawn |
|---|---|---|---|---|
| `t20rRouteAuthGates.test.mjs` | 41 | 37 | 0 | 0 |
| `crossRoomInvariantGate.test.mjs` | 73 | 0 | 1 | 10 |
| `TerminalShell.test.tsx` | 9 | 0 | 0 | 0 |

`crossRoomInvariantGate.test.mjs` never imports `handlers.mjs` at all, so
"does it load the handler module graph" selects nothing there. Its discriminator
is different and was measured rather than assumed: bulk synchronous filesystem
work. Exactly one of its 73 tests qualifies, and it is a 12x outlier in its own
file.

## Fix 1 - `t20rRouteAuthGates.test.mjs`, 37 of 41 tests

`loadHandlers()` ends in `vi.resetModules()` and then
`import("../handlers.mjs?t20r-route-auth-gates")`, so the first request in any
test that calls it pays a cold import of a ~6,375-line module and its whole
import graph. The discriminator is that call, not request count - and the flake
was reported at `:238`, a single-`call()` test, which is the proof.

Measured under full-suite concurrency the 37 affected tests span 745-3461 ms and
the two that never load the module graph measured 180 ms (`:253`) and 94 ms
(`:491`) - a clean bimodal split, 4x to 37x apart. Those two keep vitest's 5 s
default: `:253` reads `handlers.mjs` as source text and matches lines without
importing it, and `:491` only inspects directory paths it already holds. The two
tests that already carried `{ timeout: 30_000 }` (`:298`, `:317`) were left
untouched.

`HANDLER_BUDGET_MS = 20_000`, reusing 0dc9989's `ROUTE_BUDGET_MS` rather than
inventing a number: 5.8x this file's worst observed loaded test.

## Fix 2 - `crossRoomInvariantGate.test.mjs`, 1 of 73 tests

`:748` walks the entire repository root with `readdirSync`/`statSync`/
`readFileSync`, because the claim it proves is about the whole tree: no second
module anywhere declares the tier boundary. That cost is O(repository size) and
cannot be narrowed without making the assertion mean less.

Measured 1583 ms alone and 3859 ms under full-suite load, which is 77% of the 5 s
ceiling and has been observed past it. Its next-slowest sibling in the same file
is 317 ms loaded; the other 72 tests are 18-56 ms.

The ten tests that spawn the gate as a real process were deliberately left at 5 s.
They measured 92-317 ms loaded, 16x to 54x of headroom, and each already carries
its own `spawnSync({ timeout: 120_000 })` guard for the case that actually
matters - a child that fails to exit at all. Widening them would mean widening
past a guard that exists to catch a hang.

`REPO_WALK_BUDGET_MS = 20_000`, the same magnitude 0dc9989 ratified for this
defect class: 5.2x the worst observed loaded run.

## Fix 3 - `TerminalShell.test.tsx:112`, and why a budget on `it()` was wrong

This is the one that was not a timeout.

The test mounts `/suites/earnings/simulator`. `EARNINGS_ROOMS.simulator` is a
`lazy(...)` component (`MinistryRoom.tsx:56`), so `MinistryRoom` renders
`<Room />` and `header[data-room="simulator"]` does not exist until React has
resolved the dynamic `import("./EarningsRooms")`. The test was waiting on a module
load.

`vi.waitFor`'s default timeout is 1000 ms. Sixteen cold loads were measured with a
scratch probe: 1207, 1297, 1367, 1510, 1615, 1705, 1742, 2185, 2251, 2338, 2413,
2430, 2533, 2534, 2628, 2710 ms. The same load again once warm resolves in 4-5 ms,
so the cost is transform and registry cold start, not the component. The ceiling
was below the cold cost, so the outcome depended on whether Vite's transform cache
happened to be warm: the test failed at 1020 ms, 1032 ms and 1033 ms when its own
file was run alone, and passed inside a full suite. That is a cache-warmth
dependency, not a concurrency one - the opposite of the two server-side files.

**A per-test `timeout` would not have fixed it.** `vi.waitFor` enforces its own
deadline and never consults `testTimeout`; the failures landed at ~1020 ms under a
5000 ms test ceiling, which is the proof. Raising only the test budget would have
produced a still-red test and a misleading commit.

`LAZY_ROOM_WAIT_MS = 8_000` is ~3x the worst observed cold load (3 x 2710 =
8130), the sizing convention 0dc9989 states for this repo, and inside the range
the repo already uses for this kind of wait: `ministryRooms.test.tsx` waits on
this identical element at `:93` with `timeoutMs = 3000` (`:18`), and
`SettingsRoom`, `HoldingsEditor` and `FinanceTracker` all use
`WAIT = { timeout: 5000 }`. This file was the one place that waited with no
budget at all.

`LAZY_ROOM_TEST_MS = 10_000` accompanies it because a wait ceiling is only
reachable if it sits strictly inside the test ceiling. Without it, a chunk that
genuinely never resolves would be reported as an opaque "Test timed out in
5000ms" instead of the assertion that actually failed.

## The fourth mode - `[vitest-worker]: Timeout calling "onTaskUpdate"`

Investigated, not fixed, and the reason is that no safe fix exists.

The channel is birpc's. `DEFAULT_TIMEOUT = 6e4` - 60 seconds - is hard-coded in
`node_modules/vitest/dist/chunks/index.B521nVV-.js`. Every test result a worker
produces triggers `testRunner.onTaskUpdate`, which
`node_modules/vitest/dist/chunks/index.CwejwG0H.js` patches into
`rpc().onTaskUpdate(task, events)` and awaits. The main-thread handler is
`async onTaskUpdate(packs, events)` in `coverage.DfSpMS-b.js`, and
`_testRun.updated()` awaits `reportEvent()` for every event in the batch serially
before calling `vitest.report("onTaskUpdate", ...)`. When that single-threaded
drain exceeds 60 s, birpc's timer fires on the worker and `onTimeoutError` throws.

It is not configurable. Vitest's public surface exposes `testTimeout`,
`hookTimeout` and `teardownTimeout`; there is no `rpcTimeout`, and the string does
not appear anywhere in the shipped bundles.

It is not worker-count pressure either, which was the one plausible knob and was
measured rather than assumed: `npx vitest run --maxWorkers=6`, a 45% cut from the
default, still produced the error and cost 40% more wall-clock (261 s against
~172 s). There is therefore no configuration change that removes it without
trading suite wall-clock or worker isolation for it, which is not a safe or
principled repair for a transport-layer artefact.

It is pre-existing and independent of this work: reverting all three files and
running the suite twice produced it in 2 of 2 runs.

Its effect is precise and worth stating, because it is the only thing now standing
between this repository and a zero exit: vitest reports it as `Errors  1 error`,
which alone makes `npm run test` exit 1 on a run whose test results are
`5431 passed | 1 skipped`.

## The fifth mode, found and reported, not fixed

`executionAbsenceScope.test.mjs` is a further instance of Fix 2's mechanism: five
of its six tests each perform a recursive scan of `apps/dashboard/server`. It
failed once on `:78` with "Test timed out in 5000ms" during early measurement,
measuring 200-290 ms alone and 587-780 ms loaded. It is outside the scope this
brief set, it did not recur in any of the eight verification runs, and budgets do
not change how long a test takes, so nothing here can have fixed it. It is
recorded rather than silently left.

## Verification

`npm run typecheck` exit 0. Unit suite, `npm run test --workspace @picc/dashboard`:

| Run | Result | Tests | onTaskUpdate |
|---|---|---|---|
| 1 | exit 1 | 5431 passed, 1 skipped | yes |
| 2 | exit 1 | 5431 passed, 1 skipped | yes |
| 3 | exit 1 | 5431 passed, 1 skipped | yes |
| 4 | exit 1 | 5431 passed, 1 skipped | yes |
| 5 | exit 1 | 5431 passed, 1 skipped | yes |
| 6 | exit 1 | 5431 passed, 1 skipped | yes |
| 7 | exit 1 | 5431 passed, 1 skipped | yes |
| 8 | exit 1 | 5431 passed, 1 skipped | yes |

**The test floor was met on 8 of 8 runs: zero test failures, 5431 passed and 1
skipped every time.** Every non-zero exit is the single `Errors 1 error` above.

The red side, measured by reverting all three files and running twice: run 1 gave
2 failures (`crossRoomInvariantGate` "tierBoundaryFixture.mjs remains the SINGLE
tier-boundary authority", `TerminalShell` "still renders a known room through the
normal path"), run 2 gave those plus `t20rRouteAuthGates` "POST
/api/trading/paper/trade refuses" - which is the `:238` site - with
"Test timed out in 5000ms" recorded 2 and 4 times respectively. All three named
sites reproduced. `onTaskUpdate` appeared in 2 of those 2 baseline runs.

Gates: `ws7-seam-guard.mjs` "verdict pass; 0 failing check(s)" exit 0 with 62/74
and B1=BREACH, B3=BREACH unchanged; `cross-room-invariant-gate.mjs --facts-file`
"exit 0 (failing rooms: none)" over the real 22 rooms; `npm audit
--audit-level=high` exit 0 with 0 high and 0 critical (3 moderate `qs`);
`git diff --check` clean; nothing written under `apps/dashboard/server/data/` or
`.playwright-tmp/`; exactly one tracked lockfile, `package-lock.json`.

The facts-file emitter for the cross-room gate is a scratch harness run under
`vite-node` with `VITEST=1` and is not checked in, because adding a file under
`server/scripts/` is outside the spec :73 union and no amendment was taken. It
was deleted immediately after use.

No assertion, tolerance or budget value changed. No CRLF and no missing trailing
newline in anything added.
