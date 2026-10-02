# 0034 - T20_CROSS_ROOM_INVARIANT_GATE v1 -> v2

Execution record for WS-7 task T20: the cross-room invariant gate, scoped per
room instance, hard for safety and best-effort for performance/UX.

rule: T20_CROSS_ROOM_INVARIANT_GATE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0034-T20_CROSS_ROOM_INVARIANT_GATE-v1-to-v2.md)
date: 2026-10-02
historicalTradesAffected: none
source: >-
  WS-7 task T20 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1372-1379`,
  acceptance criterion **AC-047** (`:1141-1147`), the per-room bar **AC-020**
  (`:925-931`), decision **D27** (`:365-372`) and requirement **R7.5** (`:421`),
  the amended freeze invariant at **`:73`** (22 instances / 15 keys, owner-ruled
  2026-09-30), the bisect matrix row **BS-4** (`:1399`), honesty note 9
  (`:1513`), the risk-control table row "Rooms stall at reserved" (`:1450`), and
  T19's gate discipline in entry `0033`
  (`docs/trading-logic/changelog/entries/0033-T19_PERFORMANCE_MEMORY_ARM_TIER-v1-to-v2.md`).
reason: >-
  AC-047 requires a gate that is HARD for safety across every room instance, and
  `:1379` requires that gate to be SCOPED: "It runs against rooms at any
  completion state; a reserved room fails its own invariants without blocking
  unrelated rooms." Neither property is obtainable from an assertion bolted onto
  an existing suite, so the decision function was built as a separate, spawnable
  module with the two properties made structural rather than conventional.

---

## 1. What was built, and why it is three files

| File | Role |
|---|---|
| `scripts/cross-room-invariant-gate.mjs` | The gate: the frozen inventory, the invariant table, `evaluateFacts`, `gateExitCode`, and the process entry point. |
| `apps/dashboard/src/terminal/domain/roomCompletionFacts.ts` | The ONE adapter from the 22 completion records to plain facts. Imports all six record homes. |
| `apps/dashboard/server/__tests__/crossRoomInvariantGate.test.mjs` | The guard. Observes the gate failing as a real process, on both branches. |

### Why the facts travel on stdin rather than as an import

The gate must be runnable as a process whose exit code a CI runner reads, which
is why it is plain `.mjs` - the same reason `ram-ceiling-gate.mjs` is. But the
records it judges live in six modules, **five of which are `.tsx`**. That was
tested, not assumed:

```
node --experimental-strip-types -e "import('./apps/dashboard/src/pages/ministry/reservedRooms.tsx')"
ERR_UNKNOWN_FILE_EXTENSION  Unknown file extension ".tsx"
```

So the records cannot reach a plain `node` process. `roomCompletionFacts.ts`
projects them on the vitest side, where TSX resolves, and the test pipes the
result in.

**The transport cannot smuggle a verdict.** The payload carries only the records'
own raw fields - room, d1Order, verdict, the *shape* of `ws8Handoff`, absences,
reason, affordances, ceiling - and every conclusion is computed inside the gate
from a numeric measurement. An adversary controlling the stdin payload still has
nowhere to put a verdict, only facts, and the facts get measured.

### This is not a second contract home

Two lists of twenty-two exist and their INDEPENDENCE is the point:

- `ROOM_INVENTORY` in the gate is the frozen spec inventory (`:73`).
- The adapter's output is **derived** from the records - it maps the sixteen rows
  of `READ_ONLY_ROOM_COMPLETIONS` plus the six named constants and reads each
  one's own `room` field. Nothing there is hand-typed.

Because neither list is computed from the other, a record that stops being
exported shows up as a MISMATCH, which the gate reports as a named per-room
failure. A second copy that agreed by construction could not detect that at all.

## 2. Blocking vs best-effort is structural, not a convention

AC-047 `:1377` - "Safety/correctness blocks; performance/UX is recorded as
best-effort." Three mechanisms enforce it, so it cannot erode when someone adds
a check and forgets a rule:

1. Every invariant carries a `kind` from a closed vocabulary (`CHECK_KINDS`).
2. `gateExitCode` counts **only** `BLOCKING_KINDS`.
3. A row's `verdictWord` is a fold over blocking checks **only** - the expression
   never reads a best-effort check - and `bestEffortFindings` is a separate
   projection that is reported whatever the verdict is.

AC-047 `:1145`'s prohibited side effect is therefore enforced by omission in both
directions: a performance result cannot waive a safety invariant because no code
path lets a best-effort check reach `verdictWord`, and a safety pass cannot be
derived from a performance number because no code path lets a blocking check be
satisfied by one.

### The fifteen invariants - twelve blocking, three best-effort

| id | kind | budget |
|---|---|---|
| `safety.record-present` | safety | 0 |
| `safety.ws8-handoff-key-present` | safety | 0 |
| `safety.affordance-ceiling-is-zero` | safety | 0 |
| `safety.no-task-owned-absence-on-a-complete-room` | safety | 0 |
| `safety.affordance-declares-a-route-and-a-token` | safety | 0 |
| `correctness.verdict-declared` | correctness | 0 |
| `correctness.d1-order-matches-inventory-position` | correctness | 0 |
| `correctness.d1-order-claimed-by-one-room` | correctness | 0 |
| `correctness.complete-requires-evidence` | correctness | 0 |
| `correctness.incomplete-requires-an-open-handoff` | correctness | 0 |
| `correctness.absences-well-formed` | correctness | 0 |
| `correctness.pre-existing-affordances-not-removed-by-a-gate` | correctness | 0 |
| `perf.distinct-producer-routes` | performance | at-least 1 |
| `ux.declared-affordance-surface` | ux | 8 |
| `ux.named-absence-load` | ux | 6 |

**On the performance bucket, stated plainly rather than dressed up.** This gate
runs over completion records and has no render telemetry. Claiming a millisecond
would be a fabricated number, so the best-effort observations are labelled for
what they are: measurements over the record, not over a frame. `perf.*` measures
how many distinct producer routes a record names - which is the count T10's
`PRODUCER_SET_THIN` note describes in prose - and `ux.*` measures the two
surface facts a reader would otherwise have to infer from a table.

## 3. No invariant reports "ok" without having checked a quantity

This inherits T19's discipline (`PASS_LIKE === ["pass"]`, and `verdictForRow`
has no path returning `pass` without comparing a measured number to a numeric
budget). The gate enforces it four ways:

1. **Every `measure` returns a NUMBER**, never a boolean, string or null. `ok` is
   computed in exactly one place: `measured <= budget` (or `>=` for the one
   declared at-least invariant).
2. **A measurement that cannot be produced is a FAILURE, not a pass.** A
   `measure` that throws, or returns a non-finite/non-numeric value, is recorded
   with `ok: false` and a note. Both branches are asserted directly.
3. **`ok` is re-derived independently in the test** from each check's own
   `measured` and `budget`, so a hand-set `pass` cannot survive.
4. **The mutation sweep.** For every blocking invariant, a fact that genuinely
   violates it is planted, and the sweep asserts three things: the check flips,
   its `measured` becomes **greater than zero** (not merely a flipped boolean),
   and exactly that room fails. The sweep's key set is asserted equal to
   `BLOCKING_INVARIANT_IDS`, so a new blocking invariant cannot be added without
   a violating case.

## 4. Scoping: one room's failure cannot smear

`:1379` is the hard part of this task. The evidence, all three parts the brief
asks for:

- **(a) the broken room is reported failing, named.** Ceremony's
  `ws8Handoff` key is deleted; the report's `failingRooms` is exactly
  `["trading/ceremony"]`.
- **(b) every other room reports its own true state.** Every other row is
  asserted **deep-equal** to its baseline row - not merely "still passing". A
  change to any count, budget or verdict elsewhere would be caught.
- **(c) attributable by name.** The one genuinely cross-room invariant
  (`d1-order-claimed-by-one-room`) is reported against the two rooms that
  collide and no others.

There is also a **22-room sweep**: each room in turn is broken the same way, and
each is asserted to fail exactly itself. Scoping is therefore not demonstrated
for one lucky room but for all of them.

Structurally, `evaluateRoom(fact, ctx)` takes **one** room's facts and has no
access to any other room's data except two explicitly-passed cross-room
measures. A gate that returns one boolean for the whole set could not scope at
all; this one returns a row per room.

## 5. Honest incompleteness is not a gate failure

Two verdicts are honestly `incomplete` and **both pass the gate**:

| room | verdict | why it is incomplete | gate |
|---|---|---|---|
| `trading/strategy` | `incomplete` | a reserved placeholder; AC-020:929 forbids `complete` | pass |
| `trading/simulator` | `incomplete` | its Financial Twin is write-only (`POST /api/twin/run`; no GET twin, no run store) | pass |

The mechanism that makes this legal is `correctness.incomplete-requires-an-open-handoff`,
and it cuts both ways. An `incomplete` verdict is never a failure by itself.
What it forbids is `verdict: "incomplete"` carrying `ws8Handoff: null`, because
writing `null` there claims the WS-8 question was asked and answered when it was
not - which is precisely the "silently trimmed" defect D27 prohibits. The test
plants exactly that and asserts only the tampered room fails.

## 6. Two predicate corrections - recorded, not silent

Both were found by the gate reporting **real rooms as failing**, and both were
my predicates being under-specified rather than the records being defective.
Both corrections are recorded here because a predicate quietly widened to reach
green is the anti-goal this whole task exists to prevent.

### 6.1 What counts as "naming a producer"

The brief: a gate "must fail ... if a verdict asserts `complete` without a
producer". The first cut recognised two forms - a source path and a commit SHA -
and the gate immediately reported **five of the real twenty-two** as failing:
`trading/paper`, `earnings/studio`, `earnings/settings`, `intelligence/dashboard`,
`intelligence/guidance`.

Those five are not defective records. They name their producers as **HTTP
routes** (`GET /api/health`, `GET /api/browser/status`) and `trading/paper`
additionally by **changelog entry** (`T16 entry 0024 handoff #4`). Producers in
this tree are named four concrete ways and all four are now honoured -
`PRODUCER_REFERENCE_FORMS`: source-path, commit-sha, http-route,
changelog-entry.

The bite is retained and proven: the measured quantity is the **number of forms
matched**, each form is pinned with a positive AND a negative sample, and a
reason naming nothing in any form measures 0 and fails. A 700-character reason
with no producer reference fails on the second component alone.

### 6.2 What counts as a trivially-fillable reserved block

AC-020:929 prohibits declaring a room COMPLETE "with a reserved block a later
task was expected to fill". The first cut was a prefix match on `/^WS-7 T\d/`
and the gate reported `trading/paper`. Its absence owner is:

> `WS-7 T3 / WS-3 ceremony action - a deliberate ceremony action is a product decision`

That opens with a task reference and then **terminates in an owner decision** -
the opposite of trivially fillable. The whole-owner anchor
(`/^(?:WS-\d+\s+T\d+)(?:\s*\/\s*WS-\d+\s+T\d+)*$/`, plus a small placeholder-word
list) keeps the room honest and still catches the bare form. Both halves are
asserted: `trading/paper`'s compound owner measures 0, and a planted bare
`WS-7 T12` measures 1 and fails.

## 7. The 18-vs-22 contradiction - RECORDED, NOT PAPERED OVER

The gate runs on **22**. Seven places in the spec still say 18:

| location | text |
|---|---|
| `:1142` | AC-047 scenario, "all 18 room instances" |
| `:365` | D27 heading, "All 18 rooms stay in scope" |
| `:366` | D27 context, "D1 commits all 18 room instances" |
| `:368` | D27 decision, "All 18 rooms remain in WS-7 scope" |
| `:421` | R7.5, "All 18 rooms stay in scope" |
| `:929` | AC-020 prohibited side effect, "All 18 rooms stay in WS-7 scope" |
| `:1373` | T20 scope, "The hard gate across all 18 room instances" |

The inventory at `:73` was **amended to 22 instances / 15 keys, owner-ruled
2026-09-30**. This is the same class of stale text T19 found for B2 (entry
`0033`).

**The spec prose was deliberately NOT edited.** Gating on 18 would drop
Ceremony, Ministry, Strategy and Risk - four instances - out of a safety gate,
and the amendment is the later owner ruling. But silently rewriting seven places
would make the contradiction vanish without a record, which is the same defect in
the opposite direction. So it is recorded in `STALE_INSTANCE_COUNT_IN_SPEC`, in
this entry, and **printed by the gate on every run**; a test asserts the stale
text is still present in the spec AND that the gate runs on 22.

## 8. The pre-existing write affordances - surfaced, never failed on

T10's brief said **seven** instances carry pre-existing write affordances. Tallying
the records gives **twelve instances carrying twenty-five affordances**. Recorded
here rather than reconciled silently; a test asserts the count from the data so
entry `0032`'s "seven" cannot be read as current.

All twenty-five appear in the report's `ownerDecisions`, each with `blocking:
false` and the disposition `OWNER DECISION - a pre-existing write affordance,
deliberately not removed`. The headline is unchanged from T10 and is now
enumerable by the gate rather than only in prose:

| instance | affordance | route |
|---|---|---|
| `trading/command-centre` | Perps order execution | `/api/command-centre/perps/execute` |
| `trading/command-centre` | Perps position close | `/api/command-centre/perps/close` |

`PerpsCommandCentre` POSTs order execution and position close inside a room D1
calls read-only. That is an owner decision, deliberately not removed, and the
gate surfaces it. `trading/command-centre` **passes**.

Two ceilings are enforced as safety, both frozen empty data:
`PAPER_LIVE_INTERACTIVE_AFFORDANCES` (`paperLive.ts:556`) for `trading/paper` and
`READ_ONLY_INTERACTIVE_AFFORDANCES` (`readOnlyRooms.ts:230`) for the sixteen. A
room gaining a declared interactive affordance fails; so does a ceiling that is
empty but **not frozen**.

## 9. Risk 9 - no second contract home for `ConfluenceScore`

T11–T16 added a large server surface under `services/copilot/` while the client
owns `contracts.ts`, pinned by regex at `ws6TerminalSeamGuard.test.mjs:42,46,50,54`.
Two definitions of `ConfluenceScore` will drift.

The gate asserts the server and client agree on the shapes rooms actually consume
**without creating a fixture**:

- The **eight-field key set** `contracts.ts:195-204` declares is extracted from
  the source and compared with `Object.keys()` of what the real narrowing
  (`projectDecision`, `copilotReading.ts:145`) actually produces. A contract that
  grows or loses a field is caught, not absorbed.
- The **`Regimes` union** (`contracts.ts:188`) equals the narrowing's fallback
  list (`copilotReading.ts:198`), five members.
- The **`confidence` union** (`contracts.ts:198`) equals the list at
  `copilotReading.ts:197`.
- **The four pinned regexes** at `ws6TerminalSeamGuard.test.mjs:42,46,50,54` are
  re-asserted here against the same `contracts.ts`, so if this gate ever made its
  own copy, those pins would keep matching a file nothing renders.
- **The tier boundary has exactly one declaration site.** A tree walk from the
  repo root finds every `export const TIER_BOUNDARIES|APLUS_MIN_SCORE|B_MIN_SCORE`
  and asserts the list is exactly
  `apps/dashboard/server/services/copilot/tierBoundaryFixture.mjs`. T11's
  fixture remains the single authority; this gate adds none. Test files are
  excluded from the walk because a test may ASSERT the constants by name -
  including this one - but a test cannot DECLARE an authority.

## 10. T13's `isAdmissibleAsSignal` handoff - ALREADY DISCHARGED

The brief recorded this as outstanding: "`contracts.ts:130` references
`isAdmissibleAsSignal`, which **exists nowhere** - the server equivalent is
`assertNotDeterministicInput` and the client function is still owed."

**It exists.** `copilot.ts:84-86`, re-exported at `index.ts:81`:

```ts
export function isAdmissibleAsSignal(_c: CopilotExplanation): false {
  return false
}
```

and `contracts.ts:130` mentions it only in a prose comment, which now resolves.
The handoff was discharged before T20; the brief's "exists nowhere" is stale.

The gate therefore does not implement it - implementing it would have created a
second definition. It makes it **enforceable so it cannot regress**: the function
exists, is re-exported from the public entry point, and returns the literal
`false` for every explanation (AC-014's separation, executable). The server's
`assertNotDeterministicInput` (`routing.mjs:170`) is confirmed present as the
write-side twin.

## 11. Why CI config was NOT touched

T20's file list names "CI config". `.github/workflows/**` is **outside** the
file-touch union at `:73`, and T13 already took that deviation for its D15 job
and recorded it as an open item in entry `0025` (see the comment at
`ci.yml:76-85`). Taking a second deviation for the same reason compounds an
existing deviation rather than resolving it, and T21 - the final seam-guard task
- is the natural place to consolidate.

More decisively, **a standalone CI job could not run this gate.** With no facts
on stdin the gate fails closed by design, and producing facts needs the TSX-side
adapter. The gate is instead already a hard CI gate through the `test` job:
`npm test` runs vitest, `crossRoomInvariantGate.test.mjs` fails the build when any
room breaks, and the guard spawns the gate as a real process on both branches. A
CI job would add a visible line, not a stronger gate.

## 12. Evidence the gate fails when it should

AC-047 `:1146` and the brief's requirement that "a gate never seen to fail is an
unverified gate" are answered by observation, not assertion:

| branch | mechanism | observed |
|---|---|---|
| `--fail-branch` | a real safety break planted in `trading/ceremony` | **exit 1**, `failing rooms: ["trading/ceremony"]` |
| `--missing-record-branch` | `trading/ministry`'s record removed from the set | **exit 1**, named |
| real room broken, spawned | `trading/ministry`'s verdict corrupted | **exit 1** |
| no facts supplied | fail closed | **exit 1** |
| unparseable payload | fail closed | **exit 1** |
| `--best-effort-branch` | 12 affordances on `trading/studio` | **exit 0**, findings recorded |
| real UX observation, spawned | 12 affordances on `trading/studio` | **exit 0** |
| the real twenty-two | as they are | **exit 0**, 22 rows enumerated |

The gate prints `NOT a measurement` on its failing branch, mirroring T19's
`ram-ceiling-gate.mjs --fail-branch`, so a non-zero exit is never mistaken for a
measurement of a room.

## 13. Verification

- `npm run typecheck` - clean.
- `npm run test --workspace @picc/dashboard` - **5021 passed / 1 skipped / 0
  failed** across 372 files. The 4951 floor plus exactly the 70 new tests.
- `git diff --check` - clean. Nothing written under `apps/dashboard/server/data/`,
  no `.playwright-tmp/`, no lockfile touched, no junction or symlink created.
- The gate's guard pins were re-checked, not assumed: `handlers.mjs` is not
  touched by this task, so **statics 72 / dynamics 83** cannot have moved.
- No e2e run, no push - T21 owns the single batch push (AC-048).

## 14. Open items for T21

1. **The 18-vs-22 prose.** Seven spec locations, listed in §7. Left as the owner
   wrote them on purpose. T21 touches this spec and is the right place to decide
   whether to reword or to footnote the amendment.
2. **Entry `0032`'s "seven" affordance instances** against the twelve the records
   carry (§8). Same shape of problem; T21 reconciles it if the changelog prose is
   treated as normative.
3. **The `.github/workflows/**` whitelist deviation**, already open from T13's
   entry `0025`. T20 deliberately did not add to it.
4. **`contracts.ts:130`'s comment** now resolves to a real function. Worth a
   one-line touch-up to cite `copilot.ts:84` rather than leaving the reference
   free-floating; deliberately not done here, since T21 is the contract owner.