# PICC Session Policy + Channel Catalog + Extension Active-Tab Sync

Status: draft → implementing (user directive 2026-08-31)
Spec owner: user + executor (big-pickle). Not part of PICC_TRADING_SUITE_UPGRADE.md;
it is a separate user-authorized workstream that takes priority over T11 for now.

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
3. **Extension popup lists every venue's headless state**, unrelated to what the
   human is looking at. Desired: the popup shows **only the active tab's** sync
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
- **R6 — Extension**: content script `sensor-queue-depth` reply carries
  `venueId` (+ name); background echoes it; popup shows **one row — the active
  tab's** sync state (venue, mode, headless status, "no sync target" otherwise),
  generalized labels.
- **R7 — Income channels**: ChannelsTab renders provider status from the health
  payload (not only 3 hardcoded cards) with honest Configured/Not-configured +
  enable hints.

## Non-goals (this workstream)

- No new data collection / novel-source capture yet — exploration result is
  proposed in the final report, not implemented.
- No T11 multi-timeframe panes (still pending from trading suite).
- No changes to gate semantics for **decided** venues beyond persistence.

## Checklist

1. [ ] `session-policy.json` store in `captureProfiles.mjs` (boot load, save,
       per-user keys, VITEST disk guard, `_resetHeadlessSessionState` clears
       in-memory cache).
2. [ ] `firstLoginGate` honors persisted policy before the propose flow.
3. [ ] `interventions.mjs` `respondIntervention` capture branch persists
       approve/reject (import cycle checked: none — interventions does not
       import captureProfiles currently).
4. [ ] `GET/POST /api/trading/session-policy` in `handlers.mjs` (auth = same as
       capture-config) + client fns in `src/lib/api.ts`.
5. [ ] Tests: gate persistence (approved fast-path / rejected no-reask), "ask"
       re-arms, interventions write path, API clamp + restart round-trip.
6. [ ] `streamCatalog.ts` trading category + entries; CatalogTab filter + sync
       settings table; ChannelsTab from health payload.
7. [ ] Extension active-tab sync row (content/background/popup).
8. [ ] Full `npx vitest run` + `npx tsc -b --noEmit` green; commit(s).