import { useEffect, useState } from "react"
import { MinistryRoom as TerminalMinistryRoom } from "@/terminal/routes/MinistryRoom"
import { fetchMinistryGovernance } from "@/terminal/adapters/governanceReading"

/**
 * WS-7 T8 — the page composition for the Ministry room.
 *
 * WHY THE FILE IS CALLED `MinistryAuthorityRoom` AND NOT `MinistryRoom`.
 *
 * `pages/ministry/MinistryRoom.tsx` is the SUITE ROUTER — it holds `INNER_NAV`'s
 * counterpart map `MINISTRY_ROOMS` and resolves a room by URL param. The page
 * composition for the `ministry` key cannot take that name, so it continues the
 * name T7R-A's reserved body already used for exactly this slot
 * (`reservedRooms.tsx` exported `MinistryAuthorityRoom`). An earlier draft of
 * this task overwrote the router with this content; the router was restored from
 * `git` and this composition was given the name that was free. Recorded here
 * because the collision is invisible in a diff that adds files.
 *
 * WHY THIS FILE EXISTS AT ALL. The router lazy-maps the `ministry` key and
 * renders rooms with NO props (`<Room />`), while the terminal Ministry room is
 * presentational by design and takes its readout as a prop. From `e9c8137` until
 * this task that combination rendered a reserved body naming WS-7 T8 as its
 * owner — a correct named absence, and now discharged.
 *
 * It is the same shape as T7R-B's `pages/ministry/RiskRoom.tsx`: fetch ONE
 * readout, hand it to the room.
 *
 * IT DEPENDS ON NOTHING ELSE'S STATE. T8's bisect line (spec :1271) requires
 * that "neither room may depend on the other to render; both degrade to reserved
 * independently". Concretely, this caller:
 *
 *   - fetches `/api/trading/ministry` and NOTHING ELSE — no ceremony route, no
 *     candles, no market data. The Ceremony room is not a dependency of this
 *     render at any layer: not in this file, not in the adapter, not in the
 *     route, and not in the room.
 *   - holds no shared store, no context and no module-level state. Each caller
 *     owns one `useState` and one `useEffect`, so mounting this room mounts no
 *     part of Ceremony's.
 *   - renders its own named absences. With the readout absent, the room shows the
 *     unavailable states for the authority set and the permit log, and zero
 *     room-separation rows, which is visibly different from a populated readout
 *     rather than a blank shell that could pass for either.
 *
 * A pending request renders as `null`, which the room projects into named
 * absences. It is not a clean separation state and it is not a registered
 * authority.
 */
export function MinistryAuthorityRoom() {
  const [readout, setReadout] = useState<Awaited<ReturnType<typeof fetchMinistryGovernance>>["readout"]>(null)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    void fetchMinistryGovernance({ signal: controller.signal }).then((next) => {
      if (alive) setReadout(next.readout)
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [])

  return <TerminalMinistryRoom readout={readout} />
}
