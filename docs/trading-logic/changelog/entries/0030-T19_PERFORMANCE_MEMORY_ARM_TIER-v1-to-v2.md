# 0030 - T19_PERFORMANCE_MEMORY_ARM_TIER v1 -> v2

Execution record for WS-7 task T19: the B1-B12 verdicts, the B10 2 GB ceiling
gate, and the checked-in ARM probe artifact.

rule: T19_PERFORMANCE_MEMORY_ARM_TIER
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0030-T19_PERFORMANCE_MEMORY_ARM_TIER-v1-to-v2.md)
date: 2026-10-02
historicalTradesAffected: none
source: >-
  WS-7 task T19 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1363-1370`,
  the budget table at §4.6 (`:716-741`), the verdict-vocabulary note (`:739`),
  the provenance marker (`:741`), decisions D21 (`:309-316`) and
  **D21-SUPERSESSION (`:277-308`)**, acceptance criteria AC-043 (`:1109-1115`),
  AC-044 (`:1117-1123`) and AC-045 (`:1125-1131`), the ship gate (`:1495`),
  honesty notes 3, 4 and 25 (`:1461`, `:1462`, `:1487`), plan v1 §3.7
  (`:414-453`) with its Risks 1 and 11 (`:594`, `:604`), and the pre-existing
  five-run e2e table in entry 0021 (`:270-276`).

reason: >-
  T19 owns the last unresolved performance question in WS-7 and it owns it in the
  worst possible position: it must ratify numbers from the very spec that flakes
  ~1-in-3 on an unchanged tree, and the manifest it would ratify into "does not
  survive a failing run" (plan §3.7 item 3). A flake therefore destroys the
  evidence rather than merely delaying it.

  Two things had to be built rather than measured: the 2 GB ceiling gate that
  §4.6:731 records as "UNMEASURED - gate does not exist yet", and the ARM probe
  OUTPUT artifact that §4.6:741 and honesty note 25 (`:1487`) both record as
  absent from the repository while the probe SCRIPT is present.

  And one thing had to be un-built: the ~1800 ms ARM figure. It appears in four
  places in the spec and the owner withdrew it.

---

## 1. The B2 supersession, and where the divergence is recorded

**The spec contradicts itself, and the contradiction is the substance of this
task rather than an incidental defect.**

`D21-SUPERSESSION` (`:277-308`) **WITHDREW** the ~1800 ms ARM room-transition
ratification as unsound, **with no substitute adopted** (`:305-307`). Three
places in the spec still carry the withdrawn figure as live text:

| Location | Stale text |
|---|---|
| AC-045 `:1128` | "The ARM room-transition budget is **ratified at ~1800 ms p95**, derived from the measured 7.18× ARM/x86 ratio" |
| T19's own acceptance `:1368` | "**B2's budget is already ratified at ~1800 ms by D21**" |
| §9 ship gate `:1495` | "the ARM tier ratified at ~1800 ms with 250 ms retained as x86-only" |

A fourth location is stale in the same direction without repeating the number:
the §4.6 verdict-vocabulary note (`:739`) and provenance note (`:741`) both still
describe B2 as "ratified-but-not-directly-measured", which was true before the
supersession and is not true now.

**Resolution: the supersession wins.** §4.6 B2 at `:723` — "**WITHDRAWN - NO
DEFENSIBLE FIGURE** ... **No replacement figure is substituted**" — is the later
and governing text, and it is what this task implements. B2's row in
`apps/dashboard/perf/budget-verdicts.json` carries
`verdict: "WITHDRAWN_UNMEASURED"`, `budgetMs: null`, `budgetStatus: "WITHDRAWN"`
and `ratified: false`.

**Where the divergence is recorded, so it is visible rather than resolved in
silence:**

- `budget-verdicts.json` → `specDivergence`, naming the supersession, the
  governing line (`:723`), all four stale locations by line number, and the
  resolution.
- The guard `perfBudgetVerdicts.test.mjs` asserts that **no row anywhere carries
  `1800` as a budget**, that B2 is not `pass`, that B2 has no numeric budget, and
  that B2 is not marked ratified. An implementer who later re-introduces the
  withdrawn figure fails the suite.
- §4 below records the **third, independent** ground for the withdrawal that this
  task found.

### The vocabulary still contains `RATIFIED_UNMEASURED`

`:739` asks for a token representing "ratified but not measured", and T19's stale
acceptance line asks for the same. That token exists and is fully specified. It
is simply **not B2's current state** — B2 is withdrawn, not ratified. Keeping
`RATIFIED_UNMEASURED` reachable means the pre-supersession state stays a defined,
distinguishable state instead of an undefined one, and it means a future
re-ratification has a correct token to use rather than being forced into `pass`.

---

## 2. The flake disposition, recorded BEFORE any number was ratified

Plan §3.7 item 1 requires the disposition in writing before ratification, not
after. This section was written first; §3 reports what the runs then produced.

**The flake rate observed on an unchanged tree by this task: 4 of 5 runs failed**
(80%), against the ~1-in-3 previously recorded. The measured consequence is
sharper than "sometimes slow":

> **In 4 of 5 runs the harness never reached the 6× throttle rate at all.**
> Only run 4 completed all 48 iterations. The failure is not a slow assertion; it
> is the run dying before the measurement it exists to take.

### 2.1 What was ELIMINATED, with evidence

**The swallowed click — ELIMINATED for these five runs.**
`terminal-perf.spec.ts:629-631` and `:637-639` swallow `page.click()` rejections,
which is why entry 0021 could only ever say "timed-out". With fix round 3's
recording in place, all five runs report `clickFailureCount: 0`, and every
iteration record in every run carries `dashboardClickError: null` **and**
`marketsClickError: null`. The click landed every single time, including in the
four runs that failed. Whatever kills these runs, it is not a click that never
landed. This corroborates the prior 8-runs-0-captured result from a second angle:
the earlier runs could not have observed a swallowed click either, because the
harness did not record one.

**"A 429ing endpoint gates the marker" — stays DISPROVEN, now with a positive
control.** 429s are present and heavy (`endpointFailures` in run 4 records
`/api/trading/screener` 40 rate-limited, `/spread` 39, `/news` 35,
`/api/trading/copilot` 21, `/api/packs/registry` 22), and the browser console is
full of `429 (Too Many Requests)`. But in **run 3** the iteration that hung
recorded `apiCalls: 0` — no request was in flight when
`waitForSelector("[data-room='dashboard']")` never resolved. A request-gated
marker cannot be the mechanism for that instance. Consistent with the plan's
existing finding at `:421-423`, and this task does **not** re-propose it.

**The lazy `MinistryRoom` chunk — NOT IMPLICATED by any observation, and not in
the measured path.** The transition loop only ever visits `dashboard` and
`markets` (`terminal-perf.spec.ts:632`, `:640`); it never touches Ministry. T8/T9/T10
have since landed the room surfaces, so the hypothesis is differently shaped from
when it was proposed, but nothing in five runs of evidence points at it.

### 2.2 What was ESTABLISHED, and is the likeliest cause

**The harness's own timeout budget is arithmetically incompatible with the
measured cost. This is new, and it is sufficient to explain the flake on its
own.**

- Run 4 — the only run that completed — took **281 734 ms of its 300 000 ms
  budget: 6 % headroom.** The harness asserts a 250 ms per-transition budget
  while being able to afford roughly 6 s per iteration at 6× throttle.
- Run 1 aborted at **295 887 ms having completed 32 of 48 iterations.** It did
  not fail an assertion; it ran out of wall clock mid-loop.
- At the observed 4× p95 (4875–13 781 ms) plus a comparable markets leg, 48
  iterations cannot fit in 300 s. The margin is gone before the run starts.

A suite running at 94 % of its time budget will fail intermittently on an
unchanged tree. That is the flake, and no room or component needs to be at fault.

### 2.3 Two latent defects found in the harness's own evidence

Both were found by reading the code rather than trusting field names, and both
would have produced wrong numbers for anyone consuming the artifact.

1. **`warmup` is misnamed — it is inverted.**
   `terminal-perf.spec.ts:623` calls `beginIteration(i, i >= WARMUP_SAMPLES)`, and
   `:635` pushes to `transitionSamples` on the same condition. So the evidence
   file's `warmup` field is **`true` for the 12 MEASURED steady samples** and
   `false` for the **4 DISCARDED warm-up iterations**. Selecting
   `warmup === false` silently measures exactly the samples the harness throws
   away. My first extraction pass made this error and was corrected against the
   harness source.

2. **`roomTransitionMs` is the DASHBOARD leg, not the markets leg.**
   `:620-622` says so outright — "`elapsed` is `t0 -> the DASHBOARD marker` only …
   The markets half is timed separately below". So B1's manifest figure and the
   evidence file's `marketsMarkerMs` column are **different measurements of the
   same loop**. Both are reported in §3 rather than either being presented as
   *the* transition number.

### 2.4 What remains UNROOTED

Not everything is explained. Runs 2, 3 and 5 died on
`page.waitForSelector: Timeout 15000ms exceeded` with the click recorded as
landed (`dashSelector: "timed-out"`, `marketsSelector: "not-reached"`,
`apiCalls: 0` in run 3). Run 2's hung iteration did record `apiCalls: 4`, so a
fully clean "no request in flight" reading holds for run 3 but not for run 2.
**The 15 s selector timeout remains unexplained** and is carried forward as
UNROOTED. T19 did not root it and does not claim to have.

---

## 3. Every run reported, including the failures

Format copied from entry 0021 `:270-276`. N = 5, executed sequentially on an
otherwise-idle session with no other build or test running. Per-run evidence
files were read from `apps/dashboard/test-results/terminal-perf-transition-evidence.json`,
which is written from an `afterEach` and therefore **survives a failing run** —
the manifest does not, so for runs 1, 2, 3 and 5 it still held the previous
run's committed numbers and was **not** used.

| # | Outcome | Wall clock | 6× reached? | 1× p95 | 4× p95 | 6× p95 | `clickFailureCount` | `harnessAborts` | Failure |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **FAIL** | 295.9 s | **no** | 393 | 13 781 | — | 0 | 36 | 300 s test timeout, 32/48 iterations done |
| 2 | **FAIL** | 310.0 s | **no** | 573 | 13 775 | — | 0 | 37 | `waitForSelector` 15 s timeout at 4× |
| 3 | **FAIL** | 310.1 s | **no** | 597 | 12 631 | — | 0 | 33 | `waitForSelector` 15 s timeout at 4×; `unanswered: 12` |
| 4 | **PASS** | 281.7 s | yes | 568 | 4 875 | **7 238** | 0 | 55 | — |
| 5 | **FAIL** | 128.5 s | **no** | 207 | 4 908 | — | 0 | 44 | `waitForSelector` 15 s timeout at 6×, iteration 0 |

(All figures are the **dashboard leg**, nearest-rank/harness-equivalent p95, in ms,
against the 250 ms x86-only tier. Run 4's 6× p50 is 5 804 ms.)

**No run was dropped.** Four of five failed. A run dropped because it flaked is a
fabricated pass, and the 6× figure below exists because exactly one run survived.

### The spread IS the finding

- **4× p95 across five runs: 4 875 / 4 908 / 12 631 / 13 775 / 13 781 ms — a
  2.83× spread, and bimodal.** Two runs near 4.9 s, three near 12.6–13.8 s. No
  change to the tree can produce a 2.83× bimodal swing; this is machine and
  environment load, exactly the signature entry 0021 `:286-289` reported for cold
  FCP (3 024 ms vs 796 ms, 3.8×).
- **1× p95 across five runs: 207 / 393 / 568 / 573 / 597 ms — 2.88×**, and
  **breaching the 250 ms tier in 4 of 5 runs even unthrottled.** The D21
  supersession's table (`:296`) records 1× as `PASS` at 113/173 ms; that does not
  reproduce here.
- **6× p95: one sample, 7 238 ms.** Not a distribution.

### What is ratified, and what is explicitly NOT

**B1's VERDICT is ratified: `BREACH`.** It is over-determined. All 24 per-rate p95
values measured across five runs, at both throttle rates that completed and on
both legs, exceed the 250 ms tier — by 0.8× at the very best single reading
(1× p95 = 207 ms in run 5) and by up to 55×. No plausible sample could make this
row pass, so the verdict does not depend on the flake.

**B1's FIGURE is NOT ratified.** `ratifiedFigureMs: null` and
`sampleAdequacy: "INSUFFICIENT_SINGLE_RUN"`. Only 1 of 5 runs reached 6×, and plan
§3.7 item 2 forbids ratifying a number from one run. The 12 raw samples are
recorded in the manifest so the verdict is re-derivable, and the 7 238 ms figure is
reported here as **the single surviving observation**, not as the settled value.

**B3's verdict is unchanged: `BREACH`.** It was not fixed and not softened. Two
honesty notes travel with it: no 10k-table-scroll raw samples exist anywhere in the
manifest (the only 16 ms budget it carries is `deterministicDomain`, a different
measurement), and the spec's own evidence pointer "manifest `:38-39`" resolves to
the `roomTransitionP95@6x` row — a room-transition row, not a table-scroll row.
The verdict is carried at the spec's stated value and in the conservative
direction, with the provenance defect recorded rather than papered over by
inventing samples. The manifest encodes this as `carriedBreachFrom`, a path that
can only ever yield `BREACH` and never `pass`.

### Four producers landed since the baseline was taken

Recorded because it changes what these numbers mean:

- **T7R-B added `POST /api/trading/copilot` to `MARKETS_PANELS`**
  (`terminal-perf.spec.ts:180`), so the Markets transition now makes **one more
  request** than when any earlier baseline was taken. **Pre-T7R-B figures are not
  comparable** and are not treated here as a baseline to beat. That route also
  appears in this run's 429 set (21 rate-limited), so it is live in the loop.
- **T10 reused eleven existing routes across 16 room instances with zero new
  routes.**
- **T8/T9/T10 each landed room surfaces**, so the lazy-chunk hypothesis is now
  differently shaped than when it was proposed.
- `copilot-engine-bench.json` and `budget-verdicts.json` are **separate artifacts
  by design**, following T13's precedent: the e2e manifest does not survive a
  failing run, so its evidence is not coupled to an unrelated browser flake.

---

## 4. B12 — a third, independent ground for the withdrawal

`scripts/arm-probe.mjs` was run five times on this host and its output is now
checked in (`apps/dashboard/perf/arm-probe.json`), which closes §4.6:741 and
honesty note 25 (`:1487`).

| | Owner-relayed | This host (x86, 5 runs) |
|---|---|---|
| `bench_checksum` | `2095.419` | **`2095.419` — identical every run** |
| `bench_ms` (x86) | `419.48` | **572.02 – 741.13** |
| platform | Snapdragon 680 (ARM64) | `win32-x64` |

Two separable claims sit in B12 and they do not stand or fall together, so the
row carries `PARTIAL_VERIFICATION` with the halves named:

1. **Checksum identity — CORROBORATED.** An independent machine computes the same
   accumulator, so the bench really is deterministic across machines.
2. **The 7.18× ratio — NOT REPRODUCED.** This host is 1.36–1.77× slower than the
   x86 machine the ratio was computed against. Had the relayed ARM figure of
   3 012.39 ms held, the ratio against this host is **4.67×, not 7.18×**.

That is a **third independent reason** the ~1800 ms derivation is unsound, beyond
the supersession's two (a CPU-only ratio cannot transfer to a render-bound path,
and a max-of-5 figure is not a percentile). A ratio that moves with the host
cannot be carried onto a transition budget.

**B9 stays `UNVERIFIED`.** No ARM64 device is attached to this host
(`platform=win32-x64`). The owner's ARM jitter (p50 0.84 / p95 4.47 / max 7.71 ms)
is retained **verbatim** under `ownerRelayed` with its provenance and is **not**
restated as measured by this repository. **No ARM number has been fabricated.**
This follows T13's precedent (entry 0025): upgrade what was actually verified,
leave the rest honest.

---

## 5. B10 — the 2 GB gate, built and observed firing

`scripts/ram-ceiling-gate.mjs` is the gate §4.6:731 records as absent.

**Measurement method.** `apps/dashboard` serves the UI *and* the entire `/api/*`
surface from **one** node process — `vite.config.ts:92-93` installs `handleApi` as
dev-server middleware — so "whole stack" is the vite process tree. The gate boots
it, waits for an HTTP response, discards a warm-up, then sums WorkingSetSize
across the tree at 400 ms and takes the peak. This is deliberately **not** the
browser tab's `performance.memory.usedJSHeapSize` (~30 MB in the e2e manifest):
that is one tab, and B10 is a RAM ceiling for the product.

**Two valid runs: 385.5 MB and 372.1 MB. The higher is recorded: 385.5 MB, which
is 18.8 % of the frozen 2 048 MB ceiling. Verdict: `pass`.** The peak decomposes as
`node.exe 143.5 MB + conhost.exe 7.6 MB + esbuild.exe 105.5 MB`, recorded in the
artifact so the number is checkable rather than asserted.

**The gate was observed FIRING, as AC-043 requires.** Its prohibited side effect
(`:1113`) is verbatim: "A gate that has never been observed failing is not
accepted as working; a warning is not a gate."

```
$ node scripts/ram-ceiling-gate.mjs --self-test
  ok    compliant 1024 MB: got pass, expected pass
  ok    breaching 2049 MB: got BREACH, expected BREACH
  ok    exactly at the 2048 MB ceiling: got pass, expected pass
  ok    no measurement: got UNMEASURED, expected UNMEASURED
  ok    null measurement: got UNMEASURED, expected UNMEASURED
[picc-ram-gate] self-test PASSED (5 cases; the BREACH branch was observed firing: true)
=== exit code: 0 ===

$ node scripts/ram-ceiling-gate.mjs --fail-branch
[picc-ram-gate] FAIL-BRANCH PROOF - synthetic peak 2560 MB, ceiling 2048 MB. Not a measurement; this is the gate refusing, driven by a literal.
[picc-ram-gate] verdict = BREACH; exiting 1 as a real over-ceiling build would.
=== exit code: 1 ===
```

The `--fail-branch` proof exists because a decision function returning `BREACH` is
not yet a gate — a gate is a thing that **fails a build**, and that is a non-zero
exit. `ramCeilingGate.test.mjs` spawns it and asserts exit code 1, so if the failing
branch ever stopped failing the suite would go red.

**Both synthetic branches are labelled as NOT measurements.** Nothing is booted and
no RSS is sampled in either; a literal is fed to the decision function. Quoting a
synthetic 2 560 MB peak as though it were observed RSS would be the same fabricated
pass this task exists to prevent, pointed the other way. The default mode supplies
the number; the self-tests supply the proof that the number can be refused.

**The ceiling is frozen.** `RAM_CEILING_MB = 2048` is a constant with no CLI flag
and no environment override; the guard asserts both the literal declaration and
the absence of any env-var read. T19's bisect line (`:1370`) says the gate "must
not be softened to make a room pass", and **no room failed because of this gate**,
so no softening was even attempted.

**Two real bugs found and fixed while building it, both recorded because both had
produced a wrong number:**

1. **Unit error, 1024×.** `Win32_Process.WorkingSetSize` is in **bytes** and
   `/proc/.../VmRSS` is in **kB**. An early version divided once and labelled the
   result MB, turning a real **257 MB** stack into a fabricated **263 GB
   "BREACH"**. Had that been reported, B10 would have shipped as a false breach.
   Each platform is now normalised to MB at the source, and `summarise` no longer
   divides at all.
2. **Readiness probe on the wrong address family.** vite binds IPv6 `::1` on
   Windows, so a `127.0.0.1` probe was refused against a perfectly healthy stack
   and `stackReady` stayed false — which produced an artifact whose `measured`
   block was a null placeholder sitting next to a `pass` verdict derived from a
   real reading. **Two numbers disagreeing inside one file is exactly the defect
   this task exists to prevent.** All three families are probed, and `measured` now
   always carries the real reading.

**Store isolation verified, not assumed.** Booting the stack writes to stores. Every
`PICC_*_DATA_DIR` / `*_FILE` variable was redirected into a temp root, and
`PICC_VAULT_KEY` was supplied so `vault.mjs:49-53` short-circuits **before** it can
read or mint the hardcoded `server/data/picc-vault.key` — which is the one store
with no isolation variable, a gap the vitest setup documents at its own
`:151-154`. A full-tree fingerprint (path, size, mtime, SHA-256) taken before and
after the run: **7 372 entries before, 7 372 after, 0 added, 0 removed, 0
changed.** Nothing was written to the real store.

---

## 6. The extended verdict vocabulary, and the re-derivation property

AC-044 (`:1120`) requires `pass`, `BREACH`, or `UNMEASURED`. Three tokens cannot
describe twelve rows, and §4.6:739 says so in the spec's own words. The vocabulary
is now seven tokens in `scripts/perf-budget-verdicts.mjs`:

| Token | Satisfies a budget? | Measured? | The state it names |
|---|---|---|---|
| `pass` | **yes** | yes | recomputed percentile within budget |
| `BREACH` | no | yes | recomputed percentile over budget; or a spec-carried breach |
| `UNMEASURED` | no | no | budget set, no measurement path |
| `RATIFIED_UNMEASURED` | no | no | budget ratified by decision, never sampled |
| `WITHDRAWN_UNMEASURED` | no | no | budget withdrawn as unsound, **no substitute** — B2 |
| `UNVERIFIED` | no | no | a figure exists but was never reproduced |
| `PARTIAL_VERIFICATION` | no | no | separable claims, some corroborated, some not — B12 |

**Exactly one token satisfies a budget**, asserted directly
(`PASS_LIKE === ["pass"]`). `RATIFIED_UNMEASURED` and `WITHDRAWN_UNMEASURED` are
asserted to be distinct descriptions, because `:739` and `:723` blur exactly that
pair and collapsing them would re-open a decision the owner made.

### The property that matters

**The verdict is re-derivable from the row's own numbers, so a fabricated pass
fails.** `verdictForRow(row)` is never told the verdict; it recomputes it. The
manifest is self-contained — B5, B6 and B10 carry their raw sample series inline
(T11's 200 samples each, the gate's 17) rather than pointing at a sibling file, so
re-derivation needs nothing but this file.

The load-bearing invariant, asserted as a structural property:

> **`verdictForRow` has no code path that returns `pass` without comparing a
> measured quantity against a numeric budget.**

Everything else is arranged around that. A withdrawn budget returns
`WITHDRAWN_UNMEASURED` **before** any sample arithmetic, so **feeding B2 raw
samples cannot manufacture a pass** — asserted directly. `pass` with no samples,
`pass` with no budget, and over-budget samples labelled `pass` are each asserted to
fail. `nearestRank` is a deliberately **different implementation** from the
harness's `sorted[floor(p*n)]`, and the guard asserts the two agree on B1's
samples, so a wrong percentile helper is caught rather than agreeing with its own
bug.

This is the discipline `perfArtifact.test.mjs:9-18` established for B5/B6, extended
from two rows to twelve and from three tokens to seven. As that file puts it, it
"asserts the thing that actually matters … and it is the one that cannot rot."

### Every budget's verdict

| # | Budget | Budget | Verdict | Basis |
|---|---|---:|---|---|
| B1 | Room transition, x86 throttled proxy | ≤ 250 ms p95 (x86-only) | **`BREACH`** | 12 raw samples, p95 7 238 ms; over-determined across 24 readings. Figure **not** ratified (1 run) |
| B2 | Room transition, ARM floor class | **withdrawn** | **`WITHDRAWN_UNMEASURED`** | no defensible figure; needs a direct on-device sample |
| B3 | 10k virtual-table scroll frame | ≤ 16 ms p95 | **`BREACH`** | carried from §4.6:724; no samples exist, citation defective. **Not fixed** |
| B4 | Terminal first interactive paint (warm) | ≤ 2000 ms p95 | `UNMEASURED` | no measurement path |
| B5 | Copilot confluence evaluation | ≤ 100 ms p95 | `pass` | 200 raw samples, p95 0.124 ms (T11) |
| B6 | Copilot veto evaluation | ≤ 25 ms p95 | `pass` | 200 raw samples, p95 0.081 ms (T11) |
| B7 | Realtime tick to visible | ≤ 50 ms p95 | `UNMEASURED` | no measurement path |
| B8 | Chart pointer/highlight interaction | ≤ 50 ms p95 | `UNMEASURED` | no measurement path; spec's pointer collides with B7 |
| B9 | ARM jitter p50/p95/max | informational | **`UNVERIFIED`** | no ARM64 device; owner figures retained verbatim, not restated |
| B10 | **Peak RSS, whole stack** | **≤ 2048 MB** | **`pass`** | **measured 385.5 MB peak**, two runs, tree working set |
| B11 | Needle 3 in-process footprint | informational | `UNVERIFIED` | vendor-reported, never independently verified |
| B12 | Deterministic bench parity | checksum identity | **`PARTIAL_VERIFICATION`** | checksum corroborated; 7.18× ratio not reproduced |

---

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run test --workspace @picc/dashboard` (baseline, before changes) | run 1: **3 failed** / 4894 passed / 1 skipped — the known concurrency flake, on an unmodified tree; run 2: **4897 passed / 1 skipped / 0 failed** |
| `node scripts/ram-ceiling-gate.mjs --self-test` | exit 0, both branches exercised |
| `node scripts/ram-ceiling-gate.mjs --fail-branch` | **exit 1 — the gate observed refusing** |
| `node scripts/ram-ceiling-gate.mjs` | peak 385.5 MB / 2048 MB → `pass`, exit 0 |
| Real-store fingerprint across the gate run | 7 372 → 7 372 entries, 0 added / 0 removed / 0 changed |
| `node scripts/arm-probe-record.mjs` | B9 `UNVERIFIED`, B12 `PARTIAL_VERIFICATION`, artifact written |
| e2e perf runs | **5 executed, 4 failed, 1 passed — all reported above, none dropped** |

Unit count: **4897 + 54 new = 4951**, across 371 files. The 54 are the 35 in
`perfBudgetVerdicts.test.mjs` and the 19 in `ramCeilingGate.test.mjs`.

### What could NOT be verified

- **B2.** No ARM64 device is attached and no x86 proxy can substitute — that is the
  entire argument at `arm-probe.mjs:2-6`. The direct on-device room-transition
  sample remains outstanding and is not simulated.
- **B9's ARM jitter.** Same reason. `UNVERIFIED`, not estimated.
- **The 15 s selector timeout.** Runs 2, 3 and 5 died on it and it is still
  UNROOTED (§2.4). T19 established the timeout-budget mechanism for run 1 and
  eliminated the swallowed click and the 429 gate for all five runs, but did not
  explain the selector timeout and does not claim to have.
- **B3 and B4/B7/B8's real figures.** No measurement path exists for any of them.
- **Whether the owner wants a Playwright leg in CI.** Plan Risk 12 (`:605`)
  recommends it but marks it `UNVERIFIED` pending an owner decision, because with
  the flake at 4-in-5 an e2e CI leg would be intermittently red. **T19 did not add
  one.** With §2.2 in hand the owner may now want the harness timeout budget
  revisited first, which is a separate change to an existing e2e assertion.

### Spec self-contradictions found

1. **B2 / the withdrawn ~1800 ms figure — four stale locations** (§1 above). The
   substantive one; resolved in favour of the supersession and recorded in the
   manifest and guarded by a test.
2. **§4.6 B3's evidence pointer.** `:724` cites "manifest `:38-39`", which is the
   `roomTransitionP95@6x` row — a room-transition row — for a budget described as a
   10k-table scroll frame, while the manifest's only 16 ms budget is
   `deterministicDomain`, a different measurement. **Left unfixed**: correcting it
   is a spec amendment, not a T19 edit, and inventing samples to make the citation
   resolve would be a fabricated measurement. Recorded on the row.
3. **§4.6 B8's evidence pointer.** `:729` cites "manifest `:58-59`", which is the
   `tickToVisible` block — B7's budget. Left on the row as a pointer collision.
4. **Two harness defects** (§2.3): the inverted `warmup` flag and the
   dashboard-leg/markets-leg conflation in `roomTransitionMs`. Both are in e2e
   code and both change how the evidence artifact should be read, but fixing
   either means editing an existing e2e harness, which is outside T19's file list.
   Reported, not silently patched.

## Net effect

Added:

- `scripts/ram-ceiling-gate.mjs` — the B10 2 GB ceiling gate
- `scripts/arm-probe-record.mjs` — consumes the probe, checks its output in
- `scripts/perf-budget-verdicts.mjs` — the extended vocabulary and the derivation
- `apps/dashboard/perf/budget-verdicts.json` — B1-B12 with raw samples
- `apps/dashboard/perf/ram-ceiling-gate.json` — B10's measured peak
- `apps/dashboard/perf/arm-probe.json` — the ARM probe output (absent before)
- `apps/dashboard/server/__tests__/perfBudgetVerdicts.test.mjs` — 35 tests
- `apps/dashboard/server/__tests__/ramCeilingGate.test.mjs` — 19 tests

Changed: no existing file. `apps/dashboard/perf/terminal-perf-manifest.json` is
rewritten by every e2e run and was restored with `git checkout --` after each one,
so it is byte-identical to `HEAD`.

Not done, deliberately: no ~1800 ms figure anywhere; no number ratified from a
single run; no failing run dropped; no `pass` recorded for anything measured,
inferred or unavailable; B1, B3 and the RAM ceiling untouched; no fake ARM
measurement; the pre-T7R-B transition not treated as a comparable baseline.