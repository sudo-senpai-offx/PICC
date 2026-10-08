# Wealth Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cross-venue net-worth ledger: real-money legs with provenance badges, partial totals with an incomplete flag, paper kept separate, settled-only billing, explicit transfers, daily snapshots.

**Architecture:** New `server/services/wealth/` boundary (store, FX, leg readers, aggregator, transfers) consumed by one additive route and one room; the existing accountMetrics collector is extended as a leg feed; a daily snapshot arm lives in `services/jobs/wealth-refresh.mjs`.

**Tech Stack:** Node 22 ESM (`server/services/*.mjs`), Vitest 5.0.3, React 19 + TS room, existing Yahoo/CCXT market access, BTCPay Greenfield wallet API.

**Spec:** `docs/superpowers/specs/2026-10-08-wealth-ledger-design.md` — the plan
argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- Honest absence is a hard contract: absent legs excluded with reason, `incomplete:true` unless every in-scope leg is LIVE, paper never summed, FX-missing legs excluded, manual legs never LIVE.
- Additive-only API changes (ADR-0005): one new route `GET /api/wealth/overview`; existing payload bytes never change.
- Hermetic tests: dynamic imports + `PICC_WEALTH_DATA_DIR` redirect + `vi.resetModules()`; register the new var in `testSupport/storeIsolation.mjs` + runbook inventory (precedent: a96f831, 93fbb5c); every new test file hand-rolling a redirect must be added to the guard inventory (precedent: 93fbb5c fix).
- Boot invariants (`bootSequence.mjs`, do not reorder); never add a second ceremony route; never set ceremony-gate envs manually.
- Probe scripts go in `apps/dashboard/testSupport/*.tmp.mjs` and are deleted after use; never print `.env` values.
- TDD with watched RED/GREEN per task; one commit per task, `feat(wealth): ...` / `fix(wealth): ...` style.

---

### Task 1: Wealth store (legs registry + transfers + snapshots)

**Files:**
- Create: `apps/dashboard/server/services/wealth/store.mjs`
- Test: `apps/dashboard/server/__tests__/wealthStore.test.mjs`
- Modify: `apps/dashboard/testSupport/storeIsolation.mjs` (append `PICC_WEALTH_DATA_DIR` entry, never reorder), `docs/runbooks/PICC_OPERABILITY_RUNBOOK.md` (§4.3 row + counts, T8 accounting protocol)

**Interfaces:**
- Consumes: `PICC_WEALTH_DATA_DIR` env (default `join(__dirname, "..", "..", "data")`), files `wealth.json` (single JSON doc `{ legs, transfers, snapshots }`, best-effort persist mirroring `tradeJournal.mjs:8-24`).
- Produces (later tasks consume these exact names):
  - `listLegs()` → array of `{ id, kind, ccy, amount, observedAt, status: LIVE|STALE|ABSENT|ENTERED, reason, fxSource, fxAt }`
  - `upsertLeg(leg)` → stored leg (validates `status` enum, `asOf` required for `kind:"manual"` — rejects without named reason `manual-asof-required`)
  - `listTransfers()` / `addTransfer({ fromLeg, toLeg, ccy, amount, at, note })` → transfer; `at` required (named reason `transfer-at-required`)
  - `addSnapshot({ at, totalUsd, incomplete, legStatus })` → snapshot; date-keyed idempotent on `(tzDate)` — same date overwrites, never duplicates
  - `_resetWealthForTest()`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/server/__tests__/wealthStore.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("wealth store", () => {
  let dir, mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-wealth-"))
    process.env.PICC_WEALTH_DATA_DIR = dir
    vi.resetModules()
    mod = await import("./wealth/store.mjs").catch(() => import("../services/wealth/store.mjs"))
  })
  afterEach(() => {
    delete process.env.PICC_WEALTH_DATA_DIR
    mod._resetWealthForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("rejects a manual leg without as-of", () => {
    const r = mod.upsertLeg({ id: "tng", kind: "manual", ccy: "MYR", amount: 18 })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
  })

  it("snapshots are date-keyed idempotent", () => {
    mod.addSnapshot({ at: "2026-10-08T00:00:00+08:00", totalUsd: 100, incomplete: true, legStatus: [] })
    mod.addSnapshot({ at: "2026-10-08T12:00:00+08:00", totalUsd: 120, incomplete: true, legStatus: [] })
    expect(mod.listSnapshots({}).filter((s) => s.tzDate === "2026-10-08").length).toBe(1)
  })
})
```

(Fix the import path to the real relative location when writing the file; the assertion that matters is rejection + idempotency. Also add a `listSnapshots({ limit = 100 } = {})` newest-first reader to the interface above — implement it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/wealthStore.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … store.mjs"

- [ ] **Step 3: Write minimal implementation**

`apps/dashboard/server/services/wealth/store.mjs` — module store + best-effort JSON persist (tradeJournal pattern), seeded-ABSENT legs on first boot: `hyperliquid` (`reason: "hyperliquid-credentials-unset"`), `ccxt-spot` (`"ccxt-keys-unset"`), `btcpay` (`"btcpay-unconfigured"`), `tng-manual` (empty manual shell, no amount). Status enum enforced; `asOf` required for manual; date-keyed snapshot overwrite by `tzDate` (compute with `Intl.DateTimeFormat("en-CA", { timeZone })`, tz from `PICC_SNAPSHOT_TZ` default `Asia/Singapore`).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/wealth/store.mjs apps/dashboard/server/__tests__/wealthStore.test.mjs apps/dashboard/testSupport/storeIsolation.mjs docs/runbooks/PICC_OPERABILITY_RUNBOOK.md
git commit -m "feat(wealth): store with seeded ABSENT legs, transfers, date-keyed snapshots"
```

### Task 2: FX module (observed rates, declared parity, freshest-wins)

**Files:**
- Create: `apps/dashboard/server/services/wealth/fx.mjs`
- Test: `apps/dashboard/server/__tests__/wealthFx.test.mjs`

**Interfaces:**
- Consumes: injectable price readers `{ yahooQuote(ccy), ccxtQuote(ccy) }` → `{ rate, quotedAt } | null` (default implementations in Task 3's readers; this task tests with injected doubles — no network in tests).
- Produces:
  - `PEGGED = new Set(["USDT", "USDC", "DAI"])` (declared parity assumption, labeled in code comment + surfaced as `fxSource: "declared-parity"`)
  - `convertToUsd(ccy, amount, readers)` → `{ usd, fxSource, fxAt }` or `{ usd: null, reason }` — freshest `quotedAt` wins, tie → CCXT; stale-beyond-threshold (same 90s/5min rule as legs: LIVE<90s, usable<5min) excluded with `fx-unobservable:<ccy>`; pegged stables skip observation with `declared-parity`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { convertToUsd } from "../services/wealth/fx.mjs"

const readers = (yahoo, ccxt) => ({ yahooQuote: async () => yahoo, ccxtQuote: async () => ccxt })

describe("fx", () => {
  it("freshest quote wins, tie goes to ccxt", async () => {
    const r = await convertToUsd("MYR", 18, readers(
      { rate: 0.21, quotedAt: "2026-10-08T00:00:10Z" },
      { rate: 0.22, quotedAt: "2026-10-08T00:00:10Z" }))
    expect(r.usd).toBeCloseTo(18 * 0.22)
    expect(r.fxSource).toBe("ccxt")
  })
  it("pegged stables use declared parity without observation", async () => {
    const r = await convertToUsd("USDT", 10, readers(null, null))
    expect(r.usd).toBe(10)
    expect(r.fxSource).toBe("declared-parity")
  })
  it("missing rates exclude with reason", async () => {
    const r = await convertToUsd("MYR", 18, readers(null, null))
    expect(r.usd).toBe(null)
    expect(r.reason).toMatch(/fx-unobservable/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/wealthFx.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … fx.mjs"

- [ ] **Step 3: Write minimal implementation**

Pure async mapper exactly per the interface; no imports from market modules (readers injected).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/wealth/fx.mjs apps/dashboard/server/__tests__/wealthFx.test.mjs
git commit -m "feat(wealth): fx with declared parity and freshest-wins"
```

### Task 3: Keyed leg readers (ccxt-spot, hyperliquid, BTCPay)

**Files:**
- Create: `apps/dashboard/server/services/wealth/legsKeyed.mjs`
- Test: `apps/dashboard/server/__tests__/wealthLegsKeyed.test.mjs`

**Interfaces:**
- Consumes: broker registry (ccxt spot balances, read-only), hyperliquid equity reader (same source the API uses; creds required), BTCPay Greenfield `GET {PICC_BTCPAY_URL}/api/v1/stores/{PICC_BTCPAY_STORE_ID}/payment-methods/{PICC_BTCPAY_PAYMENT_METHOD_ID default BTC}/wallet` with `Authorization: token $PICC_BTCPAY_API_KEY` → `{ balance, confirmedBalance, unconfirmedBalance }` (decimal strings; use confirmedBalance; unconfirmed reported separately, never summed).
- Produces (status by spec decision 10: observedAt<90s → LIVE, <5min → STALE, older → ABSENT with `stale-exceeded` reason; observedAt missing → ABSENT):
  - `readCcxtSpotLeg()` → leg record (`status` + reason; ABSENT `ccxt-keys-unset` without keys)
  - `readHyperliquidLeg()` → leg record (ABSENT `hyperliquid-credentials-unset` without creds)
  - `readBtcpayLeg()` → leg record in wallet ccy (ABSENT `btcpay-unconfigured` unless URL+key+storeId all set; HTTP failure → named reason with status, secret never logged)
  - `yahooQuote(ccy)` / `ccxtQuote(ccy)` — the default readers Task 2 injects (Yahoo last close + quotedAt; CCXT reference ticker + quotedAt; null when unobservable)

- [ ] **Step 1: Write the failing test**

Mock the three sources (no network, no keys): keyed readers return ABSENT with exact reasons when env is unset; BTCPay mocked fetch returning `{ confirmedBalance: "0.05", unconfirmedBalance: "0.01" }` maps to amount 0.05 + unconfirmed noted, never summed. Yahoo/CCXT reader tests assert null-on-unobservable.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/wealthLegsKeyed.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … legsKeyed.mjs"

- [ ] **Step 3: Write minimal implementation**

Read-only mappers exactly per the interface. BTCPay key permission required: `btcpay.store.canviewwallet` (document in header comment). No persistence here (store.mjs owns it).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/wealth/legsKeyed.mjs apps/dashboard/server/__tests__/wealthLegsKeyed.test.mjs
git commit -m "feat(wealth): keyed leg readers (ccxt, hyperliquid, btcpay)"
```

### Task 4: Local legs (manual, billing-settled, localstore, paper summary)

**Files:**
- Create: `apps/dashboard/server/services/wealth/legsLocal.mjs`
- Test: `apps/dashboard/server/__tests__/wealthLegsLocal.test.mjs`

**Interfaces:**
- Consumes: wealth store (manual legs with required as-of), billing settled sources (TnG manual — closed-loop, no API; billing flows NEVER summed, only settled balances), localstore `financial_accounts`/`transactions`/`nft_holdings` (read-only), paper analytics reader (existing `/api/trading/paper/analytics` producer — import the service function, not the route).
- Produces (manual legs: ENTERED + age-from-asOf in whole days, never LIVE/STALE):
  - `readManualLegs()` → stored manual legs with ENTERED + age-from-asOf (never LIVE/STALE)
  - `readBillingLegs()` → settled-balance legs only (flows excluded by construction — no flow field exists on the output shape)
  - `readLocalstoreLegs()` → legs with priority-dedupe: any row overlapping a live keyed leg id is flagged `duplicate-of:<legId>` and EXCLUDED with reason (live keyed legs win — spec decision 8)
  - `readPaperSummary()` → `{ equity, cash, committed, open, closed }` passthrough (never converted, never summed — shape has no path into the total)

- [ ] **Step 1: Write the failing test**

Fixtures: manual leg with as-of → ENTERED + correct age days; billing flow-shaped input → absent from output; localstore row overlapping `ccxt-spot` → excluded `duplicate-of`; paper summary → exact five fields, no usd total.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/wealthLegsLocal.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … legsLocal.mjs"

- [ ] **Step 3: Write minimal implementation**

Read-only mappers exactly per the interface.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/wealth/legsLocal.mjs apps/dashboard/server/__tests__/wealthLegsLocal.test.mjs
git commit -m "feat(wealth): local legs with priority dedupe and paper summary"
```

### Task 5: Aggregator (partial totals, window-adjusted snapshots)

**Files:**
- Create: `apps/dashboard/server/services/wealth/aggregate.mjs`
- Test: `apps/dashboard/server/__tests__/wealthAggregate.test.mjs`

**Interfaces:**
- Consumes: leg arrays (Task 3+4 shapes), transfers (Task 1 shape), `convertToUsd` (Task 2).
- Produces:
  - `overview({ legs, transfers, paper })` → `{ totalUsd, incomplete, legs: [leg + usd|reason], paper, transfers }` — total sums only converted legs; `incomplete:true` unless every in-scope leg is LIVE; paper block passed through untouched.
  - `snapshotAdjust({ legs, transfers, windowStart, windowEnd })` → legs with in-flight duplicates excluded per transfers dated inside the window (spec decision 16); transfers outside the window ignored.

- [ ] **Step 1: Write the failing test**

Fixtures: 2 LIVE legs + 1 ABSENT leg → total of 2 + `incomplete:true` + absent reason present; transfer inside window → destination leg excluded once; transfer outside window → no exclusion; paper block deep-equal passthrough.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/wealthAggregate.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … aggregate.mjs"

- [ ] **Step 3: Write minimal implementation**

Pure functions exactly per the interface (no store/IO — snapshot persistence belongs to Task 7's job).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/wealth/aggregate.mjs apps/dashboard/server/__tests__/wealthAggregate.test.mjs
git commit -m "feat(wealth): aggregator with window-adjusted snapshots"
```

### Task 6: Transfers Phase 1 (manual log) + Phase 2 (suggest-and-confirm)

**Files:**
- Create: `apps/dashboard/server/services/wealth/transfers.mjs`
- Test: `apps/dashboard/server/__tests__/wealthTransfers.test.mjs`

**Interfaces:**
- Consumes: wealth store transfers (Task 1).
- Produces:
  - Phase 1: `validateTransfer(t)` → `{ ok, reason }` (`at` required, amount finite > 0, fromLeg ≠ toLeg, both legs known) — used by the route in Task 7.
  - Phase 2: `suggestTransfers({ legs, windowMs })` → candidates from burst-matched opposite flows (same ccy, amounts within 1%, timestamps within windowMs default 24h) each `{ fromLeg, toLeg, ccy, amount, at, confidence: "candidate", status: "unconfirmed" }` — NEVER auto-confirmed; confirmation writes via `addTransfer` only from explicit operator action.

- [ ] **Step 1: Write the failing test**

Validation rejects (missing at, zero amount, same-leg, unknown leg) with named reasons; suggester finds an obvious pair and ignores non-matching flows; nothing auto-writes (store transfer count unchanged after suggest).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/wealthTransfers.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL with "Cannot find module … transfers.mjs"

- [ ] **Step 3: Write minimal implementation**

Exactly per the interface. Phase 2 ships in the same task only after Phase 1 tests green (report both separately).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/wealth/transfers.mjs apps/dashboard/server/__tests__/wealthTransfers.test.mjs
git commit -m "feat(wealth): manual transfer log plus suggest-and-confirm"
```

### Task 7: accountMetrics collector extension (CCXT spot balances)

**Files:**
- Modify: `apps/dashboard/server/services/accountMetrics.mjs` (collector only; strict parser untouched)
- Test: extend the accountMetrics test file(s) — CCXT spot balances collected per (user, venue) with observedAt; no-keys → nothing stored (no fabricated rows)

**Interfaces:**
- Consumes: broker registry (read-only balances).
- Produces: populated `account-metrics.json` keyed `{ [userId]: { [venueId]: record } }` for reachable keyed venues; unreachable/unkeyed venues store nothing (existing ABSENT semantics downstream).

- [ ] **Step 1: Write the failing test**

Mocked registry with one keyed venue → one stored record with observedAt; unkeyed registry → store untouched.

- [ ] **Step 2: Run test to verify it fails**

Run: the accountMetrics suite (workdir `apps/dashboard`)
Expected: FAIL (no CCXT collection)

- [ ] **Step 3: Write minimal implementation**

Collector addition only; parser, store shape, and API surface byte-identical.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/accountMetrics.mjs <touched test files>
git commit -m "feat(wealth): collect CCXT spot balances into account metrics"
```

### Task 8: portfolioAnalytics null-honesty fix

**Files:**
- Modify: `apps/dashboard/server/services/portfolioAnalytics.mjs` (return-shape sites only)
- Test: extend its test file(s)

**Interfaces:**
- Consumes: nothing new.
- Produces: `mean`/`stdDev`/`pearsonCorr`/`sharpeRatio`/`sortinoRatio` (and siblings) return `null` + callers treat null as abstain on insufficient data (empty, n<2, n<5, zero-variance) instead of 0. Audit every in-repo caller first; any caller that cannot tolerate null without redesign is STOP-left untouched + reported (Wave 0 T3 precedent).

- [ ] **Step 1: Write the failing test**

Empty/short/degenerate inputs → null (not 0) at each function.

- [ ] **Step 2: Run test to verify it fails**

Run: the portfolioAnalytics suite (workdir `apps/dashboard`)
Expected: FAIL (returns 0)

- [ ] **Step 3: Write minimal implementation**

Shaping only; no formula changes for sufficient data.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/services/portfolioAnalytics.mjs <touched test files>
git commit -m "fix(honesty): null-not-zero in portfolio analytics"
```

### Task 9: Route + room + daily job (wealth-refresh)

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (ONE additive branch), `apps/dashboard/server/services/scheduler.mjs` (register `wealth-refresh` via existing `every()` in `services/jobs/wealth-refresh.mjs` — new file)
- Create: `apps/dashboard/server/services/jobs/wealth-refresh.mjs`, frontend wealth room under `src/pages/ministry/` (mirror the DispatchBell-adjacent room structure and its test layout in `src/pages/ministry/__tests__/`; existing tokens/components only), `POST /api/wealth/transfers` (validateTransfer → addTransfer; requireAuth) alongside `GET /api/wealth/overview`
- Test: `apps/dashboard/server/__tests__/wealthApi.test.mjs` (fresh handlers import + `PICC_WEALTH_DATA_DIR` redirect; unauth refused; overview shape incl. `incomplete`, paper block, badges; transfer validation reasons) + room component test (badges render; incomplete banner; manual as-of form; permission-free read)

**Interfaces:**
- Consumes: Tasks 1–6 exact exports.
- Produces:
  - `GET /api/wealth/overview` → `{ totalUsd|null, incomplete, legs, paper, transfers, snapshots }`
  - `POST /api/wealth/transfers` → `{ ok, transfer }` or `{ ok:false, reason }`
  - Daily snapshot arm in the job: date-keyed by `PICC_SNAPSHOT_TZ` (default `Asia/Singapore`), idempotent overwrite; 2-year rolling prune (`snapshots older than 730 days dropped by policy`); manual legs refreshed as ENTERED (never fetched).

- [ ] **Step 1: Write the failing test**

API suite first: route missing → 404 (then shape assertions after implementation).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/wealthApi.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL (404 or no `incomplete`)

- [ ] **Step 3: Write minimal implementation**

Route branches (dynamic `await import()` like neighbors — no new static imports in handlers.mjs), job file, room. No bootSequence reorder; no ceremony route.

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npx vitest run server/__tests__/wealthApi.test.mjs` then `npm run typecheck` (repo root)
Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add <route, job, room, tests>
git commit -m "feat(wealth): overview route, room and daily snapshots"
```
