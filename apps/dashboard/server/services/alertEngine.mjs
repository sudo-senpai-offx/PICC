// Alert engine — evaluates conditions against live price data, stores in-memory, persists to JSON.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "data")
const ALERTS_FILE = join(DATA_DIR, "alerts.json")

let alerts = []
let priceCache = new Map() // symbol -> { price, prevPrice, ts }
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

export function createAlert({ userId = "default", symbol, condition, value, message = "", recurring = false, expiresAt = null }) {
  const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const alert = {
    id,
    userId,
    symbol: String(symbol).toUpperCase(),
    condition, // "price_above" | "price_below" | "price_crossing_up" | "price_crossing_down" | "pct_change_up" | "pct_change_down"
    value: Number(value),
    message: String(message || ""),
    recurring: Boolean(recurring),
    expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
    status: "armed", // armed | triggered | expired | disabled
    createdAt: Date.now(),
    triggeredAt: null,
    lastPrice: null,
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

function evaluateAlert(alert) {
  if (alert.status !== "armed") return null
  if (alert.expiresAt && Date.now() > alert.expiresAt) {
    alert.status = "expired"
    saveAlerts()
    return null
  }
  const cached = priceCache.get(alert.symbol)
  if (!cached || cached.price == null) return null
  const { price, prevPrice } = cached
  let triggered = false

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
export function startAlertEngine(intervalMs = 2000) {
  if (evalInterval) return
  evalInterval = setInterval(() => {
    for (const alert of alerts) {
      evaluateAlert(alert)
    }
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
