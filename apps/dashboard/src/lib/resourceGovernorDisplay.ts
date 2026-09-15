// G3 — PICC_RESOURCE_GOVERNOR_v1.md §7: pure display logic for the Resource
// surface on /settings. Everything the panel renders comes from these
// null-safe functions; the component is a dumb consumer.
//
// Honesty contract (§7: "unobserved metrics render '—', never zero"):
//   - verdict counters show real counts ONLY once today's ledger has entries;
//     an empty ledger renders "—" for every counter
//   - a tier with zero calls renders "—" for tokens/latency/verdicts — zero
//     calls is "not observed", not "free"
//   - row cells with missing metrics render "—", never 0 or "n/a" fabrication
//   - the banner tells the truth about the enforcement flag
import type { ResourceOverview, ResourceLedgerRow } from "@/lib/api"

const DASH = "—"

export interface BudgetTierRow {
  tier: string
  label: string
  calls: string
  tokens: string
  avgLatencyMs: string
  verdicts: string
}

export interface VerdictSummary {
  accepted: string
  throttled: string
  failed: string
}

export interface FeatureBurn {
  feature: string
  calls: number
  accepted: number
  throttled: number
  failed: number
  tokens: number
}

export interface LedgerViewRow {
  createdAt: string
  feature: string
  tier: string
  verdict: string
  tokens: string
  latencyMs: string
  model: string
  degraded: boolean
}

export function fmtMetric(n: number | undefined | null): string {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? String(n) : DASH
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DASH
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
}

const TIER_LABELS: Record<string, string> = {
  T0: "T0 · tool calls (confidence-gated)",
  T1: "T1 · light text gen (≤500 tok)",
  T2: "T2 · reasoning / burst",
  T3: "T3 · overflow only"
}

export function budgetSheet(p: ResourceOverview): BudgetTierRow[] {
  const tiers = ["T0", "T1", "T2", "T3"]
  return tiers.map((tier) => {
    const cell = p.perTier[tier] ?? { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } }
    const seen = cell.calls > 0
    const v = cell.verdicts
    return {
      tier,
      label: TIER_LABELS[tier] ?? tier,
      calls: fmtMetric(cell.calls),
      tokens: fmtMetric(cell.tokens),
      avgLatencyMs: seen && cell.calls > 0 ? fmtMetric(Math.round(cell.latencyMs / cell.calls)) : DASH,
      verdicts: seen ? `${v.accepted}·${v.throttled}·${v.failed}` : DASH
    }
  })
}

export function verdictSummary(p: ResourceOverview): VerdictSummary {
  const observed = p.ledger.entriesToday > 0
  if (!observed) return { accepted: DASH, throttled: DASH, failed: DASH }
  return {
    accepted: String(p.verdicts.accepted),
    throttled: String(p.verdicts.throttled),
    failed: String(p.verdicts.failed)
  }
}

export function featureBurnDown(p: ResourceOverview): FeatureBurn[] {
  const byFeature = new Map<string, FeatureBurn>()
  for (const row of p.rows) {
    const key = row.feature || "unknown"
    const cur = byFeature.get(key) ?? { feature: key, calls: 0, accepted: 0, throttled: 0, failed: 0, tokens: 0 }
    cur.calls += 1
    if (row.verdict === "accepted") cur.accepted += 1
    else if (row.verdict === "throttled") cur.throttled += 1
    else if (row.verdict === "failed") cur.failed += 1
    cur.tokens += Number(row.tokens) || 0
    byFeature.set(key, cur)
  }
  return [...byFeature.values()].sort((a, b) => b.calls - a.calls)
}

export function ledgerTable(p: ResourceOverview): LedgerViewRow[] {
  return p.rows.map((row: ResourceLedgerRow) => ({
    createdAt: fmtTime(row.created_at),
    feature: row.feature || DASH,
    tier: row.tier || DASH,
    verdict: row.verdict || DASH,
    tokens: fmtMetric(row.tokens),
    latencyMs: fmtMetric(row.latencyMs),
    model: row.model || DASH,
    degraded: row.degraded === true
  }))
}

export function governorBanner(p: ResourceOverview): { enabled: boolean; text: string } {
  if (p.enabled) {
    return {
      enabled: true,
      text: "Governor ON — every LLM call is routed (T0/T1 local-first, T2 burst, T3 overflow) and each verdict lands in this ledger."
    }
  }
  return {
    enabled: false,
    text: "Governor OFF — calls run the pre-governor path. This ledger shows only what was recorded when it was on."
  }
}