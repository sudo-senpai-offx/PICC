// WS-4 F5 — leader on-read guards (WS-4 R5.1 / R6.1 / AC-5). Pure display/feed
// guards evaluated at readout compose — no sweeper loop (D4). autoUnfollow:
// a leader with no position since > PICC_LEADER_AUTO_UNFOLLOW_DAYS (default 21)
// UTC days reads as status auto-unfollowed (reason leader:auto-unfollow:
// no-positions-21d). sevenDayStop: trailing-7-UTC-day sum of pnlAfterCosts on
// closed ideas vs equity breaches/floors PICC_LEADER_7D_STOP_PCT (default 5) →
// suppressed rows + leader:idea-suppressed:7d-stop until the window recovers.
// A bad env value is a named leader:deny:invalid-environment — never a silent
// pass. This is a display guard only: WS-4 has no execution path.

import { dayKeyOf } from "../u4faRisk.mjs"

const DAY_MS = 86400000
const round2 = (x) => Math.round(Number(x) * 100) / 100

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return { ok: true, value: fallback }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, raw }
  return { ok: true, value: n }
}

const utcDayStart = (value) => {
  const d = new Date(value)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function autoUnfollow(leader, { now = Date.now() } = {}) {
  const env = envNumber("PICC_LEADER_AUTO_UNFOLLOW_DAYS", 21)
  if (!env.ok) {
    return { active: true, reason: `leader:deny:invalid-environment (PICC_LEADER_AUTO_UNFOLLOW_DAYS=${env.raw})` }
  }
  if (!leader || typeof leader.lastPositionAt !== "string") {
    return { active: true, reason: "leader:auto-unfollow:no-positions-21d" }
  }
  const elapsed = Math.floor((utcDayStart(dayKeyOf(now)) - utcDayStart(dayKeyOf(leader.lastPositionAt))) / DAY_MS)
  if (elapsed > env.value) return { active: true, reason: "leader:auto-unfollow:no-positions-21d" }
  return { active: false, reason: null }
}

export function sevenDayStop(ideas, equityUsd, { now = Date.now() } = {}) {
  const env = envNumber("PICC_LEADER_7D_STOP_PCT", 5)
  if (!env.ok) {
    return {
      active: true,
      reason: `leader:deny:invalid-environment (PICC_LEADER_7D_STOP_PCT=${env.raw})`,
      pnlSum: null,
      lossPct: null,
      windowDays: 7,
      suppressed: []
    }
  }
  const today = utcDayStart(dayKeyOf(now))
  const windowStart = today - 6 * DAY_MS
  const inWindow = (Array.isArray(ideas) ? ideas : []).filter((r) => {
    if (!r || typeof r.closedAt !== "string") return false
    const t = utcDayStart(dayKeyOf(r.closedAt))
    return t >= windowStart && t <= today
  })
  const pnlSum = round2(inWindow.reduce((a, r) => a + Number(r.pnlAfterCosts ?? 0), 0))
  const lossPct = typeof equityUsd === "number" && equityUsd > 0 && pnlSum < 0 ? round2((-pnlSum / equityUsd) * 100) : 0
  const active = lossPct >= env.value
  return {
    active,
    reason: active ? "leader:idea-suppressed:7d-stop" : null,
    pnlSum,
    lossPct,
    windowDays: 7,
    suppressed: active ? inWindow.map((r) => ({ ...r })) : []
  }
}