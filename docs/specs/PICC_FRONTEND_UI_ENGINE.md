# PICC Frontend UI Engine — spec v1 (Phase 3)

**Status:** Draft for execution · **Date:** 2026-08-28 · **updated 2026-09-17 (D1 clean break):** the browser extension is gone; feed modes are `["auto","studio"]`, and the `/api/extension/status` endpoint no longer exists. Extension-referencing rows below are retained as the historical plan but the LIVE seams they must consume are the studio variants marked in each row.
**Extends:** `docs/specs/EXTENSION_CONNECTIVITY_ENGINE.md` (Phases 1) · `docs/specs/PICC_EXPLICIT_AUDIT.md` (Phase 2)
**Supersedes:** nothing; consumes Phase 1's server/status surfaces.
**Grounding rule:** claims cite files read this session; anything not re-read is marked UNVERIFIED.

## Requirements (each testable — UI claims are asserted via component tests)

- **REQ-1 — Hybrid feed panel on `/suites`.** A visible panel shows: feed mode selector (auto | studio — the `"extension"` mode was removed in the D1 clean break, A-2), the *active* upstream leg for the last received frame, honest states (studio offline = "studio offline", never "connected"). Mirrors the runbook's studio-era `FEED` expectation.
- **REQ-2 — Chart honesty surfaces.** TradingChart consumes Phase 1's resolved-timeframe data: warning banner names requested vs served resolution + source; disabled timeframe buttons explain why (`TradingChart.tsx:90,119-136`).
- **REQ-3 — Status chip accuracy.** The dashboards' live/connected chips reflect the *actual* source of the data they render (studio leg / headless / none), matching `realtimeSuite.mjs` fault-isolated statuses (verified earlier this session; line refs UNVERIFIED).
- **REQ-4 — One SSE bus, zero leaks.** All realtime consumers (suites + per-chart ticks) share the singleton bus from Phase 1 T8; navigation to a non-suite route unsubscribes correctly (refcount to 0 closes the stream).
- **REQ-5 — Division of labor preserved.** No decision/confidence logic moves into the studio browser or any browser surface; web app remains the only analyzer. The studio stays a status surface.

## Design

- **Suite layout anchor:** `/suites` route + `SUITE_META` in `src/pages/Suites.tsx` (structure verified earlier this session; line refs UNVERIFIED — re-read before coding). Feed panel joins the trading/status column next to the suite stream components; data comes from `liveEOStats()`'s `feed` block + `realtimeSuite` statuses (the extension-era `/api/extension/status` read at `handlers.mjs:4211-4223` was removed with the D1 clean break).
- **Chart wiring:** `useCandleData` (`src/hooks/useCandleData.ts`, verified this session) already returns `source` and `resolvedTimeframe`; TradingChart already renders `SOURCE_BADGES` (`src/components/TradingChart.tsx:22-27`) and the mismatch warning (`:132-136`). Phase 3 replaces the 86400-only guard and adds the disabled-button tooltips; no new data path.
- **SSE consumption:** extend the shared bus (Phase 1 T8) so `useRealtimeSuite.ts` (singleton + refcount, verified earlier this session) and `useCandleData` subscribe to the same stream. `liveTrading.ts` remains the place where the raw SSE lives (**its exported helper names UNVERIFIED — re-read before replacing `useCandleData.ts:235`'s fetch**).
- **Studio surface (was popup):** the extension popup is gone (D1 clean break); the equivalent status surface is the Browser Studio page/dockable. Add honesty copy: "Read-only aggregation. PICC never spends, trades or submits on your behalf." and a data-source line.
- **Copy standards:** every live/offline label grounded in a real status field; unconfigured ≠ zero-filled (`TRADING_MULTIPLATFORM_ROADMAP.md:179-180`); AI-interaction disclosure already present (`docs/COMPLIANCE.md:41-54`) must be preserved across any studio rewrite.

## Non-goals

- No reintroduction of overlay dockables *in broker pages* (capture is studio-side and DOM-free by the v2.0.0 contract); this phase is web-app UI only.
- No new analytics/computation in the studio browser (REQ-5).
- No styling-system rewrite; no charting-library change (lightweight-charts stays, `apps/dashboard/package.json:20`).
- No touch to rate limits, gates, credentials, or vault paths.

## Tasks

- [ ] **U1 — Feed panel.** Mode selector persists via Phase 1's prefs seam (`src/lib/trading.ts` prefs, `TradingSuite.tsx:256-352` surface — re-verify endpoint name); renders active leg + honest offline copy. **Acceptance:** component test sets each status fixture (studio-only, none) and asserts the exact rendered label; selector round-trips through the prefs endpoint in a test double.
- [ ] **U2 — Chart honesty UI.** Mismatch banner for any served-vs-requested divergence; disabled buttons with tooltip; badge shows `Yahoo daily · delayed` for 86400+ sources via existing `SOURCE_BADGES` entries. **Acceptance:** component tests: served 60 vs requested 5 → banner "showing 1m bars (expertoption)"; only EO configured → 5 s/15 s/30 s/30 m/4 h buttons disabled.
- [ ] **U3 — Status chip wiring.** LiveMarketBoard / suite status chips consume the real source-of-last-frame. **Acceptance:** with the studio feeding but no headless session, chips show the studio leg and never "connected" when `sendTimestamp` is stale.
- [ ] **U4 — SSE bus migration.** All consumers use the Phase 1 bus; route change unsubscribes. **Acceptance:** network fixture asserts exactly one `/api/trading/realtime` fetch per page across suite + 2 charts; navigating away closes it (refcount 0).
- [ ] **U5 — Studio status surface.** Shows session alive/dead + feed leg + honesty copy. **Acceptance:** component test with mocked status fixtures; copy assertions include the read-only sentence.
- [ ] **U6 — Docs + compatibility.** `docs/TRADING_RUNBOOK.md` Part-B feed-panel steps; `docs/ARCHITECTURE.md:69-85` UI block updated; demo/live gate labels unchanged. **Acceptance:** reviewer diff; grep shows no UI copy claims conflicting with the Phase 1/2 ledger.

## Risks

- **R1: stale-premise creep.** Phase 3 UI must not be designed against the pre-Phase-1 protocol (functions that don't exist yet, mislabeled resolutions). Each U-task consumes a Phase 1 surface by name; if that surface is missing, the task is blocked, not redesigned.
- **R2: SSE bus leak regressions** (double-stream when a second singleton is introduced, or refcount drift leaving streams open). U4's network assert is the guard; keep the bus in `liveTrading.ts`/one manager file.
- **R3: copy drift on studio honesty** — the read-only sentence is a compliance surface; U5 asserts it in test, not just copy review.

## Honesty notes

- No gate/rate-limit changes; no credential/value forwarding via the studio or any browser surface.
- Fabricated-state risk is the inverse here: UI must not paint "live" when the session is offline — every label maps to a real status field (REQ-3).
- UNVERIFIED re-read list: `Suites.tsx`/`useRealtimeSuite.ts`/`liveTrading.ts` exact line refs, `realtimeSuite.mjs` line refs, Trading-Suite prefs endpoint name, current studio page/dockable shape.