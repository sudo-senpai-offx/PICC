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

  // ── MV3 state persistence (chrome.storage.local) ──
  // Saves overlay state so it survives service worker restarts and loads instantly.
  const MV3_STATE_KEY = "piccOverlayState"
  let mv3SaveTimer = null

  function saveOverlayStateLocal() {
    clearTimeout(mv3SaveTimer)
    mv3SaveTimer = setTimeout(() => {
      try {
        const layout = {}
        for (const d of activeDockables) {
          layout[d.id] = {
            position: dockablePositions[d.id] || null,
            size: dockableSizes[d.id] || null,
            opacity: dockableOpacities[d.id] ?? null
          }
        }
        const state = {
          settings: currentSettings,
          layout,
          groups: dockGroups,
          siteId: currentSite?.id || null,
          siteSuite: currentSite?.suite || null,
          timestamp: Date.now()
        }
        chrome.storage.local.set({ [MV3_STATE_KEY]: state })
      } catch { /* storage quota or context destroyed */ }
    }, 300)
  }

  function loadOverlayStateLocal() {
    // Read from chrome.storage.local — the writer (saveOverlayStateLocal)
    // stores under chrome.storage, not localStorage. The old localStorage read
    // always returned null, silently discarding saved state.
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(MV3_STATE_KEY, (data) => resolve(data[MV3_STATE_KEY] || null))
      } catch { resolve(null) }
    })
  }

  // ── Dock grouping state ──
  const dockGroups = {} // groupId → [dockId, dockId, ...]
  const dockGroupMap = {} // dockId → groupId
  const groupActiveTab = {} // groupId → currently visible dockId

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
    saveOverlayStateLocal()
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
    // Position at the first member's position (clamped to the viewport)
    const firstDock = shadowRoot.getElementById(`__PICC_DOCK_${members[0]}__`)
    const firstPosRaw = dockablePositions[members[0]] || { x: 16, y: 16 }
    const firstSize = dockableSizes[members[0]] || { width: 280, height: 200 }
    const firstPos = clampToViewport(firstPosRaw.x, firstPosRaw.y, firstSize.width, Math.min(firstSize.height, window.innerHeight - 2 * DOCK_MARGIN))
    gc.style.cssText = `position:fixed;top:${firstPos.y}px;left:${firstPos.x}px;width:${firstSize.width}px;max-height:${firstSize.height}px;overflow:auto;z-index:2147483646;` +
      `background:rgba(20,20,48,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#eef0ff;` +
      `border:1px solid rgba(108,99,255,0.4);border-radius:8px;font:12px/1.4 system-ui,sans-serif;` +
      `box-shadow:0 4px 16px rgba(0,0,0,.3);transition:max-height .2s ease;user-select:none;pointer-events:auto;`
    gc.style.opacity = String(dockableOpacities[members[0]] ?? currentSettings.opacity)

    // Tab bar
    const tabBar = document.createElement("div")
    tabBar.style.cssText = "display:flex;align-items:center;background:rgba(26,26,46,0.6);border-bottom:1px solid rgba(42,42,74,0.4);overflow-x:auto;user-select:none;"
    let activeTab = members[0]
    groupActiveTab[groupId] = activeTab
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
        groupActiveTab[groupId] = dId
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
              const raw = { x: ev.clientX - 40, y: ev.clientY - 18 }
              const clamped = clampToViewport(raw.x, raw.y, el.offsetWidth || 260, el.offsetHeight || 120)
              applyDockXY(el, clamped.x, clamped.y)
              dockablePositions[dId] = { x: clamped.x, y: clamped.y }
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

    // Make group draggable via tab bar (viewport-clamped + focus)
    let gDrag = false, gsx = 0, gsy = 0
    tabBar.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.closest("[data-picc-group-body]")) return
      bringToFront(gc)
      gDrag = true; gsx = e.clientX; gsy = e.clientY
      const rect = gc.getBoundingClientRect()
      gc.style.transition = "none"
      const onMove = (ev) => {
        if (!gDrag) return
        const clamped = clampToViewport(rect.left + ev.clientX - gsx, rect.top + ev.clientY - gsy, gc.offsetWidth, gc.offsetHeight)
        applyDockXY(gc, clamped.x, clamped.y)
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
        bringToFront(gc)
        rsx = e.clientX; rsy = e.clientY
        rw = gc.offsetWidth; rh = gc.offsetHeight
        gc.style.transition = "none"
        const onMove = (ev) => {
          if (!isResizing) return
          // Stay inside the viewport while growing.
          const left = gc.getBoundingClientRect().left
          const top = gc.getBoundingClientRect().top
          const maxW = Math.max(200, window.innerWidth - left - DOCK_MARGIN)
          const maxH = Math.max(100, window.innerHeight - top - DOCK_MARGIN)
          if (isH || isD) gc.style.width = Math.min(Math.max(200, rw + ev.clientX - rsx), maxW) + "px"
          if (isV || isD) gc.style.maxHeight = Math.min(Math.max(100, rh + ev.clientY - rsy), maxH) + "px"
        }
        const onUp = () => {
          isResizing = false
          gc.style.transition = ""
          document.removeEventListener("mousemove", onMove)
          document.removeEventListener("mouseup", onUp)
          clampDockEl(gc)
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
      // Clamp restored positions against the CURRENT viewport — a layout
      // saved on a 4K monitor must not land off-screen on a laptop.
      const w = layout.size?.width ?? dockEl.offsetWidth ?? 280
      const h = layout.size?.height ?? dockEl.offsetHeight ?? 200
      const { x, y } = clampToViewport(layout.position.x, layout.position.y, w, h)
      applyDockXY(dockEl, x, y)
      dockablePositions[id] = { x, y }
    }
    if (layout.size) {
      const maxW = Math.max(200, window.innerWidth - 2 * DOCK_MARGIN)
      const maxH = Math.max(100, window.innerHeight - 2 * DOCK_MARGIN)
      const size = { width: Math.min(layout.size.width, maxW), height: Math.min(layout.size.height, maxH) }
      dockEl.style.width = size.width + "px"
      dockEl.style.maxHeight = size.height + "px"
      dockableSizes[id] = size
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
    Object.keys(groupActiveTab).forEach((k) => delete groupActiveTab[k])
  }

  // Default dockable presets per suite type
  const SUITE_DOCKABLE_PRESETS = {
    trading: [
      { id: "price-ticker", title: "Price Ticker", icon: "📈", description: "Real-time asset prices with percentage change", defaultPos: "top-right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
      { id: "positions", title: "Positions", icon: "💹", description: "Active trades across all asset pairs with live PnL", defaultPos: "top-right", defaultSize: { width: 280, height: 220 }, defaultCollapsed: false },
      { id: "ai-signals", title: "AI Signals", icon: "🧠", description: "Live confluence decisions with verdict badges", defaultPos: "right", defaultSize: { width: 260, height: 260 }, defaultCollapsed: false },
      { id: "autopilot", title: "Autopilot", icon: "🤖", description: "Start/stop autopilot, status, today PnL", defaultPos: "bottom-left", defaultSize: { width: 260, height: 180 }, defaultCollapsed: false },
      { id: "portfolio", title: "Portfolio", icon: "📊", description: "Paper trading balance, PnL, and win rate", defaultPos: "top-left", defaultSize: { width: 300, height: 180 }, defaultCollapsed: true },
      { id: "risk-mgr", title: "Risk Manager", icon: "⚠️", description: "Daily loss limit, concurrent trades, cooldown", defaultPos: "bottom-right", defaultSize: { width: 280, height: 140 }, defaultCollapsed: true },
      { id: "kelly-sizing", title: "Kelly Sizing", icon: "🎯", description: "Kelly criterion sizing with suggested positions", defaultPos: "left", defaultSize: { width: 260, height: 180 }, defaultCollapsed: true },
      { id: "regime-detect", title: "Regime Detection", icon: "📡", description: "Market regime: trending, ranging, volatile, breakout", defaultPos: "top-left", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
      { id: "order-flow", title: "Order Flow", icon: "🌊", description: "Cumulative delta, imbalance, and divergence signals", defaultPos: "bottom-left", defaultSize: { width: 280, height: 200 }, defaultCollapsed: true },
      { id: "expiry-opt", title: "Expiry Optimizer", icon: "⏱️", description: "Optimal expiry selection with volatility analysis", defaultPos: "right", defaultSize: { width: 260, height: 200 }, defaultCollapsed: true },
      { id: "sentiment", title: "Sentiment", icon: "🎭", description: "News + social sentiment fusion with extremes", defaultPos: "top-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
      { id: "calibration", title: "Calibration", icon: "📐", description: "Predicted vs realized win rate per confidence bucket, breakeven line", defaultPos: "left", defaultSize: { width: 280, height: 220 }, defaultCollapsed: true },
      { id: "entry-points", title: "Buy/Sell Points", icon: "🎯", description: "Ideal buy/sell zones with live mini-chart, hover crosshair and one-click simulation", defaultPos: "left", defaultSize: { width: 280, height: 300 }, defaultCollapsed: false },
      { id: "model-matrix", title: "Model Matrix", icon: "🧬", description: "Multiplexing multi-model consensus with adaptive weights, per active asset", defaultPos: "right", defaultSize: { width: 270, height: 280 }, defaultCollapsed: true },
      { id: "server-status", title: "PICC Status", icon: "🔌", description: "Server connection health and data pipeline status", defaultPos: "bottom-right", defaultSize: { width: 260, height: 160 }, defaultCollapsed: true },
      { id: "data-sources", title: "Data Sources", icon: "🩺", description: "Honesty status of every feed: live, local, stale, unconfigured", defaultPos: "right", defaultSize: { width: 280, height: 260 }, defaultCollapsed: true },
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
      features: { assistance: true, decisionSupport: true, automation: true, autopilot: true, analysis: true, ai: true },
      dockableLayout: {},
      positions: []
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
  const shadowRoot = shadowHost.attachShadow({ mode: "closed" })
  // Prevent host styles from leaking into shadow DOM
  const hostStyle = document.createElement("style")
  hostStyle.textContent = ":host{all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;}"
  shadowRoot.appendChild(hostStyle)

  // ── Site detection ──────────────────────────────────────────────────────────
  const SITE_PROFILES = [
    // Trading. platformKind drives feature gating: only binary/fixed-time
    // platforms ("binary") get the autopilot/automation features — the
    // server-side autopilot loop is ExpertOption-demo-only, so showing live
    // autopilot controls on a spot/equity broker would imply capability
    // that does not exist.
    { hosts: ["expertoption.com", "expert-option.com", "expertoption.finance", "app.expertoption.finance", "app.expertoption.com"], id: "expertoption", label: "ExpertOption", category: "trading", suite: "trading", platformKind: "binary" },
    { hosts: ["binance.com"], id: "binance", label: "Binance", category: "trading", suite: "trading", platformKind: "spot" },
    { hosts: ["coinbase.com"], id: "coinbase", label: "Coinbase", category: "trading", suite: "trading", platformKind: "spot" },
    { hosts: ["kraken.com"], id: "kraken", label: "Kraken", category: "trading", suite: "trading", platformKind: "spot" },
    { hosts: ["robinhood.com"], id: "robinhood", label: "Robinhood", category: "trading", suite: "trading", platformKind: "equity" },
    { hosts: ["tastytrade.com"], id: "tastytrade", label: "Tastytrade", category: "trading", suite: "trading", platformKind: "equity" },
    { hosts: ["webull.com"], id: "webull", label: "Webull", category: "trading", suite: "trading", platformKind: "equity" },
    { hosts: ["etoro.com"], id: "etoro", label: "eToro", category: "trading", suite: "trading", platformKind: "spot" },
    { hosts: ["tradingview.com"], id: "tradingview", label: "TradingView", category: "trading", suite: "trading", platformKind: "charts" },
    { hosts: ["mt4.metaquotes.net", "mt5.metaquotes.net"], id: "metatrader", label: "MetaTrader", category: "trading", suite: "trading", platformKind: "spot" },
    { hosts: ["deriv.com"], id: "deriv", label: "Deriv", category: "trading", suite: "trading", platformKind: "binary" },
    { hosts: ["olymptrade.com"], id: "olymptrade", label: "OlympTrade", category: "trading", suite: "trading", platformKind: "binary" },
    { hosts: ["quotex.com"], id: "quotex", label: "Quotex", category: "trading", suite: "trading", platformKind: "binary" },
    { hosts: ["iqoption.com"], id: "iqoption", label: "IQ Option", category: "trading", suite: "trading", platformKind: "binary" },
    { hosts: ["nadex.com"], id: "nadex", label: "Nadex", category: "trading", suite: "trading", platformKind: "binary" },
    // Bandwidth
    { hosts: ["speedtest.net"], id: "speedtest", label: "Speedtest", category: "bandwidth", suite: "bandwidth" },
    { hosts: ["fast.com"], id: "fast", label: "Fast.com", category: "bandwidth", suite: "bandwidth" },
    { hosts: ["ipinfo.io", "ip.me", "whatismyip.com"], id: "ipinfo", label: "IP Info", category: "bandwidth", suite: "bandwidth" },
    // Dividends / Interest
    { hosts: ["schwab.com"], id: "schwab", label: "Schwab", category: "dividend", suite: "dividend" },
    { hosts: ["fidelity.com"], id: "fidelity", label: "Fidelity", category: "dividend", suite: "dividend" },
    { hosts: ["vanguard.com"], id: "vanguard", label: "Vanguard", category: "dividend", suite: "dividend" },
    // Affiliate
    { hosts: ["amazon.com"], id: "amazon", label: "Amazon", category: "affiliate", suite: "affiliate" },
    { hosts: ["shopee.com", "shopee.*"], id: "shopee", label: "Shopee", category: "affiliate", suite: "affiliate" },
    { hosts: ["lazada.com"], id: "lazada", label: "Lazada", category: "affiliate", suite: "affiliate" },
    // Content
    { hosts: ["youtube.com"], id: "youtube", label: "YouTube", category: "content", suite: "content" },
    { hosts: ["tiktok.com"], id: "tiktok", label: "TikTok", category: "content", suite: "content" },
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
    { hosts: ["google.com", "accounts.google.com"], id: "google", label: "Google", category: "other", suite: null },
    { hosts: ["github.com"], id: "github", label: "GitHub", category: "other", suite: null },
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
      if (opts?.signal?.aborted) return { ok: false, error: "aborted", data: null }
      const send = () => chrome.runtime.sendMessage({
        type: "picc-server-fetch",
        path,
        method: opts?.method || "GET",
        body: opts?.body || null,
        timeout: opts?.timeout || 20000
      })
      const resp = opts?.signal
        ? await Promise.race([
            send(),
            new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(new Error("picc-abort")), { once: true }))
          ])
        : await send()
      if (!resp || !resp.ok) {
        return { ok: false, error: resp?.error || resp?.data?.error || resp?.status || "unknown", data: null }
      }
      return { ok: true, data: resp.data, status: resp.status }
    } catch (err) {
      return { ok: false, error: err?.message === "picc-abort" ? "aborted" : "extension-context-invalidated", data: null }
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
    const resp = await serverFetch("/api/browser/prefs")
    return resp.ok ? (resp.data?.prefs || {}) : {}
  }

  async function savePrefsForSite(siteId, prefs) {
    if (!siteId) return null
    const resp = await serverFetch("/api/browser/prefs", { method: "POST", body: { site: siteId, prefs: prefs || {} } })
    return resp.ok ? resp.data : null
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

  // ── Viewport containment + stacking ──────────────────────────────────────
  // Dockables are position:fixed overlays: they must NEVER extend past the
  // live browser viewport, no matter what a restored layout says, how far the
  // user drags, how big they resize, or how narrow the window gets.
  const DOCK_MARGIN = 2 // keep at least this much of the panel on-screen
  let dockZTop = 2147483000 // stacking allocator (< shadow host's own z-index)
  const Z_CEILING = 2147483620

  /** Clamp an (x, y) position for a w×h element inside the viewport. */
  function clampToViewport(x, y, w, h) {
    const vw = Math.max(60, window.innerWidth)
    const vh = Math.max(60, window.innerHeight)
    const maxX = Math.max(DOCK_MARGIN, vw - w - DOCK_MARGIN)
    const maxY = Math.max(DOCK_MARGIN, vh - h - DOCK_MARGIN)
    return {
      x: Math.min(Math.max(DOCK_MARGIN, x), maxX),
      y: Math.min(Math.max(DOCK_MARGIN, y), maxY)
    }
  }

  /** Write explicit left/top coords (clearing any CSS anchor sides). */
  function applyDockXY(el, x, y) {
    el.style.left = x + "px"
    el.style.top = y + "px"
    el.style.right = "auto"
    el.style.bottom = "auto"
    el.style.transform = "none" // clear translateY(-50%) anchors
  }

  /** Clamp an already-placed fixed element into the viewport. Returns true when it moved. */
  function clampDockEl(el) {
    if (!el || !el.isConnected) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    const { x, y } = clampToViewport(r.left, r.top, r.width, r.height)
    const moved = Math.round(r.left) !== x || Math.round(r.top) !== y
    if (moved) applyDockXY(el, x, y)
    return moved
  }

  /** Bring a floating panel above its siblings. */
  function bringToFront(el) {
    if (!el) return
    if (dockZTop >= Z_CEILING) {
      // Recycle: flatten everyone back to base, then hand out fresh slots.
      dockZTop = 2147483000
      for (const d of shadowRoot.querySelectorAll("[data-picc-dock], [data-picc-group]")) {
        d.style.zIndex = String(2147483000)
      }
    }
    dockZTop += 1
    el.style.zIndex = String(dockZTop)
  }

  /** Re-clamp every visible panel (viewport shrink / rotation / zoom). */
  function reclampAllDockables() {
    for (const el of shadowRoot.querySelectorAll("[data-picc-dock], [data-picc-group]")) {
      if (el.style.display === "none") continue
      clampDockEl(el)
    }
  }

  let reclampTimer = null
  window.addEventListener("resize", () => {
    clearTimeout(reclampTimer)
    reclampTimer = setTimeout(reclampAllDockables, 120)
  })

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
      if (c) {
        // Expanded panel must fit the live viewport: cap width, then re-clamp
        // the whole rect (it may have been restored near an edge while collapsed).
        const maxW = Math.max(200, window.innerWidth - 2 * DOCK_MARGIN)
        if (width > maxW) dock.style.width = maxW + "px"
        requestAnimationFrame(() => clampDockEl(dock))
      }
    })

    const closeBtn = document.createElement("button")
    closeBtn.textContent = "\u2715"
    closeBtn.title = "Remove dockable"
    closeBtn.style.cssText = "background:none;border:none;color:#a5a0ff;cursor:pointer;font-size:10px;padding:1px 4px;border-radius:3px;opacity:.6;"
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      activeDockables = activeDockables.filter((d) => d.id !== id)
      if (dockGroupMap[id]) ungroupDock(id)
      dock.remove()
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

      titleBar.addEventListener("dblclick", (e) => {
        if (e.target.closest("[data-picc-action]")) return
        e.preventDefault()
        toggleBtn.click()
      })

      titleBar.addEventListener("mousedown", (e) => {
        if (e.target.closest("[data-picc-action]")) return
        e.preventDefault()
        isDragging = true
        bringToFront(dock)
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
          // Edge docking (snap near borders), then HARD viewport clamp — the
          // panel can never leave the live viewport even on tiny windows.
          if (nx < DOCK_THRESHOLD) nx = EDGE_OFFSET
          if (ny < DOCK_THRESHOLD) ny = EDGE_OFFSET
          if (nx + dock.offsetWidth > window.innerWidth - DOCK_THRESHOLD) nx = window.innerWidth - dock.offsetWidth - EDGE_OFFSET
          if (ny + dock.offsetHeight > window.innerHeight - DOCK_THRESHOLD) ny = window.innerHeight - dock.offsetHeight - EDGE_OFFSET
          const clamped = clampToViewport(nx, ny, dock.offsetWidth, dock.offsetHeight)
          applyDockXY(dock, clamped.x, clamped.y)
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
        bringToFront(dock)
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
        const clamped = clampToViewport(nx, ny, dock.offsetWidth, dock.offsetHeight)
        applyDockXY(dock, clamped.x, clamped.y)
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
          bringToFront(dock)
          rsx = e.clientX; rsy = e.clientY
          rw = dock.offsetWidth; rh = dock.offsetHeight
          dock.style.transition = "none"
          const onMove = (ev) => {
            if (!isResizing) return
            // Never grow past the viewport edge — the rect must stay on-screen.
            const left = dock.getBoundingClientRect().left
            const top = dock.getBoundingClientRect().top
            const maxW = Math.max(200, window.innerWidth - left - DOCK_MARGIN)
            const maxH = Math.max(100, window.innerHeight - top - DOCK_MARGIN)
            if (isH || isD) dock.style.width = Math.min(Math.max(200, rw + ev.clientX - rsx), maxW) + "px"
            if (isV || isD) dock.style.maxHeight = Math.min(Math.max(100, rh + ev.clientY - rsy), maxH) + "px"
          }
          const onUp = () => {
            isResizing = false
            dock.style.transition = ""
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            clampDockEl(dock)
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
    activeAsset: "",
    openDeals: [],
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
    calibration: null,
    calibrationFetchedAt: 0,
    entryLevels: null,
    entryHoverPrice: null,
    models: null,
    calendar: null,
    calendarFetchedAt: 0,
    lastCandles: [],
    lastFetchError: null,
    lastFetchAt: 0,
    loadingSince: Date.now(),
    serverReachable: null,
    sources: null,
    sourcesFetchedAt: 0,
    upstream: { framesSeen: 0, framesPushed: 0, lastFrameAt: 0, lastPushAt: 0, lastPushError: null }
  }

  // ── Upstream bridge: page WS frames → server ────────────────────────────────
  // inject.js (MAIN world) sniffs the broker gateway's WebSocket and relays
  // frames here via window.postMessage. We batch them and push to the server,
  // which folds them into the same candle buffers the studio bridge feeds.
  const UPSTREAM_QUEUE = []
  let upstreamTimer = null
  let upstreamFlushInFlight = false
  const UPSTREAM_FLUSH_MS = 2000
  const UPSTREAM_MAX_BATCH = 120

  /**
   * Shape-validate a relayed frame BEFORE queueing: any page script can forge
   * window messages, so treat them as hostile input. Only broker-shaped
   * candle/profile/error frames pass; string fields are length-capped and
   * serialized size is bounded.
   */
  function sanitizeUpstreamFrame(frame) {
    try {
      if (!frame || typeof frame !== "object" || typeof frame.action !== "string") return null
      if (frame.action.length > 40) return null
      const msg = frame.message
      let clean = { action: frame.action }
      if (msg != null) {
        if (typeof msg !== "object") return null
        clean.message = {}
        if (msg.assetId != null) clean.message.assetId = String(msg.assetId).slice(0, 32)
        if (msg.name != null) clean.message.name = String(msg.name).slice(0, 64)
        if (Array.isArray(msg.candles)) {
          // Keep only structurally valid rows, cap the count.
          clean.message.candles = msg.candles.slice(0, 64)
            .filter((c) => c && typeof c === "object" && Array.isArray(c.v))
            .map((c) => ({ t: Number(c.t) || 0, tf: Number(c.tf) || 0, v: c.v.slice(0, 8).map(Number) }))
        }
      }
      if (JSON.stringify(clean).length > 4096) return null
      return clean
    } catch {
      return null
    }
  }

  function queueUpstreamFrame(frame) {
    const clean = sanitizeUpstreamFrame(frame)
    if (!clean) return
    tradingState.upstream.framesSeen += 1
    tradingState.upstream.lastFrameAt = Date.now()
    UPSTREAM_QUEUE.push(clean)
    while (UPSTREAM_QUEUE.length > 400) UPSTREAM_QUEUE.shift()
    if (!upstreamTimer) upstreamTimer = setTimeout(flushUpstream, UPSTREAM_FLUSH_MS)
  }

  async function flushUpstream() {
    upstreamTimer = null
    if (upstreamFlushInFlight) return
    if (!UPSTREAM_QUEUE.length) return
    if (!serverPort) {
      // Server not discovered yet — retry on the normal cadence.
      upstreamTimer = setTimeout(flushUpstream, UPSTREAM_FLUSH_MS)
      return
    }
    upstreamFlushInFlight = true
    const batch = UPSTREAM_QUEUE.splice(0, UPSTREAM_MAX_BATCH)
    try {
      const resp = await serverFetch("/api/extension/ingest", {
        method: "POST",
        body: { frames: batch },
        timeout: 8000
      })
      if (resp?.ok) {
        tradingState.upstream.framesPushed += batch.length
        tradingState.upstream.lastPushAt = Date.now()
        tradingState.upstream.lastPushError = null
      } else if (resp?.error === "aborted") {
        requeueUpstream(batch)
      } else {
        tradingState.upstream.lastPushError = resp?.error || "ingest-failed"
      }
    } catch (err) {
      tradingState.upstream.lastPushError = String(err?.message ?? err).slice(0, 120)
      requeueUpstream(batch)
    } finally {
      upstreamFlushInFlight = false
      if (UPSTREAM_QUEUE.length && !upstreamTimer) upstreamTimer = setTimeout(flushUpstream, UPSTREAM_FLUSH_MS)
    }
  }

  /** Re-queue failed batches at the HEAD (preserve order), re-trimming the cap. */
  function requeueUpstream(batch) {
    UPSTREAM_QUEUE.unshift(...batch.slice(-400))
    while (UPSTREAM_QUEUE.length > 400) UPSTREAM_QUEUE.shift()
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return
    const d = ev.data
    if (!d || !d.__piccEOFrame || !d.frame) return
    queueUpstreamFrame(d.frame)
  })

  const CURRENCY_SYMBOLS = { USD: "$", EUR: "\u20AC", GBP: "\u00A3", JPY: "\u00A5", CNY: "\u00A5", KRW: "\u20A9", INR: "\u20B9", BRL: "R$", RUB: "\u20BD", AUD: "A$", CAD: "C$", CHF: "CHF ", NGN: "\u20A6", PHP: "\u20B1", THB: "\u0E3F", VND: "\u20AB", MYR: "RM", IDR: "Rp" }
  // HTML-escape everything dynamic that reaches innerHTML. Values rendered by
  // the overlay come from PAGE DOM scrapes and SERVER responses — both are
  // hostile channels into an extension-context sink.
  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c])
  }
  /** Finite-number guard for .toFixed() chains — a string field used to abort
   * the whole renderer loop, freezing every dockable after the bad one. */
  function num(v, digits) {
    const n = Number(v)
    return Number.isFinite(n) ? n.toFixed(digits) : "\u2014"
  }
  function fmt$(n, currency) {
    if (n == null || !isFinite(n)) return "\u2014"
    const sym = CURRENCY_SYMBOLS[(currency || "USD").toUpperCase()] || (esc(currency || "$") + " ")
    return sym + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  function tone(val, pos, neg) {
    if (val > 0) return pos || "#4ade80"
    if (val < 0) return neg || "#ff6b6b"
    return "#a5a0ff"
  }

  // ── Breakeven indicator (Phase 11) ─────────────────────────────────────────
  // Minimum win rate a payout schedule demands: 1 / (1 + payout/100).
  // Green = confidence clears the breakeven line, amber = near it, red = below.
  function breakevenWinRate(payoutPct) {
    const p = Number(payoutPct)
    if (!isFinite(p) || p <= 0) return null
    return 100 / (100 + p)
  }
  function breakevenTone(diffPts) {
    if (!isFinite(diffPts)) return "#a5a0ff"
    if (diffPts > 3) return "#4ade80"
    if (diffPts >= -3) return "#f59e0b"
    return "#ff6b6b"
  }
  function breakevenBadge(confidencePct, payoutPct) {
    const be = breakevenWinRate(payoutPct)
    const conf = Number(confidencePct)
    if (be == null || !isFinite(conf)) return ""
    const diff = conf - be
    const color = breakevenTone(diff)
    return `<span style="font-size:9px;color:${color}">vs ${be.toFixed(1)}% breakeven @ ${payoutPct}% payout</span>`
  }

  // ── Offline / staleness / timeout helpers ──
  const OFFLINE_TIMEOUT_MS = 10000
  function isTimedOut() {
    return tradingState.loadingSince > 0 && Date.now() - tradingState.loadingSince > OFFLINE_TIMEOUT_MS
  }
  function offlineBanner() {
    return '<div style="background:#ff6b6b12;border:1px solid #ff6b6b40;border-radius:4px;padding:6px 8px;margin-bottom:4px;font-size:10px;color:#ff6b6b">' +
      '<span style="font-weight:600">Server offline</span> — can\'t reach PICC backend.' +
      '<div style="margin-top:3px;color:#9aa0c0">Run: <code style="color:#6c63ff;background:#0d0d1a;padding:1px 3px;border-radius:2px">npm run dev</code></div>' +
      '</div>'
  }
  function staleLabel() {
    if (!tradingState.lastFetchAt) return ""
    const ago = Math.round((Date.now() - tradingState.lastFetchAt) / 1000)
    if (ago < 5) return ""
    const color = ago > 60 ? "#ff6b6b" : ago > 30 ? "#f59e0b" : "#9aa0c0"
    const badge = ago > 30
      ? `<span style="font-weight:700;color:${color};background:${color}22;border:1px solid ${color}55;border-radius:3px;padding:0 4px;margin-left:4px">\u25cf STALE</span>`
      : ""
    return `<div style="font-size:9px;color:${color};margin-top:2px">Last update ${ago}s ago${badge}</div>`
  }
  function sourceLabel(text) {
    return `<div style="font-size:9px;color:#9aa0c0;margin-top:2px">source: ${text}</div>`
  }

  // Normalize a scraped asset name for server API calls and Yahoo Finance.
  // Mirrors server/services/assetCatalog.mjs — client and server MUST agree
  // on canonical ids, or active-asset detection silently fails for anything
  // beyond plain forex pairs (commodities, crypto full names, indices...).
  const ASSET_ALIAS_MAP = {
    // metals
    GOLD: "GOLD", XAUUSD: "GOLD", XAU: "GOLD", GOLDUSD: "GOLD",
    SILVER: "SILVER", XAGUSD: "SILVER", XAG: "SILVER",
    PLATINUM: "PLATINUM", XPTUSD: "PLATINUM",
    PALLADIUM: "PALLADIUM", XPDUSD: "PALLADIUM",
    COPPER: "COPPER",
    // energies
    OIL: "OIL", WTI: "OIL", WTIUSD: "OIL", USOIL: "OIL", CRUDE: "OIL", CRUDEOIL: "OIL",
    BRENT: "BRENT", UKOIL: "BRENT",
    NATGAS: "NATGAS", NATURALGAS: "NATGAS",
    // indices
    US30: "US30", DOW: "US30", DJI: "US30", WALLSTREET: "US30", WALLST30: "US30",
    NAS100: "NAS100", USTEC: "NAS100", NASDAQ: "NAS100",
    SPX500: "SPX500", US500: "SPX500", SP500: "SPX500",
    GER40: "GER40", GER30: "GER40", DAX: "GER40", GERMANY30: "GER40",
    UK100: "UK100", FTSE: "UK100",
    JP225: "JP225", NIKKEI: "JP225",
    HK50: "HK50", HANGSENG: "HK50",
    AUS200: "AUS200", ASX200: "AUS200",
    // crypto full names + shorts
    BTCUSD: "BTCUSD", BITCOIN: "BTCUSD", BTC: "BTCUSD", XBTUSD: "BTCUSD",
    ETHUSD: "ETHUSD", ETHEREUM: "ETHUSD", ETH: "ETHUSD",
    LTCUSD: "LTCUSD", LITECOIN: "LTCUSD",
    XRPUSD: "XRPUSD", RIPPLE: "XRPUSD",
    SOLUSD: "SOLUSD", SOLANA: "SOLUSD",
    ADAUSD: "ADAUSD", CARDANO: "ADAUSD",
    DOGEUSD: "DOGEUSD", DOGECOIN: "DOGEUSD"
  }
  function normalizeAssetId(raw) {
    if (!raw) return "EURUSD"
    let s = raw.replace(/\s*\(otc\)/gi, "").replace(/\s+/g, "").toUpperCase()
    if (/^[A-Z]{3}\/[A-Z]{3}$/.test(s)) s = s.replace("/", "")
    if (/^[A-Z]{3}\.[A-Z]{3}$/.test(s)) s = s.replace(".", "")
    return ASSET_ALIAS_MAP[s] || s || "EURUSD"
  }

  // Scrape-failure placeholders must never become the primary asset key.
  const GARBAGE_ASSET_RE = /^(asset\s*\d+|live[_\s-]*asset)$/i
  function detectPrimaryAssetFromPage() {
    try {
      const m = String(document.title || "").match(/[A-Z]{3,6}\s*\/\s*[A-Z]{3,6}|(?:^|[\s\-—–|(])(?:Bitcoin|Ethereum|Litecoin|Ripple|Solana|Cardano|Dogecoin|Polkadot|Chainlink|Avalanche|Gold|Silver|Platinum|Palladium|Copper|Oil|Crude|WTI|Brent|Dow|Nasdaq|FTSE|DAX|Nikkei)(?=$|[\s\-—–)|])/i)
      if (m && !GARBAGE_ASSET_RE.test(m[0].trim())) return m[0].replace(/[\s\-—–|(]+/g, "").trim()
    } catch {}
    try {
      const m = String(window.location.href || "").match(/[?&](?:asset|symbol)=([A-Za-z0-9_%./-]+)/)
      if (m) {
        try { return decodeURIComponent(m[1]) } catch { return m[1] }
      }
    } catch {}
    for (const el of document.querySelectorAll("[class*=asset], [class*=instrument], [class*=symbol]")) {
      const t = (el.textContent || "").trim()
      if (t && t.length <= 24 && !GARBAGE_ASSET_RE.test(t) && /[A-Za-z]/.test(t) && !/balance|payout|profit/i.test(t)) return t
    }
    for (const a of Array.isArray(tradingState.assets) ? tradingState.assets : []) {
      const n = String(a?.name ?? "")
      if (n && !GARBAGE_ASSET_RE.test(n)) return n
    }
    return null
  }

  // ── Feature-aware helpers ──────────────────────────────────────────────────
  const DOCKABLE_FEATURES = {
    "price-ticker": ["analysis"],
    "positions": [],
    "portfolio": [],
    "ai-signals": ["ai", "decisionSupport", "analysis"],
    "risk-mgr": ["decisionSupport", "analysis"],
    "autopilot": ["autopilot", "automation"],
    "kelly-sizing": ["analysis"],
    "regime-detect": ["analysis"],
    "order-flow": ["analysis"],
    "expiry-opt": ["analysis"],
    "sentiment": ["analysis"],
    "calibration": ["analysis"],
    "entry-points": ["analysis"],
    "model-matrix": ["analysis"],
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
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("price-ticker")
    const staleAgo = tradingState.lastFetchAt ? Math.round((Date.now() - tradingState.lastFetchAt) / 1000) : 0
    const isStale = staleAgo > 30
    const dotColor = serverOnline === false || isStale ? "#ff6b6b" : serverOnline === true ? "#4ade80" : "#f59e0b"
    const statusDot = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor};margin-right:4px"></span>`
    const statusLabel = isStale ? 'Stale' : serverOnline === true ? 'Connected' : serverOnline === false ? 'Offline' : 'Checking'
    const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:9px;color:#9aa0c0"><span style="${isStale ? 'color:' + (staleAgo > 60 ? '#ff6b6b' : '#f59e0b') + ';font-weight:600' : ''}">${statusDot}${statusLabel}</span><span>${new Date().toLocaleTimeString()}</span></div>`
    if (!assets.length) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner() + header
      return banner + header + '<div style="color:#a5a0ff;padding:4px">Waiting for market data\u2026</div>'
    }
    const rows = assets.slice(0, 6).map((a) => {
      const c = tone(a.changePct)
      const isActive = activeAsset && normalizeAssetId(a.name || a.id) === activeAsset
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #6c63ff20${isActive ? ';background:#6c63ff10;border-radius:3px' : ''}">` +
        `<span style="font-weight:${isActive ? '700' : '600'};font-size:11px${isActive ? ';color:#6c63ff' : ''}">${esc(a.name || a.id)}${isActive ? ' \u25cf' : ''}</span>` +
        `<span style="font-size:11px;color:${c}">${num(a.price, 4)}</span>` +
        `<span style="font-size:10px;color:${c}">${a.changePct != null && Number.isFinite(Number(a.changePct)) ? (a.changePct >= 0 ? "+" : "") + Number(a.changePct).toFixed(2) + "%" : ""}</span>` +
        `</div>`
    }).join("")
    const acct = tradingState.account
    const bal = acct?.balance != null ? fmt$(acct.balance, acct.currency) : ""
    const src = tradingState.candleSource || ""
    const srcLabel = src === "buffer" ? "live" : src === "live" ? "fetched" : src === "yahoo" ? "delayed" : ""
    const srcColor = src === "buffer" || src === "live" ? "#4ade80" : src === "yahoo" ? "#f59e0b" : "#a5a0ff"
    return banner + header + `<div style="font-size:11px">${rows}</div>` +
      (bal ? `<div style="margin-top:4px;font-size:10px;color:#a5a0ff">Balance: ${bal}</div>` : "") +
      (srcLabel ? `<div style="font-size:9px;color:${srcColor}">data: ${srcLabel}</div>` : "") +
      staleLabel()
  }

  // ── Portfolio Renderer ─────────────────────────────────────────────────────
  function renderPortfolio() {
    const paper = tradingState.paper
    const demo = tradingState.demo
    const acct = tradingState.account
    const banner = checkFeatures("portfolio")
    const lines = []
    if (paper) {
      lines.push(`<div style="font-weight:600;font-size:11px;color:#6c63ff;margin-bottom:2px">Paper Trading</div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Cash</span><span>${fmt$(paper.cash, acct?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Committed</span><span>${fmt$(paper.committed, acct?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>PnL</span><span style="color:${tone(paper.realizedPnl)}">${fmt$(paper.realizedPnl, acct?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Win rate</span><span>${paper.winRate != null ? paper.winRate + "%" : "\u2014"}</span></div>`)
    }
    if (acct?.demoWallet || acct?.realWallet) {
      const modeLabel = acct.demo !== false ? "Demo" : "Live"
      lines.push(`<div style="font-weight:600;font-size:11px;color:#6c63ff;margin:4px 0 2px">ExpertOption ${modeLabel}</div>`)
      if (acct.demoWallet) {
        const dw = acct.demoWallet
        lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Demo</span><span>${fmt$(dw.balance, dw.currency)}</span></div>`)
      }
      if (acct.realWallet) {
        const rw = acct.realWallet
        lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Real</span><span>${fmt$(rw.balance, rw.currency)}</span></div>`)
      }
    } else if (demo) {
      lines.push(`<div style="font-weight:600;font-size:11px;color:#6c63ff;margin:4px 0 2px">ExpertOption Demo</div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Balance</span><span>${fmt$(demo.balance, acct?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Today</span><span style="color:${tone(demo.todayPnl)}">${fmt$(demo.todayPnl, acct?.currency)}</span></div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Trades</span><span>${demo.todayTrades ?? 0}</span></div>`)
    }
    if (!lines.length) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">No position data yet\u2026</div>'
    }
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── AI Signals Renderer ────────────────────────────────────────────────────
  function renderAISignals() {
    const d = tradingState.decisions
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("ai-signals")
    if (!d.length) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Waiting for AI analysis\u2026</div>'
    }
    const rows = d.slice(0, 5).map((dec) => {
      const verdictColor = dec.verdict === "TRADE" ? "#4ade80" : dec.verdict === "OBSERVE" ? "#f59e0b" : "#a5a0ff"
      const gates = dec.gates || {}
      const gIcon = (ok) => ok ? '<span style="color:#4ade80">\u2713</span>' : '<span style="color:#ff6b6b">\u2717</span>'
      const decAsset = esc(dec.asset || dec.assetId || "")
      const isActive = activeAsset && String(dec.asset || dec.assetId || "").toUpperCase() === activeAsset.toUpperCase()
      const confNum = Number(dec.confidence)
      return `<div style="border-bottom:1px solid #6c63ff15;padding:3px 0${isActive ? ';background:#6c63ff08;border-radius:3px' : ''}">` +
        `<div style="display:flex;justify-content:space-between;align-items:center">` +
          `<span style="font-weight:600;font-size:11px${isActive ? ';color:#6c63ff' : ''}">${decAsset}${isActive ? ' \u25cf' : ''}</span>` +
          `<span style="font-size:10px;font-weight:600;color:${verdictColor}">${esc(dec.verdict)}</span>` +
        `</div>` +
        `<div style="display:flex;gap:6px;font-size:9px;color:#a5a0ff">` +
          `<span>${gIcon(gates.score)} conf</span>` +
          `<span>${gIcon(gates.winProb)} prob</span>` +
          `<span>${gIcon(gates.payout)} pay</span>` +
          `<span>${Number.isFinite(confNum) ? confNum.toFixed(0) + "%" : ""}</span>` +
          `<span style="color:${dec.direction === "up" ? "#4ade80" : dec.direction === "down" ? "#ff6b6b" : "#a5a0ff"}">${esc((dec.direction || "").toUpperCase())}</span>` +
        `</div>` +
        (Number.isFinite(confNum) || dec.ev != null
          ? `<div style="font-size:9px;margin-top:1px">` +
            `${Number.isFinite(confNum) ? `<span style="color:#a5a0ff">${confNum.toFixed(0)}%</span> ` : ""}` +
            breakevenBadge(dec.confidence, dec.payout) +
            (dec.ev != null && Number.isFinite(Number(dec.ev)) ? ` <span style="color:${dec.ev > 0 ? "#4ade80" : "#ff6b6b"}">EV ${(dec.ev * 100).toFixed(1)}%/stake</span>` : "") +
            `</div>`
          : "") +
        `</div>`
    }).join("")
    return banner + `<div style="padding:2px 0">${rows}</div>`
  }

  // ── Risk Manager Renderer ──────────────────────────────────────────────────
  function renderRiskManager() {
    const demo = tradingState.demo
    const auto = tradingState.autopilot
    const banner = checkFeatures("risk-mgr")
    if (!demo && !auto) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Risk metrics loading\u2026</div>'
    }
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
  // Per-asset scope helpers shared by the renderer + click handlers below.
  function autopilotScopeList() {
    const auto = tradingState.autopilot || {}
    let list = Array.isArray(auto.assets) ? auto.assets.map((a) => ({ ...a })) : []
    // Legacy configs trade exactly ONE asset via auto.assetId. Seed the scope
    // with it so enabling another asset never silently drops the old target.
    if (!list.length && auto.assetId) {
      list = [{ assetId: String(auto.assetId).toUpperCase(), enabled: true, duration: null, amount: null, minConfidence: null }]
    }
    return list
  }

  async function saveAutopilotScope(mutate) {
    const auto = tradingState.autopilot
    if (!auto) return
    const list = mutate(autopilotScopeList())
    try {
      await serverFetch("/api/trading/autopilot", {
        method: "POST",
        body: {
          assets: list,
          // keep primary display asset = first enabled entry
          assetId: (list.find((a) => a.enabled !== false) ?? {}).assetId ?? auto.assetId
        },
        timeout: 8000
      })
      showToast("Autopilot", "Asset scope saved", "success")
    } catch {
      showToast("Autopilot", "Could not save asset scope", "error")
    }
    void fetchTradingData().then(updateAllDockables).catch(() => {})
  }

  function renderAutopilot() {
    const auto = tradingState.autopilot
    const demo = tradingState.demo
    const running = auto?.enabled ?? false
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("autopilot")
    const body = typeof piccRenderAutopilotPanel === "function"
      ? piccRenderAutopilotPanel({ auto, demo })
      : ""
    const lines = []

    // Per-asset quick-config for the ACTIVE asset — writes to the SAME server
    // config the suite page manages, so both stay in sync.
    if (auto && activeAsset) {
      const scope = autopilotScopeList()
      const mine = scope.find((a) => String(a.assetId).toUpperCase() === activeAsset.toUpperCase())
      const knownElsewhere = !mine && String(auto.assetId || "").toUpperCase() === activeAsset.toUpperCase()
      const inScope = mine ? mine.enabled !== false : knownElsewhere
      const effDur = Number(mine?.duration ?? auto.duration ?? 60)
      const effConf = Math.round(Number(mine?.minConfidence ?? auto.minConfidence ?? 55))
      const scopeSummary = scope
        .slice(0, 4)
        .map((a) => `${esc(String(a.assetId).toUpperCase())}${a.enabled !== false ? "" : "\u2717"}`)
        .join(" \u00b7 ")

      lines.push(`<div style="margin-top:6px;padding-top:5px;border-top:1px solid #6c63ff20">`)
      lines.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">`)
      lines.push(`<span style="font-size:9px;color:#9aa0c0">ACTIVE ASSET</span>`)
      lines.push(`<button data-picc-action="apx-toggle" title="${inScope ? "Remove from engine scope" : "Add to engine scope"}" style="background:${inScope ? "#4ade8025" : "#2a2a4a"};border:1px solid ${inScope ? "#4ade80" : "#555"};color:${inScope ? "#4ade80" : "#9aa0c0"};font-size:9px;font-weight:600;padding:1px 7px;border-radius:10px;cursor:pointer">${inScope ? "\u2713 trading" : "+ enable"}</button>`)
      lines.push(`</div>`)
      lines.push(`<div style="font-size:11px;font-weight:700;color:#eef0ff;margin-bottom:4px">${esc(activeAsset)}</div>`)
      lines.push(`<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">`)
      lines.push(`<span style="font-size:9px;color:#9aa0c0;width:52px">duration</span>`)
      lines.push(`<select data-picc-action="apx-duration" style="flex:1;background:#16162c;border:1px solid #2a2a4a;color:#eef0ff;font-size:10px;border-radius:3px;padding:1px 3px">`)
      for (const s of [15, 30, 60, 120, 300, 900]) {
        lines.push(`<option value="${s}"${effDur === s ? " selected" : ""}>${s}s</option>`)
      }
      lines.push(`</select></div>`)
      lines.push(`<div style="display:flex;gap:4px;align-items:center">`)
      lines.push(`<span style="font-size:9px;color:#9aa0c0;width:52px">min conf</span>`)
      lines.push(`<button data-picc-action="apx-conf-dec" style="background:#2a2a4a;border:none;color:#eef0ff;width:18px;height:16px;border-radius:3px;cursor:pointer;font-size:10px">\u2212</button>`)
      lines.push(`<span style="font-size:11px;font-weight:600;color:#6c63ff;width:34px;text-align:center">${effConf}%</span>`)
      lines.push(`<button data-picc-action="apx-conf-inc" style="background:#2a2a4a;border:none;color:#eef0ff;width:18px;height:16px;border-radius:3px;cursor:pointer;font-size:10px">+</button>`)
      lines.push(`<span style="font-size:8px;color:#5a6078;margin-left:auto">(asset override)</span>`)
      lines.push(`</div>`)
      if (scopeSummary) {
        lines.push(`<div style="font-size:8px;color:#5a6078;margin-top:3px">engine scope: ${scopeSummary}${scope.length > 4 ? " \u2026" : ""}</div>`)
      }
      lines.push(`</div>`)
    }

    lines.push(`<div style="display:flex;gap:4px;margin-top:6px">`)
    lines.push(`<button data-picc-action="autopilot-toggle" style="flex:1;background:${running ? "#ff6b6b30" : "#4ade8030"};border:1px solid ${running ? "#ff6b6b" : "#4ade80"};color:#eef0ff;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600">${running ? "Stop" : "Start"}</button>`)
    lines.push(`<button data-picc-action="autopilot-kill" style="background:#ff6b6b30;border:1px solid #ff6b6b;color:#ff6b6b;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600">Kill</button>`)
    lines.push(`</div>`)
    return banner + `<div style="padding:2px 0">${body}${lines.join("")}</div>` + staleLabel()
  }

  // ── Kelly Sizing Renderer ──────────────────────────────────────────────────
  function renderKellySizing() {
    const kelly = tradingState.kelly
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("kelly-sizing")
    if (!kelly) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Loading Kelly data\u2026</div>'
    }
    const stats = kelly.stats || {}
    const k = kelly.kelly || {}
    const balance = Number(tradingState.account?.balance ?? tradingState.demo?.balance ?? 0)
    const suggested = Number(k.suggested)
    const suggestedUsd = Number.isFinite(suggested) && balance > 0 ? (suggested / 100) * balance : null
    const lines = []
    if (activeAsset) lines.push(`<div style="font-size:9px;color:#6c63ff;margin-bottom:2px">${esc(activeAsset)} \u25cf</div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Win rate</span><span>${stats.winRate != null ? stats.winRate + "%" : "\u2014"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Avg payout</span><span>${stats.avgPayout != null ? stats.avgPayout + "x" : "—"}</span></div>`)
    lines.push(`<div style="border-top:1px solid #6c63ff20;margin:4px 0"></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Full Kelly</span><span style="color:#6c63ff">${k.fullKelly != null ? k.fullKelly + "%" : "—"}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Suggested (${k.mode || "half"})</span><span style="font-weight:600;color:#4ade80">${k.suggested != null ? k.suggested + "%" : "—"}${suggestedUsd != null ? ` \u2248 ${fmt$(suggestedUsd, tradingState.account?.currency)}` : ""}</span></div>`)
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px"><span>Break-even WR</span><span>${k.breakEven != null ? k.breakEven + "%" : "—"}</span></div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + sourceLabel(stats.totalTrades > 0 ? "trade history" : "using defaults (no history)")
  }

  // ── Regime Detection Renderer ──────────────────────────────────────────────
  function renderRegimeDetect() {
    const regime = tradingState.regime
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("regime-detect")
    if (!regime || regime.regime === "unknown") {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Analyzing market regime\u2026</div>' + sourceLabel("insufficient data")
    }
    const colors = { trending: "#4ade80", ranging: "#f59e0b", volatile: "#ff6b6b", breakout: "#6c63ff" }
    const c = colors[regime.regime] || "#a5a0ff"
    const lines = []
    if (activeAsset) lines.push(`<div style="font-size:9px;color:#6c63ff;margin-bottom:2px">${esc(activeAsset)} \u25cf</div>`)
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:8px;height:8px;border-radius:50%;background:${c}"></div><span style="font-weight:600;font-size:12px;color:${c}">${esc((regime.regime || "").toUpperCase())}</span><span style="font-size:10px;color:#9aa0c0">${regime.confidence || 0}%</span></div>`)
    if (regime.metrics) lines.push(`<div style="font-size:10px;color:#9aa0c0">ADX: ${regime.metrics.adx} · ATR ratio: ${regime.metrics.atrRatio}x</div>`)
    if (regime.suggestedStrategy) lines.push(`<div style="font-size:10px;margin-top:4px">Strategy: <b style="color:#6c63ff">${esc(regime.suggestedStrategy)}</b></div>`)
    if (regime.factors?.length) lines.push(`<div style="font-size:9px;color:#9aa0c0;margin-top:2px">${esc(regime.factors.join(" · "))}</div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + sourceLabel("price action")
  }

  // ── Order Flow Renderer ────────────────────────────────────────────────────
  function renderOrderFlow() {
    const of = tradingState.orderFlow
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("order-flow")
    if (!of || !of.delta?.length) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Loading order flow\u2026</div>'
    }
    const lines = []
    if (activeAsset) lines.push(`<div style="font-size:9px;color:#6c63ff;margin-bottom:2px">${esc(activeAsset)} \u25cf</div>`)
    const imbColor = of.imbalance === "buy-heavy" ? "#4ade80" : of.imbalance === "sell-heavy" ? "#ff6b6b" : "#f59e0b"
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-weight:600;font-size:11px">Net Delta</span><span style="color:${of.cumulative >= 0 ? "#4ade80" : "#ff6b6b"};font-weight:600">${of.cumulative >= 0 ? "+" : ""}${of.cumulative}</span><span style="font-size:9px;padding:1px 4px;border-radius:3px;background:${imbColor}30;color:${imbColor}">${esc(of.imbalance)}</span></div>`)
    const hasVolume = of.delta.some((d) => (d.volume || 0) > 0)
    if (of.avgDelta != null) lines.push(`<div style="font-size:10px;color:#9aa0c0">Avg delta: ${of.avgDelta}</div>`)
    if (of.signals?.length) {
      for (const sig of of.signals.slice(0, 3)) {
        lines.push(`<div style="font-size:9px;color:${sig.type === "divergence" ? "#f59e0b" : "#6c63ff"};margin-top:2px">⚡ ${esc(sig.desc)}</div>`)
      }
    }
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + sourceLabel(hasVolume ? "live candles" : "no volume data")
  }

  // ── Expiry Optimizer Renderer ──────────────────────────────────────────────
  function renderExpiryOpt() {
    const exp = tradingState.expiry
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("expiry-opt")
    if (!exp || !exp.recommended) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Analyzing optimal expiry\u2026</div>'
    }
    const r = exp.recommended
    const lines = []
    if (activeAsset) lines.push(`<div style="font-size:9px;color:#6c63ff;margin-bottom:2px">${esc(activeAsset)} \u25cf</div>`)
    lines.push(`<div style="font-weight:600;font-size:12px;color:#6c63ff;margin-bottom:4px">Recommended: ${esc(r.label)}</div>`)
    lines.push(`<div style="font-size:10px;color:#9aa0c0">Score: ${r.score}/100 · Vol: ${exp.volatility || "—"}</div>`)
    if (exp.all?.length) {
      const top3 = exp.all.slice(0, 3)
      lines.push(`<div style="display:flex;gap:4px;margin-top:4px">`)
      for (const e of top3) {
        const barW = Math.max(10, e.score)
        lines.push(`<div style="flex:1;text-align:center;font-size:9px"><div style="margin-bottom:2px">${esc(e.label)}</div><div style="background:#1a1a2e;border-radius:2px;height:4px;overflow:hidden"><div style="height:100%;width:${barW}%;background:#6c63ff;border-radius:2px"></div></div><div style="color:#9aa0c0;margin-top:1px">${e.score}</div></div>`)
      }
      lines.push(`</div>`)
    }
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + sourceLabel(exp.volatility != null ? "volatility model" : "using defaults")
  }

  // ── Sentiment Renderer ─────────────────────────────────────────────────────
  function renderSentiment() {
    const sent = tradingState.sentiment
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("sentiment")
    if (!sent || !sent.composite) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Loading sentiment\u2026</div>'
    }
    const c = sent.composite
    const lines = []
    if (activeAsset) lines.push(`<div style="font-size:9px;color:#6c63ff;margin-bottom:2px">${esc(activeAsset)} \u25cf</div>`)
    const scoreColor = c.score > 0.2 ? "#4ade80" : c.score < -0.2 ? "#ff6b6b" : "#f59e0b"
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-weight:600;font-size:12px;color:${scoreColor}">${esc(c.label || "Neutral")}</span><span style="font-size:10px;color:#9aa0c0">Score: ${c.score}</span>${c.extreme ? '<span style="font-size:8px;padding:1px 3px;border-radius:3px;background:#ff6b6b30;color:#ff6b6b">EXTREME</span>' : ""}</div>`)
    if (sent.news) lines.push(`<div style="font-size:10px;color:#9aa0c0">News: ${sent.news.bullish}🟢 ${sent.news.bearish}🔴 ${sent.news.neutral}⚪ (${sent.news.sampleSize})</div>`)
    if (sent.social) lines.push(`<div style="font-size:10px;color:#9aa0c0">Social velocity: ${sent.social.velocity > 0 ? "+" : ""}${sent.social.velocity}</div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + sourceLabel(sent.news?.sampleSize > 0 ? "news+social" : "unavailable")
  }

  // ── Calibration Renderer (Phase 11) ────────────────────────────────────────
  function renderCalibration() {
    const banner = checkFeatures("calibration")
    const cal = tradingState.calibration
    const decWithPayout = tradingState.decisions.find((d) => d.payout != null) || null
    const payout = decWithPayout?.payout ?? 80
    const be = breakevenWinRate(payout)
    const lines = []
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">` +
      `<span>Breakeven @ ${payout}% payout</span>` +
      `<span style="font-weight:600;color:#6c63ff">${be != null ? be.toFixed(1) + "%" : "—"}</span></div>`)
    if (!cal || cal.totalResolved === 0) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + lines.join("") +
        '<div style="color:#a5a0ff;padding:4px">No resolved decisions yet — the ledger needs expired trades to calibrate.</div>' +
        sourceLabel("insufficient data")
    }
    if (cal.buckets?.length) {
      lines.push(`<div style="font-size:9px;color:#6c63ff;border-bottom:1px solid #6c63ff30;padding-bottom:2px;margin-bottom:2px;display:flex;justify-content:space-between"><span>bucket</span><span>pred → real</span><span>n</span></div>`)
      for (const b of cal.buckets.slice(0, 8)) {
        const gapColor = b.calibrationGap == null ? "#a5a0ff" : b.calibrationGap >= -0.03 ? "#4ade80" : b.calibrationGap >= -0.1 ? "#f59e0b" : "#ff6b6b"
        lines.push(`<div style="display:flex;justify-content:space-between;font-size:10px;padding:1px 0">` +
          `<span style="color:#a5a0ff">${esc(b.bucket)}</span>` +
          `<span>${b.predictedWinRate != null ? (b.predictedWinRate * 100).toFixed(0) + "%" : "—"} → ` +
          `<span style="color:${gapColor}">${b.realizedWinRate != null ? (b.realizedWinRate * 100).toFixed(0) + "%" : "—"}</span>` +
          `${b.calibrationGap != null ? ` <span style="color:${gapColor}">(${(b.calibrationGap * 100).toFixed(0)})</span>` : ""}</span>` +
          `<span style="color:#9aa0c0">${b.count}</span></div>`)
      }
    } else {
      lines.push('<div style="color:#a5a0ff;padding:2px">No decisions in the 55–95% confidence range yet.</div>')
    }
    if (cal.calibrationGap != null) {
      const gColor = cal.calibrationGap >= -0.03 ? "#4ade80" : cal.calibrationGap >= -0.1 ? "#f59e0b" : "#ff6b6b"
      lines.push(`<div style="border-top:1px solid #6c63ff20;margin-top:4px;padding-top:3px;font-size:10px;display:flex;justify-content:space-between">` +
        `<span>Overall gap (real − pred)</span>` +
        `<span style="color:${gColor};font-weight:600">${(cal.calibrationGap * 100).toFixed(1)} pts</span></div>`)
    }
    if (cal.hitRate != null && cal.avgPredictedConfidence != null) {
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:10px">` +
        `<span>Hit rate / predicted</span>` +
        `<span>${(cal.hitRate * 100).toFixed(0)}% / ${(cal.avgPredictedConfidence * 100).toFixed(0)}%</span></div>`)
    }
    const adequacy = cal.adequacy || "insufficient"
    const adeqColor = adequacy === "adequate" ? "#4ade80" : adequacy === "limited" ? "#f59e0b" : "#ff6b6b"
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:10px;margin-top:2px">` +
      `<span>Sample size (${esc(cal.sampleSize)})</span>` +
      `<span style="color:${adeqColor};font-weight:600">${esc(adequacy)}</span></div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` +
      sourceLabel(cal.totalResolved > 0 ? "trade history" : "insufficient data") + staleLabel()
  }

  // ── Host-chart hover projection ────────────────────────────────────────────
  // When hovering an ideal buy/sell level, the point is displayed ON THE
  // BROKER'S OWN LIVE CHART (the trading graph rendered by the host page),
  // not on an emulated chart. We locate the page's chart <canvas>, build a
  // price→y pixel mapping from the broker's own price-axis labels (least-
  // squares fit over ≥2 labels), and float an amber marker line at the exact
  // projected position — recomputed every animation frame so it MOVES with
  // the live chart (rescales, scrolls, ticks).
  const HOST_CHART_ID = "__PICC_HOST_CHART_MARKER__"
  let hostChartCache = { canvas: null, checkedAt: 0 }
  let hostChartRaf = 0

  function isVisibleEl(el) {
    return Boolean(el && el.getBoundingClientRect && (() => {
      const r = el.getBoundingClientRect()
      return r.width > 120 && r.height > 120 && r.top < window.innerHeight && r.bottom > 0
    })())
  }

  /** Locate the host page's main chart canvas (largest visible canvas). */
  function findChartCanvas() {
    const now = Date.now()
    if (hostChartCache.canvas && isCanvasLive(hostChartCache.canvas)) {
      hostChartCache.checkedAt = now
      return hostChartCache.canvas
    }
    if (now - hostChartCache.checkedAt < 1500) return null // throttle DOM scans
    hostChartCache.checkedAt = now
    let best = null
    let bestArea = 0
    try {
      for (const c of document.querySelectorAll("canvas")) {
        if (!isCanvasLive(c)) continue
        const r = c.getBoundingClientRect()
        const area = r.width * r.height
        if (area > bestArea) { best = c; bestArea = area }
      }
    } catch { return null }
    hostChartCache.canvas = bestArea >= 120 * 120 ? best : null
    return hostChartCache.canvas
  }

  function isCanvasLive(c) {
    try {
      const r = c.getBoundingClientRect()
      return r.width > 120 && r.height > 120 && r.bottom > 0 && r.top < window.innerHeight
    } catch { return false }
  }

  /**
   * Build a price→y linear map from the broker's own price-axis labels.
   * Collects numeric texts in the right-hand band beside/over the chart,
   * keeps strictly monotonic samples, least-squares fits y = a·price + b.
   * Returns {a, b, ok, source:"axis"} or null.
   */
  function fitPriceMapFromAxis(canvasRect) {
    try {
      const bandLeft = canvasRect.right - Math.max(90, canvasRect.width * 0.18)
      const samples = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const txt = node.textContent.trim()
        if (!txt || txt.length > 12) continue
        const m = txt.match(/^\d{1,3}(?:[ ,.]?\d{3})*(?:[.,]\d+)?$|^\d+[.,]\d+$/)
        if (!m) continue
        const price = parseFloat(txt.replace(/[ ,](?=\d{3}\b)/g, "").replace(",", "."))
        if (!Number.isFinite(price) || price <= 0) continue
        const el = node.parentElement
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        // Must sit inside-or-right-of the chart, vertically overlapping it.
        if (r.left < bandLeft - 8) continue
        if (r.bottom < canvasRect.top || r.top > canvasRect.bottom) continue
        samples.push({ price, y: r.top + r.height / 2 })
        if (samples.length >= 40) break
      }
      // Keep distinct-price samples; require ≥2 separated levels.
      const seen = new Map()
      for (const s of samples) {
        const key = s.price.toFixed(6)
        if (!seen.has(key)) seen.set(key, s)
      }
      const pts = [...seen.values()].sort((p, q) => p.price - q.price)
      if (pts.length < 2) return null
      const spanP = pts[pts.length - 1].price - pts[0].price
      const spanY = Math.abs(pts[pts.length - 1].y - pts[0].y)
      if (!(spanP > 0) || !(spanY > 24)) return null
      // Least squares y = a*price + b
      let sx = 0, sy = 0, sxx = 0, sxy = 0
      for (const p of pts) { sx += p.price; sy += p.y; sxx += p.price * p.price; sxy += p.price * p.y }
      const n = pts.length
      const denom = n * sxx - sx * sx
      if (Math.abs(denom) < 1e-9) return null
      const a = (n * sxy - sx * sy) / denom
      const b = (sy - a * sx) / n
      if (!Number.isFinite(a) || a === 0) return null
      return { a, b, ok: true, source: "axis" }
    } catch { return null }
  }

  /**
   * Fallback mapping: assume the canvas displays the recent candle range with
   ~8% padding. Approximate — the marker renders dashed + tagged "~".
   */
  function approxPriceMapFromCandles(canvasRect) {
    try {
      const candles = Array.isArray(tradingState.lastCandles) ? tradingState.lastCandles.slice(-80) : []
      if (candles.length < 5) return null
      let hi = -Infinity, lo = Infinity
      for (const c of candles) {
        hi = Math.max(hi, Number(c.high))
        lo = Math.min(lo, Number(c.low))
      }
      if (!(hi > lo)) return null
      const pad = (hi - lo) * 0.08
      const top = hi + pad
      const bottom = lo - pad
      const a = -(canvasRect.height) / (top - bottom)
      const b = canvasRect.top - a * top
      return { a, b, ok: true, source: "approx" }
    } catch { return null }
  }

  function priceToY(map, price) {
    return map.a * price + map.b
  }

  function ensureHostMarkerLayer(canvas) {
    let layer = document.getElementById(HOST_CHART_ID)
    if (!layer) {
      layer = document.createElement("div")
      layer.id = HOST_CHART_ID
      layer.style.cssText = "all:initial;position:fixed;z-index:2147483640;pointer-events:none;"
      const line = document.createElement("div")
      line.id = HOST_CHART_ID + "_LINE"
      line.style.cssText = "position:absolute;left:0;height:0;border-top:2px solid #fbbf24;box-shadow:0 0 8px rgba(251,191,36,.7);"
      const chip = document.createElement("div")
      chip.id = HOST_CHART_ID + "_CHIP"
      chip.style.cssText = "position:absolute;right:0;transform:translateY(-50%);background:#fbbf24;color:#111;font:bold 10px system-ui;padding:2px 7px;border-radius:4px;white-space:nowrap;"
      layer.appendChild(line)
      layer.appendChild(chip)
      document.documentElement.appendChild(layer)
    }
    return layer
  }

  /**
   * Show/move the marker for `price` on the host chart. Starts a rAF loop so
   * the marker tracks the LIVE chart (scroll, rescale, tick updates).
   */
  function hostChartShow(price) {
    try {
      const target = Number(price)
      if (!Number.isFinite(target) || target <= 0) return hostChartHide()
      cancelAnimationFrame(hostChartRaf)

      const render = () => {
        const canvas = findChartCanvas()
        if (!canvas) { hostChartHide(); return }
        const rect = canvas.getBoundingClientRect()
        let map = fitPriceMapFromAxis(rect)
        if (!map) map = approxPriceMapFromCandles(rect)
        if (!map) { hostChartHide(); return }

        const y = priceToY(map, target)
        if (!Number.isFinite(y)) { hostChartHide(); return }
        // Off-chart price: clamp marker to the edge instead of vanishing.
        const clampedY = Math.min(Math.max(y, rect.top + 4), rect.bottom - 4)
        const offChart = Math.abs(clampedY - y) > 1

        const layer = ensureHostMarkerLayer(canvas)
        layer.style.display = "block"
        layer.style.left = rect.left + "px"
        layer.style.top = "0px"
        layer.style.width = rect.width + "px"
        layer.style.height = rect.height + "px"
        const line = layer.firstChild
        line.style.top = (clampedY - rect.top) + "px"
        line.style.width = rect.width + "px"
        line.style.borderTopStyle = map.source === "approx" || offChart ? "dashed" : "solid"
        const chip = layer.lastChild
        chip.style.top = (clampedY - rect.top) + "px"
        const pretty = target < 10 ? target.toFixed(4) : target < 1000 ? target.toFixed(2) : target.toLocaleString("en-US", { maximumFractionDigits: 2 })
        chip.textContent = `${map.source === "approx" ? "~" : ""}${offChart ? "↕ " : ""}${pretty}`
        hostChartRaf = requestAnimationFrame(render)
      }
      render()
    } catch { hostChartHide() }
  }

  function hostChartHide() {
    cancelAnimationFrame(hostChartRaf)
    hostChartRaf = 0
    const layer = document.getElementById(HOST_CHART_ID)
    if (layer) layer.style.display = "none"
  }

  // ── Entry Points Renderer — ideal buy/sell zones for the ACTIVE asset ─────
  // Hovering a zone/level PROJECTS the price point onto the broker's own live
  // chart (see host-chart projection above). The compact in-dock candle
  // reference remains only as a fallback when no host chart is detectable.
  // Each zone carries a confirm-to-simulate buy button (paper trade).
  const ENTRY_CHART_H = 74

  function drawEntryChart() {
    try {
      const canvas = shadowRoot.getElementById("__PICC_ENTRY_CHART__")
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = "#0d0d1a"
      ctx.fillRect(0, 0, W, H)

      const candles = Array.isArray(tradingState.lastCandles) ? tradingState.lastCandles : []
      const levels = tradingState.entryLevels
      if (!candles.length || !levels?.ok) {
        ctx.fillStyle = "#5a6078"
        ctx.font = "9px system-ui"
        ctx.fillText("waiting for candle data…", 8, H / 2)
        return
      }
      // Price range = candles ∪ hovered level so the crosshair is always visible.
      let hi = -Infinity
      let lo = Infinity
      for (const c of candles) {
        if (Number(c.high) > hi) hi = Number(c.high)
        if (Number(c.low) < lo) lo = Number(c.low)
      }
      const hoverP = Number(tradingState.entryHoverPrice)
      if (Number.isFinite(hoverP)) {
        hi = Math.max(hi, hoverP)
        lo = Math.min(lo, hoverP)
      }
      if (!(hi > lo)) { hi += 1; lo -= 1 }
      const pad = (hi - lo) * 0.08
      hi += pad
      lo -= pad
      const yOf = (p) => H - ((p - lo) / (hi - lo)) * H

      // Zone bands behind the candles.
      const band = (zone, color) => {
        if (!zone) return
        const y1 = yOf(Math.min(Number(zone.high), hi))
        const y2 = yOf(Math.max(Number(zone.low), lo))
        ctx.fillStyle = color
        ctx.fillRect(0, y1, W, Math.max(2, y2 - y1))
      }
      band(levels.buyZone, "rgba(74,222,128,0.14)")
      band(levels.sellZone, "rgba(255,107,107,0.12)")

      // Candles: thin bodies + wicks.
      const n = candles.length
      const step = W / n
      for (let i = 0; i < n; i++) {
        const c = candles[i]
        const up = Number(c.close) >= Number(c.open)
        ctx.strokeStyle = up ? "rgba(74,222,128,0.75)" : "rgba(255,107,107,0.75)"
        ctx.fillStyle = up ? "rgba(74,222,128,0.55)" : "rgba(255,107,107,0.55)"
        const x = i * step + step / 2
        ctx.beginPath()
        ctx.moveTo(x, yOf(Number(c.high)))
        ctx.lineTo(x, yOf(Number(c.low)))
        ctx.stroke()
        const bodyTop = yOf(Math.max(Number(c.open), Number(c.close)))
        const bodyH = Math.max(1, Math.abs(yOf(Number(c.open)) - yOf(Number(c.close))))
        ctx.fillRect(x - Math.max(0.6, step * 0.3), bodyTop, Math.max(1.2, step * 0.6), bodyH)
      }

      // Live spot line.
      const spotY = yOf(Number(levels.spot))
      ctx.strokeStyle = "rgba(108,99,255,0.85)"
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(0, spotY)
      ctx.lineTo(W, spotY)
      ctx.stroke()
      ctx.setLineDash([])

      // Hovered level crosshair — realtime via delegated mousemove.
      if (Number.isFinite(hoverP)) {
        const hy = yOf(hoverP)
        ctx.strokeStyle = "#f59e0b"
        ctx.lineWidth = 1.4
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.moveTo(0, hy)
        ctx.lineTo(W, hy)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineWidth = 1
        ctx.fillStyle = "#f59e0b"
        ctx.font = "bold 9px system-ui"
        const label = Number(hoverP) < 10 ? Number(hoverP).toFixed(4) : Number(hoverP).toFixed(2)
        ctx.fillText(label, 4, Math.max(10, hy - 3))
      }

      // Timestamp footer.
      ctx.fillStyle = "#5a6078"
      ctx.font = "8px system-ui"
      ctx.fillText(`${n} bars · ${tradingState.candleSource === "yahoo" ? "daily" : "live"}`, 4, H - 2)
    } catch { /* chart must never break the dockable */ }
  }

  function renderEntryPoints() {
    const levels = tradingState.entryLevels
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("entry-points")
    if (!levels || !levels.ok) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner +
        `<div style="font-size:9px;color:#6c63ff;margin-bottom:2px">${esc(activeAsset)} \u25cf</div>` +
        `<div style="color:#a5a0ff;padding:4px">${esc(levels?.reason || "Computing ideal buy/sell zones\u2026")}</div>`
    }
    const spot = Number(levels.spot)
    // Primary display = the BROKER'S OWN LIVE CHART via projection. The
    // compact in-dock candle strip renders ONLY when no host chart can be
    // located (e.g. unusual layout), so the feature never goes blind.
    const hasHostChart = Boolean(findChartCanvas())
    const fmtPx = (v) => {
      const n = Number(v)
      if (!Number.isFinite(n)) return "\u2014"
      return n < 10 ? n.toFixed(4) : n < 1000 ? n.toFixed(2) : n.toLocaleString("en-US", { maximumFractionDigits: 2 })
    }
    const lines = []
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px"><span style="color:#6c63ff">${esc(activeAsset)} \u25cf</span><span style="color:#eef0ff">spot ${fmtPx(spot)}</span></div>`)
    if (!hasHostChart) {
      lines.push(`<canvas id="__PICC_ENTRY_CHART__" width="248" height="${ENTRY_CHART_H}" style="width:100%;border-radius:4px;display:block;margin-bottom:4px"></canvas>`)
    }

    const zoneRow = (z, label, color, side) => {
      if (!z) return ""
      const dist = (((Number(z.anchor)) - spot) / spot * 100).toFixed(2)
      return `<div data-entry-hover-price="${Number(z.anchor)}" style="border:1px solid ${color}44;border-radius:4px;padding:3px 6px;margin-bottom:3px;background:${color}08;cursor:crosshair">` +
        `<div style="display:flex;justify-content:space-between;font-size:10px;font-weight:600;color:${color}">` +
        `<span>${label}</span><span>${fmtPx(z.low)} \u2013 ${fmtPx(z.high)}</span></div>` +
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;color:#9aa0c0">` +
        `<span>${dist > 0 ? "+" : ""}${dist}% from spot \u00b7 strength ${Number(z.strength) || 1}/5</span>` +
        `<button data-picc-action="entry-simulate" data-side="${side}" data-price="${Number(z.anchor)}" title="Simulate a paper trade at this level" style="background:${color}25;border:1px solid ${color};color:${color};font-size:9px;font-weight:600;padding:1px 6px;border-radius:3px;cursor:pointer">\u25b6 simulate</button>` +
        `</div></div>`
    }
    lines.push(zoneRow(levels.buyZone, "\u25bc IDEAL BUY", "#4ade80", "up"))
    lines.push(zoneRow(levels.sellZone, "\u25b2 IDEAL SELL", "#ff6b6b", "down"))

    for (const l of (levels.levels || []).filter((l) => l.kind !== "spot").slice(0, 5)) {
      lines.push(`<div data-entry-hover-price="${Number(l.price)}" style="display:flex;justify-content:space-between;font-size:9px;color:#9aa0c0;padding:1px 0;cursor:crosshair${l.kind === "support" ? ';background:#4ade8006' : ';background:#ff6b6b06'}">` +
        `<span>${l.kind === "support" ? "\ud83d\udfe2" : "\ud83d\udd34"} ${fmtPx(l.price)}</span>` +
        `<span>+${Math.abs(Number(l.distancePct)).toFixed(2)}% \u00b7 ${esc(String((l.sources || [])[0] ?? ""))}</span></div>`)
    }
    lines.push(`<div style="font-size:8px;color:#5a6078;margin-top:2px">hover a level \u2192 point projected on the live broker chart \u00b7 pivots+swings+EMA</div>`)
    // Fallback strip needs a draw pass once its DOM exists; the host-chart
    // marker draws itself via rAF from the hover delegation.
    if (!hasHostChart) setTimeout(drawEntryChart, 0)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + staleLabel()
  }

  // ── Model Matrix Renderer — multiplexing multi-model consensus ────────────
  function renderModelMatrix() {
    const matrix = tradingState.models
    const activeAsset = tradingState.activeAsset || ""
    const banner = checkFeatures("model-matrix")
    if (!matrix || !matrix.ok) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner +
        `<div style="font-size:9px;color:#6c63ff;margin-bottom:2px">${esc(activeAsset)} \u25cf</div>` +
        `<div style="color:#a5a0ff;padding:4px">${esc(matrix?.reason || "Running model battery\u2026")}</div>`
    }
    const c = matrix.consensus || {}
    const dirColor = c.direction === "up" ? "#4ade80" : c.direction === "down" ? "#ff6b6b" : "#f59e0b"
    const dirArrow = c.direction === "up" ? "\u25b2" : c.direction === "down" ? "\u25bc" : "\u25c6"
    const lines = []
    lines.push(`<div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px"><span style="color:#6c63ff">${esc(activeAsset)} \u25cf ${matrix.modelsRun} models</span><span style="color:#9aa0c0">agree ${c.agree}/${c.total}</span></div>`)
    lines.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` +
      `<span style="font-size:13px;font-weight:700;color:${dirColor}">${dirArrow} ${esc(String(c.direction ?? "flat").toUpperCase())}</span>` +
      `<span style="font-size:10px;color:#9aa0c0">${Number(c.confidence) ?? 0}% conf</span>` +
      `<div style="flex:1;background:#1a1a2e;border-radius:3px;height:6px;overflow:hidden">` +
      `<div style="height:100%;width:${Math.round(Number(c.confidence) || 0)}%;background:${dirColor};border-radius:3px"></div></div>` +
      `</div>`)
    for (const v of (matrix.votes || []).slice(0, 7)) {
      const vc = v.direction === "up" ? "#4ade80" : v.direction === "down" ? "#ff6b6b" : "#a5a0ff"
      const arrow = v.direction === "up" ? "\u25b2" : v.direction === "down" ? "\u25bc" : "\u25c6"
      lines.push(`<div style="padding:2px 0;border-bottom:1px solid #6c63ff10" title="${esc(v.note || "")}">` +
        `<div style="display:flex;justify-content:space-between;font-size:10px">` +
        `<span style="color:#c9cdf0">${esc(v.name)}</span>` +
        `<span style="color:${vc};font-weight:600">${arrow} ${Math.round(Number(v.confidence))}%</span></div>` +
        `<div style="display:flex;gap:4px;align-items:center">` +
        `<div style="flex:1;background:#1a1a2e;border-radius:2px;height:3px;overflow:hidden">` +
        `<div style="height:100%;width:${Math.round(Number(v.confidence))}%;background:${vc};border-radius:2px"></div></div>` +
        `<span style="font-size:8px;color:#5a6078">\u00d7${v.weight}</span></div>` +
        `</div>`)
    }
    lines.push(`<div style="font-size:8px;color:#5a6078;margin-top:3px">weights adapt online from settled outcomes \u00b7 multiplexed per tick</div>`)
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + staleLabel()
  }

  // ── Economic Calendar Renderer (feeds the dividend suite's calendar dock) ─
  function renderCalendar() {
    const cal = tradingState.calendar
    const banner = checkFeatures("calendar")
    if (!cal || !Array.isArray(cal.events)) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      return banner + '<div style="color:#a5a0ff;padding:4px">Loading economic calendar\u2026</div>'
    }
    const impactColor = { high: "#ff6b6b", medium: "#f59e0b", low: "#9aa0c0" }
    const events = cal.events.slice(0, 10)
    if (!events.length) {
      return banner + '<div style="color:#a5a0ff;padding:4px">No calendar events in the next 7 days.</div>' + sourceLabel("provider feed")
    }
    const lines = []
    const summary = cal.summary || {}
    lines.push(`<div style="font-size:9px;color:#9aa0c0;margin-bottom:3px">${events.length} upcoming \u00b7 ${summary.high ?? 0} high-impact</div>`)
    for (const ev of events) {
      const c = impactColor[ev.impact] || "#9aa0c0"
      lines.push(`<div style="padding:2px 0;border-bottom:1px solid #6c63ff15">` +
        `<div style="display:flex;justify-content:space-between;font-size:10px">` +
        `<span style="font-weight:600;color:${c}">${esc(ev.currency || "")} ${esc(ev.event || "")}</span>` +
        `<span style="color:#9aa0c0;font-size:9px">${esc(String(ev.date || "").slice(5))}</span></div>` +
        (ev.forecast ? `<div style="font-size:9px;color:#5a6078">forecast ${esc(ev.forecast)}${ev.previous ? ` \u00b7 prev ${esc(ev.previous)}` : ""}</div>` : "") +
        `</div>`)
    }
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + sourceLabel("economic calendar")
  }

  // ── Positions Renderer (multi-trade tracker) ──────────────────────────────
  function renderPositions() {
    const openDeals = tradingState.openDeals || tradingState.demo?.openDeals || []
    const banner = checkFeatures("positions")
    const activeAsset = tradingState.activeAsset || ""
    const settled = tradingState.demo?.settled || []
    if (!openDeals.length && !settled.length) {
      if (serverOnline === false || isTimedOut()) return banner + offlineBanner()
      // Honest empty state: explain WHY there are no positions instead of a
      // bare placeholder.
      const demo = tradingState.demo
      let hint = "No open positions — waiting for signals."
      if (!demo?.configured) hint = "No ExpertOption token configured — add it in the Trading Suite to enable live demo deals."
      else if (/expir|invalid|stale|token|reject/i.test(String(demo?.sessionError ?? ""))) hint = `Session problem: ${demo.sessionError}`
      else if (!tradingState.autopilot?.enabled) hint = "No open positions. Autopilot is off — start it below or trade manually from the suite."
      return banner + `<div style="color:#a5a0ff;padding:4px">${esc(hint)}</div>` + staleLabel()
    }
    const lines = []
    lines.push(`<div style="font-size:10px;color:#9aa0c0;margin-bottom:4px">${openDeals.length} open position${openDeals.length !== 1 ? "s" : ""}</div>`)
    for (const deal of openDeals) {
      const dir = (deal.direction || deal.type || "").toLowerCase()
      const dirColor = dir === "call" ? "#4ade80" : dir === "put" ? "#ff6b6b" : "#f59e0b"
      const dirLabel = dir === "call" ? "CALL" : dir === "put" ? "PUT" : (deal.direction || deal.type || "\u2014")
      const dealAsset = deal.asset || deal.assetId || ""
      const isActive = activeAsset && String(dealAsset).toUpperCase() === activeAsset.toUpperCase()
      const strike = deal.strike ?? deal.entryPrice ?? null
      const lastPrice = deal.lastPrice ?? deal.currentPrice ?? null
      const pnl = deal.livePnl
      const pnlColor = pnl != null ? (pnl > 0 ? "#4ade80" : pnl < 0 ? "#ff6b6b" : "#a5a0ff") : "#a5a0ff"
      const amount = deal.amount != null ? fmt$(deal.amount, tradingState.account?.currency) : "\u2014"
      const strikeStr = num(strike, 4)
      const lastStr = num(lastPrice, 4)
      const pnlStr = pnl != null && Number.isFinite(Number(pnl)) ? (pnl >= 0 ? "+" : "") + Number(pnl).toFixed(4) : "\u2014"
      const duration = deal.duration ?? deal.expiry ?? null
      const durationStr = duration ? duration + "s" : "\u2014"
      const createdAt = deal.createdAt ?? deal.openedAt ?? null
      const ageStr = createdAt ? formatDuration(Date.now() - createdAt) : ""
      lines.push(`<div style="padding:4px 0;border-bottom:1px solid #6c63ff15${isActive ? ';background:#6c63ff08;border-radius:3px' : ''}">`)
      lines.push(`<div style="display:flex;justify-content:space-between;align-items:center">`)
      lines.push(`<span style="font-weight:600;font-size:11px${isActive ? ';color:#6c63ff' : ''}">${esc(dealAsset || "\u2014")}${isActive ? ' \u25cf' : ''}</span>`)
      lines.push(`<span style="display:flex;gap:4px;align-items:center">`)
      lines.push(`<span style="font-size:10px;font-weight:600;color:${dirColor};padding:0 4px;border:1px solid ${dirColor}44;border-radius:3px">${esc(dirLabel)}</span>`)
      if (deal.serverId != null) {
        lines.push(`<button data-picc-action="close-deal" data-deal-id="${esc(deal.serverId)}" title="Close this position early" style="background:none;border:none;color:#9aa0c0;cursor:pointer;font-size:10px;padding:0 2px;line-height:1">\u2715</button>`)
      }
      lines.push(`</span>`)
      lines.push(`</div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:10px;color:#9aa0c0">`)
      lines.push(`<span>${amount} \u00b7 ${durationStr}</span>`)
      lines.push(`<span style="color:${pnlColor};font-weight:600">${pnlStr}</span>`)
      lines.push(`</div>`)
      lines.push(`<div style="display:flex;justify-content:space-between;font-size:9px;color:#9aa0c0">`)
      lines.push(`<span>strike: ${strikeStr} \u2192 now: ${lastStr}</span>`)
      lines.push(`<span>${ageStr}</span>`)
      lines.push(`</div>`)
      lines.push(`</div>`)
    }
    if (settled.length) {
      lines.push(`<div style="border-top:1px solid #6c63ff20;margin-top:4px;padding-top:4px;font-size:9px;color:#9aa0c0">Recent settled</div>`)
      for (const s of settled.slice(0, 5)) {
        const sDir = (s.direction || s.type || "").toLowerCase()
        const sColor = s.result === "win" ? "#4ade80" : s.result === "loss" ? "#ff6b6b" : "#a5a0ff"
        const sPnl = s.pnl ?? s.profit ?? null
        const sPnlStr = sPnl != null ? (sPnl >= 0 ? "+" : "") + fmt$(sPnl, tradingState.account?.currency) : ""
        lines.push(`<div style="display:flex;justify-content:space-between;font-size:9px;padding:1px 0">`)
        lines.push(`<span>${esc(s.asset || s.assetId || "")} ${esc(sDir.toUpperCase())}</span>`)
        lines.push(`<span style="color:${sColor}">${s.result || ""} ${sPnlStr}</span>`)
        lines.push(`</div>`)
      }
    }
    return banner + `<div style="padding:2px 0">${lines.join("")}</div>` + staleLabel()
  }

  function formatDuration(ms) {
    if (ms < 0 || !Number.isFinite(ms)) return ""
    const s = Math.floor(ms / 1000)
    if (s < 60) return s + "s"
    const m = Math.floor(s / 60)
    return m + "m " + (s % 60) + "s"
  }

  // ── Generic renderers (work on ANY site) ───────────────────────────────────
  function renderPageOverview() {
    const pm = tradingState.pageMetrics
    const assets = tradingState.assets
    const lines = []
    if (pm) {
      lines.push(`<div style="font-weight:600;font-size:11px;color:#6c63ff;margin-bottom:4px">${esc(pm.title || window.location.hostname)}</div>`)
      lines.push(`<div style="font-size:10px;color:#9aa0c0;word-break:break-all;margin-bottom:4px">${esc(window.location.href.substring(0, 60))}…</div>`)
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
          `<span>${esc(a.name)}</span>` +
          `<span>${a.price != null ? a.price : "\u2014"} ${a.changePct != null && Number.isFinite(Number(a.changePct)) ? `<span style="color:${c}">${a.changePct >= 0 ? "+" : ""}${Number(a.changePct).toFixed(2)}%</span>` : ""}</span></div>`)
      }
    }
    if (!lines.length) return '<div style="color:#a5a0ff;padding:4px">Analyzing page\u2026</div>'
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  function renderPageContent() {
    const pm = tradingState.pageMetrics
    const lines = []
    if (pm?.description) {
      lines.push(`<div style="font-size:10px;color:#9aa0c0;margin-bottom:4px"><b style="color:#eef0ff">Description:</b> ${esc(pm.description.substring(0, 120))}${pm.description.length > 120 ? "…" : ""}</div>`)
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
          lines.push(`<div style="font-size:10px;color:#eef0ff;padding-left:${indent}px">${esc(h.text.substring(0, 50))}${h.text.length > 50 ? "…" : ""}</div>`)
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
          lines.push(`<div style="font-size:10px;color:#9aa0c0">→ ${esc(l)}</div>`)
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
      lines.push(`<code style="font-size:9px;color:#6c63ff;background:#0d0d1a;padding:2px 4px;border-radius:3px;display:block;margin-top:2px">npm run dev</code>`)
    }
    const assets = tradingState.assets
    if (assets.length > 0) {
      lines.push(`<div style="border-top:1px solid #6c63ff20;margin:4px 0"></div>`)
      lines.push(`<div style="font-weight:600;font-size:10px;color:#6c63ff;margin-bottom:2px">Live Data</div>`)
      for (const a of assets.slice(0, 4)) {
        const c = tone(a.changePct)
        lines.push(`<div style="display:flex;justify-content:space-between;font-size:11px">` +
          `<span>${esc(a.name)}</span>` +
          `<span style="font-weight:600">${a.price != null ? esc(a.price) : "\u2026"}</span></div>`)
      }
    }
    if (!serverOnline && assets.length === 0) {
      lines.push(`<div style="font-size:10px;color:#9aa0c0;margin-top:4px">Extension will still detect page data, prices, and content.</div>`)
    }
    // Show last fetch error for debugging
    if (tradingState.lastFetchError) {
      lines.push(`<div style="border-top:1px solid #6c63ff20;margin:4px 0"></div>`)
      lines.push(`<div style="font-size:9px;color:#ff6b6b;margin-top:2px">Last error: ${esc(tradingState.lastFetchError)}</div>`)
    }
    // Show active asset being tracked
    if (tradingState.activeAsset) {
      lines.push(`<div style="font-size:9px;color:#6c63ff;margin-top:2px">Tracking: ${esc(tradingState.activeAsset)}</div>`)
    }
    return `<div style="padding:2px 0">${lines.join("")}</div>`
  }

  // ── Data Sources Honesty Renderer ─────────────────────────────────────────
  function renderDataSources() {
    const sources = tradingState.sources
    const STATUS_META = {
      live: { color: "#4ade80" },
      local: { color: "#60a5fa" },
      stale: { color: "#f59e0b" },
      unconfigured: { color: "#9aa0c0" }
    }
    if (!sources || typeof sources !== "object") {
      if (serverOnline === false || isTimedOut()) return offlineBanner()
      return '<div style="color:#a5a0ff;padding:4px">Checking data source health\u2026</div>' + sourceLabel("api/trading/health")
    }
    const entries = Object.entries(sources).filter(([, s]) => s && s.status)
    if (!entries.length) {
      return '<div style="color:#a5a0ff;padding:4px">No source report available</div>' + sourceLabel("api/trading/health")
    }
    const problems = entries.filter(([, s]) => s.status === "stale" || s.status === "unconfigured")
    const unconfCount = entries.filter(([, s]) => s.status === "unconfigured").length
    const staleCount = entries.filter(([, s]) => s.status === "stale").length
    const overallColor = problems.length === 0 ? "#4ade80" : (unconfCount >= 3 || staleCount >= 3 || sources.candles?.status === "unconfigured") ? "#ff6b6b" : "#f59e0b"
    const overallLabel = problems.length === 0 ? "All feeds healthy" : overallColor === "#ff6b6b" ? "System degraded" : "Partial degradation"
    const HINTS = {
      candles: { unconfigured: "Open a chart on the trading platform \u2014 this tab feeds candles to PICC", stale: "Feed idle \u2014 keep the platform tab open, or restart the server" },
      sentiment: { unconfigured: "Set Serper API key to enable news sentiment", stale: "Sentiment cache old \u2014 will refresh on next analysis" },
      orderflow: { unconfigured: "Waiting for candle feed", stale: "Derived from stale candles" },
      regime: { unconfigured: "Waiting for candle feed", stale: "Derived from stale candles" },
      expiry: { unconfigured: "Waiting for candle feed", stale: "Derived from stale candles" },
      kelly: { unconfigured: "Close paper trades to calibrate sizing", stale: "Trade history is old \u2014 results may not reflect current edge" }
    }
    const header = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` +
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${overallColor}"></span>` +
      `<span style="font-weight:600;font-size:11px;color:${overallColor}">${overallLabel}</span>` +
      `<span style="font-size:9px;color:#9aa0c0">${entries.length - problems.length}/${entries.length} ok</span>` +
      (sources.candles?.feed ? `<span style="font-size:8px;font-weight:700;color:#60a5fa;background:#60a5fa22;border:1px solid #60a5fa55;border-radius:3px;padding:0 4px;margin-left:auto">FEED: ${esc(String(sources.candles.feed).toUpperCase())}</span>` : "") +
      `</div>`
    const rows = entries.map(([name, info]) => {
      const meta = STATUS_META[info.status] || STATUS_META.unconfigured
      const hint = (HINTS[name] || {})[info.status] || ""
      const updatedTxt = info.lastUpdate ? new Date(info.lastUpdate).toLocaleTimeString() : "never"
      const ageTxt = info.age != null ? info.age + "s" : "\u2014"
      return `<div style="padding:2px 0;border-bottom:1px solid #6c63ff15">` +
        `<div style="display:flex;justify-content:space-between;align-items:center">` +
        `<span style="font-size:11px;font-weight:600">${name}</span>` +
        `<span style="display:flex;align-items:center;gap:5px">` +
        `<span style="font-size:9px;color:#9aa0c0">${updatedTxt} \u00b7 ${ageTxt}</span>` +
        `<span style="font-size:8px;font-weight:700;color:${meta.color};background:${meta.color}22;border:1px solid ${meta.color}55;border-radius:3px;padding:0 4px">${info.status.toUpperCase()}</span>` +
        `</span></div>` +
        (hint ? `<div style="font-size:9px;color:#9aa0c0;margin-top:1px">\u2192 ${hint}</div>` : "") +
        `</div>`
    }).join("")
    return header + `<div style="margin-top:2px">${rows}</div>` + staleLabel()
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
    if (isEO) {
      try {
        const titleMatch = document.title.match(/^([A-Z0-9/.\s-]+?)\s*[-–—|]/)
        if (titleMatch) {
          const raw = titleMatch[1].trim()
          const cleaned = raw.replace(/\s*\(otc\)/gi, "").replace(/\s+/g, "").toUpperCase()
          if (cleaned.length >= 3 && cleaned.length <= 20 && /[A-Z]/.test(cleaned) && /\d/.test(cleaned)) {
            out.assetName = cleaned.replace("/", "")
          } else if (/^[A-Z]{2,6}$/.test(cleaned) || /^[A-Z]{3}\/[A-Z]{3}$/.test(cleaned)) {
            out.assetName = cleaned.replace("/", "")
          }
        }
      } catch {}
      try {
        const urlMatch = window.location.href.match(/asset[=/]([A-Za-z0-9._-]+)/i)
        if (urlMatch && !out.assetName) out.assetName = decodeURIComponent(urlMatch[1]).toUpperCase().replace(/[^A-Z0-9]/g, "")
      } catch {}
      try {
        if (!out.assetName) {
          for (const el of document.querySelectorAll("[class*='instrument'], [class*='pair'], [class*='active-asset'], [data-asset]")) {
            if (el.closest("[data-picc-overlay], [data-picc-dock]")) continue
            const t = (el.textContent || el.dataset.asset || "").trim()
            if (t && t.length >= 3 && t.length <= 24) {
              const cleaned = t.replace(/\s*\(otc\)/gi, "").replace(/\s+/g, "").toUpperCase()
              if (/^[A-Z]{3}\/[A-Z]{3}$/.test(cleaned) || /^[A-Z]{2,6}$/.test(cleaned)) {
                out.assetName = cleaned.replace("/", "")
                break
              }
            }
          }
        }
      } catch {}
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
  let tradingFetchInFlight = false
  let tradingAbortController = null
  // Exponential backoff while the server is unreachable (5s → 60s cap).
  // Prevents the offline state from hammering localhost with requests.
  let tradingOfflineBackoffMs = 0
  let tradingNextPollAllowedAt = 0

  async function fetchTradingData() {
    if (tradingFetchInFlight) return
    if (Date.now() < tradingNextPollAllowedAt) return
    tradingFetchInFlight = true
    tradingAbortController = new AbortController()
    const signal = tradingAbortController.signal
    try {
      if (!tradingState.loadingSince) tradingState.loadingSince = Date.now()
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
      tradingState.pageMetrics = collectPageMetricsLocal()

      // Use the consolidated server endpoint — returns ALL dockable data in one call
      let primaryRaw = tradingState.assets?.[0]?.name || tradingState.assets?.[0]?.id || "EURUSD"
      if (GARBAGE_ASSET_RE.test(primaryRaw)) primaryRaw = detectPrimaryAssetFromPage() || primaryRaw
      const primaryAsset = normalizeAssetId(primaryRaw)
      const resp = await serverFetch("/api/extension/trading-data", {
        method: "POST",
        body: { assetId: primaryAsset, candleCount: 100 },
        signal
      })
      if (signal.aborted) return
      if (resp && resp.ok) {
        tradingOfflineBackoffMs = 0
        tradingState.serverReachable = true
        tradingState.lastFetchError = null
        tradingState.lastFetchAt = Date.now()
        tradingState.loadingSince = 0
        // Use server-authoritative viewed asset (from EO's own WS stream)
        const serverViewed = resp.data?.viewed
        const activeAsset = serverViewed ? normalizeAssetId(serverViewed) : primaryAsset
        if (serverViewed && activeAsset !== tradingState.activeAsset) {
          // Asset switched — invalidate per-asset caches
          tradingState.regime = null
          tradingState.expiry = null
          tradingState.orderFlow = null
          tradingState.sentiment = null
          tradingState.lastCandles = null
          tradingState.entryLevels = null
          tradingState.entryHoverPrice = null
          tradingState.models = null
          tradingState.decisions = []
        }
        tradingState.activeAsset = activeAsset
        // Status / account — server balance is canonical when available
        const d = resp.data
        if (d?.status?.ok) {
          tradingState.paper = d.status.paper || null
          if (d.status.expertOption) {
            const eo = d.status.expertOption
            tradingState.account = {
              balance: eo.balance ?? tradingState.account?.balance ?? null,
              currency: eo.currency || "USD",
              demo: eo.demo,
              demoWallet: eo.demoWallet || null,
              realWallet: eo.realWallet || null
            }
            if (eo.balance != null) tradingState.demo = { ...tradingState.demo, balance: eo.balance }
          }
        }
        // Autopilot
        if (d?.autopilot) tradingState.autopilot = d.autopilot.config || d.autopilot
        // Demo
        if (d?.demo) tradingState.demo = d.demo
        // Open deals (multi-trade)
        if (d?.openDeals) tradingState.openDeals = d.openDeals
        // Decisions — sort: viewed asset first, then by EV
        if (d?.decisions) {
          const raw = Array.isArray(d.decisions) ? d.decisions : (d.decisions.decisions || [])
          raw.sort((a, b) => {
            const aMatch = (a.asset || a.assetId || "").toUpperCase() === activeAsset.toUpperCase()
            const bMatch = (b.asset || b.assetId || "").toUpperCase() === activeAsset.toUpperCase()
            if (aMatch !== bMatch) return aMatch ? -1 : 1
            return (b.ev || 0) - (a.ev || 0)
          })
          tradingState.decisions = raw
        }
        // Candles
        if (d?.candles?.length) {
          tradingState.lastCandles = d.candles
          tradingState.candleSource = d.candleSource || "unknown"
          const last = d.candles[d.candles.length - 1]
          const prev = d.candles[d.candles.length - 2]
          if (last) {
            const targetAsset = tradingState.activeAsset || primaryAsset
            const existing = tradingState.assets.find((a) => normalizeAssetId(a.name || a.id) === targetAsset)
            if (existing) {
              existing.price = last.close
              if (prev && prev.close) {
                existing.changePct = ((last.close - prev.close) / prev.close) * 100
                existing.change = last.close - prev.close
              }
            } else if (!tradingState.assets.find((a) => a.id === targetAsset)) {
              tradingState.assets.unshift({
                id: targetAsset,
                name: targetAsset,
                price: last.close,
                changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : 0,
                change: prev ? last.close - prev.close : 0
              })
            }
            // Cap assets array to prevent unbounded growth
            if (tradingState.assets.length > 8) tradingState.assets.length = 8
          }
        }
        // Advanced analytics
        if (d?.kelly) tradingState.kelly = d.kelly
        if (d?.regime) tradingState.regime = d.regime
        if (d?.expiry) tradingState.expiry = d.expiry
        if (d?.sentiment) tradingState.sentiment = d.sentiment
        if (d?.orderFlow) tradingState.orderFlow = d.orderFlow
        if (d?.entryLevels) tradingState.entryLevels = d.entryLevels
        if (d?.models) tradingState.models = d.models

        // Calibration panel — daily refresh, cached for 24h
        const CALIBRATION_REFRESH_MS = 24 * 60 * 60 * 1000
        if (Date.now() - tradingState.calibrationFetchedAt > CALIBRATION_REFRESH_MS) {
          tradingState.calibrationFetchedAt = Date.now()
          void serverFetch("/api/trading/health").then((h) => {
            if (h?.ok && h.data?.calibration) {
              tradingState.calibration = h.data.calibration
              updateAllDockables()
            }
          }).catch(() => {})
        }
        // Economic calendar (dividend suite's Ex-Date Calendar dockable) —
        // was stuck on "Loading…" forever because no renderer ever fed it.
        if (Date.now() - tradingState.calendarFetchedAt > 30 * 60 * 1000) {
          tradingState.calendarFetchedAt = Date.now()
          void serverFetch("/api/trading/calendar?days=7").then((cal) => {
            if (cal?.ok && cal.data?.events) {
              tradingState.calendar = cal.data
              updateAllDockables()
            }
          }).catch(() => {})
        }
      } else {
        // Consolidated endpoint failed — fallback to individual endpoints.
        // POLLING STORM GUARD: when the server is actually DOWN (not a data
        // hiccup), the fallback used to fire 10+ extra requests every 5s
        // forever, each one also re-scanning 4 ports in the background.
        tradingState.serverReachable = false
        tradingState.lastFetchError = resp?.error || "consolidated-failed"
        const offlineErrors = ["no server found", "server-unreachable", "extension-context-invalidated"]
        if (offlineErrors.includes(String(resp?.error || "").toLowerCase())) {
          tradingOfflineBackoffMs = Math.min(60_000, (tradingOfflineBackoffMs || 5_000) * 2)
          tradingNextPollAllowedAt = Date.now() + tradingOfflineBackoffMs
          tradingState.lastPollDelayMs = tradingOfflineBackoffMs
          return
        }
        if (signal.aborted) return
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
          tradingState.serverReachable = true
          tradingState.lastFetchError = null
          tradingState.lastFetchAt = Date.now()
          tradingState.loadingSince = 0
          tradingState.paper = statusVal.data?.paper || null
          if (statusVal.data?.expertOption) {
            const eo = statusVal.data.expertOption
            tradingState.account = {
              balance: eo.balance ?? tradingState.account?.balance ?? null,
              currency: eo.currency || "USD",
              demo: eo.demo,
              demoWallet: eo.demoWallet || null,
              realWallet: eo.realWallet || null
            }
            if (eo.balance != null) tradingState.demo = { ...tradingState.demo, balance: eo.balance }
          }
        }
        if (autopilotVal?.ok) tradingState.autopilot = autopilotVal.data?.config || autopilotVal.data
        if (demoVal?.ok) tradingState.demo = demoVal.data
        if (decisionsVal?.ok && decisionsVal.data?.decisions) tradingState.decisions = decisionsVal.data.decisions

        // Fetch candles + advanced analytics individually
        const useAsset = tradingState.activeAsset || primaryAsset
        const candleResp = await serverFetch("/api/trading/candles", { method: "POST", body: { assetId: useAsset, timeframe: 60, count: 100 }, signal })
        if (signal.aborted) return
        if (candleResp?.ok && candleResp.data?.candles?.length) {
          tradingState.lastCandles = candleResp.data.candles
          tradingState.candleSource = candleResp.data.source || "unknown"
          const last = candleResp.data.candles[candleResp.data.candles.length - 1]
          const prev = candleResp.data.candles[candleResp.data.candles.length - 2]
          if (last) {
            const targetAsset = tradingState.activeAsset || primaryAsset
            const existing = tradingState.assets.find((a) => normalizeAssetId(a.name || a.id) === targetAsset)
            if (existing) {
              existing.price = last.close
              if (prev && prev.close) {
                existing.changePct = ((last.close - prev.close) / prev.close) * 100
                existing.change = last.close - prev.close
              }
            } else if (!tradingState.assets.find((a) => a.id === targetAsset)) {
              tradingState.assets.unshift({
                id: targetAsset,
                name: targetAsset,
                price: last.close,
                changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : 0,
                change: prev ? last.close - prev.close : 0
              })
            }
            if (tradingState.assets.length > 8) tradingState.assets.length = 8
          }
        }
        const [kelly, regime, expiry, sentiment, orderFlow] = await Promise.allSettled([
          serverFetch("/api/trading/kelly"),
          serverFetch("/api/trading/regime", { method: "POST", body: { candles: tradingState.lastCandles } }),
          serverFetch("/api/trading/expiry", { method: "POST", body: { candles: tradingState.lastCandles } }),
          serverFetch("/api/trading/sentiment", { method: "POST", body: { symbol: useAsset } }),
          serverFetch("/api/trading/orderflow", { method: "POST", body: { candles: tradingState.lastCandles } }),
        ])
        for (const [key, val] of [["kelly", kelly], ["regime", regime], ["expiry", expiry], ["sentiment", sentiment], ["orderFlow", orderFlow]]) {
          const v = val.status === "fulfilled" ? val.value : null
          if (v?.ok) tradingState[key] = v.data
        }
      }
      if (tradingState.serverReachable && Date.now() - tradingState.sourcesFetchedAt > 20000) {
        tradingState.sourcesFetchedAt = Date.now()
        void serverFetch("/api/trading/health").then((h) => {
          if (h?.ok && h.data?.sources) {
            tradingState.sources = h.data.sources
            updateAllDockables()
          }
        }).catch(() => {})
      }
    } catch {
      tradingState.serverReachable = false
      tradingState.lastFetchError = "fetch-exception"
    } finally {
      tradingFetchInFlight = false
      if (tradingAbortController?.signal === signal) tradingAbortController = null
    }
  }

  function updateAllDockables() {
    const panels = {
      "price-ticker": renderPriceTicker,
      "positions": renderPositions,
      "portfolio": renderPortfolio,
      "ai-signals": renderAISignals,
      "risk-mgr": renderRiskManager,
      "autopilot": renderAutopilot,
      "kelly-sizing": renderKellySizing,
      "regime-detect": renderRegimeDetect,
      "order-flow": renderOrderFlow,
      "expiry-opt": renderExpiryOpt,
      "sentiment": renderSentiment,
      "calibration": renderCalibration,
      "entry-points": renderEntryPoints,
      "model-matrix": renderModelMatrix,
      "calendar": renderCalendar,
      "page-overview": renderPageOverview,
      "page-content": renderPageContent,
      "server-status": renderServerStatus,
      "data-sources": renderDataSources,
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
      // Per-renderer isolation: one malformed field must never abort the loop
      // and freeze every dockable after it (the old failure mode — panels
      // stuck on "Loading…" while polling silently kept failing).
      let html
      try {
        html = renderer()
      } catch (err) {
        html = '<div style="font-size:9px;color:#f59e0b;padding:2px">Render error \u2014 will retry</div>'
      }
      const dock = shadowRoot.getElementById(`__PICC_DOCK_${id}__`)
      if (!dock) continue
      const body = dock.querySelector("[data-picc-body]")
      if (body) body.innerHTML = html
      const gid = dockGroupMap[id]
      if (gid && groupActiveTab[gid] === id) {
        const gc = shadowRoot.getElementById(`__PICC_GROUP_${gid}__`)
        const gBody = gc?.querySelector("[data-picc-group-body]")
        if (gBody) gBody.innerHTML = html
      }
    }
  }

  function startTradingPoll() {
    if (tradingPollTimer) return
    fetchTradingData().then(updateAllDockables).catch(() => {})
    tradingPollTimer = setInterval(() => { fetchTradingData().then(updateAllDockables).catch(() => {}) }, 5000)
  }

  function stopTradingPoll() {
    if (tradingPollTimer) { clearInterval(tradingPollTimer); tradingPollTimer = null }
    if (tradingAbortController) { tradingAbortController.abort(); tradingAbortController = null }
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
    // Platform-kind honesty gate: the autopilot loop is ExpertOption-demo-only
    // server-side. On spot/equity/charting platforms, disable the automation
    // features by default so panels show "feature disabled" instead of
    // implying control this platform does not have. Binary platforms (EO,
    // Deriv, Quotex…) keep them enabled.
    if (siteInfo?.platformKind && siteInfo.platformKind !== "binary") {
      currentSettings.features = { ...(currentSettings.features || {}), automation: false, autopilot: false }
    }
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
      // Visibility changes can expose panels restored while hidden — re-clamp
      // so nothing sits outside the live viewport.
      requestAnimationFrame(reclampAllDockables)
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
      // Only toggle docks that are enabled in settings (not disabled via ⚙)
      const enabledDocks = activeDockables.filter((d) => currentSettings.dockables?.[d.id] !== false)
      const allHidden = enabledDocks.every((d) => {
        const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`)
        return dockEl && dockEl.style.display === "none"
      })
      enabledDocks.forEach((d) => {
        const dockEl = shadowRoot.getElementById(`__PICC_DOCK_${d.id}__`)
        if (dockEl) dockEl.style.display = allHidden ? "" : "none"
      })
      toggleBtn.textContent = allHidden ? "👁" : "👁\u200D\u2757"
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
        slider.addEventListener("change", () => {
          saveOverlayStateLocal()
          if (currentSite?.id) savePrefsForSite(currentSite.id, { overlaySettings: currentSettings }).catch(() => {})
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
            // Persist immediately so changes survive tab close
            saveOverlayStateLocal()
            if (currentSite?.id) savePrefsForSite(currentSite.id, { overlaySettings: currentSettings }).catch(() => {})
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
          cb.addEventListener("change", () => {
            currentSettings.features[key] = cb.checked
            saveOverlayStateLocal()
            if (currentSite?.id) savePrefsForSite(currentSite.id, { overlaySettings: currentSettings }).catch(() => {})
          })
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
      saveOverlayStateLocal()
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
      // Persist the close so auto-start honors it across reloads — the old
      // code only saved it server-side and the local check read a flag that
      // was never written, so a closed overlay resurrected on every reload.
      try {
        if (currentSite?.id) savePrefsForSite(currentSite.id, { overlay: false }).catch(() => {})
        const state = await new Promise((resolve) => {
          chrome.storage.local.get(MV3_STATE_KEY, (data) => resolve(data[MV3_STATE_KEY] || null))
        })
        chrome.storage.local.set({
          [MV3_STATE_KEY]: {
            ...(state || {}),
            siteId: currentSite?.id || state?.siteId || null,
            settings: { ...(state?.settings || currentSettings), overlay: false },
            timestamp: Date.now()
          }
        })
      } catch { /* storage unavailable */ }
      return
    }

    const siteInfo = detectSite(window.location.href)
    let overlaySettings = {}

    // MV3 fast-path: load local state instantly (no server roundtrip)
    try {
      const localState = await new Promise((resolve) => {
        chrome.storage.local.get(MV3_STATE_KEY, (data) => resolve(data[MV3_STATE_KEY] || null))
      })
      if (localState?.settings && localState.siteId === siteInfo?.id) {
        overlaySettings = { ...localState.settings, dockableLayout: localState.layout || {}, _siteSpecific: true }
        // Apply immediately, then refresh from server in background
        createOverlay(siteInfo, overlaySettings)
        // Background refresh from server (updates local if different)
        getPrefs().then((prefs) => {
          const sitePrefs = prefs[siteInfo?.id]
          if (sitePrefs?.overlaySettings) {
            const serverSettings = sitePrefs.overlaySettings
            // Only re-create if server has different settings
            if (JSON.stringify(serverSettings) !== JSON.stringify(overlaySettings)) {
              createOverlay(siteInfo, { ...serverSettings, _siteSpecific: true })
            }
          }
        }).catch(() => {})
        return
      }
    } catch { /* chrome.storage unavailable */ }

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
    // Explicit open clears a persisted close — auto-start may resume.
    try {
      if (currentSite?.id) savePrefsForSite(currentSite.id, { overlay: true }).catch(() => {})
      chrome.storage.local.get(MV3_STATE_KEY, (data) => {
        const state = data[MV3_STATE_KEY]
        if (state?.settings?.overlay === false) {
          chrome.storage.local.set({ [MV3_STATE_KEY]: { ...state, settings: { ...state.settings, overlay: true } } })
        }
      })
    } catch { /* ignore */ }
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
          playAlertSound("success")
          showToast("Autopilot", running ? "Stopped" : "Started", "success")
        } else {
          showToast("Autopilot", result?.error || "Server unreachable — try again", "error")
        }
      } catch {
        showToast("Autopilot", "Failed to toggle — server unreachable", "error")
      }
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
          showToast("Kill Switch", result?.error ? `Failed to stop autopilot — ${result.error}` : "Failed to stop autopilot — server unreachable.", "error")
        }
      } catch (err) {
        showToast("Kill Switch", `Kill switch failed: ${err?.message ?? err}`, "error")
      }
      btn.disabled = false
    }
    if (action === "close-deal") {
      const dealId = btn.getAttribute("data-deal-id")
      if (!dealId) return
      if (!window.confirm(`Close position ${dealId} early?`)) return
      btn.disabled = true
      try {
        const result = await serverFetch("/api/trading/demo/close", { method: "POST", body: { dealId } })
        if (result?.ok) {
          showToast("Position", `Close requested for ${dealId}`, "success")
          await fetchTradingData()
          updateAllDockables()
        } else {
          showToast("Position", result?.error || "Close failed — no connected demo session?", "error")
        }
      } catch (err) {
        showToast("Position", `Close failed: ${err?.message ?? err}`, "error")
      } finally {
        btn.disabled = false
      }
    }

    // ── Per-asset autopilot scope controls (ACTIVE asset) ──
    const activeAsset = String(tradingState.activeAsset || "").toUpperCase()
    if (activeAsset && (action === "apx-toggle" || action === "apx-conf-dec" || action === "apx-conf-inc")) {
      const auto = tradingState.autopilot || {}
      await saveAutopilotScope((list) => {
        let entry = list.find((a) => String(a.assetId).toUpperCase() === activeAsset)
        if (!entry) {
          entry = { assetId: activeAsset, enabled: true, duration: null, amount: null, minConfidence: null }
          list.push(entry)
        }
        if (action === "apx-toggle") {
          entry.enabled = !(entry.enabled !== false)
        } else {
          const cur = Number(entry.minConfidence ?? auto.minConfidence ?? 55)
          entry.minConfidence = Math.max(30, Math.min(95, action === "apx-conf-inc" ? cur + 5 : cur - 5))
        }
        return list
      })
    }

    // ── Simulate buy/sell from the entry-points dockable (paper trade) ──
    if (action === "entry-simulate") {
      const side = btn.getAttribute("data-side") === "down" ? "down" : "up"
      const price = Number(btn.getAttribute("data-price"))
      const symbol = String(tradingState.activeAsset || "EURUSD")
      const spot = Number(tradingState.entryLevels?.spot) || price
      const kellyPct = Number(tradingState.kelly?.kelly?.suggested) || 2
      const balance = Number(tradingState.account?.balance ?? 0)
      const amount = balance > 0 ? Math.max(1, Math.round(((kellyPct / 100) * balance) * 100) / 100) : 100
      const label = `${side.toUpperCase()} ${symbol} @ ${Number.isFinite(price) ? price : spot}`
      if (!window.confirm(`SIMULATE TRADE (paper only)\n\n${label}\nAmount: ${amount} (Kelly ${kellyPct}% of balance)\n\nOpen this paper position?`)) return
      btn.disabled = true
      try {
        const result = await serverFetch("/api/trading/paper/trade", {
          method: "POST",
          body: { symbol, side, entry: spot || price, amount },
          timeout: 8000
        })
        if (result?.ok) {
          playAlertSound("success")
          showToast("Paper trade", `Simulated ${label} · $${amount}`, "success")
        } else {
          showToast("Paper trade", result?.error || "Simulation failed — is the paper engine available?", "error")
        }
      } catch (err) {
        showToast("Paper trade", `Failed: ${err?.message ?? err}`, "error")
      } finally {
        btn.disabled = false
      }
    }
  })

  // ── Entry-points hover → host-chart projection — delegated so it survives
  // re-renders. The hovered price is displayed ON THE BROKER'S LIVE CHART and
  // tracks it in realtime via the rAF loop inside hostChartShow().
  shadowRoot.addEventListener("mousemove", (e) => {
    const row = e.composedPath().find((el) => el.hasAttribute?.("data-entry-hover-price"))
    const price = row ? Number(row.getAttribute("data-entry-hover-price")) : NaN
    if (Number.isFinite(price)) {
      if (tradingState.entryHoverPrice !== price) {
        tradingState.entryHoverPrice = price
        drawEntryChart() // fallback strip (only present without a host chart)
      }
      hostChartShow(price)
    } else if (tradingState.entryHoverPrice != null) {
      tradingState.entryHoverPrice = null
      drawEntryChart()
      hostChartHide()
    }
  }, true)

  // Duration select needs a change event, not click.
  shadowRoot.addEventListener("change", async (e) => {
    const el = e.composedPath().find((node) => node?.getAttribute?.("data-picc-action") === "apx-duration")
    if (!el) return
    const activeAsset = String(tradingState.activeAsset || "").toUpperCase()
    if (!activeAsset) return
    const value = Number(el.value) || 60
    await saveAutopilotScope((list) => {
      let entry = list.find((a) => String(a.assetId).toUpperCase() === activeAsset)
      if (!entry) {
        entry = { assetId: activeAsset, enabled: true, duration: null, amount: null, minConfidence: null }
        list.push(entry)
      }
      entry.duration = value
      return list
    })
  })

  // ── Message listener from background/popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "toggle-overlay") { toggleOverlay(); return false }
    if (msg.action === "get-metrics") { sendResponse(collectPageMetrics()); return false }
    if (msg.action === "server-status") {
      const prevOnline = serverOnline
      serverOnline = msg.online
      serverPort = msg.port || null
      updateServerStatus()
      // Toast on status transitions (not on initial load)
      if (prevOnline !== null && prevOnline !== msg.online) {
        if (msg.online) {
          showToast("Server Online", "PICC backend reconnected on port " + (msg.port || "?"), "success")
        } else {
          showToast("Server Offline", "PICC backend unreachable — panels may show stale data.", "warning")
        }
      }
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

  // ── Auto-start on trading platforms ────────────────────────────────────────
  // On recognized trading suites, auto-create the overlay immediately — no
  // manual keyboard shortcut or popup click required.
  void (async function _autoStartOverlay() {
    try {
      const autoSite = detectSite(window.location.href)
      if (autoSite?.suite) {
        let shouldAutoStart = true
        try {
          const localState = await new Promise((resolve) => {
            chrome.storage.local.get(MV3_STATE_KEY, (data) => resolve(data[MV3_STATE_KEY] || null))
          })
          if (localState?.siteId === autoSite.id && localState.settings?.overlay === false) {
            shouldAutoStart = false
          }
        } catch {}
        if (shouldAutoStart && !overlayVisible) {
          setTimeout(() => { if (!overlayVisible) toggleOverlay() }, 800)
        }
      }
    } catch {}
  })()
})()
