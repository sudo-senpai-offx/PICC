# 0003 - STAKING_JURISDICTION_STATUS v1 -> v2

Supersession record for the jurisdictional/regulatory characterisation of
on-chain staking that PICC presented in its catalog and in its setup wizard.

rule: STAKING_JURISDICTION_STATUS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0003-STAKING_JURISDICTION_STATUS-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 characterised on-chain staking as unregulated in PICC's jurisdiction, and
  asserted as a corollary that the exchanges the catalog lists do not offer it.
  Both halves are regulatory claims about third parties and about the legal
  status of an activity in a jurisdiction PICC does not control, made with no
  in-tree legal source. D26 deletes such claims rather than verifying them,
  and R5.4 forbids re-footnoting them to a source PICC does not control. v2
  replaces the regulatory framing with the risk that actually governs the
  decision - self-custody and smart-contract exposure - and keeps the explicit
  "use at your own risk" caution.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, decision D26,
  requirement R5.4, acceptance criterion AC-049; owner decision recorded
  2026-09-26.

## What changed

apps/dashboard/src/lib/streamCatalog.ts, the `staking-defi` entry:

- v1: `"On-chain staking (ETH ~2-3.5%, SOL ~5-6% mid-2026). NOT offered by
  SC-registered MY exchanges - unregulated locally, use at your own risk."`
- v2: `"On-chain staking (ETH ~2-3.5%, SOL ~5-6% mid-2026). Self-custody and
  smart-contract risk apply - use at your own risk."`

The id, name, category, residential, vps, payout and url are unchanged, and the
entry stays in CATALOG.

apps/dashboard/src/components/StreamSetupWizard.tsx, the crypto setup hint
(live UI copy):

- v1: `"Malaysia: on-ramp via SC-registered exchanges (Luno, MX Global);
  on-chain staking is unregulated locally - use at your own risk. Set est
  $/day = (staked amount x APY) / 365."`
- v2: `"Malaysia: on-ramp via exchanges (Luno, MX Global); on-chain staking
  carries smart-contract risk - use at your own risk. Set est $/day =
  (staked amount x APY) / 365."`

The estimation formula and the surrounding sentence structure are preserved
verbatim, because this string is live user-facing copy and the formula is the
part the user is actually there to use. Only the regulatory qualifiers were
removed; the two venue names were kept because naming where to on-ramp is
product guidance rather than a status assertion.

## Why historicalTradesAffected is `none`

Decided, not defaulted. This is the record where `reinterpret` was most
plausible, so it is worth stating the check explicitly. The `staking-defi` note
and the wizard `setupHint` are both display strings; the `setupHint` in
particular is the closest thing here to something a user reads before acting.
But risk appetite in PICC is enforced in code - the perps margin cap, the
notional envelope, the capture and ceremony gates - and none of those read
either string. A user who read the old wording was given a caution, not a rule,
and the v2 wording still carries an explicit "use at your own risk" caution of
equal force. No past trade was sized, gated, scored or labelled by the deleted
text, so no result needs re-labelling (`reinterpret`) and none is invalidated.
`none` is the accurate answer.
