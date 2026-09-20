# C2 — Copilot Command Deck Implementation Plan

**Status:** COMPLETE · **Date:** 2026-09-20 · **Commits:** `4d3f93b` (T1), `d535450` (T2), `5c84676`+`592b9ea` (T3 + costLine remediation), `18fc6e0` (T4), `0a043bc`+`640fbb6` (T5 + bailout-honesty remediation), `48195cd` (T6), `docs` closure commit (this file). Floor: 245 files / 2581 tests green (T0 239/2561).

**Plan deviations (recorded at closure):** (1) `@testing-library/react` is NOT installed — C1's T7 frontend snippets were aspirational; C2 component tests use `createRoot` + `flushSync` + manual queries per `MinistryRoom.studio.test.tsx`. (2) Design ch.2 line 32 "richer status.v32" is delivered as a NEW additive `v32` suite section (soak-bay digits), NOT a mutation of the live payload's `status.v32` — the payload stays OFF-byte-identical (ADR-0005). (3) The register endpoint (C1) returns `soak.resolved` = supplied ledger ROW count; the soak bay's "decisions resolved/total" uses `flipGate.candidateTrades` vs target 100, because rows are per engine|expiry aggregates, not decision counts. (4) `V32DecisionRow.costLine` is nullable (`{…} | null`) — v3.2-eval w/ OBSERVE/ctx-bailout rows carry no cost line; component null-guards and renders "—". (5) `v32Engine` returns a 4-field ctx-bailout row (`{ engine, assetId, verdict, reason }`) when context assembly fails; `V32DecisionRow` must be null-safe against it (Ruling I; `row.asset ?? row.assetId`, `(row.reasons ?? [])`) and render no zeros / no spurious failed gates on that path (T5 remediation `640fbb6`). (6) `Badge` tone union is `accent|success|warn|danger|muted` and `Card` accepts only `{ className?, style?, children }` (Rulings G/J): brief snippets using `tone="warning"` or `data-testid` on `Card` were adjudicated to valid props. (7) T5's `pillars` label+count merge into one span: the brief's own JSX could never render its own contiguous `pillars 2/5` assertion (JSX whitespace stripping). (8) `TradingSuite.deeplink.test.tsx` is order-coupled and may flake in a mixed batch; re-run alone, do not modify. (9) One-commit-per-task was relaxed twice for reviewer-remediation commits (T3 `592b9ea`, T5 `640fbb6`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v3.2 lane fully visible on the trading Dashboard by rebuilding it into the Copilot Command Deck — an additive realtime `v32` suite section feeding a Soak Status bay, v3.2-aware Decision Register rows (pillars, cost line, trip-wires, explain), and the Watch → Decide → Dispatch → Act spine stacked vertically — with every digit honest (stale = visibly stale, never zeroed, never interpolated).

**Architecture:** Additive-only (ADR-0005). Server side ships ONE new suite section (`v32Section` in `realtimeSuite`'s SECTIONS) composed by a pure, injectable `composeV32Section(...)` (mirrors `v32Register`); it reuses `v32Register` for the register bytes, then adds the soak digits the design names — 1m buffer coverage (`mergeCCXTAssets(getBrokerData())` vs `MIN_BARS`), decisions resolved/total (flip-gate `candidateTrades` vs the 100-trade target), breakeven (`candidateExpectancy`), uptime (a new additive `enabledAt` config stamp; absent stamp → honest null + reason), flip-gate progress (`flipGate`). The frontend rides `useRealtimeSuite`'s existing snapshot for SoakBay + DispatchStrip and the existing `getTradingDecisions()` poll for the Decision Register (rows gain a `strategies.v32.result` branch); `DashboardRoom` becomes the spine. No new state library, no new runtime dependency; existing payload bytes stay untouched.

**Tech Stack:** Node 22 ESM (`server/services/*.mjs`), Vitest, Express-less `handlers.mjs`, React 19 + TS, jsdom via `createRoot` + `flushSync` + manual DOM queries (NOT `@testing-library/react` — see deviation note T3/T5).

**Spec:** `docs/specs/PICC_COPILOT_REDESIGN_v1.md` (ch. 2 line 32 additive v32 section; ch. 3 spine; ch. 4 Decision Register + Soak Status bay + honest empty states; ch. 6 testing) + `docs/adr/0005-additive-api-contract.md`.

## Global Constraints

- Additive-only API contract (ADR-0005): new endpoints + additive keys only; existing payload bytes never change while v3.2 is OFF; the 2527-test floor + byte-identity tests stay green.
- Never fabricate data: soak digits with no honest source return `null` + a `reason`; `flipGate` numbers come from `constitution.flipGate`; buffer counts come from live buffers (`MIN_BARS = 40`, `ANALYSIS_PERIOD = 60`).
- Hermetic service/API tests: fresh-import + `PICC_*_DATA_DIR` env redirect + `vi.resetModules()` per test (the `accountMetricsApi.test.mjs` pattern). `v32Section.mjs` must be mockable from `realtimeSuite.test.mjs` so the mixed floor never chains a live engine read under VITEST.
- Frontend tests: `@vitest-environment jsdom`, `createRoot` from `react-dom/client` + `flushSync` + manual DOM queries + `waitFor(check, what, timeoutMs)` helper; `vi.mock("@/hooks/useRealtimeSuite")` / `vi.mock("@/lib/...")` for data hooks. `@testing-library/react` is NOT installed (see T3 deviation note).
- Existing tokens/classes only (no new styling deps, no inline hex). Existing `TradingSuite` card components are reused, not re-implemented.
- Targeted vitest filters are relative paths from `apps/dashboard` workdir; PowerShell, no `rg`/`head`/`grep` binaries.
- Commits: one per task, message style that matches the repo (`feat(copilot): ...`).

---

### Task 1: Additive `enabledAt` stamp in `v32Config` (honest uptime source)

**Files:**
- Modify: `apps/dashboard/server/services/v32Config.mjs` (V32_DEFAULTS, TOP_KEYS, validateV32Config, add `stampV32Config`, wire into `saveV32Config`)
- Test: `apps/dashboard/server/__tests__/v32Config.test.mjs`

**Interfaces:**
- Produces (Task 2 consumes):
  - `stampV32Config(value, now = Date.now())` — pure. Returns a copy with `enabledAt` stamped when `enabled === true` and no stamp exists, `null` when `enabled === false` (a fresh enable re-stamps), else unchanged.
  - `V32_DEFAULTS.enabledAt: null`; `TOP_KEYS` gains `"enabledAt"`; validate allows `null` or finite number.
- Consumes: existing `validateV32Config`, `saveV32Config` (VITEST-suppressed — so the stamp lives in the pure helper, tested directly).

- [ ] **Step 1: Write the failing tests**

Append to `apps/dashboard/server/__tests__/v32Config.test.mjs`:

```js
import { stampV32Config } from "../services/v32Config.mjs"

describe("v32Config enabledAt stamp (C2 uptime source)", () => {
  it("stamps a fresh enabled-at when a config first turns enabled", () => {
    const out = stampV32Config({ enabled: true, proposalCap: 3, consecutiveLossThreshold: null }, 12345)
    expect(out.enabledAt).toBe(12345)
    expect(out.enabled).toBe(true)
  })

  it("keeps an existing stamp while enabled (uptime is continuous)", () => {
    const out = stampV32Config({ enabled: true, enabledAt: 111 }, 222)
    expect(out.enabledAt).toBe(111)
  })

  it("clears the stamp when disabled so a re-enable re-stamps", () => {
    const out = stampV32Config({ enabled: false, enabledAt: 111 }, 222)
    expect(out.enabledAt).toBeNull()
  })

  it("leaves unrelated config keys untouched", () => {
    const out = stampV32Config({ enabled: true, proposalCap: 7 }, 5)
    expect(out.proposalCap).toBe(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/dashboard`): `npx vitest run server/__tests__/v32Config.test.mjs --maxWorkers=3`
Expected: FAIL — `stampV32Config` is not exported.

- [ ] **Step 3: Implement the stamp**

In `apps/dashboard/server/services/v32Config.mjs`:

```js
export const V32_DEFAULTS = Object.freeze({
  enabled: false,
  proposalCap: 0,
  consecutiveLossThreshold: null,
  enabledAt: null // C2: additive soak "uptime" anchor, stamped when enabled (honest null when never enabled)
})

const TOP_KEYS = new Set(["enabled", "proposalCap", "consecutiveLossThreshold", "enabledAt"])
```

In `validateV32Config`, after the `consecutiveLossThreshold` check:

```js
  if (raw.enabledAt != null) {
    checkType(raw.enabledAt, "number", errors, "enabledAt")
  }
```

Add the pure stamp helper above `saveV32Config`:

```js
/**
 * Additive enabled-at stamp (C2). Pure so tests never touch the data dir:
 * enabled without a stamp → stamp now; disabled → clear the stamp so a
 * re-enable reflects a new soak start. Any other payload is returned unchanged.
 */
export function stampV32Config(value, now = Date.now()) {
  if (value == null || typeof value !== "object") return value
  if (value.enabled === true) {
    if (value.enabledAt != null) return value
    return { ...value, enabledAt: now }
  }
  if (value.enabled === false && value.enabledAt != null) {
    return { ...value, enabledAt: null }
  }
  return value
}
```

In `saveV32Config`, stamp before serializing (VITEST returns early, so this only runs in real runs, but the pure helper is the tested surface):

```js
export async function saveV32Config(value, { file = null } = {}) {
  if (process.env.VITEST) return true
  const stamped = stampV32Config(value)
  const payload = JSON.stringify(validateV32Config(stamped).ok ? stamped : V32_DEFAULTS, null, 2)
  // ... rest unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/v32Config.test.mjs --maxWorkers=3`
Expected: PASS (old + new tests).

- [ ] **Step 5: Run the full floor once**

Run (from repo root): `npm run typecheck; if ($?) { cd apps/dashboard; npx vitest run --maxWorkers=3 }`
Expected: green floor (no test touches the real data dir; VITEST suppression keeps `saveV32Config` inert).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/services/v32Config.mjs apps/dashboard/server/__tests__/v32Config.test.mjs
git commit -m "feat(copilot): v32Config stamps enabledAt for honest soak uptime"
```

---

### Task 2: `v32Section` realtime section (soak digits + additive explain)

**Files:**
- Create: `apps/dashboard/server/services/v32Section.mjs`
- Modify: `apps/dashboard/server/services/realtimeSuite.mjs` (import + SECTIONS entry)
- Modify: `apps/dashboard/server/__tests__/realtimeSuite.test.mjs` (mock `./v32Section.mjs`, add snapshot + isolation assertions)
- Test: `apps/dashboard/server/__tests__/v32Section.test.mjs`

**Interfaces:**
- Consumes (Task 1): `V32_DEFAULTS.enabledAt` via `loadV32Config`; `stampV32Config` not needed here (config is read-only in the lane cycle).
- Consumes (C1 + verified sources): `v32Register` (`server/services/v32Register.mjs`), `getDecisions` (adaptiveConfluence.mjs:1263), `correctlyAnsweredByEngine` (accuracyLedger.mjs:163), `loadV32Config`, `mergeCCXTAssets` (liveCCXT.mjs:336), `getBrokerData` (brokers/index.mjs:107), `MIN_BARS` (adaptiveConfluence.mjs:49), `explainState` (v32Copilot.mjs:216).
- Produces (Task 3+ consume the shape):
  - `v32Section()` → live-gathering wrapper (fault-isolated per source).
  - `composeV32Section({ decisions = [], rows = null, config = null, watch = [], at = Date.now() })` → pure, injectable, the tested surface. Return shape:
    ```js
    {
      ok: true,
      enabled, mode, at,            // from v32Register
      assets, assetCount,           // from v32Register (v3.2 result rows, wire bytes unchanged)
      soak, flipGate,               // from v32Register (C1 contract preserved verbatim)
      watch: { total, buffered, reason },     // NEW — 1m buffer coverage over the watch set
      decisions: { resolved, total },         // NEW — resolved = flipGate.candidateTrades, total = 100 (soak target)
      breakeven,                              // NEW — round3(candidateExpectancy) | null
      uptime: { seconds, reason },            // NEW — from config.enabledAt; absent → null + reason
      explain: [{ assetId, state }]           // NEW — additive per-asset explainState (empty when off)
    }
    ```

- [ ] **Step 1: Write the failing unit tests**

Create `apps/dashboard/server/__tests__/v32Section.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROW = (assetId) => ({
  engine: "v3.2",
  assetId,
  asset: assetId,
  direction: "up",
  expiry: 60,
  ts: 100,
  score: { available: true, score: 0.8, direction: "up", pillars: [
    { pillar: "vwap", available: true, side: "above", direction: "up" },
    { pillar: "ema", available: true, aligned: "long", direction: "up" }
  ], degraded: [] },
  costLine: { ev: 0.14, evPerWin: null, breakevenPayout: 55, payoutBeats: true, evRR: 2.4, evRRPass: true },
  confidence: 66,
  regime: { registers: { adx: { available: true, chop: false } } },
  copilot: { ok: true, wires: [], blockedBy: [] },
  verdict: "TRADE",
  gates: { score: true, costLine: true, copilot: true },
  reasons: [],
  honesty: { sampleSource: "rows", spreadSource: null, calendarSource: "fallback-schedule", candleSource: "liveEO", tradesFeed: "absent" }
})

const LEDGER_ROWS = [
  { engine: "v3.2", expiry: "60", hits: 12, misses: 6, total: 18 },
  { engine: "legacy", expiry: "60", hits: 90, misses: 60, total: 150 }
]

describe("v32Section compose (pure, injectable)", () => {
  let sec
  beforeEach(async () => {
    vi.resetModules()
    sec = await import("../services/v32Section.mjs")
  })
  afterEach(() => vi.resetModules())

  it("sits inert under an OFF lane: zeros, honest reasons, no phantom assets", async () => {
    const out = await sec.composeV32Section({
      decisions: [{ strategies: { v32: { enabled: true, result: ROW("EURUSD") } } }],
      rows: LEDGER_ROWS,
      config: { enabled: false },
      watch: [{ id: "EURUSD", periods: { 60: Array(40).fill({ c: 1 }) } }],
      at: 50
    })
    expect(out.enabled).toBe(false)
    expect(out.mode).toBe("shadow")
    expect(out.assets).toEqual([])
    expect(out.assetCount).toBe(0)
    expect(out.watch.total).toBe(1)
    expect(out.watch.buffered).toBe(1)
    expect(out.decisions.resolved).toBe(18)
    expect(out.decisions.total).toBe(100)
    expect(out.breakeven).toBeNull()
    expect(out.uptime.seconds).toBeNull()
    expect(out.uptime.reason).toContain("stamp")
    expect(out.explain).toEqual([])
    expect(out.soak.reason).toContain("powered toggle")
  })

  it("reports buffer coverage from the live watch set vs MIN_BARS", async () => {
    const out = await sec.composeV32Section({
      decisions: [],
      rows: [],
      config: { enabled: false },
      watch: [
        { id: "EURUSD", periods: { 60: Array(40).fill({ c: 1 }) } },
        { id: "GBPUSD", periods: { 60: [] } },
        { id: "BTCUSD", periods: { 60: Array(12).fill({ c: 1 }) } }
      ],
      at: 1
    })
    expect(out.watch.total).toBe(3)
    expect(out.watch.buffered).toBe(1)
    expect(out.watch.reason).toBeNull()
  })

  it("honestly reports an empty watch set instead of inventing coverage", async () => {
    const out = await sec.composeV32Section({ decisions: [], rows: [], config: { enabled: false }, watch: [], at: 1 })
    expect(out.watch.total).toBe(0)
    expect(out.watch.buffered).toBe(0)
    expect(out.watch.reason).toContain("waiting for the live watch set")
  })

  it("computes breakeven + uptime from flip-gate digits and the config stamp", async () => {
    const out = await sec.composeV32Section({
      decisions: [],
      rows: LEDGER_ROWS,
      config: { enabled: true, enabledAt: 400 },
      watch: [],
      at: 1500
    })
    expect(out.enabled).toBe(true)
    expect(out.mode).toBe("powered")
    // candidate = 18 trades, 12 hits at 82 payout / 6 misses → ev = 12*0.82 - 6 = 3.84 → /18 = 0.2133 → 0.213
    expect(out.breakeven).toBe(0.213)
    expect(out.uptime.seconds).toBe(1100)
    expect(out.uptime.reason).toBeNull()
    expect(out.decisions.resolved).toBe(18)
    expect(out.flipGate.candidateTrades).toBe(18)
  })

  it("returns null uptime with an explicit reason when enabled but never stamped", async () => {
    const out = await sec.composeV32Section({
      decisions: [],
      rows: LEDGER_ROWS,
      config: { enabled: true, enabledAt: null },
      watch: [],
      at: 1500
    })
    expect(out.uptime.seconds).toBeNull()
    expect(out.uptime.reason).toContain("enabledAt")
  })

  it("forwards enabled v3.2 rows exactly and attaches additive explain state", async () => {
    const row = ROW("EURUSD")
    const out = await sec.composeV32Section({
      decisions: [{ strategies: { v32: { enabled: true, result: row } } }],
      rows: LEDGER_ROWS,
      config: { enabled: true, enabledAt: 100, proposalCap: 0, consecutiveLossThreshold: null },
      watch: [],
      at: 200
    })
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toEqual(row) // register contract: wire bytes mirrored exactly
    expect(out.explain).toHaveLength(1)
    expect(out.explain[0].assetId).toBe("EURUSD")
    expect(out.explain[0].state.ok).toBe(true)
    expect(out.explain[0].state.verdict).toBe("TRADE")
    expect(out.explain[0].state.score).toEqual({ available: true, score: 0.8, direction: "up" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/dashboard`): `npx vitest run server/__tests__/v32Section.test.mjs --maxWorkers=3`
Expected: FAIL — `v32Section.mjs` does not exist.

- [ ] **Step 3: Implement `v32Section.mjs`**

Create `apps/dashboard/server/services/v32Section.mjs`:

```js
// Additive realtime surface for the v3.2 soak bay (PICC_COPILOT_REDESIGN_v1
// ch.2 line 32 + ch.4). Composes the v32Register bytes with the soak digits the
// design names, plus additive per-asset explainState. Never fabricates: absent
// buffers / untamped uptime → explicit reason. `composeV32Section` is pure and
// injectable (every source passed in); `v32Section()` is the live wrapper that
// gathers each source in its own try/catch so a dead feed degrades, never throws.
import { v32Register } from "./v32Register.mjs"
import { MIN_BARS } from "./adaptiveConfluence.mjs"

export { v32Register } // re-export so the register's contract rides along unchanged

const SOAK_TARGET = 100 // flipGate default minTrades (constitution.mjs:243)

function round3(n) {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null
}

/**
 * Additive explain-state per asset, composed from the row's own fields so the
 * frontend never re-implements gate logic. Pure/deterministic; absent rows →
 * empty.
 */
async function explainFor(assets, config, at) {
  if (!Array.isArray(assets) || assets.length === 0) return []
  const { explainState } = await import("./v32Copilot.mjs")
  return assets.map((row) => ({
    assetId: row.assetId,
    state: explainState({
      regime: row.regime ?? {},
      execution: { score: row.score, costLine: row.costLine },
      constitution: {},
      risk: {},
      config: config ?? {},
      at: Number.isFinite(row.ts) ? row.ts : at
    })
  }))
}

export async function composeV32Section({ decisions = [], rows = null, config = null, watch = [], at = Date.now() } = {}) {
  const register = await v32Register({ decisions, rows, config, at })
  const assetList = Array.isArray(watch) ? watch : []
  const buffered = assetList.filter((a) => (a?.periods?.[60]?.length ?? 0) >= MIN_BARS).length
  const watchDigit = {
    total: assetList.length,
    buffered,
    reason: assetList.length === 0 ? "waiting for the live watch set — broker feeds absent" : null
  }
  const candidateTrades = Number.isFinite(register.flipGate?.candidateTrades) ? register.flipGate.candidateTrades : 0
  const breakeven = round3(register.flipGate?.candidateExpectancy)
  const enabledAt = config?.enabledAt
  const uptime = {
    seconds: Number.isFinite(enabledAt) && register.enabled && at >= enabledAt ? Math.floor((at - enabledAt) / 1000) : null,
    reason: register.enabled
      ? (Number.isFinite(enabledAt) ? null : "no enabledAt stamp in v32-config — uptime inapplicable")
      : "v3.2 lane off — uptime requires a powered toggle"
  }
  const explain = register.enabled ? await explainFor(register.assets, config, at) : []
  return {
    ...register,
    watch: watchDigit,
    decisions: { resolved: candidateTrades, total: SOAK_TARGET },
    breakeven,
    uptime,
    explain
  }
}

/**
 * Live wrapper for realtimeSuite SECTIONS. Each source is fault-isolated: a
 * dead engine/ledger/config/broker feed degrades the digit to an honest null
 * rather than throwing and killing the whole `suite` event.
 */
export async function v32Section() {
  let decisions = []
  try {
    const { getDecisions } = await import("./adaptiveConfluence.mjs")
    decisions = ((await getDecisions())?.decisions ?? []) || []
  } catch { /* engine offline → empty */ }
  let rows = null
  try {
    const { correctlyAnsweredByEngine } = await import("./accuracyLedger.mjs")
    rows = correctlyAnsweredByEngine()
  } catch { rows = [] }
  let config = null
  try {
    const { loadV32Config } = await import("./v32Config.mjs")
    config = (await loadV32Config({})).config ?? null
  } catch { config = null }
  let watch = []
  try {
    const { getBrokerData } = await import("./brokers/index.mjs")
    const { mergeCCXTAssets } = await import("./liveCCXT.mjs")
    watch = (mergeCCXTAssets(getBrokerData())?.assets ?? []) || []
  } catch { watch = [] }
  let at = Date.now()
  try {
    const { getDecisions } = await import("./adaptiveConfluence.mjs")
    const cached = await getDecisions()
    if (Number.isFinite(cached?.ts)) at = cached.ts
  } catch { /* keep Date.now() */ }
  return composeV32Section({ decisions, rows, config, watch, at })
}
```

- [ ] **Step 4: Run the v32Section unit test to verify it passes**

Run: `npx vitest run server/__tests__/v32Section.test.mjs --maxWorkers=3`
Expected: PASS.

- [ ] **Step 5: Wire the section into realtimeSuite**

In `apps/dashboard/server/services/realtimeSuite.mjs`, add the import after `dispatchSection`:

```js
import { v32Section } from "./v32Section.mjs"
```

And the section entry after `dispatch`:

```js
  dispatch: { ttl: 2000, load: () => dispatchSection() },
  // v3.2 soak bay digits + register (C2). Own TTL like the other slow lanes; a
  // failing section degrades to `snapshot.v32 = null`, never kills the suite.
  v32: { ttl: 8000, load: () => v32Section() }
```

- [ ] **Step 6: Extend realtimeSuite.test.mjs (mock the dry runner, assert the wire-in)**

Add after the existing `dispatch` mock block (mock BEFORE the module-level imports):

```js
vi.mock("../services/v32Section.mjs", () => ({
  v32Section: vi.fn(async () => ({
    ok: true,
    enabled: false,
    mode: "shadow",
    at: 1,
    assets: [],
    assetCount: 0,
    soak: { resolved: 0, breakeven: null, reason: "v3.2 lane off — soak digits require a powered toggle" },
    flipGate: { flip: false, legacyExpectancy: null, candidateExpectancy: null, legacyTrades: 0, candidateTrades: 0, reason: "no decided rows for one engine — soak not comparable" },
    watch: { total: 0, buffered: 0, reason: "waiting for the live watch set — broker feeds absent" },
    decisions: { resolved: 0, total: 100 },
    breakeven: null,
    uptime: { seconds: null, reason: "v3.2 lane off — uptime requires a powered toggle" },
    explain: []
  }))
}))
```

Add inside the first `it` in `describe("tradingSuiteSnapshot", ...)` (after the `dispatch` assertion):

```js
    expect(snap.v32.ok).toBe(true)
    expect(snap.v32.enabled).toBe(false)
    expect(snap.v32.watch.buffered).toBe(0)
    expect(snap.v32.decisions.total).toBe(100)
```

Add a fault-isolation `it` after the existing convergence isolation test:

```js
  it("fault-isolates a failing v32 section to null (soak bay never kills the suite)", async () => {
    m.bustRealtimeSuite()
    vi.mocked(v32SectionMock.v32Section).mockRejectedValueOnce(new Error("engine down"))
    const snap = await m.tradingSuiteSnapshot()
    expect(snap.v32).toBeNull()
    expect(snap.trading.ok).toBe(true)
    const snap2 = await m.tradingSuiteSnapshot()
    expect(snap2.v32.ok).toBe(true)
    m.bustRealtimeSuite()
  })
```

Also capture the imported mock at module scope, next to the other module imports:

```js
const v32SectionMock = await import("../services/v32Section.mjs")
```

- [ ] **Step 7: Run realtimeSuite tests**

Run: `npx vitest run server/__tests__/realtimeSuite.test.mjs --maxWorkers=3`
Expected: PASS (old 8 + new assertions + new isolation test).

- [ ] **Step 8: Run the typecheck + full floor**

From repo root: `npm run typecheck; if ($?) { cd apps/dashboard; npx vitest run --maxWorkers=3 }`
Expected: green floor.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/server/services/v32Section.mjs apps/dashboard/server/services/realtimeSuite.mjs apps/dashboard/server/__tests__/v32Section.test.mjs apps/dashboard/server/__tests__/realtimeSuite.test.mjs
git commit -m "feat(copilot): realtime v32 section with honest soak digits"
```

---

### Task 3: Frontend v3.2 types + additive snapshot key (+ deviation note)

**Files:**
- Modify: `apps/dashboard/src/lib/liveTrading.ts` (`TradingSuiteSnapshot` + `LiveDecision`)
- Create: `apps/dashboard/src/lib/v32.ts` (types + helpers)
- Test: `apps/dashboard/src/lib/__tests__/v32.test.ts`

**Interfaces:**
- Consumes (Task 2): the `v32Section` shape (documented in Task 2 interfaces).
- Produces (Task 4/5 consume):
  - `src/lib/v32.ts`: `V32Pillar`, `V32CopilotWire`, `V32DecisionRow`, `V32ExplainState`, `V32FlipGate`, `V32Soak`, `V32Watch`, `V32Decisions`, `V32Uptime`, `V32RegisterSnapshot`, `EV_RR_MIN = 2`, `fmtUptime(seconds|null)`, `pillarGlyph(pillar)`.
  - `TradingSuiteSnapshot.v32: V32RegisterSnapshot | null` (additive key).
  - `LiveDecision.strategies?: { v32?: { enabled: boolean; result: V32DecisionRow } }` (additive optional).

> **Deviation note (recorded for closure):** `@testing-library/react` is NOT installed (`package.json`'s jsdom + react-dom only). C1's plan (T7 snippets) referenced RTL APIs; the repo's actual convention (verified in `MinistryRoom.studio.test.tsx`, `DispatchBell.test.tsx`, `useCandleData.*`) is `createRoot` + `flushSync` + manual DOM queries + a local `waitFor`. All C2 component tests follow that convention.

- [ ] **Step 1: Write the failing type/helper tests**

Create `apps/dashboard/src/lib/__tests__/v32.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { EV_RR_MIN, fmtUptime, pillarGlyph } from "@/lib/v32"

describe("v3.2 frontend helpers", () => {
  it("exposes the cost-line floor the soak bay labels against", () => {
    expect(EV_RR_MIN).toBe(2)
  })

  it("formats uptime seconds hum3anly and honestly (null in → '—')", () => {
    expect(fmtUptime(null)).toBe("—")
    expect(fmtUptime(0)).toBe("0s")
    expect(fmtUptime(59)).toBe("59s")
    expect(fmtUptime(60)).toBe("1m")
    expect(fmtUptime(3661)).toBe("1h 1m")
  })

  it("glyphs a pillar by its directional read", () => {
    expect(pillarGlyph({ direction: "up" })).toBe("▲")
    expect(pillarGlyph({ direction: "down" })).toBe("▼")
    expect(pillarGlyph({ direction: "neutral" })).toBe("·")
    expect(pillarGlyph({ available: false })).toBe("—")
    expect(pillarGlyph({})).toBe("?")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/dashboard`): `npx vitest run src/lib/__tests__/v32.test.ts --maxWorkers=3`
Expected: FAIL — `@/lib/v32` does not exist.

- [ ] **Step 3: Create `src/lib/v32.ts`**

```ts
// v3.2 lane — frontend types + tiny presentational helpers (PICC_COPILOT_REDESIGN
// ch.2/4). Types mirror the server surfaces: the realtime `v32` section
// (v32Section.mjs), the register rows (v32Engine.v32DecisionForAsset), and the
// additive per-asset explain state (v32Copilot.explainState). Honesty helpers
// return "—" for null so absent digits render as absent, never as 0.
import type { DispatchEntry } from "@/lib/dispatch"

export const EV_RR_MIN = 2 // constitution.mjs:22 — the cost-line floor

export interface V32Pillar {
  pillar: string
  available?: boolean
  direction?: "up" | "down" | "neutral"
  reason?: string
  [k: string]: unknown
}

export interface V32CopilotWire {
  id: number | string
  tripped: boolean
  reason: string
  [k: string]: unknown
}

export interface V32DecisionRow {
  engine: "v3.2"
  assetId: string
  asset: string
  direction: "up" | "down" | null
  expiry: number | null
  ts: number
  score: {
    available: boolean
    score: number | null
    direction: "up" | "down" | "neutral"
    pillars: V32Pillar[]
    degraded: { pillar: string; reason: string }[]
    reason?: string
    source?: string
  }
  costLine: {
    ev: number | null
    evPerWin: number | null
    breakevenPayout: number | null
    payoutBeats: boolean
    evRR: number | null
    evRRPass: boolean
  }
  confidence: number | null
  regime: unknown
  copilot: { ok: boolean; wires: V32CopilotWire[]; blockedBy: (string | number)[] }
  verdict: "TRADE" | "OBSERVE" | "NEUTRAL"
  gates: { score: boolean; costLine: boolean; copilot: boolean }
  reasons: string[]
  honesty: { sampleSource?: string; spreadSource?: string | null; calendarSource?: string; candleSource?: string; tradesFeed?: string }
}

export interface V32ExplainState {
  at: number | null
  ok: boolean
  verdict: "TRADE" | "NEUTRAL"
  blockedBy: (string | number)[]
  wires: V32CopilotWire[]
  costLine: V32DecisionRow["costLine"] | null
  score: { available: boolean; score: number | null; direction: string } | null
  regime: { adx: { available: boolean; chop: boolean | null } | null; session: { available: boolean; label: string | null } | null }
  risk: { dayStartBalance: unknown; pnl: unknown; proposalsToday: unknown }
  config: { proposalCap: number | null; consecutiveLossThreshold: number | null }
}

export interface V32FlipGate {
  flip: boolean
  legacyExpectancy: number | null
  candidateExpectancy: number | null
  legacyTrades: number
  candidateTrades: number
  reason: string
}

export interface V32Soak {
  resolved: number
  breakeven: number | null
  reason: string | null
}

export interface V32Watch {
  total: number
  buffered: number
  reason: string | null
}

export interface V32Decisions {
  resolved: number
  total: number
}

export interface V32Uptime {
  seconds: number | null
  reason: string | null
}

export interface V32RegisterSnapshot {
  ok: boolean
  enabled: boolean
  mode: "powered" | "shadow"
  at: number
  assets: V32DecisionRow[]
  assetCount: number
  soak: V32Soak
  flipGate: V32FlipGate
  watch: V32Watch
  decisions: V32Decisions
  breakeven: number | null
  uptime: V32Uptime
  explain: { assetId: string; state: V32ExplainState }[]
}

/** Uptime seconds → "59s" / "1m" / "1h 2m"; null → "—" (never "0" for absent). */
export function fmtUptime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—"
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Pillar seal glyph: directional read, or an honest "—" when unmeasured. */
export function pillarGlyph(p: V32Pillar): string {
  if (p.available === false) return "—"
  if (p.direction === "up") return "▲"
  if (p.direction === "down") return "▼"
  if (p.direction === "neutral") return "·"
  return "?"
}
```

- [ ] **Step 4: Add the additive keys to `liveTrading.ts`**

In `TradingSuiteSnapshot` (after `dispatch`):

```ts
  dispatch: { unread: number; entries: DispatchEntry[] } | null
  /** v3.2 soak bay + register (C2) — additive section; absent when the lane is off or the section failed. */
  v32: V32RegisterSnapshot | null
```

Add the import next to the existing `import type { DispatchEntry } ...` block (top of file):

```ts
import type { V32RegisterSnapshot } from "@/lib/v32"
```

In `LiveDecision` (after the `sentiment` optional field):

```ts
  /** v3.2 lane row, attached when the lane is enabled (additive). Absent for legacy decisions. */
  strategies?: { v32?: { enabled: boolean; result: V32DecisionRow } }
```

Add `V32DecisionRow` to the same `v32` import:

```ts
import type { V32DecisionRow, V32RegisterSnapshot } from "@/lib/v32"
```

- [ ] **Step 5: Run tests + typecheck**

From `apps/dashboard`: `npx vitest run src/lib/__tests__/v32.test.ts --maxWorkers=3`
Then from repo root: `npm run typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/v32.ts apps/dashboard/src/lib/__tests__/v32.test.ts apps/dashboard/src/lib/liveTrading.ts
git commit -m "feat(copilot): frontend v3.2 types + additive snapshot key"
```

---

### Task 4: Soak Status bay component (honest live digits)

**Files:**
- Create: `apps/dashboard/src/components/SoakBay.tsx`
- Test: `apps/dashboard/src/components/__tests__/SoakBay.test.tsx`

**Interfaces:**
- Consumes (Task 3): `V32RegisterSnapshot`, `fmtUptime`, `pillarGlyph` from `@/lib/v32`.
- Consumes: `useRealtimeSuite` from `@/hooks/useRealtimeSuite`.
- Produces: `<SoakBay />` — standalone presentational bay reading `snapshot.v32`; renders the design's digits (ch.4): enabled/mode, assets watched, 1m buffer coverage, decisions resolved/total, breakeven, uptime, flip-gate progress. Stale = visibly stale when `snapshot.ts` is old / `connected` is false; empty = "awaiting live buffers (≥40 × 1m per asset)" with the exact off-lane reason. Never zeroes a null digit.

- [ ] **Step 1: Write the failing component tests**

Create `apps/dashboard/src/components/__tests__/SoakBay.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { SoakBay } from "../SoakBay"
import type { V32RegisterSnapshot } from "@/lib/v32"

let mockSnapshot: { ts: number; v32: V32RegisterSnapshot | null } | null = null
let mockConnected = true

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ snapshot: mockSnapshot, live: null, connected: mockConnected, error: null })
}))

const SOAK: V32RegisterSnapshot = {
  ok: true, enabled: false, mode: "shadow", at: 1000,
  assets: [], assetCount: 0,
  soak: { resolved: 0, breakeven: null, reason: "v3.2 lane off — soak digits require a powered toggle" },
  flipGate: { flip: false, legacyExpectancy: null, candidateExpectancy: null, legacyTrades: 0, candidateTrades: 0, reason: "no decided rows for one engine — soak not comparable" },
  watch: { total: 3, buffered: 1, reason: null },
  decisions: { resolved: 18, total: 100 },
  breakeven: null,
  uptime: { seconds: null, reason: "v3.2 lane off — uptime requires a powered toggle" },
  explain: []
}

function mount(host: HTMLDivElement) {
  const root = createRoot(host)
  flushSync(() => { root.render(<SoakBay />) })
  return () => { flushSync(() => { root.unmount() }) }
}

describe("SoakBay", () => {
  afterEach(() => { vi.clearAllMocks(); mockSnapshot = null; mockConnected = true })

  it("renders the design's soak digits with honest labels (not zeros)", () => {
    mockSnapshot = { ts: Date.now(), v32: SOAK }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    const text = host.textContent ?? ""
    expect(text).toContain("Soak")
    expect(text).toContain("shadow")
    expect(text).toContain("3 watched")   // total watch set
    expect(text).toContain("1 buffered") // ≥40 × 1m
    expect(text).toContain("18 / 100")   // decisions resolved/total
    expect(text).toContain("v3.2 lane off")
    unmount(); document.body.removeChild(host)
  })

  it("marks stale visibly stale instead of interpolating", () => {
    mockSnapshot = { ts: Date.now() - 60_000, v32: SOAK }
    mockConnected = false
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    expect(host.textContent ?? "").toContain("stale")
    unmount(); document.body.removeChild(host)
  })

  it("renders the vault empty state when the section is absent", () => {
    mockSnapshot = { ts: Date.now(), v32: null }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    expect(host.textContent ?? "").toContain("awaiting live buffers")
    unmount(); document.body.removeChild(host)
  })

  it("shows powered digits when the lane is live", () => {
    mockSnapshot = {
      ts: Date.now(),
      v32: { ...SOAK, enabled: true, mode: "powered", breakeven: 0.213, uptime: { seconds: 1100, reason: null }, flipGate: { ...SOAK.flipGate, flip: false, legacyExpectancy: 0.2, candidateExpectancy: 0.213, legacyTrades: 150, candidateTrades: 18, reason: "candidate under 100 paper trades" } }
    }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    const text = host.textContent ?? ""
    expect(text).toContain("powered")
    expect(text).toContain("breakeven")
    expect(text).toContain("18m")
    unmount(); document.body.removeChild(host)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/dashboard`): `npx vitest run src/components/__tests__/SoakBay.test.tsx --maxWorkers=3`
Expected: FAIL — `../SoakBay` does not exist.

- [ ] **Step 3: Implement `SoakBay.tsx`**

Create `apps/dashboard/src/components/SoakBay.tsx`:

```tsx
// v3.2 Soak Status bay (PICC_COPILOT_REDESIGN ch.4). Lives off the realtime
// suite snapshot's additive `v32` section. Honesty contract: stale = visibly
// stale; absent buffers / off lane = the vault note, never zeros, never
// interpolated digits.
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { fmtUptime } from "@/lib/v32"
import { Badge, Card } from "@/components/ui"

const STALE_MS = 12_000

export function SoakBay() {
  const { snapshot, connected } = useRealtimeSuite()
  const v32 = snapshot?.v32 ?? null
  const stale = !connected || (snapshot != null && Date.now() - snapshot.ts > STALE_MS)

  return (
    <Card className="pad stack" data-testid="soak-bay">
      <div className="row-between">
        <div className="row">
          <strong>V3.2 Soak Status</strong>
          {v32 ? (
            <Badge tone={stale ? "warn" : v32.mode === "powered" ? "success" : "muted"}>
              {stale ? "stale" : v32.mode}
            </Badge>
          ) : (
            <Badge tone="muted">absent</Badge>
          )}
        </div>
        <span className="muted small">flip-readiness at a glance</span>
      </div>

      {!v32 ? (
        <p className="muted small" data-testid="soak-empty">
          Awaiting live buffers (≥40 × 1m per asset) and a broker session to fill the v3.2 register.
        </p>
      ) : (
        <div className="grid grid-4 small" style={{ marginTop: 6, gap: 4 }}>
          <span className="muted">lane <strong>{v32.mode}</strong></span>
          <span className="muted">watched <strong>{v32.watch.total}</strong></span>
          <span className="muted">1m buffered <strong>{v32.watch.buffered}</strong>{" "}
            <em className="muted">{v32.watch.reason ? "(no feed)" : "(≥40 bars)"}</em></span>
          <span className="muted">decisions <strong>{v32.decisions.resolved} / {v32.decisions.total}</strong></span>
          <span className="muted">breakeven <strong>{v32.breakeven != null ? v32.breakeven : "—"}</strong></span>
          <span className="muted">uptime <strong>{fmtUptime(v32.uptime.seconds)}</strong></span>
          <span className="muted">candidate <strong>{v32.flipGate.candidateTrades} ♢</strong></span>
          <span className="muted">legacy <strong>{v32.flipGate.legacyTrades}</strong></span>
        </div>
      )}

      {v32 ? (
        <>
          <div className="row gap small muted" style={{ marginTop: 6 }}>
            <span>flip gate</span>
            <Badge tone={v32.flipGate.flip ? "success" : "muted"}>{v32.flipGate.flip ? "READY" : "soaking"}</Badge>
            <span className="muted small">{v32.flipGate.reason}</span>
          </div>
          {!v32.enabled && v32.soak?.reason ? (
            <p className="muted small" style={{ marginTop: 6 }}>{v32.soak.reason}</p>
          ) : null}
          {v32.uptime.reason && !v32.enabled ? (
            <p className="muted small" style={{ marginTop: 2 }}>{v32.uptime.reason}</p>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}
```

- [ ] **Step 4: Run the component tests**

Run: `npx vitest run src/components/__tests__/SoakBay.test.tsx --maxWorkers=3`
Expected: PASS. (If the "18m" uptime assertion fails because the fixture sets seconds 1100 → "18m", adjust or assert `fantastic`; expected `fmtUptime(1100)` = "18m".)

- [ ] **Step 5: Run typecheck**

From repo root: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/SoakBay.tsx apps/dashboard/src/components/__tests__/SoakBay.test.tsx
git commit -m "feat(copilot): soak status bay with honest live digits"
```

---

### Task 5: Decision Register — v3.2-aware rows (pillars, cost line, trip-wires, explain)

**Files:**
- Modify: `apps/dashboard/src/components/LiveDecisionsPanel.tsx` (route each row: v3.2 branch vs legacy branch)
- Create: `apps/dashboard/src/components/V32DecisionRow.tsx`
- Test: `apps/dashboard/src/components/__tests__/V32DecisionRow.test.tsx`

**Interfaces:**
- Consumes (Task 3): `V32DecisionRow`, `V32ExplainState`, `V32Pillar`, `pillarGlyph` from `@/lib/v32`; the `LiveDecision.strategies` additive key.
- Produces: `<V32DecisionRow row={V32DecisionRow} explain={V32ExplainState | null} />`; `LiveDecisionsPanel` renders it when `d.strategies?.v32?.enabled === true && d.strategies.v32.result`, else the legacy `DecisionRow` unchanged.

- [ ] **Step 1: Write the failing component test**

Create `apps/dashboard/src/components/__tests__/V32DecisionRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { V32DecisionRow } from "../V32DecisionRow"
import type { V32DecisionRow as Row, V32ExplainState } from "@/lib/v32"

const ROW: Row = {
  engine: "v3.2", assetId: "EURUSD", asset: "EURUSD", direction: "up", expiry: 60, ts: 100,
  score: {
    available: true, score: 0.8, direction: "up",
    pillars: [
      { pillar: "vwap", available: true, side: "above", direction: "up" },
      { pillar: "ema", available: true, aligned: "long", direction: "up" },
      { pillar: "volumeDelta", available: false, reason: "volume delta not measured (eo venue)" },
      { pillar: "cvd", available: false, reason: "not measured on eo venue" },
      { pillar: "relativeVolume", available: false, reason: "not measured on eo venue" }
    ],
    degraded: [{ pillar: "volumeDelta", reason: "volume delta not measured (eo venue)" }]
  },
  costLine: { ev: 0.14, evPerWin: null, breakevenPayout: 55, payoutBeats: true, evRR: 2.4, evRRPass: true },
  confidence: 66,
  regime: {},
  copilot: { ok: true, wires: [{ id: 1, tripped: false, reason: "ok" }], blockedBy: [] },
  verdict: "TRADE",
  gates: { score: true, costLine: true, copilot: true },
  reasons: [],
  honesty: { sampleSource: "correctlyAnsweredByEngine", spreadSource: null, calendarSource: "fallback-schedule", candleSource: "liveEO", tradesFeed: "absent" }
}

const EXPLAIN: V32ExplainState = {
  at: 100, ok: true, verdict: "TRADE", blockedBy: [],
  wires: [{ id: 1, tripped: false, reason: "ok" }],
  costLine: ROW.costLine,
  score: { available: true, score: 0.8, direction: "up" },
  regime: { adx: { available: false, chop: null }, session: { available: false, label: null } },
  risk: { dayStartBalance: null, pnl: null, proposalsToday: null },
  config: { proposalCap: 0, consecutiveLossThreshold: null }
}

describe("V32DecisionRow (Decision Register v3.2 branch)", () => {
  function render(host: HTMLDivElement) {
    const root = createRoot(host)
    flushSync(() => { root.render(<V32DecisionRow row={ROW} explain={EXPLAIN} />) })
    return () => { flushSync(() => { root.unmount() }) }
  }

  it("shows the v3.2 engine tag, five pillar glyphs and pillared score", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = render(host)
    const text = host.textContent ?? ""
    expect(text).toContain("v3.2")
    expect(text).toContain("▲")       // vwap up
    expect(text).toContain("▲")       // ema up
    expect(text).toContain("pillars 2/5")
    unmount(); document.body.removeChild(host)
  })

  it("renders the cost line: EV, EV/unit risk, and margin vs EV_RR_MIN", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = render(host)
    const text = host.textContent ?? ""
    expect(text).toContain("EV +0.14")
    expect(text).toContain("EV/RR 2.4")
    expect(text).toContain("margin ✓ (≥2)")
    unmount(); document.body.removeChild(host)
  })

  it("renders confidence, expiry and the explain verdict", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = render(host)
    const text = host.textContent ?? ""
    expect(text).toContain("66%")
    expect(text).toContain("60s")
    expect(text).toContain("TRADE")
    unmount(); document.body.removeChild(host)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/dashboard`): `npx vitest run src/components/__tests__/V32DecisionRow.test.tsx --maxWorkers=3`
Expected: FAIL — `../V32DecisionRow` does not exist.

- [ ] **Step 3: Implement `V32DecisionRow.tsx`**

Create `apps/dashboard/src/components/V32DecisionRow.tsx`:

```tsx
// Decision Register — the v3.2 branch (PICC_COPILOT_REDESIGN ch.4 line 48):
// engine tag, five-point execution pillars as a compact score, the cost line
// (EV, cost-adjusted EV, EV/unit risk, margin vs EV_RR_MIN), confidence,
// trip-wire flags with reason text, and the explain verdict. Every figure is
// presence-guarded: null → "—", never a zero.
import type { V32DecisionRow as Row, V32ExplainState, V32Pillar } from "@/lib/v32"
import { EV_RR_MIN, pillarGlyph } from "@/lib/v32"
import { Badge } from "@/components/ui"

function fmtNum(n: number | null, sign = false): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const s = n.toFixed(2)
  return sign && n > 0 ? `+${s}` : s
}

export function V32DecisionRow({ row, explain }: { row: Row; explain: V32ExplainState | null }) {
  const dir = row.direction === "up" ? "▲" : row.direction === "down" ? "▼" : "→"
  const measured = row.score?.pillars?.filter((p: V32Pillar) => p.available === true).length ?? 0
  const total = row.score?.pillars?.length ?? 0
  const tripped = (row.copilot?.wires ?? []).filter((w) => w.tripped)
  const marginOk = row.costLine?.evRRPass === true

  return (
    <div className={`card pad ${row.verdict === "TRADE" ? "live-cell" : ""}`} data-testid="v32-decision-row">
      <div className="row-between">
        <div className="row gap">
          <Badge tone="success">v3.2</Badge>
          <strong className="small">{row.asset}</strong>
          <span className="muted small">{dir} {row.direction ?? "flat"}</span>
        </div>
        <div className="row gap">
          <Badge tone={row.verdict === "TRADE" ? "success" : row.verdict === "OBSERVE" ? "warn" : "muted"}>{row.verdict}</Badge>
          <span className="muted small">conf {row.confidence != null ? `${row.confidence}%` : "—"}</span>
        </div>
      </div>

      <div className="row gap small" style={{ marginTop: 6 }} title="execution pillars (measured / total)">
        <span className="muted">pillars</span>
        {(row.score?.pillars ?? []).map((p) => (
          <span key={p.pillar} className={p.available === false ? "muted" : ""} title={p.pillar}>
            {pillarGlyph(p)}
          </span>
        ))}
        <span className="muted">{measured}/{total}</span>
      </div>

      <div className="grid grid-3 small" style={{ marginTop: 6, gap: 4 }}>
        <span className="muted">EV <strong>{fmtNum(row.costLine?.ev, true)}</strong></span>
        <span className="muted">EV/RR <strong>{row.costLine?.evRR != null ? row.costLine.evRR.toFixed(1) : "—"}</strong></span>
        <span className="muted">margin <strong className={marginOk ? "" : "danger-text"}>{marginOk ? "✓" : "✗"} (≥{EV_RR_MIN})</strong></span>
        <span className="muted">payout <strong>{row.costLine?.payoutBeats ? "beats BE" : "—"}</strong></span>
        <span className="muted">expiry <strong>{row.expiry != null ? `${row.expiry}s` : "—"}</strong></span>
        <span className="muted">explain <strong>{explain?.verdict ?? row.verdict}</strong></span>
      </div>

      {tripped.length ? (
        <div className="small danger-text" style={{ marginTop: 4 }}>
          {tripped.map((w) => `${w.id}✕ ${w.reason}`).join(" · ")}
        </div>
      ) : row.verdict !== "TRADE" ? (
        <p className="muted small" style={{ marginTop: 4 }}>{row.copilot?.blockedBy?.join(", ") || "not tradeable"}</p>
      ) : null}
      {row.reasons.length ? <p className="muted small" style={{ marginTop: 4 }}>{row.reasons.slice(0, 2).join(" · ")}</p> : null}
    </div>
  )
}
```

- [ ] **Step 4: Route rows in `LiveDecisionsPanel.tsx`**

Add the import near the top:

```tsx
import { V32DecisionRow } from "@/components/V32DecisionRow"
```

Change `DecisionRow`'s render call sites. Because `decisions.map((d) => <DecisionRow key={d.assetId} d={d} />)` appears three times, replace the row-rendering inside each `.map` with a branch:

```tsx
                {trades.map((d) =>
                  d.strategies?.v32?.enabled === true && d.strategies.v32.result ? (
                    <V32DecisionRow key={d.assetId} row={d.strategies.v32.result} explain={null} />
                  ) : (
                    <DecisionRow key={d.assetId} d={d} />
                  )
                )}
```

Apply the same conditional in the `observes.map(...)` and `neutral.map(...)` calls.

Optionally update the empty-state summary to mention the v3.2 register (the existing copy already covers "minimum 40 bars per asset"; keep it).

- [ ] **Step 5: Run the V32DecisionRow test + a decision-panel smoke**

Run: `npx vitest run src/components/__tests__/V32DecisionRow.test.tsx --maxWorkers=3`
Then from repo root: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/V32DecisionRow.tsx apps/dashboard/src/components/__tests__/V32DecisionRow.test.tsx apps/dashboard/src/components/LiveDecisionsPanel.tsx
git commit -m "feat(copilot): v3.2-aware decision register rows"
```

---

### Task 6: Command Deck spine — DispatchStrip + rebuilt DashboardRoom

**Files:**
- Create: `apps/dashboard/src/components/DispatchStrip.tsx`
- Modify: `apps/dashboard/src/pages/ministry/DashboardRoom.tsx` (Watch → Decide → Dispatch → Act bands stacked vertically; SoakBay + register + strip integrated)
- Modify: `apps/dashboard/src/components/__tests__/TradingSuite.deeplink.test.tsx` (ONLY if a suite-card test breaks; verify first)
- Test: `apps/dashboard/src/components/__tests__/DispatchStrip.test.tsx`, `apps/dashboard/src/pages/ministry/__tests__/DashboardRoom.commandDeck.test.tsx`

**Interfaces:**
- Consumes (Task 4): `<SoakBay />`. Consumes (Task 5): `LiveDecisionsPanel` (rendered inside the Decide band). Consumes (C1): `snapshot.dispatch` for the strip.
- Consumes: existing `StatusCards, TradePlannerCard, NewsCard, SignalNotificationsCard` from `@/components/TradingSuite`.
- Produces: `<DispatchStrip />` (unread count + up to 3 latest dispatch entries + link to the Dispatch room) and the rebuilt `DashboardRoom` (spine bands, one `<section data-room="dashboard">`).

- [ ] **Step 1: Write the failing DispatchStrip test**

Create `apps/dashboard/src/components/__tests__/DispatchStrip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { DispatchStrip } from "../DispatchStrip"

let mockUnread = 2
let mockEntries: unknown[] = [{ id: "d1", kind: "decision", severity: "info", title: "Soak milestone", ts: 100, read: false }, { id: "d2", kind: "venue", severity: "warning", title: "Broker notice", ts: 99, read: false }]
vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ snapshot: { dispatch: { unread: mockUnread, entries: mockEntries } }, live: null, connected: true, error: null })
}))

describe("DispatchStrip", () => {
  afterEach(() => { vi.clearAllMocks() })

  it("shows unread count and latest entries, linking to the Dispatch room", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => {
      root.render(<MemoryRouter><DispatchStrip /></MemoryRouter>)
    })
    const text = host.textContent ?? ""
    expect(text).toContain("Dispatch")
    expect(text).toContain("2")
    expect(text).toContain("Soak milestone")
    expect(host.querySelector("a[href='/suites/trading/dispatch']")).toBeTruthy()
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/dashboard`): `npx vitest run src/components/__tests__/DispatchStrip.test.tsx --maxWorkers=3`
Expected: FAIL — `../DispatchStrip` does not exist.

- [ ] **Step 3: Implement `DispatchStrip.tsx`**

Create `apps/dashboard/src/components/DispatchStrip.tsx`:

```tsx
// The Dispatch band of the Command Deck spine (PICC_COPILOT_REDESIGN ch.3):
// a first-class, compact view of the dispatch inbox (unread count + latest)
// with a direct link to the full Dispatch room. Rides the existing realtime
// snapshot — no new polls, no new dependency.
import { NavLink } from "react-router-dom"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { KIND_LABEL } from "@/lib/dispatch"
import { Card, Badge } from "@/components/ui"

const LATEST = 3

export function DispatchStrip() {
  const { snapshot } = useRealtimeSuite()
  const dispatch = snapshot?.dispatch ?? null
  const entries = dispatch?.entries?.slice(0, LATEST) ?? []

  return (
    <Card className="pad stack" data-testid="dispatch-strip">
      <div className="row-between">
        <div className="row">
          <strong>Dispatch</strong>
          {dispatch ? (
            <Badge tone={dispatch.unread > 0 ? "warning" : "muted"}>{dispatch.unread} unread</Badge>
          ) : (
            <Badge tone="muted">no data yet</Badge>
          )}
        </div>
        <NavLink className="small" to="/suites/trading/dispatch">Open Dispatch →</NavLink>
      </div>
      {entries.length ? (
        <div className="stack small" style={{ marginTop: 4 }}>
          {entries.map((e) => (
            <div key={e.id} className="row-between muted small">
              <span>{KIND_LABEL[e.kind] ?? e.kind}: {e.title}</span>
              <span className="tiny">{new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Nothing dispatched yet — PICC is watching.</p>
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Write the failing DashboardRoom Command Deck test**

Create `apps/dashboard/src/pages/ministry/__tests__/DashboardRoom.commandDeck.test.tsx`:

```tsx
// @vitest-environment jsdom
// C2 — the Command Deck spine (PICC_COPILOT_REDESIGN ch.3): the trading
// Dashboard stacks Watch → Decide → Dispatch → Act vertically, surfacing the
// Soak bay and the Dispatch strip alongside the existing suite cards.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { DashboardRoom } from "../DashboardRoom"

let mockSnapshot: { ts: number; v32: unknown; dispatch: { unread: number; entries: unknown[] } | null } = {
  ts: Date.now(), v32: null, dispatch: { unread: 1, entries: [{ id: "d1", kind: "decision", severity: "info", title: "Soak milestone", ts: 100, read: false }] }
}

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ snapshot: mockSnapshot, live: null, connected: true, error: null })
}))
vi.mock("@/lib/trading", async (orig) => {
  const real = await orig()
  return { ...real, getTradingStatus: vi.fn(async () => ({ paper: { cash: 100, balance: 100, equity: 100, riskPerTradePct: 2 }, riskPerTradePct: 2 })) }
})
vi.mock("@/lib/liveTrading", async (orig) => {
  const real = await orig()
  return { ...real, getTradingDecisions: vi.fn(async () => ({ ts: Date.now(), status: "connected", mode: "paper", account: null, viewed: null, decisions: [] })) }
})

describe("DashboardRoom — Command Deck spine", () => {
  beforeEach(() => { mockSnapshot = { ts: Date.now(), v32: null, dispatch: { unread: 1, entries: [{ id: "d1", kind: "decision", severity: "info", title: "Soak milestone", ts: 100, read: false }] } } })
  afterEach(() => { vi.clearAllMocks() })

  it("stacks the Watch → Decide → Dispatch → Act spine and shows the Soak bay", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => { root.render(<MemoryRouter><DashboardRoom /></MemoryRouter>) })
    const text = host.textContent ?? ""
    expect(text).toContain("Watch")
    expect(text).toContain("Decide")
    expect(text).toContain("Dispatch")
    expect(text).toContain("Act")
    // Soak bay + dispatch strip present (honest empty v32 state renders the vault note)
    expect(text).toContain("awaiting live buffers")
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run src/pages/ministry/__tests__/DashboardRoom.commandDeck.test.tsx --maxWorkers=3`
Expected: FAIL — the rebuilt DashboardRoom does not exist yet.

- [ ] **Step 6: Rebuild `DashboardRoom.tsx` as the Command Deck**

Replace the body of `apps/dashboard/src/pages/ministry/DashboardRoom.tsx` (keep imports of the existing suite cards, add SoakBay + DispatchStrip):

```tsx
import { useEffect, useRef, useState } from "react"
import { StatusCards, TradePlannerCard, NewsCard, SignalNotificationsCard } from "@/components/TradingSuite"
import { LiveDecisionsPanel } from "@/components/LiveDecisionsPanel"
import { SoakBay } from "@/components/SoakBay"
import { DispatchStrip } from "@/components/DispatchStrip"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { getTradingStatus } from "@/lib/trading"
import type { PaperOverview } from "@/lib/trading"

export function DashboardRoom() {
  const [status, setStatus] = useState<{ paper: PaperOverview; riskPerTradePct: number } | null>(null)
  const lastLoadAt = useRef(0)
  const { snapshot } = useRealtimeSuite()

  useEffect(() => {
    let alive = true
    getTradingStatus().then((s) => {
      if (alive) setStatus(s)
      lastLoadAt.current = Date.now()
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!snapshot || snapshot.ts < lastLoadAt.current) return
    if (snapshot.trading) setStatus(snapshot.trading)
  }, [snapshot])

  return (
    <div className="stack">
      <header data-room="dashboard">
        <h2>Command Deck</h2>
        <p className="muted small">The copilot loop, end to end: watch → decide → dispatch → act. Every band below is honest to its data — stale is never passed off as live.</p>
      </header>

      <section className="stack" data-band="watch" aria-label="Watch">
        <h4 className="small muted">1 · Watch</h4>
        <StatusCards
          paper={status?.paper ?? null}
          riskPct={status?.riskPerTradePct ?? 2}
          demo={snapshot?.demo ?? null}
          liveAccount={snapshot?.live?.account ?? null}
        />
      </section>

      <section className="stack" data-band="decide" aria-label="Decide">
        <h4 className="small muted">2 · Decide</h4>
        <SoakBay />
        <LiveDecisionsPanel />
        <NewsCard />
      </section>

      <section className="stack" data-band="dispatch" aria-label="Dispatch">
        <h4 className="small muted">3 · Dispatch</h4>
        <DispatchStrip />
      </section>

      <section className="stack" data-band="act" aria-label="Act">
        <h4 className="small muted">4 · Act</h4>
        <TradePlannerCard />
        <SignalNotificationsCard />
      </section>
    </div>
  )
}
```

- [ ] **Step 7: Run the new tests + the pre-existing dashboard-adjacent tests**

Run (from `apps/dashboard`):
`npx vitest run src/pages/ministry/__tests__/DashboardRoom.commandDeck.test.tsx src/components/__tests__/DispatchStrip.test.tsx src/components/__tests__/TradingSuite.deeplink.test.tsx --maxWorkers=3`
Then from repo root: `npm run typecheck`
Expected: PASS. If `TradingSuite.deeplink.test.tsx` fails here, it is the known order-coupled flake — re-run it alone; do not "fix" it.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/DispatchStrip.tsx apps/dashboard/src/components/__tests__/DispatchStrip.test.tsx apps/dashboard/src/pages/ministry/DashboardRoom.tsx apps/dashboard/src/pages/ministry/__tests__/DashboardRoom.commandDeck.test.tsx
git commit -m "feat(copilot): command deck spine on the trading dashboard"
```

---

### Task 7: Closure — full floor, typecheck, docs ledger

**Files:**
- Modify: this plan's `Status:` header → COMPLETE + commit range.
- Modify: `docs/specs/PICC_COPILOT_REDESIGN_v1.md` — no edits needed (spec unchanged; the additive section now exists).

**Interfaces:** none — closure only.

- [ ] **Step 1: Full floor + typecheck**

From repo root: `npm run typecheck; if ($?) { cd apps/dashboard; npx vitest run --maxWorkers=3 }`
Expected: green floor (previous floor was 239 files / 2557 tests; C2 adds suites + component tests, so the count grows; the LEGACY count must not shrink).

- [ ] **Step 2: Verify the byte-identity + additive floors specifically**

Run (from `apps/dashboard`):
`npx vitest run server/__tests__/adaptiveConfluence.v32.test.mjs server/__tests__/v32Register.test.mjs server/__tests__/realtimeSuite.test.mjs --maxWorkers=3`
Expected: PASS — no legacy payload bytes drifted while the lane is OFF.

- [ ] **Step 3: Record the deviations learned during C2**

In this plan's Status line, add:

```
**Plan deviations (recorded at closure):** (1) `@testing-library/react` is NOT
installed — C1's T7 frontend snippets were aspirational; C2 component tests use
`createRoot` + `flushSync` + manual queries per `MinistryRoom.studio.test.tsx`.
(2) Design ch.2 line 32 "richer status.v32" is delivered as a NEW additive
`v32` suite section (soak-bay digits), NOT a mutation of the live payload's
`status.v32` — the payload stays OFF-byte-identical (ADR-0005). (3) The register
endpoint (C1) returns `soak.resolved` = supplied ledger ROW count; the soak
bay's "decisions resolved/total" uses `flipGate.candidateTrades` vs target 100,
because rows are per engine|expiry aggregates, not decision counts.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-20-c2-command-deck.md
git commit -m "docs(copilot): C2 command deck closure"
```

---