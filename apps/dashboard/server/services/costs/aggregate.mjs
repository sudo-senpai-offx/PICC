// Costs aggregator — day + all-time realized-cost scorecard (plan Task 5).
//
// Pure functions, no store/IO (persistence belongs to the Task 7 record job).
// Observed-only venues (spec decision 5): a venue row appears ONLY when
// observed fills or prior rollups exist for it — no pre-seeded rows, never a
// zero. Near-empty windows read as absences with reasons, never zeros (spec
// decision 10; wealth T5 precedent: no-convertible → null total + reason).
//
// Provenance (honesty rule): every number carries measured | modeled |
// modeled-with-calibrated-inputs. A summed total mixes legs, so totals take
// the weakest link — pure measured stays "measured"; any plain "modeled" leg
// drags the total to "modeled"; measured + calibrated (no plain modeled)
// reads "modeled-with-calibrated-inputs". Totals never overclaim measured;
// per-kind lines in `byKind` keep each leg's exact label.
//
// Rollup honesty: the Task 1 store keeps rollup totals without per-leg
// provenance, so rollup legs always enter all-time totals at the downgraded
// "modeled" label with `incomplete: true` and an explicit
// "rollup-provenance-unobserved" reason — a conservative trust downgrade,
// never an overclaim, regardless of any caller-supplied rollup.provenance. Rollups stamped with the window day are skipped with a
// "rollup-overlaps-window-day" reason: the day window is built from live
// fills, and callers must pass rollups for closed days only (the Task 7 job
// rolls up before fills prune), so same-day rollups would double-count.
//
// Attempts (Task 4 counters) ride each venue row as a separate `waste` line
// `{ refused, failed }` — never added into cost totals. Attempts for a venue
// with no observed costs never create a row; they surface as an
// "attempts-without-observed-costs" reason with `incomplete: true`.
//
// Shape:
// scorecard({ fills, rollups, attempts, window }) →
// { venues: [{ venue, day, allTime, waste }], totalUsd, provenance,
//   incomplete, reason, skipped, window }
// where day/allTime = { totalUsd (null + reason when absent), provenance
// (null when absent), reason (null when present), byKind: [{ kind, totalUsd,
// provenance }] }. Top-level totalUsd sums venue all-time totals; with no
// venue rows it is null with reason "no-observed-costs".

const KNOWN_PROVENANCE = new Set(["measured", "modeled", "modeled-with-calibrated-inputs"])

// Weakest-link rank: a total is only as trustworthy as its weakest leg.
const PROVENANCE_RANK = { measured: 0, "modeled-with-calibrated-inputs": 1, modeled: 2 }
const RANK_PROVENANCE = ["measured", "modeled-with-calibrated-inputs", "modeled"]

function weakestLink(provenances) {
  let worst = 0
  for (const p of provenances) worst = Math.max(worst, PROVENANCE_RANK[p] ?? 2)
  return RANK_PROVENANCE[worst]
}

function snapshotTz() {
  return process.env.PICC_SNAPSHOT_TZ || "Asia/Singapore"
}

function tzDateFor(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: snapshotTz() }).format(new Date(at))
}

function finiteOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Sum validated legs [{ kind, amountUsd, provenance }] into a window summary.
// Empty → null total + absence reason, never a zero.
function sumWindow(legs, absentReason) {
  if (legs.length === 0) {
    return { totalUsd: null, provenance: null, reason: absentReason, byKind: [] }
  }
  const byKind = new Map()
  for (const leg of legs) {
    let entry = byKind.get(leg.kind)
    if (!entry) {
      entry = { kind: leg.kind, totalUsd: 0, provenances: [] }
      byKind.set(leg.kind, entry)
    }
    entry.totalUsd += leg.amountUsd
    entry.provenances.push(leg.provenance)
  }
  const lines = [...byKind.values()]
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
    .map((e) => ({ kind: e.kind, totalUsd: e.totalUsd, provenance: weakestLink(e.provenances) }))
  return {
    totalUsd: lines.reduce((sum, l) => sum + l.totalUsd, 0),
    provenance: weakestLink(legs.map((l) => l.provenance)),
    reason: null,
    byKind: lines
  }
}

function wasteFor(attempts, venue) {
  if (attempts == null || typeof attempts !== "object") return null
  const entry = attempts[venue] ?? attempts[String(venue).toLowerCase()] ?? null
  if (entry == null || typeof entry !== "object") return null
  const refused = finiteOrNull(entry.refused)
  const failed = finiteOrNull(entry.failed)
  if (refused === null && failed === null) return null
  return { refused: refused ?? 0, failed: failed ?? 0 }
}

export function scorecard({ fills = [], rollups = [], attempts = {}, window = {} } = {}) {
  const skipped = []
  let incomplete = false
  const tz = snapshotTz()

  const rawDay = window?.day
  let windowDay = null
  let dayUnparseable = false
  if (rawDay === undefined || rawDay === null || rawDay === "") {
    try {
      windowDay = tzDateFor(Date.now())
    } catch {
      dayUnparseable = true
    }
  } else if (typeof rawDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) && Number.isFinite(Date.parse(`${rawDay}T12:00:00Z`))) {
    windowDay = rawDay
  } else {
    dayUnparseable = true
    incomplete = true
    skipped.push({ index: null, reason: "window-day-unparseable" })
  }

  // venue → { dayLegs: [], allLegs: [], seenAs }
  const venues = new Map()
  const touch = (venue) => {
    let row = venues.get(venue)
    if (!row) {
      row = { venue, dayLegs: [], allLegs: [] }
      venues.set(venue, row)
    }
    return row
  }

  const fillList = Array.isArray(fills) ? fills : []
  if (!Array.isArray(fills)) {
    incomplete = true
    skipped.push({ index: null, reason: "fills-not-array" })
  }
  fillList.forEach((fill, index) => {
    if (fill == null || typeof fill !== "object") {
      incomplete = true
      skipped.push({ index, reason: "fill-not-object" })
      return
    }
    const venue = String(fill.venue ?? "").trim()
    if (!venue) {
      incomplete = true
      skipped.push({ index, reason: "fill-venue-required" })
      return
    }
    const amountUsd = finiteOrNull(fill.amountUsd)
    if (amountUsd === null) {
      incomplete = true
      skipped.push({ index, venue, reason: "fill-amount-not-finite" })
      return
    }
    if (!KNOWN_PROVENANCE.has(fill.provenance)) {
      incomplete = true
      skipped.push({ index, venue, reason: `fill-provenance-unobserved:${String(fill.provenance ?? "")}` })
      return
    }
    const kind = String(fill.kind ?? "unknown")
    const leg = { kind, amountUsd, provenance: fill.provenance }
    const row = touch(venue)
    row.allLegs.push(leg)
    const t = Date.parse(fill.observedAt)
    if (!Number.isFinite(t)) {
      // Counted all-time (the cost was observed) but unbucketable by day.
      incomplete = true
      skipped.push({ index, venue, reason: "fill-observedAt-unparseable" })
      return
    }
    if (!dayUnparseable && tzDateFor(t) === windowDay) row.dayLegs.push(leg)
  })

  const rollupList = Array.isArray(rollups) ? rollups : []
  if (!Array.isArray(rollups)) {
    incomplete = true
    skipped.push({ index: null, reason: "rollups-not-array" })
  }
  rollupList.forEach((rollup, index) => {
    if (rollup == null || typeof rollup !== "object") {
      incomplete = true
      skipped.push({ index, reason: "rollup-not-object" })
      return
    }
    const venue = String(rollup.venue ?? "").trim()
    if (!venue) {
      incomplete = true
      skipped.push({ index, reason: "rollup-venue-required" })
      return
    }
    const rollupDay = rollup.tzDate ?? (rollup.at ? tzDateFor(rollup.at) : null)
    if (!dayUnparseable && rollupDay === windowDay) {
      // Day window is built from live fills; same-day rollups would double-count.
      incomplete = true
      skipped.push({ index, venue, reason: "rollup-overlaps-window-day" })
      return
    }
    const totals = rollup.totals
    if (totals == null || typeof totals !== "object" || Array.isArray(totals)) {
      incomplete = true
      skipped.push({ index, venue, reason: "rollup-totals-absent" })
      return
    }
    // Rollup legs carry no per-leg provenance in the Task 1 store: always
    // downgrade to "modeled" (conservative — never overclaims measured) and
    // say so, regardless of any caller-supplied rollup.provenance.
    incomplete = true
    skipped.push({ index, venue, reason: "rollup-provenance-unobserved" })
    const legs = []
    for (const [kind, raw] of Object.entries(totals)) {
      const amountUsd = finiteOrNull(raw)
      if (amountUsd === null) {
        incomplete = true
        skipped.push({ index, venue, reason: `rollup-amount-not-finite:${kind}` })
        continue
      }
      legs.push({ kind: String(kind), amountUsd, provenance: "modeled" })
    }
    if (legs.length === 0) {
      // Degenerate rollup (empty totals or every amount non-finite): every
      // leg already recorded in skipped[] above (or empty-totals below), so
      // create no venue row — absent, never a confident zero.
      if (Object.keys(totals).length === 0) {
        skipped.push({ index, venue, reason: "rollup-totals-empty" })
      }
      return
    }
    const row = touch(venue)
    row.allLegs.push(...legs)
  })

  const rows = [...venues.values()].sort((a, b) => (a.venue < b.venue ? -1 : a.venue > b.venue ? 1 : 0))
  const venueNames = new Set(rows.map((r) => r.venue))
  const attemptVenues = attempts != null && typeof attempts === "object" ? Object.keys(attempts) : []
  const unmatched = attemptVenues.filter(
    (v) => !venueNames.has(v) && !venueNames.has(String(v).toLowerCase())
  )
  if (unmatched.length > 0) {
    incomplete = true
    for (const v of unmatched) skipped.push({ index: null, venue: v, reason: `attempts-without-observed-costs:${v}` })
  }

  const venuesOut = rows.map((row) => ({
    venue: row.venue,
    day: dayUnparseable
      ? { totalUsd: null, provenance: null, reason: "window-day-unparseable", byKind: [] }
      : sumWindow(row.dayLegs, "no-observed-costs-for-day"),
    allTime: sumWindow(row.allLegs, "no-observed-costs"),
    // Waste line: attempt counts, structurally separate from cost totals.
    waste: wasteFor(attempts, row.venue)
  }))

  if (venuesOut.length === 0) {
    // Wealth T5 precedent: no convertible legs → null total + reason, never zero.
    return {
      venues: [],
      totalUsd: null,
      provenance: null,
      incomplete: true,
      reason: unmatched.length > 0 ? `no-observed-costs:${unmatched.map((v) => `attempts-without-observed-costs:${v}`).join(",")}` : "no-observed-costs",
      skipped,
      window: { tzDate: dayUnparseable ? null : windowDay, tz }
    }
  }

  const totals = venuesOut.map((v) => v.allTime).filter((s) => s.totalUsd !== null)
  if (totals.length === 0) {
    // Defense-in-depth: rows exist but no valid all-time legs (should be
    // unreachable after per-source validation) — null total + reason, never
    // a confident zero.
    return {
      venues: venuesOut,
      totalUsd: null,
      provenance: null,
      incomplete: true,
      reason: "no-observed-costs",
      skipped,
      window: { tzDate: dayUnparseable ? null : windowDay, tz }
    }
  }
  const totalUsd = totals.reduce((sum, s) => sum + s.totalUsd, 0)
  return {
    venues: venuesOut,
    totalUsd,
    provenance: weakestLink(totals.map((s) => s.provenance)),
    incomplete,
    reason: null,
    skipped,
    window: { tzDate: dayUnparseable ? null : windowDay, tz }
  }
}
