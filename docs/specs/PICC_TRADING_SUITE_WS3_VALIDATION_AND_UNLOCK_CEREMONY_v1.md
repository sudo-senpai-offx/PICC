# PICC Trading Suite — WS-3 · Validation & Unlock Ceremony — spec v1

# Status: LANDED (implementation complete; serial floor green; awaiting owner ship decision)

**Date:** 2026-09-23 · **Workstream:** WS-3 of `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` (APPROVED) · **Kind:** implementation-ready plan · **Approved by:** pending owner, subagent-driven implementation.

**Binding canon (all read and verified in this session, file:line grounded):**
- Master design: `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` — WS-3 scope block `:58-62`, locked decision 7 (four gates) `:33`, decision 8 (hybrid soak: sims never spendable) `:34`, decision 11 (venue earns live, ADR-driven) `:37`, current limitation 4 (v3.2 lane zero resolved; going live now = sub-statistical) `:81`.
- WS-2 spec (format precedent + landed substrate): `docs/specs/PICC_TRADING_SUITE_WS2_RISK_AND_DRAWDOWN_ENFORCEMENT_v1.md` — landed T1–T8 (riskState/riskGates/riskHaltStore patterns WS-3 mirrors), resolution `:280-286`.
- WS-1 spec: `docs/specs/PICC_TRADING_SUITE_WS1_LIVE_ORDER_LIFECYCLE_v1.md` — R1.5 `testnetOnly: true` flips at WS-3 `:29`, riskModel shape `:140`, R6.2 mainnet refused without ceremony `:72`, risk 3 (mainnet-leak handoff note) `:311`, sandbox E2E honest skip `:292-296`.
- Scope compendium: `.superpowers/sdd/PICC_TRADING_SUITE_WS345_PIPELINE/plan.md` (WS-3 block `:9-25`).
- Seams (read): `services/constitution.mjs`, `services/accuracyLedger.mjs`, `services/v32Register.mjs`, `services/v32Section.mjs`, `services/v32Config.mjs`, `services/commandCentre/riskState.mjs`, `services/commandCentre/riskGates.mjs`, `services/commandCentre/riskHaltStore.mjs`, `services/venues/hyperliquidPerps.mjs`, `services/commandCentre/policyGraphCatalog.mjs`, `services/commandCentre/commandCentreOverview.mjs`, `server/handlers.mjs`, `server/index.mjs`, `docs/specs/PICC_TRADING_SITES_CATALOG_v1.md`, `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md:408-410`, `src/components/CommandCentrePanel.tsx`, `src/pages/ministry/CommandCentreRoom.tsx`.

---

## 0. Current state (all verified this session)

1. **The 300/500 constitution clock is global and dormantly wired.** `REQ_CON_2_DEPLOYABLE_FLOOR = 300` / `REQ_CON_3_FORWARD_FLOOR = 500` (`constitution.mjs:17-18`); `gateConstitution` (`:90-104`) AND-composes both floors globally. `gateConstitution` and `aggregateDayState` (`:48-79`) are consumed ONLY by `constitution.test.mjs` — no production caller (grep-verified). Counts are "DERIVED from the shared accuracy-ledger entries on demand — deliberately no second counter" (`:6-8`).
2. **The ledger is in-memory; restart wipes it.** `accuracyLedger.mjs` is a module-level `entries = []` (`:25`), capped `LEDGER_CAP 1000` (`:19`, oldest dropped `:68`), cleared only by `resetLedger` (`:456-459`, tests/admin), started at `index.mjs:201` (`startLedger`, loop `:435-441`). No persistence anywhere — "flushed elsewhere" means exactly this: resolved history dies on restart and overflows at 1000. The ceremony therefore CANNOT re-derive counts from the ledger at read time; it needs its own restart-persistent store that observes resolutions as they happen.
3. **Rows carry `engine` but no venue-class and no sim/real provenance.** Entry shape `accuracyLedger.mjs:33-57` has `engine` (`:51`, `"legacy"` default) only. Callers: `adaptiveConfluence.mjs` `logTradeVerdicts` — v3.2 rows at `:886`, legacy rows at `:914`. `correctlyAnsweredByEngine` (`accuracyLedger.mjs:163-181`) excludes pushes; `ledgerStats` counts decided = hit+miss+push (`:191`). The plan.md claim "ledger does not distinguish sim/real" is confirmed — nothing does.
4. **Gate 2 machinery exists but reads the in-memory table.** `flipGate` (`constitution.mjs:243-261`, `minTrades = 100` default) is pure over rows; `v32Status` (`adaptiveConfluence.mjs:996-1029`) calls `flipGate({ rows: led })` at `:1014` where `led = correctlyAnsweredByEngine()` — in-memory, restart-fragile. Its docstring: "the ~2–4-week soak elapse is an external time condition (checked by the operator), not a numeric gate here" (`constitution.mjs:240-241`) — the manual check WS-3 removes.
5. **Gate 3 (50-streak ratio) and Gate 4 (trading-day window) have zero code.** Only time anchor: `v32Config.enabledAt` (`v32Config.mjs:24`, stamped by `stampV32Config` `:133-143`). `REQ-STG-3` (`docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md:115`) names "≥100 paper trades on each AND ~2–4 week soak elapsed" — the elapse is the machine gate to build.
6. **Unified-switch seams are scattered operator-flips today.** (a) `v32Config.enabled: false` default with a comment saying flipping to true is "a one-line operator change" (`v32Config.mjs:5-7`); no API route writes v32-config (grep-verified — only GET `/api/trading/engine/v32`, `handlers.mjs:1324-1340`). (b) Perps mainnet refusal: `hyperliquidPerps.mjs:56-57` `RAIL_OFF_TESTNET_ONLY` — "…insufficient until the WS-3 ceremony" — EXACT TEXT pinned by tests (`:28`); `modeOf` (`:87-94`) refuses mainnet whenever sandbox is off. (c) `policyGraphCatalog.mjs` templates: `automationPermission` sanctioned/forbidden (`:68,:89,:116`), `demoOnly` (`:69,:90,:117`), perps `mode:"copilot"` (`:122`). (d) The data catalog (`PICC_TRADING_SITES_CATALOG_v1.md` §2 schema `:14-28`) has NO enablement field.
7. **Persistent-store patterns to mirror exist.** `riskState.mjs` (boot health `:26-45`, persist `:47-51`, `PICC_COMMAND_CENTRE_DATA_DIR||../data` `:7-9`, unreadable → UNHEALTHY), `riskHaltStore.mjs` (self-wiring seam at module init `:126-140`, fail-safe `trippedDefault` `:59-62`), `riskGates.mjs` (`RISK_GATE_ORDER` `:15-20`, `envNumber` invalid → named `invalid-environment` deny `:35-41`). Readout precedent: `handlers.mjs:1512-1594` overview route with `riskFeed` `:1588`, `observeRiskFeed` `:1655-1659`, composed at `commandCentreOverview.mjs:71-92`; UI honesty pattern `AggregateRiskStrip` (`CommandCentrePanel.tsx:382-406` — n/a cells + unobservable note, never a silent pass).

## 1. Requirements (each testable; master-spec section cited)

### R1 — Persistent per-venue-class ceremony store (decisions 7, 8; `SEAL :58-59`) — T1
- R1.1 A restart-persistent store mirrors `riskState.mjs`: boot health, `version:1`, unreadable/corrupt → UNHEALTHY, mutations refuse, **never unlocks**. Store file `ceremony-state.json` beside `ccxt-risk-aggregate.json` (`PICC_COMMAND_CENTRE_DATA_DIR` default `services/data/`).
- R1.2 Per venue-class state: `spendableResolved` (gate-1 counter = decided rows: hit|miss|push per `constitution.mjs:39-40`), `byEngine` per-expiry hit/miss buckets (the persistent mirror of `correctlyAnsweredByEngine`), trailing-50 hit/miss ring (gate-3), distinct-UTC-day set (gate-4), `windowOpenedAt`, `lastCreditAt`.
- R1.3 `enablement[venueClass] = null | { unlocked: true, at, by }` — default null (locked) for every class; only the ceremony transaction writes it (never `saveV32Config`, never env alone).
- R1.4 An explicit `assetClasses` map (default EMPTY) classifies assets → venue class at credit time. Empty map = every row untagged → honest deny (no backfill, no heuristic inference — D3).
- R1.5 Every credit records `ledgerSeq` so the store is provably a projection of ledger rows, not a second truth (`constitution.mjs:6-8` doctrine); a reconciliation read compares store vs live ledger.

### R2 — Provenance + class seam on ledger rows (decision 8; `SEAL :34`) — T2
- R2.1 `recordDecision` entries gain optional `venueClass` (default `null`) and `provenance` (default `"real"`); `"sim"` must be opted into at the source (`d.provenance === "sim"`). Existing callers stay byte-identical (additive fields).
- R2.2 The ceremony credits ONLY rows that are `provenance === "real"` AND have a class in the `assetClasses` map. A sim row is a named deny (`ceremony:deny:sim-row`), an untagged row `ceremony:deny:untagged-class`. Deterministic sims exist for debugging/regression only (R2.3) and are never spendable — proven by fixture, not assertion.
- R2.3 No sim engine is built in WS-3; the seam + exclusion fixtures deliver decision 8's machine half. (There is no ledger-writing sim path today — grep-verified; `paperAdapter.mjs` simulates trades but never calls `recordDecision`.)

### R3 — Credit wiring survives restart (decision 8; §0.2) — T1, T3
- R3.1 `flushLedger` calls a registered resolve consumer (`registerResolveConsumer`, default no-op — existing behavior byte-identical); `ceremonyState` self-wires at module init (mirror `riskHaltStore.mjs:126-140`); `index.mjs` imports the module at boot so the wiring is live in production.
- R3.2 A server restart re-hydrates every counter from `ceremony-state.json`; counts never reset (unlike the in-memory ledger).

### R4 — Gate 1: 300 resolved per venue-class (decision 7; `SEAL :33`) — T4
- R4.1 `ceremonyGate1(venueClass)` passes when `spendableResolved ≥ PICC_CEREMONY_GATE1_MIN_RESOLVES` (default 300 = `REQ_CON_2_DEPLOYABLE_FLOOR`, reused per class, never globally).
- R4.2 Named deny on shortfall: `ceremony:deny:gate1-short (have N, require 300)`. The global `gateConstitution`/500-forward path stays untouched (Non-goals).

### R5 — Gate 2: 100-resolve flip-gate reads the spendable store (decision 7; `flipGate` `constitution.mjs:243-261`) — T4
- R5.1 `ceremonyGate2(venueClass)` rebuilds flipGate-shaped rows from the store's `byEngine` buckets (spendable, per class) and calls the existing pure `constitution.flipGate` — the flip gate's inputs now come from the ceremony store, not the in-memory `correctlyAnsweredByEngine()`.
- R5.2 The unified switch = the flip-gate AND the store's `enablement` read from the SAME store (R1.3); `adaptiveConfluence.v32Status` keeps its shadow surface untouched (its numbers stay live for the soak dashboard; the ceremony readout is the authority).

### R6 — Gate 3: 50-resolve streak floor with observed/expected ratio ∈ [0.7, 1.3] (decision 7; zero code today) — T4, T5
- R6.1 Ratio definition (D5): over the trailing **50 most recent credited hit/miss rows** per class (pushes skipped — a push is not a correct/incorrect answer, matching `correctlyAnsweredByEngine`): `observed = hits/50`, `expected = mean(winProb)` over the same 50, `ratio = observed/expected`. Pass iff `ratio ∈ [0.7, 1.3]`.
- R6.2 Named denies: `ceremony:deny:streak-short` (<50 rows), `ceremony:deny:streak-winprob-missing` (any null winProb), `ceremony:deny:streak-out-of-band (ratio r, band [lo,hi])`.

### R7 — Gate 4: ~30-trading-day calendar window, machine-enforced (decision 7; `REQ-STG-3` `V3_2...:115`) — T5, T4
- R7.1 `tradingDaysElapsed(venueClass)` = count of distinct UTC dayKeys (`u4faRisk.dayKeyOf`) on which the class received ≥1 spendable credit, from `windowOpenedAt` (first credit). A dead feed stalls the window — honest (no credits = no days).
- R7.2 Pass iff `tradingDaysElapsed ≥ PICC_CEREMONY_GATE4_TRADING_DAYS` (default 30); deny `ceremony:deny:days-short (have N trading days, require 30)`.
- R7.3 This replaces the operator check note at `constitution.mjs:240-241` (docstring edit only, R10).

### R8 — Unified paper→demo→live switch through one locus (decision 7; `SEAL :61`) — T3, T6
- R8.1 The ONE locus is `ceremonyState.enablement`. The perps adapter's `modeOf` (`hyperliquidPerps.mjs:87-94`) gains an additive mainnet branch: proceed only when the env REQUEST (`PICC_CCXT_PERPS_MAINNET_ENABLED=1`) AND the store PERMISSION (`enablement["hyperliquid-perps"].unlocked === true`) agree; sandbox still wins; UNHEALTHY store never reads as unlocked.
- R8.2 **No venue goes live in WS-3** (Non-goals): with every gate deniable on zero/honest data and `enablement` default-null, the mainnet branch is unreachable in production — verified by a test, not by luck.
- R8.3 `v32Config.enabled` toggle and `policyGraphCatalog` static permissions are NOT modified; the ceremony readout is the machine truth an operator flip now cites (D6).

### R9 — Honest readout: named deny, never silent pass (ADR-0005) — T3, T7
- R9.1 `GET /api/command-centre/ceremony` (auth, `writeJson` mirror of `handlers.mjs:1512-1594`) returns per class: `spendableResolved`, **`scaleResolved` tier (500+, readout only)**, each gate `{ id, pass, reason }`, `enablement`, `platformVerification`, `lastCreditAt`, `ledgerRunning` (from `ledgerEngineStats`, `accuracyLedger.mjs:451-453` — dead resolve loop = `ceremony:deny:ledger-stale` surface).
- R9.3 The readout surfaces the master-blueprint deploy(300+)/scale(500+) distinction (`MASTER BLUEPRINT v3.3 Part 0.4/8`): gate-1 is the deployable floor; a `scaleResolved ≥ PICC_CEREMONY_SCALE_MIN_RESOLVES` marker appears once reached. Readout only — unlock still requires only gate-1 (D7).
- R9.2 A minimal `UnlockCeremony` UI element renders gate state mirroring `AggregateRiskStrip` (`CommandCentrePanel.tsx:382-406`): pass/block + named reason + spendable count; absent data renders "not-wired", never a pass.

### R11 — Platform-verification gate for binary-options-class venues (master blueprint v3.3 Part A) — T1, T4
- R11.1 Every binary-options-class venue class carries a `platformVerification` record (default `null` = NOT verified). Only a deliberate ceremony-store write sets `{ verified: true, at, by, regulator, payoutFloorPct, withdrawalTested }`; no code infers it.
- R11.2 For a binary-options-class class, `evaluateCeremony` blocks unlock while `platformVerification === null` or any required field is missing: `ceremony:deny:platform-unverified`. Non-binary classes are unaffected.
- R11.3 `payoutFloorPct` must be ≥ 85 when present (Part A rule 25); below → `ceremony:deny:payout-below-floor`. Readout surfaces the record so the cause is visible.
- R11.4 This is the machine half of the blueprint's platform-verification gate (regulator on public register, withdrawal cycle test, payout floor, OTC-adversarial flag). The record holds the evidence INDEX + outcome; the operator performs the external checks (they are not automatable in code) — the ceremony deny is machine, the evidence entry is human, ADR-0005.

### R10 — Constitution elapse code-enforced (decision 7; `SEAL :62`; `constitution.mjs:240-241`) — T4
- R10.1 The "soak elapse … checked by the operator" docstring is removed and reworded to "elapse enforced by the WS-3 ceremony (gate 4)". Comment-only — `constitution.test.mjs` stays green; no behavior change to `flipGate` or `gateConstitution`.

## 2. Design decisions (the hard questions; RATIFY = planner recommendation needing owner lock)

**Locked master decisions re-affirmed (not renegotiable):** decision 1 (one workstream at a time, WS-3 after WS-2) `SEAL :27`; decision 7 (four machine-enforced gates, 300/100/50/30) `:33`; decision 8 (sims for debugging only, real-feed resolves spendable) `:34`; decision 11 (venue earns live via ADR-driven process, HL first) `:37`.

**Blueprint doctrine cross-checked (master blueprint v3.3 + v3.4 addendum, owner-supplied 2026-09-23):** Part 0.4 sample-size table (300+ = "genuinely usable", 100–300 = "metrics stabilise / variant comparisons mean something", 30–100 = "first impression") — consistent with gates 1/2/3; Part 8 final verdict (300+ deployable, 500+ scaling) → D7 two-tier readout; Part A platform-verification gate (regulation register, withdrawal test, payout floor) for the binary-options class → D8 record; Part 5.2/6.4 sample-size discipline → readout only, no new unlock gates. No blueprint rule revises the 300/100/50/30-days structure; hybrid soak + human v32 toggle lockdown are re-affirmed intact.

**D1 — Persistence location (RATIFY).** New `services/commandCentre/ceremonyState.mjs` + `ceremony-state.json` in the same `PICC_COMMAND_CENTRE_DATA_DIR` as `riskState.mjs` (`:7-9`). Rationale: the ceremony is command-centre operational truth like the halt/aggregate stores; one data dir keeps boot conventions and `canTouchDisk`/VITEST semantics shared. Rejected: extending `accuracyLedger.mjs` with persistence (the ledger is engine-owned, capped, reset by tests — bolting ceremony durability into it entangles two lifetimes); re-deriving at read time (impossible — in-memory source, §0.2).

**D2 — Provenance seam (RATIFY).** `provenance` + `venueClass` are explicit row fields on `recordDecision`, `"real"`/`null` defaults; sims opt in. Rationale: the ledger is the only place both live rows and (future) sim rows meet; classifying at the source is cheaper and greppable than inferring at credit time. Rejected: inferring provenance from the caller module (import graphs rewire silently); defaulting untagged rows to a class (fabrication, violates ADR-0005).

**D3 — No backfill, explicit classification map (RATIFY).** The `assetClasses` map (asset → venue class) ships empty; the operator/venue-wiring populates it deliberately as per-class feeds land. Every pre-map row is honest-deny `ceremony:deny:untagged-class`. Rationale: existing rows (a) are untagged and (b) would be wiped by the in-memory ledger anyway — backfilling would fabricate class attribution from symbol heuristics. The count starts from WS-3 onward.

**D4 — Catalog field vs code enablement (RATIFY).** Keep the catalog schema (`PICC_TRADING_SITES_CATALOG_v1.md` §2) WITHOUT an enablement field; enablement is operational state in the ceremony store. Rationale: the catalog is a data-facts descriptor (verified/auth/rateLimit — `:14-28`); unlock state must be machine-readable, restart-persistent and audit-trailed — a prose field cannot be enforced and would rot. The catalog gains only a resolution-style note pointing at the ceremony store (mirror its own `:117-129` resolution idiom).

**D5 — Gate-3 ratio definition (RATIFY).** observed = realized hit rate over the trailing 50 decided hit/miss rows; expected = the engine's own mean `winProb` over the same rows; ratio = observed/expected ∈ [0.7, 1.3]. Pushes excluded from both (consistent with the flip-gate's push exclusion, `accuracyLedger.mjs:158-162`). Rejected: comparing raw hit/miss counts (has no expectation baseline); including pushes (dilutes calibration vs the engine's predicted edge).

**D6 — Engine-toggle execution stays human in WS-3 (RATIFY).** The ceremony build-out is the machine state machine + readout + venue permission branch (§R8); the actual v32 flip execution and the perps venue flip are later ceremony ACTIONS on this machinery. `v32Config.mjs` is not modified. Rationale: there is no code path that writes v32-config today (§0.6) — the operator-file-edit precedent is replaced procedurally: the flip now must cite the machine gate state.

**D7 — Deploy/scale two-tier readout, single unlock floor (RATIFY).** Gate-1 (300) is the unlock floor; 500 is surfaced as a scale-tier marker in the readout only (master blueprint: 300+ deployable, 500+ scaling), never a second unlock gate. Rationale: the blueprint's own table treats 100–300 as "metrics begin to stabilise" and 300+ as "genuinely usable" — 300 stays the ceremony's unlock bar; 500 gives operators a forward marker without renegotiating decision-7's numbers.

**D8 — Platform-verification record, binary-options class (RATIFY; master blueprint Part A).** A `platformVerification` record per binary-options-class venue class, default `null`, is a precondition for `evaluateCeremony` unlock of that class; the external evidence checks stay human (automatable only in their deny-half). Rationale: the blueprint's platform gate ("If the platform fails the gate, the execution engine never activates") is mandatory for the binary-options class PICC carries (`expertoption`); the record keeps the machine deny + human evidence honest and separated.

**Non-goals (explicitly out of WS-3):** shipping any venue live or unlocking any class; changing `v32Config.enabled` / `stampV32Config`; changing `gateConstitution` or the 500-forward path; deleting the autopilot/envelope loss paths (WS-2 authority shift already in place); touching fail-closed risk gates 16–19, sidecar gates 1–10, perps gates 11–15; any sim engine; backfilling the ledger; adding an enablement field to the catalog schema; the resolve-feed cross-class check (flagged in Risks — known first-slice caveat, not a silent pass: class = decision feed origin under REQ-CON-1 one-clock semantics); renegotiating 300/100/50/30; adding `platformVerification` to the catalog schema or inferring it from any code. The deploy/scale tier (D7) and platform record (D8) are ADDITIVE to the readout/store, not new unlock gates.

## 3. Module designs

### 3.1 File map

**CREATE**

| # | File | Role | Depends on |
|---|---|---|---|
| F1 | `services/commandCentre/ceremonyState.mjs` | Persistent store: per-class counters/aggregates/streak/days/enablement/assetClasses; boot health; self-wires the resolve consumer (mirror `riskHaltStore.mjs:126-140`) | `u4faRisk.dayKeyOf`, ledger seam (R3.1) |
| F2 | `services/commandCentre/ceremonyGates.mjs` | Pure gate evaluators gate1–gate4 + `evaluateCeremony(venueClass)` AND-composed with stable `ceremony:deny:*` reasons; env-number validation mirroring `riskGates.mjs:35-41` | F1, F3, `constitution.flipGate` |
| F3 | `services/commandCentre/tradingCalendar.mjs` | Pure trading-day primitive: distinct-day counting, per-class calendar (crypto 24/7 default; weekend/holiday exclusion map override, empty default) | `u4faRisk.dayKeyOf` |
| F4 | `src/components/UnlockCeremony.tsx` | Minimal gate readout panel (AggregateRiskStrip pattern) | API from F5 |
| F5 | test guard `__tests__/ws3CeremonySeamGuard.test.mjs` | Source-level guard: credit filters real+classed; mainnet branch unreachable without store unlock; MS-3 floor | all |

**MODIFY**

| # | File | Change |
|---|---|---|
| M1 | `services/accuracyLedger.mjs` | Additive: `venueClass`/`provenance` row fields (`recordDecision` `:33-57`), `registerResolveConsumer` + `flushLedger` invocation (`:127-151`). Existing exports/behavior byte-identical. |
| M2 | `server/handlers.mjs` | Add `/api/command-centre/ceremony` GET route (auth + writeJson, mirror `:1512-1594`). Nothing else. |
| M3 | `server/index.mjs` | Boot import of `ceremonyState` (wires credit path in prod, beside `startLedger` `:201`). |
| M4 | `services/venues/hyperliquidPerps.mjs` | `modeOf` (`:87-94`): additive mainnet branch reading `enablement["hyperliquid-perps"]`; existing refusal strings byte-identical. |
| M5 | `services/constitution.mjs` | Comment-only: `flipGate` docstring `:240-241` elapse note → ceremony gate-4. |
| M6 | `src/pages/ministry/CommandCentreRoom.tsx` | Mount `UnlockCeremony`. |
| M7 | `apps/dashboard/.env.example` | Document the WS-3 ceremony vars (T8). |
| M8 | `PICC.md` | §10 registry row + §23 methodology note (T8). |

### 3.2 Ceremony store shape (`ceremony-state.json`, F1)

```jsonc
{ "version": 1,
  "classes": {
    "ccxt-crypto": {
      "windowOpenedAt": "…", "lastCreditAt": "…", "spendableResolved": 0,
      "byEngine": { "legacy": { "60": { "hits": 0, "misses": 0, "total": 0 } } }, // persist correctlyAnsweredByEngine mirror (gate-2)
      "streak": [ { "ledgerSeq": 1, "ts": 0, "dayKey": "2026-09-23", "result": "hit", "winProb": 0.62 } ], // trailing-50 hit/miss (gate-3)
      "tradingDays": ["2026-09-23"] }                                          // distinct dayKeys of spendable credits (gate-4)
  },
  "enablement": { "ccxt-crypto": null, "hyperliquid-perps": null, "expertoption": null }, // {unlocked:true,at,by}|null (R1.3)
  "platformVerification": { "expertoption": null }, // {verified:true,at,by,regulator,payoutFloorPct,withdrawalTested}|null (R11, D8)
  "assetClasses": {} }                                                            // explicit asset→class map, empty default (D3)
```

Boot: unreadable / version ≠ 1 → UNHEALTHY (`riskState.mjs:26-45` mirror), mutations refuse, `enablement` reads locked, file preserved. Credit path: `creditResolved(rows)` filters `provenance==="real"` + `assetClasses[asset]` present; hit/miss/push all bump `spendableResolved`+`tradingDays`; hit/miss bump `byEngine` + push the streak ring (cap 50); `legacy` vs `v3.2` from the row's `engine` (`accuracyLedger.mjs:51`). `platformVerification` and `enablement` are written by the ceremony ACTIONS only (explicit store pages), never by the credit path.

### 3.3 Gate family (F2) — per venue class, in order, first deny stops with one reason

**gate1 constitution-300** — `spendableResolved ≥ PICC_CEREMONY_GATE1_MIN_RESOLVES` else `ceremony:deny:gate1-short (have N, require 300)`.
**gate2 flip-gate-100** — rebuild rows from `byEngine` buckets → `constitution.flipGate(...)`; block echoes its stable reason (`constitution.mjs:249-261`), prefixed `ceremony:deny:flip-unmet`.
**gate3 streak-50-ratio** — trailing-50 ring (R6.1); short / winProb-missing / out-of-band named denies.
**gate4 trading-days-30** — `tradingCalendar.tradingDaysElapsed(class) ≥ 30` (R7.2).
`evaluateCeremony(venueClass)` returns `{ gates: [{id, pass, reason}], spendableResolved, enablement, ok }`; store UNHEALTHY → every gate `ceremony:deny:store-unhealthy` (never a pass).

> **Note (implementation, 2026-09-23):** for binary-options classes the platform gate (`gate-platform-verification-85`, D8/R11) is ADDITIVE and is evaluated between gate-1 and gate-2 — `[gate1, gate-platform, gate2, gate3, gate4]` in order, pinned by the seam guard (WS-3 `ws3CeremonySeamGuard.test.mjs` `(d)`). On ledger (resolve-loop) staleness the route observes `ledgerEngineStats().running === false` and the readout emits a synthesized `gate-ledger-health` gate with reason `ceremony:deny:ledger-stale`, pass=false (R9.1) — a dead loop is never a silent all-pass.

### 3.4 Env vars (F2, read at call time; invalid numeric → named `invalid-environment: <VAR>=<raw>` deny, mirror `riskGates.mjs:35-41`)

| Var | Default | Meaning |
|---|---|---|
| `PICC_CEREMONY_GATE1_MIN_RESOLVES` | `300` | gate-1 per-class resolved floor (R4) |
| `PICC_CEREMONY_SCALE_MIN_RESOLVES` | `500` | scale-tier readout marker (R9.3, D7; readout only, not a gate) |
| `PICC_CEREMONY_GATE3_STREAK` | `50` | gate-3 trailing streak length (R6) |
| `PICC_CEREMONY_GATE3_RATIO_LO` / `PICC_CEREMONY_GATE3_RATIO_HI` | `0.7` / `1.3` | calibration band (R6.1) |
| `PICC_CEREMONY_GATE4_TRADING_DAYS` | `30` | gate-4 trading-day window (R7) |

## 4. Acceptance (observable, each mapped to a task's tests)

| AC | Observable behavior | Verification |
|---|---|---|
| AC-1 | Store persists per-class counters across a module re-boot; UNHEALTHY boot refuses mutations and never unlocks; credits are real+classed only; `ledgerSeq` reconciliation matches the live ledger; binary-options-class classes default `platformVerification: null` | `ceremonyState.test.mjs` |
| AC-2 | `recordDecision` stores `venueClass`/`provenance` (null/"real" defaults); an explicit sim row is distinguishable and never credited; no consumer registered → flushLedger byte-identical; existing ledger tests green | `accuracyLedger.ceremonySeam.test.mjs` + existing `accuracyLedger.test.mjs` |
| AC-3 | gate1 per class (decided incl. push); gate2 over store buckets; gate3 trailing-50 ratio with all three named denies; gate4 over trading days; AND-composed `evaluateCeremony`; env invalid → named deny; binary-options-class blocked on missing `platformVerification` (`ceremony:deny:platform-unverified`) and payout < 85 (`ceremony:deny:payout-below-floor`) | `ceremonyGates.test.mjs`, `tradingCalendar.test.mjs` |
| AC-4 | Crypto class counts every UTC day; a class with a weekend exclusion map skips them; a zero-credit day is never counted; one UTC boundary via `dayKeyOf` | `tradingCalendar.test.mjs` |
| AC-5 | `GET /api/command-centre/ceremony` (auth) returns per-class gate state + spendable count + `scaleResolved` marker + enablement + `platformVerification` + `ledgerRunning`; overview route byte-identical | `ceremonyRoute.test.mjs` |
| AC-6 | `PICC_CCXT_PERPS_MAINNET_ENABLED=1` alone refuses with the EXACT existing strings (`hyperliquidPerps.mjs:56-57`); a test-only store unlock + mainnet flag proceeds; sandbox still wins; UNHEALTHY store never unlocks | `ceremonyVenueUnlock.test.mjs` |
| AC-7 | UI renders per-class gate pass/block + named reason + spendable count; absent data renders "not-wired"; mounted in the Command Centre room | `UnlockCeremony.test.tsx` |
| AC-8 | Serial floor + typecheck + `verifyAudit()` green; guard asserts credit filtering + mainnet unreachability; `constitution.mjs` no longer says "checked by the operator"; PICC.md registry row added | T8 commands |

## 5. Checklist tasks (ordered; every task ends with Tests: + Command:)

**T1 — Ceremony store (`F1`).** Acceptance per R1/R3.2/R11/AC-1: boot health + version; credit path (real+classed, decided incl. push; hit/miss to `byEngine` + streak ring capped 50; dayKeys); `enablement` default null and only ceremony-written; `platformVerification` default null, write-gated, never credit-path-touched; `assetClasses` map validated (known asset ids only — unknown key = named reject); re-boot survival; `resetCeremonyState` test seam; self-wire of the resolve consumer (R3.1). Tests: `server/__tests__/ceremonyState.test.mjs` (≥14). Command: `npx vitest run __tests__/ceremonyState.test.mjs`.

**T5 — Trading-day primitive (`F3`).** Acceptance per R7/AC-4: distinct-day counting from credited dayKeys; crypto default = every UTC day; exclusion-map class skips weekends/holidays; zero-credit day never counted; same-day duplicates count once. Tests: `server/__tests__/tradingCalendar.test.mjs` (≥6). Command: `npx vitest run __tests__/tradingCalendar.test.mjs`.

**T2 — Ledger provenance seam (`M1`).** Acceptance per R2/AC-2: additive `venueClass`/`provenance` fields on `recordDecision`; `registerResolveConsumer` (default no-op) invoked per resolved row in `flushLedger`; existing `accuracyLedger.test.mjs` green untouched. Tests: `server/__tests__/accuracyLedger.ceremonySeam.test.mjs` (≥7). Command: `npx vitest run __tests__/accuracyLedger.ceremonySeam.test.mjs`.

**T4 — Gate evaluators + constitution elapse note (`F2`, `M5`).** Acceptance per R4/R5/R6/R7/R10/R11/AC-3: gate1 per-class 300 (decided); gate2 rebuilds flipGate rows from store buckets (candidate+legacy ≥ 100 per class enforced by `flipGate` itself) with `ceremony:deny:flip-unmet` reasons; gate3 ring ratio with the three named denies; gate4 ≥ 30 trading days; `evaluateCeremony` AND-composed; binary-options-class blocked without verified `platformVerification` and with payout < 85; env-number invalid → named deny; `constitution.mjs` `:240-241` docstring reworded (comment-only). Tests: `server/__tests__/ceremonyGates.test.mjs` (≥15; gate-3/gate-4 cases listed first). Command: `npx vitest run __tests__/ceremonyGates.test.mjs`.

**T3 — Credit wiring + ceremony route (`F1` self-wire completion, `M2`, `M3`).** Acceptance per R3/R5/R9/AC-5: `index.mjs` boots the module (credit path live in prod); route `GET /api/command-centre/ceremony` returns per-class `{ gates, spendableResolved, scaleResolved, enablement, platformVerification, lastCreditAt, ledgerRunning }` with `ledgerRunning === false` surfaced as `ceremony:deny:ledger-stale`; overview untouched. Tests: `server/__tests__/ceremonyRoute.test.mjs` (≥6, fixture store). Command: `npx vitest run __tests__/ceremonyRoute.test.mjs`.

**T6 — Adapter enablement branch (`M4`).** Acceptance per R8/AC-6: `modeOf` additive branch — mainnet proceeds only on env REQUEST + store PERMISSION; refusal strings byte-identical when locked; sandbox wins when both flags; UNHEALTHY store reads locked. Tests: `server/__tests__/ceremonyVenueUnlock.test.mjs` (≥5; simulates an unlock by writing a fixture store, never a real flip). Command: `npx vitest run __tests__/ceremonyVenueUnlock.test.mjs`.

**T7 — Ceremony readout UI (`F4`, `M6`).** Acceptance per R9.2/AC-7: gates rendered per class with pass/block tone + named reason + spendable count + scale(500) marker; absent data → "not-wired" honesty cell (AggregateRiskStrip mirror, `CommandCentrePanel.tsx:382-406`); mounted in `CommandCentreRoom.tsx`. Tests: `src/components/__tests__/UnlockCeremony.test.tsx` (≥6). Command: `npx vitest run __tests__/UnlockCeremony.test.tsx`.

**T8 — Guard, floor, docs (`F5`, `M7`, `M8`).** Acceptance per AC-8: `ws3CeremonySeamGuard.test.mjs` asserts (a) credit filters real+classed (sim/untagged rows never reach the store), (b) the adapter mainnet branch is unreachable without a store unlock, (c) gate numbers are the locked defaults; PICC.md §10 registry row for this spec + §23 methodology note; `.env.example` gains the ceremony vars. Commands: `npx vitest run --maxWorkers=1; npm run typecheck` (serial floor from `apps/dashboard`, ws1 §8.3); `verifyAudit()` green (WS-2 §9).

### File-bisect matrix (parallel-dispatch safety; one owner per file)

| Task | Files touched | Parallel-safe with |
|---|---|---|
| T1 | `ceremonyState.mjs` (new) | all |
| T5 | `tradingCalendar.mjs` (new) | all |
| T2 | `accuracyLedger.mjs` | T1, T5, T4, T6, T7 |
| T4 | `ceremonyGates.mjs` (new), `constitution.mjs` (comment-only `:240-241`) | T1, T5, T2, T6, T7 |
| T3 | `handlers.mjs`, `index.mjs` | T1, T5, T2, T6, T7 — **after T4 landed** (route recomposes gates) |
| T6 | `hyperliquidPerps.mjs` | T1 (store read), all others |
| T7 | `src/components/UnlockCeremony.tsx` (new), `CommandCentreRoom.tsx` | everything server-side |
| T8 | `ws3CeremonySeamGuard.test.mjs` (new), `PICC.md`, `.env.example` | last (after all) |

Import-only edges (not collisions): T1→T2 seam; T4→F1/F3/`constitution`; T3→T1/T4 (+T2 for the wiring assertion); T6→T1. **Hard conflicts: none** — every file has exactly one owning task; `handlers.mjs`/`index.mjs`/`accuracyLedger.mjs`/`constitution.mjs`/`hyperliquidPerps.mjs` are single-owner by row. T3 must land after T4 (its route test recomposes `evaluateCeremony`).

## 6. Risks

1. **Ledger wipe vs ceremony store split-brain.** `resetLedger` (`accuracyLedger.mjs:456-459`) or a restart no longer resets gate progress (design intent, R3.2) — an operator expecting the ledger to control ceremony progress will be wrong. Guard: T1 test proving re-boot survival; `ledgerSeq` reconciliation seam; R9 readout shows `lastCreditAt` so staleness is visible.
2. **Provenance default "real" is one bad opt-in away from poisoning counts.** A future sim path that forgets `d.provenance = "sim"` credits sim resolves toward the gates. Guard: T2 tests proving sim exclusion; T8 source-level guard rendering the sim tag reachable and asserted; no ledger-writing sim exists today (§0.5) so no retrofit needed.
3. **Per-class flip-gate depletion.** `flipGate` needs ≥100 rows per ENGINE per class (`constitution.mjs:252-257`) — the class dimension splits the legacy pool; gate-2 blocks classes whose legacy trail is thin, honestly. Guard: stable `ceremony:deny:flip-unmet` reasons cited in the readout, not silent.
4. **Gate-3 stalls on winProb-null rows.** Engine rows recorded without `winProb` (`recordDecision` `:41` `?? null`) deny gate-3 (`ceremony:deny:streak-winprob-missing`). Guard: the named deny + test; the ratio never silently skips a row.
5. **Gate-4 stalls on a healthy-but-idle week.** No TRADE verdicts = no credits = no trading days (R7.1). Honest, but the readout must make the cause visible — Guard: `days-short` reason cites `lastCreditAt`; runbook-style note in the readout.
6. **Adapter mainnet branch dead-lock / leak.** If the ceremony store is UNHEALTHY or absent, the branch must read LOCKED (fail-safe), and the refusal strings pinned by existing tests (`hyperliquidPerps.mjs:28`) must stay byte-identical. Guard: T6 tests pin the exact strings AND assert UNHEALTHY→locked; WS-1 risk 3 (`WS1...:311`) handoff honored — the refusal text changes only in a future ceremony execution, never in WS-3.
7. **Shared-file drift.** `accuracyLedger.mjs`, `handlers.mjs`, `index.mjs`, `constitution.mjs`, `hyperliquidPerps.mjs` each have one owner per matrix; the constitution edit is comment-only to keep its 381-line suite green (T4).
8. **Class attribution is decision-feed origin, not resolve-feed origin.** First-slice rows may be resolved against the shared live feed while tagged to a class by asset origin — the REQ-CON-1 one-clock semantics, but a future per-class resolve feed could make attribution drift. Guard: flagged in honesty notes; the `assetClasses` map is deliberate config, not inference; a resolve-feed cross-check is deferred (Non-goals) and documented.
9. **Platform verification is a human-paced external gate.** The binary-options class stays locked behind `platformVerification` until an operator records the evidence — a class that would otherwise gate-1-pass sits `ceremony:deny:platform-unverified`. Honest by design; the readout must surface the record so the cause is visible (R11.4).

## 7. Honesty notes

- **No venue goes live in WS-3** — the machinery + state machine + readout land; `enablement` stays null for every class; gate-4/… cannot pass on zero data. The mainnet branch is proven unreachable in production (AC-6 guard) — the flip is a LATER ceremony action on this machinery.
- **The blueprint's platform gate is machine-deny + human-evidence, kept separate (D8)** — `platformVerification` defaults null for the binary-options class; the deny is code (`ceremony:deny:platform-unverified`), the evidence entry (regulator register, withdrawal test) is a deliberate operator write with the audit trail; nothing infers it.
- **Deploy vs scale is a readout distinction, not a second gate (D7)** — unlock requires gate-1 (300); 500 is surfaced as a scale marker so operators see the forward bar without the ceremony inventing a new threshold.
- **Sims are never spendable** — the `provenance` seam + exclusion fixtures deliver decision 8's machine half; no sim engine is built. A sim row is a named `ceremony:deny:sim-row`, never a silent skip.
- **No backfill** — existing ledger rows are untagged and in-memory (lost anyway); the ceremony counts from WS-3 onward with an explicit `assetClasses` map (empty default → `ceremony:deny:untagged-class`). Nothing is inferred from asset symbols.
- **The catalog schema is untouched** (D4) — enablement is code-persisted operational state, audit-trailed in the ceremony store; the catalog doc stays the data-facts descriptor.
- **Resolution provenance caveat** (Risks 8) — class = decision feed origin under REQ-CON-1 one-clock semantics; the resolve-feed cross-check is out of scope and disclosed, not silently passed.
- **The fail-closed risk layer is untouched** — risk gates 16–19, sidecar 10, perps 11–15, halt persistence all stay byte-identical; WS-3 adds ceremony machinery only.
- **No credentials, tokens, wallet addresses, or account numbers appear in this spec** — env vars are cited by NAME, never value.
- **The constitution's derived-truth doctrine holds** — the ceremony store is a persistent PROJECTION of spendable ledger rows (each credit carries `ledgerSeq`), not a second counter that could drift.

## 8. Verified facts and flagged findings from the real code (read this session)

### 8.1 Verified anchors (all read this session)
- `constitution.mjs:17-18` floors 300/500 global; `:90-104` `gateConstitution` (test-only consumer); `:39-40` `decided` incl. push; `:48-79` `aggregateDayState`; `:240-241` operator-elapse docstring; `:243-261` `flipGate` (minTrades 100, stable reasons).
- `accuracyLedger.mjs:19` `LEDGER_CAP 1000`; `:25` `entries = []` in-memory; `:33-57` entry shape (`engine` at `:51`, no venueClass/provenance); `:68` cap drop; `:127-151` `flushLedger`; `:163-181` `correctlyAnsweredByEngine` (pushes excluded); `:435-441` loop; `:451-453` `ledgerEngineStats`; `:456-459` `resetLedger`. `index.mjs:10` import, `:201` `startLedger`.
- `v32Config.mjs:5-7` operator-flip comment; `:20-25` `V32_DEFAULTS` incl. `enabledAt` `:24`; `:27` `TOP_KEYS`; `:133-143` `stampV32Config`; `:149-152` `saveV32Config` (VITEST-suppressed). No write route (grep).
- `adaptiveConfluence.mjs:886,:914` `recordDecision` callers; `:996-1029` `v32Status` (`flipGate` at `:1014`); `v32Register.mjs:8-42`; `v32Section.mjs:12` `SOAK_TARGET 100`, `:72-77` uptime from `enabledAt`.
- `riskState.mjs:7-9` DATA_DIR; `:26-45` boot health; `:47-51` persist; `:168-255` refresh; `riskHaltStore.mjs:59-62` fail-safe; `:83-87` hydrate; `:126-140` self-wiring seam. `riskGates.mjs:15-20` `RISK_GATE_ORDER`; `:35-41` `envNumber`.
- `hyperliquidPerps.mjs:54-57` exact refusal strings; `:87-94` `modeOf`; `:90` `PICC_CCXT_PERPS_MAINNET_ENABLED`; `:522-534` adapter surface.
- `policyGraphCatalog.mjs:61-129` 3 templates (ccxt `:62-80`, expertoption `:81-108`, perps `:109-128`); `:132-139` sites/template lookups. Catalog doc §2 schema `:14-28` (no enablement); resolved rows `:117-129`.
- `handlers.mjs:1324-1340` `/api/trading/engine/v32`; `:1349-1354` ledger flush POST; `:1512-1594` overview route; `:1588` riskFeed; `:1655-1659` `observeRiskFeed`; `commandCentreOverview.mjs:71-92` risk compose. Runbook `:408-410` mainnet = WS-3 ceremony. `CommandCentrePanel.tsx:382-406` AggregateRiskStrip. `CommandCentreRoom.tsx:30` panel mount. `.superpowers/sdd/PICC_TRADING_SUITE_WS345_PIPELINE/plan.md:9-25` WS-3 compendium.

### 8.2 Flagged, verify-at-implementation (UNVERIFIED this session)
- Exact insertion point inside `flushLedger` for the consumer invocation (design pinned to `:127-151`, exact line verified by the implementer against the final diff).
- `src/` overview types for the new ceremony cell (the route is separate from `/api/command-centre/overview`, so no `CommandCentreOverview` type change is expected — confirmed the overview composer file is untouched).
- The `assetClasses` map's first real entries (operator/venue-wiring decision, not a code decision — map ships empty).

### 8.3 Task count
8 core tasks (T1–T8); ~52 asserted acceptance checks across the new test files plus the serial floor.

## 9. Resolution (filled after implementation, 2026-09-23)

- **Task statuses:** T1–T8 all landed with their assert batteries (landing commits `be4f1b8` T1, `8f45b6a` T2, `3ef2c49` T3, `d6756fa` T4, `45fea25` T5, `475ea16` T6, `1023680` T7, `8b132dc` T8); the WS-3 review round (this commit) approved the three flagged fixes.
- **Gate-number strictness (decision 7 re-affirmed):** the 300/100/50/30-day unlock numbers stay locked, per class; no number renegotiation in this workstream. The platform gate is a strict ADDITIVE gate for binary-options classes, evaluated between gate-1 and gate-2 (implementation-pinned by the seam guard). The deploy(300+)/scale(500+) tier distinction stays readout-only (D7): `PICC_CEREMONY_SCALE_MIN_RESOLVES` is now read by the server at call time and emitted as `scaleMinResolves` on the ceremony payload — consumed by `UnlockCeremony.tsx`, never an unlock gate; an invalid value is a named `invalid-environment` readout (null floor + reason), never a silent fallback.
- **Ledger-stale deny (R9.1, review fix 1):** when the resolve loop is not running the readout now emits a synthesized `gate-ledger-health` gate with reason `ceremony:deny:ledger-stale`, pass=false — a dead loop can never read as a silent all-pass. Route observes `ledgerEngineStats().running`; the four core gate ids + the platform id stay byte-identical while the loop is running.
- **swapInstance honors the resolved mode (review fix 3):** the ordering seam's swap instance now passes `sandbox: <mode-resolved>` — sandbox:true under testnet, sandbox:false ONLY under env REQUEST + ceremony-store unlock + no sandbox flag (fail-closed otherwise). A genuinely unlocked mainnet branch targets live endpoints; inert in production (enablement null). Pinned at source by `perpsSeamGuard.test.mjs`.
- **Review outcomes:** security review CLEAN. Code review flagged ledger-stale silent-pass (IMPORTANT), client-hardcoded scale floor (WARNING), and dead `swapInstance` sandbox invariance (WARNING) — all three fixed in this review round with tests (see above).
- **Serial floor:** `apps/dashboard` `npx vitest run --maxWorkers=1` — 271 files, 2998 passed + 1 skipped (2999 tests), exit 0 (2026-09-23); `npm run typecheck` green; `verifyAudit()` green.
- **Owner approval:** pending — decisions locked by the blueprint and owner 2026-09-23; ship decision (whether any venue class actually goes live across the WS-3 ceremony) awaits the owner.