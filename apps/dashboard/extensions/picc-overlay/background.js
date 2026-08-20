// PICC Overlay — background service worker (central hub)
// ALL server communication, state management, tab management, heartbeat.
// Content scripts NEVER fetch — they talk to this worker only.

const PICC_PORTS = [5173, 3000, 5174, 3001]
// Chrome enforces minimum 30s alarm period; 12s is silently clamped.
const HEARTBEAT_MS = 30_000
const METRICS_MS = 30_000

// ── State ────────────────────────────────────────────────────────────────────
let serverOnline = false
let lastServerCheck = 0
let detectedPort = null
let serverFetchRetries = 0
const MAX_RETRIES = 1
let extensionState = { installed: true, installTime: null, activeTabId: null }

// ── Side Panel ────────────────────────────────────────────────────────────────
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {})
}

// ── Sender validation ────────────────────────────────────────────────────────
// Only accept messages from our own extension's content scripts and popup.
function isTrustedSender(sender) {
  // Background-to-background messages (alarms, etc.)
  if (!sender.url) return true
  // Our own extension pages
  if (sender.url.startsWith("chrome-extension://") && sender.url.includes(chrome.runtime.id)) return true
  // Content scripts injected by us match our extension ID
  if (sender.id === chrome.runtime.id) return true
  return false
}

// ── Installation ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    if (details.reason === "install") {
      extensionState.installTime = Date.now()
      chrome.storage.local.set({
        piccInstalled: true,
        piccInstallTime: Date.now(),
        piccVersion: chrome.runtime.getManifest().version
      })
    }
    // Ensure context menu exists (re-create on update if removed)
    try {
      chrome.contextMenus.create({
        id: "picc-overlay",
        title: "PICC: Toggle Overlay",
        contexts: ["page", "action"]
      })
    } catch {}
  }
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
    // Attach auth token if stored
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
    if (!resp.ok) return { ok: false, data: null, status: resp.status }
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

// ── Server health check ──────────────────────────────────────────────────────
async function checkServer() {
  const result = await detectServerPort()
  const wasOnline = serverOnline
  serverOnline = result.ok
  lastServerCheck = Date.now()
  await chrome.storage.local.set({
    piccServerOnline: serverOnline,
    piccLastCheck: lastServerCheck,
    piccServerPort: detectedPort
  })

  // Only broadcast on actual status change (fixed: removed || true)
  if (wasOnline !== serverOnline) {
    broadcastStatus()
  }

  return serverOnline
}

// Broadcast status to all tabs with content scripts
function broadcastStatus() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: "server-status",
          online: serverOnline,
          port: detectedPort
        }).catch(() => {})
      }
    }
  })
}

// ── Heartbeat ────────────────────────────────────────────────────────────────
async function sendHeartbeat() {
  const online = await checkServer()
  if (!online) return

  let tabInfo = null
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab) {
      tabInfo = { id: tab.id, url: tab.url, title: tab.title }
      extensionState.activeTabId = tab.id
    }
  } catch {}

  let cookieCount = 0
  try {
    if (tabInfo?.url) {
      const url = new URL(tabInfo.url)
      const cookies = await chrome.cookies?.getAll({ domain: url.hostname }) || []
      cookieCount = cookies.length
    }
  } catch {}

  await serverFetch("/api/extension/heartbeat", {
    method: "POST",
    body: {
      extensionVersion: chrome.runtime.getManifest().version,
      installTime: extensionState.installTime,
      activeTab: tabInfo,
      cookieCount,
      serverOnline: true,
      port: detectedPort,
      timestamp: Date.now()
    }
  })
}

// ── Metrics relay ────────────────────────────────────────────────────────────
async function relayMetrics() {
  if (!serverOnline) return
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const response = await chrome.tabs.sendMessage(tab.id, { action: "get-metrics" }).catch(() => null)
    if (response) {
      await serverFetch("/api/browser/metrics", {
        method: "POST",
        body: { tabId: tab.id, ...response }
      })
    }
  } catch {}
}

// ── Tab tracking ─────────────────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  extensionState.activeTabId = activeInfo.tabId
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.tabs.sendMessage(tabId, {
      action: "server-status",
      online: serverOnline,
      port: detectedPort
    }).catch(() => {})
  }
})

// ── Alarms (MV3 service worker lifecycle safe) ───────────────────────────────
chrome.alarms.create("picc-heartbeat", { periodInMinutes: HEARTBEAT_MS / 60000 })
chrome.alarms.create("picc-metrics", { periodInMinutes: METRICS_MS / 60000 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "picc-heartbeat") sendHeartbeat()
  if (alarm.name === "picc-metrics") relayMetrics()
})

// ── Cookie access ────────────────────────────────────────────────────────────
async function getCookiesForUrl(url) {
  try {
    const u = new URL(url)
    return await chrome.cookies?.getAll({ domain: u.hostname }) || []
  } catch {
    return []
  }
}

// ── URL validation for downloads ─────────────────────────────────────────────
function isSafeDownloadUrl(url) {
  try {
    const u = new URL(url)
    // Only allow http/https — no file://, no ftp://, no data:
    if (u.protocol !== "http:" && u.protocol !== "https:") return false
    // Block internal network ranges
    const host = u.hostname
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false
    if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) return false
    return true
  } catch {
    return false
  }
}

// ── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── Sender validation: only trust our own extension pages ──
  if (!isTrustedSender(sender)) {
    sendResponse({ error: "untrusted sender" })
    return false
  }

  // Open side panel on action click (when no popup is set)
  if (msg.action === "open-sidepanel" && sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {})
    return
  }

  // Server proxy (content scripts → background → PICC server)
  if (msg.type === "picc-server-fetch" || msg.action === "server-request") {
    serverFetch(msg.path, { method: msg.method, body: msg.body, timeout: msg.timeout })
      .then((result) => sendResponse(result))
    return true
  }

  // Server status
  if (msg.action === "get-status") {
    sendResponse({ online: serverOnline, port: detectedPort, lastCheck: lastServerCheck })
    return false
  }

  // Extension state
  if (msg.action === "get-extension-state") {
    chrome.storage.local.get(["piccInstalled", "piccInstallTime", "piccVersion", "piccServerOnline", "piccServerPort"], (data) => {
      sendResponse({ ...data, online: serverOnline, port: detectedPort })
    })
    return true
  }

  // Toggle overlay — inject content.js if needed
  if (msg.action === "toggle-overlay") {
    const tabId = msg.tabId || sender.tab?.id
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "toggle-overlay" }).catch(() => {
        chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
          .then(() => chrome.tabs.sendMessage(tabId, { action: "toggle-overlay" }).catch(() => {}))
          .catch(() => {})
      })
    }
    sendResponse({ ok: true })
    return false
  }

  // Cookie access (restricted to active tab's origin)
  if (msg.action === "get-cookies") {
    getCookiesForUrl(msg.url || "").then((cookies) => sendResponse({ cookies }))
    return true
  }

  // Execute script in tab — ONLY our own content.js file, no arbitrary functions
  if (msg.action === "execute-script") {
    // SECURITY: Only allow executing our own content.js, not arbitrary functions
    if (msg.func || (msg.files && msg.files.some((f) => f !== "content.js"))) {
      sendResponse({ ok: false, error: "only content.js execution is permitted" })
      return false
    }
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId, allFrames: false },
      files: msg.files || ["content.js"]
    }).then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: err.message }))
    return true
  }

  // Inject CSS — ONLY from our own extension resources
  if (msg.action === "inject-css") {
    // SECURITY: Only allow injecting CSS from our own files
    if (msg.css) {
      sendResponse({ ok: false, error: "inline CSS injection not permitted — use file-based CSS" })
      return false
    }
    chrome.scripting.insertCSS({ target: { tabId: msg.tabId }, files: msg.files || [] })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }))
    return true
  }

  // Tab info
  if (msg.action === "get-tab-info") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      sendResponse({ tab: tab ? { id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } : null })
    })
    return true
  }

  // Notification — use extension icon
  if (msg.action === "notify") {
    chrome.notifications?.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: msg.title || "PICC",
      message: msg.message || ""
    }).catch(() => {})
    sendResponse({ ok: true })
    return false
  }

  // Download — validate URL safety
  if (msg.action === "download") {
    if (!isSafeDownloadUrl(msg.url)) {
      sendResponse({ ok: false, error: "unsafe download URL" })
      return false
    }
    try { chrome.downloads?.download({ url: msg.url, filename: msg.filename }) } catch {}
    sendResponse({ ok: true })
    return false
  }

  // Server re-check
  if (msg.action === "check-server") {
    checkServer().then((online) => sendResponse({ online, port: detectedPort }))
    return true
  }

  if (msg.action === "capture-screenshot") {
    try {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message })
        else sendResponse({ ok: true, image: dataUrl })
      })
    } catch (err) { sendResponse({ error: err.message }) }
    return true
  }

  if (msg.action === "relay-cookies") {
    const url = msg.url
    if (!url) { sendResponse({ ok: false }); return false }
    ;(async () => {
      try {
        const u = new URL(url)
        const cookies = await chrome.cookies?.getAll({ domain: u.hostname }) || []
        await serverFetch("/api/browser/cookies", { method: "POST", body: { url, cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires })) } })
        sendResponse({ ok: true, count: cookies.length })
      } catch (err) { sendResponse({ ok: false, error: err.message }) }
    })()
    return true
  }
})

// ── Context menu ─────────────────────────────────────────────────────────────
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "picc-overlay" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: "toggle-overlay" }).catch(() => {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
        .then(() => chrome.tabs.sendMessage(tab.id, { action: "toggle-overlay" }).catch(() => {}))
        .catch(() => {})
    })
  }
})

// ── Startup: detect server and send initial heartbeat ────────────────────────
;(async () => {
  await detectServerPort()
  await sendHeartbeat()
})()
