/**
 * Typed surface for `ceremonyState.mjs`, for the CLIENT test that drives the real
 * WS-3 ceremony store.
 *
 * WHY THIS EXISTS. `CeremonyRoom.test.tsx` imports `KNOWN_VENUE_CLASSES` so it
 * can render the store's REAL venue-class inventory rather than a hand-picked
 * subset, and reads this module's source to assert R1.4's claim about the unlock
 * seam. `ceremonyState.mjs` is plain `.mjs`, so the importer would otherwise get
 * TS7016 and an `any`. The precedent is `services/copilot/decision.d.mts`.
 *
 * ONLY THE READ SURFACE IS DECLARED, and that restriction is the safety property
 * rather than an omission. `creditResolved`, `unlockVenueClass`,
 * `setPlatformVerification`, `setAssetClasses` and `resetCeremonyState` are all
 * MUTATION seams, and they are deliberately absent from this declaration: a
 * client-side test that can type-check a call to one of them is a client-side test
 * one edit away from writing to the developer's real ceremony store. The room's
 * assertions are about what the store REPORTS, so the report is all this needs.
 */

export type CeremonyEnablementRecord = {
  unlocked: true
  at: string
  by: string
}

export type CeremonyPlatformVerificationRecord = {
  verified: true
  at: string
  by: string | null
  regulator: string | null
  payoutFloorPct: number | null
  payoutUnderFloor: boolean
  withdrawalTested: boolean
}

export type CeremonyClassState = {
  windowOpenedAt: string | null
  lastCreditAt: string | null
  spendableResolved: number
  byEngine: Record<string, Record<string, { hits: number; misses: number; total: number }>>
  streak: Array<{ ledgerSeq: number | null; ts: number; dayKey: string; result: string; winProb: number | null }>
  tradingDays: string[]
}

/** The store's closed venue-class vocabulary. D2/AC-005 removed the third member. */
export declare const KNOWN_VENUE_CLASSES: string[]

export declare const STREAK_LIMIT: number

export declare function storeHealth(): { ok: boolean; reason?: string }

export declare function ceremonyState(): unknown

export declare function classState(venueClass: string): CeremonyClassState | null

export declare function enablement(): Record<string, CeremonyEnablementRecord | null> | { locked: true; reason: string }

export declare function platformVerification(): Record<string, CeremonyPlatformVerificationRecord | null> | { locked: true; reason: string }

export declare function recentDenials(n?: number): Array<{ at: string; seq: number | null; reason: string }>
