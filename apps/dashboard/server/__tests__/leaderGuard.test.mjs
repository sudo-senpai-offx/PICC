// WS-4 T4 — F5 leader on-read guards (WS-4 R5.1/R6.1/AC-5). autoUnfollow rides
// dayKeyOf UTC-day windows; sevenDayStop sums trailing-7-day closed-idea pnl vs
// account equity. Environment overrides honored; a bad env value is a named
// leader:deny:invalid-environment, never a silent pass. Both are pure — the
// readout, not the store, consults them.
import { afterEach, beforeEach, expect, test } from "vitest"

import { autoUnfollow, sevenDayStop } from "../services/copytrade/leaderGuard.mjs"

const DAY_MS = 86400000
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const isoOf = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toISOString()

const idea = (pnl, closedAt) => ({ id: "x", closedAt, pnlAfterCosts: pnl })

const leader = (lastPositionAt) => ({ id: "leader-1", source: "csv", lastPositionAt, ideas: [] })

beforeEach(() => {
  delete process.env.PICC_LEADER_AUTO_UNFOLLOW_DAYS
  delete process.env.PICC_LEADER_7D_STOP_PCT
})

afterEach(() => {
  delete process.env.PICC_LEADER_AUTO_UNFOLLOW_DAYS
  delete process.env.PICC_LEADER_7D_STOP_PCT
})

test("autoUnfollow: null lastPositionAt → active + leader:auto-unfollow:no-positions-21d", () => {
  expect(autoUnfollow(leader(null), { now: NOW })).toEqual({
    active: true,
    reason: "leader:auto-unfollow:no-positions-21d"
  })
})

test("autoUnfollow: a position today keeps the leader followed", () => {
  expect(autoUnfollow(leader(isoOf(0)), { now: NOW })).toEqual({ active: false, reason: null })
})

test("autoUnfollow: 20 UTC days without a position is not a breach", () => {
  expect(autoUnfollow(leader(isoOf(20)), { now: NOW })).toEqual({ active: false, reason: null })
})

test("autoUnfollow: exactly 21 UTC days is NOT yet older than 21 — still followed", () => {
  expect(autoUnfollow(leader(isoOf(21)), { now: NOW })).toEqual({ active: false, reason: null })
})

test("autoUnfollow: 22 UTC days without a position → auto-unfollowed with exact reason", () => {
  expect(autoUnfollow(leader(isoOf(22)), { now: NOW })).toEqual({
    active: true,
    reason: "leader:auto-unfollow:no-positions-21d"
  })
})

test("autoUnfollow: PICC_LEADER_AUTO_UNFOLLOW_DAYS override is honored", () => {
  process.env.PICC_LEADER_AUTO_UNFOLLOW_DAYS = "5"
  expect(autoUnfollow(leader(isoOf(6)), { now: NOW }).active).toBe(true)
  expect(autoUnfollow(leader(isoOf(5)), { now: NOW }).active).toBe(false)
})

test("autoUnfollow: a bad env value is a named leader:deny:invalid-environment", () => {
  process.env.PICC_LEADER_AUTO_UNFOLLOW_DAYS = "banana"
  expect(autoUnfollow(leader(isoOf(0)), { now: NOW })).toEqual({
    active: true,
    reason: "leader:deny:invalid-environment (PICC_LEADER_AUTO_UNFOLLOW_DAYS=banana)"
  })
})

test("sevenDayStop: trailing-7d pnl breaching 5% of equity → suppressed rows + leader:idea-suppressed:7d-stop", () => {
  const ideas = [idea(-30, isoOf(1)), idea(-30, isoOf(2)), idea(1000, isoOf(61))]
  const r = sevenDayStop(ideas, 1000, { now: NOW })
  expect(r.active).toBe(true)
  expect(r.reason).toBe("leader:idea-suppressed:7d-stop")
  expect(r.lossPct).toBe(6)
  expect(r.windowDays).toBe(7)
})

test("sevenDayStop: pnl exactly at the 5% floor is a breach (≥ floor)", () => {
  const r = sevenDayStop([idea(-50, isoOf(1))], 1000, { now: NOW })
  expect(r.active).toBe(true)
  expect(r.lossPct).toBe(5)
})

test("sevenDayStop: a recovered window surfaces the rows again (no suppression, no reason)", () => {
  const ideas = [idea(-10, isoOf(1)), idea(-10, isoOf(2)), idea(-10, isoOf(8))]
  const r = sevenDayStop(ideas, 1000, { now: NOW })
  expect(r.active).toBe(false)
  expect(r.reason).toBeNull()
  // the 8-day-old loss is not in the trailing window (window start = 6 days ago)
  expect(r.lossPct).toBe(2)
})

test("sevenDayStop: rows older than the 7-UTC-day window never count", () => {
  const r = sevenDayStop([idea(-3000, isoOf(8))], 1000, { now: NOW })
  expect(r.lossPct).toBe(0)
  expect(r.active).toBe(false)
})

test("sevenDayStop: unknown/zero equity is a named leader:deny:equity-unavailable — never a silent no-stop", () => {
  for (const equity of [null, undefined, 0, -5, NaN, "abc"]) {
    const r = sevenDayStop([idea(-60, isoOf(1))], equity, { now: NOW })
    expect(r).toEqual({
      active: true,
      reason: "leader:deny:equity-unavailable",
      pnlSum: null,
      lossPct: null,
      windowDays: 7
    })
  }
  expect(sevenDayStop(null, 1000, { now: NOW }).active).toBe(false)
})

test("sevenDayStop: a bad PICC_LEADER_7D_STOP_PCT is a named leader:deny:invalid-environment", () => {
  process.env.PICC_LEADER_7D_STOP_PCT = "zero"
  expect(sevenDayStop([idea(-60, isoOf(1))], 1000, { now: NOW }).reason).toBe(
    "leader:deny:invalid-environment (PICC_LEADER_7D_STOP_PCT=zero)"
  )
})