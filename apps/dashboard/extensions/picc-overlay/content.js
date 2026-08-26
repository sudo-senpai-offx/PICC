// PICC Sensor — passive market-data relay (overlay/automation removed).
//
// Single responsibility: relay the host broker page's own WebSocket frames
// (sniffed by inject.js in MAIN world) to the PICC server's ingestion buffer,
// so the Signal Engine and dashboards get realtime candles without a headless
// browser. No UI, no DOM mutation, no automation — read-only by construction.
(() => {
  if (window.__PICC_SENSOR__) return
  window.__PICC_SENSOR__ = true

  // ── Server discovery ──────────────────────────────────────────────────────
  // The web app owns analysis/notifications; the sensor only needs to find it.
  let serverPort = null
  let online = null
  const PORTS = [5173, 3000]
  let backoffMs = 0

  async function checkServer() {
    for (const port of PORTS) {
      try {
        const ctl = new AbortController()
        setTimeout(() => ctl.abort(), 2500)
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctl.signal })
        if (res.ok) {
          const wasOffline = online === false
          serverPort = port
          online = true
          backoffMs = 0
          chrome.storage.local.set({ piccSensorStatus: { online, port, at: Date.now() } })
          if (wasOffline) console.info("[picc-sensor] server found on", port)
          flush() // drain anything queued while offline
          return
        }
      } catch { /* try next port */ }
    }
    online = false
    chrome.storage.local.set({ piccSensorStatus: { online, port: null, at: Date.now() } })
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
  let flushTimer = null
  let flushing = false
  const FLUSH_MS = 2000
  const MAX_BATCH = 120

  async function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    if (flushing) return
    if (!QUEUE.length) return
    if (!serverPort || online === false) {
      scheduleFlush(backoffMs || FLUSH_MS)
      return
    }
    flushing = true
    const batch = QUEUE.splice(0, MAX_BATCH)
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/extension/ingest`, {
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
    chrome.storage.local.get(["piccRelayEnabled"], ({ piccRelayEnabled }) => {
      if (piccRelayEnabled === false) return // user kill-switch, defaults ON
      const clean = sanitizeUpstreamFrame(frame)
      if (!clean) return
      QUEUE.push(clean)
      while (QUEUE.length > 400) QUEUE.shift()
      scheduleFlush(FLUSH_MS)
    })
  }

  // inject.js (MAIN world) relays gateway frames here.
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return
    const d = ev.data
    if (!d || !d.__piccEOFrame || !d.frame) return
    queueFrame(d.frame)
  })

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  checkServer()
  setInterval(checkServer, 15_000)
  setInterval(() => { if (online) flush() }, 30_000)
})()
