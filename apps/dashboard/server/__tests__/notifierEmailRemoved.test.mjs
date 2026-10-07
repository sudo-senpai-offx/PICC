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

// Hermetic: this suite asserts the webpush channel's UNCONFIGURED path
// (`unavailable` + a VAPID_* reason). Vitest inherits the developer's real
// process env, so a configured VAPID block in apps/dashboard/.env made the
// notifier report `no-subscriptions` instead and failed an otherwise-correct
// assertion. Snapshot and clear the VAPID_* keys for the duration of this file
// so the intended state is established explicitly rather than assumed.
const VAPID_KEYS = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "VAPID_EMAIL",
]
const savedVapid = new Map()
for (const k of VAPID_KEYS) {
  if (process.env[k] !== undefined) savedVapid.set(k, process.env[k])
  delete process.env[k]
}

describe("email channel removal persistence tolerance (T9 / REQ-11)", () => {
  afterAll(() => {
    for (const k of VAPID_KEYS) {
      if (savedVapid.has(k)) process.env[k] = savedVapid.get(k)
      else delete process.env[k]
    }
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

    // Status lists exactly the FOUR shipping channels — no email row.
    // T14 added `telegram` (D11's second transport), so the enumeration moves
    // from three to four. The assertion is the same exhaustive one it always
    // was: an exact set, so a fifth row or a resurrected `email` row still fails.
    const st = notifier.notifierStatus()
    expect(st.channels.map((c) => c.name).sort()).toEqual(["inApp", "telegram", "webhook", "webpush"])

    // A dispatch records no email result key and no transport is invoked
    // (sendEmail no longer exists — the row is not in CHANNELS at all).
    const rec = await notifier.dispatchAlert({ kind: "TEST", assetId: "X", title: "t", body: "b" })
    expect(rec.results.email).toBeUndefined()
    // T14: per-channel results are OUTCOME OBJECTS, not the old bare strings.
    // The assertions below therefore also pin the reason, which the string
    // vocabulary could not carry - a strengthening, not a relaxation.
    expect(rec.results.inApp.state).toBe("delivered")
    expect(rec.results.webpush.state).toBe("unavailable")
    expect(rec.results.webpush.reason).toMatch(/VAPID_/)

    // Restore the module cache for any later suite.
    vi.resetModules()
    await import("../services/notifier.mjs?restore=1")
  })
})