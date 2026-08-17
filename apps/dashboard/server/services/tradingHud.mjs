/**
 * Live trading HUD — the injected, display-only overlay for trading platforms.
 *
 * When the studio's active page is a trading site (ExpertOption today), this
 * service subscribes to the adaptive-confluence decision engine and pushes the
 * current signal board into the page's PICC overlay as a compact⇄full HUD:
 *
 *   • bottom-right, collapsible to a one-line pill, pointer-events:none except
 *     the expand/collapse toggle — the browsed site stays fully interactive;
 *   • expiry + MTTD countdown clocks are computed in-page from absolute
 *     timestamps (no per-second server pushes);
 *   • rebuilt on every decision (~15s) and re-injected after each navigation;
 *   • honest, read-only, always demo-display with a clear DEMO badge.
 *
 * Respects the per-site overlay preference (explicit `overlay: false` disables
 * the HUD for that site). All DOM is built with createElement/textContent —
 * Trusted-Types safe, no HTML strings.
 */
import { subscribeDecisions, getDecisions } from "./adaptiveConfluence.mjs"
import { onStudioEvent, studioStatus, studioOverlay, getBrowserPreferences, isOverlayEnabled } from "./browserStudio.mjs"
import { suiteForSite } from "./suites.mjs"

const HUD_MIN_INTERVAL_MS = 3000
const PREF_CACHE_MS = 30_000
const VERDICT_TONE = { TRADE: "#1f9d5b", OBSERVE: "#d09e2b", NEUTRAL: "#6f6f95" }
const DIR_ARROW = { up: "↑", down: "↓" }

let started = false
let offStudio = null
let offDecisions = null
let currentSite = null
let lastPushAt = 0
let lastNodesJson = null
let prefCache = { at: 0, prefs: {} }
const stats = { active: false, site: null, suite: null, lastPushAt: 0, lastNodesJson: null, lastError: null, pushes: 0 }

function statusLine(msg) {
  const parts = [String(msg?.mode ?? "demo")]
  if (msg?.status === "connected") parts.push("connected")
  if (msg?.viewed) parts.push(`viewing ${msg.viewed}`)
  return parts.join(" · ")
}

function rowFor(d, ts) {
  const tone = VERDICT_TONE[d.verdict] ?? "#6f6f95"
  const dir = DIR_ARROW[d.direction] ?? "·"
  const expiryAt = d.expiry ? ts + Number(d.expiry) * 1000 : 0
  const mttdAt = d.mttdSec != null && d.mttdSec > 0 ? ts + Number(d.mttdSec) * 1000 : 0
  const cells = [
    { tag: "span", style: `font-weight:700;color:${tone}`, text: String(d.verdict ?? "?") },
    { tag: "span", style: "font-weight:600", text: `${String(d.asset ?? "?")} ${dir}` },
    { tag: "span", style: "opacity:.7", text: String(d.phase ?? "") }
  ]
  if (d.winProb != null) cells.push({ tag: "span", text: `${Math.round(Number(d.winProb) * 100)}%` })
  if (d.ev != null) cells.push({ tag: "span", text: `EV ${Math.round(Number(d.ev) * 100)}%` })
  if (d.payout) cells.push({ tag: "span", text: `P${Number(d.payout)}%` })
  if (expiryAt) {
    cells.push({
      tag: "span",
      style: "font-variant-numeric:tabular-nums;opacity:.9",
      attrs: { "data-picc-clock": "", "data-at": String(expiryAt), "data-label": "expiry" },
      text: "expiry --:--"
    })
  }
  if (mttdAt) {
    cells.push({
      tag: "span",
      style: "font-variant-numeric:tabular-nums;opacity:.65",
      attrs: { "data-picc-clock": "", "data-at": String(mttdAt), "data-label": "mttd" },
      text: "mttd --:--"
    })
  }
  return {
    tag: "div",
    className: "picc-hud-row",
    style: "display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;border-top:1px solid rgba(108,99,255,.25);padding:5px 0",
    attrs: { "data-picc-hud-role": "row" },
    children: cells
  }
}

/**
 * Build the full overlay node set for the trading HUD (pure, testable).
 */
export function tradingHudNodes(site, msg) {
  const decisions = Array.isArray(msg?.decisions) ? msg.decisions : []
  const ts = Number(msg?.ts ?? Date.now())
  const label = site?.name ?? "trading platform"
  const rows = decisions.map((d) => rowFor(d, ts))
  const nodeStyle =
    "position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:340px;max-height:70vh;overflow:auto;" +
    "background:#141430;color:#eef0ff;border:1px solid #6c63ff;border-radius:12px;padding:12px;" +
    "font:12.5px/1.5 system-ui,-apple-system,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.5);pointer-events:none"
  const header = {
    tag: "div",
    style: "display:flex;align-items:center;gap:8px;margin-bottom:6px",
    children: [
      { tag: "span", style: "font-weight:700", text: `🧠 PICC · ${label}` },
      { tag: "span", style: "font-weight:700;color:#f1c40f;border:1px solid #f1c40f;border-radius:4px;padding:0 4px;font-size:10px", text: "DEMO" },
      {
        tag: "button",
        className: "picc-hud-toggle",
        style:
          "pointer-events:auto;cursor:pointer;margin-left:auto;background:transparent;border:1px solid #6c63ff;" +
          "color:#eef0ff;border-radius:6px;padding:2px 8px;font:11px system-ui",
        attrs: { "data-picc-hud-role": "toggle" },
        text: "▾ expand"
      }
    ]
  }
  const meta = {
    tag: "div",
    style: "opacity:.75;margin-bottom:4px",
    text: `${statusLine(msg)} · ${decisions.length} signals · updated ${new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  }
  const empty = rows.length === 0
    ? [{ tag: "div", style: "opacity:.7;padding:4px 0", text: "No signals yet — engine is warming up." }]
    : rows
  const footer = {
    tag: "div",
    style: "opacity:.55;margin-top:6px;font-size:11px",
    text: "Read-only display. Decisions are demo signals — never trade live without approval."
  }
  return [
    // The whole HUD lives inside #__PICC_OVERLAY__ but overrides its position
    // to the bottom-right corner and keeps itself non-interactive.
    { tag: "div", style: nodeStyle, attrs: { "data-picc-hud": "compact" }, children: [header, meta, ...empty, footer] }
  ]
}

async function overlayMeta(site) {
  if (!prefCache.prefs || Date.now() - prefCache.at > PREF_CACHE_MS) {
    prefCache = { at: Date.now(), prefs: (await getBrowserPreferences().catch(() => ({}))) ?? {} }
  }
  const pref = prefCache.prefs?.[site?.id] ?? prefCache.prefs?.[site?.host]
  return { allowed: pref?.overlay !== false, overlaySettings: pref?.overlaySettings }
}

async function evaluate(msg) {
  stats.evaluations = (stats.evaluations ?? 0) + 1
  // A full navigation destroys the injected overlay DOM, so the next push must
  // re-inject even when the decision content is byte-identical to the last one.
  if (msg?.type === "intel" && msg.intel?.category === "navigation") {
    lastNodesJson = null
    lastPushAt = 0
    stats.lastPushAt = 0
  }
  const status = studioStatus()
  const site = status?.open ? (status.currentSite ?? null) : null
  const suite = site ? suiteForSite(site) : null
  if (!site || !status.open || suite?.id !== "trading") {
    stats.active = false
    stats.site = null
    stats.suite = null
    deactivate()
    return
  }
  stats.active = true
  stats.site = site
  stats.suite = suite
  currentSite = site
  if (!offDecisions) {
    offDecisions = subscribeDecisions(() => void push())
  }
  void push()
}

function deactivate() {
  if (offDecisions) {
    try {
      offDecisions()
    } catch {
      /* ignore */
    }
    offDecisions = null
  }
  currentSite = null
  lastNodesJson = null
  lastPushAt = 0
  stats.lastPushAt = 0
  stats.lastNodesJson = null
}

async function push() {
  if (!currentSite || !offDecisions) return
  if (!isOverlayEnabled()) return
  const { allowed, overlaySettings } = await overlayMeta(currentSite)
  if (!allowed) return
  const now = Date.now()
  if (now - lastPushAt < HUD_MIN_INTERVAL_MS) return
  try {
    const msg = await getDecisions()
    const nodes = tradingHudNodes(currentSite, msg)
    const json = JSON.stringify(nodes)
    if (json === lastNodesJson) return
    lastNodesJson = json
    lastPushAt = now
    stats.lastPushAt = now
    stats.pushes++
    await studioOverlay({ nodes, overlaySettings: overlaySettings ? { ...overlaySettings, _site: currentSite?.id } : undefined })
    stats.lastError = null
  } catch (err) {
    stats.lastError = err?.message ?? String(err)
    /* best-effort — the overlay must never break the browser */
  }
}

/**
 * Start the trading HUD. Listens to studio lifecycle/navigation so it only
 * activates while a trading site is loaded, and re-injects after each page
 * load. Idempotent.
 */
export function startTradingHud() {
  if (started) return
  started = true
  offStudio = onStudioEvent((msg) => {
    if (
      msg.type === "assist" ||
      msg.type === "status" ||
      msg.type === "closed" ||
      (msg.type === "intel" && msg.intel?.category === "navigation")
    ) {
      void evaluate(msg)
    }
  })
  void evaluate()
}

