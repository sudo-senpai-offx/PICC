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
    try {
      if (currentSite?.id) {
        const settings = { ...currentSettings, dockableLayout: layout, groups: dockGroups }
        savePrefsForSite(currentSite.id, { overlaySettings: settings }).catch(() => {})
      }
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

  function addDockToGroup(dockId, groupId) {
    if (!dockGroups[groupId]) return
    if (dockGroups[groupId].includes(dockId)) return
    dockGroups[groupId].push(dockId)
    dockGroupMap[dockId] = groupId
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
      // Drag tab out to ungroup
      tab.addEventListener("mousedown", (e) => {
        if (e.target.tagName === "BUTTON") return
        e.stopPropagation()
        const startX = e.clientX
        const startY = e.clientY
        const onMove = (ev) => {
          const dx = Math.abs(ev.clientX - startX)
          const dy = Math.abs(ev.clientY - startY)
          if (dx > 30 || dy > 30) {
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            ungroupDock(dId)
            const el = shadowRoot.getElementById(`__PICC_DOCK_${dId}__`)
            if (el) {
              el.style.display = ""
              el.style.left = ev.clientX - 40 + "px"
              el.style.top = ev.clientY - 18 + "px"
              el.style.right = "auto"
              el.style.bottom = "auto"
              dockablePositions[dId] = { x: Math.round(ev.clientX - 40), y: Math.round(ev.clientY - 18) }
              saveDockableLayout()
            }
          }
        }
        const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
      })
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

    // Resize handles for group (horizontal + vertical + diagonal)
    const RESIZE_CSS_G = "position:absolute;opacity:.3;z-index:1;"
    const makeGResizeHandler = (direction) => {
      const el = document.createElement("div")
      el.setAttribute("data-picc-resize", direction)
      const isH = direction === "horizontal"
      const isV = direction === "vertical"
      const isD = direction === "diagonal"
      el.style.cssText = RESIZE_CSS_G +
        (isD ? "bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;" :
         isH ? "bottom:0;right:0;top:36px;width:5px;cursor:ew-resize;" :
         "bottom:0;right:0;left:36px;height:5px;cursor:ns-resize;")
      let isResizing = false, rsx, rsy, rw, rh
      el.addEventListener("mousedown", (e) => {
        e.preventDefault()
        e.stopPropagation()
        isResizing = true
        rsx = e.clientX; rsy = e.clientY
        rw = gc.offsetWidth; rh = gc.offsetHeight
        gc.style.transition = "none"
        const onMove = (ev) => {
          if (!isResizing) return
          if (isH || isD) gc.style.width = Math.max(200, rw + ev.clientX - rsx) + "px"
          if (isV || isD) gc.style.maxHeight = Math.max(100, rh + ev.clientY - rsy) + "px"
        }
        const onUp = () => {
          isResizing = false
          gc.style.transition = ""
          document.removeEventListener("mousemove", onMove)
          document.removeEventListener("mouseup", onUp)
          for (const dId of members) {
            dockableSizes[dId] = { width: Math.round(gc.offsetWidth), height: Math.round(gc.offsetHeight) }
          }
          saveDockableLayout()
        }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
      })
      return el
    }
    gc.appendChild(makeGResizeHandler("diagonal"))
    gc.appendChild(makeGResizeHandler("horizontal"))
    gc.appendChild(makeGResizeHandler("vertical"))

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

  // ── Shadow DOM isolation ────────────────────────────────────────────────────
  const shadowHost = document.createElement("div")
  shadowHost.id = "__PICC_SHADOW_HOST__"
  shadowHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;"
  document.body.appendChild(shadowHost)
  const shadowRoot = shadowHost.attachShadow({ mode: "open" })

  // ── Site detection ──────────────────────────────────────────────────────────
  const SITE_PROFILES = [
    // Trading
    { hosts: ["expertoption.com", "expert-option.com", "expertoption.finance"], id: "expertoption", label: "ExpertOption", category: "trading", suite: "trading" },
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
      if (typeof content === "string") body.innerHTML = content
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
          // Check for grouping — if overlapping another dock or a group container
          const myRect = dock.getBoundingClientRect()
          let grouped = false
          // First: check overlap with existing group containers (tab bar area)
          for (const gc of shadowRoot.querySelectorAll("[data-picc-group]")) {
            const gcRect = gc.getBoundingClientRect()
            const tabBarEl = gc.querySelector("div")
            const tabBarBottom = tabBarEl ? gcRect.top + tabBarEl.offsetHeight : gcRect.top + 36
            const titleOverlap = !(myRect.right < gcRect.left || gcRect.right < myRect.left ||
              myRect.bottom < gcRect.top || tabBarBottom < myRect.top)
            if (titleOverlap) {
              const groupId = gc.getAttribute("data-picc-group")
              addDockToGroup(id, groupId)
              grouped = true
              break
            }
          }
          // Second: check overlap with individual docks
          if (!grouped) {
            for (const otherDock of shadowRoot.querySelectorAll("[data-picc-dock]")) {
              if (otherDock === dock) continue
              if (otherDock.style.display === "none") continue
              const otherRect = otherDock.getBoundingClientRect()
              const titleOverlap = !(myRect.right < otherRect.left || otherRect.right < myRect.left ||
                myRect.bottom < otherRect.top || otherRect.top + 36 < myRect.top)
              if (titleOverlap) {
                groupDocks(id, otherDock.id.replace(/^__PICC_DOCK_/, "").replace(/__$/, ""))
                grouped = true
                break
              }
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

      // ── Resize handles (horizontal + vertical + diagonal) ──
      const handle = shadowRoot.getElementById(`__PICC_RESIZE_${id}__`)
      if (handle) handle.remove()
      const RESIZE_CSS = "position:absolute;opacity:.3;z-index:1;"
      const makeResizeHandler = (direction) => {
        const el = document.createElement("div")
        el.setAttribute("data-picc-resize", direction)
        const isH = direction === "horizontal"
        const isV = direction === "vertical"
        const isD = direction === "diagonal"
        el.style.cssText = RESIZE_CSS +
          (isD ? "bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;" :
           isH ? "bottom:0;right:0;top:36px;width:5px;cursor:ew-resize;" :
           "bottom:0;right:0;left:36px;height:5px;cursor:ns-resize;")
        let isResizing = false, rsx, rsy, rw, rh
        el.addEventListener("mousedown", (e) => {
          e.preventDefault()
          e.stopPropagation()
          isResizing = true
          rsx = e.clientX; rsy = e.clientY
          rw = dock.offsetWidth; rh = dock.offsetHeight
          dock.style.transition = "none"
          const onMove = (ev) => {
            if (!isResizing) return
            if (isH || isD) dock.style.width = Math.max(200, rw + ev.clientX - rsx) + "px"
            if (isV || isD) dock.style.maxHeight = Math.max(100, rh + ev.clientY - rsy) + "px"
          }
          const onUp = () => {
            isResizing = false
            dock.style.transition = ""
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            dockableSizes[id] = { width: Math.round(dock.offsetWidth), height: Math.round(dock.offsetHeight) }
            saveDockableLayout()
          }
          document.addEventListener("mousemove", onMove)
          document.addEventListener("mouseup", onUp)
        })
        return el
      }
      dock.appendChild(makeResizeHandler("diagonal"))
      dock.appendChild(makeResizeHandler("horizontal"))
      dock.appendChild(makeResizeHandler("vertical"))

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
    lastCandles: []
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

  // Normalize a scraped asset name for server API calls and Yahoo Finance.
  // "EUR/USD" → "EURUSD", "Gold" → "GOLD", "BTC/USD" → "BTCUSD", "EUR/USD (OTC)" → "EURUSD"
  function normalizeAssetId(raw) {
    if (!raw) return "EURUSD"
    let s = raw.replace(/\s*\(otc\)/gi, "").replace(/\s+/g, "").toUpperCase()
    if (/^[A-Z]{3}\/[A-Z]{3}$/.test(s)) s = s.replace("/", "")
    if (/^[A-Z]{3}\.[A-Z]{3}$/.test(s)) s = s.replace(".", "")
    if (s.length > 6) {
      // Try to extract a 3/3 currency pair: "EURUSDGBP" → "EURUSD"? No, take first 6
      const pair = s.slice(0, 6)
      if (/^[A-Z]{3}[A-Z]{3}$/.test(pair)) return pair
    }
    if (s.length === 6 && /^[A-Z]{6}$/.test(s)) return s
    // Known commodity/crypto mappings
    const MAP = { GOLD: "GOLD", SILVER: "SILVER", BTCUSD: "BTCUSD", ETHUSD: "ETHUSD", XAUUSD: "GOLD", XAGUSD: "SILVER" }
    return MAP[s] || s.slice(0, 12) || "EURUSD"
  }

  // ── Feature-aware helpers ──────────────────────────────────────────────────
  const DOCKABLE_FEATURES = {
    "price-ticker": ["analysis"],
    "portfolio": [],
    "ai-signals": ["ai", "decisionSupport", "analysis"],
    "risk-mgr": ["decisionSupport", "analysis"],
    "autopilot": ["autopilot", "automation", "decisionSupport"],
    "kelly-sizing": ["analysis"],
    "regime-detect": ["analysis"],
    "order-flow": ["analysis"],
    "expiry-opt": ["analysis"],
    "sentiment": ["analysis"],
  }
  function checkFeatures(dockId) {
    const needed = DOCKABLE_FEATURES[dockId]
    if (!needed || !needed.length) return ""
    const disabled = needed.filter((f) => !currentSettings.features?.[f])
    if (!disabled.length) return ""
    const label = disabled.map((f) => f.replace(/([A-Z])/g, " $1").trim()).join(", ")
    return `<div style="background:#f59e0b15;border:1px solid #f59e0b40;border-radius:4px;padding:4px 6px;margin-bottom:4px;font-size:10px;color:#f59e0b">` +
      `<span style="font-weight:600">⚠ Feature disabled:</span> ${label}. Enable in pill ⚙ settings.</div>`
  }

  // ── Price Ticker Renderer ──────────────────────────────────────────────────
  function renderPriceTicker() {
    const assets = tradingState.assets
    const banner = checkFeatures("price-ticker")
    const statusDot = serverOnline === true ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ade80;margin-right:4px"></span>' :
      serverOnline === false ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#ff6b6b;margin-right:4px"></span>' :
      '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#f59e0b;margin-right:4px"></span>'
    const statusLabel = serverOnline === true ? 'Connected' : serverOnline === false ? 'Offline' : 'Checking'
    const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:9px;color:#9aa0c0"><span>${statusDot}${statusLabel}</span><span>${new Date().toLocaleTimeString()}</span></div>`
    if (!assets.length) return banner + header + '<div style="color:#a5a0ff;padding:4px">Waiting for market data\u2026</div>'
    const rows = assets.slice(0, 6).map((a) => {
      const c = tone(a.changePct)
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #6c63ff20">` +
        `<span style="font-weight:600;font-size:11px">${a.name || a.id}</span>` +
        `<span style="font-size:11px;color:${c}">${a.price != null ? a.price.toFixed(4) : "\u2014"}</span>` +
        `<span style="font-size:10px;color:${c}">${a.changePct != null ? (a.changePct >= 0 ? "+" : "") + a.changePct.toFixed(2) + "%" : ""}</span>` +
        `</div>`
    }).join("")
    const acct = tradingState.account
    const bal = acct?.balance != null ? fmt$(acct.balance, acct.currency) : ""
    return banner + header + `<div style="font-size:11px">${rows}</div>` +
      (bal ? `<div style="margin-top:4px;font-size:10px;color:#a5a0ff">Balance: ${bal}</div>` : "")
  }

  // ── Portfolio Renderer ─────────────────────────────────────────────────────
  function renderPortfolio() {
    const paper = tradingState.paper
    const demo = tradingState.demo
    const banner = checkFeatures("portfolio")
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
    if (!lines.length) return banner + '<div style="color:#a5a0ff;padding:4px">No position data yet\u2026</div>'
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── AI Signals Renderer ────────────────────────────────────────────────────
  function renderAISignals() {
    const d = tradingState.decisions
    const banner = checkFeatures("ai-signals")
    if (!d.length) return banner + '<div style="color:#a5a0ff;padding:4px">Waiting for AI analysis\u2026</div>'
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
          `<span style="color:${dec.direction === "up" ? "#4ade80" : dec.direction === "down" ? "#ff6b6b" : "#a5a0ff"}">${(dec.direction || "").toUpperCase()}</span>` +
        `</div>` +
        `</div>`
    }).join("")
    return banner + `<div style="padding:2px 0">${rows}</div>`
  }

  // ── Risk Manager Renderer ──────────────────────────────────────────────────
  function renderRiskManager() {
    const demo = tradingState.demo
    const auto = tradingState.autopilot
    const banner = checkFeatures("risk-mgr")
    if (!demo && !auto) return banner + '<div style="color:#a5a0ff;padding:4px">Risk metrics loading\u2026</div>'
    const lines = []
    if (auto) {
      const maxLossPct = auto.dailyLossLimitPct ?? 10
      const todayPnl = demo?.todayPnl ?? 0
      const todayLoss = todayPnl < 0 ? Math.abs(todayPnl) : 0
      // Show as PnL vs limit: use dollar amounts
      const pct = maxLossPct > 0 && todayLoss > 0 ? Math.min(100, (todayLoss / (maxLossPct / 100)) * 100) : 0
      const barColor = pct > 80 ? "#ff6b6b" : pct > 50 ? "#f59e0b" : "#4ade80"
      lines.push(`<div style="font-size:11px;font-weight:600;color:#6c63ff;margin-bottom:2px">Daily Loss Limit</div>`)
      lines.push(`<div style="background:#1a1a2e;border-radius:3px;height:8px;overflow:hidden;margin-bottom:2px">` +
        `<div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:10px;color:#a5a0ff"><span>${fmt$(todayLoss, demo?.currency)} lost</span><span>${maxLossPct}% limit</span></div>`)
    }
    if (demo?.autopilot) {
      const ap = demo.autopilot
      const openPos = demo.openDeals?.length ?? 0
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px"><span>Open positions</span><span>${openPos}/${ap.maxConcurrent ?? 1}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Trades today</span><span>${demo.todayTrades ?? 0}/${ap.maxDailyTrades ?? "\u221e"}</span></div>`)
      const cdMs = ap.cooldownMs ?? 0
      const lastRunAt = ap.lastRun?.at ?? (typeof ap.lastRun === "number" ? ap.lastRun : 0)
      const lastRun = lastRunAt ? new Date(lastRunAt).getTime() : 0
      const cdLeft = lastRun > 0 && cdMs > 0 ? Math.max(0, Math.ceil((cdMs - (Date.now() - lastRun)) / 1000)) : 0
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Cooldown</span><span>${cdLeft > 0 ? cdLeft + "s" : "ready"}</span></div>`)
    }
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Autopilot Control Renderer ─────────────────────────────────────────────
  function renderAutopilot() {
    const auto = tradingState.autopilot
    const running = auto?.enabled ?? false
    const statusColor = running ? "#4ade80" : "#a5a0ff"
    const banner = checkFeatures("autopilot")
    const lines = []
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">`)
    lines.push(`<div style="width:8px;height:8px;border-radius:50%;background:${statusColor}"></div>`)
    lines.push(`<span style="font-weight:600;font-size:11px">${running ? "Running" : "Stopped"}</span>`)
    lines.push(`</div>`)
    if (auto?.minConfidence != null) lines.push(`<div style="font-size:11px">Min confidence: <b>${auto.minConfidence}%</b></div>`)
    if (auto?.assetId) lines.push(`<div style="font-size:11px">Asset: <b>${auto.assetId}</b></div>`)
    const lastDec = tradingState.demo?.autopilot?.lastDecision
    if (lastDec) lines.push(`<div style="font-size:10px;color:#a5a0ff">Last: ${lastDec}</div>`)
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
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Kelly Sizing Renderer ──────────────────────────────────────────────────
  function renderKellySizing() {
    const kelly = tradingState.kelly
    const banner = checkFeatures("kelly-sizing")
    if (!kelly) return banner + '<div style="color:#a5a0ff;padding:4px">Loading Kelly data\u2026</div>'
    const stats = kelly.stats || {}
    const k = kelly.kelly || {}
    const lines = []
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Win rate</span><span>${stats.winRate != null ? stats.winRate + "%" : "—"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Avg payout</span><span>${stats.avgPayout != null ? stats.avgPayout + "x" : "—"}</span></div>`)
    lines.push(`<div style="border-top:1px solid #6c63ff20;margin:4px 0"></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Full Kelly</span><span style="color:#6c63ff">${k.fullKelly != null ? k.fullKelly + "%" : "—"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Suggested (${k.mode || "half"})</span><span style="font-weight:600;color:#4ade80">${k.suggested != null ? k.suggested + "%" : "—"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Break-even WR</span><span>${k.breakEven != null ? k.breakEven + "%" : "—"}</span></div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Regime Detection Renderer ──────────────────────────────────────────────
  function renderRegimeDetect() {
    const regime = tradingState.regime
    const banner = checkFeatures("regime-detect")
    if (!regime || regime.regime === "unknown") return banner + '<div style="color:#a5a0ff;padding:4px">Analyzing market regime\u2026</div>'
    const colors = { trending: "#4ade80", ranging: "#f59e0b", volatile: "#ff6b6b", breakout: "#6c63ff" }
    const c = colors[regime.regime] || "#a5a0ff"
    const lines = []
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:8px;height:8px;border-radius:50%;background:${c}"></div><span style="font-weight:600;font-size:12px;color:${c}">${(regime.regime || "").toUpperCase()}</span><span style="font-size:10px;color:#9aa0c0">${regime.confidence || 0}%</span></div>`)
    if (regime.metrics) lines.push(`<div style="font-size:10px;color:#9aa0c0">ADX: ${regime.metrics.adx} · ATR ratio: ${regime.metrics.atrRatio}x</div>`)
    if (regime.suggestedStrategy) lines.push(`<div style="font-size:10px;margin-top:4px">Strategy: <b style="color:#6c63ff">${regime.suggestedStrategy}</b></div>`)
    if (regime.factors?.length) lines.push(`<div style="font-size:9px;color:#9aa0c0;margin-top:2px">${regime.factors.join(" · ")}</div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Order Flow Renderer ────────────────────────────────────────────────────
  function renderOrderFlow() {
    const of = tradingState.orderFlow
    const banner = checkFeatures("order-flow")
    if (!of || !of.delta?.length) return banner + '<div style="color:#a5a0ff;padding:4px">Loading order flow\u2026</div>'
    const lines = []
    const imbColor = of.imbalance === "buy-heavy" ? "#4ade80" : of.imbalance === "sell-heavy" ? "#ff6b6b" : "#f59e0b"
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-weight:600;font-size:11px">Net Delta</span><span style="color:${of.cumulative >= 0 ? "#4ade80" : "#ff6b6b"};font-weight:600">${of.cumulative >= 0 ? "+" : ""}${of.cumulative}</span><span style="font-size:9px;padding:1px 4px;border-radius:3px;background:${imbColor}30;color:${imbColor}">${of.imbalance}</span></div>`)
    if (of.avgDelta != null) lines.push(`<div style="font-size:10px;color:#9aa0c0">Avg delta: ${of.avgDelta}</div>`)
    if (of.signals?.length) {
      for (const sig of of.signals.slice(0, 3)) {
        lines.push(`<div style="font-size:9px;color:${sig.type === "divergence" ? "#f59e0b" : "#6c63ff"};margin-top:2px">⚡ ${sig.desc}</div>`)
      }
    }
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Expiry Optimizer Renderer ──────────────────────────────────────────────
  function renderExpiryOpt() {
    const exp = tradingState.expiry
    const banner = checkFeatures("expiry-opt")
    if (!exp || !exp.recommended) return banner + '<div style="color:#a5a0ff;padding:4px">Analyzing optimal expiry\u2026</div>'
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
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Sentiment Renderer ─────────────────────────────────────────────────────
  function renderSentiment() {
    const sent = tradingState.sentiment
    const banner = checkFeatures("sentiment")
    if (!sent || !sent.composite) return banner + '<div style="color:#a5a0ff;padding:4px">Loading sentiment\u2026</div>'
    const c = sent.composite
    const lines = []
    const scoreColor = c.score > 0.2 ? "#4ade80" : c.score < -0.2 ? "#ff6b6b" : "#f59e0b"
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-weight:600;font-size:12px;color:${scoreColor}">${c.label || "Neutral"}</span><span style="font-size:10px;color:#9aa0c0">Score: ${c.score}</span>${c.extreme ? '<span style="font-size:8px;padding:1px 3px;border-radius:3px;background:#ff6b6b30;color:#ff6b6b">EXTREME</span>' : ""}</div>`)
    if (sent.news) lines.push(`<div style="font-size:10px;color:#9aa0c0">News: ${sent.news.bullish}🟢 ${sent.news.bearish}🔴 ${sent.news.neutral}⚪ (${sent.news.sampleSize})</div>`)
    if (sent.social) lines.push(`<div style="font-size:10px;color:#9aa0c0">Social velocity: ${sent.social.velocity > 0 ? "+" : ""}${sent.social.velocity}</div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Generic renderers (work on ANY site) ───────────────────────────────────
  function renderPageOverview() {
    const pm = tradingState.pageMetrics
    const assets = tradingState.assets
    const lines = []
    if (pm) {
      lines.push(`<div style="font-weight:600;font-size:11px;color:#6c63ff;margin-bottom:4px">${pm.title || window.location.hostname}</div>`)
      lines.push(`<div style="font-size:10px;color:#9aa0c0;word-break:break-all;margin-bottom:4px">${window.location.href.substring(0, 60)}…</div>`)
      if (pm.loadTime != null) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Load time</span><span style="color:${pm.loadTime < 2000 ? "#4ade80" : pm.loadTime < 5000 ? "#f59e0b" : "#ff6b6b"}">${pm.loadTime}ms</span></div>`)
      if (pm.domContentLoaded != null) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>DOM ready</span><span>${pm.domContentLoaded}ms</span></div>`)
      if (pm.firstPaint != null) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>First paint</span><span>${pm.firstPaint}ms</span></div>`)
      if (pm.domElements) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>DOM elements</span><span>${pm.domElements.toLocaleString()}</span></div>`)
      if (pm.images) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Images</span><span>${pm.images}</span></div>`)
      if (pm.links) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Links</span><span>${pm.links}</span></div>`)
      if (pm.scripts) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Scripts</span><span>${pm.scripts}</span></div>`)
      if (pm.forms) lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Forms</span><span>${pm.forms}</span></div>`)
    }
    if (assets.length > 0) {
      lines.push(`<div style="border-top:1px solid #6c63ff20;margin:4px 0"></div>`)
      lines.push(`<div style="font-weight:600;font-size:10px;color:#6c63ff;margin-bottom:2px">Detected Prices</div>`)
      for (const a of assets.slice(0, 5)) {
        const c = tone(a.changePct)
        lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px">` +
          `<span>${a.name}</span>` +
          `<span>${a.price != null ? a.price : "\u2014"} ${a.changePct != null ? `<span style="color:${c}">${a.changePct >= 0 ? "+" : ""}${a.changePct.toFixed(2)}%</span>` : ""}</span></div>`)
      }
    }
    if (!lines.length) return '<div style="color:#a5a0ff;padding:4px">Analyzing page\u2026</div>'
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  function renderPageContent() {
    const pm = tradingState.pageMetrics
    const lines = []
    if (pm?.description) {
      lines.push(`<div style="font-size:10px;color:#9aa0c0;margin-bottom:4px"><b style="color:#eef0ff">Description:</b> ${pm.description.substring(0, 120)}${pm.description.length > 120 ? "…" : ""}</div>`)
    }
    // Extract headings
    try {
      const headings = []
      for (const h of document.querySelectorAll("h1, h2, h3")) {
        const text = h.textContent.trim()
        if (text && text.length < 100) headings.push({ level: h.tagName, text })
        if (headings.length >= 6) break
      }
      if (headings.length > 0) {
        lines.push(`<div style="font-weight:600;font-size:10px;color:#6c63ff;margin-bottom:2px">Headings</div>`)
        for (const h of headings) {
          const indent = h.level === "H1" ? 0 : h.level === "H2" ? 4 : 8
          lines.push(`<div style="font-size:10px;color:#eef0ff;padding-left:${indent}px">${h.text.substring(0, 50)}${h.text.length > 50 ? "…" : ""}</div>`)
        }
      }
    } catch {}
    // Extract key links
    try {
      const links = []
      for (const a of document.querySelectorAll("a[href]")) {
        const text = a.textContent.trim()
        if (text && text.length > 2 && text.length < 60) links.push(text)
        if (links.length >= 5) break
      }
      if (links.length > 0) {
        lines.push(`<div style="font-weight:600;font-size:10px;color:#6c63ff;margin-top:4px;margin-bottom:2px">Key Links</div>`)
        for (const l of links) {
          lines.push(`<div style="font-size:10px;color:#9aa0c0">→ ${l}</div>`)
        }
      }
    } catch {}
    if (!lines.length) return '<div style="color:#a5a0ff;padding:4px">Scanning page content\u2026</div>'
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  function renderServerStatus() {
    const lines = []
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">`)
    lines.push(`<div style="width:8px;height:8px;border-radius:50%;background:${serverOnline ? "#4ade80" : serverOnline === false ? "#ff6b6b" : "#f59e0b"}"></div>`)
    lines.push(`<span style="font-weight:600;font-size:11px">${serverOnline ? "Server Online" : serverOnline === false ? "Server Offline" : "Checking\u2026"}</span>`)
    lines.push(`</div>`)
    if (serverPort) lines.push(`<div style="font-size:10px;color:#9aa0c0">Port: ${serverPort}</div>`)
    if (tradingState.lastCandles?.length) lines.push(`<div style="font-size:10px;color:#9aa0c0">Candles: ${tradingState.lastCandles.length}</div>`)
    const dataFlags = [
      tradingState.kelly ? "Kelly" : null,
      tradingState.regime ? "Regime" : null,
      tradingState.expiry ? "Expiry" : null,
      tradingState.sentiment ? "Sentiment" : null,
      tradingState.orderFlow ? "OrderFlow" : null,
      tradingState.autopilot ? "Autopilot" : null,
      tradingState.decisions?.length ? "AI" : null
    ].filter(Boolean)
    if (dataFlags.length) {
      lines.push(`<div style="font-size:9px;color:#4ade80;margin-top:2px">${dataFlags.join(" \u00b7 ")}</div>`)
    }
    if (!serverOnline) {
      lines.push(`<div style="font-size:10px;color:#f59e0b;margin-top:4px">Start the server for full features:</div>`)
      lines.push(`<code style="font-size:9px;color:#6c63ff;background:#0d0d1a;padding:2px 4px;border-radius:3px;display:block;margin-top:2px">npm run serve</code>`)
    }
    const assets = tradingState.assets
    if (assets.length > 0) {
      lines.push(`<div style="border-top:1px solid #6c63ff20;margin:4px 0"></div>`)
      lines.push(`<div style="font-weight:600;font-size:10px;color:#6c63ff;margin-bottom:2px">Live Data</div>`)
      for (const a of assets.slice(0, 4)) {
        const c = tone(a.changePct)
        lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px">` +
          `<span>${a.name}</span>` +
          `<span style="font-weight:600">${a.price != null ? a.price : "\u2026"}</span></div>`)
      }
    }
    if (!serverOnline && assets.length === 0) {
      lines.push(`<div style="font-size:10px;color:#9aa0c0;margin-top:4px">Extension will still detect page data, prices, and content.</div>`)
    }
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Universal page data extraction (works on ANY site) ────────────────────
  let eoObserver = null
  let eoLastPrice = null
  let eoLastAsset = null

  function scrapePageData() {
    const result = { assets: [], balance: null, pageMetrics: null }
    try {
      const data = extractPageData()
      if (data.prices.length > 0) {
        for (const p of data.prices.slice(0, 5)) {
          const old = result.assets.find((a) => a.name === p.name)
          if (old) {
            const oldPrice = old.price
            old.price = p.value
            if (oldPrice > 0) {
              old.changePct = ((p.value - oldPrice) / oldPrice) * 100
              old.change = p.value - oldPrice
            }
          } else {
            result.assets.push({
              id: p.name || "asset-" + result.assets.length,
              name: p.name || "Asset " + (result.assets.length + 1),
              price: p.value,
              changePct: 0,
              change: 0,
            })
          }
        }
      }
      if (data.balance != null) result.balance = data.balance
      if (data.assetName && result.assets.length === 0) {
        result.assets.push({ id: data.assetName, name: data.assetName, price: null, changePct: null, change: null })
      }
      result.pageMetrics = collectPageMetricsLocal()
    } catch {}
    // Start real-time observer on any site
    if (!eoObserver) startEOObserver()
    return result
  }

  // Parse a text string into a numeric price, handling various formats.
  function parsePrice(text) {
    if (!text || text.length > 30) return null
    const cleaned = text.replace(/[\$\u20AC\u00A3\u00A5\u20A9\u20B9]/g, "").replace(/balance[:\s]*/gi, "").replace(/[\u2248\u2249]/g, "").trim()
    let m = cleaned.match(/^(\d{1,10}\.\d{2,8})$/)
    if (m) return parseFloat(m[1])
    m = cleaned.match(/^(\d{1,3}(?:,\d{3})*\.\d{2,8})$/)
    if (m) return parseFloat(m[1].replace(/,/g, ""))
    m = cleaned.match(/^(\d{4,10})$/)
    if (m) return parseFloat(m[1])
    return null
  }

  function extractPageData() {
    const out = { prices: [], balance: null, assetName: null }
    const isEO = /expertoption\.(com|finance)/i.test(window.location.hostname)
    // ── ExpertOption-specific selectors first (fallback for React apps) ──
    if (isEO) {
      try {
        const priceSelectors = [
          '[class*="price"]', '[class*="Price"]', '[class*="quote"]', '[class*="Quote"]',
          '[class*="current-value"]', '[class*="asset-price"]',
          '[data-value]', '[data-price]'
        ]
        for (const sel of priceSelectors) {
          const els = document.querySelectorAll(sel)
          for (const el of els) {
            if (el.closest("[data-picc-overlay], [data-picc-dock]")) continue
            const text = el.textContent.trim()
            if (!text || text.length > 30) continue
            const val = parsePrice(text)
            if (val != null && val > 0) {
              const rect = el.getBoundingClientRect()
              if (rect.width >= 5 && rect.height >= 5 && rect.top < window.innerHeight) {
                const name = findNearbyAssetName(el) || out.assetName
                if (name && !out.assetName) out.assetName = name
                const score = 50 + (parseFloat(getComputedStyle(el).fontSize) || 12)
                if (!out.prices.find((p) => Math.abs(p.value - val) / val < 0.001))
                  out.prices.push({ value: val, name: name || "Asset", score })
              }
            }
          }
          if (out.prices.length >= 3) break
        }
        const balSelectors = [
          '[class*="balance"]', '[class*="Balance"]', '[class*="wallet"]', '[class*="Wallet"]',
          '[class*="deposit"]', '[class*="account-amount"]'
        ]
        for (const sel of balSelectors) {
          if (out.balance != null) break
          for (const el of document.querySelectorAll(sel)) {
            if (el.closest("[data-picc-overlay], [data-picc-dock]")) continue
            const m = el.textContent.trim().match(/([\d,]+\.?\d{0,2})/)
            if (m) {
              const val = parseFloat(m[1].replace(/,/g, ""))
              if (val > 0 && val < 9999999) { out.balance = val; break }
            }
          }
        }
        const nameSelectors = [
          '[class*="asset-name"]', '[class*="AssetName"]', '[class*="instrument"]',
          '[class*="pair-name"]', '[class*="symbol"]'
        ]
        if (!out.assetName) for (const sel of nameSelectors) {
          const el = document.querySelector(sel)
          if (el && !el.closest("[data-picc-overlay], [data-picc-dock]")) {
            const t = el.textContent.trim()
            if (t && t.length < 30) {
              const cleaned = t.replace(/\s*\(otc\)/gi, "").replace(/\s+/g, "").toUpperCase()
              if (/^[A-Z]{3}\/[A-Z]{3}$/.test(cleaned) || /^[A-Z]{3,6}$/.test(cleaned)) {
                out.assetName = cleaned; break
              }
            }
          }
        }
      } catch {}
    }
    // ── Universal TreeWalker: scan every text node in the document ──
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (parent.closest("script, style, noscript, [data-picc-overlay], [data-picc-dock], [data-picc-settings]"))
          return NodeFilter.FILTER_REJECT
        const text = node.textContent.trim()
        if (!text || text.length > 30) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })
    const priceCandidates = []
    let node
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim()
      const parent = node.parentElement
      if (!parent) continue
      // Match decimal prices: 1.09234, $1,234.56, 24567, 1,092.34
      const val = parsePrice(text)
      if (val == null || val <= 0 || val > 99999999) continue
      const rect = parent.getBoundingClientRect()
      if (rect.width < 5 || rect.height < 5) continue
      if (rect.top > window.innerHeight || rect.left > window.innerWidth) continue
      const cs = getComputedStyle(parent)
      const fontSize = parseFloat(cs.fontSize) || 12
      const fontWeight = parseInt(cs.fontWeight) || 400
      const color = cs.color
      // Score: larger font + bolder = more likely THE price
      let score = fontSize * 2 + fontWeight * 0.05
      // Bonus for being in the top 2/3 of the page (trading interfaces put price there)
      if (rect.top < window.innerHeight * 0.66) score += 5
      // Bonus for being near the horizontal center (chart prices are centered)
      const centerDist = Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2)
      if (centerDist < window.innerWidth * 0.3) score += 8
      // Bonus for high-contrast colors (white/bright on dark = price display)
      const brightness = parseColorBrightness(color)
      if (brightness > 180) score += 4
      priceCandidates.push({ val, score, fontSize, parent, text, rect })
    }
    // Sort by score descending
    priceCandidates.sort((a, b) => b.score - a.score)
    // Deduplicate: if two candidates have very close values (< 0.1% diff), keep the higher-scored one
    const seen = new Set()
    for (const c of priceCandidates) {
      const key = Math.round(c.val * 1000)
      if (seen.has(key)) continue
      seen.add(key)
      // Find the asset name near this price
      let assetName = findNearbyAssetName(c.parent)
      if (!assetName) assetName = out.assetName
      out.prices.push({ value: c.val, name: assetName || "Asset " + (out.prices.length + 1), score: c.score })
      if (out.prices.length >= 5) break
    }
    // ── Balance: scan for currency-formatted numbers (only if not found via EO selectors) ──
    if (out.balance == null) {
      const balWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement
        if (!p || p.closest("script, style, noscript, [data-picc-overlay], [data-picc-dock]"))
          return NodeFilter.FILTER_REJECT
        return /\d/.test(n.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      }
    })
    while ((node = balWalker.nextNode())) {
      const text = node.textContent.trim()
      // Match: $1,234.56 / $1234 / 1234.56 USD / Balance: 5000.00
      const m = text.match(/(?:\$\s*|balance[:\s]*|≈\s*)([\d,]+\.?\d{0,2})/i)
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""))
        const rect = node.parentElement?.getBoundingClientRect()
        if (rect && val > 0 && val < 9999999 && rect.top < 100) {
          out.balance = val
          break
        }
      }
    }
    } // end if (out.balance == null)
    // ── Asset name: look for XXX/XXX or known asset patterns (only if not found via EO selectors) ──
    if (!out.assetName) {
    const nameWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement
        if (!p || p.closest("script, style, noscript, [data-picc-overlay], [data-picc-dock]"))
          return NodeFilter.FILTER_REJECT
        const t = n.textContent.trim()
        return /^[A-Z]{3}\s*\/\s*[A-Z]{3}$/.test(t) || /^[A-Z]{3,6}\s*\/\s*[A-Z]{3,6}$/.test(t)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      }
    })
    node = nameWalker.nextNode()
    if (node) out.assetName = node.textContent.trim().replace(/\s+/g, "")
    } // end if (!out.assetName)
    return out
  }

  function findNearbyAssetName(el) {
    let search = el
    for (let depth = 0; depth < 8 && search; depth++) {
      const textNodes = []
      const tw = document.createTreeWalker(search, NodeFilter.SHOW_TEXT)
      let n
      while ((n = tw.nextNode())) {
        const t = n.textContent.trim()
        if (t && t.length < 40) textNodes.push(t)
      }
      const combined = textNodes.join(" ")
      const m = combined.match(/([A-Z]{3}\s*\/\s*[A-Z]{3})/)
      if (m) return m[1].replace(/\s+/g, "")
      // Also try commodity/crypto names
      const nm = combined.match(/\b(Gold|Silver|Bitcoin|Ethereum|Oil|EUR|GBP|JPY|USD|AUD|CAD|CHF|NZD)\b/i)
      if (nm) return nm[1]
      search = search.parentElement
    }
    return null
  }

  function parseColorBrightness(colorStr) {
    try {
      const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!m) return 0
      return (parseInt(m[1]) * 299 + parseInt(m[2]) * 587 + parseInt(m[3]) * 114) / 1000
    } catch { return 0 }
  }

  function collectPageMetricsLocal() {
    try {
      const perf = performance.getEntriesByType("navigation")[0]
      const paint = performance.getEntriesByType("paint")
      return {
        url: window.location.href,
        title: document.title,
        loadTime: perf ? Math.round(perf.loadEventEnd - perf.startTime) : null,
        domContentLoaded: perf ? Math.round(perf.domContentLoadedEventEnd - perf.startTime) : null,
        firstPaint: paint.find((p) => p.name === "first-paint")?.startTime
          ? Math.round(paint.find((p) => p.name === "first-paint").startTime) : null,
        domElements: document.getElementsByTagName("*").length,
        images: document.images.length,
        links: document.links.length,
        scripts: document.scripts.length,
        forms: document.forms.length,
        iframes: document.querySelectorAll("iframe").length,
        description: document.querySelector('meta[name="description"]')?.content || null,
        ogImage: document.querySelector('meta[property="og:image"]')?.content || null,
        charset: document.characterEncoding,
        readyState: document.readyState,
      }
    } catch { return null }
  }

  // ── EO-specific observer (uses universal extraction) ───────────────────────
  function startEOObserver() {
    if (eoObserver) return
    // Start on ANY page — the observer drives real-time price tracking everywhere
    let debounceTimer = null
    eoObserver = new MutationObserver(() => {
      if (debounceTimer) return
      debounceTimer = setTimeout(() => { debounceTimer = null }, 500)
      try {
        const data = extractPageData()
        const primary = data.prices[0]
        if (primary && primary.value != null && primary.value !== eoLastPrice) {
          const oldPrice = eoLastPrice || primary.value
          eoLastPrice = primary.value
          const assetId = primary.name || eoLastAsset || "LIVE_ASSET"
          const existing = tradingState.assets.find((a) => a.id === assetId || a.id === "LIVE_ASSET")
          if (existing) {
            existing.price = primary.value
            existing.changePct = oldPrice > 0 ? ((primary.value - oldPrice) / oldPrice) * 100 : 0
            existing.change = primary.value - oldPrice
            if (primary.name && existing.id !== primary.name) {
              existing.id = primary.name
              existing.name = primary.name
            }
          } else {
            tradingState.assets.push({
              id: assetId,
              name: primary.name || "Live Asset",
              price: primary.value,
              changePct: 0,
              change: 0,
            })
          }
          if (typeof updateAllDockables === "function") updateAllDockables()
        }
        if (data.balance != null) {
          if (tradingState.demo) tradingState.demo.balance = data.balance
          if (tradingState.account) tradingState.account.balance = data.balance
        }
        if (primary?.name) eoLastAsset = primary.name
      } catch {}
    })
    eoObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  // ── Fetch and update all trading data ──────────────────────────────────────
  let tradingPollTimer = null

  async function fetchTradingData() {
    try {
      // Always try DOM scraping first (gives live prices on ANY site)
      const scraped = scrapePageData()
      if (scraped && scraped.assets.length) {
        for (const sa of scraped.assets) {
          const existing = tradingState.assets.find((a) => a.id === sa.id)
          if (existing) {
            if (sa.price > 0) {
              const oldPrice = existing.price || sa.price
              existing.price = sa.price
              existing.name = sa.name || existing.name
              if (oldPrice > 0) existing.changePct = ((sa.price - oldPrice) / oldPrice) * 100
              existing.change = sa.price - oldPrice
            }
          } else {
            tradingState.assets.push(sa)
          }
        }
        if (scraped.balance != null) {
          if (!tradingState.demo) tradingState.demo = {}
          tradingState.demo.balance = scraped.balance
          if (tradingState.account) tradingState.account.balance = scraped.balance
        }
      }
      if (scraped?.pageMetrics) tradingState.pageMetrics = scraped.pageMetrics
      tradingState.pageMetrics = collectPageMetricsLocal()

      // Use the consolidated server endpoint — returns ALL dockable data in one call
      const primaryRaw = tradingState.assets?.[0]?.name || tradingState.assets?.[0]?.id || "EURUSD"
      const primaryAsset = normalizeAssetId(primaryRaw)
      const resp = await serverFetch("/api/extension/trading-data", {
        method: "POST",
        body: { assetId: primaryAsset, candleCount: 100 }
      })
      if (resp && resp.ok) {
        // Status / account
        if (resp.status?.ok) {
          tradingState.paper = resp.status.paper || null
          if (resp.status.expertOption) {
            const eo = resp.status.expertOption
            tradingState.account = {
              balance: eo.balance ?? tradingState.account?.balance ?? null,
              currency: eo.currency || "USD",
              demo: eo.demo
            }
          }
        }
        // Autopilot
        if (resp.autopilot) tradingState.autopilot = resp.autopilot.config || resp.autopilot
        // Demo
        if (resp.demo) tradingState.demo = resp.demo
        // Decisions
        if (resp.decisions) tradingState.decisions = Array.isArray(resp.decisions) ? resp.decisions : (resp.decisions.decisions || [])
        // Candles
        if (resp.candles?.length) {
          tradingState.lastCandles = resp.candles
          // Populate price from candles if DOM scraping failed
          const last = resp.candles[resp.candles.length - 1]
          const prev = resp.candles[resp.candles.length - 2]
          if (last && tradingState.assets[0] && !tradingState.assets[0].price) {
            tradingState.assets[0].price = last.close
            if (prev && prev.close) tradingState.assets[0].changePct = ((last.close - prev.close) / prev.close) * 100
          }
          // If no assets found at all, create one from the server response
          if (!tradingState.assets.length && last) {
            tradingState.assets.push({
              id: primaryAsset,
              name: primaryAsset,
              price: last.close,
              changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : 0,
              change: prev ? last.close - prev.close : 0
            })
          }
        }
        // Advanced analytics
        if (resp.kelly) tradingState.kelly = resp.kelly
        if (resp.regime) tradingState.regime = resp.regime
        if (resp.expiry) tradingState.expiry = resp.expiry
        if (resp.sentiment) tradingState.sentiment = resp.sentiment
        if (resp.orderFlow) tradingState.orderFlow = resp.orderFlow
      } else {
        // Consolidated endpoint failed — fallback to individual endpoints
        const [status, autopilot, demo, decisions] = await Promise.allSettled([
          serverFetch("/api/trading/status"),
          serverFetch("/api/trading/autopilot"),
          serverFetch("/api/trading/demo"),
          serverFetch("/api/trading/decisions")
        ])
        const statusVal = status.status === "fulfilled" ? status.value : null
        const autopilotVal = autopilot.status === "fulfilled" ? autopilot.value : null
        const demoVal = demo.status === "fulfilled" ? demo.value : null
        const decisionsVal = decisions.status === "fulfilled" ? decisions.value : null
        if (statusVal?.ok) {
          tradingState.paper = statusVal.paper || null
          if (statusVal.expertOption) {
            tradingState.account = {
              balance: statusVal.expertOption.balance ?? tradingState.account?.balance ?? null,
              currency: statusVal.expertOption.currency || "USD",
              demo: statusVal.expertOption.demo
            }
          }
        }
        if (autopilotVal?.ok) tradingState.autopilot = autopilotVal.config || autopilotVal
        if (demoVal?.ok) tradingState.demo = demoVal
        if (decisionsVal?.ok && decisionsVal.decisions) tradingState.decisions = decisionsVal.decisions

        // Fetch candles + advanced analytics individually
        const candleResp = await serverFetch("/api/trading/candles", { method: "POST", body: { assetId: primaryAsset, timeframe: 60, count: 100 } })
        if (candleResp?.ok && candleResp.candles?.length) {
          tradingState.lastCandles = candleResp.candles
          const last = candleResp.candles[candleResp.candles.length - 1]
          const prev = candleResp.candles[candleResp.candles.length - 2]
          if (tradingState.assets[0] && !tradingState.assets[0].price) {
            tradingState.assets[0].price = last.close
            if (prev && prev.close) tradingState.assets[0].changePct = ((last.close - prev.close) / prev.close) * 100
          }
        }
        const [kelly, regime, expiry, sentiment, orderFlow] = await Promise.allSettled([
          serverFetch("/api/trading/kelly"),
          serverFetch("/api/trading/regime", { method: "POST", body: { candles: tradingState.lastCandles } }),
          serverFetch("/api/trading/expiry", { method: "POST", body: { candles: tradingState.lastCandles } }),
          serverFetch("/api/trading/sentiment", { method: "POST", body: { symbol: primaryAsset } }),
          serverFetch("/api/trading/orderflow", { method: "POST", body: { candles: tradingState.lastCandles } }),
        ])
        for (const [key, val] of [["kelly", kelly], ["regime", regime], ["expiry", expiry], ["sentiment", sentiment], ["orderFlow", orderFlow]]) {
          const v = val.status === "fulfilled" ? val.value : null
          if (v?.ok) tradingState[key] = v
        }
      }
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
      "page-overview": renderPageOverview,
      "page-content": renderPageContent,
      "server-status": renderServerStatus,
      "speed": renderPageOverview,
      "connectors": renderServerStatus,
      "tracker": renderPageOverview,
      "optimizer": renderServerStatus,
      "analytics": renderPageOverview,
      "scheduler": renderServerStatus,
      "yield": renderPageOverview,
      "gas": renderServerStatus,
      "general": renderPageOverview,
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
    fetchTradingData().then(updateAllDockables).catch(() => {})
    tradingPollTimer = setInterval(() => { fetchTradingData().then(updateAllDockables).catch(() => {}) }, 5000)
  }

  function stopTradingPoll() {
    if (tradingPollTimer) { clearInterval(tradingPollTimer); tradingPollTimer = null }
  }

  // ── Create dockables with live-rendered content ────────────────────────────
  function createTradingDockables(siteInfo) {
    const presets = SUITE_DOCKABLE_PRESETS.trading
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

  // ── Generic suite dockables (work on ANY site) ─────────────────────────────
  function createGenericDockables(siteInfo) {
    const isUnrecognized = !siteInfo?.suite
    // For unrecognized sites, use enhanced generic presets
    const genericPresets = isUnrecognized ? [
      { id: "page-overview", title: "Page Overview", icon: "📊", description: "Page metrics, detected prices, and content", defaultPos: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
      { id: "page-content", title: "Page Content", icon: "📝", description: "Headings, links, and page structure", defaultPos: "right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
      { id: "server-status", title: "PICC Status", icon: "🧠", description: "Server connection and live data feed", defaultPos: "bottom-right", defaultSize: { width: 260, height: 160 }, defaultCollapsed: false },
    ] : (SUITE_DOCKABLE_PRESETS[siteInfo?.suite] || SUITE_DOCKABLE_PRESETS.generic)
    return genericPresets.map((preset) => {
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
          meta.textContent = `${d.defaultSize.width}×${d.defaultSize.height} · ${d.defaultPos}`
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
      // Save current config on close so defaults persist for next open
      if (siteInfo?.id) savePrefsForSite(siteInfo.id, { overlay: false, overlaySettings: currentSettings })
      el.remove()
      activeDockables.forEach((d) => { const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`); if (dockEl) dockEl.remove() })
      cleanupGroups()
      activeDockables = []
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

    // Start polling for all suites (not just trading)
    startTradingPoll()

    activeDockables = docks.map((d) => {
      const rawId = d.id || ""
      return { id: rawId.replace(/^__PICC_DOCK_/, "").replace(/__$/, "") }
    })

    // Apply saved settings to dockable visibility/opacity on creation
    applySettings(currentSettings)

    return el
  }

  // ── Toggle overlay ──────────────────────────────────────────────────────────
  async function toggleOverlay() {
    if (overlayVisible) {
      stopTradingPoll()
      const el = shadowRoot.getElementById(OVERLAY_ID)
      if (el) el.remove()
      activeDockables.forEach((d) => { const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`); if (dockEl) dockEl.remove() })
      cleanupGroups()
      activeDockables = []
      overlayVisible = false
      return
    }

    const siteInfo = detectSite(window.location.href)
    let overlaySettings = {}
    if (siteInfo?.id) {
      const prefs = await getPrefs()
      const sitePrefs = prefs[siteInfo.id]
      // Re-enable overlay if it was disabled
      if (sitePrefs?.overlay === false) {
        await savePrefsForSite(siteInfo.id, { overlay: true })
      }
      // Load saved site-specific settings; otherwise use suite defaults
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
        const path = running ? "/api/trading/autopilot/stop" : "/api/trading/autopilot/start"
        const result = await serverFetch(path, { method: "POST", body: { reason: "user" } })
        if (result?.ok) {
          await fetchTradingData()
          updateAllDockables()
        }
      } catch { /* ignore */ }
      btn.disabled = false
    }
    if (action === "autopilot-kill") {
      btn.disabled = true
      try {
        const result = await serverFetch("/api/trading/autopilot/stop", { method: "POST", body: { reason: "emergency-kill-switch" } })
        if (result?.ok) {
          await fetchTradingData()
          updateAllDockables()
          playAlertSound("danger")
          showToast("Kill Switch", "Emergency stop executed. All autopilot activity halted.", "error")
        } else {
          showToast("Kill Switch", "Failed to stop autopilot — server unreachable or auth required.", "error")
        }
      } catch { /* ignore */ }
      btn.disabled = false
    }
  })

  // ── Message listener from background/popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "toggle-overlay") { toggleOverlay(); return false }
    if (msg.action === "get-metrics") { sendResponse(collectPageMetrics()); return false }
    if (msg.action === "server-status") {
      serverOnline = msg.online
      serverPort = msg.port || null
      updateServerStatus()
      return false
    }
    if (msg.action === "show-notification") {
      if (msg.type === "error" || msg.type === "danger") playAlertSound("danger")
      else if (msg.type === "success") playAlertSound("success")
      else playAlertSound("info")
      showToast(msg.title, msg.message, msg.type)
      return false
    }
    if (msg.action === "extract-content") { sendResponse(extractPageContent(msg.selectors)); return false }
    if (msg.action === "detect-forms") { sendResponse(detectForms()); return false }
    if (msg.action === "read-storage") { sendResponse(readWebStorage()); return false }
    if (msg.action === "fill-field") { sendResponse(fillField(msg.selector, msg.value)); return false }
    if (msg.action === "click-element") { sendResponse(clickElement(msg.selector)); return false }
    if (msg.action === "navigate") { sendResponse(navigateTo(msg.url)); return false }
  })

  // ── Server check on load ────────────────────────────────────────────────────
  // Initial check via background. Periodic updates come from background alarms
  // pushing "server-status" messages to this content script.
  checkServer()
})()
