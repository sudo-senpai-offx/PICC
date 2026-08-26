// PICC Cross-Platform Position Manager + Portfolio Risk.
//
// Aggregates OPEN exposure across every venue that holds positions today —
// the paper ledger and the ExpertOption demo session (tomorrow: CCXT/MetaApi
// adapters via the same normalized shape) — and answers the questions a
// multi-venue trader actually has:
//   • How much am I exposed to, per instrument and per venue, RIGHT NOW?
//   • What is my combined P&L today?
//   • Is a NEW position safe given everything already open?
//
// Honesty rules: every number is computed from real stores; venues with no
// data report zero counts rather than fabricated figures; risk checks are
// advisory (decision support), never silent order blockers.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const TRADING_DIR =
  process.env.PICC_TRADING_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const LEDGER_FILE = join(TRADING_DIR, "trading-ledger.json")
const DEMO_DEALS_FILE = join(TRADING_DIR, "trading-demo-deals.json")

async function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

/**
 * Aggregate all open positions across venues.
 * @returns {ok, venues[], byInstrument{}, totals{}, generatedAt}
 */
export async function aggregateOpenPositions() {
  const positions = []

  // ── Paper ledger ─────────────────────────────────────────────────────────
  const paper = await readJsonSafe(LEDGER_FILE, { positions: [], closed: [], signals: [] })
  for (const p of Array.isArray(paper.positions) ? paper.positions : []) {
    if (p?.status !== "open") continue
    positions.push({
      venue: "paper",
      id: String(p.id ?? ""),
      symbol: canonical(String(p.symbol ?? "")),
      side: p.side === "down" ? "down" : "up",
      entry: Number(p.entry) || 0,
      amount: Number(p.amount) || 0,
      openedAt: p.openedAt ?? null
    })
  }

  // ── ExpertOption demo deals (live session when connected) ────────────────
  try {
    const { getDemoSession } = await import("./autopilot.mjs")
    const session = getDemoSession()
    const open = session && session.connected ? session.deals() : []
    for (const d of Array.isArray(open) ? open : []) {
      positions.push({
        venue: "expertoption",
        id: String(d.serverId ?? ""),
        symbol: canonical(String(d.asset ?? d.assetId ?? "")),
        side: d.type === "put" ? "down" : "up",
        entry: Number(d.openPrice ?? d.strike ?? 0),
        amount: Number(d.amount) || 0,
        openedAt: d.openedAt ?? null
      })
    }
  } catch { /* autopilot unavailable — paper-only view */ }

  // ── Fold into per-instrument and per-venue views ─────────────────────────
  const byInstrument = {}
  const byVenue = {}
  let notional = 0
  for (const p of positions) {
    const size = Math.max(0, Number(p.amount) || 0)
    notional += size
    const inst = (byInstrument[p.symbol] ??= {
      symbol: p.symbol, totalSize: 0, positions: 0,
      weightedEntrySum: 0, venues: new Set(), sides: { up: 0, down: 0 }
    })
    inst.totalSize = round2(inst.totalSize + size)
    inst.positions += 1
    inst.weightedEntrySum += (Number(p.entry) || 0) * size
    inst.venues.add(p.venue)
    inst.sides[p.side] += 1

    const v = (byVenue[p.venue] ??= { venue: p.venue, totalSize: 0, positions: 0 })
    v.totalSize = round2(v.totalSize + size)
    v.positions += 1
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    positions,
    byInstrument: Object.fromEntries(
      Object.entries(byInstrument).map(([sym, i]) => [sym, {
        symbol: sym,
        totalSize: i.totalSize,
        positions: i.positions,
        avgEntry: i.totalSize > 0 ? round2(i.weightedEntrySum / i.totalSize) : null,
        venues: [...i.venues],
        hedged: i.sides.up > 0 && i.sides.down > 0
      }])
    ),
    venues: Object.values(byVenue),
    totals: {
      openPositions: positions.length,
      notional: round2(notional),
      instruments: Object.keys(byInstrument).length
    }
  }
}

function canonical(raw) {
  // Local mirror avoids a circular import with assetCatalog via autopilot.
  return String(raw ?? "").replace(/\s*\(otc\)/gi, "").replace(/[/\s.\-_]+/g, "").toUpperCase() || "UNKNOWN"
}

/** Combined realized P&L today across paper closed trades + settled demo deals. */
export async function combinedTodayPnl() {
  const today = new Date().toISOString().slice(0, 10)
  let paperPnl = 0
  let paperCount = 0
  let demoPnl = 0
  let demoCount = 0

  const paper = await readJsonSafe(LEDGER_FILE, { closed: [] })
  for (const t of Array.isArray(paper.closed) ? paper.closed : []) {
    if (!(t.closedAt ?? "").startsWith(today)) continue
    paperPnl += Number(t.pnl) || 0
    paperCount += 1
  }

  const demo = await readJsonSafe(DEMO_DEALS_FILE, { deals: [] })
  for (const d of Array.isArray(demo.deals) ? demo.deals : []) {
    if (!(d.closedAt ?? "").startsWith(today)) continue
    demoPnl += Number(d.profit) || 0
    demoCount += 1
  }

  return {
    paper: { pnl: round2(paperPnl), trades: paperCount },
    expertoption: { pnl: round2(demoPnl), trades: demoCount },
    total: { pnl: round2(paperPnl + demoPnl), trades: paperCount + demoCount }
  }
}

/**
 * Pre-trade portfolio risk check for a prospective new position.
 * Advisory decision-support: returns pass/warn/refuse-style signals without
 * ever blocking an executor directly.
 */
export async function portfolioRiskCheck({ symbol, amount, maxNotional = 50000, maxSingleVenueShare = 0.8 }) {
  const agg = await aggregateOpenPositions()
  const addSize = Math.max(0, Number(amount) || 0)
  const sym = canonical(symbol)
  const newNotional = round2(agg.totals.notional + addSize)

  const warnings = []
  let allowed = true

  if (newNotional > Number(maxNotional)) {
    allowed = false
    warnings.push(`aggregate notional ${newNotional} would exceed the ${maxNotional} cap`)
  }

  const inst = agg.byInstrument[sym]
  const instSize = (inst?.totalSize ?? 0) + addSize
  if (agg.totals.notional + addSize > 0 && instSize / (agg.totals.notional + addSize) > 0.5) {
    warnings.push(`${Math.round((instSize / (agg.totals.notional + addSize)) * 100)}% of open notional concentrated in ${sym}`)
  }

  for (const v of agg.venues) {
    const share = (v.totalSize + (v.venue === "paper" ? addSize : 0)) / Math.max(1, newNotional)
    if (share > maxSingleVenueShare) {
      warnings.push(`venue ${v.venue} holds ${Math.round(share * 100)}% of exposure (> ${maxSingleVenueShare * 100}% cap)`)
    }
  }

  if (inst?.hedged || ((inst?.sides?.up ?? 0) > 0 && (inst?.sides?.down ?? 0) > 0)) {
    warnings.push(`${sym} already carries offsetting up/down legs`)
  }

  const pnlToday = await combinedTodayPnl()

  return {
    ok: true,
    allowed,
    warnings,
    proposed: { symbol: sym, amount: round2(addSize) },
    after: { totalNotional: newNotional },
    todayPnl: pnlToday.total,
    exposureByInstrument: Object.fromEntries(
      Object.entries(agg.byInstrument).map(([s, i]) => [s, i.totalSize])
    )
  }
}
