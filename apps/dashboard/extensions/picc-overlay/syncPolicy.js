// PICC Sensor — per-stream sync cadence policy (pure).
//
// A stream's venue-session sync cadence is a pure function of the activity of
// the tab that HOSTS that stream — never of which tab is the browser's
// globally-active one. Switching tabs must not stop a stream that was just
// active: a stream stays REALTIME for ACTIVITY_WINDOW_MS after its tab last had
// focus, degrades to INTERMITTENT once that window lapses, and drops to
// LONG-period on prolonged inactivity.
//
// This module is shared verbatim between the extension background worker
// (background.js imports it — MV3 type:module) and the server-side unit tests,
// so the policy never drifts between what ships and what is verified.

export const SYNC = {
  // The scheduler beat: MV3 alarms enforce a 30 s minimum, so this is both the
  // alarm period and the fastest cadence the worker can direct.
  TICK_MS: 30_000,
  // Realtime — the stream's tab is focused, or was focused within the window.
  REALTIME_MS: 15_000,
  // Intermittent — activity window lapsed, inactivity still below prolonged.
  INTERMITTENT_MS: 90_000,
  // Long-period — prolonged inactivity.
  LONG_MS: 300_000,
  // A stream stays realtime this long after its tab last had focus.
  ACTIVITY_WINDOW_MS: 60_000,
  // Inactivity at/above this is "prolonged" → long-period sync.
  PROLONGED_MS: 600_000
}

/**
 * Resolve a stream's sync cadence from its tab's activity state.
 * @param {{ active?: boolean, lastFocusedAt?: number }} tab activity snapshot
 * @param {number} now epoch ms
 * @returns {number} cadence ms
 */
export function cadenceFor({ active = false, lastFocusedAt = 0 } = {}, now = Date.now()) {
  const sinceFocus = now - lastFocusedAt
  if (active || sinceFocus < SYNC.ACTIVITY_WINDOW_MS) return SYNC.REALTIME_MS
  if (sinceFocus < SYNC.PROLONGED_MS) return SYNC.INTERMITTENT_MS
  return SYNC.LONG_MS
}

/**
 * Q5 — resolve a stream's sync cadence with an optional per-site override.
 * Tier selection is identical to cadenceFor (activity window → realtime,
 * prolonged → intermittent, else long); a connector may override the ms for
 * each tier and each threshold. Any field the override omits falls back to the
 * cross-site SYNC policy. Returns the raw tier ms (no beat floor — the worker
 * applies TICK_MS), keeping this a pure policy resolver like cadenceFor.
 * @param {{ active?: boolean, lastFocusedAt?: number }} tab activity snapshot
 * @param {number} now epoch ms
 * @param {object} [override] { realtimeMs, intermittentMs, longMs, activityWindowMs, prolongedMs }
 * @returns {number} cadence ms
 */
export function cadenceMsFor({ active = false, lastFocusedAt = 0 } = {}, now = Date.now(), override = {}) {
  const realtimeMs = override.realtimeMs ?? SYNC.REALTIME_MS
  const intermittentMs = override.intermittentMs ?? SYNC.INTERMITTENT_MS
  const longMs = override.longMs ?? SYNC.LONG_MS
  const activityWindowMs = override.activityWindowMs ?? SYNC.ACTIVITY_WINDOW_MS
  const prolongedMs = override.prolongedMs ?? SYNC.PROLONGED_MS
  const sinceFocus = now - lastFocusedAt
  if (active || sinceFocus < activityWindowMs) return realtimeMs
  if (sinceFocus < prolongedMs) return intermittentMs
  return longMs
}

/**
 * Human label for a resolved cadence — realtime / intermittent / long.
 * @param {number} cadence ms
 * @returns {"realtime" | "intermittent" | "long"}
 */
export function cadenceLabel(cadence) {
  if (cadence <= SYNC.REALTIME_MS) return "realtime"
  if (cadence <= SYNC.INTERMITTENT_MS) return "intermittent"
  return "long"
}