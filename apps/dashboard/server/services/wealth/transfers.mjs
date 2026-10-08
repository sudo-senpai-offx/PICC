// Wealth transfers Phase 1 (manual log validation) + Phase 2 (suggest-and-confirm).
//
// Binding spec (design doc, decisions 4/16):
// - Explicit transfer log with source-deduction; snapshots exclude in-flight
//   duplicates using transfers dated inside the window (see aggregate.mjs).
// - Phase 1: validateTransfer({ fromLeg, toLeg, ccy, amount, at, note }) with
//   named reasons — consumed by POST /api/wealth/transfers (Task 9). It never
//   writes; confirmation writes go through store.mjs addTransfer (which returns
//   { ok, transfer } wrappers) from explicit operator action only.
// - Phase 2: suggestTransfers({ legs, windowMs }) burst-matches opposite flows
//   (same ccy, amounts within 1%, timestamps within windowMs default 24h) into
//   { fromLeg, toLeg, ccy, amount, at, confidence: "candidate",
//   status: "unconfirmed" } candidates. NEVER auto-confirmed: this module holds
//   no store import for writing and emits candidates without ids.
//
// Read-only + pure mappers: no persistence here (store.mjs owns it), no static
// imports of store modules (dynamic `await import()` only, so tests stay
// hermetic and importing this module never touches a data dir — the leg
// registry is injectable via deps).

const DAY_MS = 86_400_000
const DEFAULT_WINDOW_MS = DAY_MS
const BURST_TOLERANCE = 0.01

function normCcy(v) {
  return String(v ?? "").trim().toUpperCase()
}

function msOrNaN(v) {
  if (v === undefined || v === null || v === "") return NaN
  return new Date(v).getTime()
}

async function knownLegIds(deps) {
  if (Array.isArray(deps.legs)) return new Set(deps.legs.map((l) => l?.id).filter((id) => typeof id === "string"))
  if (Array.isArray(deps.knownLegIds)) return new Set(deps.knownLegIds)
  const store = await import("./store.mjs")
  return new Set(store.listLegs().map((l) => l.id))
}

// ── Phase 1: manual transfer validation ──────────────────────────────────────

export async function validateTransfer(t = {}, deps = {}) {
  const fromLeg = typeof t.fromLeg === "string" ? t.fromLeg : ""
  const toLeg = typeof t.toLeg === "string" ? t.toLeg : ""
  if (fromLeg === "" || toLeg === "") {
    return { ok: false, reason: "transfer-leg-required" }
  }
  if (fromLeg === toLeg) {
    return { ok: false, reason: "transfer-same-leg" }
  }
  if (t.at === undefined || t.at === null || t.at === "") {
    return { ok: false, reason: "transfer-at-required" }
  }
  if (!Number.isFinite(msOrNaN(t.at))) {
    return { ok: false, reason: "transfer-at-invalid" }
  }
  if (normCcy(t.ccy) === "") {
    return { ok: false, reason: "transfer-ccy-required" }
  }
  const amount = Number(t.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "transfer-amount-invalid" }
  }
  const known = await knownLegIds(deps)
  const unknown = [fromLeg, toLeg].find((id) => !known.has(id))
  if (unknown !== undefined) {
    return { ok: false, reason: `transfer-unknown-leg:${unknown}` }
  }
  return { ok: true }
}

// ── Phase 2: burst-matched suggestions (pure, never writes) ──────────────────

function withinTolerance(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= BURST_TOLERANCE + Number.EPSILON
}

function flowEvents(legs) {
  const events = []
  for (const leg of legs) {
    if (!leg || typeof leg.id !== "string") continue
    if (Array.isArray(leg.flows)) {
      for (const f of leg.flows) {
        const amount = Number(f?.amount)
        const at = msOrNaN(f?.at)
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(at)) continue
        events.push({
          legId: leg.id,
          direction: f?.direction === "in" ? "in" : "out",
          ccy: normCcy(f?.ccy ?? leg.ccy),
          amount,
          at
        })
      }
    } else {
      // Balance sighting: a burst is two sightings of the same ccy/amount
      // close together in time on different legs.
      const amount = Number(leg.amount)
      const at = msOrNaN(leg.observedAt)
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(at)) continue
      events.push({ legId: leg.id, direction: null, ccy: normCcy(leg.ccy), amount, at })
    }
  }
  return events
}

export function suggestTransfers({ legs = [], windowMs = DEFAULT_WINDOW_MS } = {}) {
  const window = Number.isFinite(Number(windowMs)) && Number(windowMs) > 0
    ? Number(windowMs)
    : DEFAULT_WINDOW_MS
  const sightings = flowEvents(Array.isArray(legs) ? legs : [])
  const out = []
  const seen = new Set()
  for (let i = 0; i < sightings.length; i++) {
    for (let j = 0; j < sightings.length; j++) {
      if (i === j) continue
      const a = sightings[i]
      const b = sightings[j]
      if (a.legId === b.legId) continue
      if (a.ccy === "" || a.ccy !== b.ccy) continue
      // Opposite flows: an outflow pairs with an inflow; two bare sightings
      // pair earliest → latest. Same-direction explicit flows never pair.
      if (a.direction !== null && b.direction !== null && a.direction === b.direction) continue
      if (!withinTolerance(a.amount, b.amount)) continue
      if (Math.abs(a.at - b.at) > window) continue
      const from = a.direction === "in" ? b : a.direction === "out" ? a : (a.at <= b.at ? a : b)
      const to = from === a ? b : a
      if (from.direction === "in" || to.direction === "out") continue
      const key = `${from.legId}|${to.legId}|${from.ccy}|${from.amount}|${from.at}|${to.amount}|${to.at}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        fromLeg: from.legId,
        toLeg: to.legId,
        ccy: from.ccy,
        amount: to.amount,
        at: new Date(to.at).toISOString(),
        confidence: "candidate",
        status: "unconfirmed"
      })
    }
  }
  // Deterministic order: earliest arrival first.
  out.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime())
  return out
}
