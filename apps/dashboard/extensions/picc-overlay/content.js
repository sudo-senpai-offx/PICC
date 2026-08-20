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
  let currentSettings = {}

  // ── State maps for dockable persistence ──
  const dockablePositions = {}
  const dockableSizes = {}
  const dockableOpacities = {}

  // ── Dock grouping state ──
  const dockGroups = {} // groupId → [dockId, dockId, ...]
  const dockGroupMap = {} // dockId → groupId

  function saveDockableLayout() {
    const layout = {}
    for (const d of activeDockables) {
      layout[d.id] = {
        position: dockablePositions[d.id] || null,
        size: dockableSizes[d.id] || null,
        opacity: dockableOpacities[d.id] ?? null
      }
    }
    // Save via server
    try {
      const data = { dockableLayout: layout, groups: dockGroups }
      chrome.runtime.sendMessage({ action: "save-prefs", data })
    } catch {}
  }

  // ── Dock grouping (Krita/Photoshop-style tab stacking) ──
  function groupDocks(dockIdA, dockIdB) {
    const groupId = dockGroupMap[dockIdA] || dockGroupMap[dockIdB] || `picc-group-${Date.now()}`
    const docks = [dockIdA, dockIdB]
    if (!dockGroups[groupId]) dockGroups[groupId] = []
    for (const d of docks) {
      if (!dockGroups[groupId].includes(d)) dockGroups[groupId].push(d)
      dockGroupMap[d] = groupId
    }
    rebuildGroupContainer(groupId)
  }

  function ungroupDock(dockId) {
    const groupId = dockGroupMap[dockId]
    if (!groupId) return
    const members = dockGroups[groupId] || []
    delete dockGroupMap[dockId]
    const remaining = members.filter((d) => d !== dockId)
    if (remaining.length <= 1) {
      // Dissolve group entirely
      for (const d of remaining) delete dockGroupMap[d]
      delete dockGroups[groupId]
      // Remove the group container
      const gc = shadowRoot.getElementById(`__PICC_GROUP_${groupId}__`)
      if (gc) gc.remove()
      // Show individual docks
      for (const d of remaining) {
        const el = shadowRoot.getElementById(`__PICC_DOCK_${d}__`)
        if (el) el.style.display = ""
      }
    } else {
      dockGroups[groupId] = remaining
      rebuildGroupContainer(groupId)
    }
    saveDockableLayout()
  }

  function rebuildGroupContainer(groupId) {
    const members = dockGroups[groupId] || []
    if (members.length < 2) return
    // Remove old container
    const oldGc = shadowRoot.getElementById(`__PICC_GROUP_${groupId}__`)
    if (oldGc) oldGc.remove()
    // Hide individual dock elements
    for (const d of members) {
      const el = shadowRoot.getElementById(`__PICC_DOCK_${d}__`)
      if (el) el.style.display = "none"
    }
    // Create grouped container
    const gc = document.createElement("div")
    gc.id = `__PICC_GROUP_${groupId}__`
    gc.setAttribute("data-picc-group", groupId)
    // Position at the first member's position
    const firstDock = shadowRoot.getElementById(`__PICC_DOCK_${members[0]}__`)
    const firstPos = dockablePositions[members[0]] || { x: 16, y: 16 }
    const firstSize = dockableSizes[members[0]] || { width: 280, height: 200 }
    gc.style.cssText = `position:fixed;top:${firstPos.y}px;left:${firstPos.x}px;width:${firstSize.width}px;max-height:${firstSize.height}px;overflow:auto;z-index:2147483646;` +
      `background:rgba(20,20,48,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#eef0ff;` +
      `border:1px solid rgba(108,99,255,0.4);border-radius:8px;font:12px/1.4 system-ui,sans-serif;` +
      `box-shadow:0 4px 16px rgba(0,0,0,.3);transition:max-height .2s ease;user-select:none;pointer-events:auto;`
    gc.style.opacity = String(dockableOpacities[members[0]] ?? currentSettings.opacity)

    // Tab bar
    const tabBar = document.createElement("div")
    tabBar.style.cssText = "display:flex;align-items:center;background:rgba(26,26,46,0.6);border-bottom:1px solid rgba(42,42,74,0.4);overflow-x:auto;user-select:none;"
    let activeTab = members[0]
    const tabEls = {}

    for (const dId of members) {
      const preset = (SUITE_DOCKABLE_PRESETS.trading || []).concat(SUITE_DOCKABLE_PRESETS.bandwidth || []).concat(SUITE_DOCKABLE_PRESETS.affiliate || []).concat(SUITE_DOCKABLE_PRESETS.generic || []).find((p) => p.id === dId)
      const tab = document.createElement("div")
      const isActive = dId === activeTab
      tab.style.cssText = `display:flex;align-items:center;gap:3px;padding:4px 8px;font-size:10px;cursor:pointer;white-space:nowrap;border-bottom:2px solid ${isActive ? "#6c63ff" : "transparent"};` +
        `background:${isActive ? "rgba(108,99,255,0.12)" : "transparent"};color:${isActive ? "#eef0ff" : "#9aa0c0"};`
      tab.textContent = `${preset?.icon || "?"} ${preset?.title || dId}`
      tab.addEventListener("click", () => {
        activeTab = dId
        // Update tab styles
        for (const [tid, tel] of Object.entries(tabEls)) {
          const isActive2 = tid === dId
          tel.style.borderBottom = `2px solid ${isActive2 ? "#6c63ff" : "transparent"}`
          tel.style.background = isActive2 ? "rgba(108,99,255,0.12)" : "transparent"
          tel.style.color = isActive2 ? "#eef0ff" : "#9aa0c0"
        }
        // Swap content
        const body = gc.querySelector("[data-picc-group-body]")
        if (body) {
          const srcDock = shadowRoot.getElementById(`__PICC_DOCK_${dId}__`)
          const srcBody = srcDock?.querySelector("[data-picc-body]")
          if (srcBody) body.innerHTML = srcBody.innerHTML
        }
      })
      // Double-click tab to ungroup
      tab.addEventListener("dblclick", (e) => { e.stopPropagation(); ungroupDock(dId) })
      tabEls[dId] = tab
      tabBar.appendChild(tab)
    }

    // Close group button
    const closeGroupBtn = document.createElement("button")
    closeGroupBtn.textContent = "\u2715"
    closeGroupBtn.style.cssText = "background:none;border:none;color:#9aa0c0;cursor:pointer;font-size:10px;padding:2px 5px;margin-left:auto;"
    closeGroupBtn.addEventListener("click", () => {
      for (const dId of [...members]) ungroupDock(dId)
    })
    tabBar.appendChild(closeGroupBtn)
    gc.appendChild(tabBar)

    // Content area
    const contentBody = document.createElement("div")
    contentBody.setAttribute("data-picc-group-body", "")
    contentBody.style.cssText = "padding:4px;min-height:40px;"
    // Show active tab content
    const activeDockEl = shadowRoot.getElementById(`__PICC_DOCK_${activeTab}__`)
    const activeBody = activeDockEl?.querySelector("[data-picc-body]")
    if (activeBody) contentBody.innerHTML = activeBody.innerHTML
    gc.appendChild(contentBody)

    // Make group draggable via tab bar
    let gDrag = false, gsx = 0, gsy = 0
    tabBar.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.closest("[data-picc-group-body]")) return
      gDrag = true; gsx = e.clientX; gsy = e.clientY
      const rect = gc.getBoundingClientRect()
      gc.style.transition = "none"
      const onMove = (ev) => {
        if (!gDrag) return
        gc.style.left = (rect.left + ev.clientX - gsx) + "px"
        gc.style.top = (rect.top + ev.clientY - gsy) + "px"
      }
      const onUp = () => {
        gDrag = false
        gc.style.transition = ""
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        const r = gc.getBoundingClientRect()
        for (const dId of members) dockablePositions[dId] = { x: Math.round(r.left), y: Math.round(r.top) }
        saveDockableLayout()
      }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    })

    shadowRoot.appendChild(gc)
  }

  function restoreDockableLayout(dockEl, id) {
    const layout = currentSettings?.dockableLayout?.[id]
    if (!layout) return
    if (layout.position) {
      dockEl.style.left = layout.position.x + "px"
      dockEl.style.top = layout.position.y + "px"
      dockEl.style.right = "auto"
      dockEl.style.bottom = "auto"
      dockablePositions[id] = layout.position
    }
    if (layout.size) {
      dockEl.style.width = layout.size.width + "px"
      dockEl.style.maxHeight = layout.size.height + "px"
      dockableSizes[id] = layout.size
    }
    if (layout.opacity != null) {
      dockEl.style.opacity = String(layout.opacity)
      dockableOpacities[id] = layout.opacity
    }
  }

  function cleanupGroups() {
    for (const gid of Object.keys(dockGroups)) {
      const gc = shadowRoot.getElementById(`__PICC_GROUP_${gid}__`)
      if (gc) gc.remove()
    }
    Object.keys(dockGroups).forEach((k) => delete dockGroups[k])
    Object.keys(dockGroupMap).forEach((k) => delete dockGroupMap[k])
  }

  // Default dockable presets per suite type
  const SUITE_DOCKABLE_PRESETS = {
    trading: [
      { id: "price-ticker", title: "Price Ticker", icon: "📈", description: "Real-time asset prices with percentage change", defaultPos: "top-right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
      { id: "ai-signals", title: "AI Signals", icon: "🧠", description: "Live confluence decisions with verdict badges", defaultPos: "right", defaultSize: { width: 260, height: 260 }, defaultCollapsed: false },
      { id: "autopilot", title: "Autopilot", icon: "🤖", description: "Start/stop autopilot, status, today PnL", defaultPos: "bottom-left", defaultSize: { width: 260, height: 180 }, defaultCollapsed: false },
      { id: "portfolio", title: "Portfolio", icon: "📊", description: "Paper trading balance, PnL, and win rate", defaultPos: "top-left", defaultSize: { width: 300, height: 180 }, defaultCollapsed: true },
      { id: "risk-mgr", title: "Risk Manager", icon: "⚠️", description: "Daily loss limit, concurrent trades, cooldown", defaultPos: "bottom-right", defaultSize: { width: 280, height: 140 }, defaultCollapsed: true },
      { id: "kelly-sizing", title: "Kelly Sizing", icon: "🎯", description: "Kelly criterion sizing with suggested positions", defaultPos: "left", defaultSize: { width: 260, height: 180 }, defaultCollapsed: true },
      { id: "regime-detect", title: "Regime Detection", icon: "📡", description: "Market regime: trending, ranging, volatile, breakout", defaultPos: "top-left", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
      { id: "order-flow", title: "Order Flow", icon: "🌊", description: "Cumulative delta, imbalance, and divergence signals", defaultPos: "bottom-left", defaultSize: { width: 280, height: 200 }, defaultCollapsed: true },
      { id: "expiry-opt", title: "Expiry Optimizer", icon: "⏱️", description: "Optimal expiry selection with volatility analysis", defaultPos: "right", defaultSize: { width: 260, height: 200 }, defaultCollapsed: true },
      { id: "sentiment", title: "Sentiment", icon: "🎭", description: "News + social sentiment fusion with extremes", defaultPos: "top-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
    ],
    bandwidth: [
      { id: "speed", title: "Speed Monitor", icon: "📡", defaultPos: "top-right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
      { id: "connectors", title: "Connectors", icon: "🔌", defaultPos: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true }
    ],
    affiliate: [
      { id: "tracker", title: "Affiliate Tracker", icon: "💰", defaultPos: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "optimizer", title: "Link Optimizer", icon: "🔗", defaultPos: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true }
    ],
    content: [
      { id: "analytics", title: "Content Analytics", icon: "📊", defaultPos: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "scheduler", title: "Post Scheduler", icon: "📅", defaultPos: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true }
    ],
    dividend: [
      { id: "portfolio", title: "Dividend Portfolio", icon: "💎", defaultPos: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "calendar", title: "Ex-Date Calendar", icon: "📅", defaultPos: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true }
    ],
    defi: [
      { id: "yield", title: "Yield Tracker", icon: "🌱", defaultPos: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "gas", title: "Gas Tracker", icon: "⛽", defaultPos: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultCollapsed: true }
    ],
    generic: [
      { id: "general", title: "PICC Panel", icon: "🧠", defaultPos: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultCollapsed: false }
    ]
  }

  function getDefaultSettings(suite) {
    const dockables = (SUITE_DOCKABLE_PRESETS[suite] || SUITE_DOCKABLE_PRESETS.generic).map((d) => d.id)
    return {
      enabled: true,
      opacity: 0.92,
      collapsed: false,
      dockables: Object.fromEntries(dockables.map((id) => [id, true])),
      features: { assistance: true, decisionSupport: true, automation: false, autopilot: false, analysis: true, ai: true },
      dockableLayout: {}
    }
  }

  function addSection(panel, title, buildFn) {
    const sec = document.createElement("fieldset")
    sec.style.cssText = "border:1px solid #2a2a4a;border-radius:4px;padding:6px 8px;margin-bottom:6px;"
    const legend = document.createElement("legend")
    legend.style.cssText = "font-size:10px;color:#6c63ff;padding:0 4px;"
    legend.textContent = title
    sec.appendChild(legend)
    buildFn(sec)
    panel.appendChild(sec)
  }

  function addRow(parent, label, value, onChange) {
    const row = document.createElement("div")
    row.style.cssText = "display:flex;align-items:center;gap:6px;margin:3px 0;"
    const lbl = document.createElement("span")
    lbl.style.cssText = "font-size:10px;color:#9aa0c0;min-width:20px;"
    lbl.textContent = label
    const input = document.createElement("input")
    input.type = "number"
    input.value = String(value)
    input.style.cssText = "flex:1;padding:2px 6px;font-size:10px;background:#1a1a2e;border:1px solid #6c63ff40;color:#eef0ff;border-radius:3px;"
    input.addEventListener("change", () => onChange(input.value))
    row.appendChild(lbl)
    row.appendChild(input)
    parent.appendChild(row)
  }

  // ── Shadow DOM isolation ────────────────────────────────────────────────────
  const shadowHost = document.createElement("div")
  shadowHost.id = "__PICC_SHADOW_HOST__"
  shadowHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;"
  document.body.appendChild(shadowHost)
  const shadowRoot = shadowHost.attachShadow({ mode: "open" })

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
    const overlay = shadowRoot.getElementById(OVERLAY_ID)
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
    // Use PerformanceNavigationTiming (modern) instead of deprecated performance.timing
    const nav = performance.getEntriesByType?.("navigation")?.[0]
    const loadTime = nav ? nav.loadEventEnd - nav.startTime : 0
    const domReady = nav ? nav.domContentLoadedEventEnd - nav.startTime : 0

    return {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY, max: document.documentElement.scrollHeight },
      performance: { loadTime, domReady },
      resources: performance.getEntriesByType?.("resource")?.length || 0,
      forms: document.forms.length,
      links: document.links.length,
      images: document.images.length,
    }
  }
  // Expose metrics getter for PICC web app (accessible only to extension content scripts, not page JS)
  // SECURITY: window-level getter removed — page scripts must not access internal extension data

  // ── DOM content extraction ────────────────────────────────────────────────
  function extractPageContent(selectors) {
    if (!selectors) {
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || "").slice(0, 50000),
      }
    }
    const out = { url: location.href, title: document.title }
    for (const [key, selector] of Object.entries(selectors)) {
      const tryOne = (sel) => {
        if (typeof sel === "string" && sel.startsWith("text:")) {
          const needle = sel.slice(5)
          for (const el of document.querySelectorAll("div,span,p,td,h1,h2,h3,label,a")) {
            const t = (el.textContent || "").trim()
            if (t.includes(needle) && t.length <= 300) return el
          }
          return null
        }
        try { return document.querySelector(sel) } catch { return null }
      }
      const list = Array.isArray(selector) ? selector : [selector]
      let found = null
      for (const s of list) { found = tryOne(s); if (found) break }
      out[key] = found ? (found.innerText || found.textContent || "").trim() : null
    }
    return out
  }

  // ── Form detection ─────────────────────────────────────────────────────────
  function detectForms() {
    const forms = []
    for (const form of document.forms) {
      const fields = []
      for (const el of form.elements) {
        if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
          fields.push({ tag: el.tagName, type: el.type || "text", name: el.name || "", id: el.id || "", placeholder: el.placeholder || "", value: el.value || "", required: el.required })
        }
      }
      forms.push({ action: form.action, method: form.method, fields })
    }
    const standalone = []
    for (const inp of document.querySelectorAll("input, select, textarea")) {
      if (!inp.form) {
        standalone.push({ tag: inp.tagName, type: inp.type || "text", name: inp.name || "", id: inp.id || "", placeholder: inp.placeholder || "", value: inp.value || "" })
      }
    }
    return { forms, standalone, totalFormCount: document.forms.length }
  }

  // ── Web storage reading ────────────────────────────────────────────────────
  function readWebStorage() {
    const local = {}
    const session = {}
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); local[k] = localStorage.getItem(k) } } catch {}
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); session[k] = sessionStorage.getItem(k) } } catch {}
    return { localStorage: local, sessionStorage: session }
  }

  // ── Form fill / element click ──────────────────────────────────────────────
  function fillField(selector, value) {
    const el = document.querySelector(selector)
    if (!el) return { ok: false, error: "element not found" }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, selector }
  }

  function clickElement(selector) {
    const el = document.querySelector(selector)
    if (!el) return { ok: false, error: "element not found" }
    el.click()
    return { ok: true, selector, text: (el.textContent || "").trim().slice(0, 100) }
  }

  function navigateTo(url) {
    if (url && /^https?:\/\//i.test(url)) { window.location.href = url; return { ok: true, url } }
    return { ok: false, error: "invalid url" }
  }

  // ── Sound alerts ──────────────────────────────────────────────────────
  let audioCtx = null
  function playAlertSound(type = "info") {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      if (type === "danger") {
        osc.frequency.value = 880
        gain.gain.value = 0.15
        osc.type = "square"
      } else if (type === "success") {
        osc.frequency.value = 523
        gain.gain.value = 0.12
        osc.type = "sine"
      } else {
        osc.frequency.value = 440
        gain.gain.value = 0.1
        osc.type = "sine"
      }
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3)
      osc.stop(audioCtx.currentTime + 0.3)
    } catch { /* ignore */ }
  }

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
    if (!shadowRoot.getElementById("__picc_toast_style__")) {
      style.id = "__picc_toast_style__"
      shadowRoot.appendChild(style)
    }

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

    shadowRoot.appendChild(toast)
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
      `box-shadow:0 4px 16px rgba(0,0,0,.3);transition:max-height .2s ease,width .2s ease;user-select:none;pointer-events:auto;`
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

      // ── Drag with edge-docking + position persistence ──
      const DOCK_THRESHOLD = 24
      const EDGE_OFFSET = 4
      let isDragging = false
      let dragStartX, dragStartY, dragElStartX, dragElStartY

      titleBar.addEventListener("mousedown", (e) => {
        if (e.target.closest("[data-picc-action]")) return
        e.preventDefault()
        isDragging = true
        dragStartX = e.clientX
        dragStartY = e.clientY
        const rect = dock.getBoundingClientRect()
        dragElStartX = rect.left
        dragElStartY = rect.top
        dock.style.transition = "none"
        const onMove = (ev) => {
          if (!isDragging) return
          const dx = ev.clientX - dragStartX
          const dy = ev.clientY - dragStartY
          let nx = dragElStartX + dx
          let ny = dragElStartY + dy
          // Edge docking
          if (nx < DOCK_THRESHOLD) nx = EDGE_OFFSET
          if (ny < DOCK_THRESHOLD) ny = EDGE_OFFSET
          if (nx + dock.offsetWidth > window.innerWidth - DOCK_THRESHOLD) nx = window.innerWidth - dock.offsetWidth - EDGE_OFFSET
          if (ny + dock.offsetHeight > window.innerHeight - DOCK_THRESHOLD) ny = window.innerHeight - dock.offsetHeight - EDGE_OFFSET
          dock.style.left = nx + "px"
          dock.style.top = ny + "px"
          dock.style.right = "auto"
          dock.style.bottom = "auto"
        }
        const onUp = () => {
          isDragging = false
          dock.style.transition = ""
          document.removeEventListener("mousemove", onMove)
          document.removeEventListener("mouseup", onUp)
          // Persist position
          const r = dock.getBoundingClientRect()
          dockablePositions[id] = { x: Math.round(r.left), y: Math.round(r.top) }
          // Check for grouping — if overlapping another dock's title bar, stack them
          const myRect = dock.getBoundingClientRect()
          let grouped = false
          for (const otherDock of shadowRoot.querySelectorAll("[data-picc-dock]")) {
            if (otherDock === dock) continue
            if (otherDock.style.display === "none") continue
            const otherRect = otherDock.getBoundingClientRect()
            // Check if the title bar areas overlap
            const titleOverlap = !(myRect.right < otherRect.left || otherRect.right < myRect.left ||
              myRect.bottom < otherRect.top || otherRect.top + 36 < myRect.top)
            if (titleOverlap) {
              groupDocks(id, otherDock.id.replace(/^__PICC_DOCK_/, "").replace(/__$/, ""))
              grouped = true
              break
            }
          }
          if (!grouped) saveDockableLayout()
        }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
      })

      // Touch support for drag
      titleBar.addEventListener("touchstart", (e) => {
        if (e.target.closest("[data-picc-action]")) return
        const touch = e.touches[0]
        isDragging = true
        dragStartX = touch.clientX
        dragStartY = touch.clientY
        const rect = dock.getBoundingClientRect()
        dragElStartX = rect.left
        dragElStartY = rect.top
        dock.style.transition = "none"
      }, { passive: true })

      titleBar.addEventListener("touchmove", (e) => {
        if (!isDragging) return
        e.preventDefault()
        const touch = e.touches[0]
        const dx = touch.clientX - dragStartX
        const dy = touch.clientY - dragStartY
        let nx = dragElStartX + dx
        let ny = dragElStartY + dy
        if (nx < DOCK_THRESHOLD) nx = EDGE_OFFSET
        if (ny < DOCK_THRESHOLD) ny = EDGE_OFFSET
        if (nx + dock.offsetWidth > window.innerWidth - DOCK_THRESHOLD) nx = window.innerWidth - dock.offsetWidth - EDGE_OFFSET
        if (ny + dock.offsetHeight > window.innerHeight - DOCK_THRESHOLD) ny = window.innerHeight - dock.offsetHeight - EDGE_OFFSET
        dock.style.left = nx + "px"
        dock.style.top = ny + "px"
        dock.style.right = "auto"
        dock.style.bottom = "auto"
      }, { passive: false })

      titleBar.addEventListener("touchend", () => {
        isDragging = false
        dock.style.transition = ""
        const r = dock.getBoundingClientRect()
        dockablePositions[id] = { x: Math.round(r.left), y: Math.round(r.top) }
        saveDockableLayout()
      })

      // ── Resize handle ──
      const handle = shadowRoot.getElementById(`__PICC_RESIZE_${id}__`)
      const resizeHandle = document.createElement("div")
      resizeHandle.id = `__PICC_RESIZE_${id}__`
      resizeHandle.style.cssText = "position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;opacity:.3;"
      if (handle) handle.remove()
      {
        let isResizing = false
        let rsx, rsy, rw, rh
        resizeHandle.addEventListener("mousedown", (e) => {
          e.preventDefault()
          e.stopPropagation()
          isResizing = true
          rsx = e.clientX; rsy = e.clientY
          rw = dock.offsetWidth; rh = dock.offsetHeight
          dock.style.transition = "none"
          const onMove = (ev) => {
            if (!isResizing) return
            const nw = Math.max(200, rw + ev.clientX - rsx)
            const nh = Math.max(100, rh + ev.clientY - rsy)
            dock.style.width = nw + "px"
            dock.style.maxHeight = nh + "px"
          }
          const onUp = () => {
            isResizing = false
            dock.style.transition = ""
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            const r = dock.getBoundingClientRect()
            dockableSizes[id] = { width: Math.round(r.width), height: Math.round(r.height) }
            saveDockableLayout()
          }
          document.addEventListener("mousemove", onMove)
          document.addEventListener("mouseup", onUp)
        })
      }
      dock.appendChild(resizeHandle)

      // ── Opacity slider ──
      const opacityRow = document.createElement("div")
      opacityRow.style.cssText = "display:flex;align-items:center;gap:4px;padding:2px 8px;font-size:9px;color:#9aa0c0;"
      const opacityLabel = document.createElement("span")
      opacityLabel.textContent = "Opacity"
      const opacitySlider = document.createElement("input")
      opacitySlider.type = "range"
      opacitySlider.min = "20"
      opacitySlider.max = "100"
      opacitySlider.value = String(Math.round((dockableOpacities[id] ?? 0.92) * 100))
      opacitySlider.style.cssText = "flex:1;height:3px;cursor:pointer;"
      opacitySlider.addEventListener("input", () => {
        const val = Number(opacitySlider.value) / 100
        dock.style.opacity = String(val)
        dockableOpacities[id] = val
      })
      opacitySlider.addEventListener("change", () => saveDockableLayout())
      opacityRow.appendChild(opacityLabel)
      opacityRow.appendChild(opacitySlider)
      dock.insertBefore(opacityRow, dock.children[1]) // after title bar, before content

    return dock
  }

  // ── Trading suite dockables ────────────────────────────────────────────────
  // Live data state for all trading panels
  const tradingState = {
    assets: [],
    account: null,
    decisions: [],
    autopilot: null,
    paper: null,
    demo: null,
    kelly: null,
    regime: null,
    orderFlow: null,
    expiry: null,
    sentiment: null,
    lastCandles: [],
    lastUpdate: 0
  }

  const CURRENCY_SYMBOLS = { USD: "$", EUR: "\u20AC", GBP: "\u00A3", JPY: "\u00A5", CNY: "\u00A5", KRW: "\u20A9", INR: "\u20B9", BRL: "R$", RUB: "\u20BD", AUD: "A$", CAD: "C$", CHF: "CHF ", NGN: "\u20A6", PHP: "\u20B1", THB: "\u0E3F", VND: "\u20AB", MYR: "RM", IDR: "Rp" }
  function fmt$(n, currency) {
    if (n == null || !isFinite(n)) return "\u2014"
    const sym = CURRENCY_SYMBOLS[(currency || "USD").toUpperCase()] || (currency || "$") + " "
    return sym + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  function fmtPct(n) {
    if (n == null || !isFinite(n)) return "\u2014"
    return n.toFixed(2) + "%"
  }
  function tone(val, pos, neg) {
    if (val > 0) return pos || "#4ade80"
    if (val < 0) return neg || "#ff6b6b"
    return "#a5a0ff"
  }

  // ── Price Ticker Renderer ──────────────────────────────────────────────────
  function renderPriceTicker() {
    const assets = tradingState.assets
    if (!assets.length) return '<div style="color:#a5a0ff;padding:4px">Waiting for market data\u2026</div>'
    const rows = assets.slice(0, 6).map((a) => {
      const c = tone(a.changePct)
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #6c63ff20">` +
        `<span style="font-weight:600;font-size:11px">${a.name || a.id}</span>` +
        `<span style="font-size:11px;color:${c}">${a.price != null ? a.price.toFixed(4) : "\u2014"}</span>` +
        `<span style="font-size:10px;color:${c}">${a.changePct != null ? (a.changePct >= 0 ? "+" : "") + a.changePct.toFixed(2) + "%" : ""}</span>` +
        `</div>`
    }).join("")
    const acct = tradingState.account
    const bal = acct ? fmt$(acct.balance, acct.currency) : ""
    return `<div style="font-size:11px">${rows}</div>` +
      (bal ? `<div style="margin-top:4px;font-size:10px;color:#a5a0ff">Balance: ${bal}</div>` : "")
  }

  // ── Portfolio Renderer ─────────────────────────────────────────────────────
  function renderPortfolio() {
    const paper = tradingState.paper
    const demo = tradingState.demo
    const lines = []
    if (paper) {
      lines.push(`<div style="font-weight:600;font-size:11px;color:#6c63ff;margin-bottom:2px">Paper Trading</div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Cash</span><span>${fmt$(paper.cash, tradingState.account?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Committed</span><span>${fmt$(paper.committed, tradingState.account?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>PnL</span><span style="color:${tone(paper.realizedPnl)}">${fmt$(paper.realizedPnl, tradingState.account?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Win rate</span><span>${paper.winRate != null ? paper.winRate + "%" : "\u2014"}</span></div>`)
    }
    if (demo) {
      lines.push(`<div style="font-weight:600;font-size:11px;color:#6c63ff;margin:4px 0 2px">ExpertOption Demo</div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Balance</span><span>${fmt$(demo.balance, demo.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Today</span><span style="color:${tone(demo.todayPnl)}">${fmt$(demo.todayPnl, demo.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Trades</span><span>${demo.todayTrades ?? 0}</span></div>`)
    }
    if (!lines.length) return '<div style="color:#a5a0ff;padding:4px">No position data yet\u2026</div>'
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── AI Signals Renderer ────────────────────────────────────────────────────
  function renderAISignals() {
    const d = tradingState.decisions
    if (!d.length) return '<div style="color:#a5a0ff;padding:4px">Waiting for AI analysis\u2026</div>'
    const rows = d.slice(0, 5).map((dec) => {
      const verdictColor = dec.verdict === "TRADE" ? "#4ade80" : dec.verdict === "OBSERVE" ? "#f59e0b" : "#a5a0ff"
      const gates = dec.gates || {}
      const gIcon = (ok) => ok ? '<span style="color:#4ade80">\u2713</span>' : '<span style="color:#ff6b6b">\u2717</span>'
      return `<div style="border-bottom:1px solid #6c63ff15;padding:3px 0">` +
        `<div style="display:flex;justify-content:space-between;align-items:center">` +
          `<span style="font-weight:600;font-size:11px">${dec.asset || dec.assetId}</span>` +
          `<span style="font-size:10px;font-weight:600;color:${verdictColor}">${dec.verdict}</span>` +
        `</div>` +
        `<div style="display:flex;gap:6px;font-size:9px;color:#a5a0ff">` +
          `<span>${gIcon(gates.score)} conf</span>` +
          `<span>${gIcon(gates.winProb)} prob</span>` +
          `<span>${gIcon(gates.payout)} pay</span>` +
          `<span>${dec.confidence != null ? dec.confidence.toFixed(0) + "%" : ""}</span>` +
          `<span style="color:${tone(0, dec.direction === "up" ? "#4ade80" : "#ff6b6b")}">${(dec.direction || "").toUpperCase()}</span>` +
        `</div>` +
        `</div>`
    }).join("")
    return `<div style="padding:2px 0">${rows}</div>`
  }

  // ── Risk Manager Renderer ──────────────────────────────────────────────────
  function renderRiskManager() {
    const demo = tradingState.demo
    const auto = tradingState.autopilot
    if (!demo && !auto) return '<div style="color:#a5a0ff;padding:4px">Risk metrics loading\u2026</div>'
    const lines = []
    if (auto) {
      const maxLoss = auto.dailyLossLimitPct ?? 10
      const todayLoss = auto.dailyLoss != null ? Math.abs(auto.dailyLoss) : 0
      const pct = maxLoss > 0 ? Math.min(100, (todayLoss / maxLoss) * 100) : 0
      const barColor = pct > 80 ? "#ff6b6b" : pct > 50 ? "#f59e0b" : "#4ade80"
      lines.push(`<div style="font-size:11px;font-weight:600;color:#6c63ff;margin-bottom:2px">Daily Loss Limit</div>`)
      lines.push(`<div style="background:#1a1a2e;border-radius:3px;height:8px;overflow:hidden;margin-bottom:2px">` +
        `<div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:10px;color:#a5a0ff"><span>${fmtPct(todayLoss)} used</span><span>${fmtPct(maxLoss)} limit</span></div>`)
    }
    if (demo?.autopilot) {
      const ap = demo.autopilot
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px"><span>Concurrent</span><span>${ap.concurrent ?? 0}/${ap.maxConcurrent ?? 1}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Trades today</span><span>${demo.todayTrades ?? 0}/${ap.maxDailyTrades ?? "\u221e"}</span></div>`)
      const cdLeft = ap.cooldownRemainingMs ? Math.ceil(ap.cooldownRemainingMs / 1000) + "s" : "ready"
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Cooldown</span><span>${cdLeft}</span></div>`)
    }
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Autopilot Control Renderer ─────────────────────────────────────────────
  function renderAutopilot() {
    const auto = tradingState.autopilot
    const running = auto?.enabled ?? false
    const statusColor = running ? "#4ade80" : "#a5a0ff"
    const lines = []
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">`)
    lines.push(`<div style="width:8px;height:8px;border-radius:50%;background:${statusColor}"></div>`)
    lines.push(`<span style="font-weight:600;font-size:11px">${running ? "Running" : "Stopped"}</span>`)
    lines.push(`</div>`)
    if (auto?.strategy) lines.push(`<div style="font-size:11px">Strategy: <b>${auto.strategy}</b></div>`)
    if (auto?.assetId) lines.push(`<div style="font-size:11px">Asset: <b>${auto.assetId}</b></div>`)
    if (auto?.lastDecision) lines.push(`<div style="font-size:10px;color:#a5a0ff">Last: ${auto.lastDecision}</div>`)
    const demo = tradingState.demo
    if (demo?.todayPnl != null) {
      lines.push(`<div style="font-size:11px;margin-top:2px">Today PnL: <span style="color:${tone(demo.todayPnl)}">${fmt$(demo.todayPnl, demo.currency)}</span></div>`)
    }
    // Human-review countdown: show time until cooldown expires
    if (running && auto?.lastEntryAt && auto?.cooldownMs) {
      const elapsed = Date.now() - auto.lastEntryAt
      const remaining = auto.cooldownMs - elapsed
      if (remaining > 0) {
        const secs = Math.ceil(remaining / 1000)
        const mins = Math.floor(secs / 60)
        const remSecs = secs % 60
        const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`
        const pct = Math.min(100, Math.round((elapsed / auto.cooldownMs) * 100))
        lines.push(`<div style="margin-top:4px">`)
        lines.push(`<div style="font-size:10px;color:#f59e0b;margin-bottom:2px">Review cooldown: ${timeStr}</div>`)
        lines.push(`<div style="background:#1a1a2e;border-radius:3px;height:4px;overflow:hidden">`)
        lines.push(`<div style="height:100%;width:${pct}%;background:#f59e0b;border-radius:3px;transition:width 1s linear"></div>`)
        lines.push(`</div></div>`)
      }
    }
    // Control buttons
    lines.push(`<div style="display:flex;gap:4px;margin-top:6px">`)
    lines.push(`<button data-picc-action="autopilot-toggle" style="flex:1;background:${running ? "#ff6b6b30" : "#4ade8030"};border:1px solid ${running ? "#ff6b6b" : "#4ade80"};color:#eef0ff;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600">${running ? "Stop" : "Start"}</button>`)
    lines.push(`<button data-picc-action="autopilot-kill" style="background:#ff6b6b30;border:1px solid #ff6b6b;color:#ff6b6b;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600">Kill</button>`)
    lines.push(`</div>`)
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Kelly Sizing Renderer ──────────────────────────────────────────────────
  function renderKellySizing() {
    const kelly = tradingState.kelly
    if (!kelly) return '<div style="color:#a5a0ff;padding:4px">Loading Kelly data…</div>'
    const stats = kelly.stats || {}
    const k = kelly.kelly || {}
    const lines = []
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Win rate</span><span>${stats.winRate != null ? stats.winRate + "%" : "—"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Avg payout</span><span>${stats.avgPayout != null ? stats.avgPayout + "x" : "—"}</span></div>`)
    lines.push(`<div style="border-top:1px solid #6c63ff20;margin:4px 0"></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Full Kelly</span><span style="color:#6c63ff">${k.fullKelly != null ? k.fullKelly + "%" : "—"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Suggested (${k.mode || "half"})</span><span style="font-weight:600;color:#4ade80">${k.suggested != null ? k.suggested + "%" : "—"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Break-even WR</span><span>${k.breakEven != null ? k.breakEven + "%" : "—"}</span></div>`)
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Regime Detection Renderer ──────────────────────────────────────────────
  function renderRegimeDetect() {
    const regime = tradingState.regime
    if (!regime || regime.regime === "unknown") return '<div style="color:#a5a0ff;padding:4px">Analyzing market regime…</div>'
    const colors = { trending: "#4ade80", ranging: "#f59e0b", volatile: "#ff6b6b", breakout: "#6c63ff" }
    const c = colors[regime.regime] || "#a5a0ff"
    const lines = []
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:8px;height:8px;border-radius:50%;background:${c}"></div><span style="font-weight:600;font-size:12px;color:${c}">${(regime.regime || "").toUpperCase()}</span><span style="font-size:10px;color:#9aa0c0">${regime.confidence || 0}%</span></div>`)
    if (regime.metrics) lines.push(`<div style="font-size:10px;color:#9aa0c0">ADX: ${regime.metrics.adx} · ATR ratio: ${regime.metrics.atrRatio}x</div>`)
    if (regime.suggestedStrategy) lines.push(`<div style="font-size:10px;margin-top:4px">Strategy: <b style="color:#6c63ff">${regime.suggestedStrategy}</b></div>`)
    if (regime.factors?.length) lines.push(`<div style="font-size:9px;color:#9aa0c0;margin-top:2px">${regime.factors.join(" · ")}</div>`)
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Order Flow Renderer ────────────────────────────────────────────────────
  function renderOrderFlow() {
    const of = tradingState.orderFlow
    if (!of || !of.delta?.length) return '<div style="color:#a5a0ff;padding:4px">Loading order flow…</div>'
    const lines = []
    const imbColor = of.imbalance === "buy-heavy" ? "#4ade80" : of.imbalance === "sell-heavy" ? "#ff6b6b" : "#f59e0b"
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-weight:600;font-size:11px">Net Delta</span><span style="color:${of.cumulative >= 0 ? "#4ade80" : "#ff6b6b"};font-weight:600">${of.cumulative >= 0 ? "+" : ""}${of.cumulative}</span><span style="font-size:9px;padding:1px 4px;border-radius:3px;background:${imbColor}30;color:${imbColor}">${of.imbalance}</span></div>`)
    if (of.avgDelta != null) lines.push(`<div style="font-size:10px;color:#9aa0c0">Avg delta: ${of.avgDelta}</div>`)
    if (of.signals?.length) {
      for (const sig of of.signals.slice(0, 3)) {
        lines.push(`<div style="font-size:9px;color:${sig.type === "divergence" ? "#f59e0b" : "#6c63ff"};margin-top:2px">⚡ ${sig.desc}</div>`)
      }
    }
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Expiry Optimizer Renderer ──────────────────────────────────────────────
  function renderExpiryOpt() {
    const exp = tradingState.expiry
    if (!exp || !exp.recommended) return '<div style="color:#a5a0ff;padding:4px">Analyzing optimal expiry…</div>'
    const r = exp.recommended
    const lines = []
    lines.push(`<div style="font-weight:600;font-size:12px;color:#6c63ff;margin-bottom:4px">Recommended: ${r.label}</div>`)
    lines.push(`<div style="font-size:10px;color:#9aa0c0">Score: ${r.score}/100 · Vol: ${exp.volatility || "—"}</div>`)
    if (exp.all?.length) {
      const top3 = exp.all.slice(0, 3)
      lines.push(`<div style="display:flex;gap:4px;margin-top:4px">`)
      for (const e of top3) {
        const barW = Math.max(10, e.score)
        lines.push(`<div style="flex:1;text-align:center;font-size:9px"><div style="margin-bottom:2px">${e.label}</div><div style="background:#1a1a2e;border-radius:2px;height:4px;overflow:hidden"><div style="height:100%;width:${barW}%;background:#6c63ff;border-radius:2px"></div></div><div style="color:#9aa0c0;margin-top:1px">${e.score}</div></div>`)
      }
      lines.push(`</div>`)
    }
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Sentiment Renderer ─────────────────────────────────────────────────────
  function renderSentiment() {
    const sent = tradingState.sentiment
    if (!sent || !sent.composite) return '<div style="color:#a5a0ff;padding:4px">Loading sentiment…</div>'
    const c = sent.composite
    const lines = []
    const scoreColor = c.score > 0.2 ? "#4ade80" : c.score < -0.2 ? "#ff6b6b" : "#f59e0b"
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-weight:600;font-size:12px;color:${scoreColor}">${c.label || "Neutral"}</span><span style="font-size:10px;color:#9aa0c0">Score: ${c.score}</span>${c.extreme ? '<span style="font-size:8px;padding:1px 3px;border-radius:3px;background:#ff6b6b30;color:#ff6b6b">EXTREME</span>' : ""}</div>`)
    if (sent.news) lines.push(`<div style="font-size:10px;color:#9aa0c0">News: ${sent.news.bullish}🟢 ${sent.news.bearish}🔴 ${sent.news.neutral}⚪ (${sent.news.sampleSize})</div>`)
    if (sent.social) lines.push(`<div style="font-size:10px;color:#9aa0c0">Social velocity: ${sent.social.velocity > 0 ? "+" : ""}${sent.social.velocity}</div>`)
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Fetch and update all trading data ──────────────────────────────────────
  let tradingPollTimer = null

  async function fetchTradingData() {
    try {
      const [status, autopilot, demo, decisions] = await Promise.all([
        serverFetch("/api/trading/status"),
        serverFetch("/api/autopilot/config"),
        serverFetch("/api/expertoption/demo/status"),
        serverFetch("/api/decisions")
      ])
      if (status?.ok) {
        tradingState.paper = status.paper || null
        tradingState.account = status.live || null
      }
      if (autopilot?.ok) tradingState.autopilot = autopilot.config || null
      if (demo) tradingState.demo = demo
      if (decisions?.decisions) tradingState.decisions = decisions.decisions
      // Fetch live asset prices
      const live = await serverFetch("/api/live/stats")
      if (live?.watched) {
        tradingState.assets = live.watched.map((w) => ({ id: w, name: w, price: null, changePct: null, change: null }))
      }
      tradingState.lastUpdate = Date.now()
      // Fetch advanced trading data
      const [kelly, regime, orderFlow] = await Promise.all([
        serverFetch("/api/trading/kelly"),
        serverFetch("/api/trading/orderflow", { method: "POST", body: { candles: tradingState.lastCandles || [] } }),
        serverFetch("/api/trading/sentiment", { method: "POST", body: { symbol: "EURUSD" } }),
      ])
      if (kelly?.ok) tradingState.kelly = kelly
      if (regime?.ok) tradingState.regime = regime
      if (orderFlow?.ok) tradingState.orderFlow = orderFlow
    } catch {
      // Server not reachable — keep last state
    }
  }

  function updateAllDockables() {
    const panels = {
      "price-ticker": renderPriceTicker,
      "portfolio": renderPortfolio,
      "ai-signals": renderAISignals,
      "risk-mgr": renderRiskManager,
      "autopilot": renderAutopilot,
      "kelly-sizing": renderKellySizing,
      "regime-detect": renderRegimeDetect,
      "order-flow": renderOrderFlow,
      "expiry-opt": renderExpiryOpt,
      "sentiment": renderSentiment,
    }
    for (const [id, renderer] of Object.entries(panels)) {
      const dock = shadowRoot.getElementById(`__PICC_DOCK_${id}__`)
      if (!dock) continue
      const body = dock.querySelector("[data-picc-body]")
      if (body) body.innerHTML = renderer()
    }
  }

  function startTradingPoll() {
    if (tradingPollTimer) return
    fetchTradingData().then(updateAllDockables)
    tradingPollTimer = setInterval(() => { fetchTradingData().then(updateAllDockables) }, 5000)
  }

  function stopTradingPoll() {
    if (tradingPollTimer) { clearInterval(tradingPollTimer); tradingPollTimer = null }
  }

  // ── Create dockables with live-rendered content ────────────────────────────
  function createTradingDockables(siteInfo) {
    const presets = SUITE_DOCKABLE_PRESETS.trading
    const renderers = {
      "price-ticker": renderPriceTicker,
      "portfolio": renderPortfolio,
      "ai-signals": renderAISignals,
      "risk-mgr": renderRiskManager,
      "autopilot": renderAutopilot
    }
    const dockables = presets.map((preset) => {
      const body = document.createElement("div")
      body.setAttribute("data-picc-body", "")
      body.style.cssText = "padding:6px 8px;font-size:11px;color:#eef0ff;min-height:30px;"
      body.innerHTML = '<div style="color:#a5a0ff">Loading\u2026</div>'
      const dock = createDockable({
        id: preset.id,
        title: preset.title,
        icon: preset.icon,
        content: body,
        position: preset.defaultPos,
        width: preset.defaultSize.width,
        height: preset.defaultSize.height,
        collapsed: preset.defaultCollapsed,
        features: { decisionSupport: true, analysis: true },
        suite: "trading"
      })
      shadowRoot.appendChild(dock)
      dock.style.display = "none"
      restoreDockableLayout(dock, preset.id)
      return dock
    })

    startTradingPoll()
    return dockables
  }

  // ── Generic suite dockables ────────────────────────────────────────────────
  function createGenericDockables(siteInfo) {
    const presets = SUITE_DOCKABLE_PRESETS[siteInfo?.suite] || SUITE_DOCKABLE_PRESETS.generic
    return presets.map((preset) => {
      const dock = createDockable({
        id: preset.id,
        title: preset.title,
        icon: preset.icon,
        content: `PICC active on ${siteInfo?.label || window.location.hostname}`,
        position: preset.defaultPos,
        width: preset.defaultSize.width,
        height: preset.defaultSize.height,
        collapsed: preset.defaultCollapsed,
        features: { assistance: true },
        suite: siteInfo?.suite
      })
      shadowRoot.appendChild(dock)
      dock.style.display = "none"
      restoreDockableLayout(dock, preset.id)
      return dock
    })
  }

  // ── Main overlay creation ──────────────────────────────────────────────────
  function createOverlay(siteInfo, overlaySettings) {
    // Remove existing
    const existing = shadowRoot.getElementById(OVERLAY_ID)
    if (existing) existing.remove()
    activeDockables.forEach((d) => { const el = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`); if (el) el.remove() })
    cleanupGroups()
    activeDockables = []

    currentSite = siteInfo

    // Create the pill (main control)
    const el = document.createElement("div")
    el.id = OVERLAY_ID
    el.setAttribute("data-picc-overlay", "1")
    shadowRoot.appendChild(el)

    const cfg = overlaySettings || {}
    currentSettings = { ...getDefaultSettings(siteInfo?.suite), ...cfg }
    const opa = currentSettings.opacity

    // Pill position is always bottom-left (fixed); dockables are positioned independently
    const PILL_X = 16
    const PILL_Y = 16

    function applySettings(settings) {
      el.style.background = `rgba(20,20,48,${settings.opacity})`
      for (const d of activeDockables) {
        const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`)
        if (dockEl) {
          dockEl.style.display = settings.dockables?.[d.id] !== false ? "" : "none"
          dockEl.style.opacity = String(settings.opacity)
        }
      }
    }

    el.style.cssText =
      `position:fixed;bottom:${PILL_Y}px;left:${PILL_X}px;z-index:2147483647;width:auto;max-height:none;overflow:visible;` +
      `background:rgba(20,20,48,${opa});backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#eef0ff;` +
      `border:1px solid rgba(108,99,255,0.5);border-radius:12px;padding:4px 8px;font:13px/1.5 system-ui,sans-serif;` +
      `box-shadow:0 8px 32px rgba(0,0,0,.4),0 0 0 1px rgba(108,99,255,0.15);user-select:none;pointer-events:auto;`

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

    // Toggle overlay button
    const toggleBtn = document.createElement("button")
    toggleBtn.textContent = "👁"
    toggleBtn.title = "Toggle overlay dockables"
    toggleBtn.dataset.piccAction = "toggle-dockables"
    toggleBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:4px;"
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const allHidden = activeDockables.every((d) => {
        const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`)
        return dockEl && dockEl.style.display === "none"
      })
      activeDockables.forEach((d) => {
        const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`)
        if (dockEl) dockEl.style.display = allHidden ? "" : "none"
      })
      toggleBtn.textContent = allHidden ? "👁" : "👁‍🗨"
    })

    // Settings button
    const settingsBtn = document.createElement("button")
    settingsBtn.textContent = "\u2699"
    settingsBtn.title = "Overlay settings"
    settingsBtn.style.cssText = "background:none;border:none;color:#eef0ff;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:4px;"
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const existing = shadowRoot.getElementById("__PICC_SETTINGS__")
      if (existing) { existing.remove(); return }

      const panel = document.createElement("div")
      panel.id = "__PICC_SETTINGS__"
      panel.style.cssText = "position:absolute;bottom:100%;right:0;width:300px;max-height:500px;overflow-y:auto;background:#0d0d1a;border:1px solid #2a2a4a;border-radius:8px;padding:12px;margin-bottom:8px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.5);"

      // Title
      const hasSiteConfig = !!(currentSite?.id && currentSettings._siteSpecific)
      const title = document.createElement("div")
      title.style.cssText = "font-size:12px;font-weight:700;color:#6c63ff;margin-bottom:4px;"
      title.textContent = "Overlay Settings"
      panel.appendChild(title)

      // Config source indicator
      const sourceBadge = document.createElement("div")
      sourceBadge.style.cssText = "font-size:9px;margin-bottom:8px;padding:3px 6px;border-radius:4px;" +
        (hasSiteConfig ? "background:#4ade8020;color:#4ade80;border:1px solid #4ade8040;" : "background:#6c63ff20;color:#6c63ff;border:1px solid #6c63ff40;")
      sourceBadge.textContent = hasSiteConfig ? `Using saved config for ${currentSite.label}` : `Using default ${currentSite?.suite || "generic"} config`
      panel.appendChild(sourceBadge)

      // Global Opacity
      addSection(panel, "Opacity", (sec) => {
        const slider = document.createElement("input")
        slider.type = "range"; slider.min = "20"; slider.max = "100"
        slider.value = String(Math.round(currentSettings.opacity * 100))
        slider.style.cssText = "width:100%;"
        slider.addEventListener("input", () => {
          currentSettings.opacity = Number(slider.value) / 100
          shadowRoot.querySelectorAll("[id^=__PICC_DOCK_]").forEach((d) => d.style.opacity = String(currentSettings.opacity))
        })
        sec.appendChild(slider)
      })

      // Per-dockable toggles
      addSection(panel, "Dockable Panels", (sec) => {
        const hint = document.createElement("p")
        hint.style.cssText = "font-size:10px;color:#9aa0c0;margin:0 0 6px;"
        hint.textContent = "Toggle which dockable panels appear in the overlay. Drag to reposition, resize from bottom-right corner."
        sec.appendChild(hint)

        const dockConfig = SUITE_DOCKABLE_PRESETS[currentSite?.suite] || []
        dockConfig.forEach((d) => {
          const row = document.createElement("label")
          row.style.cssText = "display:flex;align-items:center;gap:8px;font-size:11px;padding:4px 6px;border-radius:4px;cursor:pointer;margin-bottom:3px;border:1px solid " + (currentSettings.dockables?.[d.id] !== false ? "#6c63ff" : "#2a2a4a") + ";background:" + (currentSettings.dockables?.[d.id] !== false ? "rgba(108,99,255,0.08)" : "transparent") + ";transition:border-color 0.15s,background 0.15s;"

          const cb = document.createElement("input")
          cb.type = "checkbox"
          cb.checked = currentSettings.dockables?.[d.id] !== false
          cb.style.cssText = "width:14px;height:14px;"
          cb.addEventListener("change", () => {
            if (!currentSettings.dockables) currentSettings.dockables = {}
            currentSettings.dockables[d.id] = cb.checked
            const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`)
            if (dockEl) dockEl.style.display = cb.checked ? "" : "none"
            row.style.borderColor = cb.checked ? "#6c63ff" : "#2a2a4a"
            row.style.background = cb.checked ? "rgba(108,99,255,0.08)" : "transparent"
          })

          const icon = document.createElement("span")
          icon.style.cssText = "font-size:14px;"
          icon.textContent = d.icon

          const info = document.createElement("div")
          info.style.cssText = "flex:1;"
          const name = document.createElement("strong")
          name.style.cssText = "font-size:11px;"
          name.textContent = d.title
          info.appendChild(name)
          if (d.description) {
            const desc = document.createElement("p")
            desc.style.cssText = "font-size:9px;color:#9aa0c0;margin:1px 0 0;"
            desc.textContent = d.description
            info.appendChild(desc)
          }
          const meta = document.createElement("p")
          meta.style.cssText = "font-size:9px;color:#666;margin:1px 0 0;"
          meta.textContent = `${d.defaultSize.width}×${d.defaultSize.height} · ${d.defaultPosition}`
          info.appendChild(meta)

          row.appendChild(cb)
          row.appendChild(icon)
          row.appendChild(info)
          sec.appendChild(row)
        })
      })

      // Feature toggles
      addSection(panel, "Features", (sec) => {
        Object.entries(currentSettings.features || {}).forEach(([key, val]) => {
          const row = document.createElement("label")
          row.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0;cursor:pointer;"
          const cb = document.createElement("input")
          cb.type = "checkbox"
          cb.checked = val
          cb.addEventListener("change", () => { currentSettings.features[key] = cb.checked })
          row.appendChild(cb)
          row.appendChild(document.createTextNode(key.replace(/([A-Z])/g, " $1").trim()))
          sec.appendChild(row)
        })
      })

      // Save buttons
      const btnRow = document.createElement("div")
      btnRow.style.cssText = "display:flex;gap:6px;margin-top:8px;"
      const saveBtn = document.createElement("button")
      saveBtn.textContent = "💾 Save Site Config"
      saveBtn.style.cssText = "flex:1;padding:5px 8px;font-size:10px;background:#6c63ff30;border:1px solid #6c63ff40;color:#a5a0ff;border-radius:4px;cursor:pointer;font-weight:600;"
      saveBtn.addEventListener("click", async () => {
        currentSettings._siteSpecific = true
        const ok = await savePrefsForSite(currentSite?.id, { overlaySettings: currentSettings })
        if (ok !== null) {
          saveBtn.textContent = "✓ Saved!"
          saveBtn.style.background = "#4ade8030"
          saveBtn.style.borderColor = "#4ade8040"
          saveBtn.style.color = "#4ade80"
          setTimeout(() => {
            saveBtn.textContent = "💾 Save Site Config"
            saveBtn.style.background = "#6c63ff30"
            saveBtn.style.borderColor = "#6c63ff40"
            saveBtn.style.color = "#a5a0ff"
          }, 1500)
        }
      })
      const resetBtn = document.createElement("button")
      resetBtn.textContent = "↺ Reset to Defaults"
      resetBtn.style.cssText = "flex:1;padding:5px 8px;font-size:10px;background:#ff6b6b20;border:1px solid #ff6b6b40;color:#ff6b6b;border-radius:4px;cursor:pointer;"
      resetBtn.addEventListener("click", async () => {
        currentSettings = getDefaultSettings(currentSite?.suite)
        currentSettings._siteSpecific = false
        applySettings(currentSettings)
        // Also clear saved site config
        if (currentSite?.id) await savePrefsForSite(currentSite.id, { overlaySettings: null })
      })
      btnRow.appendChild(saveBtn)
      btnRow.appendChild(resetBtn)
      panel.appendChild(btnRow)

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
      stopTradingPoll()
      el.remove()
      activeDockables.forEach((d) => { const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`); if (dockEl) dockEl.remove() })
      cleanupGroups()
      activeDockables = []
      if (siteInfo?.id) savePrefsForSite(siteInfo.id, { overlay: false })
    })

    btnRow.appendChild(toggleBtn)
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

    activeDockables = docks.map((d) => {
      const rawId = d.id || ""
      return { id: rawId.replace(/^__PICC_DOCK_/, "").replace(/__$/, "") }
    })

    return el
  }

  // ── Toggle overlay ──────────────────────────────────────────────────────────
  async function toggleOverlay() {
    if (overlayVisible) {
      const el = shadowRoot.getElementById(OVERLAY_ID)
      if (el) el.remove()
      activeDockables.forEach((d) => { const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`); if (dockEl) dockEl.remove() })
      cleanupGroups()
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
      if (sitePrefs?.overlaySettings) {
        overlaySettings = sitePrefs.overlaySettings
        overlaySettings._siteSpecific = true
      }
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

  // ── Autopilot control button delegation (on shadowRoot — document won't receive shadow DOM click events) ──
  shadowRoot.addEventListener("click", async (e) => {
    const btn = e.composedPath().find((el) => el.hasAttribute?.("data-picc-action"))
    if (!btn) return
    const action = btn.getAttribute("data-picc-action")
    if (action === "autopilot-toggle") {
      btn.disabled = true
      btn.textContent = "..."
      try {
        const running = tradingState.autopilot?.enabled
        const path = running ? "/api/autopilot/stop" : "/api/autopilot/start"
        const method = running ? "POST" : "POST"
        await serverFetch(path, { method, body: { reason: "user" } })
        await fetchTradingData()
        updateAllDockables()
      } catch { /* ignore */ }
      btn.disabled = false
    }
    if (action === "autopilot-kill") {
      btn.disabled = true
      try {
        await serverFetch("/api/autopilot/stop", { method: "POST", body: { reason: "emergency-kill-switch" } })
        await fetchTradingData()
        updateAllDockables()
        playAlertSound("danger")
        showToast("Kill Switch", "Emergency stop executed. All autopilot activity halted.", "error")
      } catch { /* ignore */ }
      btn.disabled = false
    }
  })

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
      if (msg.type === "error" || msg.type === "danger") playAlertSound("danger")
      else if (msg.type === "success") playAlertSound("success")
      else playAlertSound("info")
      showToast(msg.title, msg.message, msg.type)
    }
    if (msg.action === "extract-content") return extractPageContent(msg.selectors)
    if (msg.action === "detect-forms") return detectForms()
    if (msg.action === "read-storage") return readWebStorage()
    if (msg.action === "fill-field") return fillField(msg.selector, msg.value)
    if (msg.action === "click-element") return clickElement(msg.selector)
    if (msg.action === "navigate") return navigateTo(msg.url)
  })

  // ── Server check on load ────────────────────────────────────────────────────
  // Initial check via background. Periodic updates come from background alarms
  // pushing "server-status" messages to this content script.
  checkServer()
})()
