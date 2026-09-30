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
 * three independent rows. The phrase "with honest unavailability" is doing real
 * work in that sentence: two of the three capabilities DO NOT EXIST in this
 * tree, so the specified behaviour today IS the honest-unavailability path, and
 * a room that quietly rendered them as working would be the defect.
 *
 *   - ATR(14) with the spec's 1.5x stop — REAL. `indicators.mjs:600-617` and
 *     `v32Context.mjs:185-213` implement it, so the room renders a live
 *     reading when one is supplied and an honest absence when it is not.
 *   - 2% daily drawdown disable — NOT IMPLEMENTED. Owned by the WS-7 T11 risk
 *     layer. The two nearby numbers that DO exist (a -2% session halt in
 *     `v32Copilot.mjs:28`, a -5% daily limit in `u4faRisk.mjs`) are
 *     deliberately not substituted; a near-match displayed under this label
 *     would read as a working safety rail.
 *   - 3-strike 24h key lock — NOT IMPLEMENTED. No strike counter and no
 *     key-lock store exist anywhere in the tree.
 *
 * ROUTE MOUNT, AND WHY IT IS THE FLAGGED PART OF THIS ROOM.
 *
 * The room implementation and its tests are complete and self-contained, but
 * the room is NOT reachable at a URL, and that is a named gap rather than a
 * silent one. Reaching it would mean adding a nineteenth ministry room key, and
 * the WS-6 §0.3 room-key contract freezes the set at exactly eighteen:
 *
 *   - `apps/dashboard/src/pages/__tests__/ministryRooms.test.tsx:165-177`
 *     pins the exact, ORDERED trading key list;
 *   - `:193-196` pins the cross-suite total at exactly 18;
 *   - `src/terminal/components/__tests__/TerminalShell.test.tsx:45-59` pins
 *     INNER_NAV and MINISTRY_ROOMS to the same key set in both directions, so a
 *     route added without a nav entry fails just as hard as a nav entry added
 *     without a route.
 *
 * Landing this room would mean moving two frozen characterisation assertions to
 * a nineteenth key, and a frozen characterisation test is exactly the thing
 * this workstream's rules forbid weakening to make a change land. The gap is
 * therefore FLAGGED, with the assertions named, rather than absorbed. The
 * amendment that would close it is a spec amendment to WS-6 §0.3's frozen room
 * keys — an owner decision, not an implementation detail.
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
   * NOT genuinely complete, on two independent counts, both named:
   *
   *  1. PRODUCER PENDING. Two of the three capabilities do not exist in this
   *     tree. They are WS-7 T11 risk-layer work, in the same workstream.
   *  2. ROUTE NOT MOUNTED. The room is implemented and tested but has no URL,
   *     because mounting it requires a nineteenth ministry room key and the
   *     WS-6 §0.3 room-key contract freezes the set at eighteen. The exact
   *     frozen assertions are named in this file's header.
   *
   * Neither is a WS-8 boundary: the risk layer and the room contract are both
   * WS-7 scope. Recording them as a WS-8 handoff would be false, and
   * recording neither would be the unflagged trim AC-020 prohibits.
   */
  verdict: "surface-complete, producer-pending, route-unmounted",
  pendingScope: "WS-7 T11 - the risk layer (2% daily drawdown disable, 3-strike 24h key lock)",
  routeBlocker:
    "WS-6 spec 0.3 freezes 18 ministry room keys; adding `risk` requires moving the pinned assertions at src/pages/__tests__/ministryRooms.test.tsx:165-177 and :193-196, and breaking INNER_NAV/MINISTRY_ROOMS parity at src/terminal/components/__tests__/TerminalShell.test.tsx:45-59. Closing this needs a WS-6 spec amendment, not an edit to a frozen characterisation test.",
  ws8Handoff: null,
  reason: `No scope in this room logically belongs to WS-8. The unbuilt capabilities are owned by ${RISK_LAYER_OWNER}, inside WS-7.`
} as const
