import { describe, expect, it, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import {
  dayKeyOf,
  utcDayStartMs,
  u4faAmountFor,
  pnlByUtcDay,
  lastLossAtFrom,
  checkProposalGate,
  riskDayState,
  recordU4faProposal,
  resetU4faRiskState
} from "../services/u4faRisk.mjs"

const DAY = "2026-03-10"
const DAY_START = Date.parse(`${DAY}T00:00:00.000Z`) // 2026-03-10T00:00:00Z
const NEXT_DAY_ONE_SEC = DAY_START + 24 * 3600 * 1000 + 1000 // 2026-03-11T00:00:01Z

describe("u4faRisk — day-key (Decision B: 00:00 GMT, U4FA-owned)", () => {
  it("the UTC day-key rolls exactly at the ISO date boundary", () => {
    expect(dayKeyOf(`${DAY}T00:00:00.000Z`)).toBe(DAY)
    expect(dayKeyOf(`${DAY}T23:59:59.999Z`)).toBe(DAY)
    expect(dayKeyOf(`2026-03-11T00:00:00.000Z`)).toBe("2026-03-11")
  })

  it("utcDayStartMs maps a day-key to its 00:00:00Z instant", () => {
    expect(utcDayStartMs(DAY)).toBe(DAY_START)
    expect(dayKeyOf(DAY_START + 1000)).toBe(DAY) // 00:00:01 GMT is still the same UTC day
  })
})

describe("u4faRisk — Decision A amount (three balances × three percents)", () => {
  const BALANCES = [100, 1000, 10000]
  const PCTS = [0.5, 1, 2]
  const expected = {
    100: { 0.5: { amount: 1, floor: true }, 1: { amount: 1, floor: false }, 2: { amount: 2, floor: false } },
    1000: { 0.5: { amount: 5, floor: false }, 1: { amount: 10, floor: false }, 2: { amount: 20, floor: false } },
    10000: { 0.5: { amount: 50, floor: false }, 1: { amount: 100, floor: false }, 2: { amount: 200, floor: false } }
  }
  for (const bal of BALANCES) {
    for (const pct of PCTS) {
      it(`balance $${bal} × ${pct}% → $${expected[bal][pct].amount}${expected[bal][pct].floor ? " (floor declared)" : ""}`, () => {
        const r = u4faAmountFor(bal, { riskPct: pct })
        expect(r.amount).toBe(expected[bal][pct].amount)
        expect(r.floorApplied).toBe(expected[bal][pct].floor)
        expect(r.riskPct).toBe(pct)
      })
    }
  }

  it("the ≥1-unit floor binds exactly when raw cents fall below 1 unit, and is declared", () => {
    expect(u4faAmountFor(200, { riskPct: 0.5 })).toMatchObject({ amount: 1, floorApplied: false }) // raw = 1.00 exactly
    expect(u4faAmountFor(150, { riskPct: 0.5 })).toMatchObject({ amount: 1, floorApplied: true }) // raw = 0.75
    expect(u4faAmountFor(0, { riskPct: 0.5 })).toMatchObject({ amount: 1, floorApplied: true })
  })
})

describe("u4faRisk — daily-loss barrier (−X% of UTC-day start blocks next proposal)", () => {
  const starts = [1000, 5000, 10000]
  const pcts = [1, 5, 20]
  for (const start of starts) {
    for (const pct of pcts) {
      it(`start $${start} @ -${pct}%: exact boundary blocks, just above passes`, () => {
        const limit = start * (pct / 100)
        const exact = checkProposalGate({ now: DAY_START, dayStartBalance: start, pnl: -limit, dailyLossLimitPct: pct })
        expect(exact.ok).toBe(false)
        expect(exact.reason).toMatch(/daily loss barrier/)
        const above = checkProposalGate({ now: DAY_START, dayStartBalance: start, pnl: -limit + 0.01, dailyLossLimitPct: pct })
        expect(above.ok).toBe(true)
      })
    }
  }

  it("a win (positive daily PnL) never trips the barrier", () => {
    const g = checkProposalGate({ now: DAY_START, dayStartBalance: 1000, pnl: 500 })
    expect(g.ok).toBe(true)
  })

  it("an unobservable day-start balance skips the barrier honestly (no fabricated start)", () => {
    const g = checkProposalGate({ now: DAY_START, dayStartBalance: null, pnl: -99999 })
    expect(g.ok).toBe(true) // cannot verify a barrier against an unobserved start
  })
})

describe("u4faRisk — 10/day proposal cap (the 11th proposal in one UTC day is refused)", () => {
  it("proposal 10 passes, proposal 11 is refused with the cap reason", () => {
    expect(checkProposalGate({ now: DAY_START, proposalsToday: 9 }).ok).toBe(true)
    const tenth = checkProposalGate({ now: DAY_START, proposalsToday: 10 })
    expect(tenth.ok).toBe(false)
    expect(tenth.reason).toMatch(/daily proposal cap 10/)
    expect(checkProposalGate({ now: DAY_START, proposalsToday: 11 }).ok).toBe(false)
  })

  it("a custom maxDailyProposals clamp applies", () => {
    expect(checkProposalGate({ now: DAY_START, proposalsToday: 12, maxDailyProposals: 20 }).ok).toBe(true)
    expect(checkProposalGate({ now: DAY_START, proposalsToday: 20, maxDailyProposals: 20 }).ok).toBe(false)
  })
})

describe("u4faRisk — post-loss proposal throttle (15 min anti-revenge)", () => {
  it("suppresses NEW proposals while inside the 15 min window after a resolved loss", () => {
    expect(checkProposalGate({ now: DAY_START, lastLossAt: DAY_START - 899999 }).ok).toBe(false)
    const g = checkProposalGate({ now: DAY_START, lastLossAt: DAY_START - 899999 })
    expect(g.reason).toMatch(/post-loss cooldown/)
  })

  it("clears exactly at 15 min and never with no observed loss", () => {
    expect(checkProposalGate({ now: DAY_START, lastLossAt: DAY_START - 900000 }).ok).toBe(true)
    expect(checkProposalGate({ now: DAY_START, lastLossAt: null }).ok).toBe(true)
  })

  it("a 20-minute-old loss does not suppress", () => {
    expect(checkProposalGate({ now: DAY_START, lastLossAt: DAY_START - 20 * 60 * 1000 }).ok).toBe(true)
  })
})

describe("u4faRisk — loss/PNL feeds (paper ledger + accuracy ledger)", () => {
  it("pnlByUtcDay sums only same-UTC-day closed PnL and skips unobservable timestamps", () => {
    const closed = [
      { pnl: 12.5, closedAt: `${DAY}T09:00:00Z` },
      { pnl: -30, closedAt: `${DAY}T23:00:00Z` }, // same UTC day
      { pnl: 1000, closedAt: `2026-03-11T01:00:00Z` }, // next UTC day
      { pnl: -5, closedAt: "not-a-date" }, // unobservable -> skipped
      { pnl: 7, closedAt: null } // skipped
    ]
    expect(pnlByUtcDay({ closed, dayKey: DAY })).toBe(-17.5)
    expect(pnlByUtcDay({ closed, dayKey: "2026-03-11" })).toBe(1000)
    expect(pnlByUtcDay({ closed: [], dayKey: DAY })).toBe(0)
  })

  it("lastLossAtFrom reports the newest paper loss or ledger miss; null when none", () => {
    const closed = [
      { pnl: -10, closedAt: `${DAY}T08:00:00Z` },
      { pnl: 5, closedAt: `${DAY}T12:00:00Z` }, // a win is never a loss
      { pnl: -1, closedAt: `${DAY}T18:00:00Z` }
    ]
    const resolved = [{ result: "miss", resolvedAt: `${DAY}T19:00:00Z` }, { result: "hit", resolvedAt: `${DAY}T20:00:00Z` }]
    expect(lastLossAtFrom({ closed, resolved })).toBe(Date.parse(`${DAY}T19:00:00Z`))
    expect(lastLossAtFrom({ closed: [], resolved: [{ result: "hit", resolvedAt: `${DAY}T19:00:00Z` }] })).toBe(null)
    expect(lastLossAtFrom({ closed: [{ pnl: -3, closedAt: "junk" }], resolved: [] })).toBe(null)
    expect(lastLossAtFrom({ closed: [], resolved: [] })).toBe(null)
  })
})

describe("u4faRisk — UTC day latch (counters reset at 00:00:01 GMT)", () => {
  beforeEach(() => resetU4faRiskState())

  it("recordU4faProposal bumps the day counter and snapshots the day-start balance", () => {
    recordU4faProposal({ now: DAY_START, balance: 5000 })
    recordU4faProposal({ now: DAY_START + 30_000, balance: 4999 })
    expect(riskDayState({ now: DAY_START, balance: 5000 })).toMatchObject({ key: DAY, proposals: 2, dayStartBalance: 5000 })
  })

  it("after the 00:00 GMT rollover both counters reset and the balance re-snapshots", () => {
    recordU4faProposal({ now: DAY_START, balance: 5000 })
    recordU4faProposal({ now: DAY_START + 60_000, balance: 5000 })
    expect(riskDayState({ now: DAY_START + 60_000, balance: 5000 }).proposals).toBe(2)
    const rolled = riskDayState({ now: NEXT_DAY_ONE_SEC, balance: 4200 })
    expect(rolled).toMatchObject({ key: "2026-03-11", proposals: 0, dayStartBalance: 4200 })
    expect(dayKeyOf(NEXT_DAY_ONE_SEC)).toBe("2026-03-11")
  })

  it("resetU4faRiskState drops the latch entirely", () => {
    recordU4faProposal({ now: DAY_START, balance: 10 })
    resetU4faRiskState()
    expect(riskDayState({ now: DAY_START, balance: 99 }).proposals).toBe(0)
  })
})

describe("u4faRisk — config comment names the Decision B deviation", () => {
  it("the u4fa-config.mjs header records the UTC day-key deviation from autopilot's local-midnight knobs", () => {
    const path = join(fileURLToPath(new URL("..", import.meta.url)), "services", "u4faConfig.mjs")
    const src = readFileSync(path, "utf8")
    expect(src).toMatch(/Decision B/)
    expect(src).toMatch(/UTC day-key/)
    expect(src).toMatch(/autopilot/)
    expect(src).toMatch(/local-midnight/)
  })
})