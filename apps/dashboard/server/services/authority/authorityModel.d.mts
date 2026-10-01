/**
 * Typed surface for `authorityModel.mjs`, for the CLIENT test that re-runs D10's
 * own assertion.
 *
 * WHY THIS EXISTS. `MinistryRoom.test.tsx` calls `authorityById` and
 * `unassignedAuthorityLabel` so the room's display value rests on the MODEL's
 * real behaviour rather than on T16's test having once passed. `authorityModel.mjs`
 * is plain `.mjs`, so the importer would otherwise get TS7016 and an `any`. The
 * precedent is `services/copilot/decision.d.mts`.
 *
 * ONLY THE TWO DISPLAY FUNCTIONS ARE DECLARED. `createAuthority` and
 * `defineAuthorities` construct records and are deliberately absent: a client test
 * that can type-check their construction is a client test that could mint an
 * authority, and D10's whole point is that the reservation must never be a record
 * no human holds.
 *
 * `authorityById` RETURNS `| null` AND THAT IS THE POINT. It is the function T16
 * asserts returns `null` for the reservation, so the declaration states the
 * nullable return rather than hiding it — a non-null return type here would let a
 * caller dereference the result of a lookup that is expected to fail.
 */

export type AuthorityRecord = {
  readonly id: string
  readonly title: string
  readonly scope: readonly string[]
  readonly canApprove: readonly string[]
}

/** D10's literal reservation, as a NAME. Never synthesised into a record. */
export declare const UNASSIGNED_RESERVATION: string

/**
 * `null` when there is no such record — never a synthesised stand-in. Asserted to
 * return `null` for `"WS-7+"`.
 */
export declare function authorityById(authorities: readonly unknown[], id: string): AuthorityRecord | null

/** An absent authority is `false`; there is no path by which "no record" permits. */
export declare function canApprove(authority: AuthorityRecord | null | undefined, roomKey: string): boolean

/** An unapprovable room yields `[]`, which is an answer rather than "unknown". */
export declare function approversForRoom(authorities: readonly unknown[], roomKey: string): string[]

export declare function unassignedAuthorityLabel(): string
