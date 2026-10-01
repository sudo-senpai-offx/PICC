import { useEffect, useState } from "react"
import { fetchReadOnlyView } from "@/terminal/adapters/readOnlyReading"
import { buildReadOnlyRoomView } from "@/terminal/domain/readOnlyRooms"
import type { ReadOnlyRoomKey, ReadOnlyRoomView, ReadOnlySuiteId } from "@/terminal/domain/readOnlyRooms"

/**
 * WS-7 T10 — the page-caller seam. Sixteen instances use this ONE hook.
 *
 * `MinistryRoom.tsx` renders `<Room />` with no props, and the terminal rooms are
 * presentational by design, so a caller has to exist to hand each room its
 * reading. That is `pages/ministry/*Room.tsx`, and this hook is what all sixteen
 * of them use rather than sixteen near-identical `useEffect` bodies.
 *
 * THE INITIAL VALUE IS AN UNOBSERVED VIEW, NEVER A PLACEHOLDER. The hook starts
 * from `buildReadOnlyRoomView({ key, suite, readouts: {} })`, which is the honest
 * "nothing observed yet" state and renders the room's named absences. An earlier
 * instinct was to start from a fabricated populated view and let the fetch replace
 * it, which is exactly the zero-fill this task exists to prevent: for the length
 * of the first paint the room would have claimed observations nobody made.
 *
 * A FAILED FETCH LEAVES THE ROOM UNOBSERVED rather than blanking it. The adapter
 * turns a refusal into a named absence inside the view, so a transport failure is
 * a rendered fact about the room rather than an empty page — which is what makes
 * each instance independently revertible: pull the network out and the room still
 * identifies itself and says what it cannot see.
 *
 * RE-FETCHING ON A KEY CHANGE is deliberate and is the bisect property in
 * practice: a room's state is scoped to its own (key, suite), so switching rooms
 * cannot leave the previous room's observations on screen.
 */
export function useReadOnlyView(
  key: ReadOnlyRoomKey,
  suite: ReadOnlySuiteId
): { view: ReadOnlyRoomView; loading: boolean; failed: boolean } {
  const [view, setView] = useState<ReadOnlyRoomView>(() =>
    buildReadOnlyRoomView({ key, suite, readouts: {} })
  )
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    // Reset to unobserved on a key/suite change, so the previous room's data
    // cannot survive into this one.
    setView(buildReadOnlyRoomView({ key, suite, readouts: {} }))
    setLoading(true)
    setFailed(false)

    fetchReadOnlyView(key, suite)
      .then((next) => {
        if (alive) setView(next)
      })
      .catch(() => {
        // The adapter resolves refusals into the view, so reaching here means the
        // projection itself failed. Record it and LEAVE THE ROOM UNOBSERVED: an
        // exception must not become a populated room.
        if (alive) setFailed(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [key, suite])

  return { view, loading, failed }
}