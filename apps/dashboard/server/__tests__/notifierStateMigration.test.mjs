// Regression: loadState() must MIGRATE persisted state written by an older
// notifier build. A notifications.json that predates the T4 snooze ledger
// (no `snoozes` key) or uses a legacy channels shape must still load — the
// scheduler's pack-observation job calls notifierStatus() every 60s, and an
// un-migrated file crashed it with "Cannot convert undefined or null to
// object" (Object.keys(state.snoozes) on undefined).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let notifier

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-notifier-migration-"))
  process.env.PICC_NOTIFICATION_DATA_DIR = tmp
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  writeFileSync(
    join(tmp, "notifications.json"),
    JSON.stringify({
      prefs: {
        minConfidence: 80,
        leadMinutes: 4,
        windowMinutes: 20,
        // legacy channel shape: `email`, no `webhook`
        channels: { inApp: true, webpush: true, email: true }
      },
      subscriptions: [],
      recent: [] // no `snoozes` key — pre-T4 persisted shape
    })
  )
  vi.resetModules()
  notifier = await import("../services/notifier.mjs?migration=1")
})

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 80))
  delete process.env.PICC_NOTIFICATION_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("notifier loadState migration (pre-T4 persisted shape)", () => {
  it("notifierStatus survives a file with no snoozes key and reports 0", () => {
    expect(() => notifier.notifierStatus()).not.toThrow()
    expect(notifier.notifierStatus().snoozes).toBe(0)
  })

  it("preserves the user's persisted prefs while merging missing channel defaults", () => {
    const st = notifier.notifierStatus()
    expect(st.prefs.minConfidence).toBe(80) // persisted value kept
    expect(st.prefs.leadMinutes).toBe(4)
    // legacy `email` key is preserved (historical fact), webhook default merged
    expect(st.prefs.channels.email).toBe(true)
    // shipping channels all present with honest userEnabled
    const webhook = st.channels.find((c) => c.name === "webhook")
    expect(webhook.name).toBe("webhook")
    expect(webhook.configured).toBe(false) // no WEBHOOK_URL env
    expect(webhook.userEnabled).toBe(true) // not disabled by the user
  })

  it("snoozeAlert works on migrated state (mutation path does not crash)", async () => {
    const rec = await notifier.dispatchAlert({
      kind: "TEST",
      assetId: "BTCUSD",
      title: "migrated",
      body: "still works"
    })
    expect(rec.results.inApp).toBe("sent")
    const snoozed = notifier.snoozeAlert({ tag: "picc-BTCUSD" })
    expect(snoozed.ok).toBe(true)
    expect(notifier.notifierStatus().snoozes).toBe(1)
  })
})