/**
 * WS-6 T6 — incremental chart update planner (AC-003).
 *
 * The existing `CandlestickChart.tsx:437-444` calls `setData` on every series
 * update, which is a FULL replacement per tick. On the owner-locked
 * Atom/Snapdragon floor that is the wrong shape: a price tick should touch one
 * bar, not rebuild the series.
 *
 * This module is the decision layer only. It is pure, so the routing decision
 * ("incremental" vs "replace" vs "noop") is testable with no canvas, no
 * lightweight-charts instance, and no DOM. The component applies the plan.
 *
 * D14 honesty: a bar carries no aggressor-side information, so delta, CVD, and
 * absorption are reported as unavailable on every plan. The planner never emits a
 * numeric placeholder for them — the same rule enforced for order flow in
 * `adapters/realtime.ts` and `domain/availability.ts`.
 */

export type ChartBar = { time: number; open: number; high: number; low: number; close: number }

export type ChartUpdatePlan = {
  kind: "incremental" | "replace" | "noop"
  /** The bars to pass to the series' incremental update path. */
  bars: ChartBar[] | null
  /** The full series, when a full replace is required. */
  series: ChartBar[] | null
  /** Fields that cannot be derived from OHLC bars (D14). */
  unavailableFields: string[]
  values: Record<string, number | undefined>
}

const BAR_ONLY_UNAVAILABLE = ["delta", "cvd", "absorption"] as const

function sameBar(a: ChartBar, b: ChartBar): boolean {
  return (
    a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close
  )
}

export function planChartUpdate(previous: readonly ChartBar[], next: readonly ChartBar[]): ChartUpdatePlan {
  const values: Record<string, number | undefined> = {}
  const unavailableFields = [...BAR_ONLY_UNAVAILABLE]

  const unchanged = previous.length === next.length && previous.every((b, i) => sameBar(b, next[i]))
  if (unchanged) {
    return { kind: "noop", bars: null, series: null, unavailableFields, values }
  }

  // A structural change (count shrank, a historical bar was rewritten, or the
  // series started from empty) cannot be expressed as an incremental update and
  // must take the bounded full-refresh path instead.
  const structural =
    next.length === 0 ||
    next.length < previous.length ||
    previous.length === 0 ||
    previous[0]?.time !== next[0]?.time ||
    previous.slice(0, -1).some((b, i) => !sameBar(b, next[i]))

  if (structural) {
    return { kind: "replace", bars: null, series: [...next], unavailableFields, values }
  }

  // Only the tail changed, or a bar was appended: update just those bars.
  // When every previous bar still matches, findIndex returns -1; the first bar
  // that actually needs updating is then the first APPENDED bar, not index 0.
  // Slicing from 0 there would re-send the whole series and defeat the
  // incremental path entirely.
  const firstChanged = previous.findIndex((b, i) => !sameBar(b, next[i]))
  const start = firstChanged === -1 ? previous.length : firstChanged
  return {
    kind: "incremental",
    bars: next.slice(start),
    series: null,
    unavailableFields,
    values
  }
}
