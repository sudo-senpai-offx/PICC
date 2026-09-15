# PICC Expanded-Scope Implementation Plan (SP-0 → SP-4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PICC's trading suite and ministry shell from mostly-dysfunctional wiring into an observably functional, production-grade, honest-state country-of-ministries dashboard, with a per-ministry integration registry.

**Architecture:** Six phases run in order: SP-0 observes the running app and produces the authoritative defect ledger; SP-1 fixes shell/IA (inner sidebar always-expanded, real room routes, curated room compositions of EXISTING panels); SP-2 dedupes to one owner per concept; SP-3 refurbishes every page; SP-4 reimplements broken surfaces one-by-one with the narrowest backend fix each needs. The integration registry (R9.2) is a server-owned per-ministry catalog generalizing the existing `captureProfiles.mjs` precedent. No wholesale server re-architecture; 410 advisory-first stays.

**Tech Stack:** React 19 + TS 5.8 + react-router 7 (dashboard), vite 7 dev server w/ in-process /api middleware (single `npm run dev` on 5173), Node server, vitest 3 + jsdom (repo-native tests: NO @testing-library/react), Playwright via Python for browser verification (python 3.10.11 + playwright installed; `scripts/with_server.py`), lightweight-charts, ccxt.

**Spec:** `docs/superpowers/plans/2026-09-08-picc-ministry-ia-rebuild-expanded-design.md` (binding; approved 2026-09-08; SP-0..SP-4 + §2 decisions + §9 mandate + §10 Q1 resolved). The plan argues from the spec; executors read both.

## Global Constraints

- Autopilot start/stop 410 (advisory-first). No order-execution re-enablement, ever.
- No fake credentials, no fabricated venues/data, no weakened honesty labels. Unconfigured ≠ zero-filled.
- `simulator|agents|income` FeatureKeys are additive-only (never deleted).
- Extension (`apps/dashboard/extensions/picc-overlay/`) stays read-only server-driven sensor; zero diff. Per-ministry site lists live server-side.
- No `npm install` unless dependencies ACTUALLY change (a deliberate ADOPT of a new library in SP-4 is a real dependency change: pin exact version, license-reviewed MIT/Apache per research dossier, state the change in the commit).
- Repo-native tests only: `// @vitest-environment jsdom` docblock + createRoot + flushSync + exact-text DOM lookups. NEVER import @testing-library/react.
- Root `npm run typecheck` (tsc -b --noEmit) exit 0 at every slice end; `npm test --workspace @picc/dashboard` green per slice.
- `TradingSuite.deeplink.test.tsx` stays green AND UNCHANGED — deep links resolve into the re-homed composition; any change to that test requires explicit user approval first.
- verification-before-completion: no completion claim without a fresh run in THIS session.
- Working dir for all commands: `apps/dashboard` unless stated otherwise.

---

## SP-0 — Functional baseline (OBSERVATION ONLY, no code)

Goal: observe the running app and record what ACTUALLY works. Output is the
reimplementation queue for SP-1..SP-4. No source edits in this phase; Playwright
scripts and the ledger live in `.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/` (uncommitted by convention).

### Task 0.0: Environment readiness

**Files:**
- Create: `.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/sp0-runbook.md` (notes file)
- Test: none (observation phase)

- [ ] **Step 1: Verify dev stack boots**

Run (from `apps/dashboard`): `npm run dev`
Expected: vite serving on `http://localhost:5173` (strictPort). The vite plugin
mounts `handleApi` for `/api/*` — the SPA and API are one server in dev.

Verify API: `curl http://localhost:5173/api/trading/status` (or the probe in
`scripts/probe-e2e-decisions.mjs` referenced from `npm run smoke:trading`).

- [ ] **Step 2: Verify local auth path**

`apps/dashboard/src/lib/auth.ts` exports `signUpLocal`/`signInLocal`/`getAuthStatus`;
`Login.tsx` mode-flips to signup when `!s.hasUsers`. SP-0 uses the app's OWN local
account to log in — this is not a fake credential, it is the app's local auth.

Create one local user via the UI (email `sp0.observer@picc.local`,
password ≥ 8 chars) OR via `signUpLocal` in a Playwright script.

- [ ] **Step 3: Note the honest-observation caveat in sp0-runbook.md**

Record which of these are configured in this environment (check `.env` keys
without printing values): `SERPER_API_KEY`, broker demo config, extension
connected? The ledger must say what was and wasn't observable. If the extension
is disconnected and keys are unset, that IS the user's truth — degraded surfaces
stay degraded in the ledger.

**Deliverable:** dev stack boots, an authenticated session is provable, and the
runbook records the environment's configured/unconfigured surface.

### Task 0.1: Observe every trading panel

**Files:**
- Create: `.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/sp0-panels.md` (evidence log)
- Create: `.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/playwright-sp0-panels.py`

- [ ] **Step 1: Write the Playwright walker**

Script per `C:\Users\sharv\.agents\skills\webapp-testing\SKILL.md` (with_server.py
at `C:\Users\sharv\.agents\skills\webapp-testing\scripts\with_server.py`):

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    console_msgs = []
    page.on("console", lambda m: console_msgs.append(f"{m.type}: {m.text}"))
    page.goto("http://localhost:5173/login")
    page.wait_for_load_state("networkidle")
    # sign in (mode flips to signup when no users)
    page.fill("input[type=email]", "sp0.observer@picc.local")
    page.fill("input[type=password]", "sp0-observer-pass")
    if page.locator("input[name=name], input[placeholder*='name' i]").count():
        page.fill("input[name=name], input[placeholder*='name' i]", "SP0 Observer")
    page.locator("button[type=submit]").click()
    page.wait_for_load_state("networkidle")
    page.goto("http://localhost:5173/suites/trading")
    page.wait_for_load_state("networkidle")
    page.screenshot(path=".superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/sp0-trading-landing.png", full_page=True)
    # capture section inventory: list every .card / panel heading on the page
    headings = page.locator("h1,h2,h3,.card-title").all_inner_texts()
    print("HEADINGS:", headings)
    print("CONSOLE_END:", console_msgs[:50])
    browser.close()
```

- [ ] **Step 2: Run the walker against every trading surface**

For EACH panel/room: navigate, wait networkidle, screenshot, dump DOM text
(`page.locator("body").inner_text()`), collect console errors. Keep one
consolidated log `sp0-panels.md` with one section per surface.

Target inventory (confirmed exports/panels in `TradingSuite.tsx`):
StatusCard(s), PortfolioPanel, PortfolioAggregatePanel, AccountMetricsPanel,
PaperAnalyticsCard, PaperTradingCard, WatchlistPanel, WatchlistScannerCard,
ScreenerPanel, LiveDecisionsPanel, ConvergencePanel, LedgerPanel,
TradePlannerCard, NewsCard, MarketIntelPanel, PredictionCard, ProAnalysisCard,
SignalNotificationsCard, SignalsCard, AdvancedIndicatorsPanel, PatternPanel,
BacktestPanel, ModelMatrixPanel, AlertPanel, CalendarPanel, SessionPanel,
SpreadPanel, TradeJournalPanel, CapabilitiesPanel, DataSourcesPanel, AssistantCard,
plus CommandCentrePanel (`@/components/CommandCentrePanel`) and AutopilotSuite.

- [ ] **Step 3: Classify each surface in sp0-panels.md**

Per surface record: renders? data flows (real values vs zeros vs empty)? console
errors? honest label present? Classify: **FUNCTIONAL / DEGRADED-honest /
DEFECTIVE**. Evidence: screenshot path + DOM snippet + console excerpt.

**Deliverable:** `sp0-panels.md` with a per-surface observation + classification.

### Task 0.2: Observe every non-suite page + shell

**Files:**
- Create: `.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/sp0-pages.md` (evidence log)

- [ ] **Step 1: Walk every route in scope**

Routes: `/` (Dashboard), `/opportunities`, `/settings`, `/profile`, `/suites/trading`,
`/suites/earnings`, `/suites/intelligence`, `/login`. For each: renders? console
errors? dead elements?

- [ ] **Step 2: Verify the dead-end nav behavior**

Click every inner-nav link in all three ministries; assert the URL bounces to `/`
(the known `*` catch-all). Record which bounced — this is SP-1's target list.

- [ ] **Step 3: Inspect ministry sidebar rendering**

Screenshot the ministry inner sidebar; note whether nav links overflow, whether
any scrollbar shows, whether layout breaks. Verify `localStorage['picc.rail.inner']`
has any effect (it should NOT, per SP-1 findings — inner rail is hardcoded 220px).

**Deliverable:** `sp0-pages.md` with per-page evidence.

### Task 0.3: Produce the baseline ledger

**Files:**
- Create: `.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/baseline-observed-states.md` ← THE QUEUE

- [ ] **Step 1: Merge sp0-panels.md + sp0-pages.md into the ledger**

Ledger rows: `| Surface | Route | Observed state | Evidence | SP action |`
SP action ∈ {keep, re-home, dedupe, refurbish, reimplement, honest-stub}.

- [ ] **Step 2: State the honest-observation scope**

The ledger's FUNCTIONAL claims are ONLY for surfaces observed working. Everything
else is DEFECTIVE/DEGRADED until proven otherwise. Note any surface the
environment could not exercise (e.g. requires extension or key) — it is recorded
as DEGRADED-honest / UNVERIFIED, never assumed live.

- [ ] **Step 3: Commit the phase marker**

The ledger stays UNCOMMITTED (.superpowers convention) but record the phase in
`progress.md`. Slice gate: ledger produced and read by the coordinator before SP-1.

---

## SP-1 — Shell & IA

### Task 1.1: Inner sidebar always-expanded

**Files:**
- Modify: `apps/dashboard/src/components/AppShell.tsx` (INNER_RAIL_KEY at :75, inner rail use :131, takeover effect :138-145, burger handler :172-175)
- Test: `apps/dashboard/src/components/__tests__/AppShell.nav.test.tsx` (labels pinned, survives)

**Interfaces:**
- Consumes: `useRailState`, `OUTER_RAIL_KEY` (unchanged), `useLocation`.
- Produces: AppShell with NO inner-rail state; entering a suite still collapses the outer rail only.

- [ ] **Step 1: Remove the inner rail state**

In `AppShell.tsx`:
- Delete `const INNER_RAIL_KEY = "picc.rail.inner"` (:75).
- Delete `const inner = useRailState(INNER_RAIL_KEY)` (:131).
- Takeover effect (:138-145) becomes: when `inMinistry` and outer rail is
  expanded, collapse only the outer rail — REMOVE the `inner.toggle()` line.
  (Design §3.4: "delete `inner` rail from both, drop `INNER_RAIL_KEY`, keep
  `if (!outer.collapsed) outer.toggle()`".)
- Burger handler (:172-175): remove the `inner.toggle()` branch; keep
  `outer.toggle()` unconditionally.

- [ ] **Step 2: Run the pinned nav test**

Run: `npx vitest run src/components/__tests__/AppShell.nav.test.tsx`
Expected: PASS with labels unchanged (no label edits).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` (repo root) → exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/AppShell.tsx
git commit -m "feat(ministries): lock inner rail expanded, drop inner collapse state"
```

### Task 1.2: Scoped scrollbar-hide + bounded ministry sidebar

**Files:**
- Modify: `apps/dashboard/src/index.css` (global scrollbar rules :23-49; `.ministry-sidebar` ~:1652-1658)

- [ ] **Step 1: Bound the sidebar height and hide its scrollbar scoped**

In the `.ministry-sidebar` block add a scoped hide so the ALWAYS-EXPANDED rail
scrolls invisibly when links overflow:

```css
.ministry-sidebar {
  width: 220px;
  border-right: 1px solid #333;
  padding: 12px;
  flex-shrink: 0;
  overflow-y: auto;
  height: 100%;
  scrollbar-width: none;          /* firefox: hide */
  -ms-overflow-style: none;       /* legacy edge/ie */
}
.ministry-sidebar::-webkit-scrollbar {
  display: none;                  /* chrome/safari: hide */
}
```

Do NOT touch the global scrollbar rules (:23-49) — other panels keep styled
scrollbars.

- [ ] **Step 2: Verify with Playwright**

Reuse the SP-0 walker: navigate `/suites/trading`, screenshot the sidebar; assert
links render fully and no native scrollbar thumb is visible. Save screenshot to
`.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/sp1-sidebar.png`.

- [ ] **Step 3: Typecheck + suite slice test**

Run: `npm run typecheck` (exit 0) and `npm test --workspace @picc/dashboard` (green).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/index.css
git commit -m "style(ministries): hidden-scrollbar bounded ministry sidebar"
```

### Task 1.3: Real room routes for every ministry

**Files:**
- Modify: `apps/dashboard/src/App.tsx` (suite branch, sub-routes)
- Create: `apps/dashboard/src/pages/ministry/DashboardRoom.tsx`, `MarketsRoom.tsx`, `PaperRoom.tsx`, `AutopilotRoom.tsx`, `CommandCentreRoom.tsx`, `SimulatorRoom.tsx`, `SettingsRoom.tsx`, `EarningsRooms.tsx`, `IntelligenceRooms.tsx`
- Test: `apps/dashboard/src/pages/__tests__/ministryRooms.test.tsx`
- Modify: `apps/dashboard/src/pages/MinistryShell.tsx` (no nav change needed — labels stay)

**Interfaces:**
- Consumes: `MinistryShell` (unchanged props/Outlet), existing panel components (see Task 1.4), `MinistrySettings` from `@/lib/ministrySettings` (P1 Task 4).
- Produces: sub-routes `/suites/:suiteId/<room>` rendering the room components; the `*` catch-all no longer swallows rooms.

- [ ] **Step 1: Write the failing room-routing test**

`src/pages/__tests__/ministryRooms.test.tsx` (repo-native pattern):

```tsx
// @vitest-environment jsdom
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { flushSync } from "react-dom"
// @ts-expect-error vitest global
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let host: HTMLDivElement | null = null
function mount(route: string) {
  host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="suites/:suiteId" element={<div data-testid="shell" />}>
            <Route index element={<div data-testid="landing" />} />
            <Route path="markets" element={<div data-testid="markets-room" />} />
            <Route path="autopilot" element={<div data-testid="autopilot-room" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
  })
}

describe("ministry room routes", () => {
  afterEach(() => { host?.remove(); host = null })
  it("renders a trading room at its sub-route", () => {
    mount("/suites/trading/markets")
    expect(host!.querySelector('[data-testid="markets-room"]')).toBeTruthy()
  })
  it("bounces unknown rooms nowhere (no * inside suite)", () => {
    mount("/suites/trading/autopilot")
    expect(host!.querySelector('[data-testid="autopilot-room"]')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify room routing is missing**

Run: `npx vitest run src/pages/__tests__/ministryRooms.test.tsx`
Expected: FAIL (no sub-routes exist; unknown path falls to `*` catch-all).

- [ ] **Step 3: Add the sub-routes in App.tsx**

Inside the existing `/suites/:suiteId` branch (which renders `<MinistryShell/>`
with `<Route index element={<Suites />} />`), add:

```tsx
<Route path="dashboard" element={<DashboardRoom />} />
<Route path="markets" element={<MarketsRoom />} />
<Route path="paper" element={<PaperRoom />} />
<Route path="autopilot" element={<AutopilotRoom />} />
<Route path="command-centre" element={<CommandCentreRoom />} />
<Route path="simulator" element={<SimulatorRoom />} />
<Route path="settings" element={<SettingsRoom />} />
```

Earnings + Intelligence rooms: same child-route pattern per their `INNER_NAV`
(dashboard/simulator/settings; dashboard/governor/guidance/settings) rendering
the honest scaffolds (Task 1.5).

- [ ] **Step 4: Create the room components**

`DashboardRoom.tsx` etc. initially render `<Outlet />`-free composition per
Task 1.4 (trading) or `<HonestScaffold>` per Task 1.5 (earnings/intelligence).
Create at least the trading room files with the compositions from Task 1.4 and
the ministry scaffolds.

- [ ] **Step 5: Run the room test + existing suite tests**

Run: `npx vitest run src/pages/__tests__/ministryRooms.test.tsx` → PASS.
Run: `npx vitest run src/pages/__tests__/MinistryShell.test.tsx src/components/__tests__/AppShell.nav.test.tsx` → PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` (exit 0). Commit:
`git add apps/dashboard/src/App.tsx apps/dashboard/src/pages/ministry/ apps/dashboard/src/pages/__tests__/ministryRooms.test.tsx`
`git commit -m "feat(ministries): real room routes under each ministry shell"`

### Task 1.4: Trading room compositions (re-home existing panels)

**Files:**
- Modify: `apps/dashboard/src/pages/ministry/DashboardRoom.tsx`, `MarketsRoom.tsx`, `PaperRoom.tsx`, `AutopilotRoom.tsx`, `CommandCentreRoom.tsx`, `SimulatorRoom.tsx` (contents)
- Test: `apps/dashboard/src/pages/__tests__/ministryRooms.test.tsx` (extend: assert real panel headlines render)

**Interfaces:**
- Consumes (all confirmed exports): `MarketsSuite`, `AutopilotSuite`, `SignalNotificationsCard` from `@/components/TradingSuite`; `CommandCentrePanel` from `@/components/CommandCentrePanel`; internal panels via `MarketsSuite` sections.
- Produces: curated per-room compositions. `Suites.tsx` index landing still hosts the full `MarketsSuite` + `CommandCentrePanel` tabs (deeplink path stays live).

- [ ] **Step 1: Define the curated distribution (extend a table in the room file comments + this plan)**

| Room | Panels (existing) |
|---|---|
| dashboard | StatusCards grid, LiveDecisionsPanel, TradePlannerCard, NewsCard, SignalNotificationsCard |
| markets | WatchlistPanel, SpreadPanel, MarketIntelPanel, CalendarPanel, SessionPanel, ScreenerPanel |
| paper | PaperTradingCard, PaperAnalyticsCard, LedgerPanel, TradeJournalPanel |
| autopilot | AutopilotSuite (whole), ProAnalysisCard, PredictionCard, ModelMatrixPanel |
| command-centre | CommandCentrePanel, PatternPanel, AdvancedIndicatorsPanel, SignalsCard |
| simulator | re-homed Simulator content (see §3.5 de-linked pages) |

Implementation note: internal panels (WatchlistPanel, SpreadPanel, …) are
currently rendered only inside `MarketsSuite`. Re-homing means the room
components import the SAME internal components — verify each is exported or
exported via a named sibling before wiring. If a panel is not exported, make the
narrowest change in `TradingSuite.tsx` to `export` it (no logic change) so rooms
can compose it. `TradePlannerCard`/`WatchlistScannerCard` are internal
(`function TradePlannerCard()` at :1637, `WatchlistScannerCard()` at :1742) —
export those two.

- [ ] **Step 2: Write the room compositions**

Each room file renders its panel grid with the existing `.card` grid classes
(`.grid`, `.card`, `.span-*` per index.css conventions). Copy the section markup
patterns from `MarketsSuite` so no visual invention is needed.

- [ ] **Step 3: Extend the room test asserting real headlines**

```tsx
it("markets room renders WatchlistPanel", () => {
  mount("/suites/trading/markets")
  expect(host!.textContent).toContain("Watchlist")
})
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/pages/__tests__/ministryRooms.test.tsx` → PASS;
`npm run typecheck` → exit 0.

- [ ] **Step 5: Playwright verify the rooms render**

Walk each trading room; assert no error boundary and no blank content. Save
`screenshots/sp1-rooms-*.png`.

- [ ] **Step 6: Commit**

`git commit -m "feat(ministries): curated trading room compositions re-homing existing panels"`

### Task 1.5: Earnings/Intelligence honest scaffolds

**Files:**
- Create: `apps/dashboard/src/pages/ministry/HonestScaffold.tsx`
- Modify: `apps/dashboard/src/pages/ministry/EarningsRooms.tsx`, `IntelligenceRooms.tsx`

- [ ] **Step 1: Build `HonestScaffold`**

A shared component: ministry icon + label, "under development" badge, honest
blurb ("This ministry's <room> surface is under development. No fabricated data —
configured capabilities will appear here."). No fake cards, no zero-filled
gadgets. Mirrors the P1 `Settings.tsx` honest-notes convention.

- [ ] **Step 2: Wire every earnings/intelligence room to the scaffold**

Earnings rooms: dashboard/simulator/settings → `HonestScaffold` labeled per room.
Intelligence rooms: dashboard/governor/guidance/settings → same. The ministry
index landing (`Suites.tsx` intent) remains reachable for earnings/intelligence
(via `/suites/earnings` → index → scaffolded landing).

- [ ] **Step 3: Playwright verify no dead-ends**

Click every earnings/intelligence room link; assert URL stays inside
`/suites/earnings|intelligence/*` and the scaffold headline renders.

- [ ] **Step 4: Typecheck + commit**

`git commit -m "feat(ministries): honest under-development scaffolds for earnings + intelligence rooms"`

### Task 1.6: Landing becomes a real ministry dashboard

**Files:**
- Modify: `apps/dashboard/src/pages/Suites.tsx` (keep exports/API; upgrade content)
- Test: `apps/dashboard/src/components/__tests__/TradingSuite.deeplink.test.tsx` (UNCHANGED, must pass)

- [ ] **Step 1: Add room-link quick cards**

At the top of `Suites.tsx` above the tabs: a row of room links (Dashboard,
Markets, Paper, Autopilot, Command Centre, Simulator, Settings) as
`<NavLink to={room}>` cards. Deep-link tab behavior (`?asset=&panel=&venue=`)
stays exactly as-is.

- [ ] **Step 2: Run the deeplink test untouched**

Run: `npx vitest run src/components/__tests__/TradingSuite.deeplink.test.tsx` → PASS (no edits to the test).

- [ ] **Step 3: Playwright click-through + commit**

From `/suites/trading` click each room card; assert navigation. Then:
`git commit -m "feat(ministries): ministry landing dashboard with room links"`

### Task 1.7: Shell slice gate (typecheck + suite + Playwright)

- [ ] **Step 1: Full static + unit gate**

Run: `npm run typecheck` (exit 0); `npm test --workspace @picc/dashboard` (green).

- [ ] **Step 2: Full no-dead-end walk**

Playwright: enter each ministry, click EVERY room link, assert no bounce to `/`
and no error boundary. Record in `sp0-pages.md` → update ledger rows for nav.

- [ ] **Step 3: Record SP-1 complete in progress.md**

---

## SP-2 — Dedupe (one owner per concept)

### Task 2.1: Metrics → one Portfolio owner

**Files:**
- Modify: `apps/dashboard/src/components/TradingSuite.tsx` (remove the non-owner metric surfaces)
- Test: extend `ministryRooms.test.tsx` + run full suite
- Test: `apps/dashboard/src/components/__tests__/TradingSuite.deeplink.test.tsx` (UNCHANGED, green)

- [ ] **Step 1: Choose the owner by wiring strength (ledger-informed)**

Six metric surfaces: PortfolioPanel, PortfolioAggregatePanel, AccountMetricsPanel,
PaperAnalyticsCard, demo-analytics (AutopilotSuite), StatusCards. Decide the owner
from SP-0 evidence (strongest data path) — PROPOSED owner: `PortfolioPanel`
(+ `StatusCards` kept as the lightweight shell summary; they are a different
concept: environment status, not portfolio math).

- [ ] **Step 2: Remove non-owner panels from all room compositions**

Delete or stop rendering non-owner surfaces in `MarketsSuite`/rooms. Keeping the
component definitions (dead code) is acceptable; removing them from the DOM is
the requirement. Prefer removing from DOM over deleting files (files may be
re-homed in SP-3/SP-4).

- [ ] **Step 3: Verify nothing observable disappears**

Playwright: portfolio surfaces still show real values; only duplicate cards
gone. Screenshot before/after into `.superpowers`.

- [ ] **Step 4: Suite green + commit**

`git commit -m "refactor(trading): dedupe metric surfaces to one portfolio owner"`

### Task 2.2: Decisions → one owner

- [ ] **Step 1: Pick owner between LiveDecisionsPanel + ConvergencePanel**

Same dedupe logic (one renders `/trading/decisions`; the other is redundant —
SP-0 decides which shows real data). Remove the loser from rooms.

- [ ] **Step 2: Verify + commit**

`git commit -m "refactor(trading): single decisions surface owner"`

### Task 2.3: Watchlist trio → one Watchlist + one Screener

- [ ] **Step 1: Merge**

WatchlistPanel (full watchlist) stays; WatchlistScannerCard is removed from
rooms (its scanner function folds into the ScreenerPanel's watchlist-scoped
option, added in SP-4 Task 4.4).

- [ ] **Step 2: Verify + commit**

`git commit -m "refactor(trading): watchlist surfaces merge into watchlist + screener"`

### Task 2.4: Outcome records → ledger owns settlements

- [ ] **Step 1: Ledger owns**

LedgerPanel `/trading/ledger` owns observed payouts; demo settled/deals +
PaperAnalyticsCard outcome tables are removed from rooms or reduced to a "see
Ledger" link. No data deletion — only surface removal.

- [ ] **Step 2: Verify + commit**

`git commit -m "refactor(trading): outcome records consolidated under the ledger"`

### Task 2.5: Honest stub card stays honest

- [ ] **Step 1: TradePlannerCard**

TradePlannerCard (honest "local math, no network" calculator) keeps its truthful
labeling through dedupe; it gains REAL validated math in SP-4 Task 4.3. No label
weakening here.

- [ ] **Step 2: Slice gate**

Full `npm run typecheck` + suite green; Playwright spot-check that dedupe removed
cards and preserved data; record SP-2 in progress.md.

---

## SP-3 — Page-by-page refurbishment

### Task 3.1: Dashboard

**Files:**
- Modify: `apps/dashboard/src/pages/Dashboard.tsx`

- [ ] **Step 1: Fill with real re-homed content**

Preview: hero strip (server health + ministry status from `/api/trading/status` +
`/health`), cumulative ministry summary (reuse server `aggregateMinistries` from
P1 Task 5 or the trading aggregate), ministry room quick-links. No placeholder
gadgets; data that can't be read shows honest "unconfigured" state.

- [ ] **Step 2: E2E + test deps**

`Dashboard.quickActions.test.tsx` must stay green (labels unchanged) — verify.
Playwright screenshot into `.superpowers`.

- [ ] **Step 3: Commit**

`git commit -m "feat(dashboard): real ministry summary + status hero"`

### Task 3.2: Opportunities

**Files:**
- Modify: `apps/dashboard/src/pages/Opportunities.tsx`
Per frontend-design skill: real opportunity cards from existing data (watchlist
signals, screener top movers), honest empty state. E2E screenshot + commit.

### Task 3.3: Profile

**Files:**
- Modify: `apps/dashboard/src/pages/Profile.tsx`
Polish + real data (account from local auth/session), no fabrication. Commit.

### Task 3.4: Settings (per-ministry settings surface)

**Files:**
- Modify: `apps/dashboard/src/pages/ministry/SettingsRoom.tsx`, `apps/dashboard/src/pages/Settings.tsx` (keep PICC-scoped + honest note)
- Consumes: `getMinistrySettings`/`saveMinistrySettings` + `AutopilotMode` from `@/lib/ministrySettings` (P1 Task 4)

- [ ] **Step 1: Surface the per-ministry settings**

`SettingsRoom` binds the two controls (autopilot/copilot flip-switch +
confidenceThreshold) to `ministrySettings` storage. Honest labels: no
claims beyond what the setting does; demo-gated capabilities stay gated.

- [ ] **Step 2: Test the bindings**

`src/lib/__tests__/ministrySettings.test.ts` exists (P1) — add a component-level
test asserting the flip-switch persists via `saveMinistrySettings` (repo-native
mount). Commit.

### Task 3.5: Login

**Files:**
- Modify: `apps/dashboard/src/pages/Login.tsx`
Polish per frontend-design skill; honest copy (no "AI manages your money"
overclaim — keep "you stay in control"). E2E screenshot. Commit.

### Task 3.6: Suites landing

Finish the landing polish from Task 1.6 if needed (room cards + ministry
overview), per the ledger. Commit.

### Task 3.7: Shell chrome (TopBar/CommandPalette)

**Files:**
- Modify: `apps/dashboard/src/components/TopBar.tsx`, `apps/dashboard/src/components/CommandPalette.tsx`
Polish per frontend-design; CommandPalette must keep all its pinned label tests
(`CommandPalette.test.tsx:60-83`) green. Commit.

### Task 3.8: Re-home dead-page content

**Files:**
- Modify: `apps/dashboard/src/pages/ministry/SimulatorRoom.tsx` (absorb Simulator.tsx trading content)
- Decide + act: `Simulator.tsx`, `Agents.tsx`, `Income.tsx`, `StreamPage.tsx` become reachable again OR deleted — USER DECISION at this task's checkpoint (design §8.3).

- [ ] **Step 1: Re-home content**

Simulator content → trading SimulatorRoom; Agents content → intelligence
scaffold upgrade (honest); Income/Streams content → earnings scaffolds.
Preserved files: if re-homing is complete and no route will ever reference them,
propose deletion in a commit message the user can veto; otherwise leave files
with a header comment "re-homed into /suites/... — kept for reference".

- [ ] **Step 2: Slice gate**

Suite + typecheck green; Playwright screenshots per refurbished page in
`.superpowers/sdd/2026-09-08-picc-ministry-ia-rebuild/sp3-*.png`. Record SP-3 + the dead-page decision in progress.md.

---

## SP-4 — Broken-surface reimplementation (one-by-one)

Queue source: SP-0 ledger + the known wiring-level candidates below. Ordered by
impact (ledger-informed). Each task: narrowest backend fix ONLY, tests, honest
labels, gates unchanged.

### Task 4.1: Autopilot decisions/why routes

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (add the two missing routes; server logic exists in `autopilot.mjs`)
- Modify: `apps/dashboard/src/pages/ministry/AutopilotRoom.tsx` (call the two lib functions)
- Test: `apps/dashboard/server/__tests__/autopilotRoutes.test.mjs`

- [ ] **Step 1: Write the failing server test**

`getAutopilotDecisions`/`whyAutopilot` exist in `autopilot.mjs` but have NO
handler routes. Test: `GET /api/trading/autopilot/decisions` returns the
decisions shape; `GET /api/trading/autopilot/why?assetId=X` returns the why
shape (mirror `handler.mjs` conventions + existing route tests).

- [ ] **Step 2: Add the two routes in handlers.mjs**

Wire the existing functions; keep the `autopilot/start`/`autopilot/stop` 410
behavior EXACTLY as-is (do not touch those routes).

- [ ] **Step 3: Wire the client**

`AutopilotRoom` calls `getAutopilotDecisions`/`whyAutopilot` from `@/lib/trading`
(instrumented UI: decisions list + per-asset "why" expander). Honest empty state.

- [ ] **Step 4: Green + typecheck + E2E + commit**

`git commit -m "feat(trading): wire autopilot decisions + why routes"`

### Task 4.2: Walk-forward hyperopt panel

**Files:**
- Modify: `apps/dashboard/src/pages/ministry/AutopilotRoom.tsx` (or BacktestPanel) — add panel
- Consumes: existing `/trading/walk-forward` endpoint (NO new engine)

- [ ] **Step 1: Panel + caller**

Add a WalkForwardCard that calls the existing endpoint and renders the
hyperopt result (params grid, walk-forward windows, honesty: methodology
explained in-card). No new server engine — the endpoint exists.

- [ ] **Step 2: E2E + commit**

`git commit -m "feat(trading): walk-forward hyperopt panel wiring existing endpoint"`

### Task 4.3: TradePlannerCard — real validated math

**Files:**
- Modify: `apps/dashboard/src/components/TradingSuite.tsx` (TradePlannerCard at :1637)
- Test: `apps/dashboard/src/lib/__tests__/positionMath.test.ts` (new pure helpers)

- [ ] **Step 1: Extract pure position-math helpers**

`computePositionSize(equity, riskPct, entry, stop)` and
`computeRiskReward(entry, stop, target)` + Kelly guidance line (reuse existing
Kelly in `@/lib/trading` if surfaced; else plain half-Kelly formula from the
corpus). Unit-test the formulas (round-trip, edge cases: stop==entry → null).

- [ ] **Step 2: Replace the local-math body**

Card keeps its honest provenance header ("position planner — local math, not an
order") but the math is now the validated helpers; results show size, risk
currency, R:R, and a confidence footnote. No order-execution affordances.

- [ ] **Step 3: Green + commit**

`git commit -m "feat(trading): trade planner real position math + kelly guidance"`

### Task 4.4: Screener watchlist-scoped universe

**Files:**
- Modify: `apps/dashboard/src/components/TradingSuite.tsx` (ScreenerPanel)
- Consumes: `screenerRun(opts)` already accepts `symbols[]` (`trading.ts:1141`)

- [ ] **Step 1: Add the scope toggle**

Screener gains "Universe: All / Watchlist" toggle — watchlist passes
`symbols: getWatchlists()/watchlist quotes` into `screenerRun`. Honest label for
empty watchlist ("add symbols to your watchlist to scope the screener").

- [ ] **Step 2: Green + commit**

`git commit -m "feat(trading): screener watchlist-scoped universe"`

### Task 4.5: Serper graceful degraded news

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` + `NewsCard` in `TradingSuite.tsx`

- [ ] **Step 1: Honest no-key state**

When `SERPER_API_KEY` is unset: endpoint returns 200 with
`{ ok: true, sources: [], degraded: { reason: "news_api_unconfigured" } }` —
NEVER fake news, NEVER a 500. NewsCard renders the honest reason + "configure
SERPER_API_KEY to enable live news" hint.

- [ ] **Step 2: Test the endpoint**

Server test asserts the no-key response shape; client test asserts the honest
label renders. Commit: `git commit -m "feat(trading): graceful degraded news state when key unset"`

### Task 4.6: Risk metrics upgrade (research-wave adoption)

**Files:**
- Modify: `apps/dashboard/src/pages/ministry/PaperRoom.tsx` or a new `RiskMetricsCard`
- Consumes: research dossier `research-live-adoption.md` (VaR/CVaR + Sharpe/Sortino/Calmar + Monte Carlo)
- Deps: ADD `@railpath/finance-toolkit@0.5.4` (MIT, npm-verified) — real dependency change, license-pinned (design §5/gates allow when deps actually change)

- [ ] **Step 1: Declare the dependency deliberately**

```bash
npm install @railpath/finance-toolkit@0.5.4
```
Check-in the lockfile change with a comment in the commit body citing the
license (MIT) + dossier URL.

- [ ] **Step 2: New RiskMetricsCard**

From the portfolio/paper history compute: VaR(95), CVaR(95) (historical +
parametric via finance-toolkit), Sharpe, Sortino, Calmar, max drawdown %.
Best-of-best presentation per dossier (equity drawdown bars, metric table).
Honest zero/empty state when < N observations.

- [ ] **Step 3: Test the pure metrics**

Extract `computeRiskMetrics(returns)` behind the toolkit; unit-test with a known
returns series (assert VaR/CVaR monotonicity, ratio formulas); toolkit is
wrapped, never leaked into components.

- [ ] **Step 4: E2E + commit**

`git commit -m "feat(trading): risk metrics card (VaR/CVaR/sharpe/sortino/calmar + monte carlo)"`

### Task 4.7: Niche indicators implementation

**Files:**
- Create: `apps/dashboard/src/lib/indicators.ts` (Choppiness, TSI, DeMarker, Fisher Transform, Coppock)
- Test: `apps/dashboard/src/lib/__tests__/indicators.test.ts`

- [ ] **Step 1: Implement the five indicators from corpus formulas**

JS/TS ecosystem has NO permissive package covering all five (dossier verdict:
implement in-house; `@ixjb94/indicators@1.2.6` MIT as cross-check only — do not
add as a dependency unless needed). Formulas in `COMPREHENSIVE_TRADING_KNOWLEDGE_BASE.md`. DeMarker has no existing implementation anywhere → custom.

- [ ] **Step 2: Property tests**

Deterministic output on a fixed series; length/NaN contracts; cross-check
Choppiness/TSI/Fisher/Coppock values against a hand-computed small series.

- [ ] **Step 3: Surface in AdvancedIndicatorsPanel or MarketsRoom**

Add the five to the indicators surface with honest labels ("implemented in-house —
formulas from the corpus"). Commit.

### Task 4.8: Integration registry (R9.2) — server-owned per-ministry catalog

**Files:**
- Create: `apps/dashboard/server/services/integrationRegistry.mjs`
- Test: `apps/dashboard/server/__tests__/integrationRegistry.test.mjs`
- Modify: `apps/dashboard/server/handlers.mjs` (`GET /api/integrations` + `GET /api/integrations/:ministry`)
- Modify: `apps/dashboard/src/lib/integrations.ts` + a room surface (e.g. SettingsRoom "Integrations" tab)
- Deps: NONE (no new installs; catalog is server-owned data)

- [ ] **Step 1: Registry model (generalizes captureProfiles)**

```js
// integrationRegistry.mjs
// shape: { id, ministry, name, url, purpose, dataImported[], boundary: { freeTier, rateLimit, keyRequired }, state: "connected"|"unconfigured"|"degraded", addedAt }
```

Seed ≤ 3 verified free-tier sources per ministry from `research-live-integrations.md`
(only the VERIFIED ones: Trading → Twelve Data, Binance public, GDELT or Marketaux;
Earnings → SEC EDGAR XBRL, GotCashback, AffiliateRoll; Intelligence → Tavily,
OpenAlex, arXiv). State starts `unconfigured` (honest) unless a probe proves
`connected` (SP-0/4 environment). Additive — `integration.<id>` FeatureKey-gated.

- [ ] **Step 2: Tests**

Registry returns per-ministry lists; unknown ministry → `[]`; every seed entry
has the full honest boundary shape; state never defaults to "connected".

- [ ] **Step 3: Handlers + client + surface**

`GET /api/integrations` + `/:ministry` (honest states); lib wrapper; SettingsRoom
tab renders the registry table with per-source boundary + state badge, plus a
footer note: "Read-only info acquisition honoring each source's free-tier
boundaries. New sources are added over time (PICC-as-a-country)."

- [ ] **Step 4: Green + E2E + commit**

`git commit -m "feat(integrations): per-ministry integration registry (read-only, boundaries honored)"`

### Task 4.9: Remaining SP-0 queue (template)

- [ ] **Step 1: For every DEFECTIVE surface in the SP-0 ledger not yet handled:**

Write a brief (in `.superpowers/sdd/.../task-brief.md`): surface, observed
defect (evidence), data path (lib fn + endpoint), narrowest backend fix,
acceptance criteria (observable E2E), honesty requirements. Implement with the
same pattern as Tasks 4.1-4.5 (test-first, narrowest fix, honest labels).

- [ ] **Step 2: Slice gate**

Full static + suite + Playwright verification per surface; 410/gates untouched;
record each in progress.md.

---

## Self-review (per writing-plans skill)

**Spec coverage:** design §2 decisions 1-6 → SP-1.1/1.2/1.3/1.5 (sidebar), SP-2/SP-4 (shape C), SP-1/SP-3 boundary (B), SP-3.4 (per-ministry settings), SP-0 (observation-first). §3 findings → SP-1.3 (dead-end rooms), SP-2 (dupes), SP-4.1-4.5 (broken queue). §4 decomposition → one phase per SP. §5 verification → per-slice gates. §6 gates → Global Constraints + per-task honesty steps. §9 mandate → SP-4.6/4.7 (adoption), SP-4.8 (registry), research dossier citations. §10 Q1 → SP-4.8 read-only registry; Q2 → resolved (research ran NOW; plan grounded).

**Placeholder scan:** none — every task names files, tests, commands, and code
snippets. SP-4.9 is intentionally template-driven because its content is the
SP-0 ledger's discovered defects (unknowable at plan time by definition); the
template + acceptance contract is fully specified.

**Type consistency:** `AutopilotMode`/`MinistrySettings` (P1 T4) consumed by
SP-3.4; `getMinistrySettings`/`saveMinistrySettings` names match P1 plan.
`screenerRun` symbols param matches `trading.ts:1141`. `computeRiskMetrics`,
`computePositionSize`, `computeRiskReward`, `integrationRegistry.mjs` defined
where first used and reused consistently.

---

## Execution handoff

After user review: **Subagent-Driven** (recommended — fresh subagent per task,
coordinator reviews between tasks, SP-0 is coordinator-run observation) or
**Inline** batch execution with checkpoints. SP-0 MUST be run by the coordinator
(or a single observe-only agent) before any SP-1 subagent work begins.