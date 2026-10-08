// Wealth aggregator — partial totals with per-leg badges + window-adjusted
// snapshots (Task 5).
//
// Binding spec: design doc decisions 1 (real money only in the total; paper
// in a separate, never-summed section), 2 (partial totals + incomplete flag),
// 16 (transfer deduction is snapshot-window adjustment), and §4 honesty
// rules (absent excluded with reason; FX-missing excluded with reason, no
// stale-rate conversion, no total-nulling; manual never LIVE is enforced by
// the leg readers — the aggregator never relabels status).
//
// Pure functions, no store/IO (snapshot persistence belongs to Task 7's job).
// Clarifications applied: same-ccy settled legs from different providers sum
// normally (exclusion ran in Tasks 3/4 — never re-excluded here); legs
// arriving with fxSource "declared-parity" pass through unrelabeled.

import { convertToUsd as defaultConvertToUsd } from "./fx.mjs"

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toTimeMs(value) {
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

async function convertLeg(leg, readers, convertFn) {
  // Legs with no amount to convert (e.g. seeded ABSENT shells) stay excluded
  // with their own reason — never zero, never converted.
  if (leg.amount === null || leg.amount === undefined) {
    return { ...leg, usd: null }
  }
  // Declared-parity legs (USD + pegged stables labeled upstream) pass
  // through: no observation, no relabeling of fxSource/fxAt.
  if (leg.fxSource === "declared-parity") {
    const qty = toFiniteNumber(leg.amount)
    if (qty === null) return { ...leg, usd: null }
    return { ...leg, usd: qty }
  }
  const qty = toFiniteNumber(leg.amount)
  if (qty === null) {
    return { ...leg, usd: null, reason: leg.reason ?? `fx-invalid-amount:${leg.ccy}` }
  }
  const r = await convertFn(leg.ccy, qty, readers)
  if (r.usd === null || r.usd === undefined) {
    return { ...leg, usd: null, reason: r.reason ?? leg.reason ?? `fx-unobservable:${leg.ccy}` }
  }
  const { usd: _u, reason: _r, ...rest } = leg
  void _u
  void _r
  return { ...rest, ...(leg.reason !== undefined ? { reason: leg.reason } : {}), usd: r.usd, fxSource: r.fxSource, fxAt: r.fxAt }
}

function isConvertibleStatus(status) {
  // ABSENT legs are excluded with their own reason (honesty rule) — the
  // converter is never consulted for them.
  return status !== "ABSENT"
}

// overview({ legs, transfers, paper, readers?, convertFn? }) →
// { totalUsd, incomplete, legs, paper, transfers }.
// - totalUsd sums only successfully converted legs (never nulls the total;
//   FX-missing legs are excluded with reason).
// - Zero convertible legs (empty registry, all ABSENT, all FX-missing) yield
//   { totalUsd: null, incomplete: true, reason: "no-convertible-legs" } —
//   never a confident zero.
// - incomplete:true unless every in-scope leg is LIVE (decision 2).
// - paper passes through untouched (decision 1: structural separation — no
//   shared accumulator, no usd field added).
export async function overview({ legs = [], transfers = [], paper = null, readers = null, convertFn = defaultConvertToUsd } = {}) {
  const outLegs = []
  let totalUsd = 0
  let convertedCount = 0
  for (const leg of legs) {
    if (!isConvertibleStatus(leg.status)) {
      outLegs.push({ ...leg, usd: null })
      continue
    }
    const converted = await convertLeg(leg, readers, convertFn)
    if (converted.usd !== null) {
      totalUsd += converted.usd
      convertedCount += 1
    }
    outLegs.push(converted)
  }
  if (convertedCount === 0) {
    return { totalUsd: null, incomplete: true, reason: "no-convertible-legs", legs: outLegs, paper, transfers }
  }
  const incomplete = !legs.every((leg) => leg.status === "LIVE")
  return { totalUsd, incomplete, legs: outLegs, paper, transfers }
}

// snapshotAdjust({ legs, transfers, windowStart?, windowEnd? }) →
// { legs, excluded }. Each transfer dated inside the window marks its
// destination leg as an in-flight duplicate: the leg is removed from the
// snapshot legs once (decision 16); the transfer log itself is untouched and
// the exclusion is recorded as evidence. Transfers outside the window — or
// with unparseable dates — are ignored.
// Window bounds are inclusive; a null/undefined bound is unbounded on that
// side, so a fully null window matches every parseable-dated transfer
// (match-all). An unparseable transfer `at` never matches, even match-all.
export function snapshotAdjust({ legs = [], transfers = [], windowStart = null, windowEnd = null } = {}) {
  const startMs = windowStart === null || windowStart === undefined ? null : toTimeMs(windowStart)
  const endMs = windowEnd === null || windowEnd === undefined ? null : toTimeMs(windowEnd)
  const inWindow = (at) => {
    const t = toTimeMs(at)
    if (t === null) return false
    if (startMs !== null && t < startMs) return false
    if (endMs !== null && t > endMs) return false
    return true
  }
  const excludedIds = new Set()
  const excluded = []
  for (const t of transfers) {
    if (!t || typeof t !== "object") continue
    if (!inWindow(t.at)) continue
    if (typeof t.toLeg !== "string") continue
    if (!legs.some((leg) => leg.id === t.toLeg)) continue
    if (excludedIds.has(t.toLeg)) continue
    excludedIds.add(t.toLeg)
    excluded.push({ legId: t.toLeg, transferId: t.id ?? null, reason: "in-flight-duplicate" })
  }
  return { legs: legs.filter((leg) => !excludedIds.has(leg.id)), excluded }
}
