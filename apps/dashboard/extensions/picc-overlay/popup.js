// PICC Sensor popup — connection/config surface. No trading controls: the
// command centre (web app) owns analysis and notifications.
const $ = (id) => document.getElementById(id)

function renderStatus(st) {
  const el = $("conn")
  if (!st || st.online !== true && st.online !== false) { el.textContent = "checking…"; el.className = "st warn"; return }
  if (st.online === true) {
    el.textContent = `online :${st.port}`
    el.className = "st ok"
  } else {
    el.textContent = "server offline"
    el.className = "st bad"
  }
}

async function refresh() {
  const { piccSensorStatus, piccRelayEnabled } = await chrome.storage.local.get([
    "piccSensorStatus", "piccRelayEnabled"
  ])
  renderStatus(piccSensorStatus)
  $("queued").textContent = String(await chrome.runtime.sendMessage({ action: "sensor-queue-depth" }).catch(() => 0) ?? 0)
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
