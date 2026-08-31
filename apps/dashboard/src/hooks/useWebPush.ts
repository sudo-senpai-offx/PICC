import { useCallback, useState } from "react"
import { enableWebPush, disableWebPush } from "@/lib/webPush"
import type { WebPushOutcome } from "@/lib/webPush"
import { isPushSupported } from "@/lib/push"

// T8 — THE single shared web-push hook. Both the suite's advisory-alerts card
// and the notification bell consume this; the ONLY `pushManager.subscribe` call
// site in the app is inside lib/webPush.ts (grep-asserted). Permission request
// + subscription happen together here — the bell no longer asks for permission
// without subscribing. Unconfigured VAPID (503) surfaces as honest
// "unavailable", never a fabricated send.
interface WebPushState {
  supported: boolean
  enabled: boolean
  busy: boolean
  unavailable: boolean
  message: string | null
  outcome: WebPushOutcome | null
}

const initial: WebPushState = {
  supported: isPushSupported(),
  enabled: false,
  busy: false,
  unavailable: false,
  message: null,
  outcome: null
}

export function useWebPush() {
  const [state, setState] = useState<WebPushState>(initial)

  const apply = useCallback((outcome: WebPushOutcome) => {
    switch (outcome.kind) {
      case "enabled":
        setState((s) => ({
          ...s,
          enabled: true,
          unavailable: false,
          message: `Push enabled — synced with the server (${outcome.subscriptions} subscription${outcome.subscriptions === 1 ? "" : "s"}).`
        }))
        break
      case "disabled":
        setState((s) => ({ ...s, enabled: false, message: "Push disabled on this browser." }))
        break
      case "unavailable":
        setState((s) => ({ ...s, enabled: false, unavailable: true, message: outcome.reason }))
        break
      case "denied":
        setState((s) => ({ ...s, enabled: false, message: `Permission ${outcome.permission} — push stays off until you allow notifications for this site.` }))
        break
      case "unsupported":
        setState((s) => ({ ...s, enabled: false, message: "This browser cannot receive Web Push (no Service Worker / PushManager)." }))
        break
      case "error":
        setState((s) => ({ ...s, enabled: false, message: outcome.message }))
        break
    }
    setState((s) => ({ ...s, outcome }))
  }, [])

  const enable = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, message: null }))
    const outcome = await enableWebPush({
      isPushSupported,
      requestPermission: () => Notification.requestPermission(),
      serviceWorkerReady: () => navigator.serviceWorker.ready,
      fetchVapidPublicKey: async () => {
        try {
          const res = await fetch("/api/notifications/vapid-public-key", { credentials: "include" })
          if (res.status === 503) return null // unconfigured VAPID → honest unavailable
          if (!res.ok) throw new Error(`VAPID key request failed (${res.status})`)
          const j = (await res.json()) as { publicKey?: string }
          return typeof j.publicKey === "string" && j.publicKey ? j.publicKey : null
        } catch (e) {
          return null // transport failure must not fabricate a send either
        }
      },
      postSubscribe: async (sub) => {
        const res = await fetch("/api/notifications/subscribe-push", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub)
        })
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; subscriptions?: number }
        return { ok: Boolean(j.ok), subscriptions: Number(j.subscriptions ?? 0) }
      },
      postUnsubscribe: async (endpoint) => {
        const res = await fetch("/api/notifications/unsubscribe-push", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint })
        })
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; subscriptions?: number }
        return { ok: Boolean(j.ok), subscriptions: Number(j.subscriptions ?? 0) }
      }
    })
    apply(outcome)
    setState((s) => ({ ...s, busy: false }))
  }, [apply])

  const disable = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, message: null }))
    const outcome = await disableWebPush({
      isPushSupported,
      serviceWorkerReady: () => navigator.serviceWorker.ready,
      postUnsubscribe: async (endpoint) => {
        const res = await fetch("/api/notifications/unsubscribe-push", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint })
        })
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; subscriptions?: number }
        return { ok: Boolean(j.ok), subscriptions: Number(j.subscriptions ?? 0) }
      }
    })
    apply(outcome)
    setState((s) => ({ ...s, busy: false }))
  }, [apply])

  return { ...state, enable, disable } as WebPushState & { enable: () => Promise<void>; disable: () => Promise<void> }
}