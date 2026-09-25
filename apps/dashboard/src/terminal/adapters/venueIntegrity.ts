import type { Availability } from "../domain/availability"
import { isUsable } from "../domain/availability"
import type { VenueIntegrity } from "../contracts"

/**
 * WS-6 T3 — per-venue integrity register (AC-012, D11).
 *
 * D11 is a hard lock: no venue may be counterparty + price-feed authority +
 * settlement authority simultaneously. The terminal must NOT silently award
 * independence — a conflict is NAMED, the status is never `verified`, and
 * nothing here can enable execution. This module is a read-only classifier: it
 * performs no network call, reads no credential, and never returns `verified`
 * for a venue whose authorities are unknown or whose credentials are not live.
 *
 * Authority ASSIGNMENTS are operator-supplied facts. This module never invents
 * them; an unrecorded authority yields `unverified`, not a guess.
 */

export type VenueRecord = {
  venueId: string
  feedAuthority: string
  counterpartyAuthority: string
  settlementAuthority: string
  credentialStatus: Availability
  /** Optional operator-declared hold. A blocked venue is never verified. */
  blocked?: string | null
}

export type RegisterAssessment = {
  venues: VenueIntegrity[]
  conflicted: string[]
  blockers: Array<{ venueId: string; blocker: string }>
  /** True only when the register is non-empty and every venue is verified. */
  allVerified: boolean
}

const ROLES = [
  { role: "feed authority", field: "feedAuthority" },
  { role: "counterparty authority", field: "counterpartyAuthority" },
  { role: "settlement authority", field: "settlementAuthority" }
] as const

function norm(value: string): string {
  return typeof value === "string" ? value.trim() : ""
}

export function assessVenue(record: VenueRecord): VenueIntegrity {
  const authorities = ROLES.map((r) => ({ ...r, value: norm(record[r.field]) }))

  // Unknown authority is an unconfigured state, not a verified one.
  const missing = authorities.filter((a) => a.value.length === 0)
  if (missing.length > 0) {
    return {
      ...toIntegrity(record),
      integrityStatus: "unverified",
      blocker: `authority not recorded: ${missing.map((m) => m.role).join(", ")}`
    }
  }

  // D11: find any single entity holding two or more of the three roles.
  const byEntity = new Map<string, string[]>()
  for (const a of authorities) {
    const held = byEntity.get(a.value)
    if (held) held.push(a.role)
    else byEntity.set(a.value, [a.role])
  }
  const conflicts = [...byEntity.entries()].filter(([, roles]) => roles.length > 1)
  if (conflicts.length > 0) {
    const detail = conflicts.map(([entity, roles]) => `"${entity}" holds ${roles.join(" + ")}`).join("; ")
    return {
      ...toIntegrity(record),
      integrityStatus: "conflict",
      blocker: `venue independence conflict — ${detail}. Requires an ADR-backed exception before any wiring.`
    }
  }

  if (typeof record.blocked === "string" && record.blocked.trim().length > 0) {
    return { ...toIntegrity(record), integrityStatus: "blocked", blocker: record.blocked.trim() }
  }

  // Integrity cannot be verified while the credential state is unknown.
  if (!isUsable(record.credentialStatus)) {
    return {
      ...toIntegrity(record),
      integrityStatus: "unverified",
      blocker: "credential state is not live; independence cannot be verified"
    }
  }

  return { ...toIntegrity(record), integrityStatus: "verified", blocker: null }
}

function toIntegrity(record: VenueRecord): VenueIntegrity {
  return {
    venueId: record.venueId,
    feedAuthority: record.feedAuthority,
    counterpartyAuthority: record.counterpartyAuthority,
    settlementAuthority: record.settlementAuthority,
    credentialStatus: record.credentialStatus,
    integrityStatus: "unverified",
    blocker: null
  }
}

export function assessRegister(records: readonly VenueRecord[]): RegisterAssessment {
  const venues = records.map(assessVenue)
  const conflicted = venues.filter((v) => v.integrityStatus === "conflict").map((v) => v.venueId)
  const blockers = venues
    .filter((v) => v.blocker != null)
    .map((v) => ({ venueId: v.venueId, blocker: v.blocker as string }))
  // An empty register is an UNCONFIGURED state, never a vacuous all-clear.
  const allVerified = venues.length > 0 && venues.every((v) => v.integrityStatus === "verified")
  return { venues, conflicted, blockers, allVerified }
}
