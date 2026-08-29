// PICC Sensor — passive market-data relay (overlay/automation removed).
//
// Single responsibility: relay the host broker page's own WebSocket frames
// (sniffed by inject.js in MAIN world) to the PICC server's ingestion buffer,
// so the Signal Engine and dashboards get realtime candles without a headless
// browser. No UI, no DOM mutation, no automation — read-only by construction.
(() => {
  if (window.__PICC_SENSOR__) return
  window.__PICC_SENSOR__ = true

  // ── Context-lifecycle guard ────────────────────────────────────────────────
  // When the extension is reloaded, updated, or disabled, Chrome invalidates
  // every running content-script context. Pending async continuations (an
  // awaited fetch resolving after the reload) still execute inside the dead
  // context, and any chrome.* call there throws "Extension context
  // invalidated." — previously an unhandled promise rejection repeated by the
  // 15 s interval forever (REQ-1 / T2). Every chrome.* call in this file goes
  // through chromeGuard() so a dead context tears itself down silently.
  const INVALIDATED = /Extension context invalidated/
  let dead = false
  let checkTimer = null
  let heartbeatTimer = null
  let flushTimer = null

  function isInvalidated(err) {
    return !!err && INVALIDATED.test(String(err?.message ?? err))
  }

  function teardown() {
    if (dead) return
    dead = true
    window.__PICC_SENSOR_DEAD__ = true
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    window.removeEventListener("message", onMessage)
  }

  // Three failure routes, one exit: the pre-check (chrome.runtime.id becomes
  // undefined on invalidation), synchronous throws, and promise rejections.
  // Invariant: no chrome.* rejection ever escapes to the page — a dead
  // context is silent, and a live one rethrows genuine errors unchanged.
  function chromeGuard(fn) {
    try {
      if (dead) return undefined
      if (typeof chrome?.runtime?.id !== "string") { teardown(); return undefined }
      const out = fn()
      if (out && typeof out.then === "function") {
        return out.catch((err) => {
          if (isInvalidated(err)) { teardown(); return undefined }
          throw err
        })
      }
      return out
    } catch (err) {
      if (isInvalidated(err)) { teardown(); return undefined }
      throw err
    }
  }

  const store = {
    set(entry) { return chromeGuard(() => chrome.storage.local.set(entry)) },
    get(keys, cb) { return chromeGuard(() => chrome.storage.local.get(keys, cb)) }
  }

  // ── Server discovery ──────────────────────────────────────────────────────
  // The web app owns analysis/notifications; the sensor only needs to find it.
  // Probes BOTH loopback families by hostname, dev AND prod ports: a vite dev
  // server may bind IPv6 loopback (::1) only and REFUSE the IPv4 literal
  // 127.0.0.1 — with IPv4-only probes the sensor never found a healthy local
  // dev server and sat offline forever while the dashboard answered at
  // localhost:5173 (T11 finding 2026-08-29; the running server refused
  // 127.0.0.1:5173 and answered 200 on localhost:5173). The discovered ORIGIN
  // is reused for the flush, so both the health probe and the frame POST
  // always hit a reachable address.
  let serverOrigin = null // e.g. "http://localhost:5173" — the reachable origin
  let online = null
  const SERVER_CANDIDATES = [
    { origin: "http://127.0.0.1:5173", port: 5173 }, // vite dev, IPv4 loopback
    { origin: "http://localhost:5173", port: 5173 }, // vite dev, IPv6 loopback
    { origin: "http://127.0.0.1:3000", port: 3000 }, // prod server, IPv4
    { origin: "http://localhost:3000", port: 3000 }  // prod server, IPv6
  ]
  let backoffMs = 0

  async function checkServer() {
    for (const c of SERVER_CANDIDATES) {
      try {
        const ctl = new AbortController()
        setTimeout(() => ctl.abort(), 2500)
        const res = await fetch(`${c.origin}/api/health`, { signal: ctl.signal })
        if (res.ok) {
          const wasOffline = online === false
          serverOrigin = c.origin
          online = true
          backoffMs = 0
          store.set({ piccSensorStatus: { online, port: c.port, origin: c.origin, at: Date.now() } })
          if (wasOffline) console.info("[picc-sensor] server found on", c.origin)
          flush() // drain anything queued while offline
          return
        }
      } catch { /* try next candidate */ }
    }
    online = false
    store.set({ piccSensorStatus: { online, port: null, origin: null, at: Date.now() } })
  }

  // ── Upstream frame bridge ─────────────────────────────────────────────────
  // Shape-validate BEFORE queueing: any page script can forge postMessage.
  // Only broker-shaped candle/profile frames pass; strings capped; size bounded.
  function sanitizeUpstreamFrame(frame) {
    try {
      if (!frame || typeof frame !== "object" || typeof frame.action !== "string") return null
      if (frame.action.length > 40) return null
      const msg = frame.message
      const clean = { action: frame.action }
      if (msg != null) {
        if (typeof msg !== "object") return null
        clean.message = {}
        if (msg.assetId != null) clean.message.assetId = String(msg.assetId).slice(0, 32)
        if (msg.name != null) clean.message.name = String(msg.name).slice(0, 64)
        if (Array.isArray(msg.candles)) {
          clean.message.candles = msg.candles.slice(0, 64)
            .filter((c) => c && typeof c === "object" && Array.isArray(c.v))
            .map((c) => ({ t: Number(c.t) || 0, tf: Number(c.tf) || 0, v: c.v.slice(0, 8).map(Number) }))
        }
      }
      if (JSON.stringify(clean).length > 4096) return null
      return clean
    } catch { return null }
  }

  const QUEUE = []
  let flushing = false
  const FLUSH_MS = 2000
  const MAX_BATCH = 120

  async function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    if (flushing) return
    if (!QUEUE.length) return
    if (!serverOrigin || online === false) {
      scheduleFlush(backoffMs || FLUSH_MS)
      return
    }
    flushing = true
    const batch = QUEUE.splice(0, MAX_BATCH)
    try {
      const res = await fetch(`${serverOrigin}/api/extension/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames: batch })
      })
      if (!res.ok) requeue(batch)
      else backoffMs = 0
    } catch {
      requeue(batch)
    } finally {
      flushing = false
      if (QUEUE.length) scheduleFlush(FLUSH_MS)
    }
  }

  function requeue(batch) {
    QUEUE.unshift(...batch.slice(-400))
    while (QUEUE.length > 400) QUEUE.shift()
    // Exponential offline backoff: 2s → 60s cap. A dead server must not be hammered.
    backoffMs = Math.min(60_000, (backoffMs || FLUSH_MS) * 2)
    scheduleFlush(backoffMs)
  }

  function scheduleFlush(ms) {
    if (flushTimer) return
    flushTimer = setTimeout(flush, ms)
  }

  function queueFrame(frame) {
    store.get(["piccRelayEnabled"], ({ piccRelayEnabled }) => {
      if (piccRelayEnabled === false) return // user kill-switch, defaults ON
      const clean = sanitizeUpstreamFrame(frame)
      if (!clean) return
      QUEUE.push(clean)
      while (QUEUE.length > 400) QUEUE.shift()
      scheduleFlush(FLUSH_MS)
    })
  }

  // inject.js (MAIN world) relays gateway frames here.
  function onMessage(ev) {
    if (ev.source !== window) return
    const d = ev.data
    if (!d || !d.__piccEOFrame || !d.frame) return
    queueFrame(d.frame)
  }
  window.addEventListener("message", onMessage)

  // ── Popup telemetry reply ─────────────────────────────────────────────────
  // The popup asks the background for "frames queued"; the background asks the
  // active tab's sensor context. Passive read-only answer (T3 round-trip).
  // Registered through the guard so a dead context never registers.
  chromeGuard(() => chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg && msg.action === "sensor-queue-depth") {
      respond({ action: "sensor-queue-depth", depth: QUEUE.length, observed: true })
      return false // synchronous reply: close the port, nothing async pending
    }
    return false
  }))

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  checkTimer = setInterval(checkServer, 15_000)
  heartbeatTimer = setInterval(() => { if (online) flush() }, 30_000)
  checkServer()
})()