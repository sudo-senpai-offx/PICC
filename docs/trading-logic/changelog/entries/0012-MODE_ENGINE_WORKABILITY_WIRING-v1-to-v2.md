# 0012 - MODE_ENGINE_WORKABILITY_WIRING v1 -> v2

Supersession record for the claim that the Mode Engine's `workability` step has a
deterministic scorer wired behind it.

rule: MODE_ENGINE_WORKABILITY_WIRING
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0012-MODE_ENGINE_WORKABILITY_WIRING-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 listed `workability` as one of the seven steps of a "deterministic 7-step
  fixed decision order" with no qualifier, and omitted that it is the single step
  whose scorer is deferred. The implementation says so in its own words:
  `commandCentre/commandCentreOverview.mjs:291-293` emits
  `workability: { value: null, note: "deterministic workability scorer not-wired
  - conservative 0 fed to the engine (slice 5+)" }`, and
  `commandCentre/commandCentreOverview.mjs:131-140` feeds `0` explicitly so the
  engine cannot receive a fabricated score. `modeEngine.mjs:41,134-135` caps any
  value under `AUTOPILOT_WORKABILITY_FLOOR` (0.5) at COPILOT, so the deferred
  scorer currently *supplies* that floor rather than earning it. v1 described as
  wired the one step the implementation labels not-wired, and hid the
  "slice 5+" deferral. v2 states the wiring that exists, the scorer that does
  not, and the consequence for a live surface verdict.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirement
  R5.1 and acceptance criterion AC-016. Implementation evidence:
  apps/dashboard/server/services/commandCentre/commandCentreOverview.mjs:131-140,291-293
  and apps/dashboard/server/services/commandCentre/modeEngine.mjs:40-41,129-139,
  asserted by apps/dashboard/server/__tests__/commandCentre.overviewApi.test.mjs:122-123,174-177.
  Finding H7 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md.
  Sibling records: 0010-PAPER_ONLY_ORDER_PATH_CLAIM (the execution surface this
  gate caps), 0011-BANDWIDTH_PAYOUT_CLAIMS_LEG (the slice whose absence the
  "slice 5+" note defers to).

## What changed

`PICC.md` §11.1 L5 Mode Engine, the step list only:

- **v1:** "deterministic 7-step fixed decision order (kill switch -> opt-in ->
  breakers -> freshness/HOLD -> 5C truth table -> workability -> deliberation ->
  advisory), chosen by site risk, never by convenience."
- **v2:** the same list, plus: "**Workability is the one step with no
  deterministic scorer wired:** `commandCentreOverview.mjs:291-293` feeds a
  conservative `0` with the note 'deterministic workability scorer not-wired -
  conservative 0 fed to the engine (slice 5+)', and `modeEngine.mjs:41,134-135`
  caps anything below `AUTOPILOT_WORKABILITY_FLOOR` (0.5) at COPILOT. On the live
  surface that floor is currently *supplied* rather than *earned* - the engine
  logic is real, the deterministic scorer behind it is deferred."

Nothing else in §11.1 changed. The eight-layer design, the five modes, the
downgrade-only advisory rule, the 5A-5H safety floor, the idempotency guarantee
and the "a non-converged board never executes" statement are all real and are
preserved.

## Why this is a documentation-truth defect and not a code defect

The code is honest here and the guard asserts it:
`commandCentre.overviewApi.test.mjs:122-123` asserts
`ccxt.inputs.workability.value` is `null` and the note contains `not-wired`, and
`:174-177` asserts the conservative `0` produces a real COPILOT cap rather than a
fabricated execution power. The engine's step-5 logic is genuinely implemented
and genuinely deterministic *given* an input; what is missing is the producer of
that input. v1 described the consumer as if the producer existed, which is a
claim about the tree rather than about behaviour.

This is the mirror of the defect class the other records in this batch address.
Those are "document claims a shipped artifact that is absent"; this one is
"document describes a wired step whose producer is deferred". Both are claims
about the tree, both are checkable, and R5.1 covers the second as squarely as the
first - a reader deciding whether a surface can reach AUTOPILOT needs to know
that the gate is currently a constant, not a measurement.

## Why historicalTradesAffected is `none`

Decided, not defaulted. The corrected text describes the *source* of an input to
a verdict, and no verdict, recommendation or sizing decision in this repository's
recorded history was produced by the `workability` scorer - because there is no
scorer. The engine consumes the literal `0` that `commandCentreOverview.mjs`
supplies, and `0` is below the floor, so any live surface verdict is capped at
COPILOT regardless of the other six steps.

That is the argument, and it is worth stating explicitly: the corrected text
changes no gate, no floor constant, no cap and no input. `AUTOPILOT_WORKABILITY_FLOOR`
is still `0.5`; `modeEngine.mjs:134-135` still caps below it; the
`commandCentre.overviewApi.test.mjs` assertions are untouched and still pass
unchanged. No prior verdict, paper decision or recorded result was computed under
a scorer that does not exist, and none is invalidated by naming the deferral.

`reinterpret` would apply if a past verdict had been *labelled* as
workability-earned when it was workability-supplied. No such label exists: the
verdict reason string the engine emits for this case is the deterministic floor
message at `modeEngine.mjs:137`, and it is emitted today exactly as it was
before this correction.
