// PICC MTF Convergence — live section loader for the realtime suite (spec 7b).
//
// Thin glue between the pure convergence engine (mtfConvergence.mjs) and the
// live ExpertOption buffers (liveEO.mjs): pick the viewed asset, stream its
// in-buffer timeframes directly, aggregate 30m/4h from the M1 buffer, and
// never fabricate a read when nothing is connected — an absent buffer reports
// source "none" / stale / empty planes, which converge turns into NO TRADE with
// "—" values (R10 honesty rule). The section cache TTL lives in realtimeSuite.
import { loadConvergence, converge } from "./mtfConvergence.mjs"
import { liveEOData } from "./liveEO.mjs"

// The full ladder the convergence matrix shows: intraday buffers direct from
// liveEO, 30m/4h derived from M1 (dailies would go through getBestCandles at
// a call site — out of scope for the live-buffer section).
export const CONVERGENCE_TIMEFRAMES = [60, 300, 900, 3600, 1800, 14400]
export const CONVERGENCE_DERIVE_TFS = [1800, 14400]

/**
 * One convergence read for the currently-viewed asset over the live buffers.
 * @param {object} [opts]
 * @param {number} [opts.now] - injected clock for tests / dedupe
 * @returns {Promise<object>} a ConvergenceResult-shaped payload plus the
 *   resolved asset identity and read timestamp.
 */
export async function convergenceSection({ now = Date.now() } = {}) {
  let data = null
  try {
    data = liveEOData()
  } catch {
    data = null
  }
  const assets = Array.isArray(data?.assets) ? data.assets : []
  const asset = assets.find((a) => a.id === data?.viewed) ?? assets[0] ?? null
  const periods = asset?.periods ?? {}
  const liveByTf = {}
  for (const tf of CONVERGENCE_TIMEFRAMES) {
    if (Array.isArray(periods[tf]) && periods[tf].length) liveByTf[tf] = periods[tf]
  }
  const { planes, sourceByTf, staleByTf } = await loadConvergence({
    tfs: CONVERGENCE_TIMEFRAMES,
    liveByTf,
    m1: liveByTf[60] ?? [],
    deriveTfs: CONVERGENCE_DERIVE_TFS
  })
  const result = converge({ planes, sourceByTf, staleByTf })
  return {
    ...result,
    assetId: asset?.id ?? null,
    asset: asset?.name ?? null,
    source: "liveEO-buffers",
    ts: now
  }
}