// Alert engine — evaluates conditions against live price data, stores in-memory, persists to JSON.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
// PICC_ALERTS_DATA_DIR lets tests redirect the store away from the
// developer's real alerts.json (same pattern as PICC_NOTIFICATION_DATA_DIR).
const DATA_DIR = process.env.PICC_ALERTS_DATA_DIR || join(__dirname, "..", "data")
const ALERTS_FILE = join(DATA_DIR, "alerts.json")

let alerts = []
let alertHistory = []
const MAX_HISTORY = 500
let priceCache = new Map() // symbol -> { price, prevPrice, ts }
// symbol -> { score5, state, confidence, ts } — fed by updateConvergence (the
// MTF convergence read), consumed by the "convergence_above" condition (8a).
let convergenceCache = new Map()
let listeners = new Set()
let evalInterval = null

function loadAlerts() {
  try {
    if (existsSync(ALERTS_FILE)) {
      alerts = JSON.parse(readFileSync(ALERTS_FILE, "utf-8"))
    }
  } catch { alerts = [] }
}

function saveAlerts() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2))
  } catch { /* ignore */ }
}

loadAlerts()

// ── Alert CRUD ───────────────────────────────────────────────────────
export function listAlerts(userId = null) {
  if (userId) return alerts.filter((a) => a.userId === userId)
  return [...alerts]
}

const ALERT_CONDITIONS = [
  "price_above", "price_below", "price_crossing_up", "price_crossing_down",
  "pct_change_up", "pct_change_down", "convergence_above"
]

/** Normalize a composed-condition entry; returns null for anything unusable. */
function normalizeCondition(c) {
  if (!c || typeof c !== "object") return null
  const condition = String(c.condition ?? "")
  if (!ALERT_CONDITIONS.includes(condition)) return null
  // Null/empty value is unusable — drop, don't coerce to a guessed number.
  if (c.value == null || c.value === "") return null
  const value = Number(c.value)
  if (!Number.isFinite(value)) return null
  const band = Array.isArray(c.band) && c.band.length ? c.band.map(String) : null
  return { condition, value, band }
}

export function createAlert({ userId = "default", symbol, condition, value, message = "", recurring = false, expiresAt = null, band = null, conditions = null, logic = "AND" }) {
  const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  // T9 — composed conditions (AND/OR over the same condition enum). When
  // present, `condition`/`value` remain the alert's headline for display and
  // backward compatibility; evaluation uses `conditions`.
  const normalized = Array.isArray(conditions) ? conditions.map(normalizeCondition).filter((c) => c) : []
  const alert = {
    id,
    userId,
    symbol: String(symbol).toUpperCase(),
    // "price_above" | "price_below" | "price_crossing_up" | "price_crossing_down" |
    // "pct_change_up" | "pct_change_down" | "convergence_above"
    condition,
    value: Number(value),
    // Optional state band for convergence_above: an array of engine states
    // (e.g. ["LONG BIAS", "SHORT BIAS"]) that also fires the alert.
    band: Array.isArray(band) && band.length ? band : null,
    // T9 — multi-condition compose: [{condition,value,band?}] + "AND" | "OR".
    conditions: normalized.length ? normalized : null,
    logic: normalized.length ? (String(logic ?? "AND").toUpperCase() === "OR" ? "OR" : "AND") : null,
    message: String(message || ""),
    recurring: Boolean(recurring),
    expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
    status: "armed", // armed | triggered | expired | disabled
    createdAt: Date.now(),
    triggeredAt: null,
    lastPrice: null,
    lastScore: null,
    prevPrice: null
  }
  alerts.push(alert)
  saveAlerts()
  return alert
}

export function deleteAlert(id) {
  const idx = alerts.findIndex((a) => a.id === id)
  if (idx === -1) return false
  alerts.splice(idx, 1)
  saveAlerts()
  return true
}

export function disableAlert(id) {
  const alert = alerts.find((a) => a.id === id)
  if (!alert) return null
  alert.status = "disabled"
  saveAlerts()
  return alert
}

export function enableAlert(id) {
  const alert = alerts.find((a) => a.id === id)
  if (!alert) return null
  alert.status = "armed"
  saveAlerts()
  return alert
}

// ── Price update + evaluation ────────────────────────────────────────
export function updatePrice(symbol, price) {
  const key = String(symbol).toUpperCase()
  const prev = priceCache.get(key)
  priceCache.set(key, {
    price: Number(price),
    prevPrice: prev?.price ?? null,
    ts: Date.now()
  })
}

export function getPrice(symbol) {
  return priceCache.get(String(symbol).toUpperCase()) ?? null
}

/**
 * Feed the latest MTF convergence read per symbol (slice 8a). Called by the
 * convergence evaluator (marketConvergence.convergenceSection); the armed
 * `convergence_above` alerts then trigger on the next evaluation pass.
 * @param {string} symbol
 * @param {{ score5: number|null, state: string|null, confidence?: number|null }} read
 */
export function updateConvergence(symbol, { score5 = null, state = null, confidence = null } = {}) {
  const key = String(symbol).toUpperCase()
  convergenceCache.set(key, {
    score5: score5 == null ? null : Number(score5),
    state: state ?? null,
    confidence: confidence == null ? null : Number(confidence),
    ts: Date.now()
  })
}

export function getConvergence(symbol) {
  return convergenceCache.get(String(symbol).toUpperCase()) ?? null
}

function crosses(prev, curr, threshold) {
  if (prev == null || curr == null) return false
  return (prev < threshold && curr >= threshold) || (prev > threshold && curr <= threshold)
}

function crossesUp(prev, curr, threshold) {
  if (prev == null || curr == null) return false
  return prev < threshold && curr >= threshold
}

function crossesDown(prev, curr, threshold) {
  if (prev == null || curr == null) return false
  return prev > threshold && curr <= threshold
}

/**
 * Evaluate ONE condition against the live caches. Absent data NEVER triggers
 * (no fabricated fires): a missing convergence read or price returns false.
 * Shared by the legacy single-condition path and the T9 composed conditions.
 */
function matchCondition(spec, symbol) {
  const condition = spec?.condition
  const value = Number(spec?.value)
  if (condition === "convergence_above") {
    const conv = convergenceCache.get(symbol)
    if (!conv || conv.score5 == null) return false
    const bandHit = Array.isArray(spec.band) && spec.band.includes(conv.state)
    return bandHit || conv.score5 >= value
  }
  const cached = priceCache.get(symbol)
  if (!cached || cached.price == null) return false
  const { price, prevPrice } = cached
  switch (condition) {
    case "price_above":
      return price > value
    case "price_below":
      return price < value
    case "price_crossing_up":
      return crossesUp(prevPrice, price, value)
    case "price_crossing_down":
      return crossesDown(prevPrice, price, value)
    case "pct_change_up":
      return !!(prevPrice && prevPrice > 0) && ((price - prevPrice) / prevPrice) * 100 >= value
    case "pct_change_down":
      return !!(prevPrice && prevPrice > 0) && ((prevPrice - price) / prevPrice) * 100 >= value
    default:
      return false
  }
}

function evaluateAlert(alert) {
  if (alert.status !== "armed") return null
  if (alert.expiresAt && Date.now() > alert.expiresAt) {
    alert.status = "expired"
    saveAlerts()
    return null
  }
  let triggered = false

  // T9 — composed conditions (AND/OR over the same enum). Absent data within a
  // condition counts as unmet, so a composed alert never fires on missing reads.
  if (alert.conditions?.length) {
    const results = alert.conditions.map((c) => matchCondition(c, alert.symbol))
    triggered = alert.logic === "OR" ? results.some(Boolean) : results.every(Boolean)
    if (triggered) {
      alert.lastPrice = priceCache.get(alert.symbol)?.price ?? null
      alert.lastScore = convergenceCache.get(alert.symbol)?.score5 ?? null
      alert.triggeredAt = Date.now()
      if (alert.recurring) {
        alert.status = "armed" // re-arm
      } else {
        alert.status = "triggered"
      }
      saveAlerts()
      const notification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        alertId: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        value: alert.value,
        conditions: alert.conditions,
        logic: alert.logic,
        price: alert.lastPrice,
        message: alert.message || `${alert.symbol} composed alert fired (${alert.logic}: ${results.map((r, i) => `${alert.conditions[i].condition}${r ? " ✓" : " ✗"}`).join(" | ")})`,
        ts: Date.now()
      }
      for (const cb of listeners) {
        try { cb(notification) } catch { /* ignore */ }
      }
      alertHistory.unshift(notification)
      if (alertHistory.length > MAX_HISTORY) alertHistory.length = MAX_HISTORY
      return notification
    }
    return null
  }

  // convergence_above: no prices involved — reads the MTF convergence cache
  // (score5 0-5 threshold and/or a configured state band).
  if (alert.condition === "convergence_above") {
    const conv = convergenceCache.get(alert.symbol)
    if (!conv || conv.score5 == null) return null // absent read never triggers
    const bandHit = Array.isArray(alert.band) && alert.band.includes(conv.state)
    triggered = bandHit || conv.score5 >= alert.value
    if (triggered) {
      alert.lastScore = conv.score5
      alert.triggeredAt = Date.now()
      if (alert.recurring) {
        alert.status = "armed" // re-arm
      } else {
        alert.status = "triggered"
      }
      saveAlerts()
      const notification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        alertId: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        value: alert.value,
        band: alert.band,
        score5: conv.score5,
        state: conv.state,
        confidence: conv.confidence ?? null,
        message: alert.message || `${alert.symbol} convergence ${conv.score5}/5 (${conv.state ?? "—"})`,
        ts: Date.now()
      }
      for (const cb of listeners) {
        try { cb(notification) } catch { /* ignore */ }
      }
      alertHistory.unshift(notification)
      if (alertHistory.length > MAX_HISTORY) alertHistory.length = MAX_HISTORY
      return notification
    }
    return null
  }

  const cached = priceCache.get(alert.symbol)
  if (!cached || cached.price == null) return null
  const { price, prevPrice } = cached

  switch (alert.condition) {
    case "price_above":
      triggered = price > alert.value
      break
    case "price_below":
      triggered = price < alert.value
      break
    case "price_crossing_up":
      triggered = crossesUp(prevPrice, price, alert.value)
      break
    case "price_crossing_down":
      triggered = crossesDown(prevPrice, price, alert.value)
      break
    case "pct_change_up": {
      if (prevPrice && prevPrice > 0) {
        const pct = ((price - prevPrice) / prevPrice) * 100
        triggered = pct >= alert.value
      }
      break
    }
    case "pct_change_down": {
      if (prevPrice && prevPrice > 0) {
        const pct = ((prevPrice - price) / prevPrice) * 100
        triggered = pct >= alert.value
      }
      break
    }
  }

  if (triggered) {
    alert.lastPrice = price
    alert.prevPrice = prevPrice
    alert.triggeredAt = Date.now()
    if (alert.recurring) {
      alert.status = "armed" // re-arm
    } else {
      alert.status = "triggered"
    }
    saveAlerts()
    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      value: alert.value,
      price,
      message: alert.message || `${alert.symbol} alert: ${alert.condition} ${alert.value}`,
      ts: Date.now()
    }
    for (const cb of listeners) {
      try { cb(notification) } catch { /* ignore */ }
    }
    alertHistory.unshift(notification)
    if (alertHistory.length > MAX_HISTORY) alertHistory.length = MAX_HISTORY
    return notification
  }
  return null
}

// ── Subscription ─────────────────────────────────────────────────────
export function onAlert(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ── Periodic evaluation ──────────────────────────────────────────────
/** Evaluate every armed alert once. Exported so tests stay timer-free. */
export function evaluateAlerts() {
  for (const alert of alerts) {
    try {
      evaluateAlert(alert)
    } catch { /* one bad alert never takes the loop down */ }
  }
}

export function startAlertEngine(intervalMs = 2000) {
  if (evalInterval) return
  evalInterval = setInterval(() => {
    evaluateAlerts()
  }, intervalMs)
  return true
}

export function stopAlertEngine() {
  if (evalInterval) {
    clearInterval(evalInterval)
    evalInterval = null
  }
}

export function alertStats() {
  const armed = alerts.filter((a) => a.status === "armed").length
  const triggered = alerts.filter((a) => a.status === "triggered").length
  const expired = alerts.filter((a) => a.status === "expired").length
  const disabled = alerts.filter((a) => a.status === "disabled").length
  return { total: alerts.length, armed, triggered, expired, disabled, symbols: [...new Set(alerts.map((a) => a.symbol))].length }
}

export function getAlertHistory({ limit = 50, symbol = null } = {}) {
  let result = alertHistory
  if (symbol) result = result.filter((n) => n.symbol === String(symbol).toUpperCase())
  return result.slice(0, limit)
}

// Load history from triggered alerts
function loadHistory() {
  for (const a of alerts) {
    if (a.status === "triggered" && a.triggeredAt) {
      alertHistory.unshift({
        id: `hist_${a.id}_${a.triggeredAt}`,
        alertId: a.id,
        symbol: a.symbol,
        condition: a.condition,
        value: a.value,
        price: a.lastPrice ?? 0,
        message: a.message || `${a.symbol} alert triggered`,
        ts: a.triggeredAt
      })
    }
  }
}
loadHistory()
