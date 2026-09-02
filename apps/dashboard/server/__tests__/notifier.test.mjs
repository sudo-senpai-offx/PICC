import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Hoisted mock state — referenced from inside the vi.mock("web-push") factory,
// so the exported sendWebPush can be driven without a real VAPID endpoint (T3).
const { webPushCalls } = vi.hoisted(() => ({ webPushCalls: [] }))
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (_sub, body) => {
      webPushCalls.push(typeof body === "string" ? JSON.parse(body) : body)
    }
  }
}))

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
    expect(notifier.listPushSubscriptions()).toBe(before)
  })

  it("convergence dispatches record honest skipped-vs-sent on unconfigured channels (8b)", async () => {
    notifier.setPrefs({ channels: { inApp: true } })
    const rec = await notifier.dispatchAlert({
      kind: "convergence",
      assetId: "EURUSD",
      title: "convergence test",
      body: "state LONG BIAS · score 4/5",
      details: { condition: "convergence_above", threshold: 3, score5: 4, state: "LONG BIAS" }
    })
    expect(rec.kind).toBe("convergence")
    expect(rec.assetId).toBe("EURUSD")
    expect(rec.results.inApp).toBe("sent")
    // Unconfigured channels must be SKIPPED, never fabricated as sent/failed.
    expect(rec.results.webpush).toBe("skipped")
    expect(rec.results.email).toBe("skipped")
  })
})

describe("webhook channel (T9)", () => {
  it("unconfigured webhook records 'skipped', never fabricated as sent/failed", async () => {
    // WEBHOOK_URL is unset in beforeAll on purpose.
    const rec = await notifier.dispatchAlert({ kind: "TEST", assetId: "WEBHOOK", title: "t", body: "b" })
    expect(rec.results.webhook).toBe("skipped")
  })

  it("configured webhook POSTs the payload and records 'sent'", async () => {
    process.env.WEBHOOK_URL = "https://hooks.example/picc"
    const calls = []
    const orig = globalThis.fetch
    // Minimal mocked fetch: assert request shape, respond with ok.
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init: JSON.parse(init.body) })
      return { ok: true }
    }
    try {
      const rec = await notifier.dispatchAlert({
        kind: "convergence",
        assetId: "EURUSD",
        title: "convergence hook",
        body: "state LONG BIAS · score 4/5"
      })
      expect(rec.results.webhook).toBe("sent")
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe("https://hooks.example/picc")
      expect(calls[0].init.kind).toBe("convergence")
      expect(calls[0].init.assetId).toBe("EURUSD")
      expect(calls[0].init.title).toBe("convergence hook")
      expect(calls[0].init.sentAt).toBeTruthy()
    } finally {
      globalThis.fetch = orig
      delete process.env.WEBHOOK_URL
    }
  })

  it("non-ok webhook response records 'failed' with the status surfaced", async () => {
    process.env.WEBHOOK_URL = "https://hooks.example/picc"
    const orig = globalThis.fetch
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" })
    try {
      const rec = await notifier.dispatchAlert({ kind: "TEST", assetId: "X", title: "t", body: "b" })
      expect(rec.results.webhook).toBe("failed")
      expect(rec.webhookError).toMatch(/500/)
    } finally {
      globalThis.fetch = orig
      delete process.env.WEBHOOK_URL
    }
  })

  it("user-disabled webhook records 'off', distinct from unconfigured 'skipped'", async () => {
    notifier.setPrefs({ channels: { webhook: false } })
    const rec = await notifier.dispatchAlert({ kind: "TEST", assetId: "X", title: "t", body: "b" })
    expect(rec.results.webhook).toBe("off")
    notifier.setPrefs({ channels: { webhook: true } }) // restore
  })
})

describe("web-push payload v2 (T3)", () => {
  beforeEach(() => {
    webPushCalls.length = 0
    process.env.VAPID_PUBLIC_KEY = "test-pub"
    process.env.VAPID_PRIVATE_KEY = "test-priv"
    notifier.addPushSubscription({ endpoint: "https://push.example/t3" })
  })

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    notifier.removePushSubscription("https://push.example/t3")
  })

  it("forwards optional payload-v2 fields to the web-push transport when provided", async () => {
    const rec = await notifier.dispatchAlert({
      kind: "PRE_TRADE",
      assetId: "EURUSD",
      title: "Entry window",
      body: "entry above 1.08 · model agreement 4/5",
      venue: { venueId: "expertoption", tradeUrl: "https://expertoption.com/trading" },
      windowText: "Window: 21:57–22:12 EET",
      actions: [
        { action: "view", title: "View" },
        { action: "snooze", title: "Snooze 10m" }
      ],
      requireInteraction: false
    })
    expect(rec.results.webpush).toBe("sent")
    // Exactly one send per active subscription — earlier tests may have left
    // other endpoints in state, so the count is subscription-driven, not fixed.
    expect(webPushCalls).toHaveLength(notifier.listPushSubscriptions())
    expect(webPushCalls.at(-1)).toMatchObject({
      title: "Entry window",
      body: "entry above 1.08 · model agreement 4/5",
      asset: "EURUSD",
      kind: "PRE_TRADE",
      venue: { venueId: "expertoption", tradeUrl: "https://expertoption.com/trading" },
      windowText: "Window: 21:57–22:12 EET",
      actions: [
        { action: "view", title: "View" },
        { action: "snooze", title: "Snooze 10m" }
      ],
      requireInteraction: false
    })
  })

  it("omits payload-v2 fields by default — body stays backward-compatible with sw.js", async () => {
    await notifier.dispatchAlert({ kind: "FOLLOW_UP", assetId: "BTCUSD", title: "t", body: "b" })
    expect(webPushCalls.length).toBeGreaterThan(0)
    const sent = webPushCalls.at(-1)
    expect(Object.keys(sent).sort()).toEqual(["asset", "body", "kind", "title"])
    expect(sent.actions).toBeUndefined()
    expect(sent.requireInteraction).toBeUndefined()
  })
})

describe("snooze ledger (T4, REQ-5)", () => {
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    notifier.removePushSubscription("https://push.example/snooze")
  })

  it("a tag is snoozeable at most once — second snooze is a no-op", async () => {
    vi.useFakeTimers()
    await notifier.dispatchAlert({ kind: "PRE_TRADE", assetId: "SNOOZE1", title: "Entry window", body: "above 1.08" })
    expect(notifier.snoozeAlert({ tag: "picc-SNOOZE1" }).ok).toBe(true)
    const again = notifier.snoozeAlert({ tag: "picc-SNOOZE1" })
    expect(again.ok).toBe(false)
    expect(again.error).toBe("already snoozed")
    // Unknown tags are a 404-grade refusal, never a fake success.
    const unknown = notifier.snoozeAlert({ tag: "picc-NOPE" })
    expect(unknown.ok).toBe(false)
    expect(unknown.error).toBe("unknown tag")
    // Consume the entry so the shared in-memory ledger is clean for later tests.
    vi.advanceTimersByTime(600_000)
    await notifier.flushSnoozes()
  })

  it("flush before due does nothing; flush at due re-dispatches through all enabled channels with the honest body line and original ts", async () => {
    vi.useFakeTimers()
    process.env.VAPID_PUBLIC_KEY = "test-pub"
    process.env.VAPID_PRIVATE_KEY = "test-priv"
    notifier.addPushSubscription({ endpoint: "https://push.example/snooze" })
    webPushCalls.length = 0

    const first = await notifier.dispatchAlert({
      kind: "PRE_TRADE",
      assetId: "SNOOZE2",
      title: "Entry window",
      body: "above 1.08",
      venue: { venueId: "expertoption", tradeUrl: "https://expertoption.com/trading" }
    })
    expect(notifier.snoozeAlert({ tag: "picc-SNOOZE2" }).ok).toBe(true)

    // Not due yet — the sweep is a no-op and nothing is re-shown.
    expect(await notifier.flushSnoozes()).toBe(0)
    expect(notifier.notifierStatus().recent[0].snoozed).toBeUndefined()

    // 10 minutes later it falls due.
    vi.advanceTimersByTime(600_000)
    expect(await notifier.flushSnoozes()).toBe(1)

    const top = notifier.notifierStatus().recent[0]
    expect(top.snoozed).toBe(true)
    expect(top.assetId).toBe("SNOOZE2")
    expect(top.ts).toBe(first.ts) // re-show carries the ORIGINAL ts, never the flush time
    const original = new Date(first.ts).toLocaleString()
    expect(top.body).toBe(`above 1.08\n⏸ Snoozed 1× — re-shown per your snooze (original ${original}).`)
    expect(top.results.inApp).toBe("sent")
    expect(top.results.webpush).toBe("sent")
    // Channels were re-driven — the web-push transport received the re-show body.
    const sent = webPushCalls.at(-1)
    expect(sent.asset).toBe("SNOOZE2")
    expect(sent.body).toContain("Snoozed 1×")
    expect(sent.venue).toEqual({ venueId: "expertoption", tradeUrl: "https://expertoption.com/trading" })
    // The re-show is never re-snoozeable: the entry is gone AND the record is
    // marked snoozed, so a stale click cannot re-queue it.
    const resnooze = notifier.snoozeAlert({ tag: "picc-SNOOZE2" })
    expect(resnooze.ok).toBe(false)
    expect(resnooze.error).toBe("unknown tag")
  })
})

describe("snooze ledger survives a server restart (T4)", () => {
  it("persists the in-flight snooze to notifications.json and a fresh module instance honors it", async () => {
    // Real timers here: we must let the debounced persist() land on disk.
    await notifier.dispatchAlert({ kind: "PRE_TRADE", assetId: "RESTART1", title: "entry", body: "restart proof" })
    expect(notifier.snoozeAlert({ tag: "picc-RESTART1" }).ok).toBe(true)
    await new Promise((r) => setTimeout(r, 80))

    const raw = JSON.parse(readFileSync(join(tmp, "notifications.json"), "utf8"))
    expect(raw.snoozes["picc-RESTART1"]).toBeTruthy()
    expect(raw.snoozes["picc-RESTART1"].dueAt).toBeGreaterThan(Date.now())
    expect(raw.snoozes["picc-RESTART1"].count).toBe(1)
    expect(raw.snoozes["picc-RESTART1"].payload.body).toBe("restart proof")

    // Simulate restart: a fresh module instance boots from the same state file.
    vi.resetModules()
    const restarted = await import("../services/notifier.mjs?restart=1")
    const again = restarted.snoozeAlert({ tag: "picc-RESTART1" })
    expect(again.ok).toBe(false) // in-flight one-shot survived the restart
    expect(again.error).toBe("already snoozed")
  })
})
