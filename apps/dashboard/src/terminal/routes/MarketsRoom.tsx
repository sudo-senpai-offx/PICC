import { RoomFrame } from "../components/RoomFrame"
import { CopilotScoreSurface } from "../components/CopilotScoreSurface"
import { copilotUnavailable, describeConfluence, COPILOT_ENGINE_OWNER } from "../domain/copilotDecision"
import type { CopilotDecisionView } from "../domain/copilotDecision"
import type { ConfluenceScore, ExecutionTier, VetoOutcome } from "../contracts"

/**
 * WS-7 T7 — room instance 1 of 18 (D1's order): Markets / COP-22.
 *
 * SCOPE, STATED PRECISELY, BECAUSE D27 FORBIDS TRIMMING IT QUIETLY.
 *
 * T7's acceptance line is: "Markets surfaces the score, per-expert
 * contributions, and fired vetoes". That is what this room adds, and all three
 * are rendered, per-expert and per-veto, with their own provenance.
 *
 * It does NOT add the deterministic engine that PRODUCES them. The engine —
 * regime classifier, six weighted experts, confluence, tiers, six vetoes, four
 * boosters, and the risk layer — is WS-7 T11, a P0 task in the same workstream
 * that has not run. Building it here would be a different task wearing this
 * one's name, and it would make the room non-revertible independently, which
 * T7's bisect line forbids ("Markets alone can be reverted while Risk remains;
 * each room's route and tests are self-contained").
 *
 * So the room renders the CONTRACT, and reports the engine's absence through
 * the shared honest-unavailable path with the owner named. That is a flagged
 * gap, recorded as such in this file, in the room's completion record, and in
 * the task report — not a silent trim. See `MARKETS_COMPLETION` below.
 *
 * THE SIX EXISTING PANELS ARE NOT TOUCHED. `MarketsRoom` renders
 * SpreadPanel, WatchlistPanel, MarketIntelPanel, CalendarPanel, SessionPanel
 * and ScreenerPanel, and `terminal-perf.spec.ts` measures a transition into
 * this room. This route is an ADDITION to that room, not a replacement for it:
 * the room's existing panels, its `data-room="markets"` marker and its
 * deep-link contract are unchanged, and COP-22's surface is composed beneath
 * them so the measured transition path keeps its existing structure.
 *
 * PRESENTATIONAL ONLY. The room takes its reading as a prop and opens no
 * transport, reads no clock of its own, and requests no credential. Fetching
 * the engine's output when it exists is a wiring change in the adapter layer,
 * not a change to this room.
 */
export type MarketsRoomProps = {
  /**
   * The engine's reading, or `null` when there is none. A caller that has no
   * reading passes `null`; it never constructs a placeholder score.
   */
  confluence: ConfluenceScore | null
  vetoes?: readonly VetoOutcome[]
  /** D5. Defaults to `false`: an absent flag must never mean permitted. */
  automationPermitted?: boolean
  /** D6, a read-only input. Defaults to the paper rung. */
  rung?: ExecutionTier["rung"]
  /** Shown in the room header so the reader can see what is missing and why. */
  children?: React.ReactNode
}

/** The reason the room shows when no reading has been supplied. */
export const MARKETS_NO_READING_REASON =
  `The deterministic Copilot engine (regime classifier, six weighted experts, confluence, tiers, six vetoes) is not built. It is WS-7 task T11, a P0 task in this same workstream; this room surfaces its contract and reports its absence rather than synthesising a score. Room owner: ${COPILOT_ENGINE_OWNER}.`

export function buildMarketsDecision(props: MarketsRoomProps): CopilotDecisionView {
  if (props.confluence === null) {
    return copilotUnavailable(MARKETS_NO_READING_REASON)
  }
  return describeConfluence({
    score: props.confluence,
    vetoes: props.vetoes ?? [],
    // Both defaults fail closed. `automationPermitted` is a D5 safety flag, so
    // an omitted prop is `false` rather than "whatever the broker says"; and
    // `rung` is a D6 read-only input, so an omitted prop is `paper`, the
    // lowest rung, rather than a value this room could have invented.
    automationPermitted: props.automationPermitted === true,
    rung: props.rung ?? "paper"
  })
}

export function MarketsRoom(props: MarketsRoomProps) {
  const view = buildMarketsDecision(props)
  return (
    <RoomFrame roomKey="markets" title="Markets" capabilityLabel="Copilot decision (COP-22)">
      <CopilotScoreSurface view={view} />
      {props.children}
    </RoomFrame>
  )
}

/**
 * The room's D27 completeness verdict, carried in code so it cannot drift from
 * the report. AC-020's verification is "the completion record contains an
 * explicit completeness verdict"; a verdict that lives only in a markdown file
 * is a verdict nobody re-reads when the next change lands.
 */
export const MARKETS_COMPLETION = {
  room: "markets",
  d1Order: 1,
  /**
   * NOT genuinely complete. The three things T7 names are surfaced, typed,
   * rendered per-expert and per-veto, and tested; what is missing is the
   * PRODUCER, and the producer is a WS-7 task (T11) that has not run. Declaring
   * this room COMPLETE would be an unflagged trim, which AC-020 prohibits.
   */
  verdict: "surface-complete, producer-pending",
  pendingScope: "WS-7 T11 - the deterministic Copilot engine (six experts, confluence, tiers, six vetoes)",
  ws8Handoff: null,
  reason:
    "No scope in this room logically belongs to WS-8: the score, the per-expert contributions and the fired vetoes are all WS-7 T11 determinism work. The gap is an in-workstream task ordering (T7 is P1, T11 is P0), not a boundary disagreement, and it is named rather than absorbed."
} as const
