// PICC Sensor popup — connection/config surface. No trading controls: the
// command centre (web app) owns analysis and notifications.
const $ = (id) => document.getElementById(id)

function renderServer(srv) {
  // PICC BACKEND reachability — from the background worker's LIVE probe,
  // independent of the broker-tab sensor (T11 finding 2026-08-29).
  const el = $("conn")
  if (!srv || srv.online !== true && srv.online !== false) { el.textContent = "checking…"; el.className = "st warn"; return }
  if (srv.online === true) {
    el.textContent = `online :${srv.port}`
    el.className = "st ok"
  } else {
    el.textContent = "offline"
    el.className = "st bad"
  }
}

function renderRelay(st) {
  // The RELAY leg: the sensor's own view. The sensor content script runs only
  // on broker tabs, so when none is open the relay is honestly "idle", not
  // "offline" — and queue depth below reads n/a, never a fabricated 0.
  const el = $("relay-st")
  if (!st || (st.online !== true && st.online !== false)) { el.textContent = "idle (no broker tab)"; el.className = "st warn"; return }
  el.textContent = st.online === true ? `online :${st.port}` : "sensor offline"
  el.className = st.online === true ? "st ok" : "st bad"
}

async function refresh() {
  const { piccSensorStatus, piccRelayEnabled, piccServerOnline, piccServerPort } = await chrome.storage.local.get([
    "piccSensorStatus", "piccRelayEnabled", "piccServerOnline", "piccServerPort"
  ])
  // Fresh probe beats the heartbeat's cached state; fall back to the cache if
  // the worker is unreachable (should never happen — same extension).
  const srv = await chrome.runtime.sendMessage({ action: "server-status" }).catch(() => null)
  renderServer(srv ?? { online: piccServerOnline, port: piccServerPort, checkedAt: Date.now() })
  renderRelay(piccSensorStatus)
  // Queue depth comes from the ACTIVE tab's sensor; no observable sensor => n/a,
  // never a fabricated 0.
  const q = await chrome.runtime.sendMessage({ action: "sensor-queue-depth" }).catch(() => null)
  $("queued").textContent = q?.observed === true ? String(q.depth) : "n/a"
  $("relay").classList.toggle("on", piccRelayEnabled !== false)
}

$("relay").addEventListener("click", async () => {
  const { piccRelayEnabled } = await chrome.storage.local.get(["piccRelayEnabled"])
  await chrome.storage.local.set({ piccRelayEnabled: piccRelayEnabled === false })
  await refresh()
})

$("open").addEventListener("click", async () => {
  const { piccSettings } = await chrome.storage.sync.get(["piccSettings"])
  const url = piccSettings?.backendUrl || "http://localhost:5173"
  chrome.tabs.create({ url })
})

$("save").addEventListener("click", async () => {
  const url = $("backend").value.trim().replace(/\/+$/, "")
  const { piccSettings } = await chrome.storage.sync.get(["piccSettings"])
  await chrome.storage.sync.set({ piccSettings: { ...(piccSettings ?? {}), backendUrl: url } })
  $("backend").value = url
})

// Init
chrome.storage.sync.get(["piccSettings"]).then(({ piccSettings }) => {
  $("backend").value = piccSettings?.backendUrl || "http://localhost:5173"
})
void refresh()
setInterval(refresh, 3000)
