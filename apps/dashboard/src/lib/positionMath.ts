export interface PositionSizeResult {
  riskPerUnit: number
  riskUsd: number
  positionUnits: number
  notional: number
  stopPct: number
}

export interface RiskRewardResult {
  rewardPerUnit: number
  riskPerUnit: number
  rR: number
}

function isPos(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

export function computePositionSize(
  equity: number,
  riskPct: number,
  entry: number,
  stop: number,
): PositionSizeResult | null {
  if (!isPos(equity) || !isPos(riskPct) || !isPos(entry) || !isPos(stop) || entry === stop) {
    return null
  }
  const riskUsd = (equity * riskPct) / 100
  const riskPerUnit = Math.abs(entry - stop)
  const positionUnits = riskUsd / riskPerUnit
  const notional = positionUnits * entry
  const stopPct = (riskPerUnit / entry) * 100
  return { riskPerUnit, riskUsd, positionUnits, notional, stopPct }
}

export function computeRiskReward(
  entry: number,
  stop: number,
  target: number,
): RiskRewardResult | null {
  if (!isPos(entry) || !isPos(stop) || !isPos(target) || entry === stop || target === entry) {
    return null
  }
  const riskPerUnit = Math.abs(entry - stop)
  const rewardPerUnit = Math.abs(target - entry)
  const rR = rewardPerUnit / riskPerUnit
  return { rewardPerUnit, riskPerUnit, rR }
}

export function computeHalfKelly(winRate: number, winLossRatio: number): number | null {
  let w = Number(winRate)
  if (Number.isFinite(w) && w > 1 && w <= 100) {
    w = w / 100
  }
  if (!Number.isFinite(w) || !Number.isFinite(winLossRatio) || w <= 0 || w >= 1 || winLossRatio <= 0) {
    return null
  }
  const f = w - (1 - w) / winLossRatio
  return Math.max(0, f * 0.5)
}
