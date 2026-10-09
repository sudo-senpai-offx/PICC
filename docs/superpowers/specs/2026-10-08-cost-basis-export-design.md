# Cost-Basis Export — Design

**Date**: 2026-10-08
**Status**: proposed (owner approved design A 2026-10-08; pending written-spec review)
**Author**: agent, with owner decisions recorded verbatim below
**Wave**: Wave 3, item W3-03 (third of W3-01…W3-10, one by one)

## 1. Purpose

A report-only tax-lot CSV for the operator's accountant: FIFO-matched disposals
with cost basis, fees, and gains, denominated in USD, with provenance on every
line. Explicitly not tax advice; the file and the screen both say so.

## 2. Owner decisions (2026-10-08, binding)

1. **Real disposals only**: journal closes + live close records + costs fills.
   Paper and Hyperliquid-testnet excluded by venue kind with stated reason.
2. **FIFO**, stated on the export (`method=FIFO` column + banner).
3. **Fees adjust basis** (buys up, sells down proceeds, funding accruals) ONLY
   from explicitly linked cost records (live fee fields, costs fills by
   close/fill id); otherwise `fee-unobserved` flag. No heuristic linkage, ever.
4. **Self-transfers flagged via the wealth transfer log, still listed**
   (no auto-exclusion).
5. **CSV + period filter**: `GET /api/tax/lots?from&to`, wealth-room download
   section with period picker.
6. **USD via wealth FX** (freshest-wins + declared parity); disclaimer banner as
   CSV comment row + on-screen notice.
7. **Opening balances + flag**: manual starting lots per asset (qty, basis,
   date); unmatched sells list with `basis-unobserved`, gain unstated.
8. **Global FIFO pool per asset** across venues/wallets.
9. **Swaps as paired entries**: close (disposal) + entry (acquisition) linked by
   tag; unpaired halves flagged, never inferred.
10. **Dates + MY calendar-year preset + all-time**.

## 3. Architecture

New `server/services/tax/` boundary:

- `lots.mjs` — FIFO matcher over global per-asset pools: acquisitions from
  journal entries + opening balances + swap-acquisition halves; disposals from
  journal closes + live close records (+ swap-disposal halves); basis adjusted
  only from linked cost records; outputs disposal lots
  `{ date, asset, side, qty, price, ccy, feeUsd, proceedsUsd, basisUsd,
  gainUsd|null, method: "FIFO", provenance, selfTransfer, flags[] }`
  (`gainUsd: null` + `basis-unobserved` when unmatched; `fee-unobserved`
  when unlinked).
- `csv.mjs` — renderer: banner comment row (report-only disclaimer + method +
  generated-at), fixed header, one row per lot, stable column order.
- Route: additive `GET /api/tax/lots?from&to` (requireAuth); disposal-date
  filtering on exitTime; CSV download content-type.
- UI: wealth-room download section (period picker + year preset + all-time),
  disclaimer notice, self-transfer flags visible.

## 4. Honesty rules (load-bearing)

- No linked fee record → `fee-unobserved`, never zero-fee assumption.
- No matching buy lot → `basis-unobserved`, gain unstated (never zero gain).
- Testnet/paper never enter the matcher (excluded with reason upstream).
- Unpaired swap halves flagged, never inferred into pairs.
- Banner states report-only status on every export; screen notice matches.

## 5. Non-goals

- Tax advice, filing, or jurisdiction-specific treatment (MY/SG rules are the
  accountant's domain).
- Venue recommendations, rankings, signals.
- Amended/backdated exports beyond opening balances (no revision machinery).

## 6. Testing

Hermetic per-file suites (fixture journals/fills/costs, dynamic imports).
Stateless matcher: no new store, no new env var — journal, costs, and wealth
transfer inputs are read from their existing stores per request. Opening
balances persist in the existing tradeJournal shape (a flagged entry kind, not
a new table). Tripwire-safe; full suite + typecheck green before merge.
