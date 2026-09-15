/**
 * Per-suite last-room preference.
 *
 * Opening a ministry resumes the room you last closed (per suite): the
 * dispatcher records the resolved room; the suite index reads it back and
 * redirects. Storage key `picc.ministry.<suiteId>.lastRoom` stays isolated
 * from the `.settings` key used by ministrySettings.ts.
 *
 * Honesty contract: a stored value that no longer matches the suite's rooms
 * is ignored (returns null), never rendered into a dead link.
 */

const lastRoomKey = (suiteId: string) => `picc.ministry.${suiteId}.lastRoom`

/** Stored, still-valid room for a suite, or null when none/invalid. */
export function getLastRoom(suiteId: string | undefined, validRooms: readonly string[]): string | null {
  if (!suiteId || validRooms.length === 0) return null
  try {
    const raw = localStorage.getItem(lastRoomKey(suiteId))
    if (raw && validRooms.includes(raw)) return raw
  } catch {
    /* storage unavailable */
  }
  return null
}

/** Record the room a suite last opened. Callers validate the room first. */
export function rememberRoom(suiteId: string | undefined, room: string | undefined): void {
  if (!suiteId || !room) return
  try {
    localStorage.setItem(lastRoomKey(suiteId), room)
  } catch {
    /* storage unavailable */
  }
}