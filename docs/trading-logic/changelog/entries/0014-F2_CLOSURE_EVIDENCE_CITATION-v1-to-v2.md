# 0014 - F2_CLOSURE_EVIDENCE_CITATION v1 -> v2

Supersession record for a closure citation in the `PICC.md` §12.1 F-series audit
ledger that named a test file which is not in the tracked tree.

rule: F2_CLOSURE_EVIDENCE_CITATION
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0014-F2_CLOSURE_EVIDENCE_CITATION-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 closed finding F2 ("stale overlay-era background") with the citation
  "sensor chain covered by `e2eExtensionFeedChain.test.mjs`". `git ls-files`
  returns zero matches for that name. The tracked e2e suite is
  `apps/dashboard/e2e/{autopilot-surface,command-centre-order-flow,terminal-perf,ws7-transition-diagnostic}.spec.ts`
  plus `helpers/isolatedEnv.mjs` and `sharedAuth.ts`. A closure citation is the
  strongest form a document-truth defect takes, because it asserts that a
  *guarantee* is pinned: a reader of the F-series table - which is headed "all
  CLOSED" - would conclude a sensor-chain regression could not land, on the
  authority of a test that does not exist. The control that makes this a
  citation defect rather than a table-wide convention is the F3 row beside it,
  which cites `resolutionChain.test.mjs` and that file is present. v2 states the
  real closure, which is removal, and names the guard that actually enforces it.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirement
  R5.1 and acceptance criterion AC-016; owner decision D1 (extension clean
  break). Finding H9 and section 2 item S19 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md -
  S19 records the negative control, that the section's other citations
  spot-check clean, which is what isolates F2. Sibling record:
  0007-BROWSER_EXTENSION_SHIPPED_CLAIM, which removes the component F2's cited
  test was supposed to cover.

## What changed

`PICC.md` §12.1, one row:

- **v1:** "| F2 | stale overlay-era background | sensor chain covered by
  `e2eExtensionFeedChain.test.mjs` |"
- **v2:** "| F2 | stale overlay-era background | closed by removal: the
  overlay-era background and its sensor chain are gone with the extension (D1),
  and `extensionAbsence.test.mjs` pins the absence. **The closure citation
  previously given here, `e2eExtensionFeedChain.test.mjs`, names a file that is
  not in the tracked tree and never was in this repository's history of this doc
  - there is no such test.** |"

The F1 row in the same table was corrected in the same pass, because it carried
the mirror defect: "archived as `apps/extension-archived`; canonical =
picc-overlay" named `picc-overlay` as a shipped canonical component. It now reads
"there is no canonical extension - the extension era was removed end-to-end
(D1)". That edit belongs to 0007 and is not re-justified here.

## Why the v2 wording keeps the false citation visible

The obvious alternative is to delete `e2eExtensionFeedChain.test.mjs` from the
cell and say nothing. That would have produced a row indistinguishable from a row
that had been correct all along, and the defect class this task exists to close
is precisely "a false claim that leaves no trace once removed".

The F-series table is an audit ledger, and an audit ledger's value is that a
future reader can see which closures were re-verified and which were not. Keeping
the wrong citation in the row, marked wrong, converts a silent false closure into
a checkable one: a reviewer can `git ls-files | grep e2eExtensionFeedChain`, get
nothing, and see that this is exactly the claim the row says is false. The
sentence is also the only place a reader who remembers the old citation will look,
which is where an answer belongs.

The scope of the claim is stated precisely rather than generously. The
investigation established the file is absent from the tracked tree. The row does
not assert anything about git history, because that was not checked; it says the
name is not in the tracked tree, and separately that no such test exists. Those
are the two claims that were verified, and the record does not overstate past
them.

## Why historicalTradesAffected is `none`

Decided, not defaulted. The corrected text is a cell in an audit-closure table.
It is read by a human reviewing whether a finding is closed; it is read by no
backtest, no sizing formula, no scoring path, no risk gate, and no
result-interpreting label.

The clause worth arguing is the direction of the defect. v1 asserted that a
*regression* was impossible - a test existed. v2 asserts the opposite, and in
doing so weakens the claimed guarantee rather than the recorded results. A weaker
guarantee claim cannot invalidate a result: there is no past result that depended
on `e2eExtensionFeedChain.test.mjs` catching anything, because no such test ran.
Had the file existed and then been deleted, that would be a different question
about historical coverage, and `invalidated` might have been arguable. It never
existed, so there is no coverage to reconcile and `none` is the accurate answer.
