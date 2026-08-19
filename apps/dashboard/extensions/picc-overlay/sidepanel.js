// PICC Side Panel — persistent control panel (never closes on blur).

const CACHED_PORT = "piccCachedPort"

async function serverFetch(path) {
  let port = null
  try {
    const data = await chrome.storage.local.get([CACHED_PORT])
    port = data[CACHED_PORT]
  } catch {}
  const ports = port ? [port, ...[5173, 3000, 5174, 3001].filter((p) => p !== port)] : [5173, 3000, 5174, 3001]
  for (const p of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api${path}`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        if (p !== port) chrome.storage.local.set({ [CACHED_PORT]: p })
        return await r.json()
      }
    } catch {}
  }
  return null
}

// Sound settings
const SOUND_KEY = "piccAlertSound"

async function getSoundEnabled() {
  try {
    const data = await chrome.storage.local.get([SOUND_KEY])
    return data[SOUND_KEY] !== false
  } catch { return true }
}

async function setSoundEnabled(enabled) {
  chrome.storage.local.set({ [SOUND_KEY]: enabled })
}

let _audioCtx = null
function playSideAlert() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = _audioCtx.createOscillator()
    const gain = _audioCtx.createGain()
    osc.connect(gain)
    gain.connect(_audioCtx.destination)
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.type = "square"
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.3)
    osc.stop(_audioCtx.currentTime + 0.3)
  } catch { /* ignore */ }
}

// Tab switching
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"))
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"))
    tab.classList.add("active")
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active")
    loadTab(tab.dataset.tab)
  })
})

// Server status
async function checkServer() {
  const el = document.getElementById("status")
  const data = await serverFetch("/health")
  if (data) {
    el.textContent = "Server online" + (data.port ? ` (:${data.port})` : "")
    el.className = "status online"
  } else {
    el.textContent = "Server offline"
    el.className = "status offline"
  }
}

// Load tab content
async function loadTab(tab) {
  if (tab === "signals") loadSignals()
  else if (tab === "portfolio") loadPortfolio()
  else if (tab === "alerts") loadAlerts()
  else if (tab === "sessions") loadSessions()
}

async function loadSignals() {
  const el = document.getElementById("signal-content")
  const data = await serverFetch("/trading/intel")
  if (!data || !data.ok) { el.innerHTML = '<div class="empty">No signal data</div>'; return }
  const d = data.data || data
  el.innerHTML = `
    <div class="metric"><span class="metric-label">Verdict</span><span class="metric-value" style="color:${d.verdict === "TRADE" ? "#4ade80" : d.verdict === "OBSERVE" ? "#f59e0b" : "#9aa0c0"}">${d.verdict || "N/A"}</span></div>
    <div class="metric"><span class="metric-label">Confidence</span><span class="metric-value">${d.confidence ?? "N/A"}%</span></div>
    <div class="metric"><span class="metric-label">Direction</span><span class="metric-value">${d.direction || "N/A"}</span></div>
    <div class="metric"><span class="metric-label">Score</span><span class="metric-value">${d.score ?? "N/A"}</span></div>
    <div class="metric"><span class="metric-label">Asset</span><span class="metric-value">${d.asset || d.symbol || "N/A"}</span></div>
  `
}

async function loadPortfolio() {
  const el = document.getElementById("portfolio-content")
  const data = await serverFetch("/trading/status")
  if (!data) { el.innerHTML = '<div class="empty">No portfolio data</div>'; return }
  el.innerHTML = `
    <div class="metric"><span class="metric-label">Balance</span><span class="metric-value">$${(data.balance ?? 0).toFixed(2)}</span></div>
    <div class="metric"><span class="metric-label">Equity</span><span class="metric-value">$${(data.equity ?? 0).toFixed(2)}</span></div>
    <div class="metric"><span class="metric-label">Today P&L</span><span class="metric-value" style="color:${(data.todayPnl ?? 0) >= 0 ? "#4ade80" : "#ff6b6b"}">$${(data.todayPnl ?? 0).toFixed(2)}</span></div>
    <div class="metric"><span class="metric-label">Open Positions</span><span class="metric-value">${data.openPositions ?? 0}</span></div>
  `
}

async function loadAlerts() {
  const el = document.getElementById("alerts-content")
  const data = await serverFetch("/trading/alerts")
  if (!data || !data.ok) { el.innerHTML = '<div class="empty">No alerts</div>'; return }
  const alerts = (data.alerts || []).filter((a) => a.status === "armed")
  const soundOn = await getSoundEnabled()
  const soundToggle = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;color:#9aa0c0;">
    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
      <input type="checkbox" id="sound-toggle" ${soundOn ? "checked" : ""} style="width:12px;height:12px;" />
      Alert sound
    </label>
  </div>`
  if (alerts.length === 0) { el.innerHTML = soundToggle + '<div class="empty">No active alerts</div>'; return }
  if (soundOn) playSideAlert()
  el.innerHTML = soundToggle + alerts.slice(0, 10).map((a) => `
    <div class="metric">
      <span class="metric-label">${a.symbol} ${a.condition.replace(/_/g, " ")} ${a.value}</span>
      <span class="metric-value" style="color:#4ade80;font-size:10px;">ARMED</span>
    </div>
  `).join("")
  const cb = document.getElementById("sound-toggle")
  if (cb) cb.addEventListener("change", () => setSoundEnabled(cb.checked))
}

async function loadSessions() {
  const el = document.getElementById("sessions-content")
  const data = await serverFetch("/trading/sessions")
  if (!data || !data.ok) { el.innerHTML = '<div class="empty">No session data</div>'; return }
  const c = data.current
  el.innerHTML = `
    <div style="padding:6px;border-radius:4px;background:${c.activeOverlaps?.length ? "#ec489811" : c.activeSessions?.length ? "#6c63ff11" : "#1a1a2e"};border:1px solid ${c.activeOverlaps?.length ? "#ec4898" : c.activeSessions?.length ? "#6c63ff" : "#2a2a4a"};margin-bottom:8px;">
      <div style="font-size:12px;font-weight:600;">${c.activeOverlaps?.length ? c.activeOverlaps[0].name : c.activeSessions?.length ? c.activeSessions.map((s) => s.name).join(" + ") : "Off Hours"}</div>
      <div style="font-size:10px;color:#9aa0c0;">UTC ${c.utcHour} | ${c.description}</div>
    </div>
    ${(data.schedule?.schedule || []).map((s) => `
      <div class="session-bar">
        <span class="session-dot" style="background:${s.isActive ? s.color : "#2a2a4a"};"></span>
        <span style="color:${s.isActive ? s.color : "#9aa0c0"};min-width:60px;">${s.name}</span>
        <span style="font-size:10px;color:#9aa0c0;">${s.isActive ? `${s.hoursUntilClose}h left` : `in ${s.hoursUntilOpen}h`}</span>
      </div>
    `).join("")}
  `
}

// Actions
document.getElementById("toggle-overlay").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) chrome.runtime.sendMessage({ action: "toggle-overlay", tabId: tab.id })
})

document.getElementById("open-dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:5173" })
})

// Site info
async function loadSiteInfo() {
  const el = document.getElementById("site-info")
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) { el.textContent = "No active tab"; return }
  try { el.textContent = new URL(tab.url).hostname } catch { el.textContent = tab.url }
}

// Init
checkServer()
loadSiteInfo()
loadTab("signals")

// Refresh every 30s
setInterval(checkServer, 30000)
setInterval(() => {
  const activeTab = document.querySelector(".tab.active")
  if (activeTab) loadTab(activeTab.dataset.tab)
}, 30000)
