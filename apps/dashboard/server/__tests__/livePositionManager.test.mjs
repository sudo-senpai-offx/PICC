// WS-1 T4 — livePositionManager.mjs: the live perps position manager (F3).
// Restart-persistent open-position lifecycle, HONEST realized P&L (fees/funding
// labeled per ADR-0005, never a made-up number), one-way netting (R3.6), and the
// peak-anchored wallet state WS-3's breaker consumes (R3.4; halted stays null).
//
// Conventions mirror positionManager.test.mjs (:9-25) with the MANAGER's own
// data-dir var: PICC_COMMAND_CENTRE_DATA_DIR (the paper manager's
// PICC_TRADING_DATA_DIR is a different module's variable — not reused). Each
// test boots a fresh module instance from a tmp dir; a `restart` re-import from
// the same dir proves persistence. The fixture adapter is a plain stub — F3
// holds no ccxt instance, it only calls the injected adapter's observer methods.
import { afterEach, expect, test, vi } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir = null

const T = (h, m = 0) => new Date(Date.UTC(2026, 0, 1, h, m)).toISOString()

function openPosition(overrides = {}) {
  return {
    id: "0xopen1",
    symbol: "BTC/USDC:USDC",
    side: "long",
    size: 2,
    entryPrice: 100,
    leverage: 4,
    marginUsd: 50,
    marginMode: "isolated",
    openedAt: T(10),
    openOrderId: "c-1",
    ...overrides
  }
}

function venueRow(symbol = "BTC/USDC:USDC", side = "long") {
  return {
    symbol,
    side,
    size: 2,
    entryPrice: 100,
    notional: 200,
    leverage: 4,
    marginMode: "isolated",
    liquidationPrice: null,
    at: new Date(Date.parse(T(10)) + 60_000).toISOString()
  }
}

function walletAdapter({ equityUsd = 100, at = new Date().toISOString(), positions = [], equity = null } = {}) {
  return {
    observeEquity: async () =>
      equity !== null
        ? equity
        : { ok: true, equityUsd, currency: "USDT", at: new Date(at).toISOString() },
    positionView: async () => positions
  }
}

async function boot() {
  dir = await mkdtemp(join(tmpdir(), "picc-lpm-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  vi.resetModules()
  return import("../services/livePositionManager.mjs")
}

/** Re-import from the SAME data dir — proves restart persistence. */
async function restart() {
  vi.resetModules()
  return import("../services/livePositionManager.mjs")
}

afterEach(async () => {
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  vi.resetModules()
})

test("trackOpen registers an open position with the honest persisted shape (source persisted)", async () => {
  const m = await boot()
  const p = m.trackOpen({ position: openPosition(), now: Date.parse(T(10)) })
  expect(p).toMatchObject({
    id: "0xopen1",
    symbol: "BTC/USDC:USDC",
    side: "long",
    size: 2,
    entryPrice: 100,
    leverage: 4,
    marginUsd: 50,
    marginMode: "isolated",
    openedAt: T(10),
    openOrderId: "c-1",
    source: "persisted"
  })
  expect(m.openPositions()).toHaveLength(1)
})

test("long close: entry 100 → exit 110, size 2 ⇒ +20; fees unobserved, funding observed", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition(), now: Date.parse(T(10)) })
  const res = m.recordClose({
    positionId: "0xopen1",
    fill: { id: "f1", symbol: "BTC/USDC:USDC", side: "sell", filled: 2, average: 110, status: "closed", at: T(10, 30) },
    fundingObservations: [],
    now: Date.parse(T(10, 30))
  })
  expect(res).toEqual({
    positionId: "0xopen1",
    realizedPnlUsd: 20,
    fees: "unobserved",
    fundingAccrual: "observed",
    reason: expect.stringContaining("gross")
  })
  expect(m.openPositions()).toHaveLength(0)
})

test("short close: entry 100 → exit 90, size 2 ⇒ +20 (short profits on the drop)", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition({ symbol: "ETH/USDC:USDC", side: "short", size: 2, entryPrice: 100 }), now: Date.parse(T(10)) })
  const res = m.recordClose({
    positionId: "0xopen1",
    fill: { id: "f2", symbol: "ETH/USDC:USDC", side: "buy", filled: 2, average: 90, status: "closed", at: T(10, 30) },
    fundingObservations: [],
    now: Date.parse(T(10, 30))
  })
  expect(res.realizedPnlUsd).toBe(20)
  expect(res.fees).toBe("unobserved")
})

test("fee present in the fill ⇒ fees observed and P&L net of it (realized −0.5)", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition(), now: Date.parse(T(10)) })
  const res = m.recordClose({
    positionId: "0xopen1",
    fill: { id: "f3", symbol: "BTC/USDC:USDC", side: "sell", filled: 2, average: 110, fee: 0.5, status: "closed", at: T(10, 30) },
    fundingObservations: [],
    now: Date.parse(T(10, 30))
  })
  expect(res.realizedPnlUsd).toBe(19.5)
  expect(res.fees).toBe("observed")
  expect(res.reason).toContain("net of venue fee")
})

test("funding observations captured during the hold are included in realized P&L", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition(), now: Date.parse(T(10)) }) // notional 200
  const res = m.recordClose({
    positionId: "0xopen1",
    fill: { id: "f4", symbol: "BTC/USDC:USDC", side: "sell", filled: 2, average: 110, status: "closed", at: T(10, 30) },
    fundingObservations: [
      { rate: 0.001, at: T(10, 10) },
      { rate: 0.002, at: T(10, 20) }
    ],
    now: Date.parse(T(10, 30))
  })
  // accrued = (0.001 + 0.002) × 200 notional = 0.6 → 20 + 0.6
  expect(res.realizedPnlUsd).toBeCloseTo(20.6, 5)
  expect(res.fundingAccrual).toBe("observed")
  expect(res.reason).toContain("funding accrual")
})

test("hold crossing a funding boundary without an observation ⇒ unobserved-portion, no funding adjustment", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition(), now: Date.parse(T(10)) })
  const res = m.recordClose({
    positionId: "0xopen1",
    fill: { id: "f5", symbol: "BTC/USDC:USDC", side: "sell", filled: 2, average: 110, status: "closed", at: T(13) },
    fundingObservations: [{ rate: 0.001, at: T(10, 5) }],
    now: Date.parse(T(13))
  })
  expect(res.realizedPnlUsd).toBe(20) // gross, funding NOT adjusted
  expect(res.fundingAccrual).toBe("unobserved-portion")
  expect(res.reason).toContain("unobserved-portion")
})

test("recordReduction nets an opposite-side fill: size shrinks, entry/side kept, reduction-to-zero closes, never a second position", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition({ id: "p-net", symbol: "SOL/USDC:USDC", size: 2, entryPrice: 100 }), now: Date.parse(T(10)) })
  const reduced = m.recordReduction({ positionId: "p-net", filledSize: 1, avgPrice: 105, now: Date.parse(T(10, 30)) })
  expect(reduced).toMatchObject({ id: "p-net", size: 1, entryPrice: 100, side: "long", realizedAccruedUsd: 5 })
  expect(m.openPositions()).toHaveLength(1) // the same position, never a second one
  const closed = m.recordReduction({ positionId: "p-net", filledSize: 1, avgPrice: 110, now: Date.parse(T(10, 40)) })
  // round-trip total = the verified-fill sum (105−100)+(110−100) = 15, NOT the understated 10
  expect(closed).toMatchObject({ positionId: "p-net", realizedPnlUsd: 15, fees: "unobserved" })
  expect(m.openPositions()).toHaveLength(0)
})

test("restart persistence: positions reload and the day baseline survives a re-import from the same data dir", async () => {
  const m1 = await boot()
  m1.trackOpen({ position: openPosition({ id: "p-restart" }), now: Date.parse(T(9)) })
  await m1.observePerpsWallet(walletAdapter({ equityUsd: 100, at: T(9), positions: [venueRow()] }), { now: Date.parse(T(9)) })
  await m1.observePerpsWallet(walletAdapter({ equityUsd: 90, at: T(11), positions: [venueRow()] }), { now: Date.parse(T(11)) })

  const m2 = await restart()
  expect(m2.openPositions()).toHaveLength(1)
  expect(m2.openPositions()[0].id).toBe("p-restart")

  const s = await m2.observePerpsWallet(walletAdapter({ equityUsd: 90, at: T(12), positions: [venueRow()] }), { now: Date.parse(T(12)) })
  expect(s.dayKey).toBe("2026-01-01")
  expect(s.dayStartEquityUsd).toBe(100) // restart must not reset the day baseline
  expect(s.dayLossPct).toBe(10)
  expect(s.runningPeakUsd).toBe(100)
})

test("reconcileWithVenue labels venue-observed / reconciled / persisted and closes vanished-without-verify as closed-unobserved with pnl null", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition({ id: "p-known", symbol: "BTC/USDC:USDC", side: "long" }), now: Date.parse(T(10)) })
  m.trackOpen({ position: openPosition({ id: "p-vanished", symbol: "ETH/USDC:USDC", side: "short", size: 1, entryPrice: 200 }), now: Date.parse(T(10)) })

  const res = await m.reconcileWithVenue([
    venueRow("BTC/USDC:USDC", "long"), // matches p-known
    venueRow("SOL/USDC:USDC", "long"), // venue-only
    venueRow("ETH/USDC:USDC", "short") // matches p-vanished: it IS present → reconciled
  ])

  const labels = Object.fromEntries(m.openPositions().map((p) => [p.id, p.source]))
  expect(labels["p-known"]).toBe("reconciled")
  expect(labels["venue:SOL/USDC:USDC:long"]).toBe("venue-observed")
  expect(labels["p-vanished"]).toBe("reconciled")
  expect(res.venueObserved).toEqual(["venue:SOL/USDC:USDC:long"])

  // now the vanished case: ETH leaves the venue without a verified close
  const res2 = await m.reconcileWithVenue([
    venueRow("BTC/USDC:USDC", "long"),
    venueRow("SOL/USDC:USDC", "long")
  ])
  expect(res2.closedUnobserved).toHaveLength(1)
  expect(res2.closedUnobserved[0].positionId).toBe("p-vanished")
  expect(res2.closedUnobserved[0].pnl).toBeNull()
  expect(res2.closedUnobserved[0].source).toBe("closed-unobserved")
  expect(res2.closedUnobserved[0].reason).toContain("p-vanished")
  expect(m.openPositions().some((p) => p.id === "p-vanished")).toBe(false)

  // venue unobservable ⇒ no mutation, fresh/undecided positions keep the persisted label
  const pFresh = m.trackOpen({ position: openPosition({ id: "p-fresh", symbol: "SOL/USDC:USDC", side: "short" }) })
  expect(pFresh.source).toBe("persisted")
  const res3 = await m.reconcileWithVenue({ ok: false, reason: "positions-unobservable" })
  expect(res3.ok).toBe(false)
  expect(res3.reason).toBe("positions-unobservable")
  expect(m.openPositions().find((p) => p.id === "p-fresh").source).toBe("persisted")

  // a malformed view (non-array, non-{ok:false}) is an unobservable read too —
  // it must never close anything
  const res4 = await m.reconcileWithVenue(null)
  expect(res4.ok).toBe(false)
  expect(m.openPositions().find((p) => p.id === "p-fresh").source).toBe("persisted")
})

test("peak ratchet is one-way and halted stays null: 100 → 95 (drawdown 5%, peak 100) → 110 (peak 110)", async () => {
  const m = await boot()
  const s1 = await m.observePerpsWallet(walletAdapter({ equityUsd: 100, at: T(8) }), { now: Date.parse(T(8)) })
  expect(s1.runningPeakUsd).toBe(100)
  expect(s1.drawdownFromPeakPct).toBe(0)
  expect(s1.halted).toBeNull()

  const s2 = await m.observePerpsWallet(walletAdapter({ equityUsd: 95, at: T(9) }), { now: Date.parse(T(9)) })
  expect(s2.runningPeakUsd).toBe(100) // peak still 100
  expect(s2.drawdownFromPeakPct).toBe(5)
  expect(s2.halted).toBeNull()

  const s3 = await m.observePerpsWallet(walletAdapter({ equityUsd: 110, at: T(10) }), { now: Date.parse(T(10)) })
  expect(s3.runningPeakUsd).toBe(110) // one-way ratchet up
  expect(s3.drawdownFromPeakPct).toBe(0)
  expect(s3.halted).toBeNull()
})

test("day rollover re-baselines dayStartEquityUsd on the UTC day change while the peak ratchet persists", async () => {
  const m = await boot()
  const d1 = Date.parse("2026-01-01T12:00:00.000Z")
  const d1b = Date.parse("2026-01-01T20:00:00.000Z")
  const d2 = Date.parse("2026-01-02T12:00:00.000Z")

  const s1 = await m.observePerpsWallet(walletAdapter({ equityUsd: 100, at: new Date(d1).toISOString() }), { now: d1 })
  expect(s1.dayKey).toBe("2026-01-01")
  expect(s1.dayStartEquityUsd).toBe(100)

  const s1b = await m.observePerpsWallet(walletAdapter({ equityUsd: 90, at: new Date(d1b).toISOString() }), { now: d1b })
  expect(s1b.dayStartEquityUsd).toBe(100) // same-day baseline preserved
  expect(s1b.dayLossPct).toBe(10)

  const s2 = await m.observePerpsWallet(walletAdapter({ equityUsd: 95, at: new Date(d2).toISOString() }), { now: d2 })
  expect(s2.dayKey).toBe("2026-01-02")
  expect(s2.dayStartEquityUsd).toBe(95) // re-seeded from current equity
  expect(s2.dayLossPct).toBe(0)
  expect(s2.runningPeakUsd).toBe(100) // peak survives the day roll
  expect(s2.drawdownFromPeakPct).toBe(5)
})

test("recordClose and recordReduction on an unknown positionId are refused loudly (no silent no-op)", async () => {
  const m = await boot()
  expect(() =>
    m.recordClose({ positionId: "ghost", fill: { id: "x", average: 100 }, fundingObservations: [] })
  ).toThrow(/ghost/)
  expect(() => m.recordReduction({ positionId: "ghost", filledSize: 1, avgPrice: 100 })).toThrow(/ghost/)
})

test("recordReduction refuses a reduction larger than the open size (over-close is never silent)", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition({ id: "p-small", size: 1 }), now: Date.parse(T(10)) })
  expect(() => m.recordReduction({ positionId: "p-small", filledSize: 2, avgPrice: 100 })).toThrow(/exceeds/)
})

test("observePerpsWallet reports an unobservable wallet honestly and never fabricates a snapshot", async () => {
  const m = await boot()
  const bad = {
    observeEquity: async () => ({ ok: false, reason: "equity-unobservable" }),
    positionView: async () => []
  }
  const res = await m.observePerpsWallet(bad, { now: Date.parse(T(8)) })
  expect(res.ok).toBe(false)
  expect(res.reason).toBe("equity-unobservable")
})

// ── Fix round 1 (review): not-latched boot reconcile, interior funding boundary,
//    accrued reduction P&L, corrupt-store refusal, netted-record drain ──────

test("F1 a FAILED boot reconcile is not latched: the failure is surfaced and the next successful read DOES reconcile", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition({ id: "p-boot", symbol: "BTC/USDC:USDC", side: "long" }), now: Date.parse(T(10)) })

  const flaky = {
    observeEquity: async () => ({ ok: true, equityUsd: 100, currency: "USDT", at: T(10) }),
    positionView: async () => {
      throw new Error("venue read hiccup")
    }
  }
  const r1 = await m.observePerpsWallet(flaky, { now: Date.parse(T(10)) })
  expect(r1.ok).toBe(true) // the equity observation itself succeeded
  expect(r1.reconcile).toBeDefined() // the reconcile failure is surfaced, NOT swallowed
  expect(r1.reconcile.ok).toBe(false)
  expect(r1.reconcile.reason).toContain("venue read hiccup")

  // Second call with a healthy read MUST run reconcile (not latched by the failure):
  // the venue-only SOL row gets adopted and p-boot (absent from the observable
  // venue) is honestly closed-unobserved.
  const healthy = {
    observeEquity: async () => ({ ok: true, equityUsd: 100, currency: "USDT", at: T(10, 5) }),
    positionView: async () => [venueRow("SOL/USDC:USDC", "long")]
  }
  const r2 = await m.observePerpsWallet(healthy, { now: Date.parse(T(10, 5)) })
  expect(r2.reconcile.ok).toBe(true)
  expect(m.openPositions().map((p) => p.id)).toEqual(["venue:SOL/USDC:USDC:long"])
  expect(m.openPositions()[0].source).toBe("venue-observed")
})

test("F2 hourly-spaced in-hold funding observations (an interior gap of EXACTLY one interval) capture every boundary ⇒ observed, accrual included", async () => {
  const m = await boot()
  m.trackOpen({ position: openPosition(), now: Date.parse(T(10)) }) // notional 200
  const res = m.recordClose({
    positionId: "0xopen1",
    fill: { id: "f6", symbol: "BTC/USDC:USDC", side: "sell", filled: 2, average: 110, status: "closed", at: T(12) },
    fundingObservations: [
      { rate: 0.001, at: T(10, 30) },
      { rate: 0.002, at: T(11, 30) } // exactly one FUNDING_INTERVAL after the prior in-hold obs
    ],
    now: Date.parse(T(12))
  })
  // gaps: open→10:30 = 30m, 10:30→11:30 = exactly 1h (interior, captured by the
  // 11:30 bookend), 11:30→close 12:00 = 30m ⇒ 0 missed boundaries ⇒ observed
  expect(res.fundingAccrual).toBe("observed")
  expect(res.reason).toContain("funding accrual")
  expect(res.realizedPnlUsd).toBeCloseTo(20.6, 5) // (0.001+0.002)×200 = 0.6 → 20 + 0.6
})

test("F3 partial reductions book realized P&L at EVERY reduction: the round-trip total equals the verified-fill sum (gain and loss)", async () => {
  const m = await boot()
  // gain path: size 2 @ 100, reduce 1 @ 105, close 1 @ 110 ⇒ (105−100)+(110−100) = 15
  m.trackOpen({ position: openPosition({ id: "p-gain", size: 2, entryPrice: 100 }), now: Date.parse(T(10)) })
  const r1 = m.recordReduction({ positionId: "p-gain", filledSize: 1, avgPrice: 105, now: Date.parse(T(10, 30)) })
  expect(r1.realizedAccruedUsd).toBe(5)
  expect(r1.size).toBe(1)
  const c1 = m.recordReduction({ positionId: "p-gain", filledSize: 1, avgPrice: 110, now: Date.parse(T(10, 40)) })
  expect(c1.realizedPnlUsd).toBe(15)
  expect(m.openPositions()).toHaveLength(0)

  // symmetric loss path: reduce 1 @ 95, close 1 @ 110 ⇒ (95−100)+(110−100) = 5, NOT 10
  m.trackOpen({ position: openPosition({ id: "p-loss", size: 2, entryPrice: 100 }), now: Date.parse(T(11)) })
  const l1 = m.recordReduction({ positionId: "p-loss", filledSize: 1, avgPrice: 95, now: Date.parse(T(11, 30)) })
  expect(l1.realizedAccruedUsd).toBe(-5)
  const lc = m.recordReduction({ positionId: "p-loss", filledSize: 1, avgPrice: 110, now: Date.parse(T(11, 40)) })
  expect(lc.realizedPnlUsd).toBe(5)
  expect(m.openPositions()).toHaveLength(0)
})

test("F4 corrupt or future-version stores are refused loudly on boot — never silently booted as empty and never overwritten", async () => {
  // positions store: unparseable
  const d = await mkdtemp(join(tmpdir(), "picc-lpm-"))
  dir = d
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = d
  await writeFile(join(d, "ccxt-perps-positions.json"), "{ definitely not json", "utf8")
  vi.resetModules()
  const m = await import("../services/livePositionManager.mjs")

  expect(m.storeHealth().positions).toEqual({ ok: false, reason: "positions-store-unreadable" })

  // mutations refuse loudly — never "boot clean as if empty"
  expect(() => m.trackOpen({ position: openPosition() })).toThrow(/positions-store-unreadable/)

  // reconcile refuses and does not close/relabel anything
  const rec = await m.reconcileWithVenue([])
  expect(rec.ok).toBe(false)
  expect(rec.reason).toBe("positions-store-unreadable")

  // the boot observer surfaces the failure instead of silently reconciling empty
  const w = await m.observePerpsWallet(walletAdapter({ equityUsd: 100, at: T(8) }), { now: Date.parse(T(8)) })
  expect(w.reconcile.ok).toBe(false)
  expect(w.reconcile.reason).toBe("positions-store-unreadable")

  // the corrupt file is still on disk, byte-for-byte — NOT wiped by an empty write
  expect(await readFile(join(d, "ccxt-perps-positions.json"), "utf8")).toBe("{ definitely not json")
})

test("F4a a future-version positions store is refused loudly (never downgraded to version 1 empty)", async () => {
  const d = await mkdtemp(join(tmpdir(), "picc-lpm-"))
  dir = d
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = d
  await writeFile(join(d, "ccxt-perps-positions.json"), JSON.stringify({ version: 2, positions: [{ id: "x" }] }), "utf8")
  vi.resetModules()
  const m = await import("../services/livePositionManager.mjs")

  expect(m.storeHealth().positions).toEqual({ ok: false, reason: "positions-store-version-mismatch" })
  expect(() => m.trackOpen({ position: openPosition() })).toThrow(/positions-store-version-mismatch/)
  expect(JSON.parse(await readFile(join(d, "ccxt-perps-positions.json"), "utf8")).version).toBe(2)
})

test("F4b a corrupt risk store is refused loudly — the day baseline is never silently reset and the file is preserved", async () => {
  const d = await mkdtemp(join(tmpdir(), "picc-lpm-"))
  dir = d
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = d
  await writeFile(join(d, "ccxt-perps-risk.json"), "{{ not json", "utf8")
  vi.resetModules()
  const m = await import("../services/livePositionManager.mjs")

  expect(m.storeHealth().risk).toEqual({ ok: false, reason: "risk-store-unreadable" })

  const w = await m.observePerpsWallet(walletAdapter({ equityUsd: 90, at: T(8) }), { now: Date.parse(T(8)) })
  expect(w.ok).toBe(false)
  expect(w.reason).toBe("risk-store-unreadable")
  expect(await readFile(join(d, "ccxt-perps-risk.json"), "utf8")).toBe("{{ not json")
})

test("F5 recordReduction drains ACROSS same-(symbol, side) records in open order instead of throwing while the netted group covers the fill", async () => {
  const m = await boot()
  // two of our opens on the SAME (symbol, side) that the venue netted into one row
  m.trackOpen({ position: openPosition({ id: "net-a", symbol: "BTC/USDC:USDC", side: "long", size: 1, entryPrice: 100, openedAt: T(9), openOrderId: "c-a" }), now: Date.parse(T(9)) })
  m.trackOpen({ position: openPosition({ id: "net-b", symbol: "BTC/USDC:USDC", side: "long", size: 1, entryPrice: 100, openedAt: T(10), openOrderId: "c-b" }), now: Date.parse(T(10)) })

  const closedA = m.recordReduction({ positionId: "net-a", filledSize: 1.5, avgPrice: 105, now: Date.parse(T(10, 30)) })
  expect(closedA.realizedPnlUsd).toBe(5) // net-a drained to zero: (105−100)×1
  const remaining = m.openPositions()
  expect(remaining).toHaveLength(1)
  expect(remaining[0].id).toBe("net-b") // the over-fill drained into the next record
  expect(remaining[0].size).toBe(0.5)
  expect(remaining[0].realizedAccruedUsd).toBe(2.5) // (105−100)×0.5 booked at THIS reduction

  // exceeding the NETTED group total still throws (the position is not flat-guard)
  expect(() =>
    m.recordReduction({ positionId: "net-b", filledSize: 1, avgPrice: 120, now: Date.parse(T(10, 40)) })
  ).toThrow(/exceeds/)
})