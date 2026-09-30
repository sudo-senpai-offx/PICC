# 0022 - T11_DETERMINISTIC_COPILOT_ENGINE v1 -> v2

Execution record for WS-7 task T11: the deterministic rule engine — the
five-class regime classifier, the six weighted experts, the confluence, the
execution tiers, the six vetoes, the four boosters plus Unicorn, and the risk
layer. **No model on this path.**

rule: T11_DETERMINISTIC_COPILOT_ENGINE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0022-T11_DETERMINISTIC_COPILOT_ENGINE-v1-to-v2.md)
date: 2026-09-30
historicalTradesAffected: none
source: >-
  WS-7 task T11 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1291-1298`,
  the module layout at §4.2 (`:535-588`), the rule engine at §4.4 (`:676-701`),
  the core data shapes at §4.3 (`:590-672`), the freeze invariants at §0.3
  (`:73`), acceptance criteria AC-021 (`:933`), AC-022 (`:941`), AC-023
  (`:949`) and AC-030 (`:1005`), the B5/B6 budget rows at §4.6 (`:726-727`),
  the dead-zone rendering rule at §4.7 (`:747`), the bisect matrix row BS-2
  (`:1397`), and plan v1 §3.1 (`:180-226`) with its Risk 6 (`:597`).

reason: >-
  T7 shipped the Copilot's CONSUMER half and named its producer as pending. The
  terminal could render a confluence score, six per-expert contributions and
  fired vetoes — but nothing computed them. `contracts.ts:137` says so in the
  tree's own words: "`ConfluenceScore` is WS-7 T11 and is not built yet; until
  it is, these types are the contract the Markets room renders and the room
  reports the engine's absence honestly rather than synthesizing a score."
  That is the correct behaviour for a missing producer, and it means the whole
  decision path was absent while the rooms around it rendered its shape.

  T11 is also the bisect prerequisite. BS-2 (`:1397`) puts T11–T13 and T15–T16
  ahead of every room, and T11's own bisect line (`:1298`) requires the engine
  to be "pure and testable with no model, no network, and no React. It can ship
  dark and be enabled per room."

## The T7 back-references this entry discharges (plan v1 §3.1 item 10)

Two T7 completion records name T11 as their owner. Both are named here with
their file and line, which is what makes the T7 reconciliation traceable rather
than a claim.

| T7 record | Line | What it recorded | Discharged by |
|---|---|---|---|
| `src/terminal/routes/MarketsRoom.tsx` | `:103` | `pendingScope: "WS-7 T11 - the deterministic Copilot engine (six experts, confluence, tiers, six vetoes)"` | `confluence.mjs`, `tiers.mjs`, `vetoes/`, `regime.mjs`, `experts/` |
| `src/terminal/routes/RiskRoom.tsx` | `:100` | `pendingScope: "WS-7 T11 - the risk layer (2% daily drawdown disable, 3-strike 24h key lock)"` | `riskLayer.mjs` |
| `src/terminal/domain/riskLayer.ts` | `:53` | `RISK_LAYER_OWNER = "WS-7 T11"` | `riskLayer.mjs` — the producer now exists |
| `src/terminal/domain/copilotDecision.ts` | `:79` | `COPILOT_ENGINE_OWNER = "WS-7 T11"` | `engine.mjs` — the callable whole now exists |

**Neither T7 record is edited.** BS-2's "must not touch" column is room visuals
(`:1397`), so the render side still describes the producer as pending and will
keep doing so until BS-3 wires these observations into the rooms. That is named
below as a BS-3 handoff rather than silently trimmed.

## The four acceptance criteria, and how each is met

### AC-021 — deterministic (`:933-939`)

One state, evaluated 100 times, byte-identical via `JSON.stringify` — not
`toEqual`, which treats `-0` and `0` as equal and would hide a property-order
change. Plus a 25 ms real pause between runs, which the 100-run loop cannot
catch because it usually completes inside one millisecond.

The path reads no clock: `computedAt` is a required, supplied, finite epoch-ms
argument and `deriveMarketState` throws without one. There is no `Date.now`, no
`Math.random`, no `fetch`, no `WebSocket`, no `ccxt` in any engine file, and a
test asserts that by reading the sources.

### AC-022 — vetoes are inspectable outcomes (`:941-947`)

Six rule modules, each emitting a full `VetoOutcome` (`ruleId`, `fired`,
`inputs`, `suppressed`, `evaluatedAt`, `ruleVersion` — contracts.ts:176-184).
Read/write assertions go through the **`vetoIndex.mjs` store**, not through a
returned object, because plan §3.1 item 6 is explicit that D7's point is that
the record survives the call. The store exposes **no** `update`, `delete`,
`remove`, `clear`, `set`, `purge`, `retract`, `amend` or `expire`, and the test
asserts each is absent **by name**.

### AC-023 — tier boundaries are exact (`:949-955`)

`>= 85` → A+ / 1%; `>= 70` → B / 0.5%; below → ignore / 0%. `null` → ignore /
hold / 0%, never a score of 0. No rounding anywhere on the score path, so
84.999999 is B and cannot reach A+.

### AC-030 — weights sum to 100 and degrade honestly (`:1005-1011`)

The weight sum is asserted at **exactly** 100, both as a load-time throw and as
a test. T11 has **no model**, so the Sentiment expert is structurally
unavailable by default: five experts at 95% coverage, confidence `medium`, and
the score carries the 5-point hole rather than the survivors being rescaled to
fill it.

## The spec contradicts itself on the A+ boundary, and which side won

Three places say A+ starts at **85 or above**; two say **above** 85:

| Location | Text |
|---|---|
| AC-023 `:952` (binding) | "85+ → A+ (1% risk)" |
| AC-023 `:950` (scenario) | includes `85` among the scores to map |
| §4.2 `:550` (comment) | `tiers.mjs # >85 A+` |
| §4.4 `:689` (prose) | "`>85 = A+` (risk 1%)" |

They differ at exactly one input, a score of exactly 85. **AC-023 won**, because
it is the acceptance criterion and because its scenario explicitly lists 85 as a
case to map with an expected A+. `>= 85` is implemented. §4.2:550 and §4.4:689
are prose and are left unmodified — this entry records the divergence rather
than quietly editing the spec.

## Judgement calls, stated rather than buried

1. **Band → 0-100 sub-score is an affine map of each expert's own declared
   band.** §4.4:686 gives each expert a band in delta space (Macro Bias
   "+10 / −10 each") and §4.3:608 types `rawDelta` as "within the expert's own
   band", but no spec text relates a band's delta space to the 0-100 confluence.
   `bandToScore` is the single place they meet. Note the consequence: because
   two bands are asymmetric (Structural is [−15, +20], Momentum is [−10, +15]),
   a zero raw delta does **not** map to 50. "No structural edge" scoring below
   the midpoint is honest, not a bug.

2. **The score divides by 100, never by coverage.** That is the mechanical
   meaning of AC-030's "weights may not be renormalized". A missing expert
   leaves a hole of exactly its own weight. The test asserts each surviving
   expert's weighted points are **identical** with and without sentiment
   present, and includes the control: a coverage-dividing engine produces a
   strictly larger total.

3. **Confidence cut-points are not in the spec.** §4.3:616 names the vocabulary
   (`high`/`medium`/`low`/`unavailable`) and AC-030 requires the confidence to
   reflect the gap, but no figure is given. 100 → high, ≥80 → medium, else
   low, declared as `CONFIDENCE_THRESHOLDS` so the choice is auditable and
   table-tested. Sentiment missing reads `medium`, not `high`.

4. **A veto that cannot be evaluated FIRES.** The repo's precedent is
   `v32Copilot.mjs:5` — "Every wire FAILS CLOSED: an unavailable input blocks
   the entry with an honest reason and never passes". Reporting `fired: false`
   for a rule whose inputs were absent would place a "checked and clear" in
   front of a caller when nothing was checked. The record carries
   `inputs.unevaluated` and the missing input names, so the caller sees exactly
   what to go and supply. `sessionOpen` is exempt because its only input is the
   mandatory `computedAt` — forcing it to fail closed would invent an absence.

5. **`null` vs `[]` is preserved for `newsEvents` and `proposals`.** A supplied
   empty list means "a live source found nothing"; an absent one means "no
   source was supplied". Collapsing them was a real defect found during T11 — it
   made the news veto report "no Red Folder events in the window" about a source
   nobody gave it.

6. **Unicorn is a named boolean, not a fifth delta.** §4.2:547 and §4.4:693 name
   it; §4.4:686 states no value for it and the band closes at the four boosters'
   +45. Inventing one would widen a closed band and let the expert exceed the
   100-point ceiling alone. T12 owns the hypertrend conflict resolution and is
   where a Unicorn scoring question belongs.

7. **`deadZone` yields `score: null`, not 0.** §4.7:747 requires a dead zone to
   render as "no trading" rather than as a low score. `null` is the spec's named
   unscoreable value and routes to ignore/hold/0%.

8. **The regime mapping is judgement, and is declared as data.** `REGIME_RULES`
   reads the repo's existing `SESSIONS` and `SESSION_BOUNDS_UTC` rather than
   restating hours — a third copy of the session table is what
   `tradingSessionPolicy.mjs:7-8` exists to prevent. The dead-zone rule
   (20:00–00:00 **inclusive of the 00:00 instant**) is reproduced from
   `tradingSessionPolicy.mjs:54`, not re-derived.

9. **Two files exist that §4.2 does not name**, both inside the §4.2-named
   directory: `marketState.mjs` (derives the shared indicator series once
   instead of six times) and `engine.mjs` (AC-021:935's action is "Run the
   confluence engine", so a callable whole must exist). §4.2:537 says the layout
   is proposed and no path is claimed to exist, and `:1294` names the directory
   itself.

## BS-3 handoffs named, not silently trimmed (D27)

| # | Handoff | Why it could not land in T11 |
|---|---|---|
| 1 | Wire `engine.mjs` into `MarketsRoom.tsx`'s `pendingScope` (`:103`) | Room visuals are BS-2's "must not touch" (`:1397`) |
| 2 | Wire `riskLayer.mjs` into `riskLayer.ts`'s two honest absences (`:152-185`, `:207-215`) | Same. The render side still reports both capabilities unavailable because no caller supplies observations yet |
| 3 | Add a **client-side** test that imports `tierBoundaryFixture.mjs` | Requires editing `src/terminal/`. Equality is instead proven server-side by reading the client's literals — see below |
| 4 | Update `riskLayer.ts`'s copy at `:23-27` to name T11 as delivered | Same |

## Risk 6 — the tier-boundary drift guard, and what it does NOT do

Two copies of a safety boundary drift, so both are pinned to one fixture:
`copilot/tierBoundaryFixture.mjs`. The server table is authoritative
(`tiers.mjs`); the client's `bandOf` at `copilotDecision.ts:122-127` is a
rendering projection.

`tierBoundaryParity.test.mjs` proves equality by **reading** the client source
and asserting its literals equal the fixture's — the six weight rows
element-wise, the two `>=` boundaries, the risk percentages, and the `null`
guard. `src/terminal/` gains **no bytes** from T11.

Its control matters: a drift that MOVES one point from Macro Bias to Sentiment
keeps the sum at 100, so a "both sides sum to 100" check sees nothing. Only
element-wise equality catches it, and that control is asserted.

**This is the part of Risk 6 that is deliberately NOT discharged.** Plan §3.1
item 4 wants a shared-fixture test both sides read; the client-side half needs a
file in `src/terminal/`, which BS-2 forbids. Recorded as BS-3 handoff #3.

## B5 and B6 — first measurement, previously UNMEASURED

Spec §4.6:726-727 left both rows UNMEASURED and named T11 as their producer.
`scripts/copilot-engine-probe.mjs` measures the pure engine over four pinned
deterministic fixtures, 10 warm-up iterations discarded, 200 measured, and
writes `perf/copilot-engine-bench.json` — **not** `terminal-perf-manifest.json`,
because that file "does not survive a failing run" (plan §6 Risk 1) and coupling
this evidence to the unrelated browser flake would destroy it.

| Row | Budget | p50 | p95 | max | Verdict |
|---|---:|---:|---:|---:|---|
| B5 confluence | ≤ 100 ms p95 | 0.040 ms | 0.124 ms | 0.516 ms | `pass` |
| B6 vetoes (all six) | ≤ 25 ms p95 | 0.035 ms | 0.081 ms | 1.088 ms | `pass` |

Both are raw samples in the artifact, with host facts, so a reader can tell what
machine produced them. `perfArtifact.test.mjs` does **not** assert `pass` —
timings rot — it asserts the recorded verdict is **derivable from the recorded
samples**, recomputed by an independent nearest-rank. A fabricated pass fails.

## Net effect

Added:

- `apps/dashboard/server/services/copilot/regime.mjs`
- `apps/dashboard/server/services/copilot/marketState.mjs`
- `apps/dashboard/server/services/copilot/confluence.mjs`
- `apps/dashboard/server/services/copilot/tiers.mjs`
- `apps/dashboard/server/services/copilot/tierBoundaryFixture.mjs`
- `apps/dashboard/server/services/copilot/engine.mjs`
- `apps/dashboard/server/services/copilot/riskLayer.mjs`
- `apps/dashboard/server/services/copilot/vetoIndex.mjs`
- `apps/dashboard/server/services/copilot/experts/{macroBias,structural,trendStrength,momentumExhaustion,volatilityBoosters,sentiment}.mjs`
- `apps/dashboard/server/services/copilot/vetoes/{outcome,topDownHierarchy,correlationTrap,wickVsClose,spreadVsTarget,newsLockout,sessionOpen}.mjs`
- `apps/dashboard/server/services/copilot/__tests__/` — 9 co-located pure test
  files plus `fixtures/marketFixtures.mjs`
- `scripts/copilot-engine-probe.mjs`
- `apps/dashboard/perf/copilot-engine-bench.json`

Edited: nothing. Every file this record lists is new.

Deliberately NOT built, because they belong to other tasks:

- `copilot/conflicts/{c1,c2,c3}` — **T12** (`:1300-1307`). `conflictOverrides`
  is emitted as an empty array, which is the honest statement that no conflict
  resolution has been applied.
- `copilot/routing.mjs` — **T13** (`:1312`), the D16 cloud-routing predicate.
- `copilot/explain.mjs` — **T13** (`:1312`), the plain-English layer.
- `copilot/retention.mjs` — **T15** (`:1330`). T11's half is the veto record's
  retention tag and its injected sink; T15 owns the classes, the persistence
  layer and the purge job.
- `copilot/authority/` — **T16** (`:1336-1343`).
- The sentiment model input — **T13**. `experts/sentiment.mjs` exists as the
  seam and is structurally unavailable in T11, which is what makes spec :1316's
  bisect line ("with it removed, the deterministic engine still scores, with
  Sentiment unavailable and an honest confidence penalty") true by
  construction rather than by assertion.

Unchanged, deliberately: `src/terminal/**` (BS-2 must not touch room visuals),
the room routes, `contracts.ts` and its four `ws6TerminalSeamGuard` regex pins,
`ccxtOrdering.mjs`, `executionAbsence.test.mjs`'s frozen assertion logic, the
18-room key inventory, `perpsSeamGuard.test.mjs`'s amputation intent, both
lockfiles' contents, and every existing test and guard value.

The engine ships dark: `isEngineEnabledForRoom` returns `false` for every room
until a room is explicitly named.
