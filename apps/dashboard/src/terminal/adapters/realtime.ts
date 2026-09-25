import type { Availability } from "../domain/availability"
import { live, stale, unavailable } from "../domain/availability"

/**
 * WS-6 T3 — realtime adapter (AC-007).
 *
 * Consumes the EXISTING shared bus. It opens no socket, creates no second
 * transport, and holds no state of its own: the singleton invariant frozen by
 * T0 (one `SuiteStreamManager` on `globalThis.__picc_suite_stream`) is
 * untouched. This module only NORMALIZES what the bus already reports.
 *
 * The two rules it exists to enforce:
 *  1. Availability is OBSERVED. No snapshot, a disconnected stream, or a
 *     reported error is `unavailable` with a reason — never `live`.
 *  2. Absent data stays `null`. A section that has not been observed is
 *     `null`, never `0` and never `[]` (AC-007's prohibited side effect). A
 *     genuinely observed `0` or `[]` is preserved, because unconfigured is not
 *     the same as zero.
 */

export type RawRealtime = {
  connected: boolean
  error: string | null
  snapshot: { ts?: number; trading?: unknown; positions?: unknown; closed?: unknown; signals?: unknown } | null
}

export type SuiteData = {
  trading: unknown | null
  positions: unknown[] | null
  closed: unknown[] | null
  signals: unknown[] | null
}

export type NormalizedRealtime = {
  availability: Availability
  data: SuiteData
}

const OWNER = "realtime bus"

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Copies only sections that were actually observed. A missing section is null;
 * an observed empty array stays an empty array.
 */
export function extractSuiteData(snapshot: RawRealtime["snapshot"]): SuiteData {
  if (!snapshot || typeof snapshot !== "object") {
    return { trading: null, positions: null, closed: null, signals: null }
  }
  return {
    trading: snapshot.trading ?? null,
    positions: isArray(snapshot.positions) ? snapshot.positions : null,
    closed: isArray(snapshot.closed) ? snapshot.closed : null,
    signals: isArray(snapshot.signals) ? snapshot.signals : null
  }
}

export function normalizeRealtime(
  raw: RawRealtime,
  opts: { now?: number; maxAgeMs?: number; source?: string } = {}
): NormalizedRealtime {
  const now = opts.now ?? Date.now()
  const maxAgeMs = opts.maxAgeMs ?? 15_000
  const source = opts.source ?? "suite realtime stream"
  const data = extractSuiteData(raw.snapshot)

  if (raw.error != null && raw.error.trim().length > 0) {
    return { availability: unavailable({ reason: raw.error, owner: OWNER, since: now }), data }
  }

  if (!raw.connected) {
    return {
      availability: unavailable({ reason: "realtime stream is not connected", owner: OWNER, since: now }),
      data
    }
  }

  if (raw.snapshot == null) {
    return {
      availability: unavailable({ reason: "awaiting the first suite event from the realtime stream", owner: OWNER, since: now }),
      data
    }
  }

  const ts = typeof raw.snapshot.ts === "number" ? raw.snapshot.ts : null
  if (ts != null && now - ts > maxAgeMs) {
    return {
      availability: stale({
        source,
        observedAt: ts,
        reason: `last suite event is ${now - ts}ms old (max ${maxAgeMs}ms)`
      }),
      data
    }
  }

  return {
    availability: live({ source, observedAt: ts ?? now, freshnessMs: ts == null ? 0 : now - ts }),
    data
  }
}
