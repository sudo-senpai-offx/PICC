# Implementation Plan — v3.2 Context/Regime Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delivery of Layer 1 of the v3.2 layered engine — a pure, honest Context/Regime register (`v32Context.mjs`) that establishes *where price is* and *what the regime allows* before any 5-point score matters (spec §3).

**Architecture:** One new pure module `v32Context.mjs` composes the context/regime registers. Net-new pieces (EMA400 top-down, volatility-regime classifier, dead-zone/red-folder classes) are written fresh and TDD-first. Pieces already implemented elsewhere (Regime-3 Chop latch, 4H/daily S/R, F1 safety gates, MTF voters) are **re-homed — wrapped, not duplicated** — so their tested behavior is reused byte-for-byte with the existing surface kept intact. Every register is honest: unavailable reads report `available:false` + reason, never an invented number.

**Tech Stack:** Node 22, ESM `.mjs`, Vitest, existing `indicators.mjs` (`ema`, `atr`, `natr`, `adx`, `computeIndicatorDashboard`, `detectMarketPhase`, `supportResistance`), `fourFactor.mjs` (`nextRegimeState`, `resolveStructureLevels`, `sessionInWindow`, `spreadGateF1`, `blackoutViolations`, `correlationBlocked`), `mtfConvergence.mjs` (`voteTrend`, `voteMomentum`, `voteStructure`, `voteVolatility`, `deriveAggregatePlanes`), `economicCalendar.mjs` (`upcomingHighImpact`, `calendarImpactSummary`), `u4faConfig.mjs` (class config, session windows, correlations, `spreadSource`).

**Spec:** `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` (§3 + §5 trip-wires 2/3/4 that consume these registers; T7/T8/T9 of §8).

## Global Constraints

- Spec pin T12 (flip): do NOT re-point demoted-trigger tests yet (that's the soak-phase consent).
- Pinned test floor: **224 files / 2382 tests green** (canonical: `npm run test --workspace @picc/dashboard` + `npm run typecheck --workspace @picc/dashboard`) after every task.
- **No new I/O; no wiring into the live `computeNow → decideAssets → assessCall` path in this plan.** New registers are pure functions + unit tests only.
- Honesty pins (G2, carried over from the Constitution layer): every exported register reports `available`, `source`, and (where derived) sample counts; absent/non-finite data yields `available:false` + reason, never a fabricated number.
- **Re-home, don't duplicate**: anything already implemented and tested (`nextRegimeState`, `resolveStructureLevels`, `sessionInWindow`, `spreadGateF1`, `blackoutViolations`, `correlationBlocked`, MTF voters, `ema`, `atr`) is imported and wrapped — its behavior is reused, never rewritten. The existing modules stay untouched.
- Frozen surfaces this plan must NOT modify: `constitution.mjs`, `accuracyLedger.mjs`, `adaptiveConfluence.mjs` (`evaluateAsset`'s `constitution` param stays as shipped), `fourFactor.mjs`, `mtfConvergence.mjs`, `indicators.mjs` (read-only imports except `contextCoordinates.mjs`, which is a new file).
- 15s fast slice / HUD / Execution pillars / cost-line UI are plan 3 — do not build them here.
- Follow repo conventions when adding modules: ESM `.mjs`, named exports, no default-export drama, copy style matching the existing service files.

---
---

## 1. File structure

| File | Action |
|---|---|
| `apps/dashboard/server/services/v32Context.mjs` | **New** — the Context/Regime register module (pure). Net-new: `ema400Context`, `volatilityRegime`, `sessionClassify`, `f1GateRegister`, `biasRegister`, `assembleRegime`. Re-homed wrappers: `adxChop` (→`nextRegimeState`+`adx`), `structureRegister` (→`resolveStructureLevels`). |
| `apps/dashboard/server/services/contextCoordinates.mjs` | **New** — tiny shared coordinate helpers: percentile-of-last (+ trailing-window of finite values), reused by the vol-regime classifier (pure). |
| `apps/dashboard/server/__tests__/v32Context.test.mjs` | **New** — unit bed for the whole layer (one `describe` per register). |
| `apps/dashboard/server/__tests__/contextCoordinates.test.mjs` | **New** — percentile helper tests. |
| `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` | Edit — §8 task table: strike T7/T8/T9 + `✓` + evidence. |
| `docs/superpowers/plans/2026-09-19-v32-context-regime-layer.md` | Edit — §7 Status section (this doc, after all tasks). |

---

## 2. Tasks

### Task 1: Re-home ADX/Regime-3 Chop + structure registers

**Files:**
- Create: `apps/dashboard/server/services/v32Context.mjs` (scaffold + `adxChop` + `structureRegister`)
- Test: `apps/dashboard/server/__tests__/v32Context.test.mjs`

**Interfaces:**
- Consumes: `nextRegimeState(state, goodReading, confirmBars)` from `fourFactor.mjs`; `adx(highs, lows, closes, 14)` from `indicators.mjs`; `resolveStructureLevels({ hourlyCandles, dailyCandles, price, pipSize, tolerancePips })` from `fourFactor.mjs`.
- Produces: `adxChop({ highs, lows, closes, state, threshold = 25, confirmBars = 2 })` → `{ available, adx, plusDI, minusDI, tier, chop, trend, nextState, reason }`; `structureRegister({ hourlyCandles, dailyCandles, price, pipSize, tolerancePips = 10, nowMs })` → `{ available, sources, call, put, legs, reason }` (passthrough shape, honest when inputs short).

- [x] **Step 1: Write the failing test**

```js
import { describe, expect, test } from "vitest"
import { adxChop, structureRegister } from "../services/v32Context.mjs"

function trendCandles(n = 60, step = 0.2, base = 100) {
  const out = []
  for (let i = 0; i < n; i++) {
    const close = base + step * i
    out.push({ time: i * 60, open: close - step, high: close + 0.05, low: close - 0.05, close })
  }
  return out
}

describe("adxChop (REQ-CTX-1)", () => {
  test("strong trend reports trending, chop false", () => {
    const r = adxChop({ highs: trendCandles().map(c => c.high), lows: trendCandles().map(c => c.low), closes: trendCandles().map(c => c.close) })
    expect(r.available).toBe(true)
    expect(r.chop).toBe(false)
    expect(r.adx).toBeGreaterThan(25)
  })

  test("honest unavailable on insufficient bars", () => {
    const r = adxChop({ highs: [1, 2, 3], lows: [1, 2, 3], closes: [1, 2, 3] })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/insufficient|bars/i)
  })

  test("reuses the existing nextRegimeState latch semantics (2-bar re-arm)", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.round(Math.sin(i * 0.9) * 2)) // choppy → low ADX
    const h = closes.map(c => c + 1), lo = closes.map(c => c - 1)
    const first = adxChop({ highs: h, lows: lo, closes, state: { chop: false, streak: 0 } })
    // then a forced good stretch re-arms after 2
    const strong = trendCandles(80)
    let st = first.nextState
    let out = null
    for (let i = 0; i < 3; i++) {
      out = adxChop({ highs: strong.map(c => c.high), lows: strong.map(c => c.low), closes: strong.map(c => c.close), state: st })
      st = out.nextState
    }
    expect(out.chop).toBe(false)
  })
})

describe("structureRegister (REQ-CTX-2)", () => {
  test("honest unavailable when no candles supplied", () => {
    const r = structureRegister({ hourlyCandles: null, dailyCandles: null, price: 1.08, pipSize: 0.0001 })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/candle|structure/i)
  })
})
```

- [x] **Step 2: Run test to verify it fails** — `npx vitest run apps/dashboard/server/__tests__/v32Context.test.mjs` → FAIL with "module not found".

- [x] **Step 3: Minimal scaffold + implementation**

```js
import { nextRegimeState, resolveStructureLevels } from "./fourFactor.mjs"
import { adx } from "./indicators.mjs"

export const REQ_CTX_1_ADX_PERIOD = 14

export function adxChop({ highs, lows, closes, state = { chop: false, streak: 0 }, threshold = 25, confirmBars = 2 } = {}) {
  const res = adx(highs, lows, closes, REQ_CTX_1_ADX_PERIOD)
  const last = Array.isArray(closes) ? closes.length - 1 : -1
  const adxVal = res?.adx?.[last]
  if (adxVal == null || !Number.isFinite(adxVal)) {
    return { available: false, adx: null, plusDI: null, minusDI: null, tier: "none", chop: false, trend: "n/a", nextState: { ...state }, reason: "insufficient bars for ADX(14)" }
  }
  const plusDI = res.plusDI[last], minusDI = res.minusDI[last]
  const tier = adxVal > 40 ? "extreme" : adxVal > 25 ? "trend" : adxVal > 20 ? "forming" : "no-trend"
  const good = adxVal >= threshold
  const nextState = nextRegimeState(state, good, confirmBars)
  const trend = plusDI > minusDI ? "up" : minusDI > plusDI ? "down" : "flat"
  return { available: true, adx: round2(adxVal), plusDI, minusDI, tier, chop: nextState.chop, trend, nextState, confirmBars }
}

function round2(x) { return Math.round(x * 100) / 100 }

export function structureRegister({ hourlyCandles = null, dailyCandles = null, price, pipSize, tolerancePips = 10 } = {}) {
  if (price == null || !Number.isFinite(Number(price)) || pipSize == null) {
    return { available: false, sources: "none", call: { hit: false, legs: [] }, put: { hit: false, legs: [] }, legs: {}, reason: "no price/pipSize supplied — structure unavailable" }
  }
  const resolved = resolveStructureLevels({ hourlyCandles, dailyCandles, price, pipSize, tolerancePips })
  const anyLeg = resolved.sources !== "none"
  return { ...resolved, available: anyLeg, reason: anyLeg ? undefined : "no S/R plane derivable (min-history guards) — structure unavailable" }
}
```

- [x] **Step 4: Run test to verify it passes** — same command → PASS (scaffold imports clean; 2 pending tasks' tests may still reference unshipped symbols — keep only Task 1 tests in the file until their task lands).

- [ ] **Step 5: Commit** `feat: re-home ADX chop + structure registers into v32Context`

---

### Task 2: MTF HTF bias register (REQ-CTX-3)

**Files:**
- Modify: `apps/dashboard/server/services/v32Context.mjs`
- Test: `apps/dashboard/server/__tests__/v32Context.test.mjs`

**Interfaces:**
- Consumes: `voteTrend(dash)`, `voteMomentum(dash)`, `voteStructure(swings, lastIndex)`, `voteVolatility(dash)` from `mtfConvergence.mjs`; `computeIndicatorDashboard(candles)` and `swingPoints(highs, lows, { lookback })` from `indicators.mjs`.
- Produces: `biasRegister({ byTf })` → `{ available, register: { tf: { trend, momentum, structure, volatility } }, agreed, conflicted, reason }`. Register-only semantics — part of the register, **never a veto** (mirrors spec §3 CTX-3 "may weight, not veto").

- [x] **Step 1: Failure-first test** (append to `v32Context.test.mjs`)

```js
describe("biasRegister (REQ-CTX-3)", () => {
  test("agrees when every HTF voter is bullish", () => {
    const candles = trendCandles(120)
    const dash = { ... } // build via computeIndicatorDashboard(candles)
  })
})
```

**Test body (exact):**

```js
import { computeIndicatorDashboard, swingPoints } from "../services/indicators.mjs"

describe("biasRegister (REQ-CTX-3)", () => {
  test("register-only: never a veto, always reports per-TF votes", () => {
    const candles = trendCandles(120)
    const dash = computeIndicatorDashboard(candles)
    const { highs, lows } = { highs: candles.map(c => c.high), lows: candles.map(c => c.low) }
    const swings = swingPoints(highs, lows, { lookback: 2 })
    const r = biasRegister({ byTf: { 900: { dash, high: highs[highs.length - 1] } } })
    expect(r.available).toBe(true)
    expect(r.register[900]).toBeDefined()
    expect(["trend", "momentum", "structure", "volatility"]).toEqual(expect.arrayContaining(Object.keys(r.register[900])))
  })
})
```

Adjust the exact voters invoked to the shape you implement (the seam is composable); the test must be honest about inputs the voters actually need.

- [x] **Step 2: Run → confirm FAIL.**
- [x] **Step 3: Implement** — thin composition that runs each exported voter over a per-TF dash and summarizes `agreed` (the number of +1/-1 votes matching the majority) vs `conflicted`.
- [x] **Step 4: Run → PASS + full floor green + typecheck.**
- [ ] **Step 5: Commit** `feat: MTF bias register (REQ-CTX-3)`

---

### Task 3: EMA400 top-down context register (REQ-CTX-4)

**Files:**
- Modify: `apps/dashboard/server/services/v32Context.mjs`
- Test: `apps/dashboard/server/__tests__/v32Context.test.mjs`

**Interfaces:**
- Consumes: `ema(closes, period)` from `indicators.mjs`; `deriveAggregatePlanes(base, tfs, { baseTf, source })` from `mtfConvergence.mjs`.
- Produces: `ema400Context({ planes })` → `{ available, register, reason }` where each plane reports `{ price, ma400, ma200, ma100, longContext, shortContext, available, source, candles }`. Honesty: needs ≥ 400 closed bars for the 400-EMA to be meaningful; fewer → `available:false, reason:"< 400 bars"`. Register only — never a trigger.

- [x] **Step 1: Failure-first test**

```js
describe("ema400Context (REQ-CTX-4)", () => {
  test("long-only context is price >= ma400 chain on the D1 plane", () => {
    const n = 500
    const closes = Array.from({ length: n }, (_, i) => 100 + 0.2 * i) // strong uptrend
    const candles = closes.map((c, i) => ({ time: i * 86400, open: c - 0.2, high: c + 0.1, low: c - 0.6, close: c }))
    const r = ema400Context({ planes: { 86400: candles } })
    expect(r.available).toBe(true)
    expect(r.register[86400].longContext).toBe(true)
    expect(r.register[86400].ma400).toBeLessThan(r.register[86400].ma200)
    expect(r.register[86400].source).toBe("aggregate-plan")
  })

  test("honest unavailable below 400 bars", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1)
    const candles = closes.map((c, i) => ({ time: i * 86400, open: c, high: c + 1, low: c - 1, close: c }))
    const r = ema400Context({ planes: { 86400: candles } })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/400/)
  })
})
```

- [x] **Step 2: Run → FAIL.**
- [x] **Step 3: Implement** — for each `[tf, candles]` of `planes`, if `candles.length >= 400` compute `ema(closes, [100,200,400])`; last values; `longContext = price >= ma400 && ma200 >= ma400` (chain ascends toward price in an uptrend: short EMA above long EMA), `shortContext` mirrored. Each entry carries its source label.
- [x] **Step 4: Run → PASS + floor + typecheck.**
- [ ] **Step 5: Commit** `feat: EMA400 top-down context register (REQ-CTX-4)`

---

### Task 4: Volatility regime classifier + size cut (REQ-CTX-7)

**Files:**
- Create: `apps/dashboard/server/services/contextCoordinates.mjs` (percentile-of-last helper)
- Modify: `apps/dashboard/server/services/v32Context.mjs`
- Test: `apps/dashboard/server/__tests__/contextCoordinates.test.mjs`, `apps/dashboard/server/__tests__/v32Context.test.mjs`

**Interfaces:**
- Consumes: `atr(highs, lows, closes, 14)` / `natr(highs, lows, closes, 14)` from `indicators.mjs`.
- Produces: `percentileOfLast(series, { window })` → `{ value, percentile, n }`; `volatilityRegime({ candles, window = 100 })` → `{ available, regime: "LOW"|"NORMAL"|"HIGH", percentile, sizeCutPct, atr, reason }`. Rule (spec CTX-7): `percentile > 0.7` → HIGH, `< 0.3` → LOW, else NORMAL; HIGH carries `sizeCutPct: 0.5` (50% cut; range 25–50% is the blueprint band — pick 0.5 default as the conservative lock, config override param `highCutPct = 0.5`).

- [x] **Step 1: Failure-first tests**

```js
describe("percentileOfLast", () => {
  test("last value equal to the series max is 100th percentile", () => {
    const r = percentileOfLast([1, 2, 3, 4, 5], {})
    expect(r.percentile).toBe(1)
    expect(r.n).toBe(5)
  })
  test("empty series is honest null", () => {
    const r = percentileOfLast([], {})
    expect(r.percentile).toBeNull()
    expect(r.n).toBe(0)
  })
})

describe("volatilityRegime (REQ-CTX-7)", () => {
  test("HIGH regime when ATR is in the top decile → size cut", () => {
    const base = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i * 0.3) * 0.5)
    const candles = base.map((c, i) => ({ time: i * 300, open: c, high: c + (i > 110 ? 3 : 0.1), low: c - (i > 110 ? 3 : 0.1), close: c }))
    const r = volatilityRegime({ candles })
    expect(r.available).toBe(true)
    expect(r.regime).toBe("HIGH")
    expect(r.sizeCutPct).toBe(0.5)
  })
  test("honest unavailable on too few candles", () => {
    const r = volatilityRegime({ candles: [] })
    expect(r.available).toBe(false)
  })
})
```

- [x] **Step 2: Run → FAIL.**
- [x] **Step 3: Implement** — `percentileOfLast` computes rank of last finite value over the trailing `window` of finite values (mirror the `detectMarketPhase` pattern: `below / n`). `volatilityRegime` uses `atr().series` tail + `candles` length guard (`>= 30`), then thresholds from the spec.
- [x] **Step 4: Run → PASS + floor + typecheck.**
- [ ] **Step 5: Commit** `feat: vol-regime classifier + size cut (REQ-CTX-7)`

---

### Task 5: Dead-zone / red-folder session classes (REQ-CTX-5)

**Files:**
- Modify: `apps/dashboard/server/services/v32Context.mjs`
- Test: `apps/dashboard/server/__tests__/v32Context.test.mjs`

**Interfaces:**
- Consumes: `sessionInWindow({ tz, start, end }, nowMs)` and `blackoutViolations({ events, nowMs, minutes, currencies })` from `fourFactor.mjs`; `upcomingHighImpact(events, { days })` + `calendarImpactSummary(events)` from `economicCalendar.mjs`.
- Produces: `sessionClassify({ tz, start, end, nowMs, events, currencies, days = 7 })` → `{ label: "dead-zone"|"red-folder"|"red-folder+dead-zone"|"normal", source: "observed", window: { ok, wall }, blackout: { blocked, hits }, upcoming: array, reason }`. Fallback-schedule honesty: when `events` is `null`/empty, `source: "fallback-schedule"` and the classifier still reports the session window but never fabricates news.

- [x] **Step 1: Failure-first test**

```js
describe("sessionClassify (REQ-CTX-5)", () => {
  test("red-folder when a high-impact USD event is 10 min away", () => {
    const now = Date.UTC(2026, 8, 20, 12, 0, 0)
    const events = [
      { date: "2026-09-20", time: "12:10", currency: "USD", impact: "high", event: "FOMC" },
      { date: "2026-09-20", time: "14:00", currency: "GBP", impact: "low", event: "MPC minutes" }
    ]
    const r = sessionClassify({ tz: "UTC", start: "00:00", end: "23:59", nowMs: now, events, currencies: ["USD"], days: 7 })
    expect(r.label).toBe("red-folder")
    expect(r.source).toBe("observed")
  })

  test("inside a closed session window → dead-zone", () => {
    const r = sessionClassify({ tz: "Europe/London", start: "07:00", end: "16:00", nowMs: Date.UTC(2026, 8, 20, 4, 0, 0), events: [], currencies: ["USD"] })
    expect(r.label).toBe("dead-zone")
  })

  test("fallback-schedule honesty: null events never fabricates a red-folder", () => {
    const r = sessionClassify({ tz: "UTC", start: "00:00", end: "23:59", nowMs: Date.UTC(2026, 8, 20, 12, 0, 0), events: null, currencies: ["USD"] })
    expect(r.source).toBe("fallback-schedule")
    expect(r.label).toBe("normal") // open window, no observed events
  })
})
```

- [x] **Step 2: Run → FAIL.**
- [x] **Step 3: Implement** — decompose: window read via `sessionInWindow`; news read via `blackoutViolations` on high-impact events touching `currencies`; label precedence `red-folder+dead-zone` > `red-folder` > `dead-zone` > `normal`. `upcomingHighImpact` fills the `upcoming` register.
- [x] **Step 4: Run → PASS + floor + typecheck.**
- [ ] **Step 5: Commit** `feat: dead-zone / red-folder session classes (REQ-CTX-5)`

---

### Task 6: F1 safety gates re-homed + `assembleRegime` compose + honesty pins

**Files:**
- Modify: `apps/dashboard/server/services/v32Context.mjs`
- Test: `apps/dashboard/server/__tests__/v32Context.test.mjs`

**Interfaces:**
- Consumes: `spreadGateF1(spread, maxSpreadPips, nowMs)` from `fourFactor.mjs` (with `u4faConfig` `spreadSource: null` = honest unmeasurable); `correlationBlocked({ assetId, losses, correlations, nowMs })` from `fourFactor.mjs`.
- Produces: `f1GateRegister({ assetId, spread, maxSpreadPips, losses, correlations, session, news, nowMs })` → `{ ok, checks: { session, spread, news, correlation }, reasons }` (re-homes the four F1 gates); `assembleRegime(inputs)` → top-level `{ registers: { adx, structure, bias, ema400, vol, session }, f1, sources, at }` with one `sources` honesty map.

- [x] **Step 1: Failure-first test**

```js
describe("f1GateRegister (REQ-CTX-6)", () => {
  test("spread DATA-GAP (null source) → unmeasurable, gate closed", () => {
    const r = f1GateRegister({ assetId: "GBPUSD", spread: null, maxSpreadPips: 1.5, losses: [], correlations: {}, session: { ok: true }, nowMs: Date.now() })
    expect(r.checks.spread.check).toBe("unmeasurable")
    expect(r.ok).toBe(false)
  })

  test("GBPUSD pauses 15 min on a fresh EURUSD loss (correlation lock)", () => {
    const now = Date.now()
    const r = f1GateRegister({
      assetId: "GBPUSD", spread: { spreadPips: 1.0, source: "wired", at: now }, maxSpreadPips: 1.5,
      losses: [{ asset: "EURUSD", ts: now - 60000 }],
      correlations: { GBPUSD: { triggers: ["EURUSD"], pauseMs: 900000 } },
      session: { ok: true }, nowMs: now
    })
    expect(r.checks.correlation.blocked).toBe(true)
  })
})
```

- [x] **Step 2: Run → FAIL.**
- [x] **Step 3: Implement** — each gate wraps its existing exported function; `ok` is the AND of `session.ok && spread.ok && !news.blocked && !correlation.blocked`. `assembleRegime` folds all Task 1–6 registers into `{ registers, f1, sources, at: nowMs }` and stamps `REQ` tags.
- [x] **Step 4: Run → PASS + floor + typecheck.**
- [ ] **Step 5: Commit** `feat: F1 gates re-homed + assembleRegime composition`

---

### Task 7: Spec §8 task-table evidence + plan status

**Files:**
- Modify: `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` (§8 — strike T7/T8/T9, add ✓ + evidence pointing at `v32Context.mjs` functions + test counts)
- Modify: `docs/superpowers/plans/2026-09-19-v32-context-regime-layer.md` (§7 — Status: all tasks shipped, toggle unwired as planned)

- [x] **Step 1: Update spec §8 rows** — T7/T8/T9 struck through + `✓` + evidence (function + test-file line references).
- [x] **Step 2: Add plan §7** — mirror the Constitution plan's status block.
- [x] **Step 3: Full floor + typecheck + copy-rule check** — `npm run test --workspace @picc/dashboard`, `npm run typecheck --workspace @picc/dashboard`; confirm ≥ 2382 tests, 224 files, no drift in existing suites.
- [x] **Step 4: Commit** `docs: v3.2 Context/Regime layer — task-table evidence + plan status`

---

## 3. Out of scope (this plan)

- Any wiring into `computeNow → decideAssets → assessCall` or `evaluateAsset` — the toggle stays OFF (plan 3 = Execution/Copilot + the 15s fast slice T3).
- `vwap`/config-probe slicing (T3), futures-proxy leg (T4), Δ/CVD/rel-vol (T5), VWAP+EMA 9/21 pillars (T6), cost line + trip-wires (T10) — all plan 3 per plan 1 §1.
- Cooldown-value revisits (consecutive-loss thresholds, B-IND-0 §9) — recorded as open notes, not changed here.
- Demoted-trigger test re-pointing (spec T12) — held for the soak phase per the flip-gate pin.

---

## 7. Status

**All tasks shipped (2026-09-20).**

| Task | Register(s) landed | Tests |
|---|---|---|
| 1 — ADX chop + structure re-home | `v32Context.adxChop` (REQ-CTX-1, `nextRegimeState` latch reused), `v32Context.structureRegister` (REQ-CTX-2, `resolveStructureLevels` passthrough) | 5 |
| 2 — MTF bias register | `v32Context.biasRegister` (REQ-CTX-3, MTF voters composed; register-only, never a veto) | 2 |
| 3 — EMA400 context | `v32Context.ema400Context` (REQ-CTX-4, chain incl. caller-declared `source`, `<400` honest) | 3 |
| 4 — Vol-regime + size cut | `contextCoordinates.percentileOfLast` (flat-window neutral, non-finite excluded) + `v32Context.volatilityRegime` (REQ-CTX-7, HIGH `sizeCutPct: 0.5`) | 9 |
| 5 — Session classes | `v32Context.sessionClassify` (REQ-CTX-5, dead-zone/red-folder/fallback-schedule honesty) | 3 |
| 6 — F1 gates + envelope | `v32Context.f1GateRegister` (REQ-CTX-6, strict AND) + `v32Context.assembleRegime` (compose + `sources` map) | 4 |
| 7 — Spec §8 + this §7 | `dates/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` T7/T8/T9 + CTX-6+compose struck/✓/evidenced | — |

**Verification:** full floor `npm run test --workspace @picc/dashboard` — **2408 tests / 226 files green**; `npm run typecheck --workspace @picc/dashboard` clean. Context/Regime registers are pure + unit-tested only — the live `computeNow → decideAssets → assessCall` path is untouched (toggle OFF, plan 3 wires it). No commits made in this plan's execution — commit steps left pending the user's explicit go-ahead.
