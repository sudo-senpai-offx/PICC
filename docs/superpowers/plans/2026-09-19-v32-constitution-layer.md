# Implementation Plan — v3.2 Constitution Layer

Spec: `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` (§1, §2, REQ-CON-1..5, T1/T2/T11/T12)
Date: 2026-09-19 · Workspace: `C:\Users\sharv\Downloads\freelance\PICC` · Branch: `master`

This is **plan 1 of 3** for the v3.2 rebuild. It delivers the Constitution subsystem
alone — the layer that must exist before Context/Regime (plan 2) and the Execution
5-point + Copilot (plan 3) can be grounded. Each plan is independently testable.

---

## 1. Goals / Non-goals

### Goals
1. Fixed **aggregate global sample clock** — one persisted count of decisions, keyed by
   UTC day, shared by every real-money decision gate (forex/EO + crypto + future legs).
2. **Constitution gates** (REQ-CON-2): real-money proposals blocked below
   300 deployable / 500 forward samples; confidence = `{ sampleSize, costAdjustedExpectancy }`
   only — expiry-specific, derived from the shared ledger.
3. **Cost-adjusted EV gate** (REQ-CON-3): `payout + 1.5-pip spread + slippage + margin`,
   EV-RR threshold re-derived from the shared ledger (no hardcoded default survives).
4. **Confidence shape** (REQ-CON-4): sampled (observed) and empirical expectancy
   merge into a single serializable `confidence` object on every TRADE decision.
5. **Engine tag + flip-gate comparator** (REQ-STG, ADR-0004): every ledger entry carries
   `engine: "legacy" | "v3.2"`; correctly-answered counts (hit / miss, push excluded)
   per engine per expiry, feeding the flip gate — as data plumbing only. The toggle
   itself stays OFF in this plan (no behavior change to legacies).
6. **Honesty pins** (REQ-CON-5): every new constant/gate reports its derivation source;
   nothing is silently hardcoded.

### Non-goals (this plan)
- 15s fast pipeline slice / HUD (T3) — plan 2.
- Futures-proxy leg, Δ/CVD/rel-vol pillars, VWAP/EMA nature (T4–T8) — plan 3.
- Dead-zone/red-folder session classes (T9), cost line UI + trip-wire 5/8 (T10) — plan 3.
- Any routing change: `computeNow → decideAssets → assessCall` still runs the legacy
  path end-to-end. The Constitution gates are **wired as a new VETO input** that is
  OFF unless configured (feature-flag default off) — zero behavior drift unless opt-in.

---

## 2. File structure

| File | Action |
|---|---|
| `apps/dashboard/server/services/constitution.mjs` | **New** — aggregate clock, counters, gates, confidence, flip-gate comparator (pure + one persisted JSON store) |
| `apps/dashboard/server/services/accuracyLedger.mjs` | Edit — persist `engine` tag on entries; expose aggregate counters + correctly-answered table to `constitution.mjs` |
| `apps/dashboard/server/services/adaptiveConfluence.mjs` | Edit — `assessCall`/`evaluateAsset` carries `confidence` + optional `constitution` veto when enabled |
| `apps/dashboard/server/services/u4faConfig.mjs` (or sibling `v32Config.mjs`) | Edit — honest-config rule reuse; add `v32` toggle block, feature-flag default off |
| `apps/dashboard/server/__tests__/constitution.test.mjs` | **New** — unit bed for the whole layer |
| `apps/dashboard/server/__tests__/accuracyLedger.test.mjs` | Edit — engine-tag + aggregate counter tests |
| `apps/dashboard/server/__tests__/adaptiveConfluence.test.mjs` | Edit — confidence shape + veto wiring tests |

The accuracy ledger is **in-memory** (module `entries` array, no file store — verified
2026-09-19: `accuracyLedger.mjs` has no load/save; `data/trading-ledger.json` is the
separate demo-deals store). Constitution therefore mirrors the `u4faRisk.mjs` pattern:
a module-owned UTC day-latch (`dayKeyOf`/`utcDayStartMs` imported from `u4faRisk.mjs` —
one UTC truth), with counts **derived from the ledger entries themselves** (single source
of truth, no second state to drift). An optional injectable JSON store
(`data/constitution-level.json`, same `data/` dir as the other stores) is offered for
restart durability but defaults OFF so nothing persists beyond what the ledger keeps —
honest and consistent with the ledger's own durability boundary.

---

## 3. Test commands

- Scope tests: `npm run test --workspace @picc/dashboard -- __tests__/constitution.test.mjs`
- Full floor: `npm run test --workspace @picc/dashboard` (**must stay 2341 green + new**)
- Typecheck: `npm run typecheck --workspace @picc/dashboard`

Pattern: each task starts with the failing test(s), then the implementation, then the
full floor. Commit after every task (repo style: low-noise, one intent per commit).

---

## 4. Tasks (TDD per task)

### Task 1 — Aggregate sample clock + persisted UTC counters (T1)

**Tests first** (`constitution.test.mjs`):
- `aggregateDayState({ now })` keys on UTC day; rolls counter to 0 at 00:00 GMT boundary
  (reuse `dayKeyOf` semantics; one login: same day = same counter across all asset legs).
- `recordSample({ now, result: "hit"|"miss"|"push", expiry })` increments
  `deployable`/`forward` counters per correct answer bucket and bumps `total`.
- State derivation: `deployable`/`forward` are **computed from the shared ledger's
  resolved entries** (hit/miss/push per expiry per engine), not a parallel counter —
  a test proves two fresh junctions agree on the same ledger without any `recordSample`
  call (no drift between the two views).
- Day-latch rollover test mirrors `u4faRisk.test.mjs`: same UTC key = same state,
  crossing 00:00 GMT resets the borrow counter.
- Optional store: `save()`/`load()` roundtrip works only when a path is injected; with
  none, `storeFailed: false` and no I/O is attempted (never throws).

**Implementation**: `constitution.mjs` with `dayKeyOf`, `utcDayStartMs` (import from
`u4faRisk.mjs` to keep one day-key truth); `aggregateDayState` computes per-UTC-day tallies
straight from ledger entries via an injected `ledgerEntries()` accessor (reusing the
existing `resolveResult` outcome taxonomy); `recordSample` is a thin test seam over the
same tally (not a second source of truth). Deployable/forward semantics per REQ-CON-2.

---

### Task 2 — Constitution gates + confidence shape (T2)

**Tests first**:
- `gate({ deployable, forward, confidence, sampleSize })` returns block reason strings
  (`require 300 deployable samples`, `require 500 forward samples`) until floors pass;
  then `ok: true` with the concrete numbers.
- `costAdjustedEv({ payoutPct, spreadPips, slippagePips, marginPct })` returns
  `payout + spread + slippage + margin` in consistent units; `margin` honored as a pct of
  the payout-degraded gross (formula pinned in a doc-comment, asserted numerically).
- `evGate({ winProb, payoutPct, evRRMin })` re-export — same contract as
  `adaptiveConfluence.evGate` (line 360) but threshold now comes from
  `deriveEvRRFloor(ledgerTable, { minSamples })` instead of the constant `EV_RR_MIN`.
- `deriveEvRRFloor`: from the shared ledger's correctly-answered table, returns the
  realized EV-RR at `n` samples or the current constant when under `minSamples`
  (honest: reports `derived: true|false`).
- `confidenceShape({ sampleSize, costAdjustedExpectancy })` returns exactly
  `{ sampleSize, costAdjustedExpectancy }` — nothing else; asserting no extra key.
- Wire: with the `v32` toggle OFF, `assessCall` output is byte-identical to today
  (regression: existing `adaptiveConfluence.test.mjs` + `u4faRisk.test.mjs` stay green
  unmodified). With the toggle ON + floors unmet, a `TRADE` downgrades to `NEUTRAL` and
  `gates.constitution` reports the block reason.

**Implementation**: pure functions in `constitution.mjs`; `adaptiveConfluence` edits
guarded by an enabled check that reads the toggle (default off). No legacy-visible change.

---

### Task 3 — Ledger engine tag + correctly-answered comparator (T11)

**Tests first** (`accuracyLedger.test.mjs`):
- `recordDecision` stores `engine` (default `"legacy"`; explicit `engine: "v3.2"` honored).
- `correctlyAnsweredByEngine()` returns `[{ engine, expiry, hits, misses, total }]`
  where pushes are excluded from the ratio (REQ-STG: push is not a correct answer).
- Flip comparator `flipGate({ rows, legacy, candidate, minTrades = 100 })`:
  - false when EITHER engine's paper count `< minTrades`;
  - false when candidate's cost-adjusted expectancy `<` legacy's — equality FLIPS
    (REQ-STG-3 says "≥", matching ADR-0004; the plan earlier text to the contrary was
    corrected 2026-09-19);
  - true only when both pass; `flip`, `reason`, and both expectancies serialized.

**Implementation**: `accuracyLedger.mjs` gains the `engine` field on the entry object and
an exported `correctlyAnsweredByEngine` scan (counts on ledger entries, not new state —
the ledger remains the single source of truth). `constitution.flipGate` is pure over that
table. The v3.2 engine does not exist yet, so `flipGate` is exercised with synthetic
tables in tests only.

---

### Task 4 — Honesty pins + spec traceability (T12)

**Tests first**:
- Every exported constant in `constitution.mjs` carries a `source` string (spec §/REQ tag)
  and a test asserts each one is non-empty and points at a REQ- tag that exists.
- Any derivation that falls back to a hardcoded number sets `derived: false` in its
  output — a test asserts the fallback is never silent.
- Demand pins: a `TRADE` never clears when `sampleSize < 300` (deployable) even if the
  legacy `confidence` numbers look strong (the veto is an AND, not an OR).

**Implementation**: doc-comment source tags per constant; the veto is ANDed into the same
`gates` object the composite already exposes; `confidence` on the decision is the new
shape (replacing the pre-existing `confidence` reading of `winProb`/`ev` where present —
verify against `assessCall`'s current output and pin with a regression assert).

---

## 5. Risks / mitigations

| Risk | Mitigation |
|---|---|
| Day-key divergence between autopilot (local midnight) / u4faRisk (UTC) / Constitution (UTC, shared) | Constitution imports `dayKeyOf`/`utcDayStartMs` from `u4faRisk.mjs` — one UTC truth; header comment notes the autopilot difference is intentional (Decision B accepted). |
| Store corruption or concurrent write between the two JSON stores | No second state: counts derive from ledger entries on demand (in-memory, same durability boundary). The optional JSON store is injectable-for-tests only and defaults OFF; store read/write never throws (`storeFailed` flagged honestly). |
| The existing 2341-test floor is huge and the toggle is new surface | Toggle default OFF; regression runs are just the existing suite; new veto behavior is exercised under explicit `enabled: true`. |
| EV-floor derivation changes legacy expectations | Not wired until toggle ON; `derived:false` fallback keeps the constant until the ledger table is real. |
| Confidence shape replaces legacy `confidence` reading | Regression-pinned; verified against `assessCall`'s current serialized output before merge. |

---

## 6. Definition of done

- `constitution.test.mjs` + edited `accuracyLedger`/`adaptiveConfluence` tests all green.
- Full floor green: `npm run test --workspace @picc/dashboard` (2341 + new, zero removed).
- `npm run typecheck --workspace @picc/dashboard` clean.
- Toggle is OFF in every committed config; no behavior change to legacy decisions.
- Spec cross-checks: every `REQ-CON-*` and `REQ-STG-6` item in §8 T1/T2/T11/T12 rows is
  marked with shipped test evidence in the spec file (strikethrough + `✓` + commit sha).

---

## 7. Status (2026-09-19 execution round)

**ALL FOUR TASKS SHIPPED** — floor 2378 tests (2341 baseline + 37 new), typecheck clean.

| Task | Status | Evidence |
|---|---|---|
| T1 aggregate clock | ✅ | `constitution.mjs` `aggregateDayState` — UTC day-key derived from ledger rows (no parallel counter); per-expiry hit/miss/push + engine filter seam. 7 tests. |
| T2 gates + confidence | ✅ | `gateConstitution`, `costAdjustedEv` (1.5-pip spread + slippage + margin, HUD `line`), `deriveEvRRFloor` (derived or honest `derived:false`), `confidenceShape` (strict 2-key, extra keys throw). `evaluateAsset` `constitution` veto (default-off, TRADE→NEUTRAL + reason). 18 tests. |
| T3 ledger tag + flip gate | ✅ | `accuracyLedger.recordDecision` stores `engine` (default `legacy`); `correctlyAnsweredByEngine` (push excluded); `constitution.flipGate` (≥minTrades each + candidate ≥ legacy). 8 tests. |
| T4 honesty pins | ✅ | every exported constant has a REQ source tag (`constitutionSourceOf` asserts non-empty); fallback derivations declare `derived:false`; AND-veto proven to downgrade a real TRADE. 4 tests. |

Commits: none made yet — the repo also holds the prior uncommitted spec/ADR resolution
work; commit strategy pending user direction.

Not yet wired (deliberately): nothing imports `aggregateDayState`/the veto into the live
`computeNow` path — the toggle stays OFF. Wiring is plan 2 (Context/Regime) / plan 3
(Execution + Copilot) scope.