# PICC Frontend UI Reskin — spec v1

**Status:** For execution
**Date:** 2026-09-18
**Extends:** `docs/specs/PICC_FRONTEND_UI_ENGINE.md` (U-series/T-series honesty surfaces), `docs/specs/PICC_SUITE_MINISTRY_MODEL_v1.md` (ministry IA + Decision C classification), `docs/specs/PICC_MULTISOURCE_ENGINE.md` (source-preference backend at `:45`, `:99` — already landed), `CONTEXT.md:8-64` (the 11 locked decisions, of record)
**Grounding rule:** every file:line below was read this session; anything not re-read is marked UNVERIFIED.

---

## Requirements

### REQ-A — Classification registry
The ad-hoc category machinery becomes one machine-readable registry.

**Testable:**
1. `lib/registry.ts` exists and defines families `crypto, defi, p2p, dividend, interest, content, agent, affiliate` (status `active`) and `rental, nft` (status `coming-soon`). Each entry carries `familyId, label, owningMinistry, subDomain, status, graduationRef` (graduation rule per `CONTEXT.md:36-39`). Decision note: existing category `affiliate` (in use at `types.ts:187` — `crypto` sits at `:191`) is kept as an active family mapped to the Earnings ministry — the locked decision list does not enumerate it, so it is preserved rather than dropped.
2. Every component that resolves a family/category goes through the registry. After the change, a repo grep for hardcoded category maps finds matches only in `src/lib/registry.ts` and `src/lib/types.ts`.
3. `StreamCategory` (`types.ts:183-196`) loses `"bandwidth"` (184) and `"other"` (195). `normalizeStreamRow` (`income.ts:255-272`) maps unknown categories to a registry `"uncategorized"` marker — never `"other"` (currently defaulted at `income.ts:259`) — displayed honestly as "Uncategorized" with status `unconfigured`.
4. `streamCatalog.ts` drops the excluded families: `bandwidth/depin/storage/compute` from the CatalogEntry union (`:8-22`), `STREAM_CATEGORY_LABELS` (`:30-44`), `DEPIN_APPS`/`STORAGE_APPS`/`COMPUTE_APPS` (`:46-69`), and the `CATALOG` spread (`:167-181`). Grep for `depin|storage|compute` then shows no catalog rows, only `docs/adr/0002-bandwidth-suite-rejected.md` and `CONTEXT.md:31-33` rationale.

### REQ-B — Brand + per-ministry themes
Identity sweep and token-based theme architecture, dark-first.

**Testable:**
1. User-visible brand strings read "Personal Income Command Centre". Grep for `Passive Income|Command Center` returns 0 matches in `apps/dashboard/src`, `index.html:6,12`, `public/manifest.json:2,4`, `package.json:5`, `PICC.md:1`, `README.md:1`, and `PRIVACY.md:7` (currently "Personal Income Command Center" — spelling normalized to "Centre"). Subsystem strings are untouched: `CommandCentreRoom` ("Command Centre Web"), the `command-centre` room key (`MinistryShell.tsx:10`), and `suitesLanding.test.tsx:63` stay as-is.
2. Four `[data-theme=…]` token blocks exist (dark): `income-command-centre`, `trading`, `earnings`, `intelligence`, bound by route scope — hub + `/opportunities` + `/settings` + `/profile` + `/login` = command-centre; each `/suites/:suiteId` subtree = its ministry theme (route binding in `App.tsx:40-52`, shell in `AppShell.tsx`, per-suite override in `MinistryShell.tsx`).
3. Components consume tokens only. After the sweep, grep for raw `#(?:[0-9a-fA-F]{3,8})` in `apps/dashboard/src` finds no NEW occurrences; the 82 pre-existing ones (incl. token file `index.css:12`, `SessionPanel.tsx:46`, `ResourceGovernorPanel.tsx:18`, `EarningsRooms.tsx:168,220,235`, `IncomeStreams.tsx:474,646`) are migrated or explicitly exempted with a comment explaining why.
4. Light mode remains a token override — no per-component light CSS, no hardcoded colors that would block the override. Shipping light is a non-goal; the architecture must not foreclose it.

### REQ-C — PWA + asset budget
**Testable:**
1. `sw.js` gains a versioned static precache of the app shell (index.html, manifest, icons, hashed entry chunks) injected at build time by a small Vite plugin that reads `dist/assets/*` and rewrites the served `sw.js` cache list. The push-only contract (`sw.js:6` — "No caching, no intercepting fetches") is preserved for runtime data: financial payloads are never runtime-cached; navigation is network-first with the precache as offline fallback.
2. Offline hub shell: with network off, `/` renders hub chrome plus honest "unavailable" states — the component decides per data section between stale-marking and omission, never zeros.
3. `public/manifest.json` brand strings updated (`:2`, `:4`); `theme_color` follows the hub `--bg` token (stays `#0d0d1a` `:7-8` unless theme work changes the hub background); `start_url: "/"` (`:5`) unchanged; `sw.js` deep-link default `/suites` (`sw.js:21`) still resolves (redirect exists in `App.tsx`).
4. Asset budget from `npm run build`: initial route (`/`) JS+CSS gz ≤ 200 KB; each suite route adds ≤ 60 KB gz beyond the shared shell (suite chunks code-split via lazy routes in `App.tsx:40-52`).
5. Install surface preserved: registration (`main.tsx:15-19`), `installEligibility.ts` (iOS 16.4+ rule, `:12-21`), `useInstallBanner` — behavior unchanged.

### REQ-D — Income-first hub + studio universality
**Testable:**
1. Hub (`/`, `App.tsx:42`) becomes the Income Command Centre: new brand `<h1>` replaces "Command Center" (`Dashboard.tsx:209`); at-a-glance totals (net worth, income today, income this month — aggregated from `getStreams()`/`getEarnings()`); ministry launch cards (existing grid `Dashboard.tsx:244-259` re-labeled "Launch Trading Suite" etc.); per-stream breakdown linking each stream to its owning ministry per registry.
2. Browser Studio becomes universal: every ministry's `INNER_NAV` (`MinistryShell.tsx:4-25`) gains a `studio` entry before `settings`; `MINISTRY_ROOMS` (`MinistryRoom.tsx:37-41`) resolves `studio` per suite to the existing Studio surface; primary sidebar entry (`AppShell.tsx:54`) and `/studio` route stay.
3. The studio-gating tests (`MinistryRoom.studio.test.tsx:1-77`) are REWRITTEN to assert the opposite — studio present in every ministry and resolving at `/suites/:suiteId/studio` — never silently deleted; the header comment (`:1-7`) is updated to record the deliberate reversal (this spec supersedes the 2026-09-16 removal decision it records).
4. `suitesLanding.test.tsx:59-71` extends its label list with "Studio"; the "Command Centre" assertion (`:63`) is preserved.

### REQ-E — Honesty surfaces (U1/U3/U5 + T6/T3 UI halves)
**Testable:**
1. **T3 UI half (feed panel):** `TradingChart` source dropdown (`:302-324`) persists via the existing backend — `GET /api/trading/source-preference` (`server/handlers.mjs:2280-2295`), `POST` (`:2305-2322`), route constant observed at `:2370`; endpoint tests at `server/__tests__/resolutionChain.test.mjs:438-554`. On mount the saved preference is fetched and applied; on change it is POSTed. A "why this source" line explains the current source (U1 wording contract per PICC_FRONTEND_UI_ENGINE.md).
2. **U3 status chips:** `SOURCE_BADGES` (`TradingChart.tsx:29-34`, `:177-187`), the `feed === "studio"` badge (`:238`), and the "EO live" chip (`TradingSuite.tsx:244`) no longer render a static "live". Badges derive from `servedSource`/`pinnedSource` plus freshness from `useCandleData.ts` (sources at `:36-42`, results at `:394-401`). A chip never claims "live" for a stale or buffered feed — existing U3 contract unchanged.
3. **U5 studio status surface:** the per-ministry studio room shows the same running/connected/feed status as the standalone Studio page (one shared component, no forked logic).
4. **T6 half:** the source/recency/`resolved` surface (in `useCandleData` and the mismatch banner `TradingChart.tsx:354-358`) is restyled only — semantics unchanged.
5. HonestScaffold pattern preserved for all scaffold rooms: "under development", "No fabricated data — configured capabilities will appear here" (`HonestScaffold.tsx:12-18`). No new fabricated state anywhere.

---

## Design

**Registry (`src/lib/registry.ts`)** — the module REQ-A creates. Typed family entries (`owningMinistry` ∈ the 3 suite ids; `subDomain` = room key per `MinistryShell.tsx:4-25`); helpers `familyToSuite(familyId)` and `suiteToFamilies(suiteId)` replace the wrong-keyed ad-hoc lookups at `EarningsRooms.tsx:299` and `:410` — today `SUITE_META[stream.category]` indexes a map that holds only the 3 ministry ids (suites.ts:13-35), so category keys like `crypto` yield `undefined`, silently falling back to the "🧭" icon (`EarningsRooms.tsx:310`). `streamCatalog.ts` imports registry entries so it stays the "configure this family" source while sharing one vocabulary with `IncomeStream` (`types.ts:199+`). The registry is the ONLY place a category maps to a suite/sub-domain — nav (`MinistryShell.tsx`), the hub's per-stream breakdown (REQ-D.1), and earnings rooms all resolve through it.

**Theme architecture (`src/themes.css`)** — four `[data-theme=…]` blocks override semantic tokens: `--bg, --bg-elev, --panel, --text, --text-muted, --accent, --gain, --loss, --border, --font-numeric`. Base primitives stay in `index.css:1-17` (`:root` layout/neutral tokens unchanged as the fallback). Theme characters per the locked decision: trading = institutional terminal (dense, monospace numerals via `--font-numeric`, near-zero decoration); earnings = cashier's ledger (growth-green accent, per-stream cards, glanceable); intelligence = strategic forecast desk (deep blue, evidence-dense, restrained accent); income-command-centre = state room (at-a-glance totals, calm authority). Theme binding: `AppShell.tsx` sets the attribute for hub/non-suite routes; `MinistryShell.tsx` sets it per-suite on its subtree; `Login.tsx` root sets command-centre. Components read tokens only — the raw-hex sweep enforces this. All four themes ship dark-first; light variants are token overrides, deferred (non-goal).

**PWA shell** — keep the hand-written `public/sw.js` as the source of truth for the push contract; add a tiny Vite plugin (in-app, no new dependency) that, after `build`, injects the hashed `dist/assets/*` list plus `index.html`/manifest/icons into a versioned precache block (`cacheName: picc-shell-v<pkg version>`). Runtime fetches stay uncached (finance data freshness); only precached shell assets serve offline, network-first with cache fallback. Manifest `theme_color` tracks the hub `--bg` token. Suite routes are code-split so only the hub shell is in the initial precache.

**Studio universality** — the reversal of the 2026-09-16 gating (recorded in `MinistryRoom.studio.test.tsx:2-7`). Mechanically: add `studio` to each suite's `INNER_NAV` (before `settings`), map `"studio"` in each suite's room table in `MinistryRoom.tsx:14-41` to a shared `StudioRoom` wrapper that renders the existing Studio surface (imported once, reused three times — no forked logic, per REQ-E.3). The `/studio` route plus primary sidebar entry (`AppShell.tsx:54`) stay as the standalone path. Headless operation from inside a ministry room is inherited from the existing studio, not re-implemented.

**Removal list (verified this session — zero production imports, only the cites below):**
- `src/components/TradingHud.tsx` (decl only `:73`), `SignalFeed.tsx` (`:75`), `ConfluencePanel.tsx` (`:69`), `PortfolioPanel.tsx` (`:56`), `TradeOrderForm.tsx` (`:23`), `LoginBadge.tsx` (`:10`) — delete outright.
- `src/components/ConvergencePanel.tsx` (`:54`) — delete only AFTER relocating `RegimeBadge`, which is import-only by the test `components/__tests__/ConvergencePanel.regime.test.tsx:13`; `convergenceDisplay.ts:1` comment mentions it. Move `RegimeBadge` into a shared file or fold the test, in the same commit.
- `brokerAgnosticLabels.test.ts:14-23` lists `components/TradeOrderForm.tsx:16`, `components/TradingHud.tsx:19`, `components/ConfluencePanel.tsx:20` by path — update the list in the same commit or the test ENOENTs.
- `streamCatalog.ts` excluded families (REQ-A.4) and their importers: `IncomeStreams.tsx:5`, `CommandPalette.tsx:3`, `StreamSetupWizard.tsx:3`, `EarningsRooms.tsx:285-296` (category→panel map incl. `other` at `:290` — replaced by registry-driven panel resolution).

## Non-goals
- No backend changes: T3 server half (source-preference endpoints) and the SSE bus (`useRealtimeSuite.ts`, T8) ship as-is; only dashboard-consumer code changes.
- No light themes, no font/logo asset work beyond token-driven text/brand strings, no user-account or permissions changes.
- No new dependencies (no workbox, no vite-plugin-pwa, no CSS framework) — the precache plugin is in-repo.
- No fabricated data, no demo/live gate changes, no rate-limit or authorship-gate changes anywhere.
- No renaming of subsystem strings ("Command Centre Web", room keys, storage keys like `picc.ministry.<id>.lastRoom` in `ministryNav.ts:13`).
- Doc corpus beyond brand-string greps is out of scope (PICC.md §4/§5 module/page counts update deferred to the executor's discretion, flagged in Honesty notes).

---

## Tasks

Ordered; each task names files + acceptance. Slice 1 (registry) lands before Slice 5 (composition) so nav/hub/earnings rooms resolve through the registry.

**Slice 1 — Registry (REQ-A)**
- [x] **T1 Create `src/lib/registry.ts`; refactor `IncomeStream.category` to `familyId`.** — Done (`6bfc763`, completed `8a98999`).
  - Files: `src/lib/registry.ts` (new), `src/lib/types.ts:183-218`, `src/lib/income.ts:255-272`, `src/lib/streamCatalog.ts:8-69,167-181`, `src/pages/ministry/EarningsRooms.tsx:285-296`, `src/pages/ministry/StreamSetupWizard.tsx` (imports at `:3`), `src/components/CommandPalette.tsx:3`, `src/components/IncomeStreams.tsx:5`.
  - Acceptance: registry exports family table + `familyToSuite`/`suiteToFamilies`/`familyLabel`; `normalizeStreamRow` maps unknown → `familyId: "uncategorized"`, never "other" (`income.ts:259`); `EarningsRooms.tsx:299,410` resolve via registry (no `undefined` → "🧭" fallback at `:310` — icon comes from the family entry); grep `depin|storage|compute|bandwidth` finds 0 matches in `src` + `server` (only `docs/adr/0002-bandwidth-suite-rejected.md`, `CONTEXT.md:31-33`); `npm run typecheck` and `npm test` green (existing suites, minus the changed expectations).
  - **Verified (2026-09-19):** `registry.ts` exports `FAMILIES` (11 entries incl. `affiliate` preserved + `uncategorized` fallback), `familyToSuite`/`suiteToFamilies`/`familyLabel` (registry.ts:138-156); `income.ts:259-261` maps unknown → `uncategorized`; `registry.test.ts:33-34` asserts `bandwidth`/`depin` absent from catalog ids. **Documented deviation on the grep:** residual `bandwidth`/`depin`/`depth` words in `src` are server-side **site-category** vocabulary (ConnectorsPanel CATEGORY_EMOJI, HoldingsEditor `depin_nodes` CRUD, `income.ts` holdings.depin data shape — decisions locked in session) or Keltner-channel `bandwidth` (trading indicator, unrelated); streamCatalog rows themselves are clean (`streamCatalog.test.ts:57-58` rejects `bandwidth/depin/storage/compute/other`).
- [x] **T2 Update registry consumers + tests pinning the old union.** — Done (`6bfc763`).
  - Files: `src/lib/__tests__/suites.test.ts` (pins SUITE_META keys = 3), `suitesLanding.test.tsx:59-71` (labels), `brokerAgnosticLabels.test.ts:14-23` (paths — keep in sync with Slice 7), `src/pages/Suites.tsx:21-61` (resume/deep-link paths unchanged — verify).
  - Acceptance: `suites.test.ts` still passes (registry does not mutate SUITE_META); grep for `"other"` as a StreamCategory literal = 0 in `src/lib`; earnings-room tests (if any) resolve icons from registry entries.

**Slice 2 — Identity sweep (REQ-B.1)**
- [x] **T3 Brand-string sweep.** — Done (`8a98999`; spec-level wave `6bfc763`). Full-repo grep verified 0 `Passive Income|Command Center` in the named files; "Command Centre"/"Command Centre Web" subsystem strings untouched; `package.json`, `index.html`, `PICC.md`, `README.md`, `PRIVACY.md`, `Login.tsx`, `AppShell.tsx`, `TopBar.tsx`, `CommandPalette.tsx`, `Dashboard.quickActions.test.tsx` all carry the normalized "Income Command Centre".
  - Files: `src/components/AppShell.tsx:184`, `src/pages/Login.tsx:43`, `src/pages/Dashboard.tsx:209` (→ "Income Command Centre" h1), `src/components/TopBar.tsx:6`, `src/components/CommandPalette.tsx:19` (→ "Income Command Centre"), `index.html:6,12`, `public/manifest.json:2,4`, `package.json:5`, `PICC.md:1`, `README.md:1`, `PRIVACY.md:7` (fix spelling to "Centre"), `src/components/SessionPanel.tsx:46` + `src/components/UserMenu.tsx` (UNVERIFIED — grep for label copies).
  - Acceptance: full-repo grep for `Passive Income|Command Center` = 0 in the files above; `Command Centre` (room label, `MinistryShell.tsx:10`, `suitesLanding.test.tsx:63`) AND `Command Centre Web` remain untouched; `npm test` green.

**Slice 3 — Theme tokens + binding (REQ-B.2-4)**
- [x] **T4 Create `src/themes.css` with 4 `[data-theme]` token blocks; bind by route.** — Done (`6bfc763`). Verified (`2026-09-19`): `themes.css` has the 4 blocks `income-command-centre` (:21), `trading` (:39), `earnings` (:57), `intelligence` (:75) + `--font-numeric`; `AppShell.tsx:172`, `Login.tsx:39`, `MinistryShell.tsx:38` set `data-theme`; `App.tsx` lazily splits suite routes.
  - Files: `src/themes.css` (new), `src/index.css:1-17` (keep `:root` primitives), `src/main.tsx` (import themes.css), `src/components/AppShell.tsx` (set data-theme for hub/non-suite), `src/pages/MinistryShell.tsx:4-25,37-42` (per-suite data-theme + themed brand row), `src/pages/Login.tsx` (command-centre theme on root).
  - Acceptance: rendered DOM shows `data-theme` per route (hub = income-command-centre, `/suites/trading` = trading, etc.); `--font-numeric` used for numerals in Trading suite rooms; visual spot-check via `npm run dev` — hub shows command-centre palette, each suite its own; no visual regression where tokens are unset (fallback = `:root`).
- [x] **T5 Raw-hex migration sweep.** — Done (`8a98999`). Verified (2026-09-19): audit script ran over all `apps/dashboard/src` hex tokens — 99 found, 0 uncommented; every remaining occurrence carries an inline `// token-exempt:` comment with reason.
  - Files: all `apps/dashboard/src` matches of `#(?:[0-9a-fA-F]{3,8})` outside `index.css`/`themes.css` (82 pre-existing incl. `SessionPanel.tsx:46`, `ResourceGovernorPanel.tsx:18`, `EarningsRooms.tsx:168,220,235`, `IncomeStreams.tsx:474,646`).
  - Acceptance: grep count of raw hex in `src` (excl. token files) is 0 or every remaining occurrence has an inline `// token-exempt:` comment with reason; `npm test` + visual spot-check green.

**Slice 4 — PWA (REQ-C)**
- [x] **T6 Add build-time precache plugin + manifest/brand updates.** — Done (`6bfc763`). Verified (2026-09-19): `vite.config.ts` precache plugin emits versioned `dist/sw.js`; precache audit — dist/sw.js lists 18 assets, on-disk 18, exact match; push-only runtime contract preserved.
  - Files: `apps/dashboard/vite.config.ts:28-77` (add in-repo plugin reading `dist/assets/*` post-build), `public/sw.js` (versioned precache block; keep push contract `:6` and deep-link `/suites` `:21`), `public/manifest.json:2,4,7-8`, `src/main.tsx:15-19` (unchanged).
  - Acceptance: `npm run build` emits `dist/sw.js` whose precache list matches `dist/assets/*` contents; offline test (DevTools offline) on `/` renders hub chrome + honest unavailable states, never zeros; `theme_color` == hub `--bg`; install banner still offers install (iOS UA + not-standalone → true per `installEligibility.ts:12-20`).
- [x] **T7 Code-split suite routes; measure budget.** — Done (`6bfc763`; budget measured in `8a98999`). Verified (2026-09-19) via `apps/dashboard/scripts/measure-budget.cjs` + `which-chunk.cjs`: initial route (`/`) JS+CSS gz = **122 KB ≤ 200 OK**; suite chunks `TradingSuite` = 100 KB gz, `PaperRoom` = 124 KB gz — **flag as risk with delta** (over the 60 KB/suite ideal; spec allows flagging). `lightweight-charts` confined to the `TradingSuite` chunk — the shared shell stays lean.
  - Files: `src/App.tsx:40-52` (lazy suite routes — `MinistryShell` chunk), `package.json` (build script unchanged), CI/log record.
  - Acceptance: `npm run build` reports initial chunk gz ≤ 200 KB and suite chunks ≤ 60 KB each (record numbers in PR body; if over, split further or flag as risk with the delta).

**Slice 5 — Composition (REQ-D)**
- [x] **T8 Hub rework.** — Done (`6bfc763`). Verified (2026-09-19): `Dashboard.tsx:211` renders "Income Command Centre" h1; hero-card shows net worth (computed from live accounts) + `{incomeToday} today · {incomeMonthly} this month · {activeCount} active streams` — real sums, no fabrication.
  - Files: `src/pages/Dashboard.tsx:206-259` (h1, hero-card, grid-3 → command-centre totals + per-stream breakdown via registry `familyToSuite`), `src/components/IncomeStreams.tsx` (reuse/export breakdown), `src/lib/registry.ts` (already in place).
  - Acceptance: `/` shows Income Command Centre brand; totals = sum over `getStreams()` balances + `getEarnings()` today/month sums (no fabricated values); each stream card links to `familyToSuite(familyId)` route; `npm test` + visual check.
- [x] **T9 Studio universality.** — Done (`6bfc763`). Verified (2026-09-19): `MinistryShell.tsx:12,18,25` add `studio` to all three INNER_NAVs; `MinistryRoom.tsx` maps `studio` → shared lazy `StudioRoomComponent` (:12-38); `MinistryRoom.studio.test.tsx` header records the deliberate reversal (REQ-D.2/3, referenced spec); `suitesLanding.test.tsx:63` label list includes "Studio".
  - Files: `src/pages/MinistryShell.tsx:4-25` (add `studio` before `settings`), `src/pages/ministry/MinistryRoom.tsx:14-41` (map `studio` → shared StudioRoom per suite), `src/pages/ministry/__tests__/MinistryRoom.studio.test.tsx:1-77` (REWRITE to assert presence + resolution, update header comment), `src/pages/__tests__/suitesLanding.test.tsx:63` (add "Studio" to label list).
  - Acceptance: `npm test` — rewritten studio tests pass asserting studio present per suite; `/suites/trading/studio` renders studio surface with status (REQ-E.3); `/suites/earnings/studio` + `/suites/intelligence/studio` identical via shared component; `suitesLanding` label list includes "Studio".

**Slice 6 — Honesty surfaces (REQ-E)**
- [x] **T10 Source-preference persistence (T3 UI half).** — Done (`1e603a3`). Verified (2026-09-19): `hooks/useSourcePreference.ts` GETs on mount/POSTs on change; `TradingChart.tsx` source dropdown (:302-354) persists via `/api/trading/source-preference` (server half already landed, T3 UI half of MULTISOURCE).
  - Files: `src/components/TradingChart.tsx:302-324` (dropdown → persist on change), new `src/hooks/useSourcePreference.ts` (GET on mount, POST on change, error → keep previous + console.error), `src/hooks/useCandleData.ts:36-42,394-401` (consume saved pref as initial `pinnedSource`).
  - Acceptance: change source → reload → dropdown shows saved source (server round-trip via `/api/trading/source-preference`, endpoint tests already at `resolutionChain.test.mjs:438-554`); POST failure shows a non-blocking notice and keeps the last-good selection; no "live" claim rendered while buffering/stale (U3).
- [x] **T11 Status-chip accuracy.** — Done (`1e603a3`). Verified (2026-09-19): shared `SourceBadge.tsx` reads `servedSource`/freshness; grep `"EO live"` = 0 in `src`; dealer badge shows freshness — installed `SourceBadge` stale-tone + honest empty-state (`TradingChart.tsx:435-450`).
  - Files: `src/components/TradingChart.tsx:29-34,177-187,238`, `src/components/TradingSuite.tsx:244`, shared `src/components/SourceBadge.tsx` (new) reading `servedSource`/freshness.
  - Acceptance: grep `"EO live"|"EO headless live"` = 0; badge for a stale/buffered feed shows freshness text, never "live"; studio badge shows "EO studio" + connection state, never "headless live".

**Slice 7 — Removal (verified orphans)**
- [x] **T12 Delete orphan components.** — Done (`1e603a3`). Verified (2026-09-19): `TradingHud.tsx`, `TradeOrderForm.tsx` deleted (git `1e603a3`); `brokerAgnosticLabels.test.ts:14-23` updated; typecheck + full suite green (223 files / 2337 tests). Note (2026-09-19): `SignalFeed`, `ConfluencePanel`, `PortfolioPanel`, `LoginBadge`, `ConvergencePanel` were removed earlier in the suite-simplification wave (`6536176`) rather than in T12 itself — codebase satisfies the end-state regardless.
  - Files: delete `TradingHud.tsx`, `SignalFeed.tsx`, `ConfluencePanel.tsx`, `PortfolioPanel.tsx`, `TradeOrderForm.tsx`, `LoginBadge.tsx`, `ConvergencePanel.tsx` (after relocating `RegimeBadge` per Design); update `brokerAgnosticLabels.test.ts:14-23`; delete/absorb `ConvergencePanel.regime.test.tsx:13`.
  - Acceptance: `npm run typecheck` + `npm test` green; grep for each deleted component name = 0 in `src` (except the updated test-list line + `convergenceDisplay.ts:1` comment if kept); no dangling imports in any test.

---

## Risks

1. **Studio-gating test flip** — T9 rewrites `MinistryRoom.studio.test.tsx`; the 2026-09-16 removal decision is recorded in its header (`:2-7`). Guard: rewrite in the SAME commit as the nav/dispatch change; header comment updated to reference this spec's reversal.
2. **Orphan deletion ENOENTs the label test** — `brokerAgnosticLabels.test.ts:14-23` references `TradeOrderForm`/`TradingHud`/`ConfluencePanel` by path. Guard: T12 updates the list in the same commit; `npm test` is the check.
3. **Registry refactor silently changes `EarningsRooms` behavior** — the "🧭" fallback today is dead-wrong for every non-ministry category (wrong-keyed `SUITE_META[stream.category]`); the fix changes visible icons. Guard: snapshot/visual check on `/suites/earnings/*` in T1 acceptance; existing earnings-room tests or a new one pin the resolved icon per family.
4. **PWA precache goes stale after deploys** — precache list is build-injected; if `sw.js` serves an old shell, users see a stale offline hub. Guard: `cacheName` versioned by package version + registration `updateViaCache` default; document a manual SW-bump step in the deploy checklist (note in PR body).
5. **Bundle budget overrun on the hub** — the hub pulls in per-stream breakdown + ministry launch cards; code-splitting must keep the shared shell lean. Guard: T7 numbers recorded in PR body; if `>` budget, ship slicing (lightweight-charts is heavy — verify it stays inside the trading chunk, not the shell).
6. **Theme sweep misses a raw hex used for semantics** (e.g. `SessionPanel.tsx:46` `#fff` foreground on a dark app — a real contrast bug today). Guard: T5 comment-exemption policy + visual spot-check per theme.

## Honesty notes

- No demo/live gates touched: this spec changes no server endpoints, rate limits, authorship gates, or feed modes. T10 speaks to an existing endpoint (`handlers.mjs:2280-2322`); it adds persistence in the dashboard only.
- Fabricated-state risk: none introduced. The hub totals are real sums over `getStreams()`/`getEarnings()`; offline mode renders "unavailable" states, never zeros; all scaffold rooms keep "under development — no fabricated data" (`HonestScaffold.tsx:12-18`).
- Studio stays a status surface: the universal studio rooms surface the same running/connected/feed state as the standalone page; the studio never fabricates "live" for a stopped headless session (U5 + U3 contracts, unchallenged).
- UNVERIFIED this session (verify before relying): `src/components/UserMenu.tsx` and any other unreviewed string files for brand copies (T3 greps will catch them at execution); `Dashboard.tsx` test files covering the hub (T8 calls for a check); exact line spans of `suites.test.ts` pins beyond the grep hit at `:13-22`; `packages/*` or extension (`apps/extension`) brand strings — extension is out of scope here but flagged for the sweep.
- The single most likely breakage: **T9 flipping the studio-gating suite** — the tests exist to enforce the old decision, so the flip looks like a regression unless the header comment and the spec reference land in the same commit.