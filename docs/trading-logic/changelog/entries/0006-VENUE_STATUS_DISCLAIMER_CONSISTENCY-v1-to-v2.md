# 0006 - VENUE_STATUS_DISCLAIMER_CONSISTENCY v1 -> v2

Supersession record for two unsourced-assertion and honesty-consistency defects
that survived the D26 claim deletions in
`apps/dashboard/src/lib/streamCatalog.ts` and
`docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md`.

This record is a **sibling of 0001 and 0004/0005**, not a replacement. Those
records describe the claim deletions; this one corrects the *shape* of what was
left behind, which their before/after tables would otherwise misdescribe. A
supersession log is append-only: a published record is not rewritten in place,
so 0001's table of the seven catalog notes is superseded by the table below
rather than edited.

rule: VENUE_STATUS_DISCLAIMER_CONSISTENCY
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0006-VENUE_STATUS_DISCLAIMER_CONSISTENCY-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  Two defects of the same class as the claims D26 deleted - an unsourced
  assertion, or the absence of the honesty qualifier that would have prevented
  one from being inferred.

  **One.** The catalog notes for `luno` and `mx-global` were left without the
  "PICC asserts no regulatory status for this venue" qualifier that the other
  five venue notes in the same file received. Silence in a note is not neutral
  in a catalog a user reads when deciding where to place money: a note that
  describes what a venue trades, and says nothing about its regulatory status,
  can be read as PICC having checked. That is the inference D26 exists to
  prevent, reintroduced by omission rather than by assertion.

  **Two.** The runbook's Route C introduction read "Six Malaysian exchanges take
  direct MYR deposits via FPX". The exhaustiveness count was v1's, and record
  0004 removed the "(Dec 2025)" currency stamp and the regulatory claim from
  that same sentence precisely because they were unevidenced. Leaving a bare
  count behind is the same unsourced assertion with nothing left to check it
  against: nothing now says when the list was accurate or how it was compiled.
  A separate sentence in the same file also repeated "offshore exchanges" in
  two adjacent clauses, an artefact introduced by the 0004/0005 deletion
  pass rather than present in v1.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, decision D26
  and requirement R5.4; reviewer findings on WS-7 T5a, 2026-09-27 (Minor 6,
  Minor 7, Minor 9). Sibling records: 0001-VENDOR_REGULATORY_STATUS,
  0004-RUNBOOK_LICENSING_ASSERTION, 0005-RUNBOOK_DESIGNATION_CLAIM.

## What changed

`streamCatalog.ts` - all seven formerly-claimed venue notes now carry the
qualifier. This supersedes the corresponding rows of 0001's table:

| Entry | v2 note (this record) |
|---|---|
| luno | "Buy & hold BTC/ETH; no local staking product - log gains as manual balance. PICC asserts no regulatory status for this venue." |
| mx-global | "BTC/ETH/USDT spot pairs. PICC asserts no regulatory status for this venue." |
| hata | "Crypto exchange. PICC asserts no regulatory status for this venue." |
| sinegy | "Crypto exchange based in Penang. PICC asserts no regulatory status for this venue." |
| kinetic | "Crypto exchange based in Kuala Lumpur. PICC asserts no regulatory status for this venue." |
| selangor-kuasa | "P2P Islamic financing platform. PICC asserts no regulatory status for this venue." |
| pitik | "Agritech P2P for poultry/livestock financing. PICC asserts no regulatory status for this venue." |

`staking-defi` and `funding-circle` are unchanged: neither ever carried a
regulatory claim about a named third party (one is a generic yield product, the
other's claim was a licence plus useful lending detail), so there is no status
to disclaim. The qualifier is applied to exactly the seven entries whose v1 note
asserted a third party's status.

`HYPERLIQUID_CONNECT_RUNBOOK.md`:

- "Six Malaysian exchanges take direct MYR deposits via FPX" became "These
  Malaysian exchanges take direct MYR deposits via FPX". The count is gone; the
  operational content (FPX rail, no P2P counterparty, and the full venue list
  that follows in the bullets) is untouched.
- "do not re-recommend offshore exchanges to this user" became "do not
  re-recommend them to this user", removing a repetition introduced by the
  deletion pass. Pure prose; no assertion either way.

## The alternative that was rejected

The reviewer asked for consistency and left the direction open: all seven, or
none. **None was rejected** because silence is the failure mode. D26 removed
claims; a catalog whose remaining notes are pure product description does not
assert anything false, but it also does not tell the reader that PICC asserts
nothing - and the user is choosing where to place money. The qualifier is short,
it is the same sentence in all seven notes so the file reads consistently, and
it converts an absence into an explicit statement. It is also now a single
repeated phrase, which is what makes the consistency checkable by eye.

## Why historicalTradesAffected is `none`

Decided, not defaulted, and the same reasoning as 0001: the `note` field is
display copy read by the catalog UI and the overlay help and by nothing else. No
backtest, no metric, no entry-selection branch, no risk gate and no scoring path
ever parsed it, so a user reading a note received information, never a rule. The
runbook edits likewise changed no number, route, check, command or fee, and a
runbook is prose rather than an execution path. Nothing was sized, gated, scored
or labelled by the changed text, so no past result needs re-labelling
(`reinterpret`) and none is invalidated. `none` is the accurate answer.
