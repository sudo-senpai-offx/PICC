// ---------------------------------------------------------------------
// Shared coordinate helpers for the v3.2 Context/Regime layer. Pure.
// percentileOfLast ranks the last finite value of a series against its
// own trailing window (mirror of the detectMarketPhase percentile read,
// but extracted so the vol-regime classifier and other consumers share one
// honest implementation). "No window" = the full finite series.
// ---------------------------------------------------------------------

export function percentileOfLast(series = [], { window = null } = {}) {
  const finite = Array.isArray(series) ? series.filter((v) => v != null && Number.isFinite(Number(v))).map(Number) : []
  if (finite.length === 0) return { value: null, percentile: null, n: 0 }
  const n = window != null && window > 0 ? Math.min(window, finite.length) : finite.length
  const tail = finite.slice(-n)
  const value = tail[tail.length - 1]
  if (!Number.isFinite(value)) return { value: null, percentile: null, n: 0 }
  const lo = Math.min(...tail)
  const hi = Math.max(...tail)
  // A flat window is positionally indeterminate — ranking it as max (1.0) or
  // min (0.0) would mislabel a constant-vol regime, so report neutral.
  if (hi === lo) return { value, percentile: 0.5, n: tail.length }
  const below = tail.filter((v) => v <= value).length
  return { value, percentile: below / tail.length, n: tail.length }
}