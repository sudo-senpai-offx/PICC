// PICC MTF Convergence — live section loader for the realtime suite (spec 7b).
//
// Thin glue between the pure convergence engine (mtfConvergence.mjs) and the
// live ExpertOption buffers (liveEO.mjs): pick the viewed asset, stream its
// in-buffer timeframes directly, aggregate 30m/4h from the M1 buffer, and
// never fabricate a read when nothing is connected — an absent buffer reports
// source "none" / stale / empty planes, which converge turns into NO TRADE with
// "—" values (R10 honesty rule). The section cache TTL lives in realtimeSuite.
import { loadConvergence, converge, setConvergenceOutcomeHook, PRESETS, resolvePreset } from "./mtfConvergence.mjs"
import { liveEOData } from "./liveEO.mjs"
import { updateConvergence } from "./alertEngine.mjs"
import { recordConvergence, flushConvergence } from "./convergenceLedger.mjs"
import { detectRegimeLatched, regimeKnobs, REGIME_MODES as REGIME_MODE_LIST } from "./regimeEngine.mjs"

// The full ladder the convergence matrix shows: intraday buffers direct from
// liveEO, 30m/4h derived from M1 (dailies would go through getBestCandles at
// a call site — out of scope for the live-buffer section).
export const CONVERGENCE_TIMEFRAMES = [60, 300, 900, 3600, 1800, 14400]
export const CONVERGENCE_DERIVE_TFS = [1800, 14400]

// 9a outcome hook: every converged read with a directional state is recorded
// into the outcome ledger (preset "intraday" = this section's ladder). The
// ledger's state-change guard keeps repeated ticks of the same state from
// spamming the store; matured entries resolve against realized price on flush.
setConvergenceOutcomeHook((result, ctx) => {
  if (!ctx?.assetId || result.state == null) return
  recordConvergence({
    assetId: ctx.assetId,
    asset: ctx.asset,
    state: result.state,
    preset: ctx.preset ?? "intraday",
    score5: result.score5,
    quality: result.quality,
    confidence: result.confidence
  })
})

// Per-asset regime modulation mode (REQ-R3): "soft" is the default; "hard" and
// "off" are explicit per-asset overrides. The mode map is in-memory (settings
// surface wiring is a later fusion slice) — reset helpers exist for tests and
// for a settings toggle to land on without touching this module.
const REGIME_MODE_OVERRIDES = new Map() // assetId -> "soft"|"hard"|"off"

/** Register a per-asset modulation mode. Throws on an unknown mode (loud). */
export function setRegimeMode(assetId, mode) {
  if (!REGIME_MODE_LIST.includes(mode)) {
    throw new Error(`unknown regime mode "${mode}" (expected one of ${REGIME_MODE_LIST.join(",")})`)
  }
  REGIME_MODE_OVERRIDES.set(assetId, mode)
}

/** Test/dev hook: drop all per-asset mode overrides (default resumes). */
export function resetRegimeModes() {
  REGIME_MODE_OVERRIDES.clear()
}

/** The live-buffer ladder's preset (marketConvergence's own, spec 7b). */
const SECTION_PRESET = "intraday"

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
  // B-REG-3: regime read over the same planes; the bias plane is the preset's
  // bias role (regimeEngine imports PRESETS read-only — engine unchanged).
  const idKey = asset?.id ?? "default"
  const mode = REGIME_MODE_OVERRIDES.get(idKey) ?? "soft"
  const regime = detectRegimeLatched({
    assetId: idKey,
    planes,
    biasTf: PRESETS[SECTION_PRESET].bias
  })
  const knobs = regimeKnobs(
    { regime: regime.regime, volatile: regime.volatile, confidence: regime.confidence },
    { mode, preset: SECTION_PRESET }
  )
  const applied = knobs.weights != null || knobs.conservative
  const presetCfg = resolvePreset(SECTION_PRESET)
  const result = converge({
    planes,
    sourceByTf,
    staleByTf,
    // spec 5c: the intraday preset reads momentum from the RSI 60/40 band
    // (giua64 Intraday convention) — an RSI read, never StochRSI.
    momentumRsi: presetCfg?.momentum?.mode === "rsi60_40",
    ...(applied ? { weights: knobs.weights, conservative: knobs.conservative } : {}),
    outcome: { assetId: asset?.id ?? null, asset: asset?.name ?? null, preset: SECTION_PRESET }
  })
  // Feed the alert engine (spec 8a/8b): armed convergence_above alerts for
  // this symbol now evaluate against the freshest honest read. Absent reads
  // are null -> the condition stays silent (never triggers on no data).
  if (asset?.id) {
    updateConvergence(asset.id, {
      score5: result.score5,
      state: result.state,
      confidence: result.confidence
    })
  }
  // 9a: resolve matured convergence decisions against realized price (the
  // outcome hook above records new ones during converge()).
  try {
    flushConvergence()
  } catch {
    /* a bad resolve pass must not break the section */
  }
  return {
    ...result,
    assetId: asset?.id ?? null,
    asset: asset?.name ?? null,
    source: "liveEO-buffers",
    ts: now,
    // Additive regime block (R1 mitigation): how the read was modulated, and
    // by which regime. `applied` false + `labels` null = advisory, not applied.
    regime: { ...regime, mode, applied, labels: knobs.labels }
  }
}