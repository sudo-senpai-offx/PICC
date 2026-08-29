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
  // ALL network I/O runs in the background worker (host-permission-exempt):
  // a content-script fetch to http://localhost from an https broker page is
  // CORS-blocked (server allowlists origins at handlers.mjs:219,4453) AND
  // mixed-content-blocked — the broker-tab sensor could never reach the
  // backend no matter how health checks were phrased (T11 finding, "server
  // online / relay offline" 2026-08-29). The worker's `server-status` answer
  // (detectServerPort → piccServerOnline/piccDetectedPort) is the single
  // source of truth; storage is the fallback when the worker is unreachable.
  let serverOrigin = null // e.g. "http://localhost:5173" — for display only
  let online = null

  function readCachedServerState() {
    return new Promise((resolve) => {
      store.get(["piccServerOnline", "piccServerPort"], ({ piccServerOnline, piccServerPort }) => {
        resolve({ online: piccServerOnline === true, port: Number(piccServerPort) || null })
      })
    })
  }

  async function probeServer() {
    // Fresh worker probe first — the heartbeat's cached state is up to 30 s old.
    let st = null
    try { st = await chromeGuard(() => chrome.runtime.sendMessage({ action: "server-status" })) } catch { st = null }
    if (dead) return // torn-down context: the storage fallback would await a callback that never fires
    if (!st || typeof st.online !== "boolean") st = await readCachedServerState()
    online = st.online === true
    serverOrigin = online ? `http://localhost:${st.port}` : null
    const wasOffline = !online
    store.set({
      piccSensorStatus: {
        online,
        port: online ? st.port : null,
        origin: serverOrigin,
        at: Date.now(),
        relayedCount,
        lastRelayAt: lastRelayAt || null
      }
    })
    if (online && wasOffline) console.info("[picc-sensor] server found via worker probe")
    if (online) flush() // drain anything queued while offline
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
  let backoffMs = 0
  // Relay activity, surfaced by the popup so "relay" means frames flowing,
  // not just the backend being reachable (T11 finding 2026-08-29).
  let relayedCount = 0
  let lastRelayAt = 0

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
    // Chunk oversized batches: chrome.runtime.sendMessage payloads must stay
    // modest; an uncapped batch of 120 × 4 KB sanitized frames is too fat.
    let chunk = batch
    if (JSON.stringify({ frames: batch }).length > 128 * 1024) {
      chunk = batch.slice(0, Math.max(1, Math.ceil(batch.length / 2)))
      QUEUE.unshift(...batch.slice(chunk.length))
    }
    try {
      // The WORKER performs the POST (host-permission-exempt): a content-script
      // fetch to http://localhost from an https broker page dies on CORS +
      // mixed content. The worker answers ok/status; a non-ok answer means the
      // server rejected the batch (rate limit, oversize) and the sensor
      // requeues with its usual offline backoff.
      const res = await chromeGuard(() => chrome.runtime.sendMessage({ action: "relay-flush", frames: chunk }))
      if (res && res.ok === true) backoffMs = 0
      else requeue(chunk)
    } catch {
      requeue(chunk)
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
      relayedCount += 1
      lastRelayAt = Date.now()
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
  checkTimer = setInterval(probeServer, 15_000)
  heartbeatTimer = setInterval(() => { if (online) flush() }, 30_000)
  probeServer()
})()