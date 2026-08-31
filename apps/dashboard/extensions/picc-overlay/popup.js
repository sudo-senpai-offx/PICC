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
  // The RELAY leg is the sensor's view of the broker-tab feed: online + frames
  // FLOWING within the last minute. The sensor content script runs only on
  // broker tabs, so with no tab open the relay is honestly "idle", not
  // "offline" — and queue depth below reads n/a, never a fabricated 0. The
  // online flag comes from the worker's probe (the broker-tab sensor cannot
  // fetch the backend itself — CORS + mixed content, T11 2026-08-29).
  const el = $("relay-st")
  if (!st || (st.online !== true && st.online !== false)) { el.textContent = "idle (no broker tab)"; el.className = "st warn"; return }
  if (st.online === true) {
    const flowing = typeof st.lastRelayAt === "number" && Date.now() - st.lastRelayAt < 60_000
    el.textContent = flowing ? `online :${st.port}` : "up · waiting for feed"
    el.className = "st ok"
    return
  }
  el.textContent = "sensor offline"
  el.className = "st bad"
}

// ── Sync status helpers (Phase 5, spec T8) ──────────────────────────────────
// The popup shows only the ACTIVE tab's venue. Row state comes from the worker's
// mirrored headless-status read — the ENGINE's observed state (idle / synced /
// not-enabled), never dressed up as a connected session. No trading controls
// live here. The per-venue "Headless sessions" list was removed per user request
// (2026-08-31): the active-tab "Sync (this tab)" row is the surface that matters.
const HEADLESS_TEXT = {
  ok: "session synced",
  idle: "idle · never captured",
  guest: "guest session",
  "needs-credentials": "login needed",
  "not-enabled": "not enabled",
  "no-tab": "open venue tab", // T12.1: engine targets the venue's OWN open tab, never the active one
  "pending-approval": "awaiting approval", // T9: first-login gate — human must approve in the dashboard
  rejected: "login rejected", // T9: cooldown before the gate re-asks
  error: "capture error"
}
const HEADLESS_TONE = {
  ok: "ok",
  idle: "warn",
  guest: "warn",
  "needs-credentials": "warn",
  "not-enabled": "dim",
  "no-tab": "warn",
  "pending-approval": "warn",
  rejected: "bad",
  error: "bad"
}

function fmtTime(iso) {
  if (!iso) return "never"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

async function refresh() {
  const { piccSensorStatus, piccRelayEnabled, piccServerOnline, piccServerPort, piccHeadlessStatus } = await chrome.storage.local.get([
    "piccSensorStatus", "piccRelayEnabled", "piccServerOnline", "piccServerPort", "piccHeadlessStatus"
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
  // T-EDGE: this tab's sync target. Generalized beyond "trading platform" —
  // whatever PICC venue (if any) the active tab hosts, show its state and the
  // per-platform sync decision. No venue host => honestly "not a PICC venue".
  renderSyncTab(q?.venueId ?? null, q?.venueName ?? null, piccHeadlessStatus?.venues ?? null)
  $("relay").classList.toggle("on", piccRelayEnabled !== false)
}

function renderSyncTab(venueId, venueName, allVenues) {
  const el = $("sync-tab")
  if (!venueId) {
    el.textContent = "not a PICC venue"
    el.className = "st dim"
    return
  }
  const label = venueName || venueId
  const row = allVenues && allVenues[venueId]
  // Show the ENGINE-observed state for this venue (idle / synced / not-enabled…),
  // or just "venue detected" when the status feed hasn't landed yet.
  const text = row ? (HEADLESS_TEXT[row.status] ?? row.status) : "venue detected"
  const tone = row ? (HEADLESS_TONE[row.status] ?? "warn") : "ok"
  el.textContent = `${label} · ${text}`
  el.className = `st ${tone}`
  el.title = row
    ? `this tab: ${label} · session ${fmtTime(row.lastCaptureAt)} · metrics ${fmtTime(row.lastMetricsAt)}`
    : `this tab hosts ${label}`
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
