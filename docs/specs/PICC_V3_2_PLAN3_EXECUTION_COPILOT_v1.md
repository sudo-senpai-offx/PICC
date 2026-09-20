# PICC v3.2 Plan 3 — Execution 5-point + Copilot + Live Wiring — spec v1

**Status:** Ready for execution · **Date:** 2026-09-20 · **Workspace:** `C:\Users\sharv\Downloads\freelance\PICC` · **Branch:** `master`
**Extends:** `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` (§4 Execution pillars, §5 Copilot trip-wires, §6 staging, §8 tasks T5/T6/T10), `docs/adr/0003-execution-granularity-aggregated.md`, `docs/adr/0004-decision-core-rebuild.md`, `docs/specs/notes/B-IND-0-current-engine-coverage-2026-09-19.md` (§8 volume reality, §9 disposition map, §10 locked dispositions, §12.4 trip-wires)
**Prior plans:** `docs/superpowers/plans/2026-09-19-v32-constitution-layer.md` (COMMITTED `44554d4`), `docs/superpowers/plans/2026-09-19-v32-context-regime-layer.md` (COMMITTED `b595253`)

**Grounding rule:** every `file:line` below was read in the 2026-09-20 session; anything not re-read is marked **UNVERIFIED**. The v3.2 blueprint (§3–§6, §8) is authoritative; plan 3 fills its execution-side rows (T5 red-line, T6, T10), wires the shipped registers, and builds the Copilot layer — all under a **toggle that is OFF in every committed config**, so legacy decisions stay byte-identical (the 2408-test floor pins this). Demoted legacy triggers remain context registers — computed, logged, HUD-visible, never decision inputs (REQ-STG-6, ADR-0004).

---

## 0. Purpose & scope

Plan 3 is the third and final plan of the v3.2 layered-engine rebuild. It delivers:

1. **Execution 5-point pillars** (blueprint §4; B-IND-0 §10.1/10.2/10.4): VWAP dual-anchor, EMA 9/21 alignment + spread, Volume Delta / CVD / Relative Volume, and the per-venue score composition with the honest degradation path (crypto vs forex/EO).
2. **Cost line (REQ-L9, B-IND-0 §10.9)** surfaced on every forex/EO v3.2 output, rejection reasons citing the numbers.
3. **Copilot layer (blueprint §5; B-IND-0 §11.4 + §12.4)**: the 8 approved deterministic trip-wires + serializable explain-state. Zero LLM in the trade path (LLM explain-only inside the HUD is the Studio/(c) surface's later concern — non-goal here).
4. **Live wiring (ADR-0004 / REQ-STG-1/2)**: `assembleRegime` (`v32Context.mjs`) → Execution score → Copilot veto → per-asset decision row tagged `engine:"v3.2"`, plus the v3.2 lane riding the existing `computeNow → decideAssets → evaluateAsset` chain, and the ledger/`v32Status` flip-gate data plumbing. Toggle default OFF; ON only after the operator's flip decision (REQ-STG-3).
5. **Copilot consumes the assembled regime** (registers + f1) + constitution per the blueprint's Copilot section (`copilotGate` reads `regime`/`constitution`/`execution`).

### What is already landed (Plan 1/2 + earlier work) — reused, never duplicated

| Piece | Where | Plan 3 disposition |
|---|---|---|
| Constitution floors, cost-adjusted EV (`line` = the REQ-L9 math), confidence strict shape, flip gate | `constitution.mjs` (`aggregateDayState` :48, `gateConstitution` :90, `costAdjustedEv` :120 + `line` :148, `deriveEvRRFloor` :169, `confidenceShape` :198, `flipGate` :243) | **Frozen**, read-only imports. REQ-P3-6/10/11 consume it |
| Ledger engine tag + per-engine correct-answer table | `accuracyLedger.mjs` (`recordDecision` :30 stores `engine` :51; `correctlyAnsweredByEngine` :163) | **Frozen**, read-only. v3.2 rows log `engine:"v3.2"` via the existing entry shape — no ledger edit |
| Context/Regime registers | `v32Context.mjs` (`adxChop` :26, `structureRegister` :68, `biasRegister` :98, `ema400Context` :139, `volatilityRegime` :192, `sessionClassify` :245, `f1GateRegister` :286, `assembleRegime` :329) | **Frozen**, pure + unit-tested; wiring target. `assembleRegime` is imported nowhere outside its test today (verified: only `v32Context.test.mjs:2,203` references it) |
| Anchored-cumulative VWAP indicator | `indicators.mjs` `vwap(highs,lows,closes,volumes)` :657 ("resets at each null/candle-boundary gap > 5× median") | **Frozen**, read-only. Pillar-1 primary anchor |
| EMA primitive | `indicators.mjs` `ema(closes, period)` :55 | **Frozen**, read-only. Pillars 2–3 compose it |
| Legacy decision core (paper/real separation D4/D5, landed `bf99e09`) | `fourFactor.mjs` `evaluateU4FA` :352 — `compliance.requiresHumanApproval` :380, `accessibility` eligibility :388; `interventions.mjs` `proposeTrade` :410 (risk gate via `checkProposalGate` :437) + `proposeSuiteTrade` :510; `regimeEngine.mjs` (B-REG market-mode classifier, `detectRegimeEnhanced` :202) | The **U4FA verdict retires** (ADR-0004); its paper/real posture and proposal gate are the pattern the copilot lane mirrors. `regimeEngine.mjs` is a **separate lineage** (trading-suite rebuild), NOT the v3.2 5-point — out of scope here beyond read-only reuse if a knob is needed (none is) |
| Kill-switch / breakers (trip-wires 1 & 6 reuse) | `commandCentre/safetySidecar.mjs` (`GATE_ORDER` :32, `wireKillSwitchReader` :57, `crossSiteHaltState` :69, `noteBreakerTrip` :81) | **Read-only** import in `v32Copilot` |
| Risk knobs / proposals gate (trip-wire 1 & 8 precedents) | `u4faRisk.mjs` (`U4FA_DAILY_LOSS_LIMIT_PCT` :22, `U4FA_MAX_DAILY_PROPOSALS` :23, `checkProposalGate` :95, `riskDayState` :139); `u4faConfig.mjs` `U4FA_DEFAULTS` (`risk` block :118-122, `loadU4faConfig` :342, `deepMergeConfig` :142, `validateU4faConfig` :178) | `u4faConfig`'s **load/save/validate pattern** is mirrored by a new sibling `v32Config.mjs` (plan-1 stated alternative: "u4faConfig.mjs (or sibling v32Config.mjs)") |
| Live-path seam | `adaptiveConfluence.mjs` — `evaluateAsset` :383 (already carries `constitution` param + default-off veto, :574-580 — the exact additive-wiring precedent this plan repeats), `decideAssets` :698, `computeNow` :883 (:909 calls `decideAssets`), `logTradeVerdicts` :805 (ledger write at :830), `proposeU4faTrades` :969, `u4faEventFromDecision` :1049, `getDecisions` :1114 | **Additive, toggle-guarded edits only** — the same contract Plan 1 shipped (present `constitution` param → veto applied; absent → byte-identical) |

### Blueprint ambiguities this plan resolves

1. **`assessCall` does not exist as a symbol.** The user brief's "`computeNow → decideAssets → assessCall`" maps to `computeNow` (`adaptiveConfluence.mjs:883`) → `decideAssets` (:698) → the per-asset call `evaluateAsset` (:383). Wiring lands there: computeNow builds the v3.2 context batch, decideAssets threads a `v32` lane, evaluateAsset builds the `strategies.v32` row. Verified by grep: zero `assessCall` matches in the repo.
2. **"Crypto full 5-point" is partially data-gated.** Volume Delta / CVD are specified as maker-flow over a trades feed (blueprint §4 pillars 4–5; B-IND-0 §8: only ccxt OHLCV volume exists, `ccxtAdapter.mjs:19`; `liveCCXT.mjs` has only `volumeProxy` :124 — a bar-activity proxy, explicitly *not* a trades feed). Resolution: the Δ/CVD pillars ship **pure** over a caller-supplied signed-trades series and report the honest `available:false, reason:"no trades feed"` in every live wiring path until a trades feed exists; crypto live = VWAP + EMA 9/21 + Relative Volume (bar volume) now, Δ/CVD becoming live when the feed lands. No maker-flow number is ever synthesized (G2).
3. **15s (b)/(c) cadence + futures-proxy leg (T3/T4/T13) are deferred**, not part of this plan: no adapter serves a 15s plane (ccxt `INTERVAL_BY_TF` starts at 60s per ADR-0003; studio leg is the future feed). The 60s core this plan wires is the honest 5-point surface today.
4. **Config surface**: a new sibling `v32Config.mjs` (data-dir `v32-config.json`, `u4faConfig` pattern) rather than editing the legacy `u4faConfig.mjs` — zero risk to the legacy config validation surface (`u4faConfig.mjs:178`).

---

## 1. Requirements (REQ-P3-x) with acceptance criteria

| REQ | Rule | Acceptance criteria (testable) |
|---|---|---|
| REQ-P3-1 | **Toggle gate**: a `v32` config block, `enabled` default **false** in every committed config; OFF ⇒ the legacy decision path is byte-identical (no new fields, no new rows, no new I/O). ON ⇒ the v3.2 lane runs alongside and legacy keeps logging `engine:"legacy"` (REQ-STG-1) | A test with `enabled:false` runs the existing `computeNow`/`decideAssets` fixtures and deep-equals today's serialized decisions (existing `adaptiveConfluence.test.mjs`/`u4faPayload.test.mjs` stay green **unmodified**); a test with `enabled:true` shows the v3.2 lane attached and legacy rows still tagged `engine:"legacy"` |
| REQ-P3-2 | **VWAP dual-anchor pillars** (B-IND-0 §10.1): anchored-cumulative primary (`indicators.vwap` :657 wrap) + session-reset secondary (net-new); anchor selectable per venue/session; honest unavailable below min bars | `vwapPillar({candles, anchor:"cumulative"|"session"})` returns `{available, anchor, vwap, price, side, distancePct}`; cumulative matches `indicators.vwap` last value on a fixture; session-reset recomputes from the session-open bar only; <15 bars → `available:false` + reason |
| REQ-P3-3 | **EMA 9/21 pillars** (blueprint §4 pillars 2–3): fast-pair alignment + separation/direction; net-new composition over `indicators.ema` | `emaPair({closes})` returns `{available, ema9, ema21, aligned:"long"|"short"|"crossing"|"flat", spread, spreadPct}`; a monotonic up fixture aligns long with `ema9>ema21`; insufficient bars → honest unavailable |
| REQ-P3-4 | **Δ/CVD/rel-vol pillars** (blueprint §4 pillars 4–5 + relative volume; B-IND-0 §8): pure over a signed-trades series; honest `available:false` without a feed; rel-vol over bar volume, crypto-only by construction | `volumeDelta({trades})`, `cumulativeVolumeDelta({trades})` compute maker-flow delta/CVD over a fixture; with `trades` absent → `available:false, reason:"no trades feed"`; `relativeVolume({candles})` computes bar volume vs trailing average, `available:false` when candles carry no volume |
| REQ-P3-5 | **Score composition + venue degradation** (blueprint §4; S3): crypto = full 5-point (+rel-vol); forex/EO = VWAP + EMA 9/21 only with honest-null volume legs; the score is a directional entry *argument*, never a standalone probability (REQ-CON-5) | `executionScore({pillars, venue:"crypto"|"forex"|"eo"})` emits `{available, score, direction, pillars, degraded:[...]}`; forex/EO output lists Δ/CVD/rel-vol as `unavailable` with reasons and scores on 2 pillars only; no `confidence` field on the score object (banned shape) |
| REQ-P3-6 | **Cost line on every forex/EO v3.2 output (REQ-L9 / B-IND-0 §10.9)**: payout, 1.5-pip spread model, slippage, EV margin; rejection reasons cite the numbers | The v3.2 decision row's `costLine` equals `constitution.costAdjustedEv().line` semantics (:148-155); a failing EV-margin decision's `reasons` contains the numeric net-payout/breakeven figures |
| REQ-P3-7 | **Copilot = the 8 approved trip-wires** (blueprint §5; B-IND-0 §12.4), deterministic, fail-closed on unavailable inputs with honest reasons; LLM explain-only = serializable explain-state, zero LLM calls in the module | `copilotGate({regime, execution, constitution, risk, config})` returns `{ok, wires:[{id, tripped, reason}], blockedBy}`; each of wires 1–8 trips on its fixture; an unavailable input (e.g. no balance for wire 1) blocks the entry with the honest reason, never passes |
| REQ-P3-8 | **Copilot consumes the assembled regime + constitution** (user brief; blueprint §5): trip-wires 2–5 read `regime.registers.adx.chop`, `regime.registers.session.label`, `regime.f1.checks.spread`, `constitution` cost line / EV margin | Fixtures: chop-confirmed ⇒ wire 2 blocked; `label!=="normal"` ⇒ wire 3 blocked; spread not ok ⇒ wire 4 blocked; `${evRR < 2}` ⇒ wire 5 blocked; any veto downgrades the v3.2 TRADE → NEUTRAL with `reasons` carrying the wire ids |
| REQ-P3-9 | **Proposal/day cap (trip-wire 8, S5, ADR-0004 Consequences)**: persisted config setting, default **unlimited**, `0` = unlimited; supersedes `maxDailyTrades`/`U4FA_MAX_DAILY_PROPOSALS` on the v3.2 lane | `proposalCap: undefined/0` never trips wire 8; `proposalCap: 2` trips when `proposalsToday >= 2`; setting round-trips through `v32Config` load/save; a doc-comment states the supersede |
| REQ-P3-10 | **Confidence strict shape on every v3.2 decision (REQ-CON-5)**: `{sampleSize, costAdjustedExpectancy}` only; standalone %/score banned | The v3.2 decision's `confidence` passes `constitution.confidenceShape` without throwing; `sampleSize` = aggregate deployable + per-engine rows; expectancy re-derives plan-1's formula (see Design 6) and a consistency test equals `constitution.flipGate`'s internal expectancy on the same rows |
| REQ-P3-11 | **Flip-gate readiness surface (REQ-STG-3)**: `v32Status()` reports toggle state, per-engine counts, and the `flipGate` result over the shared ledger — data plumbing only; the actual flip is the operator's call after the ~2–4-week soak | `v32Status()` returns `{enabled, mode, flipGate:{flip, legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades}, at}`; with both engines `< 100` paper trades it reports `flip:false` + the `reason` from `constitution.flipGate` (:243) |
| REQ-P3-12 | **Honesty pins (G2)** on every new register/output: `available`, `source`, sample counts; unavailable ⇒ honest reason, never fabricated numbers; demoted triggers stay registers | A sweep test asserts every exported v3.2 register shape carries `available` + `source`; every `available:false` path carries a non-empty `reason`; no new mock/fabricated feed is introduced |

---

## 2. Design

### 2.1 Modules touched

| File | Action | Role |
|---|---|---|
| `apps/dashboard/server/services/v32Config.mjs` | **New** | `V32_DEFAULTS` (`enabled:false`, `proposalCap: 0` = unlimited, `sessionHaltFloorPct: 2` — non-configurable floor constant, `consecutiveLossThreshold: null` = disabled-until-owner), `loadV32Config`/`saveV32Config`/`validateV32Config` mirroring `u4faConfig.mjs` (:142/:178/:342) in `data/v32-config.json` |
| `apps/dashboard/server/services/v32Execution.mjs` | **New** | Pillars (REQ-P3-2/3/4) + `executionScore` (REQ-P3-5). Pure; wraps `indicators.vwap`/`indicators.ema` read-only |
| `apps/dashboard/server/services/v32Copilot.mjs` | **New** | `copilotGate` (REQ-P3-7/8/9) + `explainState` serializer (deterministic, no LLM). Imports read-only: `safetySidecar` (`wireKillSwitchReader`, `crossSiteHaltState`), `u4faRisk` (`checkProposalGate` :95, `riskDayState` :139), `v32Config` |
| `apps/dashboard/server/services/v32Engine.mjs` | **New** | Per-asset composition: `v32ContextForAsset` (assembles `assembleRegime` inputs, mirroring `buildU4faStrategy` `adaptiveConfluence.mjs:672`), `v32DecisionForAsset` (regime → score → cost line → copilot gate → decision row `engine:"v3.2"`), chop-latch continuity map (mirrors `u4faRegimeStates` `adaptiveConfluence.mjs:661`), confidence strict shape (REQ-P3-10/REQ-CON-5) |
| `apps/dashboard/server/services/adaptiveConfluence.mjs` | **Edit — additive, toggle-guarded only** | `computeNow` (:883) builds the v3.2 context batch when `enabled`; `decideAssets` (:698) threads a `v32` lane into `evaluateAsset`; `evaluateAsset` (:383) attaches `strategies.v32 = {enabled, result}` when the toggle is on; `logTradeVerdicts` (:805) logs v3.2 TRADE rows with `engine:"v3.2"` (default `"legacy"` stays for the old path — `accuracyLedger.mjs:51`); `v32Status()` export (REQ-P3-11). OFF ⇒ the added code paths are unreachable (same contract as the `constitution` param, :574) |
| `apps/dashboard/server/__tests__/v32Config.test.mjs`, `v32Execution.test.mjs`, `v32Copilot.test.mjs`, `v32Engine.test.mjs`, `adaptiveConfluence.v32.test.mjs`, `v32Honesty.test.mjs` | **New** | Test beds, one per module + the live wiring regression bed + the REQ-P3-12 honesty-pins sweep |
| `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` | Edit | §8 task table: strike T6/T10 `✓`; annotate T5 (pillars shipped, feed wiring deferred); mark T3/T4/T13 deferred to the 15s plan with reason |
| `docs/superpowers/plans/2026-09-19-v32-execution-copilot-layer.md` | **New** (this plan's companion status doc; same style as the prior two plans) | — |

**Frozen surfaces (read-only imports only):** `constitution.mjs`, `accuracyLedger.mjs`, `fourFactor.mjs`, `mtfConvergence.mjs`, `indicators.mjs`, `v32Context.mjs`, `safetySidecar.mjs`, `interventions.mjs`, `u4faRisk.mjs`, `u4faConfig.mjs`. The sole writable legacy module is `adaptiveConfluence.mjs`, under the exact additive contract Plan 1 already set (evidence: `adaptiveConfluence.mjs:574` "NULL/undefined means 'not yet wired' — legacy behavior is byte-identical" + the unmodified `adaptiveConfluence.test.mjs`).

### 2.2 The v3.2 lane data shapes

Per-asset v3.2 decision row (`strategies.v32.result` on the existing decision object, plus the ledger row):

```js
{
  engine: "v3.2",                          // recordDecision tags the ledger entry (accuracyLedger.mjs:51)
  assetId, asset, direction, expiry, ts,   // same vocabulary as the legacy row
  score: { available, score, direction, pillars, degraded },   // REQ-P3-5 — entry argument, never confidence
  costLine: { payoutPct, spreadPips, slippagePips, marginPct, netPayoutPct, evRRMin }, // REQ-P3-6 = constitution.costAdjustedEv().line
  confidence: { sampleSize, costAdjustedExpectancy },           // REQ-P3-10 strict shape via confidenceShape
  regime: assembleRegime output (registers + f1 + sources + at), // REQ-STG-6: demoted triggers + registers visible, never inputs
  copilot: { ok, wires: [{id, tripped, reason}], blockedBy },   // REQ-P3-7
  verdict: "TRADE" | "OBSERVE" | "NEUTRAL",                     // copilot veto downgrades TRADE → NEUTRAL (REQ-P3-8)
  gates: { score, costLine, copilot },                          // composite gate mirror
  reasons: [...],                                               // cost-line numbers + wire ids + honest unavailables
  honesty: { sampleSource, spreadSource, calendarSource, candleSource, tradesFeed: "absent" }
}
```

Wiring call flow (toggle ON only):

```
computeNow (adaptiveConfluence.mjs:883)
  → v32Engine.batchContext(data, u4faContext, v32Config)   // per-asset assembleRegime inputs (context batch, cached per tick)
  → decideAssets (:698) threads { v32 } into strategies
  → evaluateAsset (:383) → v32Engine.v32DecisionForAsset(...)   // regime → executionScore → costLine → copilotGate → row
  → logTradeVerdicts (:805) writes engine:"v3.2" rows (paper/demo only; real money stays Constitution-gated)
  → v32Status() readable via getDecisions().status.v32 (no new endpoints in this plan)
```

### 2.3 Copilot trip-wire mapping (blueprint §5 → implementation)

| # | Wire | Implementation source |
|---|---|---|
| 1 | −5% daily / −2% session hard-halt (non-configurable floor) | Daily: `u4faRisk.checkProposalGate` (:95) floor semantics; session: net-PnL% over resolved miss/hit rows within the active session window vs balance; **fail-closed when balance/session source unavailable** |
| 2 | Regime-3 Chop override | `regime.registers.adx.chop === true` (REQ-CTX-1) |
| 3 | Dead-zone / red-folder entry block | `regime.registers.session.label !== "normal"` (REQ-CTX-5) |
| 4 | 1.5-pip spread-spike abort | `regime.f1.checks.spread.check !== "ok"` (REQ-CTX-6; unmeasurable ⇒ closed, never synthesized) |
| 5 | Cost line below 2:1 EV margin | `execution.costLine` EV-RR `< constitution.EV_RR_MIN` (2, `constitution.mjs:22`) or `costAdjustedEv().evRRPass === false` |
| 6 | Kill-switch everywhere | `safetySidecar.crossSiteHaltState()` + `wireKillSwitchReader` read (fail-safe: throwing reader = KILL, `safetySidecar.mjs:56-59`) |
| 7 | Voluntary pause on consecutive losses (threshold **TBD** by owner) | Wire shape ready: `consecutiveLossCount` over `regime.f1.checks.correlation` losses feed; `config.consecutiveLossThreshold` default `null` = disabled until set; tripping when count ≥ threshold |
| 8 | Configurable proposals/day cap | `config.proposalCap`; `proposalsToday` from `u4faRisk.riskDayState().proposals`; default unlimited (`0`/undefined never trips); supersedes `maxDailyTrades` (`u4faConfig.mjs:121`) and `U4FA_MAX_DAILY_PROPOSALS` (`u4faRisk.mjs:23`) on the v3.2 lane |

### 2.4 Design decisions on the open seams

1. **Config = sibling `v32Config.mjs`** (plan-1's stated alternative), not an edit to `u4faConfig.mjs` — the legacy config's validation surface (`u4faConfig.mjs:178`) is untouched.
2. **The −2% session halt floor is a constant in `v32Copilot`** (`SESSION_HALT_FLOOR_PCT = 2`, REQ source tag) — non-configurable per the blueprint; the daily −5% is re-derived from `u4faRisk`'s risk block.
3. **Δ/CVD pillar honesty contract** (Design resolution 2): both functions take `trades = [{timeMs, price, side:"buy"|"sell"|"take", amount}]`; absent → `available:false, reason:"no trades feed"`. Live wiring never fabricates the series. Relative volume uses OHLCV bar volume (`ccxtAdapter` 60s OHLCV carries volume per ADR-0003; `liveCCXT.volumeProxy` :124 stays the no-tick proxy for `ticks`, not a maker flow).
4. **Confidence expectancy re-derivation** (REQ-P3-10): `constitution.expectancyOf` is private (`constitution.mjs:219`); `v32Engine` recomputes the identical formula over `correctlyAnsweredByEngine()` rows for `engine:"v3.2"` (payout 82 fallback per REQ-CON-4/`flipGate` default), with a consistency test asserting equality with `flipGate`'s internal numbers on shared rows. No edit to `constitution.mjs`.
5. **The v3.2 lane rides `strategies.v32` on the existing decision object** — the SSE/REST surface (`getDecisions` :1114, `u4faEventFromDecision` :1049) needs no new endpoints, and the registers become HUD-visible via the existing `type:"decision"` stream (UI rendering of them is the Studio's later work, see Non-goals).
6. **Flip = operator action, not code**: Plan 3 ships the flip *data* (`v32Status`, REQ-P3-11). Flipping the toggle in config after the soak is a one-line operator change documented in the plan status, per ADR-0004/REQ-STG-3 (≥100 paper trades each, new expectancy ≥ old, ~2–4 weeks elapsed).

---

## 3. Tasks (TDD-first; commit steps listed, NOT run — the user authorizes commits explicitly)

Commands per task: scope test `npm run test --workspace @picc/dashboard -- __tests__/<bed>.test.mjs`; floor `npm run test --workspace @picc/dashboard` (**must stay ≥ 2408 tests / 226 files** + new); `npm run typecheck --workspace @picc/dashboard`. Pattern: failing test → implement → green → full floor → commit.

### Task 1 — `v32Config.mjs` (REQ-P3-1, REQ-P3-9 config half)

**Status: ✅ SHIPPED (2026-09-20)** — 18 tests in `v32Config.test.mjs` (`V32_DEFAULTS.enabled === false`, unknown-key reject, load/save round-trip via `PICC_TRADING_DATA_DIR`, `proposalCap` 0/undefined = unlimited, supersede doc-comment). No runtime config file committed.

**Files:** new `services/v32Config.mjs`, new `__tests__/v32Config.test.mjs`.
**Acceptance:** `V32_DEFAULTS.enabled === false`; `validateV32Config` rejects unknown keys (mirror `u4faConfig.mjs:178`); `loadV32Config`/`saveV32Config` round-trip a tmp-dir JSON (the `PICC_TRADING_DATA_DIR` pattern, `u4faConfig.mjs:130-137`); `proposalCap: 0` and `undefined` serialize as unlimited; a doc-comment names the `maxDailyTrades` supersede (ADR-0004 Consequences).
**Commit:** `feat(v32): config toggle + proposal cap setting (REQ-P3-1/9)`

### Task 2 — `v32Execution.mjs` pillars + score (REQ-P3-2/3/4/5)

**Status: ✅ SHIPPED (2026-09-20)** — 20 tests in `v32Execution.test.mjs` (`vwapPillar` cumulative matches `indicators.vwap` fixture, session-reset from session-open bar, <15 bars honest-close; `emaPair` 9/21 alignment/spread, <21 honest-close; `volumeDelta`/`cumulativeVolumeDelta` pure over signed trades + honest `no trades feed`; `relativeVolume` bar-volume crypto-only; `executionScore` venue degradation forex/EO = 2-pillar + **no `confidence`**).

**Files:** new `services/v32Execution.mjs`, new `__tests__/v32Execution.test.mjs`.
**Acceptance:** `vwapPillar` cumulative matches `indicators.vwap` fixture; session-reset recomputes from session-open; `emaPair` alignment/spread; `volumeDelta`/`cumulativeVolumeDelta` pure over signed trades + honest-null without a feed; `relativeVolume` bar-volume crypto-only; `executionScore` venue degradation (forex/EO = 2-pillar, crypto = full where feed exists) and **no confidence field on the score**.
**Commit:** `feat(v32): execution 5-point pillars + venue degradation (REQ-P3-2..5)`

### Task 3 — `v32Copilot.mjs` (REQ-P3-7/8/9 copilot half, explain-state)

**Status: ✅ SHIPPED (2026-09-20)** — 36 tests in `v32Copilot.test.mjs`. All 8 wires trip on fixtures / pass honestly; no-balance wire 1 blocks with reason; wire 8 honors `proposalCap` (0 = unlimited); `explainState` deterministic, static test pins **zero LLM imports** in the module; `SESSION_HALT_FLOOR_PCT = 2` REQ-tagged and non-configurable.

**Files:** new `services/v32Copilot.mjs`, new `__tests__/v32Copilot.test.mjs`.
**Acceptance:** all 8 wires trip on their fixtures and honestly pass otherwise; fail-closed on unavailable inputs (no balance → wire 1 blocked with reason); wire 8 honors `proposalCap` (0 = unlimited); `explainState` serializes `{regime, execution, costLine, wires}` deterministically with **zero LLM calls** (module has no import of any LLM service — pins with a static check in the test); `SESSION_HALT_FLOOR_PCT = 2` REQ-tagged and non-configurable.
**Commit:** `feat(v32): copilot trip-wires 1-8 + deterministic explain-state (REQ-P3-7..9)`

### Task 4 — `v32Engine.mjs` per-asset composition (REQ-P3-6/8/10/12)

**Status: ✅ SHIPPED (2026-09-20)** — 17 tests in `v32Engine.test.mjs`. `v32ContextForAsset` mirrors the live load path (`deepMergeConfig` + `resolveAssetConfig`, refusal honest `{ok:false, ..., reason}`); `v32DecisionForAsset` regime→pillars→score→copilot chain, TRADE downgrade on wire veto, `confidence` passes `confidenceShape` strictly, `costLine` == `costAdjustedEv().line` semantics, expectancy re-derivation consistency test == `flipGate` internals, chop-latch continuity (2-bar re-arm) over two calls.

**Files:** new `services/v32Engine.mjs`, new `__tests__/v32Engine.test.mjs`.
**Acceptance:** `v32ContextForAsset` mirrors `buildU4faStrategy` inputs (`adaptiveConfluence.mjs:672-696`: 60s candles, 3600 plane when present, D1 honestly null — "Yahoo EOD not in the live cycle" precedent :684, calendar/events, spread null, losses, session windows from config, pipSize via `resolvePipSize`); `v32DecisionForAsset` produces the §2.2 row; regime→score→copilot chain; TRADE downgrade on any wire; `confidence` passes `confidenceShape`; `costLine` == `costAdjustedEv().line` semantics; consistency test vs `flipGate` expectancy; chop-latch continuity across two calls (2-bar re-arm, `nextRegimeState` `fourFactor.mjs:295`).
**Commit:** `feat(v32): per-asset engine composition + confidence + cost line (REQ-P3-6/8/10)`

### Task 5 — Live wiring in `adaptiveConfluence.mjs` (REQ-P3-1/11, REQ-STG-1/2)

**Status: ✅ SHIPPED (2026-09-20)** — 7 tests in the new `adaptiveConfluence.v32.test.mjs` + `decideAssets` OFF deep-equal in the file. OFF ⇒ `adaptiveConfluence.test.mjs` + `u4faPayload.test.mjs` stay green **unmodified** (byte-identical decisions). ON ⇒ `buildV32Strategy` → `strategies.v32` → `v32Row` (same confluence `winProb`/`payout`) → v3.2 TRADE rows hit the ledger via `recordDecision` tagged `engine:"v3.2"`; v3.2 cooldown `v32:<assetId>:<expiry>`; every runtime seam fails **closed** (null context → per-asset OBSERVE, never kills the batch).

**Files:** edit `services/adaptiveConfluence.mjs` (additive, toggle-guarded), new `__tests__/adaptiveConfluence.v32.test.mjs`.
**Acceptance (OFF):** with `enabled:false`, existing suite files are **unmodified green** (byte-identical floor — the exact Plan-1 precedent) and the v3.2 code paths are provably unreachable (a `computeNow`/`decideAssets` fixture deep-equals today's output).
**Acceptance (ON):** `computeNow` builds the v3.2 context batch; `evaluateAsset` attaches `strategies.v32`; v3.2 TRADE rows hit the ledger with `engine:"v3.2"` via the existing `recordDecision` shape (`accuracyLedger.mjs:51`); legacy rows stay `engine:"legacy"`; `v32Status()` reports toggle + lagged flip-gate numbers; everything fails **closed** on runtime error (mirror `u4faRuntimeContext` `adaptiveConfluence.mjs:844-881`).
**Commit:** `feat(v32): toggle-gated live wiring — regime to copilot lane (REQ-STG-1/2)`

### Task 6 — `v32Status` + flip-readiness surface (REQ-P3-11)

**Status: ✅ SHIPPED (2026-09-20)** — 4 further tests in `adaptiveConfluence.v32.test.mjs` (11 total in the bed). `v32Status()` = `{enabled, mode, flipGate:{flip, legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades}, at}`; shadow vs powered; `flip:false` under min-trades with the constitution reason; `flip:true` only when both engines ≥ 100 with candidate ≥ legacy; a read-only probe proves the status call never writes the ledger. `computeNow` attaches `status.v32` only when `enabled === true` (OFF keeps `status` byte-identical).

**Files:** edit `services/adaptiveConfluence.mjs` (+ test in `adaptiveConfluence.v32.test.mjs`).
**Acceptance:** `v32Status()` = `{enabled, mode, flipGate:{flip, legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades}, at}` from `correctlyAnsweredByEngine` + `constitution.flipGate` (:243) — no new endpoints, no ledger writes; under powered toggle OFF it still reports the comparison numbers for the soak dashboard.
**Commit:** `feat(v32): flip-gate readiness status surface (REQ-P3-11)`

### Task 7 — Spec/plan documentation + §8 task-table evidence (REQ-STG-5 shape)

**Status: ✅ DONE** — this spec's §3 evidence above + per-REQ trace below; new `docs/superpowers/plans/2026-09-19-v32-execution-copilot-layer.md` §7 status; layered-spec §8 updated (struck T6/T10, annotated T5/T12, deferred T3/T4/T13). REQ-P3-12 sweep test shipped: **17 tests** in `v32Honesty.test.mjs` (`.mjs` filters — run with `vitest run server/__tests__/v32Honesty.test.mjs`).

**Per-REQ test evidence:**
| REQ | Evidence |
|---|---|
| REQ-P3-1 | `adaptiveConfluence.test.mjs` + `u4faPayload.test.mjs` green **unmodified** (OFF byte-identity); `adaptiveConfluence.v32.test.mjs` ON-attach + legacy `engine:"legacy"`; `v32Config.test.mjs` `enabled:false` default |
| REQ-P3-2 | `v32Execution.test.mjs` — `vwapPillar` cumulative == `indicators.vwap` fixture, session-reset, <15 honest-close |
| REQ-P3-3 | `v32Execution.test.mjs` — `emaPair` alignment/spread, <21 honest-close |
| REQ-P3-4 | `v32Execution.test.mjs` + `v32Honesty.test.mjs` — volume pillars `no trades feed` honest-close, rel-vol crypto-only |
| REQ-P3-5 | `v32Execution.test.mjs` + `v32Honesty.test.mjs` — venue degradation, no `confidence` on score |
| REQ-P3-6 | `v32Engine.test.mjs` — `costLine` == `costAdjustedEv().line` semantics, numeric reasons on EV-margin fail |
| REQ-P3-7 | `v32Copilot.test.mjs` (36) — wires 1–8 fixtures + fail-closed + zero-LLM static pin |
| REQ-P3-8 | `v32Copilot.test.mjs` — chop/session/spread/EV-RR wire vetoes downgrade TRADE→NEUTRAL |
| REQ-P3-9 | `v32Copilot.test.mjs` + `v32Config.test.mjs` — `proposalCap` 0/unlimited + round-trip + supersede |
| REQ-P3-10 | `v32Engine.test.mjs` — `confidenceShape` strict, expectancy == `flipGate` internals |
| REQ-P3-11 | `adaptiveConfluence.v32.test.mjs` — `v32Status` shape, shadow/powered, flip thresholds, read-only |
| REQ-P3-12 | `v32Honesty.test.mjs` (17) — sweep: `available`/`source`, every false ⇒ reason, no fabricated feed |

**Files:** edit `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` §8 (strike T6/T10 `✓` + evidence; annotate T5 red-line; mark T3/T4/T13 deferred-with-reason), new `docs/superpowers/plans/2026-09-19-v32-execution-copilot-layer.md` §7 status block (mirror the prior two plans' status sections), this spec's status.
**Acceptance:** full floor + typecheck green; every `REQ-P3-*` ships with test evidence; toggle confirmed OFF in every committed config; no demoted-trigger tests re-pointed (spec T12 stays pinned for the soak — plan-2's global pin).
**Commit:** `docs(v32): plan-3 evidence + task-table closure`

---

## 4. Non-goals (deferred to later plans)

1. **15s (b)/(c) cadence + HUD state snapshot (T3), futures-proxy leg (T4), 15s E2E (T13)** — no adapter serves a 15s plane (ADR-0003: ccxt ladder starts at 60s; the studio capture leg is the future feed). They land in a 15s-slot plan gated on that probe.
2. **Maker-flow Δ/CVD live feed wiring (T5 data side)** — no trades feed exists (`liveCCXT.volumeProxy` is bar-activity, not maker flow). Pillars ship pure + honest-null; the feed wiring lands with the feed.
3. **LLM explain inside the HUD** — `v32Copilot` ships `explainState` (deterministic); rendering it through an LLM is the Studio/(c) HUD surface's later work. Zero LLM in the trade path is enforced here, not extended.
4. **HUD/Studio UI for the registers, cost line, wire flags** — the v3.2 lane rides the existing `type:"decision"` stream; client rendering is the frontend track.
5. **Demoted-trigger test re-pointing (spec T12)** — held for the soak phase per the plan-2 pin (ADR-0004 consent).
6. **B-REG `regimeEngine` integration** — separate lineage (trading-suite rebuild), out of v3.2's §3 register list.
7. **Real-money broker plumbing** — advisory-first posture unchanged; the v3.2 lane proposes paper/demo orders only (`openPaperTrade` precedent, `proposeU4faTrades` `adaptiveConfluence.mjs:969`).

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Live-wiring edit to `adaptiveConfluence.mjs` regresses the byte-identical floor** (the module is on the "frozen surfaces" list — the only planned exception) | The edit is additive + toggle-guarded with the identical contract Plan 1 already shipped (the `constitution` param, `adaptiveConfluence.mjs:574`): OFF ⇒ code paths unreachable. `adaptiveConfluence.test.mjs` + `u4faPayload.test.mjs` must stay green **unmodified**; the v32 test bed pins a deep-equal OFF fixture. This is the single most likely thing to bite → gate every task on it |
| **"Crypto full 5-point" is claimed while maker-flow feed data is absent** | REQ-P3-4/5 honest-null ahead of the feed; no synthesized delta; rel-vol is the only live volume pillar now; spec annotates the gap on the blueprint table rather than hiding it |
| **Confidence-shape expectancy drifts from `constitution.expectancyOf`** (private at `constitution.mjs:219`) | Formula re-used verbatim and pinned by a consistency test equalizing with `flipGate` numbers on shared rows (REQ-P3-10 acceptance) |
| **Trip-wire fail-open under missing inputs** (balance, spread, kill-switch reader) | Copilot fails **closed** with honest reasons (REQ-P3-7); `safetySidecar` reader throwing = KILL (:56-59); spread unmeasurable = gate closed (REQ-CTX-6) |
| **computeNow CPU doubling from dash-per-TF under the toggle** | Only under `enabled:true`; v3.2 context batch computed once per tick and shared across assets; no work when OFF; no perf commitment claimed for the OFF path |
| **Cost-line double-source drift** (legacy `evGate` vs `costAdjustedEv`) | `constitution.costAdjustedEv`'s doc-comment already pins the 1:1 `evGate` contract (`constitution.mjs:117-119`); REQ-P3-6 asserts the v3.2 `costLine` equals its `line` semantics on shared fixtures |
| **Session-halt floor reads a PnL source that doesn't exist yet** | Wire-1 runs daily-loss via `checkProposalGate` now; the −2% session leg fails closed ("cannot compute session PnL — balance unavailable") until the closed-trades feed exists — honest, never fabricated, and non-configurable per the blueprint |

---

## 6. Verification (definition of done)

- Full floor: `npm run test --workspace @picc/dashboard` — **2527 tests / 232 files green** (Plan-2 floor 2408/226 preserved, +119 new tests in 6 new files).
- Typecheck: `npm run typecheck --workspace @picc/dashboard` clean.
- `v32Config.enabled` is **false in every committed config** (`v32-config.json` absent from the repo = default false; the toggle is a data-dir runtime file like `u4fa-config.json`).
- Legacy byte-identity: `adaptiveConfluence.test.mjs`, `u4faPayload.test.mjs`, `fourFactor`/`v32Context` suites green **unmodified**.
- Spec cross-checks: blueprint §8 T6/T10 struck `✓` with evidence; T5/T12 annotated; T3/T4/T13 marked deferred; every `REQ-P3-*` traced to its test (§3 Task 7 evidence table).
- Commit steps listed per task but executed only on the user's explicit go-ahead (one intent per commit).

---

## 7. Honesty notes

- **Demo/live gates touched:** the v3.2 lane proposes **paper/demo only** (the `openPaperTrade` / proposals posture is untouched); real-money execution stays Constitution-gated (REQ-CON-2/3) and the toggle OFF in committed config means **zero behavior change to legacy decisions** until the operator flips after the soak.
- **Fabricated-state risks:** the Δ/CVD pillars never synthesize maker flow (`reason:"no trades feed"`); the spread gate never invents a spread (`spreadSource: null` → unmeasurable, closed); the session-regime fallback is labeled `source:"fallback-schedule"` (REQ-CTX-5); the D1 structure plane stays honestly unavailable in the live cycle ("Yahoo EOD not in the live cycle", `adaptiveConfluence.mjs:684` precedent).
- **No credentials, tokens, or account numbers** appear in this spec or in any planned artifact.