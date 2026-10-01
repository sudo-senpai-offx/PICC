import { RoomFrame } from "../components/RoomFrame"
import { ReadOnlyRoomSurface } from "../components/ReadOnlyRoomSurface"
import { buildReadOnlyRoomView } from "../domain/readOnlyRooms"
import type { ReadOnlyRoomKey, ReadOnlyRoomView, ReadOnlySuiteId } from "../domain/readOnlyRooms"

/**
 * WS-7 T10 — room instances 7..22 of 22 (D1's residual): the remaining
 * read-only rooms.
 *
 * Spec :1282-1289, and the whole task is three lines of it:
 *
 *   Acceptance: AC-020 passes per instance. Read-only rooms never acquire a write
 *               affordance; unavailable data is unavailable, not zero.
 *   Bisect:     Each instance is independently revertible.
 *
 * WHAT THIS ROOM IS. A presentational frame around ONE surface, given a view and
 * nothing else. It takes no transport, opens no socket, reads no clock and
 * requests no credential — which is what makes "each instance is independently
 * revertible" structural rather than aspirational: an instance with no readouts
 * at all still renders, identifies itself, and names what it does not know.
 *
 * WHY IT IS NOT SIXTEEN COMPONENTS. Nine distinct room keys are instantiated
 * sixteen times (three dashboards, three settings, three studios, two
 * simulators, and one each of autopilot, command-centre, dispatch, governor and
 * guidance). One frame + one surface + one projection serves all sixteen; the
 * instances differ as DATA. A test asserts this module exports no per-key branch
 * and that the domain module has exactly one projection entry point, because
 * sixteen exported builders would be sixteen shapes free to drift.
 *
 * THE AC-020 / D27 VERDICTS ARE NOT HERE. They are per INSTANCE, and an instance
 * is a (suite, key) pair — sixteen of them — so they live in
 * `readOnlyRoomCompletions.ts` as one frozen array that T21's D27 check can
 * enumerate. A verdict reachable only by a hand-written constant name is a verdict
 * a later task will forget to look at.
 */

export type ReadOnlyRoomProps = {
  /** Pre-built by the page caller, or built here from readouts if given those. */
  view?: ReadOnlyRoomView
  readouts?: Readonly<Record<string, unknown>> | null
  suite?: ReadOnlySuiteId
  key?: ReadOnlyRoomKey
}

/**
 * The route takes whichever of the two forms it was given. A `view` is preferred
 * because it is what the projection already produced; readouts are accepted so a
 * caller that has only wire data does not have to import the projection to build
 * the room. Both paths go through `buildReadOnlyRoomView`, so there is still
 * exactly one projection in the tree.
 */
export function ReadOnlyRoom({ view, readouts, suite, key }: ReadOnlyRoomProps) {
  const resolved =
    view ??
    buildReadOnlyRoomView({
      key: (key ?? "dashboard") as ReadOnlyRoomKey,
      suite: (suite ?? "trading") as ReadOnlySuiteId,
      readouts: readouts ?? {}
    })
  return (
    <RoomFrame
      roomKey={resolved.key}
      title={`${resolved.title}`}
      capabilityLabel={resolved.capabilityLabel}
    >
      <ReadOnlyRoomSurface view={resolved} />
    </RoomFrame>
  )
}

export type { ReadOnlyRoomKey, ReadOnlyRoomView, ReadOnlySuiteId }