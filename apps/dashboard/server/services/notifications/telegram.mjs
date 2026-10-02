// WS-7 T14 - the TELEGRAM transport. D11's second transport.
//
// D11 (spec :184-191) requires "Telegram bot AND WebPush" with configuration in
// the general Settings room, and it forbids a secret in a client-side field.
// Both are honoured structurally here:
//
//   * The bot token and the chat id live ONLY in process env and are read only
//     inside this server module. Nothing this module returns contains either
//     value - `telegramConfigStatus()` exposes booleans and the NAME of the
//     missing key, never the key, so a masked view of the configuration is safe
//     to serialise to the client. That is the same discipline `llmSettingsView`
//     applies to the provider keys (handlers.mjs:2786).
//   * The transport is INDEPENDENT of WebPush. It reads its own two env vars,
//     has its own preference key (`channels.telegram`), and its failures are
//     recorded against its own name. Nothing in the WebPush path can fail
//     because of Telegram and vice versa - which is the bisect line at spec
//     :1325, asserted in notifications.transports.test.mjs.
//
// The send goes to Telegram's Bot API over `fetch`. A non-2xx answer is a
// FAILURE with Telegram's own `description`, never a silent skip, because
// Telegram returns 200 for a well-formed request to a chat the bot cannot
// reach only rarely - and when it does answer 4xx/5xx the operator needs the
// reason, not a shrug.

import { classifyDelivery, DELIVERY_STATES } from "./states.mjs"

const TELEGRAM_API = "https://api.telegram.org"

/** Channel name as it appears in prefs, in `results`, and in the Settings room. */
export const TELEGRAM_CHANNEL = "telegram"

/**
 * Which of the two required settings are present. Returns the NAMES of the
 * missing ones and never their values, so the reason string is safe to persist
 * in a dispatch record and safe to show in a room.
 */
export function telegramConfigStatus(env = process.env) {
  const missing = []
  if (!env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN")
  if (!env.TELEGRAM_CHAT_ID) missing.push("TELEGRAM_CHAT_ID")
  return Object.freeze({
    configured: missing.length === 0,
    /** e.g. "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset" - names, never values. */
    reason: missing.length === 0 ? null : `${missing.join(", ")} unset`
  })
}

/** Telegram's `sendMessage` takes plain text; a 4096-char cap is its own limit. */
const MAX_MESSAGE_CHARS = 4096

function messageText(payload) {
  const head = `PICC ${payload.kind} - ${payload.assetId}`
  const body = typeof payload.body === "string" ? payload.body : ""
  const composed = body ? `${head}\n${body}` : head
  return composed.length > MAX_MESSAGE_CHARS ? composed.slice(0, MAX_MESSAGE_CHARS) : composed
}

/**
 * Deliver one alert over Telegram.
 *
 * RETURNS AN OUTCOME, NOT A BOOLEAN. The counts are what `classifyDelivery`
 * turns into a state, and the counts are the only thing that can make this
 * transport look delivered - a resolved promise is an acknowledgement, a thrown
 * one is not. See states.mjs for why that indirection exists.
 *
 * `fetchImpl` is injectable so the test can drive it without a network call.
 */
export async function sendTelegram(payload, { fetchImpl = fetch } = {}) {
  const status = telegramConfigStatus()
  if (!status.configured) {
    return classifyDelivery({ configured: false, reason: status.reason })
  }

  const url = `${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`
  let body
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: messageText(payload),
        // Alerts are not to be silently dropped from the chat by a later admin
        // setting on a shared device, and PICC's advisory alerts are addressed
        // to one operator rather than a group conversation.
        disable_notification: false
      })
    })
    // A WHATWG `Response` exposes `.json()` directly. The `typeof` guard is not
    // defensive noise: it is what lets a test drive this with a plain object
    // double, and it means a response whose body cannot be parsed degrades to a
    // named failure rather than throwing past the outcome.
    body = typeof res?.json === "function" ? await res.json().catch(() => null) : null
    if (!res.ok) {
      const description = typeof body?.description === "string" ? body.description : `http ${res.status}`
      return classifyDelivery({
        configured: true,
        attempted: 1,
        acknowledged: 0,
        reason: `telegram ${res.status}: ${description}`.slice(0, 200)
      })
    }
  } catch (err) {
    // A transport that throws is a FAILURE. It is reported as one, and it never
    // takes the other transports down with it.
    return classifyDelivery({
      configured: true,
      attempted: 1,
      acknowledged: 0,
      reason: `telegram unreachable: ${String(err?.message ?? err)}`.slice(0, 200)
    })
  }

  // Telegram answers 200 for a delivered message. `ok: false` inside a 200 body
  // is still a refusal, so it is not counted as an acknowledgement.
  const acknowledged = body?.ok === true ? 1 : 0
  return classifyDelivery({
    configured: true,
    attempted: 1,
    acknowledged,
    reason: acknowledged === 0 ? "telegram accepted the request but did not confirm delivery" : null
  })
}

export { DELIVERY_STATES }
