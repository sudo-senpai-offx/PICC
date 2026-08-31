// Chart overlay toggle orchestration (T10) — pure decision layer kept out of
// the React component so toggle behavior is unit-testable against a mock
// lightweight-charts surface (spec R7: no unknown v5 API misuse).

export type OverlayKey = "volume" | "sma" | "bollinger" | "rsi" | "macd"

export interface OverlayDecision {
  key: OverlayKey
  /** The series should be drawn (on AND has rows — except volume, which draws
   *  unconditionally once candles exist). */
  visible: boolean
  /** The rows to feed the series on this pass (empty clears the series). */
  rows: unknown[]
  /** On but nothing to draw yet — the honest "warm-up" state, never a crash. */
  awaitingData: boolean
}

/**
 * Decide what every overlay series must do this pass. A series is visible only
 * when its toggle is on AND it has data — a toggle with an empty candle feed
 * (warm-up) shows nothing rather than a stale line.
 */
export function decideOverlays(
  toggles: Partial<Record<OverlayKey, boolean>>,
  rows: Partial<Record<OverlayKey, unknown[]>>
): OverlayDecision[] {
  const keys: OverlayKey[] = ["volume", "sma", "bollinger", "rsi", "macd"]
  return keys.map((key) => {
    const on = toggles[key] === true || (key === "volume" && toggles[key] !== false)
    const data = rows[key] ?? []
    const visible = on && (data.length > 0 || key === "volume")
    return { key, visible, rows: data, awaitingData: on && !visible }
  })
}

// ── secondary pane (RSI / MACD) ────────────────────────────────────────────

export type PaneKey = "rsi" | "macd"

export interface PaneSpec {
  kind: "line" | "histogram"
  options: Record<string, unknown>
}

const RSI_LINE: PaneSpec = {
  kind: "line",
  options: { color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
}

const MACD_LINE: PaneSpec = {
  kind: "line",
  options: { color: "#4ade80", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
}
const MACD_SIGNAL: PaneSpec = {
  kind: "line",
  options: { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
}
const MACD_HIST: PaneSpec = {
  kind: "histogram",
  options: { color: "rgba(108, 99, 255, 0.35)", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
}

/**
 * The series a secondary pane must contain for the requested indicators.
 * Empty request → no specs (the pane itself must be removed).
 */
export function paneSpecsFor(keys: PaneKey[]): PaneSpec[] {
  const specs: PaneSpec[] = []
  for (const k of keys) {
    if (k === "rsi") specs.push(RSI_LINE)
    if (k === "macd") {
      specs.push(MACD_LINE, MACD_SIGNAL, MACD_HIST)
    }
  }
  return specs
}

/** Pane keys the user has switched on, in a stable display order. */
export function activePaneKeys(toggles: Partial<Record<PaneKey, boolean>>): PaneKey[] {
  const out: PaneKey[] = []
  if (toggles.rsi) out.push("rsi")
  if (toggles.macd) out.push("macd")
  return out
}