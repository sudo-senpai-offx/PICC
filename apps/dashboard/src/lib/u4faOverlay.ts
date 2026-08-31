import type { LiveEvent } from "@/lib/liveTrading"
import type { Time } from "lightweight-charts"
import type { CandleDatum } from "@/components/CandlestickChart"

/**
 * T7 — U4FA decision markers for the candlestick chart.
 *
 * Honesty contract: markers are rendered EXCLUSIVELY from real `type:"u4fa"`
 * SSE events the engine actually emitted for this asset. The server only emits
 * for assets whose U4FA strategy is enabled (adaptiveConfluence.mjs
 * strategies.u4fa.enabled), so a strategy-off asset naturally renders none.
 * Any event whose `honesty` block is missing or null is dropped — a decision
 * without named producers cannot be shown. No fabrication server- or client-side.
 *
 * Event timestamps are snapped to the nearest candle bar (tolerance: half the
 * median bar gap + 30s slack) and the marker reuses that bar's OWN time value,
 * so lightweight-charts `setMarkers` always sees a time that exists in the
 * candle series. Events with no bar nearby are dropped instead of mis-placed.
 */
export interface U4faMarker {
  time: Time
  position: "aboveBar" | "belowBar"
  shape: "arrowUp" | "arrowDown" | "circle"
  color: string
  text: string
}

const VERDICT_COLOR: Record<string, string> = {
  TRADE: "#4ade80",
  OBSERVE: "#f59e0b",
  NEUTRAL: "#94a3b8"
}

/** Seconds of a lightweight-charts time (numbers are already epoch seconds). */
function toSec(t: Time): number {
  return typeof t === "number" ? t : new Date(t as string).getTime() / 1000
}

/** Median gap between consecutive bar times — backdrop for the snap tolerance. */
function medianBarGap(candles: CandleDatum[]): number {
  const gaps: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const gap = toSec(candles[i].time) - toSec(candles[i - 1].time)
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap)
  }
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * Map realtime u4fa events onto the candle series as honest advisory markers.
 * Events arrive on the SHARED realtime stream for every opted-in asset, so the
 * caller filters by the chart's assetId here exactly once.
 */
export function u4faMarkersFor(events: LiveEvent[], assetId: string, candles: CandleDatum[]): U4faMarker[] {
  if (!candles.length) return []
  const step = medianBarGap(candles)
  const tolerance = Math.max(60, step / 2 + 30)
  // Bar lookup: candles are time-sorted (the chart sanitizes), binary search.
  const times = candles.map((c) => toSec(c.time))
  const findBar = (eventSec: number): CandleDatum | null => {
    let lo = 0
    let hi = times.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] < eventSec) lo = mid + 1
      else hi = mid
    }
    const candidates = [lo - 1, lo, lo + 1].filter((i) => i >= 0 && i < times.length)
    let best: CandleDatum | null = null
    let bestDist = Infinity
    for (const i of candidates) {
      const d = Math.abs(times[i] - eventSec)
      if (d < bestDist) {
        bestDist = d
        best = candles[i]
      }
    }
    return best && bestDist <= tolerance ? best : null
  }

  const byBar = new Map<number, U4faMarker>()
  const byBarTs = new Map<number, number>()
  for (const e of events) {
    if (e.type !== "u4fa") continue
    if (e.assetId !== assetId) continue
    // Honesty gate: a decision without named producers is not shown.
    if (!e.honesty) continue
    if (e.ts == null || !Number.isFinite(e.ts)) continue
    const bar = findBar(e.ts / 1000)
    if (!bar) continue
    const barSec = toSec(bar.time)
    const prevTs = byBarTs.get(barSec)
    // Newest event wins for a bar that saw several decisions.
    if (prevTs != null && e.ts <= prevTs) continue
    byBarTs.set(barSec, e.ts)
    const place = directionShape(e)
    byBar.set(barSec, {
      time: bar.time, // reuse the bar's OWN time — always valid in setMarkers
      position: place.position,
      shape: place.shape,
      color: VERDICT_COLOR[e.verdict] ?? "#94a3b8",
      text: e.verdict
    })
  }

  return [...byBar.values()].sort((a, b) => toSec(a.time) - toSec(b.time))
}

function directionShape(e: LiveEvent & { type: "u4fa" }): Pick<U4faMarker, "shape" | "position"> {
  if (e.direction === "down") return { shape: "arrowDown", position: "belowBar" }
  if (e.direction === "up") return { shape: "arrowUp", position: "aboveBar" }
  return { shape: "circle", position: "aboveBar" }
}