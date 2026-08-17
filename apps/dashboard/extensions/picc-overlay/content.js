// PICC Overlay — content script
// Injected into every page. Creates/manages the overlay with dockables.
// Communicates with the PICC server for site detection, settings, intervention, and metrics.

(() => {
  if (window.__picc_content_loaded) return
  window.__picc_content_loaded = true

  const OVERLAY_ID = "__PICC_OVERLAY__"
  let overlayVisible = false
  let serverOnline = null
  let activeDockables = []
  let currentSite = null

  // ── Site detection ──────────────────────────────────────────────────────────
  const SITE_PROFILES = [
    // Trading
    { hosts: ["expertoption.com", "expert-option.com"], id: "expertoption", label: "ExpertOption", category: "trading", suite: "trading" },
    { hosts: ["binance.com", "www.binance.com"], id: "binance", label: "Binance", category: "trading", suite: "trading" },
    { hosts: ["coinbase.com", "www.coinbase.com"], id: "coinbase", label: "Coinbase", category: "trading", suite: "trading" },
    { hosts: ["kraken.com", "www.kraken.com"], id: "kraken", label: "Kraken", category: "trading", suite: "trading" },
    { hosts: ["robinhood.com", "www.robinhood.com"], id: "robinhood", label: "Robinhood", category: "trading", suite: "trading" },
    { hosts: ["tastytrade.com", "www.tastytrade.com"], id: "tastytrade", label: "Tastytrade", category: "trading", suite: "trading" },
    { hosts: ["webull.com", "www.webull.com"], id: "webull", label: "Webull", category: "trading", suite: "trading" },
    { hosts: ["etoro.com", "www.etoro.com"], id: "etoro", label: "eToro", category: "trading", suite: "trading" },
    { hosts: ["tradingview.com", "www.tradingview.com"], id: "tradingview", label: "TradingView", category: "trading", suite: "trading" },
    { hosts: ["mt4.metaquotes.net", "mt5.metaquotes.net"], id: "metatrader", label: "MetaTrader", category: "trading", suite: "trading" },
    { hosts: ["deriv.com", "www.deriv.com"], id: "deriv", label: "Deriv", category: "trading", suite: "trading" },
    { hosts: ["olymptrade.com", "www.olymptrade.com"], id: "olymptrade", label: "OlympTrade", category: "trading", suite: "trading" },
    { hosts: ["quotex.com", "www.quotex.com"], id: "quotex", label: "Quotex", category: "trading", suite: "trading" },
    { hosts: ["iqoption.com", "www.iqoption.com"], id: "iqoption", label: "IQ Option", category: "trading", suite: "trading" },
    { hosts: ["nadex.com", "www.nadex.com"], id: "nadex", label: "Nadex", category: "trading", suite: "trading" },
    // Bandwidth
    { hosts: ["speedtest.net", "www.speedtest.net"], id: "speedtest", label: "Speedtest", category: "bandwidth", suite: "bandwidth" },
    { hosts: ["fast.com"], id: "fast", label: "Fast.com", category: "bandwidth", suite: "bandwidth" },
    { hosts: ["ipinfo.io", "ip.me", "whatismyip.com"], id: "ipinfo", label: "IP Info", category: "bandwidth", suite: "bandwidth" },
    // Dividends / Interest
    { hosts: ["schwab.com", "www.schwab.com"], id: "schwab", label: "Schwab", category: "dividend", suite: "dividend" },
    { hosts: ["fidelity.com", "www.fidelity.com"], id: "fidelity", label: "Fidelity", category: "dividend", suite: "dividend" },
    { hosts: ["vanguard.com", "www.vanguard.com"], id: "vanguard", label: "Vanguard", category: "dividend", suite: "dividend" },
    // Affiliate
    { hosts: ["amazon.com", "www.amazon.com"], id: "amazon", label: "Amazon", category: "affiliate", suite: "affiliate" },
    { hosts: ["shopee.com", "shopee.*"], id: "shopee", label: "Shopee", category: "affiliate", suite: "affiliate" },
    { hosts: ["lazada.com", "www.lazada.com"], id: "lazada", label: "Lazada", category: "affiliate", suite: "affiliate" },
    // Content
    { hosts: ["youtube.com", "www.youtube.com"], id: "youtube", label: "YouTube", category: "content", suite: "content" },
    { hosts: ["tiktok.com", "www.tiktok.com"], id: "tiktok", label: "TikTok", category: "content", suite: "content" },
    { hosts: ["medium.com"], id: "medium", label: "Medium", category: "content", suite: "content" },
    // Crypto / DeFi
    { hosts: ["metamask.io", "app.uniswap.org"], id: "defi", label: "DeFi", category: "defi", suite: "defi" },
    { hosts: ["opensea.io"], id: "opensea", label: "OpenSea", category: "nft", suite: "nft" },
    // P2P
    { hosts: ["localbitcoins.com", "paxful.com"], id: "p2p", label: "P2P", category: "p2p", suite: "p2p" },
    // Agents
    { hosts: ["openai.com", "chat.openai.com"], id: "openai", label: "OpenAI", category: "agent", suite: "agent" },
    { hosts: ["anthropic.com"], id: "anthropic", label: "Anthropic", category: "agent", suite: "agent" },
    // Other
    { hosts: ["google.com", "www.google.com", "accounts.google.com"], id: "google", label: "Google", category: "other", suite: null },
    { hosts: ["github.com", "www.github.com"], id: "github", label: "GitHub", category: "other", suite: null },
  ]

  function detectSite(url) {
    try {
      const u = new URL(url)
      const host = u.hostname.toLowerCase().replace(/^www\./, "")
      for (const profile of SITE_PROFILES) {
        if (profile.hosts.some((h) => host === h || host.endsWith("." + h))) {
          return { ...profile, host }
        }
      }
      return { id: null, label: host, category: "other", suite: null, host }
    } catch {
      return null
    }
  }

  // ── Server communication (ZERO fetch — everything via background) ──────────
  // Content scripts in MV3 CANNOT reach localhost. The background service worker
  // is the ONLY entity that touches the network. This is by design.
  async function serverFetch(path, opts) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "picc-server-fetch",
        path,
        method: opts?.method || "GET",
        body: opts?.body || null,
        timeout: opts?.timeout || 8000
      })
      if (!resp || !resp.ok) return null
      return resp.data
    } catch {
      // Extension context invalidated or background not ready
      return null
    }
  }

  async function checkServer() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: "check-server" })
      serverOnline = !!(resp && resp.online)
      serverPort = resp?.port || null
    } catch {
      serverOnline = false
      serverPort = null
    }
    // Update the server status indicator in the overlay
    updateServerStatus()
    return serverOnline
  }

  let serverPort = null
  function updateServerStatus() {
    const overlay = document.getElementById(OVERLAY_ID)
    if (!overlay) return
    const statusEl = overlay.querySelector("[data-picc-server-status]")
    if (!statusEl) return
    if (serverOnline === true) {
      statusEl.textContent = "connected" + (serverPort ? " :" + serverPort : "")
      statusEl.style.color = "#22c55e"
    } else if (serverOnline === false) {
      statusEl.textContent = "offline"
      statusEl.style.color = "#ff5353"
    } else {
      statusEl.textContent = "checking…"
      statusEl.style.color = "#a5a0ff"
    }
  }

  async function getPrefs() {
    return await serverFetch("/api/browser/prefs") || {}
  }

  async function savePrefsForSite(siteId, prefs) {
    return await serverFetch("/api/browser/prefs", { method: "POST", body: { site: siteId, ...prefs } })
  }

  // ── Metrics collection (supplies data to PICC web app) ─────────────────────
  function collectPageMetrics() {
    return {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY, max: document.documentElement.scrollHeight },
      performance: {
        loadTime: performance.timing?.loadEventEnd - performance.timing?.navigationStart || 0,
        domReady: performance.timing?.domContentLoadedEventEnd - performance.timing?.navigationStart || 0,
      },
      resources: performance.getEntriesByType?.("resource")?.length || 0,
      forms: document.forms.length,
      links: document.links.length,
      images: document.images.length,
    }
  }

  // Expose metrics getter for PICC web app
  window.__picc_getMetrics = collectPageMetrics

  // ── In-page toast notification ──────────────────────────────────────────────
  function showToast(title, message, type = "info") {
    const toast = document.createElement("div")
    const colors = { info: "#6c63ff", success: "#22c55e", warning: "#f59e0b", error: "#ff5353" }
    toast.style.cssText = `
      position:fixed;top:16px;right:16px;z-index:2147483647;
      background:rgba(20,20,48,0.95);backdrop-filter:blur(12px);
      border:1px solid ${colors[type] || colors.info}40;border-radius:8px;
      padding:10px 14px;font:13px/1.4 system-ui,sans-serif;color:#eef0ff;
      box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:320px;
      animation:picc-toast-in .3s ease;
    `
    const style = document.createElement("style")
    style.textContent = `@keyframes picc-toast-in{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}`
    document.documentElement.appendChild(style)

    const titleEl = document.createElement("div")
    titleEl.style.cssText = "font-weight:600;font-size:12px;color:#6c63ff;margin-bottom:4px;"
    titleEl.textContent = title
    toast.appendChild(titleEl)

    if (message) {
      const msgEl = document.createElement("div")
      msgEl.style.cssText = "font-size:11px;color:#a5a0ff;"
      msgEl.textContent = message
      toast.appendChild(msgEl)
    }

    document.documentElement.appendChild(toast)
    setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity .3s"; setTimeout(() => toast.remove(), 300) }, 4000)
  }

  // ── Dockables system ───────────────────────────────────────────────────────
  // Each dockable is a self-contained panel that can be:
  // - Collapsed (just title bar)
  // - Expanded (full content)
  // - Resized (drag corner)
  // - Moved (drag header)
  // - Stacked (when docked to sides)
  // - Transformed (rotate, scale)

  function createDockable(opts) {
    const {
      id, title, icon, content, position = "bottom-left",
      width = 300, height = 200, collapsed = true,
      features = {}, suite = null
    } = opts

    const dock = document.createElement("div")
    dock.id = `__PICC_DOCK_${id}__`
    dock.setAttribute("data-picc-dock", "")
    dock.setAttribute("data-picc-suite", suite || "")

    const posMap = {
      "top-left": { top: "8px", left: "8px" },
      "top-right": { top: "8px", right: "8px" },
      "bottom-left": { bottom: "8px", left: "8px" },
      "bottom-right": { bottom: "8px", right: "8px" },
      "left": { top: "50%", left: "8px", transform: "translateY(-50%)" },
      "right": { top: "50%", right: "8px", transform: "translateY(-50%)" },
    }
    const pos = posMap[position] || posMap["bottom-left"]

    dock.style.cssText = `position:fixed;z-index:2147483646;width:${collapsed ? "auto" : width}px;max-height:${collapsed ? "36px" : height}px;overflow:${collapsed ? "visible" : "auto"};` +
      Object.entries(pos).map(([k, v]) => `${k}:${v}`).join(";") + ";" +
      `background:rgba(20,20,48,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#eef0ff;` +
      `border:1px solid rgba(108,99,255,0.4);border-radius:8px;font:12px/1.4 system-ui,sans-serif;` +
      `box-shadow:0 4px 16px rgba(0,0,0,.3);transition:max-height .2s ease,width .2s ease;user-select:none;`
    dock.setAttribute("data-collapsed", collapsed ? "1" : "0")

    // Title bar (always visible)
    const titleBar = document.createElement("div")
    titleBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 8px;cursor:move;white-space:nowrap;"
    titleBar.innerHTML = ""

    const titleSpan = document.createElement("span")
    titleSpan.style.cssText = "font-weight:600;color:#6c63ff;font-size:11px;"
    titleSpan.textContent = `${icon || ""} ${title}`

    const dockBtns = document.createElement("span")
    dockBtns.style.cssText = "display:flex;gap:2px;"

    const toggleBtn = document.createElement("button")
    toggleBtn.textContent = "\u25B8"
    toggleBtn.title = "Expand"
    toggleBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:11px;padding:1px 4px;border-radius:3px;"
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const c = dock.getAttribute("data-collapsed") === "1"
      dock.setAttribute("data-collapsed", c ? "0" : "1")
      dock.style.maxHeight = c ? height + "px" : "36px"
      dock.style.width = c ? width + "px" : "auto"
      dock.style.overflow = c ? "auto" : "visible"
      toggleBtn.textContent = c ? "\u25BE" : "\u25B8"
      toggleBtn.title = c ? "Collapse" : "Expand"
      if (body) body.style.display = c ? "" : "none"
    })

    const closeBtn = document.createElement("button")
    closeBtn.textContent = "\u2715"
    closeBtn.title = "Remove dockable"
    closeBtn.style.cssText = "background:none;border:none;color:#a5a0ff;cursor:pointer;font-size:10px;padding:1px 4px;border-radius:3px;opacity:.6;"
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      dock.remove()
      activeDockables = activeDockables.filter((d) => d.id !== id)
    })

    dockBtns.appendChild(toggleBtn)
    dockBtns.appendChild(closeBtn)
    titleBar.replaceChildren(titleSpan, dockBtns)
    dock.appendChild(titleBar)

    // Content body
    let body = null
    if (content) {
      body = document.createElement("div")
      body.style.cssText = "padding:6px 8px;font-size:11px;color:#a5a0ff;"
      if (typeof content === "string") body.textContent = content
      else if (content instanceof HTMLElement) body.appendChild(content)
      if (collapsed) body.style.display = "none"
      dock.appendChild(body)
    }

    // Feature badges
    if (features && Object.keys(features).length > 0) {
      const badges = document.createElement("div")
      badges.style.cssText = "display:flex;flex-wrap:wrap;gap:3px;padding:0 8px 4px;"
      const icons = { assistance: "\uD83D\uDCA1", decisionSupport: "\uD83D\uDCCA", automation: "\u2699\uFE0F", autopilot: "\uD83E\uDD16", analysis: "\uD83D\uDD0D", ai: "\uD83E\uDDE0" }
      for (const [key, enabled] of Object.entries(features)) {
        const badge = document.createElement("span")
        badge.style.cssText = `font-size:9px;padding:1px 4px;border-radius:4px;${enabled ? "background:#6c63ff30;color:#a5a0ff;" : "background:#33334060;color:#555;"}`
        badge.textContent = `${icons[key] || "\u2022"} ${key}`
        badges.appendChild(badge)
      }
      if (collapsed) badges.style.display = "none"
      dock.appendChild(badges)
      if (!body) {
        body = badges
      }
    }

    // Drag
    let dragging = false, sx = 0, sy = 0
    titleBar.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return
      dragging = true; sx = e.clientX; sy = e.clientY
      const rect = dock.getBoundingClientRect()
      e.preventDefault()
      const onMove = (ev) => {
        if (!dragging) return
        dock.style.left = (rect.left + ev.clientX - sx) + "px"
        dock.style.top = (rect.top + ev.clientY - sy) + "px"
        dock.style.right = "auto"
        dock.style.bottom = "auto"
        dock.style.transform = "none"
      }
      const onUp = () => { dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    })

    // Resize handle
    const resizeHandle = document.createElement("div")
    resizeHandle.style.cssText = "position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;opacity:.3;"
    resizeHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation()
      const startX = e.clientX, startY = e.clientY
      const startW = dock.offsetWidth, startH = dock.offsetHeight
      const onMove = (ev) => {
        dock.style.width = Math.max(150, startW + ev.clientX - startX) + "px"
        dock.style.maxHeight = Math.max(80, startH + ev.clientY - startY) + "px"
      }
      const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    })
    dock.appendChild(resizeHandle)

    return dock
  }

  // ── Trading suite dockables ────────────────────────────────────────────────
  function createTradingDockables(siteInfo) {
    const dockables = []

    // Price ticker
    dockables.push(createDockable({
      id: "price-ticker", title: "Price Ticker", icon: "\uD83D\uDCC8",
      content: "Loading market data...", position: "top-right",
      width: 280, height: 180, collapsed: false,
      features: { decisionSupport: true, analysis: true }, suite: "trading"
    }))

    // Portfolio overview
    dockables.push(createDockable({
      id: "portfolio", title: "Portfolio", icon: "\uD83D\uDCC0",
      content: "Connecting to exchange...", position: "top-left",
      width: 300, height: 200, collapsed: true,
      features: { assistance: true, decisionSupport: true }, suite: "trading"
    }))

    // AI signals
    dockables.push(createDockable({
      id: "ai-signals", title: "AI Signals", icon: "\uD83E\uDDE0",
      content: "Analyzing market conditions...", position: "right",
      width: 260, height: 300, collapsed: true,
      features: { ai: true, analysis: true, decisionSupport: true }, suite: "trading"
    }))

    // Risk manager
    dockables.push(createDockable({
      id: "risk-mgr", title: "Risk Manager", icon: "\u26A0\uFE0F",
      content: "Calculating risk metrics...", position: "bottom-right",
      width: 280, height: 160, collapsed: true,
      features: { assistance: true, automation: true }, suite: "trading"
    }))

    // Autopilot status
    dockables.push(createDockable({
      id: "autopilot", title: "Autopilot", icon: "\uD83E\uDD16",
      content: "Autopilot standby", position: "bottom-left",
      width: 260, height: 200, collapsed: false,
      features: { autopilot: true, automation: true }, suite: "trading"
    }))

    return dockables
  }

  // ── Generic suite dockables ────────────────────────────────────────────────
  function createGenericDockables(siteInfo) {
    return [createDockable({
      id: "general", title: siteInfo?.label || "Site", icon: "\uD83D\uDDA5\uFE0F",
      content: `PICC active on ${siteInfo?.label || window.location.hostname}`,
      position: "bottom-right", width: 280, height: 160, collapsed: false,
      features: { assistance: true }, suite: siteInfo?.suite
    })]
  }

  // ── Main overlay creation ──────────────────────────────────────────────────
  function createOverlay(siteInfo, overlaySettings) {
    // Remove existing
    const existing = document.getElementById(OVERLAY_ID)
    if (existing) existing.remove()
    activeDockables.forEach((d) => { const el = document.getElementById(`__PICC_DOCK_${d.id}__`); if (el) el.remove() })
    activeDockables = []

    currentSite = siteInfo

    // Create the pill (main control)
    const el = document.createElement("div")
    el.id = OVERLAY_ID
    el.setAttribute("data-picc-overlay", "1")
    document.documentElement.appendChild(el)

    const cfg = overlaySettings || {}
    const posX = cfg.position?.x ?? 16
    const posY = cfg.position?.y ?? 16
    const opa = cfg.opacity ?? 0.92
    const isCollapsed = cfg.collapsed !== false

    el.style.cssText =
      `position:fixed;bottom:${posY}px;left:${posX}px;z-index:2147483647;width:auto;max-height:none;overflow:visible;` +
      `background:rgba(20,20,48,${opa});backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#eef0ff;` +
      `border:1px solid rgba(108,99,255,0.5);border-radius:12px;padding:4px 8px;font:13px/1.5 system-ui,sans-serif;` +
      `box-shadow:0 8px 32px rgba(0,0,0,.4),0 0 0 1px rgba(108,99,255,0.15);user-select:none;`

    // Pill header
    const header = document.createElement("div")
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;"

    const brand = document.createElement("span")
    brand.style.cssText = "font-weight:700;color:#6c63ff;font-size:12px;letter-spacing:.5px;white-space:nowrap;"
    brand.textContent = "\uD83E\uDDE0 PICC" + (siteInfo?.label ? " \u00B7 " + siteInfo.label : "")

    // Server status indicator
    const serverStatus = document.createElement("span")
    serverStatus.setAttribute("data-picc-server-status", "")
    serverStatus.style.cssText = "font-size:10px;white-space:nowrap;"
    if (serverOnline === true) {
      serverStatus.textContent = "server connected"
      serverStatus.style.color = "#22c55e"
    } else if (serverOnline === false) {
      serverStatus.textContent = "server offline"
      serverStatus.style.color = "#ff5353"
    } else {
      serverStatus.textContent = "checking…"
      serverStatus.style.color = "#a5a0ff"
    }

    const btnRow = document.createElement("span")
    btnRow.style.cssText = "display:flex;gap:2px;align-items:center;"

    // Expand button (shows dockables)
    const expandBtn = document.createElement("button")
    expandBtn.textContent = "\u25B8"
    expandBtn.title = "Show suite dockables"
    expandBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:4px;"
    let dockablesVisible = false
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      dockablesVisible = !dockablesVisible
      expandBtn.textContent = dockablesVisible ? "\u25BE" : "\u25B8"
      expandBtn.title = dockablesVisible ? "Hide suite dockables" : "Show suite dockables"
      activeDockables.forEach((d) => {
        const dockEl = document.getElementById(`__PICC_DOCK_${d.id}__`)
        if (dockEl) dockEl.style.display = dockablesVisible ? "" : "none"
      })
    })

    // Settings button
    const settingsBtn = document.createElement("button")
    settingsBtn.textContent = "\u2699"
    settingsBtn.title = "Overlay settings"
    settingsBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:4px;"
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      let panel = el.querySelector("[data-picc-settings]")
      if (panel) { panel.remove(); return }
      panel = createSettingsPanel(el, cfg, siteInfo)
      el.appendChild(panel)
    })

    // Close button
    const closeBtn = document.createElement("button")
    closeBtn.textContent = "\u2715"
    closeBtn.title = "Close overlay (re-open via Ctrl+Alt+Shift+O)"
    closeBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px;opacity:.7;"
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      overlayVisible = false
      el.remove()
      activeDockables.forEach((d) => { const dockEl = document.getElementById(`__PICC_DOCK_${d.id}__`); if (dockEl) dockEl.remove() })
      activeDockables = []
      if (siteInfo?.id) savePrefsForSite(siteInfo.id, { overlay: false })
    })

    btnRow.appendChild(expandBtn)
    btnRow.appendChild(settingsBtn)
    btnRow.appendChild(closeBtn)
    header.replaceChildren(brand, serverStatus, btnRow)
    el.appendChild(header)

    // Drag pill
    let dragging = false, sx = 0, sy = 0
    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return
      dragging = true; sx = e.clientX; sy = e.clientY
      const rect = el.getBoundingClientRect()
      e.preventDefault()
      const onMove = (ev) => {
        if (!dragging) return
        el.style.left = (rect.left + ev.clientX - sx) + "px"
        el.style.bottom = "auto"
        el.style.top = (rect.top + ev.clientY - sy) + "px"
      }
      const onUp = () => { dragging = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    })

    overlayVisible = true

    // Create dockables for the suite
    const docks = siteInfo?.suite === "trading"
      ? createTradingDockables(siteInfo)
      : createGenericDockables(siteInfo)

    activeDockables = docks.map((d) => ({ id: d.id || "" }))
    docks.forEach((dock) => {
      dock.style.display = "none" // Hidden until expand is clicked
      document.documentElement.appendChild(dock)
    })

    return el
  }

  // ── Settings panel ─────────────────────────────────────────────────────────
  function createSettingsPanel(el, cfg, siteInfo) {
    const panel = document.createElement("div")
    panel.setAttribute("data-picc-settings", "")
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

    // Feature toggles (based on suite)
    if (siteInfo?.suite) {
      const featTitle = document.createElement("div")
      featTitle.style.cssText = "font-size:11px;color:#a5a0ff;margin:6px 0 4px;"
      featTitle.textContent = "Features"
      panel.appendChild(featTitle)

      const features = { assistance: "Assistance", decisionSupport: "Decision Support", automation: "Automation", autopilot: "Autopilot", analysis: "Analysis", ai: "AI" }
      const featRow = document.createElement("div")
      featRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;"
      for (const [key, label] of Object.entries(features)) {
        const toggle = document.createElement("label")
        toggle.style.cssText = "font-size:10px;color:#a5a0ff;display:flex;align-items:center;gap:3px;cursor:pointer;"
        const cb = document.createElement("input")
        cb.type = "checkbox"
        cb.checked = cfg.features?.[key] !== false
        cb.style.cssText = "width:12px;height:12px;"
        cb.addEventListener("change", () => {
          if (!cfg.features) cfg.features = {}
          cfg.features[key] = cb.checked
        })
        toggle.appendChild(cb)
        toggle.appendChild(document.createTextNode(label))
        featRow.appendChild(toggle)
      }
      panel.appendChild(featRow)
    }

    // Close panel
    const closePanelBtn = document.createElement("button")
    closePanelBtn.textContent = "\u2715 Close"
    closePanelBtn.style.cssText = "background:#6c63ff30;border:1px solid #6c63ff40;color:#a5a0ff;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:4px;margin-top:6px;"
    closePanelBtn.addEventListener("click", (ev) => { ev.stopPropagation(); panel.remove() })
    panel.appendChild(closePanelBtn)

    return panel
  }

  // ── Toggle overlay ──────────────────────────────────────────────────────────
  async function toggleOverlay() {
    if (overlayVisible) {
      const el = document.getElementById(OVERLAY_ID)
      if (el) el.remove()
      activeDockables.forEach((d) => { const dockEl = document.getElementById(`__PICC_DOCK_${d.id}__`); if (dockEl) dockEl.remove() })
      activeDockables = []
      overlayVisible = false
      return
    }

    const siteInfo = detectSite(window.location.href)
    if (siteInfo?.id) {
      const prefs = await getPrefs()
      const sitePrefs = prefs[siteInfo.id]
      if (sitePrefs?.overlay === false) {
        await savePrefsForSite(siteInfo.id, { overlay: true })
      }
    }

    let overlaySettings = {}
    if (siteInfo?.id) {
      const prefs = await getPrefs()
      const sitePrefs = prefs[siteInfo.id]
      if (sitePrefs?.overlaySettings) overlaySettings = sitePrefs.overlaySettings
    }

    createOverlay(siteInfo, overlaySettings)
  }

  // ── Keyboard shortcut ───────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault()
      e.stopPropagation()
      toggleOverlay()
    }
  }, true)

  // ── Message listener from background/popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "toggle-overlay") toggleOverlay()
    if (msg.action === "get-metrics") return collectPageMetrics()
    if (msg.action === "server-status") {
      serverOnline = msg.online
      serverPort = msg.port || null
      updateServerStatus()
    }
    if (msg.action === "show-notification") {
      // Show in-page toast notification
      showToast(msg.title, msg.message, msg.type)
    }
  })

  // ── Server check on load ────────────────────────────────────────────────────
  // Initial check via background. Periodic updates come from background alarms
  // pushing "server-status" messages to this content script.
  checkServer()
})()
