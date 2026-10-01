import { RoomFrame } from "../components/RoomFrame"
import { CopilotScoreSurface } from "../components/CopilotScoreSurface"
import { copilotUnavailable, describeConfluence } from "../domain/copilotDecision"
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
 * It does NOT add the deterministic engine that PRODUCES them, and it still
 * must not. The engine — regime classifier, six weighted experts, confluence,
 * tiers, six vetoes, four boosters, and the risk layer — is WS-7 T11, and T7R-B
 * wired this room to the real one through `adapters/copilotReading.ts`. But the
 * engine is a SEPARATE task, and this room stays presentational so that
 * Markets remains revertible on its own, which T7's bisect line requires
 * ("Markets alone can be reverted while Risk remains; each room's route and
 * tests are self-contained"). An engine copy-pasted in here would fuse the two
 * and destroy that property.
 *
 * So the room renders whatever reading it is GIVEN, and reports a genuinely
 * absent one through the shared honest-unavailable path with the owner named.
 * T7R-B made that second branch honest for the first time: `null` now means
 * "this caller supplied no market state", and the owner is the supply chain,
 * rather than naming T11 as a pending blocker. See `MARKETS_COMPLETION` below.
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

/**
 * The reason the room shows when no reading has been supplied.
 *
 * WS-7 T7R-B (2026-10-01): this string NAMED T11 AS A PENDING TASK, and T11 has
 * run — `engine.mjs` ships at `a4fac35`. It named a completed task as the owner
 * of an absence, which is the unflagged-drift defect AC-020 exists to prevent,
 * so it is rewritten here.
 *
 * What is true now is narrower and more useful: the engine EXISTS and is called
 * through the adapter at `src/terminal/adapters/copilotReading.ts`, and this
 * room is handed `confluence: null` because its caller has no market state to
 * evaluate. The engine's version is named so a reader can tell a missing input
 * from a missing engine.
 */
export const MARKETS_NO_READING_REASON =
  `No market state has been supplied to the Copilot decision surface, so there is no score to render. The deterministic engine (regime classifier, six weighted experts, confluence, tiers, six vetoes) is BUILT and is invoked through src/terminal/adapters/copilotReading.ts; it returns no reading here only because this room's caller has no candles to evaluate. The room renders its contract and this reason rather than synthesising a score. Engine version: copilot-engine/1.0.0.`

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
   * GENUINELY COMPLETE. T7R-B wired the room to its producer and the producer
   * exists, so the two clauses T7 recorded — `producer-pending` and the missing
   * engine — are both discharged.
   *
   * WHAT "COMPLETE" MEANS HERE, PRECISELY, AND WHAT IT DOES NOT:
   *
   *  - COMPLETE means the acceptance line is met: "Markets surfaces the score,
   *    per-expert contributions, and fired vetoes." It does. Each is rendered
   *    with its own provenance, all six experts are reported whether or not they
   *    scored, and each fired veto names what it suppressed. Verified by
   *    `MarketsRoom.test.tsx` against a reading produced by the real engine
   *    through `adapters/copilotReading.ts`.
   *  - It does NOT mean the room always shows a number. It shows one when its
   *    caller supplies market state, and it renders the honest named-unavailable
   *    state when the caller does not. That is the specified behaviour, not a
   *    gap: an unscoreable state — including the frozen 20:00–00:00 UTC dead
   *    zone — must render as an absence and never as a fabricated score.
   *  - The one capability that is still absent BY DESIGN is the 5% Sentiment
   *    expert's model input. The room renders it as unavailable with a reason,
   *    and the confluence does not renormalise the remaining 95% to hide the
   *    gap (spec §4.1:533). That is T13's producer, which ships at `c8896f4` but
   *    supplies no model artifact by default — a measured absence with a named
   *    owner, not an unflagged trim.
   *
   * The six market panels, the `data-room="markets"` marker and the deep-link
   * contract are unchanged: COP-22 is composed beneath them, not around them.
   */
  verdict: "complete",
  ws8Handoff: null,
  reason:
    "No scope in this room logically belongs to WS-8. The score, the per-expert contributions and the fired vetoes are all WS-7 determinism work and all now ship: the engine landed at a4fac35 (T11), the conflict resolutions at 8ff9e63 (T12), the model layer and explain layer at c8896f4 (T13), and T7R-B wired this room to them through src/terminal/adapters/copilotReading.ts. TWO inputs are still absent and both are named rather than absorbed. First, the 5% Sentiment expert's model artifact, which is WS-7 T13's producer and renders as an unavailable expert with a named owner. Second, the candle series the engine consumes: the adapter is proven against the real engine in this room's tests, but the mounted markets page still supplies none, because doing so would add an unattributed request to the window e2e/terminal-perf.spec.ts:153-161 measures. Supplying market state to that page is therefore an owner decision recorded in pages/ministry/MarketsRoom.tsx, not an implementation gap this room can close quietly. A WS-8 handoff here would be false, and recording none while the wiring was missing would be the unflagged trim AC-020 prohibits."
} as const
