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

// ── Headless sessions (Phase 5, spec T8) ────────────────────────────────────
// Pure storage reader: the background worker polls the authenticated
// headless-status endpoint and mirrors it to chrome.storage.local. Rows are
// the ENGINE's observed state — needs-credentials / not-enabled / idle are
// shown honestly, never dressed up as a connected session. No trading
// controls live here.
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

function renderHeadless(st) {
  const box = $("headless")
  box.textContent = ""
  const addRow = (label, text, tone, title) => {
    const row = document.createElement("div")
    row.className = "row"
    if (title) row.title = title
    const l = document.createElement("span")
    l.className = "lbl"
    l.textContent = label
    const v = document.createElement("span")
    v.className = `st ${tone}`
    v.textContent = text
    row.append(l, v)
    box.append(row)
  }
  if (!st || st.ok !== true) {
    addRow("Headless sessions", "unavailable", "warn", "No fresh headless-session read from the server yet.")
    return
  }
  const venues = Object.values(st.venues ?? {})
  if (!venues.length) {
    addRow("Headless sessions", "no venues reported", "dim")
    return
  }
  for (const v of venues.sort((a, b) => a.venueId.localeCompare(b.venueId))) {
    const base = HEADLESS_TEXT[v.status] !== undefined
      ? { text: HEADLESS_TEXT[v.status], tone: HEADLESS_TONE[v.status] }
      : { text: v.status, tone: "warn" }
    const stale = v.stale === true && v.status !== "not-enabled"
    const tone = stale ? "warn" : base.tone
    // T13: honest provenance — WHERE the session state came from. The vote is
    // the engine's sourceLeg ("extension" = this extension on the venue tab in
    // your browser / "studio" = the deprecated studio-browser leg / null =
    // never captured); the popup never guesses a leg.
    const src = v.sourceLeg === "extension" ? "via extension"
      : v.sourceLeg === "studio" ? "via studio browser" : null
    const prefix = src && (v.status === "ok" || v.status === "guest") ? ` (${src})` : ""
    const text = stale ? `${base.text} · stale` : `${base.text}${prefix}`
    const detail = `capture ${fmtTime(v.lastCaptureAt)} · metrics ${fmtTime(v.lastMetricsAt)} · token ${fmtTime(v.tokenChangedAt)}${src ? ` · ${src}` : ""}`
    addRow(v.name ?? v.venueId, text, tone, detail)
  }
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
  renderHeadless(piccHeadlessStatus)
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
