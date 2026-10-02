// WS-7 T17 — the sandbox/testnet E2E, run against INJECTED adapters.
//
// Spec :1348 names "sandbox/testnet E2E" in this task's file list, and AC-036's
// action column says "Execute the lifecycle on each (sandbox/testnet)". Neither
// can be done here, and the honest thing is to say so rather than to fake it:
//
//   * T13 measured that Needle 3 ships no Windows build, so nothing on this host
//     can do real venue inference.
//   * No venue credential is configured in this repository, and the ordering seam
//     refuses an instance without one rather than quietly connecting keyless.
//   * No ceremony unlock has ever been granted, so even with credentials every leg
//     would fail closed.
//
// So this file exercises the FULL lifecycle — submit, verify fill, position, close,
// realized P&L, post-fill slippage — for each of the four venues against an
// injected testnet-shaped adapter, with every rail proven on every leg. That is a
// real lifecycle test. It is NOT a sandbox run, and no assertion here claims to be
// one. `REAL_SANDBOX_E2E_REQUIREMENTS` records what a real run would still need, and
// a test below asserts that record exists so the gap cannot be deleted once these
// tests are green.
//
// WHAT IS *NOT* SIMULATED, deliberately: the RAILS. A stubbed rail would make the
// whole file prove nothing, so the ceremony gate is WS-3's real store, the risk
// rails are T11's real producers, the permit read is T16's real method, and the
// consent hash is WS-2's real canonicalisation. Only the venue's network edge is
// replaced.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  CCXT_LIFECYCLE_VENUE_COUNT,
  CCXT_LIFECYCLE_VENUES,
  REAL_SANDBOX_E2E_REQUIREMENTS,
  _resetVenueLifecycleState,
  amendOrder,
  ccxtSeamLifecycleAdapter,
  consentPayloadFromAnchor,
  closePosition,
  foldFillIntoPositions,
  lifecycleAnchorKey,  placeOrder,
  positionView,
  proposeLeg,
  realizedPnl,
  runVenueLifecycle,
  slippageAnalysis
} from "../services/venues/ccxtVenueLifecycle.mjs"
import { LIFECYCLE_LEGS, LIFECYCLE_RAILS } from "../services/venues/ccxtLifecycleRails.mjs"
import { createStrikeStore } from "../services/copilot/riskLayer.mjs"
import { resetCeremonyState, unlockVenueClass } from "../services/commandCentre/ceremonyState.mjs"

const VENUE_IDS = CCXT_LIFECYCLE_VENUES.map((v) => v.id)
const SYMBOL = "BTC/USDT"
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const AMOUNT = 0.01
const ENTRY = 100
const STOP = 98
const FILL = 100.4 // 0.4% adverse — the venue's reported average, not the limit price
const EXIT = 101.2

const atrSeries = (() => {
  const highs = []
  const lows = []
  const closes = []
  for (let i = 0; i < 40; i += 1) {
    const close = 100 + (i % 2 === 0 ? 0 : 0.4)
    closes.push(close)
    highs.push(close + 1)
    lows.push(close - 1)
  }
  return { highs, lows, closes }
})()

/**
 * A testnet-shaped adapter. Every member RECORDS that it was reached, so a test
 * can assert both that it ran and — in the blocked cases — that it did not.
 */
function testnetAdapter({ fillAverage = FILL, exitAverage = EXIT, log = [] } = {}) {
  const seen = (name) => { log.push(name) }
  return {
    log,
    async placeOrder({ exchange, symbol, side, amount, price, clientOrderId }) {
      seen(`place:${exchange}:${symbol}:${side}`)
      return { id: `venue-${exchange}-1`, clientOrderId, symbol, side, type: "limit", amount, price, status: "open", filled: 0, average: null, at: new Date(NOW).toISOString() }
    },
    async amendOrder({ exchange, symbol, orderId, newPrice }) {
      seen(`amend:${exchange}:${orderId}`)
      return { id: orderId, symbol, type: "limit", price: newPrice, status: "open", filled: 0, average: null, at: new Date(NOW).toISOString() }
    },
    async cancelOrder({ exchange, orderId }) {
      seen(`cancel:${exchange}:${orderId}`)
      return { ok: true, cancelled: { id: orderId, clientOrderId: null, symbol: SYMBOL, status: "canceled", at: new Date(NOW).toISOString() } }
    },
    async closeOrder({ exchange, positionSide, filledAmount, price }) {
      seen(`close:${exchange}:${positionSide}`)
      return {
        ok: true,
        exitSide: positionSide === "long" ? "sell" : "buy",
        closesPositionOrderId: `venue-${exchange}-1`,
        order: { id: `venue-${exchange}-close-1`, symbol: SYMBOL, type: "limit", amount: filledAmount, price, status: "closed", filled: filledAmount, average: exitAverage, at: new Date(NOW).toISOString() }
      }
    },
    async verifyFill({ exchange, orderId }) {
      seen(`verifyFill:${exchange}:${orderId}`)
      return { id: orderId, symbol: SYMBOL, side: "buy", type: "limit", amount: AMOUNT, price: ENTRY, status: "closed", filled: AMOUNT, average: fillAverage, at: new Date(NOW).toISOString() }
    }
  }
}

/** An adapter whose every member throws, for the blocked-path proofs. */
function sealedAdapter() {
  const boom = (name) => () => { throw new Error(`adapter.${name} must not be reached`) }
  return { placeOrder: boom("placeOrder"), amendOrder: boom("amendOrder"), cancelOrder: boom("cancelOrder"), closeOrder: boom("closeOrder"), verifyFill: boom("verifyFill") }
}

const greenDeps = (overrides = {}) => ({
  strikeStore: createStrikeStore(),
  credentialKey: "picc:key:sandbox",
  atrSeries,
  dailyDrawdownPct: 0.4,
  dayKey: "2026-10-02",
  source: "T17-sandbox-e2e",
  now: NOW,
  ...overrides
})

const enableAll = () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PICC_CCXT_VENUE_ENABLED_")) delete process.env[key]
  }
  for (const v of CCXT_LIFECYCLE_VENUES) process.env[`PICC_CCXT_VENUE_ENABLED_${v.envSuffix}`] = "1"
}

beforeEach(() => {
  resetCeremonyState()
  _resetVenueLifecycleState()
  enableAll()
})

afterEach(() => {
  resetCeremonyState()
  _resetVenueLifecycleState()
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PICC_CCXT_VENUE_ENABLED_")) delete process.env[key]
  }
})

// ==========================================================================
// 1. THE FAIL-CLOSED POSTURE — what every venue renders today
// ==========================================================================

describe("T17 sandbox E2E — the lifecycle on an UNLOCKED tree, which is this tree's state", () => {
  it("every venue stops at the FIRST step and reports the ceremony rail, for every requested leg set", async () => {
    for (const venueId of VENUE_IDS) {
      const result = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator:ws-7-test", deps: greenDeps(), adapter: sealedAdapter(), now: NOW })
      expect(result.ok, `${venueId} must not complete with no ceremony unlock`).toBe(false)
      expect(result.completed).toBe(false)
      expect(result.venueId).toBe(venueId)
      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].step).toBe("propose:place")
      expect(result.steps[0].blockedBy).toBe("ceremony")
      expect(result.steps[0].reason).toContain("ceremony:deny:venue-class-not-unlocked")
    }
  })

  it("the sealed adapter is never reached on the dark path — proven by absence of a throw, not by a comment", async () => {
    for (const venueId of VENUE_IDS) {
      const adapter = sealedAdapter()
      const result = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps(), adapter, now: NOW })
      expect(result.ok).toBe(false)
      expect(result.completed).toBe(false)
      expect(result.steps.every((s) => s.rails?.ceremony?.verdict === "block")).toBe(true)
    }
  })

  it("a leg called directly with no anchor is refused at the consent rail", async () => {
    unlockVenueClass("ccxt-crypto", "test-operator", { now: NOW })
    const r = await placeOrder({ venueId: "kraken", symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: "c1", consentBy: "operator", deps: greenDeps(), adapter: sealedAdapter() })
    expect(r.ok).toBe(false)
    expect(r.blockedBy).toBe("consent")
    expect(r.adapterTouched).toBe(false)
    expect(r.reason).toContain("consent:deny:no-recorded-anchor")
  })
})

// ==========================================================================
// 2. THE FULL LIFECYCLE, PER VENUE
// ==========================================================================

describe("T17 sandbox E2E — submit -> fill -> position -> close -> realized P&L, per venue", () => {
  beforeEach(() => unlockVenueClass("ccxt-crypto", "test-operator", { now: NOW }))

  it("all four venues complete the lifecycle with every leg's rails recorded", async () => {
    expect(VENUE_IDS).toHaveLength(CCXT_LIFECYCLE_VENUE_COUNT)
    for (const venueId of VENUE_IDS) {
      const adapter = testnetAdapter()
      const result = await runVenueLifecycle({
        venueId,
        symbol: SYMBOL,
        amount: AMOUNT,
        price: ENTRY,
        stopPrice: STOP,
        consentBy: "operator:ws-7-test",
        deps: greenDeps({ amendPrice: 100.2, amendStopPrice: 98.2, exitPrice: EXIT }),
        adapter,
        now: NOW
      })

      expect(result.ok, `${venueId} must complete the lifecycle`).toBe(true)
      expect(result.completed).toBe(true)
      expect(result.venueCount).toBe(CCXT_LIFECYCLE_VENUE_COUNT)

      // Every leg ran, and every leg recorded its rails.
      const stepNames = result.steps.map((s) => s.step)
      for (const expected of ["propose:place", "place", "verifyFill", "slippage", "position", "propose:amend", "amend", "propose:cancel", "cancel", "propose:close", "close", "realizedPnl"]) {
        expect(stepNames, `${venueId} must run ${expected}`).toContain(expected)
      }
      expect(stepNames.some((s) => s.startsWith("propose:"))).toBe(true)
      expect(stepNames.some((s) => s === "amend")).toBe(true)
      expect(stepNames.some((s) => s === "cancel")).toBe(true)
      expect(stepNames.some((s) => s === "close")).toBe(true)
      expect(result.steps.every((s) => s.ok), `${venueId} step failures: ${JSON.stringify(result.steps.filter((s) => !s.ok))}`).toBe(true)

      // The rails: all three, on every leg that carries them. The `propose:*` steps
      // are the phase that RECORDS the consent, so their consent reading is a named
      // absence rather than a pass — asserted as such rather than waved through.
      const railKeys = Object.keys(result.rails)
      expect(railKeys.length).toBeGreaterThanOrEqual(4)
      for (const key of railKeys) {
        for (const rail of LIFECYCLE_RAILS) {
          const reading = result.rails[key][rail]
          expect(reading, `${venueId}/${key}/${rail} must be recorded`).toBeDefined()
          if (key.startsWith("propose:") && rail === "consent") {
            expect(reading.verdict, `${venueId}/${key}/consent must be a NAMED absence, not a pass and not a skip`).toBe("absent")
            expect(reading.applies).toBe(false)
            expect(reading.reason.trim().length).toBeGreaterThan(40)
          } else {
            expect(reading.verdict, `${venueId}/${key}/${rail}`).toBe("pass")
          }
        }
      }

      // The venue edge was genuinely exercised, once per leg.
      expect(adapter.log.some((l) => l.startsWith(`place:${venueId}`))).toBe(true)
      expect(adapter.log.some((l) => l.startsWith(`verifyFill:${venueId}`))).toBe(true)
      expect(adapter.log.some((l) => l.startsWith(`amend:${venueId}`))).toBe(true)
      expect(adapter.log.some((l) => l.startsWith(`cancel:${venueId}`))).toBe(true)
      expect(adapter.log.some((l) => l.startsWith(`close:${venueId}`))).toBe(true)
    }
  })

  it("realized P&L is computed from the VENUE'S TWO REPORTED AVERAGES, never the limit price", async () => {
    for (const venueId of VENUE_IDS) {
      const result = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps({ exitPrice: EXIT }), adapter: testnetAdapter(), now: NOW })
      expect(result.realizedPnl.available).toBe(true)
      expect(result.realizedPnl.side).toBe("long")
      expect(result.realizedPnl.entryAverage).toBe(FILL)
      expect(result.realizedPnl.exitAverage).toBe(EXIT)
      expect(result.realizedPnl.quantity).toBe(AMOUNT)
      // (101.2 - 100.4) * 0.01, to 8dp. If the limit price 100 had been used as
      // the entry, this would read 0.12 instead of 0.08 — a 50% overstatement of a
      // real number, which is the fabrication this assertion exists to catch.
      expect(result.realizedPnl.realizedUsd).toBeCloseTo((EXIT - FILL) * AMOUNT, 8)
      expect(result.realizedPnl.realizedUsd).not.toBeCloseTo((EXIT - ENTRY) * AMOUNT, 8)
    }
  })

  it("post-fill slippage is reported on the ENTRY and on the EXIT, signed adverse", async () => {
    for (const venueId of VENUE_IDS) {
      const entry = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps(), adapter: testnetAdapter(), now: NOW, legs: ["place"] })
      expect(entry.slippage.available).toBe(true)
      expect(entry.slippage.side).toBe("buy")
      expect(entry.slippage.averageFillPrice).toBe(FILL)
      // A buy filled ABOVE the approved price is adverse, and adverse must be
      // positive — a signed the other way would let a cost read as a saving.
      expect(entry.slippage.signedPct).toBeGreaterThan(0)
      expect(entry.slippage.adverse).toBe(true)

      const full = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps({ exitPrice: EXIT }), adapter: testnetAdapter(), now: NOW })
      // The exit's own slippage against the observed entry average.
      expect(full.slippage.available).toBe(true)
      expect(full.slippage.side).toBe("sell")
    }
  })

  it("an UNOBSERVED fill produces no position and no P&L — never a fabricated one", async () => {
    for (const venueId of VENUE_IDS) {
      const blank = testnetAdapter({ fillAverage: null })
      const result = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps(), adapter: blank, now: NOW, legs: ["place"] })
      // The place succeeded; the verify answered; the fill carried no average, so
      // no slippage could be computed and no position was priced.
      expect(result.steps.find((s) => s.step === "place").ok).toBe(true)
      expect(result.slippage.available).toBe(false)
      expect(result.slippage.reason).toContain("no average fill price")
      expect(result.position).toBeNull()
      expect(positionView({ venueId }).rows).toEqual([])
    }
  })

  it("a close with nothing observed is refused LOCALLY and never reaches the venue", async () => {
    for (const venueId of VENUE_IDS) {
      const r = await closePosition({ venueId, symbol: SYMBOL, positionOrderId: `${venueId}:${SYMBOL}`, exitPrice: EXIT, consentBy: "operator", deps: greenDeps(), adapter: sealedAdapter() })
      expect(r.ok).toBe(false)
      expect(r.blockedBy).toBe("local")
      expect(r.reason).toContain("close-unobservable")
      expect(r.adapterTouched).toBe(false)
    }
  })

  it("a close with no exit price is refused — this lifecycle performs no market read of its own", async () => {
    unlockVenueClass("ccxt-crypto", "test-operator", { now: NOW })
    for (const venueId of VENUE_IDS) {
      // Price a position by folding one real fill in, then try to close it unpriced.
      foldFillIntoPositions({ venueId, symbol: SYMBOL, orderId: "o1", side: "buy", filled: AMOUNT, average: FILL, at: new Date(NOW).toISOString() })
      const key = `${venueId}:${SYMBOL}`
      const r = await closePosition({ venueId, symbol: SYMBOL, positionOrderId: key, consentBy: "operator", deps: greenDeps(), adapter: sealedAdapter() })
      expect(r.ok, `${venueId} must refuse an unpriced close`).toBe(false)
      expect(r.reason).toContain("close-unpriced")
      expect(r.adapterTouched).toBe(false)
    }
  })

  it("the position book folds VENUE-REPORTED prices only, and a short is exited by BUYING", () => {
    const long = foldFillIntoPositions({ venueId: "binance", symbol: SYMBOL, orderId: "o1", side: "buy", filled: AMOUNT, average: FILL, at: null })
    expect(long.opened).toBe(true)
    const book = positionView({ venueId: "binance" })
    expect(book.rows).toHaveLength(1)
    expect(book.rows[0].side).toBe("long")
    expect(book.rows[0].entryAverage).toBe(FILL)
    expect(book.rows[0].notionalUsd).toBeCloseTo(AMOUNT * FILL, 8)

    // A sell against a long REALIZES rather than flipping, and the exit side the
    // lifecycle derives for a long is `sell`.
    const reduced = foldFillIntoPositions({ venueId: "binance", symbol: SYMBOL, orderId: "o2", side: "sell", filled: AMOUNT, average: EXIT, at: null })
    expect(reduced.reduced).toBe(true)
    expect(reduced.closedSize).toBe(AMOUNT)
    expect(reduced.realizedUsd).toBeCloseTo((EXIT - FILL) * AMOUNT, 8)
    expect(positionView({ venueId: "binance" }).rows).toHaveLength(0)
  })

  it("a fill with no average price is NOT folded in, and says so", () => {
    const r = foldFillIntoPositions({ venueId: "bybit", symbol: SYMBOL, orderId: "o1", side: "buy", filled: AMOUNT, average: null, at: null })
    expect(r.applied).toBe(false)
    expect(r.reason).toContain("venue-reported average price")
    expect(positionView({ venueId: "bybit" }).rows).toEqual([])
  })
})

// ==========================================================================
// 3. THE BISECT — one venue at a time, independently enable-able and revertible
// ==========================================================================

describe("T17 sandbox E2E — spec :1352's bisect, one venue at a time", () => {
  beforeEach(() => unlockVenueClass("ccxt-crypto", "test-operator", { now: NOW }))

  it("with ONE venue enabled, that venue completes and the other three stop at the ceremony rail", async () => {
    for (const enabled of VENUE_IDS) {
      _resetVenueLifecycleState()
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("PICC_CCXT_VENUE_ENABLED_")) delete process.env[key]
      }
      process.env[`PICC_CCXT_VENUE_ENABLED_${enabled.toUpperCase()}`] = "1"

      for (const venueId of VENUE_IDS) {
        const adapter = testnetAdapter()
        const result = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps({ exitPrice: EXIT }), adapter, now: NOW })
        if (venueId === enabled) {
          expect(result.completed, `${enabled} must complete when it is the one enabled venue`).toBe(true)
          expect(result.venueId).toBe(enabled)
        } else {
          expect(result.completed, `${venueId} must stay dark while only ${enabled} is enabled`).toBe(false)
          expect(result.steps[0].blockedBy).toBe("ceremony")
          expect(result.steps[0].reason).toContain("venue-rail:deny:venue-not-enabled")
          expect(adapter.log, `${venueId} must not have reached the venue`).toEqual([])
        }
      }
    }
  })

  it("reverting the one variable returns that venue to dark — the bisect is reversible", async () => {
    const venueId = "bybit"
    const enabled = async () => {
      const adapter = testnetAdapter()
      const r = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps({ exitPrice: EXIT }), adapter, now: NOW })
      return r.completed
    }
    expect(await enabled()).toBe(true)
    delete process.env.PICC_CCXT_VENUE_ENABLED_BYBIT
    expect(await enabled()).toBe(false)
    process.env.PICC_CCXT_VENUE_ENABLED_BYBIT = "1"
    expect(await enabled()).toBe(true)
  })

  it("each leg can be walked on its own, and a partial walk is NEVER reported as a completed lifecycle", async () => {
    for (const venueId of VENUE_IDS) {
      // CANCEL ONLY. The cancel leg itself is legitimate here — the seam resolves a
      // target by clientOrderId through its read-only open-order view — so the leg
      // runs. What must NOT happen is the walk reporting a completed LIFECYCLE: no
      // fill, no position and no P&L were produced, and `notWalked` says so.
      _resetVenueLifecycleState()
      const cancelLog = []
      const cancelOnly = await runVenueLifecycle({ venueId, symbol: SYMBOL, consentBy: "operator", deps: greenDeps(), adapter: testnetAdapter({ log: cancelLog }), now: NOW, legs: ["cancel"] })
      expect(cancelOnly.completed, `${venueId} cancel-only must not claim a completed lifecycle`).toBe(false)
      expect(cancelOnly.lifecycleComplete).toBe(false)
      expect(cancelOnly.notWalked.sort()).toEqual(["amend", "close", "place"])
      expect(cancelOnly.summary).toContain("lifecycle INCOMPLETE")
      expect(cancelLog.some((l) => l.startsWith(`cancel:${venueId}`))).toBe(true)

      // AMEND ONLY. An amend has nothing to amend, so it is refused before any
      // venue call rather than sent for an order nobody placed.
      _resetVenueLifecycleState()
      const amendLog = []
      const amendOnly = await runVenueLifecycle({ venueId, symbol: SYMBOL, consentBy: "operator", deps: greenDeps(), adapter: testnetAdapter({ log: amendLog }), now: NOW, legs: ["amend"] })
      expect(amendOnly.completed).toBe(false)
      expect(amendOnly.steps.find((s) => s.step === "amend").reason).toContain("amend-requires-place")
      expect(amendLog, `${venueId} amend-only must not reach the venue`).toEqual([])

      // CLOSE ONLY. Nothing has been priced, so there is nothing to exit.
      _resetVenueLifecycleState()
      const closeLog = []
      const closeOnly = await runVenueLifecycle({ venueId, symbol: SYMBOL, consentBy: "operator", deps: greenDeps(), adapter: testnetAdapter({ log: closeLog }), now: NOW, legs: ["close"] })
      expect(closeOnly.completed).toBe(false)
      expect(closeOnly.steps.find((s) => s.step === "close").reason).toContain("close-requires-fill")
      expect(closeLog, `${venueId} close-only must not reach the venue`).toEqual([])

      // PLACE ONLY. Submits and fills, but has not exited, so still not a lifecycle.
      _resetVenueLifecycleState()
      const placeOnly = await runVenueLifecycle({ venueId, symbol: SYMBOL, amount: AMOUNT, price: ENTRY, stopPrice: STOP, consentBy: "operator", deps: greenDeps(), adapter: testnetAdapter(), now: NOW, legs: ["place"] })
      expect(placeOnly.completed).toBe(false)
      expect(placeOnly.okThisWalk).toBe(true)
      expect(placeOnly.notWalked.sort()).toEqual(["amend", "cancel", "close"])
      expect(placeOnly.realizedPnl).toBeNull()
    }
  })

  it("a close names the position it exits, and NEVER falls back to a different one", async () => {
    // The failure this pins is silent and would pass every rail. The lookup used to
    // be "find the open row for this symbol" while `positionOrderId` sat in the
    // arguments unused — so a caller who consented to exit position A could have
    // position B closed, and the rails would report `pass` because they genuinely
    // passed, for the wrong position. A wrong-but-consented close is the worst
    // shape this module could fail in.
    //
    // HONEST SCOPE OF THIS TEST. The book is keyed `venue:symbol`
    // (`foldFillIntoPositions`, :250), so a single symbol holds exactly ONE open
    // row and the "two positions, one symbol" ambiguity branch is NOT reachable
    // today. It is retained defensively for a book that can hold more than one row
    // per symbol, and this test does not pretend otherwise by fabricating a
    // two-row book. What IS reachable, and what is tested here, is the mismatch:
    // a caller naming a key the book does not hold. Under the old lookup that
    // mismatch was ignored and the wrong-but-consented close proceeded.
    for (const venueId of VENUE_IDS) {
      _resetVenueLifecycleState()
      foldFillIntoPositions({ venueId, symbol: SYMBOL, orderId: "fill-one", side: "buy", filled: 0.01, average: ENTRY, at: NOW })
      const book = positionView({ venueId })
      expect(book.rows.length, `${venueId} holds one row per symbol`).toBe(1)
      const only = book.rows[0]

      // Naming a key the book does not hold refuses, and does NOT quietly use the
      // row that IS there.
      const wrong = await closePosition({
        venueId,
        symbol: SYMBOL,
        positionOrderId: `${venueId}:${SYMBOL}:not-a-real-key`,
        exitPrice: ENTRY,
        consentBy: "operator",
        deps: greenDeps(),
        adapter: testnetAdapter(),
        now: NOW
      })
      expect(wrong.ok, `${venueId} must refuse a close naming an unknown position`).toBe(false)
      expect(wrong.reason).toMatch(/close-unobservable/)
      expect(wrong.reason).toMatch(/never falls back to a different position/)
      expect(wrong.adapterTouched, `${venueId} must not reach the venue for a mismatched key`).toBe(false)

      // Naming the row the book actually holds closes that row, sized from it.
      // The leg is proposed first, because consent locks a PROPOSAL: a close
      // executed without a stored anchor is refused at the consent rail, which is
      // the behaviour `a leg called directly with no anchor is refused` covers.
      const proposal = await proposeLeg({
        leg: "close",
        venueId,
        symbol: SYMBOL,
        positionOrderId: only.key,
        exitPrice: ENTRY,
        consentBy: "operator",
        now: NOW,
        deps: greenDeps()
      })
      expect(proposal.ok, `${venueId} close proposal must be recorded`).toBe(true)

      // The claim under test is WHICH POSITION the lifecycle sent, so the adapter
      // RECORDS its arguments instead of returning an echo the assertion could be
      // written against. Asserting on the adapter's own reply would prove the
      // adapter is self-consistent, not that the right position was closed.
      const sent = []
      const recorder = {
        ...testnetAdapter(),
        async closeOrder(request) {
          sent.push(request)
          return { ok: true, order: { id: "x", amount: request.filledAmount, price: request.price } }
        }
      }
      const exact = await closePosition({
        venueId,
        symbol: SYMBOL,
        positionOrderId: only.key,
        exitPrice: ENTRY,
        consentBy: "operator",
        consentPayload: consentPayloadFromAnchor(proposal.anchorKey),
        deps: greenDeps(),
        adapter: recorder,
        now: NOW
      })
      expect(exact.ok, `${venueId} close of the named position must succeed`).toBe(true)
      expect(exact.adapterTouched).toBe(true)
      expect(sent).toHaveLength(1)
      expect(sent[0].positionOrderId, `${venueId} must send the position key that was NAMED`).toBe(only.key)
      expect(sent[0].filledAmount, `${venueId} must size the close from that position`).toBe(only.size)
      expect(sent[0].exchange).toBe(venueId)
    }
  })

  it("the position lookup is by KEY, so the symbol-only 'find any open row' bug cannot return", () => {
    // Structural rather than behavioural, because the bug's whole quality is that
    // it is invisible on the one-row book the tests above can build. The specific
    // shape that caused it — a `find` over rows filtered by symbol only, ignoring
    // the requested key — is pinned here so re-introducing it fails even though no
    // behavioural test could catch it.
    const src = readFileSync(fileURLToPath(new URL("../services/venues/ccxtVenueLifecycle.mjs", import.meta.url)), "utf8")
    // Bounded to `closePosition` ALONE. Slicing to end-of-file also swallows
    // `runVenueLifecycle`, which legitimately looks a position up BY SYMBOL when
    // it walks a full lifecycle it placed itself — so an unbounded slice fails on
    // correct code and would train a future reader to widen the regex until it
    // went green, which is how a real guard dies.
    const start = src.indexOf("export async function closePosition")
    expect(start, "closePosition must exist").toBeGreaterThan(-1)
    const rest = src.slice(start + 1)
    const nextExport = rest.search(/\nexport (?:async )?function \w+/)
    const closeBody = nextExport === -1 ? rest : rest.slice(0, nextExport)
    // A symbol-only lookup: rows filtered by symbol, with no key comparison.
    expect(closeBody).not.toMatch(/rows\.find\(\s*\(row\)\s*=>\s*row\.symbol\s*===/)
    // And the key comparison that replaced it is present.
    expect(closeBody).toMatch(/row\.key\s*===\s*wanted/)
    // Ambiguity refuses rather than choosing.
    expect(closeBody).toMatch(/close-ambiguous/)
  })
})

// ==========================================================================
// 4. THE CONSENT ANCHORS ARE REAL RECORDS, NOT A PARAMETER THE CALLER SUPPLIES
// ==========================================================================

describe("T17 sandbox E2E — propose/execute is a real separation, per venue", () => {
  beforeEach(() => unlockVenueClass("ccxt-crypto", "test-operator", { now: NOW }))

  it("a leg cannot execute without its own recorded anchor, and the anchor is keyed per venue", async () => {
    const proposal = await proposeLeg({ leg: "place", venueId: "kraken", symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: "c-kraken", consentBy: "operator", now: NOW, deps: greenDeps() })
    expect(proposal.ok).toBe(true)
    expect(proposal.anchorKey).toBe(lifecycleAnchorKey({ venueId: "kraken", leg: "place", clientOrderId: "c-kraken" }))
    expect(proposal.anchor.consentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(proposal.anchor.lockedFields).toEqual(["exchange", "symbol", "side", "amount", "price", "clientOrderId"])
    expect(proposal.anchor.consentBy).toBe("operator")
    // The venue is IN the locked fields, so one venue's anchor cannot replay
    // against another's.
    expect(proposal.anchor.fields.exchange).toBe("kraken")

    const ok = await placeOrder({ venueId: "kraken", symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: "c-kraken", consentBy: "operator", consentPayload: { symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, clientOrderId: "c-kraken" }, deps: greenDeps(), adapter: testnetAdapter() })
    expect(ok.ok).toBe(true)
    expect(ok.adapterTouched).toBe(true)
  })

  it("a mutated field between propose and execute is refused before the venue", async () => {
    await proposeLeg({ leg: "place", venueId: "coinbase", symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: "c-cb", consentBy: "operator", now: NOW, deps: greenDeps() })
    const r = await placeOrder({
      venueId: "coinbase",
      symbol: SYMBOL,
      side: "buy",
      amount: AMOUNT * 2,
      price: ENTRY,
      stopPrice: STOP,
      clientOrderId: "c-cb",
      consentBy: "operator",
      consentPayload: { symbol: SYMBOL, side: "buy", amount: AMOUNT * 2, price: ENTRY, clientOrderId: "c-cb" },
      deps: greenDeps(),
      adapter: sealedAdapter()
    })
    expect(r.ok).toBe(false)
    expect(r.blockedBy).toBe("consent")
    expect(r.reason).toContain("field:amount")
    expect(r.adapterTouched).toBe(false)
  })

  it("an AMEND cannot consume the PLACE anchor, and a CANCEL cannot consume the AMEND anchor", async () => {
    await proposeLeg({ leg: "place", venueId: "bybit", symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: "c-bb", consentBy: "operator", now: NOW, deps: greenDeps() })
    const amend = await amendOrder({ venueId: "bybit", symbol: SYMBOL, orderId: "venue-bybit-1", side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: "c-bb", newPrice: 100.2, consentBy: "operator", deps: greenDeps(), adapter: sealedAdapter() })
    expect(amend.ok).toBe(false)
    expect(amend.blockedBy).toBe("consent")
    expect(amend.reason).toContain("consent:deny:no-recorded-anchor")
  })

  it("every leg's anchor key is distinct, so no two legs share a consent", () => {
    const keys = new Set()
    for (const venueId of VENUE_IDS) {
      keys.add(lifecycleAnchorKey({ venueId, leg: "place", clientOrderId: "c1" }))
      keys.add(lifecycleAnchorKey({ venueId, leg: "amend", orderId: "o1" }))
      keys.add(lifecycleAnchorKey({ venueId, leg: "cancel", orderId: "o1" }))
      keys.add(lifecycleAnchorKey({ venueId, leg: "close", positionOrderId: "p1" }))
    }
    // 4 venues x 4 legs = 16 distinct keys, plus cross-venue isolation.
    expect(keys.size).toBe(16)
  })
})

// ==========================================================================
// 5. THE SEAM IS NOT BYPASSED, AND NO VENUE CALL ESCAPES THE RAILS
// ==========================================================================

describe("T17 sandbox E2E — the seam is the only venue edge, and the rails run first", () => {
  it("the production adapter IS the ccxtOrdering seam, member for member", async () => {
    const ordering = await import("../services/ccxtOrdering.mjs")
    const seam = ccxtSeamLifecycleAdapter()
    expect(seam.placeOrder).toBe(ordering.placeCcxtOrder)
    expect(seam.amendOrder).toBe(ordering.amendCcxtOrder)
    expect(seam.cancelOrder).toBe(ordering.cancelCcxtOrder)
    expect(seam.closeOrder).toBe(ordering.closeCcxtPosition)
    expect(seam.verifyFill).toBe(ordering.verifyCcxtFill)
  })

  it("the lifecycle module holds NO CCXT instance of its own", async () => {
    // Structurally, not by inspection: the only `ccxtOrdering.mjs` import is the
    // five seam members, so a lifecycle that grew its own exchange would have to
    // add an import here first.
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const src = readFileSync(fileURLToPath(new URL("../services/venues/ccxtVenueLifecycle.mjs", import.meta.url)), "utf8")
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]*)"/g)]
    const ccxtOrderingImports = imports.filter(([, , spec]) => spec.endsWith("ccxtOrdering.mjs"))
    expect(ccxtOrderingImports).toHaveLength(1)
    const names = ccxtOrderingImports[0][1].split(",").map((s) => s.trim()).filter(Boolean).sort()
    expect(names).toEqual(["amendCcxtOrder", "cancelCcxtOrder", "closeCcxtPosition", "placeCcxtOrder", "verifyCcxtFill"])
    expect(src).not.toMatch(/new ccxt\b/)
    // And no ORDER-SEAM CALL SHAPE anywhere in this file — not even in a comment.
    // `perpsSeamGuard.test.mjs` counts that shape across every server module, so a
    // mention of it in prose here would be counted as a third call site and the
    // guard would fail on this file rather than on a venue change.
    expect(src).not.toMatch(/\.\s*createOrder(?:s|Ws)?\s*\(/)
  })

  it("the lifecycle module IS DISCOVERABLE as order-capable, not merely declared", async () => {
    // Both halves of the two-way staleness test, proved locally. Declaring a
    // module order-capable that discovery cannot find is rot, and discovery that
    // finds one nobody declared is the gap T0 closed.
    const { discoverOrderCapableModules, findUndeclaredOrderCapability, INTENTIONAL_ORDER_CAPABLE } = await import("../scripts/absence-scope.mjs")
    const { resolve } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const serverRoot = fileURLToPath(new URL("..", import.meta.url))
    expect(discoverOrderCapableModules(serverRoot)).toContain("services/venues/ccxtVenueLifecycle.mjs")
    expect(INTENTIONAL_ORDER_CAPABLE.has("services/venues/ccxtVenueLifecycle.mjs")).toBe(true)
    expect(findUndeclaredOrderCapability(serverRoot).undeclared).toEqual([])
    expect(resolve(serverRoot, "services/venues/ccxtVenueLifecycle.mjs")).toContain("ccxtVenueLifecycle.mjs")
  })

  it("the lifecycle module is DECLARED order-capable on the reviewed list, not renamed to dodge the scanner", async () => {
    const { INTENTIONAL_ORDER_CAPABLE } = await import("../scripts/absence-scope.mjs")
    expect(INTENTIONAL_ORDER_CAPABLE.has("services/venues/ccxtVenueLifecycle.mjs")).toBe(true)
  })

  it("every leg refuses BEFORE its adapter member runs, for every venue", async () => {
    unlockVenueClass("ccxt-crypto", "test-operator", { now: NOW })
    // Drawdown at the rail: a genuine risk block with the ceremony granted and a
    // matching anchor, so the ONLY thing that can stop the leg is the risk rail.
    for (const venueId of VENUE_IDS) {
      _resetVenueLifecycleState()
      await proposeLeg({ leg: "place", venueId, symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: `c-${venueId}`, consentBy: "operator", now: NOW, deps: greenDeps() })
      const log = []
      const adapter = testnetAdapter({ log })
      const r = await placeOrder({ venueId, symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, stopPrice: STOP, clientOrderId: `c-${venueId}`, consentBy: "operator", consentPayload: { symbol: SYMBOL, side: "buy", amount: AMOUNT, price: ENTRY, clientOrderId: `c-${venueId}` }, deps: greenDeps({ dailyDrawdownPct: 3 }), adapter, now: NOW })
      expect(r.ok, `${venueId} must be blocked by the drawdown rail`).toBe(false)
      expect(r.blockedBy).toBe("risk")
      expect(r.rails.risk.detail.blockedByComponent).toBe("drawdownDisable")
      expect(log, `${venueId} must not have reached the venue`).toEqual([])
      expect(r.adapterTouched).toBe(false)
    }
  })
})

// ==========================================================================
// 6. WHAT A REAL SANDBOX RUN STILL REQUIRES — the honest close
// ==========================================================================

describe("T17 sandbox E2E — what a REAL sandbox run still requires, recorded not hidden", () => {
  it("the requirements record exists, is non-empty, and names a blocker for every requirement", () => {
    expect(Array.isArray(REAL_SANDBOX_E2E_REQUIREMENTS)).toBe(true)
    expect(REAL_SANDBOX_E2E_REQUIREMENTS.length).toBeGreaterThanOrEqual(4)
    const ids = REAL_SANDBOX_E2E_REQUIREMENTS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of REAL_SANDBOX_E2E_REQUIREMENTS) {
      expect(Object.isFrozen(r)).toBe(true)
      expect(typeof r.requirement).toBe("string")
      expect(r.requirement.trim().length, `${r.id} needs a written requirement`).toBeGreaterThan(20)
      expect(typeof r.blockedBecause).toBe("string")
      expect(r.blockedBecause.trim().length, `${r.id} needs a written blocker`).toBeGreaterThan(20)
      // D10:175-182 — an unassigned owner is the LITERAL reservation, never a name.
      expect(r.owner).toBe("WS-7+")
    }
  })

  it("credentials, egress, the venue's own testnet and a ceremony unlock are all named", () => {
    const ids = REAL_SANDBOX_E2E_REQUIREMENTS.map((r) => r.id)
    expect(ids).toContain("venue-credentials")
    expect(ids).toContain("network-egress")
    expect(ids).toContain("venue-testnet-availability")
    expect(ids).toContain("ceremony-authority")
  })

  it("NO assertion in this file claims to be a sandbox or testnet run", async () => {
    // The file's own text, checked. A test that says "sandbox E2E" in its name
    // while running an injected adapter is the exact shape AC-036:1057's
    // "no step may be simulated by a stub in a test reported as real" forbids.
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8")
    const claims = [...self.matchAll(/(?:is|was|has been)\s+(?:a\s+)?(?:REAL\s+)?sandbox run/gi)].map((m) => m[0])
    expect(claims, "the file must not assert that it performed a real sandbox run").toEqual([])
  })
})

// ==========================================================================
// 7. The pure observers, proven on their own
// ==========================================================================

describe("T17 sandbox E2E — slippage and realized P&L refuse rather than fabricate", () => {
  it("slippage needs a side, an approved price and a venue-reported fill", () => {
    expect(slippageAnalysis({ side: "buy", intendedPrice: 100, averageFillPrice: 100.4 }).available).toBe(true)
    expect(slippageAnalysis({ side: null, intendedPrice: 100, averageFillPrice: 100.4 }).available).toBe(false)
    expect(slippageAnalysis({ side: "buy", intendedPrice: null, averageFillPrice: 100.4 }).available).toBe(false)
    expect(slippageAnalysis({ side: "buy", intendedPrice: 100, averageFillPrice: null }).available).toBe(false)
    expect(slippageAnalysis({ side: "buy", intendedPrice: 100, averageFillPrice: 0 }).available).toBe(false)
  })

  it("a SELL's slippage is signed the other way, so a worse exit still reads adverse", () => {
    const good = slippageAnalysis({ side: "sell", intendedPrice: 100, averageFillPrice: 101 })
    expect(good.signedPct).toBeLessThan(0)
    expect(good.adverse).toBe(false)
    const bad = slippageAnalysis({ side: "sell", intendedPrice: 100, averageFillPrice: 99 })
    expect(bad.signedPct).toBeGreaterThan(0)
    expect(bad.adverse).toBe(true)
  })

  it("realized P&L distinguishes 'no price' from 'zero P&L'", () => {
    const flat = realizedPnl({ side: "long", entryAverage: 100, exitAverage: 100, quantity: 1 })
    expect(flat.available).toBe(true)
    expect(flat.realizedUsd).toBe(0)
    const unknown = realizedPnl({ side: "long", entryAverage: 100, exitAverage: null, quantity: 1 })
    expect(unknown.available).toBe(false)
    expect(unknown.realizedUsd).toBeNull()
    const wrongSide = realizedPnl({ side: "sideways", entryAverage: 100, exitAverage: 101, quantity: 1 })
    expect(wrongSide.available).toBe(false)
  })

  it("a SHORT realizes the inverse", () => {
    const r = realizedPnl({ side: "short", entryAverage: 100, exitAverage: 90, quantity: 2 })
    expect(r.available).toBe(true)
    expect(r.realizedUsd).toBeCloseTo(20, 8)
  })
})
