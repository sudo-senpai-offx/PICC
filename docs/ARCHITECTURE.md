# Architecture

PICC follows the **Emulation & Overlay** pattern: it simulates strategies and suggests actions, but
the user always performs the final action on the external platform.

## Layers

```
┌───────────────────────────────────────────────────────────────────┐
│  Frontend  apps/dashboard (React + TS + Vite + Supabase)           │
│  Dashboard | Simulator | Trading | Streams | Agents | Pricing | …  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ same-origin /api/* (dev middleware or node server)
┌──────────────────────────────▼─────────────────────────────────────┐
│  Backend  apps/dashboard/server (Node, ESM, zero-framework)        │
│  /api/twin/run  /api/listing/analyze  /api/content/generate        │
│  /api/extension/suggest|confirm  /api/agents/run                   │
│  /api/trading/* (predict | paper | autopilot | decisions | assist) │
│  /api/stripe/*  /api/paypal/*  /api/billing/ewallet/*  /api/btcpay/*│
│  /api/automator/*  /api/health                                     │
└──────────┬──────────────┬──────────────┬─────────────┬─────────────┘
           │              │              │             │
   ┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼─────┐ ┌─────▼──────────────┐
   │ Yahoo Finance│ │  LLM (key) │ │ Serper.dev│ │ Payments          │
   │ (no key,     │ │  chat/json │ │ (key)     │ │ PayPal | TnG |    │
   │ 5y history)  │ │            │ │ search/   │ │ BTCPay | Stripe   │
   │  drift & vol  │ │            │ │ news      │ │ (TnG manual)     │
   └──────┬───────┘ └────────────┘ └───────────┘ └────────────────────┘
          │ CoinGecko (no key, crypto prices)
   ┌──────▼──────────────────────────────────────┐
   │ Trading engine (server/services/trading.mjs) │
   │ 8-model ensemble: momentum | mean-revert |   │
   │ trend | MC | ARIMA | prophet | LSTM | GARCH  │
   │ -> walk-forward backtested confidence        │
   │ paper ledger | optional ExpertOption bridge  │
   │   (read-only WebSocket: balance/candles only) │
   └──────────────────────────────────────────────┘

   Optional: CrewAI microservice (agents/picc_agents, FastAPI :8000)
   ─────────────────────────────────────────────────────────────────────
   Dashboard backend ──/api/agents/run──▶ agents/picc_agents ──▶ CrewAI
   Research | Content | Listing | Trading | Investment (DeFi/Staking/NFT)
   (decision-support only)

   Supabase: auth, profiles, simulations, agent_logs, human_confirmations,
   overlay_settings, content_drafts, listing_analyses, payment_orders,
   crypto_holdings, defi_positions, trading_signals, defi_holdings,
   depin_holdings (all RLS-scoped) + v2 income-classification tables:
   financial_accounts, transactions, income_streams, nft_holdings,
   nft_royalty_earnings, depin_nodes, agent_configs, agent_earnings,
   agent_bounties, predictions, human_review_logs (infra/supabase/v2.sql)

   Browser Extension (MV3) ◀── passive sensor relay (broker WS frames → /api/extension/ingest)
   External platforms (Amazon, YouTube, brokerages) — user clicks, PICC never does
```

## Data flow (Financial Twin example)

1. User submits `{ ticker, capital, riskTolerance, horizonYears, simulations }` from the dashboard.
2. The backend calls Yahoo Finance `/v8/finance/chart/{ticker}` (5y of daily closes, no key) and
   computes **real annualized drift and volatility** from the log returns.
3. The Monte Carlo engine (server) projects the distribution using those real parameters, with a
   risk-based allocation.
4. With any cloud LLM key configured, the backend adds a short plain-language commentary.
5. Result (percentiles, allocation, last price, 5-year sparkline) is rendered, and a row is written
   to `public.simulations` in Supabase.
6. If Yahoo is unreachable, the backend falls back to model assumptions and says so (`source: local`).

## Data flow (extension)

The canonical extension (`apps/dashboard/extensions/picc-overlay/`) is MV3 vanilla JS loaded
unpacked — no Plasmo, no build step. It is a **passive, DOM-free sensor** (v2.x contract): it never
injects UI, mutates the page, or sends trade commands. The broker-page overlay was removed by
design (Phase 1); all decision/display surfaces live in the web dashboard now.

1. `inject.js` (MAIN world, `document_start`, broker domains only) sniffs the broker page's own
   WebSocket gateway frames and `postMessage`s them to the ISOLATED-world `content.js`. That script
   shape-validates every frame (`sanitizeUpstreamFrame`: action/asset/name caps, candle cap, size
   cap ≤ 4096) before queueing. Every `chrome.*` call goes through `chromeGuard()`, which tears the
   sensor down silently on context invalidation (reload/update) instead of throwing "Extension
   context invalidated." into the page. Server discovery re-probes `/api/health` on
   `127.0.0.1:5173`/`3000` every 15 s; while online, frames flush in batches (≤120) to the ingest
   buffer every 2 s; while offline they queue (cap 400) and flush on reconnection.
2. The ingest endpoint feeds the same market-data bus as the studio browser, so the dashboard's live
   candles work under the feed-mode gate (`auto → extension → studio` preference). The candles
   endpoint resolves the requested timeframe to the nearest bar the serving provider actually has
   and reports `requestedTimeframe`/`timeframe`/`resolved` — a 1 m request that can only be served
   as daily closes says so instead of mislabeling the bars.
3. The service worker owns only telemetry and lifecycle: heartbeat `/api/extension/heartbeat` on a
   30 s alarm (`HEARTBEAT_MS`; Chrome clamps alarm periods below 30 s — the old ~12 s claim was
   never real), active-tab changes via `/api/extension/tab-changed`, server-port discovery, the
   popup's `sensor-queue-depth` round-trip (observed depth only — "n/a", never a fabricated 0), and
   resurrection: after a reload/update invalidates live contexts, open broker + dashboard tabs are
   reloaded so the sensor comes back without user action (next navigation is the safety net).
4. Settings persist in `chrome.storage.local` with MV3-safe debounced saves. The legacy suggestion
   contract (`/api/extension/suggest` + `/api/extension/confirm`) remains server-side for the
   deprecated Plasmo skeleton (`apps/extension/`) only.
5. **Session capture (T13) — the extension is the PRIMARY headless-capture leg for a venue session
   the user already opened in their own browser** (the deprecated studio-browser leg stays as
   fallback — either present is functional, both is ideal). `content.js` runs on every
   `http(s)://*/*` page and observes ONLY the venue's configured storage keys (EO extScan cookie
   `token`/`tokenDemo` + `localStorage`/`sessionStorage` `token`) plus a storage-tier guest/active
   probe, matching the venue host ANCHORED (`(?:^|\.)${hostRe}$` — phishing subdomains never match).
   The worker relays the observation over the `relay-flush` channel (`capture-session` /
   `capture-profiles`) to `POST /api/trading/capture-session` (localhost-only + auth + rate-limited);
   the server applies the same rules as the studio leg (T9 gate, guest decision, venue's own save
   path, flap-guarded EO revive) and stamps `sourceLeg` across the status rows. The observed token is
   TRANSIENT: it rides one POST and is never written to `chrome.storage`, never into the popup, logs,
   or echoes (masked server-side); the popup only ever shows "via extension" / "via studio browser".
   5-minute TTL keeps the served scan config fresh from `/capture-profiles` when the web app is up,
   with a server-config-pinned built-in fallback when it is not; a user kill-switch
   (`piccSessionCapture:false`) disables scanning while the relay stays untouched.

## Data flow (billing)

Four payment paths, all authenticated via Supabase JWT. Money goes to the owner's own wallet —
no bank account or business registration required:

1. **PayPal** — `/pricing` → `POST /api/paypal/create-order` creates a Capture-order with a
   tier-coded `custom_id` and the tier price; the user approves on PayPal's hosted page; on return
   `/profile` calls `POST /api/paypal/capture`, which re-checks the order id, amount and tier
   against the order we created, then grants the tier.
2. **Manual e-wallet (Touch 'n Go)** — `/pricing` → `POST /api/billing/ewallet/order`
   returns an amount, instructions and a `PICC-XXXX` reference. The customer pays the seller's
   personal wallet directly and enters their receipt confirmation → `POST /api/billing/ewallet/submit`
   (self-serve, audited in `payment_orders`).
3. **BTCPay Server** — `POST /api/btcpay/invoice` creates a store invoice (redirect URL embeds
   `{InvoiceId}`); on return `/profile` checks the invoice status with `POST /api/btcpay/check` and
   grants when the payment settles.
4. **Stripe** (optional alternative) — `POST /api/stripe/checkout`; webhook (`checkout.session.completed`
   / `customer.subscription.*`) updates the profile via the service-role client.

Every path writes `profiles.subscription_tier` / `subscription_status` and an audit row in
`payment_orders`.

## Data flow (income connectors)

Every income source — bandwidth, NFT, DeFi, trading, treasury — is exposed through **one interface**
(`server/services/connectors.mjs`) that emits the same normalized snapshot no matter which transport
produced it:

```
Connector registry (slug: expertoption | honeygain | earnapp | pawns | repocket | grass | gradient |
                    silencio | opensea | aave | yearn | ...)
   ├── api       official provider API (yfinance, Stripe, Aave, ...)
   ├── ws        reverse-engineered protocol client (expertoption.mjs)
   └── browser   Browser bridge — a REAL installed Chrome/Edge over CDP
                 (playwright-core), persistent per-source profile, login-once
                 then read live dashboard DOM + the page's own WebSocket frames
```

1. **Browser bridge** (`server/services/browserBridge.mjs`) launches the machine's real Chrome/Edge
   (`PICC_BROWSER_PATH` → channels msedge/chrome/chromium → known EXE paths) in a persistent
   user-data-dir per source (`server/data/browser-profiles/<slug>`), strips the automation signals we
   control (`navigator.webdriver`), and exposes `{ goto, read, addOverlay, onFrame, close, reset }`.
   Because the target site literally talks to a real browser there is no fingerprint to detect. The
   bridge is **read-only by contract** — it reads the dashboard DOM and the page's own WebSocket
   frames; it never clicks, submits, or trades.
2. `POST /api/connectors/:slug/collect` runs the connector's best transport, polls the DOM until a
   selector yields a value (500 ms cadence, `waitMs` cap) and returns a normalized snapshot:
   `{ provider, platform, balance, today, lifetime, payoutThreshold, estimatedDaily, currency,
   source, status, error, lastChecked, extra }`. Successful snapshots are **persisted** to
   `server/data/connector_history.json` (time-series) and `connector_latest.json` (per-provider latest).
3. `GET /api/connectors` returns the registry, whether a browser is available, and the latest
   snapshots. `GET /api/connectors/:slug/history?limit=N` returns the persisted time-series (used by
   the dashboard's balance sparkline).
4. `GET /api/connectors/:slug/stream` is an SSE live feed: one persistent session per slug keeps the
   bridge open and navigated, re-reads the DOM every 5 s, persists changed snapshots, and pushes both
   the fresh snapshot and the page's own WebSocket frames (`{ dir, payload }`) to subscribers. The
   session closes when the last subscriber disconnects (`closeLiveSession`).
5. **Selector tuning.** Class-name selectors are often hashed/utility garbage on real sites, so the
   bridge `read()` also supports `text:` selectors (`"text:Floor price"`) that match the most specific
   element whose text contains the label and a number. `scripts/tune-connectors.mjs` opens each source,
   reports what the current selectors matched plus candidate elements, and writes
   `server/data/tuner-report.json`. Verified connectors are marked `tuned: true` (OpenSea is tuned
   against the live homepage); everything else ships `tuned: false` and shows an "untested" badge until
   you log in and re-tune.
6. PICC never executes on external platforms: connectors only read/aggregate, and the n8n aggregator
   workflow writes the same snapshots into the optional Supabase `income_streams` table.

## Data flow (automator)

1. The backend collects balances from each Tier-0 bandwidth provider on the dashboard's schedule:
   Honeygain, IPRoyal Pawns, Traffmonetizer (JWT), Repocket, plus manual/desktop streams (EarnApp,
   PacketStream). Credentials live in `server/data/automator-credentials.json`; collectible JWT
   tokens are decoded by `jwtInfo()` and their expiry is surfaced (and scheduled alerts fired when
   a token is ≤ 3 days from expiring or already expired).
2. `GET /api/automator/status` returns the provider matrix (balance, today, lifetime, payout
   threshold, ETA, token expiry) used by the dashboard's Automator panel.
3. `GET /api/automator/health` runs a rule engine over that status + node graph and returns
   `{ ok, issues, alerts, totals }` — flagged payout-ready balances, collector errors, token
   expiry, and node/providers mismatches.
4. `POST /api/automator/assist` answers plain-language questions about earnings: with a cloud LLM
   configured it produces a live answer (source `llm`); otherwise a local rule-based fallback
   (source `local`). Every question/answer is appended to `agent_logs` as an `assistant` row.
5. The scheduler's `credential-expiry` job (every 30 min) writes one `credential_expiry` alert per
   platform per day when a token approaches expiry.
6. PICC never moves money: it only reports, reminds, and suggests. Cash-out is done manually on
   each provider's site.

## Data flow (trading suite)

1. The user asks for a prediction on an asset (crypto or FX/stock). `POST /api/trading/predict`
   fetches 30–60 days of candles from the public data source (Yahoo Finance for FX/stocks, CoinGecko
   for crypto — neither needs a key).
2. `server/services/trading.mjs` runs the 8-model ensemble in `prediction.mjs` — momentum,
   mean-reversion, trend regression, Monte Carlo, ARIMA, Prophet-style seasonality, LSTM-lite and
   GARCH-lite — with dynamic weights from each model's walk-forward backtest hit rate. The reported
   confidence is a calibrated fraction of times the direction call would have been right on unseen
   data, never a made-up number.
3. Signals are appended to the paper ledger (`server/data/`); paper trades update the virtual
   portfolio with the same calibrated confidence and stop-loss caps. Real orders are never placed.
4. When an ExpertOption session token has been captured into the server-side credentials store
   (`server/data/trading-credentials.json` — captured from the in-app browser via
   `POST /api/browser/capture-session` or `scripts/capture-eo-session.mjs`; there are no EO env
   vars), the read-only WebSocket client surfaces balance/profile/candles through
   `/api/trading/status` and `POST /api/trading/pro/expertoption` — no trade messages are ever sent.
5. `POST /api/trading/assist` answers plain-language questions with a cloud LLM when configured,
   else a local rule-based fallback (source `local`).
6. **Headless session capture (Phase 5 engine, `docs/specs/PICC_HEADLESS_CAPTURE_ENGINE.md`).**
   `services/captureProfiles.mjs` drives the in-app browser per venue profile on a per-user,
   persisted cadence (`/api/trading/capture-config`). `expertoption` captures its session token
   through the reference `captureExpertOptionSession` hook; `iqoption` through the generic
   `browserStudio.captureViaStorageScan` hook, which reads ONLY the exact keys the profile row lists
   in `capture.storageScan` (`ssid` cookie, `verified:false` — a non-primary research candidate that
   self-validates at runtime). A tab without the configured keys errors honestly ("log in first"); a
guest page never saves. Captured tokens land in `server/data/trading-venue-tokens.json` —
    deliberately SEPARATE from `trading-credentials.json`, because the credentials object is spread
    into API responses and a shared map would leak raw tokens. Token-capture venues need NO vault
    username/password (T12.1): the gate is T9 first-login approval + the venue's OWN open tab, found by
    host (`capture.hostRe` against `browserStudio.studioLivePages()`, never the active tab); no matching
    tab → honest `no-tab` and a next-pass retry. **T13 makes the PICC extension the PRIMARY capture
    source** (the studio browser is deprecated): `POST /api/trading/capture-session` ingests the
    content script's observation of the venue tab's configured storage keys (whatever site the user
    browses, wherever the extension runs) and applies the identical gate/guest/save/revive rules; the
    status rows carry `sourceLeg: "extension" | "studio" | null` so the popup shows an honest "via
    extension" / "via studio browser". The status surface
    (`/api/trading/headless-status`, mirrored into the popup) reports the engine's OBSERVED state —
    `idle` / `needs-credentials` / `not-enabled` / `no-tab` / `guest` / `error` — plus `tokenChangedAt` (WHEN the
   token changed) and `lastMetricsAt`, never the token value. Account metrics
   (`/api/trading/account-metrics`, `services/accountMetrics.mjs`) are strict: an absent balance is
   `null`, never a fabricated `0`; a genuine observed `0` stays `0`.
7. **U4FA advisory dimension (`docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md`).** The confluence decision
   engine (`services/adaptiveConfluence.mjs`) runs `evaluateU4FA` per U4FA-enabled asset on its own
   `periods[300]` candle slice; the result rides (a) `strategies.u4fa` on the decision objects served
   by `/api/trading/decisions` and (b) `type:"u4fa"` SSE events on the SAME `/api/trading/realtime`
   socket as `decision` events — one event per U4FA-enabled decision, on the engine's existing
   `DECISION_INTERVAL_MS` tick; no new timer or endpoint. `compliance.proposalId` is the pending trade
   proposal for that symbol as observed at emit time (null honestly when none). A TRADE verdict places
   NO order by itself: `interventions.proposeTrade` enqueues a `source:"trade"` proposal in the
   applications queue, and only a human `approve` (`respondIntervention` trade branch →
   `openPaperTrade`, `trading.mjs:552`) creates a paper order. Honesty contract (all `honesty.*` keys):
   `spreadSource` is `null` when the spread was unmeasurable (`"spread":"unmeasurable"`, never a numeric
   estimate), `calendarSource` names the static schedule (`"fallback-schedule"`) when a live feed is
   absent, `structureSource` names the actual derivation (`"aggregate-h4"`/`"yahoo-d1"`), and no win-rate
   string ships before the T14 ledger gate (≥200 resolved decisions) passes.

## Key design decisions

- **No execution.** Neither the dashboard, the extension, nor the agents can place orders, publish,
  or buy anything. The extension only injects *suggestions* and copies text to the clipboard at the
  user's explicit request.
- **Human review gate.** Every suggestion surface includes a mandatory 5-second timer plus a
  confirmation toggle before copy/apply is enabled. Confirmations are logged to
  `public.human_confirmations`.
- **Real data, honest fallbacks.** The backend prefers live providers (Yahoo, the
  Gemini/Groq/Mistral/Cerebras/OpenAI hybrid, Serper, Stripe). When a key is missing or a provider
  is unreachable, it degrades to a clearly-labelled local engine rather than silently returning
  fake data. `/api/health` reports exactly which providers are configured.
- **Secrets never reach the browser.** Non-`VITE_` env vars (OpenAI, Serper, Stripe, Supabase
  service role) are only read by the Node backend.
- **Read-only integrations.** Amazon analysis uses the page data the user is already looking at;
  no Amazon API credentials are required. Financial data is historical and read-only. The
  ExpertOption bridge is a WebSocket client that only reads (balance/profile/candles) — it never
  sends trade commands.
- **Connectors are read-only too.** The browser bridge never clicks buy/withdraw/trade; it reads the
  dashboard DOM and the page's own WebSocket traffic, normalizes it, and persists the time-series
  locally in `server/data/`. Nothing is ever executed on external platforms.
- **Headless capture reads only configured keys.** The engine never guesses a session-token storage
  key: every venue row lists the exact `capture.storageScan` keys to read, a missing/cross-host
  key is an honest "log in first" error, and a captured token is never reported back through any API
  (only `tokenChangedAt` is). Venues without fixture-backed keys stay `not-enabled`.
- **Coverage matrix = source of truth for what capture is wired.** Ten venues in
  `captureProfiles.mjs`: `expertoption` (full, reference liveEO hook) and `iqoption` (full,
  storageScan) are enabled; `binance`/`kucoin`/`okx` are capture-only with ZERO documented browser
  session keys (they report `not-enabled` honestly — the mechanism is ready, the keys are not);
  `bybit`/`etoro`/`deriv`/`olymptrade`/`plus500` are catalog-only. Promoting a row is a data edit
  backed by a recorded live fixture, never fabricated selectors.
- **Demo first.** Every venue that can execute trades stays demo-gated (ExpertOption today; the
  three-layer demo net is non-negotiable per `docs/TRADING_MULTIPLATFORM_ROADMAP.md` §4). Headless
  capture and metrics are read-only layers — they never open an order path.

## Module contracts

### Dashboard → backend (`apps/dashboard/server`)

The React app calls the same-origin `/api/*` endpoints (Vite middleware in dev, `server/index.mjs`
in prod). Request/response shapes are typed in `src/lib/types.ts` (connector types live in
`src/lib/api.ts`: `ConnectorDef`, `ConnectorSnapshot`, `ConnectorRegistry`, `StreamEvent`). Provider
config and the full endpoint list live in `server/handlers.mjs`.

### Extension → backend

The canonical extension (`apps/dashboard/extensions/picc-overlay/`) is MV3 vanilla JS loaded
unpacked (no Plasmo, no build step). It relays the broker's own WebSocket frames to the server's
ingest buffer (`POST /api/extension/ingest`) — no overlay, no page mutation, no trading actions.
The service worker heartbeats `/api/extension/heartbeat`, forwards navigations via
`/api/extension/tab-changed`, and probes `/api/health` for dashboard reachability. Settings persist
in `chrome.storage.local` with MV3-safe debounced saves. The legacy
`{ suggestions: [{ id, title, body, confidence }], source }` contract (`/api/extension/suggest|confirm`)
remains available server-side for the deprecated Plasmo skeleton (`apps/extension/`) only.

### Agents → backend

The dashboard proxies `/api/agents/run` to the CrewAI FastAPI service when
`PICC_AGENTS_URL` is configured. CrewAI output is decision-support text/JSON only.

## Environment / secrets

Never commit secrets. See `docs/SETUP.md` for the full list of environment variables and where each
is used.
