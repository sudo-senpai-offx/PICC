import { MARKETS_COMPLETION } from "../routes/MarketsRoom"
import { RISK_COMPLETION } from "../routes/RiskRoom"
import { CEREMONY_COMPLETION } from "../routes/CeremonyRoom"
import { MINISTRY_COMPLETION } from "../routes/MinistryRoom"
import { PAPER_LIVE_COMPLETION } from "../routes/PaperLiveRoom"
import { STRATEGY_COMPLETION } from "../../pages/ministry/reservedRooms"

import { READ_ONLY_INTERACTIVE_AFFORDANCES } from "./readOnlyRooms"
import { READ_ONLY_ROOM_COMPLETIONS } from "./readOnlyRoomCompletions"
import { PAPER_LIVE_INTERACTIVE_AFFORDANCES } from "./paperLive"

/**
 * WS-7 T20 - the ONE adapter from "22 room completion records" to "22 plain
 * facts the cross-room gate can measure".
 *
 * ============================================================================
 * WHY AN ADAPTER, AND WHY IT IS THE ONLY ONE
 * ============================================================================
 *
 * `scripts/cross-room-invariant-gate.mjs` is the gate and it is plain `.mjs`,
 * for the reason T19's `ram-ceiling-gate.mjs` is: this gate has to be runnable as
 * a process whose exit code a CI runner reads. The records it judges live in six
 * modules, FIVE of which are `.tsx`. That is not an assumption - node v24.18
 * refuses the import:
 *
 *   node --experimental-strip-types -e "import('./.../reservedRooms.tsx')"
 *   ERR_UNKNOWN_FILE_EXTENSION  Unknown file extension ".tsx"
 *
 * So the records cannot reach a plain `node` process, and the gate's facts have
 * to be projected on the vitest side, where TSX resolves. This module is that
 * projection and it is deliberately the ONLY place that imports all six record
 * homes at once.
 *
 * ============================================================================
 * THIS IS NOT A SECOND CONTRACT HOME
 * ============================================================================
 *
 * Two lists of twenty-two exist, and the INDEPENDENCE between them is the point
 * rather than a duplication:
 *
 *  - `ROOM_INVENTORY` in the gate is the FROZEN SPEC INVENTORY (spec :73,
 *    22 instances / 15 keys). It is what the gate expects.
 *  - This module's output is DERIVED from the records themselves - it maps the
 *    sixteen rows of `READ_ONLY_ROOM_COMPLETIONS` plus the six named constants
 *    and reads each one's own `room` field. Nothing here is hand-typed.
 *
 * Because neither list is computed from the other, a record that stops being
 * exported, or is exported under a different room name, shows up as a MISMATCH -
 * which the gate reports as a named per-room failure. A second copy that agreed
 * by construction could not detect that at all.
 *
 * ============================================================================
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ============================================================================
 *
 * It computes NO verdict and asserts NO invariant. Every number below is a
 * projection of a record's own field, and the gate does all the comparing. A
 * projection that judged anything would be a place where a room could pass
 * without the gate ever measuring it.
 */

/** The six D1-order 1..6 records, each with its own named constant. */
const NAMED_RECORDS = [
  { suite: "trading", record: MARKETS_COMPLETION },
  { suite: "trading", record: RISK_COMPLETION },
  { suite: "trading", record: CEREMONY_COMPLETION },
  { suite: "trading", record: MINISTRY_COMPLETION },
  { suite: "trading", record: STRATEGY_COMPLETION },
  { suite: "trading", record: PAPER_LIVE_COMPLETION }
] as const

/**
 * The T9 frozen ceiling for Paper/Live, and the T10 frozen ceiling for the
 * sixteen read-only instances. Both are exported EMPTY FROZEN DATA on purpose -
 * `readOnlyRooms.ts:47-48` and `paperLive.ts:556` - because a comment saying
 * "no affordances here" cannot fail a test.
 *
 * These are the only two rooms whose affordance ceiling is an EXPORTED constant.
 * The other five (markets, risk, ceremony, ministry, strategy) have none, which
 * is recorded in `basis` on each fact rather than papered over: the gate reports
 * what it measured and says which kind of evidence it measured.
 */
const CEILINGS = {
  readOnly: {
    basis: "exported-frozen-ceiling",
    id: "READ_ONLY_INTERACTIVE_AFFORDANCES",
    items: READ_ONLY_INTERACTIVE_AFFORDANCES
  },
  paperLive: {
    basis: "exported-frozen-ceiling",
    id: "PAPER_LIVE_INTERACTIVE_AFFORDANCES",
    items: PAPER_LIVE_INTERACTIVE_AFFORDANCES
  }
} as const

type RawRecord = {
  room: string
  d1Order: number
  verdict?: string
  ws8Handoff?: unknown
  absences?: ReadonlyArray<{ what: string; detail: string; owner: string; isWs8Scope: boolean | null }>
  reason?: string
  preExistingWriteAffordances?: ReadonlyArray<{
    id: string
    route: string
    sourceToken: string
    detail: string
    removedByThisTask: false
  }>
}

export type RoomCompletionFact = {
  id: string
  suite: string
  key: string
  present: boolean
  verdict: string | null
  /**
   * T10's serialisation point: `ws8Handoff` being a PRESENT KEY is what
   * distinguishes "asked, and the answer is no" from "never asked". `undefined`
   * here would serialise away entirely.
   */
  hasWs8HandoffKey: boolean
  ws8HandoffKind: "null" | "object" | "absent" | "other"
  d1Order: number | null
  absences: ReadonlyArray<{ what: string; detail: string; owner: string; isWs8Scope: boolean | null }>
  reason: string
  affordances: ReadonlyArray<{
    id: string
    route: string
    sourceToken: string
    detail: string
    removedByThisTask: boolean
  }>
  ceiling: {
    basis: "exported-frozen-ceiling" | "record-declared-affordances" | "no-affordance-field"
    id: string
    length: number
    frozen: boolean
  }
}

const AFFORDANCE_FREE_EVIDENCE: readonly unknown[] = Object.freeze([])

/**
 * `hasOwnProperty`, not `in` and not a truthiness test. The distinction is the
 * whole of T10's serialisation argument: a record whose `ws8Handoff` key is
 * absent must not read like one whose value is `null`.
 */
function declaresKey(record: RawRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function ws8HandoffKindOf(record: RawRecord): RoomCompletionFact["ws8HandoffKind"] {
  if (!declaresKey(record, "ws8Handoff")) return "absent"
  const value = record.ws8Handoff
  if (value === null) return "null"
  if (typeof value === "object") return "object"
  return "other"
}

function ceilingFor(id: string, record: RawRecord): RoomCompletionFact["ceiling"] {
  if (id === "trading/paper") {
    return { basis: CEILINGS.paperLive.basis, id: CEILINGS.paperLive.id, length: CEILINGS.paperLive.items.length, frozen: Object.isFrozen(CEILINGS.paperLive.items) }
  }
  const isReadOnlyInstance = READ_ONLY_ROOM_COMPLETIONS.some((c) => `${c.suite}/${c.key}` === id)
  if (isReadOnlyInstance) {
    return { basis: CEILINGS.readOnly.basis, id: CEILINGS.readOnly.id, length: CEILINGS.readOnly.items.length, frozen: Object.isFrozen(CEILINGS.readOnly.items) }
  }
  // markets, risk, ceremony, ministry, strategy: T7-T9 recorded no affordance
  // ceiling constant and no `preExistingWriteAffordances` field. The measured
  // quantity is therefore the absence of any declared interactive affordance,
  // evidenced by a FROZEN empty array - frozen so the measurement is of
  // something that cannot be pushed into afterwards.
  const declared = record.preExistingWriteAffordances
  if (Array.isArray(declared)) {
    return {
      basis: "record-declared-affordances",
      id: `${record.room}.preExistingWriteAffordances`,
      length: declared.length,
      frozen: Object.isFrozen(declared)
    }
  }
  return {
    basis: "no-affordance-field",
    id: `${record.room}.preExistingWriteAffordances`,
    length: AFFORDANCE_FREE_EVIDENCE.length,
    frozen: Object.isFrozen(AFFORDANCE_FREE_EVIDENCE)
  }
}

function toFact(suite: string, record: RawRecord): RoomCompletionFact {
  const key = String(record.room)
  const affordances = Array.isArray(record.preExistingWriteAffordances) ? record.preExistingWriteAffordances : []
  return {
    id: `${suite}/${key}`,
    suite,
    key,
    present: true,
    verdict: typeof record.verdict === "string" ? record.verdict : null,
    hasWs8HandoffKey: declaresKey(record, "ws8Handoff"),
    ws8HandoffKind: ws8HandoffKindOf(record),
    d1Order: typeof record.d1Order === "number" ? record.d1Order : null,
    absences: Array.isArray(record.absences) ? record.absences.map((a) => ({ ...a })) : [],
    reason: typeof record.reason === "string" ? record.reason : "",
    affordances: affordances.map((a) => ({ ...a })),
    ceiling: ceilingFor(`${suite}/${key}`, record)
  }
}

/**
 * All twenty-two facts, derived from the records. Nothing here is hand-listed,
 * so a record that gains or loses a room shows up as a change in this array's
 * length and in its ids - which the gate reports per room rather than swallowing.
 */
export function collectRoomCompletionFacts(): RoomCompletionFact[] {
  const fromNamed = NAMED_RECORDS.map(({ suite, record }) => toFact(suite, record as unknown as RawRecord))
  const fromTable = READ_ONLY_ROOM_COMPLETIONS.map((c) =>
    toFact(c.suite, c as unknown as RawRecord)
  )
  return [...fromNamed, ...fromTable]
}

/**
 * The six named record constants, exported so the gate's test can assert each
 * one is still a live export. `NAMED_RECORD_SOURCES` in the gate names the file
 * each came from; this proves the symbol behind each name still resolves, which
 * is what makes a deleted export a NAMED failure rather than an `undefined` that
 * projects to `present: false` with no attribution.
 */
export const NAMED_ROOM_RECORD_IDS = Object.freeze(
  NAMED_RECORDS.map(({ suite, record }) => `${suite}/${record.room}`)
)