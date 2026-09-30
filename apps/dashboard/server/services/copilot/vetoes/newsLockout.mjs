// WS-7 T11 — veto 5 of 6: NEWS LOCKOUT.
// §4.4:691 — "(5) News Lockout ±15 min around a Red Folder event"
//
// Fires within ±15 minutes of a Red Folder event. The window is symmetric
// because the risk is not only the release: it is the repricing, the widened
// spread, and the stop-outs that happen while the book is still filling.
//
// Inputs are `state.newsEvents`: `{ at: <epochMs>, severity: "red" | ... }`.
// Only `severity === "red"` counts — a lesser event is not a Red Folder event
// and must not be given this veto's authority. A non-Red event that is present
// is reported in the record, so "we saw an event and it was not Red" is
// distinguishable from "we saw no events".
//
// `evaluatedAt` is the caller's supplied `computedAt` — the ONLY clock on this
// path (AC-021:937). The window is measured against it, and a caller that wants
// a different clock must supply a different `computedAt`.

import { buildOutcome, clearOutcome, unevaluatedOutcome } from "./outcome.mjs"

export const RULE_ID = "newsLockout"
export const RULE_VERSION = "copilot-veto-newsLockout/1.0.0"
export const SUPPRESSED = "entry"

/** §4.4:691 — "±15 min around a Red Folder event". */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000

/** Only this severity engages the lockout. */
export const RED_SEVERITY = "red"

export function evaluate(state) {
  const evaluatedAt = state.computedAt
  const events = state.newsEvents

  // `null` means the caller supplied no news source at all; `[]` means the
  // caller supplied a live one that found nothing. Only the first is an
  // absence — see the note on `deriveMarketState`'s `newsEvents`.
  if (!Array.isArray(events)) {
    return unevaluatedOutcome({
      ruleId: RULE_ID,
      evaluatedAt,
      ruleVersion: RULE_VERSION,
      suppressed: SUPPRESSED,
      missing: ["newsEvents[] (without a news source, a Red Folder release inside the window cannot be ruled out)"]
    })
  }

  const redEvents = events.filter((e) => e?.severity === RED_SEVERITY && Number.isFinite(Number(e.at)))
  const withinWindow = redEvents.filter((e) => Math.abs(Number(e.at) - evaluatedAt) <= LOCKOUT_WINDOW_MS)

  // Deterministic: nearest first, then earliest. AC-021 forbids an incidental order.
  withinWindow.sort((a, b) => {
    const da = Math.abs(Number(a.at) - evaluatedAt)
    const db = Math.abs(Number(b.at) - evaluatedAt)
    return da - db || Number(a.at) - Number(b.at)
  })

  const inputs = {
    windowMinutes: LOCKOUT_WINDOW_MS / 60000,
    eventsSeen: events.length,
    redEventsSeen: redEvents.length,
    redEventsInWindow: withinWindow.length,
    nearestMsAway: withinWindow.length > 0 ? Math.abs(Number(withinWindow[0].at) - evaluatedAt) : "none"
  }

  if (withinWindow.length === 0) {
    return clearOutcome({ ruleId: RULE_ID, inputs, suppressed: SUPPRESSED, evaluatedAt, ruleVersion: RULE_VERSION })
  }

  const nearest = withinWindow[0]
  const labelled = events.filter((e) => e?.severity === RED_SEVERITY).length
  inputs.eventAt = Number(nearest.at)
  inputs.eventId = String(nearest.id ?? nearest.label ?? "unnamed")

  return buildOutcome({
    ruleId: RULE_ID,
    fired: true,
    inputs,
    suppressed: SUPPRESSED,
    evaluatedAt,
    ruleVersion: RULE_VERSION
  })
}
