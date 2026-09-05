# PICC — Passive Income Command Center

**Cumulative master document** — the single source of truth for everything about this project.

> **Living document.** Grows with the codebase; sections below are the permanent skeleton and are
> continuously filled in as work lands. Anything in **LAST-VERIFIED** boxes was observed on the
> stated date by running the stated command — not remembered, not guessed. When code and this
> document disagree, **code is truth** and this document is wrong.
>
> **Origination:** consolidated 2026-09-05 from the legacy `docs/` corpus (architecture, audit
> ledger, finalization report, research corpus, 16 specs, setup/validation/runbook docs) as repo's
> doc end-state: `README.md` (GitHub-facing) + this file (exhaustive). Legacy docs are NOT yet
> deleted — retirement is pending explicit user confirmation after absorption is verified (§22).

---

## §0 Mission, Guardrails & Positioning

PICC is an AI-assisted **planning** platform for exploring and optimizing passive income streams:
a **Financial Twin emulator**, a **passive browser sensor** (DOM-free MV3 extension relaying broker
frames), a **studio browser** with read-only metrics overlay, an **income connector layer**
(bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels), and a **trading decision
suite** with honest, calibrated, advisory-only signals.

**The three guardrails (mission constraints, never weakened):**

1. **No live-money order placement, anywhere, ever — demo/paper only.** The only order path in the
   tree is `openPaperTrade` (`server/services/trading.mjs`) behind the human-approval interventions
   gate. "Redirect, don't execute" is the standing ADR.
2. **No behavioral camouflage** against platform bot-detection. No humanized-typing by default
   (`PICC_HUMANIZE=1` is explicit opt-in for slow reads, never for deception).
3. **Every data source reports its own honest `source`/`status` label — never fabricate a number.**
   `absent → null`, never a fabricated `0`; `unconfigured ≠ zero-filled`.

**Positioning:** decision-support tool, not an automated decision-making system. Every AI output is
gated behind a mandatory human-review step. Verified current posture: advisory-only trading
decision support (no execution weld), clean payment-security surface, credential-at-rest vault,
loopback-only container exposure, shell-injection-free process invocation.

---

## §1 The Honesty Contract

Rules that apply to code, docs, tests, and this document alike:

- **Absent → `null`.** Unmeasurable spread reports `"spread":"unmeasurable"` with
  `spreadSource:null`. Absent balance → `null`, never `0` (`accountMetrics.mjs`).
- **Unconfigured ≠ zero-filled.** When a provider key is missing or a service is unreachable, the
  output is labelled `local engine` / degraded — never presented as live.
- **Live labels mean observed live.** A feed is "connected" only while a buffer was written within
  its staleness window (`CCXT_STALE_MS` = 90 s). Popup queue depth shows `n/a` when unreachable —
  never a fabricated `0`.
- **Every prediction/decision is tagged with the `engine` that produced it.**
- **Significance before weight.** No model moves ensemble weights or claims "best" on fewer than
  12 independent embargoed walk-forward windows; models under floor stay neutral at 50%.
- **Uncertainty is shown.** Split-conformal 80/90% move band on predictions with ≥20 embargoed
  residuals; 4-h candles deliberately resolve up to daily — never mislabelled.
- **Every claim in this document is rated** with the E/A/R/S scheme (§14) where it is an evidence
  claim, and carries a LAST-VERIFIED date where it is a measured number.
- **Specs' checkboxes are aspirations, not facts.** An item is done only when its test is green
  and observed.

**The one-line rule** (from VALIDATION):
> A number in PICC is trustworthy only while its honesty label says LIVE, its source reports
> healthy in data-sources, and the calibration gap for its confidence bucket is inside tolerance.
> Everything else is a hypothesis.

---

## §2 Ground-Truth Dashboard

> These numbers were observed by running the stated commands on the stated date — the only number
> of record. Anything printed elsewhere (old READMEs, audit reports) is historical context, not
> fact.

| Measure | Value | Observed |
| :-- | :-- | :-- |
| Git branch / HEAD | `master` @ `0d88992` | 2026-09-05, `git log` |
| Test files / tests | **161 files / 1,622 tests passing** | 2026-09-05, `npm test` (apps/dashboard) |
| Typecheck | clean (`tsc -b --noEmit` exit 0) | 2026-09-05 |
| `npm audit` (dashboard) | 0 vulnerabilities (historical; re-run before release) | 2026-09-02 last recorded |
| Server service modules | 93 (`server/services/` top-level 87 + `brokers/` 6) | 2026-09-05 glob |
| Frontend | 10 pages, 60 components (recursive), hooks + lib | 2026-09-05 glob |
| Specs | 16 in `docs/specs/` (statuses §10) | 2026-09-05 glob |
| Extension | MV3 `picc-overlay`, zero-dep, no build step | 2026-09-05 |
| Test floor | **never shrinks below the latest verified count** | rule of record |

Historical suite-size milestones (context): 709/709 (PICC_FULL_SCOPE session) → 900/91 (T11 §E) →
1,391/127 (audit 2026-09-02) → 1,403/131 (remediation wave 09-03) → 1,525/143 (finalization
09-04) → 1,620/160 (strategy-program wave) → **1,622/161 (2026-09-05, incl. +2 localstore Windows
regression tests, commit `0d88992`)**.

---

## §3 System Architecture

### 3.1 Pattern

**Emulation & Overlay.** PICC simulates strategies in a sandbox and suggests actions; the user
always performs the final action on the external platform. "Neither the dashboard, the extension,
nor the agents can place orders, publish, or buy anything."

### 3.2 Layers

```
User → Dashboard (React 10 pages) ──same-origin /api/*──▶ Node backend (zero-framework ESM)
                                                        │   Yahoo Finance (no key)
                                                        │   CoinGecko (no key, crypto)
                                                        │   Hybrid cloud LLM (Gemini→Groq→Mistral→
                                                        │     Cerebras→OpenAI failover, no card)
                                                        │   Serper (live news/search)
                                                        │   Payments: PayPal | Touch 'n Go |
                                                        │     BTCPay | Stripe (owner's wallet)
                                                        │   102 service modules · 100+ routes
                                                        │   (optional) CrewAI microservice :8000
Browser Extension (MV3, DOM-free sensor) ◀── suggestions + live data ──┘
External platforms (brokers, Amazon, YouTube…) — user clicks, PICC never executes
```

- **Frontend** `apps/dashboard` — React + TypeScript + Vite + Supabase; dark theme; Dashboard |
  Simulator | Trading | Streams | Agents | Opportunities | Income | Profile | Settings | Login.
- **Backend** `apps/dashboard/server` — Node ESM, no framework; `handlers.mjs` (~100+ routes) +
  96 → 102 services (was 87 top-level + 6 `brokers/`; commandCentre grew 3 → 8 this phase —
  `agentRoster`/`policyGraphCatalog`/`policyGraphValidator` from slice 1, `modeEngine`/
  `auditTrail`/`safetySidecar` from slice 2, `deliberation`/`metalearning` from slice 3);
  same-origin `/api/*` (Vite
  middleware dev, `server/index.mjs` prod).
- **External providers** — Yahoo (5y history, drift & vol), CoinGecko (crypto), LLM (honest
  failover; all-down → local engine), Serper (news/search), payments (4 paths).
- **Optional CrewAI microservice** `agents/picc_agents` — FastAPI :8000; crews: Research | Content |
  Listing | Trading | Investment (DeFi/Staking/NFT). Decision-support only.
- **Supabase** — RLS-scoped tables v1 + v2 income-classification schema (`infra/supabase/`).
- **Browser Extension** — MV3 `picc-overlay`; passive sensor relay of broker WS frames →
  `/api/extension/ingest`; DOM-free by v2.x contract.

### 3.3 Main server route groups

Twin `/api/twin/run` · Listing `/api/listing/analyze` · Content `/api/content/generate` · Extension
`/api/extension/ingest|heartbeat|tab-changed|suggest|confirm` · Agents `/api/agents/run` · Trading
`/api/trading/*` (predict, paper, autopilot, decisions, assist, status, readiness, candles,
realtime, spread, portfolio, session-policy, capture-session, capture-config, headless-status,
account-metrics, health, ledger/stats, walk-forward, export, correlation, indicators, brokers,
feed-mode, paper/overview, models/explain) · Billing `/api/stripe/*`, `/api/paypal/*`,
`/api/billing/ewallet/*`, `/api/btcpay/*` · Automator `/api/automator/status|health|assist` ·
Connectors `/api/connectors`, `/api/connectors/:slug/collect|history|stream` · Browser
`/api/browser/capture-session|metrics` · Data `/api/data/financial_accounts|transactions` ·
Health `/api/health`.

### 3.4 Data flows (essentials)

- **Financial Twin** — ticker/capital/risk/horizon/simulations → Yahoo 5y history → real drift/vol
  → Monte Carlo projection → optional LLM commentary; unreachable Yahoo → `source: local` fallback
  labelled honestly.
- **Extension sensor** — `inject.js` (MAIN world, document_start, broker domains only) sniffs WS
  frames → `postMessage` → ISOLATED `content.js` → shape-validation
  (`sanitizeUpstreamFrame`: action/asset/name caps, candle cap, size ≤ 4096) → `chromeGuard()`
  teardown → server discovery (`127.0.0.1` + `localhost`, :5173/:3000, every 15 s) → flush batches
  (≤120) every 2 s; offline → queue (cap 400), flush on reconnect.
- **Billing** — PayPal (create→hosted approval→capture re-checks id/amount/tier) · TnG manual
  e-wallet (receipt self-confirm, owner-scoped, `selfApprove` only in single-owner demo mode) ·
  BTCPay (invoice metadata `{userId, tier}` → grant on settle) · Stripe (checkout + webhook →
  service-role profile sync). Every path writes `profiles.subscription_tier/status` + audit row in
  `payment_orders`.
- **Income connectors** — one interface (`connectors.mjs`) → normalized snapshot
  `{provider, platform, balance, today, lifetime, payoutThreshold, estimatedDaily, currency,
  source, status, error, lastChecked, extra}`; transports: `api` | `ws` (reverse-engineered, e.g.
  EO) | `browser` (real Chrome/Edge over CDP via playwright-core, persistent per-source profile,
  login-once, read-only). Snapshots → `server/data/connector_history.json` +
  `connector_latest.json`; SSE live per slug (5 s); selector tuning via `scripts/tune-connectors.mjs`.
- **Automator** — bandwidth balance collectors (Honeygain, IPRoyal Pawns, Traffmonetizer JWT,
  Repocket, manual/desktop EarnApp, PacketStream); JWT-expiry alerts (≤3 days); 30-min job; never
  moves money.
- **Trading suite** — 30–60d candles (Yahoo/CoinGecko) → ensemble → calibrated confidence →
  signals appended to paper ledger (`server/data/`); EO demo session read-only bridge
  (balance/candles only — no trade messages ever sent).

### 3.5 Secrets & security posture

- Secrets never reach the browser: non-`VITE_` keys read only by the Node backend.
- Credential-at-rest: AES-256-GCM vault (`vault.mjs`), per-directory key files, wired through each
  store's read/write choke point (F-02).
- Atomic credential writes (`auth.mjs`, tmp+rename 0600) (F-03).
- Security headers + trusted-origins DNS-rebinding guard (F-04/F-05).
- gitleaks CI gate pins the purged EO tokens; secrets-scan runs first in CI.
- Docker/n8n containers bind loopback only (D8).

---

## §4 Service Inventory (93 modules)

> Map labels from the docs extraction + module names; **the file is truth** — when a label no
> longer matches its module, update this list, not the code.

**Decision engine (11):** `prediction` walk-forward statistical ensemble (engine tag
`8-model-classic`; significance floor ≥12 windows; embargoed, step h+1 + 1 quiet bar; conformal
band) · `proanalysis` pro confluence · `adaptiveConfluence` U4FA confluence (veto-only, never
forces) · `modelMatrix` 7-model technical fusion (tag `9-model-fusion`; trend EMA, momentum ROC,
RSI reversion, Donchian, MACD, MC-drift, candle pressure — **no ARIMA/Prophet/LSTM/GARCH names in
this repo**) · `fourFactor` U4FA factor math · `u4faConfig` / `u4faRisk` U4FA configuration + risk
· `marketConvergence` / `convergenceLedger` / `convergenceAlerts` MTF-convergence evidence + alerts
· `mtfConvergence` MTF engine · `multiTimeframe` 60/300/900/3600s candle layer · `signalEngine`
signal creation.

**Feed & data (16):** `liveEO` WS bridge + SSE relay (5s-bucket cascade, viewed-asset tracking,
prune guard TTL 5 min / max 256 keys) · `liveCCXT` multi-exchange feed, liveness-gated connected ·
`ccxtConnector` read-only by contract (28 order methods structurally amputated) · `marketDataBus`
unified candle bus `getBestCandles` (priority EO-push → EO-fetch → CCXT → Yahoo-daily; latency
stats) · `yahoo` / `crypto` / `dataSources` / `serper` / `wsclient` / `indicators` / `patterns` /
`orderFlow` / `regimeDetection` / `sentimentEngine` / `economicCalendar` (static
`calendarSource:"fallback-schedule"` by design) / `marketIntel`.

**Brokers (registry + 6 adapters in `brokers/`):** `brokers/index.mjs` LiveBroker registry ·
`loaders` · `yahooAdapter` · `ccxtAdapter` · `expertoption` (demo-gated binary executor; token
bucket `PICC_EO_GATEWAY_RPM` 120; exp-backoff ≤8; 90s watchdog; auth-failure detection; dual
wallet) · `paperAdapter` (paper executor; Kelly sizing; risk cap; ATR/ADX stops; TP/SL auto-close;
Yahoo mark-to-market). **No adapter has an order-placement surface except paper + demo-gated EO
legacy paths — execution is removed by design (roadmap §0 dead-letter).**

**Trading ops (10):** `trading` paper ledger + market-data entry (the only `openPaperTrade` in the
tree) · `accuracyLedger` resolution-at-correct-expiry + `sampleEntryPrice` (no look-ahead) ·
`positionManager` aggregation + `portfolioRiskCheck` (notional cap, concentration, venue share,
hedged-leg warning) · `riskParity` equal-risk-contribution weights · `correlation` cross-asset
correlation (score math immutable; dead var removed) · `volatility` Garman-Klass + Yang-Zhang
estimators, estimator chooser wired into autopilot sizing · `kellyCriterion` (payout odds from
wins only; empty history → 0.8) · `expiryOptimizer` · `entryLevels` · `technicalBacktest`
walk-forward + hyperopt (`searchGateGrid` structurally cannot see validation slice) · `hyperopt`.

**Autopilot & risk (5):** `autopilot` stacked gates (confidence→cooldown→caps→AI→MTF→pro→
sentiment→consensus→loss-breaker→regime-breaker→liveness; dry-run `/why`; `demoStatus:
running:false // execution removed — advisory-only`) · `interventions` human-approval gate (also
the engine of the future bandwidth auto-claim) · `calibration` bucket calibration health ·
`alertEngine` · `positionManager` (listed above).

**Accounts & sessions (6):** `auth` · `profile` · `accountMetrics` (absent → null, never 0) ·
`captureProfiles` headless session engine (`ssid` via `captureViaStorageScan`) · `browserStudio`
in-app browser (liveness `checkExpertOptionSessionLive`) · `tradingSessions` (connect throws
unless `isDemo:true`).

**Income & automator (8):** `connectors` · `collectors` · `automator` · `automatorAdvice` ·
`assetCatalog` instrument canonicalization (canonicalAssetId/assetsEquivalent/yahooSymbolFor) ·
`yields` · `opportunities` · `watchlist`.

**Content & research (6):** `amazon` SP-API read-only competitor data · `keywords` · `prompts`
(versioned templates, see §21 patterns) · `llm` hybrid failover (LLM_PROVIDERS order) ·
`llmSettings` · `forecast`.

**Billing & payments (4):** `stripe` · `paypal` · `ewallet` · `btcpay` (metadata round-trip; tier
restricted to pro/business).

**Observability & UI data (8):** `health`-equivalent status surfaces via handlers ·
`realtimeSuite` fault-isolated statuses feeding dashboard chips · `tradingHud` · `suites` ·
`tradingCatalog` · `tradeJournal` (env `PICC_JOURNAL_DATA_DIR`) · `notificationCenter` (env
`PICC_NOTIFICATION_DATA_DIR`) · `notifier`.

**Persistence & infra (9):** `localstore` JSON tables, one serialized promise chain per store,
atomic tmp+rename with Windows EPERM retry + direct-write fallback (commit `0d88992`, see §12) ·
`vault` AES-256-GCM · `supabase` client · `scheduler` staleness/liveness/uptime jobs · `rateLimit`
courtesy shared-budget limiter (see §20 known issue) · `browserBridge` CDP via playwright-core,
`execFileSync` argument arrays only · `analytics` · `autodetect` browser auto-detect · `models`
model registry.

---

## §5 Frontend (10 pages, 60 components)

| Page | Purpose |
| :-- | :-- |
| Dashboard | net-worth hero (computed assets − liabilities), portfolio cards, correlation screen |
| Simulator | Financial Twin Monte Carlo |
| Trading / Suites | suite panels, live chart, paper order form (retitled "Quick Paper Trade", `simulated · advisory-only` badge), decision log, readiness, autopilot |
| Streams | income stream catalog + channel tabs |
| Agents | crew results / agent logs |
| Opportunities | catalog opportunities |
| Income | Finance Tracker (accounts/transactions CRUD), Holdings Editor (`nft_holdings`/`depin_nodes`) |
| Profile | settings + finance accounts |
| Settings | LLM/payment/provider config |
| Login | Supabase auth |

Notable components: `CorrelationScreen`, `PortfolioAggregatePanel`, `FinanceTracker`,
`HoldingsEditor` (server-backed CRUD on the Overview tab), chart fullscreen, skeleton loading,
compact mobile tier (≤560px), `prefers-reduced-motion`, full ARIA semantics (D10). API layer
`src/lib/api.ts` with typed consumers; `finance.ts` rewritten against
`financial_accounts`/`transactions` via `localdata.ts`; live SSE consumption via
`subscribeTicks`/`useRealtimeSuite` (refcounted shared stream).

---

## §6 Browser Extension (MV3 `picc-overlay`)

- Zero-dependency, no-build vanilla JS; load unpacked from
  `apps/dashboard/extensions/picc-overlay/`. `apps/extension-archived` is the retired Plasmo
  skeleton (F1) — historical demo only.
- **Contract:** DOM-free passive sensor; relays broker WS frames to `/api/extension/ingest`;
  batches ≤120, flushes every 2 s; offline queue cap 400; probes `127.0.0.1` and `localhost` on
  :5173/:3000 every 15 s (IPv4/IPv6 loopback fix, T11 §E); `chromeGuard()` on context
  invalidation; popup renders `online :port | offline | standby` (live probe, not cached).
- **T11 status:** sections A/B (chart correctness at 1m/5m/15m/1h; feed-mode flip) **VERIFIED-
  MACHINE**; sections C/D (real-Chrome lifecycle; broker-tab drag) **UNVERIFIED-HUMAN** — T11 stays
  open until a human runs them against a live EO demo session.
- The overlay on broker pages was removed by design in Phase 1 — the sensor is the product.

---

## §7 Payments & Billing

Four paths, all Supabase-JWT-authed, money to the owner's own wallet (no bank account, no business
registration):

1. **PayPal** — create-order → hosted approval → server capture re-checks id/amount/tier → grants.
2. **Touch 'n Go e-wallet (manual)** — order returns amount/instructions/`PICC-XXXX` ref; receipt
   self-confirm; owner-scoped; `selfApprove` only in single-owner/no-accounts demo mode (D3).
3. **BTCPay** — self-hosted, no KYC; invoice metadata `{userId, tier}` round-trip (D4); local node
   bundled at `127.0.0.1:23000`; Oracle VPS mainnet option **abandoned** (region denies Always
   Free) — mainnet runs on own PC (`NBITCOIN_NETWORK=mainnet`, prune=50000, assumevalid v29.2
   block 886157).
4. **Stripe** — checkout + webhook → profile sync via service-role; `stripeCustomerForUser()`
   server-side resolution (D2 — client-supplied `customerId` never trusted).

Audit posture: BTCPay grant branch was unreachable (`info.userId/tier` never returned) — fixed
with metadata round-trip + 6 tests. Stripe portal IDOR fixed (400 when no customer on file).
eWallet forge path closed (owner binding + explicit selfApprove). All landed as audit remediation
batch with tests (see §12).

---

## §8 Trading Suite

### 8.1 Engine & validation

- **Prediction (classic ensemble tag `8-model-classic`):** momentum, mean-reversion, trend
  regression, Monte Carlo, statistical seasonality, LSTM-lite, GARCH-lite concepts in the *older*
  docs — **do not import ARIMA/Prophet/LSTM/GARCH names** (repo rule); the shipped 7-model matrix
  (`9-model-fusion`) is venue-agnostic pure candle math.
- **Confidence** = calibrated fraction of times the direction call was right on unseen
  (embargoed) data; significance floor ≥12 independent windows.
- **EV units:** predicted and realized both fraction-of-stake, comparable everywhere
  (percent/fraction mix is regression-pinned).
- **Kelly:** full + half; payout odds from wins only; empty history → 0.8.
- **Per-asset honesty:** instrument hitRate below breakeven → excluded from autopilot scope, not
  averaged away.

### 8.2 Autopilot (advisory-only)

Stacked gates in order: confidence → cooldown → caps → AI → MTF → pro → sentiment → consensus →
loss-breaker → regime-breaker → liveness. Per-asset overrides/cooldowns; decision log + dry-run
`/why`. Execution removed 2026-08-31 (dead-lettered); `demoStatus: running:false // execution
removed — advisory-only`. Kill switch = dashboard autopilot stop (immediate POST; in-flight ticks
reentrancy-guarded). U4FA verdicts require human approval; no win-rate string before ≥200 resolved
decisions (T14 gate).

### 8.3 U4FA (Universal 4-Factor)

`adaptiveConfluence` runs per enabled asset on its `periods[300]` slice; results ride
`strategies.u4fa` + `type:"u4fa"` SSE events; OFF by default per asset; can VETO a confluence
TRADE, never force one; TRADE verdicts enqueue PAPER proposals (`source:"trade"`). Honest
`candleSource:"liveEO-extension"` provenance when fed by the extension.

### 8.4 MTF convergence

Simultaneous 60s+300s+900s evaluation, HTF bias overlay, confirmation scoring; backtest evidence
in `mtf-convergence-research-*` (rated R in §14); `marketConvergence`/`convergenceLedger` track
agreement evidence.

### 8.5 Multi-exchange read-only layer

CCXT connectors: Binance, Bybit, OKX, Kraken, KuCoin, et al — market data by contract; 28 order
methods amputated; 15 s scheduler job; liveness gate 90 s. Execution waves (roadmap §16) plan
`sandboxMode` testnet-first only when the owner approves that slice — still not built.

### 8.6 Venue truth-table (honesty of record)

| Venue | Status in PICC | Notes |
| :-- | :-- | :-- |
| Paper | first-class executor | the only order-capable surface |
| ExpertOption | **demo-only** (read-only bridge; live deferred) | unofficial WS protocol; unregulated EOLabs LLC, St. Vincent & Grenadines; connector not robust — recorded, never hidden |
| CCXT exchanges | market data read-only | sanctioned automation exists via official protocol — first real-money candidate |
| IQ Option / Quotex / Olymp / Deriv | session capture only, no execution | `liveLeg:false` until a recorded live fixture |
| OANDA / MetaApi / Alpaca / IBKR | planned (Wave 2) | practice accounts first |

### 8.7 Runbook essentials

Verification ladder after every pull: `npm test` → `npm run typecheck` → `npm audit
--audit-level=high` → `npm run serve` (expect `server started… 127.0.0.1`) → `npm run
smoke:trading` → `curl /api/trading/status` (`sessionLive`, `gatewayRpm`) → `/api/trading/readiness`.

Live-currency honesty: 82%-payout math ≈ 54.9% breakeven win rate; EU/UK regulator disclosures
report 68–89% of retail accounts losing money — surfaced on the readiness panel.

---

## §9 Income Generalization

- **Model:** income-stream catalog (Category A passive · B semi-passive · C active) across
  bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels; tabs for
  Interest/Dividend/Rental/Content.
- **Connectors** as in §3.4. Tuner report: OpenSea `tuned: true`; everything else `tuned: false`
  (selector tuning is per-provider, honest).
- **Automator** bandwidth collectors as in §3.4.
- **Q5 wave executed 2026-09-04:** checklist Tasks 1–13, one commit per task, suite green (F-12
  reconciled). Follow-ups from Q5: 25 open tasks (next phase per user plan).
- **Finance Tracker (Part 2a) ✅:** accounts/transactions CRUD (Profile → Finance tracker); net
  worth = Σasset − Σliability computed on Dashboard load (not snapshotted); per-account currency
  with fixed-rate USD conversion (v1); trading suite auto-synced as `type: asset` tracking
  `getPaperOverview().cash`. **Part 2b (later):** Firefly III sync (env `FIREFLY_URL`,
  `FIREFLY_TOKEN`; upsert keyed by firefly ids). **Part 3 [ ]:** Wave-1 executor contract +
  registry choke point + product decision on autonomous vs manual (owner flag).
- **Holdings Editor ✅:** server-backed `nft_holdings`/`depin_nodes` CRUD on the Overview tab
  (REQ-C write side).

---

## §10 Specs Registry (16 files in `docs/specs/`)

> Statuses are as stamped in each spec header, cross-checked 2026-09-05. Checkboxes inside specs
> are aspirations until a test is green (§1).

| Spec | Status stamp | Reality |
| :-- | :-- | :-- |
| **COMMAND_CENTRE_WEB_SPEC** | ready-for-agent (living) | newest; design approved; implementation = this repo's next phase (§11) |
| EXTENSION_CONNECTIVITY_ENGINE (Phase 1) | Draft for execution, 2026-08-28 | largely landed; T11 A/B machine-verified, C/D human-pending |
| MTF_CONVERGENCE_ENGINE | Approved (planning) | engine + convergence ledger landed |
| NEXT_WAVE_generalization | Approved (planning) | slices R5–R8 executed; Slice 7f (Binance/Bybit extension selectors) open, user-gated |
| PICC_EXPLICIT_AUDIT (Phase 2) | Draft for execution | delivered as `EXPLICIT_AUDIT_LEDGER.md` (all F1–F8, F-01..F-12 closed, §12) |
| PICC_FRONTEND_UI_ENGINE (Phase 3) | Draft for execution | status chips reflect fault-isolated sources; UI wave landed |
| PICC_HEADLESS_CAPTURE_ENGINE | Draft for execution, 2026-08-29 | capture engine + session policy landed |
| PICC_INCOME_GENERALIZATION_checklist_v1 | Tasks 1–13 EXECUTED 2026-09-04 | verified |
| PICC_INCOME_GENERALIZATION_design_v1 | Draft for execution, 2026-09-03 | executed via checklist (above) |
| PICC_INCOME_GENERALIZATION_requirements_v1 | Draft for execution, 2026-09-03 | absorbed into design+checklist |
| PICC_MULTISOURCE_ENGINE (Phase 4) | Draft for execution, 2026-08-29 | T7 landed (live probe deviation recorded); cross-source `verified` candles shipped 2026-09-04 |
| PICC_NOTIFICATION_AND_ALERT_UX_v1 | draft (no status header) | alertEngine/notificationCenter/notifier exist |
| PICC_SESSION_POLICY_AND_CHANNEL_CATALOG | draft + implementing, 2026-08-31 | session-policy route + channel catalog tabs landed |
| PICC_SIGNAL_VENUE_POOL_DECISION | decision (T5/D) | venue pool: expertoption/ccxt/paper verdicts |
| PICC_TRADING_SUITE_UPGRADE | draft | engine tags + read-only EO bridge correspond |
| PICC_UNIVERSAL_4FA_ENGINE | Draft for execution, 2026-08-30 | U4FA shipped (`adaptiveConfluence`) |

---

## §11 Command Centre Web — Design of Record (spec committed `018025b`, absorbed here)

**Status: ready-for-agent (living spec — continuously improved through implementation); §11.5
slices tracked in the spec doc.** Slices 1–3 (catalog + validator + roster registry; mode engine +
safety sidecar + audit trail; deliberation layer + metalearning tuners) landed as part of this
repo's current phase — see §21 Open work. The
approved architecture for the risk-backed autopilot/copilot command surface. Approach C:
policy-graph + blackboard deliberation + Mode Engine + safety sidecar, with metalearning and
self-improvement baked in.

### 11.1 Layered design (L6 → L0)

- **L6 UI** — Command Centre Web surface (observability + risk-backed gating).
- **L5 Mode Engine** — per-site risk-backed verdict over exactly five modes:
  `BLOCKED` (executionPower `none`) | `HOLD` (`none`) | `COPILOT` (`proposals`) |
  `AUTOPILOT_DEMO` (`liveDemo`) | `AUTOPILOT` (`live`); deterministic 7-step fixed decision
  order (kill switch → opt-in → breakers → freshness/HOLD → 5C truth table → workability →
  deliberation → advisory), chosen by site risk, never by convenience. Advisory/supervisory
  input (5H) is **downgrade-only** — it can lower the mode, and can never raise it; an advisory
  outage leaves the deterministic verdict identical.
- **L4 Deliberation** — blackboard with bounded loops (maxRounds 3 default, convergenceDelta
  0.05); divergence/convergence/looping flows; 1:1 / 1:N / N:N / N:1 edges. Evidence lands per
  hop-round (BFS distance from the decision node over reversed edges); the surface is a weighted
  directional average (neutral sides excluded from numerator AND denominator); convergence is
  movement < delta, exhaustion of maxRounds while still swinging is an honest `non-converged`
  divergence cutoff; unlanded findings are surfaced, never dropped; edge trust from the catalog
  multiplies with the P-METALEARNING seam. A non-converged board never executes — the mode engine
  caps it at COPILOT with the advisory/LLM leg excluded and the reason surfaced.
- **L3 Agent Roster** — named specialty agents (news/sentiment, technical, fundamentals, whale,
  risk manager) with surfaced findings + sources + staleness (the "350 AI bots" observability
  answer).
- **L2 Policy-Graph Catalog** — **"site = template"**; `automationPermission` =
  `sanctioned | gray | forbidden` is **per-site, not per-stream**.
- **L1 Execution** — the engine that maps a sanctioned site's sanctioned actions onto
  deterministic, idempotent primitives.
- **L0 Safety Sidecar — unbreachable.** Global kill-switch; per-site opt-in; hard breakers
  (daily-loss cap, consecutive-loss pause, regime-shift pause, site risk cap — **never
  disableable via config**); full append-only audit.

### 11.2 The 8 named protocols

**P-SPECIFICITY** · **P-GROUNDING** · **P-ANTI-HALLUCINATION** · **P-PURPOSE** (purposeless edges
rejected at catalog validation) · **P-BOUNDED-LOOPS** · **P-EVOLUTION** (walk-forward, embargoed;
survivors promoted) · **P-SELF-IMPROVEMENT** (outcome-gated, auditable, never silent) ·
**P-METALEARNING** (Meta-Optimizer between L4/L5: per-regime agent weighting, edge trust,
convergence tuning; can never touch the floor or in-flight execution).

### 11.3 Safety floor (approved 1–4 + 5A–5H)

Global kill-switch · per-site opt-in · hard breakers · full append-only audit · **5A** execution-
power separation · **5B** interrupt/takeover · **5C** credential/ToS-survival · **5D** hard
exposure ceiling · **5E** stale-data forced downgrade (never trade on stale input) · **5F**
rationale-before-act (no action without a stated reason) · **5G** idempotency (no double-fill) ·
**5H** LLM downgrade-only (an LLM can downgrade an action, never upgrade past deterministic
bounds).

### 11.4 First real-money slice (user decision)

- **Scope:** CCXT (platform-sanctioned automation, official protocol) + bandwidth browser
  auto-claim via `interventions.mjs` — **first**.
- **ExpertOption stays demo** + ExpertBot pattern now; live deferred (connector not robust,
  unofficial WS protocol, unregulated venue — recorded in the venue truth-table §8.6, never
  hidden).
- **Envelope:** max $10 single exposure · max 2 concurrent live units · −5% daily loss.
  Raiseable via config **only within the floor**.

### 11.5 Rollout slices (tracked in the spec doc — exact slice table below)

Define the *final* slice breakdown from `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` —
**implementation status is tracked there, not restated here (single source of truth):**

1. Catalog + validator + roster registry (P-PURPOSE/P-SPECIFICITY/P-BOUNDED-LOOPS; trading +
   bandwidth templates; agent mapping onto existing suites) · 2. Mode engine + safety sidecar
   (deterministic; outage-of-LLM downgrade-only proven; audit events) · 3. Deliberation layer
   (blackboard, bounded loops, convergence detector, non-converged handling; P-EVOLUTION /
   P-SELF-IMPROVEMENT / P-METALEARNING tuners, outcome-gated, floor-proof) · 4. Command Centre
   surface (per-stream command card, safety rail, mode verdict, kill-switch UI) · 5. Execution:
   bandwidth auto-claim (first live) — fixture-tested, manual live verify · 6. Execution: CCXT
   live — fixture-tested, security-review, manual live verify on smallest envelope · 7.
   ExpertOption ExpertBot pattern (demo) + expansion docs/checklist. **Slice 7 is not the end** —
   expandable one-by-one via the catalog.

### 11.6 Living methodology (applies to all future work)

Post-slice post-brainstorm per slice · highly targeted/specific implementation · self-
improvisation loops · cumulative review resolving hidden defects per slice · completion gate =
verified complete in the spec doc · end-of-all-slices exhaustive review · spec doc continuously
improved · expandable beyond slice 7 one-by-one via catalog. (Example in the field: the localstore
Windows defect found during this doc's verification — §12.)

---

## §12 Audit & Closure Ledger (as absorbed)

### 12.1 F-series (all ✅ CLOSED)

| ID | Finding | Closure evidence |
| :-- | :-- | :-- |
| F1 | Plasmo duplicate tree | archived as `apps/extension-archived`; canonical = picc-overlay |
| F2 | stale overlay-era background | sensor chain covered by `e2eExtensionFeedChain.test.mjs` |
| F3 | candle resolution lie | adapters tag real resolution; `resolutionChain.test.mjs` |
| F4 | Yahoo placeholder (= silently empty) | real intraday + daily; 4h resolves to daily honestly |
| F5 | indicators timeframe key unchecked | strict 400 on unknown keys |
| F6/F7 | doc drift / Plasmo in planning docs | truth-sync; PRIVACY dual-mode; extension row archived |
| F8 | prior-plan leftovers | correlation screen + portfolio panels + latency stats landed; multi-platform routing declined by design |

### 12.2 F-01…F-12 (all ✅ CLOSED)

F-01 CI lockfile path · F-02 encrypted vault was fiction → real AES-256-GCM vault · F-03
non-atomic credential writes → tmp+rename 0600 · F-04 no security headers → CSP +
X-Content-Type-Options + X-Frame-Options + Referrer-Policy + Permissions-Policy · F-05
DNS-rebinding guard → trusted-origins allow-list · F-06 overlapping walk-forward → embargoed
non-overlapping windows (step h+1, 1 quiet bar) · F-07 max-of-N "best model" → significance floor
≥12 windows, under-floor neutral 50% · F-08 no engine identity → `engine` tags · F-09 baseline
regressions (port guard, CRLF, fixture) → fixed · F-10 no honest uncertainty → split-conformal
80/90% band · F-11 volatility discarded intraday OHLC → Garman-Klass + Yang-Zhang + estimator
chooser + correlation screen · F-12 stale docs/PRIVACY drift → truth-sync + spec-checkbox
reconciliation.

### 12.3 Recent addition (2026-09-05, found during doc consolidation)

**localstore Windows atomic-write defect, commit `0d88992`.** `rename(tmp, file)` fails EPERM on
Windows while the destination is open by a concurrent reader (test poller, listRows, antivirus) —
the audit §5.7 "atomic tmp+rename" path was silently dropping the latest snapshot + leaving
`.tmp` residue on Windows (invisible on POSIX). Fix: bounded EPERM/EACCES rename retry → direct-
write fallback (data integrity > crash-atomicity when the lock never clears); tmp cleaned either
way; `store.write()` now returns the op-chain so durability can be awaited. Regression tests:
EPERM-retry + permanent-lock fallback (+2 → 1,622 total).

### 12.4 Decisions of record (D1–D13)

D1 paper-only order form, ever · D2 never trust client `customerId` · D3 eWallet owner-bound +
explicit `selfApprove` (single-owner demo mode only) · D4 BTCPay tier grant on invoice-metadata
round-trip · D5 `round2` defined/exported, non-finite → null · D6 `execFileSync` argument arrays ·
D7 in-tree secret purge + gitleaks gate; rotation & history rewrite stay human · D8 loopback-only
publishes · D9 extension lockfile declined with reason · D10 a11y/skeleton/mobile semantics ·
D11 env-overridable data dirs · D12 build artifacts never committed · D13 push to origin approved.

### 12.5 Standing gates (all work)

- Fixes land in their own commit referencing the finding id (REQ-4).
- No doc-only closure for testable behavior (REQ-2).
- `security-review` skill on every auth/payment/vault/broker/ledger diff.
- Full suite + typecheck clean before commits; code wins on doc conflicts.
- Test floor never shrinks.

---

## §13 Research Corpus

> External claims were gathered via live fetch of primary sources 2026-09-04 (research session).
> Rated per the E/A/R/S scheme (§14) with **R** = reviewed (collected, sources cited, not
> reproduced).

**Core pass (8):** Algory (evolutionary strategy breeding + OOS forward-test + decay detection +
correlation-screened portfolios) · Forex Factory (impact-tiered calendar, crowd sentiment, broker
spread tables) · Capafy Alpha Consensus (cross-account consensus with honest framing — the data
analogue of PICC's cross-source `verified`) · UpsideOnly (paper-trade-first funded model;
user-strategy edge ranking) · EdgeBuild (`prompt → visual strategy builder → walk-forward + MC →
12-point deploy checklist`; biggest single product gap noted) · Finviz (pattern screening +
insider aggregates + CSV/API) · Messari (analyst-verified alerts, fully cited AI output, MCP
surface) · **Invo/Involio** (immutable on-chain track records — "track records as real as the
markets"; the biggest *trust*-leap inspiration: hash-chained paper ledger).

**Appended (3 + pattern):** Simul8or (tick-replay + trade coach + R-multiple — blueprint K/O ·
Bloomberg Professional (TCA, MARS risk — blueprints M/N) · app.invoapp.com (SPA shell; provenance
only) · **"350 AI bots" multi-agent orchestration** — corroborated as role-specialized agents +
human gate (TauricResearch/TradingAgents open-source exemplar; Bitsgap 2026 synthesis "AI for
context, bots for execution — agents for research, human makes the final call"). Maps onto PICC's
existing specialty services; **the gap is observability (name + surface each agent), not
capability** (blueprint L).

**Blueprint A–O** (research-only; to be specced/ticketed; ties to SPEC §11.3/§11.4 where approved):

- Tier 1 (trust differentiators): **A** verifiable/hash-chained paper ledger · **B** generalize
  `verified` to predictions/signals/news · **C** event-risk calendar live feed.
- Tier 2 (product surface): **D** visual strategy builder + copilot · **E** paper-edge leaderboard
  · **F** technical-pattern screening · **K** trade-review/coach surface + R-multiple · **L**
  agent-team observability (+ whale/on-chain agent) · **N** execution/TCA-style view over paper
  fills.
- Tier 3 (ecosystem reach): **G** MCP/tool surface · **H** CSV/API export · **M** portfolio-level
  risk view (MARS-lite) · **O** historical-replay practice mode.
- Tier 4 (hardening close-out): **I** R4 audit items (landed 2026-09-04, ✅) · **J**
  correlation-screened portfolio (landed 2026-09-04, ✅).

**Non-negotiable carries:** advisory-only + redirect-not-execute stay; honesty labels stay; every
feature lands with tests; security-review on sensitive paths; no behavioral camouflage, no
withdrawals. Open questions from the research session (from the doc) remain open pending owner
priorities — see §21.

---

## §14 Knowledge-Base Rating Scheme (E/A/R/S) & Layer Index

- **E = empirical** — measured on PICC or cited data with methodology.
- **A = audited** — verified against this repo's code, commit-cited.
- **R = reviewed** — claims collected, sources cited, not yet reproduced.
- **S = speculative/aspirational** — flagged, not evidence. Missing rating ⇒ treat as S and fix
  the rating.

Layer index (absorbed from the former `KNOWLEDGE_BASE.md`):
L0 platform truth (architecture/security/honest claims) · L1 defect & debt ledger (§12) · L2
operating knowledge (§§5–8, §18–19) · L3 spec & decision memory (§10–11, §12.4) · L4 research
corpus (§13) · L5 strategy evidence catalog (seeds: correlation-screened portfolio, "edge faded →
rotate" surfacing, one-click advisory profiles, whale/order-flow watch as read-only source).

---

## §15 Compliance & Legal Posture

- **Malaysia PDPA 2010** (amendments relevant from **30 April 2026**) + ADMP guidelines: DPIA
  triggered by automated decision-making/profiling activities; thresholds **20,000 data subjects**
  (10,000 sensitive); fines up to **RM 1,000,000 per offence** + imprisonment; Data Protection by
  Design; DPO when thresholds apply; privacy notice must disclose AI use.
- **PICC's position:** users make final decisions → PICC's AI is a general-purpose assistant →
  strictest ADMP/DPIA duties do not apply to PICC's own suggestion processing. Operator-run
  automated scoring of users, or AI deciding tier/service → run a DPIA. **Re-evaluate the moment
  PICC gains order placement or auto-publish** — classification changes entirely.
- **Malaysia AI Governance Bill** (finalizing over 2026): pre-designed for human accountability,
  transparency, risk-based approach (lower obligations for assistive/decision-support tools).
- **Mandatory human-review feature (implemented everywhere):** 5-second countdown before
  copy/apply unlocks; explicit confirmation toggle ("I confirm I am a human making this final
  decision. The AI is only providing data."); audit to `agent_logs` + structured
  `human_review_logs`.
- **What NOT to build:** fully automated business registration; bypassing KYC/AML; AI final
  decisions without human oversight; hidden bots/agents; unprotected user data.
- **Pre-launch checklist:** DPIA if ≥20k MY users / any sensitive data; DPO if required; privacy
  notice + rights; verify every RLS policy; rotate keys (anon browser-only, service-role
  server-only); retention/deletion flows; keep AI-suggestion + human-confirmation logs.
- **Not legal advice** — verify with a qualified Malaysian (or local) lawyer before launch.

---

## §16 Roadmaps

### 16.1 Trading Multiplatform (roadmap of record)

Wave 1: paper as first-class executor (✅) · CCXT spot (Binance/Bybit/OKX/Kraken/KuCoin; keys
encrypted-at-rest; `sandboxMode` testnet-first — **built as read-only today**, execution pending
owner) · ExpertOption as binary executor (demo live). Wave 2: MetaApi (MT4/5), OANDA v20 practice,
Alpaca paper, IBKR Client Portal (all planned, none built). Wave 3: Quotex/IQ Option/Olymp/Deriv
(capture live; execution blocked on tapped protocol) · TradingView HMAC webhook receiver (planned
route `/api/trading/signals/incoming`). Out of scope: camouflage/ToS-violating automation;
withdrawals/transfers anywhere. §6 execution checklist remains unchecked by design (dead-letter).

### 16.2 Full-implementation roadmap (research base)

Research base: 8 platforms, 50+ Chrome trading extensions, 53 indicators with formulas, 30
strategies, 20 open-source repos, 6,500+ lines audited. Phases: 5 (dockable panels — **superseded,
removed by design**) · 6 backtesting & analytics · 7 multi-asset autopilot & risk · 8 advanced
indicators & patterns · 9 alerts & notifications · 10 economic calendar & news · 11 portfolio &
risk visualization · 12 agent orchestration · 13 extension polish/store-readiness. Effort ~30–40
days total; several phases partially landed or superseded by later work (see §8, §9).

### 16.3 Generalization (as absorbed)

One interface for income connectors, normalized snapshots, three transports, honest source
labels; LiveBroker read-only contract vs (future) BrokerAdapter execution contract kept separate;
`marketDataBus` fan-in priority push > rest > daily; positionManager portfolio risk checks.

---

## §17 Decisions & Rules Register (condensed)

- **redirect-not-execute** (ADR) — advisory-only; only `openPaperTrade` behind human gate.
- **No behavioral camouflage**; `PICC_HUMANIZE=1` explicit opt-in for pacing, not deception.
- **No ARIMA/Prophet/LSTM/GARCH model names** in docs/code (corrected external plan's claims).
- **Per-asset honesty:** sub-breakeven instruments leave autopilot scope.
- **Embargo discipline:** step = h+1 with 1 quiet bar; ≥12 independent windows; ≥20 residuals for
  bands; edge ≤ 0 over ≥200 decisions ⇒ engine doesn't beat its own predictions.
- **Reliability floor:** treated provisional unless ≥24h window with livePct ≥95%.
- **Demo/live gates three layers deep** (connect-time throw, ensureSession check, placement
  re-check) — never weakened for tests.
- **Automation firewall of record (Command Centre):** sanctioned | gray | forbidden per-site;
  hard breakers never disableable via config; LLM can only downgrade.

---

## §18 Setup, Env & Deployment

**Prereqs:** Node 22+; Python 3.10+ only for CrewAI agents. **Quickstart:** root `npm install` →
`apps/dashboard/.env` from `.env.example` → `npm run start:all` or dev on `:5173`/API `:3000`
(loopback only).

**Env classes (names only — values live in `.env`, never committed):**
- Supabase: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- LLM: `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `CEREBRAS_API_KEY`,
  `LLM_PROVIDERS` (default `gemini,groq,mistral,cerebras,openai`), `SERPER_API_KEY`.
- Payments: `PAYPAL_CLIENT_ID/SECRET`, `PAYPAL_MODE` (sandbox default), `EWALLET_TNG_NUMBER`,
  `BTCPAY_URL/API_KEY/STORE_ID`, `STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_PRO/PRICE_BUSINESS`.
- Amazon SP-API: `SP_AMAZON_*` (CLIENT_ID/SECRET, REFRESH_TOKEN, ACCESS_KEY, SECRET_KEY,
  MARKETPLACE default US).
- Trading: `PICC_EO_GATEWAY_RPM` (120), `PICC_BROWSER_PATH` (auto-detect), `PICC_TRADING_DATA_DIR`.
- Ops/vault: `PICC_PORT` (3000), `PICC_APP_URL`, `PICC_VAULT_KEY` (or auto-generated key file),
  `PICC_SECRET_KEY`, `PICC_HUMANIZE`, `PICC_JOURNAL_DATA_DIR`, `PICC_NOTIFICATION_DATA_DIR`,
  `PICC_AGENTS_URL`.

**Deployment:** Option 1 Docker (`infra/dashboard/docker-compose.yml`, image never bakes secrets,
`picc-data` volume, loopback bind) · Option 2 PM2 (`infra/dashboard/ecosystem.config.cjs`) ·
Option 3 systemd (`infra/dashboard/picc-dashboard.service`). TLS via nginx/Caddy; same-origin
backend, no CORS needed. Extension: load unpacked (zero-build). EO token: `capture-eo-session.mjs`
or capture API → vault at rest. CrewAI: venv + `uvicorn server:app --port 8000`. Supabase:
`schema.sql` + `v2.sql`. n8n optional: workflows in `infra/n8n/workflows/`.

---

## §19 Validation & Calibration Runbook

- Calibration: `curl -s localhost:3000/api/trading/health | jq .calibration` — monotonic realized
  win-rate buckets; `calibrationGap` ≥ −0.03..−0.05 healthy; persistently < **−0.08 =
  overconfidence** (readiness gate blocks).
- Realized vs predicted EV: `curl -s localhost:3000/api/trading/ledger/stats | jq
  '.predictedEv, .realizedEv, .edge'` — edge ≤ 0 over ≥200 decisions = engine does not beat its
  own predictions.
- Walk-forward: `curl -s -X POST localhost:3000/api/trading/walk-forward -d
  '{"candles":[…],"folds":5}'` — trust `aggregate.validationHitRate`/stability only, never train
  metrics.
- Per-asset: `/api/trading/export | jq .perAsset`.
- Reliability: `/api/trading/status | jq .uptime24h` — livePct ≥95% over ≥24h or all downstream
  stats are provisional.
- No look-ahead pins: prediction truth spans exactly h steps; hyperopt gate-grid cannot see the
  validation slice; accuracy ledger resolves at candle-time-correct expiry; indicators verified
  against canonical formulas (RSI Wilder seed hardened).

---

## §20 Known Issues (of record, 2026-09-04; documented for follow-up)

1. **429 "rate limit exceeded" when switching suites.** Single shared per-IP general bucket
   (60 req / 60 s) applies to all non-extension POST/PUT/PATCH (`handlers.mjs:1060-1077`;
   `rateLimited` at :311). A busy legitimate multi-panel suite session can cross the ceiling.
   Candidates (preference order): exempt semantically-read POST routes (mirroring the
   `EXTENSION_POLL_ROUTES` exemption) · raise the ceiling only after real measurement · split
   mutation vs read cohorts. **Never weaken demo/live gates, honesty badges, or serper/EO
   limiters.** Open: measure real per-minute POST count first.
2. **Live chart not updating in the present.** Realtime is a shared SSE stream fed only by the EO
   live WebSocket; when EO is down, fallback is Yahoo **daily** bars and `useCandleData.ts` has a
   deliberate coarse-series guard (refuses to append present buckets; nudges last close) — "no new
   candles" is designed behavior while the live feed is down. Sandbox could not reach any EO WS
   endpoint (several region URLs are dead DNS: `ws.expertoption.finance` ENOTFOUND etc.;
   `fr24g1eu.expertoption.com` resolves). **Open:** confirm whether the user's EO feed is actually
   connected; if yes, trace `subscribeLiveEO` → SSE relay. Related fix already landed: EO
   history-candle batch timestamps collapsed into one candle — now each row gets a distinct time
   (verified).
3. **Extension `apps/extension/` (Plasmo) is archived** — canonical is `picc-overlay` (§6).

---

## §21 Open Work & Backlog Register

**Owner-gated (human):** R1a rotate live EO session (after secret purge) · R1b decide EO token
history rewrite · R2 launch & verify app in owner's environment (Q5 items 115–116) · R3 approve Q5
flag items · R11 (as raised) Extension C/D legs of T11 · R9 periodic re-verification (standing).

**Scheduled/deferred:** NEXT_WAVE Slice 7f (Binance/Bybit extension selectors, user-gated) ·
Firefly III sync (Part 2b) · Wave-1 executor contract + autonomous-vs-manual product decision
(owner flag) · Income-Generalization Q5 follow-ups (25 tasks).

**Blueprint backlog (needs owner priority, §13 open questions):** A verifiable ledger · B
generalized verified · C calendar live feed · D strategy builder (large, phased) · E leaderboard ·
F pattern screening · G MCP surface · H export · K trade coach · L agent-team observability
(recommended next spec after Command Centre per research session) · M MARS-lite risk view · N TCA
view · O replay mode.

**Known-issue fixes** (§20 items 1–2 — open questions await measurements/owner env).

---

## §22 Doc Corpus Index & Absorption Status

> End-state directive: **only two project docs** — `README.md` + this `PICC.md`. Agent-specific
> files (AGENTS.md, skills, OpenCode config) stay — explicitly vital, NOT consolidated. The legacy
> `docs/` corpus below has been absorbed into this file **faithfully**. **Deletion of the legacy
> files is a separate, destructive slice pending the owner's explicit confirmation after this
> absorption is reviewed** — nothing gets deleted blindly.

| Legacy doc | Absorbed here | Status |
| :-- | :-- | :-- |
| ARCHITECTURE.md | §§0–9 | absorbed → retirement PENDING confirmation |
| KNOWLEDGE_BASE.md | §14 | absorbed → retirement PENDING |
| EXPLICIT_AUDIT_LEDGER.md | §12 | absorbed → retirement PENDING |
| AUDIT_REPORT.md | §12 | absorbed → retirement PENDING |
| FINALIZATION_REPORT.md | §§0,2,12 | absorbed → retirement PENDING |
| COMPLIANCE.md | §15 | absorbed → retirement PENDING |
| VALIDATION.md | §§1,19 | absorbed → retirement PENDING |
| SETUP.md | §18 | absorbed → retirement PENDING |
| TRADING_RUNBOOK.md | §8 | absorbed → retirement PENDING |
| T11_E2E_MANUAL_LOG.md | §6 | absorbed → retirement PENDING |
| TRADING_MULTIPLATFORM_ROADMAP.md | §16 | absorbed → retirement PENDING |
| full-implementation-roadmap.md | §16 | absorbed → retirement PENDING |
| TRADING_SUITE_GENERALIZATION_SPEC.md | §16 | absorbed → retirement PENDING |
| trading-suite-competitor-research.md | §13 | absorbed → retirement PENDING |
| mtf-convergence-research*.md (4) | §13 | absorbed → retirement PENDING |
| headless-capture-venue-research.md | §13 | absorbed → retirement PENDING |
| browser-extensions-research.md | §13 | absorbed → retirement PENDING |
| RESEARCH_AND_NEXT_LEVEL_AUDIT.md | §13 | absorbed → retirement PENDING |
| PICC_FULL_SCOPE.md | §§0,9 | absorbed → retirement PENDING |
| PROMPT_PATTERNS.md | §21 patterns note | absorbed → retirement PENDING |
| TRADING_SUITE_KNOWN_ISSUES.md | §20 | absorbed → retirement PENDING |
| PRIVACY.md (repo root, not in docs/) | (dual-mode rewrite kept in place — privacy notice is a legal artifact) | KEEP until legal review |
| docs/specs/* — 16 files | §10–11 | specs stay as of record until their slices are done; Command Centre spec is *the* next-phase spec |

---

## §23 Living Methodology (how this document stays current)

1. **Every substantive land** (feature, fix, audit closure, new verified count) updates the
   relevant section's LAST-VERIFIED box with the command + date that produced it. No update, no
   claim.
2. **Test-count milestone** (`npm test` green, full `typecheck`) is recorded into §2 whenever it
   changes, with the commit hash.
3. **New specs** get a §10 row and, when approved for implementation, a §11-style absorbed design
   block.
4. **New decisions** append to §12.4/§17 with a D-number; new audit findings append to §12 with
   their F-number and test reference.
5. **Known issues** are moved to CLOSED only with a code fix + test; the issue entry records the
   closing commit.
6. **Defects found during any verification round** (even doc work) go through the §12.3 pattern:
   observed failure → root cause → regression tests → fix → suite re-run → recorded.
7. **Retirement of an absorbed legacy doc** happens only after: (a) this file's absorption is
   verified by the owner, (b) explicit confirmation, (c) a git commit that deletes it alone (never
   mixed with other changes).

---

*End of PICC.md — continue at §24 when the next section earns one.*