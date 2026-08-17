// Browser bridge — drives a REAL installed Chromium browser (Chrome/Edge) over
// the Chrome DevTools Protocol via playwright-core. This is PICC's universal
// read path for income sources that expose no public API: log in once with a
// persistent browser profile, then read the live dashboard DOM and the page's
// own WebSocket traffic in real time.
//
// Why real Chrome (not an Electron WebView or an iframe): the target site
// literally talks to Google Chrome/Edge, so there is no fingerprint to detect.
// A persistent user-data-dir keeps cookies/sessions so the site sees a normal
// returning browser, and we strip the automation signals we control
// (navigator.webdriver) to keep the page behaving exactly as it would for a
// human user.
//
// The bridge is read-only by contract: it never clicks buy/withdraw. The
// PICC overlay it injects only displays metrics and suggestions.
import { chromium } from "playwright-core"
import { execSync } from "node:child_process"
import { cpSync, mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const BROWSER_DATA_DIR = fileURLToPath(new URL("../data/browser-profiles", import.meta.url))

const CHANNEL_CANDIDATES = ["msedge", "chrome", "chromium"]

/** Chromium paths for machines where the playwright channel lookup misses. */
const STATIC_EXES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/brave-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
]

/**
 * Best-effort registry lookup for a browser executable on Windows. Most users
 * install Chrome per-user (so Program Files paths miss) or register an
 * arbitrary install dir; the App Paths keys are where Windows itself looks.
 */
function regExecutable(app) {
  const keys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${app}`,
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${app}`
  ]
  for (const key of keys) {
    try {
      const out = execSync(`reg query "${key}" /ve`, { encoding: "utf8", windowsHide: true, timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })
      const m = out.match(/REG_SZ\s+(.+)/)
      const path = m?.[1]?.trim()
      if (path && /\.exe$/i.test(path)) return path
    } catch {
      /* key missing */
    }
  }
  return ""
}

/** Windows install locations, including the very common per-user installs. */
function windowsExes() {
  const list = []
  const push = (p) => {
    if (p && !list.includes(p)) list.push(p)
  }
  const la = process.env.LOCALAPPDATA
  if (la) {
    push(join(la, "Microsoft", "Edge", "Application", "msedge.exe"))
    push(join(la, "Google", "Chrome", "Application", "chrome.exe"))
    push(join(la, "Chromium", "Application", "chrome.exe"))
    push(join(la, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"))
  }
  for (const app of ["msedge.exe", "chrome.exe", "chromium.exe", "brave.exe"]) push(regExecutable(app))
  const pf = process.env.ProgramFiles
  const pf86 = process.env["ProgramFiles(x86)"]
  if (pf86) {
    push(join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"))
    push(join(pf86, "Google", "Chrome", "Application", "chrome.exe"))
  }
  if (pf) {
    push(join(pf, "Microsoft", "Edge", "Application", "msedge.exe"))
    push(join(pf, "Google", "Chrome", "Application", "chrome.exe"))
  }
  return list
}

/** Every known executable path, deduped, ordered most-likely first. */
export const EXE_CANDIDATES = [...windowsExes(), ...STATIC_EXES]

/**
 * Ordered list of launch strategies — env path first, then the playwright
 * channel registry (msedge/chrome/chromium), then known install locations.
 * openBridge tries each in turn and keeps the first that launches.
 */
function launchStrategies() {
  const strategies = []
  if (process.env.PICC_BROWSER_PATH) strategies.push({ executablePath: process.env.PICC_BROWSER_PATH })
  for (const channel of CHANNEL_CANDIDATES) strategies.push({ channel })
  for (const exe of EXE_CANDIDATES) strategies.push({ executablePath: exe })
  return strategies
}

export const browserAvailable = () => {
  if (process.env.PICC_BROWSER_PATH && existsSync(process.env.PICC_BROWSER_PATH)) return true
  for (const exe of EXE_CANDIDATES) {
    try {
      if (existsSync(exe)) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

/**
 * When an existing Chrome/Edge window already holds a user-data-dir, a new
 * launch of the same profile exits immediately with errors like "browser has
 * been closed" or "user data directory is already in use". This happens after
 * the dashboard restarts while a studio browser window is still open. Those
 * windows are PICC's own — they are the only processes allowed to bind the
 * profile dir — so killing them and retrying once is safe.
 */
function isProfileLockError(msg) {
  return /has been closed|already in use|ProcessSingleton|profile in use|Singletonsocket/i.test(msg ?? "")
}

function killProfileProcesses(userDataDir) {
  const needle = String(userDataDir)
  if (process.platform !== "win32") {
    // macOS/Linux: pgrep -f matches against the full command line.
    let killed = 0
    try {
      const out = execSync(`pgrep -f "${needle}"`, { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim()
      for (const id of out.split(/\s+/).map(Number).filter(Boolean)) {
        try {
          execSync(`kill -9 ${id}`, { stdio: "ignore" })
          killed++
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* no matches */
    }
    return killed
  }
  // Windows: run a temp .ps1 so no inline quoting can corrupt the -like pattern.
  const ps1 = join(tmpdir(), `picc-kill-profile-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ps1`)
  writeFileSync(ps1, 'param([string]$Needle)\nGet-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$Needle*" } | ForEach-Object { $_.ProcessId }\n')
  let killed = 0
  try {
    const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" "${needle}"`, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
    for (const id of out.split(/\s+/).map(Number).filter(Boolean)) {
      try {
        execSync(`taskkill /PID ${id} /T /F`, { windowsHide: true, stdio: "ignore" })
        killed++
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no matches */
  } finally {
    try {
      unlinkSync(ps1)
    } catch {
      /* ignore */
    }
  }
  return killed
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 }

/**
 * Best-effort OS timezone. The bridge must present the host's real timezone,
 * not a forced UTC — a browser claiming UTC from a Malaysia/SG/etc machine is
 * exactly the fingerprint mismatch bot detectors key on.
 */
function osTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/** Best-effort OS language tag (Windows registry first, Node ICU fallback). */
function osLocale() {
  if (process.platform === "win32") {
    try {
      const out = execSync('reg query "HKCU\\Control Panel\\International\\nLocaleName" /ve', {
        encoding: "utf8",
        windowsHide: true,
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"]
      })
      const m = out.match(/REG_SZ\s+(.+)/)
      const tag = m?.[1]?.trim()
      if (tag) return tag
    } catch {
      /* key missing */
    }
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
  } catch {
    return "en-US"
  }
}

/** Primary monitor size on Windows so headed windows present a real screen. */
function osViewport() {
  if (process.platform !== "win32") return { ...DEFAULT_VIEWPORT }
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.ToString()"',
      { encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }
    )
    const m = out.match(/Width=(\d+)[,}].*Height=(\d+)/s)
    if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return { width: Number(m[1]), height: Number(m[2]) }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_VIEWPORT }
}

/** Chromium lock markers that mean a source profile is currently in use. */
const PROFILE_LOCK_MARKERS = ["SingletonLock", "lockfile", "LOCK"]

// Volatile caches we never need from a real browser profile. Everything else
// (Cookies, Local Storage, IndexedDB, Login Data, History, Preferences, …) is
// copied so the imported profile looks and behaves like a seasoned browser.
const IMPORT_EXCLUDES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "GraphiteDawnCache",
  "GrShaderCache",
  "ShaderCache",
  "GpuCache",
  "Service Worker",
  "Crashpad",
  "Crash Reports",
  "logs",
  "Logs",
  "Dictionaries",
  "component_crx_cache",
  "extensions_crx_cache"
]

/** Inspect a candidate real browser profile (used by settings + import UI). */
export function realProfileState(realProfilePath) {
  const src = String(realProfilePath || "").trim()
  if (!src) return { enabled: false, source: "" }
  const sourceExists = existsSync(src)
  let locked = false
  if (sourceExists) {
    for (const marker of PROFILE_LOCK_MARKERS) {
      if (existsSync(join(src, marker))) {
        locked = true
        break
      }
    }
  }
  return { enabled: true, source: src, sourceExists, locked }
}

/**
 * Snapshot a real browser profile (e.g. the user's logged-in Edge) into
 * PICC's managed profile dir. The source browser must be closed — Chromium
 * holds a lock marker and a live LevelDB copy would be corrupted.
 */
export function importRealProfile({ realProfilePath, profile = "studio" } = {}) {
  const state = realProfileState(realProfilePath)
  if (!state.enabled) throw new Error("realProfilePath is required")
  if (!state.sourceExists) throw new Error(`real profile not found: ${state.source}`)
  if (state.locked) {
    throw new Error("the source browser is currently running — close Edge/Chrome before importing (its profile is locked)")
  }
  const safe = String(profile).replace(/[^a-zA-Z0-9_-]/g, "_")
  const dst = join(BROWSER_DATA_DIR, `${safe}-import`)
  const walk = (srcDir, dstDir) => {
    mkdirSync(dstDir, { recursive: true })
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      if (entry.isDirectory() && IMPORT_EXCLUDES.includes(entry.name)) continue
      const from = join(srcDir, entry.name)
      const to = join(dstDir, entry.name)
      if (entry.isDirectory()) walk(from, to)
      else if (entry.isFile()) cpSync(from, to, { force: true })
    }
  }
  rmSync(dst, { recursive: true, force: true })
  walk(src, dst)
  return { ok: true, source: src, dir: dst }
}

/**
 * Open a browser bridge session backed by a persistent profile directory.
 *
 * Fingerprint philosophy: this browser must look like the host's real browser.
 * Headless is off by default, timezone/locale/viewport follow the OS, and a
 * real browser profile can be imported (see importRealProfile) so the session
 * carries the age, history and login state a normal browser would have.
 *
 * @param {object} opts
 * @param {string} opts.profile   name of the persistent profile (per income source)
 * @param {boolean} [opts.headless] default false — headed windows read as human
 * @param {boolean} [opts.stealth]  strip automation signals we control (default true)
 * @param {string}  [opts.downloadsDir] directory for downloads (default: profile dir)
 * @param {boolean} [opts.devTools] open Chrome DevTools for every tab
 * @param {string}  [opts.timezone] IANA timezone override (default: OS timezone)
 * @param {string}  [opts.locale]   language tag override (default: OS locale)
 * @param {object}  [opts.viewport] {width,height} override (default: OS screen)
 * @param {string}  [opts.realProfilePath] import this real browser profile into PICC
 * @returns {Promise<{page, context, frames, onFrame, goto, evaluate, read, addOverlay, setOverlay, close, reset}>}
 */
export async function openBridge({
  profile = "default",
  headless = false,
  stealth = true,
  downloadsDir,
  devTools = false,
  timezone,
  locale,
  viewport,
  realProfilePath
} = {}) {
  const safe = profile.replace(/[^a-zA-Z0-9_-]/g, "_")
  let userDataDir = join(BROWSER_DATA_DIR, safe)
  if (realProfilePath) {
    const state = realProfileState(realProfilePath)
    if (state.sourceExists) {
      const importDir = join(BROWSER_DATA_DIR, `${safe}-import`)
      if (!existsSync(join(importDir, "Preferences"))) {
        if (state.locked) {
          throw new Error("the source browser is running — close Edge/Chrome first so its profile can be imported")
        }
        importRealProfile({ realProfilePath, profile })
      }
      userDataDir = importDir
    }
  }
  mkdirSync(userDataDir, { recursive: true })

  const args = ["--start-maximized"]
  const ignoreDefaultArgs = []
  if (stealth) {
    // navigator.webdriver is what sites use to fingerprint automation; these
    // two flags remove the signals we are able to remove in a real browser.
    ignoreDefaultArgs.push("--enable-automation")
    args.push("--disable-blink-features=AutomationControlled")
  }
  if (devTools) args.push("--auto-open-devtools-for-tabs")

  const baseOpts = {
    headless,
    // Headed: let the real window decide (--start-maximized). Headless still
    // needs an explicit viewport, so use the host screen size.
    viewport: viewport ?? (headless ? osViewport() : null),
    userAgent: undefined, // let the real browser present its own UA
    args,
    ignoreDefaultArgs,
    locale: locale || osLocale(),
    timezoneId: timezone || osTimezone()
  }
  if (downloadsDir) baseOpts.downloadsPath = downloadsDir

  let context = null
  let lastErr = null
  let launchErr = null
  let sawLockError = false
  const attempt = async () => {
    for (const strategy of launchStrategies()) {
      try {
        return await chromium.launchPersistentContext(userDataDir, { ...strategy, ...baseOpts })
      } catch (err) {
        lastErr = err
        // A missing executable is not a "launch failure" — remember the first
        // error from a candidate that exists on disk (real failure, e.g. a
        // locked profile) over the trailing "file doesn't exist" messages.
        if (!launchErr && !/executable doesn't exist|Executable doesn't exist/i.test(err.message ?? "")) {
          launchErr = err
        }
        if (isProfileLockError(err.message ?? "")) sawLockError = true
      }
    }
    return null
  }
  context = await attempt()
  if (!context && sawLockError && killProfileProcesses(userDataDir) > 0) {
    await sleep(600)
    launchErr = null
    lastErr = null
    sawLockError = false
    context = await attempt()
  }
  if (!context) {
    const candidates = [
      ...(process.env.PICC_BROWSER_PATH ? [`PICC_BROWSER_PATH=${process.env.PICC_BROWSER_PATH}`] : []),
      ...CHANNEL_CANDIDATES.map((c) => `channel ${c}`),
      ...EXE_CANDIDATES
    ]
    const detail = launchErr?.message ?? lastErr?.message ?? ""
    const err = new Error(
      `no Chromium browser could be launched. Tried ${candidates.length} candidates (${candidates.slice(0, 6).join(", ")}${
        candidates.length > 6 ? ", …" : ""
      }). Install Google Chrome or Microsoft Edge (any install location, including per-user), or set PICC_BROWSER_PATH to a chrome/msedge executable.` +
        (detail ? ` ${detail.slice(0, 200)}` : "")
    )
    err.code = "NO_BROWSER"
    throw err
  }

  const page = context.pages()[0] ?? (await context.newPage())

  // --- WebSocket sniffing: the page's own WS frames become PICC data. -------
  const frames = []
  const frameListeners = new Set()
  page.on("websocket", (ws) => {
    const url = ws.url()
    ws.on("framesent", (e) => {
      if (e.payload) {
        frames.push({ dir: "sent", payload: e.payload, url })
        for (const cb of frameListeners) {
          try {
            cb({ dir: "sent", payload: e.payload, url })
          } catch {
            /* listener errors never break the bridge */
          }
        }
      }
    })
    ws.on("framereceived", (e) => {
      if (e.payload) {
        frames.push({ dir: "recv", payload: e.payload, url })
        for (const cb of frameListeners) {
          try {
            cb({ dir: "recv", payload: e.payload, url })
          } catch {
            /* listener errors never break the bridge */
          }
        }
      }
    })
  })

  const OVERLAY_ID = "picc-bridge-overlay"

  /**
   * Coerce overlay input (node array, plain string, or single node) into the
   * node-array shape `addOverlay` expects. setOverlay previously fed raw
   * values straight into the array loop — a string was iterated character by
   * character and every node rendered "undefined".
   */
  const normalizeOverlayNodes = (nodes) => {
    if (typeof nodes === "string") return [{ text: nodes }]
    if (!Array.isArray(nodes)) return [{ text: String(nodes ?? "") }]
    return nodes.map((n) => (typeof n === "string" ? { text: n } : { text: String(n?.text ?? ""), ...(n ? { tag: n.tag, className: n.className, style: n.style } : {}) }))
  }

  /**
   * Inject a PICC overlay into the current page. The site's own scripts do not
   * own this node and it is isolated from page state; it only displays data.
   */
  async function addOverlay(nodes) {
    const script = (items) => {
      const id = "__PICC_OVERLAY__"
      let el = document.getElementById(id)
      if (!el) {
        el = document.createElement("div")
        el.id = id
        el.style.cssText =
          "position:fixed;bottom:16px;left:16px;z-index:2147483647;max-width:320px;max-height:70vh;overflow:auto;" +
          "background:#141430;color:#eef0ff;border:1px solid #6c63ff;border-radius:12px;padding:14px;font:13px/1.5 system-ui,sans-serif;" +
          "box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:system-ui,-apple-system,sans-serif"
        document.documentElement.appendChild(el)
      }
      // innerHTML and DOMParser.parseFromString are both blocked by Trusted-Types
      // pages (accounts.google.com) — build nodes with createElement/textContent
      // only so the overlay can never crash the page.
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
      el.replaceChildren()
      for (const item of items) el.appendChild(build(item))
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
    }
    await page.evaluate(script, nodes)
    return OVERLAY_ID
  }

  /**
   * Read a normalized text snapshot of the current page. When `selectors` is
   * provided, only matching elements are extracted (cheap, targeted DOM read);
   * otherwise the full body text is returned.
   *
   * Selectors may be plain CSS (`[class*='balance']`) or a `text:` prefix
   * (`"text:Floor price"`) that matches the most specific element whose text
   * contains the label — handy for sites whose class names are hashed/utility.
   * Each value may also be an array of selectors; the first one that matches
   * wins (used by generic automation fallbacks).
   */
  async function read({ selectors } = {}) {
    return readPage(page, selectors)
  }

  return {
    page,
    context,
    frames,
    onFrame: (cb) => {
      frameListeners.add(cb)
      return () => frameListeners.delete(cb)
    },
    goto: (url, opts) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000, ...opts }),
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    read,
    addOverlay,
    setOverlay: (nodes) => addOverlay(normalizeOverlayNodes(nodes)),
    close: () => context.close().catch(() => {}),
    async reset() {
      await context.clearCookies().catch(() => {})
    }
  }
}

/**
 * Read a normalized DOM text snapshot from an explicit page (not the bridge's
 * initial page), so multi-tab studio sessions always read the active tab. The
 * evaluation function is fully self-contained (page.evaluate serializes it).
 */
export function readPage(page, selectors) {
  const fn = (sel) => {
    if (!sel) return { text: document.body?.innerText ?? "", url: location.href, title: document.title }
    const matches = (selector) => {
      const out = []
      if (typeof selector === "string" && selector.startsWith("text:")) {
        const needle = selector.slice(5)
        for (const el of document.querySelectorAll("div, span, p, strong, td, h1, h2, h3, li, label, a")) {
          const t = (el.textContent ?? "").trim().replace(/\s+/g, " ")
          if (t.includes(needle) && t.length <= 300) out.push({ el, t })
        }
      }
      return out
    }
    const pick = (selector) => {
      const tryOne = (single) => {
        if (typeof single === "string" && single.startsWith("text:")) {
          const all = matches(single)
          if (all.length === 0) return null
          const withNumber = all.filter((m) => /\d/.test(m.t))
          const target = withNumber.length > 0 ? withNumber : all
          target.sort((a, b) => a.t.length - b.t.length)
          return target[0].el
        }
        if (typeof single !== "string") return null
        try {
          return document.querySelector(single)
        } catch {
          return null
        }
      }
      const list = Array.isArray(selector) ? selector : [selector]
      for (const single of list) {
        const el = tryOne(single)
        if (el) return el
      }
      return null
    }
    const out = {}
    for (const [key, selector] of Object.entries(sel)) {
      const el = pick(selector)
      out[key] = el ? (el.innerText ?? el.textContent ?? "").trim() : null
    }
    return { ...out, url: location.href, title: document.title }
  }
  return page.evaluate(fn, selectors)
}
