// Tax inputs assembly (report-only; not tax advice).
//
// Read-only assembly of Task 1 matcher rows from the existing stores:
// journal entries -> acquisitions (entry side) / disposals (closed side,
// exitTime in range); live close records -> disposals with fee fields linked
// by close id; costs fills -> linked cost records by close/fill id; wealth
// transfers -> self-transfer flags (informational only, rows stay listed).
//
// Stateless: no store, no env, no writes. Default readers are dynamic
// `await import()` calls to read-only list functions only (the costs
// paperOverlay precedent: never the route, never a write path). Every source
// is injectable via `deps` so tests stay hermetic.
//
// Paper/testnet exclusion uses ONE shared predicate (no second predicate):
// paper is the canonical `"paper"` venue string (same value as the costs
// paper overlay venue); testnet is the Hyperliquid testnet venue kind plus
// generic testnet/sandbox markers. Wealth-leg convention reused: paper lives
// outside summed totals and the Hyperliquid leg is the testnet leg
// (testnet-only rail), so the same kind strings classify tax inputs.
// Excluded records count into `excludedPaper` / `excludedTestnet`.
//
// Binding carry-forward: opening-balance entries surface ONLY as
// acquisitions, never as disposals — even when closed via the existing close
// route (guarded below by kind, not by status).
//
// Swap halves pair by shared tag; unpaired halves keep their tag and stay
// listed (the Task 1 matcher flags `swap-half-unpaired`, never infers).

export const PAPER_VENUE = "paper"

// Single shared paper predicate (canonical paper venue string).
export function isPaperVenue(value) {
  return String(value ?? "").trim().toLowerCase() === PAPER_VENUE
}

// Single shared testnet predicate: the Hyperliquid testnet venue kind plus
// generic markers. Paper never counts as testnet (checked first by callers).
export function isTestnetVenue(value) {
  const v = String(value ?? "").trim().toLowerCase()
  if (!v || v === PAPER_VENUE) return false
  return v.includes("hyperliquid") || v.includes("testnet") || v.includes("sandbox")
}

function lowerTags(rec) {
  return (Array.isArray(rec?.tags) ? rec.tags : []).map((t) => String(t).toLowerCase())
}

// Classify one source record as "paper" | "testnet" | "live".
function classifyRecord(rec) {
  const venues = [rec?.venue, rec?.kind].filter((v) => v !== undefined && v !== null && String(v) !== "")
  if (venues.some(isPaperVenue)) return "paper"
  if (venues.some(isTestnetVenue)) return "testnet"
  const tags = lowerTags(rec)
  if (tags.some((t) => t === PAPER_VENUE)) return "paper"
  if (tags.some((t) => t === "hyperliquid" || t.includes("testnet") || t.includes("sandbox"))) return "testnet"
  return "live"
}

function swapTagOf(rec) {
  const tags = Array.isArray(rec?.tags) ? rec.tags : []
  return tags.find((t) => /^swap[:-]/i.test(String(t))) ?? null
}

function isoOf(v) {
  if (v === undefined || v === null || v === "") return null
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function rangeMs(v) {
  if (v === undefined || v === null || v === "") return null
  const t = typeof v === "number" ? v : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function inRange(atIso, fromMs, toMs) {
  const t = Date.parse(atIso)
  if (!Number.isFinite(t)) return false
  if (fromMs !== null && t < fromMs) return false
  if (toMs !== null && t > toMs) return false
  return true
}

async function defaultJournalEntries() {
  const { listEntries } = await import("../tradeJournal.mjs")
  const seen = new Map()
  // Default listing hides opening balances, so read both views.
  for (const args of [{ limit: 5000 }, { kind: "opening-balance", limit: 5000 }]) {
    const res = await listEntries(args)
    const rows = Array.isArray(res) ? res : res?.entries ?? []
    for (const e of rows) {
      if (e && e.id !== undefined && !seen.has(e.id)) seen.set(e.id, e)
    }
  }
  return [...seen.values()]
}

async function defaultLiveCloses() {
  // The live manager persists open positions only; close records are
  // ephemeral rail returns, so there is no close-history store to read.
  // Touch the pure persisted read to prove the module loads read-only, then
  // report honest absence: live closes arrive via injection (Task 5 route).
  const { openPositions } = await import("../livePositionManager.mjs")
  void openPositions()
  return []
}

async function defaultFillCosts() {
  const { listFillCosts } = await import("../costs/store.mjs")
  const rows = await listFillCosts({ limit: 5000 })
  return Array.isArray(rows) ? rows : []
}

async function defaultTransfers() {
  const { listTransfers } = await import("../wealth/store.mjs")
  const rows = await listTransfers()
  return Array.isArray(rows) ? rows : []
}

export async function collectInputs({ from = null, to = null, deps = {} } = {}) {
  const fromMs = rangeMs(from)
  const toMs = rangeMs(to)

  const journalEntries = Array.isArray(deps.journalEntries)
    ? deps.journalEntries
    : typeof deps.journalReader === "function"
      ? await deps.journalReader()
      : await defaultJournalEntries()
  const liveCloses = Array.isArray(deps.liveCloses)
    ? deps.liveCloses
    : typeof deps.liveClosesReader === "function"
      ? await deps.liveClosesReader()
      : await defaultLiveCloses()
  const fillCosts = Array.isArray(deps.fillCosts)
    ? deps.fillCosts
    : typeof deps.fillCostsReader === "function"
      ? await deps.fillCostsReader()
      : await defaultFillCosts()
  const transfers = Array.isArray(deps.transfers)
    ? deps.transfers
    : typeof deps.transfersReader === "function"
      ? await deps.transfersReader()
      : await defaultTransfers()

  const acquisitions = []
  const disposals = []
  const costs = []
  const selfTransfers = []
  let excludedPaper = 0
  let excludedTestnet = 0
  const exclude = (kind) => {
    if (kind === "paper") excludedPaper += 1
    else excludedTestnet += 1
  }

  for (const e of journalEntries ?? []) {
    if (!e || typeof e !== "object") continue
    const cls = classifyRecord(e)
    if (cls !== "live") {
      exclude(cls)
      continue
    }
    const asset = String(e.symbol ?? e.asset ?? "").toUpperCase()
    const qty = Number(e.quantity ?? e.qty)
    const entryPrice = Number(e.entryPrice ?? e.price)
    const entryAt = isoOf(e.entryTime ?? e.at)
    if (!asset || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entryPrice) || !entryAt) continue
    const swapTag = swapTagOf(e)
    if (e.kind === "opening-balance") {
      // Guard: opening lots are acquisitions even when the close route
      // stamped exit fields onto them — never disposals.
      acquisitions.push({
        asset, qty, price: entryPrice, ccy: e.ccy ?? "USD", at: entryAt,
        source: "opening-balance", id: e.id, swapTag,
      })
      continue
    }
    acquisitions.push({
      asset, qty, price: entryPrice, ccy: e.ccy ?? "USD", at: entryAt,
      source: "journal-entry", id: e.id, swapTag,
    })
    if (e.status === "closed") {
      const exitPrice = Number(e.exitPrice)
      const exitAt = isoOf(e.exitTime)
      if (Number.isFinite(exitPrice) && exitAt && inRange(exitAt, fromMs, toMs)) {
        disposals.push({
          asset, qty, price: exitPrice, ccy: e.ccy ?? "USD", at: exitAt,
          source: "journal-close", id: e.id, swapTag,
        })
      }
    }
  }

  for (const c of liveCloses ?? []) {
    if (!c || typeof c !== "object") continue
    const cls = classifyRecord(c)
    if (cls !== "live") {
      exclude(cls)
      continue
    }
    const asset = String(c.symbol ?? c.asset ?? "").toUpperCase()
    const qty = Number(c.size ?? c.qty ?? c.quantity ?? c.filled)
    const price = Number(c.exitPrice ?? c.price ?? c.average)
    const at = isoOf(c.closedAt ?? c.at ?? c.exitTime)
    if (!asset || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || !at) continue
    if (!inRange(at, fromMs, toMs)) continue
    const id = c.id ?? c.positionId ?? null
    disposals.push({
      asset, qty, price, ccy: c.ccy ?? "USD", at,
      source: "live-close", id, swapTag: swapTagOf(c),
    })
    const fee = Number(c.fee ?? c.feeUsd)
    if (id !== null && Number.isFinite(fee)) {
      costs.push({ closeId: id, fillId: null, feeUsd: fee, kind: "fee" })
    }
  }

  for (const f of fillCosts ?? []) {
    if (!f || typeof f !== "object") continue
    const cls = classifyRecord(f)
    if (cls !== "live") {
      exclude(cls)
      continue
    }
    const feeUsd = Number(f.amountUsd ?? f.feeUsd)
    if (!Number.isFinite(feeUsd)) continue
    costs.push({
      closeId: f.closeId ?? null,
      fillId: f.fillId ?? f.id ?? null,
      feeUsd,
      kind: f.kind ?? "fee",
    })
  }

  for (const t of transfers ?? []) {
    if (!t || typeof t !== "object") continue
    const asset = String(t.ccy ?? t.asset ?? "").toUpperCase()
    const qty = Number(t.amount ?? t.qty)
    const at = isoOf(t.at)
    if (!asset || !Number.isFinite(qty) || qty <= 0 || !at) continue
    selfTransfers.push({ asset, qty, at })
  }

  return { acquisitions, disposals, costs, selfTransfers, excludedPaper, excludedTestnet }
}
