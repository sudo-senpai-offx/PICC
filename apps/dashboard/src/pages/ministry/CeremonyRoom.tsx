import { useEffect, useState } from "react"
import { CeremonyRoom as TerminalCeremonyRoom } from "@/terminal/routes/CeremonyRoom"
import { fetchCeremonyReadout } from "@/terminal/adapters/governanceReading"

/**
 * WS-7 T8 — the page composition for the Ceremony room.
 *
 * WHY THIS FILE EXISTS AT ALL. `MinistryRoom.tsx` lazy-maps the `ceremony` key
 * and renders rooms with NO props (`<Room />`), while the terminal Ceremony room
 * is presentational by design and takes its readout as a prop. That combination
 * is why the key existed as a RESERVED body from `e9c8137`: there was a key and
 * no surface, and a reserved body is the honest rendering of that gap rather
 * than a plausible-looking placeholder (see `reservedRooms.tsx`'s own header).
 *
 * This module is the caller, and it is deliberately the same shape as T7R-B's
 * `pages/ministry/RiskRoom.tsx`: fetch ONE readout, hand it to the room. Two
 * things are worth naming:
 *
 *   - IT REUSES THE EXISTING ROUTE. There is no `POST /api/trading/ceremony`.
 *     The WS-3 `GET /api/command-centre/ceremony` (`handlers.mjs:1868`) already
 *     served this store, already gated. A second route would give one store two
 *     answers.
 *   - IT DOES NOT COMPUTE, AND IT HAS NO UNLOCK CONTROL TO GIVE. It cannot
 *     unlock a venue class even if it wanted to: the store's `unlockVenueClass()`
 *     refuses outside a test run (`ceremonyState.mjs:189-191`). This caller
 *     therefore has nothing to fabricate and nothing to enable — the R1.4
 *     property is structural here rather than a promise.
 *
 * A pending request renders as `null`, which the room projects into named
 * absences. A pending request is NOT zero gates, and it is NOT an unlock.
 */
export function CeremonyRoom() {
  const [readout, setReadout] = useState<Awaited<ReturnType<typeof fetchCeremonyReadout>>["readout"]>(null)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    void fetchCeremonyReadout({ signal: controller.signal }).then((next) => {
      if (alive) setReadout(next.readout)
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [])

  return <TerminalCeremonyRoom readout={readout} />
}
