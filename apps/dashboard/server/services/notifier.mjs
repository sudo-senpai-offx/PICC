// PICC Notifier — the universal attention layer (generic by construction).
//
// One dispatcher, config-driven channels. NOTHING here is vendor-specific:
// a channel is { name, configured(), send(payload) } registered from env/config.
// Shipping channels:
//   in-app    — always on; forwards into notificationCenter (existing bell UI)
//   webpush   — Web Push (VAPID); active when VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY set
//   webhook   — generic outbound HTTP POST; active when WEBHOOK_URL set (T9)
//   telegram  — Telegram bot; active when TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID set
//               (T14, D11). Its transport lives in ./notifications/telegram.mjs.
//
// Honesty rules (T14, D11 spec :191 "Delivery failures are explicit, not
// silent"). A channel's `send` returns a DELIVERY OUTCOME, never a boolean, and
// the outcome is one of four distinguishable states computed by
// `classifyDelivery` from acknowledgement COUNTS:
//
//   off | unavailable | failed | delivered
//
// `unavailable` (nothing to send with) and `failed` (tried, nothing arrived)
// used to share the single word `skipped`, which is how a broken push service
// came to be reported as a non-event. They are separate states now, each with
// its own reason. See ./notifications/states.mjs for the state machine and for
// why a transport structurally cannot assert that it delivered.

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import {
  DELIVERY_STATES,
  classifyDelivery,
  deliveredOutcome,
  failedOutcome,
  offOutcome,
  summariseDeliveries,
  unavailableOutcome
} from "./notifications/states.mjs"
import { TELEGRAM_CHANNEL, sendTelegram, telegramConfigStatus } from "./notifications/telegram.mjs"

const DATA_DIR =
  process.env.PICC_NOTIFICATION_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const STATE_FILE = join(DATA_DIR, "notifications.json")

// ── persisted state: push subscriptions + user prefs ────────────────────────
const DEFAULT_STATE = () => ({
  prefs: {
    minConfidence: 65,
    leadMinutes: 3,
    windowMinutes: 15,
    channels: { inApp: true, webpush: true, webhook: true, telegram: true },
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
/**
 * T14 migration for persisted `recent` records. Builds before this task stored
 * each channel's result as the bare STRING `"sent" | "skipped" | "off" |
 * "failed"`, with any explanation in a sibling `${channel}Error` key. Two of
 * those four words are unambiguous and migrate cleanly. The third - `skipped` -
 * is precisely the conflation T14 removes: it was written both for "not
 * configured" and for "every send attempt threw", and the persisted record
 * cannot say which. So it migrates to `unavailable` carrying a reason that
 * NAMES that ambiguity rather than inventing a cause: downgrading a historical
 * `failed` to `unavailable` would understate a real failure, and upgrading it
 * to `failed` would invent one that was never observed.
 *
 * Applied at LOAD, not at read, so `summariseDeliveries` and `packObservers`
 * each see exactly one shape and there is no second place that has to know a
 * legacy one exists.
 */
function migrateLegacyOutcome(channel, raw, record) {
  if (raw && typeof raw === "object" && typeof raw.state === "string") return raw
  const legacyError = record?.[`${channel}Error`]
  switch (raw) {
    case "sent":
      return deliveredOutcome({ attempted: 1, acknowledged: 1 })
    case "off":
      return offOutcome()
    case "failed":
      return failedOutcome({ reason: legacyError ?? null, attempted: 1, acknowledged: 0 })
    case "skipped":
      return unavailableOutcome("legacy-record-said-skipped-which-could-mean-unconfigured-or-failed")
    default:
      return null
  }
}

function migrateRecordResults(record) {
  if (!record || typeof record !== "object") return record
  const results = record.results
  if (!results || typeof results !== "object") return record
  const migrated = {}
  for (const [channel, raw] of Object.entries(results)) {
    const outcome = migrateLegacyOutcome(channel, raw, record)
    if (outcome) migrated[channel] = outcome
  }
  // The sibling error keys are dropped on migration: the reason now lives on the
  // outcome, so the record has ONE place to read a delivery reason from.
  const cleaned = { ...record, results: migrated }
  for (const key of Object.keys(cleaned)) {
    if (/Error$/.test(key)) delete cleaned[key]
  }
  return cleaned
}

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
      recent: Array.isArray(parsed.recent) ? parsed.recent.map(migrateRecordResults) : d.recent,
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

// Wave 1.4 — read-time channel migration. Persisted files written by older
// builds may carry DEAD channel keys (e.g. `email`, from before the email
// channel was removed). getPrefs is the read path every consumer shares, so
// unknown keys are dropped HERE and the cleaned shape is persisted —
// migrated, not preserved. setPrefs keeps its semantics untouched (it still
// accepts whatever patch keys it is given); the next read cleans them.
const LIVE_CHANNELS = ["inApp", "webpush", "webhook", TELEGRAM_CHANNEL]
export function getPrefs() {
  const channels = state.prefs.channels ?? {}
  let dirty = false
  for (const key of Object.keys(channels)) {
    if (!LIVE_CHANNELS.includes(key)) {
      delete channels[key]
      dirty = true
    }
  }
  if (dirty) persist()
  return state.prefs
}
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

/**
 * T14. The ENDPOINTS, not a count. `listPushSubscriptions()` returns how many,
 * which is the number the room used to render on its own ("2 server-side") - a
 * bare count cannot say which browsers are subscribed, so an operator cannot
 * tell their own push subscription from a stale one left by a browser profile
 * they no longer use. Naming the endpoints is the same absence-vs-zero
 * discipline T10 applied elsewhere: the value is a list of strings, and an
 * absent subscription is absent from the list rather than being a zero in it.
 *
 * The endpoint is the only identifying part a Web Push subscription carries
 * that is safe to show, and it is the same value `removePushSubscription`
 * takes, so what the room displays is exactly what it can act on.
 */
export function listPushSubscriptionEndpoints() {
  return state.subscriptions.map((s) => s.endpoint).filter((e) => typeof e === "string")
}

/** Remove an existing web-push subscription by endpoint (disable flow). */
export function removePushSubscription(endpoint) {
  if (!endpoint) return false
  const before = state.subscriptions.length
  state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint)
  if (state.subscriptions.length !== before) persist()
  return before > state.subscriptions.length
}

// ── channels ────────────────────────────────────────────────────────────────
// Every `send` below returns a DELIVERY OUTCOME (./notifications/states.mjs),
// never a boolean, and every one of them is reachable with the other channels
// switched off. `configured` is the env test; the user preference is applied by
// the dispatcher, so a channel is never "off" by accident of configuration.

async function sendInApp(payload) {
  try {
    const { emitEvent } = await import("./notificationCenter.mjs")
    emitEvent("signal.alert", payload)
    return classifyDelivery({ configured: true, attempted: 1, acknowledged: 1 })
  } catch (err) {
    return classifyDelivery({
      configured: true,
      attempted: 1,
      acknowledged: 0,
      reason: `in-app: ${String(err?.message ?? err)}`.slice(0, 200)
    })
  }
}

/**
 * T14. The three ways this transport can fail to deliver are now three
 * DIFFERENT reported states, which is the whole point of the change:
 *
 *   no VAPID keys            -> unavailable ("VAPID_* unset"), nothing attempted
 *   keys but no subscribers  -> unavailable ("no-subscriptions"), nothing attempted
 *   attempted, none accepted -> FAILED, with the push service's own status
 *
 * The third is the one the previous build lost. It caught every per-subscription
 * error, kept only the 404/410 ones, and then returned `delivered > 0` - so a
 * push service answering 500 to every subscription produced `false`, which the
 * dispatcher recorded as `skipped`, which the room rendered as "not configured
 * - nothing will be sent". An outage was displayed as an absent setting. D11
 * requires the opposite (spec :191), and AC-037's "the failure is explicit"
 * (spec :1064) is what this restores.
 */
async function sendWebPush(payload) {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) {
    return classifyDelivery({
      configured: false,
      reason: !pub && !priv ? "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY unset" : !pub ? "VAPID_PUBLIC_KEY unset" : "VAPID_PRIVATE_KEY unset"
    })
  }
  if (state.subscriptions.length === 0) {
    return classifyDelivery({ configured: true, attempted: 0, reason: "no-subscriptions" })
  }
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
  const attempted = state.subscriptions.length
  let acknowledged = 0
  const dead = []
  let firstError = null
  for (const sub of state.subscriptions) {
    try {
      await webpush.sendNotification(sub, body)
      acknowledged++
    } catch (err) {
      // 404/410 mean the subscription is gone and are pruned. Everything else is
      // a REAL delivery failure and is now retained, named, and reported - it
      // used to be discarded here, which is how a total push outage became
      // indistinguishable from having no subscribers.
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(sub)
      else if (!firstError) firstError = err
    }
  }
  if (dead.length) {
    state.subscriptions = state.subscriptions.filter((s) => !dead.includes(s))
    persist()
  }
  return classifyDelivery({
    configured: true,
    // The attempt count is the count BEFORE pruning: the sends really were made,
    // and reporting the post-prune number would hide a partial outage.
    attempted,
    acknowledged,
    reason: firstError
      ? `web-push ${firstError?.statusCode ?? "error"}: ${String(firstError?.message ?? firstError)}`.slice(0, 200)
      : null
  })
}

/** T9 — generic webhook channel: POSTs the alert payload to WEBHOOK_URL. */
async function sendWebhook(payload) {
  const url = process.env.WEBHOOK_URL
  if (!url) return classifyDelivery({ configured: false, reason: "WEBHOOK_URL unset" })
  try {
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
    if (!res.ok) {
      return classifyDelivery({
        configured: true,
        attempted: 1,
        acknowledged: 0,
        reason: `webhook ${res.status}: ${(await res.text()).slice(0, 120)}`
      })
    }
    return classifyDelivery({ configured: true, attempted: 1, acknowledged: 1 })
  } catch (err) {
    return classifyDelivery({
      configured: true,
      attempted: 1,
      acknowledged: 0,
      reason: `webhook unreachable: ${String(err?.message ?? err)}`.slice(0, 200)
    })
  }
}

/**
 * The channel registry. `configured()` answers "is this transport set up on this
 * machine" and nothing else; the operator's preference is a separate input to
 * the dispatcher, which is what keeps "off" and "unavailable" from collapsing.
 */
const CHANNELS = [
  { name: "inApp", configured: () => true, send: sendInApp },
  { name: "webpush", configured: () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY), send: sendWebPush },
  { name: "webhook", configured: () => Boolean(process.env.WEBHOOK_URL), send: sendWebhook },
  // T14/D11's Telegram. Its own env, its own pref key, its own module; nothing
  // in the WebPush path can observe it and vice versa.
  { name: TELEGRAM_CHANNEL, configured: () => telegramConfigStatus().configured, send: (p) => sendTelegram(p) }
]

/**
 * Fan an alert out through every configured+enabled channel.
 *
 * T14. Each channel contributes an OUTCOME, and the record carries the derived
 * `delivery` summary alongside the per-channel outcomes. `record.delivery` is the
 * only thing a room may consult to decide whether to claim the alert arrived -
 * it is computed from acknowledgement counts, so a transport that reports
 * success while delivering nothing cannot produce `deliveredAny: true`.
 *
 * ONE MORE PROPERTY, and it is the bisect line at spec :1325: the loop catches
 * per-channel, so a transport that throws is recorded as a failure ON THAT
 * CHANNEL and the remaining transports still run. Telegram cannot take WebPush
 * down and neither can touch the trading path, which never calls into here.
 *
 * @returns record: {ts, kind, assetId, title, results:{channel: DeliveryOutcome}, delivery: Summary}
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
    const userEnabled = state.prefs.channels[ch.name] !== false
    // `off` short-circuits before configuration, so a transport the operator
    // disabled is reported as their choice and not as a missing key.
    if (!userEnabled) {
      record.results[ch.name] = offOutcome()
      continue
    }
    try {
      const outcome = await ch.send(payload)
      record.results[ch.name] = outcome && typeof outcome.state === "string" ? outcome : classifyDelivery({
        configured: ch.configured(),
        attempted: 0,
        reason: "transport-returned-no-outcome"
      })
    } catch (err) {
      // A transport that escapes its own error handling is still only ITS
      // failure. This catch is what makes the transports independent: the loop
      // continues, and the other channels are unaffected.
      record.results[ch.name] = failedOutcome({
        reason: String(err?.message ?? err).slice(0, 200),
        attempted: 0,
        acknowledged: 0
      })
      console.warn(`[picc-notifier] ${ch.name} failed:`, err?.message)
    }
  }
  // The one derived claim, recorded beside the evidence it was derived from.
  record.delivery = summariseDeliveries(record.results)
  state.recent.unshift(record)
  if (state.recent.length > 20) state.recent.length = 20
  persist()
  return record
}

/**
 * The room-facing configuration view. `configured` and `userEnabled` are two
 * SEPARATE booleans on purpose: "the server has no VAPID keys" and "the operator
 * turned push off" are different facts, and a single merged flag is what let the
 * old build show "not configured" for a channel the user had deliberately
 * disabled.
 *
 * `reason` is the missing-key NAMES (never values), so this whole object is
 * safe to serialise to the client - D11's "no secret in a client-side field".
 */
export function notifierStatus() {
  return {
    ok: true,
    prefs: state.prefs,
    subscriptions: state.subscriptions.length,
    recent: state.recent,
    snoozes: Object.keys(state.snoozes).length,
    channels: CHANNELS.map((c) => {
      const configured = c.configured()
      const channelReason =
        c.name === TELEGRAM_CHANNEL && !configured ? telegramConfigStatus().reason : null
      return {
        name: c.name,
        configured,
        userEnabled: state.prefs.channels[c.name] !== false,
        // Present only when the answer is "no", and it says WHY. Absent rather
        // than empty-string when configured, so absence keeps its meaning.
        ...(channelReason ? { reason: channelReason } : {})
      }
    })
  }
}

export { DELIVERY_STATES, summariseDeliveries }

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
