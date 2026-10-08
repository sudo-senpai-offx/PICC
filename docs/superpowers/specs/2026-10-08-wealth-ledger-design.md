# Wealth Ledger — Design

**Date**: 2026-10-08
**Status**: proposed (owner approved design A 2026-10-08; pending written-spec review)
**Author**: agent, with owner decisions recorded verbatim below
**Wave**: Wave 3, item W3-01 (first of W3-01…W3-10, one by one)

## 1. Purpose

A cross-venue net-worth truth for a single operator: one screen answering "what do I
actually hold, where, and how fresh is each number" — with provenance badges on every
leg, so a total is never more confident than its weakest input. Explicitly not a
trading signal, not tax advice, not a recommendation engine.

## 2. Owner decisions (2026-10-08, binding)

1. **Real money only in the total; paper in a separate, never-summed section.**
2. **Partial totals with per-leg LIVE/STALE/ABSENT badges + an `incomplete` flag.**
   Partial state is the normal state (testnet creds absent, TnG closed-loop).
3. **Display currency USD; FX via Yahoo/CCXT with per-leg `fxSource`+`fxAt`.**
   FX-missing legs are excluded with a reason (never last-known-stale conversion,
   never total-nulling).
4. **Explicit transfer log with source-deduction** (no heuristic matching).
5. **Tiered cadence**: keyed legs ride existing equity/market jobs; manual legs carry
   `enteredAt` + age badge and are never LIVE.
6. **All three surfaces**: new wealth room + store, repopulated accountMetrics
   collector as a leg feed, portfolioAnalytics null-honesty fix bundled.
7. **Billing legs are settled balances only, honestly zero when zero.** BTCPay +
   TnG (manual, closed-loop) now. No Stripe (operator has no tax ID/business
   website). Merchant-of-record follow-up (Lemon Squeezy 5%+$0.50 / Gumroad 10% /
   Paddle ~5%+$0.50 — free to start, no registration; seller-merchant eligibility
   for MY/SG unverified, operator to confirm before any leg is built) is a named
   follow-up, not this spec.
8. **Overlap dedupe by priority order**: live keyed legs win; localstore rows
   overlapping them are flagged duplicate and excluded with reason. (Operator has
   no Bybit account — geographic restrictions; legs stay venue-agnostic via the
   broker registry, Bybit appears nowhere as an assumed leg.)
9. **Snapshots daily, 2-year rolling retention**, date-keyed idempotent arm in the
   new `jobs/wealth-refresh.mjs` (tiered leg refresh + daily snapshot in one job).
10. **Staleness: keyed legs LIVE<90s / STALE<5min / ABSENT beyond; manual legs
    carry ENTERED + age badge, never LIVE/STALE.**
11. **Declared parity for USD-pegged stables (labeled assumption); every other
    currency always via observed Yahoo/CCXT rate** (missing rate excludes the leg).
12. **Transfers multiphased in this spec**: Phase 1 manual entry form in the room
    (from/to/ccy/amount/at/note); Phase 2 suggest-and-confirm (burst-matched
    candidates + approval queue) — Phase 2 ships only on Phase 1 green.
13. **Collector scope spot-only** (Hyperliquid read directly by the wealth leg).
14. **Paper section = embedded summary** (equity, cash, committed, open/closed
    counts + link to paper room), live-read passthrough per overview call.
15. **Day-one registry ships pre-seeded**: known legs (Hyperliquid, ccxt-spot,
    BTCPay, TnG-manual-empty) reading ABSENT with per-leg reasons — never an
    empty state that could be mistaken for zero.
16. **Transfer deduction is snapshot-window adjustment** (not a displayed-only
    log): snapshots exclude in-flight duplicates using transfers dated inside
    the window; the log remains visible as evidence.
17. **Manual legs require an as-of date** (backdatable, default entry time) —
    age badges reflect holding age, never entry age.
18. **BTCPay leg reads the server balance API** (operator-supplied server URL +
    API key via the existing env/vault credential pattern; ABSENT with reason
    when unconfigured). TnG stays manual (closed-loop, no API).
19. **FX conflicts resolve freshest-wins** (by quoted-at; tie → CCXT);
    stale-beyond-threshold excluded with reason. Deterministic and testable.
20. **Snapshot date key uses an operator-configurable timezone** (default
    Asia/Singapore); the same tz labels chart day boundaries.

## 3. Architecture

New `server/services/wealth/` boundary (aggregator), fed by read-only leg readers:

- `legs.mjs` — leg registry + read/refresh per leg kind:
  `ccxt-spot` (balances, keys required), `hyperliquid` (equity, creds required),
  `manual` (enteredAt-aged, never LIVE: TnG eWallet, offline holdings),
  `billing` (stripe/btcpay/ewallet flows), `localstore` (financial_accounts,
  transactions, nft_holdings), `accountMetrics` (repopulated collector output:
  the collector is extended to CCXT spot balances via the existing broker
  registry; strict-parser null-honesty retained verbatim).
  Paper adapter is a reader for the SEPARATE paper section only.
  Leg record: `{ id, kind, ccy, amount, observedAt, status: LIVE|STALE|ABSENT,
  reason, fxSource, fxAt }`; transfer record: `{ id, fromLeg, toLeg, ccy,
  amount, at, note }`; snapshot record: `{ at, totalUsd, incomplete,
  legStatus[] }`.
- `fx.mjs` — USD conversion per leg via Yahoo/CCXT observed rates; records
  `fxSource`, `fxAt` or excludes the leg with `fx-unobservable:<ccy>`.
- `transfers.mjs` — explicit inter-venue transfer log; source-leg deduction so a
  move is one pool relocating, not two pools.
- `snapshots.mjs` — periodic totals with `incomplete` flag + leg-status vector
  (history chart input; never backfilled, never revised).
- `services/jobs/wealth-refresh.mjs` — tiered refresh (keyed legs on existing
  equity/market cadence; manual legs untouched).
- Route: `GET /api/wealth/overview` (additive-only, requireAuth like neighbors).
- UI: wealth room — total + `incomplete` banner, per-leg badges, paper section,
  transfer log, snapshots chart. Existing tokens/components only.
- Bundled: `portfolioAnalytics` zero-on-empty → null + named reason
  (mean/corr/sharpe/sortino on insufficient data); callers audited for null
  tolerance, STOP rule on redesign-scoped callers (Wave 0 T3 precedent).

## 4. Honesty rules (load-bearing)

- Absent leg → excluded with reason; total carries `incomplete:true` unless every
  in-scope leg is LIVE.
- Paper equity NEVER summed into the real total (structural: separate response
  block, no shared accumulator).
- FX-missing leg excluded with reason; no stale-rate conversion, no total-nulling.
- Manual legs never LIVE (enteredAt + age badge only).
- Transfers explicit or nonexistent (no heuristic matching — rejected).
- Snapshots append-only (no revision, no backfill).

## 5. Non-goals

- Trading signals or allocation recommendations derived from wealth state.
- Tax advice (W3-03 covers report-only export separately).
- Debt/liability tracking (a later decision; schema must not preclude it).
- Live-order execution from this surface (approval-gated ceiling holds).

## 6. Testing

Hermetic per-file suites (dynamic imports, `PICC_WEALTH_DATA_DIR` redirect,
`vi.resetModules`); register the new var in the isolation contract + runbook
inventory (Wave 1 precedent: a96f831/93fbb5c); tripwire-safe (no pinned-shape
edits without T8-protocol accounting); full suite + typecheck green before merge.
