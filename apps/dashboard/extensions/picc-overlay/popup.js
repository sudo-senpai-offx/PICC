// PICC Overlay — popup script
// ZERO fetch — everything via background service worker.

async function checkServer() {
  const el = document.getElementById("status")
  try {
    const resp = await chrome.runtime.sendMessage({ action: "check-server" })
    if (resp && resp.online) {
      el.textContent = "PICC server online" + (resp.port ? " (:" + resp.port + ")" : "")
      el.className = "status online"
      return true
    }
  } catch {}
  // Fallback: check storage
  try {
    const data = await chrome.storage.local.get(["piccServerOnline"])
    if (data.piccServerOnline) {
      el.textContent = "PICC server online"
      el.className = "status online"
      return true
    }
  } catch {}
  el.textContent = "PICC server offline — run `npm run dev` in apps/dashboard"
  el.className = "status offline"
  return false
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function loadSiteInfo() {
  const el = document.getElementById("site-info")
  const tab = await getActiveTab()
  if (!tab?.url) { el.textContent = "No active tab"; return }
  try {
    const u = new URL(tab.url)
    el.textContent = u.hostname
  } catch {
    el.textContent = tab.url
  }
}

document.getElementById("toggle-btn").addEventListener("click", async () => {
  const tab = await getActiveTab()
  if (!tab) return
  chrome.runtime.sendMessage({ action: "toggle-overlay", tabId: tab.id })
  window.close()
})

checkServer()
loadSiteInfo()
