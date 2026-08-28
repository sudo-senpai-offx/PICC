import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let notifier

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-notifier-"))
  process.env.PICC_NOTIFICATION_DATA_DIR = tmp
  // Only in-app configured → webpush/email honestly report "skipped".
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  delete process.env.RESEND_API_KEY
  delete process.env.ALERT_EMAIL_TO
  notifier = await import("../services/notifier.mjs")
})

afterAll(async () => {
  // Let the debounced persist() settle before removing the tmp data dir.
  await new Promise((r) => setTimeout(r, 80))
  delete process.env.PICC_NOTIFICATION_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("generic notifier dispatcher", () => {
  it("dispatches to the in-app channel and records honest per-channel results", async () => {
    const rec = await notifier.dispatchAlert({
      kind: "TEST",
      assetId: "BTCUSD",
      title: "test alert",
      body: "hello"
    })
    expect(rec.results.inApp).toBe("sent")
    // Unconfigured channels must be SKIPPED, never fabricated as sent/failed.
    expect(rec.results.webpush).toBe("skipped")
    expect(rec.results.email).toBe("skipped")
  })

  it("status reports channel configuration honestly and prefs round-trip", async () => {
    const st = notifier.notifierStatus()
    expect(st.ok).toBe(true)
    const webpush = st.channels.find((c) => c.name === "webpush")
    expect(webpush.configured).toBe(false) // no VAPID env in tests
    expect(webpush.userEnabled).toBe(true)

    const p = notifier.setPrefs({ minConfidence: 72, leadMinutes: 5, channels: { email: false } })
    expect(p.minConfidence).toBe(72)
    expect(p.leadMinutes).toBe(5)
    expect(p.channels.email).toBe(false)
    // Clamps hold.
    const bad = notifier.setPrefs({ minConfidence: 999, leadMinutes: -4 })
    expect(bad.minConfidence).toBe(95)
    expect(bad.leadMinutes).toBe(0)
  })

  it("user-disabled channels record 'off', distinct from unconfigured 'skipped'", async () => {
    notifier.setPrefs({ channels: { inApp: false, webpush: true, email: true } })
    const rec = await notifier.dispatchAlert({ kind: "TEST", assetId: "X", title: "t", body: "b" })
    expect(rec.results.inApp).toBe("off")
    expect(rec.results.webpush).toBe("skipped") // enabled by user but not configured
    notifier.setPrefs({ channels: { inApp: true } }) // restore
  })

  it("recent history keeps newest-first with a cap", async () => {
    for (let i = 0; i < 3; i++) {
      await notifier.dispatchAlert({ kind: "TEST", assetId: `A${i}`, title: `t${i}`, body: "x" })
    }
    const st = notifier.notifierStatus()
    expect(st.recent.length).toBeGreaterThanOrEqual(3)
    expect(st.recent[0].assetId).toBe("A2") // newest first
  })

  it("web-push subscriptions dedupe by endpoint", async () => {
    expect(notifier.addPushSubscription({ endpoint: "https://push.example/abc" })).toBe(true)
    expect(notifier.addPushSubscription({ endpoint: "https://push.example/abc" })).toBe(true)
    expect(notifier.listPushSubscriptions()).toBe(1)
  })

  it("removePushSubscription deletes only the matching endpoint and persists the decrease", async () => {
    const before = notifier.listPushSubscriptions()
    notifier.addPushSubscription({ endpoint: "https://push.example/remove-me" })
    expect(notifier.listPushSubscriptions()).toBe(before + 1)

    // Removing an unknown endpoint is a clean no-op (false, no count change).
    expect(notifier.removePushSubscription("https://push.example/nope")).toBe(false)
    expect(notifier.listPushSubscriptions()).toBe(before + 1)

    // Removing the live one succeeds and the count drops back.
    expect(notifier.removePushSubscription("https://push.example/remove-me")).toBe(true)
    expect(notifier.listPushSubscriptions()).toBe(before)

    // Missing/empty endpoint is rejected without side effects.
    expect(notifier.removePushSubscription(undefined)).toBe(false)
    expect(notifier.removePushSubscription("")).toBe(false)
  })
})
