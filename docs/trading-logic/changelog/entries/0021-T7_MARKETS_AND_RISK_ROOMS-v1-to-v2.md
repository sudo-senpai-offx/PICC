# 0021 - T7_MARKETS_AND_RISK_ROOMS v1 -> v2

Execution record for WS-7 task T7: room instances 1 and 2 of 18, in D1's
order — Markets/COP-22, then Risk — each COMPLETE before the next, each
carrying the D27 completeness flag.

rule: T7_MARKETS_AND_RISK_ROOMS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0021-T7_MARKETS_AND_RISK_ROOMS-v1-to-v2.md)
date: 2026-09-30
historicalTradesAffected: none
source: >-
  WS-7 decision D1 (room order), WS-7 decision D27 (all 18 rooms stay in scope;
  flag WS-8 overlap, never silently trim), WS-7 rule R7.1, R7.5, acceptance
  criteria AC-020 and AC-041, and WS-7 task T7 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1255-1262`
  together with the shared scope note at `:1253` and the D27 obligation at
  `:1231`.

reason: >-
  Neither of the two room instances T7 names had a surface. Markets/COP-22 had
  no deterministic score surface at all — the terminal had a REMOTE copilot
  panel (`CopilotPanel`, AC-014) which is forbidden by name from showing a
  score, and no component anywhere rendered a confluence score, a per-expert
  contribution, or a fired veto. Risk had no surface either, and two of the
  three capabilities T7 names for it do not exist in this tree: there is no 2%
  daily drawdown disable and no 3-strike 24h key lock. Both facts were carried
  only by the absence of a component, so nothing asserted them, nothing
  rendered them, and neither room could be reviewed against AC-020 at all.

  Adding the surfaces without naming the two gaps would have produced the
  unflagged trim AC-020 prohibits: a Markets room that renders three headings
  and no values, and a Risk room that renders a 2% rail and a 3-strike state
  that do not exist. So both rooms carry an explicit completeness verdict in
  code, and both record the pending scope as WS-7 T11 rather than absorbing
  it.

## What the spec actually required

Quoted from the spec rather than paraphrased, because the two halves of the
acceptance line pull in different directions and the difference matters.

T7's acceptance (`:1260`):

> **Acceptance:** AC-020 passes for Markets/COP-22, then for Risk. AC-041's
> order holds. Markets surfaces the score, per-expert contributions, and fired
> vetoes; Risk surfaces ATR, the 2% drawdown disable, and the 3-strike state
> **with honest unavailability**.

AC-020 (`:928-930`):

> **Expected observable result:** It renders real data with honest provenance,
> has no reserved placeholder that could be trivially filled later, meets
> 1280×800 and WCAG AA, shows `WS-7+` for any unowned capability, and its own
> invariants are green. The completion record **explicitly flags** whether the
> room is genuinely complete or whether scope logically belongs to WS-8, naming
> that scope.
>
> **Prohibited side effect:** It may not be declared COMPLETE with a reserved
> block a later task was expected to fill, and — per D27 — **scope may not be
> silently trimmed** … All 18 rooms stay in WS-7 scope; a flagged WS-8 handoff
> is a legitimate outcome, an unflagged one is a defect.

T7's file list (`:1258`):

> **Files:** room implementations under
> `apps/dashboard/src/terminal/routes/`, their tests, the Copilot score surface
> for Markets, the risk surface for Risk.

Two facts follow from reading those together, and they are the whole shape of
this task.

**First, "with honest unavailability" is the specified behaviour for Risk, not a
degraded fallback.** Two of the three named capabilities do not exist in this
tree at all. A tree-wide search for `threeStrike`, `3-strike`, `strikeCount`,
`keyLock` and `keyLocked` returns nothing, and no 2% daily drawdown disable
exists. The nearest numbers that DO exist are deliberately not substituted:
`v32Copilot.mjs:28`'s `SESSION_HALT_FLOOR_PCT = 2` is a **session** halt, and
`u4faRisk.mjs`'s daily limit is **5%**. Displaying either under this room's
label would read as a working safety rail, and a safety rail that looks present
and is not is worse than one that is visibly absent.

**Second, the deterministic engine that produces Markets' three things is a
different task.** T11 owns "the rule engine: regime classifier, six weighted
experts, confluence, tiers, six vetoes, four boosters + Unicorn, and the risk
layer" and is P0; T7 is P1. T11 has not run. So Markets can surface the score,
the per-expert contributions and the fired vetoes as a fully typed, fully
rendered, fully tested surface, and cannot supply their values without
fabricating them.

Both of those are exactly what D27's flag exists to record. Neither is a WS-8
boundary, and recording either as one would be false.

## Room completion record 1 of 2 — Markets / COP-22

| Field | Value |
| --- | --- |
| Room | `markets` (D1 order 1 of 18) |
| Implementation | `apps/dashboard/src/terminal/routes/MarketsRoom.tsx` |
| Surface | `apps/dashboard/src/terminal/components/CopilotScoreSurface.tsx` |
| Domain | `apps/dashboard/src/terminal/domain/copilotDecision.ts` |
| Mounted at | `/suites/trading/markets`, composed into the existing `pages/ministry/MarketsRoom.tsx` |
| Tests | `apps/dashboard/src/terminal/routes/__tests__/MarketsRoom.test.tsx`, 26 |
| **D27 verdict** | **`surface-complete, producer-pending` — NOT genuinely complete** |
| Pending scope | **WS-7 T11** — the deterministic Copilot engine: six weighted experts, confluence, tiers, six vetoes |
| WS-8 handoff | **None.** No scope in this room logically belongs to WS-8. |
| Why no WS-8 handoff | The score, the per-expert contributions and the fired vetoes are all WS-7 T11 determinism work. The gap is in-workstream task ordering (T7 is P1, T11 is P0), not a boundary disagreement between workstreams. |

The verdict is not a formality and it is not a trim: it is carried in code as
`MARKETS_COMPLETION` in the room file, exported from the terminal entry point,
and asserted by two tests — one that the verdict is not the bare word
"complete", one that `ws8Handoff` is a present field (a `null` statement is a
different artifact from an absent key). A verdict that lives only in a markdown
file is a verdict nobody re-reads when the next change lands.

**Why this room is genuinely complete on the surface.** All three things T7
names are rendered per-item, not summarised: the score, all six expert rows
with their weights and per-row availability reasons, and the fired vetoes with
rule id, rule version, what was suppressed, and the inputs. Four prohibitions
are enforced as code rather than prose, because a prohibition in a component is
one the next author routes around:

- **AC-023, no interpolation band.** `bandOf` uses `>= 85` and `>= 70` with no
  rounding and no `>= 84.5`. Table-tested at 86, 85, 84.999, 84, 70, 69.999,
  69, 0. An unscoreable state maps to `ignore`/`hold`/`0%` and is rendered as
  the word `unscoreable` with `data-score="unscoreable"` — never as `0`, which
  is a legitimate confluence result.
- **AC-022, a veto is not a boolean and not absorbed into the score.** Any fired
  veto forces `hold` and 0% risk. It is applied **before** the permission check
  on purpose: with `automationPermitted: true` and a fired veto, the action is
  still `hold`, because a veto a broker flag can re-enable is advisory.
- **AC-024, an absent flag is not permission.** `automationPermitted` is tested
  `=== true`, and the room's own default is `false`. A `false` flag degrades
  `autoExecute` to `notifyForApproval` and never raises the risk percentage.
- **D6, the rung is read-only.** It is carried through untouched, so the
  copilot cannot place itself on a higher rung; the room's default is `paper`.

**The honest-unavailability path is a full render, not a blank.** With no
reading, the room shows the deterministic provenance line, the three named
capabilities, and a reason naming `WS-7 T11` — and a test asserts that every
field the type declares `number | null` is null, that the nested tier is
absent, and that no contribution can smuggle a delta. The first version of that
test digit-scanned the JSON encoding and was wrong: the reason string
legitimately contains "T11" and "WS-7", so the check could only be satisfied by
a reason that named no task. The typed-field version is both stricter and immune
to the reason text.

**Separation from the remote copilot, and why it is load-bearing.** The existing
`CopilotPanel` renders remote LLM prose, and AC-014 forbids that prose from
becoming a signal, a score, a risk input, a sizing value, or an execution
authorization. The new surface renders a deterministic function's output. They
are separate components with separate provenance labels, are exported side by
side from `src/terminal/index.ts` with that reason in a comment, and
`copilotDecision.ts` contains no parameter that accepts a `CopilotExplanation`.
Merging them would be the exact AC-014 prohibited side effect.

**What was deliberately NOT built.** The engine. Building six experts, a regime
classifier, confluence, tiers and six vetoes inside T7 would be a different task
wearing this one's name, would make the room non-revertible independently (T7's
bisect line: "Markets alone can be reverted while Risk remains"), and would
steal T11's own acceptance criteria (AC-021/022/023/030) without discharging
them. The room renders the contract; the engine fills it in when it exists.

## Room completion record 2 of 2 — Risk

| Field | Value |
| --- | --- |
| Room | `risk` (D1 order 2 of 18) |
| Implementation | `apps/dashboard/src/terminal/routes/RiskRoom.tsx` |
| Surface | `apps/dashboard/src/terminal/components/RiskLayerSurface.tsx` |
| Domain | `apps/dashboard/src/terminal/domain/riskLayer.ts` |
| Mounted at | **NOT MOUNTED — see the route blocker below** |
| Tests | `apps/dashboard/src/terminal/routes/__tests__/RiskRoom.test.tsx`, 17 |
| **D27 verdict** | **`surface-complete, producer-pending, route-unmounted` — NOT genuinely complete** |
| Pending scope | **WS-7 T11** — the risk layer: 2% daily drawdown disable, 3-strike 24h key lock |
| WS-8 handoff | **None.** No scope in this room logically belongs to WS-8. |
| Why no WS-8 handoff | The unbuilt capabilities are owned by `WS-7 T11`, inside WS-7. The route blocker is a WS-6 §0.3 freeze, not a WS-7/WS-8 boundary question. |

**Gap 1 — producer pending.** Two of three capabilities are unbuilt, and the
room says so per row rather than per room. Each row carries its OWN
availability, because one shared "risk layer: live" banner above a real ATR
would let a reader conclude the drawdown disable and the key lock are also
active. `riskLayerView().complete` is `false` today and a test asserts it.

Three invariants are enforced in code:

- **The 1.5x stop distance is derived, never accepted.** `atrStopDistance`
  exists on the input for a producer's convenience and is ignored; a test feeds
  a producer that lies with `stopDistance: 99` and asserts the room does not
  display 99. The multiplier is applied in exactly one place.
- **No near-match substitution.** The `drawdownDisable` row's rendered text
  names `v32Copilot` and `u4faRisk` explicitly as the two numbers that exist
  and are NOT this capability, and a test slices that row out of the rendered
  HTML and asserts it carries no `data-risk-value`.
- **Unavailable is never zero.** A null ATR is `unavailable`, and its detail
  says so; a null strike counter is `unavailable`, and its detail says "0
  strikes would assert a counter that was never read". An ATR of 0 would mean a
  market with no range; a stop distance of 0 would mean a stop at the entry
  price, which is catastrophic rather than absent.

The two unbuilt capabilities have **working paths, not stubs**: fed a real daily
figure, `drawdownDisableReading` evaluates against the **daily** number (not the
session number, which is a different rail) and reports fired/armed without
rounding 1.999 into a fire; fed a real counter, `threeStrikeReading` reports
the lock or the count and rejects a non-integer or negative count. Wiring the
producers is therefore a data change, not a design change.

**Gap 2 — the room is not reachable at a URL, and that is flagged rather than
absorbed.** Landing it means adding a nineteenth ministry room key. The WS-6
spec §0.3 freezes the set at exactly eighteen, and three existing assertions
enforce that:

- `src/pages/__tests__/ministryRooms.test.tsx:165-177` pins the exact, ORDERED
  trading key list;
- `:193-196` pins the cross-suite total at exactly 18;
- `src/terminal/components/__tests__/TerminalShell.test.tsx:45-59` pins
  `INNER_NAV` against `MINISTRY_ROOMS` in **both** directions, so a route added
  without a nav entry fails exactly as hard as a nav entry added without a
  route.

Landing the room would mean moving two frozen characterisation assertions to a
nineteenth key. A frozen characterisation test is exactly what this workstream's
rules forbid weakening to make a change land, so the gap is recorded in
`RISK_COMPLETION.routeBlocker` with the assertions named, and asserted by a test.
Closing it needs a **WS-6 §0.3 spec amendment** — an owner decision, not an
implementation detail. This is the one place where the honest answer was "I could
have made it go green by editing two frozen tests, and I did not".

**The room is read-only.** No `button`, `input`, `form` or submit control
anywhere in its rendered output, asserted. A read-only surface that quietly
grows a control is a scope change nobody notices; T9's Paper/Live room owns the
rails.

## AC-041 — room order is respected

Room 1 (Markets) was implemented, tested and recorded before room 2 (Risk) was
started, and the order is carried in code as `d1Order: 1` and `d1Order: 2` and
asserted. Room 2 depends on nothing from room 1: the two rooms share
`contracts.ts` and `RoomFrame`, and a test renders `RiskRoom` with only its own
three observations, satisfying T7's bisect line ("Markets alone can be reverted
while Risk remains") as far as the room implementations are concerned.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run test --workspace @picc/dashboard` run 2 | **1 failed / 3999 passed / 1 skipped** — `ws7RouteAuthCoverageBehaviour.test.mjs:228` "POST /api/trading/alerts/delete does NOT delete when the user store is unreadable", `Test timed out in 5000ms` |
| same file re-run alone | 112 passed, 0 failed — confirms it was a load-induced timeout, not a defect |
| `npm run test --workspace @picc/dashboard` run 3 | **exit 0, 4000 passed / 1 skipped / 0 failed** |
| `npm audit --audit-level=high` | exit 0 (0 high, 0 critical, 3 moderate) |
| `git diff --check` | exit 0 |

`testTimeout` was **not** raised. The 5000 ms failure in run 2 is a server-side
auth test unrelated to any file this task touched, it passed on an isolated
re-run and on a full-suite re-run, and raising the global timeout to make it go
away would have hidden it.

Unit count: **4000 passed / 1 skipped / 0 failed** across 329 files, against a
3946 floor — 3946 + 11 (the lockfile override guard, entry 0020) + 26 (Markets
room) + 17 (Risk room) = 4000, accounted for exactly.

## e2e — every run reported, with the terminal-perf flake outcome

Five e2e runs were executed. **No existing e2e assertion, budget, sample count
or timeout was changed, and `testTimeout` was not raised.** `apps/dashboard/perf/terminal-perf-manifest.json`
is rewritten by every run and was restored with `git checkout --` before the
commit.

| # | Tree | Result | Failure |
| --- | --- | --- | --- |
| 1 | with the Markets mount | 5 passed, **1 failed** | `terminal-perf.spec.ts`: **`cold FCP 3024ms exceeded 3000ms at 6x throttle`** |
| 2 | with the Markets mount | **6 passed**, exit 0 | — (FCP@6x measured **796ms**) |
| A | **mount REMOVED** (A/B) | **1 failed** | `terminal-perf.spec.ts`: `Test timeout of 300000ms exceeded` / `page.waitForSelector` |
| B | **mount REMOVED** (A/B) | **1 failed** | `terminal-perf.spec.ts`: `Test timeout of 300000ms exceeded` / `page.waitForSelector` |
| 3 | with the Markets mount | 5 passed, **1 failed** | `terminal-perf.spec.ts`: `Test timeout of 300000ms exceeded` / `page.waitForSelector` |

**Did the change plausibly affect the flake? No, and the A/B is why that is a
measurement rather than an assertion.** The known flake
(`waitForSelector [data-room='markets']` under CPU throttle, previously measured
at 1-in-3 on an unchanged tree) fired in runs 3, A and B. **Two of those three
were on a tree with the Markets mount removed**, so the flake reproduces without
this task's change. The mount was then restored byte-for-byte and the file
re-read to confirm it.

**Did the change plausibly affect the run-1 FCP failure? Not demonstrably, and
the honest limit is stated.** The 3000 ms cold-FCP budget failed at 3024 ms in
run 1 and passed at **796 ms** in run 2 on the **identical tree** — a 3.8×
swing on the same code, which is the signature of machine load rather than of
one additional synchronous component. A no-mount FCP sample could not be
obtained, because **both** no-mount runs flaked before the harness reached its
`writeFileSync(MANIFEST, ...)` line, so the no-mount cold-FCP figure does not
exist. That is recorded rather than papered over: the attribution rests on the
run-1/run-2 spread on identical code, not on a clean A/B of that specific
budget.

**What the change does and does not do to the measured path, stated exactly.**
The perf harness measures `[data-room='markets']`, which
`pages/ministry/MarketsRoom.tsx:34` renders as the room's first child. The
placement was chosen to keep it there. The added surface:

- adds **no fetch**, so it adds no request to the transition window the harness
  records (it is composed with `confluence={null}` and opens no transport);
- adds one synchronous presentational component to the room's commit, whose
  first paint is the honest-unavailable state;
- leaves all six panels, `PackRegistryStrip`, the asset `Select`, and the
  `MARKETS_PANELS` instrumentation list at
  `e2e/terminal-perf.spec.ts:153-161` untouched.

The recorded room-transition budget remains the pre-existing BREACH
(p50 2437 ms / p95 4933 ms at 6× against a 250 ms budget), which the harness
deliberately records rather than asserts and which is out of scope for T7. The
per-rate figures in run 2 are byte-identical to the pre-change manifest
(FCP 160/304/796, transition p50 121/1230/2437, p95 232/1924/4933), which is the
strongest single piece of evidence that the mount did not move the measured
path at all.

## Net effect

Added:

- `apps/dashboard/src/terminal/domain/copilotDecision.ts`
- `apps/dashboard/src/terminal/domain/riskLayer.ts`
- `apps/dashboard/src/terminal/components/CopilotScoreSurface.tsx`
- `apps/dashboard/src/terminal/components/RiskLayerSurface.tsx`
- `apps/dashboard/src/terminal/routes/MarketsRoom.tsx`
- `apps/dashboard/src/terminal/routes/RiskRoom.tsx`
- `apps/dashboard/src/terminal/routes/__tests__/MarketsRoom.test.tsx`
- `apps/dashboard/src/terminal/routes/__tests__/RiskRoom.test.tsx`

Edited:

- `apps/dashboard/src/terminal/contracts.ts` — the spec §4.3 decision-path
  shapes and the risk-layer reading, in the file that is already "the single
  source of truth for the shapes the terminal UI is allowed to render". The
  `ws6TerminalSeamGuard` pins four specific lines in this file by regex
  (`:42,46,50,54`); all four are unmodified and its tests pass.
- `apps/dashboard/src/terminal/index.ts` — the new modules exported, with the
  remote/deterministic separation documented at the entry point.
- `apps/dashboard/src/pages/ministry/MarketsRoom.tsx` — the COP-22 surface
  composed in, +25 lines, no existing line removed or moved except the
  insertion point.

Unchanged, deliberately: `apps/dashboard/package.json` (`testTimeout` not
raised), every existing test and assertion, every frozen guard value,
`ws5SeamGuard`'s authorised set, `ws6TerminalSeamGuard`'s pins, the
`ministryRooms.test.tsx` room-key freeze, `TerminalShell.test.tsx`'s nav/room
parity guard, and `MinistryShell.tsx` / `MinistryRoom.tsx`.

Two rooms of eighteen are recorded. Sixteen remain, and none of them is
recorded as done.
