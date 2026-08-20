/**
 * Kelly Criterion position sizing calculator.
 * f* = (W × P - L) / P where W=win probability, P=average payout, L=loss probability
 */
import { localStore } from "./localstore.mjs"

const store = localStore("kelly", { history: [], settings: { mode: "half", baseFraction: 0.02, maxFraction: 0.1 } })

export function getKellySettings() {
  return store.data.settings
}

export function saveKellySettings(settings) {
  Object.assign(store.data.settings, settings)
  store.write()
  return store.data.settings
}

export function computeKelly(winRate, avgPayout, mode = "half") {
  if (!winRate || !avgPayout || winRate <= 0 || winRate >= 1 || avgPayout <= 0) {
    return { fullKelly: 0, suggested: 0, breakEven: 0, mode }
  }
  const w = winRate
  const l = 1 - w
  const p = avgPayout
  const fullKelly = (w * p - l) / p
  const fraction = mode === "quarter" ? 0.25 : mode === "half" ? 0.5 : 1
  const suggested = Math.max(0, fullKelly * fraction)
  const breakEven = 1 / (1 + p)
  return { fullKelly: Math.round(fullKelly * 10000) / 100, suggested: Math.round(suggested * 10000) / 100, breakEven: Math.round(breakEven * 10000) / 100, mode }
}

export function getAntiMartingaleTier(streak, settings = {}) {
  const base = settings.baseFraction || 0.02
  const step = settings.stepFraction || 0.005
  const cap = settings.maxFraction || 0.1
  if (streak <= 0) return { tier: 0, fraction: base, label: "Base" }
  const tier = Math.min(streak, 5)
  const fraction = Math.min(base + tier * step, cap)
  return { tier, fraction: Math.round(fraction * 10000) / 100, label: `Win streak ${tier}` }
}

export function kellySnapshot() {
  const settings = getKellySettings()
  const history = store.data.history || []
  const recent = history.slice(-200)
  const wins = recent.filter((t) => t.outcome === "win").length
  const winRate = recent.length > 0 ? wins / recent.length : 0.5
  const avgPayout = recent.length > 0 ? recent.reduce((s, t) => s + (t.payout || 1), 0) / recent.length : 1.5
  return { settings, stats: { totalTrades: recent.length, winRate: Math.round(winRate * 10000) / 100, avgPayout: Math.round(avgPayout * 100) / 100 }, kelly: computeKelly(winRate, avgPayout, settings.mode) }
}
