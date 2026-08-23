// PICC Calibration — predicted-vs-realized confidence accounting.
//
// Every TRADE verdict recorded by the adaptive-confluence engine carries a
// predicted confidence (45–92%). Once the accuracy ledger resolves the entry
// (hit / miss / push against real price movement), we can ask the only question
// that matters: does "62% confident" actually win ~62% of the time?
//
// computeCalibration() buckets resolved decisions by predicted confidence and
// reports the realized win rate per bucket. A NEGATIVE calibration gap means
// the engine is overconfident — the honesty-damping pipeline exists to shrink
// exactly that gap. getBreakevenWinRate() gives the win rate a payout schedule
// demands before a single unit of stake is expected to break even.
import { LEDGER_CAP, ledgerHistory } from "./accuracyLedger.mjs"

export const CALIBRATION_BUCKET_EDGES = [55, 60, 65, 70, 75, 80, 85, 90, 95]

const round = (v, d = 6) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)

function normalizeConfidencePct(raw) {
  const c = Number(raw)
  if (!Number.isFinite(c)) return null
  return c <= 1 ? c * 100 : c
}

function decisionConfidencePct(d) {
  if (!d) return null
  if (d.confidence != null) return normalizeConfidencePct(d.confidence)
  if (d.winProb != null) return normalizeConfidencePct(Number(d.winProb) * 100)
  return null
}

export function bucketKeyFor(confidencePct) {
  const edges = CALIBRATION_BUCKET_EDGES
  if (!Number.isFinite(confidencePct)) return null
  if (confidencePct < edges[0] || confidencePct > edges[edges.length - 1]) return null
  const idx = Math.min(
    Math.floor((confidencePct - edges[0]) / 5),
    edges.length - 2
  )
  return `${edges[idx]}–${edges[idx + 1]}%`
}

function resolvedFromLedger() {
  try {
    return ledgerHistory(LEDGER_CAP)
      .filter((e) => e.status === "resolved" && ["hit", "miss", "push"].includes(e.result))
      .reverse()
  } catch {
    return []
  }
}

function normalizeDecisions(decisions) {
  const list = Array.isArray(decisions) ? decisions : resolvedFromLedger()
  return list.filter((d) => d && ["hit", "miss", "push"].includes(d.result))
}

export function computeCalibration(decisions = null) {
  const resolved = normalizeDecisions(decisions)
  const buckets = new Map()
  let unbucketed = 0
  for (const d of resolved) {
    const conf = decisionConfidencePct(d)
    const key = bucketKeyFor(conf)
    if (!key) {
      unbucketed++
      continue
    }
    if (!buckets.has(key)) {
      buckets.set(key, {
        bucket: key,
        count: 0,
        hits: 0,
        misses: 0,
        pushes: 0,
        predictedSum: 0
      })
    }
    const b = buckets.get(key)
    b.count++
    b.predictedSum += conf / 100
    if (d.result === "hit") b.hits++
    if (d.result === "miss") b.misses++
    if (d.result === "push") b.pushes++
  }
  const rows = [...buckets.values()]
    .map((b) => ({
      bucket: b.bucket,
      count: b.count,
      predictedWinRate: round(b.predictedSum / b.count),
      realizedWinRate: b.hits + b.misses > 0 ? round(b.hits / (b.hits + b.misses)) : null,
      calibrationGap:
        b.hits + b.misses > 0
          ? round(b.hits / (b.hits + b.misses) - b.predictedSum / b.count)
          : null,
      pushes: b.pushes
    }))
    .sort((a, b) => parseFloat(a.bucket) - parseFloat(b.bucket))
  return {
    totalResolved: resolved.length,
    unbucketed,
    buckets: rows
  }
}

export function getBreakevenWinRate(payoutPct) {
  const pay = Number(payoutPct)
  if (!Number.isFinite(pay) || pay <= 0) return null
  return round(1 / (1 + pay / 100), 6)
}

function sampleAdequacyLabel(n) {
  if (!Number.isFinite(n)) return "insufficient"
  if (n < 100) return "insufficient"
  if (n <= 500) return "limited"
  return "adequate"
}

export function getCalibrationSummary(decisions = null) {
  const resolved = normalizeDecisions(decisions)
  const hits = resolved.filter((d) => d.result === "hit").length
  const misses = resolved.filter((d) => d.result === "miss").length
  const pushes = resolved.filter((d) => d.result === "push").length
  const decided = hits + misses
  const hitRate = decided > 0 ? hits / decided : null
  const withConf = resolved.map((d) => decisionConfidencePct(d)).filter((c) => c != null)
  const avgPredicted = withConf.length ? withConf.reduce((a, b) => a + b / 100, 0) / withConf.length : null
  const gap = hitRate != null && avgPredicted != null ? round(hitRate - avgPredicted) : null
  const payouts = resolved.map((d) => Number(d.payout)).filter((p) => Number.isFinite(p) && p > 0)
  const avgPayout = payouts.length ? payouts.reduce((a, b) => a + b, 0) / payouts.length : null
  const cal = computeCalibration(resolved)
  return {
    totalResolved: resolved.length,
    decided,
    hits,
    misses,
    pushes,
    hitRate: round(hitRate),
    avgPredictedConfidence: round(avgPredicted),
    calibrationGap: gap,
    sampleSize: resolved.length,
    adequacy: sampleAdequacyLabel(resolved.length),
    breakevenWinRate: avgPayout != null ? getBreakevenWinRate(avgPayout) : null,
    avgPayout: round(avgPayout, 2),
    buckets: cal.buckets,
    unbucketed: cal.unbucketed,
    source: resolved.length > 0 ? "trade history" : "insufficient data"
  }
}
