# Cost-Basis Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the report-only FIFO tax-lot CSV export with cost-basis adjustments, self-transfer flags, and provenance on every line.

**Architecture:** New `server/services/tax/` boundary (FIFO matcher, CSV renderer) reading journal, live closes, costs fills, and wealth transfers; one additive download route; one wealth-room section. Stateless matcher, no new store.

**Tech Stack:** Node 22 ESM (`server/services/*.mjs`), Vitest 5.0.3, React 19 + TS, existing tradeJournal/costs/wealth-transfer readers, wealth `fx.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-08-cost-basis-export-design.md` — the plan
argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- Real disposals only (journal closes + live close records); paper/testnet excluded with stated reason; no advice language anywhere (report-only banner).
- FIFO global per-asset pools; fees adjust basis ONLY from explicitly linked cost records (else `fee-unobserved`); unmatched sells list with `basis-unobserved`, gain unstated; self-transfers flagged, still listed.
- Additive-only API changes (ADR-0005): one new route `GET /api/tax/lots?from&to`; existing payload bytes never change.
- Hermetic tests: fixture journals/fills/costs, dynamic imports, `vi.resetModules()`; stateless matcher (no new store, no new env var); every new hand-rolled test file added to the guard inventory.
- Boot invariants untouched; no second ceremony route; TDD with watched RED/GREEN; one commit per task (`feat(tax): ...` / `fix(tax): ...`).
- Probe scripts in `apps/dashboard/testSupport/*.tmp.mjs`, deleted after use; never print `.env` values or keys.

---

### Task 1: FIFO matcher (lots engine)

**Files:**
- Create: `apps/dashboard/server/services/tax/lots.mjs`
- Test: `apps/dashboard/server/__tests__/taxLots.test.mjs`

**Interfaces:**
- Consumes: acquisition rows `{ asset, qty, price, ccy, at, source: "journal-entry"|"opening-balance"|"swap-half", id }`, disposal rows `{ asset, qty, price, ccy, at, source: "journal-close"|"live-close"|"swap-half", id }`, linked cost records `{ closeId|fillId, feeUsd, kind }`, self-transfer flags `{ asset, qty, at }` (informational only).
- Produces:
  - `matchLots({ acquisitions, disposals, costs, selfTransfers })` → `{ lots: [{ id, date, asset, side, qty, price, ccy, feeUsd|null, proceedsUsd, basisUsd|null, gainUsd|null, method: "FIFO", provenance, selfTransfer, swapTag|null, flags[] }], unmatched: [...], incomplete }` — global per-asset FIFO pools; buy-fees raise basis, sell-fees lower proceeds (linked records only, else `fee-unobserved`); unmatched sells list with `basis-unobserved`, gain null; self-transfer matches flagged, still listed; `id` echoes the disposal id.

- [ ] **Step 1: Write the failing test**

`apps/dashboard/server/__tests__/taxLots.test.mjs`:

```js
import { describe, expect, it } from "vitest"
import { matchLots } from "../services/tax/lots.mjs"

const acq = (over) => ({ asset: "BTC", qty: 1, price: 50000, ccy: "USD", at: "2026-01-10T00:00:00Z", source: "journal-entry", id: "a1", ...over })
const dis = (over) => ({ asset: "BTC", qty: 0.5, price: 60000, ccy: "USD", at: "2026-02-10T00:00:00Z", source: "journal-close", id: "d1", ...over })

describe("fifo lots", () => {
  it("matches oldest acquisition first with adjusted basis", () => {
    const out = matchLots({
      acquisitions: [acq({ id: "a1", at: "2026-01-01T00:00:00Z" }), acq({ id: "a2", price: 55000, at: "2026-01-20T00:00:00Z" })],
      disposals: [dis({})],
      costs: [{ closeId: "d1", feeUsd: 5, kind: "fee" }],
      selfTransfers: [],
    })
    expect(out.lots).toHaveLength(1)
    expect(out.lots[0].basisUsd).toBeCloseTo(0.5 * 50000, 8)
    expect(out.lots[0].proceedsUsd).toBeCloseTo(0.5 * 60000 - 5, 8)
    expect(out.lots[0].method).toBe("FIFO")
  })

  it("unmatched sells list with basis-unobserved and null gain", () => {
    const out = matchLots({ acquisitions: [], disposals: [dis({})], costs: [], selfTransfers: [] })
    expect(out.lots[0].basisUsd).toBe(null)
    expect(out.lots[0].gainUsd).toBe(null)
    expect(out.lots[0].flags).toContain("basis-unobserved")
  })

  it("self-transfers flag but still list", () => {
    const out = matchLots({
      acquisitions: [acq({})], disposals: [dis({})], costs: [],
      selfTransfers: [{ asset: "BTC", qty: 0.5, at: "2026-02-10T00:00:00Z" }],
    })
    expect(out.lots[0].selfTransfer).toBe(true)
  })

  it("swap halves pair by tag; unpaired halves flag without inference", () => {
    const out = matchLots({
      acquisitions: [acq({ asset: "ETH", id: "s-buy", swapTag: "swap-1" })],
      disposals: [dis({ swapTag: "swap-1" }), dis({ id: "d-lone", swapTag: "swap-orphan" })],
      costs: [], selfTransfers: [],
    })
    expect(out.lots.find((l) => l.id === "d-lone").flags).toContain("swap-half-unpaired")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/taxLots.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … lots.mjs"

- [ ] **Step 3: Write minimal implementation**

Pure FIFO matcher exactly per the interface. Partial-lot splits (disposal larger than oldest lot consumes across lots in order, emitting one lot line per acquisition slice).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/tax/lots.mjs apps/dashboard/server/__tests__/taxLots.test.mjs
git commit -m "feat(tax): FIFO matcher with fee linkage and self-transfer flags"
```

### Task 2: Opening balances (flagged journal entries)

**Files:**
- Modify: `apps/dashboard/server/services/tradeJournal.mjs` (accept + preserve a flagged opening-balance entry kind; no behavior change to existing entries)
- Test: extend the tradeJournal test file(s)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `addEntry` accepts `kind: "opening-balance"` (optional field; all existing behavior identical when absent) with required `{ symbol, quantity, entryPrice, entryTime }`; the entry is stored verbatim with the kind flag and excluded from `journalStats()` pnl math (opening lots are not trades — stats must not count them; assert this).
  - `listEntries` supports filtering them (e.g. `{ kind: "opening-balance" }` passthrough).

- [ ] **Step 1: Write the failing test**

Opening-balance entry stores with kind; `journalStats()` totals identical with and without the opening entry present; filter returns it.

- [ ] **Step 2: Run test to verify it fails**

Run: the tradeJournal suite (workdir `apps/dashboard`)
Expected: FAIL (kind not preserved / stats polluted)

- [ ] **Step 3: Write minimal implementation**

Flag support + stats exclusion exactly per the interface. No other journal behavior touched.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2 + journal-adjacent suites (paper, tradeGate if they read the journal)
Expected: PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/tradeJournal.mjs <touched test files>
git commit -m "feat(tax): opening-balance entry kind excluded from stats"
```

### Task 3: CSV renderer (banner + fixed columns)

**Files:**
- Create: `apps/dashboard/server/services/tax/csv.mjs`
- Test: `apps/dashboard/server/__tests__/taxCsv.test.mjs`

**Interfaces:**
- Consumes: Task 1 lot lines.
- Produces:
  - `renderCsv({ lots, unmatched, method: "FIFO", generatedAt })` → string: banner comment rows (`# PICC tax lots — report only, not tax advice. Verify with your accountant.`, `# method: FIFO`, `# generated: <iso>`), fixed header `date,asset,side,qty,price,ccy,feeUsd,proceedsUsd,basisUsd,gainUsd,method,provenance,selfTransfer,flags`, one row per lot (nulls render empty, flags pipe-joined), CSV-escaped values (quotes/commas/newlines).

- [ ] **Step 1: Write the failing test**

Banner rows present with disclaimer text; header exact; null gain renders empty; value with comma quoted; unmatched section appended after a separator comment (or included with flags — pick one and pin it).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/taxCsv.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … csv.mjs"

- [ ] **Step 3: Write minimal implementation**

Exactly per the interface.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/tax/csv.mjs apps/dashboard/server/__tests__/taxCsv.test.mjs
git commit -m "feat(tax): CSV renderer with disclaimer banner"
```

### Task 4: Inputs assembly (journal + live + costs + transfers → matcher rows)

**Files:**
- Create: `apps/dashboard/server/services/tax/inputs.mjs`
- Test: `apps/dashboard/server/__tests__/taxInputs.test.mjs`

**Interfaces:**
- Consumes: tradeJournal `listEntries`, live close records (livePositionManager read path — read-only, same discipline as costs paperOverlay: prove no close/mark calls), costs fills (record-time USD), wealth transfers (self-transfer flags).
- Produces:
  - `collectInputs({ from, to })` → `{ acquisitions, disposals, costs, selfTransfers }` shaped for Task 1: journal entries → acquisitions (entry side) / disposals (closed side, exitTime in range); live closes → disposals (fee fields linked by close id); costs fills linked by close/fill id; paper + testnet records EXCLUDED with reason counts `{ excludedPaper, excludedTestnet }`; swap halves paired by shared tag (unpaired halves flagged `swap-half-unpaired`, still listed).

- [ ] **Step 1: Write the failing test**

Fixture journal (entry + close + opening-balance + paper-tagged entry) → acquisitions/disposals split correct; paper excluded with count; swap pair linked; unpaired half flagged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/taxInputs.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … inputs.mjs"

- [ ] **Step 3: Write minimal implementation**

Read-only assembly exactly per the interface. Paper/testnet identification by venue kind (match the wealth leg convention — read how legs distinguish paper/testnet first and reuse the same predicate, do not invent a second one).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/tax/inputs.mjs apps/dashboard/server/__tests__/taxInputs.test.mjs
git commit -m "feat(tax): input assembly with paper/testnet exclusion"
```

### Task 5: Route + wealth-room download section

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (ONE additive branch, dynamic `await import()` — no new static imports, 72-guard intact), wealth room component (download section: period picker + MY-year preset + all-time + disclaimer notice + self-transfer flags visible)
- Create: `apps/dashboard/server/__tests__/taxApi.test.mjs` + room section test beside the wealth room tests
- Test: fresh handlers import + DATA_DIR redirects; unauth refused; CSV content-type + banner row + fixed header; from/to filtering on exitTime; requireAuth first; no ceremony interference

**Interfaces:**
- Consumes: Tasks 1–4 exact exports.
- Produces:
  - `GET /api/tax/lots?from&to` → `text/csv` download (`Content-Disposition` attachment with dated filename); invalid dates → 400 with named reason (never default range silently).
  - Room section with period picker, year preset, all-time, disclaimer, download button.

- [ ] **Step 1: Write the failing test**

API suite: route missing → 404 (then shape assertions after implementation); component test: disclaimer renders, flags visible.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/taxApi.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL (404 or no CSV)

- [ ] **Step 3: Write minimal implementation**

Route branch + section UI. No bootSequence reorder; no ceremony route.

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npx vitest run server/__tests__/taxApi.test.mjs` then `npm run typecheck` (repo root)
Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add <route, room section, tests>
git commit -m "feat(tax): lots download route and wealth-room section"
```
