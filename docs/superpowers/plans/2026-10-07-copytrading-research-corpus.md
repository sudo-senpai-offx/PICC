# Copytrading Research Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the copytrading research corpus as a read-only, regime-stratified external behaviour dataset that validates the owner's own strategy and never describes, ranks, or replicates other participants.

**Architecture:** New `copyCorpus` service mirrors the proven `tradeJournal`/`dispatch` pattern (module store + `PICC_COPYCORPUS_DATA_DIR` JSON persistence + `_resetForTest`), but with a structurally separate store from all owner data, `origin` set at write and never inferred at read, and read-only after ingest. A thin Hyperliquid public-history ingest adapter feeds it (keyless, no credentials). Pure compute modules produce cohort survival curves (§5.1), state-conditioned behaviour stats (§5.2), and regime-stratified aggregates (§5.3), every value carrying the §5.4 bias header. Retention is a regime-bounded pruner, not a TTL.

**Tech Stack:** Node 22 ESM (`apps/dashboard/server/services/*.mjs`), Vitest 5.0.3, existing `regimeEngine.mjs` (pure, reused as-is), JSON file persistence.

**Spec:** `docs/superpowers/specs/2026-10-07-copytrading-research-corpus-design.md` — §2 prohibitions, §3 sources, §4 bias handling, §5 outputs, §6 separation, §7 sampling, §8 decisions (validate-own / regime-coverage ingest / regime-bounded retention), §9 non-goals.

## Global Constraints

- Honest absence is a hard contract: every failure path yields a NAMED reason, never a silent zero or fabricated default.
- Additive-only API changes (ADR-0005): new endpoints + additive keys only; existing payload bytes never change.
- Hermetic tests: suite inherits real `apps/dashboard/.env`; `testSupport/vitestStoreIsolation.setup.mjs` strips `PICC_*`/`VAPID_*`/`TELEGRAM_*`/`NEWSAPI_*`/`SERPER_*`/`WEBHOOK_URL` at setup-file scope (server modules capture env at IMPORT time, so `beforeEach` loses the race). New tests must dynamic-import the module under test and redirect via `PICC_COPYCORPUS_DATA_DIR` (the `tradeJournal`/`dispatch` pattern), with `_resetForTest()`.
- Boot invariants (`bootSequence.mjs`, do not reorder): `loadBrokers()` before anything calling `getBestCandles()`; `startLivenessMonitor()` before `startScheduler()`; corpus ingest must attach via `afterBrokers` or a scheduler job, never reorder boot.
- NEVER add a second ceremony route; never set `PICC_CEREMONY_GATE1_MIN_RESOLVES` / `PICC_CEREMONY_SCALE_MIN_RESOLVES`; `PICC_CCXT_SANDBOX_HYPERLIQUID=1` stays; `PICC_*_DATA_DIR` are test-isolation redirects, unset in normal operation.
- One tracked lockfile (root `package-lock.json`); probe scripts go in `apps/dashboard/testSupport/*.tmp.mjs` and are deleted after use; never print `.env` values (echo names only).
- No leaderboard, no per-participant P&L display, no copy/follow framing, no private-data scraping (§2–§3.2). No real-time signals/alerts from others' activity (§9).

---

### Task 1: External corpus store (separation boundary)

**Files:**
- Create: `apps/dashboard/server/services/copyCorpusStore.mjs`
- Test: `apps/dashboard/server/__tests__/copyCorpusStore.test.mjs`

**Interfaces:**
- Consumes: `PICC_COPYCORPUS_DATA_DIR` env (default `join(__dirname, "..", "data")`), `copyCorpus.json` persistence (best-effort, swallow on failure — mirror `tradeJournal.mjs:8-24`).
- Produces (later tasks consume these exact names):
  - `appendExternalSample(sample)` → stored record `{ id, origin: "external", venue, accountRef, regime, stateBefore, sizeResponse, outcomeKind, windowStart, windowEnd, ingestedAt }` (id = `ccx_${Date.now()}_${rand}`; `origin` forced to `"external"` even if caller passes something else; throws-nothing — returns `{ ok:false, reason }` on invalid input).
  - `listExternal({ regime, limit = 100, offset = 0 } = {})` → newest-first array (never includes `origin:"owner"` rows — there are none in this file by construction).
  - `corpusCounts()` → `{ nAccountsObserved, nDormant, nLiquidated, windowStart, windowEnd }` (the §5.4 bias-header source; zeros are real counts, not absence).
  - `_resetCopyCorpusForTest()` → clears store + no persistence write.

- [ ] **Step 1: Write the failing test**

`apps/dashboard/server/__tests__/copyCorpusStore.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("copyCorpusStore separation", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-corpus-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/copyCorpusStore.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    mod._resetCopyCorpusForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("forces origin external even when caller passes owner", () => {
    const r = mod.appendExternalSample({ venue: "hyperliquid", accountRef: "a1", origin: "owner" })
    expect(r.ok).toBe(true)
    expect(r.record.origin).toBe("external")
  })

  it("rejects identity-selected samples with a named reason", () => {
    const r = mod.appendExternalSample({ venue: "hyperliquid", accountRef: "a1", selectBy: "top-pnl" })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("counts are real numbers for the bias header", () => {
    const c = mod.corpusCounts()
    expect(typeof c.nAccountsObserved).toBe("number")
    expect(typeof c.nDormant).toBe("number")
    expect(typeof c.nLiquidated).toBe("number")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/dashboard/server/__tests__/copyCorpusStore.test.mjs` (workdir: repo root; targeted vitest filters are relative paths from `apps/dashboard` workdir — if the root runner rejects the path, run `npx vitest run server/__tests__/copyCorpusStore.test.mjs` with workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … copyCorpusStore.mjs"

- [ ] **Step 3: Write minimal implementation**

`apps/dashboard/server/services/copyCorpusStore.mjs`:

```js
// Copytrading research corpus store — EXTERNAL samples only (§6).
// Structurally separate file from all owner stores; origin is set at write,
// never inferred at read. Read-only after ingest (no update path by design).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.PICC_COPYCORPUS_DATA_DIR || join(__dirname, "..", "data")
const FILE = join(DATA_DIR, "copyCorpus.json")

let rows = []
function load() {
  try {
    if (existsSync(FILE)) {
      const p = JSON.parse(readFileSync(FILE, "utf-8"))
      rows = Array.isArray(p) ? p.filter((r) => r?.origin === "external") : []
    }
  } catch { rows = [] }
}
function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(rows, null, 2))
  } catch { /* best-effort */ }
}
load()

const BANNED_SELECTORS = new Set(["top-pnl", "leaderboard", "best-trader", "rank"])
export function appendExternalSample(s = {}) {
  if (s?.selectBy && BANNED_SELECTORS.has(String(s.selectBy))) {
    return { ok: false, reason: "identity-selected cohorts are prohibited (§2/§4.2)" }
  }
  if (!s?.venue || !s?.accountRef) {
    return { ok: false, reason: "venue and accountRef are required" }
  }
  const record = {
    id: `ccx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    origin: "external",
    venue: String(s.venue),
    accountRef: String(s.accountRef),
    regime: s.regime != null ? String(s.regime) : null,
    stateBefore: s.stateBefore ?? null,
    sizeResponse: s.sizeResponse ?? null,
    outcomeKind: s.outcomeKind ?? null,
    windowStart: s.windowStart ?? null,
    windowEnd: s.windowEnd ?? null,
    ingestedAt: new Date().toISOString(),
  }
  rows.push(record)
  save()
  return { ok: true, record }
}

export function listExternal({ regime, limit = 100, offset = 0 } = {}) {
  let out = rows.filter((r) => r.origin === "external")
  if (regime) out = out.filter((r) => r.regime === String(regime))
  out = [...out].reverse()
  return out.slice(offset, offset + limit)
}

export function corpusCounts() {
  const accounts = new Set(rows.map((r) => `${r.venue}:${r.accountRef}`))
  return {
    nAccountsObserved: accounts.size,
    nDormant: rows.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: rows.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: rows.reduce((a, r) => (a == null || (r.windowStart && r.windowStart < a) ? r.windowStart : a), null),
    windowEnd: rows.reduce((a, r) => (a == null || (r.windowEnd && r.windowEnd > a) ? r.windowEnd : a), null),
  }
}

export function _resetCopyCorpusForTest() { rows = [] }
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/copyCorpusStore.mjs apps/dashboard/server/__tests__/copyCorpusStore.test.mjs
git commit -m "feat(corpus): external-only store with write-time origin (§6)"
```

### Task 2: Hyperliquid public-history ingest adapter (keyless, read-only)

**Files:**
- Create: `apps/dashboard/server/services/copyCorpusIngest.mjs`
- Test: `apps/dashboard/server/__tests__/copyCorpusIngest.test.mjs`

**Interfaces:**
- Consumes: `copyCorpusStore.appendExternalSample`; global `fetch` (mocked in tests — never hits the network in tests); existing `regimeEngine.mjs` bucketing is NOT done here (Task 3 owns it).
- Produces:
  - `ingestPublicFills({ venue = "hyperliquid", fills, windowStart, windowEnd } = {})` → `{ ok, ingested, skipped, reason }` (pure mapping, no network; liquidations map to `outcomeKind:"liquidated"` as first-class failure data per §4.2; dormant accounts map to `outcomeKind:"dormant"`; anything identity-ranked is refused with a named reason).
  - `ingestStatus()` → `{ lastIngestAt, lastResult, reason }` (honest absence when never run: `{ lastIngestAt: null, reason: "never-ingested" }`).

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("copyCorpusIngest mapping", () => {
  let dir, mod
  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    dir = mkdtempSync(join(tmpdir(), "picc-corpus-ing-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/copyCorpusIngest.mjs")
  })
  afterEach(async () => {
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    const { rmSync } = await import("node:fs")
    rmSync(dir, { recursive: true, force: true })
  })

  it("maps a liquidation fill to outcomeKind liquidated", () => {
    const r = mod.ingestPublicFills({
      venue: "hyperliquid",
      windowStart: "2026-01-01", windowEnd: "2026-02-01",
      fills: [{ account: "0xabc", liquidated: true }],
    })
    expect(r.ingested).toBe(1)
  })

  it("reports honest absence when there is nothing to ingest", () => {
    const r = mod.ingestPublicFills({ venue: "hyperliquid", fills: [] })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("refuses private-broker payloads", () => {
    const r = mod.ingestPublicFills({ venue: "private-broker-export", fills: [{ account: "x" }] })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/dashboard/server/__tests__/copyCorpusIngest.test.mjs`
Expected: FAIL with "Cannot find module … copyCorpusIngest.mjs"

- [ ] **Step 3: Write minimal implementation**

```js
// Public-history ingest — Hyperliquid on-chain history only (§3.1–§3.2).
// Keyless. No credentials read, no private broker data accepted.
import { appendExternalSample } from "./copyCorpusStore.mjs"

let lastIngestAt = null
let lastResult = null

const PRIVATE_VENUES = new Set(["private-broker-export", "social-copy-export"])
export function ingestPublicFills({ venue = "hyperliquid", fills = [], windowStart = null, windowEnd = null } = {}) {
  if (PRIVATE_VENUES.has(String(venue))) {
    return { ok: false, ingested: 0, skipped: fills.length, reason: "private venue histories are prohibited (§3.2)" }
  }
  if (!Array.isArray(fills) || fills.length === 0) {
    return { ok: false, ingested: 0, skipped: 0, reason: "no public fills in window" }
  }
  let ingested = 0, skipped = 0
  for (const f of fills) {
    if (!f?.account) { skipped++; continue }
    const r = appendExternalSample({
      venue, accountRef: String(f.account),
      regime: null,
      stateBefore: f.stateBefore ?? null,
      sizeResponse: f.sizeResponse ?? null,
      outcomeKind: f.liquidated ? "liquidated" : (f.dormant ? "dormant" : "active"),
      windowStart, windowEnd,
    })
    if (r.ok) ingested++; else skipped++
  }
  lastIngestAt = new Date().toISOString()
  lastResult = { ingested, skipped }
  return { ok: true, ingested, skipped, reason: null }
}

export function ingestStatus() {
  if (!lastIngestAt) return { lastIngestAt: null, lastResult: null, reason: "never-ingested" }
  return { lastIngestAt, lastResult, reason: null }
}
export function _resetIngestForTest() { lastIngestAt = null; lastResult = null }
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/copyCorpusIngest.mjs apps/dashboard/server/__tests__/copyCorpusIngest.test.mjs
git commit -m "feat(corpus): keyless public-history ingest, liquidations first-class"
```

### Task 3: Regime-stratified survival curves (§5.1, pure compute)

**Files:**
- Create: `apps/dashboard/server/services/copyCorpusSurvival.mjs`
- Test: `apps/dashboard/server/__tests__/copyCorpusSurvival.test.mjs`

**Interfaces:**
- Consumes: rows shaped like Task 1 records (passed in as an argument — pure, no store import, so tests need no env redirect); existing regime labels (`regimeEngine.mjs` REGIME vocabulary reused verbatim, no new regime math).
- Produces:
  - `survivalByCohort(rows)` → `{ cohorts: [{ cohort, nAccounts, nDormant, nLiquidated, windowStart, windowEnd }], bias }` where `bias` is the §5.4 header; empty input returns `{ cohorts: [], bias: { …, reason: "no-external-samples" } }` — a named absence, never an empty curve passed off as zero survival.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { survivalByCohort } from "../services/copyCorpusSurvival.mjs"

describe("survivalByCohort", () => {
  it("cohorts by account age bucket with dormancy + liquidation counts", () => {
    const out = survivalByCohort([
      { accountRef: "a", venue: "h", cohort: "0-30d", outcomeKind: "active" },
      { accountRef: "b", venue: "h", cohort: "0-30d", outcomeKind: "liquidated" },
      { accountRef: "c", venue: "h", cohort: "0-30d", outcomeKind: "dormant" },
    ])
    expect(out.cohorts[0].nLiquidated).toBe(1)
    expect(out.cohorts[0].nDormant).toBe(1)
    expect(out.bias.nAccountsObserved).toBe(3)
  })
  it("empty input is a named absence", () => {
    const out = survivalByCohort([])
    expect(out.cohorts).toEqual([])
    expect(typeof out.bias.reason).toBe("string")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/dashboard/server/__tests__/copyCorpusSurvival.test.mjs`
Expected: FAIL with "Cannot find module … copyCorpusSurvival.mjs"

- [ ] **Step 3: Write minimal implementation**

```js
// §5.1 cohort survival curves — pure compute, no I/O.
export function survivalByCohort(rows = []) {
  const bias = {
    nAccountsObserved: new Set(rows.map((r) => `${r.venue}:${r.accountRef}`)).size,
    nDormant: rows.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: rows.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: null, windowEnd: null,
    reason: rows.length === 0 ? "no-external-samples" : null,
  }
  if (rows.length === 0) return { cohorts: [], bias }
  const byCohort = new Map()
  for (const r of rows) {
    const k = r.cohort ?? "unknown"
    if (!byCohort.has(k)) byCohort.set(k, [])
    byCohort.get(k).push(r)
  }
  const cohorts = [...byCohort.entries()].map(([cohort, rs]) => ({
    cohort,
    nAccounts: new Set(rs.map((r) => `${r.venue}:${r.accountRef}`)).size,
    nDormant: rs.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: rs.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: null, windowEnd: null,
  }))
  return { cohorts, bias }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/copyCorpusSurvival.mjs apps/dashboard/server/__tests__/copyCorpusSurvival.test.mjs
git commit -m "feat(corpus): cohort survival curves with bias header (§5.1/§5.4)"
```

### Task 4: State-conditioned behaviour stats (§5.2 — the success criterion)

**Files:**
- Create: `apps/dashboard/server/services/copyCorpusBehaviour.mjs`
- Test: `apps/dashboard/server/__tests__/copyCorpusBehaviour.test.mjs`

**Interfaces:**
- Consumes: external rows (argument, pure — same isolation as Task 3); owner history rows (argument, same shape `{ stateBefore, sizeResponse }` from `tradeJournal`/`paper` — passed in, never imported, so this module cannot mix stores by itself per §6).
- Produces:
  - `behaviourGivenState(externalRows, { ownerRows = [] } = {})` → `{ rules: [{ state, n, pIncrease, pCut, ownerComparable }], bias }`; conditions on STATE (`stateBefore` buckets like `drawdown-5pct`, `after-2-losses`), never on identity; `ownerComparable:true` only when the owner's history contains the same state bucket (the §8 decision-1 success test); empty external input → named absence.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { behaviourGivenState } from "../services/copyCorpusBehaviour.mjs"

const ext = [
  { stateBefore: "drawdown-5pct", sizeResponse: "increase" },
  { stateBefore: "drawdown-5pct", sizeResponse: "cut" },
  { stateBefore: "drawdown-5pct", sizeResponse: "cut" },
  { stateBefore: "after-2-losses", sizeResponse: "halved" },
]
describe("behaviourGivenState", () => {
  it("conditions on state and marks owner-comparability", () => {
    const out = behaviourGivenState(ext, { ownerRows: [{ stateBefore: "drawdown-5pct" }] })
    const d = out.rules.find((r) => r.state === "drawdown-5pct")
    expect(d.n).toBe(3)
    expect(d.ownerComparable).toBe(true)
    expect(out.rules.find((r) => r.state === "after-2-losses").ownerComparable).toBe(false)
  })
  it("empty input is a named absence, not a zero", () => {
    const out = behaviourGivenState([])
    expect(out.rules).toEqual([])
    expect(typeof out.bias.reason).toBe("string")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/dashboard/server/__tests__/copyCorpusBehaviour.test.mjs`
Expected: FAIL with "Cannot find module … copyCorpusBehaviour.mjs"

- [ ] **Step 3: Write minimal implementation**

```js
// §5.2 state-conditioned behaviour statistics — pure compute.
// Conditions on STATE, never on identity (§4.2). No per-participant output.
export function behaviourGivenState(externalRows = [], { ownerRows = [] } = {}) {
  const bias = {
    nAccountsObserved: new Set(externalRows.map((r) => `${r.venue}:${r.accountRef}`)).size,
    nDormant: externalRows.filter((r) => r.outcomeKind === "dormant").length,
    nLiquidated: externalRows.filter((r) => r.outcomeKind === "liquidated").length,
    windowStart: null, windowEnd: null,
    reason: externalRows.length === 0 ? "no-external-samples" : null,
  }
  if (externalRows.length === 0) return { rules: [], bias }
  const ownerStates = new Set(ownerRows.map((r) => r.stateBefore))
  const byState = new Map()
  for (const r of externalRows) {
    const k = r.stateBefore ?? "unknown"
    if (!byState.has(k)) byState.set(k, [])
    byState.get(k).push(r)
  }
  const rules = [...byState.entries()].map(([state, rs]) => {
    const n = rs.length
    const nInc = rs.filter((r) => r.sizeResponse === "increase").length
    const nCut = rs.filter((r) => ["cut", "halved"].includes(r.sizeResponse)).length
    return { state, n, pIncrease: n ? nInc / n : null, pCut: n ? nCut / n : null, ownerComparable: ownerStates.has(state) }
  })
  return { rules, bias }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/copyCorpusBehaviour.mjs apps/dashboard/server/__tests__/copyCorpusBehaviour.test.mjs
git commit -m "feat(corpus): state-conditioned behaviour stats, owner-comparable (§5.2)"
```

### Task 5: Regime-bounded retention pruner + read-only enforcement

**Files:**
- Modify: `apps/dashboard/server/services/copyCorpusStore.mjs` (add `pruneToRegimeTargets`)
- Test: `apps/dashboard/server/__tests__/copyCorpusRetention.test.mjs`

**Interfaces:**
- Consumes: `listExternal`-shaped rows; targets `{ [regime]: maxSamples }` (e.g. `{ trend: 3000, chop: 3000 }` — thousands per regime per §7, not millions).
- Produces:
  - `pruneToRegimeTargets(targets)` → `{ ok, kept, dropped, reason }`; keeps newest-first per regime, drops oldest beyond target; no update/mutate path added (read-only-after-ingest preserved — the pruner deletes whole records only, never edits).

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it, vi, beforeEach } from "vitest"
describe("regime-bounded retention", () => {
  let store
  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "picc-corpus-ret-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    vi.resetModules()
    store = await import("../services/copyCorpusStore.mjs")
    delete process.env.PICC_COPYCORPUS_DATA_DIR
  })
  it("keeps newest per regime up to target", () => {
    for (let i = 0; i < 5; i++) store.appendExternalSample({ venue: "h", accountRef: `a${i}`, regime: "trend" })
    const r = store.pruneToRegimeTargets({ trend: 3 })
    expect(r.kept).toBe(3)
    expect(r.dropped).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/dashboard/server/__tests__/copyCorpusRetention.test.mjs`
Expected: FAIL with "pruneToRegimeTargets is not a function"

- [ ] **Step 3: Write minimal implementation**

Append to `apps/dashboard/server/services/copyCorpusStore.mjs`:

```js
export function pruneToRegimeTargets(targets = {}) {
  const before = rows.length
  const byRegime = new Map()
  for (const r of rows) {
    const k = r.regime ?? "unlabelled"
    if (!byRegime.has(k)) byRegime.set(k, [])
    byRegime.get(k).push(r)
  }
  const kept = []
  for (const [regime, rs] of byRegime) {
    const max = targets[regime] ?? targets["*"] ?? rs.length
    kept.push(...rs.slice(-Math.max(0, max)))
  }
  const dropped = before - kept.length
  rows = kept
  save()
  return { ok: true, kept: kept.length, dropped, reason: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/copyCorpusStore.mjs apps/dashboard/server/__tests__/copyCorpusRetention.test.mjs
git commit -m "feat(corpus): regime-bounded minimal retention pruner (§8.3)"
```

### Task 6: Additive read API + scheduler wiring (no new ceremony, no boot reorder)

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (additive `GET /api/research/corpus` route only — read path, no mixing without explicit flag per §6)
- Modify: `apps/dashboard/server/services/bootSequence.mjs` — NO edit to ordering; corpus attaches via existing `afterBrokers`/scheduler extension point (document the attach point in code comment, do not reorder).
- Test: `apps/dashboard/server/__tests__/copyCorpusApi.test.mjs` (fresh-import `handlers.mjs` + `PICC_COPYCORPUS_DATA_DIR` redirect + `vi.resetModules()`, the `accountMetricsApi.test.mjs:56-74` pattern)

**Interfaces:**
- Consumes: Tasks 1–5 functions.
- Produces:
  - `GET /api/research/corpus?regime=<r>` → `{ regimes, survival, behaviour, bias }` (every statistic carries the §5.4 header; `?includeOwner=true` is the ONLY path that places owner rows beside external rules, and the response labels each block with its `origin`).

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it, vi, beforeEach } from "vitest"
describe("GET /api/research/corpus", () => {
  it("returns bias-headed aggregates without touching existing payloads", async () => {
    const { mkdtempSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    process.env.PICC_COPYCORPUS_DATA_DIR = mkdtempSync(join(tmpdir(), "picc-corpus-api-"))
    vi.resetModules()
    const h = await import("../handlers.mjs")
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    const res = await h.handleRequest({ method: "GET", url: "/api/research/corpus" })
    expect(res.status).toBe(200)
    expect(res.body.bias).toBeDefined()
  })
})
```

(Adapt the `handleRequest` call shape to the actual `handlers.mjs` export — read `handlers.mjs:1-80` first; the assertion that matters is `bias` present and no existing route changed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/dashboard/server/__tests__/copyCorpusApi.test.mjs`
Expected: FAIL (route missing → 404 or no `bias`)

- [ ] **Step 3: Write minimal implementation**

In `handlers.mjs`, add one branch to the existing method+path if-chain (no new router, no ceremony route):

```js
if (method === "GET" && pathname === "/api/research/corpus") {
  const { listExternal, corpusCounts } = await import("./services/copyCorpusStore.mjs")
  const { survivalByCohort } = await import("./services/copyCorpusSurvival.mjs")
  const { behaviourGivenState } = await import("./services/copyCorpusBehaviour.mjs")
  const regime = url.searchParams.get("regime")
  const rows = listExternal(regime ? { regime } : {})
  const survival = survivalByCohort(rows)
  const behaviour = behaviourGivenState(rows)
  return writeJson(res, 200, { regimes: [...new Set(rows.map((r) => r.regime))], survival, behaviour, bias: corpusCounts() })
}
```

Scheduler attach (no boot reorder): register the ingest as a scheduler job guarded by cadence config, or call `ingestPublicFills` from the existing news-digest-style job slot — document in the job file, do not touch `bootSequence.mjs` ordering.

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npm test -- --run apps/dashboard/server/__tests__/copyCorpusApi.test.mjs` then `npm run typecheck`
Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/handlers.mjs apps/dashboard/server/__tests__/copyCorpusApi.test.mjs
git commit -m "feat(corpus): additive read API with bias header (§5.4)"
```
