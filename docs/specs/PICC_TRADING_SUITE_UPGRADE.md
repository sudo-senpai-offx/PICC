# PICC Trading Suite Upgrade — spec v1

**Status:** planned → executed. **Resolution:** SUPERSEDED — P1 delivered (see commit trail); remaining P2/P3 backlog superseded by the reskin, the suite rebuild and the v3.2 layered-engine rebuild (ADR-0003/0004) (**Date:** 2026-09-19)

**Scope:** chart-history depth (Yahoo intraday + CCXT OHLCV), asset breadth, parked-endpoint integration, suite UI transformation. Write-only planning artifact — no code changes in this session.

**Extends:** `docs/TRADING_MULTIPLATFORM_ROADMAP.md` (suite roadmap), `docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md` (advisory-first posture, honesty keys), `docs/specs/PICC_MULTISOURCE_ENGINE.md` (data-source honesty, pin convention at `:105`), `docs/PROMPT_PATTERNS.md` P4/P5 (structured-output contracts; negative-space guardrails).

**Grounding rule (per PICC convention):** every `file:line` below was read this session; anything not re-read is marked **UNVERIFIED**. The mission brief is the authoritative requirement; where a requirement says "DATA-GAP" it has no verified PICC producer and must degrade to honest emptiness (`source:"none"` / `null`), never a fabricated value (G2).

---

## Requirements

| ID | Requirement (user-visible, testable) |
|----|---------------------------------------|
| REQ-1 | **Intraday chart history.** Every catalog asset with a `yahooSymbolFor` mapping (`assetCatalog.mjs:121-164`) can chart Yahoo intraday bars — 5m/15m/30m/90m-class up to ~60 days, 1h up to ~730 days, plus 1D/1W/1M — tagged with the SERVED timeframe, source, and depth. Caps are the Yahoo API contract (user ground truth: 1m ~5–7 d, 5m/15m/30m ~60 d, 1h/2h ~730 d; not network-verified this session — treat as API contract under test fixture, not live probe). |
| REQ-2 | **CCXT real candles.** With ≥1 configured ccxt exchange, crypto charts serve real historical candles from `liveCCXT`/`ccxtConnector` — `getCandles` no longer returns `[]` unconditionally (`ccxtAdapter.mjs:48-53`). `[]` remains the honest answer only when nothing is configured/mapped. |
| REQ-3 | **No fake 4h.** Yahoo never serves 4h bars. A `14400` request on a Yahoo-only asset declines via the existing resolver contract (`resolveTimeframeFor` above-range → null, `EXTENSION_CONNECTIVITY_ENGINE.md` T5) and the bus falls through to `source:"none"` or a thinner honest source. |
| REQ-4 | **Merge honesty.** Merged candle responses carry `historyDepth` (total bars), `backfilled` (count), and per-bar `backfilled:true` markers. The bus NEVER merges across different served resolutions. Client-side mixed-resolution guard (`useCandleData.ts:259-298`) stays byte-identical. |
| REQ-5 | **Asset breadth.** The Live Chart selector lists the full catalog grouped by category (metals / energies / indices / forex / crypto / equities), not the 4 hardcoded options (`TradingSuite.tsx:160-168`). Includes a curated equity/ETF set (super-set of the existing widgets' tickers). |
| REQ-6 | **Integration surfaces.** Spread pre-check, portfolio aggregate + risk check, account metrics, and system capabilities appear in the suite with honest empty/unconfigured states (never zero-filled). |
| REQ-7 | **U4FA overlay.** When `strategies.u4fa.enabled` is true for an asset (`adaptiveConfluence.mjs:384-390`), U4FA verdict/marker events render on the chart from the real `type:"u4fa"` SSE wire (`liveTrading.ts:428-432`, pinned by `u4faStream.test.ts:1-2`). No fabricated markers when the strategy is off. |
| REQ-8 | **One push subscription.** Subscribe/unsubscribe lives in ONE shared hook used by the bell (`NotificationCenter.tsx:139-141` currently permission-only) and the suite; unconfigured VAPID renders "push unavailable", never a fake `sent`. |
| REQ-9 | **Multi-condition + webhook alerts.** Alerts compose conditions with AND/OR over the existing enum (`alertEngine.mjs:52-53`: `price_above|price_below|price_crossing_up|price_crossing_down|pct_change_up|pct_change_down|convergence_above`); optional webhook channel; unconfigured channels report `skipped`, never `sent`. |
| REQ-10 | **Chart tooling.** Indicator overlay set (MA/EMA/RSI/MACD/Bollinger/volume) toggleable on the existing chart; multi-timeframe pane set (≤3 panes). |
| REQ-11 | **Suite navigation.** The 26-panel stack (`TradingSuite.tsx:176-206`) groups into sectioned tabs (pure layout, no logic change); watchlist gains columns + JSON import/export. |

## Gap analysis (grounded in `docs/trading-suite-competitor-research.md`)

| Area | Competitor landscape | PICC today | Gap → slice |
|------|----------------------|------------|-------------|
| Asset breadth | Retail dashboards win on breadth + ultra-short expiries (`competitor-research.md:54`) | Full catalog EXISTS server-side (`assetCatalog.mjs:16` ASSET_ALIASES, `:121` yahooSymbolFor) but the chart Select hardcodes 4 options (`TradingSuite.tsx:160-168`) | T4 |
| Deep charting | TradingView-class tools are the differentiator competitors lack (`:54`, `:131`) | Single pane, no overlay toggles, no history depth (Yahoo daily-only `yahooAdapter.mjs:15-16`) | T1–T3, T10–T11 |
| Data-source honesty | Weak across retail (`:118` "data provenance opaque") — PICC's unique trust feature (`:131`) | Already strong: `SOURCE_BADGES` `TradingChart.tsx:23-28`, resolved-tf tags, mixed-resolution guard \(useCandleData.ts:264\). Must NOT regress when intraday arrives | T1–T3 (extend, don't weaken) |
| Cross-venue pre-checks | None in mainstream suites | Spread + aggregate endpoints EXIST but parked (`handlers.mjs:2510`, `:2530`) | T5–T6 |
| Backtesting | Weak in retail (`:54`) | Already present (`BacktestPanel` `TradingSuite.tsx:184`, `backtestGates` `accuracyLedger.mjs:239`) | — (keep as-is; P3 polish) |
| Alerting | TradingView multi-condition | Single-condition enum (`alertEngine.mjs:52-53`) | T9 |

## Design

### Decision A — deep history: server-side merge (chosen)

**Chosen: (a) server-side merge inside the bus.** `getBestCandles` (`marketDataBus.mjs:99-145`) keeps its exact contract and single-source short-circuit (first broker with ≥30 bars returns, `:119-120`). After a primary result is chosen, a SECOND pass over the same active-broker list looks for a history source serving the SAME `servedTf` (Yahoo intraday or CCXT); if found and different from the primary, older bars are appended with dedup-by-timestamp (newest wins) and per-bar `backfilled:true`. New response keys are ADDITIVE: `historyDepth` (total bars), `backfilled` (count), `historySpanMs`. `source` stays the LIVE source — the badge must name the live feed, and a separate `historySource` key names the backfill.

**Rejected: (b) explicit `history` param.** Requires client plumbing + source-awareness in the UI, couples the hook to merge policy, and buys nothing an advisory UI needs — the client guard already handles coarse series (`useCandleData.ts:259-298`). Documented as the loser; no partial adoption.

Merge rules (non-negotiable):
- Merge ONLY when primary.servedTf === history.servedTf. Different resolutions → single-source response (no fake merge).
- Primary short-circuit ≥30 bars is never weakened (`marketDataBus.mjs:119`).
- Ticks never mutate merged history: `useCandleData.ts:259-298` (`rtf > tfSec * 4` coarse path) unchanged.
- `timeframe` = served resolution; `historyDepth` ≤ cap (max 2000, `marketDataBus.mjs:101`).

### Decision B — 14400 (4h): dropped for Yahoo

`yahooAdapter.mjs:15-16` gains `{60:"5m",1800:"30m",3600:"1h"}`-class intraday entries (nominal caps per REQ-1; actual fixture-driven). **14400 is NOT added** — no Yahoo interval exists; the existing above-range→null resolver (`EXTENSION_CONNECTIVITY_ENGINE.md` T5 chain) makes Yahoo decline 4h honestly; EO (`expertoption.mjs:17` `[60,300,900,3600]`) and CCXT continue serving 4h where they can. 4h **aggregation from 1h** is P3 (T17), not P1.

### Decision C — client guard: unchanged

No change to `useCandleData.ts:259-298`. The threshold `rtf > tfSec * 4` already handles intraday (5 s request served 60 s → coarse close-sync; 60 s served 60 s → bucketing). Once real intraday is served at the requested tf, the fine path engages naturally. Touching this is the fastest way to violate REQ-4.

### Decision D — catalog endpoint: new `GET /api/trading/catalog`

No assets/catalog HTTP route exists in `handlers.mjs` (grep this session: none). Build `GET /api/trading/catalog` grounded in `assetCatalog.mjs` (`ASSET_ALIASES` `:16`, `yahooSymbolFor` `:121`) + `QUICK_ASSETS` (`lib/trading.ts:623-630`: EURUSD, GBPUSD, BTCUSD, ETHUSD, GOLD, AUDUSD). Grouped payload `{categories:[{id,name,symbols:[{id,name,yahooSymbol}]}]}`. Client keeps watched assets pinned at the top of the Select. Curated equity/ETF set adds ≥20 liquid tickers with Yahoo symbols (all pass through untouched per `assetCatalog.mjs:162-163`); every entry must have a `yahooSymbolFor`-derivable value — unmapable entries are excluded (grep the endpoint test for a no-`undefined` assertion).

## Non-goals

- **No execution weld.** Advisory-only posture unchanged: `openPaperTrade` (`trading.mjs:552`, UNVERIFIED read this session — cited from `PICC_UNIVERSAL_4FA_ENGINE.md:110`) remains the ONLY order path, behind human approval. No autopilot resurrection (`autopilot.mjs:1332-1337` deprecated-removed — UNVERIFIED, cited from U4FA spec `:15`).
- **No new venue adapters** (MetaApi/OANDA/Alpaca stay roadmap Wave-2) — we extend existing adapters only.
- **No fabricated numbers, ever.** Unconfigured ≠ zero; "n/a" never a fake 0; `source:"none"` honest emptiness is a feature (`marketDataBus.mjs:144`).
- **Rate limits honored.** Yahoo cache TTL 600000 ms (`yahoo.mjs:7`); per-source fetch cadence never exceeds existing engine cadence (`DECISION_INTERVAL_MS 15_000`, `adaptiveConfluence.mjs:54`); ccxtConnector stays a read-only, pacered connector (`READ_ONLY_BLOCKED` order methods — verified present in ccxtConnector.mjs this session).
- **No weakening of pinned tests** (T13/T14 gates): `adaptiveConfluence.u4fa.test.mjs` U4FA-OFF path stays byte-identical; `resolutionChain.test.mjs` / `yahooAdapter.test.mjs` / marketDataBus pins change ONLY deliberately, counted, and asserted in the slice's acceptance.
- **No 4h aggregation in P1** (Decision B), no 1 s/2 s granularity (not an EO or Yahoo capability), no mobile app.

## Tasks

### Phase 1 (P1 — must ship; the four areas)

#### T1 — Yahoo intraday history adapter (P1 · M) — *chart history*
Extend `yahooAdapter.mjs:15-16` `INTERVAL_BY_TF`/`RANGE_BY_TF` with intraday resolutions (1m→`60`, 5m→`300`, 15m→`900`, 30m→`1800`, 1h→`3600`; daily/weekly/monthly unchanged). Apply per-interval range caps (fixture-driven; see REQ-1). Do NOT add `14400`. Keep the T7 honesty invariants: drop partial bars (null OHLC), tag every candle with SERVED tf, real getHistory errors propagate so the bus falls through (`yahoo.mjs` `getHistory(symbol, range, interval)` at `:28` — interval passthrough already exists, cache-distinct keys per interval).
**Acceptance:** `yahooAdapter.test.mjs` grows — fetch URL contains the per-served-tf interval, intraday fixtures return bars tagged 60/300/900/1800/3600, 14400 resolves null, count respected, `source:"yahoo"`; `yahooAdapter` curve change is a DELIBERATE, COUNTED update to any pinned resolver assertion (see R1).

#### T2 — CCXT OHLCV candles (P1 · M) — *chart history*
`ccxtAdapter.mjs:48-53` `getCandles` returns real bars. Source: `liveCCXT.mjs` buffer (`BUFFER_CAP` 400) keyed `${exchange}:${SYMBOL}` (`liveCCXT.mjs:15,37` — 37 UNVERIFIED exact-key format, cited from `PICC_MULTISOURCE_ENGINE.md:111`) with backfill via `ccxtConnector` (extend with an OHLCV fetch — `fetchTicker`/`toCcxtSymbol` verified exported at `handlers.mjs:2548`; `fetchOHLCV` existence UNVERIFIED, T2 must confirm before writing). Symbol mapping: `assetsEquivalent` (`assetCatalog.mjs:111`) + exact-name + alias fallback; unmapped pairs → `[]` with a deliberate test (mirrors `PICC_MULTISOURCE_ENGINE.md` R3 mitigation).
**Acceptance:** fixture test — configured pair returns minted candles with correct timestamps/OHLC and exchange slug; unconfigured/unmapped → `[]`; never throws; `[]` semantics documented in the test name.

#### T3 — Bus history merge + depth tags (P1 · M) — *chart history*
Implement Decision A seam in `marketDataBus.mjs` `getBestCandles` (second history pass + merge). New RESPONSE keys additive: `historyDepth`, `backfilled`, `historySpanMs`, `historySource`, per-bar `backfilled`. Client `useCandleData.ts` untouched (decision C).
**Acceptance:** contract test pins the candles payload field-by-field (missing/renamed field fails — mirror `PICC_MULTISOURCE_ENGINE.md:105` pin convention); merge-only-when-equal-servedTf test; dedup newest-wins test; primary short-circuit order unchanged test; `source` = live source when merged.

#### T4 — Catalog endpoint + asset-breadth selector (P1 · S) — *asset breadth*
`GET /api/trading/catalog` per Decision D + curated equity/ETF list. Replace the hardcoded `TradingSuite.tsx:160-168` options with the catalog grouped by category; keep watched assets pinned on top; keep `EURUSD` default.
**Acceptance:** new handler test — grouped shape, no entry without a resolvable `yahooSymbol`, `QUICK_ASSETS` all present; grep the test for a no-`undefined`-symbol assertion; component shows categories from a mocked fetch; old hardcoded option list gone (grep).

#### T5 — Spread + portfolio aggregate panels (P1 · M) — *integration*
Surface `POST /api/trading/spread` (`handlers.mjs:2530-2569`: EO mid from newest 60 s candle `:2544`, CCXT tickers `slice(0,4)` `:2550`, `TAKER_FEE_RATE = 0.001` `:2563`, pairwise best edge) and `POST /api/trading/portfolio/aggregate` (`handlers.mjs:2510-2523`: `aggregateOpenPositions` + `combinedTodayPnl` + `portfolioRiskCheck` when `proposed.amount` present `:2515-2517`) as panels with honest empty/unconfigured/`unmeasurable`-spread states.
**Acceptance:** component tests with mocked fetch — spread panel renders "n/a" (never 0) when <2 quotes; aggregate renders todayPnl + risk check result; server tests unchanged (endpoints already tested); greedy: `yield` the `riskCheck` button only when `paper.status` exists.

#### T6 — Account metrics + capabilities panels (P1 · S) — *integration*
Surface `GET /api/trading/account-metrics` (`handlers.mjs:1323`) and `POST /api/system/capabilities` (`handlers.mjs:2469-2506`; returns arch/platform/node/browserFound/notifierChannels/signalEngine/uptime `:2495-2500` — the `extensionSensor` field was removed with the D1 clean break, A-5; `browserFound` reports the studio browser).
**Acceptance:** components render honest states from fixtures (studio absent → "browser not found", not fabricated); capabilities call guarded by `signalEngine` flag `:2499`.

#### T7 — U4FA chart overlay (P1 · M) — *integration*
Consume `type:"u4fa"` SSE events (already routed `liveTrading.ts:428-432`, pinned by `u4faStream.test.ts`) in the chart context; render verdict markers/readout on `CandlestickChart.tsx` only when `strategies.u4fa.enabled` (`adaptiveConfluence.mjs:384-390`); adhere to `PICC_UNIVERSAL_4FA_ENGINE.md` honesty keys (`honesty.*` from real producer, `:202-206`).
**Acceptance:** component test — event renders a marker; strategy-off asset renders none; honesty keys asserted per U4FA spec; `adaptiveConfluence.u4fa.test.mjs` unchanged green (byte-identical OFF path).

#### T8 — Shared web-push subscription (P1 · S) — *integration*
Extract `TradingSuite.tsx:845-877` (`reg.pushManager.subscribe` + POST `/notifications/subscribe-push`) into one shared hook; `NotificationCenter.tsx:139-141` uses it (permission + subscribe together); unsubscribe + cleanup; 503-with-unset-VAPID (`handlers.mjs:2406-2443` pushed-route family) → honest "push unavailable".
**Acceptance:** one hook module (grep — no second `pushManager.subscribe` call site); hook test with mocked registration asserts subscribe/unsubscribe round-trips; UI renders unavailable state on 503; no double-subscription (idempotent guard).

#### T9 — Multi-condition + webhook alerts (P1 · M) — *UI transformation*
`alertEngine.mjs` `createAlert` (`:46`) gains a conditions-array compose (AND/OR) over the existing enum (`:52-53`); notifier gains a webhook channel with `skipped`-not-`sent` honesty (pattern precedent: `MTF_CONVERGENCE_ENGINE.md` 8b — `notifier` honesty `:163-168` UNVERIFIED, cited from `MTF_CONVERGENCE_ENGINE.md:227`).
**Acceptance:** alert tests — AND fires only when all match, OR fires on any, band field respected (`band` param `:46`); webhook channel unit test with mocked fetch — unconfigured records `skipped`; `AlertPanel` renders composed conditions from fixture.

#### T10 — Indicator overlays + volume toggle (P1 · M) — *UI transformation*
`CandlestickChart.tsx` (lightweight-charts v5: `createChart`, `CandlestickSeries`, `HistogramSeries`, `LineSeries` — verified imports this session) gains toggles: MA/EMA/Bollinger overlays (reuse `indicators.mjs` math: `swingPoints` `:695`, `supportResistance` `:720` — verified via U4FA spec citations; EMA/sma helpers UNVERIFIED, T10 confirms), RSI/MACD secondary pane, volume histogram toggle.
**Acceptance:** component tests with a lightweight-charts mock — each toggle adds/removes its series; no crash on empty candles; indicator math smoke-tested with constructed boundary fixtures (mirror U4FA factor-boundary style).

#### T11 — Multi-timeframe panes (P1 · L) — *UI transformation*
A ≤3-pane MTF row (e.g. 1m + 5m + 15m) reusing the same `useCandleData` hook (refcounted realtime connection `useCandleData.ts:243-249`). Data comes from the T1–T3 history work; panes show honest per-pane source/depth labels.
**Acceptance:** panes render independent timeframes from fixtures; shared-stream refcount test (2 panes same asset → one subscription); honest label per pane; performance smoke (no render loop).

#### T12 — Sectioned tabs layout (P1 · S) — *UI transformation*
Group the 26 panels (`TradingSuite.tsx:176-206`) into tabs (Markets / Signals / Alerts / Portfolio / Tools). Pure layout wrapper — no component logic changes, positional identity preserved.
**Acceptance:** render smoke test restores each panel under its tab (fixture fetch); grep confirms every panel id appears exactly once in the tab map; existing suite tests unchanged.

#### T13 — Watchlist columns + import/export (P1 · S) — *UI transformation*
`WatchlistPanel` gains price/change/volume columns and JSON import/export (parse + validate via `canonicalAssetId` `assetCatalog.mjs:100`; reject unmapped symbols honestly).
**Acceptance:** component tests — import validates and drops unmapped ids with a warning, no crash; export round-trips; columns render from fixture.

### Phase 2 (P2 — nice-to-have this week)

- **T14 — Depth row + TH1 indicator (P2 · M).** Per-symbol order-depth snapshot + TradeHistory-1-row depth line; honest "no depth data" state. (Mission's depth indicator ask; parked while P1 ships.)
- **T15 — CCXT deeper-history backfill (P2 · M).** Scheduled OHLCV backfill job into the `liveCCXT` buffer for configured pairs (respects ccxt rate limits).
- **T16 — Indicator presets + layout persistence (P2 · S).** Save/restore chart indicator + tab state per user.

### Phase 3 (P3 — future backlog)

- **T17 — 4h aggregation from 1h (P3 · M).** `deriveAggregatePlanes`-style derivation (`mtfConvergence.mjs:564-571` — UNVERIFIED exact signature, cited from `PICC_UNIVERSAL_4FA_ENGINE.md:45`) for Yahoo-origin 1h → 4h, tagged `source:"aggregate"`.
- **T18 — Screener click-to-chart (P3 · S).** Board rows deep-link to the Live Chart asset.
- **T19 — Volume-aware backtest hygiene (P3 · M).** Guard `backtestGates` against merged/backfilled series (asserts series provenance before scoring).

## Risks

| # | Risk | Guard |
|---|------|-------|
| R1 | **Pinned resolver behavior flip.** T1 changes yahooAdapter's curve; the "intraday→daily round-up" was the deliberately pinned intent of `EXTENSION_CONNECTIVITY_ENGINE.md` T5/T7 — tests assert it. | T1 acceptance mandates the change is deliberate + counted; `resolutionChain.test.mjs` diff reviewed line-by-line; T3 contract pin is additive-only. **Most likely to bite.** |
| R2 | Yahoo rate-limits/429s once intraday fetches multiply (cache TTL 600000 `yahoo.mjs:7`). | Cache-distinct keys per interval; single in-flight fetch per symbol+interval; T1 caps count ≤ 2000 (`marketDataBus.mjs:101`); test fixtures never hit network. |
| R3 | CCXT symbol mapping gap leaves crypto charts `[]` (key `exchange:SYMBOL` vs chart `BTCUSD`). | T2 exact+alias+`assetsEquivalent` chain; `[]` semantics tested; UNVERIFIED fetchOHLCV existence confirmed as T2 gate. |
| R4 | Merge touches the ≥30-bar short-circuit and silently changes served sources suite-wide. | T3 contract test pins short-circuit order + primary-source identity; `source` stays live; merge only same-servedTf. |
| R5 | Push double-subscription (TradingSuite + bell) or lost unsubscribe. | T8 single shared hook; idempotent guard; grep asserts one subscribe call site. |
| R6 | U4FA overlay renders fabricated markers. | T7 renders only real SSE events; strategy-off renders nothing; U4FA-OFF byte-identical test untouched. |
| R7 | lightweight-charts v5 API misuse in panes/overlays. | T10/T11 component tests with a chart mock; ≤3 panes; no unknown API surface. |
| R8 | Webhook alert channel reports `sent` when skipped. | T9 `skipped`-vs-`sent` unit test (MTF 8b precedent). |

## Honesty notes (demo/live gates touched)

- No demo/live gate is weakened. T3 responses are additive; pinned tests (`adaptiveConfluence.u4fa.test.mjs`, `resolutionChain.test.mjs`, marketDataBus/multiplex pins) change only deliberately-counted (R1).
- Fabricated-state risk: only T7 (U4FA overlay) and T9 (webhook) can manufacture claims; both are pinned to real producers (`honesty.*` keys per `PICC_UNIVERSAL_4FA_ENGINE.md:202-206`; `skipped`-not-`sent`).
- Grep-able honesty strings per slice (acceptance grep targets): `yahooAdapter` intraday tags (`timeframe:300` on 300), `"historyDepth"`, `"backfilled"`, `"historySource"`, `"Yahoo intraday"` source badge (extends `SOURCE_BADGES` `TradingChart.tsx:23-28`), `"push unavailable"`, `"skipped"` (webhook), `"unmeasurable"` (spread), `"n/a"` (never fabricated 0).
- UNVERIFIED citations in this spec (not read this session): `trading.mjs:552` openPaperTrade; `autopilot.mjs:1332-1337` removal; `liveCCXT.mjs:37` key format; `mtfConvergence.mjs:564-571` deriveAggregatePlanes signature; `notifier.mjs:163-168` skipped/sent; `indicators.mjs` EMA/sma helpers; Yahoo API caps (user ground truth). Each is flagged as a verification gate in its slice.

## Slice list (handoff output)

**Phase 1 (13):** T1 Yahoo intraday history · T2 CCXT OHLCV candles · T3 Bus merge + depth tags · T4 Catalog endpoint + selector · T5 Spread + aggregate panels · T6 Metrics + capabilities panels · T7 U4FA chart overlay · T8 Shared web-push · T9 Multi-condition + webhook alerts · T10 Indicator overlays + volume · T11 MTF panes · T12 Sectioned tabs · T13 Watchlist columns + import/export
**Phase 2 (3):** T14 Depth row + TH1 · T15 CCXT backfill job · T16 Presets + layout persistence
**Phase 3 (3):** T17 4h aggregation · T18 Screener click-to-chart · T19 Backtest provenance hygiene

**Decisions to review:** A) deep history = server-side merge in `marketDataBus` (option a; history param rejected); B) 14400 dropped for Yahoo (no aggregation in P1); C) client mixed-resolution guard byte-identical; D) new `GET /api/trading/catalog` grounded in `assetCatalog` + `QUICK_ASSETS`.

## Resolution (2026-09-19)

**Disposition:** SUPERSEDED. The P1 work shipped across the cited commit trail (all verified on disk this session); the spec's planning direction (esp. P2/P3 backlog) is superseded by the suite-reskin wave, the suite rebuild, and the v3.2 layered-engine rebuild.

**Evidence (P1 delivered):** T1 `8e88756` (Yahoo intraday 1m/5m/15m/30m/1h OHLCV) · T2 `ccxtAdapter.mjs` real OHLCV (`getCandles` at `:164`, `fetchOHLCV` at `:29,:53`) · T3 `marketDataBus.mjs:114-166` merge with `historyDepth`/`backfilled`/`historySource` + per-bar `backfilled:true` · T4 `58f0ecd` (`GET /api/trading/catalog`; Decision D) · T5 `9f7d51f` (spread + aggregate panels) · T6 `AccountMetricsPanel.tsx` + `CapabilitiesPanel.tsx` on disk · T7 `6f83871` (U4FA chart overlay) · T8 `08d43b7`/`3555095` shared web-push subscription (`useWebPush`) · T9 `alertEngine.mjs:64-83,218-242` multi-condition + AND/OR logic · T10 `CandlestickChart.tsx` indicator overlay series + `AdvancedIndicatorsPanel.tsx` (Volume) · T13 `WatchlistPanel.tsx` exists (import/export not re-verified) · T16 `chartPrefs.mjs` (persisted layout prefs).
**Evidence (superseded):** suite UI was redefined by the income command-centre reskin (`6bfc763`, then `8a98999`) and the suite-rebuild regime/fusion/paper-separation (`bf99e09`); the remaining execution/aggregation backlog (T17 4h; P2/P3) is covered by ADR-0003 (15s execution granularity) + ADR-0004 + `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md`, which supersede this spec's forward path per its §7 out-of-scope note.

**Successor:** `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` (+ ADR-0003/ADR-0004) for the trading-logic remainder; the reskin wave for the UI remainder.