// T8 — shared web-push core. Every outcome is an observed state; the guards
// that matter are pinned here: VAPID-503 → "unavailable" (never a fake send),
// existing subscription → reused (never double-subscribed), unsubscribe always
// round-trips the endpoint to the server (dead-sub cleanup).

import { describe, expect, it, vi } from "vitest"
import { enableWebPush, disableWebPush } from "../webPush"
import type { WebPushCtx } from "../webPush"

const VAPID_KEY = "AAEC_f7_AQI" // any base64url; only conversion is tested

function fakeCtx(over: Partial<WebPushCtx> & { existing?: boolean } = {}): WebPushCtx & { calls: { subscribe: number; postSubscribe: { endpoint: string }[]; postUnsubscribe: string[] } } {
  const calls = { subscribe: 0, postSubscribe: [] as { endpoint: string }[], postUnsubscribe: [] as string[] }
  const makeSub = (endpoint: string) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "k", auth: "a" }, expirationTime: null }) as PushSubscriptionJSON,
    unsubscribe: vi.fn(async () => true)
  })
  const ctx: WebPushCtx = {
    isPushSupported: () => true,
    requestPermission: async () => "granted",
    serviceWorkerReady: async () => ({
      pushManager: {
        subscribe: async () => {
          calls.subscribe++
          return makeSub("https://push.example/end")
        },
        getSubscription: async () => (over.existing ? makeSub("https://push.example/end") : null)
      }
    }),
    fetchVapidPublicKey: async () => VAPID_KEY,
    postSubscribe: async (sub) => {
      calls.postSubscribe.push({ endpoint: sub.endpoint ?? "" })
      return { ok: true, subscriptions: 1 }
    },
    postUnsubscribe: async (endpoint) => {
      calls.postUnsubscribe.push(endpoint)
      return { ok: true, subscriptions: 0 }
    },
    ...over
  }
  return { ...ctx, calls }
}

describe("enableWebPush", () => {
  it("enables end-to-end: permission → VAPID key → subscribe → server sync", async () => {
    const ctx = fakeCtx()
    const out = await enableWebPush(ctx)
    expect(out).toEqual({ kind: "enabled", subscriptions: 1 })
    expect(ctx.calls.subscribe).toBe(1)
    expect(ctx.calls.postSubscribe).toHaveLength(1)
    expect(ctx.calls.postSubscribe[0].endpoint).toMatch(/^https:\/\//)
  })

  it("reports unsupported browsers honestly", async () => {
    expect(await enableWebPush(fakeCtx({ isPushSupported: () => false }))).toEqual({ kind: "unsupported" })
  })

  it("never enables on a denied/blocked permission — honest per-permission message", async () => {
    const denied = await enableWebPush(fakeCtx({ requestPermission: async () => "denied" }))
    expect(denied).toEqual({ kind: "denied", permission: "denied" })
    const grantedDefault = await enableWebPush(fakeCtx({ requestPermission: async () => "default" }))
    expect(grantedDefault).toEqual({ kind: "denied", permission: "default" })
  })

  it("renders push unavailable (never a fake sent) when VAPID is unconfigured (503 → null)", async () => {
    const ctx = fakeCtx({ fetchVapidPublicKey: async () => null })
    expect(await enableWebPush(ctx)).toEqual({
      kind: "unavailable",
      reason: "Push unavailable — web-push is not configured on this server."
    })
    expect(ctx.calls.subscribe).toBe(0) // no subscribe attempted without a key
  })

  it("is idempotent: reuses an existing subscription instead of double-subscribing", async () => {
    const ctx = fakeCtx({ existing: true })
    const out = await enableWebPush(ctx)
    expect(out).toEqual({ kind: "enabled", subscriptions: 1 })
    expect(ctx.calls.subscribe).toBe(0) // never a second pushManager.subscribe
    expect(ctx.calls.postSubscribe).toHaveLength(1) // but the server copy is re-synced
  })

  it("surfaces server rejection verbatim", async () => {
    const ctx = fakeCtx({ postSubscribe: async () => ({ ok: false, subscriptions: 0 }) })
    expect(await enableWebPush(ctx)).toEqual({ kind: "error", message: "Server did not accept the subscription." })
  })
})

describe("disableWebPush", () => {
  it("unsubscribes the browser AND removes the server-side copy by endpoint", async () => {
    const ctx = fakeCtx({ existing: true })
    const out = await disableWebPush(ctx)
    expect(out).toEqual({ kind: "disabled" })
    expect(ctx.calls.postUnsubscribe).toEqual(["https://push.example/end"])
  })

  it("reports disabled when there is nothing to unsubscribe", async () => {
    const ctx = fakeCtx()
    expect(await disableWebPush(ctx)).toEqual({ kind: "disabled" })
    expect(ctx.calls.postUnsubscribe).toEqual([])
  })

  it("surfaces transport errors honestly", async () => {
    const ctx = fakeCtx({ serviceWorkerReady: async () => { throw new Error("no service worker") } })
    expect(await disableWebPush(ctx)).toEqual({ kind: "error", message: "no service worker" })
  })
})