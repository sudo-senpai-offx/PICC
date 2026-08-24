(() => {
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ESC[c])
  const SYMS = { USD: "$", EUR: "\u20ac", GBP: "\u00a3", JPY: "\u00a5", CAD: "C$", AUD: "A$", CHF: "CHF ", INR: "\u20b9" }
  const sym = (currency) => SYMS[String(currency || "USD").toUpperCase()] || `${String(currency || "").toUpperCase()} `
  const money = (n, currency) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return "\u2014"
    return `${v < 0 ? "-" : ""}${sym(currency)}${Math.abs(v).toFixed(2)}`
  }
  const clock = (iso) => {
    const t = Date.parse(iso)
    return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 19) : ""
  }

  function piccRenderAutopilotPanel(state = {}) {
    const auto = state.auto || {}
    const demo = state.demo || {}
    const ap = demo.autopilot || {}
    const now = Number(state.now) > 0 ? Number(state.now) : Date.now()
    const rows = []

    const cap = Math.max(0, Math.round(Number(ap.maxDailyTrades ?? auto.maxDailyTrades) || 0))
    const done = Math.max(0, Math.round(Number(demo.todayTrades) || 0))
    const capHit = cap > 0 && done >= cap
    const lossPct = Number(ap.dailyLossLimitPct ?? auto.dailyLossLimitPct) || 10
    const startBal = Number(ap.dayStartBalance ?? auto.dayStartBalance) || 0
    const lossCapAmount = startBal > 0 ? (startBal * lossPct) / 100 : null
    const pnl = Number(demo.todayPnl) || 0
    const lossHit = lossCapAmount != null && pnl <= -lossCapAmount
    const running = Boolean(auto.enabled)

    const badgeText = demo.demo === true ? "DEMO" : demo.demo === false ? "LIVE" : "\u2014"
    const badgeColor = demo.demo === false ? "#ff6b6b" : demo.demo === true ? "#4ade80" : "#9aa0c0"
    const badge =
      `<span style="margin-left:auto;font-size:9px;font-weight:700;padding:0 5px;border-radius:3px;` +
      `border:1px solid ${badgeColor}66;color:${badgeColor};background:${badgeColor}18">${badgeText}</span>`

    let stateName = "Idle"
    let stateColor = "#a5a0ff"
    if (running && (capHit || lossHit)) {
      stateName = "Paused"
      stateColor = "#f59e0b"
    } else if (running) {
      stateName = "Running"
      stateColor = "#4ade80"
    }
    const pauseNote =
      running && (capHit || lossHit)
        ? `<span style="font-size:9px;color:#f59e0b">safety limit</span>`
        : ""

    rows.push(
      `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` +
        `<div style="width:8px;height:8px;border-radius:50%;background:${stateColor}"></div>` +
        `<span style="font-weight:600;font-size:11px;color:${stateColor}">${stateName}</span>` +
        pauseNote +
        badge +
        `</div>`
    )

    let healthName = "Disconnected"
    let healthColor = "#ff6b6b"
    if (demo.connected) {
      healthName = "Connected"
      healthColor = "#4ade80"
    } else if (/expir|invalid|stale|token|reject/i.test(String(demo.sessionError || ""))) {
      healthName = "Expired"
      healthColor = "#f59e0b"
    }
    const healthTitle = demo.sessionError && !demo.connected ? ` title="${esc(demo.sessionError)}"` : ""
    rows.push(
      `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Session</span>` +
        `<span${healthTitle} style="color:${healthColor}">${healthName}</span></div>`
    )

    // Phase 13 — live-tab liveness: "token cached, no live tab" is a
    // meaningfully different state than a real session behind the feed.
    if (demo.sessionLive != null) {
      const liveName = demo.sessionLive ? "Tab live" : "No live tab"
      const liveColor = demo.sessionLive ? "#4ade80" : "#f59e0b"
      const liveTitle = demo.sessionLiveReason ? ` title="${esc(demo.sessionLiveReason)}"` : ""
      rows.push(
        `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Browser</span>` +
          `<span${liveTitle} style="color:${liveColor}">${liveName}</span></div>`
      )
    }

    // Phase 14 — the actual answer to "why didn't it trade just now".
    if (ap.lastDecision) {
      rows.push(
        `<div style="font-size:9px;color:#9aa0c0;margin:3px 0;padding:3px 4px;background:#0d0d1a;border-radius:3px;` +
          `border-left:2px solid #6c63ff;word-break:break-word">` +
          `<span style="color:#6c63ff;font-weight:600">Last decision:</span> ${esc(ap.lastDecision)}</div>`
      )
    }

    const lr = ap.lastRun
    if (lr && lr.at) {
      const dir = lr.direction ? String(lr.direction).toUpperCase() : "\u2014"
      const dirColor = lr.direction === "call" ? "#4ade80" : lr.direction === "put" ? "#ff6b6b" : "#a5a0ff"
      const conf =
        lr.confidence != null && Number.isFinite(Number(lr.confidence)) ? ` ${Math.round(Number(lr.confidence))}%` : ""
      rows.push(
        `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Last signal</span>` +
          `<span style="color:${dirColor}">${esc(dir)}${conf} \u00b7 ${clock(lr.at)}</span></div>`
      )
    }

    if (auto.assetId) {
      rows.push(
        `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Asset</span><span>${esc(String(auto.assetId).toUpperCase())}</span></div>`
      )
    }
    if (auto.minConfidence != null && Number.isFinite(Number(auto.minConfidence))) {
      rows.push(
        `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Min confidence</span><span>${Math.round(Number(auto.minConfidence))}%</span></div>`
      )
    }

    const tradesLeft = cap > 0 ? Math.max(0, cap - done) : null
    rows.push(
      `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Safety \u00b7 trades</span>` +
        `<span style="color:${capHit ? "#f59e0b" : "#eef0ff"}">${done}${cap > 0 ? `/${cap}` : ""} \u00b7 ${tradesLeft == null ? "\u221e" : tradesLeft} left</span></div>`
    )
    const lossLeft = lossCapAmount != null ? Math.max(0, lossCapAmount - Math.max(0, -pnl)) : null
    rows.push(
      `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Safety \u00b7 loss</span>` +
        `<span style="color:${lossHit ? "#f59e0b" : "#eef0ff"}">${lossLeft == null ? "\u2014" : money(lossLeft, demo.currency)} left \u00b7 ${lossPct}% cap</span></div>`
    )

    if (demo.todayPnl != null && Number.isFinite(Number(demo.todayPnl))) {
      const pnlColor = pnl > 0 ? "#4ade80" : pnl < 0 ? "#ff6b6b" : "#a5a0ff"
      rows.push(
        `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Today PnL</span><span style="color:${pnlColor}">${money(pnl, demo.currency)}</span></div>`
      )
    }

    if (ap.lastDecision) {
      rows.push(`<div style="font-size:9px;color:#a5a0ff;margin-top:2px">Last: ${esc(ap.lastDecision)}</div>`)
    }

    const cdMs = Number(ap.cooldownMs ?? auto.cooldownMs) || 0
    const entryAt = Number(ap.lastEntryAt ?? auto.lastEntryAt) || 0
    if (running && entryAt > 0 && cdMs > 0) {
      const remaining = cdMs - (now - entryAt)
      if (remaining > 0) {
        const secs = Math.ceil(remaining / 1000)
        const mins = Math.floor(secs / 60)
        const remSecs = secs % 60
        const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`
        const width = Math.min(100, Math.max(0, Math.round(((cdMs - remaining) / cdMs) * 100)))
        rows.push(
          `<div style="margin-top:4px">` +
            `<div style="font-size:10px;color:#f59e0b;margin-bottom:2px">Review cooldown: ${timeStr}</div>` +
            `<div style="background:#1a1a2e;border-radius:3px;height:4px;overflow:hidden">` +
            `<div style="height:100%;width:${width}%;background:#f59e0b;border-radius:3px;transition:width 1s linear"></div>` +
            `</div></div>`
        )
      }
    }

    return rows.join("")
  }

  globalThis.piccRenderAutopilotPanel = piccRenderAutopilotPanel
})()
