// ConvergencePanel display mapping (spec 7c) — pure and unit-testable in the
// node vitest environment (the dashboard has no jsdom/testing-library; full
// React mounting is out of reach, so all render decisions live here and the
// component stays a dumb consumer). Absent reads render as "—", never 0
// (R10 honesty: unconfigured ≠ zero-filled).
import type { ConvergenceResult, ConvergencePlane, ConvergenceState } from "@/lib/liveTrading"

export interface ConvergenceDisplayRow {
  key: string
  tfLabel: string
  role: string | null
  sign: "▲" | "▼" | "·" | "—"
  score: string
  amplitude: string
  adx: string
  source: string
  stale: boolean
}

export const NDA = "—"

/** Timeframe seconds → human label (60→"1m", 3600→"1H", 14400→"4h", …). */
export function tfLabel(seconds: number): string {
  if (seconds % 3600 === 0 && seconds >= 3600) {
    const h = seconds / 3600
    return h === 1 ? "1H" : `${h}h`
  }
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

/** Deterministic badge/state vocabulary (spec 4a). */
export function stateTone(state: ConvergenceState | string): "success" | "warn" | "muted" | "danger" {
  if (state === "NO TRADE" || state === "WAIT") return "muted"
  if (state.endsWith("BIAS")) return "success"
  if (state.endsWith("ONLY")) return "warn"
  return "warn"
}

export function displaySign(p: ConvergencePlane): ConvergenceDisplayRow["sign"] {
  if (!p.active) return "—"
  if (p.sign === 1) return "▲"
  if (p.sign === -1) return "▼"
  return "·"
}

export function fmt(v: number | null, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NDA
  return v.toFixed(digits)
}

/** The full matrix: every ladder plane → one display row; absent reads show "—". */
export function convergenceDisplayRows(r: ConvergenceResult | null): ConvergenceDisplayRow[] {
  const planes = r?.planes ?? []
  return planes.map((p) => ({
    key: String(p.tf),
    tfLabel: tfLabel(p.tf),
    role: p.label,
    sign: displaySign(p),
    score: p.score === null ? NDA : `${p.score}/5`,
    amplitude: fmt(p.amplitude),
    adx: fmt(p.adx),
    source: p.source === "none" ? NDA : p.source === "error" ? "error" : p.source,
    stale: p.stale
  }))
}

/** Header metric cell: null-safe, "—" for absent. */
export function headerMetric(v: number | null, style: "score" | "pct"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NDA
  if (style === "score") return `${v}/5`
  return `${v}%`
}

/** Human-readable state line: state plus the deterministic why reasons. */
export function whyText(r: ConvergenceResult | null): string {
  if (!r) return NDA
  const parts = Array.isArray(r.why) ? r.why : r.why ? [r.why] : []
  return [r.state, ...parts].join(" — ")
}