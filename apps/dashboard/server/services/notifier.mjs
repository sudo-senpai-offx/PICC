// PICC Notifier — the universal attention layer (generic by construction).
//
// One dispatcher, config-driven channels. NOTHING here is vendor-specific:
// a channel is { name, enabled(), send(payload) } registered from env/config.
// Shipping channels:
//   in-app   — always on; forwards into notificationCenter (existing bell UI)
//   webpush  — Web Push (VAPID); active when VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY set
//   email    — Resend HTTP API; active when RESEND_API_KEY + ALERT_EMAIL_TO set
//   webhook  — generic outbound HTTP POST; active when WEBHOOK_URL set (T9)
//
// Honesty rules: send results are recorded per channel (sent/failed/skipped +
// reason). A channel that is not configured is "skipped", never "failed" — and
// never fabricated as sent.

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const DATA_DIR =
  process.env.PICC_NOTIFICATION_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const STATE_FILE = join(DATA_DIR, "notifications.json")

// ── persisted state: push subscriptions + user prefs ────────────────────────
function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch {
    return {
      prefs: {
        minConfidence: 65,
        leadMinutes: 3,
        windowMinutes: 15,
        channels: { inApp: true, webpush: true, email: true, webhook: true },
      },
      subscriptions: [], // web-push subscription objects
      recent: []         // last 20 alert records (payload + per-channel results)
    }
  }
}
let state = loadState()
let writeQueued = false

/** Serialized-ish persist (single-process writer; atomic tmp+rename like the repo pattern). */
export function persist() {
  if (writeQueued) return
  writeQueued = true
  setTimeout(() => {
    writeQueued = false
    try {
      const tmp = `${STATE_FILE}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(state, null, 2))
      renameSync(tmp, STATE_FILE)
    } catch (err) {
      console.warn("[picc-notifier] persist failed:", err.message)
    }
  }, 50)
}

export function getPrefs() { return state.prefs }
export function setPrefs(patch = {}) {
  const p = state.prefs
  if (patch.minConfidence != null) p.minConfidence = Math.min(95, Math.max(30, Number(patch.minConfidence) || 65))
  if (patch.leadMinutes != null) p.leadMinutes = Math.min(60, Math.max(0, Math.round(Number(patch.leadMinutes) ?? 3)))
  if (patch.windowMinutes != null) p.windowMinutes = Math.min(240, Math.max(1, Math.round(Number(patch.windowMinutes) ?? 15)))
  if (patch.channels && typeof patch.channels === "object") {
    // Iterate the PATCH keys: newly added channels (e.g. webhook, T9) may not
    // exist yet in state persisted before the channel shipped — toggling them
    // must still work.
    for (const k of Object.keys(patch.channels)) {
      p.channels[k] = Boolean(patch.channels[k])
    }
  }
  persist()
  return p
}

export function addPushSubscription(subscription) {
  if (!subscription?.endpoint) return false
  if (!state.subscriptions.some((s) => s.endpoint === subscription.endpoint)) {
    state.subscriptions.push(subscription)
    persist()
  }
  return true
}
export function listPushSubscriptions() { return state.subscriptions.length }

/** Remove an existing web-push subscription by endpoint (disable flow). */
export function removePushSubscription(endpoint) {
  if (!endpoint) return false
  const before = state.subscriptions.length
  state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint)
  if (state.subscriptions.length !== before) persist()
  return before > state.subscriptions.length
}

// ── channels ────────────────────────────────────────────────────────────────
async function sendInApp(payload) {
  const { emitEvent } = await import("./notificationCenter.mjs")
  emitEvent("signal.alert", payload)
  return true
}

async function sendWebPush(payload) {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv || state.subscriptions.length === 0) return false // skipped
  const webpush = (await import("web-push")).default
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:picc@localhost", pub, priv)
  // Payload v2 (REQ-3/REQ-6/REQ-7): venue/windowText/actions/requireInteraction
  // are forwarded ONLY when the caller provided them — never defaulted here, so
  // the body stays byte-compatible with the pre-v2 sw.js contract by default.
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    asset: payload.assetId,
    kind: payload.kind,
    ...(payload.venue !== undefined && { venue: payload.venue }),
    ...(payload.windowText !== undefined && { windowText: payload.windowText }),
    ...(payload.actions !== undefined && { actions: payload.actions }),
    ...(payload.requireInteraction !== undefined && { requireInteraction: payload.requireInteraction })
  })
  let delivered = 0
  const dead = []
  for (const sub of state.subscriptions) {
    try {
      await webpush.sendNotification(sub, body)
      delivered++
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(sub)
    }
  }
  if (dead.length) {
    state.subscriptions = state.subscriptions.filter((s) => !dead.includes(s))
    persist()
  }
  return delivered > 0
}

async function sendEmail(payload) {
  const key = process.env.RESEND_API_KEY
  const to = process.env.ALERT_EMAIL_TO
  if (!key || !to) return false // skipped
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM || "PICC <onboarding@resend.dev>",
      to,
      subject: `${payload.title}`,
      text: payload.body + (payload.html ? `\n\n${payload.plainDetails ?? ""}` : "")
    })
  })
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return true
}

/** T9 — generic webhook channel: POSTs the alert payload to WEBHOOK_URL. */
async function sendWebhook(payload) {
  const url = process.env.WEBHOOK_URL
  if (!url) return false // skipped
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: payload.kind,
      assetId: payload.assetId,
      title: payload.title,
      body: payload.body,
      ts: payload.ts,
      sentAt: new Date().toISOString()
    })
  })
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return true
}

const CHANNELS = [
  { name: "inApp", enabled: () => state.prefs.channels.inApp !== false, send: sendInApp },
  { name: "webpush", enabled: () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY), send: sendWebPush },
  { name: "email", enabled: () => Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO), send: sendEmail },
  { name: "webhook", enabled: () => Boolean(process.env.WEBHOOK_URL), send: sendWebhook }
]

/**
 * Fan an alert out through every configured+enabled channel.
 * @returns record: {ts, kind, assetId, title, results:{channel:"sent"|"skipped"|"failed"|"off"}}
 */
export async function dispatchAlert({ kind, assetId, title, body, details, venue, windowText, actions, requireInteraction }) {
  const payload = { kind, assetId, title, body, plainDetails: details, ts: Date.now() }
  // Payload v2: optional additive fields forwarded verbatim to the channels
  // (webpush body above; webhook intentionally keeps its own fixed shape).
  // Unprovided fields stay absent — unconfigured ≠ zero-filled.
  if (venue !== undefined) payload.venue = venue
  if (windowText !== undefined) payload.windowText = windowText
  if (actions !== undefined) payload.actions = actions
  if (requireInteraction !== undefined) payload.requireInteraction = requireInteraction
  const record = { ts: new Date().toISOString(), kind, assetId, title, results: {} }
  for (const ch of CHANNELS) {
    if (!ch.enabled()) { record.results[ch.name] = state.prefs.channels[ch.name] === false ? "off" : "skipped"; continue }
    try {
      const ok = await ch.send(payload)
      record.results[ch.name] = ok ? "sent" : "skipped"
    } catch (err) {
      record.results[ch.name] = "failed"
      record[`${ch.name}Error`] = String(err.message ?? err).slice(0, 200)
      console.warn(`[picc-notifier] ${ch.name} failed:`, err.message)
    }
  }
  state.recent.unshift(record)
  if (state.recent.length > 20) state.recent.length = 20
  persist()
  return record
}

export function notifierStatus() {
  return {
    ok: true,
    prefs: state.prefs,
    subscriptions: state.subscriptions.length,
    recent: state.recent,
    channels: CHANNELS.map((c) => ({
      name: c.name,
      configured: c.enabled(),
      userEnabled: state.prefs.channels[c.name] !== false
    }))
  }
}
