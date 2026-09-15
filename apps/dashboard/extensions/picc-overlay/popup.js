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

// ── Session status (Phase 5, spec T8) ───────────────────────────────────────
// Pure storage reader: the background worker polls the authenticated
// headless-status endpoint and mirrors it to chrome.storage.local. The maps
// below translate the ENGINE's observed state (needs-credentials / not-enabled
// / idle are shown honestly, never dressed up as a connected session) for the
// active-tab sync row. No trading controls live here.
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
  const { piccSensorStatus, piccRelayEnabled, piccSessionCapture, piccServerOnline, piccServerPort, piccHeadlessStatus } = await chrome.storage.local.get([
    "piccSensorStatus", "piccRelayEnabled", "piccSessionCapture", "piccServerOnline", "piccServerPort", "piccHeadlessStatus"
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
  renderSessionCapture(piccSessionCapture)
}

function renderSessionCapture(localValue) {
  // S6/T6.2 — the session-capture switch is the SENSOR-side kill-switch for the
  // capture leg. The PICC settings view (server) OVERRIDES it when the server
  // actually reported it OFF (owner decision 2026-09-15): capture does not
  // occur even if the local toggle says enabled, and the popup says why instead
  // of silently ignoring the switch. Null = "server never observed" (default-ON,
  // local toggle alone dictates), never assumed OFF.
  const cap = $("capture")
  const note = $("capture-note")
  cap.classList.toggle("on", localValue !== false)
  cap.disabled = false
  note.style.display = "none"
  chrome.runtime.sendMessage({ action: "capture-profiles" })
    .then((res) => {
      if (res && res.sessionCaptureEnabled === false) {
        cap.classList.remove("on")
        cap.disabled = true // the PICC settings toggle is authoritative; local flip would lie
        note.style.display = "block"
      }
    })
    .catch(() => { /* server view unavailable — local toggle alone dictates (independence) */ })
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

async function flipToggle(key) {
  // Both switches are the same dance: read the single flag, write the inverse,
  // re-render. Each handler below stays a one-liner so the popup's storage
  // footprint (one key read + one key write per toggle) is easy to audit.
  const cur = await chrome.storage.local.get([key])
  await chrome.storage.local.set({ [key]: cur[key] === false })
  await refresh()
}

$("relay").addEventListener("click", () => flipToggle("piccRelayEnabled"))

$("capture").addEventListener("click", () => {
  // The PICC-settings view (server) is authoritative when present — the toggle
  // is disabled there, so a click here only flips the local switch when the
  // extension is the only surface (independence architecture).
  flipToggle("piccSessionCapture")
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
