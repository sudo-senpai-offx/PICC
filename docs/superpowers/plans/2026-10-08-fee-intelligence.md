# Fee Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the realized-cost scorecard per venue/route with measured|modeled provenance on every number.

**Architecture:** New `server/services/costs/` boundary (store, measured recorder, modeled leg, attempt counter, aggregator) plus a paper cost-drag overlay computed beside the untouched paper ledger, served by one additive route with a wealth-section UI.

**Tech Stack:** Node 22 ESM (`server/services/*.mjs`), Vitest 5.0.3, React 19 + TS, existing `costAdjustedEv` (constitution.mjs), wealth `fx.mjs`, livePositionManager funding shapes.

**Spec:** `docs/superpowers/specs/2026-10-08-fee-intelligence-design.md` — the plan
argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- Provenance on every number (measured | modeled | modeled-with-calibrated-inputs); absent data → absent rows/reasons, never zeros.
- Own-account fills only (no discovery, no other-participant data); funding unobserved-portion never adjusted.
- Paper ledger byte-identical behavior (overlay computes beside it, never inside).
- Additive-only API changes (ADR-0005): one new route `GET /api/costs/overview`; existing payload bytes never change.
- Hermetic tests: dynamic imports + `PICC_COSTS_DATA_DIR` redirect + `vi.resetModules()`; register the new var in `testSupport/storeIsolation.mjs` + runbook inventory; every new hand-rolled test file added to the guard inventory.
- Boot invariants untouched; no second ceremony route; TDD with watched RED/GREEN; one commit per task (`feat(costs): ...` / `fix(costs): ...`).
- Probe scripts in `apps/dashboard/testSupport/*.tmp.mjs`, deleted after use; never print `.env` values or keys.

---

### Task 1: Costs store (per-fill records + daily rollups)

**Files:**
- Create: `apps/dashboard/server/services/costs/store.mjs`
- Test: `apps/dashboard/server/__tests__/costsStore.test.mjs`
- Modify: `apps/dashboard/testSupport/storeIsolation.mjs` (append `PICC_COSTS_DATA_DIR`, never reorder), `docs/runbooks/PICC_OPERABILITY_RUNBOOK.md` (§4.3 row + counts, T8 accounting protocol)

**Interfaces:**
- Consumes: `PICC_COSTS_DATA_DIR` env (default `join(__dirname, "..", "..", "data")`), files `costs.json` (`{ fills: [], rollups: [] }`, best-effort persist mirroring tradeJournal pattern).
- Produces:
  - `recordFillCost({ venue, route, kind, amountUsd, ccy, fxSource, fxAt, provenance, observedAt })` → `{ ok, record }` / `{ ok:false, reason }` (amount finite required; provenance enum measured|modeled|modeled-with-calibrated-inputs enforced)
  - `listFillCosts({ venue, since, limit = 500 } = {})` newest-first
  - `rollupDay({ date, venue, totals })` → date-keyed idempotent rollup (`tzDate` via `PICC_SNAPSHOT_TZ`, default `Asia/Singapore`, same helper shape as wealth snapshots)
  - `listRollups({ venue, limit = 730 } = {})`
  - Prune policy in code: fills older than 90 days dropped on write; rollups older than 2 years dropped on write (deliberate retention, corpus precedent)
  - `_resetCostsForTest()`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/server/__tests__/costsStore.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("costs store", () => {
  let dir, mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-costs-"))
    process.env.PICC_COSTS_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/costs/store.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_COSTS_DATA_DIR
    mod._resetCostsForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("rejects non-finite amounts with a named reason", () => {
    const r = mod.recordFillCost({ venue: "paper", route: "close", kind: "fee", amountUsd: NaN, ccy: "USD", provenance: "modeled" })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("rollups are date-keyed idempotent", () => {
    mod.rollupDay({ date: "2026-10-08T00:00:00+08:00", venue: "paper", totals: { fee: 1 } })
    mod.rollupDay({ date: "2026-10-08T12:00:00+08:00", venue: "paper", totals: { fee: 2 } })
    expect(mod.listRollups({ venue: "paper" }).filter((r) => r.tzDate === "2026-10-08").length).toBe(1)
  })

  it("prunes fills older than 90 days on write", () => {
    mod.recordFillCost({ venue: "paper", route: "close", kind: "fee", amountUsd: 0.01, ccy: "USD", provenance: "modeled", observedAt: new Date(Date.now() - 100 * 864e5).toISOString() })
    mod.recordFillCost({ venue: "paper", route: "close", kind: "fee", amountUsd: 0.01, ccy: "USD", provenance: "modeled" })
    expect(mod.listFillCosts({}).every((f) => Date.now() - Date.parse(f.observedAt) < 90 * 864e5)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/costsStore.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … store.mjs"

- [ ] **Step 3: Write minimal implementation**

Module store + best-effort JSON persist + prune-on-write exactly per the interface. Provenance enum enforced (unknown → `{ok:false, reason}`).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/costs/store.mjs apps/dashboard/server/__tests__/costsStore.test.mjs apps/dashboard/testSupport/storeIsolation.mjs docs/runbooks/PICC_OPERABILITY_RUNBOOK.md
git commit -m "feat(costs): store with per-fill records and daily rollups"
```

### Task 2: Measured recorder (fills, funding, record-time USD)

**Files:**
- Create: `apps/dashboard/server/services/costs/measured.mjs`
- Test: `apps/dashboard/server/__tests__/costsMeasured.test.mjs`

**Interfaces:**
- Consumes: fill objects `{ venue, price, amount, fee: { cost, currency } | null, fundingAccrual?, observedAt }`, wealth `fx.mjs` `convertToUsd` (import dynamically to avoid a static edge — or inject; inject in tests, dynamic import in production passthrough).
- Produces:
  - `measureFillCost(fill, fx)` → array of cost records shaped for Task 1 `recordFillCost` with `provenance: "measured"`: explicit fee converted record-time USD (fxSource+fxAt stamped); funding leg reusing livePositionManager observed/unobserved-portion shapes — `unobserved-portion` yields NO funding record (never adjusted), with the reason carried on the fill result, not fabricated.
  - `measureFillCosts(fills, fx)` → batch mapper (pure; skipped fills reported with reasons, never zeros).

- [ ] **Step 1: Write the failing test**

Fixtures: ccxt-style fill with `{ cost: 0.01, currency: "USDT" }` + fx double (USDT parity) → one measured record amountUsd 0.01; fill with null fee → skipped with reason; funding observed → funding record; funding unobserved-portion → no record + reason.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/costsMeasured.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … measured.mjs"

- [ ] **Step 3: Write minimal implementation**

Pure mappers exactly per the interface. No network, no store writes (Task 5's job persists).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/costs/measured.mjs apps/dashboard/server/__tests__/costsMeasured.test.mjs
git commit -m "feat(costs): measured fill recorder with funding honesty"
```

### Task 3: Modeled leg (costAdjustedEv wrapper + adaptive medians)

**Files:**
- Create: `apps/dashboard/server/services/costs/modeled.mjs`
- Test: `apps/dashboard/server/__tests__/costsModeled.test.mjs`

**Interfaces:**
- Consumes: `costAdjustedEv` from `constitution.mjs` (import it — read the signature at constitution.mjs:113-151 first; do not reimplement).
- Produces:
  - `modelFillCost({ venue, notionalUsd, spreadPips, slippagePips })` → cost records with `provenance: "modeled"` (spread + slippage legs; explicit about inputs used).
  - `calibratedInputs(venue, measuredFills)` → `{ spreadPips, slippagePips, provenance: "modeled-with-calibrated-inputs" }` — venue medians once ≥30 observed fills, else the 1.5/0 defaults (threshold as named constant `CALIBRATION_MIN_FILLS = 30`).
  - Never relabels calibrated as measured (test pins the label).

- [ ] **Step 1: Write the failing test**

Defaults produce modeled records; 30+ measured fills flip inputs to medians with calibrated label; 29 fills keep defaults; label `measured` never emitted (assert across outputs).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/costsModeled.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … modeled.mjs"

- [ ] **Step 3: Write minimal implementation**

Thin wrapper + median calibration exactly per the interface. Document the feedback loop in a header comment.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/costs/modeled.mjs apps/dashboard/server/__tests__/costsModeled.test.mjs
git commit -m "feat(costs): modeled leg with adaptive calibration"
```

### Task 4: Failed-attempt counter (seam instrumentation)

**Files:**
- Modify: `apps/dashboard/server/services/ccxtOrdering.mjs` (counter increments at existing refusals only), `apps/dashboard/server/services/venues/hyperliquidPerps.mjs` (submit-path refusals only)
- Create: `apps/dashboard/server/services/costs/attempts.mjs`
- Test: `apps/dashboard/server/__tests__/costsAttempts.test.mjs`

**Interfaces:**
- Consumes: nothing new (hooks into existing refusal returns).
- Produces:
  - `countAttempt({ venue, outcome: "refused"|"failed", reason })` → increments in-memory day-keyed counters (date key, same tz rule as rollups)
  - `attemptCounts({ date } = {})` → `{ venue: { refused, failed } }`
  - Seam edits: ONE added line per existing refusal return (counter call before return) in requireKeys/sandbox-unsupported/mode blocks + perps submit refusals; refusal messages, shapes, and gate logic byte-identical (prove with the existing suites green unmodified in intent).

- [ ] **Step 1: Write the failing test**

Refusal through the seam (mocked keys-absent) increments the day counter; gated happy paths (existing tests) unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/costsAttempts.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … attempts.mjs"

- [ ] **Step 3: Write minimal implementation**

Counter module + one-line hooks exactly per the interface. No gate changes.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2 + the ccxtOrdering + perps suites
Expected: PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/costs/attempts.mjs apps/dashboard/server/__tests__/costsAttempts.test.mjs apps/dashboard/server/services/ccxtOrdering.mjs apps/dashboard/server/services/venues/hyperliquidPerps.mjs
git commit -m "feat(costs): failed-attempt counter at seam refusals"
```

### Task 5: Aggregator (day + all-time, observed-only venues)

**Files:**
- Create: `apps/dashboard/server/services/costs/aggregate.mjs`
- Test: `apps/dashboard/server/__tests__/costsAggregate.test.mjs`

**Interfaces:**
- Consumes: Task 1 store readers, Task 4 counters.
- Produces:
  - `scorecard({ fills, rollups, attempts, window })` → `{ venues: [{ venue, day, allTime, provenance }], incomplete }` — venues appear ONLY with observed fills/costs (observed-only decision); near-empty windows read as absences with reasons; every number carries measured|modeled|calibrated provenance; attempt counts shown as waste lines, never merged into cost totals.

- [ ] **Step 1: Write the failing test**

Fixtures: venue with fills → full scorecard; venue without fills → absent from venues[] (not zero); empty input → null total + reason (wealth T5 precedent: no-convertible → null).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/costsAggregate.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … aggregate.mjs"

- [ ] **Step 3: Write minimal implementation**

Pure functions exactly per the interface.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/costs/aggregate.mjs apps/dashboard/server/__tests__/costsAggregate.test.mjs
git commit -m "feat(costs): day and all-time scorecard aggregator"
```

### Task 6: Paper cost-drag overlay (ledger untouched)

**Files:**
- Create: `apps/dashboard/server/services/costs/paperOverlay.mjs`
- Test: `apps/dashboard/server/__tests__/costsPaperOverlay.test.mjs`

**Interfaces:**
- Consumes: paper fills/closes (read-only via the paper service functions, never the route), Task 3 `modelFillCost`.
- Produces:
  - `overlayForCloses(closes)` → per-close modeled cost lines `[{ closeId, feeUsd, spreadUsd, slipUsd, provenance: "modeled" }]`
  - `dragAdjustedEquity(equityCurve, overlays)` → parallel series (same timestamps, equity minus cumulative modeled costs), labeled `drag-adjusted (modeled)`; original curve passed through untouched.
  - Proves ledger-untouched: test asserts paper store/analytics functions return identical results with and without overlay computation (no import-time or call-time mutation).

- [ ] **Step 1: Write the failing test**

Fixture closes → cost lines with modeled provenance; equity curve + overlays → parallel series math exact; paper analytics output deep-equal before/after overlay run.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/costsPaperOverlay.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … paperOverlay.mjs"

- [ ] **Step 3: Write minimal implementation**

Exactly per the interface. Read-only paper access (verify no close/mark calls in the read path — T9 wealth precedent).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2 + paper suites
Expected: PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/costs/paperOverlay.mjs apps/dashboard/server/__tests__/costsPaperOverlay.test.mjs
git commit -m "feat(costs): paper cost-drag overlay beside the ledger"
```

### Task 7: Record job + route + wealth-section UI

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (ONE additive branch, dynamic `await import()` — no new static imports, 72-guard intact), wealth room component (cost section: per-venue day/all-time lines with provenance badges; near-empty states as absences)
- Create: `apps/dashboard/server/services/jobs/costs-refresh.mjs` (daily: read fills → measureFillCosts → recordFillCost → rollupDay → prune; each step named-absence-tolerant; registered via existing `every()` in scheduler.mjs — no boot reorder), `apps/dashboard/server/__tests__/costsApi.test.mjs` + room section test beside the wealth room tests
- Test: fresh handlers import + `PICC_COSTS_DATA_DIR` redirect; unauth refused; overview shape (venues, provenance, incomplete); requireAuth first; no ceremony interference; job test with mocked fills (success, empty, throw → named reasons)

**Interfaces:**
- Consumes: Tasks 1–6 exact exports.
- Produces:
  - `GET /api/costs/overview` → `{ venues, incomplete, provenance }`
  - Wealth room cost section (ships in the room component; nav wiring follows the WS-6 T0 carry-forward)

- [ ] **Step 1: Write the failing test**

API suite: route missing → 404 (then shape assertions after implementation); component test: provenance badges render, absences render (not zeros).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/costsApi.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL (404 or no `venues`)

- [ ] **Step 3: Write minimal implementation**

Record job + route branch + section UI. No bootSequence reorder; no ceremony route.

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npx vitest run server/__tests__/costsApi.test.mjs` then `npm run typecheck` (repo root)
Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add <job, route, room section, tests>
git commit -m "feat(costs): record job, overview route and wealth-section UI"
```
