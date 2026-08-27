# Trading Suite Generalization & Cleanup — Full Spec

> **Status:** Approved | **Date:** 2026-08-27 | **Supersedes:** nothing (additive)
>
> This spec covers the complete generalization of PICC's trading suite from an
> ExpertOption-centric system to a broker-agnostic, multi-platform advisory
> command centre. Every decision below was grilled and approved by the user.

---

## 0. Design decisions (grilled & settled)

| # | Decision | Answer |
|---|---|---|
| D1 | EO depth | EO stays as one catalog entry. Generalized architecture — EO is a data source, not the backbone. |
| D2 | Dual analysis paths | Consolidate. One analysis path through `marketDataBus`. Remove `viaExpertOption` branches. |
| D3 | Terminology | Generic: `long`/`short`, not `call`/`put`. |
| D4 | Priority order | Defects → dead code → generalize. |
| D5 | Asset catalog | Full catalog now — forex, equities, commodities, indices. Normalize across broker naming conventions. |
| D6 | Provider selection | User activates notification per-platform in catalog. `marketDataBus` picks ideal among activated. |
| D7 | Analysis cadence | Event-driven with rate limit. New candle triggers lightweight check; full eval if confidence crosses threshold and ≥ N minutes since last eval. |
| D8 | Notification format | Push = minimal (asset, direction, confidence, expiry). Email = full report (batched). Both include expiry duration (varies by asset/class/platform). |
| D9 | Trading chart | Multi-timeframe, up to 6 months. Primary provider = ideal provider. |
| D10 | Extension role | Headless browser access for data fetching. Market data + account state (real account balance tracked, demo balance unnecessary). |
| D11 | Email batching | Time-based cadence + confidence threshold. Daily digest at market close containing all high-confidence trades. |
| D12 | Trade expiry | Platform-provided (broker adapter reports available durations). Asset-class defaults as fallback. |
| D13 | Top N trades | Global slider, configurable, default 5, range 1–20. |
| D14 | Non-negotiables | All 9 §4 rules carry forward unchanged (advisory-only, lazy imports, atomic writes, encrypted creds, rate limiting, honest labels, demo/live gate, sandbox-default, single vault). |

---

## 1. Architecture — the generalized data pipeline

### 1.1 Current state (the problem)

```
ExpertOption WS ──→ liveEO.mjs ──→ marketDataBus (tier 1)
CCXT REST       ──→ liveCCXT.mjs ──→ marketDataBus (tier 2)
Yahoo Finance   ──→ yahoo.mjs ──→ marketDataBus (tier 3)

15+ services import liveEO.mjs directly ← structural coupling
```

`liveEO.mjs` IS the data buffer layer. Every other source feeds into EO-shaped
candle objects. The trading suite UI has EO-specific labels, credential forms,
and dual analysis paths.

### 1.2 Target state (the generalization)

```
                    ┌─ liveEO.mjs    (EO adapter — implements LiveBroker)
                    │
marketDataBus ◄────├─ liveCCXT.mjs  (CCXT adapter — implements LiveBroker)
 (single fan-in)    │
                    ├─ liveYahoo.mjs (Yahoo adapter — implements LiveBroker)
                    │
                    └─ liveGeneric.mjs (future adapters — implements LiveBroker)

All 15+ services import marketDataBus only ← no direct broker imports
```

### 1.3 The `LiveBroker` interface

Every data source implements this contract:

```ts
interface LiveBroker {
  /** Unique broker slug (matches connectors.mjs registration) */
  slug: string

  /** Human-readable name */
  label: string

  /** Priority weight — higher = preferred. User-configurable. */
  weight: number

  /** Whether this broker is currently connected/alive */
  isAlive(): boolean

  /** Latency stats for this broker */
  stats(): { medianMs: number; p95Ms: number; lastMs: number }

  /** Subscribe to live candle updates for an asset */
  subscribe(assetId: string, cb: (candle: Candle) => void): void

  /** Get buffered candles for an asset */
  getCandles(assetId: string, opts?: { timeframe?: number; count?: number }): Candle[]

  /** Available timeframe options for this broker */
  availableTimeframes(): number[]

  /** Account state (balance, positions) — null if not authenticated */
  getAccountState(): AccountState | null

  /** Expiry durations available per asset class — null = no expiry (spot) */
  getExpiryDurations(assetClass: string): number[] | null
}
```

### 1.4 The `marketDataBus` refactor

The current 3-tier waterfall becomes a **priority-sorted fan-in**:

```ts
// Current: hardcoded tier order
// Target: dynamic order based on broker weight + liveness

export function getBestCandles(assetId, opts) {
  const brokers = getActiveBrokers()  // sorted by weight DESC, alive first
  for (const broker of brokers) {
    const candles = broker.getCandles(assetId, opts)
    if (candles.length >= MIN_CANDLES) {
      return { candles, source: broker.slug, stale: false, timeframe }
    }
  }
  return { candles: [], source: "none", stale: true }
}
```

**Key changes:**
- Remove hardcoded EO→CCXT→Yahoo tier order
- Broker priority determined by: user weight setting × liveness × latency
- `source` field in response tells the UI which broker provided the data
- `dataBusStats()` aggregates across all active brokers

### 1.5 What the 15+ services change

Every service that currently imports `liveEO.mjs` switches to `marketDataBus`:

| Service | Current import | Target |
|---|---|---|
| `adaptiveConfluence.mjs` | `liveEOData, subscribeLiveEO` | `getBestCandles` from marketDataBus |
| `accuracyLedger.mjs` | `liveEOData()` | `getBestCandles` from marketDataBus |
| `marketIntel.mjs` | `liveEOData` | `getBestCandles` from marketDataBus |
| `dataSources.mjs` | `liveEOStats` | `dataBusStats` from marketDataBus |
| `realtimeSuite.mjs` | `liveEOStats` | `dataBusStats` from marketDataBus |
| `scheduler.mjs` | `liveEOStats, setLiveEOStale` | `dataBusStats` from marketDataBus |
| `sentimentEngine.mjs` | (EO display names) | Asset catalog normalization |
| `ccxtConnector.mjs` | (reference comments) | Remove EO references |
| `liveCCXT.mjs` | (mirrors EO shape) | Implements LiveBroker interface |
| `indicators.mjs` | (EO comment only) | Update comment |
| `connectors.mjs` | (EO registration) | Keep registration, add more brokers |
| `brokers.mjs` | (EO capabilities) | Generalize capabilities |
| `trading.mjs` | (EO fallback) | Use marketDataBus |
| `autopilot.mjs` | (EO session/candle imports) | Use marketDataBus + LiveBroker |
| `proanalysis.mjs` | (EO data source) | Use marketDataBus |

**`expertoption.mjs` itself is NOT deleted** — it becomes an adapter
implementation of `LiveBroker`. The file is renamed to `brokers/expertoption.mjs`
for clarity.

---

## 2. Defects to fix

### 2.1 React render crash (LIVE BUG)

**Error:** `"Objects are not valid as a React child (found: object with keys
{compression, trend, volatile_trend, quiet_range, volatile_range, transition})"`

**Root cause:** A component renders a raw market-phase/regime object where a
string is expected. The audit found that `AdvancedIndicatorsPanel.tsx` is NOT the
source — the `ProPhase` type has `label` and `strategy` string fields, and
existing renders use `phase?.label` (safe). The crash is likely in a dynamic
data path where the server returns a phase object where a string was expected.

**Fix:** Trace the exact render path. The error boundary caught it on `/suites`.
Add a defensive `typeof phase === "string" ? phase : phase?.label ?? "—"` guard
at every point where phase/regime data is rendered. Add a test that renders
`AdvancedIndicatorsPanel` with each indicator field set to an object instead of
the expected primitive — the component must not crash.

**Priority:** HIGH — live crash.

### 2.2 PaperLedger dead code

**File:** `src/components/PaperLedger.tsx` — exported `PaperLedger` component,
never imported anywhere.

**Fix:** Delete the file. Remove any references from barrel exports if present.

**Priority:** LOW — 5-minute fix.

### 2.3 Paper engine capability mismatch

**File:** `server/services/brokers.mjs` — Paper engine declares `spot-orders`
but only supports binary-style up/down trades.

**Fix:** Change Paper capabilities from `["market-data", "spot-orders",
"positions", "close-position", "account"]` to `["market-data", "paper-trading",
"positions", "close-position", "account"]`. The `binary-options` label is not
needed for paper — it simulates directional trades, not actual binary options.

**Priority:** LOW — label correction.

### 2.4 Stale extension mirror comment

**File:** `server/services/assetCatalog.mjs` line 12 — comment says "Keep the
ALIASES table mirrored in extensions/picc-overlay/content.js" but content.js no
longer contains any alias table.

**Fix:** Update comment to reflect current architecture.

**Priority:** LOW — comment fix.

---

## 3. Dead code removal

| Item | File | Action |
|---|---|---|
| `PaperLedger.tsx` | `src/components/PaperLedger.tsx` | Delete file |
| Stale extension mirror comment | `server/services/assetCatalog.mjs:12` | Update comment |
| `EO_APP_URL_RE` regex | `server/services/browserStudio.mjs:1272` | Keep (used for EO adapter), but reclassify as broker-specific |
| `checkExpertOptionSessionLive()` | `server/services/browserStudio.mjs:1284` | Keep (EO adapter), move to `brokers/expertoption.mjs` |
| `captureExpertOptionSession()` | `server/services/browserStudio.mjs:3516` | Keep (EO adapter), move to `brokers/expertoption.mjs` |
| EO-specific credential form | `src/components/TradingSuite.tsx:620-654` | Generalize to broker-agnostic credential form |

**No other dead code found.** Zero TODO/FIXME/HACK comments. Zero skipped
tests. Zero commented-out assertions.

---

## 4. EO generalization

### 4.1 Broker adapter directory

Create `server/services/brokers/` directory:

```
server/services/brokers/
  ├── index.mjs              # registerBroker(), listBrokers(), getBroker()
  ├── expertoption.mjs       # EO adapter (moved from expertoption.mjs + liveEO.mjs)
  ├── ccxt.mjs               # CCXT adapter (moved from liveCCXT.mjs)
  ├── yahoo.mjs              # Yahoo adapter (new, wraps existing yahoo.mjs)
  └── paper.mjs              # Paper adapter (moved from paper trading logic)
```

Each file exports a class/object implementing the `LiveBroker` interface.

### 4.2 EO adapter preservation

`expertoption.mjs` keeps ALL its existing functionality:
- WebSocket connection to EO servers
- Asset discovery, candle subscription, session management
- Token extraction, credential handling
- Binary options specific logic (payout, expiry, direction)

What changes:
- Wrapped in `LiveBroker` interface
- Moved to `brokers/expertoption.mjs`
- Imports from `brokers/index.mjs` instead of standalone

### 4.3 UI generalization

**TradingSuite.tsx changes:**
- "ExpertOption Session" credential card → "Broker Connection" card
- "ExpertOption quick assets" → "Quick assets" (asset list is generic)
- `EXPERTOPTION_QUICK_ASSETS` → `QUICK_ASSETS` (same data, generic name)
- `viaExpertOption` analysis branches → removed (consolidated through marketDataBus)
- Status cards: "ExpertOption account" → "Account ({broker name})" (dynamic)

**Other component changes:**
- `DockablePreview.tsx`: Remove hardcoded "ExpertOption" labels → use broker slug from data
- `LiveMarketBoard.tsx`: "Connecting to ExpertOption…" → "Connecting to {broker}…"
- `TradingChart.tsx`: "EO live" → "{source} live" (dynamic)
- `TradeOrderForm.tsx`: "Demo EO" → "Demo ({broker})", "ExpertOption not configured" → "{broker} not configured"
- `ConfluencePanel.tsx`: "Start ExpertOption to begin evaluation" → "Connect a broker to begin evaluation"
- `LiveDecisionsPanel.tsx`: "ExpertOption session connected" → "{broker} session connected"
- `TradingHud.tsx`: "the ExpertOption session must be connected" → "a broker session must be connected"

**lib/trading.ts changes:**
- `TradingCredentials.expertoptionToken/Demo/WsUrl` → generic `credentials: Record<string, string>`
- `TradingStatus.expertOption` → generic `connected: Record<string, boolean>`
- `DemoDeal.type: "call" | "put"` → `DemoDeal.direction: "long" | "short"`
- `EXPERTOPTION_QUICK_ASSETS` → `QUICK_ASSETS` (same array, generic name)
- `analyzeExpertOptionAsset()` → removed (use generic `analyzeAsset()` from marketDataBus)
- `getExpertOptionDemoStatus()` → `getBrokerStatus(slug)` (generic)
- `proAnalyzeExpertOption()` → removed (use generic `proAnalyze()`)

**lib/liveTrading.ts changes:**
- `ExpertOptionDemoStatus` → `BrokerStatus` (generic)
- `LiveDecision.payout/payoutSource/expiry` → keep (generic fields, populated by broker adapter)
- `MarketIntelRow.action: "call" | "put"` → `MarketIntelRow.direction: "long" | "short"`

---

## 5. Asset catalog expansion

### 5.1 Current catalog (assetCatalog.mjs)

| Category | Count | Status |
|---|---|---|
| Crypto | 10 | ✅ Full |
| Metals | 5 | ✅ Full |
| Energies | 3 | ✅ Full |
| Indices | 11 | ✅ Full |
| Forex | 0 | ❌ Missing |
| Equities | 0 | ❌ Missing |

### 5.2 Expansion

**Forex pairs (major + minor + exotic):**

```js
FOREX: {
  EURUSD: ["EUR/USD", "EURUSD=X", "eurusd", "Euro Dollar"],
  GBPUSD: ["GBP/USD", "GBPUSD=X", "gbpusd", "Cable"],
  USDJPY: ["USD/JPY", "USDJPY=X", "usdjpy", "Dollar Yen"],
  USDCHF: ["USD/CHF", "USDCHF=X", "usdchf"],
  AUDUSD: ["AUD/USD", "AUDUSD=X", "audusd", "Aussie"],
  USDCAD: ["USD/CAD", "USDCAD=X", "usdcad", "Loonie"],
  NZDUSD: ["NZD/USD", "NZDUSD=X", "nzdusd"],
  EURGBP: ["EUR/GBP", "EURGBP=X", "eurgbp"],
  EURJPY: ["EUR/JPY", "EURJPY=X", "eurjpy"],
  GBPJPY: ["GBP/JPY", "GBPJPY=X", "gbpjpy"],
  USDTRY: ["USD/TRY", "USDTRY=X", "usdtry"],
  USDZAR: ["USD/ZAR", "USDZAR=X", "usdzar"],
  USDMXN: ["USD/MXN", "USDMXN=X", "usdmxn"],
}
```

**Equities (top traded):**

```js
EQUITIES: {
  AAPL: ["AAPL", "Apple", "Apple Inc"],
  TSLA: ["TSLA", "Tesla", "Tesla Inc"],
  GOOGL: ["GOOGL", "Google", "Alphabet"],
  MSFT: ["MSFT", "Microsoft"],
  AMZN: ["AMZN", "Amazon"],
  NVDA: ["NVDA", "Nvidia"],
  META: ["META", "Facebook", "Meta Platforms"],
  BTCUSD: null, // already in CRYPTO
}
```

### 5.3 Cross-broker normalization

The catalog's `canonicalAssetId()` function normalizes ANY broker's naming
convention to a single canonical ID:

```js
// Examples of normalization:
"BTC/USDT"     → "BTCUSD"   (CCXT slash format)
"BTCUSDT"      → "BTCUSD"   (EO format)
"BTCUSD=X"     → "BTCUSD"   (Yahoo format)
"btc-usd"      → "BTCUSD"   (hypenated format)
"Bitcoin"      → "BTCUSD"   (human name)
"EUR/USD"      → "EURUSD"   (forex slash format)
"AAPL"         → "AAPL"     (equity passthrough)
```

The alias table is the single source of truth. Every broker adapter calls
`canonicalAssetId(raw)` before storing or displaying asset data.

---

## 6. Analysis engine

### 6.1 Single-source analysis

Analysis runs on candles from ONE provider — the ideal provider for that asset.
The ideal provider is determined by `marketDataBus` based on:
1. User-activated notification platforms (from catalog)
2. Broker weight (user-configurable, default by latency)
3. Liveness (is the broker connected?)
4. Data freshness (how old are the latest candles?)

**What analysis produces:**
- Direction: `long` or `short` (replaces `call`/`put`)
- Confidence: 0–100% (from 8-model ensemble)
- Entry price: current price or limit level
- Target exit: based on model expectations
- Timeframe: matching the candle resolution
- Expiry: from broker adapter (varies by asset/class/platform)
- Reasoning: 1-liner from the model with highest agreement

### 6.2 Event-driven cadence with rate limit

```
New candle arrives (from any broker adapter)
  → marketDataBus fans in to canonical buffer
  → lightweight check: is confidence > threshold AND ≥ N minutes since last eval?
    → YES: full analysis via prediction.mjs ensemble
    → NO: skip
  → if analysis produced: store in daily evaluation log
```

**Configurable parameters:**
- `analysisIntervalMinutes`: minimum minutes between full evals per asset (default: 5)
- `confidenceThreshold`: minimum confidence to trigger full eval (default: 60)
- `topNTrades`: daily top-N trades surfaced to user (default: 5, range: 1–20)

### 6.3 Display vs analysis separation

- **Display** (trading chart, live board, market intel): Shows data from MULTIPLE providers. UI highlights the primary/ideal provider. Aggregated candles from all enabled sources.
- **Analysis** (model matrix, entry levels, adaptive confluence, signals): Runs on data from ONE provider (the ideal). Never multi-source (would double-count).

---

## 7. Notification architecture

### 7.1 Channel behavior

| Channel | Format | Batching | Latency | Use case |
|---|---|---|---|---|
| **Push** | Minimal: asset, direction, confidence%, expiry | Per-signal (immediate) | <5s | Time-sensitive trades |
| **Email** | Full report: table of all high-confidence trades | Time-based + threshold | Minutes | Daily digest, non-urgent |
| **In-app** | Full report + chart sparkline | Real-time | Instant | Dashboard users |

### 7.2 Push notification format

```
📈 EURUSD — LONG
Confidence: 78% | Expiry: 1h
Provider: EO (live)
```

Minimal, scannable in 2 seconds. Links to dashboard for details.

### 7.3 Email batching strategy

**Trigger:** Daily at market close (configurable time) OR every N hours (configurable).

**Content:** Table of all trades that crossed the confidence threshold since
last email. Grouped by asset class, sorted by confidence DESC.

```
PICC Daily Advisory — 2026-08-27
═══════════════════════════════════

Top 5 Trades (of 12 qualified today):

#  Asset     Direction  Confidence  Entry      Target     Expiry  Provider
1  EURUSD    LONG       82%         1.0842     1.0867     4h      CCXT
2  BTCUSD    SHORT      76%         59420      58800      1h      EO
3  GOLD      LONG       71%         2345.2     2358.0     2h      Yahoo
4  USDJPY    SHORT      68%         149.82     149.45     1h      CCXT
5  NAS100    LONG       65%         19850      19920      4h      EO

Analysis powered by: CCXT (primary), EO (secondary), Yahoo (fallback)
Dashboard: http://localhost:5173
```

**Spam prevention:**
- Maximum 1 email per configurable interval (default: 4 hours)
- Only trades above confidence threshold included
- Top-N cap limits email length
- Single email contains all trades — never one email per trade

### 7.4 Expiry duration logic

```
Broker adapter reports available expiry durations per asset class
  → e.g., EO: { forex: [60, 300, 900, 1800, 3600], crypto: [60, 300, 900] }
  → CCXT spot: null (no expiry — spot positions)
  → Paper: { default: [300, 900, 3600] }

Asset-class defaults (fallback when broker doesn't report):
  → forex: 3600 (1h)
  → crypto: 3600 (1h)
  → metals: 7200 (2h)
  → energies: 7200 (2h)
  → indices: 14400 (4h)
  → equities: 86400 (1D)

User can override per-asset in catalog settings (Phase L).
```

---

## 8. Trading chart

### 8.1 Timeframe expansion

**Current:** 1m, 5m, 15m, 1h (60, 300, 900, 3600 seconds)

**Target:** 5s, 15s, 30s, 1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M

```
TIMEFRAMES = [5, 15, 30, 60, 300, 900, 1800, 3600, 14400, 86400, 604800, 2592000]
Labels:      "5s" "15s" "30s" "1m" "5m" "15m" "30m" "1h" "4h" "1D" "1W" "1M"
```

### 8.2 Server-side changes

`marketDataBus.mjs` timeframe clamp: currently `5 ≤ tf ≤ 3600`. Change to
`5 ≤ tf ≤ 2592000` (1 month).

Candle count: increase max from 500 to 2000 for larger timeframes.

### 8.3 Data source per timeframe

| Timeframe | Best source | Fallback |
|---|---|---|
| 5s–30s | EO (push) or CCXT (REST) | Yahoo (not available at this resolution) |
| 1m–15m | EO or CCXT | Yahoo (daily only) |
| 30m–4h | CCXT or Yahoo | EO (if connected) |
| 1D–1M | Yahoo (daily EOD) | CCXT (if exchange has daily candles) |

The ideal provider is selected by `marketDataBus` based on which broker has
data at the requested timeframe. The UI shows "{source} live" next to the chart.

### 8.4 UI changes

`TradingChart.tsx`: Expand timeframe selector to show all 12 options (scrollable
pill bar or dropdown for mobile).

`useCandleData.ts`: Update `Timeframe` type to include all 12 values.

`CandlestickChart.tsx`: No changes needed — it already renders any candle array.

---

## 9. Extension role

### 9.1 Data fetching scope

The extension accesses trading sites headless (via the browser bridge) to fetch:

**Market data:**
- Live candles/price feed from the trading platform
- Order book depth (where available)
- Current asset list and available timeframes

**Account state:**
- Real account balance (tracked for portfolio display)
- Open positions (tracked for portfolio risk check)
- Demo account balance: NOT tracked (unnecessary per user decision)

### 9.2 How it fits the architecture

The extension's browser bridge becomes another `LiveBroker` implementation:

```
Extension (browser bridge) → liveExtension.mjs (implements LiveBroker)
  → feeds marketDataBus alongside EO, CCXT, Yahoo
```

The extension is the **highest-fidelity** data source — it reads directly from
the user's real browser session on the trading platform. It takes priority
(highest weight) when connected.

### 9.3 Catalog integration

The webui catalog shows each trading platform with:
- Platform name and URL
- Connection status (connected/disconnected via extension)
- Notification toggle (on/off)
- Primary source priority (drag-to-reorder among activated platforms)
- Real account balance (from extension browser bridge)
- Available assets and timeframes

---

## 10. Non-negotiable rules (carried from §4)

| # | Rule | Enforcement |
|---|---|---|
| 1 | Advisory only — no execution | All order methods remain structurally amputated in CCXT. EO demo trades are paper-only. |
| 2 | Lazy dynamic imports | All heavy deps (playwright-core, ccxt) loaded on demand only. |
| 3 | Atomic tmp+rename file writes | `makeFileChain` pattern for all persisted state. |
| 4 | Encrypted credential storage | Per-broker encrypted sections in single vault. |
| 5 | Rate limiting on all endpoints | Existing rate limiter covers new endpoints. |
| 6 | Honest status labels | Never fabricate sent/success. "skipped" ≠ "failed". |
| 7 | Demo/live gate | Every broker adapter has explicit demo/live flag. Default: demo. |
| 8 | Sandbox-default for CCXT | `exchange.setSandboxMode(true)` unless user explicitly overrides. |
| 9 | Single credential vault | One `credentials.json` with per-broker encrypted sections. |

---

## 11. Execution phases

### Phase G — Defects + Dead Code (quick wins)

**Files:** 5-6 files, ~2 hours
- Fix React render crash (trace + defensive guard + test)
- Delete `PaperLedger.tsx`
- Fix Paper engine capabilities in `brokers.mjs`
- Update stale comment in `assetCatalog.mjs`
- Verify all 685+ tests still pass

### Phase H — Live Data Abstraction (highest leverage)

**Files:** 20+ files, ~1-2 sessions
- Create `server/services/brokers/` directory
- Define `LiveBroker` interface
- Move EO to `brokers/expertoption.mjs` implementing LiveBroker
- Move CCXT to `brokers/ccxt.mjs` implementing LiveBroker
- Create Yahoo adapter `brokers/yahoo.mjs` implementing LiveBroker
- Refactor `marketDataBus.mjs` to use broker registry
- Update all 15+ importing services to use marketDataBus
- Tests: mock broker implementations, fan-in priority tests

### Phase I — Asset Catalog + Normalization

**Files:** 3-5 files, ~3 hours
- Expand `assetCatalog.mjs` with forex + equities aliases
- Add `canonicalAssetId()` normalization for cross-broker naming
- Update `liveEO.mjs`, `liveCCXT.mjs` to normalize through catalog
- Remove stale extension mirror comment
- Tests: cross-broker normalization tests

### Phase J — Analysis + Notification Architecture

**Files:** 10+ files, ~1-2 sessions
- Consolidate analysis paths (remove `viaExpertOption` branches)
- Rename terminology: `call/put` → `long/short` everywhere
- Event-driven analysis with rate limiting
- Email batching logic (daily digest)
- Notification format: push=minimal, email=full report
- Expiry duration from broker adapter
- Tests: analysis engine, notification batching, expiry logic

### Phase K — Chart + UI Generalization

**Files:** 10+ files, ~1 session
- Expand timeframe options to 12 (5s through 1M)
- Update `useCandleData.ts` Timeframe type
- Update `TradingChart.tsx` timeframe selector
- Generalize EO-specific UI labels across all components
- Credential form: broker-agnostic
- Catalog UI: activation per-platform, notification toggle
- Tests: component rendering with generic broker data

---

## 12. Test strategy

| Phase | New tests | Modified tests |
|---|---|---|
| G | React crash guard test | None |
| H | LiveBroker mock, fan-in priority, broker registry | `brokers.test.mjs`, `marketDataBus` tests |
| I | Cross-broker normalization, alias resolution | `assetCatalog` tests |
| J | Analysis rate limiting, email batching, expiry | `prediction.test.mjs`, `notifier.test.mjs` |
| K | Component rendering with generic data | Existing component tests |

**Target:** 700+ tests passing at end of all phases.

---

## 13. Definition of done

- [ ] Zero React render crashes on `/suites` page
- [ ] Zero EO-specific labels in default UI path (EO visible only when EO broker is configured)
- [ ] `marketDataBus` imports zero direct broker modules (only broker registry)
- [ ] Asset catalog covers forex, crypto, metals, energies, indices, equities
- [ ] `canonicalAssetId()` normalizes CCXT/EO/Yahoo/generic naming to single canonical ID
- [ ] Trading chart supports 12 timeframes (5s through 1M)
- [ ] Analysis runs on single ideal provider, not multi-source
- [ ] Push notifications: minimal format with expiry duration
- [ ] Email notifications: batched daily digest with table of qualified trades
- [ ] Top-N configurable (global slider, default 5)
- [ ] All 9 non-negotiable rules verified
- [ ] 700+ tests passing, typecheck clean
- [ ] `PaperLedger.tsx` deleted
- [ ] Paper engine capabilities corrected
