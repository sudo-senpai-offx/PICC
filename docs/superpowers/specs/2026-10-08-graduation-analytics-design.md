# Graduation Analytics — Design

**Date**: 2026-10-08
**Status**: proposed (owner approved design A 2026-10-08; pending written-spec review)
**Author**: agent, with owner decisions recorded verbatim below
**Wave**: Wave 3, item W3-04 (fourth of W3-01…W3-10, one by one)

## 1. Purpose

Per-strategy-tag readiness readout across paper → testnet → mainnet: which
strategies have earned the right to advance, which are decaying, and what the
evidence is. Advisory only — it moves no permit, unlocks nothing, pre-authorizes
nothing.

## 2. Owner decisions (2026-10-08, binding)

1. **Unit of graduation: strategy tag** (journal strategy/pattern tags).
2. **Gate metrics: constitution floors + costs** (12 embargoed walk-forward
   windows, EV gates, calibration tolerance, cost-drag-adjusted returns).
3. **Stages: paper → testnet → mainnet** (testnet = Hyperliquid testnet, real
   mechanics, no value). Testnet leg reads ABSENT until testnet creds land
   (Phase B blocked — expected, not a defect).
4. **Advisory only**: readout + reasons; every promotion stays a manual human
   act via existing ceremony/approval paths. Autonomy ceiling intact.
5. **Symmetric demotion with hysteresis**: promote on 12 consecutive windows
   above bar; demote on 6 windows below 70% of bar (anti-whipsaw).
6. **All three data sources, recency-weighted**: backtest embargoed windows +
   paper closes + live fills, exponential decay half-life 30 days
   (config-overridable), source provenance on every window.
7. **Surface: paper-room table** (stage, gate stats, demotion warnings).

## 3. Architecture

New `server/services/graduation/` boundary:

- `windows.mjs` — normalizes backtest embargoed residuals + paper closes + live
  fills into comparable per-window stats `{ source, windowStart, windowEnd,
  returnPct, sharpe, maxDd, costDragUsd, provenance }`; windows with
  insufficient data are absent with reason (never zero-filled).
- `weighting.mjs` — recency-decay weights (half-life 30d default,
  `PICC_GRADUATION_HALFLIFE_DAYS` override); pure.
- `gates.mjs` — per-strategy-tag evaluation: promotion (12 consecutive windows
  above bar), demotion (6 below 70%), stage labels paper|testnet|mainnet;
  testnet/mainnet legs ABSENT with reasons while creds/ceremony missing;
  output is a readout object, never a permit mutation.
- Route: additive `GET /api/graduation/overview` (requireAuth); paper-room
  table (stage, stats, warnings); no nav changes beyond the room section.

## 4. Honesty rules (load-bearing)

- No 12 qualifying windows → no promotion verdict (below-floor state shown).
- Stages are labels; a "graduated" label authorizes nothing mechanically.
- Demotion warnings fire on the same math as promotions (no asymmetric courage).
- Live-sparse strategies show thin-evidence states, never extrapolated verdicts.

## 5. Non-goals

- Permit flips, ceremony unlocks, auto-promotion of any kind.
- New backtest machinery (consume technicalBacktest/hyperopt/prediction outputs).
- Venue recommendations.

## 6. Testing

Hermetic per-file suites (fixture windows/closes/fills, dynamic imports,
`PICC_GRADUATION_DATA_DIR` only if a store is needed — stateless evaluation
preferred, no new env var beyond the half-life override); tripwire-safe; full
suite + typecheck green before merge.
