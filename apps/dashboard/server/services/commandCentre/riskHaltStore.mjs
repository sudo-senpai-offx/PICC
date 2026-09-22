// Command Centre — L0 halt persistence (WS-2 R4 / AC-3). Owns
// command-centre-halt.json beside the runtime STATE_FILE, mirroring the runtime
// store's boot/persist convention (commandCentreRuntime.mjs): an unreadable or
// version-≠1 file hydrates TRIPPED — fail-safe deny, a broken store never looks
// like "all clear". Mutations are write-through and audited via appendAudit.
//
// The sidecar seam is wired at module init: the sidecar's noteBreakerTrip /
// humanTakeover / clearTakeover write through here, and this store's own
// tripBreaker / humanTakeoverPersist / clearTakeoverPersist seed the sidecar's
// in-memory globalHalt/takeover (which gate 2/3 enforce). The sidecar's gate
// logic is untouched — this module only observes and persists.

import { appendAudit } from "./auditTrail.mjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { dayKeyOf } from "../u4faRisk.mjs"
import { hydrateHaltState, wireHaltPersistence } from "./safetySidecar.mjs"

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const HALT_FILE = join(DATA_DIR, "command-centre-halt.json")

const canTouchDisk = () =>
  process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

/** { version: 1, globalHalt: null|{dayKey,site,breaker,at}, takeover: null|{at} } */
let halt = { version: 1, globalHalt: null, takeover: null }

function persist() {
  if (!canTouchDisk()) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(HALT_FILE, JSON.stringify(halt, null, 2), "utf8")
}

/** Write-through + audit (mirrors commandCentreRuntime.setKillSwitch's persist/audit). */
function commit(site, kind, data = {}, audit = appendAudit) {
  persist()
  if (audit) audit({ site, kind, data })
}

function tripFrom(value) {
  if (!value || typeof value !== "object") return null
  if (typeof value.dayKey !== "string" || value.dayKey.length === 0) return null
  return {
    dayKey: value.dayKey,
    site: value.site ?? "unknown",
    breaker: value.breaker ?? "unknown",
    at: Number.isFinite(value.at) ? value.at : null
  }
}

function takeoverFrom(value) {
  if (!value || typeof value !== "object") return null
  return Number.isFinite(value.at) ? { at: value.at } : null
}

/** Fail-safe posture: a trip for the current UTC day — gate 2 blocks now. */
function trippedDefault() {
  const at = Date.now()
  return { version: 1, globalHalt: tripFrom({ dayKey: dayKeyOf(at), site: "halt-store", breaker: "unreadable", at }), takeover: null }
}

function loadFromDisk() {
  if (!canTouchDisk() || !existsSync(HALT_FILE)) {
    return { version: 1, globalHalt: null, takeover: null }
  }
  try {
    const parsed = JSON.parse(readFileSync(HALT_FILE, "utf8"))
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) return trippedDefault()
    const globalHalt = tripFrom(parsed.globalHalt)
    if (parsed.globalHalt != null && globalHalt === null) return trippedDefault()
    const takeover = takeoverFrom(parsed.takeover)
    if (parsed.takeover != null && takeover === null) return trippedDefault()
    return { version: 1, globalHalt, takeover }
  } catch {
    // Unreadable/version-≠1 → hydrate tripped (fail-safe deny).
    return trippedDefault()
  }
}

/** Boot / re-hydration hook: re-read the file, seed the sidecar, return snapshot. */
export function hydrate() {
  if (canTouchDisk()) halt = loadFromDisk()
  hydrateHaltState({ globalHalt: halt.globalHalt, takeover: halt.takeover })
  return haltSnapshot()
}

/** Snapshot of the persisted halt state (memory truth). */
export function haltSnapshot() {
  return {
    globalHalt: halt.globalHalt ? { ...halt.globalHalt } : null,
    takeover: halt.takeover ? { ...halt.takeover } : null
  }
}

/**
 * Store-side trip entry point (the F2 gate-16 producer also uses the sidecar's
 * noteBreakerTrip, which writes through via the wired seam). Persists + audits,
 * then seeds the sidecar so gate 2 blocks the UTC day.
 */
export function tripBreaker(site, breaker, { now = Date.now(), audit = appendAudit } = {}) {
  const trip = { dayKey: dayKeyOf(now), site, breaker, at: now }
  halt = { ...halt, globalHalt: trip }
  commit(site, "halt:trip", { ...trip }, audit)
  hydrateHaltState({ globalHalt: halt.globalHalt, takeover: halt.takeover })
  return haltSnapshot()
}

/** Store-side takeover (5B): deny-all until clear. Persists + audits + seeds. */
export function humanTakeoverPersist({ now = Date.now(), audit = appendAudit } = {}) {
  halt = { ...halt, takeover: { at: now } }
  commit(null, "halt:takeover", { at: now }, audit)
  hydrateHaltState({ globalHalt: halt.globalHalt, takeover: halt.takeover })
  return haltSnapshot()
}

/** Store-side rearm: explicit human clear of the takeover. */
export function clearTakeoverPersist({ audit = appendAudit } = {}) {
  halt = { ...halt, takeover: null }
  commit(null, "halt:clear", {}, audit)
  hydrateHaltState({ globalHalt: halt.globalHalt, takeover: halt.takeover })
  return haltSnapshot()
}

// Wire the sidecar seam: any sidecar mutation writes through to this store.
wireHaltPersistence({
  onTrip: (trip) => {
    halt = { ...halt, globalHalt: { dayKey: trip.dayKey, site: trip.site, breaker: trip.breaker, at: trip.at } }
    commit(trip.site, "halt:trip", { dayKey: trip.dayKey, site: trip.site, breaker: trip.breaker, at: trip.at })
  },
  onTakeover: (tk) => {
    halt = { ...halt, takeover: { at: tk.at } }
    commit(null, "halt:takeover", { at: tk.at })
  },
  onClear: () => {
    halt = { ...halt, takeover: null }
    commit(null, "halt:clear", {})
  }
})

hydrate()

/** Test seam only — wipe to default (no halt, no takeover). */
export function _resetHaltStore() {
  halt = { version: 1, globalHalt: null, takeover: null }
  persist()
  hydrateHaltState({ globalHalt: null, takeover: null })
}