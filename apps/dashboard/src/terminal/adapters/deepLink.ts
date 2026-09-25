/**
 * WS-6 T2 — legacy deep-link compatibility adapter (AC-001).
 *
 * PURE classifier for the frozen legacy contract in
 * `src/components/TradingSuite.tsx:159-199`. Side effects (chart focus/scroll,
 * broker-tab open) deliberately stay in the component so this module can be
 * tested with no React, no DOM, and no socket.
 *
 * Preserved legacy semantics:
 *  - Gate (`:168`): act only when `asset` is present, OR `panel === "chart"`,
 *    OR `venue` is present. `panel=table` and other values are inert.
 *  - Unknown asset (`:173-177`): selection stays UNCHANGED, logged, never
 *    thrown, never auto-executed. AC-001 forbids resetting to a default room.
 *  - Chart focus (`:179`): only the exact string `chart` focuses the panel.
 *  - Venue landing (`:183-184`): one landing per `${venue}|${asset ?? ""}` key,
 *    so catalog/realtime churn cannot re-open a broker tab.
 *  - Unknown legacy keys are PRESERVED, never discarded (AC-001).
 *
 * This adapter performs no I/O and opens no transport, so it cannot create a
 * second realtime subscription (also an AC-001 prohibited side effect).
 */

/** The only query keys the terminal interprets; everything else is preserved. */
export const RECOGNISED_DEEP_LINK_KEYS = ["asset", "panel", "venue"] as const

export type DeepLinkIntent = {
  /** True when the legacy gate would fire (asset | panel==="chart" | venue). */
  isDeepLink: boolean
  asset: string | null
  panel: string | null
  venue: string | null
  /** True only for the exact panel value "chart". */
  wantsChartFocus: boolean
  /** `${venue}|${asset ?? ""}` when a venue is requested, else null. */
  venueDedupeKey: string | null
  /** Query keys the terminal does not interpret, preserved for the URL contract. */
  unknownKeys: string[]
}

export type AssetResolution = {
  next: string
  changed: boolean
  known: boolean
  reason: string | null
}

function toParams(input: URLSearchParams | string): URLSearchParams {
  if (typeof input === "string") {
    // Tolerate a full path or a leading "?" as well as a bare query string.
    const q = input.indexOf("?")
    const query = q === -1 ? input : input.slice(q + 1)
    return new URLSearchParams(query)
  }
  return input
}

/** Treats whitespace-only as absent so a blank value can never select "". */
function textOrNull(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key)
  if (raw == null) return null
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function parseDeepLink(input: URLSearchParams | string): DeepLinkIntent {
  const params = toParams(input)

  const asset = textOrNull(params, "asset")
  const panel = textOrNull(params, "panel")
  const venue = textOrNull(params, "venue")

  // Legacy gate, verbatim: TradingSuite.tsx:168
  const isDeepLink = Boolean(asset) || panel === "chart" || Boolean(venue)

  const unknownKeys: string[] = []
  for (const key of params.keys()) {
    if (!(RECOGNISED_DEEP_LINK_KEYS as readonly string[]).includes(key)) {
      if (!unknownKeys.includes(key)) unknownKeys.push(key)
    }
  }

  return {
    isDeepLink,
    asset,
    panel,
    venue,
    wantsChartFocus: panel === "chart",
    venueDedupeKey: venue ? `${venue}|${asset ?? ""}` : null,
    unknownKeys
  }
}

/**
 * Applies the legacy unknown-asset rule: a requested asset is honoured only if
 * it is present in `known`; otherwise the CURRENT selection is preserved and a
 * reason is returned for logging. Never resets to a default.
 */
export function resolveAssetSelection(
  requested: string | null,
  known: readonly string[],
  current: string
): AssetResolution {
  if (requested == null) {
    return { next: current, changed: false, known: false, reason: null }
  }
  if (!known.includes(requested)) {
    return {
      next: current,
      changed: false,
      known: false,
      reason: `deep-link asset "${requested}" is unknown — selection unchanged`
    }
  }
  return {
    next: requested,
    changed: requested !== current,
    known: true,
    reason: null
  }
}

/**
 * One venue landing per dedupe key. `lastLandedVenue` is the ref the component
 * keeps; a repeat of the same key must not re-post the command or re-open the
 * fallback broker tab.
 */
export function shouldLandVenue(venueKey: string | null, lastLandedVenue: string | null): boolean {
  if (venueKey == null) return false
  return venueKey !== lastLandedVenue
}
