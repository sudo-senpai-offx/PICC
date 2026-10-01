/**
 * WS-7 T8 — the Ceremony room's view of the WS-3 ceremony store.
 *
 * THE ROOM'S ACCEPTANCE IS "CEREMONY SURFACES THE WS-3 STORE'S REAL STATE", and
 * the whole module exists to make "real" mean something testable.
 *
 * ---------------------------------------------------------------------------
 * R1.4 — WHY AN UNLOCK IS RENDERED ONLY FROM AN UNLOCK RECORD
 * ---------------------------------------------------------------------------
 *
 * R1.4 (spec :384) requires that "ceremony/handshake unlock requirements on the
 * real rails are asserted, not assumed". The two facts that make that concrete,
 * both read off the real producer rather than assumed:
 *
 *   1. `ceremonyState.unlockVenueClass()` REFUSES outside a test run
 *      (`ceremonyState.mjs:189-191`). Its own message is
 *      `ceremony:deny:ceremony-action-unreachable`, and its stated reason is that
 *      "no ceremony-action route is wired in production — the gate/route modules
 *      own the unlock check". So on the real rail there is NO path by which an
 *      unlock record comes into existence at runtime.
 *
 *   2. `evaluateCeremony()` short-circuits on gate1 and returns `ok: false` with
 *      a named `ceremony:deny:*` reason for every gate when the class has not
 *      accumulated 300 spendable resolved rows (`ceremonyGates.mjs:38-46`,
 *      `:174-201`). An EMPTY store therefore yields failing gates, never a pass.
 *
 * Together those mean the only honest rendering of an empty store is an absence,
 * and the only thing that may ever read as unlocked is an actual `enablement`
 * record produced by the store's own seam. This module therefore:
 *
 *   - renders an unlock from the `enablement` record ALONE, and derives it by
 *     requiring `unlocked === true` on a record the route supplied;
 *   - exposes NO write affordance, and says why in a constant that is asserted
 *     against the producer's own source text (`MinistryRoom.test.tsx` /
 *     `CeremonyRoom.test.tsx` read `ceremonyState.mjs` and assert this string
 *     matches what that module actually does);
 *   - reports each gate with its OWN pass/deny reason, so a failing gate set can
 *     never be summarised as "the ceremony is progressing".
 *
 * THE REASON STRING IS COPIED FROM THE PRODUCER'S OWN VOCABULARY, not invented
 * here. `ceremony:deny:ceremony-action-unreachable` is the code
 * `ceremonyState.mjs` throws; a room that spelled a different code would be
 * advertising an error the server never produces.
 *
 * PURE. No clock, no transport. `observedAt` is carried from the response rather
 * than read from `Date.now()`, so a rendered room is reproducible.
 */

import { unavailable } from "./availability"
import type { Availability } from "./availability"

/**
 * The ceremony-action code, copied from `ceremonyState.mjs:190`.
 *
 * Asserted against that module's own source by the room's tests. If a future
 * change wires a real ceremony-action route, this constant becomes false, the
 * assertion fails, and the affordance question is reopened deliberately rather
 * than the room quietly continuing to claim there is none.
 */
export const CEREMONY_ACTION_UNREACHABLE_CODE = "ceremony:deny:ceremony-action-unreachable"

/**
 * Why this room offers no unlock control.
 *
 * The `unlockVenueClass` seam is test-only by construction; the gates and the
 * route modules own the unlock check. So the honest surface is a readout with no
 * write path, and saying so beats rendering a button that cannot work.
 */
export const CEREMONY_NO_UNLOCK_AFFORDANCE_REASON =
  `This room exposes no unlock control. The store's own unlock seam refuses outside a test run with ${CEREMONY_ACTION_UNREACHABLE_CODE}, because no ceremony-action route is wired in production — the gate and route modules own the unlock check. An unlock appears here only when the store holds a real enablement record, and no such record can be created on the real rail today.`

/** Who owns an absent ceremony observation. */
export const CEREMONY_OWNER = "WS-3 ceremony ledger supply"

export type CeremonyGateRow = {
  id: string
  pass: boolean
  reason: string | null
}

export type CeremonyEnablement = {
  unlocked: true
  at: string | null
  by: string | null
}

export type CeremonyClassRow = {
  venueClass: string
  availability: Availability
  /** Every gate, with its own pass/deny reason. Never summarised away. */
  gates: readonly CeremonyGateRow[]
  gatesPassed: number
  gatesTotal: number
  spendableResolved: number | null
  scaleResolved: number | null
  enablement: CeremonyEnablement | null
  /**
   * `true` ONLY from a real store record. There is no fallback, no default and
   * no inference from the gate set — see the module header, R1.4.
   */
  unlocked: boolean
  platformVerification: {
    verified: true
    at: string | null
    by: string | null
    regulator: string | null
    payoutFloorPct: number | null
    withdrawalTested: boolean
  } | null
  lastCreditAt: string | null
  binaryOptions: boolean
  ledgerRunning: boolean
}

export type CeremonyView = {
  reason: string | null
  /** The store's own `ok`, which means THE READOUT RAN — never that a gate passed. */
  readoutExecuted: boolean
  observedAt: string | null
  scaleMinResolves: number | null
  scaleEnvError: string | null
  classes: readonly CeremonyClassRow[]
  /** True when every known venue class has a row and the readout executed. */
  complete: boolean
}

type CeremonyResponse = {
  ok?: boolean
  at?: string | null
  scaleMinResolves?: number | null
  scaleEnvError?: string | null
  classes?: unknown
}

/**
 * Project the ceremony readout into what the room may say.
 *
 * A missing or malformed body is a NAMED ABSENCE for every class, so an empty
 * store and an unreachable route cannot look alike to a reader.
 */
export function ceremonyView(body: CeremonyResponse | null | undefined): CeremonyView {
  if (body === null || body === undefined) {
    return {
      reason:
        "The ceremony readout was not obtained, so no venue class is shown. Nothing here is a statement about the store's state.",
      readoutExecuted: false,
      observedAt: null,
      scaleMinResolves: null,
      scaleEnvError: null,
      classes: [],
      complete: false
    }
  }

  const classes = Array.isArray(body.classes) ? body.classes.filter(isClassRow).map(projectClass) : []

  return {
    reason: null,
    // `ok` COPIED and only ever `=== true`. It means the readout executed, which
    // is NOT the same claim as "the ceremony is unlocked" or "the gates pass" —
    // an unhealthy store still answers ok with named denies, by design.
    readoutExecuted: body.ok === true,
    observedAt: typeof body.at === "string" ? body.at : null,
    scaleMinResolves: typeof body.scaleMinResolves === "number" && Number.isFinite(body.scaleMinResolves) ? body.scaleMinResolves : null,
    scaleEnvError: typeof body.scaleEnvError === "string" ? body.scaleEnvError : null,
    classes,
    complete: classes.length > 0 && body.ok === true
  }
}

function projectClass(raw: Record<string, unknown>): CeremonyClassRow {
  const gates = Array.isArray(raw.gates) ? raw.gates.filter(isGate).map(projectGate) : []
  const enablement = projectEnablement(raw.enablement)

  return {
    venueClass: String(raw.venueClass ?? ""),
    availability: unavailable({
      reason: gates.length === 0
        ? "the ceremony readout supplied no gates for this venue class, so nothing can be said about its ceremony state"
        : `${gates.filter((g) => !g.pass).length} of ${gates.length} ceremony gates are not satisfied; each gate names its own ceremony:deny:* reason`,
      owner: CEREMONY_OWNER,
      since: 0
    }),
    gates,
    gatesPassed: gates.filter((g) => g.pass).length,
    gatesTotal: gates.length,
    spendableResolved: finiteOrNull(raw.spendableResolved),
    scaleResolved: finiteOrNull(raw.scaleResolved),
    enablement,
    // R1.4. `unlocked` is true ONLY because a record carrying `unlocked: true`
    // exists. It is never derived from the gates, from the class count, or from
    // any other signal — a store that passed every gate but held no enablement
    // record reads as NOT unlocked, which is the correct direction.
    unlocked: enablement !== null,
    platformVerification: projectVerification(raw.platformVerification),
    lastCreditAt: typeof raw.lastCreditAt === "string" ? raw.lastCreditAt : null,
    binaryOptions: raw.binaryOptions === true,
    ledgerRunning: raw.ledgerRunning === true
  }
}

function projectGate(raw: unknown): CeremonyGateRow {
  const g = raw as Record<string, unknown>
  return {
    id: typeof g.id === "string" ? g.id : "unknown-gate",
    pass: g.pass === true,
    reason: typeof g.reason === "string" ? g.reason : null
  }
}

function projectEnablement(raw: unknown): CeremonyEnablement | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  // `unlocked: true` is REQUIRED. An object that merely exists is not an unlock.
  if (e.unlocked !== true) return null
  return {
    unlocked: true,
    at: typeof e.at === "string" ? e.at : null,
    by: typeof e.by === "string" ? e.by : null
  }
}

function projectVerification(raw: unknown): CeremonyClassRow["platformVerification"] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  // Same rule as the enablement: `verified: true` is required, so a record that
  // merely exists cannot render as a verification.
  if (v.verified !== true) return null
  return {
    verified: true,
    at: typeof v.at === "string" ? v.at : null,
    by: typeof v.by === "string" ? v.by : null,
    regulator: typeof v.regulator === "string" ? v.regulator : null,
    payoutFloorPct: finiteOrNull(v.payoutFloorPct),
    withdrawalTested: v.withdrawalTested === true
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function isClassRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { venueClass?: unknown }).venueClass === "string"
}

function isGate(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"
}
