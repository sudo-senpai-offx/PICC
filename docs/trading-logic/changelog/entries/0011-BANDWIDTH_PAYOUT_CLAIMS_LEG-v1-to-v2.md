# 0011 - BANDWIDTH_PAYOUT_CLAIMS_LEG v1 -> v2

Supersession record for the claim that a bandwidth payout-claims execution leg
- scheduler `payout_ready` rows, a "bloodstream" claims surface, and a
`POST /api/command-centre/execute` endpoint - ships in this repository.

rule: BANDWIDTH_PAYOUT_CLAIMS_LEG
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0011-BANDWIDTH_PAYOUT_CLAIMS_LEG-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 described a named, gated, consent-bearing execution leg in three places in
  `PICC.md`, and none of it exists. A whole-tree grep for `payout_ready` returns
  zero files; `bloodstream` returns zero files; there is no
  `/api/command-centre/execute` and no `/api/command-centre/claims` in
  `handlers.mjs`. What does exist is the adjacent, real, and different
  `executionLeg` at `commandCentre/commandCentreOverview.mjs:302-309`, whose
  fields (`leg.power`, `leg.action`, `inFlight`, `lastExecutedAt`) are the CCXT
  and perps *order* leg - so the shape existed in the reader's mind and the
  substance did not. `PICC.md` §11 also listed this as the FIRST live execution
  leg and the §3.3 route group named `claims|execute` as literal paths. v2
  states what shipped (slice 6, the `trading:ccxt` order rail), what did not
  (slice 5, the payout-claims leg), and gives the real execute path.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirement
  R5.1 and acceptance criterion AC-016; Command Centre Web spec slice table
  (docs/specs/COMMAND_CENTRE_WEB_SPEC.md, slices 5 and 6), which is the register
  of what each slice was supposed to deliver. Findings H6 and H11 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md.
  Sibling records: 0010-PAPER_ONLY_ORDER_PATH_CLAIM (which execution rails
  actually exist), 0009-BANDWIDTH_SUITE_AUTOMATOR_CLAIM (the collection side of
  the same rejected suite), 0012-MODE_ENGINE_WORKABILITY_WIRING.

## What changed

| Location | v1 claim | v2 |
|---|---|---|
| `PICC.md` §3.3 | route group "`/api/command-centre/overview\|kill-switch\|claims\|execute\|orders`" | "`/api/command-centre/overview\|kill-switch\|orders`", with a note that the family has no `claims` or bare `execute` path and that the live execute endpoint is `POST /api/command-centre/orders/execute` |
| `PICC.md` §11 status paragraph | "slice 5: the FIRST live execution leg - bandwidth payout claims run the full 10-gate rail and execute on FRESH per-action human consent (consentBy), never a standing opt-in" landed | slices 1-4 and **slice 6** landed (the sanctioned `trading:ccxt` order rail, full 10-gate chain, fresh per-action consent, never a standing opt-in); **slice 5 did NOT land**, with `payout_ready`, "bloodstream" and `/api/command-centre/execute` named as absent |
| `PICC.md` §11.1 L6 UI | "the bandwidth card grows the OBSERVED claims leg (`executionLeg`) ... the bloodstream surface is a payout-claims block: scheduler `payout_ready` rows with honest claimed/ready badges, and an 'Approve & claim' button whose click is FRESH per-action human consent (consentBy) sent to `/api/command-centre/execute`" | `executionLeg` identified as the CCXT/perps order leg with its real fields cited; the bloodstream block recorded as not built; the real execute path given as `handlers.mjs:1993` |
| `PICC.md` §11.5 slice table | slice 5 "Execution: bandwidth auto-claim (first live) - fixture-tested, manual live verify" | untouched - the slice table is explicitly marked as the spec's table to track, and correcting the spec is out of scope; §11's status paragraph is where the landing claim lives and is corrected there |
| `README.md` roadmap | "First real-money execution (CCXT sanctioned automation + bandwidth auto-claim, within safety floor) \| 🔜" | the CCXT leg described as landed; the outstanding item is the perps `cancelOrder` closure and the ExpertOption removal. The bandwidth auto-claim half is gone from the roadmap because record 0009 established the suite is removed |
| `CHANGELOG.md` 2026-09-05 slice 5 | a dated entry describing the whole claims surface as landed: `GET /api/command-centre/claims`, `POST /api/command-centre/execute`, `claimPayout` with an `interventions.runWorkflow` executor, the `bandwidth:claim:<platform>:<payoutRef>` idempotency key, `payout_ready` scheduler rows, and the panel's "Approve & claim" block | entry preserved verbatim, prefixed with a dated correction that separates what landed (the `commandCentreExecution.mjs` seam, the power-aware sidecar gating, the observed `executionLeg` field) from what did not (every identifier above), and names slice 6's CCXT rail as the first live execution leg |

The `CHANGELOG.md` slice-5 entry is the one place found by the T5b verification
pass rather than by the investigation: the investigation's H6 table listed
`PICC.md` only, and the machine re-verification for this slice is what caught
it. It is the same claim class in a fourth document, and it is recorded here
rather than in a tenth record because the claim is one claim - a
payout-claims execution leg that does not exist - in four places.

That entry is also the only v1 text in this batch that is **partly** true, and
the correction is correspondingly split. The slice did land a real L1 execution
seam module and real power-aware sidecar gating; those are preserved in the
annotation as landed, because deleting them would understate what shipped. Only
the bandwidth-claims surface is marked absent.

## The judgement call inside this correction

`PICC.md` v1 was internally inconsistent about this leg, and the inconsistency is
the finding. §11 called the payout-claims leg the *first* live execution leg,
while §0 guardrail 1 - amended by D19 the previous day - described the CCXT and
perps rails as the retained execution surface, and `CHANGELOG.md` had already
recorded slice 6 as landed on 2026-09-05. Three possible fixes existed: delete
the claims, mark them unbuilt, or attribute them to the slice that did land.

**Attribution was rejected** as a third source of drift: renaming the
payout-claims claims as the CCXT order leg would have left `payout_ready`,
"bloodstream" and `/api/command-centre/execute` in the document as names a
reader would still go looking for. The correction names the real leg, names the
absent identifiers, and says which slice did not land. A reader of §11 now knows
both what shipped and what was planned, which is the same treatment D19 gave
guardrail 1.

The `README.md` roadmap row was the one place where the false claim and a true
one were fused: it listed "CCXT sanctioned automation" as future when it had
landed, and "bandwidth auto-claim" as future when it cannot land at all. v2 keeps
the row and states both halves correctly.

## Why historicalTradesAffected is `none`

Decided, not defaulted, and this is the record where `invalidated` deserves a
real argument rather than a formulaic one, because v1 named a leg that would
have *moved money* if it existed.

It did not exist, so nothing was computed under it. `none` is the accurate
answer for a specific reason: an execution leg that is absent has produced no
results to re-label or invalidate. There is no partial-execution history to
reconcile, no proposal record in `commandCentre`'s audit trail with an
`executionLeg` whose `leg.action` names a bandwidth claim, and no scheduler row
that ever produced a `payout_ready` event. The repository's audit log is the
evidence, and it records only the CCXT and perps order leg that slice 6
actually built.

The second half of the argument: this correction removes a *forward-looking*
claim, not a description of behaviour. Nothing in the corrected text changes a
gate, an envelope, a consent check, an idempotency key or an audit write, and
`interventions.mjs` - the human-approval gate v1 named as this leg's consent
mechanism - is untouched and still guards what it guards. So no prior result
changes interpretation, and none is invalidated.
