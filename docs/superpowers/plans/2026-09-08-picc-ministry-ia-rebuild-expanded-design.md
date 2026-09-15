# PICC Expanded-Scope Design — Trading Suite Refurbishment & Frontend/UI Overhaul

- **Status:** ~~DRAFT~~ **APPROVED 2026-09-08** (user: "i'll approve for now") — §10 open question pending; SP-0 + SP-1→SP-4 sequence + §2 decisions + §9 research mandate approved.
- **Date:** 2026-09-08
- **Branch:** feat/ministry-ia-rebuild (stays on this branch through the expanded workstream)
- **Extends:** docs/superpowers/plans/2026-09-08-picc-ministry-ia-rebuild.md (P1 complete) · spec docs/specs/PICC_SUITE_MINISTRY_MODEL_v1.md (binding)

---

## 1. The correction this design is built around

The panel audit (2026-09-08) verified **wiring**: for nearly every panel in
`TradingSuite.tsx` there is a `@/lib/trading.ts` call that maps to a real
`handlers.mjs` endpoint. "LIVE" in that audit means *fetch exists + handler
exists*. It does NOT mean the panel works on screen.

The user's direct experience overrides the audit: **nearly all panels are
defective when actually used** (extension disconnected, `SERPER_API_KEY` unset,
demo broker unconfigured, error states, empty results). The user has run the
app; the audit never has. Observed function is ground truth.

Consequence: fork A ("IA-first, panels are mostly live") and fork B ("rewrite
everything") converge, because the acceptance bar is identical and it comes from
the user's framing:

> **A panel is done only when it observably works end-to-end in the running app
> (real data path, real capabilities), or is refused honestly with a truthful
> "under development" state. A panel is never labeled LIVE from code inspection
> alone.**

"Production-grade with proven capabilities in trading brokerages/sites" is the
per-panel bar. Proof = observation (screenshots, DOM state, console clean,
real data flowing) against the real data paths (EO live feed when the extension
is connected, Yahoo fallback, Serper when keyed, demo-broker ledger).

## 2. Recorded decisions (user-approved)

1. **Branch:** stay on `feat/ministry-ia-rebuild` through the expanded workstream;
   integrate to master at the end via finishing-a-development-branch. "Don't drift
   further away from the plan, unless I approve."
2. **Shape (C):** remove everything duplicate; reimplement defective/stub/dysfunctional
   surfaces one-by-one, thoroughly, until fully functional, trustworthy, production-grade.
3. **Boundary (B):** frontend/UI is the workhorse NOW; each reimplemented panel may get
   the *narrowest* backend fix its real functionality needs (audit identifies which) —
   never a wholesale server overhaul.
4. **Inner sidebar (MinistryShell):** ONLY expanded state — no collapsed state, ever.
   Vertical scroll when nav links overflow, scrollbar HIDDEN, nav links shown properly.
5. **All remaining pages in scope for refurbishment:** Dashboard, Opportunities, Profile,
   Settings, Login, Suites + shell (AppShell/TopBar/CommandPalette/MinistryShell) — not
   just suites.
6. **Veto points (approved as stated):**
   - Pseudo-full-takeover "outer rail collapses on entering a ministry" stays as-is; only
     the *inner* rail is locked expanded.
   - "Proven capabilities" = verified evidence against real data paths; no fake
     credentials, no weakened demo/live gates, no weakened honesty labels.

## 3. Grounded findings (audits, 2026-09-08)

All are wiring-level observations; runtime function is UNVERIFIED until SP-0.

### 3.1 IA breakdown (why it *feels* mostly dysfunctional)
- `TradingSuite.tsx` (2194 lines) stacks ~30 panels in one flat vertical wall
  (MarketsSuite) + the whole AutopilotSuite.
- Every inner-nav link in every ministry (`MinistryShell.tsx:4-25`) resolves to a
  non-existent sub-route → `*` catch-all (`App.tsx:62`) → bounce to `/`. All declared
  rooms (trading: dashboard/markets/paper/autopilot/command-centre/simulator/settings;
  earnings: dashboard/simulator/settings; intelligence: dashboard/governor/guidance/settings)
  are dead ends. The ministry's only working content is the index landing (`Suites.tsx`).

### 3.2 Confirmed duplicates (wiring-level)
- Six metric surfaces: PortfolioPanel, PortfolioAggregatePanel, AccountMetricsPanel,
  PaperAnalyticsCard, demo-analytics, StatusCards — same equity/PnL/win-rate/drawdown
  vocabulary.
- Three watchlist/track-scan surfaces: WatchlistPanel, WatchlistScannerCard,
  ScreenerPanel (fixed UNIVERSE).
- Decisions shown twice: LiveDecisionsPanel + ConfluencePanel (same `/trading/decisions`).
- Three trade-outcome records: LedgerPanel observed payouts, demo settled/deals,
  PaperAnalyticsCard.

### 3.3 Genuinely broken or stub (the reimplementation queue, wiring-level)
- `TradePlannerCard` — honest "local math, no network" calculator (stub by admission).
- Autopilot decisions/why: client paths hit NON-EXISTENT routes while server logic
  exists (`autopilot.mjs getAutopilotDecisions/whyAutopilot`) unwired.
- `/trading/walk-forward` (hyperopt) endpoint has NO client caller — sophisticated
  server gold, dead from the UI.
- News errors without `SERPER_API_KEY`. Broker/extension statuses depend on env.
- Autopilot start/stop return 410 Gone — order execution deliberately removed;
  PICC is advisory-first. THIS GATE STAYS.
- Unused lib functions: placeDemoTrade, runStressTest, getAlertHistoryApi,
  getAssetSession, getAutopilotDecisions, whyAutopilot, startAutopilot, stopAutopilot.
- TechnicalBacktest.mjs — sophisticated, consumed only by tests; no panel.

### 3.4 Sidebar mechanics (always-expanded is surgical)
- Inner `collapsed` state (AppShell.tsx:75,131) is never rendered — actual inner
  sidebar is hardcoded 220px (`index.css:1652`). Inner collapse lives only in:
  takeover effect (AppShell.tsx:136-145, expands inner) and burger handler
  (:170-176, collapses inner on manual outer-expand).
- To lock inner expanded: delete `inner` rail from both, drop `INNER_RAIL_KEY`,
  keep `if (!outer.collapsed) outer.toggle()` (outer collapse-on-enter stays).
- Scroll: `.ministry-sidebar` already `overflow-y:auto` (index.css:1656) but needs
  bounded height; global scrollbar rules (index.css:23-49) need a scoped hide for
  the ministry sidebar.
- Tests pinning labels (survive if labels unchanged): MinistryShell.test.tsx:42-68,
  AppShell.nav.test.tsx:51-84, CommandPalette.test.tsx:60-83,
  Dashboard.quickActions.test.tsx.

### 3.5 Preserved-but-de-linked pages
Simulator.tsx, Agents.tsx, Income.tsx, StreamPage.tsx — no routes (P1 option A),
content re-homeable into ministries. DASHBOARD: re-homed into trading; AGENTS:
Intelligence; INCOME/STREAMS: Earnings.

## 4. Workstream decomposition (execution order)

Each slice ends with: slice tests green (vitest + Playwright where applicable),
root `npm run typecheck` exit 0. Each slice is one coherent commit-family.

### SP-0 — Functional baseline (OBSERVATION ONLY, no code)  ← added by this design
Before reimplementing "defective" panels, observe which ones actually are.

- Run dev server + real browser (Playwright, webapp-testing skill; `scripts/with_server.py`).
- Authenticate; visit EVERY trading panel + every page in scope.
- Per surface record: renders? data flows? console errors? honest label present?
  Evidence: screenshot + DOM state + console log.
- Produce `baseline-observed-states.md` (ledger): FUNCTIONAL / DEGRADED-honest /
  DEFECTIVE per surface. This IS the reimplementation queue; SP-1..4 consume it.
- Honest note: if the environment lacks extension/keys, the degraded observation
  is still the user's truth — the ledger says what was and wasn't observable.
- Verification: the baseline ledger's FUNCTIONAL claims are only for surfaces
  observed working; everything else is defective/degraded until proven otherwise.

### SP-1 — Shell & IA
- Inner sidebar always-expanded (decisions §3.4): AppShell edit (2 sites + key
  removal), scoped scrollbar-hide CSS, bounded-height scroll.
- Real routes for every declared room in all ministries (`App.tsx` sub-routes under
  `/suites/:suiteId/...` containing `<MinistryShell Outlet>`).
- Trading rooms host curated compositions of EXISTING panels (re-homed, not rebuilt):
  e.g. dashboard → StatusCards+decisions overview; markets → chart/spread/correlation/
  board/intel; paper → paper trading + analytics; autopilot → AutopilotSuite;
  command-centre → CommandCentrePanel; simulator → re-homed Simulator content;
  settings → per-ministry settings (REQ-5 exposure home).
- Earnings/Intelligence rooms: honest "under development" scaffolds (site-only content).
- Landing (`Suites.tsx`) becomes a real ministry dashboard with room links.
- `TradingSuite.deeplink.test.tsx` stays green (deep links resolve into the re-homed
  composition) — any change to that test needs explicit approval.
- Playwright: enter each ministry, click every room link, assert no dead-end redirect.

### SP-2 — Dedupe (one owner per concept)
- Metrics: collapse six surfaces → one Portfolio owner (pick the strongest wiring;
  delete the rest). Decisions pair → one. Watchlist trio → one Watchlist + one Screener
  (screener gains watchlist-scoped universe). Outcome records → ledger owns settlements.
- Honest stub card (`TradePlannerCard`) keeps truthful labeling while deduped.
- Each deletion removes a panel from rooms; `TradingSuite.tsx` shrinks accordingly.
- Verify: no live surface's data disappears; deeplink + existing tests green.

### SP-3 — Page-by-page refurbishment (frontend-design + webapp-testing)
- All pages: Dashboard (fill hero/metrics with real re-homed content), Opportunities,
  Profile, Settings (per-ministry settings surface from SP-1), Login, Suites,
  shell chrome (TopBar/CommandPalette polish).
- Re-home dead-page content (Simulator/Agents/Income/StreamPage) into their ministries
  per §3.5; then those preserved files become reachable again or are deleted by approval.
- Visual direction per frontend-design skill; each page E2E-verified (screenshots).

### SP-4 — Broken-surface reimplementation (one-by-one, narrow backend per panel)
Queue per SP-0 ledger, ordered by impact. Known wiring-level candidates:
- Autopilot decisions/why → add the two missing handler routes (server logic exists).
- Walk-forward hyperopt panel → wire the existing endpoint (no new engine).
- TradePlannerCard → real validated position-size/R:R math, honest provenance labels.
- Screener universe → watchlist-scoped option.
- Serper fallback → graceful degraded news state when key unset (no fake news).
- Whatever SP-0 proves defective that ISN'T on this list.
- Backend changes: narrowest per-panel, reviewed, never a wholesale overhaul.
- 410 advisory-first start/stop stays; demo/live gates stay; honest labels stay.

## 5. Verification strategy (per slice)

- Logic: vitest repo-native pattern (`// @vitest-environment jsdom` + createRoot +
  flushSync + exact-text DOM lookups; NO @testing-library/react, NO npm install).
- Browser behavior: Playwright via webapp-testing skill; screenshot + DOM assertion
  per refurbished surface. Browser-only files: `node --check` minimum.
- Static: root `npm run typecheck` (tsc -b --noEmit) exit 0 per slice.
- Suite: `npm test --workspace @picc/dashboard` green at slice end.
- Claim discipline: verification-before-completion — no completion claim without a
  fresh run in THIS session.

## 6. Gates that stay (non-negotiable)

- Autopilot start/stop 410 (advisory-first). No order-execution re-enablement.
- No fake credentials, no fabricated venues/data, no weakened honesty labels.
- `simulator|agents|income` FeatureKeys are additive-only (never deleted).
- Extension (`extensions/picc-overlay/`) remains read-only server-driven sensor;
  zero diff. Per-ministry site lists live server-side (`captureProfiles.mjs`).
- No npm install unless dependencies actually change.
- Unconfigured ≠ zero-filled; every status reports observed state.

## 7. Explicit non-goals (this workstream)

- No wholesale server re-architecture.
- No re-enablement of real order execution (410 remains).
- No new broker integrations beyond what panels need for their declared capability.
- No visual redesign that breaks the pinned tests without approval.
- No merging to master until finishing-a-development-branch at the end.

## 8. Open items for approval

1. **SP-0 added as slice 0** (observation before reimplementation) — approve?
2. Room curation details in SP-1 (which panels land in which trading room) are
   PROPOSED here; the precise distribution goes in the plan, reviewable before work.
3. Re-homed dead-page files (Simulator/Agents/Income/StreamPage): reachable again
   vs deleted once re-homed — decide during SP-3.
4. Anything in §3.3 you know to be broken that the audit missed — say it now; it
   joins the SP-0 queue.

## 9. Research mandate (user ruling, 2026-09-08 — APPROVED with §2/§4)

User directive, approved with the design: "check every aspect of trading suite
functionality towards real-life/realtime/production-level endeavors/tools/sites" ·
"look at every research document we have done so far" · "feel free to integrate
with various sites and obtain info, all in a weblike workflow/agents/models/
algorithms" · end state: "highly trustworthy, the best of the best ever
implemented" · minimize recreating from scratch; **"learn from others" policy —
copying open source is explicitly permitted (open-source preferred); closed
source → research it, don't copy.**

Implications, encoded:

- **R9.1 Research leg.** The expanded workstream includes a research leg that
  mines BOTH the repo research corpus and live-web sources:
  - Repo corpus: `TRADING_PLATFORM_RESEARCH.md` (944 lines: TradingView, MT5,
    cTrader, NinjaTrader, thinkorswim, IB TWS, 3Commas/Pionex/CryptoHopper,
    QuantConnect/Alpaca/Zipline, feature matrix, top-20 must-haves) and
    `COMPREHENSIVE_TRADING_KNOWLEDGE_BASE.md` (1142 lines, 40+ sources) — plus
    the spec corpus (20+ specs under docs/specs/).
  - Live web: firecrawl search/scrape/crawl of open-source trading suites, engines,
    and data tools (learn-from-others: adopt permissively-licensed code freely,
    with attribution; GPL-style code is informed-by not copied-in).
- **R9.2 Integration-for-info (RESOLVED 2026-09-08).** "Integrate with various
  sites and obtain info" is confirmed READ-ONLY info acquisition wherever it
  lands: quotes, news, intel, research, market data — via the existing sensor /
  capture configs / CCXT-read / Yahoo / Serper machinery, generalized. Terms,
  per user:
  (a) leverage each site's **free tier** to its reasonable limit without
  frustrating the provider — **honor the site's provided boundaries** (rate
  limits, ToS, robots, API keys);
  (b) the integration set is **open-ended** — "more and more" web sites over
  time, not a fixed list;
  (c) **PICC-as-a-country model**: each external site is a foreign relation
  with its own borders; PICC establishes respectful info-trade with them.
  Mechanically this becomes a **server-owned, per-ministry integration
  registry** (generalizing the existing `captureProfiles.mjs` →
  `extensionCaptureConfigsByMinistry` precedent): source, purpose, data
  imported, boundary/limits honored, honest state (connected / unconfigured /
  degraded), additive FeatureKey-gated. Any new **execution-capable**
  integration remains a separate, explicitly-approved rung (410 advisory-first
  stays).
- **R9.3 Best-of-best bar.** The acceptance bar for SP-4 reimplementation: each
  surface is measured against what the research corpus shows the best suites do
  (feature matrix + top-20 in TRADING_PLATFORM_RESEARCH.md), adapted to PICC's
  advisory-first, sensor-driven, honest-state architecture — never weaker.
- **R9.4 "Weblike workflow."** Understood as the existing spine (sensor → server
  capture → marketDataBus → engines/models → UI decisions), generalized to more
  info sources. No new architecture implied; research feeds SP-1/SP-4 content.

### Research wave 1 findings (2026-09-08) — verified

Corpus mining + two live-web dossiers completed; every library name and free-tier
claim re-verified by the coordinator against npm registry / provider pages
(hallucinated packages and license errors caught and corrected in the dossiers).

- **Adoption candidates** (`.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/research-live-adoption.md`):
  - VaR/CVaR + Sharpe/Sortino/Calmar: ADOPT `@railpath/finance-toolkit` (MIT) or
    `meridianalgo` (MIT); `quantstats-js` (Apache-2.0) as alternative.
  - Monte Carlo: ADOPT `@veenie/risk` (MIT, verified) for full simulation;
    finance-toolkit for VaR-scoped MC.
  - Kelly: PICC already implements; cross-check formulas only.
  - Niche indicators (Choppiness/TSI/DeMarker/Fisher/Coppock): NO permissive npm
    package covers all five — `@debut/indicators` covers 4 but is GPL-3.0
    (informed-by, NOT copy-in); recommend implementing the five in-house using
    the corpus formulas + MIT `@ixjb94/indicators` as cross-check. DeMarker has
    no JS/TS implementation anywhere (custom).
  - Best-of-best conventions: TradingView drawdown bars, MT5 MFE/MAE charts,
    QuantConnect Probabilistic Sharpe + top-5 drawdowns + walk-forward `train()`.
- **Integration registry candidates** (`.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/research-live-integrations.md`):
  27 verified free-tier sources across ministries, e.g. Twelve Data, Finnhub,
  Binance/Kraken public (keyless), Stooq (30y history), Marketaux (news+sentiment),
  GDELT (macro sentiment, CC BY 4.0), SEC EDGAR XBRL (keyless), GotCashback,
  AffiliateRoll, Tavily (1,000/mo keyless option), Brave ($5/mo), OpenAlex (CC0),
  arXiv. Registry = server-owned, per-ministry, additive FeatureKey, honest
  states — generalizes `captureProfiles.mjs`. Execution-capable stays gated.
  NOTE: `@veenie/risk` feature-depth claims are README-only; verify before deep
  adoption. `cinar/indicators` was a fabricated artifact of the first research
  pass — removed.

## 10. Open questions

### Q1 — Integration scope (RESOLVED 2026-09-08)

Was: read-only info acquisition only vs includes new execution-capable
integrations. Answered: **read-only info acquisition, free-tier with honored
boundaries, open-ended integration set, PICC-as-a-country framing.** Encoded
in R9.2 above. Execution-capable rungs stay gated (410 stays).

### Q2 — Research sequencing (asked 2026-09-08)

Run the bounded live-web adoption-research wave NOW — before the implementation
plan is written, so the plan's SP-4 / registry content is grounded in real
candidates — or fold research into plan execution, per-slice?