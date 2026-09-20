// v3.2 Plan 3 — v32Config module (REQ-P3-1 toggle gate, REQ-P3-9 proposal cap).
//
// Sibling of u4faConfig.mjs (NOT an edit to it — the legacy config's validation
// surface is untouched). The v3.2 lane's toggle is OFF in every committed
// config: `v32-config.json` is a data-dir runtime file like `u4fa-config.json`,
// absent from the repo = default OFF. Flipping it to `true` after the
// parallel-soak flip decision is a one-line operator change (ADR-0004 / REQ-STG-3).
//
// REQ-P3-9 supersede: `proposalCap` on this lane supersedes `risk.maxDailyTrades`
// (`u4faConfig.mjs`) and `U4FA_MAX_DAILY_PROPOSALS` (`u4faRisk.mjs`) for v3.2
// decisions. `0` = unlimited (the default) — matches the `maxDailyTrades: 10`
// precedent's "0 = unlimited" validation semantics (u4faConfig.mjs:306).

import { readFile, writeFile, rename } from "node:fs/promises"
import { mkdirSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** Default v3.2 config — the toggle is OFF until the operator flips it (REQ-P3-1). */
export const V32_DEFAULTS = Object.freeze({
  enabled: false,                // REQ-P3-1: OFF ⇒ legacy decision path byte-identical
  proposalCap: 0,                // REQ-P3-9: 0 = unlimited; supersedes maxDailyTrades/U4FA_MAX_DAILY_PROPOSALS
  consecutiveLossThreshold: null, // REQ-P3-7 wire 7: null = voluntary-pause disabled until owner sets a threshold
  enabledAt: null // C2: additive soak "uptime" anchor, stamped when enabled (honest null when never enabled)
})

const TOP_KEYS = new Set(["enabled", "proposalCap", "consecutiveLossThreshold", "enabledAt"])

function checkType(v, kind, errors, path) {
  if (kind === "boolean" && typeof v !== "boolean") errors.push(`${path}: expected boolean, got ${typeof v}`)
  if (kind === "number" && (typeof v !== "number" || !Number.isFinite(v))) errors.push(`${path}: expected number, got ${typeof v}`)
}

/** Validate a merged v3.2 config. Pure — returns { ok, errors }. Typo'd knobs fail loudly (never silent-default). */
export function validateV32Config(raw) {
  const errors = []
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["config must be a JSON object"] }
  }
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.has(k)) errors.push(`unknown top-level key "${k}" (typo'd knob fails loudly)`)
  }
  if (raw.enabled != null) checkType(raw.enabled, "boolean", errors, "enabled")
  if (raw.proposalCap != null) {
    checkType(raw.proposalCap, "number", errors, "proposalCap")
    if (raw.proposalCap != null && (!Number.isInteger(raw.proposalCap) || raw.proposalCap < 0)) {
      errors.push("proposalCap: non-negative integer or 0=unlimited")
    }
  }
  if (raw.consecutiveLossThreshold != null) {
    checkType(raw.consecutiveLossThreshold, "number", errors, "consecutiveLossThreshold")
    if (raw.consecutiveLossThreshold != null && (!Number.isInteger(raw.consecutiveLossThreshold) || raw.consecutiveLossThreshold < 1)) {
      errors.push("consecutiveLossThreshold: null (disabled) or positive integer")
    }
  }
  if (raw.enabledAt != null) {
    checkType(raw.enabledAt, "number", errors, "enabledAt")
  }
  return { ok: errors.length === 0, errors }
}

function dataDir() {
  // Resolved lazily so tests can point PICC_TRADING_DATA_DIR at a tmp dir after
  // module import (same pattern as u4faConfig.mjs:130-135).
  return process.env.PICC_TRADING_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
}

const CONFIG_FILE = () => join(dataDir(), "v32-config.json")

// ---------------------------------------------------------------------
// Deep merge (plain objects recursed; arrays and scalars replace) — same
// contract as u4faConfig.deepMergeConfig so `undefined proposalCap` keeps
// the default unlimited (0). Shared copy, kept in-module (read-only stance:
// no edits to the legacy module).
// ---------------------------------------------------------------------
export function deepMergeConfig(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over
  if (over != null && typeof over === "object" && base != null && typeof base === "object") {
    const out = { ...base }
    for (const k of Object.keys(over)) {
      out[k] = base[k] != null ? deepMergeConfig(base[k], over[k]) : over[k]
    }
    return out
  }
  return over == null && base != null ? base : over
}

// ---------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------
/**
 * Load the v3.2 config: defaults <- deep-merge <- v32-config.json (if any).
 * @param {object} [opts] - { file = null, config = null } for tests
 * @returns {Promise<{ config: object, source: "file"|"defaults", file: string|null }>}
 */
export async function loadV32Config({ file = null, config = null } = {}) {
  let raw = null
  let filePath = file
  if (filePath == null) {
    try {
      filePath = CONFIG_FILE()
      raw = JSON.parse(await readFile(filePath, "utf8"))
    } catch {
      raw = null
      filePath = CONFIG_FILE()
    }
  } else if (config != null) {
    raw = config
  } else {
    try {
      raw = JSON.parse(await readFile(filePath, "utf8"))
    } catch (err) {
      if (err?.code === "ENOENT") {
        raw = null
      } else {
        throw new Error(`v32-config file unreadable: ${filePath} (${err?.message ?? String(err)})`)
      }
    }
  }
  const merged = raw != null && typeof raw === "object" && !Array.isArray(raw)
    ? deepMergeConfig(V32_DEFAULTS, raw)
    : deepMergeConfig(V32_DEFAULTS, {})
  const res = validateV32Config(merged)
  if (!res.ok) throw new Error(`v32-config invalid: ${res.errors.join("; ")}`)
  return { config: merged, source: raw != null ? "file" : "defaults", file: filePath }
}

/**
 * Additive enabled-at stamp (C2). Pure so tests never touch the data dir:
 * enabled without a stamp → stamp now; disabled → clear the stamp so a
 * re-enable reflects a new soak start. Any other payload is returned unchanged.
 */
export function stampV32Config(value, now = Date.now()) {
  if (value == null || typeof value !== "object") return value
  if (value.enabled === true) {
    if (value.enabledAt != null) return value
    return { ...value, enabledAt: now }
  }
  if (value.enabled === false && value.enabledAt != null) {
    return { ...value, enabledAt: null }
  }
  return value
}

/**
 * Atomic tmp+rename write (same pattern as u4faConfig.saveU4faConfig). VITEST-suppressed:
 * tests never touch the real data dir.
 */
export async function saveV32Config(value, { file = null } = {}) {
  if (process.env.VITEST) return true
  const stamped = stampV32Config(value)
  const payload = JSON.stringify(validateV32Config(stamped).ok ? stamped : V32_DEFAULTS, null, 2)
  const filePath = file ?? CONFIG_FILE()
  const tmp = `${filePath}.${process.pid}.tmp`
  try {
    await writeFile(tmp, payload, "utf8")
    try {
      await rename(tmp, filePath)
    } catch (err) {
      if (err && err.code === "ENOENT") {
        mkdirSync(dirname(filePath), { recursive: true })
        await rename(tmp, filePath)
      } else {
        throw err
      }
    }
    return true
  } catch (err) {
    console.warn(`[picc-v32] write failed ${filePath}:`, err.message)
    try { unlinkSync(tmp) } catch { /* already gone */ }
    return false
  }
}