# PICC Trading Suite Rebuild — spec v1

**Status:** PLAN — Phase B of `PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md` (`docs/specs/`, §2). Write-only planning artifact: no code changes in this session, no other files touched. **Resolution:** SUPERSEDED — Phase B landed as implemented suite code (`bf99e09`); the decision-core remainder is superseded by ADR-0003/0004 + the v3.2 layered-engine rebuild (**Date:** 2026-09-19)

**Directives:** D4 (advisory AND execution paths; paper income separate from real income/PnL on every surface) · D5 (regime detection + MTF enhancement, both — the full-aware rebuild basis).

**Extends / grounds:** `PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md` (§2 phase B, §4 delete-zone, §5 honesty notes) — ``MTF_CONVERGENCE_ENGINE.md`` (R9/R12 discipline, state machine, presets) — `PICC_TRADING_SUITE_UPGRADE.md` (T1–T19 baseline inventory, REQ-1–11, decisions A–D) — `PICC_UNIVERSAL_4FA_ENGINE.md` (advisory-first posture, Augmentation gate, REQ-WIN) — ``PICC_INCOME_GENERALIZATION_{requirements,design,checklist}_v1.md`` (paper/real income semantics, honesty contract) — `PICC_MULTISOURCE_ENGINE.md` / `PICC_PACK1_LOCAL_TRADING_CORE_v1.md` (asset-class catalog) — `PICC_NOTIFICATION_AND_ALERT_UX_v1.md` (notifier seam, cited for Phase C only).

**Grounding rule (per PICC convention):** every `file:line` in this spec was read this session unless explicitly marked **UNVERIFIED** (then it is cited from the spec that verified it and carries a confirm-at-execution gate). DATA-GAP reads degrade to honest emptiness (`source:"none"` / `null`), never a fabricated value.

**R9/R12 discipline (echoed from MTF spec):** no claimed win-rates as design targets. Sobreiro 2026 (B.2 row): HTF-alignment lookahead inflates ROC-AUC ~0.20; honest band ~54–61% win-rate, cost-fragile. Background context only — never a rebuild target, never a UI claim (pairs with U4FA REQ-WIN ≥200 resolved decisions).

---

## 1. Requirements

| ID | Requirement (user-visible, testable) |
|----|---------------------------------------|
| REQ-R1 | **Regime classification per asset, all classes.** Every catalog asset (`assetCatalog.mjs:16-82` ASSET_ALIASES: metals ×5, energies ×3, indices ×11 incl. VIX, crypto ×10, forex ×12, equities ×7) gets a regime read: `TRENDING` / `RANGING` / `UNCERTAIN` (+ a `volatile:true` annotation), with `confidence` (0–100), `factors[]`, and per-timeframe breakdown. Fewer than 30 bars anywhere → honest `unknown`/`null`, never a guessed regime. |
| REQ-R2 | **Multi-timeframe consensus.** The regime read consumes the SAME plane data path as the MTF section (`marketConvergence.convergenceSection`: live buffers → `loadConvergence` → `converge`, `marketConvergence.mjs:44-69`), bias-plane-weighted (bias label from `resolvePreset`, `mtfConvergence.mjs:103-122`). A regime is only emitted when the consensus over the active planes is coherent; a single conflicting plane shows in `factors`, not silently averaged away. |
| REQ-R3 | **Soft blend, default on.** Regime confidence modulates the MTF read as posterior-style weights (per RegimeSense B.2 row) instead of hard switching. `mode:"soft"` is the default; `mode:"hard"` is per-asset config for deterministic behavior; `mode:"off"` disables modulation (read-only regime display). **The `mtfConvergence.mjs` signature and pinned pure-engine tests never change** — modulation is applied by passing the engine's OWN existing knobs (weights, conservative) from the regime layer (see D1/D2). |
| REQ-R4 | **UNCERTAIN escalates conservatism.** When the regime is UNCERTAIN with confidence ≥ floor (default 60) and the read is latched (2 consecutive readings, anti-flicker), the convergence call runs with `conservative:true` (HTF veto, `mtfConvergence.mjs:467-468` R8) and the state string carries an additive suffix (`"LONG ONLY (regime UNCERTAIN)"`). No classification logic inside `classifyState` changes. |
| REQ-R5 | **Fusion report.** The pro-analysis report (`ProAnalysisResult`, `lib/trading.ts:780-819`) gains two DOCUMENTARY evidence groups — `regimeLayer` and `mtfLayer` — inside `confluence.groups` (`proanalysis.mjs:108-160` buildConfluence). Both are computed from existing pure engines (regime read + `converge` result), carry honest `source` labels, and are advisory-only. **Verdict thresholds stay byte-identical** (`proanalysis.mjs:443-446`: BUY > 0.2 / SELL < −0.2 / NEUTRAL). No new MODELS (B.3: "documentary, not new MODELS"). |
| REQ-R6 | **Approval gate for execution.** Any proposal to open a paper order from the suite verdicts flows through the human-approval intervention gate: an `interventions` proposal of `source:"trade"` rendered in the notification bell, resolved via the existing respond endpoint; approve → `openPaperTrade` (`trading.mjs:574`) exactly once; reject/ignore → no order. Never auto-execute on any surface (`autopilot.mjs:1006` `running:false, // execution removed — advisory-only`, must stay). |
| REQ-R7 | **Paper income ≠ real PnL.** On every portfolio/metric surface (suite status cards, paper analytics, income overview, account metrics, portfolio aggregate, autopilot demo analytics), paper-ledger PnL and real-venue PnL render as TWO distinctly-labeled buckets and are never summed into one number. The income overview never ingests paper PnL as real income. Absent data stays `n/a`/`source:"none"` — never a fabricated 0 (`accountMetrics.mjs:3-8` contract). |
| REQ-R8 | **No new dependencies, no hardware bets, no claim inflation.** Phase B adds zero npm dependencies and no GPU; RegimeNAS (arXiv 2508.11338, B.2 row) stays a long-term research note. No win-rate claim appears anywhere (R9/R12 + U4FA REQ-WIN). |

## 2. Problem

The trading suite is a wide, honest surface (26 panels, `TradingSuite.tsx:176-206` UNVERIFIED this session — cited from TRADING_SUITE_UPGRADE REQ-11) but its *decision core* is not yet "full-aware":

1. **Regime awareness exists twice, inconsistently, and both are single-timeframe.** `regimeDetection.detectRegime` (`regimeDetection.mjs:7-32`) — ADX + ATR-ratio + Bollinger consensus → `trending/ranging/volatile/breakout`, one timeframe, no confidence floor, no Choppiness, no Supertrend, no state-carry. `indicators.detectMarketPhase` (`indicators.mjs:1277-1345`, cited from U4FA spec :22 — UNVERIFIED this session) — ADX>25 trending / <20 ranging, consumed by `proanalysis.mjs:108-160`. The MTF engine (`mtfConvergence.mjs`) has a graded ADX gate (`adxGate` :300-306, `classifyState` :454-518) but no market-mode classification (TRENDING/RANGING/UNCERTAIN), so its presets run blind to regime: a ranging market can still produce `LONG ONLY` confluence.
2. **The pure-engine seam is the right cut point but is not yet used.** `converge()` already accepts the exact knobs a regime layer needs — per-TF `weights` (`mtfConvergence.mjs:361`), `conservative` HTF veto (:329, :467-468), per-plane `dims` (:261-264) — and `marketConvergence.convergenceSection` (`marketConvergence.mjs:44-93`) is the single live call site. Nothing today computes those knobs from market mode.
3. **Execution is advisory-only with the gate pattern half-built.** `openPaperTrade` (`trading.mjs:574`) is the only order path (§0 guardrail). The U4FA spec (:23) defined the human-approval gate (proposals `source:"trade"` in `interventions.mjs`, bell filter `NotificationCenter.tsx:46,57`, respond at `handlers.mjs:4180`) — but that gate is U4FA-scoped only; suite verdicts from the MTF/regime/fusion layers have no proposal path.
4. **Paper and real money are not explicitly separated in every rendering.** The paper ledger (`PaperOverview`, `lib/trading.ts:83-93`), the income overview (`lib/income.ts:173-179` snapshots incl. `category: "trading"` streams, `streamCatalog.ts:21,155-164`), account metrics (`accountMetrics.mjs`), and the portfolio aggregate (`handlers.mjs:3038`) each render money — nothing today asserts they are never merged, and the income stream catalog already classifies ExpertOption as a `"trading"` stream, which is the exact blur D4 forbids.

## 3. Solution overview

Cut one new seam and reuse three existing ones:

- **NEW pure module `regimeEngine.mjs`** (server, `apps/dashboard/server/services/regimeEngine.mjs`): per-plane indicator reads (Choppiness Index, ATR-ratio, ADX, optional HTF Supertrend), bias-weighted multi-timeframe consensus, TRENDING/RANGING/UNCERTAIN + volatile with confidence/factors, anti-flicker latch, and a pure `regimeKnobs(regime, mode)` function that translates a regime read into the MTF engine's OWN knobs (`weights`, `conservative`). Nothing in `mtfConvergence.mjs` changes (pinned tests untouched — R9/R12).
- **REUSE the convergence call site** (`marketConvergence.convergenceSection`): the regime block is computed from the same de-dup'd plane data and returned as an ADDITIVE `regime` key (`source:"regimeEngine"`); the section may pass `conservative`/`weights` per mode.
- **REUSE the fusion report** (`proanalysis.mjs buildConfluence`): two new documentary evidence groups; verdict logic untouched.
- **REUSE the intervention gate** (U4FA M4 pattern): widen proposal sources to accept suite verdicts; approve → `openPaperTrade`; reject → nothing. Never auto-execute.

Every slice lands green independently (each = one commit-capable unit per the 5-slice plan), the layers work for ALL six cataloged asset classes, and Phase C (push-notification intervention, separate spec `PICC_PUSH_INTERVENTION_v1.md` per eradication plan §3) stays out of scope — the notifier (`notifier.mjs` dispatcher seam) is cited only as the channel Phase C will later use.

## 4. Stories

- **S1 (regime visibility):** a user watching EURUSD in the MTF matrix sees a per-asset regime badge (`RANGING, conf 72`, factors "Choppiness 46; ATR-ratio 0.9; ADX 14") and, when the read is too thin, an honest `unknown` — never a fabricated regime. All six asset classes render the same block; gold, oil, and BTCUSD all get a read (U4FA's class-level `avoid` rows in `REQ-CAL` do not hide the regime from the user).
- **S2 (regime-aware confluence):** in a latched UNCERTAIN regime, the suite's convergence state reads `LONG ONLY (regime UNCERTAIN)` — the same `classifyState` machine, with the HTF veto active and the additive suffix explaining why. Flipping the asset config to `mode:"off"` restores the pre-B read verbatim.
- **S3 (fusion report):** the pro-analysis card shows six evidence groups (trend/momentum/volatility + **regime** + **MTF state** + ensemble) with per-group honesty; the verdict line (`BUY/SELL/NEUTRAL`) is derived exactly as before.
- **S4 (human-approved paper order):** a `LONG ONLY` suite verdict gets an "Approve paper trade" proposal in the bell; the human approves → exactly one `openPaperTrade`; rejects → no order, and the refusal is visible in the proposal ledger. U4FA's own veto tests stay byte-identical.
- **S5 (two buckets everywhere):** the portfolio surface shows `Paper PnL` and `Venue (real) PnL` as separate rows; the income overview shows the ExpertOption connector snapshot under "real venue earnings" and never includes the paper ledger; a summed "total" line exists nowhere on paper/real shared surfaces.

## 5. Design

### D1 — Regime layer: NEW pure `regimeEngine.mjs` (chosen) vs extending `mtfConvergence.mjs`

**Chosen: a new pure sibling module.** Recommended over extending `mtfConvergence.mjs`, and the B.3 "or" is resolved this way:

- `mtfConvergence.mjs` is a pinned pure engine: `mtfConvergence.test.mjs` pins `converge`/`classifyState`/`loadConvergence` behavior across ~35 assertion sites read this session (test file lines 266–861). Any edit to its classification risks silent drift in the 5-tier state machine (the R1 lesson from TRADING_SUITE_UPGRADE: deliberate+counted only).
- Regime detection is a *different concern* (market mode) than confluence (trade state). The engine already exposes the knobs a regime layer needs (`weights`, `conservative`, `dims`) — the new module PRE-COMPUTES them, which keeps the engine tiny and testable (deep-module: `regimeEngine` owns regime policy; `mtfConvergence` owns confluence math).
- The existing `regimeDetection.mjs` (42 lines, community-style vocabulary `trending/ranging/volatile/breakout`, single-TF) becomes a thin adapter over the new engine for its two current consumers (`autopilot.mjs:24` import and `handlers.mjs:3179` `/api/trading/regime` POST) — see B-REG-4. This also resolves the codebase's two-regime confusion (`detectRegime` vs `detectMarketPhase`) by giving the suite ONE regime vocabulary (`TRENDING/RANGING/UNCERTAIN`) with the old vocabulary mapped additively (`regime:'TRENDING', legacy:'trending'`).

Module contract (mirrors `mtfConvergence` purity + voter style):

- `REGIME_DIMS = ["choppiness","atr_ratio","adx","supertrend"]` (per-plane voters, each `{enabled, observed, value, reason}` like `mtfConvergence.mjs:124-125`).
- `MIN_BARS = 30` (matches `mtfConvergence.mjs:30` and `regimeDetection.mjs:8`).
- Constants configurable like `STOCHRSI_TRIGGER_BAND` (`mtfConvergence.mjs:36`): Choppiness band (trend <38.2 / chop >61.8, configurable — per PHANTOM row; the 50 midline is the neutral), ATR-ratio threshold (1.5, matches `regimeDetection.mjs:27`), ADX gates (≥25 trend / <20 no-trend, matches `adxGate` `mtfConvergence.mjs:300-306`).
- `detectRegimeEnhanced({ planes, biasTf, dropOpen })` — per-plane reads → bias-weighted consensus → `{ regime, volatile, confidence, factors, perPlane, latency }`; any plane with <30 bars abstains (``source:"none"`` on that plane, never a guess).
- `regimeKnobs(regimeState, { mode, floors })` → `{ weights|null, conservative:boolean, labels:{suffix}|null }` — the ONLY coupling to `mtfConvergence` (documented, additive, test-pinned).
- Anti-flicker latch: 2 consecutive agreeing reads before a state change counts (mirrors `updateRegimeBreaker` `autopilot.mjs:461-506` and U4FA's regime-confirmation counter; latch state lives in the caller — `marketConvergence` — like `u4faRegimeStates` at `adaptiveConfluence.mjs:648`, tested via `resetU4faRegimeStates`-style hook, not part of a live reset path).
- **UNVERIFIED at spec time:** whether `indicators.mjs` has a Supertrend helper — T-REG-1 confirms; absent → the Voter returns `observed:false` and the HTF-bias dimension honestly abstains (mirror the T2 `fetchOHLCV` confirm-gate pattern from TRADING_SUITE_UPGRADE T2).

### D2 — Soft-blend vs hard-switch: BOTH, soft by default (RegimeSense row)

- Default `mode:"soft"`: regime confidence (posterior-style, RegimeSense) scales the per-plane weights inside the preset ladder and sets `conservative` on latched UNCERTAIN. Implemented purely via `converge()`'s existing `weights`/`conservative` params — **no engine change** (REQ-R3).
- `mode:"hard"`: deterministic switch — TRENDING → preset weights verbatim; RANGING → mean-reversion bias expressed as an ADDITIVE `dims`/weights override (documented policy; reuses the per-plane dims map `mtfConvergence.mjs:261-264,341-342`, never new dimensions); UNCERTAIN → conservative. Hard mode is per-asset config.
- `mode:"off"`: read-only regime display; the section's `converge()` call is byte-identical to today (guards R1-style regressions on `score5`/`quality`/`confidence`).
- Honesty: the modulation is always visible — the additive `regime` block carries `mode`, `confidence`, and `applied:{weights:bool, conservative:bool}`; when `mode:"off"` and latched data exists, the UI still shows the regime read with an "advisory, not applied" tag. A confidence floor (default 60) and the 2-read latch prevent flicker modulation (the `lowVol` precedent `mtfConvergence.mjs:388` and TRADING_SUITE_UPGRADE R2 rate-limit discipline apply to read cadence).

### D3 — Fusion: two documentary layers in `proanalysis.mjs`, verdict untouched

- `buildConfluence` (`proanalysis.mjs:108-160`) gains `regimeLayer` (regime direction + confidence → bull/neutral/bear evidence, weighted) and `mtfLayer` (`converge` result: `compositeDirection`, `score5`, `quality` → evidence) as additional groups inside `confluence.groups`.
- Verdict thresholds (`proanalysis.mjs:443-446`) and the confidence clamp stay byte-identical; new groups only shift the weighted score when their reads exist — absent regime/MTF data returns `observed:false` items that are excluded (`scoreGroup` already skips `bull === 0` items, `proanalysis.mjs:91-100` — zero-weight neutrals never move the score).
- ProAnalysisResult client type (`lib/trading.ts:780-819`) gains OPTIONAL additive fields (`confluence.groups[].layer: "regime"|"mtf"|"trend"|...` — additive, all existing consumers compile unchanged).
- The matrix surface (ConvergencePanel.tsx, globbed this session) renders the two new groups when present; pure layout/additive data.

### D4 — Execution: human-approved paper orders via the intervention gate (never auto-execute)

- Advisory stays the default everywhere (`autopilot.mjs:1006` pinned; §0 guardrail: no live-money orders anywhere — `openPaperTrade` `trading.mjs:574` is the ONLY order path).
- Reuse the U4FA Augmentation-gate pattern (:23): `proposeTrade(...)` in `interventions.mjs` (UNVERIFIED current shape — confirm at B-EXE-2, it exists for the U4FA path), `source:"trade"` proposals rendered in the bell (widen the `NotificationCenter.tsx:46,57` filter — UNVERIFIED lines, cited from U4FA :23), resolved via the existing respond endpoint (`handlers.mjs:4180`). Approve → `openPaperTrade` exactly once; reject → no order.
- Gate hard wires: risk knobs consulted before proposing (`riskPerTradePct` `trading.mjs:81,143` — cited from U4FA :18, UNVERIFIED this session), the verdict's own gates (evGate/winProb/phase chains `adaptiveConfluence.mjs:360,229,383`) are NOT bypassed for suite-sourced proposals, and a per-asset proposal cooldown (15 min, mirror `cooldownMs` `autopilot.mjs:48`) prevents spam.
- **Reading of D4's "paper → real opt-in":** PICC §0 forbids live-money orders; "real" here means the venue DEMO account. The venue-demo placement surface stays EXACTLY as-is: manual, human-clicked, via the existing `/api/trading/demo/place` family (`handlers.mjs:2077`) and autopilot's demo analytics — Phase B welds nothing to it. The gate Phase B builds is paper-only. (Recorded as open question — see §9.)
- No surface ever auto-executes: a lint/grep guard asserts zero auto-order call sites remain (extensionAbsence-style absence test, mirroring `server/__tests__/extensionAbsence.test.mjs`).

### D5 — Paper/real separation invariants (D4)

- One server-side ledger per bucket, keyed separately (paper ledger behind `trading.mjs` paper APIs — exact storage file UNVERIFIED, confirm at B-PAP-1; real = account metrics `accountMetrics.mjs` + demo deals `autopilot.mjs:1001` + connector snapshots `income.ts:173-179`).
- Every shared surface renders `paper` and `real` rows with distinct labels; no surface sums them (list in B-PAP-2; the portfolio aggregate `handlers.mjs:3038` and StatusCards `TradingSuite.tsx:1044-1045` are the two known live candidates).
- The income overview never ingests paper PnL into its stream summary (inverse of the `streamCatalog.ts:21,155-164` "trading" category risk).
- Tests assert two independent buckets exist on every shared surface (B-PAP-4) — the §5 honesty-note mandate.

### D6 — Phase B is independent of Phase C

- Phase C (push-notification intervention, eradication plan §3) is a separate spec (`PICC_PUSH_INTERVENTION_v1.md`) and separate slice; B ships without it. B only CITES the notifier seam (`notifier.mjs` dispatcher + `channels: inApp/webpush/webhook` per eradication plan §3) as the future carrier for intervention pushes — no notifier wiring, no `useWebPush.ts` changes, no VAPID/503 surface work in B (that surface belongs to TRADING_SUITE_UPGRADE T8, listed UNVERIFIED-status this session).
- Delete-zone (§4) respected: nothing removed in B references the extension concepts (the `extensionAbsence.test.mjs` pin keeps passing); `regimeDetection.mjs` is migrated, not deleted (a removal would require ADR).

## 6. Testing strategy

- **Pure unit tests, per slice, per asset class.** `regimeEngine.test.mjs` mirrors `mtfConvergence.test.mjs` discipline: synthetic fixtures per class (forex, crypto, metals, energies, indices, equities) for per-plane voters, consensus, confidence floors, anti-flicker latch, `regimeKnobs` mapping, honest-unknown-on-thin-data. Boundary fixtures in the U4FA factor-boundary style.
- **Additive-only contract tests.** Existing pinned suites must stay green with zero deliberate changes: `mtfConvergence.test.mjs`, `adaptiveConfluence.u4fa.test.mjs` (U4FA-OFF path byte-identical), `resolutionChain.test.mjs`/`marketDataBus` pins, `feedMode.test.mjs`, `extensionAbsence.test.mjs`. Any counted update requires the slice's acceptance text to name it (R1 discipline from TRADING_SUITE_UPGRADE).
- **Two-bucket assertions.** For every surface in B-PAP-2: a test mounts the surface with fixture data where paper and real differ, and asserts two separately-labeled values; a "summed total" assertion is absent by construction (grep-able).
- **Gate tests.** B-EXE: approve → `openPaperTrade` called once with the proposal's payload; reject/ignore → zero order calls; wrong-source proposal filtered before the bell; U4FA veto intact.
- **No claimed win-rates.** Any fixture/test that even mentions a win-rate number carries the honest-band comment or none at all (R9/R12; REQ-WIN ≥200 resolved gate).
- **Full gate before any done-report:** slice-local tests + `npm test` full suite + typecheck (A-4's gate precedent: 205 files / 2098 tests at Phase A close).

## 7. Non-goals

- **No Phase C work** (push-notification intervention; deep HITL with screenshot/timeout; execution confirmation UX) — own spec.
- **No RegimeNAS, no HMM training, no GPU, no new npm dependencies.**
- **No live-money execution anywhere** (§0) and no venue-demo auto-execution (autopilot stays advisory-only, `autopilot.mjs:1006`).
- **No changes to `mtfConvergence.mjs` classification** (state machine, presets, voters) — the regime layer drives it via existing knobs only.
- **No new venue adapters, no new models** (fusion = documentary evidence groups), no 4h-Yahoo (TRADING_SUITE_UPGRADE Decision B), no extension resurrection (delete-zone ADR required).
- **No win-rate claims** in UI/docs/notifications (R9/R12 + REQ-WIN).
- **No weakening of demo/live gates** and no weakening of pinned tests without a counted, named update.

## 8. Tasks (5 slices; every task = one commit-capable unit, lands green)

### Slice B-REG — Regime layer (D1/D2)

- **B-REG-1 — `regimeEngine.mjs` per-plane voters.** New `apps/dashboard/server/services/regimeEngine.mjs`: `REGIME_DIMS`, `MIN_BARS`, configurable constants (Choppiness band 38.2/61.8, ATR-ratio 1.5, ADX 25/20), four voters (choppiness, atr_ratio, adx, supertrend — supertrend `observed:false` when `indicators.mjs` lacks it; CONFIRM at execution, mirror T2's `fetchOHLCV` gate). **Acceptance:** `regimeEngine.test.mjs` unit tests per voter with per-class fixtures; voter abstention (thin data) returns `{observed:false, reason}` and never a value; no network I/O in the module.
- **B-REG-2 — consensus + state + latch.** `detectRegimeEnhanced({planes, biasTf})` → TRENDING/RANGING/UNCERTAIN + volatile/confidence/factors/perPlane; anti-flicker latch (2 readings) with a `resetRegimeLatches()` test hook (mirrors `resetU4faRegimeStates` `adaptiveConfluence.mjs:649`). **Acceptance:** consensus tests (all-trend → TRENDING conf ≥80; mixed planes → factors carry the conflict; all-flat → RANGING; thin → `unknown`); latch test flips require 2 consecutive reads; `legacy` label present (`trending/ranging/volatile/breakout` mapping).
- **B-REG-3 — `regimeKnobs` + wiring into `marketConvergence`.** `regimeKnobs(state, {mode:"soft"|"hard"|"off", floors})` → `{weights|null, conservative, suffix}`; `convergenceSection` (additive `regime` key: `{regime, volatile, confidence, factors, perPlane, mode, applied}`; conservative/weights passed when applied). **Acceptance:** marketConvergence test with a fixture latch asserts (a) `mode:"off"` → converge payload byte-identical to pre-B, (b) `mode:"soft"` → weights scaled by confidence, (c) latched UNCERTAIN → `conservative:true` + suffix in state; `score5`/`quality`/`confidence` null-on-no-data unchanged; liveEO absent → `source:"none"` regime block, no crash.
- **B-REG-4 — regime-engine adoption of `/api/trading/regime` + `regimeDetection` adapter.** The POST endpoint (`handlers.mjs:3174`) returns the new block ADDITIVELY beside the legacy fields; `regimeDetection.detectRegime` delegates to `regimeEngine` (same outputs, no behavior change for `autopilot.mjs:24` and `regimeDetection.test.mjs` — adapter counts as deliberate, named update). **Acceptance:** `handlers` test — additive keys present, legacy keys byte-identical for the same candles; `regimeDetection.test.mjs` untouched green via delegation; `extensionAbsence.test.mjs` still green.
- **B-REG-5 — UI regime badge.** ConvergencePanel.tsx (and the pro-analysis card via D3 separately): renders the additive regime block with honesty (`unknown` when null, `advisory, not applied` in `mode:"off"`). **Acceptance:** component test with fixtures — badge renders regime+conf+factors; null block → "unknown", not 0/garbage; `mode:"off"` tag shown.

### Slice B-FUS — Fusion (D3)

- **B-FUS-1 — two evidence groups in `buildConfluence`.** `proanalysis.mjs:108-160` gains `regimeLayer` + `mtfLayer` groups (each `{name, weight, bull, read, source}`; source = `"regimeEngine"` / `"liveEO-buffers"`). **Acceptance:** unit tests — group present with honest `bull:0/observed:false` when inputs absent; scoreGroup skips them (sum unchanged); `verdict` thresholds byte-identical on the existing `proanalysis` fixtures (counted: the existing suite stays green).
- **B-FUS-2 — data wiring.** `proAnalyzeSymbol` (`proanalysis.mjs:623`) and `proAnalyzeExpertOption` (:647) feed the two layers: regime via `detectRegimeEnhanced` over the available planes; MTF via `converge` over the same. **Acceptance:** fixture tests per path (Yahoo-aged intraday and liveEO buffers); slow/absent data → `observed:false` groups, never a fake read; no new network calls beyond what the report already makes.
- **B-FUS-3 — client type + card.** `ProAnalysisResult` (`lib/trading.ts:780-819`) additive `layer` tags; ProAnalysisCard renders the matrix. **Acceptance:** component test with fixtures renders 6 groups; old fixtures (5 groups) still render (optional fields); zero changes to `confluence.verdict` consumers.

### Slice B-EXE — Execution path (D4)

- **B-EXE-1 — suite proposal factory.** `proposeTrade({assetId, side, reason, verdict, source})` beside the U4FA proposal path (interventions.mjs — confirm current shape first). **Acceptance:** unit test — proposal rows carry `source:"trade"` + human-readable `reason` from the suite verdict; defaults sane (amount from `riskPerTradePct` context, `trading.mjs:81,143` cited).
- **B-EXE-2 — bell filter widened.** NotificationCenter accepts `source:"trade"` proposals from the suite (currently capture-hard-filtered per U4FA :23). **Acceptance:** component test — suite proposal renders in the bell; capture-only fixture unchanged; U4FA proposals unchanged.
- **B-EXE-3 — approve → exactly one paper order.** Respond (`handlers.mjs:4180`) approval calls `openPaperTrade` (`trading.mjs:574`) once; reject → none; duplicate respond → no double-order guard. **Acceptance:** server test — approval path asserts single call with proposal payload; reject path asserts zero calls; idempotence test; `adaptiveConfluence.u4fa.test.mjs` untouched green.
- **B-EXE-4 — no-auto-execute absence test.** New `server/__tests__/executionAbsence.test.mjs` pins ZERO auto-order call sites in suite sources (mirror `extensionAbsence.test.mjs` pattern: read the real source of the 10 wired modules, assert no `placeDemoTrade`/order call outside the human-approval path). **Acceptance:** absence test green; `autopilot.mjs:1006` `running:false` assertion still holds.

### Slice B-PAP — Paper income separation (D5)

- **B-PAP-1 — ledger audit.** Confirm the paper-ledger storage shape behind `trading.mjs` paper APIs (UNVERIFIED at spec time) and enumerate real-venue money sources (account metrics, demo deals, connector snapshots). **Acceptance:** audit note checked into the slice commit; no code change if separation already holds server-side.
- **B-PAP-2 — surface split.** Split/verify every shared surface renders two buckets: status cards (`TradingSuite.tsx:1044-1045`), paper analytics (`:1951-1960`), income overview (`income.ts:173-179`), account metrics, portfolio aggregate (`handlers.mjs:3038`), autopilot demo analytics (`handlers.mjs:2145`), trading ledger stats (`handlers.mjs:1259`). **Acceptance:** per-surface fixture test — two separately-labeled rows; no summed total on paper/real surfaces; grep-auditable label constants (`paperIncome`, `realPnl`).
- **B-PAP-3 — income-overview guard.** The income summary never ingests paper PnL (streams remain user-created/connector-sourced; `source:"none"` honesty contract maintained, `accountMetrics.mjs:3-8`). **Acceptance:** server test — paper ledger delta does NOT move `summary.lifetime`/`monthly`; a `trading`-category stream snapshot renders under real venues only.
- **B-PAP-4 — two-bucket regression tests.** New `server/__tests__/paperRealSeparation.test.mjs` (+ component twins) asserting distinct buckets on every shared surface. **Acceptance:** the §5 honesty-note mandate — "tests must assert the two buckets exist separately" — is satisfied and grep-able.

### Slice B-SPEC — this document

- **B-SPEC-1 — this file.** **Acceptance:** written under `docs/specs/PICC_TRADING_SUITE_REBUILD_v1.md`; D4/D5 mapping present; every claim grounded or marked UNVERIFIED; 5 slices decomposed into commit-capable units; open questions listed for the human.

## 9. Risks

| # | Risk | Guard |
|---|------|-------|
| R1 | **Regime modulation silently changes the live MTF read** (weights/conservative shift `score5`/`quality`/`confidence` the UI already shows) without a visible reason. | D2's `applied` block + suffix on state + `mode:"off"` escape hatch; B-REG-3 acceptance pins the off-payload byte-identical; UI shows "advisory, not applied" when off. **Most likely to bite.** |
| R2 | **Three regime vocabularies drift** (`detectRegime` legacy, `detectMarketPhase` phase, new TRENDING/RANGING/UNCERTAIN). | B-REG-4 delegates legacy vocabulary additively (`legacy` label); `detectMarketPhase` stays as proanalysis's phase field (fusion keeps both, labeled); a follow-up unification task is recorded, not executed in B. |
| R3 | **Fusion groups change verdicts** despite "documentary" intent. | B-FUS-1 pins `verdict` thresholds byte-identical; neutral items excluded by `scoreGroup` (`proanalysis.mjs:91-100`); existing proanalysis suite green with counted zero updates. |
| R4 | **Gate approval path weakens U4FA veto / auto-executes.** | B-EXE-4 absence pin + `adaptiveConfluence.u4fa.test.mjs` byte-identical + approve-once/reject-zero tests. |
| R5 | **Paper/real merge regressions on old surfaces.** | B-PAP-2/3/4 two-bucket assertions per surface; income summary untouched by paper ledger test. |
| R6 | **Choppiness/Supertrend availability in `indicators.mjs`.** | Supertrend voter `observed:false` abstention; Choppiness computed in-module from `candleArrays`-style arrays (pure, `indicators.mjs:17` exports precedent) — confirm at B-REG-1. |
| R7 | **All-classes coverage busts on exotic classes** (VIX, energies, equities have thin multi-TF data). | Honest `unknown` + per-class fixtures in pure tests; U4FA `REQ-CAL` avoidance does NOT hide regime (S1 acceptance). |

## 10. Honesty notes (demo/live gates touched)

- **Demo/live gates:** none weakened. `autopilot.mjs:1006` (`running:false`, advisory-only) and `openPaperTrade`-only (§0) remain pinned by B-EXE-4's absence test. The U4FA veto chain and `adaptiveConfluence.u4fa.test.mjs` stay byte-identical.
- **Fabricated-state risks:** (1) regime reads on thin data — guarded by `MIN_BARS` abstention and `unknown` rendering (REQ-R1/R2); (2) fusion groups on absent MTF/regime data — `observed:false` exclusion (D3); (3) proposal spam — cooldown + reason-required (B-EXE-1); (4) paper/real sums — forbidden by construction with two-bucket tests (B-PAP-4).
- **UNVERIFIED citations carried into tasks** (each is a confirm gate): `TradingSuite.tsx:176-206` panel stack line range (per TRADING_SUITE_UPGRADE REQ-11/T12); `interventions.mjs` proposal shape + `NotificationCenter.tsx:46,57` filter (per U4FA :23); `trading.mjs:81,143` risk clamp (per U4FA :18); `indicators.mjs` Supertrend helper; paper-ledger storage file name; `indicators.mjs:1277-1345` detectMarketPhase ranges; VIX/equity Yahoo intraday coverage under `yahooSymbolFor` (`assetCatalog.mjs:133-175` — equities pass through untouched, verified; VIX `^VIX` maps, verified).

## 11. Open questions for the human

1. **"Paper → real opt-in" reading (D4).** This spec interprets "real" as the venue DEMO account (PICC §0 forbids live-money orders; `openPaperTrade` is the only order path). Phase B builds the human-approved gate for PAPER orders only; venue-demo placement stays the existing manual human-clicked surface (`/api/trading/demo/place`). Confirm this reading — if "real" ever means live money, that is out of scope for PICC entirely (ADR-level decision).
2. **`regimeEngine.mjs` as new sibling vs extending `mtfConvergence.mjs`** — recommended and spec'd as new sibling (R1-style pin preservation). Confirm, or the executor stops at B-REG-1.
3. **Soft-blend default-on** with confidence floor 60 + additive labeling + `mode:"off"` escape hatch — confirm the UX default (affects what users see on the MTF matrix after B lands).

## Resolution (2026-09-19)

**Disposition:** SUPERSEDED. The rebuild's shipping slices (D4/D5) LANDED and are in the tree; the spec's forward-looking execution/decision-core direction is superseded by the current rebuild.

**Evidence (landed):** `bf99e09` "feat(suite): regime/fusion/execution gates and paper/real money separation". On disk: `server/services/regimeEngine.mjs` (D1, B-REG), `proanalysis.mjs:250,761` regimeLayer/mtfLayer groups (`source:"regimeEngine"` / `"liveEO-buffers"`; D3, B-FUS), `server/__tests__/paperRealSeparation.test.mjs` + `executionAbsence.test.mjs` (D4/D5, B-PAP/B-EXE), `docs/specs/notes/B-PAP-1-paper-ledger-audit.md` (B-PAP-1). The spec's §0 committed quote ("U4FA is the decision engine; this build enhances it") no longer governs.
**Evidence (superseded):** `docs/specs/notes/B-IND-0-current-engine-coverage-2026-09-19.md` (ADX keep, VWAP-4H keep, EMA 9/21 keep, U4FA verdict relabeled → demoted from the decision path), ADR-0003 (15s execution pipeline + 15s HUD inside the 60s engine core), ADR-0004 (U4FA `verdict` retires; parallel soak then flip), and `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` (Status: Draft for execution, 2026-09-19) — which names this pre-rebuild era explicitly.

**Successor:** `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` (+ ADR-0003/ADR-0004). Suite UI continues on under the reskin (`6bfc763`); regime/fusion/paper-separation survive as landed machinery.