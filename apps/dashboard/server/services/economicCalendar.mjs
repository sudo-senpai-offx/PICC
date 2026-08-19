// Economic calendar — fetches upcoming economic events from free sources.
// Uses FRED + manual fallback. No API key required for basic data.

const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
let cache = { at: 0, events: [] }

// Hardcoded upcoming major events (updated periodically)
const STATIC_EVENTS = [
  { date: "2026-01-29", time: "14:00", currency: "USD", event: "FOMC Interest Rate Decision", impact: "high", forecast: "4.50%", previous: "4.50%" },
  { date: "2026-01-30", time: "08:30", currency: "USD", event: "GDP (QoQ)", impact: "high", forecast: "2.8%", previous: "2.6%" },
  { date: "2026-02-07", time: "08:30", currency: "USD", event: "Non-Farm Payrolls", impact: "high", forecast: "180K", previous: "256K" },
  { date: "2026-02-12", time: "08:30", currency: "USD", event: "CPI (YoY)", impact: "high", forecast: "2.9%", previous: "2.9%" },
  { date: "2026-02-19", time: "14:00", currency: "USD", event: "FOMC Meeting Minutes", impact: "medium", forecast: "", previous: "" },
  { date: "2026-03-07", time: "08:30", currency: "USD", event: "Non-Farm Payrolls", impact: "high", forecast: "190K", previous: "143K" },
  { date: "2026-03-11", time: "08:30", currency: "USD", event: "CPI (YoY)", impact: "high", forecast: "2.8%", previous: "2.9%" },
  { date: "2026-03-18", time: "14:00", currency: "USD", event: "FOMC Interest Rate Decision", impact: "high", forecast: "4.50%", previous: "4.50%" },
  { date: "2026-04-04", time: "08:30", currency: "USD", event: "Non-Farm Payrolls", impact: "high", forecast: "175K", previous: "151K" },
  { date: "2026-04-10", time: "08:30", currency: "USD", event: "CPI (YoY)", impact: "high", forecast: "2.8%", previous: "2.8%" },
  { date: "2026-01-29", time: "04:30", currency: "EUR", event: "ECB Interest Rate Decision", impact: "high", forecast: "2.65%", previous: "2.65%" },
  { date: "2026-01-30", time: "07:00", currency: "EUR", event: "GDP (QoQ)", impact: "high", forecast: "0.2%", previous: "0.4%" },
  { date: "2026-02-06", time: "07:45", currency: "EUR", event: "ECB Rate Decision", impact: "high", forecast: "2.65%", previous: "2.65%" },
  { date: "2026-01-29", time: "07:00", currency: "GBP", event: "BOE Interest Rate Decision", impact: "high", forecast: "4.50%", previous: "4.75%" },
  { date: "2026-02-14", time: "19:00", currency: "JPY", event: "BOJ Interest Rate Decision", impact: "high", forecast: "0.50%", previous: "0.25%" },
  { date: "2026-01-28", time: "21:30", currency: "AUD", event: "CPI (YoY)", impact: "high", forecast: "2.3%", previous: "2.1%" },
  { date: "2026-02-05", time: "00:30", currency: "AUD", event: "RBA Interest Rate Decision", impact: "high", forecast: "4.10%", previous: "4.35%" },
]

// Try fetching from Financial Modeling Prep (free tier)
async function fetchFMPEvents() {
  try {
    const res = await fetch("https://financialmodelingprep.com/api/v3/economic_calendar?from=2026-01-01&to=2026-12-31&apikey=demo", {
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.slice(0, 50).map((e) => ({
      date: e.date?.slice(0, 10) ?? "",
      time: e.time ?? "",
      currency: e.country === "United States" ? "USD" : e.country === "Euro Zone" ? "EUR" : e.currency ?? "",
      event: e.event ?? "",
      impact: e.impact?.toLowerCase() === "high" ? "high" : e.impact?.toLowerCase() === "medium" ? "medium" : "low",
      forecast: e.forecast != null ? String(e.forecast) : "",
      previous: e.previous != null ? String(e.previous) : "",
      actual: e.actual != null ? String(e.actual) : ""
    }))
  } catch { return [] }
}

export async function getEconomicEvents({ days = 7, currency = null } = {}) {
  const now = Date.now()
  if (now - cache.at < CACHE_TTL && cache.events.length) {
    let events = cache.events
    if (currency) events = events.filter((e) => e.currency === currency.toUpperCase())
    return events
  }

  let events = await fetchFMPEvents()
  if (!events.length) events = [...STATIC_EVENTS]

  // Filter to upcoming events within `days`
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + days)
  const startStr = new Date().toISOString().slice(0, 10)
  const endStr = cutoff.toISOString().slice(0, 10)
  events = events.filter((e) => e.date >= startStr && e.date <= endStr)

  // Sort by date/time
  events.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))

  cache = { at: now, events }
  if (currency) events = events.filter((e) => e.currency === currency.toUpperCase())
  return events
}

export function getImpactSummary(events) {
  const high = events.filter((e) => e.impact === "high").length
  const medium = events.filter((e) => e.impact === "medium").length
  const low = events.filter((e) => e.impact === "low").length
  const currencies = [...new Set(events.map((e) => e.currency))]
  const nextHigh = events.find((e) => e.impact === "high")
  return { total: events.length, high, medium, low, currencies, nextHigh }
}
