# PICC Session Policy + Channel Catalog (+ Extension Active-Tab Sync — removed)

Status: draft → implementing (user directive 2026-08-31) · committed `0159703` (delivered). **Resolution:** COMPLETE — delivered `0159703`; all checklist items [x]; re-confirmed `2866779`/`a773cf2`/`da52233` (**Date:** 2026-09-19)
Spec owner: user + executor (big-pickle). Not part of PICC_TRADING_SUITE_UPGRADE.md;
it is a separate user-authorized workstream that takes priority over T11 for now.

> **D1 clean break (2026-09-17):** checklist item 7 — the extension active-tab
> sync row — was **removed with the extension** (no popup, no content script, no
> `/api/extension/trading-data`). Items 1–6 and 8 (session-policy persistence,
> first-login gate, stream catalog trading category, channels health rendering)
> remain live architecture and are unaffected. Extension rows below are retained
> as the historical record of the delivered feature.

> **Notification channels (2026-09-02):** this document's channel catalog is the
> **income/stream** catalog (`streamCatalog.ts`), not the alert notifier. The
> notifier (`notifier.mjs`) ships exactly three channels — **in-app, webpush,
> webhook** — the email channel was removed (see
> `PICC_NOTIFICATION_AND_ALERT_UX_v1.md` T9).

## Problem

1. **Gate re-asks on every restart.** The T9 first-login approval gate
   (`captureProfiles.mjs` `firstLoginGate`) keeps its approved/rejected state
   process-local. The human approves ExpertOption once; the next server restart
   asks again. The user wants: first visit prompts; the decision **persists**;
   later visits **auto-sync (approved) or stay silent (rejected) with no
   prompt**; the decision stays changeable in Settings → channel catalog →
   per-platform sync mode.
2. **No trading category in the income channel catalog.** `streamCatalog.ts`
   covers bandwidth/depin/storage/compute/crypto/nft/p2p/agent/interest/
   dividend/rental/content — not trading platforms, despite the trading suite
   tracking 10 venues (ExpertOption, IQ Option, Olymp Trade, Deriv, Binance,
   Bybit, KuCoin, OKX, eToro, Plus500).
3. **Extension popup lists every venue's headless state** (historical — popup removed with the D1 clean break, 2026-09-17), unrelated to what the
   human is looking at. Desired (as delivered): the popup shows **only the active tab's** sync
   status, generalized beyond "trading platform".
4. Income page hardcodes 3 payment-provider cards; status should render from the
   observed health payload, honestly.

## Requirements

- **R1 — Agent task but honest**: first visit to a venue tab proposes
  approval (existing flow). Approve/execute persists `approved` per venue.
  Reject persists `rejected`. Interrupt persists nothing (stays "ask").
- **R2 — No re-prompt**: with a persisted `approved`, the gate returns
  `{ approved: true, policy: "approved" }` without proposing. With a persisted
  `rejected`, the gate returns `{ state: "rejected", …, policy: "rejected" }`
  without proposing and without cooldown churn.
- **R3 — Survival**: the decision lives in `session-policy.json` (same
  data-dir + tmp/rename + VITEST guard pattern as `capture-config.json`), so a
  fresh server process honors it. In-memory state is boot-loaded from disk.
- **R4 — Changeable**: `GET /api/trading/session-policy` returns every venue
  with `decision: "approved" | "rejected" | "ask"` (ask = not decided / cleared).
  `POST /api/trading/session-policy` `{ venueId, decision }` sanitizes venue +
  decision and writes it. "ask" clears the row (back to prompting).
- **R5 — Catalog**: `streamCatalog.ts` gains `category: "trading"` +
  `STREAM_CATEGORY_LABELS.trading` + `TRADING_PLATFORM_APPS` (the 10 venues,
  url = venue login/home). Income → Channel Catalog gets a **Trading platform**
  filter rendering per-platform sync settings (Auto-sync / Don't sync / Ask
  each time) backed by the session-policy API + honest headless status.
- **R6 — Extension (removed with D1, 2026-09-17)**: content script `sensor-queue-depth` reply carries
  `venueId` (+ name); background echoes it; popup shows **one row — the active
  tab's** sync state (venue, mode, headless status, "no sync target" otherwise),
  generalized labels. Shipped 2026-08-31; the popup and content script were deleted with the extension.
- **R7 — Income channels**: ChannelsTab renders provider status from the health
  payload (not only 3 hardcoded cards) with honest Configured/Not-configured +
  enable hints.

## Non-goals (this workstream)

- No NEW open-positions/position-exposure capture. Exploration finding: the
  live-chart / trading-data feedback loop ALREADY exists
  (the extension-era `/api/extension/trading-data` endpoint was removed with D1 — the liveEO candle/account buffer + studio bridge carry the loop now, `handlers.mjs`); the only genuine gap is open-positions exposure
  (`accountMetrics` `openPositions`/`exposurePct` stay `null` — never
  fabricated — because no documented/verified EO position key exists and no
  live session is observed to reverse against). Extracting it requires the same
  "T10 research-first" gate used for Binance/KuCoin: a live fixture must name a
  real key before any capture hook is wired. NOT done — flagged in report.
- No T11 multi-timeframe panes (still pending from trading suite).
- No changes to gate semantics for **decided** venues beyond persistence.

## Error-log triage (directive: check logs for issue determination)

`picc-errors.log` (checked 2026-08-31): no crashes. Recurring benign warnings —
(a) "EURUSD: model matrix falling back to Yahoo DAILY bars" (Decision B, honest
daily cap — EO intraday heartbeats have no live chart to buffer when the venue
tab isn't open), (b) "market news failed: Serper 400" (degraded market-news
integration — operational, flagged to user), (c) "ExpertOption rejected the
session token" for the REAL-user context (operational — user must re-login).
None are caused by, or block, this workstream.

## Checklist

1. [x] `session-policy.json` store in `captureProfiles.mjs` (boot load, save,
       per-user keys, VITEST disk guard, `_resetHeadlessSessionState` clears
       in-memory cache).
2. [x] `firstLoginGate` honors persisted policy before the propose flow.
3. [x] `interventions.mjs` `respondIntervention` capture branch persists
       approve/reject (import cycle checked: none — interventions does not
       import captureProfiles currently).
4. [x] `GET/POST /api/trading/session-policy` in `handlers.mjs` (auth = same as
       capture-config) + client fns in `src/lib/api.ts`.
5. [x] Tests: gate persistence (approved fast-path / rejected no-reask), "ask"
       re-arms, interventions write path, API clamp + restart round-trip.
6. [x] `streamCatalog.ts` trading category + entries; CatalogTab filter + sync
       settings table; ChannelsTab from health payload.
7. [x] Extension active-tab sync row (content/background/popup) — **removed with the extension, D1 clean break 2026-09-17**.
8. [x] Full `npx vitest run` (116 files / 1303 tests) + `npx tsc -b --noEmit`
       green; committed `0159703`.

## Resolution (2026-09-19)

**Disposition:** COMPLETE. Delivered in `0159703` and re-confirmed by `2866779` (mark complete + novel-sources finding), `a773cf2` and `da52233` (terminology/annotate).

**Evidence (code, this session):** items 1–6 + 8 all [x] and verified — `firstLoginGate` + `session-policy.json` (`captureProfiles.mjs:377,495-659`), `GET/POST /api/trading/session-policy` (`handlers.mjs` + `src/lib/api.ts`), R5 trading-platform category at `src/lib/streamCatalog.ts:124-147` (`TRADING_PLATFORM_APPS`, category "trading"), `ChannelsTab` from health payload; gate persistence/interventions covered at `accountMetricsApi.test.mjs:243-298`. Item 7 (extension active-tab sync) was removed with the D1 clean break per the spec's own 2026-09-17 note — the strip is complete, not a deferral.

**Successor:** none — feature shipped; notifier channel list corrected per `PICC_NOTIFICATION_AND_ALERT_UX_v1.md` T10/T11.