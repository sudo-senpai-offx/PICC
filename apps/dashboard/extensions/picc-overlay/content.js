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
  let resilienceTimer = null

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
    if (resilienceTimer) { clearTimeout(resilienceTimer); resilienceTimer = null }
    window.removeEventListener("message", onMessage)
    window.removeEventListener("visibilitychange", onVisible)
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
    // Startup/refresh sync: the FIRST successful probe triggers one immediate
    // venue scan (this tab only; MIN_SCAN_MS-floor + capture dedup keep it
    // cheap) so a freshly loaded page pushes its latest status before the
    // worker's first cadence beat lands. After that the worker cadence owns
    // scheduling — this probe never scans again until the tab reloads.
    if (online && !firstScanDone) {
      firstScanDone = true
      scheduleVenueScan()
    }
    // NOTE: venue-session observation beyond that one startup scan is NO LONGER
    // driven from here. Cadence is
    // owned by the background worker — per-STREAM, keyed on that stream's own tab
    // activity (realtime for an active tab / within its activity window,
    // intermittent when the activity window lapses, long-period on prolonged
    // inactivity), so switching the browser's active tab never gate a stream's
    // sync. This probe stays ONLY server-discovery + flush (+ the venue scan's
    // resilience timer below). The worker drives scanVenueSession() via the
    // "venue-scan-now" message it directs at the right tab at the right pace.
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

  // ── T8 / REQ-10: __piccCommand bridge (Decision G) ─────────────────────────
  // The dashboard (T6) posts {__piccCommand:{action:"open-broker-tab", venueId,
  // url}} to the page; THIS content script (which runs on the dashboard origin
  // too, matches http(s)://*/*) validates and forwards it to the worker, then
  // acks the page with {__piccCommandAck:{venueId, ok}}. Shape-validated like
  // sanitizeUpstreamFrame — any page script can forge postMessage. The ack is
  // the dashboard's only signal that the extension handled the open (it falls
  // back to a new tab otherwise — a lost ack double-opens, so an UNRESOLVED
  // forward acks ok:false, never silence).
  function sanitizePiccCommand(cmd) {
    try {
      if (!cmd || typeof cmd !== "object" || cmd.action !== "open-broker-tab") return null
      const venueId = typeof cmd.venueId === "string" ? cmd.venueId.slice(0, 64) : ""
      const url = typeof cmd.url === "string" && /^https?:\/\//i.test(cmd.url) ? cmd.url.slice(0, 2048) : ""
      if (!venueId || !url) return null
      return { venueId, url }
    } catch { return null }
  }

  function handlePiccCommand(cmd) {
    const clean = sanitizePiccCommand(cmd)
    if (!clean) return
    const ack = (ok) => window.postMessage({ __piccCommandAck: { venueId: clean.venueId, ok } }, "*")
    const p = chromeGuard(() => chrome.runtime.sendMessage({ action: "open-broker-tab", venueId: clean.venueId, url: clean.url }))
    if (!p || typeof p.then !== "function") { ack(false); return }
    p.then((res) => ack(res && res.ok === true)).catch(() => ack(false))
  }

  // inject.js (MAIN world) relays gateway frames here; T6 posts __piccCommand.
  function onMessage(ev) {
    if (ev.source !== window) return
    const d = ev.data
    if (!d || typeof d !== "object") return
    if (d.__piccEOFrame && d.frame) queueFrame(d.frame)
    if (d.__piccCommand) handlePiccCommand(d.__piccCommand)
  }
  window.addEventListener("message", onMessage)

  // ── Popup telemetry reply ─────────────────────────────────────────────────
  // The popup asks the background for "frames queued"; the background asks the
  // active tab's sensor context. Passive read-only answer (T3 round-trip).
  // Registered through the guard so a dead context never registers.
  chromeGuard(() => chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg && msg.action === "sensor-queue-depth") {
      // Identify WHICH venue (if any) this tab hosts so the popup can show the
      // active tab's sync status, generalized beyond "trading platform". The
      // host-matched verdict mirrors scanVenueSession (line 444). Read from the
      // SYNC-cached config (already loaded by a prior scanVenueSession where
      // possible); the reply stays synchronous per the round-trip contract —
      // if the config isn't cached yet, report no venue rather than guessing.
      let venueId = null
      let venueName = null
      let hostname = ""
      try { hostname = location.hostname } catch { /* no DOM */ }
      const venues = captureConfig || null
      const venue = venues ? venues.find((v) => v && v.enabled !== false && matchesVenueHost(v.hostRe, hostname)) : null
      if (venue) {
        venueId = String(venue.venueId ?? "").slice(0, 64) || null
        venueName = String(venue.name ?? "").slice(0, 80) || null
      }
      // scannedAt: when this sensor LAST ENTERED a scan, from any driver
      // (worker cadence ping, visibilitychange, resilience timer). null before
      // the first scan. Lets the popup (and the E2E harness) tell "the sensor
      // is scanning on the scheduler's clock" from "it is idle" WITHOUT forcing
      // a duplicate relay — the capture dedup suppresses re-relays by design.
      respond({ action: "sensor-queue-depth", depth: QUEUE.length, observed: true, venueId, venueName, scannedAt: lastScanAt || null })
      return false // synchronous reply: close the port, nothing async pending
    }
    // Worker-directed venue-session scan (per-stream cadence). The background
    // worker owns the SYNC SCHEDULE (it alone sees every tab + its activity),
    // and pings the tab hosting each stream at the pace that stream's tab
    // activity warrants — realtime / intermittent / long-period. The sensor
    // here is the dumb executor: run the (still deduped) scan on demand. The
    // MIN_SCAN_MS throttle keeps redundant pings cheap, and the worker's own
    // cadence already spaces them — this guards against any double-fire (a
    // visibilitychange + a worker ping racing in the same instant).
    if (msg && msg.action === "venue-scan-now") {
      noteWorkerPing() // the worker IS alive and driving cadence — reset the resilience floor
      const now = Date.now()
      if (now - lastScanAt >= MIN_SCAN_MS) scheduleVenueScan()
      respond({ action: "venue-scan-now", observed: true })
      return false // synchronous
    }
    return false
  }))

  // ── Venue session observation (T13) ───────────────────────────────────────
  // The extension is the PRIMARY capture leg (the studio browser is
  // deprecated): on every venue tab the human browses in their OWN browser it
  // reads the venue's session surface and relays a CHANGED observation to the
  // server through the worker (the relay-flush channel — a content-script
  // fetch to http://localhost from an https venue page dies on CORS + mixed
  // content). Rules — each EXACTLY mirrors the studio hook it replaces:
  //   • liveEO venues: scanStoredTokens() replicates captureExpertOptionSession
  //     (browserStudio.mjs:3601-3639) — EVERY cookie/localStorage/sessionStorage
  //     entry is matched by VALUE SHAPE (32-hex / legacy uuid::base64 /
  //     trailing-hex cookie), because the platform can name the session key
  //     differently per deploy and the studio hook deliberately survives that;
  //     only the best-scoring hit is relayed, never a dump;
  //   • storageScan venues: readStoredKeys() replicates captureViaStorageScan
  //     (browserStudio.mjs:3676+) — ONLY the configured key names, nothing
  //     invented;
  //   • guest/active: the storage-tier probe proves ACTIVE (a profile-shaped
  //     JSON under profile keys). GUEST IS A DOM-TIER SIGNAL (login button /
  //     avatar — zero-mutation sensor cannot read it), so an unproven session
  //     is NOT reported guest — mirroring domLoginSignals' catch and the
  //     studio hook's catch, both of which default guest=false and save;
  //   • relays only when the observed token CHANGED (in-memory dedup, guards
  //     never in storage);
  //   • the token is a transient observation: it touches content memory →
  //     sendMessage → worker POST and NOTHING else. Never extension storage,
  //     never the popup, never any UI.
  //
  // The scanner no-ops on non-venue hosts (one anchored hostname test) —
  // ALL of the reading below runs ONLY on a host that matches a
  // capture-enabled venue row.
  const PICC_CAPTURE_BUILTIN = {
    // EO is the reference venue. Mirror of the server's EO entry in
    // captureProfiles.extensionCaptureConfigs() — pinned EQUAL to it by
    // extensionIntegrity.test.mjs (built-in = server config), so the fallback
    // used when the web app is absent cannot drift from the served one.
    expertoption: {
      hostRe: "expertoption\\.(com|finance)",
      via: "liveEO",
      // liveEO mode scans by VALUE SHAPE; these names only drive the same rank
      // preference the studio hook hardcodes (cookie token > tokenDemo > any
      // cookie > web storage) — a differently-named cookie still captures.
      keys: [
        { type: "cookie", key: "token" },
        { type: "cookie", key: "tokenDemo" },
        { type: "localStorage", key: "token" },
        { type: "sessionStorage", key: "token" }
      ],
      profileKeys: "user|account|profile|auth|session|current|me$|identity"
    }
  }
  let captureConfig = null // [{venueId, hostRe, via, keys, profileKeys, enabled}...] server view (or built-in fallback)
  let captureConfigAt = 0
  const CAPTURE_CFG_TTL = 5 * 60 * 1000
  const captureSent = {} // venueId -> last relayed token (IN-MEMORY only — never persisted)

  // ── Venue-scan cadence (per-stream, worker-directed) ─────────────────────
  // The WORKER owns the sync schedule and pings this tab's sensor via
  // "venue-scan-now" at the pace this STREAM's tab activity warrants. The
  // sensor side only sets the MINIMUM spacing between scans (dedup still makes
  // redundant scans no-ops) and a RESILIENCE floor: if the worker ever goes
  // quiet (dead worker, missed wake, OS suspend), the sensor falls back to a
  // long-period self-scan so it keeps the server honest without a coordinator.
  const MIN_SCAN_MS = 12_000            // hard floor between scans from any source
  const RESILIENCE_SCAN_MS = 300_000    // worker-quiet fallback (long-period)
  let lastScanAt = 0
  let lastWorkerPingAt = 0
  let firstScanDone = false
  function scheduleVenueScan() { lastScanAt = Date.now(); scanVenueSession() }
  function noteWorkerPing() { lastWorkerPingAt = Date.now() }

  // Anchored host match: `expertoption\.(com|finance)` (as served/built-in)
  // against the bare hostname must be a full trailing label — "evil-expertoption.com"
  // must NOT match. The server-side hostRe is deliberately unanchored (it runs
  // against full tab URLs where a trailing slash/query ends the match); the
  // scanner anchors because a phishing subdomain is a real threat surface here.
  function matchesVenueHost(hostRe, hostname) {
    try {
      return new RegExp(`(?:^|\\.)${hostRe}$`, "i").test(hostname || "")
    } catch { return false }
  }

  // THE ONLY document.* access in this file (pinned by extensionIntegrity:
  // the sentinel "document." appears exactly here, inside readCookies).
  // Cookies are parsed ONCE here and shared by both scan modes.
  function readCookies() {
    const out = []
    try {
      document.cookie.split(";").forEach((c) => {
        const i = c.indexOf("=")
        if (i > 0) out.push({ key: c.slice(0, i).trim(), value: decodeURIComponent(c.slice(i + 1)) })
      })
    } catch { /* cookie read refused — nothing to observe this pass */ }
    return out
  }

  // Exact-key reader for storageScan venues — mirror of captureViaStorageScan
  // (browserStudio.mjs:3676+), which reads ONLY the configured keys and nothing
  // invented. Keys are pushed in CONFIG ORDER so the FIRST configured key that
  // exists wins downstream. liveEO venues do NOT use this (they shape-scan).
  function readStoredKeys(keys) {
    const found = []
    for (const want of keys || []) {
      if (want.type === "cookie") {
        for (const c of readCookies()) {
          if (c.key === want.key) found.push({ source: "cookie", key: want.key, value: c.value })
        }
      } else if (want.type === "localStorage") {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k === want.key) found.push({ source: "localStorage", key: k, value: localStorage.getItem(k) })
          }
        } catch { /* opaque origin — no storage to read */ }
      } else if (want.type === "sessionStorage") {
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i)
            if (k === want.key) found.push({ source: "sessionStorage", key: k, value: sessionStorage.getItem(k) })
          }
        } catch { /* opaque origin — no storage to read */ }
      }
    }
    return found
  }

  // Shape-based scanner for liveEO venues — a byte-for-byte behavioral mirror
  // of captureExpertOptionSession's in-page scan (browserStudio.mjs:3601-3639):
  // every cookie + web-storage entry is matched by VALUE SHAPE so a deploy that
  // names the session key differently ("auth", "session", …) still captures.
  // Only the best-scoring hit returns (rank: cookie token 4 > cookie tokenDemo
  // 3 > any cookie 2 > web storage 1, then score: tail-hex 5 > pure-hex 3 >
  // legacy 2) — identical to the hook's sort. The three patterns below are
  // pinned present by extensionIntegrity.
  function scanStoredTokens() {
    const pattern = /^[0-9a-f]{32}$/
    const tailHex = /([0-9a-f]{32})$/
    const legacy = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::[A-Za-z0-9+/=_\-]+$/
    const found = []
    const check = (source, key, value) => {
      const v = String(value ?? "")
      if (!v) return
      let hit = null
      if (pattern.test(v)) hit = { value: v, score: 3 }
      else if (legacy.test(v)) hit = { value: v, score: 2 }
      else if (source === "cookie") {
        const m = v.match(tailHex)
        if (m) hit = { value: m[1], score: 5 }
      }
      if (!hit) return
      const rank = source === "cookie" && key === "token" ? 4
        : source === "cookie" && key === "tokenDemo" ? 3
        : source === "cookie" ? 2 : 1
      found.push({ source, key, value: hit.value, rank, score: hit.score })
    }
    try {
      for (const c of readCookies()) check("cookie", c.key, c.value)
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        check("localStorage", k, localStorage.getItem(k))
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        check("sessionStorage", k, sessionStorage.getItem(k))
      }
    } catch { /* opaque origin — nothing to observe this pass */ }
    found.sort((a, b) => b.rank - a.rank || b.score - a.score)
    return found[0] || null
  }

  // Active/unknown from the storage tier only. The studio hook's guest signal
  // is a DOM-tier read (login button / avatar — browserStudio.mjs domLoginSignals
  // :3016-3025) plus its catch default (guest=false → save). A zero-DOM-mutation
  // sensor CANNOT prove guest, so unproven = guest:false — the honest mirror of
  // both the DOM tier's absence and the catch default. Storage proves ACTIVE
  // (a profile-shaped value under a profile key with email/name); wallet mode
  // (demo/real) is read from the same storage tier the hook uses.
  function probeAccountProfile(profileKeysRe) {
    const out = { guest: false, active: false, email: null, name: null, wallet: null }
    for (const store of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i) || ""
          if (!profileKeysRe.test(k)) continue
          const raw = store.getItem(k)
          if (!raw || raw.length < 8 || raw.length > 20000) continue
          let obj = null
          try { obj = JSON.parse(raw) } catch { continue }
          if (!obj || typeof obj !== "object") continue
          const cursor = obj.user && typeof obj.user === "object" ? obj.user : obj
          const em = typeof cursor.email === "string" ? cursor.email : typeof cursor.mail === "string" ? cursor.mail : null
          const nm = typeof cursor.name === "string" ? cursor.name
            : typeof cursor.username === "string" ? cursor.username
            : typeof cursor.first_name === "string" ? cursor.first_name
            : typeof cursor.full_name === "string" ? cursor.full_name : null
          if (em || nm) {
            out.active = true
            if (!out.email && em) out.email = em
            if (!out.name && nm) out.name = nm
          }
          const low = (raw || "").toLowerCase()
          if (out.wallet == null && /("is_demo"\s*[:=]\s*1|"demo"\s*[:=]\s*1|"mode"\s*[:=]\s*"demo"|demo\s*account)/.test(low)) out.wallet = "demo"
          else if (out.wallet == null && /("is_demo"\s*[:=]\s*0|"mode"\s*[:=]\s*"real"|real\s*account)/.test(low)) out.wallet = "real"
        }
      } catch { /* opaque origin — keep empty signals */ }
    }
    return out
  }

  // The server's scan config, cached in-memory with a TTL. On ANY failure the
  // built-in EO fallback (pinned equal to the server view) is used, so the
  // scanner keeps working with no web app present — the hybrid-independence
  // rule: either present is functional, both is ideal.
  async function venueScanConfig() {
    if (captureConfig && Date.now() - captureConfigAt < CAPTURE_CFG_TTL) return captureConfig
    let venues = null
    try {
      const res = await chromeGuard(() => chrome.runtime.sendMessage({ action: "capture-profiles" }))
      if (res && Array.isArray(res.venues) && res.venues.length) venues = res.venues
    } catch { /* worker unreachable — fall through to built-in */ }
    captureConfig = venues || Object.entries(PICC_CAPTURE_BUILTIN).map(([venueId, cfg]) => ({
      venueId,
      name: cfg.name,
      hostRe: cfg.hostRe,
      via: cfg.via,
      keys: cfg.keys,
      profileKeys: cfg.profileKeys,
      origin: cfg.origin,
      slug: cfg.slug,
      capture: cfg.capture ?? null,
      enabled: true
    }))
    captureConfigAt = Date.now()
    return captureConfig
  }

  async function scanVenueSession() {
    if (dead || online !== true) return // the recorder is the web app; no app, nothing to relay (retried when it appears)
    let hostname = ""
    try { hostname = location.hostname } catch { return }
    const venues = await venueScanConfig()
    const venue = venues.find((v) => v && v.enabled !== false && matchesVenueHost(v.hostRe, hostname))
    if (!venue) return
    store.get(["piccSessionCapture"], ({ piccSessionCapture }) => {
      if (piccSessionCapture === false) return // user kill-switch for session capture, defaults ON
      // liveEO → shape scan (mirror of captureExpertOptionSession); every other
      // via → exact configured keys (mirror of captureViaStorageScan).
      const best = venue.via === "liveEO" ? scanStoredTokens() : (readStoredKeys(venue.keys)[0] ?? null)
      if (!best) return // no session-shaped token on this tab — nothing honest to observe
      const account = probeAccountProfile(new RegExp(venue.profileKeys, "i"))
      if (captureSent[venue.venueId] === best.value) return // unchanged since last relay — no noise
      const p = chromeGuard(() => chrome.runtime.sendMessage({
        action: "capture-session",
        venue: venue.venueId,
        url: location.href,
        source: `${best.source}:${best.key}`,
        token: best.value,
        account: { guest: account.guest, active: account.active, email: account.email, name: account.name, wallet: account.wallet }
      }))
      if (p && typeof p.then === "function") {
        p.then((res) => {
          // Dedup ONLY on an accepted observation. A pending-approval/error
          // answer leaves the observation un-sent so the next tick re-observes
          // (a later approval flows within 15 s).
          if (res && res.ok === true && (res.state === "ok" || res.state === "guest")) captureSent[venue.venueId] = best.value
        }).catch(() => {})
      }
    })
  }
  // visibilitychange BUBBLES to window: the listener lives here (window), not
  // document — the "document." sentinel is pinned to readStoredKeys only.
  // When THIS tab becomes visible the sensor scans immediately (a return to a
  // venue tab should re-observe right away) — throttled by the same MIN_SCAN_MS
  // floor as worker pings so rapid toggles stay cheap.
  function onVisible() {
    if (document.visibilityState !== "visible") return
    const now = Date.now()
    if (now - lastScanAt >= MIN_SCAN_MS) scheduleVenueScan()
  }
  window.addEventListener("visibilitychange", onVisible)

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  // probeServer: server discovery + frame-drain flush only (venue-scan moved to
  // the worker cadence). heartbeat: flush relay queue. resilienceTimer: if the
  // worker has not pinged a scan in a long time (worker gone / OS suspend), the
  // sensor self-scans at long-period so it never silently stops.
  function armResilienceScan() {
    if (resilienceTimer) { clearTimeout(resilienceTimer); resilienceTimer = null }
    const due = RESILIENCE_SCAN_MS - (Date.now() - lastWorkerPingAt)
    resilienceTimer = setTimeout(() => {
      if (Date.now() - lastScanAt >= MIN_SCAN_MS) scheduleVenueScan()
      armResilienceScan()
    }, Math.max(MIN_SCAN_MS, due))
  }
  checkTimer = setInterval(probeServer, 15_000)
  heartbeatTimer = setInterval(() => { if (online) flush() }, 30_000)
  armResilienceScan()
  probeServer()
})()