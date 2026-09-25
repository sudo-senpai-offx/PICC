import { useMemo } from "react"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { normalizeRealtime, type SuiteData } from "../adapters/realtime"
import type { Availability } from "../domain/availability"

/**
 * WS-6 T3 — terminal snapshot hook (AC-007).
 *
 * Consumes the EXISTING shared bus through `useRealtimeSuite`, which is a
 * listener over the process-wide `SuiteStreamManager` singleton. This hook
 * therefore opens NO transport of its own: N terminal consumers still produce
 * exactly one connection, which is the T0 invariant.
 *
 * It performs no fetch and no credential read. All it does is normalize what the
 * bus already reports into `{ availability, data }`, where an unobserved
 * section stays `null` rather than becoming `0` or `[]`.
 */
export type TerminalSnapshot = {
  availability: Availability
  data: SuiteData
  connected: boolean
  error: string | null
}

export function useTerminalSnapshot(maxAgeMs = 15_000): TerminalSnapshot {
  const { snapshot, connected, error } = useRealtimeSuite()

  return useMemo(() => {
    const normalized = normalizeRealtime(
      { connected, error, snapshot: snapshot as never },
      { maxAgeMs }
    )
    return {
      availability: normalized.availability,
      data: normalized.data,
      connected,
      error
    }
  }, [snapshot, connected, error, maxAgeMs])
}
