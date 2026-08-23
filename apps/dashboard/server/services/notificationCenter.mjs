import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const DATA_DIR =
  process.env.PICC_NOTIFICATION_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const STORE_FILE = join(DATA_DIR, "notification-center.json")

const MAX_NOTIFICATIONS = 500
const LEVELS = new Set(["info", "warn", "error", "critical"])
const CHANNELS = new Set(["in-app", "log", "all"])
export const WEBHOOK_EVENTS = [
  "autopilot.start",
  "autopilot.stop",
  "autopilot.kill",
  "risk.dailyLossApproached",
  "risk.dailyLossHit",
  "connector.stale",
  "connector.expired"
]
const WEBHOOK_EVENT_SET = new Set(WEBHOOK_EVENTS)

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

let store = null

async function load() {
  if (store) return store
  try {
    const raw = JSON.parse(await readFile(STORE_FILE, "utf8"))
    store = Array.isArray(raw?.notifications) ? raw : { notifications: [] }
  } catch {
    store = { notifications: [] }
  }
  if (!store.webhook || typeof store.webhook !== "object") {
    store.webhook = { webhookUrl: "", webhookEvents: [] }
  }
  return store
}

async function persist() {
  if (!store) return false
  try {
    await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8")
    return true
  } catch (err) {
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(STORE_FILE), { recursive: true })
        await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8")
        return true
      } catch (retryErr) {
        console.warn(`[picc-notifications] write failed ${STORE_FILE}:`, retryErr.message)
        return false
      }
    }
    console.warn(`[picc-notifications] write failed ${STORE_FILE}:`, err.message)
    return false
  }
}

function deliverToLog(notification) {
  const line = `[picc-notify][${notification.level}] ${notification.title}${
    notification.body ? ` — ${notification.body}` : ""
  }`
  if (notification.level === "error" || notification.level === "critical") {
    console.error(line)
  } else {
    console.log(line)
  }
}

export async function notify({
  title,
  body = "",
  level = "info",
  channel = "in-app",
  meta = null
} = {}) {
  const s = await load()
  const notification = {
    id: randomUUID(),
    title: String(title ?? ""),
    body: String(body ?? ""),
    level: LEVELS.has(level) ? level : "info",
    channel: CHANNELS.has(channel) ? channel : "in-app",
    meta: meta ?? null,
    read: false,
    createdAt: Date.now()
  }
  s.notifications.push(notification)
  if (s.notifications.length > MAX_NOTIFICATIONS) {
    s.notifications = s.notifications.slice(-MAX_NOTIFICATIONS)
  }
  await persist()
  if (channel === "log" || channel === "all") {
    deliverToLog(notification)
  }
  return notification
}

export async function getNotifications({ limit = 50, unreadOnly = false } = {}) {
  const s = await load()
  let notifications = [...s.notifications]
  if (unreadOnly) notifications = notifications.filter((n) => !n.read)
  notifications.sort((a, b) => b.createdAt - a.createdAt)
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50
  return notifications.slice(0, max)
}

export async function markRead(id) {
  const s = await load()
  const notification = s.notifications.find((n) => n.id === id)
  if (!notification) return false
  if (!notification.read) {
    notification.read = true
    await persist()
  }
  return true
}

export async function markAllRead() {
  const s = await load()
  let changed = 0
  for (const n of s.notifications) {
    if (!n.read) {
      n.read = true
      changed++
    }
  }
  if (changed) await persist()
  return changed
}

export async function clearOld(olderThanMs = 30 * 24 * 60 * 60 * 1000) {
  const s = await load()
  const cutoff = Date.now() - olderThanMs
  const before = s.notifications.length
  s.notifications = s.notifications.filter((n) => n.createdAt >= cutoff)
  const removed = before - s.notifications.length
  if (removed) await persist()
  return removed
}

export async function unreadCount() {
  const s = await load()
  return { count: s.notifications.filter((n) => !n.read).length }
}

export async function notificationStats() {
  const s = await load()
  const byLevel = { info: 0, warn: 0, error: 0, critical: 0 }
  let unread = 0
  for (const n of s.notifications) {
    if (!n.read) unread++
    if (byLevel[n.level] != null) byLevel[n.level]++
  }
  return { total: s.notifications.length, unread, byLevel }
}

// ---------------------------------------------------------------------
// Outbound webhook channel — fire-and-forget event delivery with one retry
// ---------------------------------------------------------------------

export function getWebhookSettings() {
  const cfg = store?.webhook ?? { webhookUrl: "", webhookEvents: [] }
  return {
    webhookUrl: String(cfg.webhookUrl ?? ""),
    webhookEvents: Array.isArray(cfg.webhookEvents) ? [...cfg.webhookEvents] : []
  }
}

export async function saveWebhookSettings({ webhookUrl, webhookEvents } = {}) {
  const s = await load()
  if (webhookUrl !== undefined) {
    const raw = String(webhookUrl ?? "").trim()
    s.webhook.webhookUrl = /^https?:\/\/\S+/i.test(raw) ? raw : ""
  }
  if (webhookEvents !== undefined) {
    s.webhook.webhookEvents = Array.isArray(webhookEvents)
      ? [...new Set(webhookEvents.filter((e) => WEBHOOK_EVENT_SET.has(e)))]
      : []
  }
  await persist()
  return getWebhookSettings()
}

async function postWebhook(url, payload, timeoutMs) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, Number(timeoutMs) || 10000))
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`webhook responded ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Deliver an event to the configured webhook. Fire-and-forget: the first
 * attempt runs detached and a single retry follows after retryDelayMs on
 * failure. Never throws — delivery problems are logged, not raised.
 */
export async function emitEvent(event, data = null, opts = {}) {
  const s = await load()
  const url = String(s.webhook?.webhookUrl ?? "")
  const events = Array.isArray(s.webhook?.webhookEvents) ? s.webhook.webhookEvents : []
  if (!url || !events.includes(event)) {
    return { ok: false, skipped: true, reason: "webhook not configured for this event" }
  }
  const payload = JSON.stringify({ event, timestamp: new Date().toISOString(), data })
  const timeoutMs = Number(opts.timeoutMs) || 10000
  const retryDelayMs = Number(opts.retryDelayMs) || 5000
  void (async () => {
    try {
      await postWebhook(url, payload, timeoutMs)
      return
    } catch (err) {
      console.warn(`[picc-notifications] webhook ${event} first attempt failed:`, err.message)
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, retryDelayMs)))
    try {
      await postWebhook(url, payload, timeoutMs)
    } catch (err) {
      console.warn(`[picc-notifications] webhook ${event} delivery failed after retry:`, err.message)
    }
  })()
  return { ok: true, queued: true, event }
}
