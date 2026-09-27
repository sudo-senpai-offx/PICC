# 0004 - RUNBOOK_LICENSING_ASSERTION v1 -> v2

Supersession record for the licensing and registration assertions in the
operator-facing Hyperliquid funding runbook.

rule: RUNBOOK_LICENSING_ASSERTION
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0004-RUNBOOK_LICENSING_ASSERTION-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 asserted Securities Commission licensing and digital-asset-exchange
  registration for third-party on-ramps and exchanges inside
  docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md - for Transak, for a list of six
  Malaysian exchanges, and in the Route C heading. PICC holds no licence, no
  registry extract and no issuer disclosure in-tree for any of them. A runbook
  is a working operator document, so an unevidenced licensing sentence there is
  not cosmetic: it is the kind of statement an operator acts on when choosing a
  funding route. D26 deletes it, and R5.4 forbids caveating or re-sourcing it.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, decision D26,
  requirement R5.4, acceptance criterion AC-049; owner decision recorded
  2026-09-26.

## What changed, and what was judged load-bearing

Each edit removed a regulatory assertion and kept the procedure. No runbook
step, check, command, route or numeric figure was removed.

1. Decision paragraph: the parenthetical justification "SC-registered DAXes
   serve MY residents only" was dropped; "(signup accepted; no VPN involved)"
   is kept because that is the operative fact that resolved the region
   question. This occurrence was invisible to a per-line scan of the runbook
   because the phrase was wrapped across a line break, and was found by
   whitespace-insensitive matching.
2. Route selection: "if SC-licensed + FPX bank rails matter more" became "if
   FPX bank rails matter more". Judged NOT load-bearing: the discriminator that
   actually picks Route C is FPX bank rails, and the route still reads and
   resolves correctly.
3. Transak caveat: "Transak is not an SC-registered DAX - it is a licensed
   payment provider" became "Transak is a fiat on-ramp, not an exchange".
   Judged NOT load-bearing: the operational payload of the sentence is that
   funds go straight to the wallet with no exchange custody, and that is kept
   verbatim. "Licensed payment provider" was itself a second licensing claim and
   was deleted with the first.
4. Route C heading: "SC-registered exchange, no P2P at all (licensing verified;
   stablecoin availability unverified)" became "MYR exchange on-ramp, no P2P at
   all (regulatory status unverified; stablecoin availability unverified)".
   Judged load-bearing as a heading and therefore KEPT as a heading, because
   `Route C` is cross-referenced later in the document. The route label and its
   "unverified" qualifier survive; only the unevidenced licensing assertion and
   the false "licensing verified" claim are gone. No anchor link or test
   references the old heading text.
5. Route C intro: "Six SC-registered Malaysian DAXes exist (Dec 2025: ...)" became
   "Six Malaysian exchanges take direct MYR deposits via FPX - no P2P
   counterparty (Luno, Hata, MX Global, SINEGY, Kinetic/KDX, Torum)". The
   actionable venue list, the FPX rail and the no-P2P property are all kept.
   The "Dec 2025" currency stamp and the "local regulatory recourse" claim were
   both unevidenced and were removed.

## Why historicalTradesAffected is `none`

Decided, not defaulted. A runbook is prose, not an execution path: no gate, cap,
adapter or ledger reads it, and no order size or venue selection in the code is
derived from it. The edits changed no procedure, so an operator following the
runbook before and after reaches the same state by the same steps. No past trade
was placed on the basis of a licensing sentence in a markdown file, so nothing
needs re-labelling and nothing is invalidated. `none` is the accurate answer.
