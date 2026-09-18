// Chart source preference (T3 — PICC_MULTISOURCE_ENGINE, Mechanism B).
//
// Persisted per-user market-data source preference, mirroring the feed-mode
// pattern in liveEO.mjs exactly: boot read-once from a PICC_DATA_DIR-resolved
// JSON file, tmp+rename writes, and reads/writes suppressed under VITEST so
// parallel test files can never contaminate each other's prefs through the
// shared data dir. "auto" = quality-ordered fan-in; any broker slug is a
// FORCED source (tried first, falls through the quality order on emptiness —
// sourceMode:"fallback", never a blackout).
//
// File shape: { "<userId>": { "source": "auto"|slug, "updatedAt": ts } }.
// Pre-auth single-user mode keys "default" (the requireAuth/verifyUser idiom).
// A slug is only accepted while it names a REGISTERED candle-capable broker —
// unknown/paper slugs resolve to "auto" rather than pinning a dead preference.

import { join } from "node:path"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { getBroker } from "./brokers/index.mjs"

const isVitest = () => process.env.VITEST === "true"
const PREFS_FILE = process.env.PICC_DATA_DIR
  ? join(process.env.PICC_DATA_DIR, "chart-prefs.json")
  : fileURLToPath(new URL("../data/chart-prefs.json", import.meta.url))

let prefs = {}
if (!isVitest()) {
  try {
    const parsed = JSON.parse(readFileSync(PREFS_FILE, "utf8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) prefs = parsed
  } catch { /* no prefs on disk yet — default */ }
}

/** Accept "auto" or a registered candle-capable broker slug (else "auto"). */
function normalizeSource(source) {
  const s = String(source ?? "").trim().toLowerCase()
  if (s === "" || s === "auto") return "auto"
  try {
    const broker = getBroker(s)
    if (broker && broker.slug !== "paper") return s
  } catch { /* registry unavailable — treat as unknown */ }
  return "auto"
}

function keyFor(userId) {
  return String(userId ?? "default") || "default"
}

/** Current source preference for a user ("auto" | broker slug). */
export function getSourcePref(userId) {
  const k = keyFor(userId)
  return normalizeSource(prefs[k]?.source)
}

/** Set the source preference. Returns the accepted value ("auto" for invalid). */
export function setSourcePref(userId, source) {
  const k = keyFor(userId)
  const s = normalizeSource(source)
  prefs[k] = { source: s, updatedAt: Date.now() }
  if (!isVitest()) {
    try {
      const tmp = `${PREFS_FILE}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(prefs, null, 2))
      renameSync(tmp, PREFS_FILE)
    } catch (err) {
      console.warn("[picc-prefs] chart source-pref write failed:", err.message)
    }
  }
  return s
}