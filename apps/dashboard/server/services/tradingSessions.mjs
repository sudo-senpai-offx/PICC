// Trading session detection and session-aware preferences.

// Session times in UTC hours (24h format)
const SESSIONS = {
  asian: {
    name: "Asian",
    open: 0,   // 00:00 UTC (Tokyo open)
    close: 9,  // 09:00 UTC (Tokyo close / overlap start)
    color: "#f59e0b",
    preferredAssets: ["USDJPY", "AUDJPY", "NZDJPY", "AUDUSD", "NZDUSD"],
    volatilityFilter: "low", // Asian session typically lower volatility
    description: "Tokyo/Sydney session — best for JPY and AUD pairs, lower volatility"
  },
  london: {
    name: "London",
    open: 7,   // 07:00 UTC (London open)
    close: 16, // 16:00 UTC (London close)
    color: "#6c63ff",
    preferredAssets: ["EURUSD", "GBPUSD", "EURGBP", "GOLD", "EURJPY", "GBPJPY"],
    volatilityFilter: "high", // London open has highest volatility
    description: "London session — highest liquidity, best for EUR/GBP pairs and Gold"
  },
  newyork: {
    name: "New York",
    open: 13,  // 13:00 UTC (NY open, overlaps with London)
    close: 22, // 22:00 UTC (NY close)
    color: "#4ade80",
    preferredAssets: ["EURUSD", "GBPUSD", "USDJPY", "USDCAD", "GOLD", "BTCUSD", "AAPL", "TSLA"],
    volatilityFilter: "high",
    description: "New York session — overlaps with London for max liquidity, USD pairs best"
  }
}

// Overlap periods (highest liquidity)
const OVERLAPS = [
  { name: "London-NY Overlap", start: 13, end: 16, color: "#ec4899", volatility: "highest", description: "Most liquid 3 hours of the trading day" },
  { name: "Asian-London Overlap", start: 7, end: 9, color: "#06b6d4", volatility: "medium", description: "Transition period with building liquidity" }
]

function utcHour(date = new Date()) {
  return date.getUTCHours() + date.getUTCMinutes() / 60
}

export function getCurrentSession(now = new Date()) {
  const hour = utcHour(now)
  const activeSessions = []
  const activeOverlaps = []

  for (const [key, session] of Object.entries(SESSIONS)) {
    if (session.open <= session.close) {
      if (hour >= session.open && hour < session.close) {
        activeSessions.push({ id: key, ...session, hoursRemaining: Math.round((session.close - hour) * 10) / 10 })
      }
    } else {
      // Wraps around midnight
      if (hour >= session.open || hour < session.close) {
        activeSessions.push({ id: key, ...session, hoursRemaining: Math.round((session.close - hour + 24) % 24 * 10) / 10 })
      }
    }
  }

  for (const overlap of OVERLAPS) {
    if (hour >= overlap.start && hour < overlap.end) {
      activeOverlaps.push({ ...overlap, hoursRemaining: Math.round((overlap.end - hour) * 10) / 10 })
    }
  }

  // Determine next session
  const allSessionStarts = Object.entries(SESSIONS).map(([id, s]) => ({
    id, ...s, hoursUntil: s.open > hour ? s.open - hour : s.open + 24 - hour
  })).sort((a, b) => a.hoursUntil - b.hoursUntil)

  const nextSession = allSessionStarts[0]

  return {
    utcHour: Math.round(hour * 10) / 10,
    activeSessions,
    activeOverlaps,
    nextSession: { ...nextSession, hoursUntil: Math.round(nextSession.hoursUntil * 10) / 10 },
    isHighVolatility: activeOverlaps.length > 0 || activeSessions.some((s) => s.volatilityFilter === "high"),
    preferredAssets: [...new Set(activeSessions.flatMap((s) => s.preferredAssets))],
    description: activeOverlaps.length > 0
      ? activeOverlaps[0].description
      : activeSessions.length > 0
        ? activeSessions[0].description
        : "Off-hours — low liquidity, wider spreads expected"
  }
}

export function getSessionSchedule() {
  const now = new Date()
  const hour = utcHour(now)
  const schedule = []

  for (const [key, session] of Object.entries(SESSIONS)) {
    const isActive = hour >= session.open && hour < session.close
    const hoursUntilOpen = session.open > hour ? session.open - hour : session.open + 24 - hour
    schedule.push({
      id: key,
      ...session,
      isActive,
      hoursUntilOpen: Math.round(hoursUntilOpen * 10) / 10,
      hoursUntilClose: isActive ? Math.round((session.close - hour) * 10) / 10 : null
    })
  }

  return {
    schedule,
    overlaps: OVERLAPS,
    currentTimeUTC: now.toISOString(),
    utcHour: Math.round(hour * 10) / 10
  }
}

export function getSessionForAsset(symbol) {
  const sym = String(symbol).toUpperCase()
  const session = getCurrentSession()

  // Find which sessions prefer this asset
  const matchingSessions = Object.entries(SESSIONS)
    .filter(([_, s]) => s.preferredAssets.includes(sym))
    .map(([id, s]) => ({ id, name: s.name, color: s.color }))

  const isPreferredNow = session.preferredAssets.includes(sym)

  return {
    symbol: sym,
    preferredSessions: matchingSessions,
    isPreferredNow,
    currentSession: session.activeSessions.map((s) => s.name),
    recommendation: isPreferredNow ? "optimal" : session.activeSessions.length > 0 ? "suboptimal" : "off_hours"
  }
}
