// PICC spread-feed provider seam (WS-2 T6, spec §3.6). Honesty contract:
// `spreadFeedFor(assetClass)` returns a MEASURED { spreadPips, source, at } or
// honest null. No default provider, no fabricated feed — an empty registry or
// an invalid reading is null, and every consumer stays fail-closed (spreadGateF1
// aborts unmeasurable). The registry is read from the u4faConfig `spreadProviders`
// map (default empty); `PICC_SPREAD_FEED_PROVIDER` names one provider by key.
import { KNOWN_CLASSES } from "./u4faConfig.mjs"

export const SPREAD_PROVIDER_ENV = "PICC_SPREAD_FEED_PROVIDER"

function providersOf(config) {
  const providers = config?.spreadProviders ?? null
  return providers != null && typeof providers === "object" && !Array.isArray(providers) ? providers : null
}

function selectProvider(config, envName) {
  if (envName == null || envName === "") return null
  const providers = providersOf(config)
  if (providers == null) return null
  return providers[envName] ?? null
}

/** Shape-validate a provider read. Any failure → null (unmeasurable, never a guess). */
export function validateSpreadReading(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null
  const pips = Number(raw.spreadPips)
  if (!Number.isFinite(pips) || pips < 0) return null
  if (typeof raw.source !== "string" || raw.source.length === 0) return null
  const at = Number(raw.at)
  if (!Number.isFinite(at)) return null
  return { spreadPips: pips, source: raw.source, at }
}

/**
 * Resolve one asset class to a measured spread reading (or null).
 * The registry is read from the u4faConfig providers map; when `config` is not
 * supplied the seam loads the live config (registry default empty).
 */
export async function spreadFeedFor(assetClass, { config = null } = {}) {
  if (config == null) {
    try {
      const { loadU4faConfig } = await import("./u4faConfig.mjs")
      config = (await loadU4faConfig({})).config
    } catch {
      config = null
    }
  }
  const provider = selectProvider(config, process.env[SPREAD_PROVIDER_ENV])
  if (provider == null) return null
  let raw = null
  try {
    raw = typeof provider === "function" ? await provider(assetClass) : await provider.read(assetClass)
  } catch {
    return null
  }
  return validateSpreadReading(raw)
}

/** Per-class snapshot for a whole decision tick: honest null per unmapped class. */
export async function spreadSnapshotFor(config = {}) {
  const out = {}
  for (const cls of KNOWN_CLASSES) out[cls] = await spreadFeedFor(cls, { config })
  return out
}

/**
 * Resolve the runtime context's spread shape to the value for one asset class.
 * Accepts the live per-class snapshot (map keyed by calibration class) AND the
 * single reading/null shapes existing fixtures inject; both stay untouched.
 */
export function resolveSpreadReading(ctxSpread, assetClass) {
  if (ctxSpread == null || typeof ctxSpread !== "object") return null
  if (Number.isFinite(Number(ctxSpread.spreadPips))) return ctxSpread
  return ctxSpread[assetClass] ?? null
}