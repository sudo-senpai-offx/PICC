// PICC service worker — web-push notifications (Phase L3) + PWA app-shell
// precache (Slice 4 / T6).
//
// Three jobs:
//   1. show a browser notification when a server-pushed alert arrives,
//   2. focus/raise the dashboard when the user clicks a notification,
//   3. precache the hashed app-shell assets at install so the shell can serve
//      offline (network-first navigations with cache fallback).
// Runtime data is NEVER cached — /api/* fetches are left untouched and nothing
// is written to the cache at run time. Only the precached shell entries serve.

// ---------------------------------------------------------------------------
// PWA app-shell precache (Slice 4 / T6). The picc-precache Vite plugin
// (vite.config.ts) rewrites these two declarations inside dist/sw.js after
// `vite build`:
//   the cache-name value   -> "picc-shell-v<pkg version>"   e.g. picc-shell-v0.1.0
//   the empty URL list     -> every hashed dist/assets/* file + index.html,
//                             manifest and icons.
// The unbuilt defaults below keep the SOURCE file inert (push-only) so serving
// it unbuilt never precaches anything.
// ---------------------------------------------------------------------------
var PICC_SHELL_VERSION = "picc-shell-v0.0.0"
var PRECACHE_URLS = []

self.addEventListener("install", (event) => {
  // Take over as soon as possible so push arrives on the fresh SW.
  self.skipWaiting()
  // App-shell precache, best effort: a failed entry must never strand push
  // delivery, so install stays non-fatal on cache.addAll rejection.
  if (PRECACHE_URLS.length > 0) {
    event.waitUntil(
      caches.open(PICC_SHELL_VERSION).then((cache) =>
        cache.addAll(PRECACHE_URLS).catch(() => {})
      )
    )
  }
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

// PWA shell fetch strategy (Slice 4 / T6): network-first navigations with the
// precache as an offline fallback; precached shell assets are cache-first with
// a network fallback. /api/* and every other runtime GET is never intercepted
// for caching — this handler only ever READS the precache, never writes to it.
self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((hit) => hit || caches.match("/index.html"))
      )
    )
    return
  }
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request))
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