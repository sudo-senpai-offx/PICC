// Costs measured recorder — fills, funding, record-time USD.
//
// Pure mappers: explicit venue-reported fees and observed funding accruals
// become Task 1 `recordFillCost`-shaped inputs with `provenance: "measured"`.
// No network, no store writes (persistence is Task 5's job); the only FX path
// is the injected `fx(ccy, amount)` double in tests, or — when omitted — a
// dynamic import of wealth `fx.mjs` `convertToUsd` with no readers (USD and
// declared-parity stables convert; anything else is honestly unobservable).
//
// Funding honesty follows the livePositionManager precedent: an
// `unobserved-portion` accrual yields NO funding record — the portion is never
// adjusted — with the reason carried on the fill result, not fabricated.
// Absent data is a skipped entry with a reason, never a zero.

const MEASURED = "measured"

async function defaultFx(ccy, amount) {
  const { convertToUsd } = await import("../wealth/fx.mjs")
  return convertToUsd(ccy, amount)
}

function observedAtOf(fill) {
  const raw = fill?.observedAt ?? fill?.at ?? null
  const t = raw ? Date.parse(raw) : NaN
  return Number.isFinite(t) ? new Date(raw).toISOString() : new Date().toISOString()
}

async function convertLeg({ kind, cost, currency }, fx) {
  const amount = Number(cost)
  if (!Number.isFinite(amount)) {
    return { record: null, skip: { kind, reason: `${kind}-amount-not-finite` } }
  }
  const ccy = currency ?? "USD"
  const converted = await fx(ccy, amount)
  if (!converted || converted.usd == null || !Number.isFinite(Number(converted.usd))) {
    return {
      record: null,
      skip: { kind, reason: converted?.reason ?? `fx-unobservable:${ccy}` }
    }
  }
  return {
    record: {
      amountUsd: Number(converted.usd),
      ccy,
      fxSource: converted.fxSource ?? null,
      fxAt: converted.fxAt ?? null
    },
    skip: null
  }
}

export async function measureFillCost(fill, fx = defaultFx) {
  const records = []
  const skipped = []
  const venue = fill?.venue ?? null
  const route = fill?.route ?? "fill"
  const observedAt = observedAtOf(fill ?? {})

  const fee = fill?.fee ?? null
  if (fee == null) {
    skipped.push({ kind: "fee", reason: "fee-unobserved" })
  } else {
    const { record, skip } = await convertLeg(
      { kind: "fee", cost: fee.cost, currency: fee.currency },
      fx
    )
    if (record) {
      records.push({
        venue,
        route,
        kind: "fee",
        ...record,
        provenance: MEASURED,
        observedAt
      })
    } else {
      skipped.push(skip)
    }
  }

  const fundingAccrual = fill?.fundingAccrual ?? null
  const funding = fill?.funding ?? null
  if (fundingAccrual === "unobserved-portion") {
    skipped.push({ kind: "funding", reason: "funding-unobserved-portion" })
  } else if (funding != null) {
    const { record, skip } = await convertLeg(
      { kind: "funding", cost: funding.amount, currency: funding.currency },
      fx
    )
    if (record) {
      records.push({
        venue,
        route,
        kind: "funding",
        ...record,
        provenance: MEASURED,
        observedAt
      })
    } else {
      skipped.push(skip)
    }
  }

  return { records, skipped }
}

export async function measureFillCosts(fills, fx = defaultFx) {
  if (!Array.isArray(fills)) {
    return { records: [], skipped: [{ index: null, reason: "fills-not-array" }] }
  }
  const records = []
  const skipped = []
  for (let index = 0; index < fills.length; index += 1) {
    const fill = fills[index]
    const { records: legRecords, skipped: legSkipped } = await measureFillCost(fill, fx)
    records.push(...legRecords)
    for (const skip of legSkipped) {
      skipped.push({ index, id: fill?.id ?? null, ...skip })
    }
  }
  return { records, skipped }
}
