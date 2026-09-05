// Command Centre — L0 runtime state (PICC_SPEC: Command Centre Web §L0/L6).
//
// The kill-switch is a MACHINE-WIDE safety device, not a per-user preference:
// one switch in this store is consulted by the Safety Sidecar's gate 1 (via
// wireKillSwitchReader) AND rendered by the Command Centre surface. A kill that
// the UI shows must be a kill that enforcement reads — otherwise the surface
// is decorative theater.
//
// Semantics: the GLOBAL kill overrides every site. Setting a kill is
// tightening; clearing it is the explicit human rearm. Every transition emits
// a 5A audit event through `appendAudit` — there is no silent path.
//
// Persistence mirrors the repo convention: one JSON file under
// PICC_COMMAND_CENTRE_DATA_DIR (the same dir the audit trail uses), memory-
// backed under vitest without the env var. A store file that cannot be parsed
// boots conservatively with the GLOBAL KILL ON (fail-safe deny — an unreadable
// store must never look like "all clear").

import { appendAudit } from "./auditTrail.mjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const STATE_FILE = join(DATA_DIR, "command-centre-runtime.json")

const canTouchDisk = () =>
  process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

/** { global: bool, sites: { [siteId]: bool } } — sites present = whoever flipped them. */
let state = { global: false, sites: {} }

function boot() {
  if (!canTouchDisk() || !existsSync(STATE_FILE)) return
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"))
    state = {
      global: parsed.global === true,
      sites: parsed.sites && typeof parsed.sites === "object" ? parsed.sites : {}
    }
  } catch {
    // Unreadable store → conservative: every switch reads as ON (fail-safe deny).
    state = { global: true, sites: {} }
  }
}
boot()

function persist() {
  if (!canTouchDisk()) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8")
}

/** Snapshot of every switch (global + per-site). */
export function killSwitchState() {
  return { global: state.global, sites: { ...state.sites } }
}

/** Effective kill for one site: the global switch overrides everything. */
export function siteKilled(siteId) {
  return state.global === true || state.sites[siteId] === true
}

/** True when ANY switch is active (the overview's "halted" headline). */
export function anyKillActive() {
  if (state.global) return true
  return Object.values(state.sites).some(Boolean)
}

/**
 * Set (tighten) or clear (explicit human rearm) one switch.
 *   scope = "global" | a site id (non-empty string)
 * The API layer validates site ids against the catalog; this store is generic.
 * Returns { ok, before, after } and always audits the transition.
 */
export function setKillSwitch(scope, kill, { audit = appendAudit, now = Date.now() } = {}) {
  const target = typeof scope === "string" && scope.trim() ? scope.trim() : null
  if (target === null) return { ok: false, error: "kill-switch scope required (global or a site id)" }
  if (typeof kill !== "boolean") return { ok: false, error: "kill must be a boolean" }
  const before = killSwitchState()
  if (target === "global") state.global = kill
  else state.sites[target] = kill
  persist()
  if (audit) {
    audit({
      site: target,
      kind: "kill-switch",
      data: { scope: target, kill, at: now }
    })
  }
  return { ok: true, before, after: { scope: target, kill: killSwitchState() } }
}

/** Test seam only — wipe to defaults (all switches OFF). */
export function _resetKillSwitchState() {
  state = { global: false, sites: {} }
  if (canTouchDisk()) writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8")
}