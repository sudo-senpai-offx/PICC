// PICC service worker — web-push notifications (Phase L3).
//
// Two jobs only:
//   1. show a browser notification when a server-pushed alert arrives,
//   2. focus/raise the dashboard when the user clicks a notification.
// No caching, no intercepting fetches — the app stays fully server-served.

self.addEventListener("install", () => {
  // Take over as soon as possible so push arrives on the fresh SW.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  let payload = { title: "PICC alert", body: "A new advisory signal is ready." }
  try {
    const parsed = event.data ? event.data.json() : null
    if (parsed?.title) payload.title = parsed.title
    if (parsed?.body) payload.body = parsed.body
    if (parsed?.asset) payload.asset = parsed.asset
    if (parsed?.kind) payload.kind = parsed.kind
  } catch {
    // Non-JSON payload: fall back to raw text, still honest.
    if (event.data) payload.body = String(event.data)
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: `picc-${payload.asset ?? "alert"}`,
      data: { url: "/suites", asset: payload.asset, kind: payload.kind }
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = event.notification.data?.url || "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes("/") && "focus" in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})