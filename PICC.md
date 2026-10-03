# PICC — Personal Income Command Centre

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
a **Financial Twin emulator**, a **studio browser** (real Chrome/Edge over CDP, read-only metrics
overlay, and the passive headless capture leg), an **income connector layer**
(bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels), and a **trading decision
suite** with honest, calibrated, advisory-only signals. **There is no browser extension** — the
extension era was removed end-to-end (D1) and `extensionAbsence.test.mjs` pins its absence (§6).

**The three guardrails (mission constraints, never weakened):**

1. **Order placement is gated, never ungated — and the claim is corrected to match the code
   (WS-7 D19, 2026-09-26).** An earlier version of this line read "no live-money order placement,
   anywhere, ever," which the code contradicted and which `executionAbsence.test.mjs` appeared to
   pin but did not. **Two venue-capable rails exist and are intentionally retained:**

   | Rail | File | Verified gates in that file |
   | --- | --- | --- |
   | CCXT spot | `server/services/ccxtOrdering.mjs` | `CCXT_HARD_NOTIONAL_CAP_USD = 10` (`:52`) · day-loss percentage computed and surfaced (`:432`, `:440`). **Other guards are asserted by `ccxtOrdering.test.mjs` / `commandCentreExecution.test.mjs` at the calling layer and are not yet re-verified here — see the honesty note below.** |
   | Hyperliquid perps | `server/services/venues/hyperliquidPerps.mjs` | mainnet requires `PICC_CCXT_PERPS_MAINNET_ENABLED=1` **and** a ceremony unlock (`:107-109`); adapter reports `testnetOnly: true` in its risk model |

   Both rails are **consent-locked and hard-capped**; neither fires unattended, and the Copilot may
   only auto-execute inside the paper → demo → live boundary. Three honest caveats:

   - The perps adapter **gained a production `cancel` member in WS-7 T3 (landed
     2026-09-29)** — `hyperliquidPerps.mjs:567`, exported at `:618`, gated by
     `modeOf()` identically to `submitOrder` and refusing an unidentifiable cancel
     before any venue instance is built. *(Corrected 2026-10-02 by T21: this bullet
     previously read "has **no** production `cancel` member, so an open perps
     position is not exitable through the production path today. WS-7 T3 adds
     one." The addition has landed, so the caveat no longer describes the tree.)*
   - Guard coverage is now **machine-discovered** rather than hand-listed, because the old
     hand-list omitted exactly these two modules and `executionAbsence.test.mjs` therefore pinned
     no guarantee at all. That was the defect this correction exists to close.
   - **The guard inventory above is partially unverified.** Only the constants cited with line
     numbers were confirmed in this pass. A separate WS-7 task re-verifies every asserted gate
     against source before any live boundary is relied upon.
2. **Browser automation-signal stripping is RETAINED, and is disclosed here (WS-7 D22,
   2026-09-26; disclosure added 2026-09-27).** An earlier version of this line read "no behavioral
   camouflage against platform
   bot-detection", which the code contradicted. `browserBridge.mjs` launches real Chrome/Edge and,
   **by default** (`stealth = true`, `:323,335`), strips the automation signals it controls. The
   `if (stealth)` block at `:362-367` pushes `--enable-automation` off the default arg list
   (`:365`) and adds `--disable-blink-features=AutomationControlled` (`:366`) — **the latter is
   the flag that actually makes `navigator.webdriver` false**, per the code's own comment at
   `:363-364`. The stated reason is that so "there is no fingerprint to detect" (`:8`) and the
   page keeps "behaving exactly as it would for a human user" (`:11`). It can also import a real
   logged-in browser profile (`importRealProfile`, `:288,353`). This is signal suppression
   against bot-detection and is disclosed rather than denied; pass `stealth: false` to keep the
   raw signals. Separately: no humanized-typing by default — `PICC_HUMANIZE=1` is explicit
   opt-in for slow reads, never for deception. **Typing boundary (WS-7 D25):** PICC never types,
   clicks or submits into a broker without an explicit human approval step for that specific
   action (`interventions.mjs:52,277` — a write step runs only once `running.approved` contains
   its own index), and PICC never holds broker credentials (the typing path reads no
   credential-shaped value from `getCredentials()`; it takes only `riskPerTradePct`).
   **The dated disclosure record for this guardrail is
   `docs/trading-logic/changelog/entries/0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE-v1-to-v2.md`** —
   AC-015 requires this guardrail to LINK the record, not merely restate it, so an operator
   reading the product's claims can find the decision that authorised the capability.
3. **Every data source reports its own honest `source`/`status` label — never fabricate a number.**
   `absent → null`, never a fabricated `0`; `unconfigured ≠ zero-filled`.

**Positioning:** decision-support tool, not an automated decision-making system. Every AI output is
gated behind a mandatory human-review step. Verified current posture: **gated** trading execution
(two hard-capped venue rails, one ceremony-gated — see guardrail 1; explicitly **not** "no
execution"), clean payment-security surface, credential-at-rest vault, loopback-only container
exposure, shell-injection-free process invocation.

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
| Browser extension | **absent** — the extension era was removed end-to-end (D1); `apps/extension-archived/` is the retired Plasmo skeleton | 2026-09-27, `git ls-files` (0 hits for `picc-overlay` or `apps/dashboard/extensions`) |
| Test floor | **never shrinks below the latest verified count** | rule of record |

Historical suite-size milestones (context): 709/709 (PICC_FULL_SCOPE session) → 900/91 (T11 §E) →
1,391/127 (audit 2026-09-02) → 1,403/131 (remediation wave 09-03) → 1,525/143 (finalization
09-04) → 1,620/160 (strategy-program wave) → **1,622/161 (2026-09-05, incl. +2 localstore Windows
regression tests, commit `0d88992`)**.

---

## §3 System Architecture

### 3.1 Pattern

**Emulation & Overlay.** PICC simulates strategies in a sandbox and suggests actions; the user
always performs the final action on the external platform. "Neither the dashboard, the studio
browser, nor the agents can place orders, publish, or buy anything" — with the single carve-out
named immediately below.

**Approved carve-out — Command Centre slice 6 (§11.4/§11.5).** `ccxtOrdering` is the ONE
deliberate exception to that rule, and the ONLY `createOrder` caller in the process
(`ccxtConnector`'s read-only guard keeps every other module amputated). It exists solely to carry
the sanctioned `trading:ccxt` execution leg: the acting human's fresh per-action click is the
consent (carrier A — PICC places), the default remains carrier B (the human places, PICC verifies
read-only), orders are LIMIT-only and spot-only, never larger than the $10 envelope ceiling (the
seam REFUSES over-cap independently of the gate — it never silently shrinks), and there is still
no withdraw/transfer/leverage/cancel code path anywhere.

### 3.2 Layers

```
User → Dashboard (React 10 pages) ──same-origin /api/*──▶ Node backend (zero-framework ESM)
                                                        │   Yahoo Finance (no key)
                                                        │   CoinGecko (no key, crypto)
                                                        │   Hybrid cloud LLM (Gemini→Groq→Mistral→
                                                        │     Cerebras→OpenAI failover, no card)
                                                        │   Serper (live news/search)
│   Payments: Touch 'n Go |
                                                         │     BTCPay | Stripe (owner's wallet)
                                                        │   107 service modules · 100+ routes
                                                        │   (optional) CrewAI microservice :8000
Studio browser (real Chrome/Edge over CDP) ◀── read-only capture + metrics ──┘
External platforms (brokers, Amazon, YouTube…) — the user places; PICC's only order-capable path
is the consent-gated `ccxtOrdering` rail
```

- **Frontend** `apps/dashboard` — React + TypeScript + Vite on the local JSON data store
  (`localstore.mjs`); dark theme; Dashboard |
  Simulator | Trading | Streams | Agents | Opportunities | Income | Profile | Settings | Login.
- **Backend** `apps/dashboard/server` — Node ESM, no framework; `handlers.mjs` (~100+ routes) +
  96 → 107 services (was 87 top-level + 6 `brokers/`; commandCentre grew 3 → 11 this phase —
  `agentRoster`/`policyGraphCatalog`/`policyGraphValidator` from slice 1, `modeEngine`/
  `auditTrail`/`safetySidecar` from slice 2, `deliberation`/`metalearning` from slice 3,
  `commandCentreRuntime`/`commandCentreOverview` from slice 4, `commandCentreExecution` from
  slice 5, `ccxtOrdering` + `ccxtExecution` from slice 6);
  same-origin `/api/*` (Vite
  middleware dev, `server/index.mjs` prod).
- **External providers** — Yahoo (5y history, drift & vol), CoinGecko (crypto), LLM (honest
  failover; all-down → local engine), Serper (news/search), payments (4 paths).
- **Optional CrewAI microservice** `agents/picc_agents` — FastAPI :8000; crews: Research | Content |
  Listing | Trading | Investment (DeFi/Staking/NFT). Decision-support only.
- **Persistence is fully local** — `server/services/localstore.mjs` writes every collection the app
  used to write remotely to `server/data/<table>.json`, self-hosted; `auth.mjs:215` is a local
  verifier that "replaces the Supabase verifier". **The `infra/supabase/*.sql` files survive as an
  orphaned schema with no client** — no supabase package in either `package.json`, no client in
  `apps/dashboard/server` or `apps/dashboard/src`. The removal is recorded in `.env.example:8-10`
  and in several code comments as owner decision "D8", which is a **different decision** from the
  loopback-only-publishes D8 in §12.4; this paragraph is the record of record.
- **Browser extension — removed (D1).** `apps/dashboard/extensions/picc-overlay/` does not exist in
  this tree; the only extension present is the retired `apps/extension-archived/` Plasmo skeleton,
  and `/api/extension/*` is absent from the server. `extensionAbsence.test.mjs` pins that state.
  The passive sensor role moved to the studio browser's headless capture leg (§3.4).

### 3.3 Main server route groups

Twin `/api/twin/run` · Listing `/api/listing/analyze` · Content `/api/content/generate` · Agents
`/api/agents/run` · Trading
`/api/trading/*` (predict, paper, autopilot, decisions, assist, status, readiness, candles,
realtime, spread, portfolio, session-policy, capture-session, capture-config, headless-status,
account-metrics, health, ledger/stats, walk-forward, export, correlation, indicators, brokers,
feed-mode, paper/overview, models/explain) · Command Centre `/api/command-centre/overview|
kill-switch|orders` (orders family: GET list · POST propose · POST execute · POST verify) ·
Billing `/api/stripe/*`,
`/api/billing/ewallet/*`, `/api/btcpay/*` ·
Connectors `/api/connectors`, `/api/connectors/:slug/collect|history|stream` · Browser
`/api/browser/capture-session|metrics` · Data `/api/data/financial_accounts|transactions` ·
Health `/api/health`. **Two route families listed in earlier revisions of this document do not
exist: `/api/extension/*` (gone with the extension) and `/api/automator/*` (gone with the
bandwidth suite). The command-centre family has no `claims` or bare `execute` path either — the
live execute endpoint is `POST /api/command-centre/orders/execute`.**

### 3.4 Data flows (essentials)

- **Financial Twin** — ticker/capital/risk/horizon/simulations → Yahoo 5y history → real drift/vol
  → Monte Carlo projection → optional LLM commentary; unreachable Yahoo → `source: local` fallback
  labelled honestly.
- **Passive headless capture (what replaced the removed extension sensor)** — `captureProfiles`
  runs a per-source headless session engine (`ssid` via `captureViaStorageScan`) over
  `browserBridge` (CDP via playwright-core, `execFileSync` argument arrays only, login-once,
  read-only), and the read-only candles/balances it produces enter the normal feed paths
  (`liveEO` WS bridge + SSE relay, `liveCCXT` multi-exchange feed). Everything in the old extension
  contract — `inject.js`, `content.js`, `sanitizeUpstreamFrame`, `chromeGuard()`, the 120-frame
  batch, the 400-item offline queue, the 15 s `127.0.0.1`/`localhost` probe and the
  `/api/extension/ingest` endpoint — belonged to the deleted extension and exists nowhere in this
  tree.
- **Billing** — TnG manual
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
- **Bandwidth balance collection — reduced to one collector (ADR-0002).** The wider bandwidth
  suite (Honeygain, IPRoyal Pawns, Traffmonetizer JWT, Repocket, manual/desktop EarnApp,
  PacketStream), the `automator` and `automatorAdvice` service modules and the
  `/api/automator/*` route group were **rejected and removed end-to-end**;
  `collectors.mjs:2-3` records that the removal "left the CashPilot aggregator as the sole
  collector", and `PICC_BANDWIDTH_SUITE_design_v1` is REJECTED in §10. No JWT-expiry alert job, no
  30-min automator job and no auto-claim scheduler rows exist; nothing here ever moved money.
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

**Feed, data & preference (17):** `liveEO` WS bridge + SSE relay (5s-bucket cascade, viewed-asset
tracking, prune guard TTL 5 min / max 256 keys; studio + headless ingestion legs, `feed`/leg
provenance — `PICC_MULTISOURCE_ENGINE` T4) · `liveCCXT` multi-exchange feed, liveness-gated
connected · `ccxtConnector` read-only by contract (28 order methods structurally amputated) ·
`marketDataBus` unified candle bus: quality-ordered source resolution (liveness >
resolution-exactness > freshness > configured weight > latency), each response names the winner and
why (`source` / `sourceMode` / per-candidate `sources[]`), stored prefs force a source first and
fall through on emptiness — never a blackout · `chartPrefs` per-user stored source preference
(`chart-prefs.json`, registry-validated slugs) · `yahoo` / `crypto` / `dataSources` (per-session
source window + feed-status) / `serper` / `wsclient` / `indicators` / `patterns` /
`orderFlow` / `regimeDetection` / `sentimentEngine` / `economicCalendar` (static
`calendarSource:"fallback-schedule"` by design) / `marketIntel`.

**Brokers (registry + 3 adapters in `brokers/`):** `brokers/index.mjs` LiveBroker registry ·
`loader` (`brokers/loader.mjs`) · `yahooAdapter` · `ccxtAdapter` ·
`paperAdapter` (paper executor; Kelly sizing; risk cap; ATR/ADX stops; TP/SL auto-close;
Yahoo mark-to-market) · plus the out-of-`brokers/` `ccxtOrdering` rail, which **is**
order-capable. **Execution is NOT removed by design** (an earlier revision of this line said it
was, and the code contradicted that): two venue-capable rails are retained intentionally — the
consent-locked, hard-capped CCXT spot rail and the ceremony-gated Hyperliquid perps rail (§0
guardrail 1, §11.1 L1). The `ccxtConnector` read-only contract still amputates every order method
on every other module.

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
in-app browser (tab liveness via `studioLivePages`/`studioPageFor`) · `tradingSessions` (connect throws
unless `isDemo:true`).

**Income (6):** `connectors` · `collectors` (CashPilot is the sole bandwidth collector after
ADR-0002) · `assetCatalog` instrument canonicalization (canonicalAssetId/assetsEquivalent/yahooSymbolFor) ·
`yields` · `opportunities` · `watchlist`. **There is no `automator` and no `automatorAdvice`
module** — the bandwidth suite was removed end-to-end (§3.4, §10).

**Content & research (6):** `amazon` SP-API read-only competitor data · `keywords` · `prompts`
(versioned templates, see §21 patterns) · `llm` hybrid failover (LLM_PROVIDERS order) ·
`llmSettings` · `forecast`.

**Billing & payments (3):** `stripe` · `ewallet` · `btcpay` (metadata round-trip; tier
restricted to pro/business).

**Observability & UI data (8):** `health`-equivalent status surfaces via handlers ·
`realtimeSuite` fault-isolated statuses feeding dashboard chips · `tradingHud` · `suites` ·
`tradingCatalog` · `tradeJournal` (env `PICC_JOURNAL_DATA_DIR`) · `notificationCenter` (env
`PICC_NOTIFICATION_DATA_DIR`) · `notifier`.

**Persistence & infra (8):** `localstore` JSON tables, one serialized promise chain per store,
atomic tmp+rename with Windows EPERM retry + direct-write fallback (commit `0d88992`, see §12) ·
`vault` AES-256-GCM · `scheduler` staleness/liveness/uptime jobs · `rateLimit`
courtesy shared-budget limiter (see §20 known issue) · `browserBridge` CDP via playwright-core,
`execFileSync` argument arrays only · `analytics` · `autodetect` browser auto-detect · `models`
model registry. **There is no `supabase` module** — persistence is local JSON (§3.2).

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
| Login | local `auth.mjs` verifier (the hosted JWT verifier was replaced) |

Notable components: `CorrelationScreen`, `PortfolioAggregatePanel`, `FinanceTracker`,
`HoldingsEditor` (server-backed CRUD on the Overview tab), chart fullscreen, skeleton loading,
compact mobile tier (≤560px), `prefers-reduced-motion`, full ARIA semantics (D10). API layer
`src/lib/api.ts` with typed consumers; `finance.ts` rewritten against
`financial_accounts`/`transactions` via `localdata.ts`; live SSE consumption via
`subscribeTicks`/`useRealtimeSuite` (refcounted shared stream).

---

## §6 Browser Extension — REMOVED (D1), replaced by the Studio Browser

**No browser extension ships in this repository.** This section previously described a canonical
zero-dependency MV3 extension (`picc-overlay`) with a passive sensor contract. That is no longer
true, and the correction is recorded here rather than by deleting the history.

- **Absent from the tracked tree:** `apps/dashboard/extensions/picc-overlay/` does not exist, and
  neither does `apps/dashboard/extensions/`. The only extension present is
  `apps/extension-archived/` — the retired Plasmo skeleton, historical only. There is no
  "canonical" extension: `picc-overlay` was superseded by removal, not by a successor.
- **Absent from the server:** there is no `/api/extension/ingest|heartbeat|tab-changed|suggest|
  confirm` route group. `tab-changed` appears nowhere in the codebase.
- **Absent from the source:** `inject.js`, `content.js`, `sanitizeUpstreamFrame` and `chromeGuard()`
  exist only in prose and in `docs/archive/*`. The 120-frame batch, the 400-item offline queue and
  the 15 s loopback probe were part of that same deleted contract.
- **Enforced:** `extensionAbsence.test.mjs` pins 25 modules free of the extension era and fails
  the suite if `content.js`, `chrome.*`, "the extension", "extension feed" or "extension
  kill-switch" reappear. This is the D1 clean break, and the guard makes the absence a guarantee
  rather than a claim.
- **What replaced it:** the passive sensor role moved to the studio browser —
  `browserStudio` (in-app browser), `captureProfiles` (per-source headless session engine) and
  `browserBridge` (CDP over playwright-core), all read-only. See §3.4.
- **Superseded spec:** `EXTENSION_CONNECTIVITY_ENGINE` is SUPERSEDED (D1) in §10;
  `PICC_HEADLESS_CAPTURE_ENGINE` is COMPLETE with the extension leg removed (D1).
- **T11 status, preserved in full:** sections A/B (chart correctness at 1m/5m/15m/1h; feed-mode
  flip) **VERIFIED-MACHINE**; sections C/D (real-Chrome lifecycle; broker-tab drag)
  **UNVERIFIED-HUMAN** — T11 stays open until a human runs them against a live EO demo session.
  **The human leg (C/D) is NOT discharged.** Those checks were earned against the extension era
  and the T11 session record is not in this repository, so this slice cannot tell whether the
  obligation was correctly retired when the extension was removed or silently dropped. It is
  recorded here as still open, and retiring it is T11's call, not a documentation correction's.

---

## §7 Payments & Billing

Three paths, all behind the local `auth.mjs` verifier (the hosted Supabase JWT verifier was
replaced; there is no hosted auth), money to the owner's own wallet (no bank account, no business
registration):

1. **Touch 'n Go e-wallet (manual)** — order returns amount/instructions/`PICC-XXXX` ref; receipt
   self-confirm; owner-scoped; `selfApprove` only in single-owner/no-accounts demo mode (D3).
2. **BTCPay** — self-hosted, no KYC; invoice metadata `{userId, tier}` round-trip (D4); local node
   bundled at `127.0.0.1:23000`; Oracle VPS mainnet option **abandoned** (region denies Always
   Free) — mainnet runs on own PC (`NBITCOIN_NETWORK=mainnet`, prune=50000, assumevalid v29.2
   block 886157).
3. **Stripe** — checkout + webhook → profile sync via service-role; `stripeCustomerForUser()`
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
TRADE, never force one; TRADE verdicts enqueue PAPER proposals (`source:"trade"`). Served candles
carry honest `feed` provenance (studio/headless/liveEO legs and broker slugs —
`PICC_MULTISOURCE_ENGINE` T4), never a fabricated `candleSource`.

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
| ~~ExpertOption~~ | **REMOVED 2026-09-29 (WS-7 D2)** | was demo-only (read-only bridge); unofficial WS protocol; unregulated EOLabs LLC, St. Vincent & Grenadines; connector never robust. Deleted outright rather than kept as a recorded-but-hidden row — see the WS-7 T2 changelog entry for the measured blast radius. |
| CCXT exchanges | market data read-only | sanctioned automation exists via official protocol — first real-money candidate |
| IQ Option / Quotex / Olymp / Deriv | session capture only, no execution | capture report carries no revive/live-bridge field, so there is nothing to restart |
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
- **Bandwidth collectors** as in §3.4 — CashPilot only, after ADR-0002 removed the wider suite and
  the `automator` module.
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

## §10 Specs Registry (39 files in `docs/specs/`; 41 registry rows)

> **Counted 2026-10-02 (WS-7 T21).** The file count is `git ls-files "docs/specs/*.md"` = **39**
> (was `35`). The row count follows the rule already documented and enforced by
> `ws3CeremonySeamGuard.test.mjs:357-369`: table rows in this section, minus the header, the
> separator, and the one `notes/` path row (which is a note, not a registry spec) = **41**.
> The bolded `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1` row **is** a registry row and is counted.

> Statuses are as stamped in each spec header, cross-checked **2026-09-19** (older-spec resolution
> pass: every non-trading-logic spec received a `Resolution:` disposition). Checkboxes inside specs
> are aspirations until a test is green (§1). Trading-logic specs (MTF, U4FA, MULTISOURCE) are the
> v3.2 rebuild's lineage and were deliberately left **untouched** pending the rebuild execution.

| Spec | Resolution (2026-09-19) | Successor / note |
| :-- | :-- | :-- |
| **PICC_V3_2_LAYERED_ENGINE_REBUILD_v1** | ACTIVE — Draft for execution (new) | v3.2 rebuild; supersedes U4FA decision path; see ADR-0003/0004 |
| COMMAND_CENTRE_WEB_SPEC | ACTIVE | slices 1–6 landed; slice 7 (ExpertBot demo + expansion docs) queued (§11 here) |
| EXTENSION_CONNECTIVITY_ENGINE | SUPERSEDED | extension clean break (D1) → Browser Studio |
| MTF_CONVERGENCE_ENGINE | ACTIVE (trading logic — untouched) | reference registers during v3.2 soak |
| NEXT_WAVE_generalization | COMPLETE | slices 1–6 + DoD closed; 7f closed forever |
| PICC_ALGORY_FINDINGS_v1 | RESEARCH-ARCHIVE | static findings; consumed by suite borrow-list |
| PICC_ALGORY_REVERSE_ENGINEERING_v1 | COMPLETE | delivered as FINDINGS v1 |
| PICC_BANDWIDTH_SUITE_design_v1 | REJECTED | ADR-0002 struck; removed end-to-end |
| PICC_EARNINGS_AGENTIC_MINISTRY_v1 | ACTIVE | §9 answered; Phase A/B gated on v3.2 trust |
| PICC_EMBEDDED_BROWSER_STUDIO_v1 | COMPLETE | Phase 0/A/C landed; B human-gated |
| PICC_EXPLICIT_AUDIT | COMPLETE | A1–A8 closed; ledger absorbed into `PICC.md` |
| PICC_EXTENSIONS_RESEARCH_v1 | RESEARCH-ARCHIVE | static findings; consumed by D1-era work |
| PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1 | COMPLETE | Phase A/B shipped; Phase C deferred to future spec |
| PICC_FRONTEND_RESKIN_execution_handoff | SUPERSEDED | handoff executed; reskin closed |
| PICC_FRONTEND_UI_ENGINE | COMPLETE | U1–U6 closed |
| PICC_FRONTEND_UI_RESKIN_execution_handoff | SUPERSEDED | handoff executed; reskin closed |
| PICC_FRONTEND_UI_RESKIN_resume | SUPERSEDED | handoff executed; reskin closed |
| PICC_FRONTEND_UI_RESKIN_v1 | COMPLETE | T1–T12 verified on disk |
| PICC_HEADLESS_CAPTURE_ENGINE | COMPLETE | T1–T13 landed; extension leg removed (D1) |
| PICC_INCOME_GENERALIZATION_checklist_v1 | COMPLETE-as-filed | T1–T13 executed; T14/T15 user-gated |
| PICC_INCOME_GENERALIZATION_design_v1 | COMPLETE | executed via checklist |
| PICC_INCOME_GENERALIZATION_requirements_v1 | COMPLETE | absorbed into design+checklist |
| PICC_MULTISOURCE_ENGINE | ACTIVE (trading logic — untouched) | data-source honesty for the v3.2 rebuild |
| PICC_NOTIFICATION_AND_ALERT_UX_v1 | COMPLETE | T1–T10 landed |
| PICC_PACK1_LOCAL_TRADING_CORE_v1 | COMPLETE | S0–S5 landed; S6 live-gate manual |
| PICC_RESOURCE_GOVERNOR_v1 | COMPLETE | G1–G5 landed |
| PICC_SESSION_POLICY_AND_CHANNEL_CATALOG | COMPLETE | delivered; checklist all [x] |
| PICC_SIGNAL_VENUE_POOL_DECISION | COMPLETE | narrow-to-liveEO-verified executed |
| PICC_STUDIO_SIMPLIFICATION_AND_SOURCE_LANDING_v1 | COMPLETE | executed via D1 clean break |
| PICC_SUITE_MINISTRY_MODEL_v1 | PASSED-INTO-IMPL | executed slices landed; governance slices VOTED-SAVE |
| PICC_TRADING_SITES_CATALOG_v1 | ACTIVE | venue/source source-of-truth; §6 C1–C4 + §4 unshipped |
| PICC_TRADING_SUITE_REBUILD_v1 | SUPERSEDED | Phase B landed; decision core → v3.2 rebuild |
| PICC_TRADING_SUITE_UPGRADE | SUPERSEDED | P1 delivered; P2/P3 → reskin + v3.2 |
| PICC_TRADING_SUITE_WS1_LIVE_ORDER_LIFECYCLE_v1 | ACTIVE | WS-1 perps live order lifecycle: T1–T9 landed; HL adapter testnet-first + real-testnet sandbox E2E (plan §5) |
| PICC_TRADING_SUITE_WS2_RISK_AND_DRAWDOWN_ENFORCEMENT_v1 | ACTIVE | WS-2 risk & drawdown enforcement: T1–T8 landed (risk gates 16–19, aggregate day-loss, MDD size-step/hard-stop, portfolio heat, halt persistence, consent payload-lock, spread seam fail-closed, 5-of-7 pillar gate) |
| PICC_TRADING_SUITE_WS3_VALIDATION_AND_UNLOCK_CEREMONY_v1 | ACTIVE | WS-3 validation & unlock ceremony: T1–T8 landed (persistent ceremony store + ledger provenance seam, trading-day primitives, gate evaluators, readout route, perps mainnet branch unlocked only via the store, unlock-ceremony UI, seam guard) |
| PICC_TRADING_SUITE_WS4_COPYTRADING_IDEA_SOURCING_v1 | ACTIVE | WS-4 copytrading idea sourcing: T0–T7 landed (follower store, feed contract + registry, qualification 300/15/positive-expectancy, CSV import + manual lanes, on-read auto-unfollow + 7d stop, platform-trust flag, readout route + read-only panel, seam guard) |
| PICC_TRADING_SUITE_WS5_BREADTH_OPERABILITY_HARDENING_v1 | ACTIVE | WS-5 shipped (`5abb151`, 16 commits, pushed to `origin/master`). T0–T5 landed (`playwright.config.ts`; `e2e/helpers/isolatedEnv.mjs`; `e2e/*.spec.ts`; `startupHealth.mjs` + `handlers.mjs`/`index.mjs`; `dangerousActionLock.ts` + 3 call sites; `AutopilotSuite.tsx` + `TradingSuite.tsx`/`AutopilotRoom.tsx`; tests; package metadata; `.env.example`; operability runbook + Hyperliquid pointer). `ws5SeamGuard.test.mjs`. Final floor 281 files/3133 tests + typecheck + `verifyAudit()` + `test:e2e` 4 passed observed green. AC-4c two-real-tab lock matrix remains manual/unverified. Three ratified claims (AC-3a, AC-8b, R1.2) were factually wrong and are recorded as honesty notes 11–13. |
| PICC_TRADING_SUITE_WS6_TERMINAL_UI_REBUILD_v1 | ACTIVE | WS-6 T0–T12 landed. Strangler migration (legacy suite remains the fallback; no room promoted to full parity yet). T0 baseline + room-key/singleton freeze; T1 typed contracts + dependency manifest (**zero new runtime dependencies**); T2 deep-link adapter + reserved RoomFrame + room-key parity guard; T3 venue-integrity conflict detector, secret redaction, copilot contract, realtime normalization, StatusBoundary, CopilotPanel, useTerminalSnapshot; T4 D10 session routing + separated expectancy/procedureDrillScore + server/client parity fixture; T5 DenseTable (10k rows, bounded DOM); T6 incremental chart planner; T7 palette contract (no `cmdk`, fails closed); T8 reduced-motion + MotionValue; T9 safety seam guard (17 guards) + blueprint provenance + supersession changelog; T10 throttled perf harness; T12 final seam guard (18 guards). Floor 302 files / 3383 tests, typecheck, e2e 5, audit chain all green. **Residual, carried deliberately:** `ARM64: UNVERIFIED` (throttled x86 proxy cannot validate ARM64 — performance gate closed, architecture gate not); `Blueprint v4.0 provenance: UNVERIFIED` (document not in repo); **room-transition budget BREACH** (1230ms p50 / 2139ms p95 vs 250ms at 6× throttle, legacy surface); 4 of 6 budgets `UNMEASURED` pending T5/T6 room promotion. No live venue is wired. |
| PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1 | ACTIVE-DRAFT | WS-7 spec authored 2026-09-25; **every owner decision resolved 2026-09-26 — zero open items remain**; **T0–T13 and T15–T16 have landed** (T0 `09125f8`, T1 `1fea406`, T2 `916a782` = room-transition decomposition, T3 `b78f5a2`, T4 `510428c`, T5 `5620b60`, T6 `4078812`, T7 `857443e`, T11 `a4fac35`, T12 `8ff9e63`, T13 `c8896f4`, T15 `7e31265`, T16 `f1567ef`), together with the room work T8–T10 (`1fd792b`, `a1b4532`, `305a334`), the two reconciliation slices T7R-A/T7R-B (`e9c8137`, `99b9960`), the §0.3 amendment `42dfaac`, the route-auth discharge T20R (`6eea89d`), T19 (`80c9659`) and T20 (`139531e`; **BS-2 and BS-3 are closed, BS-4 is in progress at T21**) and the 2026-09-26 paper-only amendment is already in guardrail 1. **Corrected 2026-10-02 by T21 (measured, not asserted):** this row previously read "T0–T7 and T11–T16 have landed … T14 is the next open task", which was true when T7R-B wrote it and stopped being true at `1fd792a`; it also listed "T11–T16" as landed while T14 has never had a commit. T21's seam guard now measures this from `git log --format=%s --all` rather than from prose: a task with no commit subject naming `WS-7 <task>` has not landed, and at T21's measurement "T14, T17 and T18 have not" (`ws7-tasks-without-a-commit`, 3 of 21). **T14, T17 AND T18 HAVE SINCE LANDED (changelog entries `0036-T14_NOTIFICATIONS_TELEGRAM_WEBPUSH`, `0038-T17_CCXTVENUE_LIFECYCLE` and `0039-T18_DATA_SOURCES`), so the live claim is now NONE — the guard's measured `ws7-tasks-without-a-commit` list is `[]` (0 of 21) and the guard's own exact-list assertion was moved to match, because a check loosened to a count would also pass if the probe stopped reporting a task at all**. **The §10 heading's row count was stale, not this row:** it read `41 registry rows` while the table holds **42** rows including one `notes/` path row that WS-3's guard has always excluded, so the spec-row count really is **41** and the heading was already correct. **T21 got this backwards twice and the record is kept.** T21 first recounted 41 by skipping the bolded `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1` row (which IS a registry row), then "corrected" the heading to 42 by counting the `notes/` row — contradicting `ws3CeremonySeamGuard.test.mjs`, which failed loudly and named the rule. The final state adopts WS-3's already-documented counting rule rather than a second, competing definition; the mistake is recorded because a count that two guards disagreed on is a count a reviewer must check by hand. **Corrected 2026-10-01 by T7R-B:** this row previously read "T0–T4 have landed … T5 in progress", which had been false since `4078812` and gave a reader a false picture of the workstream; plan §4 names it as a downstream record that goes stale independently of the rooms. **The T0 mechanism shipped:** `server/scripts/absence-scope.mjs` discovers the absence scope from the filesystem and `executionAbsenceScope.test.mjs` guards it, so a new order-capable module can no longer slip past by simply not being listed. `executionAbsence.test.mjs:27-38` still holds a hand-maintained `SUITE_SOURCES` list, but that list is now a complement to the discovered scope rather than the only scope — an earlier revision of this note said the test "pins **no** guarantee", which overstated the remaining gap. **D2 ExpertOption removal LANDED 2026-09-29** — `services/expertoption.mjs`, `services/brokers/expertoption.mjs`, `services/liveEO.mjs`, the EO capture/liveness/execution exports, the four EO endpoints, the `streamCatalog.ts:125` catalog row, the 10→9 profile rows in `captureProfiles.mjs`, and the gitignored browser-profile artifact are all gone, and `executionAbsence.test.mjs` now lists nine modules rather than ten. The seam guard `ws5SeamGuard.test.mjs` was amended in SEMANTICS, not value: a deleted frozen path is exempt by existence, and a surviving frozen path is allowed only if its capability surface (registry `id`s, exported bindings, import specifiers) does not grow relative to the WS-5 baseline. **D19 RESOLVED as outcome (B):** `PICC.md:25-38` is amended to describe the gated, consent-locked, hard-capped rails, and the guard's coverage becomes machine-discovered; working order-lifecycle code is **not** deleted (a guard that tests what exists beats a documentation claim that is false). **D21 RESOLVED — and then SUPERSEDED (see the residual block below):** the ARM floor tier was ratified at **~1800 ms p95** (derived from the 7.18× ratio; 250 ms × 7.18 ≈ 1795) with **250 ms retained explicitly as an x86-only tier**; B1 (1230 ms p50 / 2139 ms p95 at 6× throttle) stays a **KNOWN BREACH** — breaching the x86 tier by 8.6×. **Corrected 2026-10-02 by T21:** this clause previously ended "and exceeding the new ~1800 ms ARM figure — and the direct on-device ARM room-transition sample is still owed at T19". Both halves are now superseded: the ~1800 ms figure was **withdrawn as unsound**, and T19 has landed with **no ARM64 device available**, so the sample is not "still owed" but **UNVERIFIED and unobtainable on this host** (`arm-probe.json` records `host.isArm64: false`). Nothing was fabricated to close it. **D2 removal APPROVED 2026-09-26, LANDED 2026-09-29:** ExpertOption was removed entirely (12 unofficial WS endpoints, formerly `expertoption.mjs:22,36-47`; 4 dead call sites with 0 definitions — `ensureSession`/`getDemoSession` referenced but defined nowhere, callers swallow the throw; `executionAbsence.test.mjs` now lists nine modules, its EO entry removed in the same change as the spec's bisect note requires). The removal cost no working order capability, because those paths were already dead. **D23:** T3 **LANDED 2026-09-29** and the adapter now exports a real gated `cancelOrder` (`hyperliquidPerps.mjs:567`, exported at `:618`, gated by `modeOf()` before any venue instance is built). The guard was corrected **additively** — `"cancelOrder"` stays in `ccxtConnector.mjs`'s `READ_ONLY_BLOCKED` for non-seam modules and a positive seam assertion was added, and `ccxtConnector.test.mjs:299` keeps throwing; master contract `SEAL_ALL_GAPS_v1.md:42` is amended. **Corrected 2026-10-02 by T21:** this row previously read "adapter `:546-557` has 0 × `cancel`, so an open position is un-exitable through production today", which described the pre-T3 state. Guardrail 1's own perps bullet carries the same pre-T3 wording and is corrected there by this task. **D22/D25:** browser automation-signal stripping is **retained as an explicitly disclosed policy** (`browserBridge.mjs:10-11,323,362-367,288,329`) with **§0 guardrail 2** rewritten to disclose it in full. **Corrected 2026-10-02 by T21:** this row said "`PICC.md:30-31` is the stale pointer this row used to carry", which was true and is now moot twice over — post-D19 those lines are the guardrail-1 rails table, **and guardrail 2 now LINKS the dated record** `docs/trading-logic/changelog/entries/0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE-v1-to-v2.md`, which AC-015 requires and which nothing had checked for. The typing invariant is amended to the real boundary — never without per-action human approval (`interventions.mjs:52,277`), never holding broker credentials (the false "never clicks or submits" claim is at `browserStudio.mjs:1752`, **not** in the extension-eradication spec, whose `:147` already says "human-approved only"). T4 security also covers wildcard CORS + plaintext LLM key (`agents/picc_agents/server.py:106-107,70,79-80,164`) and the `profile.mjs:20` token at rest. **D24:** lockfile is **npm only** — `apps/dashboard/pnpm-lock.yaml` (0 × ccxt/playwright/web-push) is deleted, since CI already consumes the root lockfile. **D26:** unverifiable third-party regulatory claims are **deleted** (SC/DAX licensing for 8 entries at `streamCatalog.ts:42-47,63-65`; OANDA "no KYC for demo" at `browserStudio.mjs:505`). **Corrected 2026-10-02 by T21:** this row previously ended "— entries stay, claims go". The claims half is true and measured; the **entries half is false** — T7b removed all eight rows under D20 record `0019`, so "entries stay" is contradicted by a later decision and D26 is **unsatisfiable as written**. T21's gate therefore reports `catalog.claims-gone-entries-stay = FAIL` on its second half. This is a **specification contradiction needing an owner ruling** (amend D26, or restore the rows), not an implementation defect; it is recorded in `0035-T21_FINAL_WS7_SEAM_GUARD-v1-to-v2.md` §3.3. **D27:** all 22 room instances COMPLETE in order, each **flagging** any WS-8 boundary rather than silently trimming (two are honestly `incomplete`: `STRATEGY_COMPLETION` is a reserved placeholder and `trading/simulator`'s Financial Twin is write-only). T11–T13 deterministic Copilot (6 experts, 3 tiers, 6 vetoes, C1/C2/C3 as tests) with a digest-pinned, pickle-free model layer; T14–T18 notifications, retention, authority, 4-venue CCXT lifecycle, data sources (**T14, T15 and T16 of these landed; T17 and T18 have not**); T19–T21 2 GB RAM CI gate, cross-room invariant gate, the final WS-7 seam guard, single batch push. **27 decisions · 49 ACs · 22 tasks.** **Residual/UNVERIFIED:** ARM probe numbers (p50 0.84 / p95 4.47 / max 7.71 ms jitter; `bench_ms` 3012.39 vs 419.48 = **7.18× slower**; `bench_checksum=2095.419` identical) are owner-supplied from `scripts/arm-probe.mjs` (committed `c407964`); the **output artifact IS now checked in** at `apps/dashboard/perf/arm-probe.json` (T19, `80c9659`), and it records `host.isArm64: false` — **no ARM64 device was attached on this host**, so B9 stays `UNVERIFIED` and **no ARM figure may be fabricated**. T19 also **re-derived the ratio and did not reproduce it**: this host measures `bench_ms` 644.97 against the relayed 419.48, i.e. ~4.67× rather than 7.18×, so a CPU-only ratio that varies by host cannot be carried onto a render-bound transition budget. Consequently **D21's supersession governs over AC-045**: the ~1800 ms ARM figure was **WITHDRAWN as unsound** and B2 carries `WITHDRAWN_UNMEASURED`, not a ratified budget (spec `:277-308`). B1 and B3 remain **BREACH** and B1 is not rescued by the re-baseline (1230 ms p50 / 2139 ms p95 at 6× throttle, breaching both the x86 250 ms tier and the withdrawn ARM figure); **B10 is measured** — `apps/dashboard/perf/ram-ceiling-gate.json` records peak **372.1 MB** against a frozen 2048 MB ceiling, verdict `pass`, 17 samples — so "2 GB peak-RSS has no verdict (gate does not exist)" is superseded; B4/B7/B8 are `UNMEASURED`, B5/B6 `pass`, B11 `UNVERIFIED`, B12 `PARTIAL_VERIFICATION` (checksum identity corroborated, the 7.18× ratio contradicted). All twelve verdicts are in `apps/dashboard/perf/budget-verdicts.json` and re-derivable by `scripts/perf-budget-verdicts.mjs`. Needle 3 vendor claims **UNVERIFIED**; ONNX/llama.cpp ARM64 availability **UNVERIFIED**; Copilot blueprint v4.0 is owner-supplied, not a repo artifact; all owners are the literal `WS-7+` reservation. **T21's three blocking findings** (the gate exits 1, and that is the finding, not a bug): 28 venue identifiers survive in comment-stripped production code across eleven files, one of which — `scripts/capture-eo-session.mjs` — imports the `captureExpertOptionSession` that T2 deleted and therefore cannot run; `plasmo` is declared in `apps/extension-archived/package.json` with no importer; and D26's second half ("the eight catalog entries remain") is unsatisfiable as written because T7b removed those rows under D20 record `0019`. **T21's full record is `0035-T21_FINAL_WS7_SEAM_GUARD-v1-to-v2.md`.** **Corrected 2026-10-03 by entry `0040` (measured, not asserted): T21's three blocking findings are now ONE.** The first two are **DISCHARGED** — `venue.expertoption-residue` measures **0** and `deps.no-unused-dependency` measures **0** — so the gate's live failures are `catalog.claims-gone-entries-stay` alone, still at `1` and still needing an owner ruling. What was removed, and why it was residue rather than record: the 28 surviving identifiers were all **comment-stripped live code or live string literals**, and `stripComments` had already been separating them from the several hundred `D2/AC-005: … REMOVED` records correctly (which is why `services/trading.mjs`, `commandCentre/policyGraphCatalog.mjs` and `services/proanalysis.mjs` measured **0** despite holding 18 raw mentions between them). Removed: the `expertoptionToken` credential field (`venueCredentials.mjs`), the EO connector row (`connectors.mjs`), the EO `SITE_INDEX` row / `PLATFORM_KINDS` entry / `SITE_TO_CONNECTOR` mapping / login-account branch / `isLiveStreamTab` freeze-exemption (`browserStudio.mjs`), the `p1-1` `hasCredentials` gate (`scheduler.mjs` — omitted rather than `false`, which `envelopeGate`'s `gates.hasCredentials !== true` makes identical), the credential read and the now-unreachable `running` branch of `observeEoCapture` (`packObservers.mjs`), the three `expertoption*` fields of `TradingCredentials` (`src/lib/trading.ts`), the EO credential panel (`AutopilotSuite.tsx` — its `demo.configured` guard already read a field `demoStatus()` stopped emitting), and the `"expertoption"` source branches in `TradingChart.tsx` / `SourceBadge.tsx` / `DataSourcesPanel.tsx`. `scripts/capture-eo-session.mjs` is **deleted**, not emptied: it imported `captureExpertOptionSession`, which T2 removed, so it could not run. Every removal record survives. **`plasmo` was removed from `apps/extension-archived/package.json` because that app is dead and tracked as dead** — `README.md:25` lists "Plasmo (unused, historical)", `PICC.md:130`/`:730` call it "the retired Plasmo skeleton", the extension era was removed end-to-end (D1), it is **not** an npm workspace (`package.json` `workspaces: ["apps/dashboard"]`), and `plasmo` appears in neither `package-lock.json` nor `node_modules` — so it was never installed and nothing can need it. The archived tree itself is **retained** (`importResolutionGuard.test.mjs:324` pins `extension-archived/src` as present, and `ws7RegulatoryClaimGuard` allowlists `content.tsx`); only the declaration is gone, which takes `declaredRuntime` 12 → 11. The other 11 dead EO scripts under `scripts/` are **UNTOUCHED and still tracked**: none of them is measured (`studioGoto("https://app.expertoption.com/")` is a URL, not one of the vocabulary's three shapes) and none is provably unrunnable the way `capture-eo-session.mjs` was, so deleting them is an owner call, not this entry's. Unit floor **5371 → 5373** (net +2; four `observeEoCapture` "running"-state tests were replaced by assertions that the terminal state is `stopped-at-human`, and six EO-subject tests across six files were re-pointed at surviving venues rather than deleted). `0040`'s full record is `0040-EO_RESIDUE_AND_UNUSED_DEPENDENCY_DISCHARGE-v1-to-v2.md`. T21 surfaced **28 open changelog handoffs of 34 table rows** (entries 0028, 0032 and 0035 — the last being this task's own six) as a non-blocking open item; the owner's figure of 15 reconciles to neither 28 nor 34 and is recorded as an open discrepancy (`0035-4`), not silently adopted or dropped. **The 2026-09-26 round produced no implementation — spec and this row only; no breach became a pass and no `UNMEASURED` became measured.** No live venue is enabled. |
| PICC_UNIVERSAL_4FA_ENGINE | ACTIVE (trading logic — untouched) | decision path retires under ADR-0004; legs re-homed |
| notes/B-IND-0-current-engine-coverage-2026-09-19 | ACTIVE (inventory) | authoritative engine inventory for the v3.2 rebuild |

> **Delete-zone** (see ADR-0002): `PICC_BANDWIDTH_SUITE_design_v1` is struck — recreate only via a
> new ADR after evidence the segment is profitable. Extension-era concept docs (CONNECTIVITY,
> EXTENSIONS_RESEARCH, ALGORY, explicit-audit ledger) are disposition records, not live contracts.

---

## §11 Command Centre Web — Design of Record (spec committed `018025b`, absorbed here)

**Status: ready-for-agent (living spec — continuously improved through implementation); §11.5
slices tracked in the spec doc.** Slices 1–4 (catalog + validator + roster registry; mode engine +
safety sidecar + audit trail; deliberation layer + metalearning tuners; Command Centre surface —
per-stream command cards, 10-gate safety rail, real engine verdicts, kill-switch UI wired to the
runtime store) and **slice 6** — the FIRST live execution leg, the sanctioned `trading:ccxt` order
rail, running the full 10-gate chain and executing on FRESH per-action human consent (`consentBy`),
never a standing opt-in — landed as part of this
repo's current phase — see §21 Open work. **Slice 5 landed in part; only its bandwidth
payout-claims surface did not.** What slice 5 did ship is real and stays attributed to it:
the L1 execution seam module `commandCentre/commandCentreExecution.mjs` (§3.2), the power-aware
sidecar gating (proposals carrying `power` + `consentBy`; gate 4 and gate 7 semantics in
`safetySidecar.mjs`), and the observed `executionLeg` field on the overview row
(`commandCentreOverview.mjs:302`). What did **not** ship is the claims surface those pieces
were built to serve: `payout_ready`, the "bloodstream" block, `claimPayout`, the
`bandwidth:claim:` idempotency key, `claimWorkflowId`, `GET /api/command-centre/claims`,
`POST /api/command-centre/execute`, and the panel's "Approve & claim" button. No bandwidth
auto-claim scheduler runs. The
approved architecture for the risk-backed autopilot/copilot command surface. Approach C:
policy-graph + blackboard deliberation + Mode Engine + safety sidecar, with metalearning and
self-improvement baked in.

### 11.1 Layered design (L6 → L0)

- **L6 UI** — Command Centre Web surface (observability + risk-backed gating). Slice 4: one
  shared `CommandCentrePanel.tsx` mounted per stream (trading + bandwidth) — per-site command
  cards with the REAL engine verdict (`renderVerdict` over observed inputs only), a full 10-gate
  safety rail in the sidecar's gate order, and a kill-switch header + per-site toggles that read
  and write the SAME runtime store the enforcement layer consults (a throwing reader denies; an
  unreadable store boots fail-safe). Every cell is observed state or an explicit "not-wired —
  arrives with execution (slice 5+)" label; sync-approval is NOT an automation opt-in.
  Slice 5 did NOT land as described: the bandwidth card's `executionLeg`
  (`commandCentreOverview.mjs:302`) is the **CCXT/perps order leg** (`leg.power` / `leg.action` /
  `inFlight` / `lastExecutedAt`) — there is no bandwidth claims leg. The proposed "bloodstream"
  payout-claims block — scheduler `payout_ready` rows with claimed/ready badges, an
  "Approve & claim" button, and a `POST /api/command-centre/execute` endpoint — was **not built**;
  the live execute path is `POST /api/command-centre/orders/execute` (`handlers.mjs:1993`), whose
  outcome (executed / failed / blocked) renders back on the card exactly as observed.
- **L5 Mode Engine** — per-site risk-backed verdict over exactly five modes:
  `BLOCKED` (executionPower `none`) | `HOLD` (`none`) | `COPILOT` (`proposals`) |
  `AUTOPILOT_DEMO` (`liveDemo`) | `AUTOPILOT` (`live`); deterministic 7-step fixed decision
  order (kill switch → opt-in → breakers → freshness/HOLD → 5C truth table → workability →
  deliberation → advisory), chosen by site risk, never by convenience. **Workability is the one step
with no deterministic scorer wired:** `commandCentreOverview.mjs:291-293` feeds a conservative `0`
with the note "deterministic workability scorer not-wired — conservative 0 fed to the engine
(slice 5+)", and `modeEngine.mjs:41,134-135` caps anything below `AUTOPILOT_WORKABILITY_FLOOR`
(0.5) at COPILOT. On the live surface that floor is currently *supplied* rather than *earned* — the
engine logic is real, the deterministic scorer behind it is deferred. Advisory/supervisory
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
  deterministic, idempotent primitives. One proposal rail, TWO carriers (slice 6):
  **carrier A** — PICC places the order on the acting human's fresh per-action click
  (envelope-capped, limit-only, spot-only; sanctioned `trading:ccxt` only, after the FULL
  10-gate chain at click time); **carrier B — the default** — the human places it on the
  exchange herself, PICC verifies the fill READ-ONLY, never fabricating an unobservable one.
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

Global kill-switch (runtime store `commandCentreRuntime.mjs`: global dominates per-site; every
flip audited 5A; an unreadable store file boots with the GLOBAL KILL ON — fail-safe deny) ·
per-site opt-in · hard breakers · full append-only audit · **5A** execution-
power separation · **5B** interrupt/takeover · **5C** credential/ToS-survival · **5D** hard
exposure ceiling · **5E** stale-data forced downgrade (never trade on stale input) · **5F**
rationale-before-act (no action without a stated reason) · **5G** idempotency (no double-fill) ·
**5H** LLM downgrade-only (an LLM can downgrade an action, never upgrade past deterministic
bounds). Slice 5 adds power-aware gating in the sidecar: every proposal carries `power`
(`none|proposals|liveDemo|live`) + `consentBy`; gate 4 requires a STANDING opt-in for
live/liveDemo but only FRESH per-action consent for `proposals` (consent ≠ automation opt-in),
and gate 7 restricts by catalog stance (forbidden→demo-only templates, gray→proposals only,
sanctioned→live/proposals, `none` denied). The claims leg is `proposals`-powered and executes
only on fresh consentBy; AUTOPILOT (`live`) remains CCXT slice 6 — no standing opt-in exists.

### 11.4 First real-money slice (user decision)

- **Scope:** CCXT (platform-sanctioned automation, official protocol) + bandwidth browser
  auto-claim via `interventions.mjs` — **first**.
- ~~**ExpertOption stays demo** + ExpertBot pattern now; live deferred~~ → **ExpertOption is
  removed entirely** (WS-7 D2, owner-approved 2026-09-26, landed 2026-09-29). The connector was
  never robust (unofficial WS protocol, unregulated venue — recorded in the venue truth-table
  §8.6, never hidden), so the decision was removal rather than deferral, and the ~1800 ms ARM
  budget work in the WS-7 spec is unaffected: it is derived from the room-transition path, which
  never depended on the EO feed.
- **Envelope = the financial minimizer:** max $10 single exposure · max 2 concurrent live units ·
  −5% daily loss. The envelope is PICC's tightest, deterministic bound — it may never exceed it,
  and it is raiseable via config **only within the floor**.

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
    ExpertOption ExpertBot pattern (demo) + expansion docs/checklist → **DROPPED 2026-09-29 (WS-7
    D2: the venue is removed, so slice 7 is withdrawn rather than deferred)**. **Slice 7 is not the
    end** — expandable one-by-one via the catalog.

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
| F1 | Plasmo duplicate tree | archived as `apps/extension-archived`; there is no canonical extension — the extension era was removed end-to-end (D1) |
| F2 | stale overlay-era background | closed by removal: the overlay-era background and its sensor chain are gone with the extension (D1), and `extensionAbsence.test.mjs` pins the absence. **The closure citation previously given here, `e2eExtensionFeedChain.test.mjs`, names a file that is not in the tracked tree and never was in this repository's history of this doc — there is no such test.** |
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
feature lands with tests; security-review on sensitive paths; no withdrawals. (Browser
automation-signal stripping is retained and disclosed — see guardrail 2, not a "no camouflage"
claim.) Open questions from the research session (from the doc) remain open pending owner
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
owner) · ~~ExpertOption as binary executor (demo live)~~ → **removed 2026-09-29 (WS-7 D2)**. Wave 2:
MetaApi (MT4/5), OANDA v20 practice,
Alpaca paper, IBKR Client Portal (all planned, none built). Wave 3: Quotex/IQ Option/Olymp/Deriv
(capture live; execution blocked on tapped protocol) · TradingView HMAC webhook receiver (planned
route `/api/trading/signals/incoming`). Out of scope: ToS-violating automation **beyond the
disclosed automation-signal stripping in guardrail 2**, which D22 retains deliberately; and
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
- **Browser automation-signal stripping is retained, disclosed, and default-on**
  (`--disable-blink-features=AutomationControlled`, which is what clears `navigator.webdriver`, plus
  `--enable-automation` off the default args, `browserBridge.mjs:362-367`; `stealth = true`
  at `:335`, pass `stealth: false` to disable); **no humanized-typing by default** —
  `PICC_HUMANIZE=1` is explicit opt-in for pacing, not deception. See guardrail 2 and §16.1.
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
- **Persistence: nothing to configure.** The hosted database variables
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) were removed from
  `.env.example` with the hosted layer; all app data lives in `server/data/*.json` via
  `localstore.mjs`.
- LLM: `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `CEREBRAS_API_KEY`,
  `LLM_PROVIDERS` (default `gemini,groq,mistral,cerebras,openai`), `SERPER_API_KEY`.
- Payments: `EWALLET_TNG_NUMBER`,
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
or capture API → vault at rest. CrewAI: venv + `uvicorn server:app --port 8000`. **No database
setup step** — the `infra/supabase/*.sql` schema is orphaned documentation, not a deployment step
(§3.2). n8n optional: workflows in `infra/n8n/workflows/`.

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
2. **Live chart not updating in the present.** Realtime is a shared SSE stream fed by the
   live CCXT feed; the candle bus fans in all sources (liveness >
   resolution-exactness > freshness > weight > latency), so a single source being down alone no
   longer means a Yahoo-daily-only fallback. Only when NO live source is reachable does the fallback bottom out at
   Yahoo **daily** bars and `useCandleData.ts`'s deliberate coarse-series guard (refuses to append
   present buckets; nudges last close) — "no new candles" is designed behavior while no live feed is
   connected. **The EO WebSocket is no longer part of this** — `services/liveEO.mjs` and its
   unofficial endpoints were deleted 2026-09-29 (WS-7 D2), so the "Open" question below is
   resolved by removal, not by debugging: there is no EO feed to trace.
   *Historical note retained for provenance:* sandbox could not reach any EO WS
   endpoint (several region URLs were dead DNS: `ws.expertoption.finance` ENOTFOUND etc.;
   `fr24g1eu.expertoption.com` resolved). That investigation is what fed the D2 removal
   decision. A related fix had already landed before removal: EO
   history-candle batch timestamps collapsed into one candle — now each row got a distinct time
   (verified).
3. **No browser extension ships.** `apps/extension-archived/` (Plasmo) is the retired skeleton —
   note the exact path: `apps/extension/` never existed at that path. There is no canonical
   `picc-overlay`: the entire extension era was removed end-to-end (D1) and
   `extensionAbsence.test.mjs` pins the absence (§6). Its passive sensor role moved to the studio
   browser's headless capture leg.

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

**2026-09-22 — WS-1 (docs/specs/PICC_TRADING_SUITE_WS1_LIVE_ORDER_LIFECYCLE_v1) landed via the SDD loop** (per-task brief → general-subagent implementer → code-reviewer gate → fix round until APPROVED → controller re-verify). Floor at close: 254 files / 2,767 tests (2,766 passed, 1 honest skip) — `npx vitest run --maxWorkers=1` from apps/dashboard, `npm run typecheck` green.

**2026-09-22 — WS-2 (docs/specs/PICC_TRADING_SUITE_WS2_RISK_AND_DRAWDOWN_ENFORCEMENT_v1) landed** — risk gates 16–19, aggregate day-loss, MDD size-step/hard-stop, portfolio heat, halt persistence, consent payload-lock, spread seam fail-closed, 5-of-7 pillar gate. Source-level seam guard: `apps/dashboard/server/__tests__/ws2RiskSeamGuard.test.mjs`; full floor + typecheck pending controller run.

**2026-09-23 — WS-3 (docs/specs/PICC_TRADING_SUITE_WS3_VALIDATION_AND_UNLOCK_CEREMONY_v1) landed** — persistent ceremony store (unlock state, binary-class, ceremony gate-1 stake wallet), ledger provenance seam, trading-day primitives, gate evaluators, readout route, perps mainnet branch gated on the store. Source-level seam guard: `apps/dashboard/server/__tests__/ws3CeremonySeamGuard.test.mjs`; full floor + typecheck green. Perps mainnet unlock is NOT claimed venue-live — it requires the owner ceremony flip.

**2026-09-23 — WS-4 (docs/specs/PICC_TRADING_SUITE_WS4_COPYTRADING_IDEA_SOURCING_v1) landed** — persistent leader-follower store, leader-feed contract + registry (HIP stub, CSV/manual real lanes), qualification reusing analytics (300 trades / <15% MDD / positive expectancy after costs), CSV import with cost-accounting denies, on-read auto-unfollow (21d) + rolling-7-day stop (display suppression only), operator-recorded platform-trust flag, readout route + read-only panel in the Command Centre. Source-level seam guard: `apps/dashboard/server/__tests__/ws4LeaderSourcingSeamGuard.test.mjs`; full floor + typecheck green. Idea-sourcing ONLY — WS-4 adds no execution path and touches no WS-2 rail by construction (seam-pinned).

---

*End of PICC.md — continue at §24 when the next section earns one.*