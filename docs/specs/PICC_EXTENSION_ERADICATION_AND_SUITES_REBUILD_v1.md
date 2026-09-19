# PICC Extension Eradication + Trading-Suite Rebuild — spec v1

**Status:** IN PROGRESS (tracking document — updated every slice)
**Date:** 2026-09-17
**Scope:** (A) Remove every remaining Chrome-extension concept/leg from the dashboard (the extension is gone; Browser Studio is the mechanism). (B) Full-aware rebuild of the trading suite foundation: regime detection + novel-context enhancements on top of the MTF engine, advisory + execution paths, paper trading with income kept separate from real PnL. (C) Push-notification-based intervention in the separate Browser Studio window (expands later).
**Grounding rule:** every `file:line` below was read or verified this session where marked; audit rows come from a subagent sweep + targeted greps. Anything not re-read is marked **UNVERIFIED**. The mission brief is authoritative; where a requirement says "DATA-GAP" it degrades to honest emptiness, never a fabricated value.

---

## 0. Decisions locked by the user (2026-09-17)

| # | Question | Answer |
|---|----------|--------|
| D1 | Extension cleanup scope | **Remove EVERYTHING extension-related — clean break.** Not rename to "upstream". The concept is now unrelated to PICC. |
| D2 | `brokerLink.ts` bridge | **(a)+(b) on differing context**: use Browser Studio's RPC (studioTab open) where the studio context exists; plain `window.open` where it doesn't. User remains not-fully-clarified; executor picks per-seam the honest option and reports. |
| D3 | Priority order | Extension cleanup (foundation) → trading-suite rebuild → push-notification intervention. |
| D4 | Trading-suite scope | **Both** advisory-only AND execution path; incorporate paper trading for insights with **paper income separate from real income/PnL metrics** (note this distinction every surface). |
| D5 | Novel-context integration | **(a)+(b)**: regime detection layer on top of the MTF engine + enhancement of `mtfConvergence.mjs` presets with regime-aware state switching — a full-aware rebuild of everything the trading suite is based on. |
| D6 | Documentation | Anything not implemented now is recorded as todos in md files so it is never forgotten. Implement for all currently existing trading/crypto/etc. relevant context. |
| D7 | Firecrawl | Authenticated (CLI ✓, ~1,400 credits on free plan). Adhere to daily limits; write research outputs to `.firecrawl/`. |

---

## 1. Phase A — Extension eradication (foundation, must-ship first)

### A.1 Audit inventory (verified this session)

**Critical — broken logic, dead code paths (can never succeed):**

| # | Location | What is stale |
|---|----------|---------------|
| ~~A1.1~~ ✓ | `apps/dashboard/src/lib/brokerLink.ts` (whole file) | `openBrokerTab` uses dead `__piccCommand`/`__piccCommandAck` bridge (content.js gone). Always times out → always `window.open`. **Done (A-3):** rewritten → `browserTab({action:"open"})` RPC + `window.open` fallback. |
| A1.2 | `apps/dashboard/server/services/liveEO.mjs` | `FEED_MODES = ["auto","extension","studio"]` (`:89`), `legStats.extension` (`:451`), `upstreamStats = legStats.extension` (`:455`), `ingestAppFrame` (`:488-498`), extension branches in `processAppObject` (`:357,364`), `feedProvenance` extension paths (`:1077-1091`), `legs.extension` in stats (`:842,1109`), comments (`:149,344,360,482,503,600,957,963`). |
| A1.3 | `apps/dashboard/server/handlers.mjs:1115,1127` | feed-mode accepts `"extension"`; legs response carries `extension` row. |
| A1.4 | `apps/dashboard/server/services/scheduler.mjs:376-378` | reads `globalThis.__picc_ext_heartbeat?.captureEnabled` — nothing populates it. |
| A1.5 | `apps/dashboard/server/services/dataSources.mjs:39-40` | reads `stats.legs.extension.lastConsumedAt` to pick candleFeed (`"extension"` vs `"studio"`). |
| A1.6 | `apps/dashboard/server/services/autopilot.mjs:951` | returns `via: "extension"`, reason "extension feed streaming from your browser". |
| A1.7 | `apps/dashboard/server/services/adaptiveConfluence.mjs:863` | `candleSource: "liveEO-extension"` label. |
| A1.8 | `apps/dashboard/server/services/packObservers.mjs:102,167-168` | `SKIP_REASONS.extensionCaptureDisabled` path returns dead kill-switch reason + `source: "extension kill-switch"`. |
| A1.9 | `apps/dashboard/e2e/extension-sync.mjs` (whole file, 286 lines) | E2E harness loading the unpacked extension (`--load-extension`); inert. |
| A1.10 | `apps/dashboard/server/__tests__/extensionIngest.test.mjs` (whole file) | Tests `ingestAppFrame` extension-leg ingest. |
| A1.11 | `apps/dashboard/server/__tests__/extensionSelectors.test.mjs`, `extensionBoundary.test.mjs` | Import from `../../../extension-archived/src/*` (selectors, capture, session, check-boundary). |
| A1.12 | `apps/dashboard/server/errorLog.mjs:15,160` | "extension background/content/popup contexts" comments. |

**High — user-visible incorrect text:**

| # | Location | What is stale |
|---|----------|---------------|
| ~~A2.1~~ ✓ | `apps/dashboard/src/pages/Settings.tsx:153,201-203` | "extension toggle", "extension says enabled", "extension-only mode". **Done (A-3).** |
| ~~A2.2~~ ✓ | `apps/dashboard/src/components/TradingChart.tsx:183,239,408` | `feed === "extension"` → "Extension feed" / "Extension live" badge; "dead extension feed" comment. **Done (A-3).** |
| A2.3 | `apps/dashboard/server/services/packObservers.mjs:40` | pathway text "your own browser with the PICC extension". |
| A2.4 | `apps/dashboard/server/services/packRegistry.mjs:75` | `needs: "human demo-session login in the browser/extension; re-login on token expiry"`. |
| ~~A2.5~~ ✓ | `apps/dashboard/src/lib/settings.ts:12` | "Browser-extension suggestions and listing analysis." **Done (A-3).** |
| ~~A2.6~~ ✓ | `apps/dashboard/src/lib/income.ts:120` | "web-app-alone + extension-alone rule". **Done (A-3).** |

**Medium — stale comments/options (40+):**

| # | Location |
|---|----------|
| ~~A3.1~~ ✓ | `apps/dashboard/server/services/connectors.mjs:71,86,112,139,141-142,145,571` — **Done (A-4):** comments rewritten for the studio (cadence policy, origin list, JSDoc, registry view, Magic Eden note:571). |
| ~~A3.2~~ ✓ | `apps/dashboard/server/services/sessionCaptureSettings.mjs:2-4,39` — **Done (A-4):** header/JSDoc — settings toggle is THE authoritative gate (extension toggle retired, D1). |
| ~~A3.3~~ ✓ | `apps/dashboard/server/services/assetCatalog.mjs:13` — **Done (A-4):** "Browser Studio relay forwards raw frames; server normalizes". |
| ~~A3.4~~ ✓ | `apps/dashboard/server/services/prompts.mjs:53` — **Done (A-4):** "Browser Studio suggestion generation". |
| ~~A3.5~~ ✓ | `apps/dashboard/server/services/packRunner.mjs:23` (`extensionCaptureDisabled` constant) — **Done (A-4):** folded; `SKIP_REASONS` exact-vocabulary test updated (8 keys). |
| ~~A3.6~~ ✓ | `apps/dashboard/src/lib/__tests__/brokerLink.test.ts` (whole file tests dead bridge) — **Done (A-3):** rewritten (5 tests, RPC/fallback/reject). |
| ~~A3.7~~ ✓ | `apps/dashboard/src/components/__tests__/TradingSuite.deeplink.test.tsx:4` — **Done (A-3):** header comment updated. |
| ~~A3.8~~ ✓ | `apps/dashboard/src/components/__tests__/PackRegistryStrip.test.tsx:121,287` ("re-login in the extension") — **Done (A-6):** → "re-login in the browser". |
| A3.9 | `apps/dashboard/src/lib/__tests__/integrationPanels.test.ts:175` (`browserFound: true` fixture — keep, it's the studio browser) |
| ~~A3.10~~ ✓ | `apps/dashboard/server/__tests__/accountMetrics.test.mjs:32,136,141`, `captureProfiles.test.mjs:60`, `captureVenue.test.mjs:102`, `credentials.test.mjs:12` | mock `legs: { extension: {}, studio: {} }` / `sourceLeg: "extension"` — **Done (A-5):** mocks → `{ legs: { studio: {} } }`, extractAccountState fixture `leg: "studio"`. |
| ~~A3.11~~ ✓ | `apps/dashboard/server/handlers.mjs:1109,1417,2303,3750,4690`, `index.mjs:2` | comments referencing extension worker/poll/contexts/dev-loopback — **Done (A-6):** handlers.mjs comments → studio bridge/routing-poll/studio window/dev-loopback wording; `index.mjs:2` no longer claims `/api/extension/*` endpoints (they no longer exist — verified via grep: zero route registrations; endpoints were removed earlier, only the comment survived). |

**Low — archive disposal decision:**

| # | Item |
|---|------|
| A4.1 | `apps/extension-archived/` directory (Plasmo archive, node_modules, build/) — **decision needed**: keep as archive (git) or delete. Extension-selector tests currently import from it. Default per D1: keep directory in git as history (do not delete without explicit ask), but remove all dashboard imports from it. |

### A.2 Execution slices (each = one commit-capable unit, lands green)

- [x] **Slice A-1** — `liveEO.mjs`: delete extension leg (`FEED_MODES → ["auto","studio"]`, legStats.extension + upstreamStats alias, `ingestAppFrame`, extension branches in `processAppObject`/`feedProvenance`, `legs.extension` rows, extension comments). Studio leg + poll leg untouched. `extensionIngest.test.mjs` deleted; regression coverage ported into `feedMode.test.mjs` (10 tests, studio-leg). Also: `gateAccepts` comment honest about single-leg; `currentStatus` now flips to "connected" on fresh studio frames (fix: old code only checked extension here); `stopLiveEO` clears buffers unconditionally (studioOff detaches in the same call — nothing keeps feeding after stop).
- [x] **Slice A-2** — consumers of the leg: `handlers.mjs` feed-mode (valid set `["auto","studio"]`, single studio leg row), `dataSources.mjs` candleFeed (studio-only provenance, null when nothing consumed), `autopilot.mjs` (extension-liveness leg removed — `via:"studio"`/`"none"` only), `adaptiveConfluence.mjs:863` (`candleSource: "liveEO"`), `scheduler.mjs` (`__picc_ext_heartbeat` read → explicit honest `null`, comment already said relay gone).
- [x] **Slice A-3** — client: `brokerLink.ts` rewritten per D2 — dead `__piccCommand` postMessage bridge deleted, now `browserTab({action:"open", url})` RPC (new server `studioTab` "open" action = find-or-create, trailing-slash-insensitive, focuses existing venue tab instead of stacking duplicates), with plain `window.open(url,"_blank","noopener")` fallback when the studio is closed (`ensureOpen` throws `BROWSER_CLOSED`). `api.ts` `browserTab` union widened to include `"open"`. Copy fixes: `Settings.tsx` capture paragraphs (no extension toggle left — capture runs on each studio pass), `TradingChart.tsx` `"Extension feed"`/`"Extension live"` branches removed, `lib/settings.ts` overlay desc, `lib/income.ts` migration comment. Tests: `brokerLink.test.ts` rewritten (5 tests — RPC path, window.open fallback, non-https reject), `browserStudio.tabSync.test.mjs` +find-or-create test (6 tests), deeplink mock shape unchanged (6 tests).
- [x] **Slice A-4** — capture/pack layer, done: `packObservers.mjs` — dead `captureEnabled` seam removed (param, extension kill-switch block + `extensionCaptureDisabled` skip, observed rows, header/honesty JSDoc, `capturePathway` copy, "browser with the PICC extension" pathway step → studio/own browser), `killSwitchSkip` now session-only; `packRunner.mjs` folded `extensionCaptureDisabled` (SKIP_REASONS now 8 keys); `packRegistry.mjs` needs string ("re-login in the browser"); `sessionCaptureSettings.mjs`/`connectors.mjs`/`assetCatalog.mjs`/`prompts.mjs`/`errorLog.mjs` comments; `scheduler.mjs` — no longer passes `captureEnabled: null`, comment simplified ("no browser-side kill-switch anymore — the studio leg is the only capture path"); `index.mjs` comment kept (legit `/api/extension/*` API path). Tests: `packObservers.test.mjs` — 4 extension-kill-switch tests removed, remaining updated to studio-only leg (`sourceLeg: "studio"`, `feedMode: "studio"`, no captureEnabled rows) = 38 tests; `packRunner.test.mjs` vocabulary + `sourceLeg: "studio"` fixture = 12 tests. Full gate: 205 files / 2098 tests, typecheck clean.
- [x] **Slice A-5** — tests + e2e, done: deleted `e2e/extension-sync.mjs` (manual E2E harness that loaded the unpacked extension into Edge — dead, referenced the removed `extensions/picc-overlay`); deleted `extensionSelectors.test.mjs` (13 tests) + `extensionBoundary.test.mjs` (2 tests) — both imported ONLY from `extension-archived/` (dead code; the archived selectors/capture/session logic has live equivalents covered by `expertoption.session.test.mjs`, `expertoption.test.mjs`, `browserStudio.*`, `connectors.test.mjs`, `autodetect.test.mjs`). This fulfills A4.1's "remove all dashboard imports from extension-archived" (directory kept in git as history). Mock rows fixed: `liveEOStats` mocks in `accountMetrics.test.mjs`/`captureProfiles.test.mjs`/`captureVenue.test.mjs`/`credentials.test.mjs` → `{ legs: { studio: {} }, lastSeen: 0 }` (matches liveEO's real single-leg shape), and the extractAccountState fixture now uses `leg: "studio"`.
- [x] **Slice A-6** — sweep + absence-pinning test, done. Grep of the whole dashboard (src + server, all ext) for `extension|content.js|chrome.runtime|PICC extension|extension-archived`: **14 matches remain, ALL legit** — Fibonacci math levels ×3 (`indicators.mjs:852-911`, `trading.ts:1066`, `AdvancedIndicatorsPanel.tsx:205`), Automatad's third-party note (`streamCatalog.ts:106`, describes an external product), Chromium's own profile cache dir name (`browserBridge.mjs:263` `extensions_crx_cache` — checked into the studio-bridge lock-marker list, not PICC's extension), and the intentional legacy-coercion test (`feedMode.test.mjs:14-15,40,42` — proves a stored `"extension"` feed-mode preference degrades to `"auto"`). Fixes during sweep: `handlers.mjs` (5 comments: feed-mode, routing-poll, studio-window frames, dev-loopback), `accountMetricsApi.test.mjs:199` (extension worker's poll → studio routing poll), `autodetect.test.mjs:30`, `phases1216.test.mjs:64`, `PackRegistryStrip.test.tsx:121,287` (A3.8), `useCandleData.ts:82,103` (feed comment now `"studio" | "auto" | null`), `autopilot.mjs:948` + `sessionCaptureSettings.mjs:3` decision markers reworded ("only browser leg"/"no browser-side toggle"), `mtfConvergence.test.mjs:167` test title (trading-term wording), `index.mjs:2` + `prompts.mjs:53` — **verified the `/api/extension/*` endpoints no longer exist server-side** (zero route registrations; only the comment survived) → updated to honest wording. New **A-6 regression test** `server/__tests__/extensionAbsence.test.mjs` (mirrors `MinistryRoom.studio` absence pattern): reads the REAL source of 25 key modules (liveEO, packObservers, packRunner, packRegistry, scheduler, dataSources, autopilot, adaptiveConfluence, captureProfiles, accountMetrics, assetCatalog, connectors, sessionCaptureSettings, errorLog, handlers, index, prompts, browserStudio, brokerLink.ts, api.ts, useCandleData.ts, Settings.tsx, TradingChart.tsx, income.ts, settings.ts) and pins ZERO occurrences of `extension` (case-insensitive) + zero live-extension/dead-bridge tokens (`chrome.runtime|storage|tabs|alarms`, `content.js`, `__piccCommand`, `extensionCaptureDisabled`, `captureEnabled`, `PICC extension`, `extension kill-switch`) — 50 tests pass. Note: `feedMode.test.mjs` is deliberately NOT pinned (its `"extension"` strings are the D1 coercion proof).
- [x] **Slice A-7** — docs/specs sweep, done 2026-09-17. Classified every `docs/specs/*.md` by extension mentions (per-file counts via Select-String) and fixed or exemption-recorded each:

  **FIXED (current-architecture specs — stale extension seams rewritten to studio reality):**
  - `PICC_EMBEDDED_BROWSER_STUDIO_v1.md` — full Phase-C EXECUTED banner + C1–C6 done markers, REQ-6/7/9 rewrite, B1/B3/B4 single-switch, risks/honesty/open-questions closed, A-6 registry note (phase C was this doc's own removal choreography — done ahead of gate).
  - `PICC_FRONTEND_UI_ENGINE.md` — REQ-1 feed-mode selector `auto | studio` (extension mode removed, A-2), REQ-3 chip sources studio/headless/none, REQ-5 division of labor reworded (no extension/popup), layout anchor `/api/extension/status` → studio surfaces, popup section → Studio surface, U1/U3/U5 tasks rewritten, U1–U6 acceptance updated.
  - `PICC_NOTIFICATION_AND_ALERT_UX_v1.md` — REQ-6/9/10, Decision D/E/G, T8 (marked DONE/superseded by D2/A-3), risk row, honesty note, reconciliation item 1: `open-broker-tab`/`extensionCaptureConfigs()` → `studioTab "open"` RPC / `studioCaptureCatalog()`.
  - `PICC_SIGNAL_VENUE_POOL_DECISION.md` — `extensionCaptureConfigs()` → `studioCaptureCatalog()` (3 sites, D1 note), extension-integrity mention → studio bridge contract tests.
  - `PICC_SESSION_POLICY_AND_CHANNEL_CATALOG.md` — D1 banner (checklist item 7 removed with popup; items 1–6,8 live), problem 3 + R6 + item 7 marked historical.
  - `PICC_MULTISOURCE_ENGINE.md` — D1 banner (extension leg gone; feed modes `["auto","studio"]`, legStats studio-only — verified in code), REQ-3 leg set {studio, headless, yahoo, ccxt}, Mechanism C + T4 acceptance + R4 reworded off the dead extension window.
  - `PICC_SUITE_MINISTRY_MODEL_v1.md` — REQ-14 + T7 = SUPERSEDED by D1 (capture/studio generalization is the successor), T6 settings list drops "extensions".
  - `PICC_TRADING_SUITE_UPGRADE.md` — T6 capabilities row: `extensionSensor` field removed (A-5; now `browserFound`), acceptance "sensor not found" → "browser not found".
  - `PICC_UNIVERSAL_4FA_ENGINE.md` — row 24 extension session-sync open item CLOSED by D1 (studio leg), T13 table row + body (real tab → studio), R7 reworded, honesty sample `candleSource:"liveEO-studio"`.
  - `COMMAND_CENTRE_WEB_SPEC.md` — 3 prose rows "backend, extension and scripts" / "backend/extension" → studio browser; deferred item "extension-based account tracking" → studio-based.
  - `PICC_STUDIO_SIMPLIFICATION_AND_SOURCE_LANDING_v1.md` — out-of-scope line notes Phase C EXECUTED by D1; risk row "extension still live pre-Phase C" → premise MOOT.
  - `PICC_TRADING_SITES_CATALOG_v1.md` — `kind: capture` description → studio capture path; EO row human-only step → studio-browser capture; "Trade on {venue}" → studio-collect model.

  **EXEMPT (historical/decision/planning — recorded, not rewritten):** `EXTENSION_CONNECTIVITY_ENGINE.md` (48 — the extension-engine spec itself), `PICC_HEADLESS_CAPTURE_ENGINE.md` (36 — D1 banner added: T13's extension-primary-capture direction reversed), `PICC_INCOME_GENERALIZATION_{requirements,design,checklist}_v1.md` (24/36/36), `NEXT_WAVE_generalization.md` (27 — plasmo slice already archived 2026-09-03 per A6), `PICC_EXPLICIT_AUDIT.md` (14 — closed audit findings), `PICC_EXTENSIONS_RESEARCH_v1.md` (13 — research), `PICC_PACK1_LOCAL_TRADING_CORE_v1.md` (19 — PROPOSED, D1 banner added), `PICC_BANDWIDTH_SUITE_design_v1.md` (17 — found-normal REJECT per ADR-0002), `MTF_CONVERGENCE_ENGINE.md` (1 — English word "an extension of ConfluencePanel.tsx"), `PICC_ALGORY_REVERSE_ENGINEERING_v1.md`/`PICC_ALGORY_FINDINGS_v1.md` (1+ — third-party Algory analysis), `PICC_RESOURCE_GOVERNOR_v1.md`/`PICC_EARNINGS_AGENTIC_MINISTRY_v1.md` (0 relevant — stanza-clean).

  **Verification after edits:** re-grep of the twelve fixed files shows zero non-historical "extension"/"extensionSensor"/"extensionCaptureConfigs"/"open-broker-tab"/"popup.js"/"content.js" claims; the A-6 absence test still passes (docs aren't in its module list — code untouched by A-7). Code anchors confirmed before editing: `FEED_MODES=["auto","studio"]`, `legStats` studio-only (`liveEO.mjs`), `studioCaptureCatalog()` at `captureProfiles.mjs:591-593`, `browserFound` in capabilities (`handlers.mjs`), no `extension` anywhere in `dataSources.mjs`/`liveEO.mjs`.

### A.3 Phase A non-goals

- Do NOT delete `apps/extension-archived/` from disk without an explicit user ask (history archive).
- Do NOT weaken demo/live gates while removing the extension leg.
- Do NOT change `browserBridge.mjs` functionality (it's the studio bridge, not the extension).

---

## 2. Phase B — Trading-suite full-aware rebuild (the "everything" work)

### B.1 User directives

- Full-aware rebuild of EVERYTHING the trading suite is based on (D5: regime detection + MTF enhancement, both).
- Advisory AND execution paths (D4).
- Paper trading incorporated for insights; **paper income is separate from real income/PnL metrics** — every surface must distinguish them (never merge, never zero-fill).
- "Implement for all currently existing trading/crypto/etc. relevant context" — assets: trading, crypto, metals, energies, indices, forex, equities as currently cataloged.

### B.2 Research inputs (verified this session via web search)

Novel-context patterns PICC's MTF engine currently lacks:

| Source | Pattern | PICC gap → slice |
|---|---|---|
| PHANTOM (regime engine) | Choppiness Index + ATR ratio + ADX + HTF Supertrend → TRENDING/RANGING/UNCERTAIN; dual-mode strategy switching; edge filters (funding rate, taker ratio, correlation, time-of-day sizing) | Regime layer (B-slice) |
| RegimeSense (HMM) | Regime classification (bull/choppy/high-vol/crisis) with **soft allocation** via posterior probabilities, not hard switching | Soft-blend option in regime routing |
| Hakimi AI Trader | Calibrated probabilities → size by conviction | Confidence-based sizing indicator |
| Bull Machine | 7-layer confluence (Wyckoff/SMC/HOB/momentum/fib/time), regime-adaptive stops, fusion×ADX sizing | Extra confluence layers = extension of MTF dimensions |
| RegimeNAS (arXiv 2508.11338) | Multi-head attention across timeframes for regime ID + uncertainty quantification | Long-term research note (not P1 — no GPU, no new deps) |
| MTF research (repo docs) | Sobreiro 2026: HTF-alignment look-ahead inflates ROC-AUC ~0.20; honest band ~54-61% WR cost-fragile | Reuse MTF spec R9/R12 discipline; never ship claimed win-rates |
| browser-use / Nova Act HITL | Approval + UI-takeover HITL with screenshot, notification channels, timeout | Push-notification intervention design (Phase C) |

**Firecrawl tasks (free-plan budget-minded):**
- [x] ~~`firecrawl search "MTF confluence engine open source" --scrape` → `.firecrawl/mtf-confluence.md` (1 search, 2 credits).~~ SKIPPED — superseded: MTF research already consolidated in `MTF_CONVERGENCE_ENGINE.md` (Sobreiro honest-band discipline), and the B.3 slices were specified + shipped without needing new artifacts.
- [x] `firecrawl search "chopiness index regime detection trading"` → `.firecrawl/choppiness-regime.md` (only if needed). — not needed: Choppiness index shipped directly in `regimeEngine.mjs` (B.3 Regime layer, done in `bf99e09`). Closed as superseded by direct implementation.
- [x] `firecrawl research search-papers "regime detection multi-timeframe trading"` → `.firecrawl/research-regime.md` (free-plan credit; check balance first). — skipped with the other research tasks; regime detection delivered from existing domain knowledge + ADR-disciplined thresholds. Closed as superseded by direct implementation.

### B.3 Phase B slices (draft — to-spec needed before implementation)

- [x] **Spec**: `docs/specs/PICC_TRADING_SUITE_REBUILD_v1.md` via to-spec skill (problem/solution/stories/decisions/testing/out-of-scope). — DONE, shipped in `6046b63`.
- [x] **Regime layer**: new pure `regimeEngine.mjs` (or extend `mtfConvergence.mjs`): regime classification per asset from ADX/Choppiness/ATR-ratio; regime-aware state switching for MTF presets (conservative in UNCERTAIN, trend-mode in TRENDING, mean-reversion bias in RANGING). — DONE in `bf99e09`: `regimeEngine.mjs` + `regimeDetection.mjs` adapter.
- [x] **Fusion**: optional 2nd-order confluence dimensions (regime × MTF state) — documentary, not new MODELS. — DONE in `bf99e09`: documentary `weight:0` layers (integrationPanels/convergenceDisplay), never move verdict.
- [x] **Execution path**: advisory currently; execution = human-approved only (paper → real opt-in via 4FA-style gate). Never auto-execute. — DONE in `bf99e09`: `interventions.suiteTrade` approval gate + `executionAbsence` pin.
- [x] **Paper income separation**: paper PnL ledger keyed separately; every portfolio/metric surface renders `paperIncome` and `realPnl` distinctly. — DONE in `bf99e09`: separate buckets (B-PAP-2), no merged total; `paperRealSeparation` pin.
- [ ] **Push-notification intervention**: see Phase C. — DEFERRED to Phase C by design (own to-spec, `PICC_PUSH_INTERVENTION_v1.md` not drafted).

---

## 3. Phase C — Push-notification intervention in the separate browser window

- Mechanism: server detects an intervention-worthy condition (convergence state crossing, paper insight, execution approval) → in-app + web-push notification (existing notifier, `channels: inApp/webpush/webhook`) → push payload carries a deep-link to the intervention surface → Browser Studio window (window-first, real, visible) opens the intervention page → human approves/denies inline.
- Reuse: `PICC_NOTIFICATION_AND_ALERT_UX_v1.md` REQ-8 (single push subscription) + `useWebPush.ts`; `browserStudio.mjs` open-tab RPC; notifier `dispatchAlert` seam.
- Expand-later: deeper HITL (screenshot capture, timeout, multi-channel), execution confirmation.
- Slices to be drafted with to-spec (separate spec file `PICC_PUSH_INTERVENTION_v1.md`).

---

## 4. Delete-zone (intentional removals — recreation requires a new ADR)

| Path/concept | Why removed | Replacement | Revisit condition |
|---|---|---|---|
| Chrome extension (`apps/extension-archived/` + content/background/popup) | Replaced by Browser Studio (window-first) | `browserStudio.mjs` | Only via a new approved ADR |
| `ingestAppFrame` / extension leg / `__picc_ext_heartbeat` | Dead code paths, never fire | `ingestStudioFrame` | — |
| `SKIP_REASONS.extensionCaptureDisabled` | Dead kill-switch | fold into `sessionCaptureDisabled` | — |
| `e2e/extension-sync.mjs` | Inert harness | Browser Studio E2E (future) | — |
| `/api/extension/*` route family | Gone already (verified: no route in handlers.mjs) | Browser Studio API + `/api/browser/*` | — |

---

## 5. Honesty notes

- Paper income ≠ real PnL — every metric surface distinguishes them (D4); tests must assert the two buckets exist separately.
- Execution path: paper/real opt-in never weakens the existing 4FA/demo gates; advisory is the default forever.
- Unconfigured ≠ zero-filled; `source:"none"` honest emptiness everywhere.
- Verify-before-claim: every slice runs its own tests; full suite + typecheck before any "done" report.