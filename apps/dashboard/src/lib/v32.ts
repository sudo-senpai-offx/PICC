// v3.2 lane — frontend types + tiny presentational helpers (PICC_COPILOT_REDESIGN
// ch.2/4). Types mirror the server surfaces: the realtime `v32` section
// (v32Section.mjs), the register rows (v32Engine.v32DecisionForAsset), and the
// additive per-asset explain state (v32Copilot.explainState). Honesty helpers
// return "—" for null so absent digits render as absent, never as 0.

export const EV_RR_MIN = 2 // constitution.mjs:22 — the cost-line floor

export interface V32Pillar {
  pillar?: string
  available?: boolean
  direction?: "up" | "down" | "neutral"
  reason?: string
  [k: string]: unknown
}

export interface V32CopilotWire {
  id: number | string
  tripped: boolean
  reason: string
  [k: string]: unknown
}

export interface V32DecisionRow {
  engine: "v3.2"
  assetId: string
  asset: string
  direction: "up" | "down" | null
  expiry: number | null
  ts: number
  score: {
    available: boolean
    score: number | null
    direction: "up" | "down" | "neutral"
    pillars: V32Pillar[]
    degraded: { pillar: string; reason: string }[]
    reason?: string
    source?: string
  }
  costLine: {
    ev: number | null
    evPerWin: number | null
    breakevenPayout: number | null
    payoutBeats: boolean
    evRR: number | null
    evRRPass: boolean
  }
  confidence: number | null
  regime: unknown
  copilot: { ok: boolean; wires: V32CopilotWire[]; blockedBy: (string | number)[] }
  verdict: "TRADE" | "OBSERVE" | "NEUTRAL"
  gates: { score: boolean; costLine: boolean; copilot: boolean }
  reasons: string[]
  honesty: { sampleSource?: string; spreadSource?: string | null; calendarSource?: string; candleSource?: string; tradesFeed?: string }
}

export interface V32ExplainState {
  at: number | null
  ok: boolean
  verdict: "TRADE" | "NEUTRAL"
  blockedBy: (string | number)[]
  wires: V32CopilotWire[]
  costLine: V32DecisionRow["costLine"] | null
  score: { available: boolean; score: number | null; direction: string } | null
  regime: { adx: { available: boolean; chop: boolean | null } | null; session: { available: boolean; label: string | null } | null }
  risk: { dayStartBalance: unknown; pnl: unknown; proposalsToday: unknown }
  config: { proposalCap: number | null; consecutiveLossThreshold: number | null }
}

export interface V32FlipGate {
  flip: boolean
  legacyExpectancy: number | null
  candidateExpectancy: number | null
  legacyTrades: number
  candidateTrades: number
  reason: string
}

export interface V32Soak {
  resolved: number
  breakeven: number | null
  reason: string | null
}

export interface V32Watch {
  total: number
  buffered: number
  reason: string | null
}

export interface V32Decisions {
  resolved: number
  total: number
}

export interface V32Uptime {
  seconds: number | null
  reason: string | null
}

export interface V32RegisterSnapshot {
  ok: boolean
  enabled: boolean
  mode: "powered" | "shadow"
  at: number
  assets: V32DecisionRow[]
  assetCount: number
  soak: V32Soak
  flipGate: V32FlipGate
  watch: V32Watch
  decisions: V32Decisions
  breakeven: number | null
  uptime: V32Uptime
  explain: { assetId: string; state: V32ExplainState }[]
}

/** Uptime seconds → "59s" / "1m" / "1h 2m"; null → "—" (never "0" for absent). */
export function fmtUptime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—"
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Pillar seal glyph: directional read, or an honest "—" when unmeasured. */
export function pillarGlyph(p: V32Pillar): string {
  if (p.available === false) return "—"
  if (p.direction === "up") return "▲"
  if (p.direction === "down") return "▼"
  if (p.direction === "neutral") return "·"
  return "?"
}