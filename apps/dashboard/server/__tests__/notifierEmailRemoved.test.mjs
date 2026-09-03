// T9 / REQ-11 — a persisted `channels.email:true` from a pre-removal state
// file is INERT: it loads, the notifier never surfaces an email row, never
// sends. Decision H: the channel row is gone from CHANNELS, so a stale key is
// simply never read — nothing to migrate, nothing to clobber.
import { afterAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tmp = mkdtempSync(join(tmpdir(), "picc-notifier-fixture-"))
const STATE_FILE = join(tmp, "notifications.json")

describe("email channel removal persistence tolerance (T9 / REQ-11)", () => {
  afterAll(() => {
    delete process.env.PICC_NOTIFICATION_DATA_DIR
    rmSync(tmp, { recursive: true, force: true })
  })

  it("a state fixture with channels.email:true boots, never renders an email row, never sends", async () => {
    // Simulate a state file written while the email channel still existed.
    writeFileSync(
      STATE_FILE,
      JSON.stringify({
        prefs: {
          minConfidence: 65,
          leadMinutes: 3,
          windowMinutes: 15,
          // webpush defaults ON since the email removal (notifier.mjs defaults);
          // a user-disabled channel would honestly record "off", not "skipped" —
          // the email-era fixture must reflect shipped defaults to assert the
          // disabled-channel semantics it actually targets.
          channels: { inApp: true, webpush: true, email: true, webhook: false }
        },
        subscriptions: [],
        recent: [],
        snoozes: {}
      })
    )
    process.env.PICC_NOTIFICATION_DATA_DIR = tmp
    vi.resetModules()
    const notifier = await import("../services/notifier.mjs?emailFixture=1")

    // The stale key survives the load (not silently dropped) but is dead.
    expect(notifier.getPrefs().channels.email).toBe(true)

    // Status lists exactly the three shipping channels — no email row.
    const st = notifier.notifierStatus()
    expect(st.channels.map((c) => c.name).sort()).toEqual(["inApp", "webhook", "webpush"])

    // A dispatch records no email result key and no transport is invoked
    // (sendEmail no longer exists — the row is not in CHANNELS at all).
    const rec = await notifier.dispatchAlert({ kind: "TEST", assetId: "X", title: "t", body: "b" })
    expect(rec.results.email).toBeUndefined()
    expect(rec.results.inApp).toBe("sent")
    expect(rec.results.webpush).toBe("skipped")

    // Restore the module cache for any later suite.
    vi.resetModules()
    await import("../services/notifier.mjs?restore=1")
  })
})