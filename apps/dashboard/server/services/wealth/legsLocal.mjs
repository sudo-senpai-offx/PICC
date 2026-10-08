// Wealth local leg readers — manual, billing-settled, localstore, paper summary.
//
// Binding spec (design doc §2, decisions 2/7/8/14/17):
// - Paper lives in a SEPARATE, never-summed section (decision 2/14):
//   readPaperSummary returns exactly { equity, cash, committed, open, closed }
//   verbatim from the paper service — never converted, never summed, no path
//   into any total. It imports the SERVICE function (trading.mjs paperAnalytics,
//   the producer behind GET /api/trading/paper/analytics), never the route.
// - Billing legs are settled balances only (decision 7): only `granted`
//   payment_orders emit legs. In-flight flows (awaiting_payment / submitted /
//   failed) are absent by construction — the output shape has no flow field.
// - Overlap dedupe by priority (decision 8): live keyed legs win; a localstore
//   row overlapping a live keyed leg id is excluded ABSENT with reason
//   `duplicate-of:<legId>`. Transactions are flows and are never summed —
//   they are accepted and deliberately ignored, with no code path that reads
//   their amounts.
// - Manual legs carry ENTERED + age-from-asOf in whole days, never LIVE/STALE
//   (decisions 10/17; ledger carry-forward: tng-manual ABSENT-without-amount
//   is not-entered, never zero). The store permits LIVE — this reader coerces,
//   so a stored LIVE manual leg still reads ENTERED here.
//
// Read-only mappers: no persistence here (store.mjs owns it), no static
// imports of store/localstore/trading modules (dynamic `await import()` only,
// so tests stay hermetic and importing this module never pays their load cost
// or touches their data dirs — every source is injectable via deps).

const DAY_MS = 86_400_000

function finiteOrNull(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function intOrNull(v) {
  const n = finiteOrNull(v)
  return n === null ? null : Math.trunc(n)
}

function normId(v) {
  return String(v ?? "").trim().toLowerCase()
}

// ── Manual legs (wealth store, kind:"manual") ────────────────────────────────

export async function readManualLegs(deps = {}) {
  const stored = Array.isArray(deps.legs)
    ? deps.legs
    : (await import("./store.mjs")).listLegs()
  const now = Number.isFinite(Number(deps.now)) ? Number(deps.now) : Date.now()
  return stored
    .filter((l) => l && l.kind === "manual")
    .map((leg) => {
      const amount = finiteOrNull(leg.amount)
      const asOfMs = leg.asOf === undefined || leg.asOf === null || leg.asOf === ""
        ? NaN
        : new Date(leg.asOf).getTime()
      if (amount === null || !Number.isFinite(asOfMs)) {
        // Ledger carry-forward: ABSENT-without-amount (e.g. seeded tng-manual)
        // is not-entered — amount stays null, never coerced to zero.
        return {
          id: leg.id,
          kind: "manual",
          ccy: leg.ccy ?? null,
          amount: null,
          asOf: leg.asOf ?? null,
          ageDays: null,
          observedAt: leg.observedAt ?? null,
          status: "ABSENT",
          reason: leg.reason ?? "manual-unentered",
          fxSource: leg.fxSource ?? null,
          fxAt: leg.fxAt ?? null
        }
      }
      return {
        id: leg.id,
        kind: "manual",
        ccy: leg.ccy ?? null,
        amount,
        asOf: leg.asOf,
        ageDays: Math.max(0, Math.floor((now - asOfMs) / DAY_MS)),
        observedAt: leg.observedAt ?? null,
        // ENTERED unconditionally: manual legs are never LIVE/STALE, even
        // when the stored record claims otherwise.
        status: "ENTERED",
        reason: null,
        fxSource: leg.fxSource ?? null,
        fxAt: leg.fxAt ?? null
      }
    })
}

// ── Billing legs (settled balances only) ────────────────────────────────────
// payment_orders statuses: awaiting_payment | submitted | granted | failed.
// Only `granted` is settled. Everything else is a flow and emits nothing.

const SETTLED_BILLING = new Set(["granted"])

export async function readBillingLegs(deps = {}) {
  const orders = Array.isArray(deps.paymentOrders)
    ? deps.paymentOrders
    : await (await import("../localstore.mjs")).listRows("payment_orders")
  const legs = []
  for (const row of orders ?? []) {
    if (!row || !SETTLED_BILLING.has(String(row.status))) continue // flows excluded
    const amount = finiteOrNull(row.amount)
    const id = `billing-${row.provider ?? "unknown"}-${row.id ?? "noid"}`
    if (amount === null) {
      legs.push({
        id, kind: "billing", ccy: row.currency ?? null, amount: null,
        observedAt: row.updated_at ?? row.created_at ?? null,
        status: "ABSENT", reason: "billing-unobservable",
        fxSource: null, fxAt: null
      })
      continue
    }
    legs.push({
      id, kind: "billing", ccy: row.currency ?? null, amount,
      observedAt: row.updated_at ?? row.created_at ?? null,
      status: "ENTERED", reason: null,
      fxSource: null, fxAt: null
    })
  }
  return legs
}

// ── Localstore legs (financial_accounts settled balances + honest absence) ──

export async function readLocalstoreLegs(deps = {}) {
  const accounts = Array.isArray(deps.accounts)
    ? deps.accounts
    : await (await import("../localstore.mjs")).listRows("financial_accounts")
  const nftHoldings = Array.isArray(deps.nftHoldings)
    ? deps.nftHoldings
    : await (await import("../localstore.mjs")).listRows("nft_holdings")
  // Transactions are flows: accepted so callers can pass what they hold, then
  // deliberately ignored — no code path here reads a transaction amount.
  void deps.transactions
  let liveIds = deps.liveLegIds
  if (!Array.isArray(liveIds)) {
    const legs = (await import("./store.mjs")).listLegs()
    liveIds = legs.filter((l) => l && l.status === "LIVE").map((l) => l.id)
  }
  const liveByNorm = new Map(liveIds.map((id) => [normId(id), id]))
  const overlapOf = (row) => {
    for (const key of ["id", "firefly_account_id", "name"]) {
      const hit = liveByNorm.get(normId(row?.[key]))
      if (hit && normId(row[key]).length > 0) return hit
    }
    return null
  }

  const legs = []
  for (const row of accounts ?? []) {
    if (!row) continue
    const id = `localstore-${row.id ?? "noid"}`
    const base = {
      id, kind: "localstore", ccy: row.currency ?? null,
      observedAt: row.updated_at ?? row.created_at ?? null,
      fxSource: null, fxAt: null
    }
    const dup = overlapOf(row)
    if (dup) {
      // Priority dedupe (decision 8): the live keyed leg wins; this row is
      // excluded with reason, amount nulled so no downstream sum can see it.
      legs.push({ ...base, amount: null, status: "ABSENT", reason: `duplicate-of:${dup}` })
      continue
    }
    if (String(row.type) !== "asset") {
      legs.push({ ...base, amount: null, status: "ABSENT", reason: "localstore-non-asset" })
      continue
    }
    const balance = finiteOrNull(row.balance)
    if (balance === null) {
      legs.push({ ...base, amount: null, status: "ABSENT", reason: "localstore-unobservable" })
      continue
    }
    legs.push({ ...base, amount: balance, status: "ENTERED", reason: null })
  }
  for (const row of nftHoldings ?? []) {
    if (!row) continue
    // No honest USD valuation source here (floor-price currency is unknown and
    // a floor is not a holding value), so holdings surface as honest absence.
    legs.push({
      id: `localstore-nft-${row.id ?? "noid"}`, kind: "localstore",
      ccy: null, amount: null,
      observedAt: row.updated_at ?? row.created_at ?? null,
      status: "ABSENT", reason: "localstore-nft-unpriced",
      fxSource: null, fxAt: null
    })
  }
  return legs
}

// ── Paper summary (separate section, never summed) ──────────────────────────

const NULL_PAPER = { equity: null, cash: null, committed: null, open: null, closed: null }

export async function readPaperSummary(deps = {}) {
  const getAnalytics = typeof deps.paperAnalytics === "function"
    ? deps.paperAnalytics
    : (await import("../trading.mjs")).paperAnalytics
  let report
  try {
    report = await getAnalytics()
  } catch {
    return { ...NULL_PAPER }
  }
  const o = report?.overview ?? {}
  return {
    equity: finiteOrNull(o.equity),
    cash: finiteOrNull(o.cash),
    committed: finiteOrNull(o.committed),
    open: intOrNull(o.open ?? o.openCount),
    closed: intOrNull(o.closed ?? o.closedCount)
  }
}
