// PICC Notifier — the universal attention layer (generic by construction).
//
// One dispatcher, config-driven channels. NOTHING here is vendor-specific:
// a channel is { name, enabled(), send(payload) } registered from env/config.
// Shipping channels:
//   in-app   — always on; forwards into notificationCenter (existing bell UI)
//   webpush  — Web Push (VAPID); active when VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY set
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
const DEFAULT_STATE = () => ({
  prefs: {
    minConfidence: 65,
    leadMinutes: 3,
    windowMinutes: 15,
    channels: { inApp: true, webpush: true, webhook: true },
  },
  subscriptions: [], // web-push subscription objects
  recent: [],        // last 20 alert records (payload + per-channel results)
  snoozes: {}        // T4: { [tag]: { dueAt, count, ts, payload } } — one-shot in-flight snoozes
})

// Migration: persisted files written by OLDER builds may lack newer keys (the
// T4 snooze ledger, for one) or use legacy channel names (email). Never clobber
// the user's persisted prefs — merge the defaults UNDER them and normalize the
// top-level collections so every consumer (notifierStatus, snoozeAlert,
// flushSnoozes) sees the shape it expects. Without this, the scheduler's
// pack-observation job crashed notifierStatus() with "Cannot convert undefined
// or null to object" (Object.keys(state.snoozes) on a missing key).
function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"))
    const d = DEFAULT_STATE()
    return {
      prefs: {
        ...d.prefs,
        ...(parsed.prefs ?? {}),
        channels: { ...d.prefs.channels, ...(parsed.prefs?.channels ?? {}) }
      },
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : d.subscriptions,
      recent: Array.isArray(parsed.recent) ? parsed.recent : d.recent,
      snoozes: parsed.snoozes && typeof parsed.snoozes === "object" && !Array.isArray(parsed.snoozes)
        ? parsed.snoozes
        : d.snoozes
    }
  } catch {
    return DEFAULT_STATE()
  }
}
let state = loadState()
let persistTimer = null

/**
 * Debounced atomic persist (tmp+rename, single-process writer). Each call
 * RE-ARMS the 50ms timer — no boolean flag, so a pending write can never wedge
 * (e.g. a debounce queued under fake timers and then discarded by
 * vi.useRealTimers() would otherwise poison every later persist).
 */
export function persist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
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
  { name: "webhook", enabled: () => Boolean(process.env.WEBHOOK_URL), send: sendWebhook }
]

/**
 * Fan an alert out through every configured+enabled channel.
 * @returns record: {ts, kind, assetId, title, results:{channel:"sent"|"skipped"|"failed"|"off"}}
 */
export async function dispatchAlert({ kind, assetId, title, body, details, ts, venue, windowText, actions, requireInteraction, snoozed }) {
  // ts is present-when-provided (T4 re-shows carry the ORIGINAL alert time, REQ-5);
  // fresh alerts default to now. Same pattern as the payload-v2 fields: never
  // fabricated, never defaulted for the caller.
  const now = ts ?? Date.now()
  const payload = { kind, assetId, title, body, plainDetails: details, ts: now }
  // Payload v2: optional additive fields forwarded verbatim to the channels
  // (webpush body above; webhook intentionally keeps its own fixed shape).
  // Unprovided fields stay absent — unconfigured ≠ zero-filled.
  if (venue !== undefined) payload.venue = venue
  if (windowText !== undefined) payload.windowText = windowText
  if (actions !== undefined) payload.actions = actions
  if (requireInteraction !== undefined) payload.requireInteraction = requireInteraction
  // The record is the ledger's evidence source for snooze re-shows (T4), so it
  // keeps the full snapshot: body + details + venue/windowText when carried,
  // plus a snoozed:true marker on re-shows. actions/requireInteraction are NOT
  // recorded — a re-show is never re-snoozeable (REQ-5) and offers no buttons.
  const record = { ts: new Date(now).toISOString(), kind, assetId, title, body, plainDetails: details, results: {} }
  if (snoozed) record.snoozed = true
  if (venue !== undefined) record.venue = venue
  if (windowText !== undefined) record.windowText = windowText
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
    snoozes: Object.keys(state.snoozes).length,
    channels: CHANNELS.map((c) => ({
      name: c.name,
      configured: c.enabled(),
      userEnabled: state.prefs.channels[c.name] !== false
    }))
  }
}

// ── snooze ledger (T4, REQ-5) ────────────────────────────────────────────────
// A notifier-owned persisted ledger, NOT an alertEngine primitive (Decision C):
// alertEngine has no delay/snooze schedule, and the notifier is the only module
// with persisted state. A tag is snoozeable at most once; the re-show is never
// re-snoozeable. No fresh signal evaluation — the re-show replays the stored
// evidence with its original ts.
export function snoozeAlert({ tag } = {}) {
  if (!tag) return { ok: false, error: "tag required" }
  const assetId = tag.startsWith("picc-") ? tag.slice("picc-".length) : tag
  // One-shot: an in-flight entry blocks a second snooze of the same tag.
  if (state.snoozes[tag]) return { ok: false, error: "already snoozed" }
  const record = state.recent.find((r) => r.assetId === assetId)
  // Unknown tag → never a fake success. A re-shown alert (snoozed:true) is not
  // snoozeable even once its ledger entry has been deleted at flush time, and a
  // record without its body snapshot cannot be faithfully re-shown.
  if (!record || record.snoozed || typeof record.body !== "string") return { ok: false, error: "unknown tag" }
  const originalTs = Date.parse(record.ts) || Date.now()
  state.snoozes[tag] = {
    dueAt: Date.now() + 600_000, // fixed 10 minutes (REQ-5); no custom durations
    count: 1,
    ts: originalTs,              // the ORIGINAL alert time, never the snooze time
    payload: {
      kind: record.kind,
      assetId: record.assetId,
      title: record.title,
      body: record.body,
      details: record.plainDetails,
      ...(record.venue !== undefined && { venue: record.venue }),
      ...(record.windowText !== undefined && { windowText: record.windowText })
    }
  }
  persist()
  return { ok: true }
}

/**
 * Re-dispatch every due snooze once. The ledger entry is deleted AFTER the
 * dispatch resolves so a concurrent snooze POST during the flush still hits
 * "already snoozed"; after deletion the snoozed:true record blocks re-queues.
 * @returns number of snoozes flushed (0 = nothing due).
 */
export async function flushSnoozes() {
  const now = Date.now()
  const due = Object.entries(state.snoozes).filter(([, e]) => e.dueAt <= now)
  if (due.length === 0) return 0
  for (const [tag, entry] of due) {
    try {
      const p = entry.payload
      const original = new Date(entry.ts).toLocaleString()
      await dispatchAlert({
        kind: p.kind,
        assetId: p.assetId,
        title: p.title,
        body: `${p.body ?? ""}\n⏸ Snoozed ${entry.count}× — re-shown per your snooze (original ${original}).`.trim(),
        details: p.details,
        ...(p.venue !== undefined && { venue: p.venue }),
        ...(p.windowText !== undefined && { windowText: p.windowText }),
        ts: entry.ts,
        snoozed: true
      })
    } finally {
      delete state.snoozes[tag] // one-shot: re-shown at most once (REQ-5)
    }
  }
  persist()
  return due.length
}

let snoozeTimer = null

/** Start the 30s flush sweep; mirrors startSignalEngine()'s timer+kill-switch shape. */
export function startSnoozeFlusher(intervalMs = 30_000) {
  if (snoozeTimer) return
  if (process.env.PICC_SNOOZE_FLUSHER === "0") {
    console.log("[picc-notifier] snooze flusher disabled via PICC_SNOOZE_FLUSHER=0")
    return
  }
  snoozeTimer = setInterval(() => {
    flushSnoozes().catch((err) => console.warn("[picc-notifier] snooze flush error:", err.message))
  }, intervalMs)
  if (snoozeTimer.unref) snoozeTimer.unref()
}

export function stopSnoozeFlusher() {
  if (snoozeTimer) clearInterval(snoozeTimer)
  snoozeTimer = null
}
