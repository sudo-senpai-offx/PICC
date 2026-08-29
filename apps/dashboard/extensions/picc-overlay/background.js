// PICC Sensor — background service worker (MV3).
//
// Division of labor: the sensor content scripts relay broker frames DIRECTLY to
// the server's ingest endpoint (/api/extension/ingest). This worker owns the
// extension's own telemetry and lifecycle: server-port discovery for the
// heartbeat, the heartbeat itself, tab-change telemetry, the popup's
// sensor-queue-depth round-trip, and sensor resurrection after reload/update.
// No overlay, no automation, no cookies/downloads/proxying — read-only.

const PICC_PORTS = [5173, 3000, 5174, 3001]
// Chrome enforces a minimum 30 s alarm period; anything below is clamped.
const HEARTBEAT_MS = 30_000

// ── State ────────────────────────────────────────────────────────────────────
let serverOnline = false
let lastServerCheck = 0
let detectedPort = null
try {
  chrome.storage.session.get(["piccDetectedPort"]).then((d) => {
    if (d?.piccDetectedPort && PICC_PORTS.includes(d.piccDetectedPort)) {
      detectedPort = d.piccDetectedPort
    }
  }).catch(() => {})
} catch { /* storage.session unavailable (old Edge) */ }
let serverFetchRetries = 0
const MAX_RETRIES = 1

// ── Sender validation ────────────────────────────────────────────────────────
// Only accept messages from our own extension's content scripts and popup.
function isTrustedSender(sender) {
  if (!sender.url) return true // background-to-background (alarms, etc.)
  if (sender.url.startsWith("chrome-extension://") && sender.url.includes(chrome.runtime.id)) return true
  if (sender.id === chrome.runtime.id) return true // our content scripts
  return false
}

// ── Sensor resurrection (T3) ─────────────────────────────────────────────────
// A reload/update invalidates every running content-script context; only a new
// navigation injects a fresh one. Best-effort: reload open broker + dashboard
// tabs so the sensor comes back without user action. Next-navigation injection
// is the safety net if this is too aggressive in some Chrome version (R1).
function resurrectSensorTabs() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue
      try {
        const u = new URL(tab.url)
        const onBroker = /expertoption\.(com|finance)$/.test(u.hostname)
        const onDashboard = (u.hostname === "localhost" || u.hostname === "127.0.0.1") && [5173, 3000].includes(Number(u.port))
        if (onBroker || onDashboard) chrome.tabs.reload(tab.id).catch(() => {})
      } catch { /* about:blank, chrome://, etc. */ }
    }
  })
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    chrome.storage.local.set({
      piccInstalled: true,
      piccInstallTime: details.reason === "install" ? Date.now() : undefined,
      piccVersion: chrome.runtime.getManifest().version
    }).catch(() => {})
    resurrectSensorTabs()
  }
})

// Browser restart: content scripts re-inject on next navigation by themselves,
// but resurrect immediately so the sensor does not sit dead until then.
chrome.runtime.onStartup.addListener(() => {
  resurrectSensorTabs()
})

// ── Port detection ───────────────────────────────────────────────────────────
async function detectServerPort() {
  const ports = detectedPort
    ? [detectedPort, ...PICC_PORTS.filter((p) => p !== detectedPort)]
    : PICC_PORTS

  for (const port of ports) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const resp = await fetch(`http://localhost:${port}/api/health`, {
        signal: controller.signal
      })
      clearTimeout(timer)
      if (resp.ok) {
        const data = await resp.json().catch(() => null)
        if (data?.ok) {
          detectedPort = port
          serverFetchRetries = 0
          try { chrome.storage.session.set({ piccDetectedPort: port }).catch(() => {}) } catch { /* ignore */ }
          return { port, ok: true, data }
        }
      }
    } catch {
      // port not listening — try next
    }
  }
  return { port: null, ok: false, data: null }
}

// ── Central server fetch ─────────────────────────────────────────────────────
async function serverFetch(path, opts = {}) {
  if (!detectedPort) await detectServerPort()
  if (!detectedPort) return { ok: false, data: null, error: "no server found" }

  try {
    const headers = opts.body ? { "Content-Type": "application/json" } : {}
    try {
      const stored = await chrome.storage.local.get("piccAuthToken")
      if (stored.piccAuthToken) headers["Authorization"] = `Bearer ${stored.piccAuthToken}`
    } catch { /* storage unavailable */ }

    const resp = await fetch(`http://localhost:${detectedPort}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeout || 8000)
    })
    if (!resp.ok) {
      let error = null
      try {
        const raw = await resp.text()
        try {
          const parsedBody = JSON.parse(raw)
          error = parsedBody?.error ?? parsedBody?.detail ?? raw
        } catch {
          error = raw
        }
      } catch { /* body unavailable */ }
      return { ok: false, data: null, status: resp.status, error: error || `HTTP ${resp.status}` }
    }
    const data = await resp.json().catch(() => null)
    return { ok: true, data, status: resp.status }
  } catch (err) {
    if (serverFetchRetries < MAX_RETRIES) {
      detectedPort = null
      serverFetchRetries++
      return serverFetch(path, opts)
    }
    serverFetchRetries = 0
    return { ok: false, data: null, error: err.message }
  }
}

// ── Heartbeat ────────────────────────────────────────────────────────────────
async function checkServer() {
  const result = await detectServerPort()
  serverOnline = result.ok
  lastServerCheck = Date.now()
  await chrome.storage.local.set({
    piccServerOnline: serverOnline,
    piccLastCheck: lastServerCheck,
    piccServerPort: detectedPort
  })
  return serverOnline
}

async function sendHeartbeat() {
  const online = await checkServer()
  if (!online) return

  let tabInfo = null
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab) tabInfo = { id: tab.id, url: tab.url, title: tab.title }
  } catch {}

  await serverFetch("/api/extension/heartbeat", {
    method: "POST",
    body: {
      extensionVersion: chrome.runtime.getManifest().version,
      activeTab: tabInfo,
      serverOnline: true,
      port: detectedPort,
      timestamp: Date.now()
    }
  })
}

// ── Headless-session status poll (Phase 5, spec T8) ─────────────────────────
// Read-only surface for the popup: poll the authenticated headless-status
// endpoint and mirror it to chrome.storage.local under piccHeadlessStatus.
// The popup is a pure storage reader (no new message action — the action
// vocabulary stays pinned at extensionIntegrity.test.mjs:169). No automation
// is added here or anywhere else in the extension.
const HEADLESS_STATUS_KEY = "piccHeadlessStatus"

async function refreshHeadlessStatus() {
  const at = Date.now()
  // On ANY failure the stored view is { ok:false, venues:null } — the popup
  // renders the honest "unavailable" tone instead of re-claiming the last
  // good read as fresh. serverFetch does its own port detection, so the
  // cached serverOnline flag is deliberately not consulted.
  const fallback = { ok: false, at, venues: null }
  const r = await serverFetch("/api/trading/headless-status")
  if (!r.ok) {
    await chrome.storage.local.set({ [HEADLESS_STATUS_KEY]: fallback }).catch(() => {})
    return
  }
  await chrome.storage.local.set({
    [HEADLESS_STATUS_KEY]: { ok: true, at, venues: r.data?.venues ?? null }
  }).catch(() => {})
}

// ── Tab-change telemetry ─────────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!serverOnline) return
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    if (tab?.url) {
      await serverFetch("/api/extension/tab-changed", {
        method: "POST",
        body: { tabId: activeInfo.tabId, url: tab.url, title: tab.title }
      })
    }
  } catch {}
})

// ── Alarms (MV3 service worker lifecycle safe) ───────────────────────────────
async function ensureAlarms() {
  try {
    const existing = new Set((await chrome.alarms.getAll()).map((a) => a.name))
    if (!existing.has("picc-heartbeat")) chrome.alarms.create("picc-heartbeat", { periodInMinutes: HEARTBEAT_MS / 60000 })
  } catch { /* alarms unavailable */ }
}
void ensureAlarms()

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "picc-heartbeat") {
    sendHeartbeat()
    refreshHeadlessStatus() // T8: mirror headless-session state for the popup
  }
})

// ── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isTrustedSender(sender)) {
    sendResponse({ error: "untrusted sender" })
    return false
  }

  // Popup telemetry: queue depth of the ACTIVE tab's sensor. The depth lives in
  // the content-script context; only a live sensor can observe it. When there
  // is no observable sensor we say so (observed:false) instead of zero-filling.
  if (msg.action === "sensor-queue-depth") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) return sendResponse({ action: "sensor-queue-depth", depth: null, observed: false })
      chrome.tabs.sendMessage(tab.id, { action: "sensor-queue-depth" })
        .then((r) => sendResponse({ action: "sensor-queue-depth", depth: Number(r?.depth) || 0, observed: r?.observed === true }))
        .catch(() => sendResponse({ action: "sensor-queue-depth", depth: null, observed: false }))
    })
    return true
  }

  // Popup server status: a LIVE health probe owned by this worker, NOT the
  // broker-tab sensor's stored view. The sensor content script only runs on
  // broker domains, so its piccSensorStatus alone made the popup report PICC
  // offline while the backend was healthy (T11 finding 2026-08-29).
  if (msg.action === "server-status") {
    checkServer()
      .then((online) => sendResponse({ action: "server-status", online, port: detectedPort, at: Date.now() }))
      .catch(() => sendResponse({ action: "server-status", online: false, port: null, at: Date.now() }))
    return true
  }

  // Sensor frame relay: content scripts tunnel their batches here because a
  // content-script fetch to http://localhost from an https broker page is
  // CORS + mixed-content blocked. THIS worker context is host-permission
  // exempt, so it performs the ingest POST on the sensor's behalf. Frame
  // batches are already sanitized by content.js; the server re-validates.
  if (msg.action === "relay-flush") {
    const frames = Array.isArray(msg.frames) ? msg.frames : []
    if (!frames.length) { sendResponse({ ok: false, error: "no frames" }); return false }
    if (frames.length > 200) { sendResponse({ ok: false, error: "batch too large" }); return false } // ingest cap (handlers.mjs:4294)
    serverFetch("/api/extension/ingest", { method: "POST", body: { frames } })
      .then((r) => sendResponse({ ok: r.ok === true, status: r.status ?? null, error: r.error ?? null }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }))
    return true
  }

  // T13 — venue-session observation relay (capture leg). Same channel as
  // relay-flush: the content script observes the venue tab's configured keys +
  // storage-tier account profile, tunnels the observation through the worker
  // (https → localhost fetch dies on CORS/mixed content otherwise) and the
  // server applies the identical rules the studio leg does (gate, guest, save,
  // revive). The token is a TRANSIENT observation: it rides this one POST and
  // is never written to extension storage — the popup never sees any of this.
  if (msg.action === "capture-session") {
    const body = {
      venueId: String(msg.venue ?? "").slice(0, 64),
      token: String(msg.token ?? "").slice(0, 4096),
      source: msg.source ? String(msg.source).slice(0, 128) : null,
      url: msg.url ? String(msg.url).slice(0, 2048) : null,
      account: msg.account && typeof msg.account === "object"
        ? {
            guest: msg.account.guest === true,
            active: msg.account.active === true,
            email: typeof msg.account.email === "string" ? msg.account.email.slice(0, 256) : null,
            name: typeof msg.account.name === "string" ? msg.account.name.slice(0, 256) : null,
            wallet: typeof msg.account.wallet === "string" ? msg.account.wallet.slice(0, 32) : null
          }
        : null
    }
    if (!body.venueId || !body.token) { sendResponse({ ok: false, error: "incomplete observation" }); return false }
    serverFetch("/api/trading/capture-session", { method: "POST", body })
      .then((r) => sendResponse({ ok: r.ok === true, state: r.data?.state ?? null, reason: r.data?.reason ?? null, status: r.status ?? null }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }))
    return true
  }

  // T13 — scanner config for the content scripts (the venue rows → keys the
  // sensor may READ on a venue tab). Key names only, forwarded verbatim.
  if (msg.action === "capture-profiles") {
    serverFetch("/api/trading/capture-profiles")
      .then((r) => sendResponse({ ok: r.ok === true, venues: r.data?.venues ?? null, status: r.status ?? null }))
      .catch((err) => sendResponse({ ok: false, venues: null, error: String(err?.message ?? err) }))
    return true
  }

  return false
})

// ── Startup: detect server and send initial heartbeat ────────────────────────
;(async () => {
  await detectServerPort()
  await sendHeartbeat()
  await refreshHeadlessStatus() // T8: first mirror lands before the first alarm
})()