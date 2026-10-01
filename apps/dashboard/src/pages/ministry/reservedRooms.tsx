import { RoomFrame } from "@/terminal/components/RoomFrame"
import { reserved } from "@/terminal/domain/availability"

/**
 * WS-7 T7R-A — reserved body for the ONE authorised room key whose surface
 * belongs to a later WS-7 task.
 *
 * WHY ONE REMAINS. The 2026-09-30 amendment to WS-6 §0.3 authorised four new
 * ministry room keys — `risk`, `ceremony`, `ministry`, `strategy` — taking the
 * inventory from 18 instances / 11 keys to 22 / 15. All four now have real
 * surfaces: `risk` at `terminal/routes/RiskRoom.tsx` (T7/T7R-B), `ceremony` at
 * `terminal/routes/CeremonyRoom.tsx` and `ministry` at
 * `terminal/routes/MinistryRoom.tsx`, both WS-7 T8. `strategy` is WS-7 T9 and
 * still has no producer, so it keeps a reserved body.
 *
 * `CeremonyRoom` and `MinistryAuthorityRoom` were DELETED from this file by T8
 * rather than left exported and unrouted. An unused export of a reserved body
 * for a key that now has a real room is a trap: it reads as a live fallback, and
 * a later edit that re-points the router at the import path finds a placeholder
 * waiting rather than a missing module. Deleting them makes the absence of a
 * fallback visible.
 *
 * WHY THE REMAINING ENTRY IS NOT A BUILDING. It renders the explicit reserved
 * state from `RoomFrame`, naming the task that owns the room, and shows no
 * number, chart point, score, or control. That is the contract of WS-6 §4.7 and
 * of this repository's honesty rules: a reserved capability states what is
 * missing and who owns it rather than showing an empty or fabricated success.
 *
 * Writing a plausible-looking surface here instead would be the D27 failure
 * mode exactly — scope that looks assigned and is a placeholder. This is a
 * NAMED absence with an owner, which is a legitimate outcome; an unflagged one is
 * a defect.
 *
 * `data-room` is emitted for the same reason the existing rooms emit it: WS-6
 * R2.3 requires the hooks used by tests and Browser Studio, and the amended
 * R2.3 extends that obligation to the four new keys unchanged.
 */

type ReservedRoomProps = {
  roomKey: string
  title: string
  owner: string
  reason: string
}

function ReservedMinistryRoom({ roomKey, title, owner, reason }: ReservedRoomProps) {
  return (
    <div className="stack">
      <header data-room={roomKey}>
        <h2>{title}</h2>
        <span className="badge badge-muted">reserved</span>
      </header>
      <RoomFrame
        roomKey={roomKey}
        title={title}
        capabilityLabel="Room"
        reserved={reserved({ workstream: owner, reason })}
      />
    </div>
  )
}

/** WS-7 T9 — the Strategy room. */
export function StrategyRoom() {
  return (
    <ReservedMinistryRoom
      roomKey="strategy"
      title="Strategy"
      owner={STRATEGY_RESERVATION}
      reason={STRATEGY_RESERVED_REASON}
    />
  )
}

/**
 * D10's reservation, NOT a task name. R7.4 requires an unowned capability to
 * display `WS-7+`, and D10:175-182 reserves that literal precisely so nothing
 * invents an owner. T9 changed this string from `WS-7 T9` for that reason: a task
 * id is a schedule, not an owner, and a reader seeing "WS-7 T9" could reasonably
 * conclude someone was building it. T9 finished and did not, because there is
 * nothing to build against — so the reservation is the honest owner.
 *
 * The literal comes from a constant rather than being retyped, so this file has
 * exactly one copy of it and `StrategyRoom.test.tsx` can assert that.
 */
export const STRATEGY_RESERVATION = "WS-7+"

/**
 * T9's verified finding, stated as the room's reason rather than as prose
 * elsewhere, because the reason is what an operator actually reads.
 *
 * THE FINDING, AND IT IS NARROWER THAN "THERE IS NO STRATEGY CODE" — T9's FIRST
 * DRAFT SAID THAT, AND A TEST CAUGHT IT BEING FALSE.
 *
 * There IS strategy code in this tree. `services/marketIntel.mjs:87-209` exports
 * five NAMED trading strategies, each returning the same `{ score, signal,
 * reason }` shape:
 *
 *   strategyMtf     :87   multi-timeframe trend agreement
 *   strategyPhase   :131  market-phase quality
 *   strategyVolume  :145  tick-activity / order-flow pressure
 *   strategyRR      :181  asymmetric price-path and EV-weighted R:R
 *   strategyEdge    :200  realised edge from the accuracy ledger, damped
 *
 * What is actually true is narrower, and it is the part that matters:
 *
 *   1. THEY HAVE NO PRODUCTION CALLER. Enumerating every reference to the five
 *      symbols across `apps/dashboard` returns their own definitions and
 *      `server/__tests__/marketIntel.test.mjs` — and nothing else. These are
 *      orphaned exports with tests, not a served surface.
 *   2. NO ROUTE SERVES THEM. `handlers.mjs` contains no `/api/...` path matching
 *      `strateg`, so nothing can hand a room their output.
 *   3. THIS SPEC NAMES NO STRATEGY CONTENT ANYWHERE, so it does not say whether
 *      these five ARE the Strategy room's producer, whether a different producer
 *      is intended, or whether they belong to the confluence engine that was
 *      never wired to them.
 *
 * WHY THAT IS NOT PAPERED OVER WITH A PANEL. Building a Strategy room on these
 * five would mean CREATING a production caller for an orphan — which is a product
 * decision about what the room should assert, and one this spec gives T9 no basis
 * to make. It would also duplicate a confluence surface: each of the five returns
 * a confluence-shaped `{ score, signal, reason }`, which is what T7's Markets/COP-22
 * room already renders through T11's engine. A Strategy room showing them would
 * look complete and would be a second copy of the Copilot surface — which is D27's
 * exact failure mode and the WS-6 outcome (rooms that look assigned and are partly
 * placeholders).
 *
 * So the honest rendering is the explicit reserved state, and the remaining work is
 * named in `STRATEGY_COMPLETION` below. This is a NAMED absence with an owner,
 * which is a legitimate outcome; an unflagged trim is a defect.
 */
export const STRATEGY_RESERVED_REASON =
  "The Strategy room is authorised and routed, and WS-7 T9 examined it and did NOT build a surface, because what its " +
  "producer should be is not determined by this spec and T9 would have had to guess. T9's finding is precise: five NAMED " +
  "trading strategies do exist in the tree — strategyMtf, strategyPhase, strategyVolume, strategyRR and strategyEdge, all " +
  "exported from services/marketIntel.mjs — but they have ZERO production callers (nothing outside their own test file " +
  "references them), NO route serves them, and this spec names no Strategy content anywhere that would tell T9 whether " +
  "they are this room's intended producer. Building a panel on them would mean creating a production caller for an " +
  "orphan, which is a product decision about what the room should assert; and each returns a confluence-shaped " +
  "{ score, signal, reason }, which is the surface T7's Markets/COP-22 room already renders through T11's engine, so a " +
  "Strategy room showing them would be a second copy of the Copilot surface — the failure this record exists to prevent. " +
  "Nothing is shown because nothing is known about this room's intended contents. The remaining work is named in " +
  "STRATEGY_COMPLETION."

/**
 * The Strategy room's D27 completeness verdict.
 *
 * **`verdict: "incomplete"` — AND IT IS NOT "complete" WITH A CAVEAT.** AC-020
 * prohibits declaring a room COMPLETE while it "has no reserved placeholder that
 * could be trivially filled later", and this room's rendering IS a reserved
 * placeholder. So it cannot pass AC-020, and the honest report says so rather than
 * claiming the bar was met.
 *
 * WHY IT IS NOT A WS-8 HANDOFF EITHER, which is the other way D27's question can
 * be answered. The boundary is NOT "some of this room's scope belongs to WS-8" —
 * nothing here is a WS-8 concern on its face. The boundary is that **the room has
 * no producer at all**, and whose job it is to write one is not derivable from this
 * spec: T9's acceptance line (`:1278`) is "AC-020 passes for both" and names no
 * Strategy content whatsoever, which is why T9 could not scope a surface from the
 * spec. Naming an owner for that decision is the owner's, and D10's reservation is
 * what the room displays until they make it.
 *
 * `ws8Handoff` is therefore a NAMED OPEN BOUNDARY rather than `null`, because
 * writing `null` here would claim the question was asked and answered. D27's
 * requirement is that the boundary be stated and reviewable; this states it.
 */
export const STRATEGY_COMPLETION = {
  room: "strategy",
  d1Order: 5,
  verdict: "incomplete",
  ws8Handoff: Object.freeze({
    what: "WHETHER A STRATEGY PRODUCER IS WS-7 SCOPE AT ALL, OR WS-8 SCOPE",
    detail:
      "Named as an open boundary rather than decided, because this spec does not determine it. T9's acceptance line (:1278) " +
      "is only \"AC-020 passes for both\" and — unlike Markets, Risk, Ceremony and Ministry, whose acceptance lines each name " +
      "their content — it names NO Strategy content at all. There is therefore nothing in the spec to say whether the five " +
      "orphaned strategies are this room's intended producer, whether a different producer is intended, or whether they " +
      "belong to the confluence engine that was never wired to them. Two readings are consistent with the spec text: (a) " +
      "Strategy's producer is WS-7 scope that a later WS-7 task builds or adopts, or (b) it is WS-8 scope and this room " +
      "stays reserved. WS-7 cannot choose between them without inventing scope, which D27 prohibits, so the choice is the " +
      "owner's.",
    owner: "owner decision",
    decidedByThisTask: false
  }),
  absences: Object.freeze([
    Object.freeze({
      what: "NO ROUTED STRATEGY PRODUCER, AND FIVE ORPHANED EXPORTS THAT ARE NOT ONE",
      detail:
        "Five named trading strategies DO exist — strategyMtf (marketIntel.mjs:87), strategyPhase (:131), strategyVolume " +
        "(:145), strategyRR (:181) and strategyEdge (:200), each returning a confluence-shaped { score, signal, reason }. " +
        "They are not this room's producer for two verifiable reasons: nothing outside their own test file references them, so " +
        "they have ZERO production callers; and no handlers.mjs route matches /strateg/, so nothing can serve them to a " +
        "room. Adopting them would mean CREATING a production caller for an orphan, which is a product decision this spec " +
        "gives no basis for — and each returns the same shape T7's Markets/COP-22 room already renders through T11's engine, " +
        "so the room would be a second copy of the Copilot surface.",
      owner: "owner decision — whether these five are the Strategy room's producer, or a different producer is intended",
      isWs8Scope: null
    }),
    Object.freeze({
      what: "NO STRATEGY SURFACE, AND THAT IS THE POINT",
      detail:
        "A strategy panel could be assembled today from marketIntel's five strategies, from copilot/regime.mjs, from " +
        "opportunities.mjs or from proanalysis.mjs. Each belongs to another producer — the confluence engine, T11 the " +
        "decision engine, T12 the conflict resolutions, T13 the model layer — and wiring any of them here would be inventing " +
        "a product surface the spec never asked for, against producers this room does not own. The result would look complete " +
        "and would not be, which is D27's named failure and the WS-6 outcome.",
      owner: "not applicable — a deliberate refusal, not unfinished work",
      isWs8Scope: null
    })
  ]),
  reason:
    "Strategy is NOT complete and is not recorded as complete. AC-020:929 prohibits declaring a room COMPLETE while it " +
    "still has a reserved placeholder, and this room's rendering is one. The reason is not a trim: what this room's producer " +
    "should be is not determined by this spec (absences[0]), and T9 declined to invent one (absences[1]). T9's own first " +
    "draft of this record said there was no strategy code at all, and a test caught that being false — five named strategies " +
    "exist in services/marketIntel.mjs — so the record states the narrower true thing: they are orphans with no caller and " +
    "no route, and adopting them would mean creating a production caller and duplicating T7's Copilot surface. " +
    "ws8Handoff is a NAMED OPEN BOUNDARY rather than null for the reason D27 exists: this spec names no Strategy content " +
    "anywhere, so whether a Strategy producer is WS-7 or WS-8 scope is not derivable from it, and choosing would mean " +
    "inventing scope. The owner displayed is D10's WS-7+ reservation rather than a task id, because a task id is a schedule " +
    "and no human owns this capability. T9 discharged what it could: the key's existence and routing were verified, the " +
    "producer question was investigated to the level of five named symbols with a caller count of zero, the reservation was " +
    "corrected to D10's literal, and the remaining work is named here."
} as const