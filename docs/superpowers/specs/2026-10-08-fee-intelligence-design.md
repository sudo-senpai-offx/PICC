# Fee Intelligence — Design

**Date**: 2026-10-08
**Status**: proposed (owner approved design A 2026-10-08; pending written-spec review)
**Author**: agent, with owner decisions recorded verbatim below
**Wave**: Wave 3, item W3-02 (second of W3-01…W3-10, one by one)

## 1. Purpose

A realized-cost scorecard per venue/route — explicit fees, spread paid, slippage,
perps funding, failed-attempt waste — so scaling decisions rest on measured costs,
not vibes. Every number carries measured|modeled provenance. Explicitly not a
trading signal, not a venue recommendation, not advice.

## 2. Owner decisions (2026-10-08, binding)

1. **Both, with labeled provenance**: measured from fills where observable;
   constitution-modeled leg (`costAdjustedEv`) as the guaranteed-available
   backstop. Controller ruling recorded: availability via the modeled leg,
   trust via measured preference.
2. **Paper overlay only**: paper ledger untouched (reconciliation stays exact);
   per-close modeled cost lines PLUS a drag-adjusted equity series beside the
   real curve.
3. **All dimensions incl. funding**: explicit fees + spread + slippage + perps
   funding + failed-attempt counts. Funding reuses existing Hyperliquid market
   observations (`hyperliquidPerps.mjs` fundingRate reads, perpsGates gate 15
   freshness, livePositionManager observed/unobserved-portion accrual shapes).
4. **Thin build for minimal capital, engine-driven frequency**: wealth-section
   surface (no separate room); per-fill cost lines first, aggregates as volume
   grows.
5. **Observed-only venues**: rows appear when fills exist; no pre-seeded venue rows.
6. **Wealth-section surface**; per-fill records 90 days, daily per-venue rollups
   2 years.
7. **Spread/slippage hybrid**: measured where arrival + mid both observable, else
   constitution-modeled, provenance-labeled both ways.
8. **Record-time USD** via the wealth FX module (freshest-wins + declared parity),
   fxSource+fxAt stamped; history immutable.
9. **Failed attempts counted** at ordering-seam refuse points only (requireKeys,
   sandbox-unsupported, mode blocks in ccxtOrdering + perps submit paths).
10. **Windows: day + all-time** per venue; near-empty windows read as honest
    absences, never zeros.
11. **Adaptive modeled inputs**: venue medians replace 1.5/0 defaults after 30
    observed fills, labeled modeled-with-calibrated-inputs (never relabeled
    measured); feedback loop documented in code.

## 3. Architecture

New `server/services/costs/` boundary:

- `store.mjs` — per-fill cost records (90d rolling prune by policy) + daily
  per-venue rollups (2yr retention); `PICC_COSTS_DATA_DIR`; isolation contract
  + runbook inventory (precedent: wealth store).
- `recorder.mjs` — measured parsing (ccxt trade fee fields, Hyperliquid
  userFills fees for the operator's own account only — no discovery, corpus
  precedent; funding accrual shapes from livePositionManager) + modeled leg
  via `costAdjustedEv` (+ adaptive medians per decision 11) + record-time USD
  via wealth `fx.mjs`.
- `attempts.mjs` — failed-attempt counter incremented at seam refuse points
  (minimal instrumentation, no behavior change to the seam).
- `aggregate.mjs` — day + all-time per venue/route with measured|modeled
  provenance on every number; observed-only venue rows.
- Paper overlay: per-close modeled cost lines + drag-adjusted equity series,
  computed beside (never inside) the paper ledger.
- Route: additive `GET /api/costs/overview` (requireAuth) — separate route, not a
  wealth-route extension, so both shapes stay stable independently; wealth-section
  UI (ships in the wealth room component, wired when nav lands per the WS-6 T0
  carry-forward).

## 4. Honesty rules (load-bearing)

- Provenance on every number (measured | modeled | modeled-with-calibrated-inputs).
- Absent data → absent rows/reasons, never zeros (near-empty windows included).
- Funding unobserved-portion never adjusted (livePositionManager precedent).
- Own-account fills only (no discovery, no other-participant data).
- Paper ledger byte-identical behavior (overlay computes beside it).

## 5. Non-goals

- Venue recommendations or rankings ("cheapest venue" framing prohibited).
- Live fee-optimization (routing orders to save fees — execution autonomy).
- Tax treatment of costs (W3-03 territory).

## 6. Testing

Hermetic per-file suites (mocked fills/tickers, dynamic imports,
`PICC_COSTS_DATA_DIR`); tripwire-safe (no pinned-shape edits without T8
accounting); full suite + typecheck green before merge.
