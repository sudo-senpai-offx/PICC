# PICC Trading Suite — Multi-Platform Realization Roadmap

**Audience:** the AI coding assistant (and human reviewer) executing PICC's expansion from a
single-venue demo trading suite into a plug-and-play, auto-configuring, realtime, multi-platform
trading infrastructure.

**Status of this document:** grounded in a full audit of the current tree (every file/line
reference below was verified). Nothing here is speculative about the codebase's actual state.

---

## 0. Where PICC stands today (audited ground truth)

| Layer | File(s) | State |
|---|---|---|
| Binary-options executor (demo-gated) | `server/services/expertoption.mjs` | ✅ Production-grade WS client: token-bucket pacer (`PICC_EO_GATEWAY_RPM`), exp-backoff reconnect ≤8 tries, 90s watchdog, auth-failure detection, fingerprint-correlated order acks, dual-wallet account model |
| Multi-exchange market data | `server/services/ccxtConnector.mjs` + `liveCCXT.mjs` | ✅ Read-only by contract (28 order methods structurally amputated); scheduler job every 15s → `liveCCXTData()` buffers that already mirror the EO buffer contract (`assets[].periods[tfSec]`) |
| Paper executor | `server/services/trading.mjs` | ✅ Local ledger, Kelly sizing, risk cap, adaptive ATR/ADX stops, Yahoo mark-to-market, TP/SL auto-close |
| Quote/candle bus | `liveEO.mjs` (WS bridge + extension ingest) → SSE `/api/trading/realtime` | ✅ Two upstream legs (studio browser + user's own browser via extension), 5s-bucket cascade to 60/300/900/3600s, viewed-asset tracking that survives asset-list refreshes |
| Decision engine | `prediction.mjs`, `proanalysis.mjs`, `adaptiveConfluence.mjs`, `modelMatrix.mjs` | ✅ Ensemble + pro confluence + MTF + sentiment + 7-model multiplexing consensus with online weights |
| Autopilot | `services/autopilot.mjs` | ✅ Multi-asset ticks, per-asset overrides/cooldowns, stacked gates (confidence→cooldown→caps→AI→MTF→pro→sentiment→consensus→loss-breaker→regime-breaker→liveness), decision log + dry-run `/why` |
| Venue registry | `services/brokers.mjs` → `GET /api/trading/brokers` | ✅ Live-status rows for expertoption / ccxt / paper with capability vocabulary |
| Instrument canonicalization | `services/assetCatalog.mjs` | ✅ One alias table shared sensor↔server↔Yahoo; `canonicalAssetId / assetsEquivalent / yahooSymbolFor` |

**The one structural gap:** order execution is welded to ExpertOption's session singleton inside
`autopilot.mjs` (`state.session = connectTradingSession(...)`, `.buy({assetId,type:"call"|"put",...})`).
Everything downstream (handlers `/api/trading/demo/*`, UI) duck-types the session but nothing can
*provide a different session implementation*. That weld is what this roadmap removes.

---

## 1. Target architecture — the Broker Adapter Interface (BAI)

### 1.1 Contract

```js
// server/services/brokerAdapter.mjs  (to create)
/**
 * Every trading venue implements this shape. Capability flags MUST be honest:
 * an adapter that cannot do something declares it, and the engine routes around it.
 */
export const ADAPTER_CONTRACT = {
  meta: {
    slug: "expertoption",            // stable id, matches brokers.mjs row
    label: "ExpertOption",
    category: "binary",              // binary | spot | margin | futures | cfd
    capabilities: ["market-data", "account", "positions",
                   "close-position", "binary-options", "demo-trading"],
    demoOnly: true,                  // hard product boundary per venue
  },
  probe(): { configured, connected, demo, details },   // cheap, no side effects
  async connect(config): Session,
}

// Session (per venue login):
{
  // ── market data ──
  instruments(): [{ id, name, type, currency, visible, kind }]   // normalized catalog
  candles(assetId, timeframeSec, count): { closes[], ohlc[] }
  subscribeCandles(assetId, timeframeSec) / onCandles(cb)
  // ── account ──
  balance(): { balance, currency, demo }
  // ── execution ──
  placeOrder({ instrumentId, side, amount, duration?, limitPrice? })
      // binary venues: side ∈ call|put (+duration) → deal with expiry semantics
      // spot venues:   side ∈ buy|sell          → fill report
  positions(): [Deal]              // open positions/deals, normalized shape below
  closePosition(dealId)            // only when capability declared
  onSettlement(cb(kind, Deal))
}
```

### 1.2 Normalized Deal/Position shape (already exists — reuse verbatim)

```js
{ requestId, serverId, instrumentId, symbol, type, amount,
  openPrice, payout?, strikeTime?, expTime?, openedAt, expiresAt?,
  status: "active"|"closed", duration?,
  result?: "win"|"loss"|"draw", closePrice?, profit?, closedAt? }
```
EO's `openDealFrom/settlementsFrom` already emit exactly this; spot adapters map fills into it
(`payout/strikeTime/expTime = null`, `result/profit` computed at close).

### 1.3 The seam to cut (single highest-leverage change)

`autopilot.mjs` owns the session. Introduce:

```js
// services/executorRegistry.mjs
let activeExecutor = null
export function setExecutor(session, adapterMeta) { ... }
export function getExecutor() { return activeSession ?? null }
```

Then replace every direct `state.session` use in `autopilot.mjs` with `getExecutor()`, and let
`ensureSession()` become `ensureExecutor()` which asks the registry first and falls back to the EO
adapter (today's behavior, byte-for-byte, when only EO is configured). `placeDemoTrade`,
`/api/trading/demo/close` (already duck-typed!), `demoStatus` follow automatically.

**Acceptance criterion:** all 764 existing tests pass unchanged after the refactor, because the
default executor IS the current EO path.

---

## 2. Venue-by-venue integration plan (ordered by leverage ÷ effort)

Legend: 🟢 pure API · 🟡 needs local daemon/browser · 🔴 unofficial/reverse-engineered

### Wave 1 — ship next (all prerequisites already in repo)

1. **Paper engine as first-class executor** 🟢 — wrap `trading.mjs` in the BAI so autopilot can run
   against paper even without any broker token ("dry-run mode"). Zero new risk, huge onboarding win.
2. **CCXT spot (Binance, Bybit, OKX, Kraken, KuCoin…)** 🟢 — ccxt is installed. Today keys are
   *stripped* in `sanitizePatch` (trading.mjs L143-171) — deliberately keyless. To go executable:
   - add per-pair `{ apiKey, secret, password?, sandbox }` storage encrypted at rest (see §4),
   - REMOVE the amputation for explicitly-keyed instances only (`guardReadOnly` stays default),
   - implement `placeOrder` via `exchange.createOrder(symbol,'market',side,amount)` with
     `options.sandboxMode` for testnet-first gating,
   - capabilities: `spot-orders, positions(via fetchOpenOrders), close-position(cancelOrder)`.
   - Keep the read-only default for keyless configs — zero behavior change for existing users.
3. **ExpertOption remains the binary executor** 🟡 — already conforms; just wrap it as the first
   real adapter implementing the contract above.

### Wave 2 — high-value venues

4. **MetaApi (MT4/MT5 cloud API)** 🟢 — REST/websocket, free tier, covers the entire retail-FX
   world (EURUSD etc.) with REAL demo accounts. Capabilities: `spot-orders`(market), `close-position`,
   `positions`, `account`. This single adapter makes "forex income stream" real.
5. **OANDA v20** 🟢 — clean REST, practice accounts forever-free; excellent candle granularity.
6. **Alpaca** 🟢 — US equities/crypto, paper endpoint is first-class (matches PICC's demo-only DNA).
7. **Interactive Brokers Client Portal Web API** 🟡 (needs local gateway/login) — institutional
   depth; integrate last of the APIs.

### Wave 3 — browser-bridge venues (PICC's unique edge)

8. **Quotex / IQ Option / Olymp Trade / Deriv (DT/FX)** 🔴🟡 — same class of platform as EO.
   Reuse the proven pipeline instead of reverse-engineering each gateway:
   `browserStudio` persistent profile → `studioOnFrame` WS tap → per-venue frame parser module
   (mirroring `expertoption.mjs`'s parsers: `assetsFrom/candlesFrom/openDealFrom/settlementsFrom`)
   → same buffer contract. Execution ONLY where the venue exposes a demo-gated documented action
   inside the tapped protocol AND the venue is added to `SITE_INDEX` with `platformKind:"binary"`
   (the overlay honesty gate already handles this).
9. **TradingView webhook receiver** 🟢 — inbound signal source rather than executor: new endpoint
   `POST /api/trading/signals/incoming` (HMAC-verified) feeding `recordSignal` so external alerts
   enter the same calibration ledger. Low effort, big ecosystem value.

### Explicitly out of scope (record the decision)

- Any venue requiring behavioral camouflage or ToS-violating automation of live accounts.
- Withdrawals/transfers anywhere, ever. CCXT guard list already blocks these; keep it that way.

---

## 3. Autoconfiguration & adaptation (how "plug-and-play" actually feels)

1. **Credential capture via extension (already built for EO)** — generalize
   `captureExpertOptionSession` (browserStudio L3516) into per-site capture strategies registered in
   `SITE_INDEX` entries: `{ credentialCapture: { cookies:[...], storageKeys:[...], validator: fn } }`.
   Logging into any supported site in the PICC browser auto-populates the right vault entry.
2. **Capability probing at connect**: after `adapter.connect()`, run a 3-step self-test
   (`instruments()` non-empty → `candles()` fresh → tiny `balance()`) and store the PASSING
   capability set — never trust static declarations alone.
3. **Instrument normalization at the edge**: adapters return catalog rows through
   `assetCatalog.canonicalAssetId` so BTCUSDT(Binance)/BTCUSD(EO)/XBTUSD aliases collapse to one
   PICC id everywhere (model matrix, watchlist, overlay ticker).
4. **Adaptive routing**: executor selection order = user-pinned venue → venue whose
   `instruments()` contains the autopilot's scoped assets → paper. Surface the resolved route in
   `/api/trading/brokers` (`activeExecutor`) — already implemented.
5. **Rate-limit adherence**: every adapter must expose a pacer; port EO's token bucket
   (`gatewayAcquire`) into a shared `services/gatewayPacer.mjs` and make it a CONTRACT item
   (`meta.pacerRpm`), not a per-venue reimplementation.

---

## 4. Non-negotiable engineering rules (carry from the verdict)

- **Demo/live gate is three layers deep today** (connect-time throw, ensureSession check,
  placement re-check). Every new executor reproduces all three. No exceptions.
- **Honesty labels everywhere**: unconfigured ≠ zero-filled; every status field is probed live
  (see `brokers.mjs` pattern).
- **No stubs**: a venue ships only when its full lifecycle passes the E2E harness
  (`__tests__/helpers/mockExpertOption.mjs` pattern → write `mock<Venue>.mjs` per venue, then
  autopilotE2E-style tests over the mock before any network code).
- **Secrets**: extend `saveCredentials` sanitize to encrypt apiKey/secret at rest
  (`node:crypto` AES-256-GCM keyed by `PICC_SECRET_KEY` env; refuse plaintext round-trip in GET).
- **One session per venue**, owned by the executor registry; handlers/UI never open sockets.
- **Scheduler jobs are the pollers** for non-push venues (follow the `ccxt-market-data` job shape:
  read creds → early-exit when unconfigured → write into a `live*` buffer module mirroring
  `liveEOData()`).

## 5. Realtime multiplexing — extending what already works

The model matrix (`modelMatrix.mjs`) is venue-agnostic (pure candle math) and the buffer contract
is shared. Remaining work:

1. **Unified feed fan-in**: `liveEOData()` + `liveCCXTData()` + future buffers merge through one
   `services/marketFeed.mjs` exposing `getBestCandles(assetId, tf, count)` with source preference
   `push-websocket > rest-api > yahoo-daily` and per-source staleness tags (feeds `/api/trading/candles`,
   currently EO→ccxt→Yahoo inline in handlers).
2. **Tick-level model input**: matrix models currently see closed bars; add a `ticks` argument so
   pressure/Monte-Carlo can consume the sub-bar tick proxies liveEO already computes
   (`assets[].ticks.delta/ratePerMin`) — keeps everything O(1) per tick.
3. **Assistance hooks**: keep the LLM as an advisory gate (`aiGate`) — never in the hot loop;
   optional `POST /api/trading/models/explain` for on-demand natural-language rationale.

## 6. Execution checklist for the coding assistant (do in this order)

- [ ] 1. `brokerAdapter.mjs` contract file + `executorRegistry.mjs`; refactor `autopilot.mjs`
      session uses through the registry. **Tests green = done.**
- [ ] 2. Wrap EO (`adapters/expertoptionAdapter.mjs`) + Paper (`adapters/paperAdapter.mjs`);
      wire `listBrokers()` rows from adapters, delete duplicated probes in `brokers.mjs`.
- [ ] 3. CCXT executable path behind `sandbox:true` default: key storage encryption, un-amputate
      only keyed instances, `placeOrder/closePosition/positions`; mock-based tests first.
- [ ] 4. MetaApi adapter (Wave-2 headliner) with its own mock harness; then OANDA practice.
- [ ] 5. `marketFeed.mjs` fan-in replacing the inline 3-tier candle logic in handlers.
- [ ] 6. Per-site credential-capture strategy table in `SITE_INDEX`; generalize the EO capturer.
- [ ] 7. TradingView HMAC webhook ingestion.
- [ ] 8. For each new venue: `docs/TRADING_RUNBOOK.md` Part-B section listing the human-only
      verification steps (real login, live ticks, one demo cycle, network-drop recovery).

## 7. Appendix — reconciliation with the external "Complete Audit & Evolution Plan"

An externally-generated plan circulated alongside this document. Its **direction is right**; several
of its **facts about the codebase are not**, and its snippets would fail against real APIs. Where
the two documents disagree, THIS file wins. Corrections of record:

| External claim | Reality (verified) | Resolution |
|---|---|---|
| "8-model ensemble: ARIMA, Prophet-style, LSTM-lite, GARCH-lite" | `prediction.mjs` = walk-forward statistical ensemble; `modelMatrix.mjs` = **7** models (trend EMA, momentum ROC, RSI reversion, Donchian, MACD, MC-drift, candle pressure). No ARIMA/Prophet/LSTM/GARCH exists. | Do not import those names into docs/code. Extending the matrix: add a pure `(candles)→vote` fn to `MODELS` + a test. |
| `dataBus.getCandles` calling `liveEOData().getCandles(...)` / `liveCCXTData().subscribe(...)` | Both expose **snapshot objects**, not clients/methods. Subscriptions live in `liveEO.subscribeLiveEO`/connector `subscribeLive`. | Implemented correctly in `services/marketDataBus.mjs`. |
| New per-venue files (`binanceAdapter.mjs`, `bybitAdapter.mjs`) each doing `import ccxt from 'ccxt'` + own connect/cache/guards | Repo convention: **lazy dynamic import**, instance cache, read-only amputation and rate-limit handling already centralized in `ccxtConnector.mjs`. Per-venue CCXT files would duplicate all of it. | One CCXT adapter wraps `ccxtConnector`; venue differences are config, not code forks. |
| `exchange.demo` property gates live orders on ccxt instances | No such property. Sandbox gating uses `exchange.setSandboxMode(true)` + key presence. | Sandbox-default rule in §4 stands; gate on stored config flag, never on an invented attribute. |
| Separate `credentialManager.mjs` plaintext JSON vault | Duplicates `trading.mjs` credentials store + browser vault; plaintext keys contradict §4 encryption rule. | Extend ONE vault with encrypted per-venue sections (§4). |
| Arbitrage = raw spread between venues | Ignores taker fees/slippage/withdrawal friction — would report fake opportunities. | Implemented honestly in `/api/trading/spread`: net-of-fees edge, ≥0.1% bar for `opportunity`, refuses meaning when <2 venues quote. |
| Position manager writing a JSON array unlocked | Repo pattern: atomic tmp+rename writes behind promise-chain locks (`makeFileChain`). | `positionManager.mjs` reads existing locked stores instead of inventing a new unlocked one. |

### What WAS adopted from the external plan (now implemented)

- **Unified Market Data Bus** → `services/marketDataBus.mjs` (`getBestCandles`, source priority
  EO-push → EO-fetch → CCXT → Yahoo-daily, per-source median/p95 latency via `dataBusStats()`);
  `/api/trading/candles` now routes through it.
- **Cross-platform position manager** → `services/positionManager.mjs`
  (`aggregateOpenPositions`, `combinedTodayPnl`, `portfolioRiskCheck`) exposed at
  `POST /api/trading/portfolio` (optional `proposed:{symbol,amount}` runs the pre-trade check:
  notional cap, instrument concentration, single-venue share, hedged-leg warning).
- **Honest cross-venue spread engine** → `POST /api/trading/spread` (fee-adjusted, multi-venue).

### Still queued from it (folded into §6 checklist)

- Portfolio card in the webui suite consuming `/api/trading/portfolio`.
- Latency stats surfaced next to broker rows (data already collected via `dataBusStats()`).
- Multi-platform autopilot routing — blocked behind Wave-1 executor work (§6 items 1–3), by design.

## 8. Definition of done (per venue)


- [ ] Adapter passes contract tests against a scripted mock (no network)
- [ ] Demo/sandbox execution verified end-to-end by a human (Part-B checklist)
- [ ] `brokers.mjs` row shows honest live status in the suite UI
- [ ] Overlay dockables work on the venue's web app (site profile + platformKind set)
- [ ] Autopilot can scope ≥1 asset on the venue and log decisions with correct gate attribution

