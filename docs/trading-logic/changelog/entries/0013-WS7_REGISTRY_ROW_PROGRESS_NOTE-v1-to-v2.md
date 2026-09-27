# 0013 - WS7_REGISTRY_ROW_PROGRESS_NOTE v1 -> v2

Supersession record for the progress note on the WS-7 row of the `PICC.md` §10
specs registry, which described as pending two things that had shipped and
overstated the gap that remained.

rule: WS7_REGISTRY_ROW_PROGRESS_NOTE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0013-WS7_REGISTRY_ROW_PROGRESS_NOTE-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1's note read "still not started. **T0 is first and blocking: amend the
  paper-only claim and make the absence scope machine-discovered.**
  `executionAbsence.test.mjs:27-38,58-62` pins a fixed 10-module `SUITE_SOURCES`
  list that omits the real rails ... so the test is green and pins **no**
  guarantee." Both halves were false by the date of this record. T0 landed as
  `09125f8` and shipped the mechanism v1 described as missing:
  `apps/dashboard/server/scripts/absence-scope.mjs` (156 lines) discovers the
  absence scope from the filesystem - its own header states that "so a new
  order-capable module cannot slip past the guard by simply not being listed" -
  and `executionAbsenceScope.test.mjs` guards it. T1-T4 landed after it
  (`1fea406`, `916a782`, `b78f5a2`, `510428c`), and the D19 paper-only amendment
  v1 called "first and blocking" was already applied to `PICC.md` guardrail 1 on
  2026-09-26. "Pins no guarantee" overstated what remained: the hand-maintained
  10-entry list is still there at `:27-38`, but it is now a complement to a
  discovered scope rather than the only scope. v2 records what landed, what is
  still outstanding, and by which commit.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirements
  R5.1 and R5.3 and acceptance criterion AC-016; owner decisions D19, D2, D21,
  D22-D27 as recorded in the row itself. Finding H8 and section 5 item 2 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md.
  Sibling records: 0010-PAPER_ONLY_ORDER_PATH_CLAIM (the D19 amendment, now
  propagated to the two documents D19 did not reach),
  0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE (the D22 half of the same row),
  0014-F2_CLOSURE_EVIDENCE_CITATION.

## The status value was NOT changed, and this record says why

The row's status cell still reads `ACTIVE-DRAFT`. It was tempting to upgrade it,
because the note said "every owner decision resolved 2026-09-26 - zero open items
remain" while also saying "still not started", and only one of those can be
right. Upgrading would have been the wrong fix, and the evidence is the spec's own
exit condition:

- The WS-7 spec sets its own transition out of `ACTIVE-DRAFT`: the row "leaves
  `ACTIVE-DRAFT` only after the owner accepts". The owner has not accepted.
- The spec's ship gate enumerates 21 conditions; WS-7 is five tasks in with T5 in
  progress and T6-T21 unstarted.
- The registry's status vocabulary is a spec-document lifecycle axis, not an
  implementation-progress axis. `ACTIVE` is already used on fully-landed specs
  (WS-1 through WS-6, and WS-5 with a note reading "WS-5 **shipped**"), and
  `ACTIVE — Draft for execution (new)` is already used on a draft. Implementation
  state is carried in the note column by design, and the spec header states
  `Status: ACTIVE-DRAFT` and `Implementation state: not started` as two
  independent fields.

So the defect was in the **note**, not the status. Changing the status would have
made the registry more accurate than the evidence supports, which is precisely
the failure mode this whole task exists to prevent. v2 fixes the note and leaves
the status value alone, and records the reasoning here so a later reader who
re-raises the question finds the answer rather than re-deriving the temptation.

## What changed

One cell, in `PICC.md` §10. Three sub-fixes, all inside the note:

1. **"still not started. T0 is first and blocking: amend the paper-only claim and
   make the absence scope machine-discovered."** became "**T0-T4 have landed**"
   with the five commit hashes, a note that the 2026-09-26 paper-only amendment is
   already in guardrail 1, and a description of the shipped T0 mechanism
   (`absence-scope.mjs` + `executionAbsenceScope.test.mjs`) and what it fixes.
   T2 is labelled as the room-transition decomposition, because it is - the row's
   "D2 removal APPROVED (T2 unblocked)" phrasing implied T2 *was* the removal.
2. **"so the test is green and pins **no** guarantee."** became a statement that
   the hand-maintained 10-module list is still present at `:27-38` but is now a
   complement to the discovered scope, with the note that the earlier phrasing
   "overstated the remaining gap".
3. **The outstanding work is now named as one item.** The approved D2 ExpertOption
   removal has **not** landed: `brokers/expertoption.mjs` and
   `services/expertoption.mjs` are both still tracked, and
   `executionAbsence.test.mjs:35` still lists `services/expertoption.mjs`, so that
   entry must be removed in the same change. The row's "**D2 removal APPROVED**
   (T2 unblocked): ExpertOption removed entirely" became "**D2 removal APPROVED,
   NOT YET LANDED:** ExpertOption is to be removed entirely".

Also in the same cell, the stale pointer carried for D22 was corrected: the row
told the reader that `PICC.md:30-31` was "rewritten to match" the retained
signal-stripping policy. Post-D19 those lines are the guardrail-1 rails table, so
the pointer named the wrong paragraph; it now names **§0 guardrail 2** and records
that `:30-31` was the stale pointer this row used to carry. See
0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE.

**Not changed:** the status value, the D19 / D21 / D22-D27 decision text, the
residual-UNVERIFIED list, the ARM budget derivation, the breach and UNMEASURED
verdicts, "27 decisions . 49 ACs . 22 tasks", the registry row-count correction
(39 -> 42), and the closing sentence "The 2026-09-26 round produced no
implementation - spec and this row only". That closing sentence is v1's own
provenance for the round it describes and is accurate as history; v2 adds a
separate, later sentence for this correction rather than rewriting it.

## The known scale problem, recorded and not fixed

The note is a ~1,400-character cell carrying 27 decisions, 49 acceptance
criteria, 22 tasks and a residual-UNVERIFIED list. Even after the three
corrections above it remains the hardest row in the table to keep truthful, and a
progress claim drifting inside a cell that size is the predictable failure mode
rather than a one-off. Splitting the decision record out into the spec - which
already holds it - would leave the registry's status column as the single thing a
reader has to trust. That is a structural change to §10 and is out of scope for
this slice; it is recorded here so the next reader of this row knows the shape is
a known risk and not an accident.

## Why historicalTradesAffected is `none`

Decided, not defaulted. The corrected text is a project-status annotation in a
registry table. It is read by a human deciding what work remains; it is read by no
backtest, no sizing formula, no scoring path, no risk gate and no
result-interpreting label, and no code path parses `PICC.md` at runtime.

The clause worth arguing is the ExpertOption one, because it is the only part of
this correction that touches a component a result could conceivably have
depended on. ExpertOption is present, and `PICC.md` §8.6 describes it accurately
as demo-only with live deferred. This correction does not change that, does not
remove anything, and does not alter the venue truth-table row. The removal is
still pending; naming it as pending is the whole of what v2 does, and a pending
item can have produced no results. So no prior result needs re-labelling and none
is invalidated.
