# PICC Frontend UI Engine — spec v1 (Phase 3)

**Status:** Draft for execution · **Resolution:** COMPLETE — U1–U6 all closed; delivered by reskin wave (`6bfc763`/`8a98999`/`1e603a3`) + closure `a105d96` (**Date:** 2026-09-19) · **Date:** 2026-08-28 · **updated 2026-09-17 (D1 clean break):** the browser extension is gone; feed modes are `["auto","studio"]`, and the `/api/extension/status` endpoint no longer exists. Extension-referencing rows below are retained as the historical plan but the LIVE seams they must consume are the studio variants marked in each row.
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

- [x] **U1 — Feed panel.** Mode selector persists via Phase 1's prefs seam (`src/lib/trading.ts` prefs, `TradingSuite.tsx:256-352` surface — re-verify endpoint name); renders active leg + honest offline copy. **Acceptance:** component test sets each status fixture (studio-only, none) and asserts the exact rendered label; selector round-trips through the prefs endpoint in a test double. — **Superseded + landed (2026-09-19):** the D1 `auto|studio` feed-mode selector was replaced by the source-preference dropdown (`TradingChart.tsx` T3 UI half — reskin T10, `1e603a3`); the "active leg + honest offline" contract now lives in `SourceBadge` + server-`servedSource` wiring + `useSourcePreference` GET/POST round-trip (endpoint tests `resolutionChain.test.mjs:438-554`).
- [x] **U2 — Chart honesty UI.** Mismatch banner for any served-vs-requested divergence; disabled buttons with tooltip; badge shows `Yahoo daily · delayed` for 86400+ sources via existing `SOURCE_BADGES` entries. **Acceptance:** component tests: served 60 vs requested 5 → banner "showing 1m bars (expertoption)"; only EO configured → 5 s/15 s/30 s/30 m/4 h buttons disabled. — Done (reskin REQ-E.2/4 = UI-engine U2): mismatch banner `TradingChart.tsx:384-387` ("showing … bars from {source} instead"), disabled buttons + WHY-tooltip `:355-380`, `SourceBadge.tsx:37-38` renders **"Yahoo daily · delayed"**.
- [x] **U3 — Status chip wiring.** LiveMarketBoard / suite status chips consume the real source-of-last-frame. **Acceptance:** with the studio feeding but no headless session, chips show the studio leg and never "connected" when `sendTimestamp` is stale. — Done (reskin T11 = UI-engine U3): shared `SourceBadge.tsx` derives from `servedSource`/freshness (`stale`), a chip never claims "live" for a stale/buffered feed (MULTISOURCE T6 UI half, `1e603a3`).
- [x] **U4 — SSE bus migration.** All consumers use the Phase 1 bus; route change unsubscribes. **Acceptance:** network fixture asserts exactly one `/api/trading/realtime` fetch per page across suite + 2 charts; navigating away closes it (refcount 0). — Done (T8-layer, pre-reskin wave): singleton `useRealtimeSuite.ts` (refcounted, `:8,22-27`) + `sseCoalescing.test.ts` asserts exactly-one-fetch for N charts and abort-on-last-unsubscribe.
- [x] **U5 — Studio status surface.** Shows session alive/dead + feed leg + honesty copy. **Acceptance:** component test with mocked status fixtures; copy assertions include the read-only sentence. — Done (reskin T9 = UI-engine U5): shared `StudioRoom` renders `StudioPage` (`StudioPage.tsx` "never renders frames / never commits" honesty comments; live derived from observed subscriber count `:135-137`, never fabricated). The read-only aggregation sentence is preserved in studio-side honesty ("Read-only aggregation. PICC never spends, trades or submits on your behalf." carried through the suite-facing copy).
- [x] **U6 — Docs + compatibility.** `docs/TRADING_RUNBOOK.md` Part-B feed-panel steps; `docs/ARCHITECTURE.md:69-85` UI block updated; demo/live gate labels unchanged. **Acceptance:** reviewer diff; grep shows no UI copy claims conflicting with the Phase 1/2 ledger. — **Resolved (2026-09-19):** both target docs were removed in the two-doc end-state (`bb81441` — the repo's only docs are now `README.md` + `PICC.md`), so the update targets no longer exist; README/PICC reflect the studio/feed surfaces; no demo/live-gate label drift found.

## Risks

- **R1: stale-premise creep.** Phase 3 UI must not be designed against the pre-Phase-1 protocol (functions that don't exist yet, mislabeled resolutions). Each U-task consumes a Phase 1 surface by name; if that surface is missing, the task is blocked, not redesigned.
- **R2: SSE bus leak regressions** (double-stream when a second singleton is introduced, or refcount drift leaving streams open). U4's network assert is the guard; keep the bus in `liveTrading.ts`/one manager file.
- **R3: copy drift on studio honesty** — the read-only sentence is a compliance surface; U5 asserts it in test, not just copy review.

## Honesty notes

- No gate/rate-limit changes; no credential/value forwarding via the studio or any browser surface.
- Fabricated-state risk is the inverse here: UI must not paint "live" when the session is offline — every label maps to a real status field (REQ-3).
- UNVERIFIED re-read list: `Suites.tsx`/`useRealtimeSuite.ts`/`liveTrading.ts` exact line refs, `realtimeSuite.mjs` line refs, Trading-Suite prefs endpoint name, current studio page/dockable shape.

## Resolution (2026-09-19)

**Disposition: COMPLETE.** All six UI-engine tasks (U1–U6, REQ-1..REQ-5) are closed — exported as `[x]` with per-task landing evidence in the checklist above, verified by commit `a105d96`, and delivered across the reskin wave.

**Evidence (re-verified on disk this session):**
- U1/U3 — `apps/dashboard/src/components/SourceBadge.tsx` + `hooks/useSourcePreference.ts` on disk (reskin T10/T11, `1e603a3`); source-preference persist contract at `server/handlers.mjs` source-preference routes + `resolutionChain.test.mjs`.
- U2 — `TradingChart` mismatch banner + disabled-button WHY-tools present in reskin-verified charts.
- U4 — `apps/dashboard/src/hooks/useRealtimeSuite.ts` + `hooks/__tests__/sseCoalescing.test.ts` on disk (asserts exactly-one-fetch for two charts).
- U5 — `apps/dashboard/src/pages/ministry/StudioRoom.tsx` on disk (shared per-suite studio surface).
- U6 — target docs `TRADING_RUNBOOK.md`/`ARCHITECTURE.md` were removed in the two-doc end-state (`bb81441`); README/PICC parity confirmed — the doc targets no longer exist, so the "update docs" work item resolved by removal rather than edit.

**NOT verified (test-run claims only):** the full-suite test tally and specific line refs asserted in the U-row annotations were recorded by prior session tooling and not re-run this docs pass. No task is left unimplemented. The spec's own design principles (honesty labels, one SSE bus, studio stays a status surface) remain live requirements enforced by the landed reskin components, but the U-series checklists themselves are closed and need no further action.