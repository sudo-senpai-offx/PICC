// Web-push helpers (Phase L3). Pure logic only — browser globals are
// narrowed into one `isPushSupported` gate so the rest stays unit-testable.

/**
 * Convert a base64url VAPID public key into the Uint8Array that
 * `pushManager.subscribe({ applicationServerKey })` requires.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** True when this browser can subscribe to Web Push at all. */
export function isPushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
}