# 0023 - T12_CONFLICT_RESOLUTIONS_C1_C2_C3 v1 -> v2

Execution record for WS-7 task T12: the three conflict resolutions — C1
(ADX lag vs scoring), C2 (wick-vs-close vs the ATR hard stop), and C3
(hypertrend vs macro bias) — and the explicit precedence between them.

rule: T12_CONFLICT_RESOLUTIONS_C1_C2_C3
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0023-T12_CONFLICT_RESOLUTIONS_C1_C2_C3-v1-to-v2.md)
date: 2026-09-30
historicalTradesAffected: none
source: >-
  WS-7 task T12 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1300-1307`,
  the rule engine at §4.4 (`:676-701`, with C1 at `:699`, C2 at `:700`, C3 at
  `:701`), the core data shapes at §4.3 (`:590-672`, with `conflictOverrides` at
  `:619`), requirements R9.1–R9.3 (`:430-432`), acceptance criteria AC-027
  (`:981`), AC-028 (`:989`) and AC-029 (`:997`), the risk table at §7
  (`:1431-1433`), the freeze invariants at §0.3 (`:73`), the bisect matrix row
  BS-2 (`:1397`), T12's own bisect line (`:1307`), and plan v1 §3.2 (`:228-248`)
  with its Risk 6.

reason: >-
  T11 shipped the deterministic engine and emitted `conflictOverrides` as an
  always-empty array, which `confluence.mjs:304-307` states honestly: "no
  conflict resolution has been applied". §4.4:697 says the three resolutions "are
  testable requirements, not prose", and T12 is the task that makes them so.

  T12 is also the first BS-2 task to touch the score. C1 maxes a trend
  sub-score and C3 reallocates a weight, so both reach the arithmetic T11
  wrote. This record is therefore mostly about how that was done WITHOUT
  moving T11's arithmetic, and about a live defect found on the way.

## The three rules, as implemented

| | Rule id | Version | Trigger | Effect on the score | Expiry |
|---|---|---|---|---|---|
| **C1** | `copilot.conflict.c1AdxLagging` | `copilot-conflict-c1AdxLagging/1.0.0` | Booster1 **and** Booster2 both fire | `trendStrength` rawDelta forced to the band maximum (`BAND.max` = +20) | **5 candles**, anchored on the trigger candle. Derived from two indices on every call; no stored flag |
| **C2** | `copilot.conflict.c2TwoTierStop` | `copilot-conflict-c2TwoTierStop/1.0.0` | a wick beyond 1.5× ATR | **none** — it governs an exit, not an entry | n/a. Two tiers: `softAlert` (waits for the close) and `hardStop` (close beyond 1.5× ATR, or close beyond the 50 EMA) |
| **C3** | `copilot.conflict.c3HypertrendMacro` | `copilot-conflict-c3HypertrendMacro/1.0.0` | `regime == hypertrend` | `macroBias` weight 20% → **0%** | the regime's own duration; closes when the classifier stops saying `hypertrend` |

Precedence: `copilot-conflict-precedence/1.0.0`.

## A DEFECT T12 FOUND: `activeBoosters` was always `[]`

`experts/volatilityBoosters.mjs` had two vocabularies that did not match.
`BOOSTER_IDS` and `BOOSTER_DELTAS` are keyed by the spec's descriptive names
(`booster1EmaCross`); the `legs` object the module returns is keyed by short
ordinals (`booster1`). `activeBoostersOf` indexed `legs` with `BOOSTER_IDS`, so
`result.legs["booster1EmaCross"]` was always `undefined`, every
`?.fired === true` was false, and **`activeBoosters` returned `[]` for every
input**. The only entry it could ever emit was `unicorn`.

`ConfluenceScore.activeBoosters` (§4.3:618) could therefore never name a
booster, and C1 — whose condition is specified in exactly those terms (§4.4:699)
— was **unimplementable** until this was fixed.

The fix added `BOOSTER_LEG_KEYS` as frozen DATA and routed `activeBoostersOf`
through it. It is a bug fix, not a guard change: no existing assertion was
weakened, removed or relaxed, and no test result moved except to become true.
Five tests in `c1AdxLagging.test.mjs` now pin the correspondence in both
directions, including a control that fails if the two vocabularies are ever
collapsed into one.

**What this cost T12:** nothing was built on the broken reading, because the
defect was found before the first C1 test was written. Had it not been found,
C1 would have shipped as a rule that could never fire.

## The readings T12 had to make, and which text won

1. **"the next 5 candles" is anchored ON the trigger candle.**
   §4.4:699 says "for the next 5 candles"; AC-027:983-986 says "Evaluate trend
   strength across seven candles" and verifies "a 7-candle fixture asserting
   override on candles 1–5 and expiry on 6", with a scenario of "Booster1 and
   Booster2 both fire **on a candle**". For candles 1–5 to be inside the window
   of a single seven-candle fixture, the trigger must be candle 1 — so the
   window is the trigger candle plus the next four. The anchor is a named
   constant, `WINDOW_ANCHOR = "triggerCandleInclusive"`, and it is the
   conservative reading: the bar on which two leading indicators both fire is
   exactly the bar on which ADX is most likely to lag. **AC-027 won**, being the
   binding acceptance criterion.

2. **"max" is T11's band maximum, not a literal.**
   §4.4:699 says "set `Trend_Score` to max". `C1_RULE.forcedRawDelta` reads
   `experts/trendStrength.mjs` `BAND.max`, so a change to that band moves C1
   with it. A literal `20` would be a second copy of the band — plan v1 §2's
   Risk 6.

3. **The 1.5× multiplier is imported, never declared.**
   `C2_RULE.atrMultiple` reads `riskLayer.mjs` `ATR_STOP_MULTIPLE` (§4.4:695's
   ATR stop), and a test asserts it equals `vetoes/wickVsClose.mjs`'s
   `ATR_MULTIPLE` and 1.5. An entry veto and a position stop that disagreed
   about "beyond 1.5× ATR" would produce the incoherent pair "veto fired, so you
   never got in" alongside "the stop was elsewhere".

4. **The stop's anchor is the entry price.**
   §4.4:700 does not say what the stop distance is measured from. `entryPrice`
   is a first-class input; with no fill supplied the prior bar's close is used,
   which is the reference `vetoes/wickVsClose.mjs:66,72-73` already takes. Both
   paths are tested.

5. **C3's "stated window" is the regime, not a candle count.**
   §4.4:701 requires "a stated window" that "expires" and gives no figure. It
   does not omit one: the window opens when `regime.mjs` says `hypertrend` and
   closes when it stops. So C3 is scoped to a STATE, its expiry is derived from
   the same classifier the regime itself comes from, and the module holds no
   counter, no timer and no remembered flag. A test asserts the resolution's
   exact key set, so "it is not sticky" is structural rather than promised.
   `window.candleCount` is explicitly `null` — an absent figure, never `0`.

6. **The effective weight table sums to 80 while C3 is open, and is NOT
   renormalised back to 100.** AC-029:1000-1001 requires the remaining weights
   "used as declared" and forbids renormalising "in a way that hides the
   change". `effectiveWeightSum` is on the score so a caller that wanted to
   renormalise would have to do it visibly.

7. **`contributions[].weightPct` still reports the DECLARED weight.**
   §4.3:606 and `contracts.ts:162-164` type it as a literal union of the six
   declared values, and T11's `expertDegradation.test.mjs:63-64` pins the exact
   key set of a contribution. The reallocation is therefore carried in
   `effectiveWeights` — `{ expert, declaredWeightPct, effectiveWeightPct,
   adjustedBy, reason }`, one row per expert — which is the display surface
   AC-029:1002 asks for. Rewriting a declared field to `0` would have broken
   both the type and a pinned assertion, and hidden the change rather than
   showing it.

## The worked C1-vs-C2 outcome

One real market state — `adxLaggingState()`, 250 bars of chop then a gentle
ramp — in which **both** rules want to speak:

- C1: both boosters fire on the trigger bar while the ADX leg still reads
  `below-threshold`. Trend sub-score 66.67, forced to 100.
- C2: a long entered 8 points above the current price puts the 1.5×-ATR stop
  level 7.599 below the **close**, so the close is beyond it → `hardStop`,
  trigger `closeBeyondAtr`.

| Configuration | `conflictOverrides` | score |
|---|---|---|
| neither rule enabled | `[]` | 35.667 |
| C1 only | `["C1"]` | **42.333** |
| C2 only | `["C2"]` | 35.667 |
| **both (the collision)** | `["C2"]` | **35.667** |

C1's maxing is worth exactly 6.667 points, and C2's win withholds exactly
that. The resolutions read:

```text
C1:superseded<C2   C2:applied   C3:notHypertrend
```

C1's record keeps `status: "superseded"`, `supersededBy: "C2"`,
`supersededReason` (the full table row), `wouldHaveApplied: true`, and
`supersededAdjustments` holding the adjustment it would have made. Nothing is
dropped; the adjustment is withheld from the score and preserved on the record.

## `conflictOverrides` — the spec's shape, and where the losers live

§4.3:619 types it `Array<"C1" | "C2" | "C3">`. It is kept EXACTLY that: an
array of strings, applied rules only, validated on the way in. The full record
is the sibling `conflicts.resolutions`, which always has all three entries, in
the spec's order, whether they applied, were superseded, did not trigger, were
disabled, or could not be evaluated.

Putting objects into `conflictOverrides` would break §4.3; dropping superseded
rules from `resolutions` would be the "silent drop" T12's own bisect line
forbids. The split is what lets both hold at once.

## Ordering luck, refuted three ways

1. **The table is data.** `conflicts/precedence.mjs` is a frozen literal with
   a `reason` per row, and it imports NO rule module — a test reads its source
   and asserts that. A table that reached into the rules would be reachable only
   through them, and the "not by ordering luck" claim would rest on the import
   graph again.
2. **The resolver reads a set, not an array.** `resolvePrecedence` reduces its
   input to a SET of rules that want to apply, and everything after that reads
   only the table. A test hands it the same two candidates in both orders and
   asserts byte-identical `JSON.stringify` output.
3. **The confluence refuses a collision outright.** Two adjustments on one
   expert throw, naming both rules, the expert, and `precedence.mjs` — so even
   reaching the array with a collision fails rather than letting position 0 win.
   A cyclic table also throws, rather than resolving by traversal order.

The **empty cell is the control**: there is deliberately no row between C1 and
C3, because they touch different experts. A blanket "C2 always wins" would pass
every other assertion in the file and would be caught only by that one.

**Why C2 outranks both.** A stop reads an open position's geometry; a score
decides whether a position is entered. C1 can only move a tier UP, so honouring
it on the bar C2 reports breached would have the engine opening a new position
on the bar that says the existing one is in trouble. C3 can only move a tier
down, but "can only move it down" is not a reason to let a reweighting outrank
an observed fact. The stop is a fact; the weight is a view.

## AC-027, AC-028, AC-029 — how each is met

### AC-027 (`:981-987`)

A seven-candle fixture over `c1WindowAt`, asserting `[true, true, true, true,
true, false, false]`. The prohibited side effects are tested as such: a
single-booster fixture (Booster1 true, Booster2 false) yields
`status: "notTriggered"` with the ADX penalty left standing; and offsets 5, 6, 7
and 50 after a trigger all read `active: false, expired: true`. C1 is also shown
to RAISE the score, by exactly the gap the band maximum is worth and no more —
the other five experts' weighted points are asserted unchanged.

### AC-028 (`:989-995`)

Four long-side verdicts and three short-side, from fixtures whose geometry is
re-derived and re-checked by `assertFixtureGeometry()` at load. A wick beyond
1.5× ATR with the close inside gives `softAlert` with
`waitsForCandleClose: true` and `action: "alert"`. A loop asserts that no case
whose CLOSE is inside can ever report `hardStop`. `closeBelowEma50` exists to
isolate the 50-EMA clause — without it, case 3 would be indistinguishable from
case 2 and §4.4:700's "or a close below the 50 EMA" would be a clause no test
ever exercised.

**A property of the rule worth stating plainly:** on a strongly trending long
the 50-EMA clause can never be the one that fires first, because the 1.5× ATR
stop sits above the EMA and any close below the EMA has already breached the
stop. The clause is only separately observable where the 50 EMA is INSIDE 1.5×
ATR of the anchor. That is what the spec says to do, and the fixture is built
to that shape.

### AC-029 (`:997-1003`)

A three-state weight snapshot: 20% before, **0%** during, 20% after, each state
named. The effective total is 80 while the window is open, and a test asserts
the declared table is still exactly 100 throughout. `effectiveWeights` names
`adjustedBy` and a `reason` on the macro row and `null` on the other five, so
"the displayed weights must show the reallocation" is a rendered fact rather
than an inference.

## BS-3 handoffs named, not silently trimmed (D27)

| # | Handoff | Why it could not land in T12 |
|---|---|---|
| 1 | **The Risk room surface for C2's two-tier stop.** Spec `:1303` names it in T12's file list. The **server side ships complete** — `conflicts/c2TwoTierStop.mjs` is the producer — but the room's *render* of the two tiers is BS-3 work. See the note below. | BS-2's "must not touch" column is **room visuals** (`:1397`), and the instruction for this task was explicit: nothing under `apps/dashboard/src/` |
| 2 | Wire `evaluateCopilot({ conflicts })` into a caller. The engine's default path is byte-identical to T11's, so nothing consumes the conflicts until a room or a service asks for them. | Same |
| 3 | The C1 window tracker needs a candle-index source. `createC1WindowTracker()` records trigger bars; nothing yet feeds it per candle. | Same |

### The T12 file-list / bisect tension, and how it was resolved

T12's file list at `:1303` names "the Risk room surface for C2's two-tier
stop", while the bisect matrix puts T12 in **BS-2** (`:1397`), whose
"must not touch" column is **room visuals**. Plan v1 §3.2:243-248 argues the
room change is a *component* change rather than a route-table change and says so
explicitly.

**Resolution taken: the server side landed; `apps/dashboard/src/` gained zero
bytes; the room's consumption is recorded here as an untrimmed BS-3 handoff.**
The same pattern T11 used and recorded in entry 0022, and a precedent rather
than a new invention. `src/terminal/domain/riskLayer.ts` and
`src/terminal/routes/RiskRoom.tsx` are unchanged and still describe the risk
layer's capabilities as pending, which is honest: no caller supplies the
observations yet. The instruction for this task was unambiguous that `src/`
must not be edited, and it was not.

**Exactly what the Risk room must do later, so nothing is dropped:**

1. Render C2's two tiers as **two visually distinct states**, from
   `evaluateC2(...).stop`: `softAlertFired` (amber — "beyond 1.5× ATR on the
   wick, waiting for the close") and `hardStopFired` (red — "closed beyond 1.5×
   ATR" or "closed beyond the 50 EMA"). `action` is `"alert"`, `"exit"` or
   `"hold"`.
2. Show the stop **geometry** a caller cannot otherwise know: `stop.multiple`
   (1.5), `stop.period` (14), `stop.distance`, `stop.level`, `stop.emaLevel`,
   `stop.emaPeriod` (50), and `inputs.entryPrice` with its
   `entryPriceSource` — so a reader can see whether the stop is anchored to a
   real fill or to the prior bar's close.
3. Name **which** hard clause fired, from `triggers`
   (`closeBeyondAtr` and/or `closeBelowEma50`) rather than showing one
   undifferentiated "stopped".
4. Render `unavailable` as a **named absence** with `unavailableReason`, never
   as `none`. A stop that could not be evaluated is not a stop that was not
   reached.
5. Surface C1's window from `resolutions.find(r => r.rule === "C1").window`:
   `candlesRemaining` of `windowCandles`, and the window's **closed** state
   once expired — so the override's end is visible, not just its start.
6. Render C3's reallocation from `confluence.effectiveWeights`: the macro row's
   `declaredWeightPct: 20` beside `effectiveWeightPct: 0` and its `reason`, with
   `confluence.effectiveWeightSum` shown as **80**, not normalised back to 100.
7. On the precedence record: when a rule is `superseded`, show the winner and
   the reason. A user who sees Trend_Score not maxed should be able to read why.

## Files

Added:

- `apps/dashboard/server/services/copilot/conflicts/c1AdxLagging.mjs`
- `apps/dashboard/server/services/copilot/conflicts/c2TwoTierStop.mjs`
- `apps/dashboard/server/services/copilot/conflicts/c3HypertrendMacro.mjs`
- `apps/dashboard/server/services/copilot/conflicts/precedence.mjs`
- `apps/dashboard/server/services/copilot/conflicts/index.mjs`
- `apps/dashboard/server/services/copilot/__tests__/c1AdxLagging.test.mjs`
- `apps/dashboard/server/services/copilot/__tests__/c2TwoTierStop.test.mjs`
- `apps/dashboard/server/services/copilot/__tests__/c3HypertrendMacro.test.mjs`
- `apps/dashboard/server/services/copilot/__tests__/conflictPrecedence.test.mjs`
- `apps/dashboard/server/services/copilot/__tests__/fixtures/conflictFixtures.mjs`

Edited — four lines of behaviour plus headers, all inside T11's own files:

- `confluence.mjs` — an **optional** second parameter, `context`, carrying
  `{ adjustments, conflictOverrides }`. With empty context the output is
  byte-identical to T11's (a test asserts it with `JSON.stringify`), which is
  what makes T12 independently revertible. New read-only fields:
  `effectiveWeights`, `effectiveWeightSum`, `conflictAdjustments`; and
  `contributions` gained `effectiveWeightPct` **on `expertScores` only** — the
  `contributions` array keeps T11's exact five keys and exact declared weights,
  which `expertDegradation.test.mjs:63-64` pins.
- `engine.mjs` — an **optional** `conflicts` option, and `conflicts` on the
  return. Omit it and the function is byte-identical to T11's. `NO_CONFLICTS`
  distinguishes "not asked" from "asked, and none applied", the same
  `null`-versus-`[]` distinction `marketState.mjs:212-222` makes.
- `experts/volatilityBoosters.mjs` — the `BOOSTER_LEG_KEYS` fix described above.
  One new frozen export and one changed line in `activeBoostersOf`.

Unchanged, deliberately: `apps/dashboard/src/**` (BS-2 must not touch room
visuals, and the instruction forbade it), the room routes, `contracts.ts` and
its four `ws6TerminalSeamGuard` regex pins, the six vetoes, `vetoIndex.mjs`,
`tiers.mjs`, `regime.mjs`, `riskLayer.mjs`, `executionAbsence.test.mjs`'s frozen
assertion logic, both lockfiles' contents, and every existing test and guard
value.

## How T12 integrated with T11's engine rather than duplicating it

- **One scoring path.** A C1 `rawDelta` is mapped to a sub-score by the same
  `bandToScore` and the same expert band the expert itself used; a C3 `weightPct`
  reaches the same `weightedPointsOf`. A conflict rule has no arithmetic of its
  own, so there is no second place for a score to be computed differently.
- **No restated numbers.** The trend band maximum, the 1.5× multiplier, the
  Macro Bias weight, the regime classification and the booster predicates are
  all READ from T11's modules. Five tests pin those reads.
- **Observations by calling, not re-deriving.** `observeDualBooster` calls the
  Volatility & Boosters expert; `observeTrend` calls the Trend & Strength
  expert. Re-deriving "a 20/50 cross with expanding BBW" inside C1 would be a
  second definition that could disagree with the expert invisibly.
- **The tier boundary is untouched.** A conflict changes the score; it never
  re-implements `tierFor`, and it never re-derives a risk percentage.
- **C2 contributes `[]` adjustments, always, and a test asserts it.** A stop
  that edited the score would be a fourth place a tier boundary could be moved.

## A second defect, found by T12's own review of itself

`bandToScore` CLAMPS, which is correct for an expert's own reading — a delta is
computed from data and cannot legitimately leave its band. It is **not** correct
for a conflict rule's. A rule supplying `rawDelta: 9999` to the
`trendStrength` row was silently clamped to the band maximum, which is the very
value it was trying to exceed, and the score reported back a number the rule
never asked for.

`confluence.mjs` now calls `assertDeltaInBand` before mapping an adjusted
delta, and throws a `RangeError` naming the expert and the band it violated.
Values exactly on either edge are accepted, and both are tested. C1 asks for
`BAND.max`; nothing legitimately sits outside the band.

## A third finding: a comment that overstated what the code did

`conflicts/index.mjs` claimed the rule ids were "read FROM the rules … so the
two cannot drift" while declaring them as literals. `CONFLICT_RULE_IDS` is now
built from `[C1_RULE.id, C2_RULE.id, C3_RULE.id]`, and the header explains the
second declaration in `confluence.mjs` — which exists so the confluence can
validate `context.conflictOverrides` without importing the layer that adjusts
it. A test now asserts BOTH that the import is absent and that the declaration
is present, because that is the only thing making the two copies safe.

## Net effect

The three resolutions are named, versioned, individually testable, individually
disable-able, and individually revertible. The engine's default path is
unchanged and asserted unchanged. `conflictOverrides` is populated with the
spec's own string union, and every rule — including every loser — is on an
inspectable record that says who won and why.
