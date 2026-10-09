// Wave3+02 — graduated paper day-loss circuit (PAPER-FIRST).
//
// Sits ATOP the hardened 5D ceiling, never inside it:
//   - safetySidecar.mjs gate 8 (envelope-within-ceiling, maxDailyLossPct: 5)
//     and risk gates 16-19 are UNTOUCHED — live paths stay byte-identical.
//   - This module + the interventions tradeGate wiring apply ONLY to the
//     paper/demo propose paths (proposeTrade / proposeSuiteTrade).
//
// Scale (verified from source, not assumed): day-loss-pct is a percent on the
// 0..100 scale — state.dayLossPct (safetySidecar.mjs:295-299), aggregate
// riskState dayLossPct (riskState.mjs:201-202), U4FA_DAILY_LOSS_LIMIT_PCT = 5
// (u4faRisk.mjs:23), envelope maxDailyLossPct: 5 (policyGraphCatalog.mjs).
//
// Levels (named constants, proposed values in-report):
//   L0  loss <  L1 (3%)  → allow (full size)
//   L1  loss >= L1 (3%)  → reduce-size (halve, factor 0.5)
//   L2  loss >= L2 (5%)  → halt-new (block new paper proposals)
//   L3  loss >= L3 (10%) → halt-all + persisted latch until MANUAL re-enable
//
// Honesty contract: every outcome carries a NAMED reason (greppable
// `paper-circuit-*`); unobservable loss fails closed; the L3 latch never
// auto-clears (not on day rollover, not on restart) — only clearPaperCircuitHalt
// with a human reviewer clears it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { dayKeyOf } from "./u4faRisk.mjs"

/** L1: reduce size past this day-loss %. */
export const PAPER_CIRCUIT_L1_PCT = 3
/** L2: halt new paper trades past this day-loss %. */
export const PAPER_CIRCUIT_L2_PCT = 5
/** L3: halt-all + persisted manual-review latch past this day-loss %. */
export const PAPER_CIRCUIT_L3_PCT = 10
/** L1 sizing factor (halve). */
export const PAPER_CIRCUIT_SIZE_FACTOR_L1 = 0.5

const CIRCUIT_FILE = "paper-circuit.json"
const round2 = (x) => Math.round(Number(x) * 100) / 100

function dataDir() {
  const raw = process.env.PICC_DATA_DIR
  if (raw) return isAbsolute(raw) ? raw : join(fileURLToPath(new URL("..", import.meta.url)), raw)
  return fileURLToPath(new URL("../data", import.meta.url))
}
const circuitFile = () => join(dataDir(), CIRCUIT_FILE)
const canTouchDisk = () =>
  process.env.VITEST !== "true" || Boolean(process.env.PICC_DATA_DIR)

/** { version: 1, halted: null | { dayKey, level: 3, dayLossPct, at, reason } } */
let circuit = { version: 1, halted: null }

function persist() {
  if (!canTouchDisk()) return
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(circuitFile(), JSON.stringify(circuit, null, 2), "utf8")
}

function trippedFrom(value) {
  if (!value || typeof value !== "object") return null
  if (typeof value.dayKey !== "string" || value.dayKey.length === 0) return null
  return {
    dayKey: value.dayKey,
    level: 3,
    dayLossPct: Number.isFinite(Number(value.dayLossPct)) ? Number(value.dayLossPct) : null,
    at: Number.isFinite(value.at) ? value.at : null,
    reason: typeof value.reason === "string" ? value.reason : "paper-circuit-l3-halt-all"
  }
}

/** Re-read the persisted latch (restart survival). Tolerant: malformed = no halt. */
export function hydratePaperCircuit() {
  if (!canTouchDisk()) return { halted: circuit.halted ? { ...circuit.halted } : null }
  if (!existsSync(circuitFile())) {
    // No file: keep memory truth (an L3 latch is only released by explicit
    // manual clear — a missing file never silently drops it).
    return { halted: circuit.halted ? { ...circuit.halted } : null }
  }
  try {
    const parsed = JSON.parse(readFileSync(circuitFile(), "utf8"))
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      circuit = { version: 1, halted: null }
      return { halted: null }
    }
    circuit = { version: 1, halted: trippedFrom(parsed.halted) }
  } catch {
    circuit = { version: 1, halted: null }
  }
  return { halted: circuit.halted ? { ...circuit.halted } : null }
}

function ensureLoaded() {
  // Singleton safety: a fresh process (or a test that set PICC_DATA_DIR after
  // this module loaded) with no memory halt re-reads the file once.
  if (circuit.halted === null && canTouchDisk() && existsSync(circuitFile())) {
    hydratePaperCircuit()
  }
}

export function paperCircuitSnapshot() {
  ensureLoaded()
  return { halted: circuit.halted ? { ...circuit.halted } : null }
}

export function isPaperCircuitHalted() {
  return paperCircuitSnapshot().halted !== null
}

/**
 * Day-loss % on the shared percent scale: max(0, -pnl/start*100).
 * Null when the start balance is unobservable (fail-closed upstream).
 */
export function paperDayLossPctOf({ dayStartBalance, dayPnl } = {}) {
  const start = Number(dayStartBalance)
  const pnl = Number(dayPnl)
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(pnl)) return null
  return round2(Math.max(0, (-pnl / start) * 100))
}

/**
 * Pure level evaluation. The persisted L3 latch dominates: when halted, every
 * call is halt-all until explicit manual re-enable (never automatic).
 */
export function evaluatePaperCircuit({ dayLossPct, now = Date.now() } = {}) {
  ensureLoaded()
  if (circuit.halted) {
    return {
      level: 3,
      action: "halt-all",
      sizeFactor: 0,
      dayKey: dayKeyOf(now),
      reason: `paper-circuit-l3-halt-all-persisted: tripped ${circuit.halted.dayKey} (loss ${circuit.halted.dayLossPct ?? "?"}%) — manual re-enable required, use clearPaperCircuitHalt({ reviewer })`
    }
  }
  const raw = dayLossPct
  // NB: Number(null) === 0 — a null loss must NOT read as 0% (null ≠ 0).
  if (raw == null) {
    return {
      level: 2,
      action: "halt-new",
      sizeFactor: 0,
      dayKey: dayKeyOf(now),
      reason: "paper-circuit-unobservable: day loss is null/NaN/non-finite; no paper proposal on unobservable loss"
    }
  }
  const loss = Number(raw)
  if (!Number.isFinite(loss)) {
    return {
      level: 2,
      action: "halt-new",
      sizeFactor: 0,
      dayKey: dayKeyOf(now),
      reason: "paper-circuit-unobservable: day loss is null/NaN/non-finite; no paper proposal on unobservable loss"
    }
  }
  if (loss >= PAPER_CIRCUIT_L3_PCT) {
    return {
      level: 3,
      action: "halt-all",
      sizeFactor: 0,
      dayKey: dayKeyOf(now),
      reason: `paper-circuit-l3-halt-all: day loss ${loss}% >= L3 ${PAPER_CIRCUIT_L3_PCT}% — halt-all until manual re-enable`
    }
  }
  if (loss >= PAPER_CIRCUIT_L2_PCT) {
    return {
      level: 2,
      action: "halt-new",
      sizeFactor: 0,
      dayKey: dayKeyOf(now),
      reason: `paper-circuit-l2-halt-new: day loss ${loss}% >= L2 ${PAPER_CIRCUIT_L2_PCT}% — new paper trades halted`
    }
  }
  if (loss >= PAPER_CIRCUIT_L1_PCT) {
    return {
      level: 1,
      action: "reduce-size",
      sizeFactor: PAPER_CIRCUIT_SIZE_FACTOR_L1,
      dayKey: dayKeyOf(now),
      reason: `paper-circuit-l1-reduce-size: day loss ${loss}% >= L1 ${PAPER_CIRCUIT_L1_PCT}% — size halved (factor ${PAPER_CIRCUIT_SIZE_FACTOR_L1})`
    }
  }
  return {
    level: 0,
    action: "allow",
    sizeFactor: 1,
    dayKey: dayKeyOf(now),
    reason: `paper-circuit-ok: day loss ${loss}% below L1 ${PAPER_CIRCUIT_L1_PCT}%`
  }
}

/** Latch the L3 halt-all. Called by the paper propose path on an L3 reading. */
export function tripPaperCircuitHalt({ dayLossPct = null, now = Date.now(), reason = null } = {}) {
  const loss = Number(dayLossPct)
  circuit = {
    version: 1,
    halted: {
      dayKey: dayKeyOf(now),
      level: 3,
      dayLossPct: Number.isFinite(loss) ? loss : null,
      at: now,
      reason: typeof reason === "string" && reason.length > 0 ? reason : "paper-circuit-l3-halt-all"
    }
  }
  persist()
  return paperCircuitSnapshot()
}

/**
 * MANUAL re-enable — the ONLY release for the L3 latch. Requires a human
 * reviewer identity; never called automatically (no day-rollover clear, no
 * restart clear, no loss-recovery clear).
 */
export function clearPaperCircuitHalt({ reviewer = null, now = Date.now() } = {}) {
  if (typeof reviewer !== "string" || reviewer.trim().length === 0) {
    throw new Error("paper-circuit-manual-re-enable needs a reviewer: clearPaperCircuitHalt({ reviewer })")
  }
  void now
  circuit = { version: 1, halted: null }
  persist()
  return paperCircuitSnapshot()
}

/** Test seam only — wipes memory + persisted latch. */
export function _resetPaperCircuitStore() {
  circuit = { version: 1, halted: null }
  persist()
}

hydratePaperCircuit()
