# Income Generalization (Q5) — Requirements — spec v1

**Status:** APPROVED — absorbed into design + checklist, executed · **Date:** 2026-09-03 · **Resolution:** COMPLETE — requirements realized through the design + checklist artifacts; all 13 checklist tasks executed 2026-09-04 on `master` (commits `04381f0`…`ce4b3a0`, one per task, tests green). Income is the first generalized platform kind (registry, autodetect, ingest, snapshot/cadence, ws relay, host generalization, grass-by-config, server-backed streams, Overview). (**Date:** 2026-09-19)
**Extends:** `docs/TRADING_MULTIPLATFORM_ROADMAP.md` (registry + extension collection rows) · `docs/specs/EXTENSION_CONNECTIVITY_ENGINE.md` (sensor division of labor) · existing connector registry `apps/dashboard/server/services/connectors.mjs` · existing localstore CRUD `apps/dashboard/server/services/localstore.mjs` + `apps/dashboard/server/handlers.mjs:3222-3254`
**Supersedes:** nothing destructive — see Risks. Refactors only where noted.
**Grounding rule:** every claim below carries a `file:line` read in this session; anything not re-read is marked **UNVERIFIED** and must be re-checked at execution start.

These requirements are the minimal, testable translation of the user's four decided directives. They deliberately do not invent features (no new payment rails, no new marketplaces, no new trading automation). The goal is the *backbone*: a config-driven registry + extension-driven collection + one unified server-backed income surface.

---

## 1. The Honesty Contract (applies everywhere in this spec)

This repo already enforces a strict honesty idiom for metrics (`accountMetrics.mjs:3-8` — "Every number here is an OBSERVED value or null… a fabricated 0 is indistinguishable from a real balance of zero"); `notifier.mjs:181` — "Unprovided fields stay absent — unconfigured ≠ zero-filled"; `connectors.mjs:135,140-146` — no readable values → `status:"error"`, never a zero row). This spec inherits it verbatim for the income surface:

- **Unconfigured ≠ zero-filled.** A source that is not registered, not enabled, not collected for, or that yielded no readable value reports `null`/`"unconfigured"`/`status:"error"`, never a fabricated `0`.
- **Every status reports observed state.** `status` is `ok` only when a real observation landed this cycle. `"error"`, `"stale"`, `"unconfigured"` are distinct, honest states a user can act on.
- **Genuine zeros survive.** A real observed balance of `0` is preserved as `0`; it is never the same as an absent read (`accountMetrics.mjs:79-81`).

## 2. The Independence Constraint

"Either alone must provide functionality; no feature may assume both present" (`EXTENSION_CONNECTIVITY_ENGINE.md:511-512` already codifies the hybrid rule for session capture — "either present is functional, both is ideal"). This spec extends that to the income surface:

- **Web-app alone:** full income command centre (registry browsing, manual/add sources, server-backed stream CRUD, unified daily/monthly/total + holdings views). Collection degrades to the server-side browser transport (`/api/connectors/:slug/collect`) and manual entry — no extension required.
- **Extension alone:** extension keeps capturing session/resource observations and relays them to the server, which normalizes them into Earnings the next time the web app reads `/api/data`. Nothing in the extension *requires* the web UI to be present to capture; nothing in the web UI *requires* the extension to be present to render.
- Concretely testable: every endpoint we add or change must be reachable and functional regardless of whether the other half is installed.

## 3. Directive 1 — A unified income command-centre surface

The "one-stop personal income command centre" aggregation of normalized Earnings across all sources.

- **REQ-A — Unified aggregate view.** A user sees today's total, 30-day total, lifetime total, active-source count, projected annual, and cash-out-ready sources, aggregated across (a) server-normalized connector snapshots and (b) user-tracked streams — in one screen. Uses the existing aggregation shape already proven in `src/lib/streams.ts:156-182` (`streamSummary`: monthly/ lifetime/ today/ activeCount/ projectedAnnual/ cashoutReady/ daily), generalized to also ingest normalized Earnings snapshots. No new math invented — reuse `streamSummary`.
- **REQ-B — Per-source detail.** Each source row shows the normalized Earnings fields (`balance, today, lifetime, payoutThreshold, estimatedDaily, currency, source, status`, `connectors.mjs:50-66`) and an honest status badge. A source with `status:"error"`/`"stale"`/`"unconfigured"` renders that status, not a zero.
- **REQ-C — Holdings perspective.** Alongside the cash-flow aggregate, the existing holdings tables (`nft_holdings`, `depin_nodes`, `financial_accounts`, `transactions` — `localstore.mjs:12-32`) are surfaced as a holdings view, fed through the same server-backed CRUD.
- **REQ-D — Manual entry preserved.** The user can still add/edit/track a stream the way `IncomeStreams.tsx:StreamsTab` does today (manual estimatedDaily, payout threshold, notes) — this is the "no channel/API" fallback that keeps *any* source trackable.

## 4. Directive 2 — A generalized declarative site-adaptor registry (with autodetect)

- **REQ-E — Declarative registry, not per-site code plugins.** Adding support for a new income site is done by adding/editing **CONFIG** (a registered connector definition: origins, transport, cadence, declarative extractors, normalize-to-Earnings), on the existing `registerConnector` seam (`connectors.mjs:81-88`) — not by writing a new service module per site. The existing 20+ in-code connectors (expertoption…rustchain, `connectors.mjs:425-648`) become the seed/back-catalog of this registry.
- **REQ-F — Autodetect where possible.** A discovery capability fingerprints a URL and proposes an adaptor: given a site URL, return (a) whether a matching registered connector/origin exists, and (b) if not, a *proposed* adaptor whose origins/extractors are derived from what the page itself exposes (candidate DOM/number-ish nodes, storage keys the page reads, WS frames it opens). The proposal is explicitly a **proposal with `tuned:false`** (`connectors.mjs:85,542`) — it never claims trust; a human verifies selectors before the connector is trusted.
- **REQ-G — Optional `collect` hook for the hard cases.** The registry keeps `collect` (`connectors.mjs:79,183`) as an *optional* override for sources whose extraction cannot be expressed declaratively (e.g. a MAIN-world WS-sniffer like EO). Config-driven is the default; code is the documented exception.

## 5. Directive 3 — Extension-driven collection across sites via the registry

- **REQ-H — Registry snapshot for the extension.** The extension can fetch a registry snapshot (origins + per-origin cadence) so it knows which sites to watch and how often, extending the existing `capture-profiles`/`captureConfig` pattern (`background.js:279-359`, `content.js:513-530`) rather than inventing a new channel.
- **REQ-I — Per-site capture on the registered cadence.** The existing activity-based cadence (realtime 15s / intermittent 90s / long 300s via `syncPolicy.js:14-28`) drives capture for each registered origin, generalized beyond ExpertOption. Session/permission-gated: the extension reads only what the user has logged into; no new host permissions beyond what collection needs.
- **REQ-J — Generalized ingest routed to the right normalizer.** The extension POSTs captured payloads to a generalized ingest endpoint that routes each payload to the correct registered connector's normalizer → normalized Earnings → persisted snapshot. Extends `/api/extension/ingest` (`handlers.mjs:4520-4545`) rather than a parallel endpoint.
- **REQ-K — Collection always activity-driven, read-only.** Nothing in the extension ever executes on an external platform (matches the repo's standing rule, `connectors.mjs:9-10` and the sensor integrity lock, `extensionIntegrity.test.mjs:82-100`). Automation only where legal; no real-money execution; trading stays advisory.

## 6. Directive 4 — Reuse the existing unused localstore/CRUD surface to make the income page server-backed

- **REQ-L — Server-backed income streams.** The income page's stream + earnings data moves from client-only `localStorage` (`src/lib/streams.ts:5-7`) to the existing user-scoped `/api/data/:table` CRUD (`handlers.mjs:3222-3254`), using the existing `income_streams` table (and earnings written as `transactions`/`income_streams` rows consistent with the v2 schema, `localstore.mjs:20-31`). The existing client `src/lib/localdata.ts:42-67` (`listData/appendData/upsertData/removeData`) is wired up — it currently has **no consumers**.
- **REQ-M — Backward-compatible read path.** Existing localStorage streams still render (migration path), but the server table becomes the source of truth once a stream is written there. See design + Risks for the exact no-data-loss migration rule.

---

## Non-goals (explicitly out of scope)

- No new payment channels (e-wallet/BTCPay/Stripe already exist — PayPal removed per owner 2026-09-13; not extended).
- No real-money trading execution, no new automation on external platforms.
- No new marketplaces/catalog expansion beyond what the existing `streamCatalog.ts` and connector registry already seed.
- No rewriting the MAIN-world WS-sniffer as config (it stays per-venue inject code — the documented `collect` exception).
- No cloud/database migration — the JSON `localstore` is the store (`localstore.mjs:1-3`); Supabase tables are the *schema mirror*, not a new backend.
- No breaking the existing extension integrity lock (read-only, pinned `document.` surface, pinned action vocabulary, pinned host patterns — `extensionIntegrity.test.mjs:151,186,212`).

---

### File/reference map (grounded this session)

| Concern | File:line |
|---|---|
| Connector registry + Earnings shape | `connectors.mjs:50-96`, `:425-648` |
| Browser transport collect | `connectors.mjs:99-173`, `:180-192` |
| Snapshot persistence | `connectors.mjs:242-275` |
| Registry HTTP surface | `handlers.mjs:3717-3833` |
| Localstore JSON tables | `localstore.mjs:12-32`, `:97-137` |
| `/api/data` CRUD routes | `handlers.mjs:3225-3254` |
| Client localdata (unused) | `src/lib/localdata.ts:42-67` |
| Client localStorage streams | `src/lib/streams.ts:5-7,29-141,156-182` |
| Stream catalog (130+ apps) | `src/lib/streamCatalog.ts:198-213` |
| Income page + tabs | `src/pages/Income.tsx:1-80`, `src/components/IncomeStreams.tsx:31-80` |
| Extension sensor (EO-hardcoded) | `content.js:332-351`, `inject.js:19-22`, `manifest.json:32-43` |
| Extension ingest (EO-only) | `background.js:312-320`, `handlers.mjs:4520-4545` |
| Extension cadence policy | `syncPolicy.js:14-41` |
| Extension integrity lock | `extensionIntegrity.test.mjs:27-100,151,186,212` |
| Metrics honesty contract | `accountMetrics.mjs:3-8,46-51,79-81` |
