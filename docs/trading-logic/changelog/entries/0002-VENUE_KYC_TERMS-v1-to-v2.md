# 0002 - VENUE_KYC_TERMS v1 -> v2

Supersession record for the third-party onboarding/KYC terms asserted about a
demo trading venue in PICC's browser overlay site index.

rule: VENUE_KYC_TERMS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0002-VENUE_KYC_TERMS-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 described the OANDA fxTrade Practice demo venue in
  apps/dashboard/server/services/browserStudio.mjs as requiring "no payment
  info, no KYC for demo". That is a factual assertion about a third party's
  account-opening terms, presented to the user as fact, with no in-tree evidence
  - PICC holds no OANDA account, disclosure or terms capture in the repository.
  Such terms are also exactly the kind of statement that goes stale silently,
  since a   venue can change its onboarding flow at any time. D26 deletes
  unverifiable third-party claims rather than verifying or caveating them.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, decision D26,
  requirement R5.4, acceptance criterion AC-049 (the AC-049 text names
  browserStudio.mjs:505 specifically); owner decision recorded 2026-09-26.

## What changed

The OANDA SITE_INDEX row's last element:

- v1: `"Demo venue - free practice account ($100K virtual), instant email
  signup, no payment info, no KYC for demo."`
- v2: `"Demo venue - free practice account ($100K virtual), instant email
  signup."`

The hosts, id, name, category, payoutThreshold and url are unchanged. The
demo-venue description - the virtual balance and the signup affordance - is kept
because those are the parts the overlay actually uses to explain the venue.
The deleted text was the KYC/onboarding assertion and the adjacent "no payment
info" assertion, which is the same unevidenced third-party-status claim.

## Why historicalTradesAffected is `none`

Decided, not defaulted. The demo/live boundary for a venue is enforced in code
by the capture and ceremony gates, never by this display string, so the deleted
sentence was never an input to whether a trade could be placed. It also carried
no numeric, threshold or labelling semantics, so no past paper-trade or backtest
result was computed under it. `reinterpret` would imply past results were
labelled under the old rule and would need re-labelling; `invalidated` would
imply results computed under it are no longer comparable. Neither is true, so
`none` is the accurate answer.
