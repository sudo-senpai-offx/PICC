// FIFO tax-lot matcher (report-only; not tax advice).
//
// Stateless: pure function over caller-supplied rows, no store, no env.
// Global per-asset FIFO pools: disposals consume the oldest acquisitions
// first; a disposal larger than the oldest lot consumes across lots in
// order, emitting one lot line per acquisition slice.
//
// Basis adjusts ONLY from explicitly linked cost records:
// - buy-side: cost records with `fillId` equal to the acquisition `id`
//   raise basis (allocated pro-rata across consumed slices);
// - sell-side: cost records with `closeId` equal to the disposal `id`
//   lower proceeds (allocated pro-rata across emitted slices).
// Otherwise the line carries `fee-unobserved` (honest absence, never a
// zero-fee assumption).
//
// Unmatched sells are still listed with `basisUsd: null`, `gainUsd: null`
// and a `basis-unobserved` flag (gain unstated, never zero).
// Self-transfers (wealth transfer log) only flag lines, never exclude.
// Swap halves pair by shared `swapTag`; an unpaired half is flagged
// `swap-half-unpaired`, never inferred into a pair.

const EPS = 1e-12

const byTime = (a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0)

function sumFees(costs, pred) {
  let total = 0
  let linked = false
  for (const c of costs ?? []) {
    if (pred(c)) {
      linked = true
      total += Number(c.feeUsd ?? 0)
    }
  }
  return { total, linked }
}

export function matchLots({ acquisitions = [], disposals = [], costs = [], selfTransfers = [] } = {}) {
  const lots = []
  const unmatched = []

  // Global per-asset FIFO pools, oldest acquisition first.
  const pools = new Map()
  for (const a of [...acquisitions].sort(byTime)) {
    const buy = sumFees(costs, (c) => c.fillId != null && c.fillId === a.id)
    const entry = {
      acq: a,
      remaining: Number(a.qty ?? 0),
      buyFeeRate: Number(a.qty) ? buy.total / Number(a.qty) : 0,
      buyFeeLinked: buy.linked,
    }
    if (!pools.has(a.asset)) pools.set(a.asset, [])
    pools.get(a.asset).push(entry)
  }

  // Swap tags present on acquisition halves (any asset: pairing is by tag).
  const acqTags = new Set(
    (acquisitions ?? []).filter((a) => a.swapTag != null).map((a) => a.swapTag),
  )

  const isSelfTransfer = (d) =>
    (selfTransfers ?? []).some(
      (t) => t.asset === d.asset && t.qty === d.qty && t.at === d.at,
    )

  for (const d of [...disposals].sort(byTime)) {
    const sell = sumFees(costs, (c) => c.closeId != null && c.closeId === d.id)
    const selfTransfer = isSelfTransfer(d)
    const base = {
      id: d.id,
      date: d.at,
      asset: d.asset,
      side: "sell",
      price: d.price,
      ccy: d.ccy,
      method: "FIFO",
      provenance: d.source,
      selfTransfer,
      swapTag: d.swapTag ?? null,
    }
    const swapFlags = d.swapTag != null && !acqTags.has(d.swapTag) ? ["swap-half-unpaired"] : []
    const feeFlags = (buyLinked) => (!sell.linked || !buyLinked ? ["fee-unobserved"] : [])

    let remaining = Number(d.qty ?? 0)
    const pool = pools.get(d.asset) ?? []
    for (const entry of pool) {
      if (remaining <= EPS) break
      if (entry.remaining <= EPS) continue
      const slice = Math.min(entry.remaining, remaining)
      entry.remaining -= slice
      remaining -= slice
      const sellFeeSlice = Number(d.qty) ? (sell.total * slice) / Number(d.qty) : 0
      const proceedsUsd = slice * Number(d.price) - sellFeeSlice
      const basisUsd = slice * Number(entry.acq.price) + entry.buyFeeRate * slice
      lots.push({
        ...base,
        qty: slice,
        feeUsd: sell.linked ? sellFeeSlice : null,
        proceedsUsd,
        basisUsd,
        gainUsd: proceedsUsd - basisUsd,
        flags: [...feeFlags(entry.buyFeeLinked), ...swapFlags],
      })
    }

    // Unmatched remainder (or whole disposal when the pool is empty):
    // listed with basis-unobserved, gain unstated.
    if (remaining > EPS) {
      const sellFeeSlice = Number(d.qty) ? (sell.total * remaining) / Number(d.qty) : 0
      const line = {
        ...base,
        qty: remaining,
        feeUsd: sell.linked ? sellFeeSlice : null,
        proceedsUsd: remaining * Number(d.price) - sellFeeSlice,
        basisUsd: null,
        gainUsd: null,
        flags: ["basis-unobserved", ...(!sell.linked ? ["fee-unobserved"] : []), ...swapFlags],
      }
      lots.push(line)
      unmatched.push(line)
    }
  }

  return { lots, unmatched, incomplete: unmatched.length > 0 }
}
