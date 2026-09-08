# PICC Ministry / IA Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PICC as a country of ministries — Trading, Earnings, Intelligence for PICC — over a shared spine, with per-ministry workspaces, a two-level route/nav IA, per-ministry settings (incl. the autopilot/copilot flip-switch), a cumulative dashboard, and a generalized overlay extension.

**Architecture:** Three ministry workspaces under `/suites/:suiteId/...`, each with its own dashboard, inner sidebar, simulator, and settings. The Intelligence ministry is the master (prime-minister/governor) suite. Outer sidebar groups: Command (Dashboard, Opportunities), Suites (Trading/Earnings/Intelligence), Account (Settings [PICC-scoped], Profile). Two-level nesting with pseudo-full-takeover (entering a suite collapses the outer rail; expanding the outer collapses the inner). Shared spine (models/agents/workflows) is a design target, not assumed working.

**Tech Stack:** React 18 + react-router-dom 6, TypeScript, Vite, vitest + @testing-library/react (component tests in `components/__tests__/*.test.tsx`, logic tests in `lib/__tests__/*.test.ts`), localStorage for persisted feature flags and sidebar state.

**Spec:** `docs/specs/PICC_SUITE_MINISTRY_MODEL_v1.md`

## Global Constraints

- **Honesty contract:** Unconfigured ≠ zero. Never fabricate values; use `source:"none"` / honest emptiness. Never weaken demo/live gates, honesty labels, or rate limiters to make tests pass.
- **Trading stays paper/demo.** No real-money execution or funding-path build (REQ-16). The go-live gate is user-tripped only.
- **No onboarding/quick-setup wizard.** `zero-to-one` is strategy + progress-to-profitability, not onboarding (REQ-7).
- **Additive FeatureKey only.** Do not delete `FeatureKey` members; `lib/settings.ts` grows lazily. (Old keys `simulator|agents|income` stay as dead keys whose routes are removed; removing them is out of scope.)
- **Two-level routes only.** No top-level `simulator`, `agents`, or `income` pages survive. Simulators exist only per-ministry.
- **Collapse state is remembered** per the user's deliberate choice (localStorage), per-rail (outer + inner) — do not reuse a single shared boolean.
- **CSS conventions:** keep the existing `.shell`, `.sidebar`, `.nav`, `.tabs`, `.card` classes in `index.css`; add ministry-scoped styles alongside, not a rewrite.
- Commit style: conventional, lowercase scope, e.g. `feat(ministries): add earnings + intelligence suite ids`.

---

### Task 1: Ministry registry with status

**Files:**
- Modify: `apps/dashboard/src/lib/suites.ts`
- Test: `apps/dashboard/src/lib/__tests__/suites.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type SuiteId = "trading" | "earnings" | "intelligence"`; `export type SuiteStatus = "production" | "under-development"`; `export interface SuiteMeta { id: string; label: string; icon: string; blurb: string; status: SuiteStatus }`; `SUITE_META: Record<string, SuiteMeta>` containing exactly `trading`, `earnings`, `intelligence`; `suiteMeta(id?)` unchanged in signature.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/__tests__/suites.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { SUITE_META, suiteMeta } from "@/lib/suites"

describe("ministry registry", () => {
  it("exposes exactly the three ministry ids", () => {
    expect(Object.keys(SUITE_META).sort()).toEqual(["earnings", "intelligence", "trading"])
  })

  it("flags Trading as production and Earnings/Intelligence as under-development", () => {
    expect(SUITE_META.trading.status).toBe("production")
    expect(SUITE_META.earnings.status).toBe("under-development")
    expect(SUITE_META.intelligence.status).toBe("under-development")
  })

  it("records a core-purpose blurb per ministry", () => {
    for (const meta of Object.values(SUITE_META)) {
      expect(meta.blurb.length).toBeGreaterThan(0)
    }
  })

  it("resolves an id via suiteMeta", () => {
    expect(suiteMeta("trading")?.label).toBe("Trading")
  })

  it("returns null for a retired category id", () => {
    expect(suiteMeta("depin")).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/suites.test.ts`
Expected: FAIL — `SUITE_META` currently has 8 keys (`trading, depin, nft, defi, crypto, p2p, agent, other`) and `SuiteMeta` has no `status`.

- [ ] **Step 3: Rewrite `apps/dashboard/src/lib/suites.ts`**

Replace the whole file:

```ts
export type SuiteId = "trading" | "earnings" | "intelligence"
export type SuiteStatus = "production" | "under-development"

export interface SuiteMeta {
  id: string
  label: string
  icon: string
  blurb: string
  status: SuiteStatus
}

/** Client display metadata for every ministry id. Server owns feature/overlay flags. */
export const SUITE_META: Record<string, SuiteMeta> = {
  trading: {
    id: "trading",
    label: "Trading",
    icon: "📈",
    blurb: "Market execution, venues, models and P&L. Paper/demo until the go-live gate passes.",
    status: "production"
  },
  earnings: {
    id: "earnings",
    label: "Earnings",
    icon: "💰",
    blurb: "The broad income ministry: cashback, micro-task, UX, referral, affiliate, royalty, yield and agent-income.",
    status: "under-development"
  },
  intelligence: {
    id: "intelligence",
    label: "Intelligence for PICC",
    icon: "🧭",
    blurb: "Prime-minister suite: the governor, decision support, and zero-to-one guidance toward profitability.",
    status: "under-development"
  }
}

/** Resolve display metadata for a ministry id (falls back to null). */
export function suiteMeta(id?: string | null): SuiteMeta | null {
  if (id && Object.hasOwn(SUITE_META, id)) return SUITE_META[id]
  return null
}
```

> Note: This retires `depin/nft/defi/crypto/p2p/agent/other` as ministry ids (folding per spec Decision C). `apps/dashboard/src/pages/Suites.tsx` still imports `SUITE_META` and `SuiteMeta`; it will be rewritten/removed in Task 4 — run only the suites test here; the broader build is exercised at the task's end gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/suites.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit`
Expected: exit 0. (If `Suites.tsx` still compiles against the reduced `SUITE_META`, fine; its `SUITE_CATEGORIES` now just shows the 3 ministries — acceptable for this task.)

```bash
git add apps/dashboard/src/lib/suites.ts apps/dashboard/src/lib/__tests__/suites.test.ts
git commit -m "feat(ministries): add earnings + intelligence suite ids with status"
```

---

### Task 2: Two-level route nesting

**Files:**
- Modify: `apps/dashboard/src/App.tsx`
- Modify: `apps/dashboard/src/components/AppShell.tsx` (remove `Simulator`/`Agents`/`Income` nav entries; add ministry entries) — coordinated here so routes and nav stay in one coherent slice
- Test: `apps/dashboard/src/components/__tests__/AppShell.nav.test.tsx` (new)

**Interfaces:**
- Consumes: `SUITE_META` (Task 1), `isFeatureOn`/`FeatureKey` from `@/lib/settings` (Task 3 adds new keys — gate imports on the keys existing; if `earnings`/`intelligence` keys are not yet in `FeatureKey`, this task adds them, see Task 3).
- Produces: routes `/suites/:suiteId` (ministry shell placeholder for Task 4), `/suites` (redirects to `/suites/trading`), no top-level `simulator|agents|income`.

- [ ] **Step 1: Add feature keys (settings lib)**

Modify `apps/dashboard/src/lib/settings.ts` line 1:
```ts
export type FeatureKey = "simulator" | "agents" | "opportunities" | "overlay" | "content" | "income" | "trading" | "browser" | "earnings" | "intelligence"
```
and in `FEATURES` (lines 8-17) add:
```ts
  earnings: { label: "Earnings Suite", desc: "The broad income ministry: cashback, micro-task, UX, referral, affiliate, royalty, yield and agent-income." },
  intelligence: { label: "Intelligence Suite", desc: "Prime-minister suite: the governor, decision support, and zero-to-one guidance." },
```
and in `DEFAULTS` (lines 19-28) add `earnings: true, intelligence: true,`.

- [ ] **Step 2: Write the failing nav test**

Create `apps/dashboard/src/components/__tests__/AppShell.nav.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AppShell } from "@/components/AppShell"
import { signOutLocal } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({ signOutLocal: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: "t" }, loading: false }) }))
vi.mock("@/components/TopBar", () => ({ TopBar: () => <div /> }))
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }))

describe("AppShell nav", () => {
  it("shows Command, Suites, Account groups with the ministry entries", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell />
      </MemoryRouter>
    )
    expect(screen.getByText("Dashboard")).toBeTruthy()
    expect(screen.getByText("Opportunities")).toBeTruthy()
    expect(screen.getByText("Trading")).toBeTruthy()
    expect(screen.getByText("Earnings")).toBeTruthy()
    expect(screen.getByText("Intelligence for PICC")).toBeTruthy()
    expect(screen.getByText("Settings")).toBeTruthy()
    expect(screen.getByText("Profile")).toBeTruthy()
  })

  it("no longer shows removed pages (Simulator, Agents, Income)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell />
      </MemoryRouter>
    )
    expect(screen.queryByText("Simulator")).toBeNull()
    expect(screen.queryByText("Agents")).toBeNull()
    expect(screen.queryByText("Income")).toBeNull()
  })

  it("labels the Suites group", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell />
      </MemoryRouter>
    )
    expect(screen.getByText("Suites")).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/AppShell.nav.test.tsx`
Expected: FAIL — current `AppShell` `NAV` has Command/Financial/Account with Simulator, Agents, Income, Suites; no "Earnings"/"Intelligence".

- [ ] **Step 4: Rewrite AppShell NAV + Add a ministry route**

In `apps/dashboard/src/components/AppShell.tsx` replace the `NAV` constant (lines 49-73) with:

```ts
const NAV: { section: string; items: { to: string; label: string; icon: string; feature: FeatureKey | null }[] }[] = [
  {
    section: "Command",
    items: [
      { to: "/", label: "Dashboard", icon: "▦", feature: null },
      { to: "/opportunities", label: "Opportunities", icon: "🧭", feature: "opportunities" }
    ]
  },
  {
    section: "Suites",
    items: [
      { to: "/suites/trading", label: "Trading", icon: "📈", feature: "trading" },
      { to: "/suites/earnings", label: "Earnings", icon: "💰", feature: "earnings" },
      { to: "/suites/intelligence", label: "Intelligence for PICC", icon: "🧭", feature: "intelligence" }
    ]
  },
  {
    section: "Account",
    items: [
      { to: "/settings", label: "Settings", icon: "⚙️", feature: null },
      { to: "/profile", label: "Profile", icon: "👤", feature: null }
    ]
  }
]
```

In `apps/dashboard/src/App.tsx`, restructure the child routes of `/` to:

```tsx
<Route index element={<Dashboard />} />
<Route
  path="suites/:suiteId"
  element={
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  }
/>
<Route path="suites" element={<Navigate to="/suites/trading" replace />} />
<Route path="trading" element={<Navigate to="/suites/trading" replace />} />
<Route
  path="opportunities"
  element={
    <RequireFeature feature="opportunities">
      <Opportunities />
    </RequireFeature>
  }
/>
<Route path="settings" element={<Settings />} />
<Route path="profile" element={<Profile />} />
```

> Note: `App.tsx` currently wraps everything in ONE `<AppShell/>` parent route. The restructure above is minimal: keep the existing single `<AppShell>` wrapper route (which contains index, opportunities, settings, profile) AND add the `/suites/:suiteId` branch as a SIBLING top-level route (also wrapped in RequireAuth + AppShell). Remove the `simulator`, `agents`, `income`, `streams/:id` routes. The `/suites/:suiteId` branch renders AppShell with the ministry inside (Task 4 fills the inner content). Keep the import of `Suites.tsx` only if still referenced — otherwise drop it (Task 4 removes `Suites.tsx`).

- [ ] **Step 5: Run the nav test to verify it passes**

Run: `npx vitest run src/components/__tests__/AppShell.nav.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b --noEmit`
Expected: exit 0 (route type errors within `App.tsx` reconcile with the new tree).

```bash
git add apps/dashboard/src/App.tsx apps/dashboard/src/components/AppShell.tsx apps/dashboard/src/components/__tests__/AppShell.nav.test.tsx apps/dashboard/src/lib/settings.ts
git commit -m "feat(ministries): two-level suite routes + regrouped sidebar"
```

---

### Task 3: Ministry shell + inner sidebar + pseudo-full-takeover

**Files:**
- Create: `apps/dashboard/src/pages/MinistryShell.tsx`
- Modify: `apps/dashboard/src/components/AppShell.tsx` (replace the `.content` outlet behavior so the inner sidebar renders inside the ministry route)
- Delete: `apps/dashboard/src/pages/Suites.tsx` (superseded)
- Test: `apps/dashboard/src/components/__tests__/MinistryShell.test.tsx` (new)

**Interfaces:**
- Consumes: `SUITE_META`, `suiteMeta` (Task 1); `useParams` from react-router-dom; `isFeatureOn`.
- Produces: `MinistryShell` default export (reads `:suiteId` param, renders per-ministry inner sidebar + nested `<Outlet/>`); localStorage key `picc.ministry.<suiteId>.collapsed` per-rail model.

- [ ] **Step 1: Add per-rail collapse state**

In `apps/dashboard/src/components/AppShell.tsx`, change `useSidebarState` (lines 75-95) to a two-rail model. Replace it with:

```ts
function useRailState(key: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === "1"
    } catch {
      return false
    }
  })
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(key, next ? "1" : "0")
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }
  return { collapsed, toggle }
}
```

- [ ] **Step 2: Write the failing MinistryShell test**

Create `apps/dashboard/src/components/__tests__/MinistryShell.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import MinistryShell from "@/pages/MinistryShell"
import { SUITE_META } from "@/lib/suites"

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: "t" }, loading: false }) }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/suites/:suiteId/*" element={<MinistryShell />} />
      </Routes>
    </MemoryRouter>
  )
}

describe("MinistryShell", () => {
  it("renders the trading ministry's inner sidebar", () => {
    renderAt("/suites/trading")
    expect(screen.getByText(SUITE_META.trading.label)).toBeTruthy()
    expect(screen.getByText("Dashboard")).toBeTruthy() // inner nav
    expect(screen.getByText("Simulator")).toBeTruthy() // per-ministry simulator entry
  })

  it("renders the earnings ministry's label", () => {
    renderAt("/suites/earnings")
    expect(screen.getByText(SUITE_META.earnings.label)).toBeTruthy()
  })

  it("renders root /suites redirect target", () => {
    renderAt("/suites/trading")
    expect(screen.getByText("Trading")).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/MinistryShell.test.tsx`
Expected: FAIL — `src/pages/MinistryShell.tsx` does not exist.

- [ ] **Step 4: Implement MinistryShell**

Create `apps/dashboard/src/pages/MinistryShell.tsx`:

```tsx
import { NavLink, Outlet, useParams } from "react-router-dom"
import { SUITE_META, suiteMeta } from "@/lib/suites"

const INNER_NAV: Record<string, { to: string; label: string }[]> = {
  trading: [
    { to: "dashboard", label: "Dashboard" },
    { to: "markets", label: "Markets" },
    { to: "paper", label: "Paper" },
    { to: "autopilot", label: "Autopilot" },
    { to: "command-centre", label: "Command Centre" },
    { to: "simulator", label: "Simulator" },
    { to: "settings", label: "Settings" }
  ],
  earnings: [
    { to: "dashboard", label: "Dashboard" },
    { to: "simulator", label: "Simulator" },
    { to: "settings", label: "Settings" }
  ],
  intelligence: [
    { to: "dashboard", label: "Dashboard" },
    { to: "governor", label: "Governor" },
    { to: "guidance", label: "Guidance" },
    { to: "settings", label: "Settings" }
  ]
}

export default function MinistryShell() {
  const { suiteId } = useParams<{ suiteId: string }>()
  const meta = suiteMeta(suiteId)
  if (!meta) return <p className="muted">Unknown ministry.</p>

  const entries = INNER_NAV[suiteId!] ?? []

  return (
    <div className="ministry-shell">
      <aside className="ministry-sidebar">
        <div className="ministry-brand">
          <span style={{ fontSize: 22 }}>{meta.icon}</span>
          <div>
            <strong>{meta.label}</strong>
            <span className="muted small">{meta.status === "production" ? "production" : "under development"}</span>
          </div>
        </div>
        <nav className="nav">
          {entries.map((e) => (
            <NavLink
              key={e.to}
              to={e.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              <span className="nav-label">{e.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="ministry-content">
        <Outlet />
      </div>
    </div>
  )
}
```

> **Pseudo-full-takeover wiring is done in AppShell (Task 3, Step 6).** The shell above only renders the inner sidebar + nested outlet; the outer-rail collapse on route change is handled in AppShell.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/MinistryShell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire pseudo-full-takeover in AppShell**

In `apps/dashboard/src/components/AppShell.tsx`, add a `useEffect` keyed on the location pathname: when the pathname starts with `/suites/`, collapse the outer rail (set its rail state to collapsed) and ensure the ministry shell's inner rail is expanded; when the user manually toggles the outer rail inside a suite, collapse the inner rail. Implement a small `useMinistryTakeover(collapsed, toggleInner)` effect:

```tsx
import { useLocation } from "react-router-dom"

const OUTER_RAIL_KEY = "picc.rail.outer"
const INNER_RAIL_KEY = "picc.rail.inner"
```

Replace the single `useSidebarState()` in `AppShell` with two rails:

```tsx
const outer = useRailState(OUTER_RAIL_KEY)
const inner = useRailState(INNER_RAIL_KEY)
```

Then, after the existing `useExternalLinkRouter()` call, add:

```tsx
const location = useLocation()
const inMinistry = location.pathname.startsWith("/suites/")
useEffect(() => {
  if (inMinistry) {
    // entering a suite: collapse outer, expand inner
    if (!outer.collapsed) outer.toggle()
    if (inner.collapsed) inner.toggle()
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [inMinistry])
```

And render the shell body with per-rail classes:

```tsx
<div className={outer.collapsed ? "shell collapsed" : "shell"}>
  <TopBar collapsed={outer.collapsed} onToggleSidebar={() => {
    outer.toggle()
    // RULING 2026-09-08 (was `!outer.collapsed`): `outer.collapsed` reads the PRE-toggle
    // value (React batches setState), so `!outer.collapsed` collapses inner when the user
    // COLLAPSES outer — inverted. The correct manual expand-collapses-inner branch is
    // `outer.collapsed` (pre-toggle true => about to expand). See ledger ruling.
    if (inMinistry && outer.collapsed) inner.toggle() // manual expand collapses inner
  }} onOpenPalette={() => setPaletteOpen(true)} />
  ...
  <aside className="sidebar">{/* ... existing outer nav ... */}</aside>
  <main className="content"><Outlet /></main>
```

- [x] **Step 7: Remove the old Suites page** — SUPERSEDED by option-A ruling (2026-09-08): `Suites.tsx` is NOT deleted, NOT moved. It hosts the working Trading UI (MarketsSuite + CommandCentrePanel gallery + deep-link behavior) and remains the ministry **index landing** under the MinistryShell Outlet (`<Route index element={<Suites />} />`). Original text: "Delete `apps/dashboard/src/pages/Suites.tsx`. Remove any `import { Suites } from "@/pages/Suites"` — do NOT follow.

- [ ] **Step 8: Add minimal style classes**

In `apps/dashboard/src/index.css`, append (co-located near the sidebar styles):

```css
.ministry-shell { display: flex; height: 100%; }
.ministry-sidebar { width: 220px; border-right: 1px solid #333; padding: 12px; flex-shrink: 0; overflow-y: auto; }
.ministry-brand { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.ministry-content { flex: 1; min-width: 0; padding: 16px; overflow-y: auto; }
```

- [ ] **Step 9: Typecheck + run the ministry + nav tests + commit**

Run: `npx tsc -b --noEmit` (expect 0)
Run: `npx vitest run src/components/__tests__/MinistryShell.test.tsx src/components/__tests__/AppShell.nav.test.tsx` (expect all pass)

```bash
git add apps/dashboard/src/pages/MinistryShell.tsx apps/dashboard/src/components/AppShell.tsx apps/dashboard/src/index.css
# NOTE (option-A ruling): do NOT `git rm apps/dashboard/src/pages/Suites.tsx` — it is kept as ministry landing.
git commit -m "feat(ministries): ministry shell with inner sidebar + pseudo-full-takeover"
```

---

### Task 4: Per-ministry settings partition (incl. autopilot/copilot flip-switch)

**Files:**
- Create: `apps/dashboard/src/lib/ministrySettings.ts`
- Modify: `apps/dashboard/src/pages/Settings.tsx` (keep PICC-scoped; add a clear note + link, not ministry config)
- Test: `apps/dashboard/src/lib/__tests__/ministrySettings.test.ts`

**Interfaces:**
- Consumes: `SuiteId` (Task 1).
- Produces: `export type AutopilotMode = "auto" | "copilot"`; `export interface MinistrySettings { mode: AutopilotMode; confidenceThreshold: number }`; `getMinistrySettings(id: SuiteId): MinistrySettings`; `saveMinistrySettings(id: SuiteId, patch: Partial<MinistrySettings>): MinistrySettings`; storage key `picc.ministry.<id>.settings`.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/__tests__/ministrySettings.test.ts` (note: must start with the repo-native `// @vitest-environment jsdom` docblock — localStorage is unavailable under vitest's default node environment; same pattern as `income.test.ts`):

```ts
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest"
import { getMinistrySettings, saveMinistrySettings, type AutopilotMode } from "@/lib/ministrySettings"

describe("ministry settings", () => {
  beforeEach(() => localStorage.clear())

  const defaults = { mode: "auto" as AutopilotMode, confidenceThreshold: 0.6 }

  it("returns defaults for a fresh ministry", () => {
    expect(getMinistrySettings("trading")).toEqual(defaults)
  })

  it("persists a mode flip to copilot", () => {
    saveMinistrySettings("trading", { mode: "copilot" })
    expect(getMinistrySettings("trading").mode).toBe("copilot")
  })

  it("clamps confidenceThreshold to [0,1]", () => {
    saveMinistrySettings("earnings", { confidenceThreshold: 1.5 })
    expect(getMinistrySettings("earnings").confidenceThreshold).toBe(1)
    saveMinistrySettings("earnings", { confidenceThreshold: -3 })
    expect(getMinistrySettings("earnings").confidenceThreshold).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/ministrySettings.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ministrySettings.ts`**

Create `apps/dashboard/src/lib/ministrySettings.ts`:

```ts
import type { SuiteId } from "@/lib/suites"

export type AutopilotMode = "auto" | "copilot"

export interface MinistrySettings {
  mode: AutopilotMode
  confidenceThreshold: number
}

const DEFAULTS: MinistrySettings = { mode: "auto", confidenceThreshold: 0.6 }

const key = (id: SuiteId) => `picc.ministry.${id}.settings`

export function getMinistrySettings(id: SuiteId): MinistrySettings {
  try {
    const raw = localStorage.getItem(key(id))
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<MinistrySettings>
    return {
      mode: parsed.mode === "copilot" ? "copilot" : "auto",
      confidenceThreshold: clamp(parsed.confidenceThreshold ?? DEFAULTS.confidenceThreshold)
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveMinistrySettings(id: SuiteId, patch: Partial<MinistrySettings>): MinistrySettings {
  const next = { ...getMinistrySettings(id), ...patch }
  next.confidenceThreshold = clamp(next.confidenceThreshold)
  try {
    localStorage.setItem(key(id), JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
  return next
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return DEFAULTS.confidenceThreshold
  return Math.min(1, Math.max(0, n))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/ministrySettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep PICC Settings PICC-scoped**

Add a `muted` note card at the top of `apps/dashboard/src/pages/Settings.tsx` (inside the `.page` div, after the `<h1>`) that links to per-ministry settings:

```tsx
<div className="card" style={{ marginTop: 8 }}>
  <p className="muted" style={{ margin: 0 }}>
    These are <strong>PICC-wide</strong> settings. Per-ministry settings (site catalogs, the
    autopilot/copilot flip-switch, confidence threshold) live inside each ministry at
    <code> /suites/&lt;ministry&gt;/settings</code>.
  </p>
</div>
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b --noEmit` (expect 0)

```bash
git add apps/dashboard/src/lib/ministrySettings.ts apps/dashboard/src/lib/__tests__/ministrySettings.test.ts apps/dashboard/src/pages/Settings.tsx
git commit -m "feat(ministries): per-ministry settings incl autopilot/copilot flip-switch"
```

---

### Task 5: Cumulative / executive dashboard math (server-side)

**Files:**
- Create: `apps/dashboard/server/services/ministryAggregate.mjs`
- Create: `apps/dashboard/server/__tests__/ministryAggregate.test.mjs`
- Test: `apps/dashboard/server/__tests__/ministryAggregate.test.mjs` (vitest)

**Interfaces:**
- Consumes: nothing new (pure function over per-ministry inputs).
- Produces: `export function aggregateMinistries(ministries: Array<{ id: string; totals: Array<{ amount: number; currency: string }> }>): { perMinistry: Record<string, number>; grandTotal: number; currency: string | null }` — sums totals per ministry id; `grandTotal` sums across; `currency` is the single currency if all present inputs agree, else `null` (honest: mixed/empty currency → `null`, never a fabricated 0).

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/server/__tests__/ministryAggregate.test.mjs`:

```js
import { describe, expect, it } from "vitest"
import { aggregateMinistries } from "../services/ministryAggregate.mjs"

describe("aggregateMinistries", () => {
  it("sums per-ministry and grand totals with a single currency", () => {
    const r = aggregateMinistries([
      { id: "trading", totals: [{ amount: 120, currency: "USD" }] },
      { id: "earnings", totals: [{ amount: 30, currency: "USD" }, { amount: 10, currency: "USD" }] }
    ])
    expect(r.perMinistry).toEqual({ trading: 120, earnings: 40 })
    expect(r.grandTotal).toBe(160)
    expect(r.currency).toBe("USD")
  })

  it("returns null currency (honest) on mixed or empty currencies", () => {
    const mixed = aggregateMinistries([
      { id: "trading", totals: [{ amount: 1, currency: "USD" }] },
      { id: "earnings", totals: [{ amount: 1, currency: "EUR" }] }
    ])
    expect(mixed.currency).toBeNull()

    const empty = aggregateMinistries([{ id: "trading", totals: [] }])
    expect(empty.grandTotal).toBe(0)
    expect(empty.currency).toBeNull()
  })

  it("omits ministries with no totals from perMinistry but keeps them absent (no fabricated 0 entries)", () => {
    const r = aggregateMinistries([
      { id: "trading", totals: [{ amount: 5, currency: "USD" }] },
      { id: "earnings", totals: [] }
    ])
    expect(r.perMinistry["earnings"]).toBeUndefined()
    expect(r.grandTotal).toBe(5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/__tests__/ministryAggregate.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ministryAggregate.mjs`**

Create `apps/dashboard/server/services/ministryAggregate.mjs`:

```js
/**
 * Aggregate per-ministry income/pnl into a cumulative view.
 * Honesty contract: a ministry with no totals contributes no entry (not a
 * fabricated 0). Mixed or empty currencies -> currency null (never a wrong 0).
 */
export function aggregateMinistries(ministries) {
  const perMinistry = {}
  let grandTotal = 0
  const currencies = new Set()
  for (const m of ministries) {
    let sum = 0
    for (const t of m.totals ?? []) {
      sum += t.amount
      currencies.add(t.currency)
    }
    if (m.totals && m.totals.length > 0) {
      perMinistry[m.id] = sum
      grandTotal += sum
    }
  }
  const currency = currencies.size === 1 ? [...currencies][0] : null
  return { perMinistry, grandTotal, currency }
}
```

> Note: ecosystem module type — check whether `server/services` files use ESM (`import`/`export`) before choosing `.mjs`. If the server package.json has `"type": "module"`, the file may be `.js`; align with the sibling `commandCentre` services (`server/services/commandCentre/*.mjs` referenced in the spec). If those are `.mjs`, keep `.mjs`; otherwise rename accordingly and adjust the test import.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/__tests__/ministryAggregate.test.mjs`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit` (expect 0; server files may not be in the tsc project — if not, rely on the vitest pass which already type-exercises the module via tests)

```bash
git add apps/dashboard/server/services/ministryAggregate.mjs apps/dashboard/server/__tests__/ministryAggregate.test.mjs
git commit -m "feat(ministries): server-side cumulative ministry aggregation"
```

---

### Task 6: Command palette — whole-app search, remove dead pages

**Files:**
- Modify: `apps/dashboard/src/components/CommandPalette.tsx`
- Test: `apps/dashboard/src/components/__tests__/CommandPalette.test.tsx` (new)

**Interfaces:**
- Consumes: `SUITE_META` (Task 1).
- Produces: `NAV_PAGES` with entries: `/` (Command Center), `/opportunities`, `/suites/trading`, `/suites/earnings`, `/suites/intelligence`, `/settings`, `/profile`. Removed: `/simulator`, `/agents`, `/income`. Comments/keywords updated to reflect whole-app search.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/__tests__/CommandPalette.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { CommandPalette } from "@/components/CommandPalette"
import { openBrowser, closeBrowser } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  openBrowser: vi.fn().mockResolvedValue({}),
  closeBrowser: vi.fn().mockResolvedValue({}),
  CATALOG: undefined
}))
vi.mock("@/lib/streamCatalog", () => ({ CATALOG: [] }))

describe("CommandPalette pages", () => {
  it("searches a ministry page across the whole app", () => {
    render(
      <MemoryRouter>
        <CommandPalette open onClose={() => {}} />
      </MemoryRouter>
    )
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "earnings" } })
    expect(screen.getByText("Earnings")).toBeTruthy()
  })

  it("does not expose removed pages", () => {
    render(
      <MemoryRouter>
        <CommandPalette open onClose={() => {}} />
      </MemoryRouter>
    )
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "simulator" } })
    expect(screen.queryByText(/Simulator/i)).toBeNull()
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "agents" } })
    expect(screen.queryByText(/Agents/i)).toBeNull()
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "income" } })
    expect(screen.queryByText(/Income/i)).toBeNull()
  })
})
```

> The palette filters `items` to the top visible slice; searching a removed page should yield no matching row. If the `Income apps` group (from `CATALOG`) interferes, the mock `CATALOG: []` neutralizes it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/CommandPalette.test.tsx`
Expected: FAIL — `NAV_PAGES` still has `simulator/agents/income`, and "Earnings" isn't a page entry.

- [ ] **Step 3: Update `NAV_PAGES`**

Replace `NAV_PAGES` (lines 18-27) in `apps/dashboard/src/components/CommandPalette.tsx`:

```ts
const NAV_PAGES: { path: string; label: string; icon: string; feature?: FeatureKey; keywords?: string }[] = [
  { path: "/", label: "Command Center", icon: "▦", keywords: "dashboard home overview" },
  { path: "/opportunities", label: "Opportunities", icon: "🧭", feature: "opportunities", keywords: "research bounties workflows" },
  { path: "/suites/trading", label: "Trading", icon: "📈", feature: "trading", keywords: "markets prediction paper ledger autopilot command centre signals watchlist" },
  { path: "/suites/earnings", label: "Earnings", icon: "💰", feature: "earnings", keywords: "cashback micro-task ux referral affiliate royalty yield income" },
  { path: "/suites/intelligence", label: "Intelligence for PICC", icon: "🧭", feature: "intelligence", keywords: "governor prime-minister zero-to-one profitability decision support" },
  { path: "/settings", label: "Settings", icon: "⚙️", keywords: "features toggles keys" },
  { path: "/profile", label: "Profile", icon: "👤", keywords: "account user" }
]
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/CommandPalette.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit` (expect 0)

```bash
git add apps/dashboard/src/components/CommandPalette.tsx apps/dashboard/src/components/__tests__/CommandPalette.test.tsx
git commit -m "feat(ministries): whole-app command palette search, drop removed pages"
```

---

### Task 7: Extension generalization (per-ministry catalogs)

**Files:**
- Modify: `apps/dashboard/extensions/picc-overlay/manifest.json` (if present)
- Modify: `apps/dashboard/extensions/picc-overlay/content.js` (if present)
- Modify: `apps/dashboard/extensions/picc-overlay/background.js` (if present)
- Check: `apps/dashboard/extensions/picc-overlay/` directory layout (globbing first)
- Test: `node --check` on each touched JS file (browser-only code — no vitest; per repo convention)

**Interfaces:**
- Consumes: existing overlay `chrome.storage` keys.
- Produces: a per-ministry catalog object `MINISTRY_CATALOGS` mapping suite id → list of sites/controls; site config moved to the ministry namespace so configured sites are managed in per-ministry settings (Task 4) rather than a hardcoded trading set.

- [ ] **Step 1: Inspect the overlay**

Run (bash):
```
Get-ChildItem -Recurse apps/dashboard/extensions/picc-overlay | Select-Object FullName
```
Read `manifest.json`, `content.js`, `background.js` to find every hardcoded trading/site reference before changing anything.

- [ ] **Step 2: Write a `node --check` guard BEFORE editing**

The repo's browser-only verification is `node --check` (no vitest for content scripts). Confirm each file currently parses:

Run: `node --check apps/dashboard/extensions/picc-overlay/content.js` (and same for `background.js`)
Expected: exit 0 (baseline).

- [ ] **Step 3: Introduce `MINISTRY_CATALOGS`**

In `background.js` (or the appropriate shared module), add a per-ministry catalog map. Exact shape depends on the observed `chrome.storage` keys from Step 1 (this is an UNVERIFIED read — verify before writing). Example:

```js
const MINISTRY_CATALOGS = {
  trading: { /* existing trading sites/controls */ },
  earnings: { /* earnings-site controls, empty/under-development */ },
  intelligence: { /* governor read-only surfaces */ }
}
```

Key the storage so the configured set is namespaced per ministry (`chrome.storage.local.set({ ["picc.ministry." + suiteId + ".sites"]: ... })`) so Task 4's per-ministry settings own it.

- [ ] **Step 4: Replace hardcoded trading-only behavior**

Replace any hardcoded trading site list in `content.js`/`background.js` with lookups into `MINISTRY_CATALOGS` by the active ministry. A ministry without a catalog (or with an empty one) must report honestly (no fabricated controls). Keep the existing `automation`/`autopilot` semantic distinction intact (do not rename or weaken it).

- [ ] **Step 5: Verify**

Run: `node --check apps/dashboard/extensions/picc-overlay/content.js` and `node --check apps/dashboard/extensions/picc-overlay/background.js`
Expected: exit 0 on both. Grep the extension for `MINISTRY_CATALOGS` to confirm wiring.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/extensions/picc-overlay
git commit -m "feat(ministries): generalize overlay extension to per-ministry catalogs"
```

---

## Self-Review (run after writing, before handoff)

**Spec coverage:**
- REQ-1 (3 ministries) → Task 1
- REQ-2 (per-ministry workspace: dashboard/src/inner sidebar/simulator/settings) → Tasks 1, 3, 4
- REQ-3 (Intelligence master suite) → Tasks 1, 3 (Intelligence inner nav has Governor/Guidance)
- REQ-4 (governance, governor suggests) → Task 3 (Governor surface) + spec only (P2 Task 8)
- REQ-5 (per-suite autopilot/copilot flip-switch) → Task 4
- REQ-6 (confidence-gated) → Task 4 (field) + P2 Task 8 (computation)
- REQ-7 (zero-to-one, no wizard) → Task 3 (Intelligence Guidance) + spec
- REQ-8 (cumulative dashboard) → Task 5 (server aggregate)
- REQ-9 (page consolidation) → Tasks 2, 3, 6
- REQ-10 (sidebar IA) → Task 2
- REQ-11 (two-level nesting + pseudo-takeover) → Tasks 2, 3
- REQ-12 (whole-app search) → Task 6
- REQ-13 (localized/de-localized agents) → spec + P2 Task 9 (not in P1 tasks)
- REQ-14 (extension generalization) → Task 7
- REQ-15 (folding) → Task 1 (suites.ts rewrite)
- REQ-16 (go-live gate, no real-money) → Global Constraints; not a build task

**Placeholder scan:** Every task has real file paths, real code, real test code, real commit commands. The only intentional verification-gate text is Task 7 Step 3's "UNVERIFIED read — verify before writing" (the extension internals were not read this session) and Task 3 Step 6's wiring comment. These are honest gates, not placeholders.

**Type consistency:**
- `SuiteId` / `SuiteStatus` / `SuiteMeta.status` defined in Task 1, used in Tasks 1, 3, 4, 6. ✓
- `FeatureKey` extended in Task 2, used in AppShell NAV (Task 2) and CommandPalette (Task 6). ✓
- `MinistrySettings` / `AutopilotMode` / `getMinistrySettings` / `saveMinistrySettings` defined in Task 4 only. ✓
- `aggregateMinistries` defined/used in Task 5 only. ✓
- Ministry routes `/suites/{trading,earnings,intelligence}/...` consistent across Tasks 2, 3, 6. ✓

**Known cross-task dependency to flag for executors:** Task 3's inner-nav route targets (`dashboard`, `markets`, etc.) are declared but the sub-route components under `/suites/:suiteId/*` are NOT built in P1 (they fall out of the empty `Outlet`). This is intentional — P1 establishes the shell + IA; the ministry dashboards/simulators are downstream work. The `MinistryShell` renders the inner sidebar + outlet even when sub-routes are empty.

---

## Handoff choice

Plan complete and saved to `docs/superpowers/plans/2026-09-08-picc-ministry-ia-rebuild.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
