# Graduation Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-strategy-tag paper→testnet→mainnet readiness readout with symmetric promotion/demotion gates, advisory only.

**Architecture:** New `server/services/graduation/` boundary (window collector, recency weighting, gates engine) consumed by one additive route and a paper-room table; consumes backtest outputs, paper closes, and live fills read-only.

**Tech Stack:** Node 22 ESM (`server/services/*.mjs`), Vitest 5.0.3, React 19 + TS, existing technicalBacktest/hyperopt/prediction outputs, paper closes, cost-drag overlay shapes.

**Spec:** `docs/superpowers/specs/2026-10-08-graduation-analytics-design.md` — the plan
argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- Advisory only: output is a readout object, never a permit mutation; stages are labels; testnet/mainnet legs ABSENT with reasons while creds/ceremony missing.
- No 12 qualifying windows → no promotion verdict (below-floor state shown); thin-evidence strategies never extrapolated.
- Additive-only API changes (ADR-0005): one new route `GET /api/graduation/overview`; existing payload bytes never change.
- Hermetic tests: fixture windows/closes/fills, dynamic imports, `vi.resetModules()`; stateless evaluation (no new store; only `PICC_GRADUATION_HALFLIFE_DAYS` override env, no registration needed for a scalar); every new hand-rolled test file added to the guard inventory.
- Boot invariants untouched; no second ceremony route; TDD with watched RED/GREEN; one commit per task (`feat(graduation): ...` / `fix(graduation): ...`).
- Probe scripts in `apps/dashboard/testSupport/*.tmp.mjs`, deleted after use; never print `.env` values or keys.

---

### Task 1: Window collector (backtest + paper + live → normalized stats)

**Files:**
- Create: `apps/dashboard/server/services/graduation/windows.mjs`
- Test: `apps/dashboard/server/__tests__/graduationWindows.test.mjs`

**Interfaces:**
- Consumes: backtest embargoed residuals (technicalBacktest/hyperopt/prediction output shapes — read them first, adapt read-only), paper closes (paper service functions, never the route; read-only proof required as in costs paperOverlay), live fills (injected array param, default [] — ephemeral-source precedent).
- Produces:
  - `collectWindows({ backtests, paperCloses, liveFills })` → `[{ source: "backtest"|"paper"|"live", strategyTag, windowStart, windowEnd, returnPct, sharpe, maxDd, costDragUsd|null, provenance }]` — insufficient-data windows absent with reason (never zero-filled); costDragUsd from the W3-02 overlay shapes where available, else null with reason.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { collectWindows } from "../services/graduation/windows.mjs"

describe("collectWindows", () => {
  it("normalizes paper closes into window stats with provenance", () => {
    const out = collectWindows({
      backtests: [], paperCloses: [{ strategyTag: "breakout", pnlPct: 2.5, entryTime: "2026-09-01T00:00:00Z", exitTime: "2026-09-02T00:00:00Z" }], liveFills: [],
    })
    const w = out.find((x) => x.source === "paper")
    expect(w.strategyTag).toBe("breakout")
    expect(w.provenance).toBe("paper")
    expect(typeof w.returnPct).toBe("number")
  })

  it("insufficient data yields absence, not zeros", () => {
    const out = collectWindows({ backtests: [], paperCloses: [], liveFills: [] })
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/graduationWindows.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … windows.mjs"

- [ ] **Step 3: Write minimal implementation**

Pure normalizer exactly per the interface. Read-only consumers only.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/graduation/windows.mjs apps/dashboard/server/__tests__/graduationWindows.test.mjs
git commit -m "feat(graduation): window collector with provenance"
```

### Task 2: Recency weighting (30d half-life, overridable)

**Files:**
- Create: `apps/dashboard/server/services/graduation/weighting.mjs`
- Test: `apps/dashboard/server/__tests__/graduationWeighting.test.mjs`

**Interfaces:**
- Consumes: window arrays (Task 1 shapes).
- Produces:
  - `HALFLIFE_DAYS_DEFAULT = 30`; `decayWeight(windowEnd, { halfLifeDays, now } = {})` → weight in (0,1], half-life read from `PICC_GRADUATION_HALFLIFE_DAYS` when present (invalid → default with no throw).
  - `weightedMetric(windows, pick)` → `{ value, totalWeight, windowCount }` (null value + reason when totalWeight is 0, never 0).

- [ ] **Step 1: Write the failing test**

Half-life math exact (weight halves at 30d/60d); invalid env falls back to default; empty input → null + reason.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/graduationWeighting.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … weighting.mjs"

- [ ] **Step 3: Write minimal implementation**

Pure functions exactly per the interface.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/graduation/weighting.mjs apps/dashboard/server/__tests__/graduationWeighting.test.mjs
git commit -m "feat(graduation): recency-decay weighting"
```

### Task 3: Gates engine (12/6/70% hysteresis, advisory output)

**Files:**
- Create: `apps/dashboard/server/services/graduation/gates.mjs`
- Test: `apps/dashboard/server/__tests__/graduationGates.test.mjs`

**Interfaces:**
- Consumes: weighted per-strategy windows (Tasks 1–2), constitution floors (12 embargoed windows; EV gates; calibration tolerance — import the real constants/predicates, do not duplicate numbers), cost-drag-adjusted returns.
- Produces:
  - `PROMOTE_WINDOWS = 12`, `DEMOTE_WINDOWS = 6`, `DEMOTE_FRACTION = 0.7` (named constants).
  - `evaluateStrategy({ tag, windows })` → `{ tag, stage: "paper"|"testnet"|"mainnet", promoted, demoted, warnings[], reasons[], windowsUsed }` — promote on 12 consecutive windows above bar; demote on 6 below 70% of bar; below-floor (fewer than 12 qualifying windows ever) → no verdict, `below-floor` reason; testnet/mainnet stages read ABSENT with `testnet-credentials-unset` / `mainnet-ceremony-required` reasons while unmet; output contains NO permit/unlock/mutation fields (test asserts their absence).

- [ ] **Step 1: Write the failing test**

Promotion after 12 above-bar; demotion after 6 below 70%; below-floor with 11 windows → no verdict; output has no permit/unlock keys (assert `!(\"permit\" in out)`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/graduationGates.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … gates.mjs"

- [ ] **Step 3: Write minimal implementation**

Exactly per the interface. Import constitution floors (single source of truth).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/graduation/gates.mjs apps/dashboard/server/__tests__/graduationGates.test.mjs
git commit -m "feat(graduation): hysteresis gates, advisory output"
```

### Task 4: Route + paper-room table

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (ONE additive branch, dynamic `await import()` — no new static imports, 72-guard intact), paper room component (graduation table: stage, gate stats, demotion warnings, ABSENT legs)
- Create: `apps/dashboard/server/__tests__/graduationApi.test.mjs` + room table test beside the paper room tests
- Test: fresh handlers import + DATA_DIR redirects; unauth refused; overview shape (per-tag stage/stats/warnings); requireAuth first; no ceremony interference

**Interfaces:**
- Consumes: Tasks 1–3 exact exports.
- Produces:
  - `GET /api/graduation/overview` → `{ strategies: [{ tag, stage, stats, warnings, reasons }], incomplete }`
  - Paper-room table section (ships in the paper room component; nav follows existing room wiring, no new room keys).

- [ ] **Step 1: Write the failing test**

API suite: route missing → 404 (then shape assertions after implementation); component test: stage badges, demotion warnings, ABSENT legs render (not zeros).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/graduationApi.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL (404 or no `strategies`)

- [ ] **Step 3: Write minimal implementation**

Route branch + table section. No bootSequence reorder; no ceremony route.

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npx vitest run server/__tests__/graduationApi.test.mjs` then `npm run typecheck` (repo root)
Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add <route, room section, tests>
git commit -m "feat(graduation): overview route and paper-room table"
```
