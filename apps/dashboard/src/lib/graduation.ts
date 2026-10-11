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
    returnPct: GraduationStat & {
      /**
       * The windows this average was actually taken over — NOT `windowsSeen`.
       *
       * `weightedMetric` drops a window whose picked statistic is `null`
       * (`weighting.mjs:283`), so a window with no strictly positive `amount`
       * contributes neither value nor count. Return is the statistic the paper
       * verdict is argued from (`GATE_PLANS.paper.stat` is `returnPct`), so
       * reading it without this is reading the number that moves the verdict.
       */
      windowsMeasured: number
    }
    sharpe: GraduationSharpe
    maxDd: GraduationMaxDd
    capitalCommittedUsd: number | null
    /**
     * Why the capital base is absent, SENT rather than rendered from a string the
     * UI holds itself.
     *
     * The first version made the UI hardcode this reason while the API sent a
     * bare `null`, and the two vocabularies had already diverged — the UI's copy
     * had dropped the `paper-leg:` prefix this server uses. A renderer that
     * invents vocabulary the API does not send cannot be corrected by fixing the
     * API later; the UI would keep rendering its own stale string.
     */
    capitalCommittedReason: string | null
    /**
     * How many closes `capitalCommittedUsd` is a sum over.
     *
     * IT IS A SUBSET OF THE EQUITY PILE, NOT THE SAME PILE. The equity pile
     * admits any close with a readable `pnl`; the capital sum additionally
     * requires a strictly positive `amount`. So a zero-amount close moves the
     * equity curve and commits no capital, and without this count a reader sees
     * a Sharpe annualised over 4 closes beside a dollar figure summed over 3 of
     * them, with nothing in the payload reconciling 4 against 3.
     */
    capitalBaseRows: number
    /**
     * The sample `sharpe.count` and `maxDd.count` were computed over.
     *
     * IT TRAVELS BESIDE THE STATISTICS BECAUSE THE SAMPLE IS THE POINT. A Sharpe
     * read without its sample size is the misreading this readout is most likely
     * to cause: two closes a day apart annualise to a large-looking number that
     * means nothing, and a bare figure gives a reader nothing to discount it with.
     */
    rowsInEquityPile: number
    /**
     * Windows in this tag's pile whose `pnl` could not be read, so they
     * contribute no step to the equity path. `rowsInEquityPile + rowsUnmeasured`
     * is always `windowsSeen`, which is what makes the two checkable.
     */
    rowsUnmeasured: number
    costDragUsd: GraduationCostDrag
  }
}

export interface GraduationLeg {
  present: boolean
  /** A list, not one string: an absent pile and a capped read are different facts. */
  reasons: string[]
  rowsSeen: number
  /**
   * The cap the read was bounded by, or `null` when no read was attempted (the
   * backtest leg), so the number cannot imply a bound that was never applied.
   */
  readLimit: number | null
  windows: number
}

export type GraduationLegs = {
  backtest: GraduationLeg
  paper: GraduationLeg
  live: GraduationLeg
}

export interface GraduationOverview {
  ok: boolean
  /** Always `true`. Nothing in this payload moves a permit or unlocks a venue. */
  advisory: boolean
  bars: { supplied: boolean; reason: string | null }
  tagSemantics: { field: string; scope: string; note: string }
  legs: GraduationLegs
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