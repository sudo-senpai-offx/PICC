# 0005 - RUNBOOK_DESIGNATION_CLAIM v1 -> v2

Supersession record for the licensing and designation assertions that survived
the first pass over the Hyperliquid funding runbook, and for the broadening of
the claim vocabulary that now covers the whole class rather than five strings.

This record is a **sibling of 0004**, not a replacement for it. 0004 supersedes
the licensing assertions the first pass removed. These four sites expressed the
same class of unevidenced claim in phrasing the original eight-pattern scan did
not match, so they survived that pass. A supersession log is append-only: a
published record is not rewritten in place, so the correction is recorded here
and cross-referenced rather than folded into 0004.

rule: RUNBOOK_DESIGNATION_CLAIM
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0005-RUNBOOK_DESIGNATION_CLAIM-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 still asserted third-party licensing and regulatory designations in
  docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md using vocabulary the D26 scan
  did not cover: an "SC investor-alert class" label, an "SC approval aside"
  parenthetical, a "dual SC + Labuan FSA licence" clause naming two regulators
  and asserting a licence, and an "RMO-DAX since 2019" designation. PICC holds no
  licence, registry extract, or issuer disclosure in-tree for any of them. The
  gap was one of vocabulary, not of intent: the scan knew five literal strings,
  so a different spelling of the same claim read as clean. D26 deletes the
  claims; R5.4 forbids caveating or re-sourcing them. v2 strips the designation
  clause from each site and keeps the operational content.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, decision D26,
  requirement R5.4, acceptance criterion AC-049; owner ruling of 2026-09-27 that
  the surviving sites are in scope and that the guard's vocabulary must match
  the claim class rather than five literal strings. Sibling record:
  0004-RUNBOOK_LICENSING_ASSERTION-v1-to-v2.md.

## What changed, and what was kept

| Site | Removed | Kept |
|---|---|---|
| platform facts, first bullet | the "SC investor-alert class" label | the operational instruction: offshore exchanges are not reliably signup-able from Malaysia in 2026, do not re-recommend them |
| platform facts, HYPE note | "(SC approval aside," | that HYPE is not tradeable on Luno, and Luno's own table listing HYPE as no-send/receive for SA/Nigeria only |
| Route C, Hata bullet | "(the primary SC option now)", "dual SC + Labuan FSA licence", "Bybit-backed" | every fee and settlement fact (FPX ~RM0.80 instant, 0% maker, 0.10-0.40% taker, Instant Buy 1%) and all three in-app checks (a)/(b)/(c) |
| Route C, Hata bullet, verdict line | "SC +" in "best of both worlds" | "FPX + direct delivery" |
| Route C, Luno bullet | "RMO-DAX since 2019" | FPX deposit free over RM100 (RM1 below) and the no-USD-stablecoin fact with its official-table citation |

Nothing load-bearing was removed. The section heading at `:111` already reads
"regulatory status unverified", so the section is left explicitly honest about
what PICC did not verify; no replacement assertion was written about any venue's
regulatory status, because that is precisely the thing that is unverified.

**"Bybit-backed" was removed on a judgement call, flagged deliberately.** It is
not a licensing claim. It is an unevidenced third-party ownership assertion -
the same class as the "(Binance is an investor)" parenthetical dropped from the
mx-global note in 0001, and dropping one while keeping the other would have been
inconsistent. One-line revert if the reviewer disagrees.

## The vocabulary was the actual defect

The first guard banned five literal strings, which is the vocabulary the brief
supplied. A guard that only knows five strings discharges neither intent of
D26: it does not discharge the deletion (a sixth phrasing of the same claim is
invisible to it) and it does not discharge the discovered-scope requirement (a
claim can be reintroduced in a new file and a new wording simultaneously). The
vocabulary is now compositional - a licensing or designation word in the
proximity of a regulator token, a financial entity, or another licensing word -
so a phrasing nobody enumerated is still caught. See the guard's own comments
for the per-rule rationale and for the three boundaries that are deliberately
NOT banned.

## Why historicalTradesAffected is `none`

Decided, not defaulted, and the same reasoning as 0004 applies: a runbook is
prose, not an execution path. No gate, cap, adapter, ledger or risk rule reads
it, and no order size or venue selection in the code derives from it. The edits
changed no procedure, so an operator following the runbook before and after
reaches the same state by the same steps. None of the four edits touched a
number, a route, a check, a command or a fee. `none` is the accurate answer.
