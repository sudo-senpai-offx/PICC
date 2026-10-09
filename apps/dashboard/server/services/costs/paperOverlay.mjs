// Paper cost-drag overlay — modeled cost lines computed BESIDE the ledger.
//
// The paper ledger stays byte-identical: this module never opens, closes,
// marks, or persists anything. Its only paper touchpoint is the read-only
// close-history reader from the paper service (`paperHistory`, injectable via
// deps, dynamic `await import()` otherwise — the legsLocal.mjs precedent: no
// static import of the paper service, never the route). In particular it never
// goes through the marking analytics entry point, which auto-closes tripped
// positions and refreshes quotes — both writes, both out of bounds here — and
// it never touches order entry/exit, the vault, or any route handler.
//
// Cost math is owned by Task 3 `modelFillCost` (constitution `costAdjustedEv`
// wrapper): per-close notional feeds the spread + slippage legs. Paper charges
// no explicit per-trade fee, so the fee leg is a modeled zero — the ledger
// records no fee, and the drag from explicit fees on paper is nothing. Every
// line carries a modeled provenance, never measured.
//
// Honesty rules: a close whose notional is not positive-finite yields no line,
// only a named skip (absent, never zero). `dragAdjustedEquity` builds a new
// parallel series — same timestamps, equity minus cumulative modeled costs —
// and never mutates its inputs. The curve defines the timeline: overlay lines
// map positionally onto curve points after the seed point, and anything beyond
// the curve is not plotted (no fabrication past observed equity).

import {
  modelFillCost,
  DEFAULT_PIP_VALUE_PCT,
  DEFAULT_SLIPPAGE_PIPS,
  DEFAULT_SPREAD_PIPS
} from "./modeled.mjs"

export const PAPER_OVERLAY_VENUE = "paper"
export const DRAG_ADJUSTED_LABEL = "drag-adjusted (modeled)"
const MODELED = "modeled"

const round2 = (x) => Math.round(Number(x) * 100) / 100

function positiveFinite(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function finiteOrZero(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Per-close modeled cost lines for paper closed-trade rows
// (`{ id, amount, closedAt }`; `amount` is the cash committed = notional USD).
// Returns `{ lines, skipped }` on the Task 3 `{ records, skipped }` shape:
// `lines` are `[{ closeId, feeUsd, spreadUsd, slipUsd, provenance }]`;
// `skipped` carry `{ closeId, kind, reason }`. `opts` passes spread/slippage
// inputs through to `modelFillCost`; `opts.provenance` defaults to "modeled"
// and is pinned there by the modeled leg (a calibrated label flows only when
// explicitly requested — measured is never emitted).
export function overlayForCloses(closes, opts = {}) {
  const rows = Array.isArray(closes) ? closes : []
  const lines = []
  const skipped = []
  for (const close of rows) {
    const closeId = close?.id ?? null
    const notional = positiveFinite(close?.amount)
    if (notional == null) {
      skipped.push({ closeId, kind: "spread+slippage", reason: "notional-not-positive-finite" })
      continue
    }
    const out = modelFillCost({
      venue: PAPER_OVERLAY_VENUE,
      route: "close",
      notionalUsd: notional,
      spreadPips: opts.spreadPips ?? DEFAULT_SPREAD_PIPS,
      slippagePips: opts.slippagePips ?? DEFAULT_SLIPPAGE_PIPS,
      pipValuePct: opts.pipValuePct ?? DEFAULT_PIP_VALUE_PCT,
      provenance: opts.provenance ?? MODELED,
      observedAt: close?.closedAt ?? undefined
    })
    if (out.records.length === 0) {
      for (const s of out.skipped) skipped.push({ closeId, ...s })
      continue
    }
    const spread = out.records.find((r) => r.kind === "spread")
    const slip = out.records.find((r) => r.kind === "slippage")
    const provenance = spread?.provenance ?? slip?.provenance ?? MODELED
    lines.push({
      closeId,
      feeUsd: 0,
      spreadUsd: spread ? finiteOrZero(spread.amountUsd) : 0,
      slipUsd: slip ? finiteOrZero(slip.amountUsd) : 0,
      provenance
    })
  }
  return { lines, skipped }
}

// Parallel drag-adjusted equity series beside the real curve. `equityCurve`
// is analytics `equitySeries` points `[{ t, pnl, equity }]` (seed point +
// one point per close, oldest -> newest); `overlays` is either the `lines`
// array from `overlayForCloses` or its `{ lines }` result object. Returns
// `{ label, series }` with `series` of
// `{ t, equity, dragEquity, cumulativeCostUsd }`: same timestamps, original
// equity verbatim, dragEquity = equity minus cumulative modeled costs
// (rounded ledger-style to 2dp). Short overlays freeze the cumulative sum
// rather than inventing costs; the inputs are never mutated.
export function dragAdjustedEquity(equityCurve, overlays) {
  const curve = Array.isArray(equityCurve) ? equityCurve : []
  const lines = Array.isArray(overlays) ? overlays : overlays?.lines ?? []
  let cumulative = 0
  const series = curve.map((point, i) => {
    if (i > 0 && i - 1 < lines.length) {
      const line = lines[i - 1]
      if (line != null && typeof line === "object") {
        cumulative = round2(
          cumulative + finiteOrZero(line.feeUsd) + finiteOrZero(line.spreadUsd) + finiteOrZero(line.slipUsd)
        )
      }
    }
    return {
      t: point?.t ?? null,
      equity: point?.equity ?? null,
      dragEquity: round2(Number(point?.equity) - cumulative),
      cumulativeCostUsd: cumulative
    }
  })
  return { label: DRAG_ADJUSTED_LABEL, series }
}

// Read-only paper closes via the paper service, never the route. `deps`
// injects the reader (`{ paperHistory: async (limit) => [...] }`); without
// injection the service function is dynamically imported, so importing this
// module never pays the paper service's load cost. Non-array results read as
// [] (absent, never fabricated).
export async function readPaperCloses(deps = {}) {
  const list =
    typeof deps.paperHistory === "function"
      ? deps.paperHistory
      : (await import("../trading.mjs")).paperHistory
  const limit = Number.isFinite(Number(deps.limit)) ? Number(deps.limit) : 500
  const closed = await list(limit)
  return Array.isArray(closed) ? closed : []
}
