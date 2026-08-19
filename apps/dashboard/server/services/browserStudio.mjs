// PICC Browser Studio — one full-featured integrated browser for ALL income
// sources. Instead of per-provider API collectors/connectors, a single real
// Chromium (Chrome/Edge via CDP) lives inside the dashboard:
//
//   • Stream  — the live page is cast to the dashboard over CDP screencast
//               (JPEG frames over SSE), so it renders like an embedded browser.
//   • Overlay  — PICC injects its own overlay node into every page to show
//               metrics, quests, payouts and suggestions (display-only).
//   • Control  — the dashboard can drive the browser: navigate, tabs, clicks,
//               typing, scroll. PICC can also autofill saved sign-ins.
//   • Vault    — sign-in credentials the user entrusts to PICC are saved
//               server-side (best-effort JSON, like the other credential files)
//               and offered back as autofill. PICC fills the fields; the human
//               still presses submit.
//
// The bridge stays read-only-by-default for money actions: PICC reads, shows,
// fills — it never clicks buy/withdraw on the user's behalf.
import { mkdirSync } from "node:fs"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { openBridge, browserAvailable, readPage } from "./browserBridge.mjs"
import { getConnector, parseAmount } from "./connectors.mjs"
import { suiteForSite } from "./suites.mjs"

const DATA_DIR = process.env.PICC_BROWSER_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const VAULT_FILE = join(DATA_DIR, "browser-credentials.json")
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }
const MAX_TABS = 12
const UPLOADS_DIR = join(DATA_DIR, "uploads")
const MAX_UPLOAD_TOTAL = 25 * 1024 * 1024
const MAX_DOWNLOADS = 20

// ---------------------------------------------------------------------
// Performance profiles — the embedded browser adapts screencast capture to
// the host so it stays smooth on anything from a Core Duo-class netbook up
// to a beefy desktop. Lower profiles drop the frame rate, JPEG quality and
// capture resolution. The big CPU/memory killer is Chrome encoding frames
// as fast as it can (immediate acks let it pump at up to 60fps); the ack
// pump below caps capture to the profile rate instead.
// ---------------------------------------------------------------------
const PERF_MODES = {
  low: { captureFps: 8, idleFps: 2, quality: 40, scale: 0.7, maxW: 1024, maxH: 768, idleAfterMs: 900 },
  medium: { captureFps: 12, idleFps: 3, quality: 55, scale: 0.85, maxW: 1280, maxH: 900, idleAfterMs: 1200 },
  high: { captureFps: 20, idleFps: 5, quality: 62, scale: 1, maxW: 1600, maxH: 1000, idleAfterMs: 1500 }
}

function detectPerfMode() {
  const cores = (os.cpus?.()?.length) || 4
  const memGB = (os.totalmem?.() || 8e9) / 1e9
  if (cores <= 2 || memGB <= 4) return "low"
  if (cores <= 4 || memGB <= 6) return "medium"
  return "high"
}

export function resolvePerf(settings = {}) {
  const envPerf = String(process.env.PICC_BROWSER_PERF || "auto").trim().toLowerCase()
  let mode = envPerf === "auto" ? String(settings.perfMode ?? "auto") : envPerf
  mode = PERF_MODES[mode] ? mode : "auto"
  const auto = mode === "auto"
  const base = auto ? detectPerfMode() : mode
  const cfg = { ...PERF_MODES[base], mode: base, auto }
  const fps = Number(process.env.PICC_BROWSER_FPS)
  if (fps > 0) {
    cfg.captureFps = fps
    cfg.idleFps = Math.min(cfg.idleFps, fps)
  }
  return cfg
}

function safeFilename(name) {
  const base = String(name || "upload").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120)
  return base || "upload"
}

async function persistUploadFiles(files) {
  const list = Array.isArray(files) ? files : []
  const paths = []
  let total = 0
  await mkdir(UPLOADS_DIR, { recursive: true })
  for (const f of list) {
    const buf = f?.data ? Buffer.from(String(f.data), "base64") : Buffer.alloc(0)
    total += buf.length
    if (total > MAX_UPLOAD_TOTAL) throw new Error(`upload payload too large (max ${Math.round(MAX_UPLOAD_TOTAL / 1024 / 1024)} MB)`)
    const path = join(UPLOADS_DIR, `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${safeFilename(f?.name)}`)
    await writeFile(path, buf)
    paths.push(path)
  }
  return paths
}

function cleanupFiles(paths) {
  setTimeout(() => {
    for (const p of paths || []) unlink(p).catch(() => {})
  }, 60_000)
}

// ---------------------------------------------------------------------
// Credential vault — what the user entrusts to PICC (optional).
// ---------------------------------------------------------------------
async function readVault() {
  try {
    return JSON.parse(await readFile(VAULT_FILE, "utf8"))
  } catch {
    return {}
  }
}

async function writeVault(vault) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    await writeFile(VAULT_FILE, JSON.stringify(vault, null, 2), "utf8")
    return true
  } catch (err) {
    console.warn("[picc-browser] vault write failed:", err.message)
    return false
  }
}

export async function getVaultSites() {
  return Object.keys(await readVault())
}

export async function getSiteCredentials(site) {
  const vault = await readVault()
  const creds = vault[String(site || "").trim().toLowerCase()]
  if (!creds) return null
  return { site, username: creds.username ?? "", password: creds.password ?? "", updatedAt: creds.updatedAt ?? null }
}

export async function saveSiteCredentials(site, { username = "", password = "" } = {}) {
  const key = String(site || "").trim().toLowerCase()
  if (!key) throw new Error("site is required")
  const vault = await readVault()
  vault[key] = { username: String(username || ""), password: String(password || ""), updatedAt: new Date().toISOString() }
  await writeVault(vault)
  return { ok: true, site: key, saved: true }
}

export async function deleteSiteCredentials(site) {
  const key = String(site || "").trim().toLowerCase()
  const vault = await readVault()
  if (!vault[key]) return { ok: true, deleted: false }
  delete vault[key]
  await writeVault(vault)
  return { ok: true, deleted: true }
}

// ---------------------------------------------------------------------
// Browser settings — general behavior (headless/stealth/profile/homepage,
// DevTools, downloads) plus Chrome-style per-site permissions. These live
// inside the browser itself, exactly like Chrome's own settings: PICC's other
// features (forecast, connectors, …) can drive the browser, but the browser's
// own behavior is configured here and applies to every PICC feature that
// shares the browser.
// ---------------------------------------------------------------------
const SETTINGS_FILE = join(DATA_DIR, "browser-settings.json")
const PERMISSIONS_FILE = join(DATA_DIR, "browser-site-permissions.json")
const PREFS_FILE = join(DATA_DIR, "browser-preferences.json")

/** Chrome permission names understood by CDP Browser.setPermission. */
export const PERMISSION_CATALOG = [
  ["notifications", "Notifications"],
  ["geolocation", "Location"],
  ["camera", "Camera"],
  ["microphone", "Microphone"],
  ["clipboardReadWrite", "Clipboard read/write"],
  ["clipboardSanitizedWrite", "Clipboard sanitized write"],
  ["displayCapture", "Screen capture"],
  ["idleDetection", "Idle detection"],
  ["midi", "MIDI devices"],
  ["midiSysex", "MIDI (SysEx)"],
  ["backgroundSync", "Background sync"],
  ["paymentHandler", "Payment handler"],
  ["storageAccess", "Storage access"],
  ["fullscreen", "Fullscreen"],
  ["serial", "Serial ports"],
  ["usb", "USB devices"]
].map(([name, label]) => ({ name, label }))

const DEFAULT_SETTINGS = {
  // Pages always render in PICC's own embedded engine and stream to the
  // content window — a separate Chrome/Edge window is never spawned.
  stealth: true,
  // Humanized interaction — types with variable per-key latency instead of
  // instant insertText. On by default; disable for debugging.
  humanizeInput: true,
  defaultProfile: "studio",
  homepage: "",
  devTools: false,
  downloadsDir: "",
  // "Real profile" mode: point the in-app browser at a snapshot of your own
  // logged-in browser so login/Google OAuth behave like a normal returning
  // browser instead of a fresh automation profile.
  useRealProfile: false,
  realProfilePath: "",
  // Fingerprint overrides — empty means "follow the OS" (recommended).
  timezone: "",
  locale: "",
  // PICC "only refresh when active". Background tabs are hard-frozen (CDP
  // Page.setWebLifecycleState frozen) after `tabFreezeMs` of inactivity — long
  // enough for heavy suites to spin down first. A SUITE deactivates after
  // `suiteDeactivateMs` without any tab in that suite being active; note this
  // is deliberately longer than the tab timeout and is suite-scoped, because
  // multiple sites can share one suite at the same time (e.g. two trading
  // platforms, both on the trading suite). Both are configurable. The
  // live-stream tab (app.expertoption.com) is never frozen.
  tabFreezeMs: 90_000,
  suiteDeactivateMs: 600_000,
  // Screencast performance profile: "auto" picks by host cores/RAM (Core Duo
  // class → low), or force "low" | "medium" | "high". Lower = fewer frames,
  // smaller/softer JPEGs = far less CPU/RAM on weak machines.
  perfMode: "auto"
}

async function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(SETTINGS_FILE, "utf8")) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function writeSettings(settings) {
  const next = { ...(await readSettings()), ...settings }
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8")
  } catch (err) {
    console.warn("[picc-browser] settings write failed:", err.message)
  }
  return next
}

export async function getBrowserSettings() {
  return await readSettings()
}

export async function saveBrowserSettings(partial = {}) {
  const allowed = Object.keys(DEFAULT_SETTINGS)
  const clean = {}
  for (const key of allowed) {
    if (key in partial) clean[key] = partial[key]
  }
  const next = await writeSettings(clean)
  if (clean.tabFreezeMs != null || clean.suiteDeactivateMs != null) {
    PAUSE_CFG = {
      tabFreezeMs: Number(next.tabFreezeMs) || 90_000,
      suiteDeactivateMs: Number(next.suiteDeactivateMs) || 600_000
    }
  }
  if (clean.humanizeInput != null) {
    HUMANIZE_INPUT = process.env.PICC_HUMANIZE === "0" ? false : next.humanizeInput !== false
  }
  if (clean.perfMode != null) {
    studio.perf = resolvePerf(next)
    // A live session picks up the new profile immediately (stop forces the
    // idempotent guard in startScreencast to rebuild the session with the
    // new quality/resolution/fps).
    if (studio.open) {
      void stopScreencast().then(() => startScreencast()).catch(() => {})
    }
  }
  return next
}

async function readSitePermissions() {
  try {
    return JSON.parse(await readFile(PERMISSIONS_FILE, "utf8")) || {}
  } catch {
    return {}
  }
}

async function writeSitePermissions(perms) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    await writeFile(PERMISSIONS_FILE, JSON.stringify(perms, null, 2), "utf8")
  } catch (err) {
    console.warn("[picc-browser] permissions write failed:", err.message)
  }
}

export function originOf(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`
  } catch {
    return ""
  }
}

/** Chrome-style per-origin permission settings, e.g. { "https://x.com": { notifications: "allow", ... } } */
export async function getSitePermissions() {
  return await readSitePermissions()
}

export async function setSitePermission(origin, permission, setting) {
  if (!/^allow|block|ask$/.test(String(setting))) throw new Error("setting must be allow | block | ask")
  const cleanOrigin = originOf(origin) || String(origin || "").trim()
  if (!cleanOrigin) throw new Error("origin is required")
  const perms = await readSitePermissions()
  if (!perms[cleanOrigin]) perms[cleanOrigin] = {}
  perms[cleanOrigin][permission] = setting
  await writeSitePermissions(perms)
  if (studio.open && studio.bridge) {
    await applyPermissionsFor(cleanOrigin).catch(() => {})
  }
  return { ok: true, origin: cleanOrigin, permission, setting }
}

export async function removeSitePermissions(origin) {
  const cleanOrigin = originOf(origin) || String(origin || "").trim()
  if (!cleanOrigin) return { ok: true, deleted: false }
  const perms = await readSitePermissions()
  const deleted = Boolean(perms[cleanOrigin])
  delete perms[cleanOrigin]
  await writeSitePermissions(perms)
  return { ok: true, deleted }
}

/**
 * Apply stored permissions for an origin to the live page via CDP — the same
 * mechanism Chrome's own site-settings uses. Best-effort: missing/unsupported
 * permissions are ignored.
 */
async function applyPermissionsFor(origin) {
  const page = activePage()
  if (!page || page.isClosed()) return
  const perms = (await readSitePermissions())[origin]
  if (!perms) return
  let cdp = null
  try {
    cdp = await studio.bridge.context.newCDPSession(page)
    for (const [name, setting] of Object.entries(perms)) {
      if (setting === "ask") continue
      await cdp
        .send("Browser.setPermission", {
          permission: { name },
          setting: setting === "allow" ? "granted" : "denied",
          origin
        })
        .catch(() => {})
    }
  } catch {
    /* best-effort */
  } finally {
    try {
      if (cdp) await cdp.detach()
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------
// Per-source browser preferences — every income source (connector/catalog
// entry) can pin its own browser behavior: which profile to sign in with,
// embedded vs real window, and the dashboard homepage PICC navigates to.
// This is how PICC's other categories control the browser via their own
// settings pages.
// ---------------------------------------------------------------------
async function readPrefs() {
  try {
    return JSON.parse(await readFile(PREFS_FILE, "utf8")) || {}
  } catch {
    return {}
  }
}

async function writePrefs(prefs) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    await writeFile(PREFS_FILE, JSON.stringify(prefs, null, 2), "utf8")
  } catch (err) {
    console.warn("[picc-browser] prefs write failed:", err.message)
  }
}

export async function getBrowserPreferences() {
  return await readPrefs()
}

export async function saveBrowserPreference(site, prefs = {}) {
  const key = String(site || "").trim().toLowerCase()
  if (!key) throw new Error("site is required")
  const all = await readPrefs()
  const existing = all[key] || {}

  // Deep-merge overlaySettings (dockables, dockableLayout, features are nested)
  let mergedOverlaySettings = existing.overlaySettings
  if (prefs.overlaySettings) {
    const ex = existing.overlaySettings || {}
    const nw = prefs.overlaySettings
    // Deep-merge dockableLayout per-dockable
    const exLayout = ex.dockableLayout || {}
    const nwLayout = nw.dockableLayout || {}
    const mergedLayout = {}
    const allDockIds = new Set([...Object.keys(exLayout), ...Object.keys(nwLayout)])
    for (const did of allDockIds) {
      mergedLayout[did] = { ...(exLayout[did] || {}), ...(nwLayout[did] || {}) }
    }
    mergedOverlaySettings = {
      ...ex,
      ...nw,
      position: { ...(ex.position || {}), ...(nw.position || {}) },
      size: { ...(ex.size || {}), ...(nw.size || {}) },
      features: { ...(ex.features || {}), ...(nw.features || {}) },
      dockables: { ...(ex.dockables || {}), ...(nw.dockables || {}) },
      dockableLayout: mergedLayout,
    }
  }

  all[key] = {
    profile: String(prefs.profile || "").trim() || existing.profile,
    headless: typeof prefs.headless === "boolean" ? prefs.headless : existing.headless,
    homepage: String(prefs.homepage || "").trim() || existing.homepage,
    overlay: typeof prefs.overlay === "boolean" ? prefs.overlay : existing.overlay,
    overlaySettings: mergedOverlaySettings
  }
  await writePrefs(all)
  return { ok: true, site: key, prefs: all[key] }
}

// ---------------------------------------------------------------------
// Suite default presets — per-suite-type default overlay settings
// Stored under the "suites" key in browser-preferences.json
// ---------------------------------------------------------------------

export async function getSuitePresets() {
  const all = await readPrefs()
  return all.suites || {}
}

export async function saveSuitePreset(suiteId, overlaySettings) {
  const key = String(suiteId || "").trim().toLowerCase()
  if (!key) throw new Error("suiteId is required")
  const all = await readPrefs()
  if (!all.suites) all.suites = {}
  const existing = all.suites[key] || {}
  // Deep-merge dockableLayout per-dockable
  const exLayout = existing.dockableLayout || {}
  const nwLayout = overlaySettings.dockableLayout || {}
  const mergedLayout = {}
  const allDockIds = new Set([...Object.keys(exLayout), ...Object.keys(nwLayout)])
  for (const did of allDockIds) {
    mergedLayout[did] = { ...(exLayout[did] || {}), ...(nwLayout[did] || {}) }
  }
  all.suites[key] = {
    ...existing,
    ...overlaySettings,
    position: { ...(existing.position || {}), ...(overlaySettings.position || {}) },
    size: { ...(existing.size || {}), ...(overlaySettings.size || {}) },
    features: { ...(existing.features || {}), ...(overlaySettings.features || {}) },
    dockables: { ...(existing.dockables || {}), ...(overlaySettings.dockables || {}) },
    dockableLayout: mergedLayout,
  }
  await writePrefs(all)
  return { ok: true, suite: key, preset: all.suites[key] }
}

// ---------------------------------------------------------------------
// Site intelligence — map a URL to its catalog entry / known facts so the
// overlay can show relevant help without hitting the client TS catalog.
// ---------------------------------------------------------------------
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

const SITE_INDEX = [
  ["localhost,127.0.0.1,0.0.0.0", "picc-dashboard", "PICC Dashboard", "other", 0, "http://localhost:3000", "PICC command center — no overlay injection on this host."],
  ["dashboard.honeygain.com,honeygain.com", "honeygain", "Honeygain", "bandwidth", 20, "https://dashboard.honeygain.com", "1 credit = $0.001; Lucky Pot quest is auto-spinnable."],
  ["earnapp.com", "earnapp", "EarnApp", "bandwidth", 5, "https://earnapp.com/dashboard", "Desktop-only — ToS bans Docker/VMs/servers."],
  ["pawns.app,iproyal.com", "iproyal", "IPRoyal Pawns", "bandwidth", 5, "https://pawns.app", "Min payout $5."],
  ["packetstream.io", "packetstream", "PacketStream", "bandwidth", 5, "https://packetstream.io", "3% cashout fee."],
  ["traffmonetizer.com,app.traffmonetizer.com", "traffmonetizer", "Traffmonetizer", "bandwidth", 10, "https://traffmonetizer.com", "7-day JWT session."],
  ["repocket.com,app.repocket.co", "repocket", "Repocket", "bandwidth", 10, "https://repocket.com", "Max 5 devices; VPS ok at lower rates."],
  ["mystnodes.co,mystnodes.com", "mysterium", "Mysterium / MystNodes", "bandwidth", 0, "https://mystnodes.com", "DePIN VPN node (MYST)."],
  ["app.grass.io,getgrass.io", "grass", "Grass", "bandwidth", 0, "https://app.grass.io", "Browser-extension style node."],
  ["app.gradient.network,gradient.network", "gradient", "Gradient Network", "bandwidth", 0, "https://app.gradient.network", "Desktop node."],
  ["app.nodepay.ai,nodepay.ai", "nodepay", "Nodepay", "bandwidth", 0, "https://app.nodepay.ai", "Desktop node."],
  ["silencio.network", "silencio", "Silencio", "depin", 0, "https://www.silencio.network", "Mobile noise-mapping; daily quests."],
  ["opensea.io", "nft-royalties", "OpenSea", "nft", 0, "https://opensea.io", "Floor price / volume reads."],
  ["app.aave.com,aave.com", "defi-supply", "Aave", "defi", 0, "https://app.aave.com", "Supply stablecoins for APY."],
  ["yearn.fi", "defi-supply", "Yearn", "defi", 0, "https://yearn.fi", "Yield vaults."],
  ["luno.com", "luno", "Luno", "crypto", 0, "https://www.luno.com/my", "SC-registered DAX (MY)."],
  ["mxglobal.com.my", "mx-global", "MX Global", "crypto", 0, "https://mxglobal.com.my", "SC-registered DAX (MY)."],
  ["hata.io", "hata", "HATA Digital", "crypto", 0, "https://www.hata.io", "SC-registered DAX (MY)."],
  ["sinegy.com", "sinegy", "SINEGY DAX", "crypto", 0, "https://sinegy.com", "SC-registered DAX (MY)."],
  ["kineticdax.com", "kinetic", "Kinetic DAX", "crypto", 0, "https://kineticdax.com", "SC-registered DAX (MY)."],
  ["fundingsocieties.com.my", "funding-circle", "Funding Societies", "p2p", 0, "https://www.fundingsocieties.com.my", "SC-licensed P2P SME lending (MY)."],
  ["selangorkuasa.com", "selangor-kuasa", "Selangor Kuasa (SKS)", "p2p", 0, "https://www.selangorkuasa.com", "SC-licensed Islamic P2P (MY)."],
  ["pitik.ai", "pitik", "Pitik.ai", "p2p", 0, "https://pitik.ai", "SC-licensed agritech P2P (MY)."],
  ["aigen.dev", "aigen", "AIGEN Protocol", "agent", 0, "https://aigen.dev", "On-chain bounty protocol for AI agents."],
  ["agora.xyz", "agora", "Agora", "agent", 0, "https://agora.xyz", "Living agent + human economy ($THREE)."],
  ["app.expertoption.com,expertoption.com", "expertoption", "ExpertOption", "trading", 0, "https://app.expertoption.com/", "Read-only trading bridge."],
  ["binance.com,www.binance.com", "binance", "Binance", "trading", 0, "https://www.binance.com", "Crypto spot/futures exchange."],
  ["bybit.com,www.bybit.com", "bybit", "Bybit", "trading", 0, "https://www.bybit.com", "Crypto derivatives exchange."],
  ["kucoin.com,www.kucoin.com", "kucoin", "KuCoin", "trading", 0, "https://www.kucoin.com", "Crypto spot exchange."],
  ["okx.com,www.okx.com", "okx", "OKX", "trading", 0, "https://www.okx.com", "Crypto spot/derivatives exchange."],
  ["etoro.com,www.etoro.com", "etoro", "eToro", "trading", 0, "https://www.etoro.com", "Social copy-trading platform."],
  ["plus500.com,www.plus500.com", "plus500", "Plus500", "trading", 0, "https://www.plus500.com", "CFD trading platform."],
  ["iqoption.com,www.iqoption.com", "iqoption", "IQ Option", "trading", 0, "https://iqoption.com", "Binary options / trading platform."],
  ["olymptrade.com,www.olymptrade.com", "olymptrade", "Olymp Trade", "trading", 0, "https://olymptrade.com", "Binary options / trading platform."],
  ["deriv.com,app.deriv.com", "deriv", "Deriv", "trading", 0, "https://deriv.com", "Online trading platform."]
].map(([hosts, id, name, category, payoutThreshold, url, note]) => ({
  hosts: hosts.split(","),
  id,
  name,
  category,
  payoutThreshold,
  url,
  note
}))

export function detectSite(url = "") {
  const host = hostOf(url)
  if (!host) return null
  for (const entry of SITE_INDEX) {
    if (entry.hosts.some((h) => host === h || host.endsWith("." + h))) {
      return { ...entry, host }
    }
  }
  return { id: null, name: host, category: "other", payoutThreshold: 0, url: "", note: "No PICC profile for this site yet.", host }
}

// ---------------------------------------------------------------------
// The studio session — ONE integrated browser, N tabs, one screencast.
// ---------------------------------------------------------------------
const studio = {
  open: false,
  headless: true,
  profile: "studio",
  bridge: null,
  cdp: null,
  tabs: [],
  activeId: null,
  lastTabId: 0,
  vp: { ...DEFAULT_VIEWPORT },
  latestFrame: null,
  subscribers: new Set(),
  metaListeners: new Set(),
  startedAt: null,
  // Real-time page intelligence ring buffers (console/network/DOM/WS/dialogs).
  intel: { console: [], network: [], dom: [], ws: [], dialogs: [] },
  pendingDialogs: new Map(),
  lastDialogId: 0,
  fileChoosers: new Map(),
  lastFileChooserId: 0,
  downloads: [],
  lastDownloadId: 0,
  _intelThrottle: {},
  _lastAssistKey: null,
  _lastEOCapture: 0,
  _lastEOCaptureToken: null,
  // Screencast capture — the ack pump in `startScreencast` paces how many
  // frames Chrome may encode; `lastFrameSentAt` throttles how many reach SSE.
  perf: resolvePerf({}),
  lastFrameSentAt: 0,
  // PICC "only refresh when active" tracking.
  tabActivity: new Map(), // tabId -> last moment the tab was active/used (ms)
  frozen: new Set(), // tabIds whose page has been CDP-hard-frozen
  suiteActivity: new Map(), // suiteId -> last moment a tab in that suite was active (ms)
  _lastAssistKeys: new Map(), // tabId -> last assist dedupe key
  _pauseTimer: null,
  // Global overlay enabled flag — when true, overlays auto-inject on navigation
  // via detectSite + overlayNodesForSite. Persists across browser restarts via
  // the "global" entry in browser prefs.
  overlayEnabled: false
}

// Cached pause/freeze timeouts (refreshed from settings on open + save + each
// pause check). Synchronously readable so per-tab intel gating is cheap.
let PAUSE_CFG = { tabFreezeMs: 90_000, suiteDeactivateMs: 600_000 }
let HUMANIZE_INPUT = true

// Cap each intelligence buffer so a busy page can't leak memory.
const MAX_INTEL = { console: 300, network: 300, dom: 300, ws: 200, dialog: 30 }

function broadcast(msg) {
  for (const cb of studio.subscribers) {
    try {
      cb(msg)
    } catch {
      /* subscriber errors never break the studio */
    }
  }
  for (const cb of studio.metaListeners) {
    try {
      cb(msg)
    } catch {
      /* meta listener errors never break the studio */
    }
  }
}

/**
 * Lightweight studio event channel for listeners that only care about
 * lifecycle/navigation/assist messages. Unlike `subscribeStudio`, it never
 * starts or keeps the screencast alive.
 */
export function onStudioEvent(cb) {
  studio.metaListeners.add(cb)
  return () => studio.metaListeners.delete(cb)
}

// ---------------------------------------------------------------------
// Real-time page intelligence — the feed that keeps PICC updated on what
// happens in the browser. Every signal (console, page errors, network,
// WebSocket frames, DOM mutations, dialogs, navigation) is buffered into a
// ring buffer and broadcast to subscribers as `{type:"intel", intel:{...}}`.
// ---------------------------------------------------------------------
function intelItem(category, data, tabId) {
  const item = { ts: Date.now(), category, tabId: tabId ?? null, ...data }
  const buf = studio.intel[category]
  if (buf) {
    buf.push(item)
    if (buf.length > MAX_INTEL[category]) buf.shift()
  }
  return item
}

function pushIntel(category, data, tabId, { throttle = 0 } = {}) {
  if (!studio.open) return
  // PICC pauses its own per-tab work when the tab is neither active nor in an
  // active suite. Dialogs and console errors always flow — they need handling
  // no matter what, and frozen pages emit nothing anyway.
  if (category !== "dialog" && category !== "console") {
    if (tabId != null && !tabPICCActive(tabId)) return
  }
  const item = intelItem(category, data, tabId)
  if (throttle) {
    const key = `${category}:${tabId ?? "x"}`
    const last = studio._intelThrottle[key] ?? 0
    if (item.ts - last < throttle) return
    studio._intelThrottle[key] = item.ts
  }
  broadcast({ type: "intel", intel: { category, data: item } })
}

const truncate = (s, n) => (s == null ? "" : String(s).length > n ? `${String(s).slice(0, n)}…` : String(s))

/** Broadcast live site assistance (detected profile + saved credentials). */
async function pushAssist(tabId, url, force = false) {
  try {
    const site = detectSite(url)
    if (!site || !site.host) return
    // Dedupe per-tab on host+category so navigating within the same host (but
    // into a different category) re-fires, while page-to-page nav on one site
    // stays quiet. `force` bypasses dedupe so switching back to a tab re-sends
    // its assist (the client keys the rendered suite to the ACTIVE tab).
    const key = `${site.host}|${site.category ?? ""}`
    if (!force && studio._lastAssistKeys.get(tabId) === key) return
    studio._lastAssistKeys.set(tabId, key)
    const hasSavedCredentials = Boolean(site.id && (await getSiteCredentials(site.id)))
    broadcast({ type: "assist", assist: { site, suite: suiteForSite(site), hasSavedCredentials, tabId: tabId ?? null } })
  } catch {
    /* live assist is best-effort */
  }
}

// Serialize mutating control ops (tab new/close/switch) so concurrent clicks
// can't race on the shared CDP screencast session.
let opQueue = Promise.resolve()
function serial(fn) {
  const run = opQueue.then(fn, fn)
  opQueue = run.catch(() => {})
  return run
}

function tabPublic(t) {
  return { id: t.id, url: t.url, title: t.title, active: t.id === studio.activeId, auth: t.auth ?? null }
}

function tabsPayload() {
  return {
    type: "tabs",
    tabs: studio.tabs.map(tabPublic),
    activeTabId: studio.activeId
  }
}

/**
 * Instrument one page of the managed browser with the real-time intelligence
 * feed: console, page errors, network requests/responses/failures, WebSocket
 * frames, downloads, dialogs, DOM mutations and navigation. Every signal is
 * buffered and broadcast so PICC stays updated on what the page is doing.
 */
function wirePage(page, tabId) {
  if (!page || page.isClosed() || page.__piccWired) return
  page.__piccWired = true
  const id = tabId

  // Expose the toggle function so the injected script can call back to Node.js.
  page.exposeFunction("__picc_overlay_toggle", async () => {
    try {
      await studioOverlayToggle()
    } catch { /* best-effort */ }
  }).catch(() => { /* already exposed on this page — harmless */ })

  // Expose close: removes overlays and disables intervention.
  page.exposeFunction("__picc_overlay_close", async () => {
    try {
      await studioOverlayToggle(false)
    } catch { /* best-effort */ }
  }).catch(() => { /* already exposed — harmless */ })

  // Inject keyboard shortcut (Ctrl+Alt+Shift+O) into the current page.
  // addInitScript only fires on future navigations, so we also evaluate
  // directly to cover the already-loaded page.
  const injectKb = () => {
    page.evaluate(() => {
      if (window.__picc_kb_listener) return
      window.__picc_kb_listener = true
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey && e.key.toLowerCase() === "o") {
          e.preventDefault()
          e.stopPropagation()
          window.__picc_overlay_toggle?.()
        }
      }, true)
    }).catch(() => { /* page may be closed or navigating */ })
  }
  injectKb()
  // Also fire on every future document load (covers navigations after wiring).
  page.addInitScript(() => {
    if (window.__picc_kb_listener) return
    window.__picc_kb_listener = true
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault()
        e.stopPropagation()
        window.__picc_overlay_toggle?.()
      }
    }, true)
  })

  page.on("console", (msg) => {
    const type = msg.type()
    const critical = type === "error"
    pushIntel("console", { type, text: truncate(msg.text(), 800), url: truncate(msg.location()?.url ?? "", 300) }, id, {
      throttle: critical ? 0 : 250
    })
  })
  page.on("pageerror", (err) => {
    pushIntel("console", { type: "error", pageerror: true, text: truncate(String(err?.message ?? err), 800), stack: truncate(String(err?.stack ?? ""), 1200) }, id)
  })

  page.on("request", (req) => {
    const rtype = req.resourceType()
    if (["image", "font", "stylesheet", "media"].includes(rtype)) return
    pushIntel("network", { dir: "req", method: req.method(), url: truncate(req.url(), 500), type: rtype }, id, { throttle: 200 })
  })
  page.on("response", (res) => {
    const rtype = res.request().resourceType()
    if (["image", "font", "media"].includes(rtype)) return
    pushIntel("network", { dir: "res", method: res.request().method(), url: truncate(res.url(), 500), status: res.status(), type: rtype }, id, { throttle: 200 })
  })
  page.on("requestfailed", (req) => {
    pushIntel("network", { dir: "fail", method: req.method(), url: truncate(req.url(), 500), type: req.resourceType(), error: truncate(req.failure()?.errorText ?? "failed", 200) }, id)
  })

  page.on("websocket", (ws) => {
    pushIntel("ws", { dir: "open", url: truncate(ws.url(), 400) }, id)
    ws.on("framesent", (e) => pushIntel("ws", { dir: "sent", payload: truncate(String(e.payload ?? ""), 400) }, id, { throttle: 150 }))
    ws.on("framereceived", (e) => pushIntel("ws", { dir: "recv", payload: truncate(String(e.payload ?? ""), 400) }, id, { throttle: 150 }))
    ws.on("close", () => pushIntel("ws", { dir: "close" }, id))
  })

  page.on("download", (d) => {
    pushIntel("network", { dir: "download", url: truncate(d.url(), 500), suggested: truncate(d.suggestedFilename?.() ?? "", 200) }, id)
    const dlId = ++studio.lastDownloadId
    const entry = {
      id: dlId,
      tabId: id,
      url: truncate(d.url(), 500),
      filename: truncate(d.suggestedFilename?.() ?? "download.bin", 200),
      ts: Date.now()
    }
    studio.downloads.push({ download: d, entry })
    if (studio.downloads.length > MAX_DOWNLOADS) studio.downloads.shift()
    broadcast({ type: "download", download: entry })
  })

  page.on("filechooser", (chooser) => {
    const fcId = ++studio.lastFileChooserId
    const entry = {
      id: fcId,
      tabId: id,
      multiple: Boolean(chooser.isMultiple?.()),
      accept: truncate(String(chooser.accept?.() ?? ""), 200),
      ts: Date.now()
    }
    studio.fileChoosers.set(fcId, { chooser, entry })
    broadcast({ type: "filechooser", filechooser: entry })
    // The chooser hangs the page while open — auto-expire it after 2 minutes.
    const auto = setTimeout(() => studio.fileChoosers.delete(fcId), 120_000)
    auto.unref?.()
  })

  page.on("dialog", (dlg) => {
    const dlgId = ++studio.lastDialogId
    const entry = {
      id: dlgId,
      type: dlg.type(),
      message: truncate(dlg.message(), 600),
      defaultValue: truncate(dlg.defaultValue?.() ?? "", 300),
      ts: Date.now(),
      tabId: id
    }
    studio.pendingDialogs.set(dlgId, { dialog: dlg, entry })
    intelItem("dialog", entry, id)
    broadcast({ type: "intel", intel: { category: "dialog", data: entry } })
    // Never let the page hang: auto-respond if the human hasn't within 60s.
    const auto = setTimeout(() => {
      void studioDialog({ id: dlgId, action: dlg.type() === "beforeunload" ? "dismiss" : dlg.type() === "prompt" ? "type" : "accept", text: "" })
    }, 60_000)
    auto.unref?.()
  })

  installDomWatcher(page, id)

  page.on("framenavigated", () => {
    const url = page.url()
    pushIntel("navigation", { url: truncate(url, 500), title: "" }, id)
    void pushAssist(id, url)
    void refreshTabLogin(id)
    if (studio.overlayEnabled) void injectOverlayForCurrentPage()
  })
  page.on("domcontentloaded", () => void refreshTabLogin(id))
}

/**
 * Inject a MutationObserver into the page that reports compact DOM mutations
 * (attribute/text/childList) in real time, batched every ~250ms. Our own
 * overlay node is ignored. `page.exposeFunction` persists across navigations;
 * the observer itself is reinstalled on each `domcontentloaded`.
 *
 * The observer runs INSIDE the embedded browser, so it is throttled by the
 * performance profile: low = off entirely (the page's CPU is the scarce
 * resource), medium = structural changes only (childList, the cheapest and
 * most informative class), high = full attribute/text/child coverage.
 */
function domWatcherScope() {
  const mode = studio.perf?.mode ?? "high"
  if (mode === "low") return null
  if (mode === "medium") return { childList: true, subtree: true }
  return { childList: true, subtree: true, attributes: true, characterData: true }
}

async function installDomWatcher(page, id) {
  const scope = domWatcherScope()
  if (!scope) return
  try {
    await page.exposeFunction("__piccDom", (batchJson) => {
      try {
        const batch = JSON.parse(batchJson)
        for (const m of batch) pushIntel("dom", m, id, { throttle: 150 })
      } catch {
        /* malformed batch */
      }
    })
  } catch {
    return
  }
  const install = () => {
    if (page.isClosed()) return
    page
      .evaluate(
        (observeScope) => {
          if (window.__piccDomWatcher) return
          const send = window.__piccDom
          const queue = []
          let timer = 0
          const flush = () => {
            timer = 0
            if (queue.length) {
              const batch = queue.splice(0, 500)
              try {
                send(JSON.stringify(batch))
              } catch {
                /* page context gone */
              }
            }
          }
          const mo = new MutationObserver((records) => {
            for (const r of records) {
              const t = r.target
              if (t && t.nodeType === 1) {
                const el = t
                if (el.id === "__PICC_OVERLAY__" || (el.closest && el.closest("#__PICC_OVERLAY__"))) continue
              }
              const out = { t: r.type }
              if (t && t.nodeType === 1) {
                out.tag = String(t.tagName || "").toLowerCase()
                if (t.id) out.id = String(t.id).slice(0, 60)
                if (t.className && typeof t.className === "string") out.cls = String(t.className).slice(0, 80)
              }
              if (r.type === "characterData" && t && t.parentNode) {
                out.text = String(t.parentNode.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120)
              } else if (r.type === "attributes" && t) {
                out.attr = r.attributeName
                out.val = String((t.getAttribute && t.getAttribute(r.attributeName)) || "").slice(0, 120)
              } else if (r.type === "childList") {
                out.added = r.addedNodes ? r.addedNodes.length : 0
                out.removed = r.removedNodes ? r.removedNodes.length : 0
              }
              if (out.t === "childList" && !out.added && !out.removed) continue
              if (queue.length > 1000) queue.length = 0
              queue.push(out)
            }
            if (!timer) timer = setTimeout(flush, 250)
          })
          try {
            mo.observe(document.documentElement, observeScope)
            window.__piccDomWatcher = mo
          } catch {
            /* documentElement unavailable yet */
          }
        },
        scope
      )
      .catch(() => {})
  }
  install()
  page.on("domcontentloaded", install)
}

function bumpTabMeta(page, tab) {
  if (!page || page.isClosed()) return
  const update = async () => {
    touchTabActivity(tab.id)
    tab.url = page.url()
    tab.title = String((await page.title().catch(() => "")) ?? "").slice(0, 120)
    broadcast(tabsPayload())
  }
  page.on("framenavigated", update)
  try {
    void update()
  } catch {
    /* ignore */
  }
}

function activePage() {
  return studio.tabs.find((t) => t.id === studio.activeId)?.page ?? null
}

const livePage = (p) => Boolean(p && !p.isClosed())

// ---------------------------------------------------------------------
// "Only refresh when active" — per-tab activity, suite activity, and
// configurable pause/freeze of background tabs.
// ---------------------------------------------------------------------
/** True for the tab that feeds the ExpertOption live stream — never frozen. */
function isLiveStreamTab(tab) {
  if (!tab?.url) return false
  try {
    return /(?:^|\.)expertoption\.com$/i.test(new URL(tab.url).hostname)
  } catch {
    return /expertoption\.com/i.test(tab.url)
  }
}

/** The suite id a tab belongs to (its detected site's suite, else category). */
function suiteIdForTab(tab) {
  try {
    const site = detectSite(tab?.url ?? "")
    return suiteForSite(site)?.id ?? (site?.category ?? "other")
  } catch {
    return "other"
  }
}

/** Record that a tab was just used/active; refreshes both its own activity and
 * the suite it belongs to (a suite is shared by every site of that type). */
function touchTabActivity(tabId) {
  if (tabId == null) return
  studio.tabActivity.set(tabId, Date.now())
  const tab = studio.tabs.find((t) => t.id === tabId)
  if (tab) studio.suiteActivity.set(suiteIdForTab(tab), Date.now())
}

/** Whether a suite's PICC work should still run (any tab in it was active
 * within `suiteDeactivateMs`). Suite timeouts are longer than tab timeouts. */
function isSuiteActive(suiteId) {
  if (!suiteId) return false
  const last = studio.suiteActivity.get(suiteId) ?? 0
  return Date.now() - last < PAUSE_CFG.suiteDeactivateMs
}

/** Whether PICC should keep doing per-tab work for a background tab: yes while
 * its suite is still active (grace window), no once the suite deactivated. */
function tabPICCActive(tabId) {
  if (tabId == null || tabId === studio.activeId) return true
  const tab = studio.tabs.find((t) => t.id === tabId)
  if (!tab) return false
  return isSuiteActive(suiteIdForTab(tab))
}

async function freezeTab(tab) {
  if (!tab || tab.id === studio.activeId || studio.frozen.has(tab.id)) return
  if (isLiveStreamTab(tab)) return // the live EO stream must keep running
  studio.frozen.add(tab.id)
  const cdp = await studio.bridge?.context?.newCDPSession(tab.page).catch(() => null)
  if (!cdp) return
  try {
    await cdp.send("Page.enable").catch(() => {})
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" }).catch(() => {})
  } catch {
    /* non-fatal */
  } finally {
    await cdp.detach().catch(() => {})
  }
}

async function resumeTab(tab) {
  if (!tab || !studio.frozen.delete(tab.id)) return
  const cdp = await studio.bridge?.context?.newCDPSession(tab.page).catch(() => null)
  if (!cdp) return
  try {
    await cdp.send("Page.enable").catch(() => {})
    await cdp.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {})
  } catch {
    /* non-fatal */
  } finally {
    await cdp.detach().catch(() => {})
  }
}

/** Background sweep: refresh the timeout config, then hard-freeze every tab
 * that has been inactive for `tabFreezeMs`. Runs every few seconds while open. */
async function pauseCheck() {
  if (!studio.open) return
  const s = await readSettings().catch(() => null)
  if (s) {
    PAUSE_CFG = {
      tabFreezeMs: Number(s.tabFreezeMs) || 90_000,
      suiteDeactivateMs: Number(s.suiteDeactivateMs) || 600_000
    }
    HUMANIZE_INPUT = process.env.PICC_HUMANIZE === "0" ? false : s.humanizeInput !== false
  }
  const now = Date.now()
  for (const tab of studio.tabs) {
    if (tab.id === studio.activeId) {
      await resumeTab(tab)
      continue
    }
    const last = studio.tabActivity.get(tab.id) ?? 0
    if (now - last >= PAUSE_CFG.tabFreezeMs) await freezeTab(tab)
  }
}

function startPauseScheduler() {
  if (studio._pauseTimer) return
  studio._pauseTimer = setInterval(() => void pauseCheck(), 15_000)
  studio._pauseTimer.unref?.()
}

function stopPauseScheduler() {
  if (studio._pauseTimer) {
    clearInterval(studio._pauseTimer)
    studio._pauseTimer = null
  }
  for (const tab of studio.tabs) {
    studio.frozen.delete(tab.id)
    void resumeTab(tab)
  }
}

/**
 * Guarantee a live active page while the studio is open. During the brief
 * open→sync window (and right after closeStudio empties the tab list) the
 * active page can be null — without this, callers crashed with
 * "Cannot read properties of null (reading 'goto')". Self-heals by resyncing
 * tabs and creating a page only when the bridge has none.
 */
async function ensureActivePage() {
  const current = activePage()
  if (livePage(current)) return current
  await syncTabs()
  const resynced = activePage()
  if (livePage(resynced)) return resynced
  if (!studio.bridge?.context) return null
  return serial(async () => {
    const recheck = activePage()
    if (livePage(recheck)) return recheck
    const page = await studio.bridge.context.newPage().catch(() => null)
    if (!page) return null
    const tab = { id: ++studio.lastTabId, page, title: "New tab", url: "about:blank" }
    studio.tabs.push(tab)
    wirePage(page, tab.id)
    bumpTabMeta(page, tab)
    studio.activeId = tab.id
    touchTabActivity(tab.id)
    return page
  })
}

async function syncTabs() {
  const pages = studio.bridge?.context?.pages?.() ?? []
  for (const p of pages) {
    if (!studio.tabs.some((t) => t.page === p)) {
      const id = ++studio.lastTabId
      const tab = { id, page: p, title: "", url: p.url() }
      studio.tabs.push(tab)
      wirePage(p, tab.id)
      bumpTabMeta(p, tab)
      if (!studio.activeId) {
        studio.activeId = id
        touchTabActivity(id)
      }
    }
  }
  if (studio.activeId && !studio.tabs.some((t) => t.id === studio.activeId)) {
    studio.activeId = studio.tabs[0]?.id ?? null
    if (studio.activeId) touchTabActivity(studio.activeId)
  }
}

// ---- Screencast pump state (module-level, paired with studio.cdp) ----
// Chrome only produces a CDP screencast frame on a repaint, but with
// immediate acks a busy page (charts, video, autopilot clicks) can push
// frames at up to 60fps — each one a full JPEG encode at 1440x900+, which
// is the real CPU/RAM killer on weak machines. Instead of acking instantly
// we hold the ack and release it after a cadence, capping how many frames
// Chrome may encode. Frames that are byte-identical to the last broadcast
// are never re-sent (static pages / cursor blinks), and once a page has
// been visually static for `idleAfterMs` the cadence drops to the idle rate.
let screencastPage = null
let screencastClosed = false
let pendingAckId = null
let ackTimer = null
let lastChangedAt = 0
let lastBroadcastData = null
let lastFailLogAt = 0

function clearScreencastPump() {
  if (ackTimer) {
    clearTimeout(ackTimer)
    ackTimer = null
  }
  pendingAckId = null
  screencastPage = null
  lastChangedAt = 0
  lastBroadcastData = null
}

function screencastCadence() {
  const perf = studio.perf
  const idle = Date.now() - lastChangedAt > (perf?.idleAfterMs ?? 1200)
  return 1000 / (idle ? perf?.idleFps ?? 3 : perf?.captureFps ?? 15)
}

function ackScreencastFrame() {
  if (pendingAckId == null) return
  const id = pendingAckId
  pendingAckId = null
  studio.cdp?.send("Page.screencastFrameAck", { sessionId: id }).catch(() => {})
}

function onScreencastFrame(e) {
  const data = e.data ?? ""
  const now = Date.now()
  studio.latestFrame = { data, ts: now, vp: { ...studio.vp } }
  const changed = data !== lastBroadcastData
  if (changed) {
    lastChangedAt = now
    lastBroadcastData = data
    const minGap = 1000 / (studio.perf?.captureFps ?? 15)
    if (now - studio.lastFrameSentAt >= minGap) {
      studio.lastFrameSentAt = now
      broadcast({ type: "frame", data, ts: now, vp: { ...studio.vp } })
    }
  }
  pendingAckId = e.sessionId
  if (!ackTimer) {
    ackTimer = setTimeout(() => {
      ackTimer = null
      ackScreencastFrame()
    }, screencastCadence())
  }
}

async function startScreencast() {
  const page = activePage()
  if (!page || page.isClosed()) return
  // Already pumping for this exact page — reuse the live session instead of
  // detaching/restarting (session churn is expensive and mid-navigation it
  // surfaces as "Target … closed" errors).
  if (studio.cdp && !screencastClosed && screencastPage === page) return
  try {
    if (studio.cdp) {
      await studio.cdp.detach().catch(() => {})
      studio.cdp = null
    }
    clearScreencastPump()
    const cdp = await studio.bridge.context.newCDPSession(page)
    studio.cdp = cdp
    screencastPage = page
    screencastClosed = false
    const perf = studio.perf ?? PERF_MODES.high
    cdp.on("Page.screencastFrame", onScreencastFrame)
    cdp.on("Page.frameResized", (e) => {
      const m = e?.metadata?.viewport
      if (m?.width && m?.height) studio.vp = { width: m.width, height: m.height }
    })
    cdp.on("disconnected", () => {
      studio.cdp = null
      screencastClosed = true
      clearScreencastPump()
    })
    await cdp.send("Page.enable")
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: perf.quality,
      everyNthFrame: 1,
      maxWidth: Math.min(Math.round(studio.vp.width * perf.scale), perf.maxW),
      maxHeight: Math.min(Math.round(studio.vp.height * perf.scale), perf.maxH)
    })
    const vs = page.viewportSize()
    if (vs?.width && vs?.height) studio.vp = { width: vs.width, height: vs.height }
  } catch (err) {
    // "Target page, context or browser has been closed" mid-navigation and on
    // tab close is EXPECTED — the session died with its target. Log it at most
    // once per 30s so a busy session can't spam the console.
    const msg = String(err?.message ?? err)
    const expected = /(target|page|context|browser|session).*(closed|detached|crash|destroyed)|is already running|connection closed/i.test(msg)
    const now = Date.now()
    if (!expected || now - lastFailLogAt > 30_000) {
      console.warn(`[picc-browser] screencast ${expected ? "session ended" : "failed"}:`, msg)
      lastFailLogAt = now
    }
    try {
      if (studio.cdp) await studio.cdp.detach()
    } catch {
      /* ignore */
    }
    studio.cdp = null
    clearScreencastPump()
  }
}

async function stopScreencast() {
  try {
    if (studio.cdp) {
      await studio.cdp.send("Page.stopScreencast").catch(() => {})
      await studio.cdp.detach().catch(() => {})
    }
  } catch {
    /* ignore */
  }
  studio.cdp = null
  clearScreencastPump()
}

// ---------------------------------------------------------------------
// Public session API
// ---------------------------------------------------------------------
export function studioStatus() {
  const active = studio.tabs.find((t) => t.id === studio.activeId)
  const currentSite = active?.url ? detectSite(active.url) : null
  return {
    ok: true,
    open: studio.open,
    available: browserAvailable(),
    headless: studio.headless,
    profile: studio.profile,
    startedAt: studio.startedAt,
    tabs: studio.tabs.map(tabPublic),
    activeTabId: studio.activeId,
    currentUrl: active?.url ?? null,
    currentTitle: active?.title ?? null,
    currentSite,
    currentAuth: active?.auth ?? null,
    suite: suiteForSite(currentSite),
    viewport: { ...studio.vp },
    latestFrameAt: studio.latestFrame?.ts ?? null,
    subscriberCount: studio.subscribers.size,
    perf: studio.perf
      ? {
          mode: studio.perf.mode,
          auto: studio.perf.auto,
          captureFps: studio.perf.captureFps,
          idleFps: studio.perf.idleFps,
          quality: studio.perf.quality
        }
      : null,
    pause: {
      frozenCount: studio.frozen.size,
      activeSuite: [...studio.suiteActivity.entries()]
        .filter(([, at]) => Date.now() - at < PAUSE_CFG.suiteDeactivateMs)
        .map(([id]) => id),
      tabFreezeMs: PAUSE_CFG.tabFreezeMs,
      suiteDeactivateMs: PAUSE_CFG.suiteDeactivateMs
    },
    intel: {
      console: studio.intel.console.length,
      network: studio.intel.network.length,
      dom: studio.intel.dom.length,
      ws: studio.intel.ws.length,
      dialogs: studio.intel.dialogs.length,
      pendingDialogs: studio.pendingDialogs.size,
      latestAt: Math.max(
        0,
        ...[studio.intel.console.at(-1), studio.intel.network.at(-1), studio.intel.dom.at(-1), studio.intel.ws.at(-1), studio.intel.dialogs.at(-1)].map(
          (i) => i?.ts ?? 0
        )
      )
    },
    automation: {
      running: automation.running,
      intervalMs: automation.intervalMs,
      startedAt: automation.startedAt,
      lastRun: automation.lastRun,
      lastMetrics: automation.lastMetrics,
      lastSuggestions: automation.lastSuggestions,
      lastError: automation.lastError
    }
  }
}

/**
 * Resolve the studio's headless flag. The default is a REAL, interactive
 * headed window: the user drives the session directly at full fidelity, and
 * the content window stays a live mirror of it. Pass headless:true (or set
 * PICC_STUDIO_HEADLESS=1, e.g. for headless CI / E2E runs) to keep the fully
 * embedded mirror-only session instead.
 */
export function resolveStudioHeadless(headless, env = process.env) {
  if (env?.PICC_STUDIO_HEADLESS === "1") return true
  return typeof headless === "boolean" ? headless : false
}

export async function openStudio({ headless, profile, homepage } = {}) {
  const settings = await readSettings()
  studio.perf = resolvePerf(settings)
  HUMANIZE_INPUT = process.env.PICC_HUMANIZE === "0" ? false : settings.humanizeInput !== false
  // Default: a real headed Edge window so every interaction (click, keyboard,
  // hover, drag, file dialogs, video, 2FA) is fully native. The screencast
  // still streams to the content window as a live mirror of the same session.
  const head = resolveStudioHeadless(headless, process.env)
  const prof = String(profile || settings.defaultProfile || "studio").trim() || "studio"
  const home = homepage ?? settings.homepage ?? ""
  if (studio.open && studio.bridge) {
    if (studio.headless !== head || studio.profile !== prof) {
      await closeStudio()
    } else {
      return studioStatus()
    }
  }
  if (!(await browserAvailable())) {
    const err = new Error("no browser available — install Chrome/Edge or set PICC_BROWSER_PATH")
    err.code = "NO_BROWSER"
    throw err
  }
  studio.bridge = await openBridge({
    profile: prof,
    headless: head,
    stealth: settings.stealth,
    downloadsDir: settings.downloadsDir || undefined,
    devTools: settings.devTools,
    timezone: settings.timezone || undefined,
    locale: settings.locale || undefined,
    realProfilePath: settings.useRealProfile && settings.realProfilePath ? settings.realProfilePath : undefined
  })
  studio.open = true
  studio.headless = head
  studio.profile = prof
  studio.startedAt = new Date().toISOString()
  // Restore global overlay enabled flag from prefs
  const globalPrefs = (await readPrefs())["global"] || {}
  studio.overlayEnabled = globalPrefs.overlayEnabled === true
  // If the Chromium process dies (crash, OOM, dev-server restart), clear the
  // stale open state immediately so later calls self-heal instead of erroring.
  studio.bridge.context?.on?.("close", () => {
    if (!studio.open || !studio.bridge) return
    resetStudioAfterDeath()
  })
  // New windows/popups spawned from inside a loaded site (target="_blank",
  // window.open) land as new Pages in the same context. Register each as a
  // studio tab and switch to it so the content window follows with full PICC
  // intervention, instead of leaving an orphan page with none.
  studio.bridge.context?.on?.("page", (page) => {
    void serial(async () => {
      if (!studio.open) return
      const active = activePage()
      if (active?.page === page) return
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {})
      await syncTabs()
      const tab = studio.tabs.find((t) => t.page === page)
      if (!tab) return
      studio.activeId = tab.id
      bumpTabMeta(page, tab)
      void refreshTabLogin(tab.id)
      if (studio.overlayEnabled) void injectOverlayForCurrentPage()
      await startScreencast()
      broadcast(tabsPayload())
      broadcast({ type: "status", status: studioStatus() })
    })
  })
  await syncTabs()
  await ensureActivePage()
  await startScreencast()
  startPauseScheduler()
  broadcast({ type: "status", status: studioStatus() })
  if (home) {
    const page = await ensureActivePage()
    if (page) {
      await page.goto(home, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
      const tab = studio.tabs.find((t) => t.id === studio.activeId)
      if (tab) bumpTabMeta(page, tab)
      await applyPermissionsFor(originOf(page.url())).catch(() => {})
      if (studio.overlayEnabled) void injectOverlayForCurrentPage()
    }
  }
  return studioStatus()
}

export async function closeStudio() {
  stopStudioAutomation()
  stopPauseScheduler()
  await stopScreencast()
  if (studio.bridge) await studio.bridge.close().catch(() => {})
  studio.bridge = null
  studio.cdp = null
  studio.open = false
  studio.headless = true
  studio.profile = "studio"
  studio.tabs = []
  studio.activeId = null
  studio.lastTabId = 0
  studio.latestFrame = null
  studio.tabActivity.clear()
  studio.frozen.clear()
  studio.suiteActivity.clear()
  studio._lastAssistKeys.clear()
  studio.vp = { ...DEFAULT_VIEWPORT }
  studio.intel = { console: [], network: [], dom: [], ws: [], dialogs: [] }
  studio.pendingDialogs = new Map()
  studio.lastDialogId = 0
  studio.fileChoosers = new Map()
  studio.lastFileChooserId = 0
  studio.downloads = []
  studio.lastDownloadId = 0
  studio._intelThrottle = {}
  studio._lastAssistKey = null
  studio._lastEOCapture = 0
  studio._lastEOCaptureToken = null
  broadcast({ type: "status", status: studioStatus() })
  broadcast({ type: "closed" })
  return studioStatus()
}

export function subscribeStudio(cb) {
  const wasEmpty = studio.subscribers.size === 0
  studio.subscribers.add(cb)
  if (wasEmpty && studio.open) startScreencast().catch(() => {})
  return () => {
    studio.subscribers.delete(cb)
    if (studio.subscribers.size === 0 && studio.open) stopScreencast().catch(() => {})
  }
}

export function latestStudioFrame() {
  return studio.latestFrame
}

export function studioIsOpen() {
  if (!studio.open || !studio.bridge) return false
  if (!bridgeAlive()) {
    // The browser process died behind the server's back — drop the stale state
    // so consumers get a clean "not open" instead of 400s about a closed target.
    resetStudioAfterDeath()
    return false
  }
  return true
}

/** Broadcast a message to every studio subscriber + meta listener. */
export function studioBroadcast(msg) {
  broadcast(msg)
}

/** The live Playwright page for a specific tab (null if unknown/closed). */
export function studioPageFor(tabId) {
  const tab = studio.tabs.find((t) => t.id === Number(tabId))
  if (!tab) return null
  return livePage(tab.page) ? tab.page : null
}

/** Humanized typing for the intervention engine (exported wrapper). */
export async function studioTypeText(page, text) {
  await humanType(page, text)
}

/** Snapshot of the real-time intelligence ring buffers (for late joiners). */
export function getBrowserIntel() {
  const snapshot = (a) => a.slice()
  return {
    ok: true,
    open: studio.open,
    console: snapshot(studio.intel.console),
    network: snapshot(studio.intel.network),
    dom: snapshot(studio.intel.dom),
    ws: snapshot(studio.intel.ws),
    dialogs: snapshot(studio.intel.dialogs),
    pendingDialogs: [...studio.pendingDialogs.values()].map((p) => p.entry)
  }
}

/** Respond to a native page dialog (alert/confirm/prompt/beforeunload). */
export async function studioDialog({ id, action = "accept", text = "" } = {}) {
  if (!studio.open || !studio.bridge) {
    const err = new Error("browser studio is not open")
    err.code = "BROWSER_CLOSED"
    throw err
  }
  const found = studio.pendingDialogs.get(Number(id))
  if (!found) return { ok: true, handled: false, id: Number(id) }
  studio.pendingDialogs.delete(Number(id))
  const { dialog } = found
  try {
    if (action === "dismiss") await dialog.dismiss()
    else if (action === "type") await dialog.accept(String(text ?? ""))
    else await dialog.accept()
  } catch {
    /* dialog already handled by the page */
  }
  return { ok: true, handled: true, id: Number(id) }
}

// ---------------------------------------------------------------------
// Safe automation — a read-only earnings pass plus an optional autonomous
// loop. PICC never clicks buy/withdraw or submits anything; this only reads
// the live dashboard DOM, normalizes the numbers, and surfaces suggestions
// for the human to act on.
// ---------------------------------------------------------------------
const automation = {
  running: false,
  timer: null,
  intervalMs: 60000,
  startedAt: null,
  lastRun: null,
  lastMetrics: null,
  lastSuggestions: null,
  lastError: null
}

/** Map a detected site id to the tuned connector slug that reads its DOM. */
const SITE_TO_CONNECTOR = {
  honeygain: "honeygain",
  earnapp: "earnapp",
  iproyal: "pawns",
  repocket: "repocket",
  grass: "grass",
  gradient: "gradient",
  silencio: "silencio",
  "nft-royalties": "opensea",
  "defi-supply": "aave",
  mysterium: "mysterium",
  expertoption: "expertoption"
}

export function siteToConnectorSlug(siteId) {
  return SITE_TO_CONNECTOR[String(siteId || "")] ?? null
}

// Generic label selectors for sites without a tuned connector — matches
// dashboards that spell out Balance/Today/Lifetime on the page.
const GENERIC_AUTOMATE_SELECTORS = {
  balance: ["text:Available balance", "text:Current balance", "text:Balance", "text:Credits"],
  today: ["text:Today", "text:Today's earnings", "text:Earned today", "text:Daily earnings"],
  lifetime: ["text:Lifetime earnings", "text:Total earnings", "text:Total earned", "text:Lifetime"],
  payoutThreshold: ["text:Minimum payout", "text:Payout threshold", "text:Min payout"]
}

/**
 * Human-readable suggestions from a normalized metrics snapshot. Pure, so the
 * automation loop and the tests share exactly the same phrasing.
 */
export function automationSuggestions(site, metrics) {
  const fmt = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`)
  const out = []
  if (metrics.balance != null) {
    out.push(`Balance: ${fmt(metrics.balance)}`)
    if (metrics.payoutThreshold != null && metrics.payoutThreshold > 0) {
      const pct = Math.min(100, Math.round((metrics.balance / metrics.payoutThreshold) * 100))
      out.push(
        metrics.balance >= metrics.payoutThreshold
          ? "Payout threshold reached — you can withdraw."
          : `${pct}% of the ${fmt(metrics.payoutThreshold)} payout threshold.`
      )
    }
  }
  if (metrics.today != null) out.push(`Earned today: ${fmt(metrics.today)}`)
  if (metrics.lifetime != null) out.push(`Lifetime: ${fmt(metrics.lifetime)}`)
  if (metrics.estimatedDaily != null && metrics.estimatedDaily > 0) {
    out.push(`Estimated daily: ${fmt(metrics.estimatedDaily)}`)
  }
  if (out.length === 0) {
    out.push("No readable figures yet — the selectors may need tuning, or you're not signed in.")
  }
  if (site?.note) out.push(site.note)
  return out
}

/**
 * One safe automation pass on the active tab: detect the site, pick the tuned
 * connector selectors (or generic label fallbacks), read the live DOM and
 * normalize the numbers. Read-only — nothing is clicked, typed or submitted.
 */
export async function studioAutomate() {
  ensureOpen()
  const page = await ensureActivePage()
  if (!page) {
    const err = new Error("browser is not available — open the browser first")
    err.code = "BROWSER_CLOSED"
    throw err
  }
  const url = page.url()
  const site = detectSite(url)
  const slug = siteToConnectorSlug(site?.id)
  const conn = slug ? getConnector(slug) : null
  const selectors = conn?.selectors ?? GENERIC_AUTOMATE_SELECTORS
  const snapshot = await readPage(page, selectors)
  const parse = (key) => parseAmount(snapshot[key])
  const metrics = {
    balance: parse("balance") ?? parse("floor") ?? parse("available"),
    today: parse("today") ?? parse("daily") ?? parse("volume"),
    lifetime: parse("lifetime") ?? parse("total"),
    payoutThreshold: parse("payoutThreshold"),
    estimatedDaily: parse("estimatedDaily")
  }
  return {
    ok: true,
    safe: true,
    site: site ? { id: site.id, name: site.name, category: site.category, url: site.url, host: site.host } : null,
    connector: slug,
    metrics,
    suggestions: automationSuggestions(site, metrics),
    readAt: new Date().toISOString()
  }
}

/**
 * Optional autonomous loop: reruns the safe read-only pass every intervalMs
 * and broadcasts each result on the studio stream. Never executes on the
 * site — the human reviews the suggestions.
 */
export function startStudioAutomation({ intervalMs } = {}) {
  if (automation.timer) clearInterval(automation.timer)
  automation.running = true
  automation.intervalMs = Math.max(5000, Math.round(Number(intervalMs) || 60000))
  automation.startedAt = new Date().toISOString()
  const tick = async () => {
    try {
      const result = await studioAutomate()
      automation.lastRun = new Date().toISOString()
      automation.lastMetrics = result.metrics
      automation.lastSuggestions = result.suggestions
      automation.lastError = null
      broadcast({ type: "automation", automation: { ...result, runAt: automation.lastRun } })
    } catch (err) {
      automation.lastError = err?.message ?? "unknown error"
      broadcast({ type: "automation_error", error: automation.lastError, ts: Date.now() })
    }
  }
  void tick()
  automation.timer = setInterval(tick, automation.intervalMs)
  return studioAutomationStatus()
}

export function stopStudioAutomation() {
  if (automation.timer) {
    clearInterval(automation.timer)
    automation.timer = null
  }
  automation.running = false
  return studioAutomationStatus()
}

export function studioAutomationStatus() {
  return {
    ok: true,
    running: automation.running,
    intervalMs: automation.intervalMs,
    startedAt: automation.startedAt,
    lastRun: automation.lastRun,
    lastMetrics: automation.lastMetrics,
    lastSuggestions: automation.lastSuggestions,
    lastError: automation.lastError
  }
}

// ---------------------------------------------------------------------
// Control commands
// ---------------------------------------------------------------------
/**
 * True only when the underlying Chromium is still reachable. The studio flags
 * (studio.open / studio.bridge) go stale when the browser process dies without
 * the server noticing (crash, OOM, dev-server restart killing the child). A
 * dead context makes every call fail with "Target page, context or browser has
 * been closed" — this distinguishes that case so callers can self-heal instead
 * of surfacing confusing 400s. Cheap and synchronous: pages() throws when the
 * context is gone.
 */
function bridgeAlive() {
  try {
    const ctx = studio.bridge?.context
    if (!ctx) return false
    const pages = ctx.pages?.()
    return Array.isArray(pages)
  } catch {
    return false
  }
}

/** Reset the stuck open state left behind by a crashed/killed browser. */
function resetStudioAfterDeath() {
  stopStudioAutomation()
  stopPauseScheduler()
  stopScreencast()
  if (studio.bridge) studio.bridge.close().catch(() => {})
  studio.bridge = null
  studio.cdp = null
  studio.open = false
  studio.headless = true
  studio.profile = "studio"
  studio.tabs = []
  studio.activeId = null
  studio.lastTabId = 0
  studio.latestFrame = null
  studio.vp = { ...DEFAULT_VIEWPORT }
  studio._lastEOCapture = 0
  studio._lastEOCaptureToken = null
  studio.tabActivity.clear()
  studio.frozen.clear()
  studio.suiteActivity.clear()
  studio._lastAssistKeys.clear()
  broadcast({ type: "status", status: studioStatus() })
  broadcast({ type: "closed" })
}

function ensureOpen() {
  if (!studio.open || !studio.bridge || !bridgeAlive()) {
    const err = new Error("browser studio is not open — POST /api/browser/open first")
    err.code = "BROWSER_CLOSED"
    throw err
  }
}

export async function studioGoto(url) {
  ensureOpen()
  const clean = String(url || "").trim()
  if (!clean) throw new Error("url required")
  const target = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`
  const page = await ensureActivePage()
  if (!page) {
    const err = new Error("browser is not available — open the browser first")
    err.code = "BROWSER_CLOSED"
    throw err
  }
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 })
  const tab = studio.tabs.find((t) => t.id === studio.activeId)
  if (tab) bumpTabMeta(page, tab)
  void refreshTabLogin(tab?.id ?? studio.activeId)
  await applyPermissionsFor(originOf(page.url())).catch(() => {})
  // Auto-inject overlay on navigation when overlay is globally enabled
  if (studio.overlayEnabled) {
    void injectOverlayForCurrentPage()
  }
  ackScreencastFrame()
  return { ok: true, url: page.url(), title: await page.title().catch(() => "") }
}

/**
 * Ensure the studio is open (honoring the source's saved browser preferences)
 * and navigate to a dashboard. This is the single entry point PICC's other
 * categories use to drive the browser from their own settings pages.
 */
export async function studioOpenSite({ site, url, headless, profile } = {}) {
  const key = String(site || "").trim().toLowerCase()
  const prefs = key ? (await readPrefs())[key] : null
  const target = String(url || prefs?.homepage || "").trim()
  if (!target) throw new Error("url required")
  await openStudio({
    headless: typeof headless === "boolean" ? headless : prefs?.headless,
    profile: profile || prefs?.profile,
    homepage: target
  })
  const page = await ensureActivePage()
  if (page && page.url() !== target) {
    await studioGoto(target)
  }
  // Always inject overlay for the opened site when overlay is globally enabled.
  // openStudio(homepage:) does a raw goto without overlay; studioGoto also
  // injects, but the URL-matching guard may skip it if homepage already matched.
  if (studio.overlayEnabled) await injectOverlayForCurrentPage().catch(() => {})
  return studioStatus()
}

function overlayNodesForSite(site) {
  const txt = (s) => String(s ?? "")
  if (!site) {
    return [
      { tag: "div", style: "font-weight:600;margin-bottom:6px", text: "🧠 PICC" },
      { tag: "div", className: "muted", text: "No profile for this site yet." }
    ]
  }
  const nodes = [
    { tag: "div", style: "font-weight:600;margin-bottom:6px", text: `🧠 PICC · ${txt(site.name)}` },
    { tag: "div", text: `Category: ${txt(site.category)}` }
  ]
  if (site.payoutThreshold > 0) nodes.push({ tag: "div", text: `Payout threshold: $${site.payoutThreshold}` })
  nodes.push({ tag: "div", style: "margin-top:6px", text: txt(site.note) })
  return nodes
}

export async function studioNav(action) {
  ensureOpen()
  const page = await ensureActivePage()
  if (!page) {
    const err = new Error("browser is not available — open the browser first")
    err.code = "BROWSER_CLOSED"
    throw err
  }
  if (action === "back") await page.goBack({ timeout: 20000 }).catch(() => {})
  else if (action === "forward") await page.goForward({ timeout: 20000 }).catch(() => {})
  else if (action === "reload") await page.reload({ timeout: 30000 })
  else throw new Error(`unknown nav action "${action}"`)
  const tab = studio.tabs.find((t) => t.id === studio.activeId)
  if (tab) bumpTabMeta(page, tab)
  ackScreencastFrame()
  return { ok: true, url: page.url(), title: await page.title().catch(() => "") }
}

export async function studioTab({ action, url, id } = {}) {
  // Tab ops restart the CDP screencast; serialize them so rapid clicks can't
  // race on the same CDP session (which previously surfaced as 400 errors).
  return serial(() => studioTabInner({ action, url, id }))
}

async function studioTabInner({ action, url, id } = {}) {
  ensureOpen()
  const context = studio.bridge.context
  if (action === "new") {
    if (studio.tabs.length >= MAX_TABS) {
      // At the tab cap: navigate the active tab instead of erroring, so quick
      // launch always succeeds.
      const target = studio.tabs.find((t) => t.id === studio.activeId) ?? studio.tabs[0]
      if (target && url) {
        await target.page.goto(String(url).trim(), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
        bumpTabMeta(target.page, target)
      }
      studio.activeId = target?.id ?? null
      if (studio.overlayEnabled) void injectOverlayForCurrentPage()
      await startScreencast()
      broadcast(tabsPayload())
      return studioStatus()
    }
    const page = await context.newPage()
    const tab = { id: ++studio.lastTabId, page, title: "New tab", url: "about:blank" }
    studio.tabs.push(tab)
    wirePage(page, tab.id)
    bumpTabMeta(page, tab)
    if (url) await page.goto(String(url).trim(), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
    studio.activeId = tab.id
    touchTabActivity(tab.id)
    if (studio.overlayEnabled) void injectOverlayForCurrentPage()
    await startScreencast()
    broadcast(tabsPayload())
    return studioStatus()
  }
  if (action === "close") {
    const target = studio.tabs.find((t) => t.id === Number(id))
    if (!target) return studioStatus() // idempotent — the tab is already gone
    const wasActive = target.id === studio.activeId
    const idx = studio.tabs.indexOf(target)
    await target.page.close().catch(() => {})
    studio.tabs.splice(idx, 1)
    studio.tabActivity.delete(target.id)
    studio.frozen.delete(target.id)
    studio._lastAssistKeys.delete(target.id)
    if (studio.tabs.length === 0) {
      const page = await context.newPage()
      const tab = { id: ++studio.lastTabId, page, title: "New tab", url: "about:blank" }
      studio.tabs.push(tab)
      wirePage(page, tab.id)
      bumpTabMeta(page, tab)
      studio.activeId = tab.id
      touchTabActivity(tab.id)
    } else if (wasActive) {
      studio.activeId = studio.tabs[Math.min(idx, studio.tabs.length - 1)].id
      touchTabActivity(studio.activeId)
    }
    await startScreencast()
    broadcast(tabsPayload())
    return studioStatus()
  }
  if (action === "switch") {
    const target = studio.tabs.find((t) => t.id === Number(id))
    if (!target) return studioStatus() // idempotent — unknown id falls back to current
    studio.activeId = target.id
    touchTabActivity(target.id)
    void resumeTab(target)
    void pushAssist(target.id, target.url, true)
    if (studio.overlayEnabled) void injectOverlayForCurrentPage()
    await startScreencast()
    broadcast(tabsPayload())
    return studioStatus()
  }
  throw new Error(`unknown tab action "${action}"`)
}

/**
 * Humanized typing: real humans type in short bursts with variable per-key
 * latency and pause after punctuation. Instant insertText is a strong
 * automation fingerprint (and it bypasses key events entirely), so PICC types
 * by default like a person. Set the `humanizeInput` setting to false (or
 * PICC_HUMANIZE=0) to restore instant insert for debugging.
 */
function humanDelay() {
  return 30 + Math.floor(Math.random() * 100)
}

function humanPause(page) {
  return page.waitForTimeout(150 + Math.floor(Math.random() * 500))
}

async function humanType(page, text) {
  if (!text) return
  if (!HUMANIZE_INPUT) return page.keyboard.insertText(text)
  const chars = [...text]
  let i = 0
  while (i < chars.length) {
    const burst = 1 + Math.floor(Math.random() * 4)
    const chunk = chars.slice(i, i + burst).join("")
    await page.keyboard.type(chunk, { delay: humanDelay() })
    const last = chars[i + burst - 1] ?? ""
    if (/[\s.,!?;:]/.test(last)) await humanPause(page)
    i += burst
  }
}

/**
 * Dispatch a pointer/keyboard action. Coordinates are normalized 0..1 relative
 * to the displayed frame, so the client never needs to know viewport scaling.
 */
export async function studioInput(input = {}) {
  ensureOpen()
  const page = activePage()
  if (!page || page.isClosed()) return { ok: true, x: 0, y: 0, type: input.type }
  const vp = studio.vp
  const nx = Number(input.nx)
  const ny = Number(input.ny)
  const x = Number.isFinite(nx) ? Math.round(nx * vp.width) : 0
  const y = Number.isFinite(ny) ? Math.round(ny * vp.height) : 0
  switch (input.type) {
    case "click":
      await page.mouse.click(x, y, { button: input.button ?? "left", clickCount: Number(input.clickCount) || 1 })
      break
    case "dblclick":
      await page.mouse.click(x, y, { button: input.button ?? "left", clickCount: 2 })
      break
    case "mousemove":
      await page.mouse.move(x, y)
      break
    case "mousedown":
      await page.mouse.down({ button: input.button ?? "left" })
      break
    case "mouseup":
      await page.mouse.up({ button: input.button ?? "left" })
      break
    case "wheel":
      await page.mouse.wheel(Number(input.deltaX) || 0, Number(input.deltaY) || 0)
      break
    case "touch": {
      // Raw touch events (touchStart/touchMove/touchEnd) via CDP — used by the
      // client's touch-mode toggle for swipe/scroll/tap gestures on mobile-first
      // sites. Touch emulation is switched on for the page so it reacts like a
      // real touch device.
      const kind = String(input.kind ?? "end")
      const cdp = await studio.bridge.context.newCDPSession(page).catch(() => null)
      if (cdp) {
        try {
          await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }).catch(() => {})
          const points = kind === "end" ? [] : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }]
          const type = kind === "start" ? "touchStart" : kind === "move" ? "touchMove" : "touchEnd"
          await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points }).catch(() => {})
        } catch {
          /* best effort */
        } finally {
          await cdp.detach().catch(() => {})
        }
      }
      break
    }
    case "type": {
      const text = String(input.text ?? "")
      if (text) await humanType(page, text)
      break
    }
    case "key": {
      const key = String(input.key ?? "")
      if (key) await page.keyboard.press(key)
      break
    }
    case "drop": {
      const files = Array.isArray(input.files) ? input.files : []
      if (!files.length) return { ok: true, x, y, type: "drop", dropped: 0 }
      const paths = await persistUploadFiles(files)
      const items = files.map((f) => ({
        mimeType: String(f?.type || "application/octet-stream"),
        data: String(f?.name || "file"),
        title: String(f?.name || "file")
      }))
      try {
        // Native drag & drop needs a raw CDP Input.dispatchDragEvent (Playwright
        // has no public API for dropping files). Reuse the screencast session.
        let cdp = studio.cdp
        if (!cdp) cdp = await studio.bridge.context.newCDPSession(page).catch(() => null)
        if (!cdp) throw new Error("no CDP session available for drag & drop")
        const dragData = { items, files: paths, dragOperationsMask: 1 }
        for (const type of ["dragEnter", "dragOver"]) {
          await cdp.send("Input.dispatchDragEvent", { type, x, y, data: dragData, modifiers: 0 }).catch(() => {})
        }
        await cdp.send("Input.dispatchDragEvent", { type: "drop", x, y, data: dragData, modifiers: 0 })
        return { ok: true, x, y, type: "drop", dropped: files.length }
      } finally {
        cleanupFiles(paths)
      }
    }
    default:
      throw new Error(`unknown input type "${input.type}"`)
  }
  // Kick the screencast pump so the frame reflecting this input is captured
  // immediately instead of waiting for the next paced ack.
  ackScreencastFrame()
  return { ok: true, x, y, type: input.type }
}

/**
 * Answer a pending file chooser with the given files (base64 payloads). Returns
 * { handled:false } when the chooser already expired or never existed.
 */
export async function studioUploadFiles({ id, files = [] } = {}) {
  ensureOpen()
  const fcId = Number(id)
  const found = studio.fileChoosers.get(fcId)
  if (!found) return { ok: true, handled: false, id: fcId }
  studio.fileChoosers.delete(fcId)
  const paths = await persistUploadFiles(files)
  try {
    await found.chooser.setFiles(paths)
    return { ok: true, handled: true, id: fcId, uploaded: paths.length }
  } finally {
    cleanupFiles(paths)
  }
}

/**
 * Grab the current selection on the live page (inputs + plain text) so the app
 * can mirror it into the OS clipboard. Empty string when nothing is selected.
 */
export async function studioCopySelection() {
  ensureOpen()
  const page = activePage()
  if (!page || page.isClosed()) return { ok: true, text: "" }
  let text = ""
  try {
    text = await page.evaluate(() => {
      const el = document.activeElement
      const editable = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      if (editable) {
        const start = typeof el.selectionStart === "number" ? el.selectionStart : 0
        const end = typeof el.selectionEnd === "number" ? el.selectionEnd : 0
        if (end > start) return String(el.value ?? el.textContent ?? "").slice(start, end)
      }
      const sel = window.getSelection?.()
      return sel ? String(sel.toString()) : ""
    })
  } catch {
    /* page navigated away mid-read */
  }
  return { ok: true, text: String(text ?? "") }
}

export function studioDownloads() {
  return { ok: true, downloads: studio.downloads.map((d) => d.entry) }
}

export async function studioDownloadFile(id) {
  ensureOpen()
  const found = studio.downloads.find((d) => d.entry.id === Number(id))
  if (!found) {
    const err = new Error("download not found")
    err.code = "NOT_FOUND"
    throw err
  }
  const path = await found.download.path().catch(() => null)
  if (!path) {
    const err = new Error("download file is not ready yet")
    err.code = "NOT_FOUND"
    throw err
  }
  return { ok: true, path, filename: String(found.entry.filename || "download.bin") }
}

/**
 * Inject (or replace) the PICC overlay on the current page, or clear it.
 * Accepts optional overlaySettings for position, size, opacity, collapse, and features.
 */
export async function studioOverlay({ nodes, clear, overlaySettings, overlayIndex } = {}) {
  ensureOpen()
  const page = activePage()

  // Clear mode: remove overlay(s) by index or all
  if (clear) {
    if (typeof clear === "number") {
      const id = `__PICC_OVERLAY_${clear}__`
      await page.evaluate((oid) => document.getElementById(oid)?.remove(), id).catch(() => {})
    } else {
      await page.evaluate(() => {
        document.querySelectorAll('[id^="__PICC_OVERLAY_"]').forEach((el) => el.remove())
      }).catch(() => {})
    }
    return { ok: true, shown: false }
  } else if (Array.isArray(nodes)) {
    // Determine overlay index: explicit, or auto-assign next available
    let idx = typeof overlayIndex === "number" ? overlayIndex : undefined
    if (idx === undefined) {
      idx = await page.evaluate(() => {
        const existing = [...document.querySelectorAll('[id^="__PICC_OVERLAY_"]')]
        const indices = existing.map((el) => {
          const m = el.id.match(/__PICC_OVERLAY_(\d+)__/)
          return m ? parseInt(m[1], 10) : -1
        }).filter((n) => n >= 0)
        if (indices.length === 0) return 0
        return Math.max(...indices) + 1
      })
    }
    const overlayId = idx === 0 ? "__PICC_OVERLAY__" : `__PICC_OVERLAY_${idx}__`

    const settings = overlaySettings || {}
    await page.evaluate(
      (payload) => {
        const { items, cfg, oid, oidx } = payload
        let el = document.getElementById(oid)
        if (!el) {
          el = document.createElement("div")
          el.id = oid
          el.setAttribute("data-picc-overlay-index", String(oidx))
          document.documentElement.appendChild(el)
        }
        // Stack offset: shift each additional overlay up-right so they don't stack directly
        const stackOffsetX = oidx * 20
        const stackOffsetY = oidx * 20
        const posX = (cfg.position?.x ?? 16) + stackOffsetX
        const posY = (cfg.position?.y ?? 16) + stackOffsetY
        const szW = cfg.size?.width ?? 340
        const szH = cfg.size?.height ?? 400
        const opa = cfg.opacity ?? 0.92
        // Default to collapsed (pill) state — user clicks toggle to expand
        const isCollapsed = cfg.collapsed !== false
        el.style.cssText =
          `position:fixed;bottom:${posY}px;left:${posX}px;z-index:${2147483647 - oidx};` +
          (isCollapsed ? `width:auto;max-height:none;overflow:visible;` : `width:${szW}px;max-height:${szH}px;overflow:auto;`) +
          `background:rgba(20,20,48,${opa});backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#eef0ff;border:1px solid rgba(108,99,255,0.5);border-radius:12px;` +
          `padding:${isCollapsed ? "4px 8px" : "0 14px 14px"};font:13px/1.5 system-ui,sans-serif;` +
          `box-shadow:0 8px 32px rgba(0,0,0,.4),0 0 0 1px rgba(108,99,255,0.15);transition:max-height .25s ease,width .25s ease,opacity .15s,transform .15s;user-select:none;`
        el.setAttribute("data-collapsed", isCollapsed ? "1" : "0")

        // Helper: toggle between pill (collapsed) and full overlay (expanded)
        const applyCollapse = (collapsed) => {
          el.setAttribute("data-collapsed", collapsed ? "1" : "0")
          if (collapsed) {
            el.style.width = "auto"
            el.style.maxHeight = "none"
            el.style.overflow = "visible"
            el.style.padding = "4px 8px"
          } else {
            el.style.width = (cfg.size?.width ?? 340) + "px"
            el.style.maxHeight = (cfg.size?.height ?? 400) + "px"
            el.style.overflow = "auto"
            el.style.padding = "0 14px 14px"
          }
          const body = el.querySelector("[data-picc-overlay-body]")
          if (body) body.style.display = collapsed ? "none" : ""
          const hdr = el.querySelector("[data-picc-overlay-header]")
          if (hdr) {
            hdr.style.cursor = collapsed ? "" : "move"
            hdr.style.borderBottom = collapsed ? "none" : "1px solid #6c63ff40"
            hdr.style.marginBottom = collapsed ? "0" : "6px"
            hdr.style.padding = collapsed ? "0" : "4px 0 6px"
          }
          const toggleBtns = el.querySelectorAll("[data-pic-toggle]")
          toggleBtns.forEach((b) => { b.textContent = collapsed ? "▸" : "▾"; b.title = collapsed ? "Expand overlay" : "Collapse to pill" })
        }

        // Build the overlay header — this IS the pill (always visible)
        let header = el.querySelector("[data-picc-overlay-header]")
        if (!header) {
          header = document.createElement("div")
          header.setAttribute("data-picc-overlay-header", "")
          header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;"
          el.prepend(header)
        }
        header.style.cursor = isCollapsed ? "" : "move"
        header.style.borderBottom = isCollapsed ? "none" : "1px solid #6c63ff40"
        header.style.marginBottom = isCollapsed ? "0" : "6px"
        header.style.padding = isCollapsed ? "0" : "4px 0 6px"

        // Header: PICC brand + index badge
        const brand = document.createElement("span")
        brand.style.cssText = "font-weight:700;color:#6c63ff;font-size:12px;letter-spacing:.5px;white-space:nowrap;"
        brand.textContent = oidx === 0 ? "🧠 PICC" : `🧠 PICC #${oidx + 1}`

        // Header: button row (pill buttons)
        const btnRow = document.createElement("span")
        btnRow.style.cssText = "display:flex;gap:2px;align-items:center;"

        // Toggle button: expand/collapse
        const toggleBtn = document.createElement("button")
        toggleBtn.setAttribute("data-pic-toggle", "")
        toggleBtn.textContent = isCollapsed ? "▸" : "▾"
        toggleBtn.title = isCollapsed ? "Expand overlay" : "Collapse to pill"
        toggleBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:4px;"
        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          const collapsed = el.getAttribute("data-collapsed") === "1"
          applyCollapse(!collapsed)
        })

        // Close button: remove overlay + disable intervention
        const closeBtn = document.createElement("button")
        closeBtn.textContent = "✕"
        closeBtn.title = "Close overlay and disable PICC intervention (re-toggle via Ctrl+Alt+Shift+O)"
        closeBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px;opacity:.7;"
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          window.__picc_overlay_close?.()
        })

        // Settings button: toggle inline settings panel
        const settingsBtn = document.createElement("button")
        settingsBtn.textContent = "⚙"
        settingsBtn.title = "Overlay settings"
        settingsBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:4px;"
        settingsBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          let panel = el.querySelector("[data-picc-settings-panel]")
          if (panel) { panel.remove(); return }
          // Expand overlay so settings are visible
          if (el.getAttribute("data-collapsed") === "1") applyCollapse(false)
          panel = document.createElement("div")
          panel.setAttribute("data-picc-settings-panel", "")
          panel.style.cssText = "border-top:1px solid #6c63ff40;padding-top:8px;margin-top:8px;"
          const mkInput = (type, val, onChange) => {
            const inp = document.createElement("input")
            inp.type = type
            inp.value = String(val)
            inp.style.cssText = "background:#1a1a2e;border:1px solid #6c63ff40;color:#eef0ff;padding:2px 6px;border-radius:4px;font-size:12px;width:70px;"
            inp.addEventListener("change", () => onChange(inp.value))
            return inp
          }
          const mkLabel = (text) => { const s = document.createElement("span"); s.style.cssText = "font-size:11px;color:#a5a0ff;min-width:50px;"; s.textContent = text; return s }
          const title = document.createElement("div")
          title.style.cssText = "font-weight:600;font-size:12px;color:#eef0ff;margin-bottom:8px;"
          title.textContent = "Overlay Settings"
          panel.appendChild(title)
          // Position
          const posRow = document.createElement("div")
          posRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px;"
          posRow.appendChild(mkLabel("Position"))
          posRow.appendChild(mkInput("number", parseInt(el.style.left || "16", 10), (v) => { el.style.left = Math.max(0, parseInt(v, 10) || 0) + "px" }))
          posRow.appendChild(mkInput("number", parseInt(el.style.bottom || "16", 10), (v) => { el.style.bottom = Math.max(0, parseInt(v, 10) || 0) + "px" }))
          panel.appendChild(posRow)
          // Size
          const szRow = document.createElement("div")
          szRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px;"
          szRow.appendChild(mkLabel("Size"))
          szRow.appendChild(mkInput("number", el.offsetWidth, (v) => { el.style.width = Math.max(200, parseInt(v, 10) || 200) + "px" }))
          szRow.appendChild(mkInput("number", el.offsetHeight, (v) => { el.style.maxHeight = Math.max(100, parseInt(v, 10) || 100) + "px" }))
          panel.appendChild(szRow)
          // Opacity
          const opaRow = document.createElement("div")
          opaRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px;"
          opaRow.appendChild(mkLabel("Opacity"))
          const opaInp = mkInput("range", Math.round((cfg.opacity ?? 0.92) * 100), (v) => {
            const o = Math.min(100, Math.max(10, parseInt(v, 10) || 92)) / 100
            el.style.background = `rgba(20,20,48,${o})`
          })
          opaInp.style.width = "100px"
          opaInp.min = "10"
          opaInp.max = "100"
          opaRow.appendChild(opaInp)
          panel.appendChild(opaRow)
          // Close panel
          const closePanelBtn = document.createElement("button")
          closePanelBtn.textContent = "✕ Close settings"
          closePanelBtn.style.cssText = "background:#6c63ff30;border:1px solid #6c63ff40;color:#a5a0ff;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:4px;margin-top:4px;"
          closePanelBtn.addEventListener("click", (ev) => { ev.stopPropagation(); panel.remove() })
          panel.appendChild(closePanelBtn)
          body.parentNode.insertBefore(panel, body)
        })

        btnRow.appendChild(toggleBtn)
        btnRow.appendChild(settingsBtn)
        btnRow.appendChild(closeBtn)
        header.replaceChildren(brand, btnRow)

        // Build content body
        let body = el.querySelector("[data-picc-overlay-body]")
        if (!body) {
          body = document.createElement("div")
          body.setAttribute("data-picc-overlay-body", "")
          el.appendChild(body)
        }
        if (isCollapsed) body.style.display = "none"
        else body.style.display = ""

        // Build the overlay content with createElement/textContent ONLY — Trusted-Types
        // pages (e.g. accounts.google.com) block innerHTML and even
        // DOMParser.parseFromString, so no HTML-string parsing is allowed here.
        const build = (node) => {
          const d = document.createElement(node.tag || "div")
          if (node.className) d.className = String(node.className)
          if (node.style) d.setAttribute("style", String(node.style))
          if (node.attrs) {
            for (const [k, v] of Object.entries(node.attrs)) d.setAttribute(k, v === undefined ? "" : String(v))
          }
          if (node.text != null) d.textContent = String(node.text)
          for (const c of node.children || []) d.appendChild(build(c))
          return d
        }
        body.replaceChildren()
        for (const item of items) body.appendChild(build(item))

        // Feature status badges
        if (cfg.features) {
          const featureRow = document.createElement("div")
          featureRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;"
          const featureIcons = {
            assistance: "💡", decisionSupport: "📊", automation: "⚙️",
            autopilot: "🤖", analysis: "🔍", ai: "🧠"
          }
          for (const [key, enabled] of Object.entries(cfg.features)) {
            const badge = document.createElement("span")
            badge.style.cssText = `font-size:10px;padding:2px 6px;border-radius:8px;${enabled ? "background:#6c63ff30;color:#a5a0ff;" : "background:#33334060;color:#666;"}`
            badge.textContent = `${featureIcons[key] || "•"} ${key}`
            featureRow.appendChild(badge)
          }
          body.appendChild(featureRow)
        }

        // Interactive layer (trading HUD only): expand/collapse + local clocks.
        const toggle = el.querySelector("[data-picc-hud-role='toggle']")
        if (toggle && !el.__piccHudWired) {
          el.__piccHudWired = true
          el.addEventListener("click", (e) => {
            if (!e.target.closest("[data-picc-hud-role='toggle']")) return
            const rows = [...el.querySelectorAll("[data-picc-hud-role='row']")]
            if (el.getAttribute("data-picc-hud") === "full") {
              el.setAttribute("data-picc-hud", "compact")
              toggle.textContent = "▾ expand"
              rows.forEach((r, i) => {
                r.style.display = i === 0 ? "" : "none"
              })
            } else {
              el.setAttribute("data-picc-hud", "full")
              toggle.textContent = "▴ collapse"
              rows.forEach((r) => {
                r.style.display = ""
              })
            }
          })
        }
        if (toggle) {
          el.setAttribute("data-picc-hud", "compact")
          toggle.textContent = "▾ expand"
          const rows = [...el.querySelectorAll("[data-picc-hud-role='row']")]
          rows.forEach((r, i) => {
            r.style.display = i === 0 ? "" : "none"
          })
        }
        const tick = () => {
          const now = Date.now()
          for (const c of el.querySelectorAll("[data-picc-clock]")) {
            const at = Number(c.getAttribute("data-at") || 0)
            const label = c.getAttribute("data-label") || ""
            if (!at) {
              c.textContent = label ? `${label} —` : "—"
              continue
            }
            const sec = Math.max(0, Math.ceil((at - now) / 1000))
            c.textContent = `${label} ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
          }
        }
        if (toggle) {
          tick()
          if (window.__piccHudClock) clearInterval(window.__piccHudClock)
          window.__piccHudClock = setInterval(tick, 1000)
        }

        // --- Drag behavior with edge docking (mouse + touch) ---
        if (!el.__piccDragWired) {
          el.__piccDragWired = true
          const DOCK_THRESHOLD = 24
          let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0

          const startDrag = (cx, cy) => {
            dragging = true
            startX = cx
            startY = cy
            origX = parseInt(el.style.left || "16", 10)
            origY = parseInt(el.style.bottom || "16", 10)
            el.style.transition = "none"
          }
          const moveDrag = (cx, cy) => {
            if (!dragging) return
            const dx = cx - startX
            const dy = startY - cy
            let newX = Math.max(0, origX + dx)
            let newY = Math.max(0, origY + dy)
            const vw = window.innerWidth
            if (newX + el.offsetWidth > vw - DOCK_THRESHOLD) newX = vw - el.offsetWidth - 4
            if (newX < DOCK_THRESHOLD) newX = 4
            if (newY + el.offsetHeight > window.innerHeight - DOCK_THRESHOLD) newY = window.innerHeight - el.offsetHeight - 4
            if (newY < DOCK_THRESHOLD) newY = 4
            el.style.left = newX + "px"
            el.style.bottom = newY + "px"
          }
          const endDrag = () => {
            if (!dragging) return
            dragging = false
            el.style.transition = ""
          }

          // Mouse events
          header.addEventListener("mousedown", (e) => {
            if (e.target.closest("button")) return
            startDrag(e.clientX, e.clientY)
            e.preventDefault()
          })
          document.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY))
          document.addEventListener("mouseup", endDrag)

          // Touch events
          header.addEventListener("touchstart", (e) => {
            if (e.target.closest("button")) return
            const t = e.touches[0]
            startDrag(t.clientX, t.clientY)
          }, { passive: true })
          document.addEventListener("touchmove", (e) => {
            if (!dragging) return
            const t = e.touches[0]
            moveDrag(t.clientX, t.clientY)
          }, { passive: true })
          document.addEventListener("touchend", endDrag)

          // --- Resize handle (bottom-right corner) ---
          const resizeHandle = document.createElement("div")
          resizeHandle.style.cssText = "position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;opacity:.35;border-radius:0 0 12px 0;background:linear-gradient(135deg,transparent 50%,#6c63ff 50%);"
          resizeHandle.addEventListener("mousedown", (e) => {
            e.stopPropagation()
            e.preventDefault()
            const startMX = e.clientX
            const startMY = e.clientY
            const startW = el.offsetWidth
            const startH = el.offsetHeight
            const onMove = (ev) => {
              const dw = ev.clientX - startMX
              const dh = startMY - ev.clientY
              el.style.width = Math.max(200, startW + dw) + "px"
              el.style.maxHeight = Math.max(100, startH + dh) + "px"
            }
            const onUp = () => {
              document.removeEventListener("mousemove", onMove)
              document.removeEventListener("mouseup", onUp)
            }
            document.addEventListener("mousemove", onMove)
            document.addEventListener("mouseup", onUp)
          })
          resizeHandle.addEventListener("touchstart", (e) => {
            e.stopPropagation()
            const t = e.touches[0]
            const startMX = t.clientX
            const startMY = t.clientY
            const startW = el.offsetWidth
            const startH = el.offsetHeight
            const onMove = (ev) => {
              const tt = ev.touches[0]
              const dw = tt.clientX - startMX
              const dh = startMY - tt.clientY
              el.style.width = Math.max(200, startW + dw) + "px"
              el.style.maxHeight = Math.max(100, startH + dh) + "px"
            }
            const onEnd = () => {
              document.removeEventListener("touchmove", onMove)
              document.removeEventListener("touchend", onEnd)
            }
            document.addEventListener("touchmove", onMove, { passive: true })
            document.addEventListener("touchend", onEnd)
          }, { passive: true })
          el.appendChild(resizeHandle)
        }
      },
      { items: nodes, cfg: { ...settings, site: settings._site }, oid: overlayId, oidx: idx }
    )
  } else {
    throw new Error("overlay requires nodes or clear=true")
  }
  return { ok: true, shown: !clear, overlayIndex: idx }
}

/**
 * Inject an overlay for the current active page using site detection.
 * Respects the global overlayEnabled flag and per-site overlay settings.
 * Called automatically by studioGoto and studioOverlayToggle.
 */
async function injectOverlayForCurrentPage() {
  if (!studio.overlayEnabled) return
  try {
    ensureOpen()
    const page = activePage()
    if (!page || page.isClosed()) return
    const url = page.url()
    // Never inject overlay into PICC's own dashboard — only target income sites
    try {
      const u = new URL(url)
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "0.0.0.0") return
    } catch { return }
    const siteInfo = detectSite(url)
    const siteKey = siteInfo?.id || ""
    const prefs = siteKey ? (await readPrefs())[siteKey] : null
    if (prefs?.overlay === false) return
    const overlaySettings = prefs?.overlaySettings
      ? { ...prefs.overlaySettings, _site: siteKey }
      : { _site: siteKey }
    await studioOverlay({ nodes: overlayNodesForSite(siteInfo), overlaySettings }).catch(() => {})
  } catch {
    /* best-effort — never block navigation or toggle for overlay errors */
  }
}

/** Read-only access to the global overlay enabled flag. */
export function isOverlayEnabled() {
  return studio.overlayEnabled
}

/**
 * Toggle the global overlay enabled flag. When enabling, injects the overlay
 * on the current page using site detection. When disabling, removes all overlays.
 * Returns the new enabled state.
 */
export async function studioOverlayToggle(force) {
  ensureOpen()
  const newState = typeof force === "boolean" ? force : !studio.overlayEnabled
  studio.overlayEnabled = newState
  // Persist the global overlay flag to browser prefs
  try {
    const all = await readPrefs()
    all.global = { ...(all.global || {}), overlayEnabled: studio.overlayEnabled }
    await writePrefs(all)
  } catch { /* best-effort */ }
  if (studio.overlayEnabled) {
    await injectOverlayForCurrentPage().catch(() => {})
  } else {
    const page = activePage()
    if (page && !page.isClosed()) {
      await page.evaluate(() => {
        document.querySelectorAll('[id^="__PICC_OVERLAY_"]').forEach((el) => el.remove())
      }).catch(() => {})
    }
  }
  return { ok: true, overlayEnabled: studio.overlayEnabled }
}

/**
 * Read a normalized DOM snapshot of the current page (PICC analysis path).
 */
export async function studioRead({ selectors } = {}) {
  ensureOpen()
  const page = activePage()
  if (!page || page.isClosed()) {
    const err = new Error("browser is not available — open the browser first")
    err.code = "NO_BROWSER"
    throw err
  }
  return readPage(page, selectors)
}

/**
 * Run a trusted read-only function inside the active page (PICC server-side
 * only — never exposed to page content). Used to inspect storage/DOM state
 * that the generic read path does not cover.
 */
export async function studioEvalPage(fn, arg) {
  ensureOpen()
  const page = activePage()
  if (!page) {
    const err = new Error("browser is not available — open the browser first")
    err.code = "BROWSER_CLOSED"
    throw err
  }
  return page.evaluate(fn, arg)
}

/**
 * Subscribe to the active page's own WebSocket frames (sent + received).
 * The page's live WS traffic is how PICC surfaces realtime platform data.
 */
export function studioOnFrame(cb) {
  ensureOpen()
  if (!studio.bridge?.onFrame) return () => {}
  return studio.bridge.onFrame(cb)
}


/**
 * Fill the active page's login fields with vaulted credentials. Shared by
 * studioAutofill (fill only) and studioLogin (Google runs the full flow).
 */
function fillLoginFields(page, username, password) {
  return page.evaluate(
    ({ username, password }) => {
      const finder = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel)
          if (el) return el
        }
        return null
      }
      const setValue = (el, value) => {
        const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
        if (setter) setter.call(el, value)
        else el.value = value
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
      }
      const userSel = ['input[type="email"]', 'input[name*="email" i]', 'input[name*="user" i]', 'input[name*="login" i]', 'input[autocomplete="username"]', 'input[type="text"]']
      const passSel = ['input[type="password"]', 'input[name*="pass" i]', 'input[autocomplete="current-password"]']
      const user = finder(userSel)
      const pass = finder(passSel)
      let filledUser = false
      let filledPass = false
      if (user && !user.value) {
        setValue(user, username)
        filledUser = true
      }
      if (pass && !pass.value) {
        setValue(pass, password)
        filledPass = true
      }
      return { filledUser, filledPass }
    },
    { username, password }
  )
}

/**
 * Autofill the current page's sign-in form from the vault. Fills the fields
 * only — the human still presses submit. Use studioLogin for the one-tap
 * flow that also submits (Google accounts).
 */
export async function studioAutofill({ site } = {}) {
  ensureOpen()
  const page = activePage()
  const detected = detectSite(page.url())
  const key = String(site || detected?.name || "").trim().toLowerCase()
  const creds = await getSiteCredentials(key)
  if (!creds || !creds.username) throw new Error(`no saved credentials for "${key}"`)
  const filled = await fillLoginFields(page, creds.username, creds.password)
  return { ok: true, site: key, ...filled }
}

const GOOGLE_SIGNIN_HINTS = [
  "accounts.google.com",
  "gmail.com",
  "mail.google.com",
  "myaccount.google.com",
  "google.com/signin",
  "google.com/accounts"
]

/**
 * Cookies that prove an authenticated Google session. `SID`/`SIDCC` are the
 * `.google.com` session cookies (set when you sign in on any Google service),
 * `__Secure-1PSID`/`__Secure-3PSID` the modern replacements, `HSID` the
 * host-bound pair of SID. `GAPS`/`OTZ` alone do NOT prove sign-in (they can
 * linger after logout), so they are deliberately excluded from this set.
 */
const GOOGLE_AUTH_COOKIES = ["SID", "SIDCC", "HSID", "__Secure-1PSID", "__Secure-3PSID"]

/** Google hosts where the ListAccounts/DOM session probes run. */
const GOOGLE_SESSION_HOSTS = /(accounts|myaccount)\.google\.com/i

/**
 * Read a page's URL without ever throwing. Playwright's `page.url()` is
 * synchronous, but older code (and some test doubles) treated it as async —
 * `page.url().catch(...)` blew up with "page.url(...).catch is not a function".
 * Handles sync strings and promise-returning mocks alike.
 */
async function safeUrl(page) {
  try {
    if (!page || typeof page.url !== "function") return ""
    const u = page.url()
    if (u && typeof u.then === "function") return await u.catch(() => "")
    return String(u ?? "")
  } catch {
    return ""
  }
}

/**
 * Detect whether the browser session is signed in to Google — and WHICH account
 * — without ever navigating away from the user's tab:
 *   - "list"  on an accounts.google.com tab: Google's own ListAccounts JSON
 *             endpoint (same-origin cookies, the one Chrome's account chooser
 *             uses) returns the exact signed-in account email.
 *   - "dom"   fallback on accounts.google.com: pull the signed-in email out of
 *             the rendered page text when the JSON endpoint is unreachable.
 *   - "cookie"from ANY tab: the persistent profile's Google cookies prove
 *             sign-in state even when the active tab is gmail.com, a dashboard,
 *             or any other site. Account email is not readable this way.
 * Returns { ok, method, loggedIn, account, detail } and never throws.
 */
async function detectGoogleSession(page) {
  try {
    const url = await safeUrl(page)
    if (GOOGLE_SESSION_HOSTS.test(url)) {
      const list = await detectGoogleSessionList(page)
      if (list.ok && list.loggedIn) {
        return { ok: true, method: "list", loggedIn: true, account: list.accounts[0] ?? null, detail: list.detail }
      }
      const domEmail = await detectGoogleSessionDom(page)
      if (domEmail) {
        return { ok: true, method: "dom", loggedIn: true, account: domEmail, detail: "account read from the Google landing page" }
      }
    }
    const cookies = await detectGoogleCookies()
    if (cookies.ok) {
      return { ok: true, method: "cookie", loggedIn: cookies.loggedIn, account: null, detail: cookies.detail }
    }
    return { ok: false, method: "cookie", loggedIn: false, account: null, detail: cookies.detail }
  } catch (err) {
    return { ok: false, method: "cookie", loggedIn: false, account: null, detail: String(err?.message ?? err) }
  }
}

// ---------------------------------------------------------------------
// Login-state detection — generic per-site sign-in awareness. For every tab
// PICC reads the profile's cookies for that origin (httpOnly ones the DOM
// can't see) and scans the DOM for account/logout/login signals, so the
// dashboard knows what is actually signed in across the studio. Site hints
// sharpen cookie matching; everything else falls back to generic heuristics.
// Best-effort — never throws, never navigates, never blocks.
// ---------------------------------------------------------------------

/** URL paths that unambiguously mean "this page IS a sign-in screen". */
const LOGGED_OUT_URL_RE = /^\/(?:login|signin|sign-in|log-in|logon|auth|account\/login|enter|sso)(?:\/|$)/i

/**
 * Cookie names that look session-ish but do NOT prove an authenticated user
 * (anonymous server sessions, analytics, consent/regional cookies).
 */
const NON_AUTH_COOKIE_RE = /^(?:PHPSESSID|ASP\.NET_SessionId|CONNECT\.SID|JSESSIONID|CFID|CFTOKEN|_GA|_GID|AMP_TOKEN|NID|CONSENT|OTZ|SIDCC|UID|LANG|LOCALE|CURRENCY)$/i

/** Generic cookie names that imply an authenticated session for an origin. */
const GENERIC_AUTH_COOKIE_RE = /(?:^|[-_.])(?:access_?token|auth(?:_token|_cookie)?|jwt|session_?id|session_?token|login_?token|token|sess|uid|user_?id|account|identity|remember_?me|logged_in)$/i

/**
 * Per-site login hints. `authCookies` lists cookie names that prove an
 * authenticated session on that exact platform. `cookieAuth: false` marks
 * platforms whose session cookie ALSO exists for anonymous visitors — cookie
 * presence alone can never prove an active (logged-in) account there.
 *
 * ExpertOption: every visit (guest or signed-in) carries a 32-hex `token`
 * session cookie, so it can't be used as a login signal. Guests see a
 * "Log in"/"Sign up" header; signed-in accounts render a user menu/avatar.
 * Only those DOM controls (or the WS context handshake) distinguish the two.
 */
const LOGIN_HINTS = {
  expertoption: { authCookies: [], cookieAuth: false }
}

/** Minimum milliseconds between DOM/cookie login checks for one tab. */
const LOGIN_CHECK_MIN_INTERVAL_MS = 4000
/** ExpertOption token auto-recapture cooldown after a detected login. */
const EO_CAPTURE_COOLDOWN_MS = 10 * 60 * 1000

/**
 * Injected DOM + storage scanner. Compact login signal set plus an ExpertOption
 * account-model extraction (guest vs active, which wallet the app is showing,
 * and the signed-in identity) read straight from the content window's login
 * state — the same state the user sees. Trusted-Types safe: no HTML sinks.
 */
function domLoginSignals() {
  const clean = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim()
  const visible = (el) => {
    if (!el || el.nodeType !== 1) return false
    try {
      const s = getComputedStyle(el)
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false
      const r = el.getBoundingClientRect()
      return r.width > 1 && r.height > 1
    } catch {
      return false
    }
  }
  const out = {
    hasPassword: false, hasLoginForm: false, loginButton: false, logoutControl: false, accountMenu: false, avatar: false,
    // Account model (ExpertOption): the window's own login state, not a guess.
    guest: false, active: false, email: null, name: null, wallet: null, balance: null, demoControl: false, realControl: false
  }
  try {
    for (const inp of document.querySelectorAll("input")) {
      const t = String(inp.type || "text").toLowerCase()
      const n = String(inp.name || inp.id || "").toLowerCase()
      if (t === "password" || /pass(word)?/.test(n)) out.hasPassword = true
      if (t === "submit" && /(sign ?in|log ?in|login|continue)/.test(clean(inp))) out.loginButton = true
    }
    if (document.querySelector("form input[type='password'], input[name*='password']")) out.hasLoginForm = true
    const LOGOUT = /^(log ?out|sign ?out|logoff)\b/i
    const LOGIN = /^(sign ?in|log ?in|login|sign ?up|register|create account)\b/i
    const ACCOUNT = /^(my account|account|profile|dashboard|settings|portfolio)\b/i
    const WALLET_DEMO = /^(demo|demo account|practice)\b/i
    const WALLET_REAL = /^(real|live|real account|live account|real money)\b/i
    const BALANCE_RE = /(?:^|[^\d])-?\d{1,3}(?:[.,]\d{2,3})?\s?(?:usd|eur|gbp)?\s?[€$£]|[$€£]\s?-?\d{1,3}(?:[.,]\d{2,3})/i
    for (const el of document.querySelectorAll("button, a, [role='button'], [role='tab'], [role='menuitem'], li")) {
      if (!visible(el)) continue
      const t = clean(el)
      if (!t || t.length > 40) continue
      if (LOGOUT.test(t)) out.logoutControl = true
      else if (LOGIN.test(t)) out.loginButton = true
      else if (ACCOUNT.test(t) && el.tagName !== "A") out.accountMenu = true
      else if (WALLET_DEMO.test(t)) out.demoControl = true
      else if (WALLET_REAL.test(t)) out.realControl = true
      else if (out.balance == null && BALANCE_RE.test(t) && t.length < 24) out.balance = t
    }
    for (const img of document.querySelectorAll("img")) {
      if (!visible(img)) continue
      const alt = String(img.alt || "").toLowerCase()
      const cls = img.className && typeof img.className === "string" ? img.className.toLowerCase() : ""
      const src = String(img.src || "").toLowerCase()
      if (/(avatar|profile|account|user)/.test(`${alt} ${cls} ${src}`)) {
        out.avatar = true
        break
      }
    }

    // Storage tier — the logged-in app persists a user profile (email/name) and
    // the active wallet mode. A guest session stores neither.
    const profileKeys = /user|account|profile|auth|session|current|me$|identity/i
    const scanProfile = (value) => {
      if (!value || typeof value !== "string") return null
      if (value.length > 20000 || value.length < 8) return null
      let obj
      try {
        obj = JSON.parse(value)
      } catch {
        return null
      }
      if (!obj || typeof obj !== "object") return null
      let cursor = obj
      if (cursor.user && typeof cursor.user === "object") cursor = cursor.user
      const email = typeof cursor.email === "string" ? cursor.email : typeof cursor.mail === "string" ? cursor.mail : null
      const name =
        typeof cursor.name === "string" ? cursor.name :
        typeof cursor.username === "string" ? cursor.username :
        typeof cursor.first_name === "string" ? cursor.first_name :
        typeof cursor.full_name === "string" ? cursor.full_name : null
      if (email || name) return { email, name }
      return null
    }
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i) || ""
        if (!profileKeys.test(k)) continue
        const profile = scanProfile(store.getItem(k))
        if (profile) {
          out.active = true
          if (!out.email && profile.email) out.email = profile.email
          if (!out.name && profile.name) out.name = profile.name
        }
        const low = (store.getItem(k) || "").toLowerCase()
        if (out.wallet == null && /("is_demo"\s*[:=]\s*1|"demo"\s*[:=]\s*1|"mode"\s*[:=]\s*"demo"|demo\s*account)/.test(low)) {
          out.wallet = "demo"
        } else if (out.wallet == null && /("is_demo"\s*[:=]\s*0|"mode"\s*[:=]\s*"real"|real\s*account)/.test(low)) {
          out.wallet = "real"
        }
      }
    }

    // Derive the account model. User controls / profile prove an active account;
    // a visible Log in/Register header with neither means guest.
    const hasUserControl = out.logoutControl || out.accountMenu || out.avatar
    if (out.active || hasUserControl) {
      out.active = true
      out.guest = false
    } else if (out.loginButton) {
      out.guest = true
      out.active = false
    }
    if (out.wallet == null) {
      if (out.demoControl && !out.realControl) out.wallet = "demo"
      else if (out.realControl && !out.demoControl) out.wallet = "real"
    }
  } catch {
    /* page mid-navigation — report what we have */
  }
  return out
}

/** Read the profile cookies that match one tab's URL (httpOnly included). */
async function detectLoginCookies(url) {
  try {
    const context = studio.bridge?.context
    if (!context?.cookies) return { ok: false, cookies: [] }
    const list = await context.cookies([url]).catch(() => [])
    return { ok: true, cookies: Array.isArray(list) ? list : [] }
  } catch {
    return { ok: false, cookies: [] }
  }
}

/**
 * Detect the sign-in state of one tab. Combines URL markers, DOM signals and
 * the profile's cookies for that origin. Returns { ok, site, host, loggedIn,
 * confidence, method, detail, checkedAt } and never throws. `loggedIn` is
 * `true`, `false`, or `null` when no signal is found.
 */
export async function detectLoginState(page, tab) {
  const url = await safeUrl(page)
  const site = detectSite(url)
  const out = {
    ok: true,
    site: site?.id ?? null,
    host: hostOf(url),
    loggedIn: null,
    confidence: "low",
    method: "none",
    detail: "unknown",
    checkedAt: Date.now(),
    account: null
  }
  if (!/^https?:/i.test(url)) {
    out.detail = "not a web page"
    return out
  }
  let path = ""
  try {
    path = new URL(url).pathname
  } catch {
    path = ""
  }
  if (LOGGED_OUT_URL_RE.test(path)) {
    out.loggedIn = false
    out.confidence = "high"
    out.method = "url"
    out.detail = "sign-in page"
    return out
  }

  let dom = null
  if (page && typeof page.evaluate === "function" && !page.isClosed?.()) {
    dom = await page.evaluate(domLoginSignals).catch(() => null)
  }

  // Strongest signal first: an explicit logout control only exists when signed in.
  if (dom?.logoutControl) {
    out.loggedIn = true
    out.confidence = "high"
    out.method = "dom"
    out.detail = "logout control present"
    return out
  }
  // A real login form (password field) means this page is the sign-in screen.
  if (dom?.hasLoginForm || dom?.hasPassword) {
    out.loggedIn = false
    out.confidence = "high"
    out.method = "dom"
    out.detail = "login form present"
    return out
  }

  // ExpertOption renders the same `token` session cookie for guest visitors, so
  // cookie presence is never proof of an active account there. The account model
  // is read from the content window's own login state (user controls / profile
  // storage = active; Log in + Sign up header = guest). Runs before the generic
  // avatar/menu branch so the full account model is attached, not just a marker.
  if (site?.id === "expertoption" && (dom?.active || dom?.guest)) {
    const active = Boolean(dom.active)
    out.loggedIn = active
    out.confidence = "high"
    out.method = "dom"
    out.detail = active ? "active ExpertOption account" : "guest session — not signed in"
    out.account = {
      type: active ? "active" : "guest",
      guest: !active,
      email: dom.email ?? null,
      name: dom.name ?? null,
      wallet: dom.wallet ?? null,
      balance: dom.balance ?? null
    }
    return out
  }

  // Account menu / avatar are decent medium-confidence positives.
  if (dom?.accountMenu || dom?.avatar) {
    out.loggedIn = true
    out.confidence = "medium"
    out.method = "dom"
    out.detail = dom.accountMenu ? "account menu present" : "avatar present"
    return out
  }

  const hint = site?.id ? LOGIN_HINTS[site.id] : null
  const cookies = await detectLoginCookies(url)
  if (cookies.ok && cookies.cookies.length && hint?.cookieAuth !== false) {
    const hintHits = (hint?.authCookies ?? []).filter((n) => cookies.cookies.some((c) => c.name.toLowerCase() === n.toLowerCase()))
    if (hintHits.length) {
      out.loggedIn = true
      out.confidence = "high"
      out.method = "cookie"
      out.detail = `site auth cookie: ${hintHits.join(", ")}`
      return out
    }
    const generic = cookies.cookies.filter((c) => GENERIC_AUTH_COOKIE_RE.test(c.name) && !NON_AUTH_COOKIE_RE.test(c.name))
    if (generic.length) {
      out.loggedIn = true
      out.confidence = "medium"
      out.method = "cookie"
      out.detail = `auth cookies: ${generic.slice(0, 3).map((c) => c.name).join(", ")}`
      return out
    }
  }

  // Weak negative: a lone "Sign in" button with no other signal.
  if (dom?.loginButton) {
    out.loggedIn = false
    out.confidence = "low"
    out.method = "dom"
    out.detail = "sign-in button present"
    return out
  }

  out.detail = "no auth signal found"
  return out
}

/**
 * Refresh the cached login state for one tab and (when it flips) broadcast the
 * change so every subscriber stays in sync. Also auto-captures a fresh
 * ExpertOption session token the moment a login lands, reviving a stale/dead
 * trading bridge without any manual step.
 */
async function refreshTabLogin(tabId) {
  const tab = studio.tabs.find((t) => t.id === tabId)
  if (!tab || !livePage(tab.page)) return tab?.auth ?? null
  const now = Date.now()
  if (tab._loginCheckedAt && now - tab._loginCheckedAt < LOGIN_CHECK_MIN_INTERVAL_MS) return tab.auth ?? null
  tab._loginCheckedAt = now
  let auth = null
  try {
    auth = await detectLoginState(tab.page, tab)
  } catch {
    auth = null
  }
  if (!auth) return tab.auth ?? null
  touchTabActivity(tabId) // a successful login scan is a sign of life
  const flipped = tab.auth && tab.auth.loggedIn != null && auth.loggedIn != null && tab.auth.loggedIn !== auth.loggedIn
  tab.auth = auth
  if (flipped) {
    broadcast({ type: "tabs", ...tabsPayload() })
    broadcast({ type: "status", status: studioStatus() })
  }
  if (auth.loggedIn && auth.site === "expertoption") {
    if (now - studio._lastEOCapture >= EO_CAPTURE_COOLDOWN_MS) {
      void captureExpertOptionSession(tab.page)
        .then(async (r) => {
          // A guest session carries the same token cookie — never let it clobber
          // a good active-account token (demo context refuses guest tokens).
          if (!r?.ok || r.guest) return
          studio._lastEOCapture = Date.now()
          const changed = r.token !== studio._lastEOCaptureToken
          studio._lastEOCaptureToken = r.token
          if (!changed) return
          const live = await import("./liveEO.mjs").catch(() => null)
          const stats = live?.liveEOStats?.()
          const broken = !stats || stats.status !== "connected" || Boolean(stats.error)
          if (changed || broken) live?.restartLiveEO?.({ force: true })
        })
        .catch(() => {
          // Never hammer a failing page — only a successful active-account
          // capture resets the cooldown for the next attempt.
          studio._lastEOCapture = Date.now()
        })
    }
  }
  return auth
}

/** Refresh login state across every tab (navigation, page spawns, resync). */
export async function refreshLoginStates() {
  const results = []
  for (const tab of [...studio.tabs]) {
    try {
      const auth = await refreshTabLogin(tab.id)
      if (auth) results.push({ tabId: tab.id, auth })
    } catch {
      /* per-tab best-effort */
    }
  }
  return { ok: true, results }
}

async function detectGoogleSessionList(page) {
  try {
    const res = await page
      .evaluate(async () => {
        const r = await fetch("https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard", {
          credentials: "include",
          cache: "no-store"
        })
        if (!r.ok) return { ok: false, detail: `ListAccounts HTTP ${r.status}` }
        return { ok: true, text: await r.text() }
      })
      .catch((err) => ({ ok: false, detail: String(err?.message ?? err) }))
    if (!res.ok || !res.text) return { ok: false, detail: res.detail ?? "no ListAccounts response" }
    // Google has served three shapes over time: a classic JSON array of
    // accounts, an `{ isLoginRequired, accounts }` envelope, and (today) an
    // HTML page whose script postMessages the escaped account payload to the
    // account chooser. Try each in turn.
    let json = null
    try {
      json = JSON.parse(res.text)
    } catch {
      json = null
    }
    if (Array.isArray(json)) {
      const accounts = json.map((a) => a?.email).filter(Boolean)
      return { ok: true, loggedIn: accounts.length > 0, accounts, detail: `classic array, ${accounts.length} account(s)` }
    }
    if (json && typeof json.isLoginRequired === "boolean") {
      const accounts = Array.isArray(json.accounts) ? json.accounts.map((a) => a?.email).filter(Boolean) : []
      return { ok: true, loggedIn: json.isLoginRequired === false && accounts.length > 0, accounts, detail: `isLoginRequired=${json.isLoginRequired}` }
    }
    const accounts = parseListAccountsHtml(res.text)
    if (accounts) {
      return { ok: true, loggedIn: accounts.length > 0, accounts, detail: `postMessage payload, ${accounts.length} account(s)` }
    }
    return { ok: false, detail: "ListAccounts response not parseable" }
  } catch (err) {
    return { ok: false, detail: String(err?.message ?? err) }
  }
}

/**
 * Parse the modern ListAccounts response: an HTML page whose script calls
 * `window.parent.postMessage('<escaped-json>', ...)`. The payload is Google's
 * internal "gaia" serialization: `["gaia.l.a.r", [["gaia.l.a", v, name, email,
 * avatar, ...], ...]]`. Decodes escapes safely (no eval/Function on remote
 * text) and returns the signed-in account emails.
 */
export function parseListAccountsHtml(text) {
  const m = text.match(/window\.parent\.postMessage\((['"])([\s\S]*?)\1\s*,/)
  if (!m) return null
  try {
    const real = unescapeJsString(m[2])
    const payload = JSON.parse(real)
    const root = Array.isArray(payload) ? payload : null
    if (!root || !Array.isArray(root[1])) return null
    const emails = root[1].filter((t) => Array.isArray(t) && typeof t[3] === "string").map((t) => t[3]).filter(Boolean)
    return emails.length ? emails : null
  } catch {
    return null
  }
}

/** Decode a JavaScript string-literal body (\xNN, \uNNNN, \/, \\, \' …) to a string. */
export function unescapeJsString(raw) {
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\(['"\\/])/g, "$1")
}

/** Best-effort: extract a signed-in account email from the page text. */
async function detectGoogleSessionDom(page) {
  return page
    .evaluate(() => {
      const text = document.body ? document.body.innerText : ""
      const matches = text.match(/[\w.+-]+@[\w-]+\.\w{2,}/g) || []
      const unique = [...new Set(matches.map((e) => e.toLowerCase()))]
      const candidate = unique.find((e) => !/^(no-reply|noreply|support|help|accounts|security|privacy|feedback|google|gmail|reply)@/i.test(e) && !/\.google\./i.test(e.split("@")[1] ?? ""))
      return candidate ?? null
    })
    .catch(() => null)
}

/** Read the persistent profile's Google cookies — sign-in proof from any tab. */
async function detectGoogleCookies() {
  try {
    const context = studio.bridge?.context
    if (!context?.cookies) return { ok: false, detail: "context cookie API unavailable" }
    const cookies = await context
      .cookies(["https://accounts.google.com", "https://google.com", "https://gmail.com"])
      .catch(() => [])
    const auth = cookies.filter((c) => GOOGLE_AUTH_COOKIES.includes(c.name))
    const names = [...new Set(auth.map((c) => c.name))]
    if (auth.length > 0) {
      return { ok: true, loggedIn: true, names, detail: `auth cookies: ${names.join(", ")}` }
    }
    return { ok: true, loggedIn: false, names: [], detail: `no Google auth cookies (${cookies.length} google-domain cookies total)` }
  } catch (err) {
    return { ok: false, detail: String(err?.message ?? err) }
  }
}

async function googleSetValue(page, selector, value) {
  return page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector)
      if (!el) return false
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      if (setter) setter.call(el, value)
      else el.value = value
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    },
    { selector, value }
  )
}

async function googleClickNext(page, nextId) {
  await page
    .evaluate(
      (nextId) => {
        const btn = document.querySelector(nextId)
        if (btn) {
          btn.click()
          return true
        }
        const submit = document.querySelector('button[type="submit"]')
        if (submit) {
          submit.click()
          return true
        }
        const candidate = [...document.querySelectorAll("button")].find((b) => /next|sign in|continue/i.test(b.innerText ?? ""))
        if (candidate) {
          candidate.click()
          return true
        }
        return false
      },
      nextId
    )
    .catch(() => false)
}

async function googleWaitVisible(page, selector, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const visible = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel)
        return Boolean(el && el.offsetParent !== null)
      }, selector)
      .catch(() => false)
    if (visible) return true
    await page.waitForTimeout(250)
  }
  return false
}

/**
 * Drive Google's two-step sign-in (email → Next → password → Next) on the
 * active tab, then wait for the session to land and report WHICH account the
 * browser is now bound to — covering an existing account and a brand-new
 * sign-up alike. Never throws — returns a report so the UI can show state.
 * Report fields: loggedIn / account (the session account) / boundTo (account
 * the linked identity should rebind to).
 */
async function googleAutoLogin(page, username, password) {
  const report = { ok: true, mode: "google", site: "google", steps: [], submitted: false, error: null, loggedIn: false, account: null, boundTo: null }
  try {
    await page.waitForTimeout(500)

    // If a Google session is already live in this browser profile, report the
    // account we are bound to and skip typing entirely — no sign-in needed.
    const already = await detectGoogleSession(page)
    if (already.ok && already.loggedIn) {
      report.steps.push("session")
      report.loggedIn = true
      report.account = already.account ?? null
      report.boundTo = already.account ?? null
      // Cookie-tier signal proves sign-in but not WHICH account — land on
      // accounts.google.com so the ListAccounts JSON can resolve the email.
      if (!already.account) {
        await page.goto("https://accounts.google.com", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
        for (let i = 0; i < 6 && !report.account; i++) {
          await page.waitForTimeout(500)
          const resolved = await detectGoogleSession(page)
          if (resolved.ok && resolved.account) {
            report.account = resolved.account
            report.boundTo = resolved.account
          }
        }
      }
      return report
    }

    // Account chooser / "use another account" → step into the manual form.
    await page
      .evaluate(() => {
        const btn = [...document.querySelectorAll("button, a, div, span")].find((b) => /use another account/i.test(b.textContent ?? ""))
        if (btn) btn.click()
      })
      .catch(() => {})
    await page.waitForTimeout(700)

    const identifierVisible = await googleWaitVisible(
      page,
      "#identifierId, input[type='email'], input[name='identifier'], input[autocomplete='username']",
      5000
    )
    if (identifierVisible) {
      report.steps.push("identifier")
      await googleSetValue(page, "#identifierId, input[type='email'], input[name='identifier'], input[autocomplete='username']", username)
      await googleClickNext(page, "#identifierNext")
      await page.waitForTimeout(1500)
    }

    const passwordVisible = await googleWaitVisible(page, "#password, input[type='password']", 10000)
    if (passwordVisible) {
      report.steps.push("password")
      await googleSetValue(page, "#password, input[type='password']", password)
      await googleClickNext(page, "#passwordNext")
      report.submitted = true
    } else if (report.steps.length === 0) {
      report.error = "no Google sign-in form found on this page"
    }

    // Wait for the sign-in to land, then read which account the session is now
    // bound to (existing account or brand-new sign-up).
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000)
      const session = await detectGoogleSession(page)
      if (session.ok && session.loggedIn) {
        report.loggedIn = true
        report.account = session.account ?? null
        report.boundTo = session.account ?? null
        break
      }
    }
    if (report.submitted && !report.loggedIn) {
      report.error = report.error || "credentials submitted, but the sign-in has not landed yet — finish it in the browser"
    }
  } catch (err) {
    report.ok = false
    report.error = String(err?.message ?? err)
  }
  return report
}

/**
 * One-tap login for the active tab. Google accounts run the full two-step
 * flow (email → Next → password → Next) automatically; every other site gets
 * its vaulted credentials filled in (submit is still yours).
 */
export async function studioLogin({ site } = {}) {
  ensureOpen()
  const page = await ensureActivePage()
  if (!page) {
    const err = new Error("browser is not available — open the browser first")
    err.code = "BROWSER_CLOSED"
    throw err
  }
  const url = await safeUrl(page)
  const detected = detectSite(url)
  const raw = String(site || "").trim()
  const isGoogleUrl = GOOGLE_SIGNIN_HINTS.some((h) => url.includes(h))
  let key = raw || detected?.name || (isGoogleUrl ? "google" : "")
  if (isGoogleUrl && !raw) key = "google"
  key = key.trim().toLowerCase()
  const creds = await getSiteCredentials(key)
  if (!creds || !creds.username) throw new Error(`no saved credentials for "${key}" — save them in the vault first`)
  const isGoogle = isGoogleUrl || key === "google" || key === "gmail"
  // An explicit Google login must always land on the sign-in page first —
  // otherwise the "Sign in in browser" action would type into whatever tab
  // happens to be active.
  if (isGoogle && !isGoogleUrl) {
    await page.goto("https://accounts.google.com", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
  let report
  if (!isGoogle) {
    report = { ok: true, site: key, mode: "fill", submitted: false, steps: [], ...(await fillLoginFields(page, creds.username, creds.password)) }
  } else {
    report = await googleAutoLogin(page, creds.username, creds.password)
  }
  // ExpertOption keeps a short-lived session token in web storage. Grab it the
  // moment a login lands so the WS bridge never runs on a stale pasted token.
  // A session still showing as guest means the sign-in hasn't landed yet.
  if (report.ok && key === "expertoption") {
    try {
      const cap = await captureExpertOptionSession()
      report.tokenCaptured = cap.guest ? null : maskToken(cap.token)
      report.tokenGuest = cap.guest || null
    } catch {
      report.tokenCaptured = null // session not live yet — recapture via /api/browser/capture-session
    }
  }
  return report
}

/**
 * Report the LIVE Google session state of the embedded browser, so the Profile
 * page reflects what is actually signed in rather than only what was stored
 * last time. With `navigate: true` the active tab is driven to
 * accounts.google.com so the exact account email can be resolved; otherwise it
 * reads the session WITHOUT navigating (cookie-tier sign-in proof from any tab,
 * exact account only when the tab already sits on accounts.google.com). Never
 * throws — returns a report the Profile card can render directly.
 */
export async function studioGoogleSession({ navigate = false } = {}) {
  ensureOpen()
  const page = await ensureActivePage()
  if (!page) {
    return { ok: true, available: false, onGooglePage: false, method: "none", loggedIn: false, account: null, url: null, detail: "no active tab" }
  }
  let url = await safeUrl(page)
  const onGoogle = GOOGLE_SESSION_HOSTS.test(url)
  if (!onGoogle && navigate) {
    await page.goto("https://accounts.google.com", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {})
    // A signed-in visit bounces accounts.google.com → myaccount.google.com;
    // give it a few beats and re-read the real URL either way.
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(500)
      url = await safeUrl(page)
      if (GOOGLE_SESSION_HOSTS.test(url)) break
    }
  }
  const session = await detectGoogleSession(page)
  const settled = GOOGLE_SESSION_HOSTS.test(url)
  return {
    ok: true,
    available: true,
    onGooglePage: settled,
    method: session.ok ? session.method : "cookie",
    loggedIn: Boolean(session.loggedIn),
    account: session.account ?? null,
    url,
    detail: session.detail ?? null
  }
}

/**
 * Read the active ExpertOption tab's live session token and save it as the
 * `expertoptionToken` trading credential. Runs inside the real browser session
 * (cookies/web storage are only visible there), so the captured token is always
 * fresh — no more pasting a token that quietly goes stale.
 */
export async function captureExpertOptionSession(page) {
  ensureOpen()
  const target = page && livePage(page) ? page : activePage()
  if (!/expertoption\.com/i.test(target.url())) {
    throw new Error("open an app.expertoption.com tab first")
  }
  const hits = await target.evaluate(() => {
    // Current platform: a 32-hex cookie token (`token` = the session the app is
    // actively using and that setContext accepts). The `token` cookie value can
    // carry a binary prefix before the hex, so also extract a trailing 32-hex
    // run. Legacy sessions used a `uuid::base64` web-storage token.
    const pattern = /^[0-9a-f]{32}$/
    const tailHex = /([0-9a-f]{32})$/
    const legacy = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::[A-Za-z0-9+/=_\-]+$/
    const found = []
    const check = (source, key, value, score) => {
      const v = String(value ?? "")
      if (!v) return
      if (pattern.test(v)) found.push({ source, key, value: v, score })
      else if (legacy.test(v)) found.push({ source, key, value: v, score: score - 1 })
      else if (source === "cookie") {
        const m = v.match(tailHex)
        if (m) found.push({ source, key, value: m[1], score: score + 2 })
      }
    }
    document.cookie.split(";").forEach((c) => {
      const i = c.indexOf("=")
      if (i > 0) check("cookie", c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1)), 3)
    })
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      check("localStorage", k, localStorage.getItem(k), 2)
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      check("sessionStorage", k, sessionStorage.getItem(k), 2)
    }
    // The `token` cookie is the live session token (accepts demo AND real WS
    // contexts); `tokenDemo` is only the demo-context token and can go stale.
    // Prefer cookies over web-storage mirrors, which the app can lag behind.
    const rank = (h) =>
      h.source === "cookie" && h.key === "token" ? 4 : h.source === "cookie" && h.key === "tokenDemo" ? 3 : h.source === "cookie" ? 2 : 1
    found.sort((a, b) => rank(b) - rank(a) || b.score - a.score)
    return found
  })
  if (!hits.length) {
    throw new Error("no session token found on this page — log in first")
  }
  const best = hits[0]
  // Guest (not signed-in) sessions carry the same token cookie, so read the
  // account model from the content window's own login state. A guest token is
  // never saved over a good active-account one (the demo WS context refuses it).
  let guest = false
  let account = null
  try {
    const dom = await target.evaluate(domLoginSignals)
    guest = Boolean(dom && dom.guest && !dom.active)
    if (guest || dom?.active) {
      account = {
        type: guest ? "guest" : "active",
        guest,
        email: dom.email ?? null,
        name: dom.name ?? null,
        wallet: dom.wallet ?? null,
        balance: dom.balance ?? null
      }
    }
  } catch {
    guest = false
  }
  if (guest) {
    return { ok: true, token: best.value, source: `${best.source}:${best.key}`, guest: true, saved: false, account }
  }
  const { saveCredentials } = await import("./trading.mjs")
  await saveCredentials({ expertoptionToken: best.value })
  return { ok: true, token: best.value, source: `${best.source}:${best.key}`, guest: false, saved: true, account }
}

/** Mask a token for display in the UI (never masks short/empty strings). */
export function maskToken(token) {
  if (!token || token.length < 8) return token ?? ""
  return token.slice(0, 16) + "…"
}
