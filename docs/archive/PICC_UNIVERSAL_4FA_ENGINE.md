# Universal 4-Factor Engine (U4FA) — spec v1

**Status:** Draft for execution · **Date:** 2026-08-30
**Extends:** `docs/TRADING_MULTIPLATFORM_ROADMAP.md` §0/§1 (executor seam context), `docs/specs/PICC_MULTISOURCE_ENGINE.md` (data-source honesty rules REQ-3/REQ-4), `docs/TRADING_SUITE_GENERALIZATION_SPEC.md` (advisory-first posture), `docs/PROMPT_PATTERNS.md` P4/P5 (structured-output contracts; negative-space guardrails)
**Supersedes:** nothing — new strategy dimension on top of the existing decision engine.
**Grounding rule:** every claim below carries a `file:line` read this session; anything not re-read is marked **UNVERIFIED**. The user's 4-factor blueprint is the authoritative requirement ("absolute source of truth"); where this spec says "DATA-GAP" the blueprint item has no verified PICC data source and **must degrade to abort/unavailable, never to a fabricated value** (guardrail G2).

## 0. Anchor corrections of record (verified against the tree this session)

These correct the research brief handed to me; the spec below is grounded in the corrected facts.

| Research-brief claim | Verified reality | Consequence |
|---|---|---|
| Services live at `server/services/*.mjs` | Real paths are `apps/dashboard/server/services/*.mjs` (e.g. `adaptiveConfluence.mjs`, `indicators.mjs`, `autopilot.mjs` confirmed by glob + read) | All task file paths below use the real prefix |
| Execution is demo-welded to the EO session singleton (`state.session`) | Execution was **removed entirely** — `bootstrapAutopilot/autopilotTick/runAutopilotTick/startAutopilot/stopAutopilot/placeDemoTrade` are deprecated-removed (`autopilot.mjs:1332-1337`); `demoStatus` reports `running:false // execution removed — advisory-only` (`autopilot.mjs:963`). The `state.session` weld no longer exists. | U4FA **cannot** auto-place anything — which matches the blueprint's human-click compliance. The "Augmentation gate → paper after approval" path targets `openPaperTrade` (`trading.mjs:552`), not autopilot |
| `getDemoSession` exists in autopilot | **Does not exist** — imported by `brokers.mjs:41`, `positionManager.mjs:60`, `trading.mjs:915` but autopilot exports no such symbol (export list `autopilot.mjs:105-1276`); callers fail closed via try/catch | `brokers.mjs` always reports EO `connected:false`; do not rely on it for liveness. U4FA must read liveness via `getSessionLive()` (`autopilot.mjs:887`) / `getBrokerStats().upstream.lastAt` (`autoexecutor` none; see `autopilot.mjs:901-905`) |
| `executorRegistry.mjs` / `brokerAdapter.mjs` exist as Wave-1 seam | **Neither exists** (glob: no files). What DOES exist is the `LiveBroker` contract + registry in `brokers/index.mjs:9-26,56-146` (slug/label/weight/isAlive/stats/dataSnapshot/getCandles/subscribe/availableTimeframes/resolveTimeframe/getAccountState/getExpiryDurations) with four adapters (`brokers/expertoption.mjs`, `ccxtAdapter.mjs`, `paperAdapter.mjs`, `yahooAdapter.mjs`) — a data-side registry only; **no order placement surface** | U4FA consumes data through `getBrokerData()` (`brokers/index.mjs:107`) unchanged. It does NOT need a new executor; it needs the interventions approval gate + `openPaperTrade` |
| Autopilot gates implement `riskPerTradePct` | Risk knobs confirmed: `cooldownMs` default 15 min (`autopilot.mjs:48`), `dailyLossLimitPct` default 10, clamp [1,100] (`autopilot.mjs:51,295`), `maxDailyTrades` default 0=unlimited, clamp [0,100] (`autopilot.mjs:52,296`), `consecutiveLossLimit`/`consecutiveLossWindowMs` (`autopilot.mjs:61-62`) — but **`riskPerTradePct` lives in `trading.mjs:81` (default 2, clamp [1,20] at `trading.mjs:143`)**; the blueprint's 0.5% sits **below the clamp floor** | T10 must widen the clamp (or size U4FA paper orders via amount = balance×0.005 with a ≥1-unit floor) and re-run the tests that pin the clamp |
| Spread gate "no bid/ask source verified" | Confirmed: all data buffers are OHLC-only (`liveEO.mjs:37` periods map; `brokers/index.mjs:17` candles contract `{time,open,high,low,close}`); no spread/quote field anywhere in the registry contract or `expertoption.mjs` parsers read this session | F1 spread gate is DATA-GAP → default **abort with honest reason** until a spread source is wired (T6 probes first; fixture-injectable) |
| D1/H4 available for F2 swing levels | Buffers keep only 60/300/900/3600s (`liveEO.mjs:37`, `brokers.mjs:51`); CCXT REST serves up to 14400 (`brokers.mjs:70`); Yahoo serves 86400 EOD (`brokers.mjs:85`); `mtfConvergence.mjs` already derives 1800/14400 from the 3600 plane via `aggregateCandles` (`mtfConvergence.mjs:559-571`, `marketConvergence.mjs:17-18`). Live buffer cap = 400 bars (`liveEO.mjs:49`) → **D1 via aggregation needs 720 hourly bars: NOT derivable from live buffers; D1 only via Yahoo delayed-EOD; H4 derivable (4×3600, needs 120 hourly bars — available)** | F2 passes on **H4** level normally; **D1** only when Yahoo daily serves the asset (forex mapping via `assetCatalog.yahooSymbolFor` — **UNVERIFIED for all pairs, check at execution**); otherwise F2 = "structure unavailable" → no trade. Never fabricate a level |
| `economicCalendar.mjs` has the blackout primitives | Confirmed: `getEconomicCalendar` (`:92`), `upcomingHighImpact` (`:119`), `withinWindow` (`:82`), `normalizeImpact` (`:9`); **caveat:** when the live Feed is unreachable it falls back to `staticFallbackEvents` (`:52-80`) — a recurring schedule "deliberately not tied to calendar dates" | Blackout uses the calendar with an honest `source:"feed"|"fallback-schedule"` label; a fallback-schedule blackout is approximate, and that approximation must be visible in the payload |
| Anti-flicker precedent "does not exist in PICC" | It **does**: `updateRegimeBreaker` requires the SAME new regime twice consecutively before resuming (`autopilot.mjs:461-506`, `candidateCount>=2`); also `detectMarketPhase` already classifies ADX>25 trending / <20 ranging (`indicators.mjs:1199,1277-1345`) and `detectRegime` (`regimeDetection.mjs:24-29`) | U4FA's regime-confirmation counter (anti-flicker, 2-3 bars) reuses the same latching pattern, no new invention |
| Interventions proposals support arbitrary sources | `proposeCaptureLogin` sets `p.source = "capture"` after `newProposal` default `"workflow"` (`interventions.mjs:116-135,290-310`); `respondIntervention` already resolves non-workflow proposals via the `captureGate` branch (`:331-347`); **but** `NotificationCenter.tsx` hard-filters `p.source === "capture"` (`NotificationCenter.tsx:46,57`) | A new `source:"trade"` proposal needs (a) a `proposeTrade()` in `interventions.mjs` mirroring the capture-gate branch and (b) a widened filter in the bell. No new endpoint needed — `/api/browser/interventions/respond` exists (`handlers.mjs:4180`) |
| Extension session-sync E2E unverified (user-flagged open item) — **CLOSED by D1 (2026-09-17)** | The original concern was confirmed open (`extensionSessionCapture.test.mjs` drove a **mock API harness**; popup "session synced" was a literal label on `POST /api/trading/capture-session` ok). With the D1 clean break the extension and its popup/test harness are removed; session capture now runs through the studio browser (`sourceLeg: "studio"`, `captureProfiles.mjs`). The real-tab verification need survives as T13, restated against the studio (real venue tab → studio → server → decisions). | T13 (live real-tab E2E against the studio leg) is still a **blocking edge** for any U4FA feature consuming real venue data (T14), exactly as the user flagged |

---

## 1. Requirements (blueprint transcription, annotated)

The blueprint is the source of truth; the factor numbers, thresholds and presets below are transcribed **verbatim** and marked with their PICC mapping or `DATA-GAP`. Each REQ is testable.

### REQ-F1 — Override pre-gate (highest priority; failure here = NO_TRADE)

| Blueprint rule | PICC mapping / gap |
|---|---|
| **Session timing** 07:00–16:00 GMT | Config `sessionWindow` default `{ tz: "Europe/London", start: "07:00", end: "16:00" }` — **IANA clock, DST-aware** (`Intl.DateTimeFormat` with `timeZone`; no hardcoded UTC offset). Research correction: London-New-York overlap is 13:00–17:00 UTC standard-time and trims ~3h in spring; blueprint default covers London-only hours — implement as configurable, defaults per blueprint. Short styles (1–3) use `ny-london` overlap profile, long styles (4–5) `any`. **Assignee:** T4 |
| **EUR/USD spread ≤ 1.5 pips** | **DATA-GAP.** No bid/ask source verified in the registry contract (`brokers/index.mjs:17` candles only). Gate reports `{ ok:false, reason:"spread unmeasurable — no bid/ask source" }` and the engine aborts. Fixture-injectable spread source for tests; T6 probes what exists before wiring anything. **Never** synthesize a spread |
| **News blackout ±15 min** around high-impact (NFP/CPI/FOMC/rates) | Reuse `economicCalendar.getEconomicCalendar` + `upcomingHighImpact` + `withinWindow` (`economicCalendar.mjs:92,119,82`); `impact:"high"` per `normalizeImpact` (`:9`); window ±15 min **configurable** (`newsBlackoutMin`), ±15 default per blueprint (research notes prop-firm convention is ±2 — blueprint wins). Calendar source label: `"feed"` or `"fallback-schedule"` (honest; `:50-80`). Currency→asset mapping via asset id prefix / `assetCatalog.assetsEquivalent` (**UNVERIFIED for every pair** — verify in T9). **Assignee:** T5 |
| **Correlation lock** — EURUSD loss → pause correlated pairs (GBPUSD) 15 min | Loss events from the **accuracy ledger** (`accuracyLedger.mjs` `recordDecision` `:30` / auto-resolve `flushLedger` `:97` → `hit/miss/push`) and the demo-deals ledger (`autopilot.mjs` `demoDeals` `:1265`). Correlation table is **static config** (declared EURUSD↔GBPUSD pairs, honestly labeled "static config, not measured covariance"); pause window 15 min configurable. **Assignee:** T7 |

### REQ-F2 — Structure (price location + trigger candle)

| Blueprint rule | PICC mapping / gap |
|---|---|
| Price within **10 pips** of D1 **or** H4 swing S/R (support→CALL, resistance→PUT) | Levels from `supportResistance(candles, {lookback,maxLevels})` (`indicators.mjs:720`, ATR×0.5 clustering over `swingPoints` `:695`) computed on **derived** H4/D1 planes via `deriveAggregatePlanes(base, [14400, 86400], {baseTf:3600})` (`mtfConvergence.mjs:564-571` — whole-multiple, tagged `source:"aggregate"`). **Minimum-history guard (G2):** derive only when the base plane yields ≥30 target-TF bricks (H4: ≥120 hourly bars ✓ within cap 400; D1: needs 720 → **not derivable from live buffers**, use `yahooAdapter` daily `brokers.mjs:85` when the asset maps; else "structure unavailable"). **Pip conversion** is per-asset config (`pipSize` in calibration: 0.0001 FX-major, 0.01 JPY, gold 0.1 /**UNVERIFIED** — extend per class at execution). No level within tolerance on either TF → F2 fails → NO_TRADE. **Assignee:** T8 |
| Trigger candle = **pin bar** (wick > 2× body) **or** candle closes fully beyond the 20 SMA | Pure math on the 5-min trigger candle + `sma(closes,20)` (`indicators.mjs:41`). Pin-bar test: `wick = max(h-c, o-l)` vs `body = |c-o|` on the last closed bar; "closes fully beyond" = `c > sma20` (CALL) / `c < sma20` (PUT) with `o` on the opposite side. **Assignee:** T3 |

### REQ-F3 — Compulsory trend alignment + chop halt

| Blueprint rule | PICC mapping / gap |
|---|---|
| **EMA50** slope + price side aligned with direction | `ema(closes,50)` series (`indicators.mjs:55`); slope = `ema50[i] - ema50[i-k]` (`k` configurable, default 5-bar lookback **UNVERIFIED against blueprint — blueprint gives no lookback; pick and record**); price side = last close above/below EMA50. Alignment: CALL → slope>0 AND close>EMA50; PUT → inverse. **Assignee:** T3 |
| **ADX(14) > 25** compulsory | `adx(highs,lows,closes,14)` (`indicators.mjs:353`); threshold **per asset calibration** (25 default; gold 22; crypto 30 — REQ-CAL). **Assignee:** T3 |
| ADX ≤ 25 → **"Regime 3 Chop"** — halt ALL signals until recovery | Map onto PICC phase vocabulary: ADX≤25 with low ATR% = PICC `quiet_range`/`transition`, high ATR% = `volatile_range` (`detectMarketPhase`, `indicators.mjs:1320-1345`) — the blueprint's Regime-3 halt ≈ PICC `volatile_range`/`quiet_range` suppression with one addition: U4FA also refuses `transition`. **Recovery = regime-confirmation counter**: 2 consecutive 5-min readings above threshold before re-arming (mirrors `updateRegimeBreaker` 2-reading latch `autopilot.mjs:461-506` and the research's 2-3 bar anti-flicker). **Assignee:** T3 |

### REQ-F4 — Boosters (2-of-3 majority; boosters refine, never override F1–F3)

| Booster | Blueprint rule | PICC mapping / gap |
|---|---|---|
| B1 | **StochRSI(14,14,3,3)** %K/%D cross — CALL: %K<60 crosses UP through %D; PUT: %K>40 crosses DOWN | `stochRSI(closes,{period:14,smoothK:3,smoothD:3})` (`indicators.mjs:430`) — exact params. Need **previous-bar** %K/%D for cross detection (series returned; dashboard snapshot is current-only `:1148` — use the series arrays). Thresholds 60/40 from calibration (crypto 80/20). **Assignee:** T3 |
| B2 | 5-min trigger candle close green/red AND body beyond the 20 SMA | Reuses REQ-F2's 20-SMA check + `c>o` (green/CALL) / `c<o` (red/PUT). Strictly the candle body (`|c-o|` both ends beyond SMA). **Assignee:** T3 |
| B3 | **BB exhaustion** — if ADX<30 price must NOT hug upper band (CALL) / lower band (PUT); if ADX>30 rule ignored | `bollinger(closes,{period:20,mult})` (`indicators.mjs:622`) percentB (`:638`); "hug" = `percentB ≥ 0.9` upper / `≤ 0.1` lower (configurable `bbHugPct`); BB mult per calibration. ADX>30 → booster auto-passes. **Assignee:** T3 |

### REQ-MAIN — Main engine

| Blueprint | PICC mapping / gap |
|---|---|
| 5-min chart, EMA50, BB(20,2), StochRSI(14,14,3,3), ADX14 | 5-min = `periods[300]` in live buffers (`liveEO.mjs:37`). All indicators exist (`indicators.mjs`); BB mult 2 default, per-calibration override |
| **Execution timing per ADX regime:** <25 ABORT all; 25–30 enter at **open of NEXT 5-min candle +2s**; >30 enter **immediately at confirmation candle close** | Advisory field `timingRecommendation { mode:"abort"|"next-bar"|"immediate", atMs }` — PICC never auto-orders; the human uses it when approving (REQ-COMP). **Assignee:** T3 |
| **Expiry fixed 15 min** (900 s) | 900 ∈ `CANDIDATE_EXPIRIES` (`adaptiveConfluence.mjs:31`) ✓; per-calibration 30-min (1800 s) for indices/crypto is **NOT** in the set — extend `CANDIDATE_EXPIRIES` and `ASSUMED_PAYOUT` (`:31-32`) or the 30-min entries carry `payoutSource:"observed"` only, else honest "no payout estimate". **Assignee:** T9 |
| **NO_TRADE semantics:** F1–F3 failures | Verdict vocabulary reuses PICC's `NEUTRAL`/`OBSERVE`/`TRADE` + per-factor reason strings (mirrors `evaluateAsset` reasons `adaptiveConfluence.mjs:495-510`) |

### REQ-STYLE — Multi-style presets (config, not code)

Transcribed verbatim from the blueprint; **PICC mapping: one JSON preset object per style** (T2), keyed `style: "1"|"2"|"3"|"4"|"5"`:

| Style | Chart TF | EMAs | ADX threshold | StochRSI levels | BB mult | Sessions |
|---|---|---|---|---|---|---|
| 1 Bullet | 1m | (blueprint) | >30 | 80/20 | 1.5 | NY-London |
| 2 Blitz | 5m | (blueprint) | >25 | 60/40 | 2.0 | NY-London |
| 3 Rapid | 15m | (blueprint) | >20 | 50-midline | 2.5 | NY-London |
| 4 Swing | 1h | (blueprint) | >20 | 50 | 2.5 | any |
| 5 Position | 1D | (blueprint) | >15 | 50 | 3.0 | any |

Notes: (a) blueprint EMAs unspecified for styles 2–5 — **DATA-GAP, leave per-style `emas: []` empty (inherit main-engine EMA50) and flag** rather than inventing; (b) chart TF for styles 4–5 (1h/1D) — 1h exists as a live buffer (`liveEO.mjs:37`); 1D only via Yahoo EOD (see correction table); (c) StochRSI "50-midline" entry rule = `%K` crossing the 0.50 midline (research: standard trend-confirmation convention — the 60/40 usage is the 0.50±0.10 variant; keep blueprint's numbers verbatim in config).

### REQ-CAL — Per-asset calibration (one score row each; "x/5" = blueprint's own confidence score, kept verbatim)

| Class | Score | BB mult | ADX | StochRSI | Expiry | PICC mapping |
|---|---|---|---|---|---|---|
| Forex | 5/5 | 2.0 | 25 | 60/40 | 15 min (900) | Calibration default; pip 0.0001 major / 0.01 JPY (**UNVERIFIED** for minors) |
| Gold | 4/5 | 1.8 | 22 | 60/40 | 15 min (900) | Class key `gold` (GOLD/SILVER/XAUUSD aliasing via `assetCatalog` — **UNVERIFIED**, verify in T9) |
| Indices | 3/5 | 2.2 | 25 | 60/40 | 30 min (1800) | 1800 expiry must be added to `CANDIDATE_EXPIRIES`+`ASSUMED_PAYOUT` (T9) |
| Crypto | 3/5 | 2.5 | 30 | 80/20 | 30 min (1800) | Same 1800 caveat |
| Oil/Commodities | 1/5 **AVOID** | — | — | — | — | Class-level `eligibility:"avoid"` — engine refuses to even evaluate when the class row says AVOID (hard gate, not a soft penalty) |

### REQ-RISK — Risk guards (hard)

| Blueprint | PICC mapping |
|---|---|
| 0.5% of balance per trade | `trading.mjs:81,143` `riskPerTradePct` — **clamp floor is 1, so widening [1,20]→[0.5,20] (or U4FA-sized amount with ≥1-unit floor) is required**; see anchor correction 6 and T10 |
| Daily loss limit −5% → halt until 00:00 GMT | `dailyLossLimitPct: 5` (`autopilot.mjs:51,295` clamp [1,100] ✓); halt semantics per day-key reset in `todayPnl` (`:743`, day boundary is **local server midnight, not 00:00 GMT** — flag and decide in T10: either GMT day-key or accept local; blueprint says GMT) |
| 15-min post-loss notification cooldown (anti-revenge) | New **proposal throttle** (not a trading stop): suppress new `source:"trade"` proposals 15 min after the last resolved loss (accuracy ledger miss or demo-deal loss). Mirrors `cooldownMs` default already 15 min (`autopilot.mjs:48`) but applies to *notification firing* per blueprint. **Assignee:** T11 |
| Max 10 signals/day | `maxDailyTrades: 10` (`autopilot.mjs:52,296` clamp [0,100] ✓) — enforce on U4FA proposal count per day, same `todayTradeCount`-style day key (`:752`). **Assignee:** T10 |

### REQ-COMP — Compliance

| Blueprint | PICC mapping |
|---|---|
| Human must click to execute — system only notifies | Advisory-first PICC already has no execution anywhere (`autopilot.mjs:1332-1337`); U4FA adds the **Augmentation gate**: `source:"trade"` proposal in the interventions queue (`interventions.mjs` pattern), rendered in the bell (`NotificationCenter.tsx`), resolved via `/api/browser/interventions/respond` (`handlers.mjs:4180`); **approve → `openPaperTrade` (`trading.mjs:552`), reject → no order. Never auto-order.** |
| Stated win expectation 62–68% on forex majors; 70%+ is fantasy | **UNVERIFIED claim** — must be ledger/backtest-validated before appearing anywhere in UI (REQ-WIN). Existing validation vehicles: `signalAccuracy()` (`trading.mjs:813`), `ledgerStats`/gate backtest (`accuracyLedger.mjs:235+`), `tradingReadiness()` blockers ≥200 resolved decisions (`autopilot.mjs:989-1095`). |

### REQ-WIN — Win-rate claim gate (this spec's addition, per guardrail G3)

No UI surface, docs string, or notification may assert a "62–68%" (or any) U4FA win-rate until the accuracy ledger has ≥200 **resolved** U4FA decisions and the realized rate is reported honestly alongside the breakeven for the payout used (same logic as `tradingReadiness` `autopilot.mjs:1046-1061`). The claim, when made, must carry `n`, payout, and the demo-only caveat.

---

## 2. Design

### M1 — `fourFactor.mjs` (new service, `apps/dashboard/server/services/fourFactor.mjs`)

Pure, dependency-light module owning the factor pipeline. Inputs: `{ asset, candles5m, dashed (optional precomputed dashboard), calendar, spread, config (merged preset+calibration), ledger (loss events) }`. Output: a single immutable verdict object (REQ-MAIN vocabulary). Reuses:
- `computeIndicatorDashboard` (`indicators.mjs:1102`) for EMA/ADX/SMA/BB/StochRSI **plus the underlying series** (stochRSI k/d arrays for the previous bar — the dashboard snapshot alone is insufficient for the B1 cross).
- `sma`, `ema`, `adx`, `bollinger`, `stochRSI` directly for preset overrides (bollinger mult, adx threshold, stochRSI levels are **per-call params**, not constants — that is how presets become config instead of code).
- `deriveAggregatePlanes` (`mtfConvergence.mjs:564`) for H4 planes and `supportResistance` (`indicators.mjs:720`) for levels.
- `getEconomicCalendar`/`upcomingHighImpact` (news), accuracy-ledger resolved misses + `demoDeals` (correlation lock).
- `recordSignal` (`trading.mjs:749`) + `recordDecision` (`accuracyLedger.mjs:30`) for ledger/signal ingestion — same channel the confluence engine already uses (`adaptiveConfluence.mjs:648-678`), so win-rate validation is homogeneous.

Pipeline order (hard, per blueprint): **F1 → F2 → F3 → F4**. F1–F3 failures return `verdict:"NEUTRAL"` (NO_TRADE) with the failing factor + reason; F4 evaluates only when F1–F3 pass; ≥2 of 3 boosters → `TRADE`, else `OBSERVE` (blueprint "no majority" → no signal). The regime-confirmation counter (anti-flicker, 2 consecutive favorable 5-min readings; **UNVERIFIED vs blueprint — blueprint says "until recovery", no bar count; research consensus says 2-3 bars; default 2, configurable**) latches inside the module mirroring `updateRegimeBreaker` (`autopilot.mjs:461-506`), and the ADX≤25 chop halt overrides every strategy until the latch re-arms.

### M2 — F1 pre-gate assembly (M1's F1 stage + its data suppliers)

- **Session clock** (`fourFactor/sessionClock.mjs` or in-module): `Intl.DateTimeFormat("en-US",{timeZone, hourCycle:"h23", hour, minute})` against `Date.now()`; trueness = config window contains current wall time **in the configured IANA zone**. DST handled by the IANA tz database — no manual offsets. Window + tz from style/calibration config.
- **Spread gate**: reads `spreadSource` config (default `null`). `null` or unavailable → `{ok:false, reason:"spread unmeasurable"}` (abort). When a source is later wired it must return honest `{spreadPips, source, at}`. T6 probes existing buffers for any hidden bid/ask field before concluding; if the probe finds one, wire it; if not, ship the abort default and file a follow-up.
- **News blackout**: `upcomingHighImpact(events,{days})` → filter `Math.abs(eventAt - now) <= newsBlackoutMin*60_000` and the event's currency touches the asset's quote/base (config `calendarCurrencyMap` per asset, honest labels). Calendar source label rides the payload.
- **Correlation lock**: scan resolved accuracy-ledger entries + recent demo deals for a loss on any `correlations[asset].triggers[]` within `correlationPauseMs` (default 15 min) → pause. Config `correlations: {"GBPUSD": {triggers:["EURUSD"], pauseMs: 900000}}` — static, declared, not measured.

### M3 — F2 structure assembly

`resolveStructureLevels(asset, config)`:
1. Base = `periods[3600]` from `getBrokerData()` (`brokers/index.mjs:107`). If `< 120` bars → H4 unavailable.
2. H4 plane = `deriveAggregatePlanes(hourly, [14400], {baseTf:3600})[14400]`; if `< 30` H4 bricks → H4 unavailable.
3. D1 plane = try `yahooAdapter`/`marketDataBus.getBestCandles(asset, 86400, 120)` when the asset maps (else **UNVERIFIED lite**: `yahooSymbolFor` coverage for all forex minors/gold — verify in T8); **do not** derive D1 from the live buffer (needs 720 hourly bars > cap 400, `liveEO.mjs:49`).
4. `supportResistance(plane)` → nearest support/resistance level each; tolerance = `10 * pipSize` per calibration; CALL = price within tolerance above a support; PUT = within tolerance below a resistance.
5. Any source unmeasurable → that leg is `unavailable` (F2 can still pass on the other leg); **both** unavailable → F2 fails with truthful reason.

### M4 — Integration into `adaptiveConfluence.mjs` (strategy dimension, gates stay on top)

`evaluateAsset` (`adaptiveConfluence.mjs:370`) gains an optional `strategies` overlay, **default OFF per asset** (config `u4fa: { enabled: false, style: "2", weight: 0.4 }` per watched asset):

- When enabled, `evaluateU4FA(...)` runs on the same `periods[300]` candles (`:567` reads `periods[ANALYSIS_PERIOD]`, i.e. 60s — U4FA needs its own 300s slice from `a.periods`) and its verdict is attached as `decision.strategies.u4fa = {...}` — the confluence decision object keeps its exact existing shape (tests pin it).
- **The composite honesty gates are NOT bypassed** (guardrail G3): a U4FA `TRADE` direction still flows through `winProbEstimate` (damped, `adaptiveConfluence.mjs:216-243`), `pricePathRR` (`:311`), `evGate` (`:347`), `MIN_SCORE`/phase restrictions (`:441-454`) before the merge. Merged confidence = confluence confidence + `weight * u4fa_signal_strength` (clamped 45–92, same clamp `:462`); disagreement subtracts like the MTF boost (`:451-461` pattern).
- **Veto semantics:** when U4FA is enabled and returns a hard `NO_TRADE` at F1–F3 (esp. Regime-3 Chop), it contributes a veto to that asset's confluence TRADE (config `u4faVeto:true` default) — the strategy dimension can block, never force, a trade.
- Expiry: U4FA presets request 900/1800; add 1800 to `CANDIDATE_EXPIRIES` + an `ASSUMED_PAYOUT[1800]` **only if** the payout can be estimated honestly from observed demo deals (`observedPayouts`, `adaptiveConfluence.mjs:627-646`); otherwise 1800 candidates resolve with `payoutSource:"observed"` only and are marked `payoutBeats:false` when no observation exists — that is the honest failure.

### M5 — Risk mapping onto config

One U4FA risk block in the autopilot/credentials config (merged over defaults):

| Blueprint | Config target | Verdict |
|---|---|---|
| 0.5%/trade | `riskPerTradePct` (`trading.mjs:81,143`) | Widen clamp to [0.5,20] (T10 checks `trading.test.mjs` pins) or U4FA-sized `amount = max(1, balance*0.005)` at proposal time using `defaultAmount`-style math (`autopilot.mjs:758-780`) |
| −5% daily | `dailyLossLimitPct: 5` | ✓ clamp fits; **decide day-key**: blueprint says 00:00 GMT, code uses local midnight (`autopilot.mjs:743-748`) — T10 either switches the U4FA day-key to UTC or documents the deviation |
| 10 signals/day | `maxDailyTrades: 10` | ✓ clamp fits (`:296`); count applied to U4FA proposals + paper entries |
| 15-min post-loss cooldown | New `u4fa.postLossNotifyCooldownMs: 900000` | Proposal-suppression only (M8), not a trading stop |

### M6 — Augmentation gate (human approval → paper execution)

`interventions.mjs` gains `proposeTrade(proposal)` mirroring `proposeCaptureLogin` (`interventions.mjs:290-310`): `newProposal` with `source:"trade"`, `action:"order"`, `risk:"high"`, `label`/`detail` carrying the U4FA payload summary; a module-level `tradeGate` latch (single pending trade proposal at a time — applies the 10/day and 15-min-post-loss throttles here). `respondIntervention` (`:325-390`) gains a `tradeGate` branch exactly parallel to the `captureGate` branch (`:331-347`): `approve → openPaperTrade(u4faOrder)`; `reject → no order`, proposal status recorded; NOTHING executes before approval. The post-loss throttle suppresses new `proposeTrade` calls (not the approval of an already-pending one).

`NotificationCenter.tsx` widens the hard filter `:46,57` from `source === "capture"` to `["capture","trade"]`; the `trade` rows render a compact signal card (direction, asset, expiry, factor summary) with Approve/Reject feeding the existing `respondIntervention` (`:53-65`). The bell's honest-empty posture (`:193-201` — never claims "all approved") is preserved.

### M7 — Presets & calibration as config (not code)

`trading-autopilot.json`-adjacent, or a dedicated `u4fa-config.json` in `PICC_TRADING_DATA_DIR` (same atomic read/write pattern as `autopilot.mjs:153-208`): `{ presets: {1..5}, calibration: { forex|gold|indices|crypto|commodities }, correlations, sessionWindows, newsBlackoutMin, pipSizes, bbHugPct, regimeConfirmBars, expiries, postLossNotifyCooldownMs, u4faVeto }`. Load-on-boot, validated against a schema; unknown keys rejected (honest config: a typo'd knob fails loudly, it does not silently default).

### M8 — JSON signal payload schema (on the existing channels)

New SSE event `type:"u4fa"` over the existing `/api/trading/realtime` stream (same SSE infra as `emitDecisions` → `handlers.mjs:1134`) and included as `strategies.u4fa` inside `/api/trading/decisions` results (`:1225`):

```json
{
  "type": "u4fa",
  "ts": 1780000000000,
  "assetId": "EURUSD",
  "style": "2",
  "direction": "up",
  "verdict": "TRADE",
  "expiry": 900,
  "factors": {
    "f1": { "pass": true, "checks": { "session": "open", "spread": "unmeasurable", "news": "clear", "correlation": "clear" } },
    "f2": { "pass": true, "structure": { "tf": 14400, "level": 1.08412, "tolerancePips": 10, "trigger": "pin-bar" } },
    "f3": { "pass": true, "adx": 31.2, "ema50Side": "above", "ema50Slope": 0.003, "chop": false },
    "f4": { "boosters": [2, 3], "passed": 2, "required": 2, "detail": { "stochCross": false, "candle20Sma": true, "bbExhaustion": "ignored-adx>30" } }
  },
  "regime": { "adx": 31.2, "phase": "trend", "pccPhase": "trend", "chop": false },
  "timing": { "mode": "immediate", "atMs": 1780000000000, "note": "ADX>30 — enter at confirmation candle close" },
  "indicators": { "close": 1.08412, "ema50": 1.08391, "adx": 31.2, "bb": { "upper": 1.0851, "mid": 1.0839, "lower": 1.0827, "percentB": 0.72 }, "stochRsi": { "k": 63.1, "d": 58.4 } },
  "risk": { "riskPct": 0.5, "dailyLossLimitPct": 5, "maxDailyTrades": 10 },
  "compliance": { "requiresHumanApproval": true, "proposalId": null },
  "honesty": { "spreadSource": null, "structureSource": "aggregate-h4", "calendarSource": "feed", "candleSource": "liveEO-studio" }
}
```

Grounding-in-code rule (P4 of `docs/PROMPT_PATTERNS.md`): every `honesty` key is filled from the actual producer of the value in this run — an `unmeasurable` spread is a real probe result; `structureSource:"aggregate-h4"` means the level really came from the derived 14400 plane; no field is default-filled to pass a gate.

---

## 3. Non-goals

- **No live-money order placement, anywhere, ever.** Demo/paper only; the demo-only guard is restated (G1) and the paper path is `openPaperTrade` (`trading.mjs:552`) behind human approval only.
- **No Python module layout.** The blueprint's Python file structure is explicitly NOT followed; concepts map onto PICC's ESM services.
- **No new broker/venue adapters** (MetaApi/OANDA/Alpaca stay roadmap Wave-2) and **no executor-registry build** — execution was removed from PICC; U4FA does not resurrect it. The executor seam remains roadmap Wave-1 work, out of scope here.
- **No weakening** of `CANDIDATE_EXPIRIES` payout honesty, EV R:R, winProb damping, phase restrictions, rate limiters, or honesty labels to make U4FA tests pass (G3/G4).
- **No spread engine build** — the spread gate stays `unmeasurable` until a real bid/ask source is wired (T6 outcome decides; a follow-up is filed if none exists).
- **No D1 history harvest** beyond existing sources; D1 stays Yahoo-EOD-only until live buffers hold ≥720 hourly bars.
- **No portfolio-level risk engine** (positionManager's `portfolioRiskCheck` is untouched; the U4FA risk block is per-trade/per-day as the blueprint defines).
- **No auto-execution toggle.** Even with a paper executor present, the human-click gate is unconditional (`compliance.requiresHumanApproval` is always true).

---

## 4. Checklist — tasks, acceptance criteria, blocking edges

Priority: **P1** must ship · **P2** should ship · **P3** if time. Effort: S ≈ <1 session · M ≈ 1 · L > 1.

| Task | P | Effort | Blocks | Blocked by |
|---|---|---|---|---|
| T1 Baseline | P1 | S | — | — |
| T2 U4FA config module (presets/calibration/session/correlations) | P1 | M | T3, T8, T9 | — |
| T3 `fourFactor.mjs` pure factor pipeline (F2–F4 + regime latch + timing) | P1 | L | T9 | T2 |
| T4 F1 session clock (IANA/DST, configurable) | P1 | S | T9 | — |
| T5 F1 news blackout (economicCalendar reuse) | P1 | M | T9 | — |
| T6 F1 spread gate probe + honest abort | P1 | S | T9 | — |
| T7 F1 correlation lock (ledger loss events) | P2 | M | T9 | — |
| T8 F2 structure levels (H4 derive, D1 Yahoo, pip conversion, min-history guard) | P1 | M | T9 | T2 |
| T9 adaptiveConfluence integration + 900/1800 expiries; strategy-off byte-identical | P1 | L | T10, T11, T12 | T2, T3, T4, T5, T6, T8 |
| T10 Risk mapping (0.5% clamp widen or sized amount; −5% GMT day-key; 10/day) | P1 | M | T11 | T9 |
| T11 Augmentation gate (`proposeTrade`, bell filter, throttle, paper-only approval) | P1 | M | T12 | T9, T10 |
| T12 Payload schema + `u4fa` SSE/decisions emission + contract pins | P1 | M | — | T9, T11 |
| T13 **Live E2E venue-session acceptance test (real tab → studio → server → decisions)** | P1 | L | T14 | — |
| T14 Backtest-gate validation of any win-rate claim (≥200 resolved) | P1 | M | UI claim | T13 |
| T15 Docs (runbook Part-B, roadmap update, honesty copy) | P3 | S | — | T9–T14 |

### T1 — Baseline (P1 · S)
Run `npm test` + `npm run typecheck` in `apps/dashboard` (`apps/dashboard/package.json` scripts — **UNVERIFIED exact names, check at execution**). Record counts in the PR body. Existing suite ≈ **UNVERIFIED count this session** (roadmap §1.3 cites 764; verify). **Acceptance:** green baseline recorded; any drift intentional + counted.

### T2 — U4FA config module (P1 · M)
New `u4fa-config.json` loader in `apps/dashboard/server/services/u4faConfig.mjs` (atomic tmp+rename read/write pattern of `autopilot.mjs:153-208`; `VITEST`-suppressed writes like `liveEO.mjs:90-116`). Contains REQ-STYLE presets 1–5 (verbatim numbers), REQ-CAL classes (verbatim, incl. AVOID), `sessionWindows`, `newsBlackoutMin:15`, `correlations`, `pipSizes`, `bbHugPct:0.9`, `regimeConfirmBars:2`, `expiries:[900,1800]`, `postLossNotifyCooldownMs:900000`, `u4faVeto:true`, `spreadSource:null`. **Acceptance:** schema-validated defaults equal the blueprint transcription; a typo'd key fails validation loudly; AVOID-class assets are hard-refused by the loader's per-asset resolver (REQ-CAL). *Blocks T3/T8/T9.*

### T3 — `fourFactor.mjs` pure pipeline (P1 · L)
Implement M1: `evaluateU4FA({asset, candles5m, dash, calendar, spread, ledgerEvents, config})` executing F1→F4 in order with per-factor result objects, NO_TRADE on F1–F3, 2/3 booster majority on F4, EMA50 slope (record chosen lookback — blueprint unspecified), pin-bar (wick>2×body) & 20-SMA-close trigger, B1 prev-bar stochRSI cross, B2 candle body beyond SMA20, B3 percentB hug rule with ADX bypass, Regime-3 Chop latch with `regimeConfirmBars` re-arm, ADX-band `timingRecommendation` (abort/next-bar+2s/immediate). **Acceptance:** pure unit tests from candle fixtures (no network) — each factor's pass/fail flips on a constructed boundary (e.g. ADX 24.9 vs 25.1; pin-bar body ratio; %K cross direction; hug at percentB 0.89 vs 0.91); chop latch: 1 favorable reading does NOT re-arm, 2 does; F4 with 1/3 boosters → OBSERVE; F1 spread unmeasurable → NEUTRAL with honest reason (fixtures inject a spread source to test the pass path). *Blocked by T2; blocks T9.*

### T4 — F1 session clock (P1 · S)
`sessionInWindow(window, now)` using `Intl.DateTimeFormat` with `timeZone` from config; default `{tz:"Europe/London", start:"07:00", end:"16:00"}` (blueprint), plus `ny-london` (13:00–17:00) and `any` profiles. **Acceptance:** unit tests with injected fixed `Date` around DST boundaries (March/October UK switch) prove wall-clock + tz correctness (e.g. 08:00 Europe/London in BST ≠ 08:00 GMT); window and tz changes take effect without redeploy (config-driven); out-of-window → F1 fail. *Blocks T9.*

### T5 — F1 news blackout (P1 · M)
Reuse `getEconomicCalendar`/`upcomingHighImpact`/`withinWindow` (`economicCalendar.mjs:92,119,82`); blackout = `|eventAt − now| ≤ newsBlackoutMin` AND event currency ∈ asset's `calendarCurrencyMap`. **Acceptance:** with a seeded events fixture, a high-impact USD event ±15 min blocks EURUSD (and all USD-mapped assets) and does not block EURJPY unless JPY also high-impact; `newsBlackoutMin` config change honored; calendar `source:"feed"|"fallback-schedule"` label rides the payload; calendar fetch failure → **fail-open or fail-closed decision recorded in code** (recommend fail-open-with-`"fallback-schedule"` label to match existing engine behavior — record which, test it). *Blocks T9.*

### T6 — F1 spread gate probe + honest abort (P1 · S)
Audit scene: grep every data payload shape (EO parsers, ccxt adapter, liveEO buffers, accountMetrics) for any bid/ask/spread field; if found, wire `spreadSource`; if not, keep `spreadSource:null` → gate always `{ok:false, reason:"spread unmeasurable"}`. **Acceptance:** probe results documented in the PR; with `spreadSource:null`, F1 spread check is false with the exact honest reason in the payload; a fixture-injected `{spreadPips, source}` value drives the ≤1.5 boundary test; no fabricated spread ever enters a payload. *Blocks T9.*

### T7 — F1 correlation lock (P2 · M)
Read resolved losses from accuracy ledger (`accuracyLedger.mjs` entries with `result:"miss"`) + demo deals (`autopilot.mjs:1265`); static `correlations` map from T2; pause `correlationPauseMs` (15 min default) on trigger asset loss before allowing the paused asset's F1. **Acceptance:** injected ledger with a EURUSD miss 2 min ago → GBPUSD F1 blocked; 16 min ago → allowed; a win does not block; no ledger data → no block (fail-open but logged). *Blocks T9.*

### T8 — F2 structure levels (P1 · M)
Implement M3: H4 via `deriveAggregatePlanes(…, [14400], {baseTf:3600})` + min-history guard (≥30 planes, ≥120 hourly bars); D1 via best-candles request for 86400 (Yahoo EOD) when `assetCatalog.yahooSymbolFor` maps the asset (verify coverage for the watched set first — see correction table); `supportResistance` levels; tolerance `10·pipSize`; CALL/PUT mapping; either leg unavailable → other leg may still pass; both → F2 fail with truthful "structure unavailable". **Acceptance:** fixtures with scripted planes yield the expected level hit/miss at ±10 pips; <30 H4 bricks → H4 leg unavailable (never a fabricated level); D1 with no Yahoo mapping → unavailable, engine still works off H4; JPY pair pip conversion (0.01) verified against a fixture. *Blocked by T2; blocks T9.*

### T9 — adaptiveConfluence integration (P1 · L)
Implement M4: `evaluateAsset` gains optional `strategies.u4fa` (default OFF per asset), same candles path but reading `periods[300]`; merged confidence with `weight`; U4FA veto (default on) blocks confluence TRADE on F1–F3 NO_TRADE; 1800 added to `CANDIDATE_EXPIRIES` with payout honesty (observed-only until `ASSUMED_PAYOUT[1800]` can be estimated — else `payoutSource:"observed"` and `payoutBeats:false` when absent). **Acceptance:** with U4FA OFF, existing `adaptiveConfluence.test.mjs` passes **byte-identically** (strategy-off default is the regression lock); with U4FA ON on a fixture asset: a U4FA TRADE direction still fails the composite gate when EV R:R < 2 / winProb < 0.52 damped / phase = `volatile_range` (guardrail G3 proofs each refusal); U4FA Regime-3 Chop vetoes a confluence TRADE; 1800-expiry candidate reports honest payout source. *Blocked by T2–T8; blocks T10–T12.*

### T10 — Risk mapping (P1 · M)
Implement M5. **Decisions pinned 2026-08-30 by project owner — not re-opened at implementation:**
- **Decision A — risk nozzle: option (b), U4FA-sized amount.** Amount = `max(1, balance×0.005)` computed at proposal/approval time from `paperOverview().cash`; the ≥1-unit floor is declared honestly in the proposal when it binds. The global `riskPerTradePct` clamp `[1,20]` (`trading.mjs:143`) is **NOT widened** (avoids R6 ripple into pinned `trading.test.mjs` assertions).
- **Decision B — day-key: 00:00 GMT, U4FA-owned.** The U4FA risk layer runs its OWN UTC day-key (`new Date().toISOString().slice(0,10)`), carrying the −5% daily-loss barrier and the 10/day proposal counter against that key. The legacy `dailyLossLimitPct`/`maxDailyTrades` knobs in `autopilot.mjs` keep their existing local-midnight semantics **unchanged** (their tests stay put). Deviation from spec-acceptance "trips the existing daily-loss refusal": the GMT barrier is implemented U4FA-side (accuracy-ledger/demo-deal PnL by UTC day), NOT via `autopilot.mjs:851-854`, and the deviation is recorded in the `u4fa-config.json` comment (blueprint explicitly says 00:00 GMT).
`maxDailyTrades:10` counting U4FA proposals/day; `postLossNotifyCooldownMs:900000` suppressing new proposals (M8) after the last resolved U4FA loss. **Acceptance:** (A) three-balance × three-percent boundary cases unit-tested; (B) a U4FA daily PnL of −5% of the UTC-day starting balance blocks the next U4FA proposal with the barrier reason; the 11th U4FA proposal in one UTC day is refused; day-rollover at 00:00:01 GMT resets both counters; the config comment names the deviation from autopilot's local-midnight accounting. *Blocked by T9; blocks T11.*

### T11 — Augmentation gate (P1 · M)
Implement M6: `interventions.proposeTrade(...)` with the `tradeGate` single-pending latch mirroring `captureGate` (`interventions.mjs:290-347`); `respondIntervention` trade branch → `openPaperTrade` (`trading.mjs:552`) on approve only; post-loss proposal throttle (15 min after ledger miss); `NotificationCenter.tsx:46,57` filter widened to include `"trade"` with a compact signal card render. **Acceptance:** proposal lifecycle tests — propose → pending in `/api/browser/interventions` (`handlers.mjs:4174`); approve → exactly one `openPaperTrade` call with the U4FA order shape, proposal `approved`; reject → zero calls, proposal `rejected`; a second `proposeTrade` while one is pending returns the same id (no dupes); post-loss throttle suppresses new proposals for 15 min; paper-only asserted at the call site (no other execution path exists — `autopilot.mjs:1332-1337`); bell contract test (additive) green. *Blocked by T9+T10; blocks T12.*

### T12 — Payload schema + emission + pins (P1 · M)
Implement M8: `type:"u4fa"` SSE events over the existing `/api/trading/realtime` transport + `strategies.u4fa` in `/api/trading/decisions`; every `honesty` key filled from the real producer; rate-limiter interplay checked (a «watch `DECISION_INTERVAL_MS`/`LEDGER_LOG_COOLDOWN_MS` (`adaptiveConfluence.mjs:41-42`) — do not exceed existing cadence). **Acceptance:** a contract test pins the payload shape field-by-field (missing/renamed field fails, mirroring the multisource `T9` pins in `docs/specs/PICC_MULTISOURCE_ENGINE.md:105`); payloads for a spread-abort carry `"spread":"unmeasurable"` and never a numeric estimate; SSE stream delivers the event on the same socket as `decision` events; no new unwrapped endpoint. *Blocked by T9+T11.*

### T13 — Live E2E venue-session acceptance test (P1 · L) ⛔ **blocking edge**
Human-run, Part-B style (see `docs/TRADING_RUNBOOK.md` Part-B pattern — **UNVERIFIED exact layout, check at execution**): on ONE real, logged-in venue tab (EO demo): (1) the studio browser captures the venue session (PICC-side toggle ON, `sourceLeg:"studio"` observed); (2) the server ACKs the saved session (`POST /api/trading/capture-session`, `handlers.mjs` — extension-era popup step removed with D1); (3) live venue data flows — `getBrokerData` shows the real asset, `periods[300]` advances, `getSessionLive()` reports the studio leg; (4) U4FA evaluation over that real data produces verdicts with honest `candleSource:"liveEO-studio"`. **Acceptance:** all four steps pass and are logged (`docs/T11_E2E_MANUAL_LOG.md` is the existing log format — reuse it); any failure here **blocks T14** and any real-data-consumption claim in the UI; step (4) is repeatable for ≥15 min of live bars. This is the user-flagged open item, restated for the studio leg — the mock-API tests proved only the wire contract, not the venue reality. *Blocks T14.*

### T14 — Backtest-gate validation of win-rate claim (P1 · M)
With ≥200 **resolved** U4FA decisions in the accuracy ledger (and/or demo deals via `openPaperTrade` outcomes), run the existing validation: `signalAccuracy()` (`trading.mjs:813`), `ledgerStats` + gate backtest (`accuracyLedger.mjs:235+`), and the `tradingReadiness` blocker style (`autopilot.mjs:989-1095`: breakeven at the used payout, edge > 0, calibration adequacy). **Acceptance:** no UI/docs string asserts any U4FA win-rate until this gate passes; post-pass, any claim carries `n`, payout, and the demo-only caveat; a failing edge (>0) or below-breakeven realized rate blocks the claim; the 62–68% blueprint figure is displayed as **unvalidated-aspiration or not at all**. *Blocked by T13 (real-data consumption).*

### T15 — Docs (P3 · S)
Update `docs/TRADING_MULTIPLATFORM_ROADMAP.md` (U4FA as an advisory strategy dimension; correction that execution was removed and `getDemoSession` consumers fail closed), `docs/TRADING_RUNBOOK.md` Part-B (T13 checklist + blackout/spread honesty), `docs/ARCHITECTURE.md` data flow. **Acceptance:** grep shows no "executorRegistry exists", "session singleton welded", or "spread measured" claims; reviewer diff check.

---

## 5. Risks

- **R1 (most likely to bite): strategy-on changes existing decision-engine output.** Even with strategy-off as default, wiring `strategies.u4fa` into `evaluateAsset` can shift `reason`/`confidence` fields that existing tests pin. Mitigation: T9's strategy-off byte-identical assertion is the regression lock; any changed assertion must be intentional and counted (same discipline as `PICC_MULTISOURCE_ENGINE.md` R1).
- **R2: D1 level coverage is genuinely underspecified.** Live buffers cannot derive D1 (cap 400 < 720 hourly bars, `liveEO.mjs:49`); Yahoo-EOD `yahooSymbolFor` coverage for the freight of forex minors/gold is **UNVERIFIED**. Mitigation: T8 verifies mapping first (fixture inspection before coding), H4 remains the primary leg, D1 unavailable → truthful fail; if Yahoo mapping proves large, ship H4-only and file D1 as follow-up.
- **R3: F1 spread-abort turns the whole engine into a NO_TRADE machine at launch.** Since `spreadSource:null` blocks F1 for every asset, early integration tests "expect trades" will fail by design. Mitigation: T6 probes first; fixtures inject a fake spread source to prove the pass path and the engines' honesty on the abort path; the payload's `"spread":"unmeasurable"` reason is surfaced in the UI pod — this is the intended honest behavior, not a bug.
- **R4: the interventions queue has one-running-workflow semantics.** `respondIntervention` throws "intervention is not for the running workflow" when a workflow is running with a different pendingId (`interventions.mjs:349`). The `tradeGate` branch must short-circuit exactly like `captureGate` (`:331-347`), before the running check — a copy-paste of the capture branch is the correct shape. Tests must cover the "workflow running while trade proposal pending" interleaving.
- **R5: the 1800 s expiry (indices/crypto) has no honest payout estimate.** `ASSUMED_PAYOUT` only covers 60/120/300/900 (`adaptiveConfluence.mjs:32`). Mitigation: T9 keys 1800 to `observedPayouts` only; absent observations → `payoutBeats:false` → the 30-min candidates cannot clear the composite gate until real demo payouts exist — honest, and self-healing as demo data accrues.
- **R6: clamp widening for 0.5% risk can ripple.** `riskPerTradePct` clamp [1,20] (`trading.mjs:143`) is likely pinned by tests. Mitigation: T10 greps and updates pins deliberately, or chooses the sized-amount path (option b) which touches no clamp.
- **R7: real-tab E2E (T13) may find the studio's session-sync is cosmetic.** The user flagged this; it is exactly what T13 exists to reveal. If step (2)/(3) fail on a real logged-in tab, the fix is in the studio capture relay, and **no U4FA real-data feature ships until it passes** — this is a gating edge, not a design risk to work around.

## 6. Honesty appendix

**Claim vs. observed (every unverified number is labelled in the Requirements table; the load-bearing ones repeat here):**
- 62–68% win expectation: **UNVERIFIED aspiration** — gated by REQ-WIN/T14; never asserted in UI without ledger validation, `n`, payout, and the demo-only caveat. The blueprint's own note that 70%+ is fantasy is the standing ceiling for any claim copy.
- Spread ≤1.5 pips: **no bid/ask source verified** (`brokers/index.mjs:17` candles-only contract; EO parsers read this session expose OHLC/account only) → gate aborts with `"spread unmeasurable"`; fixture-injected only in tests.
- D1 level availability: live-buffer D1 derivation is **structurally impossible** (720 hourly bars needed vs 400-bar cap); D1 leg = Yahoo delayed-EOD only when mapped; `supportResistance` levels carry their derivation source (`aggregate-h4`/`yahoo-d1`) in `honesty.structureSource`.
- News blackout: calendar can be the static fallback schedule (`economicCalendar.mjs:50-80`) — approximate and labelled `"fallback-schedule"`, never presented as live feed.
- Session window: blueprint says "07:00–16:00 GMT"; implemented as **Europe/London IANA wall-clock** (DST-aware) per research; the difference (GMT vs London tz) is a config default, not a silent relabel — the default value itself is documented as the blueprint's window in the config file.
- EMA50 slope lookback and regime-confirmation bar count are **blueprint-unspecified parameters** — defaults `5` bars and `2` readings chosen from research consensus, both configurable and recorded in `u4fa-config.json`; the code comments say the blueprint is silent.
- Day boundary for the daily loss limit: **code uses server-local midnight** (`autopilot.mjs:743-748`); blueprint says 00:00 GMT — deviation decided + documented in T10, not silently "fixed" to GMT behind the user's back.
- `getDemoSession` consumers (`brokers.mjs:41`, `positionManager.mjs:60`, `trading.mjs:915`) currently fail closed on a nonexistent export — the spec's T15 docs task records this; U4FA does not depend on any of them for correctness.

**Guardrail restatement (non-negotiable):**
- **G1 — Demo-only forever:** no live-money order placement anywhere; the only execution path in scope is `openPaperTrade` (`trading.mjs:552`) behind the M6 human-approval gate. Nothing in this spec adds, widens, or softens an execution path.
- **G2 — No fabricated numbers:** every unverifiable input (spread, D1 levels, calendar source, payout for 1800 s) degrades to `unavailable/abort` with a truthful reason string; a zero-filled default or invented level that could pass a gate is a spec violation.
- **G3 — Existing honesty gates stay ON TOP of U4FA:** EV R:R ≥2 (`adaptiveConfluence.mjs:11,36`), winProb damping toward 0.5 (`:14,240-241`), payout margin 1.15 (`:37,360`), min score / whipsaw-only-OBSERVE (`:15-16,453`). U4FA adds a strategy dimension and a veto; it never bypasses the composite gate. T9 proves each refusal path.
- **G4 — No weakening to pass tests:** rate limiters (`LEDGER_LOG_COOLDOWN_MS` `adaptiveConfluence.mjs:42`, SSE cadence), honesty labels, and the `capture`/`trade` proposal queue semantics stay intact; contract pins (T12) make a weakening fail loudly.