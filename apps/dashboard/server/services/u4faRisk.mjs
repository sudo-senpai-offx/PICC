/**
 * U4FA risk layer — spec docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md T10/M5.
 *
 * The 4-factor blueprint's risk mapping, U4FA-owned. Two day-key realities
 * coexist in PICC (Decision B, pinned 2026-08-30):
 *
 *  - The legacy autopilot knobs (`dailyLossLimitPct` / `maxDailyTrades`) keep
 *    their local-midnight accounting in autopilot.mjs — unchanged, tests stay.
 *  - This module runs its OWN UTC day-key (`new Date(now).toISOString()
 *    .slice(0,10)`), carrying the blueprints -5% daily-loss barrier and the
 *    10/day proposal counter against 00:00 GMT. The deviation from the spec's
 *    wording "trips the existing daily-loss refusal" is intentional and
 *    recorded in the u4fa-config.mjs header comment.
 *
 * Everything here is pure + a tiny day-state latch so the interventions
 * `tradeGate` (T11) and the decision-engine tick (M8) can gate U4FA proposals
 * without acquiring the autopilot's knobs.
 */

export const U4FA_RISK_PCT = 0.5 // 0.5% of balance per trade (Decision A)
export const U4FA_MIN_UNITS = 1 // honest ≥1-unit floor, declared when it binds
export const U4FA_DAILY_LOSS_LIMIT_PCT = 5 // -5% -> halt until next UTC day
export const U4FA_MAX_DAILY_PROPOSALS = 10 // 10/day, counted on proposals per UTC day
export const U4FA_POST_LOSS_COOLDOWN_MS = 900000 // 15 min anti-revenge proposal throttle

const round2 = (x) => Math.round(x * 100) / 100

/** UTC day-key for a timestamp — the U4FA risk layer's own 00:00 GMT boundary. */
export function dayKeyOf(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

/** Milliseconds at 00:00:00.000Z of a `YYYY-MM-DD` day-key. */
export function utcDayStartMs(dayKey) {
  return Date.parse(`${dayKey}T00:00:00.000Z`)
}

/**
 * Decision A — U4FA-sized amount: `max(1, balance * riskPct/100)` computed at
 * proposal time. `floorApplied` declares honestly when the ≥1-unit floor binds
 * (the proposal surfaces it; it is never silently rounded).
 */
export function u4faAmountFor(balance, { riskPct = U4FA_RISK_PCT } = {}) {
  const pct = Number(riskPct) || U4FA_RISK_PCT
  const raw = round2((Number(balance) || 0) * (pct / 100))
  return {
    amount: Math.max(U4FA_MIN_UNITS, raw),
    floorApplied: raw < U4FA_MIN_UNITS,
    riskPct: pct
  }
}

/**
 * Realized PnL of one UTC day from the paper ledger's closed entries. Only
 * entries with a parseable `closedAt` are counted — an unobservable timestamp
 * never contributes to the barrier.
 */
export function pnlByUtcDay({ closed = [], dayKey }) {
  let sum = 0
  for (const c of closed) {
    if (!c?.closedAt) continue
    const t = Date.parse(c.closedAt)
    if (!Number.isFinite(t)) continue // unobservable timestamp -> never counted
    if (dayKeyOf(t) === dayKey) sum += Number(c.pnl) || 0
  }
  return round2(sum)
}

/**
 * Latest resolved loss detection feed for the post-loss throttle: newest of
 * (a) paper-ledger closed losses by `closedAt`, and (b) accuracy-ledger
 * misses by `resolvedAt` (falling back to `entryTs`). null when nothing
 * resolved a loss — the throttle only ever suppresses on observed fact.
 */
export function lastLossAtFrom({ closed = [], resolved = [] }) {
  const ts = (v) => {
    const t = Date.parse(v)
    return Number.isFinite(t) && t > 0 ? t : 0
  }
  let latest = 0
  for (const c of closed) {
    if (c?.pnl != null && Number(c.pnl) < 0) latest = Math.max(latest, ts(c.closedAt))
  }
  for (const e of resolved) {
    if (e?.result === "miss") latest = Math.max(latest, ts(e.resolvedAt ?? e.entryTs))
  }
  return latest || null
}

/**
 * Pure proposal gate. All three guards must pass for a U4FA proposal to be
 * created. Reasons are stable, greppable strings (`daily loss barrier`,
 * `daily proposal cap`, `post-loss cooldown`).
 */
export function checkProposalGate({
  now = Date.now(),
  dayStartBalance,
  pnl = 0,
  proposalsToday = 0,
  lastLossAt = null,
  dailyLossLimitPct = U4FA_DAILY_LOSS_LIMIT_PCT,
  maxDailyProposals = U4FA_MAX_DAILY_PROPOSALS,
  postLossCooldownMs = U4FA_POST_LOSS_COOLDOWN_MS
} = {}) {
  const dayKey = dayKeyOf(now)
  const start = Number(dayStartBalance)
  // Barrier: daily PnL at or below -dailyLossLimitPct of the UTC-day starting
  // balance halts new proposals until the next UTC day (00:00 GMT rollover).
  if (Number.isFinite(start) && start > 0) {
    const limit = round2(start * (Number(dailyLossLimitPct) || 0) / 100)
    if (pnl <= -limit) {
      return {
        ok: false,
        dayKey,
        reason: `daily loss barrier (-$${Math.abs(pnl)} = -${round2((Math.abs(pnl) / start) * 100)}% of $${start} UTC-day start)`
      }
    }
  }
  // Cap: the 11th U4FA proposal in one UTC day is refused (counter counts
  // created proposals, per Decision B "10/day proposal counter").
  if (Number(proposalsToday) >= Number(maxDailyProposals)) {
    return { ok: false, dayKey, reason: `daily proposal cap ${maxDailyProposals} reached` }
  }
  // Anti-revenge throttle: suppress NEW proposals 15 min after the last
  // resolved loss. It never blocks approving/ rejecting an already-pending
  // proposal.
  if (lastLossAt != null && now - Number(lastLossAt) < Number(postLossCooldownMs)) {
    return { ok: false, dayKey, reason: "post-loss cooldown 15m in effect" }
  }
  return { ok: true, dayKey }
}

// ---------------------------------------------------------------------
// UTC day-state latch (module-owned counter + day-start balance snapshot)
// ---------------------------------------------------------------------
let day = { key: null, proposals: 0, dayStartBalance: null }

/** Current UTC-day state, lazily rolled over at the 00:00 GMT key boundary. */
export function riskDayState({ now = Date.now(), balance }) {
  const key = dayKeyOf(now)
  if (day.key !== key) day = { key, proposals: 0, dayStartBalance: balance }
  if (day.dayStartBalance == null) day.dayStartBalance = balance
  return { ...day }
}

/** Bump the created-proposal counter for the UTC day (first call of the day snapshots the balance). */
export function recordU4faProposal({ now = Date.now(), balance }) {
  const st = riskDayState({ now, balance })
  day.proposals += 1
  return { ...day }
}

/** Test seam + engine reset — drops the day latch (next read re-arms fresh). */
export function resetU4faRiskState() {
  day = { key: null, proposals: 0, dayStartBalance: null }
}