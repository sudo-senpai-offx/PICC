// Economic calendar — fetches this week's economic events from the free
// ForexFactory mirror (faireconomy). No API key required. Falls back to a
// generic recurring schedule if the feed is unreachable.

const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
let cache = { at: 0, events: [] }

function normalizeImpact(raw) {
  const v = String(raw ?? "").toLowerCase()
  if (v === "high") return "high"
  if (v === "medium") return "medium"
  return "low"
}

function parseFeedEvent(e) {
  if (!e || typeof e !== "object") return null
  const title = String(e.title ?? e.event ?? "").trim()
  if (!title) return null
  const when = new Date(e.date ?? "")
  if (Number.isNaN(when.getTime())) return null
  const pad = (n) => String(n).padStart(2, "0")
  return {
    date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
    currency: String(e.country ?? e.currency ?? "").toUpperCase(),
    impact: normalizeImpact(e.impact),
    event: title,
    actual: e.actual != null ? String(e.actual) : "",
    forecast: e.forecast != null ? String(e.forecast) : "",
    previous: e.previous != null ? String(e.previous) : ""
  }
}

async function fetchFaireconomyEvents() {
  try {
    const res = await fetch(CALENDAR_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.map(parseFeedEvent).filter(Boolean)
  } catch {
    return []
  }
}

// Generic recurring schedule relative to today — used only when the live
// feed is unavailable. Deliberately not tied to specific calendar dates.
function staticFallbackEvents() {
  const now = new Date()
  const mk = (offsetDays, time, currency, event, impact) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offsetDays)
    return {
      date: d.toISOString().slice(0, 10),
      time,
      currency,
      impact,
      event,
      actual: "",
      forecast: "",
      previous: ""
    }
  }
  return [
    mk(1, "08:30", "USD", "Initial Jobless Claims", "medium"),
    mk(2, "08:30", "USD", "CPI (YoY)", "high"),
    mk(3, "14:00", "USD", "FOMC Interest Rate Decision", "high"),
    mk(3, "21:30", "AUD", "RBA Interest Rate Decision", "high"),
    mk(4, "08:30", "USD", "Non-Farm Payrolls", "high"),
    mk(4, "07:45", "EUR", "ECB Interest Rate Decision", "high"),
    mk(5, "07:00", "GBP", "BOE Interest Rate Decision", "high"),
    mk(6, "19:00", "JPY", "BOJ Interest Rate Decision", "high"),
    mk(7, "08:30", "USD", "Retail Sales (MoM)", "medium"),
    mk(8, "08:30", "USD", "PPI (YoY)", "medium")
  ]
}

function withinWindow(events, days) {
  const startStr = new Date().toISOString().slice(0, 10)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + days)
  const endStr = cutoff.toISOString().slice(0, 10)
  return events
    .filter((e) => e.date >= startStr && e.date <= endStr)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
}

export async function getEconomicCalendar({ days = 7, currency = null } = {}) {
  const now = Date.now()
  if (now - cache.at < CACHE_TTL && cache.events.length) {
    let events = withinWindow(cache.events, days)
    if (currency) events = events.filter((e) => e.currency === currency.toUpperCase())
    return events
  }

  let events = await fetchFaireconomyEvents()
  if (!events.length) events = staticFallbackEvents()

  cache = { at: now, events }

  let result = withinWindow(events, days)
  if (currency) result = result.filter((e) => e.currency === currency.toUpperCase())
  return result
}

export function calendarImpactSummary(events) {
  const high = events.filter((e) => e.impact === "high").length
  const medium = events.filter((e) => e.impact === "medium").length
  const low = events.filter((e) => e.impact === "low").length
  const currencies = [...new Set(events.map((e) => e.currency))]
  const nextHigh = events.find((e) => e.impact === "high")
  return { total: events.length, high, medium, low, currencies, nextHigh }
}

export function upcomingHighImpact(events, { days = 7 } = {}) {
  return withinWindow(events.filter((e) => e.impact === "high"), days)
}

// Back-compat aliases used by handlers.mjs
export const getEconomicEvents = getEconomicCalendar
export const getImpactSummary = calendarImpactSummary
