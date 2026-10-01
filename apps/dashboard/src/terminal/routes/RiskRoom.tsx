import { RoomFrame } from "../components/RoomFrame"
import { RiskLayerSurface } from "../components/RiskLayerSurface"
import { riskLayerView, RISK_LAYER_OWNER } from "../domain/riskLayer"
import type { AtrObservation, DrawdownObservation, RiskLayerInput, ThreeStrikeObservation } from "../domain/riskLayer"

/**
 * WS-7 T7 — room instance 2 of 18 (D1's order): Risk.
 *
 * SCOPE, STATED PRECISELY, BECAUSE D27 FORBIDS TRIMMING IT QUIETLY.
 *
 * T7's acceptance line is: "Risk surfaces ATR, the 2% drawdown disable, and
 * the 3-strike state with honest unavailability". All three are surfaced, as
 * three independent rows, each carrying its OWN availability. The phrase "with
 * honest unavailability" is doing real work in that sentence: a capability
 * whose observation the caller has not supplied must render as an absence, and a
 * room that quietly rendered it as working would be the defect.
 *
 *   - ATR(14) with the spec's 1.5x stop — produced by `atrStop` in the WS-7 T11
 *     risk layer, wired through `adapters/copilotReading.ts` (T7R-B).
 *   - 2% daily drawdown disable — produced by `dailyDrawdownDisable`, likewise
 *     wired. The two nearby numbers that DO exist in the tree (a -2% session
 *     halt in `v32Copilot.mjs:28`, a -5% daily limit in `u4faRisk.mjs`) are
 *     deliberately still not substituted; a near-match displayed under this
 *     label would read as a working safety rail.
 *   - 3-strike 24h key lock — produced by `createStrikeStore`, an append-only
 *     counter. A `strikes: 0` with no store supplied is still rejected, because
 *     it asserts a counter that was never read.
 *
 * ROUTE MOUNT — RESOLVED 2026-10-01 BY WS-7 T7R-A AND T7R-B.
 *
 * This room was committed at `857443e` complete and self-contained but
 * UNREACHABLE: reaching it needed a nineteenth ministry room key, and the WS-6
 * §0.3 room-key contract froze the set at eighteen. T7 recorded that as
 * `route-unmounted` with `routeBlocker` naming the two frozen assertions, which
 * was correct — a frozen characterisation test is exactly what may not be
 * weakened to make a change land.
 *
 * The owner then ruled (2026-09-30) that Risk, Ceremony, Ministry and Strategy
 * each take a new key, and T7R-A amended WS-6 §0.3 to 22 instances / 15 keys,
 * moving the two assertions under that explicit authorisation. `risk` is now in
 * both `INNER_NAV` and `MINISTRY_ROOMS`, so this room has a URL:
 * `/suites/trading/risk`.
 *
 * `routeBlocker` is DELETED rather than reworded. It is no longer true, and a
 * record that names a resolved blocker as a live one is the unflagged drift
 * AC-020 exists to prevent. The amendment that resolved it is recorded at
 * `docs/trading-logic/changelog/entries/0027-T7RA_WS6_ROOM_KEY_AMENDMENT-v1-to-v2.md`.
 *
 * PRESENTATIONAL ONLY. No transport, no clock of its own, no credential. The
 * room takes its three observations as props.
 */
export type RiskRoomProps = {
  atr?: AtrObservation | null
  drawdown?: DrawdownObservation | null
  threeStrike?: ThreeStrikeObservation | null
}

export function buildRiskLayer(props: RiskRoomProps): RiskLayerInput {
  return {
    atr: props.atr ?? null,
    drawdown: props.drawdown ?? null,
    threeStrike: props.threeStrike ?? null
  }
}

export function RiskRoom(props: RiskRoomProps) {
  const view = riskLayerView(buildRiskLayer(props))
  return (
    <RoomFrame roomKey="risk" title="Risk" capabilityLabel="Risk layer (ATR, drawdown disable, 3-strike lock)">
      <RiskLayerSurface view={view} />
    </RoomFrame>
  )
}

/**
 * The room's D27 completeness verdict, carried in code so it cannot drift from
 * the report. See `MARKETS_COMPLETION` for why the verdict lives here and not
 * only in prose.
 */
export const RISK_COMPLETION = {
  room: "risk",
  d1Order: 2,
  /**
   * GENUINELY COMPLETE. T7R-B discharged all three of T7's named gaps: the two
   * producers it waited on exist (T11's risk layer, `a4fac35`), the room is
   * mounted at a URL (T7R-A's amendment plus this task), and `routeBlocker` —
   * which named the two frozen assertions as the obstacle — is deleted because
   * it is no longer true.
   *
   * WHAT "COMPLETE" MEANS HERE, PRECISELY, AND WHAT IT DOES NOT:
   *
   *  - COMPLETE means the acceptance line is met: "Risk surfaces ATR, the 2%
   *    drawdown disable, and the 3-strike state with honest unavailability." It
   *    does. All three render, each with its OWN availability, and the room is
   *    reachable at `/suites/trading/risk`.
   *  - It does NOT mean all three are always live. Each is independently
   *    nullable, and a caller that has supplied only some observations sees a
   *    live row beside two named absences. That separation is the point: a live
   *    ATR next to two silent rails must not read as "the risk layer is live",
   *    and a 2% daily drawdown disable shown without an availability marker is a
   *    safety rail that appears present and is not.
   *  - What remains genuinely absent is OBSERVATION, not capability. Nothing
   *    yet supplies this room candles, the daily drawdown figure, or a strike
   *    store at runtime, so in the mounted room all three rows honestly report
   *    that no observation was supplied, naming the supply chain that owns it.
   *    The producers are built and tested; the input is not yet plumbed, and
   *    that is recorded here rather than absorbed.
   */
  verdict: "complete",
  ws8Handoff: null,
  reason:
    `No scope in this room logically belongs to WS-8. The ATR stop, the 2% daily drawdown disable and the 3-strike 24h key lock are all WS-7 risk-layer work: the producers shipped with T11 at a4fac35 and T7R-B wired this room to them through src/terminal/adapters/copilotReading.ts. The route blocker was resolved by the owner's 2026-09-30 ruling and the WS-6 §0.3 amendment recorded in changelog entry 0027, so ${RISK_LAYER_OWNER} is now the supply chain that would provide observations rather than a completed task. Recording a WS-8 handoff here would be false, and recording none while the wiring was missing would be the unflagged trim AC-020 prohibits.`
} as const
