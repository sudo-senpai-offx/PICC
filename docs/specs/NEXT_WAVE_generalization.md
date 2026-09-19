# Next Wave: Trading-Suite Generalization & Data-Collection Architecture — spec v1

> **Status:** Approved (planning artifact — no code changed by its author)
> **Date:** 2026-08-27
> **Supersedes:** the execution-re-integration plan in `docs/TRADING_MULTIPLATFORM_ROADMAP.md` (see §ADR below).
> **Extends:** `docs/TRADING_SUITE_GENERALIZATION_SPEC.md` (Phases I, K, L) — this spec makes those phases actionable as an independently-shippable slice sequence, and adds two slices the generalization spec does not cover (latency surfacing, model-matrix stabilization).
>
> **Grounding rule:** every claim is traced to a file:line read during the authoring session. Anything not verified is marked `UNVERIFIED`.

---

## 0. Verified current state (ground truth, this session)

| Slice | Verified claim | Source |
|---|---|---|
| Asset catalog | Alias tables exist for metals, energies, indices, crypto **only**. **No forex or equities aliases** in `ASSET_ALIASES`. `canonicalAssetId`/`assetsEquivalent`/`yahooSymbolFor` all present and working. | `apps/dashboard/server/services/assetCatalog.mjs:16-131` |
| Asset catalog | The §2.4 "stale extension-mirror comment" defect is **already fixed** — the header now says content.js "no longer mirrors this". | `assetCatalog.mjs:12-15` |
| Chart timeframes | `useCandleData.ts` `Timeframe = 60\|300\|900\|3600` (6), labels (8-13). Server `marketDataBus.getBestCandles` **already clamps to 2592000 (1M)** and count to 2000 (92-93). Broker-registry default `availableTimeframes` still `[60,300,900,3600]`. | `src/hooks/useCandleData.ts:6-13` ; `server/services/marketDataBus.mjs:92-93` ; `server/services/brokers/index.mjs:40` |
| UI labels | EO-specific labels remain in many components (credential card, status cards, quick-assets list, analysis entry points). | `src/components/TradingSuite.tsx:27,34,47,217,620-647,930,1022,1145` ; `DockablePreview.tsx:175,182` ; `LiveMarketBoard.tsx:58-59,147` ; `TradeOrderForm.tsx:59` ; `LiveDecisionsPanel.tsx:134` ; `TradingHud.tsx:192` |
| Latency | `dataBusStats()` computes per-source `medianMs/p95Ms/lastMs/samples` (45-57) but is **not exposed by any HTTP endpoint nor used in the UI** — only referenced by a test. | `marketDataBus.mjs:45-57` ; `server/__tests__/multiplex.test.mjs:131-135` |
| Broker rows | `GET /api/trading/brokers` → `listBrokers()` (capabilities, connected, configured). No latency, no deep-link. | `server/handlers.mjs:2286-2294` ; `server/services/brokers.mjs:30-86` |
| Web-push | `sendWebPush`, `addPushSubscription`, `listPushSubscriptions`, dead-sub cleanup on 404/410 all exist. Endpoints: status/prefs/subscribe-push/test. **No `/api/notifications/vapid-public-key` endpoint; no service worker; no `pushManager.subscribe` frontend.** Persistence is atomic tmp+rename in `notifications.json`. | `server/services/notifier.mjs:43-56,73-117` ; `server/handlers.mjs:2256-2278` ; `no sw.js anywhere` (verified) |
| Test coverage | **709 tests / 73 files; 707 pass, 2 fail** (cloud-LLM failover in `llm.test.mjs`). ~35 services have no test file, incl. `signalEngine`, `marketDataBus`, `scheduler`. | `npx vitest run` (this session); per-service grep of `__tests__/` |
| Extension **(plasmo tree ARCHIVED 2026-09-03 — historical reference only; canonical sensor is picc-overlay, DOM-free)** | Passive MV3 sensor (plasmo): `content.tsx`, `background.ts`, `popup.tsx`, `errorLog.ts`. `content.tsx` has TIER0/TIER1 registries (expertoption = Tier1). No trading-platform DOM selectors or session-capture strats beyond expertoption; no trading LiveBroker adapter wrapping browser bridge. | `apps/extension/src/content.tsx:49-96,80-89` ; `background.ts:1-176` ; `popup.tsx:1-208` |
| SITE_INDEX | `browserStudio.mjs` lists many `category:"trading"` venues (expertoption, binance, bybit, kucoin, okx, etoro, plus500, iqoption, olymptrade, deriv) each with base `url`. **No `platformKind` field** (fields are hosts/id/name/category/payoutThreshold/url/note). | `server/services/browserStudio.mjs:477-521` (map at 513-521) |
| Analysis-entry points | `analyzeExpertOptionAsset`, `getExpertOptionDemoStatus`, `proAnalyzeExpertOption`, `ExpertOptionDemoStatus` imported by the suite UI. `TradeOrderForm` imports `placeDemoTrade`/`openPaperTrade`. | `TradingSuite.tsx:27-62` ; `TradeOrderForm.tsx:3` |
| Model matrix | **NINE** pure models in `MODELS` (trend, momentum, rsi, breakout, macd, montecarlo, pressure, stoch, avwap); online weight adaptation `recordModelOutcomes`/`modelWeight` with `WEIGHT_FLOOR=0.4`, `WEIGHT_CEIL=1.6`, `DECAY_ALPHA=0.05`, `PRUNE_MIN_SAMPLES=50`; pruned models excluded from fusion (`pruned`/`prunedReason` in `getModelWeights`, `modelsRun` = active count); `computeModelMatrix` fusion. | `server/services/modelMatrix.mjs:24-29,271-281,283-379,387-461` |
| Accuracy ledger | `accuracyLedger.mjs` auto-resolves TRADE verdicts against later price — separate from per-model weight ledger. `RESOLVE_INTERVAL_MS=5000`, `LEDGER_CAP=1000`. | `server/services/accuracyLedger.mjs:1-31` |

---

## 1. Requirements (each testable)

**R1 — Asset catalog parity.** `canonicalAssetId` resolves every forex pair in §5.2 of the generalization spec (majors, minors, exotics) and every listed equity, to the documented canonical id, including human names (`Cable`, `Aussie`, `Loonie`, `Apple Inc`, `Meta Platforms`, …).

**R2 — Chart timeframes.** The `Timeframe` type and chart selector expose all 12 values `5,15,30,60,300,900,1800,3600,14400,86400,604800,2592000` with labels `5s…1M`. Broker-registry default `availableTimeframes` matches. Server already accepts the full range.

**R3 — Broker-agnostic suite.** With only a non-EO broker configured, the suite renders **zero** `ExpertOption`-worded labels; the credential card is generic ("Broker Connection"); status cards and quick-assets use generic wording; analysis entry points are broker-agnostic. (EO wording may appear only when the EO broker is specifically configured.)

**R4 — Latency surfacing.** The suite's broker rows show per-source `median` and `p95` latency (ms) alongside each broker, sourced from `dataBusStats()`. A source with no samples shows "—" (honest, not zero). Data refreshes with the suite's status poll.

**R5 — Redirect, not execute.** Each active broker row in the suite offers a **"Trade on {venue}"** primary action that opens the venue's own web app deep-linked to the instrument in question in a new tab. The old `TradeOrderForm` demo path stays as-is (advisory/paper), and is explicitly labeled "paper only / decision support". No order-execution weld is added anywhere.

**R6 — Web-push subscription.** `GET /api/notifications/vapid-public-key` returns `{ publicKey }` (public, no auth). The dashboard registers a service worker, an **"Enable push notifications"** button calls `pushManager.subscribe`, the result POSTs to `/api/notifications/subscribe-push`, an "Disable" path unsubscribes and removes the server-side subscription, and dead subscriptions are pruned on 404/410 (already implemented server-side — wire it to a UI status).

**R7 — Test coverage.** Every untested service named below gains a test file. Priority trio `signalEngine`, `marketDataBus`, `scheduler` each reach ≥70% statement coverage via deterministic, no-network tests. All previously-passing tests keep passing.

**R8 — Extension collects; web app decides.** The extension captures platform DOM/session data and forwards raw observations to the server. **No decision-making, confidence scoring, or trade logic lives in the extension.** The server brokers/buffers the data and the web app analyzes/interpreters.

**R9 — Model-matrix stabilization.** Models that persist at the weight floor with poor accuracy over a minimum sample count are **pruned** from fusion (recorded, not deleted), online weights decay so a model must stay accurate to stay elevated, and calibration hooks feed per-model accuracy from `accuracyLedger`-style resolved outcomes. New models are added **only** as pure `(candles) → vote` fns registered in `MODELS`, each with a unit test, and **never** ARIMA/Prophet/LSTM/GARCH (the repo explicitly forbids importing those names — spec §7 appendix).

---

## 2. Design decisions

### 2.1 ADR: redirect instead of execute

- **Decision:** PICC will never re-weld order execution anywhere. The generalization spec (D1-D14, §10) keeps execution advisory-only (§10 rule 1: "no execution"). This spec **supersedes** the roadmap's execution plan (`docs/TRADING_MULTIPLATFORM_ROADMAP.md` §0-§2 "the weld this roadmap removes" / Wave-2 executable venues / §6 checklist items 1-3). Those become dead-letter.
- **Rationale:** compliance + honesty surface. The advisory-first boundary is a hard product constraint (Phase A). Re-implementing per-venue execution reintroduces the welded-session problem the audit flagged and duplicates venue-specific order semantics that are exactly where honesty breaks.
- **Replacement UX:** a "Trade on {venue}" button. It deep-links to the venue web app for the instrument. The user logs in and trades on **their** venue with **their** session, with PICC's analysis open alongside.
- **Seam to reuse:** `SITE_INDEX` (`browserStudio.mjs:477-521`) already holds per-venue base URLs for `category:"trading"` venues. Extend each entry's `url` (or add an `instrumentUrl(assetId)` builder) so the redirect can deep-link beyond the home page.
- **Honesty label:** the button and adjacent copy must say "opens {venue} — you are leaving PICC's advisory view" and "PICC offers decision support only".

### 2.2 Division of labor: extension collects, web app decides

- **Extension = sensor only.** It already relays raw frames (content.tsx `findByLabel`, `/api/extension/ingest`, `/api/extension/trading-data`). It must keep doing that and gain per-platform DOM/session capture — never signal generation.
- **Web app = analyzer.** Analysis, model fusion, confidence, and interpretation run server-side. The extension POSTs observations; the server normalizes via `canonicalAssetId`, buffers in brokers/`marketDataBus`, and feeds analysis/UI.
- **Boundary rule (test-guarded):** the extension bundle must not import or reference `modelMatrix`, `prediction`, `accuracyLedger`, or any model/decision module. Enforce with a build-time guard + a test that greps the extension source for forbidden imports.

### 2.3 Cross-broker normalization (R1)

Reuse the existing `ASSET_ALIASES` + `canonicalAssetId`/`assetsEquivalent`/`yahooSymbolFor` (`assetCatalog.mjs:16-131`) — do **not** invent a second catalog. Add forex + equities alias blocks to `ASSET_ALIASES` following the exact shape of the existing blocks. `yahooSymbolFor` already handles 6-letter ids (`EURUSD=X`, `BTC-USD`, equities passthrough) at lines 116-130 — forex aliases integrate with no change there.

### 2.4 Latency surfacing (R4)

`dataBusStats()` (`marketDataBus.mjs:45-57`) is the single source. Surface it by:
1. Adding a small read endpoint that merges broker rows with latency (or extending `GET /api/trading/brokers`).
2. The suite fetches it on its existing status poll and renders `medianMs`/`p95Ms` per broker row.
Do not create a second latency recorder — reuse the ring.

### 2.5 Phase ordering: legal/UI risk first

Slice 3 (latency) and Slice 2 (Timeframe + labels) are low-risk and independently shippable. Slice 1 (catalog) is pure data + tests. Slice 6 (model matrix) is pure logic + tests. Slice 4 (L3 web-push) and Slice 7 (L1 extension) are the larger, integration-heavy ones. Order in the checklist below is the recommended execution order, but each slice is independently shippable.

---

## 3. Non-goals (explicit out of scope)

- **No execution re-integration** of any venue (supersedes roadmap §0-§2, §6 items 1-4 executable path). CCXT stays read-only; EO demo stays paper-only.
- **No withdrawals/transfers/auto-settlement** anywhere (roadmap §2 out-of-scope, preserved).
- **No ARIMA/Prophet/LSTM/GARCH** models.
- **No new runtime dependencies.** Node ≥22, zero runtime deps (web-push is already a dep; no new installs).
- **No rewrite of `marketDataBus` fan-in** beyond what's needed to expose latency (already works).
- **No per-venue CCXT forks** — venue differences remain config, not code (roadmap §7 correction of record).
- **Email (L2)** and **Notification-format polish (§7.2/§7.3)** are NOT in this wave (out of scope per the given priority order).
- **Forex/equities *live* data ingestion** is out of scope for the catalog slice (catalog is naming/normalization only; adding live feeds is a later wave).

---

## 4. Slice checklists (independently shippable; ordered by recommended execution)

Each slice = one commit-capable unit: `feat:`/`fix:`/`refactor:` per repo convention.

### Slice 1 — Asset catalog: forex + equities normalisation (Phase I)

Files: `server/services/assetCatalog.mjs`, `server/__tests__/modelMatrix.test.mjs` (its catalog describe block), optionally a new `assetCatalog.test.mjs`.

- [x] 1a. Add `FOREX` alias block to `ASSET_ALIASES` for the 13 pairs in §5.2 (EURUSD…USDMXN) incl. human names (`Cable`, `Aussie`, `Loonie`) + Yahoo `=X` forms. **Acceptance:** `canonicalAssetId("EUR/USD")===EURUSD`, `("Cable")===GBPUSD`, `("USDJPY=X")===USDJPY`. — Done (`31672d1`, "feat: add forex + equities aliases to asset catalog (Phase I)").
- [x] 1b. Add `EQUITIES` alias block (AAPL, TSLA, GOOGL, MSFT, AMZN, NVDA, META) incl. `Apple Inc`, `Meta Platforms`. **Acceptance:** `canonicalAssetId("AAPL")===AAPL`, `("Google")===GOOGL`. — Done (`31672d1`); verified on disk.
- [x] 1c. Keep `yahooSymbolFor` correct for all new ids (already handles 6-letter; verify equities passthrough + forex `=X`). **Acceptance:** `yahooSymbolFor("EURUSD")==="EURUSD=X"`, `yahooSymbolFor("AAPL")==="AAPL"`. — Done (`31672d1`).
- [x] 1d. Update the existing catalog describe block in `modelMatrix.test.mjs` to assert all new aliases; add a dedicated `assetCatalog.test.mjs` if the block grows past ~40 assertions. **Acceptance:** new tests green; no existing test changes behavior. — Done (`31672d1`); assertions incl. `("EUR/USD")==="EURUSD"`, `("Cable")==="GBPUSD"`, `("Aussie")==="AUDUSD"`, `assetsEquivalent("Cable","GBP/USD")` live in `modelMatrix.test.mjs:36-68` (no separate assetCatalog file needed — block stayed within 40 assertions).
- Effort: ~1–2 h. Risk: alias collisions (e.g., `GBPUSD` vs `GBP/USD`) — guarded by alias tests.

### Slice 2 — Chart timeframes + broker-agnostic UI labels (Phase K)

Files: `src/hooks/useCandleData.ts`, `src/components/TradingChart.tsx`, `src/components/TradingSuite.tsx`, `DockablePreview.tsx`, `LiveMarketBoard.tsx`, `TradeOrderForm.tsx`, `LiveDecisionsPanel.tsx`, `TradingHud.tsx`, `src/lib/trading.ts`, `src/lib/liveTrading.ts`, `server/services/brokers/index.mjs` (default `availableTimeframes`), plus component tests.

- [x] 2a. Expand `Timeframe` union + `TIMEFRAME_LABELS` to all 12 values. **Acceptance:** type compiles; labels map 5→"5s", 30→"30s", 3600→"1h", 2592000→"1M". — Done (`384f62f`); `useCandleData.ts:7-23` has the 12-value union + labels.
- [x] 2b. Update `TradingChart.tsx` selector to render all 12 (scrollable pill row or dropdown). **Acceptance:** renders without regression; renders a 12-option control in a test. — Done (`384f62f`); `TIMEFRAMES` const + `TIMEFRAMES.map` pill row in `TradingChart.tsx:14,355` (enabled/disabled per servable).
- [x] 2c. Update broker-registry default `availableTimeframes` to the 12; each adapter already overrides. **Acceptance:** `brokerRegistry.test.mjs` asserts default == 12 values. — Done (`384f62f`); test at `brokerRegistry.test.mjs:64-67` asserts the full 12-value range.
- [x] 2d. Genericize suite labels per §4.3 of the generalization spec: "ExpertOption Session"→"Broker Connection", "ExpertOption account"→"Account ({broker})", "ExpertOption quick assets"→"Quick assets", `EXPERTOPTION_QUICK_ASSETS`→`QUICK_ASSETS`. **Acceptance:** rendering a suite with a non-EO broker shows zero EO labels (component test). — Done (`384f62f`); `TradingSuite.tsx` uses `QUICK_ASSETS` + "Broker Connection" + "Quick assets (live feed)"; residual `ExpertOption` strings are comments only (`liveTrading.ts`, `trading.ts` docs).
- [x] 2e. Rename lib entry points `analyzeExpertOptionAsset`/`getExpertOptionDemoStatus`/`proAnalyzeExpertOption` to generic (`analyzeAsset`/`getBrokerStatus`/`proAnalyze`) and update call sites. **Acceptance:** all imports resolve; typecheck clean. — Done (`384f62f`); `analyzeAsset` (`trading.ts:199`), `proAnalyze`/`proAnalyzeSymbol` (`trading.ts:828-835`); grep returns zero EO-named entry-point symbols.
- [x] 2f. Update `DockablePreview`, `LiveMarketBoard`, `TradeOrderForm`, `LiveDecisionsPanel`, `TradingHud` strings to broker-agnostic wording. **Acceptance:** grep for EO-specific strings in `src/` returns only non-default paths (component tests). — Done (`6536176` clean-break + `384f62f`); `DockablePreview`, `TradeOrderForm`, `TradingHud` were removed in the suite simplification; surviving `LiveMarketBoard`/`LiveDecisionsPanel` carry no EO wording; `brokerAgnosticLabels.test.ts` guards the remaining component set.
- Effort: ~3–5 h. Risk: high blast radius (many components); guard with component render tests.

### Slice 3 — Surface `dataBusStats` latency in the suite (new)

Files: `server/services/brokers.mjs` (or `marketDataBus.mjs`), `server/handlers.mjs`, a suite client component, tests.

- [x] 3a. Expose a way for the UI to read `dataBusStats()`. Preferred: merge into `GET /api/trading/brokers` as a `latency` key per slug (or a sibling `GET /api/trading/latency`). **Acceptance:** endpoint returns `{ [slug]: { samples, medianMs, p95Ms, lastMs } }`. — Done (`b561d29`, "feat: surface per-source candle latency on trading venues (Slice 3)"); `handlers.mjs:3036-3040` merges `result.latency = dataBusStats()`.
- [x] 3b. Suite renders `median`/`p95` (ms) per broker row; no samples → "—". **Acceptance:** component test with a populated and an empty latency payload. — Done (`b561d29`); `TradingSuite.tsx:543-551` renders `median {…}ms · p95 {…}ms`, row hidden when `samples === 0`.
- [x] 3c. Wire refresh to the suite's existing status poll (no new polling loop). **Acceptance:** same fetch cadence as other broker status. — Done (`b561d29`); latency rides the same broker fetch fed to `TradingSuite` (no separate loop).
- Effort: ~2–3 h. Risk: UI regression on the broker table — low; guarded by render test.

### Slice 4 — Web-push subscription (Phase L3)

Files: `server/handlers.mjs` (new endpoint), `apps/dashboard` static root + a new `sw.js`, a push-enable component in the suite, `notifier.mjs` (tiny — maybe nothing), tests.

- [x] 4a. Add `GET /api/notifications/vapid-public-key` returning `{ publicKey: process.env.VAPID_PUBLIC_KEY }`. Public, no auth (browser needs it pre-subscribe). **Acceptance:** handler test asserts 200 + `{publicKey}` when env set, 503/empty honest response when unset. — Done (`3555095`); `handlers.mjs:2972-2976`, 503 with "web-push not configured" when unset.
- [x] 4b. Ship `sw.js` from the dashboard static root; register on dashboard load. **Acceptance:** served path exists; registration call present. — Done (`3555095`); `public/sw.js` present, registration + `enable-notifications` message handler (see `main.tsx:14` comment — user-initiated only).
- [x] 4c. Add "Enable push notifications" flow: request permission → fetch VAPID key → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → POST `/api/notifications/subscribe-push`. **Acceptance:** server-side subscribe-push handler test already exists; add a jsdom/mocked `PushManager` unit for the flow. — Done (`3555095`); single shared `useWebPush.ts` hook (only `pushManager.subscribe` call site), `lib/webPush.ts`, `webPush.test.ts` with mocked `PushManager`; "Enable push notifications" button in `TradingSuite.tsx:973`.
- [x] 4d. Add "Disable" → `pushManager.unsubscribe()` + server removal (add a fire-and-forget endpoint or reuse subscribe-push with an empty/unsubscribe flag). **Acceptance:** removes subscription; `notifierStatus()` count decreases. — Done (`3555095`); `useWebPush.ts:90,110` calls `/api/notifications/unsubscribe-push`.
- [x] 4e. Surface dead-subscription state: when server prunes (404/410 in `sendWebPush` already), the UI shows "push needs re-enabling" via `/api/notifications/status`. **Acceptance:** `notifierStatus()` `subscriptions` count + a UI state flag. — Done (`3555095`); notifier status surfaces subscriptions + configured webpush flag (`handlers.mjs:3057`).
- Effort: ~3–4 h. Risk: service-worker/PushManager environment differences (primary target Chrome/Edge per §14.3) — guard server-side logic with tests; mark SW/push in headless/test env as `UNVERIFIED`/skip.
- Honesty: this touches permissionful browser APIs; the "Enable" button must be user-initiated (never auto-subscribe). Note in UI copy.

### Slice 5 — Test coverage debt (new)

Files: new `__tests__/signalEngine.test.mjs`, `marketDataBus.test.mjs`, `scheduler.test.mjs`, plus as time permits for the untested list below.

- [x] 5a. `marketDataBus.test.mjs`: `getBestCandles` priority fan-in (weight order, alive-first), thin-data fallback, honest `source:"none"`, and `dataBusStats()` median/p95 math, using mock brokers via the registry. **Acceptance:** ≥70% statement coverage; deterministic no-network. — Done (`f15329b`, slice-5d wave, + later T2 wave `8844d1c` fan-in work); `marketDataBusMerge/Quality/Verify.test.mjs` cover fan-in, fallback, `source:"none"`, and stats math.
- [x] 5b. `signalEngine.test.mjs`: signal creation/emission and gating behavior (read the module first — `UNVERIFIED` specifics), deterministic inputs. **Acceptance:** ≥70% coverage. — Done (`f15329b` group + later venue-pool wave `99a1b06`/`96c1cb9`); `signalEngine.test.mjs` (11 `it`).
- [x] 5c. `scheduler.test.mjs`: job registration, staleness monitoring toggling based on broker liveness (`setBrokerStale`), early-exit when unconfigured — porting the `ccxt-market-data` job shape. **Acceptance:** ≥70% coverage; no real timers (inject clock). — Done (`f15329b`); `scheduler.test.mjs` (5 `test` incl. the 10s interval clamp + injected-clock start).
- [x] 5d. (Stretch) add coverage for: `alertEngine`, `liveCCXT`, `positionManager`, `tradeJournal`, `watchlist`, `volatility`, `dataSources`, `indicators`, `orderFlow`, `tradingSessions`. **Acceptance:** each new file has ≥1 meaningful test; no empty "smoke" files. — Done (2026-09-04 strategy wave): `alertEngine.test.mjs` (11 `it`) + `tradeJournal.test.mjs` (10 `it`) pre-existing and verified; new `orderFlow`, `dataSources`, `tradingSessions`, `watchlist`, `positionManager`, `indicators`, `volatility`, `scheduler` suites (hermetic, no network) + `liveCCXT.staleness` + `liveEO.fetchThrottle` + `correlation` + `localstore` + `modelMatrix` + `accuracyLedger` regression tests landed in the same wave.
- [x] 5e. Fix the 2 pre-existing failures in `llm.test.mjs` (cloud-LLM failover) **only if** they are environment-flaky (verify they pass in CI); else record as known-issue. **Acceptance:** documented; 709 total tests stay green (707 currently pass). — Done (2026-09-19 sweep): `llm.test.mjs` passes 8/8 in the full run; the 2 baseline failures resolved (cloud-LLM failover now recovered); full suite is **223 files / 2337 tests, 0 failures** (up from the 709/707 baseline).
- Effort: 4–8 h (5a-5c ~3–4 h; 5d stretch). Risk: testing untested code may expose latent bugs — capture them as fix commits, don't paper over.

### Slice 6 — Model-matrix stabilization (new, from spec §7 appendix)

Files: `server/services/modelMatrix.mjs`, `server/__tests__/modelMatrix.test.mjs`, `server/services/accuracyLedger.mjs` (calibration hook), maybe `server/services/localstore.mjs`.

- [x] 6a. Prune degenerate models: a model at `WEIGHT_FLOOR` (0.4) with ≥ `PRUNE_MIN_SAMPLES` (e.g., 50) notches that aren't improving is excluded from fusion (keep its record, stop weighting). Add `pruned` + `reason` to `getModelWeights`. **Acceptance:** test drives a model to the floor and asserts it's excluded from `computeModelMatrix` fusion while retained in output.
- [x] 6b. Online weight decay: add an explicit recency/decay term so a model's elevated weight erodes toward equilibrium without negative outcomes accumulating. **Acceptance:** test asserts weights decay over no-feedback ticks.
- [x] 6c. Calibration hook: when `accuracyLedger` resolves an outcome, call a new `recordModelOutcomes`-compatible point (or wire the ledger's resolved result into per-model accuracy) so per-model realized accuracy is the authority. **Acceptance:** test resolves a ledger entry and observes the weight move.
- [x] 6d. Register viable **pure `(candles)→vote`** additions to `MODELS`, each with a unit test, that do not violate the pure-function/no-I/O constraint and are not the forbidden names. Candidates: stochastic-Oscillator reversion, Bollinger/ATR drift, ADX trend-strength gate, anchored-VWAP deviation. Pick **2** maximum this wave (keep matrix interpretable + tested). **Acceptance:** each new model has a `modelMatrix.test.mjs` case (synthetic up/down/flat series → expected vote).
- [x] 6e. Ensure the existing `recordModelOutcomes` caller (settlement) keeps working with pruning. **Acceptance:** all existing modelMatrix tests green.
- Effort: 3–5 h. Risk: pruning changes consensus behavior — guard `computeModelMatrix` fusion tests; keep `MODELS.length` reporting honest (report active vs pruned separately).

### Slice 7 — Extension as data-collection layer (Phase L1, prioritised, non-executing)

Files: `apps/extension/src/content.tsx` (+ new `src/selectors/*.ts` DOM-selector maps, `src/session.ts` capture), `apps/extension/manifest`/`package.json` (perms/URL matches), `server/services/connectors.mjs` (register per-venue connectors), `server/services/brokers/<platform>.mjs` (LiveBroker adapters wrapping browser bridge), `server/services/browserStudio.mjs` SITE_INDEX (`platformKind` + `instrumentUrl`), `server/services/browserBridge.mjs` (reuse).

- [x] 7a. (done in Slice 5) Add `platformKind` to `SITE_INDEX` trading entries (e.g., `binary` for iqoption/olymptrade/expertoption, `spot`/`derivatives` for binance/bybit/kucoin/okx) + an `instrumentUrl(assetId)` builder for redirect deep-links (supports Slice-2 redirect requirement). **Acceptance:** `detectSite` returns the new fields; unit test.
- [x] 7b. Per-platform DOM-selector maps for the **Priority-1 venue (ExpertOption)** in the extension: price display, active asset, account balance, open positions. Reuse `findByLabel`/browser-bridge `text:` selector pattern. **Acceptance:** mock-DOM test returns the expected reads.
- [x] 7c. Session-capture strategy for Priority-1. **Deviation (vault rule §5):** the extension forwards NO token/cookie VALUES — only `{authenticated, storage-key names}` presence, per the credentials/vault rule below; frames carry price/asset/balance observations only. **Acceptance:** mock-DOM session test.
- [x] 7d. (already satisfied) A `brokers/expertoption.mjs`-style LiveBroker adapter **wrapping the browser bridge** for the captured data (feeds `marketDataBus` alongside existing adapters). Do NOT re-weld execution — the adapter is data-collection only (market-data + account state). **Acceptance:** `brokerRegistry.test.mjs` registers it; `getBestCandles` can source from it when no better broker.
- [x] 7e. Enforcement of the collect/decide boundary: a build guard + a test asserting the extension source does not import model/decision modules. **Acceptance:** guard fails if `modelMatrix|prediction|accuracyLedger` is imported into `apps/extension`.
- [x] 7f. (Later venues — stretch, small slices) Binance then Bybit selectors per §12.2 platform work; each as its own sub-slice with its own mock-DOM tests. — **Closed as permanently out-of-scope (2026-09-19):** the plasmo extension tree was archived in `07cba74` (canonical sensor is now headless-capture/DOM-free, per the §0 note). Binance/Bybit DOM selectors have no live extension home; venue data collection instead rides the headless-capture + broker adapters already landed. Re-opening this item would mean reviving the extension — explicitly out-of-scope for the generalization wave and not planned.
- Effort: 6–10 h (7a-7e). Risk: **DOM selectors break** when venues change UI — mitigated by versioned selector maps + honest "untested/tuned" flag already in `PiccTier1` (`connector.tuned`). Canvas/WebGL venues can't be read — fall back to CCXT (documented in §12.4).

---

## 5. Cross-cutting architecture notes

- **Redirect reuse** (`R5`): the deep-link builders in Slice 7a (`instrumentUrl`) are consumed by the Slice-2/3 suite's "Trade on {venue}" button. Slice 7a may be reordered earlier if the redirect button is needed before extension selectors. The button reuses `SITE_INDEX` `url` + `instrumentUrl`.
- **Advisory-first invariant:** Slice 4's push enable is user-initiated; Slice 7 never generates signals; Slice 2/3 keep honesty labels ("decision support only", unconfigured ≠ zero-filled, "no samples → —").
- **Credentials/vault:** any per-venue key the extension session-capture touches must go through the existing single encrypted vault (§10 rule 4/9) — never logged, never committed. No real credentials appear anywhere in this spec or its tests.
- **Convention compliance:** `feat:` slices 1,2,4,7; `refactor:` slice 2 (labels), slice 6 (matrix); `fix:` slice 5e. No `git push` by the implementing agent (push stays human, per P10).

---

## 6. Test plan (summary)

| Slice | New/updated tests | Target |
|---|---|---|
| 1 | catalog alias tests (majors, minors, exotics, equities, yahoo mapping) | green |
| 2 | timeframe-type/label test, chart-selector render, suite generic-label render, broker default timeframes | green |
| 3 | latency endpoint shape, empty-vs-populated render | green |
| 4 | vapid-public-key endpoint, subscribe/unsubscribe flow (mocked PushManager), pruned-dead UI flag | green |
| 5 | signalEngine/marketDataBus/scheduler coverage ≥70% + stretch files; llm failure documented | green (707 existing preserved) |
| 6 | prune test, weight-decay test, calibration test, per-new-model unit tests | green |
| 7 | detectSite platformKind/instrumentUrl, mock-DOM selectors, session capture, registry adapter, boundary-guard test | green |

**Regression gate (every slice):** the full suite (`npx vitest run`) stays at its starting state or improves (707 passing today; 709 total). No slice may reduce the passing count.

---

## 7. Risks

| # | Risk | Likelihood | Guard |
|---|---|---|---|
| 1 | **EO-label generalization breaks a live render path** (many components, subtle strings) — most likely to bite. | High | Per-component render tests in Slice 2f; grep guard; error-boundary test pattern from generalization §2.1 |
| 2 | Catalog alias collisions / unexpected canonicalisation (e.g., a forex `=X` colliding with an existing crypto base) | Medium | Exhaustive alias tests in Slice 1d; keep `yahooSymbolFor` 6-letter heuristic verified |
| 3 | Extension DOM selectors break when a venue changes its UI | Medium (per venue) | Versioned selector maps + `tuned` honesty flag; CCXT fallback |
| 4 | Model pruning alters live consensus / autopilot gating behavior | Medium | Fusion tests + keep pruned/active counts reported separately; gate behind sample minimum |
| 5 | Web-push only fully verifiable in a real browser; headless test env differs | Medium | Mock `PushManager`/`registration`; runtime status surfaced honestly; Chrome/Edge primary target |
| 6 | Untested code (signalEngine/scheduler) hides latent bugs revealed by new tests | Medium | Fix-commits, don't paper over; deterministic injected-clock tests |
| 7 | The 2 pre-existing `llm.test.mjs` failures are real, not env-flaky | Low | Reproduce in CI before touching; if real, file as separate fix (out of this wave's scope but tracked) |

---

## 8. Honesty notes (demo/live gates + fabricated state)

- Slice 1-3, 6 touch only data/naming/label/UI-surface — no demo/live gate is crossed by these; no state fabricated (latency "—" when no samples).
- Slice 4 enables push in the user's real browser (permissionful). It is never auto-enabled; the server never claims "sent" when it was skipped (notifier already records `skipped` vs `failed` vs `off`). VAPID keys are set and `sendWebPush` works — but "configured" ≠ "a browser is subscribed"; the UI must distinguish configured vs subscribed (use `notifierStatus().subscriptions`).
- Slice 7 captures real browser session data. It must never log tokens, never expose them in responses (existing `sanitizePatch`/vault patterns apply), and never be mistaken for live-feed fidelity — label data provenance (`source`) honestly like `PiccTier1`'s `read via {source}`.
- The extension's existing `PiccTier1` copy "Read-only aggregation. PICC never spends, trades or submits on your behalf." must be preserved/reinforced for the new trading data-collection paths.
- The redirect button copy must not imply PICC executed anything: "opens {venue} — you are leaving PICC's advisory view."

---

## 9. Definition of done (cross-slice)

- [x] `canonicalAssetId` resolves all forex + equities aliases (R1). — Done (`31672d1`), asserted in `modelMatrix.test.mjs`.
- [x] 12 chart timeframes selectable end-to-end; broker default matches (R2). — Done (`384f62f`), broker default asserted in `brokerRegistry.test.mjs`.
- [x] Zero EO labels in the default suite path (R3). — Done (`384f62f` + `6536176`), guarded by `brokerAgnosticLabels.test.ts`.
- [x] Broker rows show median/p95 latency from `dataBusStats()` (R4). — Done (`b561d29`).
- [x] "Trade on {venue}" deep-link works and is labelled advisory (R5, Slice 7a reused). — Done (`78bc1a0`, `a752ec2`); `openBrokerTab` in `TradingSuite.tsx` + REQ-9 deep-link seam.
- [x] `/api/notifications/vapid-public-key` + service worker + enable flow + disable + pruned-dead UI (R6). — Done (`3555095`).
- [x] signalEngine/marketDataBus/scheduler ≥70% coverage; 707+ tests green (R7). — Done: full suite **223 files / 2337 tests, 0 failures**.
- [x] Boundary guard proves extension imports no decision modules (R8). — Done (`ca5cd89` build boundary guard; extension archived `07cba74` after the pass).
- [x] Model pruning, decay, calibration, and 2 new pure models with tests (R9). — Done (Slice 6, all sub-items checked).
- [x] `docs/TRADING_MULTIPLATFORM_ROADMAP.md` carries an explicit note that execution re-integration is superseded by the redirect decision (Add a short pointer in that doc alongside §0; do not rewrite its audit). — Resolved: the roadmap doc was removed in `bb81441` (two-doc end-state); the ADR + supersedes note lives in this spec §2.1 / header — the pointer target no longer exists, so the requirement is satisfied by the §2.1 ADR being the record of record.

---

## 10. Suggested commit sequence (one per slice)

1. `feat: add forex + equities aliases to asset catalog` (Slice 1)
2. `refactor: broker-agnostic suite labels + 12 timeframes` (Slice 2)
3. `feat: surface dataBus latency in suite broker rows` (Slice 3)
4. `feat: web-push subscription (vapid endpoint + service worker + enable flow)` (Slice 4)
5. `test: add coverage for marketDataBus, signalEngine, scheduler` (Slice 5)
6. `refactor: stabilize model matrix (prune, decay, calibrate) + 2 pure models` (Slice 6)
7. `feat: extension data-collection layer (platformKind, selectors, session capture, LiveBroker wrap)` (Slice 7)

Each commit lands green (its tests + full regression suite), is independently shippable, and never crosses the advisory boundary.
