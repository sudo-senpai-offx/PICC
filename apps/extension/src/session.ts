// PICC extension session probe — presence-only, NEVER value-bearing.
//
// 7c's "session capture" reports THAT the user's EO session exists in this
// browser without ever touching the tokens themselves: we forward storage KEY
// NAMES (and nothing else). Values stay in the page's own storage, exactly as
// the vault rule requires (spec §5: no real credentials anywhere in PICC's
// server, logs, or tests).

export const EO_SESSION_KEY_HINTS = ["picc-token", "token", "ssid", "session", "auth", "expertoption_session"]

export interface SessionProbe {
  authenticated: boolean
  /** Storage key names that CONTAIN a session marker — names only. */
  channels: string[]
}

/** Probe the page's localStorage (readable by the content script). */
export function probeEOSession(): SessionProbe {
  const channels: string[] = []
  for (const key of EO_SESSION_KEY_HINTS) {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(key) != null) {
        channels.push(key)
      }
    } catch {
      /* storage blocked — treated as absent */
    }
  }
  return { authenticated: channels.length > 0, channels }
}