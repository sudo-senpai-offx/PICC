# Headless Session-Capture + Account-Metrics Engine (platform-general) — spec v1

**Status:** Draft for execution · **Date:** 2026-08-29
**Extends:** `docs/TRADING_MULTIPLATFORM_ROADMAP.md` (multi-venue integration; Platform-Kind taxonomy at
`apps/dashboard/server/services/browserStudio.mjs:541-552`) · the Phase-1 read-only bridge contract
(suite never executes trades) · the Phase-4 token-refresh-revive wiring (`handlers.mjs:1292-1302`,
`liveEO.mjs:1009-1022`).
**Supersedes:** nothing — new work at the headless-login + account-state layer. Applies to the ExpertOption
path (reference implementation) and generalizes across the trading-venue registry.
**Grounding rule:** every claim below carries a `file:line` I read this session; anything not re-read this
session is marked **UNVERIFIED** and must be re-verified at execution start (re-verification is a task).

---

## Requirement intent (verbatim)

1. "Extension captures the token by its own" — PICC, via its existing headless-browser machinery, logs into
   trading platforms itself, captures the session token/credentials automatically, and REFRESHES them
   PERIODICALLY so the realtime session never dies from a stale token.
2. "Capture every required metric — refresh periodically" — the headless session also collects account
   metrics (balance/equity/positions/currency/profile) on a configurable cadence, not just market data.
3. "Data/metrics/etc. collection can be configured" — per-user/per-platform configuration of what is
   collected and how often.
4. "Generalization features apply for ALL trading platforms" — the mechanism is platform-GENERAL, covering
   every platform in the registry (expertoption, binance, bybit, kucoin, okx, etoro, plus500, iqoption,
   olymptrade, deriv), not ExpertOption-only.

**Platform set named by REQ 4** (verified in `SITE_INDEX` trading rows, `browserStudio.mjs:504-513`);
PLATFORM_KINDS (`:541-552`) map them to four kinds:

| Venue (site id) | Kind | Category |
|---|---|---|
| expertoption | binary | trading |
| iqoption | binary | trading |
| olymptrade | binary | trading |
| deriv | binary | trading |
| binance | spot | trading |
| kucoin | spot | trading |
| okx | spot | trading |
| bybit | derivatives | trading |
| etoro | cfd | trading |
| plus500 | cfd | trading |

**Catalog-only venues with no data integration yet:** only `binance`, `kucoin`, `okx` have verified
deep-link symbols/URLs (`VENUE_SYMBOLS`/`VENUE_TRADE_URL`, `browserStudio.mjs:555-565`; `instrumentUrl`
`:573-581`); all ten rows are in the site index (category `"trading"`) but only ExpertOption has a live
session/token/market-data path wired today. The other nine are "capture-able in the browser" but have no
WS/feed ingestion and no account-state store yet.

---

## Requirements (each testable)

- **REQ-A — Platform-general session-token capture via headless login.** For each venue in the platform set,
  PICC opens the venue in its headless browser (reusing `openStudio`/`studioGoto`/`studioOpenSite`),
  authenticates using the per-site vault credentials (`browser-credentials.json`), verifies login landed via
  a per-platform "login-state signal", captures the session token from the per-platform storage surface, and
  persists it. Triggered (a) on demand and (b) on a configurable refresh cadence. When a captured token
  CHANGES value, the existing revive path fires (`restartLiveEO({force:true})`) so a dead session is revived;
  an unchanged token must NOT restart a healthy session (flap guard, matching
  `handlers.mjs:1292-1302` semantics). **EO is the reference implementation; every other venue's selectors
  and storage surfaces are UNVERIFIED and gated behind per-platform research.**
- **REQ-B — Configurable account-metric collection.** A per-platform "account-state extractor" reads the
  metric vocabulary (account balance, demo vs real wallet split, currency, profile identity, open
  positions, exposure/risk) from the WS-frame vocabulary AND/OR DOM reads, on a per-platform + per-user
  cadence (defaults from a sane baseline), lands in a defined server-side store, and is surfaced via an
  endpoint. Collected metrics are HONEST: each record carries the observed timestamp, the producing leg
  (`ws` | `dom`), and a `stale` flag; the store must NEVER fabricate zeros — a missing value is `null`,
  surfacing as `n/a`, not `0`.
- **REQ-C — Platform coverage matrix.** Of the ten venues: which get **full** (login + capture + metrics)
  in v1, which get **capture-only**, which stay **catalog-only** (no login/capture/metrics in v1). The
  matrix is DRIVEN by the kind→strategy mapping so a NEW venue of an existing kind is mostly config, not
  code.
- **REQ-D — Extension framing.** The extension UI/status surfaces headless-session state (per-platform row:
  last capture, last metrics, stale) WITHOUT adding any automation to the extension. The sensor stays
  read-only by construction and DOM-free; the popup stays a connection/config surface.  Existing popup
  honesty patterns extend; T9 locks must not break.
- **REQ-E — Safety/approval.** The first login per platform may require one human approval; the default
  execution account is paper/demo first; PICC places NO real-money orders — order placement (real or demo)
  is entirely OUT OF SCOPE; this phase only *reads* sessions and account state.

---

## Design

### Mechanism A — Per-platform capture profile (REQ-A/REQ-C, the main seam)

New `apps/dashboard/server/services/captureProfiles.mjs` — a config registry keyed by venue `site.id`
(`expertoption`, `binance`, `bybit`, `kucoin`, `okx`, `etoro`, `plus500`, `iqoption`, `olymptrade`,
`deriv`). Each entry declares:

```
{
  id, kind,                          // kind ∈ {binary, spot, derivatives, cfd}
  loginPage,                         // URL to navigate to (venishRoot or verified login URL)
  login: { userSel[], passSel[] },   // selectors; defaults = the generic fillLoginFields set
  storageScan: {                    // which surfaces to read the token from
     cookieName[], localStorageKeys[], sessionStorageKeys[],
     pattern?,                      // regex for the token value (e.g. EO 32-hex)
     rankingFn?,                    // tie-break like captureExpertOptionSession
  },
  loginSignal: fn(page),           // resolve {guest, active, email, name} — mirrors domLoginSignals
  capture: {                        // hooks; run AFTER loginSignal says active
     saveToken(credKey, value),    // e.g. expertoption → trading.saveCredentials
  },
  metrics: { extractVia: ["ws","dom"], cadenceMs },   // see Mechanism B
  demoReal: "demo-first" | "respect-account",         // REQ-E default
  status: "full" | "capture-only" | "catalog-only",   // REQ-C matrix
}
```

The **generic strategies** (so a new venue of an existing kind is config): each kind supplies a default
`storageScan` + `loginSignal` + `capture` + metrics-extractor that the EO profile overrides where EO
differs. Concretely:
- **binary** (iqoption/olymptrade/deriv): share the EO pattern — session token in web storage/cookies +
  login-state from a DOM probe (the `domLoginSignals` family, `browserStudio.mjs:2859-3119`).
  **UNVERIFIED** that any of them uses the identical 32-hex `token` cookie — each binary venue's real
  storage surface must be researched before its profile is enabled.
- **spot/derivatives** (binance/kucoin/okx/bybit): exchange UX differs; token usually in cookies/`localStorage`
  under a per-exchange key; login often email+password or 2FA. **UNVERIFIED** — the research task owns this.
- **cfd** (etoro/plus500): social/CFD UX, may require social login (Google/Facebook) — reuse
  `studioLogin`'s Google path (`browserStudio.mjs:3486-3530`, `GOOGLE_SIGNIN_HINTS` `:2782-2789`).
  **UNVERIFIED** — research owns this too.

**Seam reuse:** the capture step reuses the existing EO path verbatim as the reference implementation —
`captureExpertOptionSession` (`browserStudio.mjs:3579-3655`), `studioLogin`'s EO token capture bolted on
at `:3520-3528`, and the generic `studioOpenSite`/`studioGoto`/`studioAutofill` (`:1885-1904`, `:1856-1878`,
`:2771-2780`) drive the browser. `fillLoginFields` (`:2728-2764`) is the generic form filler for non-Google
venues. The per-platform profile is a NEW seam that parameterizes what today is EO-hardcoded.

**Missing vault credentials — honest state (hard constraint):** when `getSiteCredentials(siteId)`
(`browserStudio.mjs:126-131`) returns null for a venue scheduled for capture, the engine does NOT fabricate
login. It records `{ state: "needs-credentials", venue, at }` and stops. No token is saved, no session is
claimed. This surfaces in the status endpoint and REQ-D rows as "needs credentials", never as a false
"connected".

**Drive/refresh cadence:** a new scheduler job (registered alongside `ccxt-market-data`,
`scheduler.mjs:304-315`) `"headless-session-refresh"` iterates enabled venues at their configured cadence
(defaults in Mechanism B file), calling `captureVenue(venueId)` — capture +, when the token changed,
revive. Revive reuses `restartLiveEO({force:true})` via `liveEO.mjs:1009-1022` ONLY when EO's token string
changed (flap guard), matching the landed `handlers.mjs:1292-1302` pattern.

### Mechanism B — Account-metrics vocabulary, extractor, store, cadence (REQ-B)

**Metric vocabulary** (normalized from the EO account model already produced by `accountFrom`,
`expertoption.mjs:183-227`, and the WS `profile` action consumed at `liveEO.mjs:420-426`):

```
{ venueId, kind, observedAt, sourceLeg: "ws"|"dom", curated: "active"|"guest",
  currency, balance, demoWallet.balance, realWallet.balance, demo (bool),
  email, name, openPositions: [ ... ] | null, exposurePct: number|null, stale: bool }
```

Open positions: EO surfaces `state.session.deals()` (`autopilot.mjs:935`); exchanges surface via their own
WS/DOM. `exposurePct` is derived from open positions vs balance ONLY where the extractor proves the numbers
are the right semantic (mark-to-market liability); otherwise `null` — never a fabricated 0. Positions and
exposure are **P2/P3** (see matrix) and may be `null` for venues whose extractor is not implemented.

**Extractor seam:** new `apps/dashboard/server/services/accountMetrics.mjs` exports
`extractAccountState({ venueId, page, frames })` which:
1. calls the venue profile's `metrics.extractVia` hooks — `ws` parses accumulated frames (the EO model:
   `processAppObject` profile/candles shape, `liveEO.mjs:343-426`; the server-side sniffer collects frames
   via `studioOnFrame`/`browserBridge.mjs:431-457`) and `dom` reads via `readPage`
   (`browserBridge.mjs:599-645`, `text:Label` heuristic `:604-622`) and/or `studioEvalPage`
   (`browserStudio.mjs:2702-2711`). EO uses `ws` (profile action) — the two wallets already flow through
   `accountFrom`; other venues likely need `dom` first (**UNVERIFIED** research).
2. writes a **honest record** into a server-side store with `observedAt`, `sourceLeg`, `stale`.

**Store:** `server/data/account-metrics.json` (same tmp+rename + `VITEST` suppression discipline as
`liveEO.mjs:76-116`). `accountMetrics.mjs` exports `getAccountMetrics(venueId)`, `putAccountMetrics(record)`,
`accountMetricsForUser(userId)`. Multi-user: keyed by `userId` (`auth.mjs:188` `verifyUser`; `"default"`
pre-auth as in the chart-prefs pattern, `PICC_MULTISOURCE_ENGINE.md` Mechanism B).

**Cadence config (REQ-3):** per-platform + per-user cadence stored in a prefs file mirroring the feed-mode
file (`liveEO.mjs:83-116`). Defaults: session-token refresh every **30 min**; account metrics every **5 min**;
market-data unchanged (existing 15 s `ccxt-market-data`, `scheduler.mjs:304-315`). New
`GET/POST /api/trading/capture-config` (`requireAuth`, `verifyUser`) and `GET /api/trading/account-metrics`
(read-only, `requireAuth`) endpoints, following the `handlers.mjs:4332-4334` auth pattern.

### Mechanism C — Coverage matrix (REQ-C)

`captureProfiles.mjs` ships with an explicit matrix. **v1 status:**
- **full** (login+capture+metrics): `expertoption` (reference; EO WS path already works).
- **capture-only** (login+capture token, no metric extraction yet): the remaining binary venue `iqoption`
  (**UNVERIFIED** login/storage researched first); `binance`, `kucoin`, `okx` (spot — token capture only;
  metrics P3 because exchange metric semantics need fixture/replay research; their market data already
  exists via CCXT `brokers.mjs:65-77`).
- **catalog-only** (site row in `SITE_INDEX`, no login/capture/v1 metrics): `bybit`, `etoro`, `plus500`,
  `olymptrade`, `deriv` — no verified selectors/storage this session; they retain their `SITE_INDEX` rows
  and `tradingVenues()` (`browserStudio.mjs:584-592`) presence but the headless engine must report them
  "not enabled" until their profile is researched + enabled.

The matrix is a **data table** in `captureProfiles.mjs`, so "promote iqoption to full" = flip its row +
add its selectors; promoting a venue is not a code change to the engine.

### Mechanism D — Extension status framing (REQ-D)

No automation is added to the extension; the sensor (`content.js`/`inject.js`) and popup stay read-only.
The T9 zero-DOM lock (`extensionIntegrity.test.mjs:82-96`) and the read-only contract (`:73-80`) are
untouched. The extension surfaces headless-session state WITHOUT a new message action (the action
vocabulary is pinned at `extensionIntegrity.test.mjs:169`). Concretely:
- Background worker (`background.js`) polls a new read-only, authenticated, **localhost-gated** server
  endpoint `GET /api/trading/headless-status` (rows: `{ venueId, status: "ok"|"needs-credentials"|
  "not-enabled"|"error", lastCaptureAt, tokenChangedAt, lastMetricsAt, stale }`) and writes the result to
  `chrome.storage.local` under `piccHeadlessStatus`.
- The popup (`popup.js`) reads `piccHeadlessStatus` from storage (the storage-key read list is NOT pinned
  by `extensionIntegrity`; the pinned set is the message-action vocabulary at `:169` and the zero-DOM
  surface) and renders an honest per-platform row: `online :port`-style badge + last capture + stale tone.
  No new `sendMessage` action; no DOM automation; no trading controls in the popup (it must stay free of
  `autopilot`/`buyOption`/`/api/trading/demo/place`, `extensionIntegrity.test.mjs:77-78`).
- Hostile-input/queue/backoff guarantees in `content.js:135-175` are untouched.

### Mechanism E — First-login approval + demo-first (REQ-E)

First `captureVenue(venueId)` for a venue without a prior recorded successful login is routed through the
existing **human-approval gate**: the mutating workflow steps (fill/click/type/submit) belong to `WRITE_STEPS`
(`interventions.mjs:39`) and pause for approval (`:235-239`, `:238`). The engine drives login through the
workflow DSL (`runWorkflow`, `interventions.mjs:354`; `execStep`, `:140`), so the first automated login is a
**proposal** the human approves in the interventions queue — preserving the safety control. The default
execution account is demo/paper-first: profiles set `demoReal: "demo-first"`, and the engine refuses to
select a real wallet for any captured session unless a user explicitly opts it and the venue surfaces a
real-wallet account only as an *observed* (never selected-for-trading) value. **No real-money orders are
placed — orders are entirely out of scope for this phase**; this phase only reads sessions and account
state (the suite "never executes trades", `browserStudio.mjs:16`).

---

## Non-goals

- **No order execution** — real or demo. This phase captures sessions and reads account state only.
- **No extension automation** — the sensor/popup gain status framing, never DOM/overlay/automation. T9
  zero-DOM and read-only locks stay intact.
- **No overlay revival / dockables.**
- **No weakening** of: demo/live honesty gates, rate limiters (`handlers.mjs:4265-4308` localhost-only +
  240/60 s ingest), auth gates, or the human-approval gate on mutating workflow steps.
- **No token values in logs/responses** — masking at `handlers.mjs:1279,1303` stays; the spec names no
  real credentials anywhere.
- **No CCXT order-surface changes** — `ccxtAdapter.mjs` stays read-only (`brokers.mjs:76`).
- **No new venues beyond the ten** — MetaApi/OANDA/Alpaca remain roadmap Wave 2.
- **No fabricated zeros** — missing metrics are `null`/`n/a`, honestly.

## Priority & effort (honest)

P1 = must ship · P2 = should ship · P3 = if time · S < 1 session · M ≈ 1 session · L > 1 session.

| Task | Priority | Effort | Dependency |
|---|---|---|---|
| T1 Baseline + re-verify ground truth | P1 | S | — |
| T2 Capture-profile registry + EO as reference | P1 | M | T1 |
| T3 Headless login runner (vault → login → capture → save) | P1 | M | T2 |
| T4 Scheduler job + token-change revive | P1 | M | T3 |
| T5 Account-metrics vocabulary + WS extractor (EO) | P1 | M | T2 |
| T6 Metrics store + `GET /api/trading/account-metrics` | P1 | M | T5 |
| T7 Capture-config endpoints + per-user/venue cadence | P1 | M | T4, T6 |
| T8 Headless-status endpoint + popup framing (REQ-D) | P2 | M | T4, T6 |
| T9 First-login approval gate (REQ-E) wiring | P1 | M | T3 |
| T10 Non-EO profile research (fixture/replay) | P2 | L | T2 |
| T11 Enable iqoption full + spot capture-only (from T10) | P2 | M | T10 |
| T12 Contract locks + docs/runbook honesty | P2 | S | T2–T11 |

Suggested execution: one agent session for T1–T4 (session capture + refresh core); a second for T5–T7 +
T9 (metrics + config + approval); a third for T8 + T12 (extension framing + locks). T10 is the biggest
L-risk and is deliberately gated — the engine ships EO-first and stays honest about non-EO venues until
real fixture/replay research exists.

## Tasks (ordered)

- [x] **T1 — Baseline + re-verify ground truth (P1 · S).** Run `npm test` + `npm run typecheck`
  (`apps/dashboard/package.json:9,13`). Re-verify every claim marked **UNVERIFIED** in this spec against
  the actual files (list in Risks R2) and reconcile line drift. **Acceptance:** green baseline recorded;
  each UNVERIFIED claim re-checked and corrected in-place or marked confirmed. — Done: baseline re-run
  2026-08-29 = **94 files / 932 tests green**, `tsc -b --noEmit` exit 0 (pre-slice: 92/907). Every R2
  ref re-checked against the live files: `SITE_INDEX` trading rows `browserStudio.mjs:504-513` ✓,
  `PLATFORM_KINDS` `:541-552` ✓, vault `getSiteCredentials` `:126-131` ✓, `studioGoto` `:1856` ✓,
  `studioOpenSite` `:1885` ✓, `fillLoginFields` `:2728` ✓, `studioAutofill` `:2771` ✓, `domLoginSignals`
  `:2903` ✓ (spec printed the `:2859` region start — function head confirmed at 2903), studioLogin EO
  bolt-on `:3520-3528` ✓, `captureExpertOptionSession` `:3579-3655` ✓ (guest-not-saved `:3649-3651` ✓),
  `maskToken` `:3657-3661` ✓; `trading.mjs` `getCredentials` `:129` / `saveCredentials` `:134` +
  sanitizePatch blank-token guard `:143-150` ✓; `liveEO.mjs` feed-mode/VITEST prefs `:76-116` ✓,
  `restartLiveEO` `:1009-1022` ✓ (soft-reconnect-buffers comment confirmed); `scheduler.mjs` `every()`
  `:41-43` ✓, `ccxt-market-data` `:304-339` ✓, no import side effects ✓; `handlers.mjs` credentials gate
  `:1273-1309` (tokenChanged semantics `:1292-1302`) ✓; `auth.mjs` `verifyUser` `:188` ✓;
  `interventions.mjs` WRITE_STEPS `:39` / READ_STEPS `:42` / execStep `:140` / approval pause `:235-239`
  / runWorkflow `:354` ✓; `brokers.mjs` ccxt market-data row `:59-66` read-only ✓; EO host pin
  `browserStudio.login.test.mjs:297` ✓. No line drift required a code fix.

- [x] **T2 — Capture-profile registry + EO reference profile (P1 · M).** New
  `apps/dashboard/server/services/captureProfiles.mjs` with the full 10-venue table and the kind→strategy
  defaults; `expertoption` = `full` referencing `captureExpertOptionSession`
  (`browserStudio.mjs:3579-3655`), its `storageScan` (cookie/localStorage/sessionStorage + 32-hex rank
  `:3604-3621`) and `loginSignal` (`domLoginSignals` family `:2859-3119`). Other rows ship `catalog-only`
  or `capture-only` per Mechanism C. **Acceptance:** unit tests — `listCaptureProfiles()` returns all ten
  ids; kind mapping matches `PLATFORM_KINDS` (`browserStudio.mjs:541-552`); EO's `status:"full"`;
  `bybit/etoro/plus500/olymptrade/deriv` = `catalog-only`; a row can be flipped without changing the engine.
  — Done: `captureProfiles.mjs` ships the 10-row DATA TABLE (kinds mirror PLATFORM_KINDS exactly, pinned
  by a test-side literal); EO = `full` with `capture.via:"liveEO"` referencing the reference capture
  (its storageScan/loginSignal are documented on the row rather than duplicated — the engine delegates,
  so the reference stays the single source of truth); iqoption/binance/kucoin/okx = `capture-only`
  (`capture.via:null` — the hook is the T10/T11 deliverable); bybit/etoro/plus500/olymptrade/deriv =
  `catalog-only`; all rows `demoReal:"demo-first"` + default cadences (token 30 min / metrics 5–15 min).
  `captureProfiles.test.mjs` (20 tests) covers: ten ids + kinds, EO full, the 4+5 v1 honest states,
  `enabledCaptureVenues()` = hooks present (v1: EO), flip-without-engine-change (iqoption promoted by a
  data edit), copy-safe list, cadence clamp `[60s,24h]`, policy overrides.

- [x] **T3 — Headless login runner (vault → login → capture → save) (P1 · M).** New orchestrator
  `captureVenue(venueId)` in `captureProfiles.mjs`: resolve vault creds (`getSiteCredentials`,
  `browserStudio.mjs:126-131`); missing → honest `{ state:"needs-credentials" }` (never fabricate); open the
  venue via `studioOpenSite` (`:1885-1904`)/`studioGoto` (`:1856-1878`); fill via `fillLoginFields`/Google
  path (`:2728-2764`, `:3486-3530`); wait for `loginSignal` active; run the profile `capture` hook (EO →
  `saveCredentials`, `trading.mjs:134`); return masked `tokenChanged` + account. **Acceptance:** unit tests
  with a mocked page (the test harness `p.setUrl/p.setEval` model in `browserStudio.login.test.mjs` of the
  EO capture): missing vault creds → `needs-credentials` and NO `saveCredentials` call; guest token not
  saved (`browserStudio.mjs:3649-3651`); token value never in the returned object (mask via
  `maskToken`, `:3657+`) and never logged; EO host check still throws on non-EO URL
  (`:3582-3584`, pinned in `browserStudio.login.test.mjs:297`). — Done: `captureVenue(venueId, {page})` in
  `captureProfiles.mjs` (vault gate → dispatch → revive). **Deviation (documented):** v1 wires ONLY the EO
  reference — the generic open→fill→submit→wait loop is deferred to T10/T11 where per-venue selectors
  exist; EO reuses Mechanism-A verbatim (`captureExpertOptionSession` on the ACTIVE studio tab), which
  already performs saveCredentials internally. Runner: missing vault creds → `needs-credentials` with NO
  capture/save (hard constraint); host-lock / no-token thrown by the reference maps to honest
  `{state:"error", reason}` (never rethrows into the scheduler); guest sessions → `{state:"guest"}`, never
  saved; ok path compares before/after trading creds and returns `tokenChanged` + `reconnectTriggered`,
  with token values absent from the report (masking keeps them out of every return path). Tests:
  `captureProfiles.test.mjs` (mocked seams: needs-credentials no-save, guest no-save/no-revive, error
  mapping) + `captureVenue.test.mjs` (5, REAL reference implementation via the login.test.mjs fake-page
  harness, browserBridge mocked, tmp data dirs): missing-creds short-circuit incl. no token write,
  non-EO host → reason matches `/app\.expertoption\.(com|finance)/`, guest never saved, same-token flap
  guard, changed token → saved on disk + `restartLiveEO({force:true})` + no token in report/status
  (`JSON.stringify` asserted).

- [x] **T4 — Session-refresh scheduler + token-change revive (P1 · M).** New `"headless-session-refresh"` job
  (pattern of `scheduler.mjs:304-315`) iterating enabled venues at their cadence; on capture, when EO token
  CHANGED, call `restartLiveEO({force:true})` (`liveEO.mjs:1009-1022` — soft reconnect preserves buffers);
  unchanged → no-op (flap guard, per `handlers.mjs:1292-1302`). **Acceptance:** fake-timer test — token
  changed → `restartLiveEO({force:true})` called; same token / settings-only → no call (mirror
  `credentials.test.mjs:114-128` semantics); `restartLiveEO` soft-reconnect path asserted; no token in logs.
  — Done: scheduler.mjs registers `headless-session-refresh` (60 s tick, stagger 45 s, ccxt pattern)
  calling `headlessSessionRefresh()` → per-venue cadence gate (default 30 min token, clamped `[60s,24h]`,
  `setHeadlessSessionPolicy()` override seam that T7's per-user config will feed), enabled set = profile
  rows with a capture hook; error/needs-credentials runs do NOT count against the cadence (the next pass
  retries rather than waiting a full cadence for a capture that never ran). Token-change revive lives
  inside `captureVenue` exactly matching `handlers.mjs:1292-1302` semantics. Tests (captureProfiles.test.mjs):
  token changed → `restartLiveEO({force:true})` + report/status carry no token; same-token → no call;
  settings-only (risk% changed, token identical) → no call (mirrors credentials.test.mjs:114-128);
  fake-timer cadence gate (due → within-cadence skip → due again across the 30 min boundary); policy-enabled
  skip. Scheduler log lines carry only venue/state/tokenChanged — never token values.

- [x] **T5 — Account-metrics vocabulary + WS extractor (EO) (P1 · M).** New `accountMetrics.mjs`; vocabulary
  normalized from `accountFrom` (`expertoption.mjs:183-227`) and the `profile` frame path (`liveEO.mjs:420-426`).
  EO `extractVia:["ws"]` consumes accumulated frames (source leg `liveEO.mjs:435-452`) on the cadence.
  **Acceptance:** unit test — a `profile` frame produces a record with correct `demoWallet/realWallet/
  active/currency`, `sourceLeg:"ws"`, `observedAt` set; a frame with `balance:null` yields `balance:null`
  (NOT `0`); positions/exposure absent → `null`, not `[]`/`0`; a frame with balance `0` keeps `0`.
  — Done: `accountMetrics.mjs` ships the strict vocabulary parser (`parseAccountFrame`) + extractor
  (`extractAccountState`) + cadence collector (`accountMetricsRefresh`); `captureProfiles.mjs` rows gained a
  `metrics.extractVia` column (`expertoption:["ws"]`, others honest-empty) and ALL metric cadences were
  aligned to the spec's 5-min default (previously 15 min on the spot/cfd rows). **Deviation (documented):**
  the ws extractor consumes liveEO's NEW per-leg RAW profile cache (`lastRawProfile`, exposed via
  `liveEOAccountRaw()`, filled in the profile branch at `liveEO.mjs:420-426` BEFORE accountFrom flattens
  it) stamped with arrival time + source leg — NOT the flattened `account`, whose `num(...) ?? 0`
  collapses an absent balance into a fabricated 0 (exactly what this layer must never do). Parser truth
  table mirrors accountFrom's branches without any `?? 0` fallback: `balance:null` → `null`, genuine `0`
  stays `0`, legacy single-balance with no flag → `active:null` + that number on `balance` (wallet NOT
  guessed), ambient `balance` absent → both wallets `null`. `openPositions`/`exposurePct` stay `null` (no
  ws position handler yet — never `[]`/`0`). Collector runs on the SAME `headless-session-refresh` job as
  the session pass with its OWN per-venue metrics-cadence gate; a null observation stores nothing and
  leaves the gate open (retry, never a fabricated record). Tests: `accountMetrics.test.mjs` (28) — parser
  null-vs-zero truth table incl. the EO demo/real frames and raw app-object unwrapping; candle frames
  rejected; extractor most-recent-wins + sourceLeg/observedAt stamps; unknown venue / no-extractor → null;
  collector cadence gate + null-observation retry; policy seam feeds effective metrics cadence.

- [x] **T6 — Metrics store + read endpoint (P1 · M).** `server/data/account-metrics.json` store
  (tmp+rename + `VITEST` suppression, per `liveEO.mjs:76-116`), keyed by `userId`; `getAccountMetrics`/
  `putAccountMetrics`; `GET /api/trading/account-metrics` (`requireAuth`, `verifyUser` per `auth.mjs:188`).
  **Acceptance:** round-trip per user; no cross-user bleed; restart survives boot read; `stale` flag derived
  from `observedAt` vs cadence (older → `stale:true`); endpoint echoes `stale` + `sourceLeg`, never a
  fabricated `0`.
  — Done: store in `accountMetrics.mjs` (`server/data/account-metrics.json`, shape
  `{ [userId]: { [venueId]: record } }`, latest-record-wins, tmp+rename; disk rule = `!VITEST || env
  PICC_ACCOUNT_METRICS_DATA_DIR` — a vitest run only touches the file a test pointed at its own tmp dir).
  Endpoint `GET /api/trading/account-metrics` (+ `?venue=` filter): requires auth (localhost pass-through
  per the chart-prefs pattern), `userId = verifyUser(auth) ?? "default"`, per-venue record decorated with
  `stale` derived LIVE from `observedAt` vs the venue's effective metrics cadence (T7 prefs included); a
  venue with no observation is simply ABSENT from `venues` — never a zeroed/fabricated row. Tests:
  `accountMetrics.test.mjs` (store round-trip, cross-user isolation, absent venue → null, null-balance
  persisted, defensive copy, module-restart boot read via resetModules + tmp dir) +
  `accountMetricsApi.test.mjs` (10: empty-then-observed, live stale, `?venue`, absent venue absent, and
  per-user keying proven end-to-end with a REAL session token from `auth.createAccount`/`loginAccount`).

- [x] **T7 — Capture-config endpoints + per-user/venue cadence (P1 · M).** `GET/POST /api/trading/capture-config`
  persisting `{ venueId: { enabled, refreshCadenceMs, metricsCadenceMs } }` per user (prefs file pattern,
  `liveEO.mjs:83-116`); defaults 30 min token / 5 min metrics. **Acceptance:** cadence config round-trips
  per user; scheduler honors it; invalid cadence clamped to sane range; `VITEST` suppression keeps parallel
  tests isolated.
  — Done: endpoints in `handlers.mjs` + `saveCaptureConfigForUser`/`captureConfigForUser` in
  `captureProfiles.mjs` (`server/data/capture-config.json`, keyed per user, same env/VITEST disk rule via
  `PICC_CAPTURE_CONFIG_DATA_DIR`). Unknown venue rows dropped; cadences clamped `[60s,24h]`; POST applies
  the user's block to the RUNTIME policy seam immediately (`setHeadlessSessionPolicy` — scheduler honors
  it live, no scheduler code touched), and the boot read applies the `default` user's block (or the only
  block present) so prefs survive restarts. **Deviation (documented):** the runtime policy is
  process-global while the file is per-user — v1 assigns boot to `default` and live writes to whichever
  user POSTs last (single-real-user dashboard); multi-user keys are preserved on disk untouched. Removing
  a venue row replaces the runtime policy wholesale, so a deleted row re-enables profile defaults instead
  of leaving a stale override. Tests: `accountMetricsApi.test.mjs` — sanitize/clamp, live policy feed
  (`refreshCadenceMs` reported through `captureProfiles` right after POST), restart persistence
  (`headlessSessionStatus().enabled` + cadence after resetModules re-import), row-removal re-enables, GET
  round-trip, real-session per-user bucket vs the unauth `default` bucket. Full suite after T5–T7:
  **96 files / 970 tests green**, `tsc -b --noEmit` exit 0 (pre-slice 94/932).

- [ ] **T8 — Headless-status endpoint + popup framing (REQ-D) (P2 · M).** New read-only `GET /api/trading/
  headless-status` (localhost-gated + `requireAuth`): per-venue `{ status, lastCaptureAt, tokenChangedAt,
  lastMetricsAt, stale }`, honest `needs-credentials`/`not-enabled` states. Background worker polls it and
  writes `piccHeadlessStatus` to `chrome.storage.local`; popup reads it and renders per-platform rows
  (badge + last capture + stale tone). NO new message action; zero-DOM and read-only locks intact.
  **Acceptance:** `extensionIntegrity.test.mjs` stays green with no edits to its pinned action vocabulary
  (`:169`) or DOM-free checks (`:82-96`); popup renders `needs-credentials` honestly (never "connected");
  no `autopilot`/`buyOption`/`/api/trading/demo/place` tokens in the popup (`:77-78`).

- [ ] **T9 — First-login human-approval gate (REQ-E) (P1 · M).** Drive first login through the workflow DSL so
  WRITE_STEPS (`interventions.mjs:39`) become approval proposals (`:235-239`); demo-first default;
  real-wallet observed, never selected-for-trading. Approval echoed in the capture report; rejected proposal
  aborts capture honestly. **Acceptance:** first capture of a venue yields a `proposal` rather than an
  auto-executed login; approve → login proceeds + token captured + masked; reject → no token saved, state
  `rejected`; READ_STEPS (`:42`) still auto-run; existing `interventions` tests stay green.

- [ ] **T10 — Non-EO profile research: fixtures/replay (P2 · L).** For the nine non-EO venues: capture real
  login-page/DOM/WS fixtures (or documented replay) to pin `loginPage`, `storageScan` keys, `loginSignal`,
  and `metrics` extractVia. Record findings in the profile rows + a research log section in
  `docs/` (**UNVERIFIED** selectors/storage surfaces live here — the riskiest task). **Acceptance:** each
  non-EO venue row carries a source-fixed fixture or an explicit "not yet researched → catalog-only"
  marker; NO venue is promoted to `full`/`capture-only` without a fixture-backed profile; the engine stays
  honest (`not-enabled`) for unresearched venues.

- [ ] **T11 — Enable iqoption full + spot capture-only from T10 (P2 · M).** Flip the matrix rows the research
  supports: `iqoption` → `full`; `binance`/`kucoin`/`okx` → `capture-only` (token capture; metrics stay P3).
  **Acceptance:** capture-only venues capture + save a token and report `state:"ok"`; metrics endpoint
  still returns `null` (not fabricated) until their extractor lands; EO suite green.

- [ ] **T12 — Contract locks + docs (P2 · S).** Add pins: capture-config file schema + `VITEST` suppression;
  account-metrics record shape (no fabricated zeros); headless-status row shape; popup storage-key read
  list; EO-only tests that need updating (list below). Update `docs/TRADING_MULTIPLATFORM_ROADMAP.md` and
  `docs/ARCHITECTURE.md` (headless session capture + metrics data-flow, coverage matrix, demo-first rule).
  **Acceptance:** a deliberate violation (writing a `0` where a metric is missing, adding a message action
  without both ends, dropping `VITEST` suppression) fails its test, then reverts to a byte-identical tree
  green.

**Existing tests that pin EO-only behavior and would need DELIBERATE updates (count them):**
- `server/__tests__/browserStudio.login.test.mjs` — `captureExpertOptionSession` host-check (`:297`), EO
  guest/active/account capture (`:167-287`). T2/T3 keeps these green (EO unchanged) but they pin that
  capture is EO-only; T3 must prove non-EO capture does not regress them.
- `server/__tests__/phases1216.test.mjs` — `EO_APP_URL_RE` + `checkExpertOptionSessionLive` (`:72-76`).
  If a venue-agnostic liveness replaces the EO-only helper, these must be updated.
- `server/__tests__/liveEO.test.mjs` (profile/account handling) — unaffected unless the metrics store
  changes how `account` is emitted; T5 must keep the `account` emit contract (`liveEO.mjs:420-426`).
- `server/__tests__/extensionIntegrity.test.mjs` — MAIN-world sniffer EO-domains (`:32-35`) and pinned
  action vocabulary (`:169`). T8 MUST keep these green (REQ-D adds no automation and no message action).
- `server/__tests__/brokers.test.mjs` (`:29,:50-55`) — asserts `expertoption` remains the active executor;
  the headless engine must not change executor selection.

## Risks

- **R1 (most likely to bite): non-EO login selectors and token storage surfaces are UNVERIFIED.** The nine
  venues (bn, bybit, kucoin, okx, etoro, plus500, iqoption, olymptrade, deriv) may use social/2FA login,
  per-exchange cookie keys, or no discoverable token surface at all. If T10 is skipped, the engine either
  silently fails (honest `needs-credentials`) or — worse — captures the wrong value as a "token".
  Mitigation: T10 mandates fixture/replay research BEFORE any venue is promoted; the engine ships
  EO-first and reports `not-enabled` for unresearched venues; no venue claim is ever fabricated.
- **R2 — line drift.** Every `file:line` in this spec was read 2026-08-29; any drift since means a
  selector/storage claim could target the wrong seam. Mitigation: T1 re-verifies all UNVERIFIED lines and
  re-baselines; the spec's file:line facts are re-confirmed before T2+.
- **R3 — REQ-D touches the T9 message contract.** Adding a new popup↔background `sendMessage` action would
  break the pinned vocabulary (`extensionIntegrity.test.mjs:169`). Mitigation: REQ-D uses a storage-key read
  (not a message action) and keeps the worker as the only fetch-surface; T8 asserts the integrity test
  stays green byte-for-byte.
- **R4 — revival flaps a healthy session.** `restartLiveEO({force:true})` soft-reconnects unconditionally
  (`liveEO.mjs:1014-1020`). Mitigation: T4 only forces on a real token CHANGE; unchanged token + healthy is
  a proven no-op (flap guard, matching `handlers.mjs:1292-1302`).
- **R5 — metrics fabrication.** A missing balance/position silently recorded as `0` would poison exposure
  and equity curves. Mitigation: encoder yields `null` and the store/tests pin "no fabricated zeros"; REQ-B
  acceptance asserts `balance:null` for absent values and `null` (not `[]`/`0`) for absent positions.
- **R6 — first-login automation bypasses the approval gate.** If `captureVenue` fills/submits directly
  instead of through `interventions.mjs` WRITE_STEPS, the human-approval safety control is silently
  weakened. Mitigation: T9 routes the first login through the workflow DSL proposal path and asserts a
  `proposal` is produced before any mutating step runs.

## Honesty notes

- Demo/live gates, rate limiters (`handlers.mjs:4265-4308` localhost-only + 240/60 s ingest), auth gates,
  and the human-approval gate on mutating steps: untouched and preserved.
- Token values never enter this spec, logs, or responses — masking at `handlers.mjs:1279,1303` stays; token
  values are never logged by the capture or refresh path (a grep-the-write-path guard test is a T12 pin).
- Credentials for headless logins come ONLY from the vault (`browser-credentials.json`); when vault creds
  are missing the engine reports an honest `needs-credentials` state — it never fabricates a login or a
  session.
- Fabricated-state risk addressed head-on: the metrics store must never write `0` where a platform value is
  absent; REQ-B acceptance and a contract-lock test enforce `null`/`n/a` over zeros.
- The extension is read-only by construction (zero DOM surface, `extensionIntegrity.test.mjs:82-96`); this
  spec adds NO overlay/DOM automation — all automation lives server-side via `browserBridge`/`browserStudio`
  behind the workflow approval gate.
- No real-money orders — order placement is entirely out of scope; the first login defaults to
  paper/demo-first (REQ-E).
