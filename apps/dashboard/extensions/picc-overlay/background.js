// PICC Overlay — background service worker (central hub)
// ALL server communication, state management, tab management, heartbeat.
// Content scripts NEVER fetch — they talk to this worker only.

const PICC_PORTS = [5173, 3000, 5174, 3001] // Vite dev first, then production
const HEARTBEAT_MS = 12_000
const METRICS_MS = 30_000

// ── State ────────────────────────────────────────────────────────────────────
let serverOnline = false
let lastServerCheck = 0
let detectedPort = null
let extensionState = { installed: true, installTime: null, activeTabId: null }

// ── Installation ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    extensionState.installTime = Date.now()
    chrome.storage.local.set({
      piccInstalled: true,
      piccInstallTime: Date.now(),
      piccVersion: chrome.runtime.getManifest().version
    })
    chrome.contextMenus?.create({
      id: "picc-overlay",
      title: "PICC: Toggle Overlay",
      contexts: ["page", "action"]
    })
  }
})

// ── Port detection ───────────────────────────────────────────────────────────
// Try each port until one responds. Cache the working port.
async function detectServerPort() {
  // If we already found a working port, try it first
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
  // Auto-detect port if not yet known
  if (!detectedPort) {
    await detectServerPort()
  }
  if (!detectedPort) return { ok: false, data: null, error: "no server found" }

  try {
    const resp = await fetch(`http://localhost:${detectedPort}${path}`, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeout || 8000)
    })
    if (!resp.ok) return { ok: false, data: null, status: resp.status }
    const data = await resp.json().catch(() => null)
    return { ok: true, data, status: resp.status }
  } catch (err) {
    // Port might have changed — clear cache and retry once
    if (detectedPort) {
      detectedPort = null
      return serverFetch(path, opts)
    }
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

  // Push status change to all content scripts
  if (wasOnline !== serverOnline || true) {
    try {
      const tabs = await chrome.tabs.query({})
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: "server-status",
            online: serverOnline,
            port: detectedPort
          }).catch(() => {})
        }
      }
    } catch {}
  }

  return serverOnline
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

// ── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Server proxy
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

  // Toggle overlay
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

  // Cookie access
  if (msg.action === "get-cookies") {
    getCookiesForUrl(msg.url || "").then((cookies) => sendResponse({ cookies }))
    return true
  }

  // Execute script in tab
  if (msg.action === "execute-script") {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId, allFrames: false },
      func: msg.func,
      args: msg.args || []
    }).then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: err.message }))
    return true
  }

  // Inject CSS
  if (msg.action === "inject-css") {
    chrome.scripting.insertCSS({ target: { tabId: msg.tabId }, css: msg.css })
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

  // Notification
  if (msg.action === "notify") {
    chrome.notifications?.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: msg.title || "PICC",
      message: msg.message || ""
    }).catch(() => {})
    sendResponse({ ok: true })
    return false
  }

  // Download
  if (msg.action === "download") {
    chrome.downloads?.download({ url: msg.url, filename: msg.filename }).catch(() => {})
    sendResponse({ ok: true })
    return false
  }

  // Server re-check
  if (msg.action === "check-server") {
    checkServer().then((online) => sendResponse({ online, port: detectedPort }))
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
