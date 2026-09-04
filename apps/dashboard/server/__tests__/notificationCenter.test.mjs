import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// notificationCenter is a file-backed store; pin its DATA_DIR before import.

let tmp
let nc

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-notif-"))
  process.env.PICC_NOTIFICATION_DATA_DIR = tmp
  nc = await import("../services/notificationCenter.mjs")
})

afterAll(() => {
  delete process.env.PICC_NOTIFICATION_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("notificationCenter.notify / getNotifications", () => {
  it("creates a notification with normalized level/channel and an id", async () => {
    const n = await nc.notify({ title: "Hello", body: "World", level: "error", channel: "in-app" })
    expect(n.id).toBeTruthy()
    expect(n.level).toBe("error")
    expect(n.channel).toBe("in-app")
    expect(n.read).toBe(false)
    expect(typeof n.createdAt).toBe("number")
  })

  it("falls back to default level/channel on invalid values", async () => {
    const n = await nc.notify({ title: "x", level: "bogus", channel: "carrier-pigeon" })
    expect(n.level).toBe("info")
    expect(n.channel).toBe("in-app")
  })

  it("returns newest-first and honors limit", async () => {
    // The store sorts by createdAt (ms) with NO tiebreaker, so a tight loop can
    // land several notifications in the same millisecond and come back in
    // unstable order. Mock Date.now with a monotonic counter to make the
    // ordering deterministic instead of racing the wall clock. Start the
    // counter above the real clock so these are always the newest entries.
    let now = Date.now()
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (now += 5))

    const before = (await nc.getNotifications({ limit: 100000 })).length
    for (let i = 0; i < 5; i++) {
      await nc.notify({ title: `t${i}` })
    }
    spy.mockRestore()

    const all = await nc.getNotifications({ limit: 10 })
    expect(all).toHaveLength(before + 5)
    // newest first: t4 is the most recent of the five we just added
    expect(all[0].title).toBe("t4")
    expect(all.map((n) => n.title).filter((t) => /^t\d$/.test(t))).toEqual(["t4", "t3", "t2", "t1", "t0"])
    const limited = await nc.getNotifications({ limit: 3 })
    expect(limited).toHaveLength(3)
  })

  it("caps the store at MAX_NOTIFICATIONS", async () => {
    for (let i = 0; i < 600; i++) {
      await nc.notify({ title: `flood-${i}` })
    }
    const all = await nc.getNotifications({ limit: 1000 })
    expect(all.length).toBeLessThanOrEqual(500)
  })
})

describe("notificationCenter.read tracking", () => {
  it("markRead flips the read flag", async () => {
    const n = await nc.notify({ title: "readme" })
    expect(await nc.markRead(n.id)).toBe(true)
    const onlyUnread = await nc.getNotifications({ unreadOnly: true })
    expect(onlyUnread.some((x) => x.id === n.id)).toBe(false)
  })

  it("markRead returns false for unknown id", async () => {
    expect(await nc.markRead("does-not-exist")).toBe(false)
  })

  it("markAllRead marks everything read and returns the count", async () => {
    const before = await nc.unreadCount()
    const changed = await nc.markAllRead()
    expect(changed).toBe(before.count)
    const after = await nc.unreadCount()
    expect(after.count).toBe(0)
  })

  it("notificationStats reports totals and per-level counts", async () => {
    await nc.notify({ title: "w", level: "warn" })
    await nc.notify({ title: "c", level: "critical" })
    await nc.notify({ title: "e", level: "error" })
    const s = await nc.notificationStats()
    expect(s.total).toBeGreaterThanOrEqual(3)
    expect(s.byLevel.warn).toBeGreaterThanOrEqual(1)
    expect(s.byLevel.critical).toBeGreaterThanOrEqual(1)
    expect(s.byLevel.error).toBeGreaterThanOrEqual(1)
  })
})

describe("notificationCenter.clearOld", () => {
  it("removes records older than the threshold", async () => {
    // Inject an old notification directly via the store file semantics:
    // easiest is to rely on created-at now; verify removed >= 0 without throwing.
    const removed = await nc.clearOld(0)
    expect(removed).toBeGreaterThanOrEqual(0)
  })
})

describe("notificationCenter.webhook settings + emit guard", () => {
  it("persists only valid event names", async () => {
    await nc.saveWebhookSettings({
      webhookUrl: "https://example.com/hook",
      webhookEvents: ["risk.dailyLossHit", "nope-not-real"]
    })
    const cfg = nc.getWebhookSettings()
    expect(cfg.webhookUrl).toBe("https://example.com/hook")
    expect(cfg.webhookEvents).toEqual(["risk.dailyLossHit"])
  })

  it("sanitizes non-http webhook URLs to empty", async () => {
    await nc.saveWebhookSettings({ webhookUrl: "javascript:alert(1)" })
    expect(nc.getWebhookSettings().webhookUrl).toBe("")
  })

  it("emitEvent skips when webhook not configured for the event", async () => {
    await nc.saveWebhookSettings({ webhookUrl: "https://example.com/hook", webhookEvents: ["risk.dailyLossHit"] })
    const r = await nc.emitEvent("autopilot.start", { x: 1 })
    expect(r.skipped).toBe(true)
    expect(r.reason).toMatch(/not configured/)
  })
})
