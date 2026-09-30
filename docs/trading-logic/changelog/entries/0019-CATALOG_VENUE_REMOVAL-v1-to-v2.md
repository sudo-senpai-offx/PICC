# 0019 - CATALOG_VENUE_REMOVAL v1 -> v2

Owner decision record and supersession entry for the removal of 13 income
catalog rows and the addition of 7 researched replacements
(WS-7 task T7b).

rule: CATALOG_VENUE_REMOVAL
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0019-CATALOG_VENUE_REMOVAL-v1-to-v2.md)
date: 2026-09-30
approvalDate: 2026-09-30
historicalTradesAffected: none
source: >-
  Owner instruction for WS-7 task T7b, given 2026-09-30 in the task brief for
  this workstream. The owner's decision is explicit and unconditional: 8
  peer-to-peer lending rows and 5 crypto exchange rows are removed from
  `apps/dashboard/src/lib/streamCatalog.ts`, and 14 DeFi and data connectors
  (opensea, aave, yearn, compound, magiceden, lido, jito, eigenlayer, pendle,
  mysterium, storj, rustchain, defillama, plus the already-removed
  expertoption) are retained untouched. The owner is recorded as the literal
  `WS-7+`. Replacement candidates were identified with brokerchooser.com as a
  candidate-identification source only, per the same brief. This is a separate
  decision from D26 (entry 0001 and entry 0006), which removed claims from
  rows that were retained; this entry removes the rows themselves.

## v1 -> v2

v1 carried 13 venue rows whose backing evidence PICC could not produce
in-tree and whose operators were not reachable by the owner. v2 removes the
rows outright and replaces them with rows whose facts are each traceable to a
page that was actually read. The change is recorded rather than silently
applied because the reasoning — why a row was removed while a similar-looking
row was kept — is the part a future reader needs.

reason: >-
  The 13 rows below are removed on the owner's explicit decision. D26 removed
  the unverifiable regulatory claims from these same rows and deliberately
  left the rows in place, recording that "whether these venues should be listed
  at all is a separate question this decision does not answer"
  (`docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:363`). The
  owner has now answered that separate question in the negative for these 13
  and kept the 14 DeFi and data connectors. Every removed row carried a
  user-facing `note` sentence asserting something about the venue that PICC
  holds no in-tree evidence for; each deleted sentence is reproduced in the
  removals table so the deletion is auditable rather than a silent shrink. The
  replacements are added on a stricter rule than D26 applied: a replacement row
  may carry only fields a page that was actually read supports, and it may
  carry no regulatory-status claim of any kind, because brokerchooser.com is a
  review site and a review site is not a regulator.

## Removals - 13 rows deleted, every deleted sentence recorded

Every value in the final column is the exact `note` string that was removed
from the row. Nothing else in these rows changed: `id`, `name`, `category`,
`residential`, `vps`, `payout` and `url` were deleted together with the note,
because the whole row is gone.

| Row id | Name | Category | Note text deleted from the row |
| --- | --- | --- | --- |
| funding-circle | Funding Societies | p2p | P2P SME lending; ~7-13% target returns with default risk. Auto-reinvest available. |
| selangor-kuasa | Selangor Kuasa (SKS) | p2p | P2P Islamic financing platform. PICC asserts no regulatory status for this venue. |
| pitik | Pitik.ai | p2p | Agritech P2P for poultry/livestock financing. PICC asserts no regulatory status for this venue. |
| stashaway | StashAway Simple | p2p | Not P2P but fixed-income cash management (~3-4% p.a.) - a low-effort parking yield. |
| peerberry | PeerBerry | p2p | EU P2P lending marketplace; 10M+ EUR interest paid out historically. Default risk applies. |
| brdge | BRDGE | p2p | Singapore-based SME lending marketplace. |
| 8lends | 8lends | p2p | Web3 crowdlending - real-world business loans settled on-chain. |
| prosper | Prosper | p2p | US P2P lending marketplace. |
| luno | Luno | crypto | Buy & hold BTC/ETH; no local staking product - log gains as manual balance. PICC asserts no regulatory status for this venue. |
| mx-global | MX Global | crypto | BTC/ETH/USDT spot pairs. PICC asserts no regulatory status for this venue. |
| hata | HATA Digital | crypto | Crypto exchange. PICC asserts no regulatory status for this venue. |
| sinegy | SINEGY DAX | crypto | Crypto exchange based in Penang. PICC asserts no regulatory status for this venue. |
| kinetic | Kinetic DAX | crypto | Crypto exchange based in Kuala Lumpur. PICC asserts no regulatory status for this venue. |

### What else referenced these rows, and what was done about it

Dependency sweep over every tracked file, by row id, before the deletion. Four
surfaces referenced a removed name, and each is recorded here rather than left
implicit.

- `apps/dashboard/src/components/StreamSetupWizard.tsx` named three removed
  venues in user-facing setup copy: the `p2p` category examples listed
  "Funding Societies", the `crypto` category examples listed "Luno holdings",
  and the `crypto` setup hint read "Malaysia: on-ramp via exchanges (Luno, MX
  Global)". All three strings were rewritten in the same change, to name the
  added rows instead. The three deleted sentences are the "UI copy" sentences
  of this record.
- `apps/dashboard/server/services/browserStudio.mjs:485-492` and
  `apps/dashboard/server/services/opportunities.mjs:45` also name some of
  these venues. They are **separate** venue and opportunity catalogs that do
  not import `streamCatalog.ts`, and no removed row was load-bearing for them.
  They are out of scope for this decision and were left untouched. Recorded
  here so a later reader does not mistake this entry for a repo-wide purge.
- `apps/dashboard/src/terminal/adapters/__tests__/venueIntegrity.test.ts:109,123`
  and `apps/dashboard/src/terminal/components/__tests__/StatusBoundary.test.tsx:46,47,70`
  use the string `hata` as an arbitrary fixture `venueId` for a generic
  venue-integrity model. Those tests do not import the catalog, so removing the
  row changes nothing for them. The fixtures were left exactly as they are,
  because `StatusBoundary.test.tsx` is an allowlisted file in
  `ws7RegulatoryClaimGuard.test.mjs` with an occurrence count of 1, and
  rewriting an unrelated fixture would put that count at risk for no gain.
- `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md` and `infra/supabase/schema.sql`
  also name some of these venues. Both are outside the catalog and outside this
  decision. Left untouched.

### No guard pinned a count or an index

This is the finding that most needed checking, so it is stated positively: no
guard anywhere in the tree pinned a catalog row count, a row index, or a
per-category row count. `streamCatalog.test.ts:37` asserts only that
`CATALOG.length` equals the sum of the ten exported groups, which is a
self-consistency property and holds for any row set. `registry.test.ts:116-130`
pins the `FamilyId` union, which is an income-stream *family* vocabulary in
`src/lib/registry.ts` and is independent of catalog rows; the `p2p` family was
therefore left in place and still resolves to the `intelligence` ministry. No
snapshot directory exists in the workspace, and no test or document under
`README.md`, `PICC.md` or `CHANGELOG.md` enumerates these venues.

## Additions - 7 rows added, each traced to a page that was read

Every added row carries factual fields only. No row carries `regulated`,
`licensed`, `authorised`, `approved`, `registered`, `accredited`, `chartered`,
`supervised` or any equivalent regulatory-status claim, and none was eligible
to: the sources are review sites and vendor marketing pages, not regulators.
Each note ends with the house disclaimer already used by the retained DAX-era
rows, that PICC asserts no regulatory status for the venue.

| Row id | Source actually read | What that source supports, and is recorded on the row |
| --- | --- | --- |
| interactive-brokers | brokerchooser.com/best-brokers/best-crypto-brokers-in-malaysia, read 2026-09-30 | Ranked #1 crypto broker for Malaysia in 2026; 20 cryptocurrencies; $1.75 spot fee on a $1,000 trade; crypto wallet available; deposit and withdrawal by bank transfer. The payout field records the bank-transfer withdrawal method, which is what the source names. |
| webull | brokerchooser.com/best-brokers/best-crypto-brokers-in-malaysia, read 2026-09-30 | Ranked #2 for Malaysia in 2026; 70 cryptocurrencies; $10.00 spot fee on a $1,000 trade; crypto wallet available; deposit and withdrawal by bank transfer. |
| swissquote | brokerchooser.com/best-brokers/best-crypto-brokers-in-malaysia, read 2026-09-30 | Ranked #3 for Malaysia in 2026; 52 cryptocurrencies; $10.00 spot fee on a $1,000 trade; crypto wallet available; deposits by bank transfer or card; withdrawals by bank transfer. |
| oanda | brokerchooser.com/best-brokers/best-crypto-brokers-in-malaysia, read 2026-09-30 | Ranked #6 for Malaysia in 2026; 9 cryptocurrencies; $2.50 spot fee on a $1,000 trade; no crypto wallet; withdrawals by bank transfer, card, PayPal, Skrill or Neteller. The payout field lists exactly those withdrawal methods. |
| alpaca | brokerchooser.com/best-brokers/best-crypto-brokers-in-malaysia, read 2026-09-30 | Ranked #7 for Malaysia in 2026; 25 cryptocurrencies; $2.50 spot fee on a $1,000 trade; crypto wallet available; withdrawals by bank transfer or Airwallex. |
| mintos | mintos.com/en/ and mintos.com/en/how-it-works/fees and help.mintos.com, read 2026-09-30 | A European investment platform whose core product is loan notes from third-party lenders; its own fees page states same-day withdrawal with no fee; secondary-market sales carry a 0.85% fee. The payout field records bank transfer, the withdrawal rail the source names. |
| debitum | faq.debitum.investments/en/articles/13002466-how-to-make-a-withdrawal, read 2026-09-30 | A business-loan investment marketplace whose own help centre requires a bank account on file before any withdrawal, states withdrawals are usually processed within 3 business days with no withdrawal fee, and states only uninvested balance is withdrawable. The payout field records bank transfer via SEPA, the rail the source names. |

All seven URLs were resolved over HTTP and returned 200 before the rows were
written: interactivebrokers.com, webull.com, swissquote.com, oanda.com,
alpaca.markets, mintos.com and debitum.investments.

### What was deliberately NOT claimed on these rows

- **No regulatory status, for any of the seven.** The Debitum source page
  carries licensing and supervision claims about itself. They were not copied,
  because this is exactly the claim class D26 deletes and the guard
  `ws7RegulatoryClaimGuard` exists to catch. BrokerChooser is a review site;
  a review site is not a regulator.
- **No return, yield or APY figure on any p2p row.** Debitum's page carries a
  default rate and an XIRR, and a third-party review carries a Mintos recovery
  rate. All are volatile, several are asterisked on the page, and none is
  something PICC can stand behind. The rows record payout mechanics only.
- **No "trustworthy", "safe", "reviewed by BrokerChooser" or equivalent
  endorsement.** BrokerChooser is recorded as the page the coin-count and fee
  figures were read from, which is a provenance statement, not a judgement.

## Candidates researched and deliberately left out

A candidate that could not be sourced from a page actually read was left out.
Five were dropped, and the reason is recorded for each so the next reader does
not re-run the same dead ends.

- **Zopa.** Its own blog and its own "our story" page state that it closed the
  P2P retail investing side of the business in December 2021 and wound up
  investor portfolios. Not a live candidate. Excluded on status.
- **LendingClub.** The `lendingclub.com` homepage now reads "Happen Bank,
  formerly LendingClub" and offers personal loans, checking accounts and
  certificates of deposit. A directory summary still describes it as a P2P
  marketplace; that description is stale. Excluded on status, not on quality.
- **Upstart.** Its own homepage is borrower-facing personal loans and debt
  consolidation. It is a loan-origination marketplace, not a venue where an
  investor lends. Excluded on category.
- **Monefit SmartSaver.** A genuine loan-funding platform, and the pages read
  state returns are paid out daily and that a withdrawal can be requested at
  any time. But no page read named the withdrawal rail, so the `payout` field
  would have been inferred. Excluded on the evidence boundary rather than
  written with a guessed payout.
- **CapBay.** A live Malaysian P2P financing platform and the closest
  geographic fit to the removed Malaysian rows, which is what makes dropping it
  a real loss. The pages read describe the platform and its cumulative data as
  at 30 June 2026 but do not name a payout rail. Excluded on the same evidence
  boundary. If a page that names the withdrawal method is produced, this is the
  first candidate to revisit.

Two further names were rejected on the same rule rather than on merit: Coinbase
and Kraken are named by the BrokerChooser page as crypto exchanges, but that
page carries no deposit or withdrawal data for either, so their `payout` fields
would have been inferred. Binance was not reconsidered at all, because it is
already a `trading` category row in `TRADING_PLATFORM_APPS` and a second row
would have been a duplicate venue under a second category.

## The empty-category question, decided rather than left dangling

Removing 5 crypto exchange rows and 8 p2p rows would have emptied the `p2p`
catalog group outright, and the `p2p` filter button in `IncomeStreams.tsx:623`
would have rendered an empty table. The decision is to **retain both
categories**, and it is decided by two independent reasons rather than by the
additions happening to fill them.

- `crypto` was never at risk of being emptied. `CRYPTO_APPS` also holds
  `staking-defi`, and all three `DEFI_APPS` rows carry `category: "crypto"`, so
  the category still resolves to four rows after the deletion. The five added
  rows take it to nine.
- `p2p` is a **family**, not only a row group, and the family is pinned by a
  guard. `src/lib/registry.ts:103-104` defines the `p2p` family and
  `registry.test.ts:116-130` pins `p2p` into the `FamilyId` union, with
  `registry.test.ts:81` pinning it to the `intelligence` ministry. An operator
  can still log a manual `p2p` income stream through `income.ts`, so removing
  the family would delete a user-facing capability and break a passing guard to
  fix a cosmetic gap. The family, the category union, and the
  `STREAM_CATEGORY_LABELS` entry all stay.
- The gap was closed the honest way instead: `p2p` is repopulated with 2 rows
  that are each sourced, rather than by deleting the category or by keeping an
  unsourced row to make the number look less thin. Two well-sourced rows are
  recorded here as a deliberately small set, with the dropped candidates named
  above, because a row that cannot be sourced is worse than a missing row.

## Verification measured on this change

- `npm run typecheck` exit 0.
- `npm run test --workspace @picc/dashboard`: 3947 total, 3946 passed, 1
  skipped, 0 failed - the AC-046 floor is unmoved, which is the expected
  result since no test was added, removed, weakened or re-pinned.
- `npm audit --audit-level=high` exit 0, recorded in the separate T7a change.
- `git diff --check` clean, exit 0.
- `ws7RegulatoryClaimGuard` passes, which is the operative check that none of
  the 7 added notes carries a regulatory-status claim.
