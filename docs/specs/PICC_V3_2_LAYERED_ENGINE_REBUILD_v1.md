# PICC v3.2 Layered Decision Engine — Rebuild — spec v1

**Status:** Draft for execution · **Date:** 2026-09-19
**Extends:** `docs/adr/0004-decision-core-rebuild.md` (decision path), `docs/adr/0003-execution-granularity-aggregated.md` (pipeline shape), `docs/specs/notes/B-IND-0-current-engine-coverage-2026-09-19.md` (verified engine inventory + locked dispositions §9–§12), `docs/specs/PICC_MULTISOURCE_ENGINE.md` (data-source honesty REQ-3/REQ-4), `docs/TRADING_SUITE_GENERALIZATION_SPEC.md` (advisory-first posture)
**Supersedes:** `docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md` (decision path — U4FA verdict retires; living legs re-homed), the trading-logic decision surface of `docs/specs/MTF_CONVERGENCE_ENGINE.md` (outputs become soak-period reference registers)
**Grounding rule:** every `file:line` below was read/verified in the 2026-09-19 session (recorded in B-IND-0); anything not re-read is marked **UNVERIFIED**. The v3.2 blueprint is authoritative; where a requirement says "DATA-GAP" it degrades to honest emptiness (`abort/unavailable`), never a fabricated value (guardrail G2). Demoted legacy triggers are **context registers** — computed, logged, HUD-visible — and are never decision inputs.

---

## 0. Decisions locked by the user (2026-09-19)

Recorded in full at B-IND-0 §10–§12 and ADR-0003/0004. Abridged here; the ADRs are the canonical history.

| # | Decision | Verdict |
|---|---|---|
| ADR-0003 | Execution granularity | **(b)+(c) inside (a)**: 15s pipeline + 15s human HUD nested inside the 60s+ engine core |
| ADR-0004 | Decision-core rebuild | U4FA `verdict` retires; new layered engine; **parallel soak then flip**; paper/demo run new engine now; real money Constitution-gated |
| L1 | VWAP anchor | Both: anchored-cumulative primary + session-reset secondary (configurable per venue) |
| L2 | EMA chain | EMA400 top-down (D1/H4 → EMA400 → EMA200/100) as Context register only; 9/21 stays execution fast pair |
| L3 | StochRSI + BB %B | Context registers only (never trigger/booster inputs) |
| L4 | Δ/CVD/rel-vol | Net-new, wired for crypto (ccxt) now; forex/EO degrade to VWAP+EMA-only (v3.2 §2.5) |
| L5 | Futures-proxy leg | Build now inside the 15s slot; >0.80 corr & >70% same-sign unlocks non-crypto Δ/CVD |
| L6 | Vol regime | ATR-percentile LOW/NORMAL/HIGH; 25–50% size cut in HIGH VOL |
| L7 | Sample gate | Hard gate now: 300+ deployable / 500+ forward for real money; paper/demo always open |
| L8 | Session classes | Dead-zone (illiquid/wide) + red-folder (news-heavy) → no fresh entries; feeds F1/spread gate |
| L9 | Cost line | Explicit cost line on every forex/EO output (payout, 1.5-pip spread model, slippage, EV margin) |
| L10 | Sizing | Half-Kelly + anti-martingale + volatile-regime cut (ADR-0004 trit → new Normalization) |
| S1 | Sample clock | One aggregate global counter across venues above the volume-reliability bar |
| S2 | Flip gate | Shared `accuracyLedger` tagged per engine; new cost-adjusted expectancy ≥ old, ≥100 paper trades each, ~2–4 wk soak |
| S3 | Venue shapes | One 5-point signal; EO expiry via EV gate across `CANDIDATE_EXPIRIES`; crypto open-candle direction |
| S4 | Copilot trip-wires | 8 approved wires (see §4) |
| S5 | Trade cap | User-configurable, persisted, UI default unlimited; `0` = unlimited |

---

## 1. Pipeline shape (ADR-0003: (b)+(c) inside (a))

Three nested cadences; one decision surface. `(a)` remains the automated execution cadence; `(b)`/`(c)` are advisory + the human HUD that watches the same state.

| Cadence | Interval | Runs | Output |
|---|---|---|---|
| (a) engine core | 60s+ (per venue feed real-time via scheduler; `DECISION_INTERVAL_MS` today 15,000 at `adaptiveConfluence.mjs:54` — **v3.2 re-pins to ≥60s for the automated core**) | Constitution → Context/Regime → Execution 5-point → decision record | Logged decision + proposal (paper/demo) or gated advisory (real) |
| (b) 15s fast pipeline | 15,000 ms | VWAP/EMA fast slice + futures-proxy leg + Δ/CVD/rel-vol refresh (crypto) | Fresh 15s context registers for the HUD + trigger source for a **15s advisory tick** (never auto-orders) |
| (c) 15s human HUD | 15,000 ms | The Studio browser renders the same state (regime, 5-point score, registers, cost line, trip-wire flags) | Human-visible snapshot for live review |

Sources: 15s legs come from the Studio capture leg / liveEO `periods` (extend `liveEO.mjs:37` mapping with a 15s plane where the venue serves it — ccxt `INTERVAL_BY_TF` starts at 60s, `ccxtAdapter.mjs:19`, so 15s is **studio-leg/futures-HTTP only** until probed). 60s+ core consumes the existing 60/300/900/3600 planes.

## 2. Layer 0 — Constitution (always-on)

Nothing executes real money until the Constitution gates pass. No confidence number exists without sample size + cost-adjusted expectancy.

| REQ | Rule | Mapping / gap |
|---|---|---|
| REQ-CON-1 | **Aggregate global sample clock** across all venues/assets meeting the volume-reliability bar; single counter, persisted | Net-new counter service over `accuracyLedger` rows (`accuracyLedger.mjs` `recordDecision` `:30`, `flushLedger` `:97`); volume-reliability bar reuses `brokers/index.mjs` `isAlive`+stats, ccxt-tick vs EO-paper legally separate as documented in B-IND-0 §8 |
| REQ-CON-2 | **Real-money floor: 300+ deployable samples** (per the aggregate clock) before real-money execution unlocks | Enforcement in the decision core; paper/demo bypass (always open) |
| REQ-CON-3 | **Forward validation: 500+ forward samples** (paper/demo, walked forward) required to keep real-money edge claims | Walk-forward over ledger; `hyperopt.mjs` walk-forward pattern reused |
| REQ-CON-4 | **Cost-adjusted EV gate** — EV must clear costs: payout, spread model (1.5-pip), slippage, and the EV margin; `PAYOUT_MARGIN` 1.15-style check retained | Reuses EV gate from `adaptiveConfluence.mjs` (`EV_RR_MIN`, `MIN_WIN_PROB 0.52` seed); **ALL thresholds re-derived from the ledger, not hardcoded**, expected-value uses observed payout where available (`payoutSource:"observed"`), else honest "no payout estimate" |
| REQ-CON-5 | **No confidence without sample + expectancy** — "confidence" field is only `{ sampleSize, costAdjustedExpectancy }`; standalone %/score banned from decision inputs | Relabel: `modelMatrix.mjs` confidence %, U4FA 0–5 score, calibration buckets become registers only (B-IND-0 §9) |

## 3. Layer 1 — Context/Regime

Establishes *where price is* and *what the regime allows* before any 5-point score matters.

| REQ | Rule | Mapping / gap |
|---|---|---|
| REQ-CTX-1 | **ADX(14)** trend + **Regime-3 Chop halt** (`adx(highs,lows,closes,14)` `indicators.mjs:353`; ADX≤25 → halt, 2-consecutive-bar re-arm anti-flicker like `updateRegimeBreaker` `autopilot.mjs:461-506`) | Keep from U4FA REQ-F3; re-homed intact |
| REQ-CTX-2 | **4H/daily S/R** — price within tolerance of swing S/R (`resolveStructureLevels`, `supportResistance` `indicators.mjs:723`; **≥30 target-TF bricks guard** — D1 via Yahoo EOD `yahooAdapter` only when mapped, else "structure unavailable") | Keep from U4FA REQ-F2; re-homed |
| REQ-CTX-3 | **MTF HTF bias** — MTF voters (`mtfConvergence.mjs` `voteTrend`, `voteMomentum`, `voteStructure`, `voteVolatility`) produce a bias register the Execution layer may weight, not veto | MTF outputs stay as reference registers during soak; then bias register |
| REQ-CTX-4 | **EMA400 top-down context** — D1/H4 → MA400 → MA200/100 register; long-only context = price ≥ MA400 chain; **register only, never trigger** | Net-new from `ema` (`indicators.mjs:55`); aggregated planes via `deriveAggregatePlanes` (`mtfConvergence.mjs:564`) |
| REQ-CTX-5 | **Dead-zone / red-folder session classes** — dead-zone (illiquid, wide) and red-folder (news-heavy) → no fresh entries; feeds F1/spread gate | Net-new classification over `economicCalendar` + session window (`economicCalendar.mjs` `withinWindow` `:82`, `upcomingHighImpact` `:119`; fallback-schedule labeled honestly) |
| REQ-CTX-6 | **F1 safety gates re-homed** — session window, spread gate 1.5-pip (DATA-GAP today → `{ok:false, reason:"spread unmeasurable"}`), news blackout ±15, correlation lock EURUSD↔GBPUSD | Ported from U4FA REQ-F1; spread **never synthesized**; cooldown values revisited vs prop-firm ±2 research per B-IND-0 §9 |
| REQ-CTX-7 | **Volatility regime** — ATR-percentile → LOW/NORMAL/HIGH; **25–50% size cut in HIGH VOL** | ATR-%-based (`atr` `indicators.mjs:613`, reuse `regimeDetection.mjs` patterns) |

## 4. Layer 2 — Execution 5-point score (60s+)

Directional entry signal, one signal across venues (S3). **Crypto: full 5-point. Forex/EO: VWAP + EMA 9/21 only** (Δ/CVD/rel-vol honest-null per v3.2 §2.5) until the futures-proxy leg unlocks them (L4/L5).

| Pillar | Source | Mapping / gap |
|---|---|---|
| 1 VWAP | Anchored-cumulative + session-reset secondary (configurable) | `vwap(highs,lows,closes)` `indicators.mjs:657`; modelMatrix AVWAP & proanalysis 0.7 price-vs-VWAP as prior art; session-reset VWAP net-new |
| 2 EMA 9/21 alignment | 9/21 fast pair (EMA 9 vs EMA 21) | Net-new composition from `ema` `indicators.mjs:55` |
| 3 EMA 9/21 spread | Separation/direction of the fast pair | Net-new |
| 4 Volume Delta | Maker-flow delta (take-order agnostic) | **Crypto only** — ccxt trades feed (`ccxtAdapter.mjs` open trades); net-new |
| 5 CVD | Cumulative volume delta | **Crypto only**; net-new |
| + Relative Volume | Current vs average volume | **Crypto only**; net-new |
| R2 | **Futures-proxy leg (15s slot)** — proxy validator `>0.80 corr`, `>70% same-sign` over the proxy vs spot; when it validates, Δ/CVD/rel-vol unlock for non-crypto | **Build now inside (b)**; honesty gate |

Score semantics: the five (or two, on degrades) pillars compose a directional entry signal; individual pillar weights from calibration, but **final "confidence" is only sample+expectancy (REQ-CON-5)** — the score is an entry *argument*, never a standalone probability.

## 5. Layer 3 — Copilot (deterministic; LLM explain-only)

Zero LLM in the trade path. Trip-wires veto with fixed rules; the LLM only explains the HUD state.

| # | Trip-wire | Behavior | Reuses |
|---|---|---|---|
| 1 | −5% daily / −2% session hard-halt | Kill proposals for the day/session; non-configurable floor | `commandCentre/safetySidecar.mjs` (kill-switch gate, `GATE_ORDER`); daily-loss limit precedent `u4faRisk.mjs:101-110`, `autopilot.mjs:899-900` |
| 2 | Regime-3 Chop override | Block entries while chop-confirmed | REQ-CTX-1 |
| 3 | Dead-zone / red-folder entry block | No fresh entries in classified windows | REQ-CTX-5 |
| 4 | 1.5-pip spread-spike abort | Abort on spread above model | F1/re-homed + L9 model |
| 5 | Cost line below 2:1 EV margin | Abort | REQ-CON-4 |
| 6 | Kill-switch everywhere | Global off available on every surface | `interventions.mjs` + existing kill-switch |
| 7 | Voluntary pause on consecutive losses | Threshold **TBD** (owner), wire shape ready | consecutive-loss counters (`autopilot.mjs:61-62` legacy) |
| 8 | Configurable proposals/day cap | Setting, persisted (data-dir config, same pattern as U4FA knobs); UI default unlimited, `0`=unlimited | Net-new setting; supersedes `maxDailyTrades` + prior 10/day refs |

**Cost line (REQ-L9):** every forex/EO output carries an explicit line — payout, 1.5-pip spread model, slippage, EV margin; rejection reasons cite the number.

**Sizing (REQ-L10):** half-Kelly + anti-martingale, volatile-regime cut layered on (REQ-CTX-7); risk knobs 0.5%/trade, −5% daily UTC, 15-min post-loss cooldown move from U4FA Trit to this Normalization layer per ADR-0004.

## 6. Staging & instrumentation (ADR-0004)

| REQ | Rule |
|---|---|
| REQ-STG-1 | **Parallel soak**: new engine ships alongside old; config toggle routes decision path; **old path keeps logging** with engine tag |
| REQ-STG-2 | Shared `accuracyLedger` rows tagged `engine:"old"|"new"` + signal source so both feed the same ledger |
| REQ-STG-3 | **Flip gate**: new path's cost-adjusted expectancy ≥ old path's in the same window **AND ≥100 paper trades on each AND ~2–4 week soak elapsed**; then old path retires to registers |
| REQ-STG-4 | Paper/demo run **new engine immediately** (fast-forward sample clock); real money Constitution-gated |
| REQ-STG-5 | 2,341-test floor preserved; tests pinning demoted trigger paths **re-pointed to the new decision surface over the soak**, honesty pins carried over |
| REQ-STG-6 | Demoted triggers (StochRSI/BB/SMA20 legs) stay in-tree as context registers — logged, HUD-visible, never decision inputs |

## 7. Out of scope (this spec)

- Push-notification-based intervention UI (Phase C of Extension-Eradication spec — separate track).
- Broker order plumbing for real money (advisory-first posture unchanged; `openPaperTrade` `trading.mjs:552` remains the paper path).
- Non-trading-logic spec backlog (frontend/studio/income/capture) — resolved separately (see the older-spec resolution pass).

## 8. Task plan (draft — refined at execution)

| Task | Deliverable | Depends |
|---|---|---|
| ~~T1~~ ~~Aggregate sample clock + persisted counter over shared `accuracyLedger`~~ ✓ | `constitution.mjs` `aggregateDayState` — UTC day-key derived from ledger rows (uses `u4faRisk` day-key), per-expiry hit/miss/push buckets + engine filter (T11 seam); 7 tests | B-IND-0 §8 bar |
| ~~T2~~ ~~Constitution gates (300/500 floor, cost-adjusted EV re-derived, confidence shape)~~ ✓ | `gateConstitution` (REQ-CON-2/3 AND-composed), `costAdjustedEv` (1.5-pip spread + slippage + margin, HUD cost line), `deriveEvRRFloor` (derived EV-RR or honest `derived:false` fallback), `confidenceShape` (REQ-CON-5 strict 2-key shape, extra keys throw); `evaluateAsset` `constitution` honor-path (TRADE→NEUTRAL veto, default-off); 18 tests | T1 |
| T3 | 15s fast pipeline slice + HUD state snapshot ((b)/(c) cadence) | liveEO 15s plane probe |
| T4 | Futures-proxy leg + validator (>0.80 corr / >70% same-sign) | T3 |
| T5 | Δ/CVD/rel-vol crypto wiring | ccxt trades feed |
| T6 | VWAP dual-anchor + EMA 9/21 pillars | — |
| ~~T7~~ ~~EMA400 context chain + regime registers (StochRSI/BB stay as registers)~~ ✓ | `v32Context.mjs` `ema400Context` (REQ-CTX-4 — price/MA100/200/400 chain per plane, `<400 bars` honest `available:false`, caller-declared `source`), `biasRegister` (REQ-CTX-3 — MTF voters composed, register-only never a veto), `structureRegister` (REQ-CTX-2 — re-homed `resolveStructureLevels`), `adxChop` (REQ-CTX-1 — re-homed `nextRegimeState` chop latch); StochRSI/BB stay as registers in the existing engine, untouched; 10 tests | — |
| ~~T8~~ ~~Vol-regime classifier + size cut~~ ✓ | `contextCoordinates.mjs` `percentileOfLast` (trailing-window rank, flat-window neutral 0.5 not top-ranked, non-finite excluded) + `v32Context.mjs` `volatilityRegime` (REQ-CTX-7 — ATR(14) percentile: >0.7 HIGH with `sizeCutPct: 0.5`, <0.3 LOW, ≥30 finite samples guard); 9 tests | — |
| ~~T9~~ ~~Dead-zone/red-folder session classes~~ ✓ | `v32Context.mjs` `sessionClassify` (REQ-CTX-5 — re-homed `sessionInWindow` + `blackoutViolations`, `upcoming` slice derived from `nowMs` for determinism, `source:"fallback-schedule"` honesty when `events` null, labels `red-folder+dead-zone` > `red-folder` > `dead-zone` > `normal`); no live `economicCalendar` wiring (still caller-supplied — plan 3); 3 tests | — |
| ~~CTX-6+compose~~ ~~F1 gates re-homed + envelope~~ ✓ | `v32Context.mjs` `f1GateRegister` (REQ-CTX-6 — re-homed `spreadGateF1`/`correlationBlocked`/`blackoutViolations`/`sessionInWindow` as four named checks, `ok` strict AND) + `assembleRegime` (single `{ registers, f1, sources, at }` envelope with honesty `sources` map — composition boundary, never a veto); 4 tests | — |
| T10 | Cost line + trip-wire 5 (EV margin abort) + trip-wire 8 setting | T2 |
| ~~T11~~ ~~Engine tag on ledger + flip-gate comparison~~ ✓ | `accuracyLedger` `recordDecision` stores `engine` (default `"legacy"`); `correctlyAnsweredByEngine` (hit/miss only — pushes excluded); `constitution` `flipGate` (≥minTrades each + candidate expectancy ≥ legacy); 8 tests | T1 |
| T12 | Re-point demoted-trigger tests; honesty pins | T2 |
| T13 | 15s studio-leg real-venue E2E (carried from U4FA T13) | T3 |