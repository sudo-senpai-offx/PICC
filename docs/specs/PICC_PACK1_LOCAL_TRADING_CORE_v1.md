# G5 — Pack 1 "Local Trading Core" — spec v1

> **D1 clean break (2026-09-17) — historical record:** the "existing engine" rows below describe the extension as the PRIMARY capture leg (`extensions/picc-overlay/content.js`). The extension is removed; the **studio browser is the only capture leg** (`browserStudio.captureExpertOptionSession`, `sourceLeg:"studio"`). Pack-1 content (EO session capture, CCXT poll, news digest, signal notifications) is unaffected; extension rows are history.

## Status
PROPOSED — one blocker category (`DEPENDENCY-NOT-YET-AVAILABLE` for the Cactus Needle T0 runtime) and three open-owner questions (§Open questions) before approval. No code landed from this spec.

**Owner decisions (2026-09-13):** Q1 — **Serper is REPLACED, never supplemented**: digest sources are free/reliable only (RSS/Atom + catalog §4 free candidates), with locally resettable rate limits (shared polite rate limiter), optionally fed by a local webcrawling service that is a **global PICC capability** (usable by other features, not Pack-1-only). Q2 — approved: re-login uses the existing studio/extension session, demo-token 30min lifecycle OK, and **any manual-login need must surface a proper workflow PATHWAY prompt (structured steps + ack), never silent autodetection/automation**. Q3 — confirmed: MarketsRoom placement. S1/S3/S5 and the S6 live-run expectations carry these decisions.

## Classification
- **Kind:** G5 execution spec — Pack 1 of the Governor's Pack Registry (Governor §6, pack list §5) under the Earnings Agentic Ministry (§11 tiered router semantics), landing as a **PICC Pack** (ministry E10: mini AI/ML platform).
- **Scope lock:** Pack 1 "Local Trading Core" = exactly four steps: EO session capture, CCXT market-data poll, news digest, signal notifications. Nothing else. All four steps are read-only or advisory; **zero order-placement code** (the only order path, `openPaperTrade`, stays human-gated; `trading.mjs` `openPaperTrade` is locked to paper + approvals — UNVERIFIED exact lock mechanism, behavior asserted in existing tests).
- **Tags:** RUN/L-class per step (Governor §7 + Ministry §11 semantics): L-class = human-executed steps stop at human handoff (`stopped-at-human`); RUN = auto.

## Anchors
- `g-resource-governor-v1` — §5 Pack 1 list; §7 G5 acceptance ("pack runs are observed live once tiers are up; **L-class steps stop at human handoff**"); §6 Q6 (no new top-level settings page); §8.5 amendment (max RAM/CPU/storage configurable, conservative defaults, settings surface); owner answers A1 (Celeron N-series floor, 16GB DDR4, Core 5 120U iGPU-only, strict/configurable allocation), A3 (hybrid stack), B5 (strict rate limits), D8 (no Supabase — local persistence), E9/E10 (pack proceeds; mini AI/ML platform).
- `g-trading-sites-catalog-v1` — §4 free news sources (**UNVERIFIED candidates**, not implemented), §5 multiplexing contract (shared per-source rpm envelope; suites multiplex without exceeding venue caps).
- `g-earnings-ministry-v1` — §11 tiered router: RUN auto, L-class human-executed, `agent_logs` records every step, human flips "done"; Tier-0 Cactus Needle confidence-gated escalation.
- G1/G2/G3 landed (verified this session) — governor primitives exist and are wired.

## Problem
The four Pack-1 capabilities exist today as **scattered, silent, and unobservable** seams: an EO capture engine, a CCXT poller, a Serper-driven news helper, and a notification dispatcher all run (or refuse to run) with no single surface that says *what is running, whether it is healthy, and what is honestly not running and why*. The Governor's §7 acceptance says the pack "runs are observed live" — observation requires a registry. Today there is none, so G5 cannot be demonstrated.

Additionally the pack's honest states are invisible: Serper unconfigured → news silently `[]`; VAPID unset → "Web push is not configured" (TradingSuite.tsx:1003); EO degraded → "expired"/"unconfigured" (liveEO.mjs:165-175). These truths exist **per-seam** but are never aggregated, so the platform cannot claim "packs run" nor can it demonstrate the L-class handoff discipline §11 demands.

## Verified starting state (all facts read this session, file:line)
### Governor primitives (the envelope surface — reuse, do not replace)
- `server/services/resourceGovernor.mjs` — `routeTask` (pure tier decision T0/T1/T2/T3/unavailable), `recordCall` (append-only ledger via `localStore("resource_ledger")`, prompt content stripped, rotate-by-day bounded), `governorStats`, `recentRows`. Env ceilings verified: `PICC_GOV_T0_CONFIDENCE_THRESHOLD` default 0.6, `PICC_GOV_T1_MAX_TOKENS` 500, `PICC_GOV_T2_BURST_PER_HOUR`, `PICC_GOV_LEDGER_MAX_PER_DAY` 1000.
- G2 wired: `server/services/llm.mjs:54,72-74,134-136` routes via `routeTask` + `recordCall` when `PICC_RESOURCE_GOVERNOR=on`. Test seam: `server/__tests__/llmGovernor.test.mjs`.
- G3 surface: `handlers.mjs:1952-1966` `GET /api/settings/llm/resource` → `{enabled, budgets, governorStats, rows}`; UI `src/components/ResourceGovernorPanel.tsx` mounted at `Settings.tsx:317`.
- Rate limiting: `rateLimited(key, limit, windowMs)` at `handlers.mjs:314`; general bucket 60/60s for non-extension POST/PUT/PATCH at `:1076`, `EXTENSION_POLL_ROUTES` exemption `:1067`; existing ext-* limiters (ext-metrics 60/60, ext-ingest 240/60, ext-capture 120/60, ext-capture-profiles 60/60, ext-heartbeat 30/60).
- Persistence (D8): `server/services/localstore.mjs` exports `isTable/listRows/appendRow/upsertRow/removeRow/localStore(name, defaults)` — the registry persists here as JSON, no Supabase.

### Step P1-1 — EO session capture
- `server/services/captureProfiles.mjs` — `CAPTURE_PROFILES` data table; `captureVenue(venueId)` runner; EO via studio browser `browserStudio.captureExpertOptionSession` (`browserStudio.mjs:3579-3655`), IQ Option via `captureViaStorageScan` (`:3657+`); extension leg `captureSessionFromExtension` (`captureProfiles.mjs:604-681`), studio leg `:874-899`; key preference cookie `token` > `tokenDemo` > web-storage mirrors (`:751-757`); cadences tokenMs 30min / metricsMs 5min; `headlessSessionStatus()` exposes `sourceLeg` "extension" | "studio" | null.
- Extension is the PRIMARY capture leg: `extensions/picc-overlay/content.js:313-365` ("Venue session observation (T13)") — mirrors `captureExpertOptionSession` (`browserStudio.mjs:3601-3639`), relays **only on token change** (in-memory dedup `captureSent`, never persisted), user kill-switch `piccSessionCapture` (defaults ON), heartbeat flush every 30s.
- Session policy gate (T9 first-login): `handlers.mjs:1476` `/api/trading/session-policy`; token save refreshes dead headless EO session `handlers.mjs:1398-1412`; routes `/api/trading/capture-session` `:4913`, `/api/browser/capture-session` `:4488`, `/api/trading/sessions` GET `:2630`, `/api/trading/sessions/asset` POST `:2635`.
- Truthfulness: `liveEO.mjs:139-154` `currentStatus()` → "connected" | "stale" | "connecting" | "idle" + degraded kinds "unconfigured"/"expired" (`:165-175`, sticky until fresh token); feed mode via `getFeedMode()` (`:120`).
- Command Centre 5C truth table: `server/services/commandCentre/policyGraphCatalog.mjs:79-101` — expertoption `automationPermission: "forbidden"`, `demoOnly: true`, envelope `{mode:"demo", maxExposureUsd:null, maxConcurrent:1, maxDailyLossPct:5}`; enforced by `modeEngine.mjs:121-123`, `safetySidecar.mjs:223-246`, `policyGraphValidator.mjs:180-184`, surfaced in `commandCentreOverview.mjs:196-200` ("venue forbids automation — demo-only surface (5C truth table)"). Demo-only is a hard invariant.

### Step P1-2 — CCXT market-data poll
- `server/services/ccxtConnector.mjs` — `READ_ONLY_BLOCKED = [createOrder, createOrders, createOrderWs, createOrdersWs]` (`:33-37`), `guardReadOnly(exchange)` `:145`, `isRateLimitError` `:132`; connect/fetchCandles/fetchTicker/disconnect only.
- `server/services/scheduler.mjs` — `ccxt-market-data` job every 15s polls every entry of `ccxtExchanges` (default example binance BTCUSDT 5m) → `liveCCXT` state → adaptiveConfluence; `headless-session-refresh` every 60s; `sessionUptime24h()` feeds readiness (`autopilot.mjs:1117`).
- Credentials surface: `trading.mjs` `DEFAULT_CREDS` (`ccxtExchanges: []`, `expertoptionDemo: true`, `paperStartingBalance: 10000`, `riskPerTradePct: 2`); `sanitizePatch` `:166+` (ccxtExchanges array-capped 12 pairs, exchange lowered, limit 1..1000 default 200); broker UI `TradingSuite.tsx:782-831` ("Broker Connection", "Session token (paste to replace)" placeholder "token saved ✓", CCXT pairs textarea "Up to 12 pairs").

### Step P1-3 — News digest
- `/server/services/serper.mjs` — **legacy, REPLACED per owner decision (2026-09-13)**: `news(query)` returns `[]` when `env.serperApiKey` absent (honest skip); the digest no longer reads Serper — source-of-truth is the new free source set below. (Serper code stays in the tree untouched for now; the digest simply stops consuming it.)
- **Free news sources (owner-authorized Q1, was "gated on owner Q1")**: catalog §4 candidates remain UNVERIFIED (no `siteCatalog.mjs`, grep-scoped) — S3 hooks a **stable free primary first**: RSS/Atom feeds owned by PICC's digest (e.g., a curated feed list + the shared polite rate limiter with locally resettable ceilings, per-source rpm inside catalog §5's envelope), plus an optional **local webcrawling service** (global PICC capability — reuse by other features, NOT Pack-1-only) that can read catalog §4 pages with a browser-less fetch path. No paid/SERP API participates. Sources are verified at S3 implementation time and recorded in the spec's S3 notes.

### Step P1-4 — Signal notifications
- `server/services/signalEngine.mjs` — 45s cadence (`CHECK_INTERVAL_MS 45_000`), PRE_TRADE/FOLLOW_UP state machine, advisory-only (no order placement), kill switch `PICC_SIGNAL_ENGINE=0`; consumes `dispatchAlert`/`getPrefs` from notifier.
- `server/services/notifier.mjs` — channels in-app (always, → bell), webpush (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY), webhook (WEBHOOK_URL); **unconfigured channel = "skipped", never "failed"/"sent"** (`:10-12`); per-channel sent/failed/skipped/off records; state `data/notifications.json` (`PICC_NOTIFICATION_DATA_DIR`); default prefs `{minConfidence:65, leadMinutes:3, windowMinutes:15, channels:{inApp:true,webpush:true,webhook:true}}`, `recent[]` capped 20, `snoozes{}`. `convergenceAlerts.mjs` mirrors the skipped-vs-sent pattern.
- Honest unconfigured surface (T8): `src/hooks/useWebPush.ts` — VAPID 503 → `unavailable` ("never a fabricated send", `:10-11`); routes `/api/notifications/vapid-public-key`, `/subscribe-push`, `/unsubscribe-push`; suite text "Web push is not configured on this server (no VAPID keys) — nothing will be sent." (`TradingSuite.tsx:1003`).
- Signal ledger honesty: `trading.mjs` `recordSignal` `:771`, `recentSignals` `:788`, `MAX_SIGNAL_PENDING_MS` 30min → stale signals flushed honest `"unresolved"` (`flushStaleSignals` `:805`) — never guessed outcomes.

### Frontend / ministry IA (Packs surface placement)
- Ministry IA: `src/App.tsx:60-64` — `/suites/:suiteId` under `MinistryShell`; trading ministry rooms include `MarketsRoom.tsx`, `CommandCentreRoom.tsx`, `AutopilotRoom.tsx`, `DashboardRoom.tsx`, `SettingsRoom.tsx`.
- Dashboard hero "Ministry status hero strip (real client reads, no fabricated values)" at `src/pages/Dashboard.tsx:246`.
- Existing honesty surfaces to mirror: `LiveDecisionsPanel.tsx:115-116` ("Adaptive Confluence" + engine live/idle badge), `:132-135` ("No decisions yet — engine needs live 1m buffers (min 40 bars per asset) and a broker session connected"), `TradingHud.tsx:190` (engine warming up copy), `ReadinessPanel.tsx:40-42` ("Demo → Real Readiness" BLOCKED(n)/met via `getTradingReadiness` — `autopilot.mjs:1039-1144`: blockers ≥200 resolved decisions, EV edge ≤0, demo-off, live uptime <80%, candle feed unconfigured/stale), `CommandCentrePanel.tsx:210` (GLOBAL KILL ACTIVE banner), `:238` (BLOCKED:"danger").
- Test rig: `npm test` = `vitest run --maxWorkers=3` (`apps/dashboard/package.json:13`); existing patterns `server/__tests__/*.test.mjs` + `src/**/__tests__` (jsdom installed); `web-push ^3.6.7` dependency present.

## Design

### The seam being cut
A **server-side Pack Registry + runner** (`packRegistry.mjs`, `packRunner.mjs`) that *observes* the existing four seams and reports, per step: `idle | running | stopped-at-human | skipped-unconfigured | blocked`, with `lastObservedAt` and an evidence row per attempt. The registry is **observational first**: Pack 1 slices 1, 2, 4 wrap the existing engines with zero behavioral change to them (no new poller, no new channel, no signature changes); only slice 3 (news digest) introduces a new runner, because a digest aggregator does not exist. All four steps stay inside the Command Centre truth table (expertoption `forbidden` → demo-only surface is untouched and asserted).

**L-class semantics (Ministry §11, Governor §7):** L-class steps and sub-gates stop at human handoff with status `stopped-at-human`, `needs` describing the human action, and a `doneBy: "human"` ack endpoint. RUN steps auto-run within their envelope. The only L-class element in Pack 1 is the **EO login sub-gate** (when degraded kind is `unconfigured`/`expired`, the human must re-login in their own browser/extension; capture is RUN once the token exists). Pack step statuses must never auto-transition a stopped-at-human step to running.

**Envelope model (per step: model tier, rpm ceiling, cadence, RAM/CPU/storage):**
- Enforce via **existing** primitives only: `rateLimited` for the registry HTTP surface; `routeTask`/`recordCall` for any LLM synthesis (digest synthesis at tier T3 with `PICC_GOV_T1_MAX_TOKENS` fallback); `PICC_GOV_*` envs. **No new ad-hoc rate limiter registry.**
- §8.5 caps (self-introduced by THIS spec, flowing from the amendment; env-parsed with conservative defaults, surfaced read-only in the strip footer): `PICC_RESOURCE_MAX_RAM_MB` (default 4096 — fits the 16GB floor), `PICC_RESOURCE_MAX_CPU_PCT` (default 50), `PICC_RESOURCE_MAX_STORAGE_MB` (default 2048, data dir). `packRunner` gates RUN-step start when a cap is exceeded → step `blocked` with reason; no process supervision is added here.
- Deployment floor (A1): Celeron N-series / Core 5 120U, iGPU-only, 16GB DDR4 max (strict gem5 modeling in interim — A1). The four steps add no new always-on process: they ride the existing scheduler tick and the existing storage-observed engines.

**Pack registry data model** (persisted via `localStore("pack_registry")`, D8):
```
{ version: 1, updatedAt, totalBudgetUsd: 0, capExBudgetUsd: 0, env: "dev", ownerCountry: "BD",
  packs: [ { id: "pack1-local-trading-core", label: "Local Trading Core",
    steps: [ { id, label, kind: "run"|"l-class", status: idle|running|stopped-at-human|skipped-unconfigured|blocked,
      envelope: { tier, cadenceMs, rpmCeiling, needs}, lastObservedAt, lastError, detail,
      evidence: [ {ts, status, detail, observed: null|value} ] } ],
    gateSet: ["hasApiKey", "hasCredentials", "hasVapid", "dependencyAvailable"], ... } ] }
```
Honesty contract (test-enforced): `observed: null` renders as `"not-observed"` (never 0/zero-filled); `skipped-unconfigured` carries the exact reason ("no news source configured", "no VAPID keys", "no ccxt pairs configured"); every step row records its last observation attempt with ts; pruning cap `PICC_PACK_REGISTRY_MAX_ROWS` default 5000, keep 30d.

**G5 acceptance mapping (Governor §7):** per-slice acceptance = unit seam (vitest, no network, no credentials) **and** live-observation precondition (must be satisfied against the running instance by the completing agent). Slice 6 is the explicit live run: manual/observed, records appended as `{kind:"observation", by:"human"}` evidence rows — **observation is a manual gate, not a CI proof** (honesty note).

## Non-goals
- No live/real-money trading, no order placement, no autopilot change — `openPaperTrade` and the command-centre gates are untouched.
- **Cactus Needle T0 runtime is NOT shipped here** (DEPENDENCY-NOT-YET-AVAILABLE). While absent, the EO capture step runs its extraction-free variant (session + storage-scan observation only, exactly what `captureProfiles.mjs` does today) and the T0-confident-extraction sub-step reports `skipped-unconfigured` with reason "cactus-needle-t0-runtime-not-shipped". No fake AI extraction output is ever produced.
- No new browser/extension surface, no new notification channel, no rework of `captureProfiles` signatures (registry observes existing exports only).
- No paid/SERP news APIs — Serper is replaced by free sources (owner decision); the digest never depends on a key-gated paid endpoint.
- No new top-level settings page (Governor §6 Q6) — the strip is a component inside the existing ministry IA; §8.5 caps surface as env + read-only footer, not a new page.
- No multi-pack framework build-out; the registry stores an array so future packs extend it, but only Pack 1 is defined and tested.

## Slices (ordered; each independently lands green + observable)

### S0 — Registry + runner skeleton
Files: `server/services/packRegistry.mjs` (new), `server/services/packRunner.mjs` (new), `handlers.mjs` (add `GET /api/packs/registry` — `rateLimited("packs", 30, 60)` mirroring ext-heartbeat; import registry), `server/__tests__/packRegistry.test.mjs` (new), `server/__tests__/packRunner.test.mjs` (new).
- **T0.1** Registry module: pack 1 definition (4 steps, kinds, envelopes), state machine, `localStore("pack_registry")` persistence, `PICC_PACK_REGISTRY_MAX_ROWS` prune.
  AC: vitest — state transitions legal/illegal; persistence round-trip; `observed: null` renders `"not-observed"` never 0; prune cap works; no network/credentials in tests.
- **T0.2** Runner: envelope gate (tier ceiling, `PICC_RESOURCE_*` caps, dependency flags), attempts list with ts, honesty clause (unconfigured mile reasons).
  AC: vitest — blocked when cap exceeded; `skipped-unconfigured` reason strings exact; stopped-at-human never auto-runs.
- **T0.3** HTTP surface: `GET /api/packs/registry`; CORS/session consistent with sibling handlers.
  AC: vitest (handler test with mocked registry) + live-observation precondition: hit the endpoint on the running instance, returns pack 1 with 4 steps `idle`, no fabricated values.

### S1 — Step P1-1 EO session capture (RUN + one L-class sub-gate)
Files: `packRunner.mjs` (P1-1 observer already in S0; add wiring), `server/__tests__/packRegistry.test.mjs` (P1-1 cases).
- **T1.1** Observe existing engine, change nothing: read `captureProfiles.headlessSessionStatus()` (sourceLeg extension/studio/null), `liveEO.currentStatus()` + degraded kind, `getFeedMode()`, token presence via `trading.mjs getCredentials()` (expertoptionToken non-empty).
  AC: vitest with fake seam outputs → status mapping table correct: connected+token → `running`; degraded `unconfigured`/`expired` → `stopped-at-human` with `needs:"re-login"`; no token at all → `stopped-at-human` `needs:"login"`; `piccSessionCapture === false` (extension kill-switch) → `skipped-unconfigured` reason "extension-capture-disabled".
  Live-observation precondition: with a demo token captured, step shows `running` + `sourceLeg`; with token cleared, shows `stopped-at-human (re-login)`; **the human doing the re-login is the L-class handoff, demonstrated live**.
- **T1.2** T0 extraction sub-step: if needle runtime absent → `skipped-unconfigured`, reason "cactus-needle-t0-runtime-not-shipped"; if present → `routeTask("ExtractEO","T0")` obeys `PICC_GOV_T0_CONFIDENCE_THRESHOLD`; extraction rows through `recordCall` (token ledger).
  AC: vitest both branches with mocked runtime presence; no fabricated extraction output.

### S2 — Step P1-2 CCXT market-data poll (RUN)
Files: `packRunner.mjs` (observer), `server/__tests__/packRegistry.test.mjs` (P1-2 cases), optional `server/__tests__/packRegistry.ccxtReadOnly.test.mjs`.
- **T2.1** Observe the existing `ccxt-market-data` scheduler job + `liveCCXT` state: poll counts (ok/fail), lastPollAt; `ccxtExchanges` empty → `skipped-unconfigured` reason "no-ccxt-pairs-configured". **No new poller** — registry reads, scheduler writes.
  AC: vitest — mapping of fake liveCCXT states → running/skipped; read-only re-assertion: `guardReadOnly` amputates the four order methods (`ccxtConnector.mjs:33-37` list asserted verbatim in test; mirrors existing `extensionIntegrity.test.mjs` style).
  Live-observation precondition: with binance BTCUSDT configured, step `running` with fresh `lastPollAt` (≤ cadence + slack); with pairs cleared, `skipped-unconfigured`.
- **T2.2** Envelope: cadence 15s existing; rpm ceiling = venue public-data cap minus margin (per-source catalog §5 multiplexing contract; ccxt rate-limit error already handled by `isRateLimitError`), recorded as `rpmCeiling` fact.
  AC: vitest — envelope fact present and ≤ catalog cap for the configured venues; no new limiter introduced (test greps runner source for `rateLimited(` count == 1, the registry route).

### S3 — Step P1-3 News digest (RUN) — the only new engine
Files: `server/services/newsDigest.mjs` (new), `packRunner.mjs` (P1-3), `packObservers.mjs` (P1-3 observer), `server/__tests__/newsDigest.test.mjs` (new). Serper is NOT consulted (owner Q1 — replaced).
- **T3.1** Digest runner: cadence 10min; sources = the free-source set (≥1 feed configured — source list from the digest's own config): classes `configured = feeds.length > 0`; honest skip reason "no-news-source-configured" when the feed list is empty; synthetic digest of fetched items bounded (≤6 fetches per 10min per source — B5-strict, inside catalog §5 envelope, rate limiter resettable locally); optional LLM synthesis at tier T3 via `routeTask`, token ceiling `PICC_GOV_T1_MAX_TOKENS` fallback; output rows `{items: [], source, at}` — **empty items never fabricated, titles never invented** (a feed that returns nothing records the empty row honestly).
  AC: vitest — no feeds configured → `skipped-unconfigured` reason "no-news-source-configured"; configured + mocked fetch → digest shape + rpm budget respected (fake fetch counter ≤ 6/10min); synthesis path honors governor routing (mock `routeTask`).
  Live-observation precondition (both states demonstrable): no feeds → `skipped-unconfigured` on the registry; feeds configured → `running` + digest row with `observed.items.length >= 0` honestly.
- **T3.2** Digest store + prune (registry evidence; cap rows/30d).
  AC: vitest prune.

### S4 — Step P1-4 Signal notifications (RUN)
Files: `packRunner.mjs` (observer), `server/__tests__/packRegistry.test.mjs` (P1-4 cases).
- **T4.1** Observe `notifier.dispatchAlert` channel records per channel: in-app always; webpush/webhook `skipped`-when-unconfigured (already the notifier contract `:10-12`); surface `channels:[{name, state: sent|failed|skipped|off, reason}]` in the step row.
  AC: vitest — fake channel records map to step statuses; unconfigured webpush → `skipped-unconfigured` reason "no-vapid"; in-app-only healthy → `running`; volume bounded (recent[] cap 20).
  Live-observation precondition: default prefs on the live instance → step `running`, channels show in-app ok + webpush "skipped (no VAPID)" + webhook "skipped (no webhook url)" — matches `TradingSuite.tsx:1003` honesty exactly.
- **T4.2** Kill-switch honesty: `PICC_SIGNAL_ENGINE=0` → step `skipped-unconfigured` reason "signal-engine-disabled".
  AC: vitest env-toggle.

### S5 — Packs strip on the trading ministry (UX)
Files: `src/components/PackRegistryStrip.tsx` (new), `src/lib/packRegistry.ts` (new client), `src/pages/ministry/MarketsRoom.tsx` (mount strip above engine panels), `src/components/__tests__/PackRegistryStrip.test.tsx` (new).
- **T5.1** Strip component: polls `GET /api/packs/registry` (with `lastUpdatedAt` "as of" timestamp; failure → honest "registry unreachable" message, no cached fabrication); per-step status badge + envelope fact line + L-class chip ("needs human: re-login") + ack button ONLY on `stopped-at-human` steps (POST ack, server marks `doneBy:"human"`, step re-arms to its RUN leg).
  AC: tsx test (jsdom + vitest, pattern of `MinistryShell.test.tsx`) — renders 4 steps, statuses color-coded, ack button only on L-class stop, honest empty states; ack POST mocked.
  Live-observation precondition: strip visible in MarketsRoom at `/suites/trading`, values match the registry endpoint 1:1.
- **T5.2** Footer line: §8.5 budget vs used (RAM/CPU/storage env caps read-only) + "config: PICC_RESOURCE_* envs" note; no new settings page.
  AC: tsx test renders footer; live observation shows caps text.
- **Placement rationale (adaptation flag):** Governor §6 Q6 forbids a new top-level settings page; the strip is a component in the existing ministry IA. MarketsRoom is chosen over Dashboard.tsx:246 hero strip because Pack 1's four steps are data-plane executions (session, candles, news, signals) whose panels already live on MarketsRoom (Adaptive Confluence, engine idle, readiness), so "what is running" sits where the data is watched. The Dashboard hero remains out of scope (Q3 — **owner confirmed MarketsRoom 2026-09-13**).

### S6 — G5 live-observation acceptance run (Manual)
Files: no code — runbook recorded into registry as `{kind:"observation", by:"human"}` evidence rows per step.
- **T6.1** Against the running instance with: real demo EO session (or extension capture leg), one ccxt pair (e.g., binance BTCUSDT 5m), **no** VAPID, free news sources configured (feeds) OR honestly skipped — observe ALL FOUR: capture `running` + sourceLeg; ccxt `running` + fresh lastPollAt; news `running` (feeds) or `skipped-unconfigured (no-news-source-configured)`; notifications `running` with in-app ok + webpush/webhook skipped — every row truthful.
  AC: G5 §7 "pack runs are observed live": evidence rows with ts + observed values.
- **T6.2** L-class demonstration: clear the EO token → step shows `stopped-at-human (re-login)` **with the workflow pathway prompt exposed (structured steps + ack — owner Q2: manual login is prompted, never auto-detected/automated)**; human re-logs (L-class handoff) → step returns to `running` with `doneBy:"human"` evidence row. Kill-switch variants `PICC_SIGNAL_ENGINE=0` and `piccSessionCapture=false` observed.
  AC: §7 "L-class steps stop at human handoff" demonstrated.

## Risks
1. **Registry honesty drift** — a status row that zero-fills or auto-transitions a stopped-at-human step silently breaks the G5 and §11 contracts. Guard: honesty contract tests (T0.1, T4.1) + `"not-observed"` sentinel + ack-only transition via explicit POST.
2. **Regression to the EO capture path** — any signature change to `captureProfiles`/`browserStudio` would break the live capture legs that already work. Guard: S1/S2 observers are read-only on existing exports; existing capture/extension tests stay green; `extensionIntegrity`-style reachability asserted in T2.1 (pattern cited).
3. **Double-polling / envelope bleed** — a naive "poll now" would double ccxt traffic. Guard: S2 design explicitly forbids a new poller (test greps for single `rateLimited(` usage in runner source); envelope facts asserted ≤ catalog caps (T2.2).
4. **UI stale/❮fabricated state** — strip caching old statuses would contradict "no fabricated values" (Dashboard.tsx:246 comment). Guard: "as of" timestamp + unreachable → honest message (T5.1) + live 1:1 check.
5. **L-class semantics confusion** — labeling an unconfigured-but-RUN step as stopped-at-human (or vice versa). Guard: vocabulary tests (T1.1/T4.2) asserting exact reason strings; status vocabulary fixed in S0.
6. **Digest LLM cost at T3** — unbounded synthesis tokens beyond the envelope. Guard: T3.1 routeTask + token ceiling assert; cache/skip when items empty.

## Honesty notes
- **Demo/live gates touched:** G5's "observed live" acceptance is a **manual/observed gate** — the live run (S6) requires a real running instance (EO demo session or extension, ccxt pair) plus unconfigured serper/VAPID to demonstrate every honest state; it is recorded as human-observation evidence rows, not CI assertions. No test in this spec touches the network or real credentials (all seams mocked; serper/ccxt/notifier fake fixtures).
- **Fabricated-state risk:** the registry's `observed` column is null until an observation lands; UI renders `"not-observed"`. No pack status is ever derived from absence-of-data-as-success. News digest items and AI extraction are never invented: no serper key → skipped; no Cactus Needle runtime → skipped, reason "cactus-needle-t0-runtime-not-shipped".
- **Credentials:** step rows store only presence flags (`tokenConfigured: true/false`), never token values; the strip never echoes tokens (matches "token is stored server-side and never echoed back in full", TradingSuite.tsx:786-787).

## Open questions (owner must answer; defaults hold until answered)
1. ~~News provisioning~~ **RESOLVED (2026-09-13):** Serper replaced strictly — digest sources are free/reliable (RSS/Atom feeds first; catalog §4 candidates verified at S3), with a locally resettable rate limit (shared polite rate limiter), plus an optional global local-webcrawling service usable across PICC features (not pack-only). Live demonstration uses the free-source states (running or honest `no-news-source-configured` skip).
2. ~~EO re-login cadence~~ **RESOLVED (2026-09-13):** approved — lifecyle = existing studio/extension session, demo token 30min refresh, manual re-login on expiry; **every manual-login need surfaces a structured workflow pathway prompt (steps + ack)** and no silent autodetection/automation attempts.
3. ~~Packs strip placement~~ **RESOLVED (2026-09-13):** MarketsRoom (recommended default confirmed).

---

## S3 execution notes (2026-09-13)

**Landed files**
- `server/services/webfetch.mjs` + `server/__tests__/webfetch.test.mjs` (23 tests) — GLOBAL PICC fetch capability, not pack-only: per-host sliding window, callable via host allowlist, honest gate detection (cloudflare/challenge/captcha markers), retry backoff, `webfetchLimits()/webFetchStats()/resetWebFetchLimits()`.
- `server/services/newsDigest.mjs` + `server/__tests__/newsDigest.test.mjs` (24 tests) — the only new Pack-1 engine: dependency-free RSS 2.0/Atom regex extractor (CDATA + entity decode), per-source fetch budget ≤6/10min enforced BEFORE the wire (B5-strict), dedupe by link, honest `not-xml`/gate/rate-limit per-source rows, digest store pruned (200 rows / 30d), synthesis = governor-routed stub (`routeTask` + `PICC_GOV_T1_MAX_TOKENS` ceiling; `PICC_NEWS_DIGEST_SYNTHESIS=on` enables; a summary is NEVER invented when off).
- `server/services/packObservers.mjs` — `observeNewsDigest` (+4 tests): no feeds → `skipped-unconfigured no-news-source-configured`; feeds but no pass → `running` with `items: null` (never invented 0); after a pass → honest counts.
- `server/handlers.mjs` + `server/__tests__/webfetchApi.test.mjs` (5 tests) — GET `/api/webfetch/limits` (rate-limited 30/60s, unauth'd), POST `/api/webfetch/limits/reset` (rate-limited 10/60s, auth-gated).
- `server/services/scheduler.mjs` — observation block p1-3 + separate `every("news-digest", 600_000, …)` RUN leg (staggerMs 90_000).

**Feed research (probe-verified 200 + real feed XML, no key, no captcha gate)** — curated in `VERIFIED_FREE_FEEDS`:
`https://www.forexlive.com/feed/news` · `https://cointelegraph.com/rss` · `https://www.coindesk.com/arc/outboundfeeds/rss/` · `https://news.google.com/rss/search?q=crypto&hl=en-US&gl=US&ceid=US:en` · `https://finance.yahoo.com/news/rssindex` · `https://cryptoslate.com/feed/` · `https://feeds.content.dowjones.io/public/rss/mw_topstories` · `https://www.ft.com/news-feed?format=rss` · `https://www.livemint.com/rss/markets`
Excluded: barchart (200 but text/html, not feed XML); investing.com/rss/news_1.rss probed 200 but kept out of the curated set (heavier anti-bot posture; operators may still add it).

**Captcha research (owner decision: honest skip is the default; solvers are an OFF adapter seam)**
- hcaptcha-challenger / recaptcha-challenger (QIN2DIM) exist, GPL-3.0, but are auto-fill libraries for interactive use — NOT silent network solvers; default OFF via `PICC_WEBFETCH_SOLVER` (empty = never engage).
- Cloudflare Turnstile solvers are paid/proxy-gated or license-gray; not integrated.
- Tesseract OCR covers only legacy text CAPTCHAs; not integrated.
- Contract: gates are DETECTED and recorded with their observed kind (e.g. `gated cloudflare-challenge`) and the source row is honest; PICC never bypasses a gate silently.

**Env surface** — `PICC_NEWS_FEEDS` (comma-separated URLs; garbage entries dropped, never counted), `PICC_WEBFETCH_MAX_RPM` (default 30/min/host), `PICC_WEBFETCH_SOLVER` (empty off), `PICC_NEWS_DIGEST_SYNTHESIS` (off), `PICC_NEWS_DIGEST_MAX_ROWS` (200).

**Verification** — batch 136/136 (packRegistry, packRunner, packRegistryApi, packObservers, handlers, scheduler, newsDigest, webfetch, webfetchApi). Full suite 206 files / 2123 tests green; `npm run typecheck` clean (exit 0). Live on the dev instance: unconfigured → registry `p1-3-news-digest => skipped-unconfigured | no-news-source-configured` + scheduler "news digest pass skipped — no feeds configured (honest skip)"; configured (2 feeds) → pass `feeds:2 ok:2 gated:0 rateLimited:0 items:50`, registry → `running | news digest active (2 feeds configured; last pass … - 50 items)`; GET `/api/webfetch/limits` → honest stats showing both observed hosts, `limited:0`.