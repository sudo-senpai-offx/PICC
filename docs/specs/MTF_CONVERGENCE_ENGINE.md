# Multi-Timeframe Convergence Engine — spec v1

> **Status:** Approved (planning artifact — no code changed by its author)
> **Date:** 2026-08-28
> **Extends:** the slice-7 completion of `docs/specs/NEXT_WAVE_generalization.md` (committed at HEAD `ca5cd89`). This spec builds on the **existing** `multiTimeframe.mjs` confluence foundation rather than replacing it from scratch, and adds the professional MTF methodology the audit confirmed the current engine lacks.
> **Supersedes:** nothing — the current skeleton engine is preserved as a compat layer (see §Design). No part of `multiTimeframe.mjs`, `adaptiveConfluence.mjs`, `modelMatrix.mjs`, the SSE suite, or the alert/notifier chain is removed.
>
> **Grounding rule:** every claim is traced to a file:line read during the authoring session. Anything not verified is marked `UNVERIFIED`. Sources: `docs/mtf-convergence-research.md` (the research decisions that MUST be baked in), `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, `docs/COMPLIANCE.md`, and the current HEAD file tree.

---

## 0. Verified current state (ground truth, this session)

| Area | Verified claim | Source |
|---|---|---|
| MTF engine (skeleton) | `multiTimeframe.mjs` exists: `TIMEFRAME_SECONDS` 8 TFs (1m…1w), `TRADING_STYLES` **only 3** (scalping/dayTrading/swing — **no Position preset**), `multiTimeframeConfluence` (:170-288) computes per-TF `computeIndicatorDashboard`+`extractSignal` → agreement/weighted score/confidence `0.6·agree+0.4·strength` (:244), `quickMtfCheck` only 5m+15m (:294-327). Output direction vocabulary is `up/down/flat` (:237); **not** the NO-TRADE/WAIT/ONLY/BIAS state machine. | `apps/dashboard/server/services/multiTimeframe.mjs:21-24,27-31,170-288,294-327` |
| MTF indicator battery | Every pure indicator the new engine needs exists in `indicators.mjs`: `ema` :55, `aggregateCandles` :156, `alligator` :184, `adx` :353, `rsi` :396, `stochRSI` :430, `stochastic` :453, `macd` :477, `bollinger` :622, `fractals` :675, `swingPoints` :695, `computeIndicatorDashboard` :1102-1265, `detectMarketPhase` :1276. No external indicator package (the header declares "pure, dependency-free" :1-8). | `apps/dashboard/server/services/indicators.mjs` (verified by grep; lines above) |
| StochRSI semantics (existing) | `computeIndicatorDashboard` already reads StochRSI with the **canonical 0.8/0.2** extremes (`>= 80` overbought, `<= 20` oversold) — the research-correct convention, so the new engine inherits it and must NOT introduce a 60/40 zone. | `indicators.mjs:1202` |
| ADX semantics (existing) | `detectMarketPhase` already uses ADX `>25` strong / `<20` weak / 20–25 "transitional" for the trend-mode gate; `detectMarketPhase` returns `trendStrengthLabel` with a `>40` "very strong" tier. The new engine can reuse this regime lexicon for the graded ADX gate. | `indicators.mjs:1303-1304,1362` ; `multiTimeframe.mjs:249-260` (regimeHint path) |
| Data fan-in | `getBestCandles(assetId,{timeframe,count})` at `marketDataBus.mjs:91-132` is the single candle entry point; returns `{candles, source, stale, timeframe}` with honest `source:"none"` (never throws on absence). Broker default registry `getCandles: () => []` but `availableTimeframes` full 12. | `server/services/marketDataBus.mjs:91-132` ; `server/services/brokers/index.mjs:38-40` |
| Live buffer coverage | `liveEO.mjs` `WATCH_PERIODS = [60,300,900,3600]` — **only 1m/5m/15m/1h held live**; 30m/4h/daily+ must be aggregated (M1→higher via `aggregateCandles`) or fetched (Yahoo). `cascadeBar` folds ticks into buffers (:217-229); `fetchAssetCandles` (:940-965) on-demand pulls. | `server/services/liveEO.mjs:34,217-229,940-965` |
| Daily+ data | `yahooAdapter.mjs` `availableTimeframes()` returns `[86400,604800,2592000]` (1D/1W/1M), `getCandles` :25. **ccxt/paper adapters currently return `[]`** from `getCandles` (no market data; trade-sim / poll-only). | `server/services/brokers/yahooAdapter.mjs:25,35-36` ; `brokers/ccxtAdapter.mjs:48-53` ; `brokers/paperAdapter.mjs:19-21` |
| Parallel consensus engine | `modelMatrix.mjs` `MODELS` = **9 pure `(candles)→vote` models** at :271-281 (trend/momentum/rsi/breakout/macd/montecarlo/pressure/stoch/avwap); `computeModelMatrix` requires **≥40 closes** (:391), fuses weighted votes into `{direction,confidence,agree,total}` (:410-460) with prune/decay/participation shaping (:399, :415-439). | `server/services/modelMatrix.mjs:271-281,387-461` |
| Verdict engine | `adaptiveConfluence.mjs` `evaluateAsset` (:370+) fuses `quickMtfCheck` (:396) with an **MTF veto**: `mtfBlock = mtf.total>=2 && mtf.agree===0` blocked from TRADE (:451-452). Gates on score/winProb/priceRR/evRR/payout (:441-447); `CANDIDATE_EXPIRIES=[60,120,300,900]` (:31). | `server/services/adaptiveConfluence.mjs:31,370-460` |
| Signal heartbeat | `signalEngine.mjs` advisor runs on `CHECK_INTERVAL_MS = 45_000` (:24) and calls `dispatchAlert` (notifier) directly (:22,68,96,122,132). | `server/services/signalEngine.mjs:24,68` |
| Notifier (email removed) | **Historical record:** `notifier.mjs` dispatched to 3 channels — in-app, webpush, email (Resend). **Email channel removed 2026-09-02** (see `PICC_NOTIFICATION_AND_ALERT_UX_v1.md` T9); the notifier now ships exactly **in-app, webpush, webhook**, and results still record sent/skipped/failed/off — never fabricated. | `server/services/notifier.mjs` |
| Alert engine (no MTF condition) | `alertEngine.mjs` conditions are **price-only** (`price_above/below/crossing_up/crossing_down/pct_change_up/down` :47, evaluator :129-156); emits via `onAlert` listeners (:189-192), `startAlertEngine` 2s (:195). **No convergence-score condition exists.** | `server/services/alertEngine.mjs:47,129-156,189-203` |
| Backtest (no technical strategy backtester) | `prediction.mjs backtestModels` (:192-235) is **directional walk-forward only**, keyed to the **8 legacy named models** incl. `arima/prophet/lstm/garch` (:194) — those names are forbidden for new work. `accuracyLedger.mjs backtestGates` (:239-377) is the honest realized EV validator (buckets engine-vs-demo by expiry). **No vectorized indicator/strategy backtester exists** — net-new for state win-rates. | `server/services/prediction.mjs:192-235` ; `server/services/accuracyLedger.mjs:239-377` |
| Delivery / SSE | `/api/trading/realtime` SSE rides a `suite` event (handlers :1179-1191, `suiteTimer` 5s) from `realtimeSuite.mjs` `SECTIONS` (`signals` ttl 6s :20, `intel` ttl 8s :22). A new convergence section can be added to `SECTIONS` with a distinct TTL. | `server/handlers.mjs:1179-1191` ; `server/services/realtimeSuite.mjs:16-39` |
| Frontend surface | `ConfluencePanel.tsx` already renders `d.mtf.agree/total` (:43) and gates (:58-64). `LiveDecisionsPanel.tsx` renders verdicts/gates/reasons. Shared types live in `src/lib/trading.ts` (`LiveDecision` equivalents via `liveTrading.ts`; `ModelMatrixResult` :1170-1181). New MTF state vocabulary will be added to these type files. | `apps/dashboard/src/components/ConfluencePanel.tsx:43,58-64` ; `LiveDecisionsPanel.tsx:19-67` ; `src/lib/trading.ts:1160-1186` |
| Tests | **77 test files / 759 tests pass** (run this session via `npx vitest run`, no-jsdom, pure-logic). Existing `multiTimeframe.test.mjs` covers `selectStyle`, `TIMEFRAME_SECONDS`, `TRADING_STYLES`, and confluence scoring. Server test convention: `server/__tests__/<name>.test.mjs`. | `npx vitest run` (this session) ; `server/__tests__/multiTimeframe.test.mjs:1-60` |
| **Correction vs user doc** | (a) The claimed "MTF engine" **exists as a skeleton** — the audit's 8-TF/3-style engine is real but is NOT the 5-tier framework in the user's doc. (b) The "8-model ARIMA/Prophet/LSTM/GARCH" list is the **legacy prediction path** only, not the MTF engine. (c) The "60/40 StochRSI zone" is **RSI-preset folklore** (research Q3) — the existing engine already uses canonical 0.8/0.2 and must not introduce 60/40. (d) Test count is **759, not 623**. | `prediction.mjs:194` ; `indicators.mjs:1202` ; `npx vitest run` |
| **Correction vs audit (verification)** | The audit's stated "email: only if exists — verify" resolves to **email channel exists** (notifier.mjs:8,:149). The audit's `evaluateAsset`/`quickMtfCheck`, `computeModelMatrix >=40`, and all indicator :line references **all matched what I read** — no disagreement found. | `notifier.mjs:8,149` |

---

## 1. Requirements (each testable)

**R1 — Five-tier preset engine.** A pure `mtfConverge()` function classifies each preset's ladder (Scalping M1→M5→M15; Intraday M5→M15→H1; Swing/Intraday M15→H1→H4; Swing H1→H4→D1; Position D→W→M) into the semantic planes `context / bias / swing / confirm / entry` and emits, per preset, one **state** plus a convergence score.

**R2 — Six configurable indicator dimensions per timeframe.** `trend` (triple EMA = ema20/50/200 alignment), `momentum` (RSI 14 + MACD histogram), `market_structure` (HH/HL-LH/LL swing structure), `trend_strength` (ADX gate), `momentum_trigger` (StochRSI %K/%D cross), `volatility` (Bollinger midline). Each plane can be enabled/disabled per timeframe; a disabled dimension contributes neither +1 nor 0 to that timeframe's sign (it is excluded, not zero-voted). Every dimension reports its observed inputs so "configured-but-not-observed" never reads as a signal.

**R3 — Sign-sum convergence (conformance).** Per verified convention, each active dimension votes **+1/0/−1**; the timeframe's score is the sign-sum of its active dimensions; the composite is the **weighted** sum across timeframes (default weights equal → pure sign-sum; presets may overweight bias/HTF). Converge score = aligned timeframes / active timeframes.

**R4 — State vocabulary + why.** Output is exactly one of `NO TRADE / WAIT / LONG WATCH / SHORT WATCH / LONG ONLY / SHORT ONLY / LONG BIAS / SHORT BIAS`, plus a human `why` reason string (e.g. `H1/4H conflict`, `ADX<20 no trend`, `low volatility`, `strong bull confluence`, `bear regime only`). Each state must be reachable by a deterministic pure test.

**R5 — Convergence score / quality / confidence.** Emits (a) a 5-scale score `5/5…0/5` = `round(5 × aligned/active)`, (b) a quality score `1–10`, and (c) a confidence `%.` Quality and confidence must degrade honestly when data is thin (fewer than `MIN_BARS` per plane → that plane abstains and is excluded from `active`; `no samples → "—"`, never zero).

**R6 — ADX graded gating.** Per research decision #3, ADX on the **bias plane** (the mid/higher TF) is a direction-blind trend-mode gate, not a signal: `≥40` extreme, `≥25` established, `≥20` forming, `<20` no-trend. `20–25` is treated as neutral (gray zone). These thresholds ship as the `detectMarketPhase`/`trendStrengthLabel` reuse, labelled "convention attributed to Wilder (1978)" not "per Wilder".

**R7 — StochRSI trigger correction.** `momentum_trigger` fires on a **%K/%D cross** with a `0.40/0.60` **trigger line**, explicitly labelled a **design choice** — never on an overbought/oversold "0.60–0.40 zone". Overbought/oversold stays canonical `0.8/0.2` (reuse `indicators.mjs:1202`). If an intraday preset wants a 60/40 band, that is **RSI** 60/40 (as in giua64 Intraday), not StochRSI.

**R8 — Conservative-mode HTF veto.** In `conservative` mode, a conflict between the two highest planes (e.g. H1 vs H4 disagree → `NO TRADE`) vetoes the lower planes even if the entry plane is aligned. This is the igaudette Conservative behavior.

**R9 — Repaint-safe, closed-bar invariant (evidence-backed).** Every plane computes on **closed bars only** (`[1]`-equivalent = last *closed* bar at each TF, dropping any forming live bar). Planes are additionally **time-aligned**: a lower plane's entry read may only use each higher plane's last closed bar *as of the observation time* — never a higher-TF bar that is still forming or that closes after the decision point. Rationale is measured, not theoretical: Sobreiro et al. (2026) found HTF-alignment look-ahead inflates ROC-AUC by ~0.20 points (`docs/mtf-convergence-research-b-backtests.md` §B4). A static test must prove the engine never consumes the in-flight bar for its final state.

**R10 — Data-availability fallbacks.** The engine is data-source-agnostic: 30m/4h assembled from M1 via `aggregateCandles` (`indicators.mjs:156`); daily+ fetched from Yahoo (`yahooAdapter.mjs:36`); missing planes **abstain** and are removed from `active`, never zero-filled. `source`/`stale` per plane is reported honestly.

**R11 — Conditional convergence alerts.** A new alert condition `convergence_above` (and/or reuse of `dispatchAlert`) fires push/email/in-app **only** when a watched asset's convergence score (or state) crosses a user-set threshold. No alert fires when the channel is unconfigured (notifier already records `skipped`, not `sent`).

**R12 — Honest validation loop.** The engine's own hit-rate/win-rate claims come **only** from realized outcomes via the `accuracyLedger`-style bucketing (reuse `backtestGates` pattern :239-377) and, optionally, a new vectorized technical backtester. No "MTF alignment ⇒ +X% win rate" claim is shipped.

---

## 2. Design

### 2.1 Placement decision: new module, preserved compat layer

The existing `multiTimeframe.mjs` is a working skeleton consumed by `adaptiveConfluence.mjs` (`quickMtfCheck` at :29, `evaluateAsset` :396, and the `mtfBlock` veto :451-452) and by `ConfluencePanel`-adjacent UI. To avoid breaking those seams, the new engine is a **new pure module `server/services/mtfConvergence.mjs`**, and `multiTimeframe.mjs` is left untouched (a thin re-export alias may be added if a single import site is desired, but no existing consumer is rewritten in this wave). This is extend-not-replace.

`mtfConvergence.mjs` reuses `computeIndicatorDashboard`, `adx`, `stochRSI`, `ema`, `bollinger`, `swingPoints`, `detectMarketPhase`, `aggregateCandles` from `indicators.mjs` and `getBestCandles` from `marketDataBus.mjs` for data — it does **not** reinvent math.

### 2.2 The six dimensions are NOT modelMatrix "models"

Constraint: "max 2 new pure `(candles)→vote` models per wave"; "convergence dimensions are not new models unless they produce votes." **Decision:** the six per-TF dimensions are **feature computations inside `mtfConvergence.mjs`, not entries in `MODELS`** (`modelMatrix.mjs:271-281`). They do not emit standalone directional votes with weight adaptation and are never fed to `computeModelMatrix`. This wave adds **zero** new models to `MODELS`. The existing `computeModelMatrix` consensus may be surfaced **alongside** the MTF read in the UI (they are parallel, complementary lenses) but never merged numerically.

### 2.3 Per-plane indicator plane → sign

For each active (enabled, data-sufficient) timeframe, each enabled dimension produces `+1/0/−1`:

| Dimension | Source | +1 / −1 / 0 definition (all on closed bars) |
|---|---|---|
| `trend` | `dash.ema.read` (`indicators.mjs:1171-1173`) | bullish/bearish/mixed alignment → +1/−1/0 |
| `momentum` | `dash.rsi.value` + `dash.macd.hist` (`:1138,1144`) | RSI>50 & hist>0 → +1; RSI<50 & hist<0 → −1; else 0 |
| `market_structure` | `swingPoints` (:695) HH/HL-LH/LL | higher-low/higher-high → +1; lower-high/lower-low → −1; else 0 |
| `trend_strength` | `dash.adx` (`:1149,1199`) | ADX≥25 gate; direction from +DI vs −DI; ADX<20 → 0 with "no trend" reason |
| `momentum_trigger` | `dash.stochRSI` `k`/`d` (`:1148,1202`) | %K crosses %D within trigger line 0.40/0.60 → +1/−1; else 0 (design choice label) |
| `volatility` | `dash.bollinger.mid` + `percentB` (`:1139-1142`) | price above mid & %B<0.8 → +1; below mid & %B>0.2... (pull from band) → +1/−1/0 |

The timeframe sign = sum of its enabled dimensions' votes (each clipped to ±1). Per research decision #1, **equal-weight sign-sum is the default base**; weights are a preset option (`R3`), not the core formula. Note on softness (verified 2026-08-28): the only direct fuzzy-vs-binary DSS comparison found (Kondruk & Hetsko 2025, `docs/mtf-convergence-research-a-academic.md` §C2) shows soft/weighted aggregation beats hard binary gates — the engine's confidence/quality shaping (R5) is where that softness lives, not in the base sign-sum.

### 2.4 State machine (per preset)

Composite score `S` (weighted across timeframes, normalized to [−1,+1]) + plane alignment → state:

| State | Condition (deterministic; exact bands fixed in tests) |
|---|---|
| `NO TRADE` | Conservative-mode HTF conflict, OR composite in the no-trend band (bias-plane ADX<20), OR zero active planes |
| `WAIT` | Weak alignment, one step below WATCH (e.g. aligned TFs under threshold) |
| `LONG/SHORT WATCH` | Directional lean established but not confirmed across the ladder |
| `LONG/SHORT ONLY` | Strong alignment, higher planes agree, gated by ADX trend-mode |
| `LONG/SHORT BIAS` | Full confluence: all active planes aligned + trend-moded good |

`why` reasons accumulate from: plane conflicts (`H1/4H conflict`), ADX (`ADX<20 no trend`), volatility (`low volatility`), regime (`bear regime only`), and a confirmation string (`strong bull confluence`). Advisory-only: states never map to order intent.

### 2.5 Five-tier presets + weights

| Preset | Entry | Confirm | Bias | Semantic planes | Default weight (bias>confirm>entry) |
|---|---|---|---|---|---|
| Scalping | M1 | M5 | M15 | entry/confirm/bias | e0.3 c0.3 b0.4 |
| Intraday | M5 | M15 | H1 | entry/confirm/bias | e0.3 c0.3 b0.4 |
| Swing/Intraday | M15 | H1 | H4 | entry/confirm/bias | e0.3 c0.3 b0.4 |
| Swing | H1 | H4 | D1 | entry/confirm/bias | e0.25 c0.3 b0.45 |
| Position | D | W | M | entry/confirm/bias | e0.2 c0.35 b0.45 |

The five semantic labels (`context/bias/swing/confirm/entry`) map onto the low→high ladder; each preset binds its three TFs to `entry/confirm/bias`. `swing` and `context` are the planes "above" bias — present in the ladder conceptually; the implementation exposes them as labels and, for the two highest presets, may compute an optional top context plane when data exists (default off to keep parity + data-safety).

### 2.6 ADX graded gate + StochRSI trigger

Reuse `detectMarketPhase`'s ADX tiers (`indicators.mjs:1303-1304,1362`): `≥40` extreme / `≥25` established / `≥20` forming / `<20` no-trend; `20–25` gray → neutral. This is the `R6` gate, direction-blind-by-definition (ADX has no sign — direction comes from `+DI/−DI` at `indicators.mjs:378-380`).

StochRSI overbought/oversold stays canonical `0.8/0.2` (`indicators.mjs:1202`). `momentum_trigger` is a **%K/%D cross** gated to a `0.40/0.60` trigger band, explicitly labelled a design choice (research Q3). No `0.60–0.40` "zone" is shipped as a sourced rule.

### 2.7 Data sourcing / repaint safety

1. Per plane: try the live buffer for TF ∈ {60,300,900,3600} (from `liveEO.mjs:34`); for other TFs (1800/14400/86400/604800/2592000) aggregate from M1 via `aggregateCandles` or fetch via `getBestCandles`→broker (Yahoo for daily+).
2. Compute on `[0..N-2]` (drop index `N-1` if it is a forming/in-flight bar) — the closed-bar invariant (`R9`), matching the research note's `[1]`+`lookahead` repaint-safe pattern.
3. A plane with `< MIN_BARS` (default 30) abstains and is removed from `active`; its `score:null` is reported with `source`/`stale` per plane.

### 2.8 Where it plugs in

- **Server:** `mtfConvergence.mjs` is called from (a) a new `GET /api/trading/convergence?assetId=…&preset=…` on-demand handler, and (b) a new `convergence` section in `realtimeSuite.mjs SECTIONS` (`realtimeSuite.mjs:16-39`) streamed through the existing `/api/trading/realtime` `suite` event (handlers :1179-1191).
- **UI:** a `ConvergencePanel.tsx` (or an extension of `ConfluencePanel.tsx`) renders the per-plane matrix + state + `why` + 5-scale/quality/confidence. Types added to `src/lib/trading.ts` (and `liveTrading.ts` where `LiveDecision` lives) per `ModelMatrixResult`-style :1170-1181.
- **Notifier:** a convergence evaluator calls `dispatchAlert({kind,assetId,title,body,details})` (`notifier.mjs:156`) — the same seam `signalEngine.mjs` uses (:68). Alert condition `convergence_above` in `alertEngine.mjs` (new switch case near :129-156) or a parallel evaluator; channels stay in-app/webpush/email with honest skipped/sent recording (:163-168).
- **Adaptive fusion (optional follow-on):** expose `mtfConvergence` state to `adaptiveConfluence.evaluateAsset` as a richer replacement for `quickMtfCheck`'s 2-TF read (:396) — but this is flagged as a **later, separate slice** so the pure module can land and be tested in isolation first.

### 2.9 Honest validation loop

- **Realized outcomes:** when the engine (or the existing decision engine) reaches a directional write-in, log it and resolve against realized price via the `accuracyLedger` pattern (`recordDecision`/`backtestGates` :239-377). Bucket convergence-state win-rates (state × preset) so the engine's own hit-rate is **observed**, never asserted.
- **Optional vectorized technical backtester:** new pure `technicalBacktest.mjs` that walks a candle series, fires the engine's state at each closed bar, and buckets forward hit-rates per state. **Flagged stretch/optional**: it is net-new and the biggest effort; if it balloons the wave, it is deferred to a follow-on slice (slice 9b).

---

## 3. Non-goals (explicit out of scope)

- **No execution/order intent anywhere.** States and reasons are advisory; the engine never emits a trade message (ARCHITECTURE "No execution" :195, COMPLIANCE "does not execute" :10).
- **No new models added to `modelMatrix.mjs`** `MODELS` (:271) — the six dimensions stay inside `mtfConvergence.mjs`. Zero new pure `MODELS` entries this wave.
- **No ARIMA / Prophet / LSTM / GARCH** anywhere (the legacy prediction names at `prediction.mjs:194` are forbidden for new work).
- **No 0.60–0.40 StochRSI zone** as a sourced rule (research Q3 correction). No invented "MTF ⇒ +X% win rate" figure (VALIDATION has the only calibration/EV claims).
- **No rewrite/removal of `multiTimeframe.mjs` or its consumers** (`adaptiveConfluence.mjs`, `ConfluencePanel`). New module coexists.
- **No new runtime dependencies** (project is zero-framework, Node ESM; keep it that way).
- **No expiry↔timeframe rule** is shipped as authoritative — expiry stays a user-configurable heuristic (research Q6).
- **No email/notification-channel work** beyond wiring the new `convergence_above` condition into the existing `dispatchAlert` chain (email channel already exists, `notifier.mjs:149`).
- **No live-order/platform integration.**

---

## 4. Slice checklists (independently shippable, ordered by recommended execution)

Each slice = one commit-capable unit (`feat:`/`refactor:`/`test:` per repo convention), lands green, and never pushes (human pushes).

### Slice 1 — Pure convergence module + unit tests (core)

Files: `server/services/mtfConvergence.mjs` (new), `server/__tests__/mtfConvergence.test.mjs` (new), reuse `indicators.mjs` / `marketDataBus.mjs` / `on-demand` data async wrapper (`UNVERIFIED` exact async helper shape — finalize in implementation).

- [x] 1a. Implement per-dimension `vote(candlePlane, dimension)` → `+1/0/−1` for all six dimensions, reading only closed-bar dashboards. **Acceptance:** unit test feeds synthetic up/down/flat series and asserts each dimension's expected vote. — Done: exported voters `voteTrend/voteMomentum/voteStructure/voteTrendStrength/voteMomentumTrigger/voteVolatility` + `VOTERS` keyed by dimension; unit-branch tests on hand-built fixtures + whole-pipeline assertions on synthetic up/down/flat/zig-zag series.
- [x] 1b. Implement timeframe aggregation: per-plane sign-sum → composite And convergence score `5-scale = round(5·aligned/active)`, quality 1–10, confidence `%`. **Acceptance:** tests hit 5/5 full-alignment, 0/5 no-alignment, and mixed-`active`-count paths; exact band outputs asserted. — Done: exact bands asserted (5/5→5·10·80, 0/5→0·5·13, abstainer→5·8·80, zero-active→nulls).
- [x] 1c. Enforce closed-bar invariant: the module takes a `dropOpen` flag and, when set, computes on `[0..N-2]`. **Acceptance:** a test asserts a synthetic forming bar never changes the returned state (`R9`). — Done: plane-level + converge-level dropOpen tests; forming bar flips the read only when dropOpen=false.
- [x] 1d. Data abstraction: `mtfConvergence` accepts `{ planes: { tf: candles[] }, sourceByTf }` so it is pure and testable with no network. **Acceptance:** all 1a-1c tests run with no I/O; a thin async loader (data-fetch) is added separately and tested with mocked brokers. — Done: `fetchPlanes(tfs, fetcher)` (mock-tested; `error`/`unknown` labels, no fabrication). Async helper shape finalized here.
- Effort: ~4–6 h. Risk: dimension-vote edge cases (thin bars, null reads) — guarded by exhaustive null-input tests. This is the foundation; everything downstream depends on it.

### Slice 2 — Five-tier presets + plane labels

Files: `mtfConvergence.mjs` (extend), `mtfConvergence.test.mjs`.

- [x] 2a. Define the 5 presets (Scalping/Intraday/Swing-Intraday/Swing/Position) as `{ entry, confirm, bias, labels, weights }` matching §2.5. **Acceptance:** test asserts each preset's TF ladder + plane labels and default weights. — Done: `TF_SECONDS`, `PRESETS`, `resolvePreset`; ladder/weights/labels asserted per §2.5 row.
- [x] 2b. Default equal-weight sign-sum overridable by per-preset weights. **Acceptance:** a test with bias/confirm/entry weights produces the weighted composite distinct from plain sign-sum. — Done: swing weights flip the composite from 0 to −0.2 vs plain sign-sum.
- [x] 2c. Optional top-plane (`context`/`swing`) off-by-default toggle. **Acceptance:** default run uses 3 planes; enabling the top plane requires data present else it abstains honestly. — Done: `top` option; `position` top is data-undefined (`tf:null`, always abstains); absent data → `no data` abstain with `context` label + source preserved.
- Effort: ~2–3 h. Risk: preset/weight ambiguity — pinned by acceptance tests.

### Slice 3 — Per-dimension configurability

Files: `mtfConvergence.mjs` (extend), tests.
- [x] 3a. `config.dimensions` per timeframe (`{ trend, momentum, market_structure, trend_strength, momentum_trigger, volatility }` booleans). Disabled dimension is excluded, not zero-voted. **Acceptance:** disabling `momentum_trigger` changes the timeframe's sign-sum only by removing that vote, and `active`/`total` counts reflect only enabled ones. — Done: `dims` accepts a flat map (all planes) or per-tf map; disabled dims emit `enabled:false, value:null, reason:"disabled"` and are excluded from amplitude/enabledDims; strength normalizes per plane by its own enabled count.
- [x] 3b. "Configured but unobserved ≠ zero" honesty rule: every dimension reports `{enabled, observed, value}` so a disabled/unobserved dimension is distinguishable from a genuine 0. **Acceptance:** a plane with an unobserved dimension reports `value:null` and never counts it as a 0 vote. — Done: all six dims always present in each plane's `votes`; `value` is `+1|0|-1` when observed, `null` when unobserved or disabled; amplitude sums observed values only.
- Effort: ~2–3 h. Risk: config default drift — a config-resolution unit test pins defaults.

### Slice 4 — State machine + reason strings

Files: `mtfConvergence.mjs` (extend), tests.

- [x] 4a. Deterministic state bands mapping composite + plane alignment → one of `NO TRADE/WAIT/WATCH/ONLY/BIAS` (per direction). **Acceptance:** each state reachable by an explicit synthetic input in tests (`R4`). — Done: `classifyState` bands (WAIT <½ aligned, WATCH ≥½, ONLY ≥2/3, BIAS 1.0, NO TRADE on dir-0/zero-active/conservative veto); every state covered by synthetic fixtures.
- [x] 4b. `why` reason composer: `H1/4H conflict`, `ADX<20 no trend`, `low volatility`, `strong bull confluence`, `bear regime only`, plane-conflict, data-abstain. **Acceptance:** tests assert the exact reason string emitted per state. — Done: composer strings locked by exact-`toEqual` tests; extras (`H1/4H conflict`, `ADX<20 no trend`, `data: n of m planes active`) appended deterministically.
- Effort: ~2–3 h. Risk: reason-string churn — locked by string-assertion tests.

### Slice 5 — ADX graded gate + StochRSI trigger correction

Files: `mtfConvergence.mjs` (extend), tests.

- [x] 5a. ADX gate tiers (`≥40/≥25/≥20/<20`, gray 20–25 neutral) on the bias plane, direction-blind with `+DI/−DI` giving direction. Label copy "convention attributed to Wilder (1978)". **Acceptance:** tests drive ADX through <20, 20–25, 25, ≥40 and assert the resulting gate/state and `why`. — Done: `adxGate` tiers match `trendStrengthLabel` reuse vocabulary (none/weak/strong/very strong, attributed to Wilder 1978); `classifyState` gated — no-trend rejects to NO TRADE, forming (20-25, incl. the 25 boundary) caps at ONLY, extreme passes with `ADX≥40 extreme` note; `adx` numeric read surfaced per plane; converge derives the tier from the bias/highest active plane.
- [x] 5b. StochRSI `momentum_trigger` = `%K/%D` cross gated to `0.40/0.60` trigger line, labelled design choice; overbought/oversold stays `0.8/0.2`. **Acceptance:** a test asserts a %K/%D cross inside the band fires the trigger and outside it does not; a separate test asserts overbought/oversold uses 0.8/0.2 (regression guard for `indicators.mjs:1202` semantics). — Done: `STOCHRSI_OB_OS = {over:80, under:20}` exported + regression-asserted strictly outside the trigger band; cross tests cover in-band fire, cross-leaving-band, and OB-zone crosses (no trigger).
- [ ] 5c. RSI 60/40 as an **intraday-preset option** (giua64 Intraday) iff needed — never StochRSI. **Acceptance:** if added, labeled RSI 60/40 not StochRSI. — NOT added in this wave: the `momentum` dimension already consumes RSI (>50 threshold) on every plane and preset; an RSI 60/40 band would duplicate that read. Revisit iff a user asks for a stricter intraday momentum band (must be labeled RSI, never StochRSI).
- Effort: ~3–4 h. Risk: ADX/DIR sign ambiguity — pinned by tier tests.

### Slice 6 — Data availability fallbacks + wired loader

Files: `mtfConvergence.mjs` (async loader), `marketDataBus.mjs` (reuse — minimal or no change), tests.

- [x] 6a. 30m/4h assembled from M1 via `aggregateCandles` (`indicators.mjs:156`); daily+ via `getBestCandles`→Yahoo (`yahooAdapter.mjs:36`); in-buffer TFs used directly. **Acceptance:** a test feeds M1 synthetic candles and asserts the aggregated 30m/4h planes compute correctly with matching timestamps. — Done: pure `deriveAggregatePlanes` (whole-multiple tfs, group-end timestamps, source `aggregate`); `loadConvergence` wired loader (live buffer first, 30m/4h from M1, remainder via caller-supplied `fetchHigher` wrapping `getBestCandles`); 8k-bar M1 test proves 30m+4h planes go ACTIVE with last-bar timestamp == last M1 bar.
- [x] 6b. Missing-plane abstain + per-plane `source`/`stale`. **Acceptance:** a plane whose loader returns `source:"none"`/`[]` is excluded from `active` and reports `score:null`, `stale`, never zero (`R10`, honesty rule). — Done: `staleByTf` rides through `converge` per plane; loader marks `source:"none"`, `stale:true`, `[]` when nothing available (incl. thrown fetchers); converge drops such planes from `active` (score null, state NO TRADE).
- Effort: ~3–4 h. Risk: aggregation timestamp drift / stale buffers — guarded by timestamp + stale-fetch tests.

### Slice 7 — SSE/UI surface (convergence panel + types)

Files: `server/handlers.mjs` (new `GET /api/trading/convergence` + a `convergence` section in `realtimeSuite.mjs SECTIONS` :16-39), `realtimeSuite.mjs`, `src/lib/trading.ts` + `liveTrading.ts` (types), `src/components/ConvergencePanel.tsx` (new) or extend `ConfluencePanel.tsx`, component tests.

- [x] 7a. Add MTF types (`ConvergenceResult`, `PerPlane`, `ConvergenceState`) to the shared type files. **Acceptance:** typecheck passes; a `ModelMatrixResult`-style shape is exported (:1170-1181 pattern). — Done: `ConvergencePlane`/`ConvergenceResult`/`ConvergenceState` + `convergence` key added to `TradingSuiteSnapshot` in `src/lib/liveTrading.ts` (plain JSON, nullable metrics, ModelMatrixResult-style envelope); typecheck exits 0. Note: `why` may be a string or string[] (abstain/veto paths emit a plain string).
- [x] 7b. Add the `convergence` section to `SECTIONS` with its own TTL (e.g. 8–15s), streamed via the existing `suite` event. **Acceptance:** `realtimeSuite.test.mjs` asserts a `convergence` key in the snapshot and per-section fault isolation (one failing section → null, not stream death). — Done: `convergence: { ttl: 10000, load: () => convergenceSection() }`; new glue module `server/services/marketConvergence.mjs` (viewed asset → live buffers direct, 30m/4h from M1, honest none/stale when idle); `realtimeSuite.test.mjs` asserts the key + mockRejectedValueOnce isolation (null, other sections live).
- [x] 7c. Render a `ConvergencePanel` showing per-plane matrix + state + `why` + 5-scale/quality/confidence; "no samples → —" for missing planes. **Acceptance:** a component test renders a populated and an empty payload with `—` for absent values. — Done: `ConvergencePanel.tsx` mounted in `TradingSuite.tsx` next to `MarketIntelPanel`, consuming the shared `useRealtimeSuite` stream (no extra SSE connection). All render decisions live in the pure `src/lib/convergenceDisplay.ts` (display rows, tf labels, state tones, null-safe metrics) and are tested in `src/lib/__tests__/convergenceDisplay.test.ts` — the dashboard has no jsdom/testing-library, so full React mounting is out of reach and the component stays a dumb consumer of tested pure logic (deviation flagged in the wave report).
- Effort: ~3–5 h. Risk: SSE section fault/isolation regression — guarded by the realtimeSuite test; UI blast radius contained by component test.

### Slice 8 — Conditional convergence alert binding

Files: `server/services/alertEngine.mjs` (new `convergence_above` condition), `signalEngine.mjs` or a new convergence evaluator calling `dispatchAlert` (`notifier.mjs:156`), `src/lib/trading.ts` (`Alert` shape + create), tests.

- [x] 8a. Add `convergence_above` alert condition: fires when an asset's day/time convergence score ≥ threshold (5-scale) or state reaches a configured band. **Acceptance:** `alertEngine.test.mjs` asserts the new condition triggers on threshold-cross and stays silent below it. — Done: `alertEngine.mjs` gained a convergence cache (`updateConvergence`/`getConvergence`), a `band` array on alerts, the `convergence_above` branch in `evaluateAlert` (score-threshold OR band hit, `lastScore` recorded, recurring re-arms), and an exported `evaluateAlerts()`; `alertEngine.test.mjs` covers threshold-cross, band-below-threshold, silence outside the band, no-read-silence (R10), recurring re-fire, and a price-condition regression guard. Tests redirect the alert store via `PICC_ALERTS_DATA_DIR` (same pattern as `PICC_NOTIFICATION_DATA_DIR`) so workers never race the real `alerts.json`.
- [x] 8b. Wire a convergence evaluator → `dispatchAlert({kind:"convergence", assetId, title, body, details})`. **Acceptance:** with channels unconfigured, the record shows `skipped` not `sent` (notifier honesty :163-168); with push/email configured it delivers. **Acceptance:** email channel verified present already (`notifier.mjs:149`). — Done: new bridge `server/services/convergenceAlerts.mjs` (`startConvergenceAlerts`/`stopConvergenceAlerts` subscribing to the engine, dispatching `kind:"convergence"`; started in `index.mjs` next to `startSignalEngine()`); `marketConvergence.mjs` feeds `updateConvergence` after each converged read. `convergenceAlerts.test.mjs` (mocked notifier) asserts the dispatched shape + that non-convergence notifications are ignored + start idempotency/stop; `notifier.test.mjs` adds a convergence-kind record with unconfigured channels → `inApp:"sent"`, `webpush`/`email:"skipped"`.
- [x] 8c. Expose create/toggle for the new condition in the UI (`AlertPanel` / trading lib). **Acceptance:** type compiles; a handler test creates + lists a `convergence_above` alert. — Done: `src/lib/trading.ts` `Alert` gained `band` + `lastScore`, `createAlert` accepts `band`; `AlertPanel.tsx` adds the "Convergence ≥ (5-scale)" condition with an optional state-band checkbox row (engine states) and renders band/last-score on each row; `alertHandlers.test.mjs` creates + lists a `convergence_above` alert with its band via `/api/trading/alerts` and confirms the validator rejects unknown conditions.
- Effort: ~3–4 h. Risk: escaping the notifier silence-on-unconfigured rule — guarded by the skipped-vs-sent test.

### Slice 9 — Realized-outcome validation + (optional) technical backtester

Files: `server/services/mtfConvergence.mjs` (outcome logging hook), `accuracyLedger.mjs` (reuse `backtestGates` :239-377 bucketing or a new convergence-specific bucket), `server/__tests__/mtfConvergence.test.mjs`; optional `server/services/technicalBacktest.mjs` (new).

- [x] 9a. Log engine state/direction at decision time and resolve against realized price via the accuracy-ledger pattern; bucket win-rate by convergence state × preset. **Acceptance:** a test records a synthetic set of entries, resolves them, and asserts the state-by-state hit-rate + realized EV buckets match the hand-computed values (`R12`). — Done: new `server/services/convergenceLedger.mjs` — records directional states (LONG/SHORT WATCH/ONLY/BIAS; WAIT/NO TRADE are not price calls and are never recorded) on STATE CHANGE per asset (a persisting state is not a new decision), samples the entry price from the live 60s buffer at decision time, and reuses `accuracyLedger.resolveResult`/`exitPriceFor` verbatim so both ledgers measure wins identically. Matured entries resolve 30m after the read (default horizon); no exit data stays pending to a 12h cap then becomes UNRESOLVED (never guessed); pushes count as decided but never hit/miss. `convergenceLedgerStats()` buckets hit-rate + realized EV by state, by preset, and by `state × preset` (even-money EV unless a venue payout% was recorded). `mtfConvergence.mjs` gained the outcome-logging hook (`setConvergenceOutcomeHook`; converge() forwards a caller-owned `outcome` context, observers can never break the engine) and `marketConvergence.mjs` wires it (preset "intraday") + flushes each section tick. `convergenceLedger.test.mjs` asserts the hand-computed buckets (6 hits / 2 misses / 0.75 rate / 3.55÷8 EV; per-state and per-preset breakdowns), push-as-decided, unresolved honesty, guard/duplication rejection, and history entry-price sampling; `mtfConvergence.test.mjs` adds hook-forwarding + throwing-observer isolation (58 tests).
- [x] 9b. (Stretch/optional — defer if it balloons effort) Pure `technicalBacktest.mjs`: walk a candle series, fire the engine state at each closed bar, bucket forward hit-rates per state over a moving window. **Acceptance:** deterministic synthetic-series test reproduces expected per-state hit-rates; no look-ahead (truth spans strictly after the decision bar, mirroring `prediction.mjs:208-213`); the harness **reports the number of parameter configurations tried, uses an untouched out-of-sample slice left aside before tuning, models transaction costs, and labels every output as backtest-only** — the Bailey/López de Prado/Harvey-Liu obligations (`docs/mtf-convergence-research-b-backtests.md` §B7) so a "95% backtest win rate" can never be presented as a live expectation. — Done: new `server/services/technicalBacktest.mjs` (pure; no I/O) — `closedPlanePrefixes()` feeds each decision only candles closed at or before it (higher timeframes never leak an in-progress candle, the B4 hairline), truth spans `(close[d+horizon]−close[d])/close[d]` strictly after the decision bar; `decisionIndices()` caps surfaces with first+last kept; `evaluateSurface()` buckets gross vs net hit-rates per engine state after a round-trip cost fraction and emits a sampled moving-window trajectory per state; `runTechnicalBacktest()` splits the tail reserve FIRST, tunes the best net-hit-rate config on in-sample only, then evaluates the winner on the untouched out-of-sample slice, reports `configsTried` + every trial, and labels every node backtest-only. `technicalBacktest.test.mjs` (14 tests) hand-derives expectations without trusting the engine: every decided call wins on pure ramps (no SHORT ever manufactured on up-only history; window tracks to 1.0), costs turn the same 100% gross win-rate into a 0% net win-rate, flat history fabricates no directional call (`best` null, no OOS), OOS indices never overlap IS truth, and the in-progress-900s-candle exclusion is asserted directly.
- Effort: 9a ~4–5 h; 9b ~6–10 h if taken. Risk: 9b is the single largest effort and is net-new — **if it pushes the wave past budget, drop 9b and keep 9a** (the accuracy-ledger loop already satisfies `R12` honesty on live outcomes).

---

## 5. Cross-cutting constraints

- **Advisory-first (hard):** engine emits states/reasons only; never order intent; never writes to a venue. Confirmed invariant in `ARCHITECTURE.md` ("No execution" :195) and `COMPLIANCE.md` ("does not execute" :10). A test may assert the module exports no execution function.
- **Forbidden models:** ARIMA/Prophet/LSTM/GARCH (legacy names at `prediction.mjs:194`) — never imported or re-created. New pure `(candles)→vote` models max 2/wave; **this wave adds 0** to `MODELS` (six dimensions stay in `mtfConvergence.mjs`).
- **Honesty labels:** unconfigured ≠ zero-filled; every state reports observed data; `no samples → "—"` not 0; every plane reports `source`/`stale`; tests must not fake live data.
- **Compliance copy (ESMA caveat):** any surfaced copy for the binary/expiry-adjacent surface must carry the ESMA structural-negative-EV / "decision support, not a claim of profitability" caveat (research Q6; consistent with `COMPLIANCE.md`). Expiry stays a user-configurable heuristic — never an authoritative mapping.
- **Tests:** no-jsdom, pure-logic unit tests in `server/__tests__/<name>.test.mjs`; every slice's tests are `npx vitest run`-green and the full suite is preserved (759 passing at HEAD).
- **Typecheck:** every frontend slice keeps `apps/dashboard` typecheck clean.
- **No push:** implementing agent commits locally per repo convention; human pushes.
- **Regression gate:** full `npx vitest run` stays at 759-or-better after every slice.

---

## 6. Research implications appendix (what this spec intentionally rejects from the user's framework doc)

The user's framework doc, taken literally, asserts several things the research report (`docs/mtf-convergence-research.md`) refutes or de-sources. This spec deliberately rejects or corrects each:

1. **"60/40 StochRSI zone" — rejected.** Research Q3 (report :45-57) shows 0.8/0.2 are the canonical Chande & Kroll extremes; "60/40" leaks from **RSI** intraday presets (giua64) or StochRSI trigger-line strategies, and is a design choice, not a sourced rule. The spec ships `momentum_trigger` as a `%K/%D` cross with a `0.40/0.60` trigger line labelled design choice (`R7`, slice 5b) and keeps overbought/oversold at 0.8/0.2 (already the existing engine behavior at `indicators.mjs:1202`).
2. **"MTF alignment ⇒ +X% win rate" — rejected.** Research Q1 (report :10-26) finds no citable scholarly figure; the honest anchors are practitioner adoption (Taylor & Allen, ≥90% of FX dealers weight charts) and higher-horizon profitability (Brock et al.), with Park & Irwin's marginal-positive-but-caveated survey as the sober summary. The spec's only win-rate claims come from realized outcomes (`R12`, slice 9a) per `VALIDATION.md`.
3. **Expiry↔timeframe mapping folklore — rejected as a rule.** Research Q6 (report :93-104) finds no authoritative expiry table; ESMA's 2018 ban documents the structural negative expected return. Expiry stays a user-configurable heuristic with ESMA-compliant caveat copy (slice 8/§5).
4. **Novel weighted formula as the base — rejected in favor of conformance.** Research Q4 (report :63-73) shows every real TradingView MTF dashboard sums per-plane +1/0/−1 into a composite. The spec's base is equal-weight sign-sum, with weights as a preset option (`R3`, §2.3), matching igaudette/giua64/eliasvictor.
5. **HTF veto optionality — adopted as "conservative" mode.** Research Q4's igaudette Conservative preset (H1/4H conflict ⇒ no trade) becomes `R8`/`conservative`, not the default for all presets.

These decisions are grounded in the report's source-quality grades (report :108-130) and its "Verified-claim summary" (report :146-153).

### 6.1 Second-pass claim verification (2026-08-28) — what the appended framework-doc evidence became

The user's appended "hard numbers / validation docs" were chased to primary sources in three verification notes; the full verdict table lives at the end of `docs/mtf-convergence-research.md` ("Supplementary verification"). The plan-level consequences:

1. **Honest expectation band.** Peer-reviewed + live-reported MTF numbers cluster at **~54–61% win rate / ~0.61 ROC-AUC**, cost-fragile (Sobreiro et al., *Forecasting* 8(3):40 — the only fully peer-reviewed backtest in the batch, and it *undercuts* the "MTF dramatically improves results" thesis). Kondruk & Hetsko's +3,283.69% / 2.07% is real but one paper, one asset (XAU/USD), one lab. Whatever the engine ships, VALIDATION.md's realized-outcome rules stay the sole source of win-rate claims. (Notes B1–B7, C1–C2.)
2. **Fuzzy over binary (C2)** — the only direct soft-vs-hard DSS comparison found supports the engine's confidence/quality shaping over strict binary state cutoffs (already reflected in §2.3).
3. **Look-ahead bias is quantified (~0.20 ROC-AUC)** — R9's time-alignment clause is now directly evidence-backed (B4).
4. **Backtest-honesty obligations (B7)** — configurations-tried count, untouched OOS slice, cost modeling, "backtest-only" labeling are now explicit acceptance criteria in slice 9b.
5. **Rejected as sourced**: the "Δ^0.4899 / Nyquist timeframe-selection" formula (C6 — UNFOUND; closest real counterpart is Hurst/wavelet scaling), HSI 54.3%/1.49 (B3 — UNFOUND; numbers recycle between unrelated pages), GitHub EMA/ALMA 80–96.7% (B6 — UNFOUND), and the "fractal alignment" phrasing (B1 — UNFOUND). These must not appear in product copy or the spec's grounding.
6. **Pattern references worth keeping** (systems note C-systems): TV Co-Pilot's HTF-bias LONG/SHORT/SKIP verdict panel (closest UI reference for slice 7's convergence panel), Dresteghamat's Regime/Direction/Exhaustion dashboard (design reference only — core is hidden, no reproducible results, which is PICC's differentiator), Pinecone's webhook→router→multi-channel alert pattern (slice 8), and the TeIKa 15(2) Telegram + RSI bot paper (slice 8 reference).
7. **Human-in-the-loop validation** (C3–C5, systems §6): the semi-automated/human-approval paradigm has real literature support (TradingAgents; Ye & Schuller ESWA 2023); AutoTrader-AgentEdge is an existence proof of LLM-agents + regime gating but is a demo with no costs. Advisory-first stance stands; no spec change required beyond citations.
8. **Microservices "industry standard" (C8)** — overstated; PICC's zero-framework modular ESM services stay as-is (a non-goal, §3).

---

## 7. Risks

| # | Risk | Likelihood | Guard |
|---|---|---|---|
| 1 | **Dimension-vote / state edge cases** (thin bars, null indicator reads) produce a wrong state on live data — most likely to bite. | High | Slice 1 exhaustive null/thin-input tests; every state reachable by a deterministic synthetic input (slice 4a) |
| 2 | Closed-bar invariant violated by a forming-bar read → repaint/`why` churn | Medium | `dropOpen` path tested (slice 1c/`R9`) |
| 3 | Data-availability gaps (30m/4h unaggregated, daily+ fetch errors) silently zero a plane | Medium | Abstain-not-zero rule + per-plane `source`/`stale` (slice 6b / `R10`) |
| 4 | SSE `convergence` section fault takes down the whole `suite` event | Medium | Fault-isolated section with per-section TTL (slice 7b), mirroring existing `realtimeSuite` design :53-68 |
| 5 | Notifier reports `sent` when a channel was skipped | Low | Skipped-vs-sent honesty test (slice 8b) |
| 6 | Slice 9b vectorized backtester balloons the wave | Medium | Explicitly optional/stretch; drop 9b, keep 9a to satisfy `R12` |

---

## 8. Suggested commit sequence (one per slice)

1. `feat: pure multi-timeframe convergence module + unit tests` (Slice 1)
2. `feat: five-tier MTF presets + plane labels` (Slice 2)
3. `feat: configurable MTF indicator dimensions` (Slice 3)
4. `feat: MTF state machine + why reasons` (Slice 4)
5. `feat: ADX graded gate + StochRSI trigger correction` (Slice 5)
6. `feat: MTF data-availability fallbacks (M1 aggregation, Yahoo daily+)` (Slice 6)
7. `feat: convergence panel + SSE/UI surface` (Slice 7)
8. `feat: conditional convergence alerts` (Slice 8)
9. `feat: MTF realized-outcome validation (+ optional technical backtester)` (Slice 9)

Each commit lands green (its tests + full 759-test regression), is independently shippable, and never crosses the advisory boundary.
