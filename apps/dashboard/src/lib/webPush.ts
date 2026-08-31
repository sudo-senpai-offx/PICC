// T8 — ONE shared web-push subscription flow (enabled/disabled/unavailable),
// extracted from the suite card (TradingSuite) + bell (NotificationCenter) into
// a single injectable core so the honesty rules are unit-testable without
// browser globals. Every outcome is an observed state:
//   - unsupported     → this browser has no PushManager
//   - denied          → permission not granted (honest per-permission message)
//   - unavailable     → VAPID not configured on the server (503) — NEVER a fake "sent"
//   - enabled         → subscription synced with the server
//   - error           → transport/engine failure surfaced verbatim
// Idempotent guard: an existing PushSubscription is reused, never re-subscribed.

import { urlBase64ToUint8Array } from "@/lib/push"

export type WebPushOutcome =
  | { kind: "unsupported" }
  | { kind: "denied"; permission: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "enabled"; subscriptions: number }
  | { kind: "disabled" }
  | { kind: "error"; message: string }

/** Browser-shaped primitives injected by the host hook (or a test fake). */
export interface WebPushCtx {
  isPushSupported(): boolean
  requestPermission(): Promise<string>
  /** Resolves the ServiceWorkerRegistration (navigator.serviceWorker.ready). */
  serviceWorkerReady(): Promise<{
    pushManager: {
      subscribe(opts: { userVisibleOnly: true; applicationServerKey: BufferSource }): Promise<{ toJSON(): PushSubscriptionJSON }>
      getSubscription(): Promise<{ toJSON(): PushSubscriptionJSON; endpoint: string; unsubscribe(): Promise<boolean> } | null>
    }
  }>
  /** VAPID public key; null means the server says web-push is not configured (503). */
  fetchVapidPublicKey(): Promise<string | null>
  postSubscribe(sub: PushSubscriptionJSON): Promise<{ ok: boolean; subscriptions: number }>
  postUnsubscribe(endpoint: string): Promise<{ ok: boolean; subscriptions: number }>
}

/** Narrower injectable surface for disabling (no permission/VAPID needed). */
export interface WebPushDisableCtx {
  isPushSupported(): boolean
  serviceWorkerReady(): Promise<{
    pushManager: {
      getSubscription(): Promise<{ toJSON(): PushSubscriptionJSON; endpoint: string; unsubscribe(): Promise<boolean> } | null>
    }
  }>
  postUnsubscribe(endpoint: string): Promise<{ ok: boolean; subscriptions: number }>
}

export async function enableWebPush(ctx: WebPushCtx): Promise<WebPushOutcome> {
  if (!ctx.isPushSupported()) return { kind: "unsupported" }
  let permission: string
  try {
    permission = await ctx.requestPermission()
  } catch (e) {
    return { kind: "error", message: (e as Error).message }
  }
  if (permission !== "granted") {
    return { kind: "denied", permission } // honest per-permission message, never "enabled"
  }
  let reg: Awaited<ReturnType<WebPushCtx["serviceWorkerReady"]>>
  try {
    reg = await ctx.serviceWorkerReady()
  } catch (e) {
    return { kind: "error", message: (e as Error).message }
  }
  const publicKey = await ctx.fetchVapidPublicKey()
  if (!publicKey) {
    // Unconfigured VAPID → 503 → honest "unavailable", not a fabricated send.
    return { kind: "unavailable", reason: "Push unavailable — web-push is not configured on this server." }
  }
  try {
    // Idempotent guard: never double-subscribe this browser.
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      const res = await ctx.postSubscribe(existing.toJSON())
      return res.ok ? { kind: "enabled", subscriptions: res.subscriptions } : { kind: "error", message: "Server did not accept the subscription." }
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    })
    const res = await ctx.postSubscribe(sub.toJSON())
    return res.ok ? { kind: "enabled", subscriptions: res.subscriptions } : { kind: "error", message: "Server did not accept the subscription." }
  } catch (e) {
    return { kind: "error", message: (e as Error).message }
  }
}

export async function disableWebPush(ctx: WebPushDisableCtx): Promise<WebPushOutcome> {
  if (!ctx.isPushSupported()) return { kind: "unsupported" }
  try {
    const reg = await ctx.serviceWorkerReady()
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return { kind: "disabled" }
    let unsubscribed = true
    try {
      unsubscribed = await sub.unsubscribe()
    } catch {
      // Even if the browser-side unsubscribe threw, remove the server-side copy
      // (dead-sub cleanup precedent) — then report the real state below.
    }
    const endpoint = sub.endpoint
    const res = await ctx.postUnsubscribe(endpoint)
    return res.ok ? { kind: "disabled" } : { kind: "error", message: !unsubscribed ? "Browser unsubscribe failed." : "Server did not clear the subscription." }
  } catch (e) {
    return { kind: "error", message: (e as Error).message }
  }
}