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

// REQ-4 deep link: /suites?asset=<asset>&panel=chart[&venue=<venue>], built only
// from the whitelisted payload fields. Unset asset simply drops the param; the
// suite's unknown-value handling degrades to the current view on bad input.
function deepLink(payload) {
  const url = new URL("/suites", self.location.origin)
  if (payload.asset) url.searchParams.set("asset", payload.asset)
  url.searchParams.set("panel", "chart")
  if (payload.venue) url.searchParams.set("venue", payload.venue)
  return url.toString()
}

self.addEventListener("push", (event) => {
  let payload = { title: "PICC alert", body: "A new advisory signal is ready." }
  try {
    const parsed = event.data ? event.data.json() : null
    if (parsed?.title) payload.title = parsed.title
    if (parsed?.body) payload.body = parsed.body
    if (parsed?.asset) payload.asset = parsed.asset
    if (parsed?.kind) payload.kind = parsed.kind
    // Payload v2 (REQ-3): additive whitelist with length caps — never forward
    // raw JSON; every field is parsed and bounded the way the fields above are.
    if (typeof parsed?.venue === "string") payload.venue = parsed.venue.slice(0, 40)
    else if (typeof parsed?.venue?.venueId === "string") payload.venue = parsed.venue.venueId.slice(0, 40)
    if (typeof parsed?.windowText === "string") payload.windowText = parsed.windowText.slice(0, 96)
    if (typeof parsed?.requireInteraction === "boolean") payload.requireInteraction = parsed.requireInteraction
    if (Array.isArray(parsed?.actions)) {
      payload.actions = parsed.actions
        .slice(0, 2) // ≤ 2 buttons — anything beyond that is ignored, not trusted
        .map((a) => ({
          action: String(a?.action ?? "").slice(0, 32),
          title: String(a?.title ?? "").slice(0, 32)
        }))
        .filter((a) => a.action && a.title)
      if (payload.actions.length === 0) delete payload.actions
    }
  } catch {
    // Non-JSON payload: fall back to raw text, still honest.
    if (event.data) payload.body = String(event.data)
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: `picc-${payload.asset ?? "alert"}`,
      data: { url: deepLink(payload), asset: payload.asset, kind: payload.kind },
      ...(payload.actions && { actions: payload.actions }),
      ...(payload.requireInteraction !== undefined && { requireInteraction: payload.requireInteraction })
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const action = event.action
  if (action === "snooze") {
    // REQ-4/REQ-5: snooze re-dispatches server-side in 10m — this branch only
    // asks, it NEVER navigates (and never opens a window).
    event.waitUntil(
      fetch("/api/notifications/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: event.notification.tag })
      }).catch(() => {})
    )
    return
  }
  // "view" and the default (no action) both land on the deep link — byte-identical
  // to the pre-actions focus-or-open path.
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