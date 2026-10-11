import { getToken } from "./auth"

/**
 * Typed client for `GET /api/graduation/overview` (W3-04 Task 4).
 *
 * THE TYPES ARE A CLOSE TRANSCRIPT OF THE PAYLOAD, and the absences are typed
 * as they are served rather than widened: every statistic is
 * `{ value: number | null; reason: string | null }`, because `null` here means
 * "nobody measured this" and `0` means "measured, and it was zero". Widening a
 * statistic to `number` is what turns the first into the second at the render
 * boundary, so the types make that mistake a compile error instead of a silent
 * one.
 */

/** A statistic: a measured number, or an absence carrying the reason for it. */
export interface GraduationStat {
  value: number | null
  reason: string | null
}

export interface GraduationSharpe extends GraduationStat {
  count: number
}

export interface GraduationMaxDd extends GraduationStat {
  /** Percentage drawdown, against the reported capital base. `null` when unmeasured. */
  pct: number | null
  count: number
}

export interface GraduationCostDrag extends GraduationStat {
  /** W3-02 overlay provenance, read off the lines. Paper is `modeled`. */
  provenances: string[]
  /** Always `false`: no layer in the stack applies a drag adjustment. */
  adjusted: boolean
}

export interface GraduationSourceRow {
  stat: string | null
  bar: number | null
  windowsSeen: number
  windowsMeasured: number
  weighted: {
    value: number | null
    totalWeight: number
    windowCount: number
    reason: string | null
  }
}

export interface GraduationStrategy {
  tag: string
  stage: string
  verdict: string
  promoted: boolean
  demoted: boolean
  windowsUsed: number
  windowsSeen: number
  skipped: Record<string, number>
  /** Keyed by source; iterated by the UI, never indexed, so an unfamiliar key is safe. */
  sources: Record<string, GraduationSourceRow>
  reasons: string[]
  warnings: string[]
  stats: {
    returnPct: GraduationStat & { windowsMeasured: number }
    sharpe: GraduationSharpe
    maxDd: GraduationMaxDd
    capitalCommittedUsd: number | null
    costDragUsd: GraduationCostDrag
  }
}

export interface GraduationLeg {
  present: boolean
  reason: string | null
  rowsSeen: number
  windows: number
}

/**
 * The paper leg's own shape, which is NOT the other two.
 *
 * It carries a REASON LIST rather than one reason string because a capped read
 * and an empty pile are different facts that can hold at once, and it carries the
 * read limit beside the count that limit bounds — without which "12 rows" reads
 * as "the whole paper history", which is a claim the route cannot support.
 */
export interface GraduationPaperLeg extends GraduationLeg {
  reasons: string[]
  readLimit: number
}

export interface GraduationOverview {
  ok: boolean
  /** Always `true`. Nothing in this payload moves a permit or unlocks a venue. */
  advisory: boolean
  bars: { supplied: boolean; reason: string | null }
  tagSemantics: { field: string; scope: string; note: string }
  legs: { backtest: GraduationLeg; paper: GraduationPaperLeg; live: GraduationLeg }
  strategies: GraduationStrategy[]
  unattributed: { rows: number; reason: string | null }
  excluded: Array<{ key: string; count: number }>
  costLinesSkipped: Array<{ closeId: string | null; reason: string }>
  incomplete: boolean
  reason: string | null
}

// Same header construction as lib/costs.ts and lib/wealth.ts: auth token when
// logged in. The route is gated, so an anonymous call is refused with a 401 and
// the section renders a refusal rather than an empty readout.
function headers(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchGraduationOverview(): Promise<GraduationOverview> {
  const res = await fetch("/api/graduation/overview", { headers: headers() })
  if (!res.ok) throw new Error(`graduation overview GET failed: ${res.status}`)
  return (await res.json()) as GraduationOverview
}