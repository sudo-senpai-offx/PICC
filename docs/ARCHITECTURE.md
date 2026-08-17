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
│  /api/trading/* (predict | paper | portfolio | history | assist)   │
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
   │ momentum + mean-reversion + regression + MC  │
   │ -> honest backtest-damped confidence         │
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

   Browser Extension (Plasmo) ◀── overlay suggestions (extension/confirm logs)
   External platforms (Amazon, YouTube, brokerages) — user clicks, PICC never does
```

## Data flow (Financial Twin example)

1. User submits `{ ticker, capital, riskTolerance, horizonYears, simulations }` from the dashboard.
2. The backend calls Yahoo Finance `/v8/finance/chart/{ticker}` (5y of daily closes, no key) and
   computes **real annualized drift and volatility** from the log returns.
3. The Monte Carlo engine (server) projects the distribution using those real parameters, with a
   risk-based allocation.
4. If `OPENAI_API_KEY` is set, the backend adds a short plain-language commentary.
5. Result (percentiles, allocation, last price, 5-year sparkline) is rendered, and a row is written
   to `public.simulations` in Supabase.
6. If Yahoo is unreachable, the backend falls back to model assumptions and says so (`source: local`).

## Data flow (extension)

1. The content script extracts page context — Amazon title/bullets/brand/ASIN or YouTube
   title/channel/description — and messages the service worker.
2. The service worker POSTs `{ platform, pageTitle, pageData }` to `/api/extension/suggest`.
3. With `OPENAI_API_KEY`, the backend generates real suggestions (optionally informed by Serper);
   otherwise a rule engine returns generic ones.
4. The overlay renders them with the mandatory 5-second human-review timer. Copying logs a
   confirmation to `/api/extension/confirm`.

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
   bridge is **read-only by contract** — the injected overlay only displays metrics.
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
   threshold, ETA, token expiry) used by the dashboard's Automator panel and the browser overlay.
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
2. `server/services/trading.mjs` runs four models — momentum (EMA cross), mean-reversion (z-score),
   linear regression slope, and Monte Carlo — and votes on direction. The reported confidence is the
   ensemble agreement **damped toward 50%** so a 2-of-3 vote reads ~60%, never a confident 90%.
3. Signals are appended to the paper ledger (`server/data/`); paper trades update the virtual
   portfolio with the same damping and stop-loss caps. Real orders are never placed.
4. If `EXPERTOPTION_USER_ID` + `EXPERT_OPTION_TOKEN` are configured, `POST /api/trading/account`
   opens a read-only WebSocket to ExpertOption and returns balance/profile/candles — no trade
   messages are ever sent.
5. `POST /api/trading/assist` answers plain-language questions with a cloud LLM when configured,
   else a local rule-based fallback (source `local`).

## Key design decisions

- **No execution.** Neither the dashboard, the extension, nor the agents can place orders, publish,
  or buy anything. The extension only injects *suggestions* and copies text to the clipboard at the
  user's explicit request.
- **Human review gate.** Every suggestion surface includes a mandatory 5-second timer plus a
  confirmation toggle before copy/apply is enabled. Confirmations are logged to
  `public.human_confirmations`.
- **Real data, honest fallbacks.** The backend prefers live providers (Yahoo, OpenAI, Serper,
  Stripe). When a key is missing or a provider is unreachable, it degrades to a clearly-labelled
  local engine rather than silently returning fake data. `/api/health` reports exactly which
  providers are configured.
- **Secrets never reach the browser.** Non-`VITE_` env vars (OpenAI, Serper, Stripe, Supabase
  service role) are only read by the Node backend.
- **Read-only integrations.** Amazon analysis uses the page data the user is already looking at;
  no Amazon API credentials are required. Financial data is historical and read-only. The
  ExpertOption bridge is a WebSocket client that only reads (balance/profile/candles) — it never
  sends trade commands.
- **Connectors are read-only too.** The browser bridge never clicks buy/withdraw/trade; it reads the
  dashboard DOM and the page's own WebSocket traffic, normalizes it, and persists the time-series
  locally in `server/data/`. Nothing is ever executed on external platforms.

## Module contracts

### Dashboard → backend (`apps/dashboard/server`)

The React app calls the same-origin `/api/*` endpoints (Vite middleware in dev, `server/index.mjs`
in prod). Request/response shapes are typed in `src/lib/types.ts` (connector types live in
`src/lib/api.ts`: `ConnectorDef`, `ConnectorSnapshot`, `ConnectorRegistry`, `StreamEvent`). Provider
config and the full endpoint list live in `server/handlers.mjs`.

### Extension → backend

The service worker forwards page context to `/api/extension/suggest` and expects
`{ suggestions: [{ id, title, body, confidence }], source }`. Copy confirmations go to
`/api/extension/confirm`. The popup stores settings in `chrome.storage.sync`. Tier-0/Tier-1 overlays
(`apps/extension/src/content.tsx`) also read `GET /api/connectors` and may trigger
`POST /api/connectors/:slug/collect` to surface live balances on the source's own page.

### Agents → backend

The dashboard proxies `/api/agents/run` to the CrewAI FastAPI service when
`PICC_AGENTS_URL` is configured. CrewAI output is decision-support text/JSON only.

## Environment / secrets

Never commit secrets. See `docs/SETUP.md` for the full list of environment variables and where each
is used.
