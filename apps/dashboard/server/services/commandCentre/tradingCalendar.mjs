// WS-3 F3 — pure trading-day primitive. Day-key semantics delegate to
// u4faRisk.dayKeyOf so UTC boundaries match the resolve clock used elsewhere.
import { dayKeyOf as u4faDayKeyOf } from "../u4faRisk.mjs"

export function dayKeyOf(date) {
  return u4faDayKeyOf(date)
}

export function tradingDaysElapsed(dayKeys = []) {
  const seen = new Set()
  for (const key of dayKeys) if (key) seen.add(String(key))
  return seen.size
}

export function daysElapsedForClass(dayKeys = [], classCalendars = {}, className) {
  const exclusions = classCalendars?.[className]?.exclusions ?? {}
  const seen = new Set()
  for (const key of dayKeys) {
    if (!key) continue
    const k = String(key)
    if (!exclusions[k]) seen.add(k)
  }
  return seen.size
}