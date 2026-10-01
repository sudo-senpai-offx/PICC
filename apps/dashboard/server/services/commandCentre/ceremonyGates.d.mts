/**
 * Typed surface for `ceremonyGates.mjs`, for the CLIENT test that drives the real
 * WS-3 ceremony gates.
 *
 * WHY THIS EXISTS. `CeremonyRoom.test.tsx` calls `evaluateCeremony` against the
 * real store so the "empty store" rendering comes from the PRODUCER rather than
 * from a fixture imitating one — which is the difference between asserting R1.4
 * and asserting a hand-written copy of it. `ceremonyGates.mjs` is plain `.mjs`,
 * so the importer would otherwise get TS7016 and an `any`. The precedent is
 * `services/copilot/decision.d.mts`.
 *
 * `ENABLEMENT` IS A UNION DELIBERATELY. Every read in `ceremonyState.mjs` returns
 * `{ locked: true, reason }` when the store is unhealthy rather than the record
 * map, so a declaration that typed it as the map alone would let the room's
 * projection reach `.unlocked` on an unhealthy-store answer. The union is what
 * forces that branch to be handled.
 */

import type { CeremonyEnablementRecord, CeremonyPlatformVerificationRecord } from "./ceremonyState.mjs"

export type CeremonyGateOutcome = {
  /** Stable gate id, e.g. `gate1-constitution-300`. An audit-surface selector. */
  id: string
  pass: boolean
  /** The producer's own `ceremony:deny:*` string, or its pass reason. */
  reason: string
}

/**
 * `evaluateCeremony`'s own return contract.
 *
 * `ok` is the CEREMONY verdict — every gate satisfied — and is a DIFFERENT claim
 * from the route's top-level `ok`, which only means the readout executed. An
 * unhealthy store answers `ok: false` with every gate naming
 * `ceremony:deny:store-unhealthy`, and a dead resolve loop answers with a
 * synthesized `gate-ledger-health` deny, so `gates` is never empty on either of
 * those false verdicts.
 */
export declare function evaluateCeremony(
  venueClass: string,
  options?: { ledgerRunning?: boolean }
): {
  venueClass: string
  gates: CeremonyGateOutcome[]
  spendableResolved: number | null
  scaleResolved: number | null
  enablement: CeremonyEnablementRecord | null | { locked: true; reason: string }
  platformVerification: CeremonyPlatformVerificationRecord | null
  lastCreditAt: string | null
  ok: boolean
}

/**
 * The scale readout. `ok: false` carries the offending variable name and raw
 * value rather than a silent fallback to a wrong floor (R9.3/D7), which is why
 * `value` is only present on the `ok: true` branch.
 */
export declare function ceremonyScaleReadout(): { ok: true; value: number } | { ok: false; varName: string; raw: unknown }

export declare function ceremonyGate1(storeClass?: unknown): CeremonyGateOutcome
export declare function ceremonyGate2(storeClass?: unknown): CeremonyGateOutcome
export declare function ceremonyGate3(storeClass?: unknown): CeremonyGateOutcome
export declare function ceremonyGate4(storeClass?: unknown): CeremonyGateOutcome
export declare function ceremonyPlatformGate(venueClass: string, platformVerificationMap?: unknown): CeremonyGateOutcome | null
