import { RoomFrame } from "../components/RoomFrame"
import { CeremonySurface } from "../components/CeremonySurface"
import { ceremonyView, CEREMONY_NO_UNLOCK_AFFORDANCE_REASON } from "../domain/ceremonyRoom"
import type { CeremonyView } from "../domain/ceremonyRoom"

/**
 * WS-7 T8 — room instance 3 of 22 (D1's order): Ceremony.
 *
 * SCOPE, STATED PRECISELY, BECAUSE D27 FORBIDS TRIMMING IT QUIETLY.
 *
 * T8's acceptance line is: "Ceremony surfaces the WS-3 store's real state". The
 * producer is NOT rebuilt here and was never missing — it is the WS-3
 * `services/commandCentre/ceremonyState.mjs` store plus
 * `ceremonyGates.mjs`, both shipping long before WS-7, and the readout route is
 * the pre-existing WS-3 `GET /api/command-centre/ceremony`
 * (`handlers.mjs:1868`), which was already `requireAuth`-gated. T8's part was
 * the SURFACE, and that is the whole of it: no gate was moved, no threshold
 * restated, no new authority taken over the store.
 *
 * R1.4 IS WHAT MAKES "REAL STATE" A TESTABLE CLAIM, and it is stated here
 * rather than buried in the domain module because it is the acceptance criterion
 * this room is judged on.
 *
 * R1.4 (spec :384) requires the ceremony/handshake unlock requirements on the
 * real rails to be ASSERTED, not assumed. Two producer facts make that concrete,
 * and `CeremonyRoom.test.tsx` asserts both against the producer's own source
 * rather than against a fixture:
 *
 *   1. `unlockVenueClass()` THROWS outside a test run with
 *      `ceremony:deny:ceremony-action-unreachable` (`ceremonyState.mjs:189-191`).
 *      So on the real rail there is no path by which an unlock record comes into
 *      existence. This room therefore renders an unlock ONLY from a real
 *      `enablement` record and offers no unlock control at all — a room that
 *      could render "unlocked" without a test proving the rail enforces it would
 *      fail R1.4, and the test does prove it.
 *
 *   2. `evaluateCeremony()` short-circuits on gate1 and returns `ok: false` with
 *      a named `ceremony:deny:gate1-short` reason when a class has not
 *      accumulated 300 spendable resolved rows (`ceremonyGates.mjs:38-46`). An
 *      EMPTY store therefore yields FAILING gates, and this room renders that as
 *      an honest absence rather than as a fabricated unlock — asserted with a
 *      genuinely empty store, not a hand-written fixture.
 *
 * PRESENTATIONAL ONLY. The room takes the readout as a prop, opens no transport,
 * reads no clock of its own and requests no credential. `MinistryRoom.tsx`
 * renders rooms with no props, so the fetching caller is
 * `src/pages/ministry/CeremonyRoom.tsx`, mirroring how T7R-B split the Risk room.
 */
/** The readout's wire shape, taken from the projection so the two cannot drift. */
type CeremonyReadout = Parameters<typeof ceremonyView>[0]

export type CeremonyRoomProps = {
  /** The readout, or `null` when there is none. A caller never builds a placeholder. */
  readout: CeremonyReadout
}

export function buildCeremonyView(props: CeremonyRoomProps): CeremonyView {
  return ceremonyView(props.readout ?? null)
}

export function CeremonyRoom(props: CeremonyRoomProps) {
  const view = buildCeremonyView(props)
  return (
    <RoomFrame roomKey="ceremony" title="Ceremony" capabilityLabel="WS-3 ceremony store (gates, enablement, platform verification)">
      <CeremonySurface view={view} />
    </RoomFrame>
  )
}

/**
 * The room's D27 completeness verdict, carried in code so it cannot drift from
 * the report. See `MARKETS_COMPLETION` for why the verdict lives here and not
 * only in prose.
 */
export const CEREMONY_COMPLETION = {
  room: "ceremony",
  d1Order: 3,
  /**
   * GENUINELY COMPLETE, WITH ONE ABSENCE NAMED — and the absence is a real
   * runtime fact about this tree, not a trim.
   *
   * WHAT "COMPLETE" MEANS HERE, PRECISELY:
   *
   *  - COMPLETE means T8's acceptance line is met: "Ceremony surfaces the WS-3
   *    store's real state." It does. Every venue class the store knows about is
   *    rendered; every gate is rendered with the PRODUCER'S OWN `reason` string;
   *    enablement and platform verification each render as a record or as a
   *    named absence; and the room is reachable at `/suites/trading/ceremony`.
   *  - It does NOT mean any venue class is unlocked. Nothing in this tree has
   *    300 spendable resolved rows for a venue class, so the honest rendering
   *    today is every gate unsatisfied with `ceremony:deny:gate1-short (have 0,
   *    require 300)`. That is the acceptance met, not the acceptance missed:
   *    "with honest unavailability" is the Risk room's wording, and the same
   *    principle applies here because the alternative — an unlock the rail does
   *    not enforce — is exactly what R1.4 forbids.
   *  - R1.4's bar is met by ASSERTION, not by intent: `CeremonyRoom.test.tsx`
   *    reads `ceremonyState.mjs` and asserts (a) the unlock seam really does
   *    refuse outside a test run, and (b) the room renders no unlock for a store
   *    that holds no enablement record. Remove the producer's refusal and the
   *    first assertion fails; make the room infer an unlock from passing gates
   *    and the second fails.
   *
   * THE ONE THING THAT IS ABSENT, AND IT IS NOT A WS-8 BOUNDARY: there is no
   * ceremony-ACTION surface — no button, no route, no grant — because
   * `unlockVenueClass()` refuses outside a test run by design
   * (`ceremonyState.mjs:189-191`). T17 owns venue lifecycle and T18 owns data
   * sources; neither is what is missing here. What is missing is a deliberate
   * ceremony action, and the store's own comment says the gate/route modules own
   * that check. So this is recorded as an absence with a named owner rather than
   * as scope that belongs to a later workstream.
   */
  verdict: "complete",
  ws8Handoff: null,
  /**
   * The one absence is named HERE as well as in the prose above, deliberately.
   *
   * `JSON.stringify(CEREMONY_COMPLETION)` serialises the DATA fields only, so a
   * verdict that named its boundary solely in its JSDoc would serialise to
   * something that reads as a bare "complete". D27 asks for the boundary to be a
   * stated, reviewable thing; putting it in the field that survives
   * serialisation is what makes it so.
   */
  absences: Object.freeze([
    Object.freeze({
      what: "NO CEREMONY-ACTION SURFACE",
      detail:
        "The room exposes no button, route or grant, because unlockVenueClass() refuses outside a test run with " +
        "ceremony:deny:ceremony-action-unreachable — the store's own comment states that no ceremony-action route is wired " +
        "in production and that the gate/route modules own the unlock check. An unlock renders only when the store holds a " +
        "real enablement record, and no such record can be created on the real rail today.",
      owner: "WS-3 ceremony store, by design — a deliberate ceremony action is a product decision",
      isWs8Scope: false
    })
  ]),
  reason:
    `No scope in this room logically belongs to WS-8. The store, the four gates and the platform-verification gate are all WS-3 work that shipped before WS-7 opened: services/commandCentre/ceremonyState.mjs and ceremonyGates.mjs, read out through the pre-existing requireAuth-gated GET /api/command-centre/ceremony (handlers.mjs:1868), which T8 reused rather than duplicating. No gate, threshold, band or enablement record was restated by this room — ${CEREMONY_NO_UNLOCK_AFFORDANCE_REASON} The room renders an empty store as an honest absence, which R1.4 requires and which a fabricated unlock would violate. A WS-8 handoff here would be false, and recording none while an unlock affordance were missing would be the unflagged trim AC-020 prohibits: the affordance's absence is stated above, with the producer's own refusal as the reason.`
} as const
