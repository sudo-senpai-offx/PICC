// T11 (slice 6 reskin) — the shared honesty-first market-data source badge.
// The pre-slice chart badges claimed "EO live" for EVERY EO-buffered series
// regardless of freshness, and "EO headless live" implied live liveness for a
// headless-seeded feed. This badge speaks ONLY the server's tags (README /
// resolutionChain provenance + freshness), so it NEVER emits "EO live"/"EO
// headless live": the provenance is "studio"/"headless" when the server says
// so, buffers and Yahoo daily keep their real degraded labels, and an unknown
// slug renders muted — a ccxt/broker feed is not EO.
import { Badge } from "@/components/ui"

export interface SourceBadgeProps {
  /** The slug the SERVER served ("expertoption" | "live" | "buffer" | "ccxt" | ...). */
  servedSource: string | null
  /** Leg provenance for EO winners: "studio" | "headless" | null. */
  feed: string | null
  /** Server-reported staleness (stale series ≠ live data). */
  stale?: boolean
  /** Realtime transport offline (streamError from the shared bus). */
  streamError?: boolean
}

export function SourceBadge({ servedSource, feed, stale = false, streamError = false }: SourceBadgeProps) {
  if (!servedSource || servedSource === "none") return null
  const isEo = ["expertoption", "live", "buffer"].includes(servedSource)

  if (feed === "studio") {
    const status = streamError ? "stream offline" : stale ? "stale" : "active"
    return <Badge tone={streamError || stale ? "warn" : "success"}>EO studio · {status}</Badge>
  }
  if (feed === "headless") {
    const status = streamError ? "stream offline" : stale ? "stale" : "active"
    return <Badge tone={streamError || stale ? "warn" : "success"}>EO headless · {status}</Badge>
  }
  if (servedSource === "buffer") {
    return <Badge tone="warn">EO buffer{stale ? " · stale" : ""}</Badge>
  }
  if (servedSource === "yahoo" || servedSource === "yahoo-daily") {
    return <Badge tone="warn">Yahoo daily · delayed</Badge>
  }
  if (isEo) {
    const status = streamError ? "stream offline" : stale ? "stale" : "active"
    return <Badge tone={streamError || stale ? "warn" : "success"}>EO · {status}</Badge>
  }
  return <Badge tone="muted">{servedSource}{stale ? " · stale" : ""}</Badge>
}