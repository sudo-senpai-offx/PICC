import { useCallback, useEffect, useRef, useState } from "react"
import { SUITE_DOCKABLES, type DockableConfig } from "@/lib/overlaySettings"

const EDGE_DOCK_THRESHOLD = 24
const MIN_DOCK_W = 200
const MIN_DOCK_H = 100

interface DockableState {
  id: string
  config: DockableConfig
  visible: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  collapsed: boolean
  dragging: boolean
  resizing: boolean
  pinned: boolean
  group: string | null
  tabActive: boolean
}

// ── Placeholder content per dockable (represents what each panel actually shows) ──
function PlaceholderContent({ dockId, config }: { dockId: string; config: DockableConfig }) {
  const row = (label: string, value: string, valColor?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
      <span style={{ color: "#9aa0c0" }}>{label}</span>
      <span style={{ color: valColor || "#eef0ff", fontWeight: 500 }}>{value}</span>
    </div>
  )
  const bar = (pct: number, color: string) => (
    <div style={{ background: "#1a1a2e", borderRadius: 3, height: 6, overflow: "hidden", marginTop: 2 }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
    </div>
  )

  switch (dockId) {
    case "price-ticker":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {row("EUR/USD", "1.0842", "#4ade80")}
          {row("GBP/USD", "1.2631", "#ff6b6b")}
          {row("USD/JPY", "149.82", "#4ade80")}
          {row("BTC/USD", "67,420", "#ff6b6b")}
          {row("ETH/USD", "3,512", "#4ade80")}
          <div style={{ borderTop: "1px solid #6c63ff20", marginTop: 4, paddingTop: 4 }}>
            {row("Balance", "$10,247.50", "#6c63ff")}
          </div>
        </div>
      )
    case "portfolio":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: "#6c63ff", marginBottom: 2 }}>Paper Trading</div>
          {row("Cash", "$8,450.00")}
          {row("Committed", "$1,797.50")}
          {row("PnL", "+$247.50", "#4ade80")}
          {row("Win rate", "68%")}
          <div style={{ borderTop: "1px solid #6c63ff20", marginTop: 4, paddingTop: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 11, color: "#6c63ff", marginBottom: 2 }}>ExpertOption Demo</div>
            {row("Balance", "$5,120.00")}
            {row("Today", "+$82.30", "#4ade80")}
            {row("Trades", "12")}
          </div>
        </div>
      )
    case "ai-signals":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            { asset: "EUR/USD", verdict: "TRADE", dir: "UP", conf: "82%", color: "#4ade80" },
            { asset: "GBP/USD", verdict: "OBSERVE", dir: "—", conf: "54%", color: "#f59e0b" },
            { asset: "USD/JPY", verdict: "TRADE", dir: "DOWN", conf: "76%", color: "#ff6b6b" },
          ].map((sig) => (
            <div key={sig.asset} style={{ borderBottom: "1px solid #6c63ff15", paddingBottom: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 11 }}>{sig.asset}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: sig.color }}>{sig.verdict}</span>
              </div>
              <div style={{ display: "flex", gap: 6, fontSize: 9, color: "#9aa0c0" }}>
                <span>✓ conf</span><span>✓ prob</span><span>{sig.conf}</span>
                <span style={{ color: sig.color }}>{sig.dir}</span>
              </div>
            </div>
          ))}
        </div>
      )
    case "risk-mgr":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: "#6c63ff" }}>Daily Loss Limit</div>
          {bar(35, "#4ade80")}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9aa0c0" }}>
            <span>3.5% used</span><span>10% limit</span>
          </div>
          {row("Concurrent", "0/1")}
          {row("Trades today", "5/∞")}
          {row("Cooldown", "ready", "#4ade80")}
        </div>
      )
    case "autopilot":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontWeight: 600, fontSize: 11 }}>Running</span>
          </div>
          {row("Strategy", "Adaptive Confluence")}
          {row("Asset", "EUR/USD")}
          {row("Today PnL", "+$82.30", "#4ade80")}
          <div style={{ fontSize: 10, color: "#f59e0b" }}>Review cooldown: 2m 14s</div>
          {bar(65, "#f59e0b")}
          <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
            <div style={{ flex: 1, textAlign: "center", background: "#ff6b6b30", border: "1px solid #ff6b6b", borderRadius: 4, padding: "2px 0", fontSize: 10, color: "#ff6b6b" }}>Stop</div>
            <div style={{ textAlign: "center", background: "#ff6b6b30", border: "1px solid #ff6b6b", borderRadius: 4, padding: "2px 8px", fontSize: 10, color: "#ff6b6b" }}>Kill</div>
          </div>
        </div>
      )
    case "kelly-sizing":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {row("Win rate", "68%")}
          {row("Avg payout", "1.85x")}
          <div style={{ borderTop: "1px solid #6c63ff20", margin: "4px 0" }} />
          {row("Full Kelly", "12.4%", "#6c63ff")}
          {row("Suggested (half)", "6.2%", "#4ade80")}
          {row("Break-even WR", "35%")}
        </div>
      )
    case "regime-detect":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontWeight: 600, fontSize: 12, color: "#4ade80" }}>TRENDING</span>
            <span style={{ fontSize: 10, color: "#9aa0c0" }}>78%</span>
          </div>
          <div style={{ fontSize: 10, color: "#9aa0c0" }}>ADX: 34.2 · ATR ratio: 1.4x</div>
          {row("Strategy", "Momentum Follow", "#6c63ff")}
          <div style={{ fontSize: 9, color: "#9aa0c0" }}>EMA aligned · Volume rising · RSI neutral</div>
        </div>
      )
    case "order-flow":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 11 }}>Net Delta</span>
            <span style={{ color: "#4ade80", fontWeight: 600 }}>+142</span>
            <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "#4ade8030", color: "#4ade80" }}>buy-heavy</span>
          </div>
          {row("Avg delta", "23.7")}
          <div style={{ fontSize: 9, color: "#6c63ff" }}>⚡ Absorption detected at 1.0840</div>
          <div style={{ fontSize: 9, color: "#f59e0b" }}>⚡ Divergence: price up, delta flat</div>
        </div>
      )
    case "expiry-opt":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: "#6c63ff" }}>Recommended: 60s</div>
          <div style={{ fontSize: 10, color: "#9aa0c0" }}>Score: 87/100 · Vol: Medium</div>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            {[
              { label: "30s", score: 72 },
              { label: "60s", score: 87 },
              { label: "120s", score: 64 },
            ].map((e) => (
              <div key={e.label} style={{ flex: 1, textAlign: "center", fontSize: 9 }}>
                <div style={{ marginBottom: 2 }}>{e.label}</div>
                <div style={{ background: "#1a1a2e", borderRadius: 2, height: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${e.score}%`, background: "#6c63ff", borderRadius: 2 }} />
                </div>
                <div style={{ color: "#9aa0c0", marginTop: 1 }}>{e.score}</div>
              </div>
            ))}
          </div>
        </div>
      )
    case "sentiment":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: "#4ade80" }}>Bullish</span>
            <span style={{ fontSize: 10, color: "#9aa0c0" }}>Score: 0.34</span>
          </div>
          <div style={{ fontSize: 10, color: "#9aa0c0" }}>News: 12🟢 4🔴 6⚪ (22)</div>
          <div style={{ fontSize: 10, color: "#9aa0c0" }}>Social velocity: +8</div>
          <div style={{ fontSize: 9, color: "#6c63ff", marginTop: 2 }}>Weighted: News 0.4 · Social 0.3 · Technical 0.3</div>
        </div>
      )
    default:
      return (
        <div style={{ color: "#9aa0c0", fontSize: 11, padding: 4 }}>
          {config.description}
        </div>
      )
  }
}

function clampEdge(pos: { x: number; y: number }, size: { width: number; height: number }, vw: number, vh: number) {
  let { x, y } = pos
  if (x < EDGE_DOCK_THRESHOLD) x = 0
  if (y < EDGE_DOCK_THRESHOLD) y = 0
  if (x + size.width > vw - EDGE_DOCK_THRESHOLD) x = vw - size.width
  if (y + size.height > vh - EDGE_DOCK_THRESHOLD) y = vh - size.height
  x = Math.max(0, Math.min(vw - size.width, x))
  y = Math.max(0, Math.min(vh - size.height, y))
  return { x, y }
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

function positionFromLabel(label: string, idx: number, total: number, vw: number, vh: number): { x: number; y: number } {
  const margin = 16
  const cols = Math.ceil(Math.sqrt(total))
  const row = Math.floor(idx / cols)
  const col = idx % cols
  const cellW = (vw - margin * 2) / cols
  const cellH = (vh - margin * 2) / Math.ceil(total / cols)
  switch (label) {
    case "top-left": return { x: margin, y: margin + 50 }
    case "top-right": return { x: vw - 280 - margin, y: margin + 50 }
    case "bottom-left": return { x: margin, y: vh - 180 - margin - 40 }
    case "bottom-right": return { x: vw - 280 - margin, y: vh - 180 - margin - 40 }
    case "left": return { x: margin, y: margin + 50 + row * (cellH * 0.6) }
    case "right": return { x: vw - 280 - margin, y: margin + 50 + row * (cellH * 0.6) }
    default: return { x: col * cellW + margin, y: margin + 50 + row * cellH }
  }
}

// ── Grouped dock container (tabbed) ──
function GroupContainer({
  groupId,
  docks,
  globalOpacity,
  onTabSelect,
  onTabDragStart,
  onTabDrag,
  onTabDragEnd,
  onDragStart,
  onResizeStart,
  onToggleCollapse,
  onTogglePin,
  onClose,
}: {
  groupId: string
  docks: DockableState[]
  globalOpacity: number
  onTabSelect: (groupId: string, dockId: string) => void
  onTabDragStart: (e: React.MouseEvent, dockId: string) => void
  onTabDrag: (e: globalThis.MouseEvent, dockId: string) => void
  onTabDragEnd: (e: globalThis.MouseEvent, dockId: string) => void
  onDragStart: (e: React.MouseEvent, id: string) => void
  onResizeStart: (e: React.MouseEvent, id: string) => void
  onToggleCollapse: (id: string) => void
  onTogglePin: (id: string) => void
  onClose: (id: string) => void
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const activeDock = docks.find((d) => d.tabActive) || docks[0]
  if (!activeDock) return null

  // Tab drag listeners
  useEffect(() => {
    const draggingTab = docks.find((d) => (d as any)._tabDragging)
    if (!draggingTab) return
    const onMove = (e: MouseEvent) => onTabDrag(e, draggingTab.id)
    const onUp = (e: MouseEvent) => onTabDragEnd(e, draggingTab.id)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [docks, onTabDrag, onTabDragEnd])

  return (
    <div
      ref={groupRef}
      style={{
        position: "fixed",
        left: activeDock.position.x,
        top: activeDock.position.y,
        width: activeDock.size.width,
        height: activeDock.collapsed ? 36 : activeDock.size.height,
        opacity: globalOpacity,
        background: "rgba(13, 13, 26, 0.92)",
        border: activeDock.pinned ? "1px solid var(--accent, #6c63ff)" : "1px solid rgba(42, 42, 74, 0.8)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        zIndex: activeDock.dragging ? 100 : 10,
        transition: activeDock.dragging || activeDock.resizing ? "none" : "opacity 0.2s, border-color 0.2s",
        overflow: "hidden",
        fontFamily: "13px/1.5 system-ui, sans-serif",
        color: "#eef0ff",
      }}
    >
      {/* Tab bar */}
      <div
        onMouseDown={(e) => onDragStart(e, activeDock.id)}
        style={{
          display: "flex",
          alignItems: "center",
          background: activeDock.dragging ? "rgba(108, 99, 255, 0.15)" : "rgba(26, 26, 46, 0.6)",
          cursor: activeDock.dragging ? "grabbing" : "grab",
          borderBottom: "1px solid rgba(42, 42, 74, 0.4)",
          userSelect: "none",
          minHeight: 32,
        }}
      >
        {docks.map((d) => (
          <div
            key={d.id}
            onMouseDown={(e) => { e.stopPropagation(); onTabDragStart(e, d.id) }}
            onClick={(e) => { e.stopPropagation(); onTabSelect(groupId, d.id) }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: d.tabActive ? 600 : 400,
              color: d.tabActive ? "#eef0ff" : "#9aa0c0",
              background: d.tabActive ? "rgba(108, 99, 255, 0.12)" : "transparent",
              borderBottom: d.tabActive ? "2px solid #6c63ff" : "2px solid transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.15s",
              borderRight: "1px solid rgba(42, 42, 74, 0.3)",
            }}
          >
            <span style={{ fontSize: 12 }}>{d.config.icon}</span>
            <span>{d.config.title}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 2, padding: "0 6px" }}>
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(activeDock.id) }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: activeDock.pinned ? "#6c63ff" : "#9aa0c0",
              fontSize: 11, padding: "0 2px", lineHeight: 1,
            }}
          >📌</button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(activeDock.id) }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
            }}
          >{activeDock.collapsed ? "▸" : "▾"}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(activeDock.id) }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
            }}
          >✕</button>
        </div>
      </div>

      {/* Active tab content */}
      {!activeDock.collapsed && (
        <div style={{ padding: "8px 10px", overflow: "auto", maxHeight: activeDock.size.height - 36 }}>
          <PlaceholderContent dockId={activeDock.id} config={activeDock.config} />
        </div>
      )}

      {/* Resize handle */}
      {!activeDock.collapsed && (
        <div
          onMouseDown={(e) => onResizeStart(e, activeDock.id)}
          style={{
            position: "absolute", right: 0, bottom: 0, width: 16, height: 16,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 50%, rgba(108,99,255,0.4) 50%)",
            borderRadius: "0 0 10px 0",
          }}
        />
      )}
    </div>
  )
}

// ── Single standalone dock ──
function StandaloneDock({
  dock,
  globalOpacity,
  dropTarget,
  onDragStart,
  onDrag,
  onDragEnd,
  onResizeStart,
  onResize,
  onResizeEnd,
  onToggleCollapse,
  onTogglePin,
  onClose,
}: {
  dock: DockableState
  globalOpacity: number
  dropTarget: string | null
  onDragStart: (e: React.MouseEvent, id: string) => void
  onDrag: (e: globalThis.MouseEvent, id: string) => void
  onDragEnd: (e: globalThis.MouseEvent, id: string) => void
  onResizeStart: (e: React.MouseEvent, id: string) => void
  onResize: (e: globalThis.MouseEvent, id: string) => void
  onResizeEnd: (e: globalThis.MouseEvent, id: string) => void
  onToggleCollapse: (id: string) => void
  onTogglePin: (id: string) => void
  onClose: (id: string) => void
}) {
  const dockRef = useRef<HTMLDivElement>(null)
  const isDropTarget = dropTarget === dock.id

  useEffect(() => {
    if (!dock.dragging) return
    const onMove = (e: MouseEvent) => onDrag(e, dock.id)
    const onUp = (e: MouseEvent) => onDragEnd(e, dock.id)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [dock.dragging, dock.id, onDrag, onDragEnd])

  useEffect(() => {
    if (!dock.resizing) return
    const onMove = (e: MouseEvent) => onResize(e, dock.id)
    const onUp = (e: MouseEvent) => onResizeEnd(e, dock.id)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [dock.resizing, dock.id, onResize, onResizeEnd])

  if (!dock.visible) return null

  return (
    <div
      ref={dockRef}
      data-dock-id={dock.id}
      style={{
        position: "fixed",
        left: dock.position.x,
        top: dock.position.y,
        width: dock.size.width,
        height: dock.collapsed ? 36 : dock.size.height,
        opacity: globalOpacity,
        background: "rgba(13, 13, 26, 0.92)",
        border: isDropTarget
          ? "2px solid #6c63ff"
          : dock.pinned ? "1px solid var(--accent, #6c63ff)" : "1px solid rgba(42, 42, 74, 0.8)",
        borderRadius: 10,
        boxShadow: isDropTarget ? "0 0 20px rgba(108,99,255,0.4)" : "0 8px 32px rgba(0,0,0,.5)",
        zIndex: dock.dragging ? 100 : 10,
        transition: dock.dragging || dock.resizing ? "none" : "opacity 0.2s, border-color 0.2s, box-shadow 0.2s",
        overflow: "hidden",
        fontFamily: "13px/1.5 system-ui, sans-serif",
        color: "#eef0ff",
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={(e) => onDragStart(e, dock.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: dock.dragging ? "rgba(108, 99, 255, 0.15)" : "rgba(26, 26, 46, 0.6)",
          cursor: dock.dragging ? "grabbing" : "grab",
          borderBottom: "1px solid rgba(42, 42, 74, 0.4)",
          userSelect: "none",
          fontSize: 12,
        }}
      >
        <span style={{ fontSize: 14 }}>{dock.config.icon}</span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 12 }}>{dock.config.title}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(dock.id) }}
          title={dock.pinned ? "Unpin" : "Pin to top"}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: dock.pinned ? "#6c63ff" : "#9aa0c0",
            fontSize: 11, padding: "0 2px", lineHeight: 1,
          }}
        >📌</button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(dock.id) }}
          title={dock.collapsed ? "Expand" : "Collapse"}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
          }}
        >{dock.collapsed ? "▸" : "▾"}</button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(dock.id) }}
          title="Hide panel"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#9aa0c0", fontSize: 13, padding: "0 2px", lineHeight: 1,
          }}
        >✕</button>
      </div>

      {/* Content */}
      {!dock.collapsed && (
        <div style={{ padding: "8px 10px", overflow: "auto", maxHeight: dock.size.height - 36 }}>
          <PlaceholderContent dockId={dock.id} config={dock.config} />
        </div>
      )}

      {/* Resize handle */}
      {!dock.collapsed && (
        <div
          onMouseDown={(e) => onResizeStart(e, dock.id)}
          style={{
            position: "absolute", right: 0, bottom: 0, width: 16, height: 16,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 50%, rgba(108,99,255,0.4) 50%)",
            borderRadius: "0 0 10px 0",
          }}
        />
      )}
    </div>
  )
}

export function DockablePreview({ suiteId, onClose }: { suiteId: string; onClose: () => void }) {
  const configs = SUITE_DOCKABLES[suiteId] || SUITE_DOCKABLES.generic
  const [docks, setDocks] = useState<DockableState[]>(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200
    const vh = typeof window !== "undefined" ? window.innerHeight : 800
    return configs.map((c, i) => ({
      id: c.id,
      config: c,
      visible: true,
      position: positionFromLabel(c.defaultPosition, i, configs.length, vw, vh),
      size: { ...c.defaultSize },
      opacity: c.defaultOpacity,
      collapsed: c.defaultCollapsed,
      dragging: false,
      resizing: false,
      pinned: false,
      group: null,
      tabActive: true,
    }))
  })

  const [globalOpacity, setGlobalOpacity] = useState(0.92)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // ESC + backdrop close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      return { ...d, dragging: true, _dragStart: { mouseX: e.clientX, mouseY: e.clientY, elX: d.position.x, elY: d.position.y } } as any
    }))
  }, [])

  const handleDrag = useCallback((e: MouseEvent, id: string) => {
    setDocks((prev) => {
      let newDropTarget: string | null = null
      const updated = prev.map((d) => {
        if (d.id !== id || !d.dragging) return d
        const ds = (d as any)._dragStart
        if (!ds) return d
        const newX = ds.elX + (e.clientX - ds.mouseX)
        const newY = ds.elY + (e.clientY - ds.mouseY)
        const pos = clampEdge({ x: newX, y: newY }, d.size, window.innerWidth, window.innerHeight)
        // Check for drop targets (other visible non-grouped docks)
        for (const other of prev) {
          if (other.id === id || !other.visible || other.dragging || other.group) continue
          const overlap = rectsOverlap(
            { x: pos.x, y: pos.y, w: d.size.width, h: d.size.height },
            { x: other.position.x, y: other.position.y, w: other.size.width, h: other.size.height }
          )
          if (overlap) {
            newDropTarget = other.id
            break
          }
        }
        return { ...d, position: pos }
      })
      // Only update dropTarget if it changed
      if (newDropTarget !== dropTarget) setDropTarget(newDropTarget)
      return updated
    })
  }, [dropTarget])

  const handleDragEnd = useCallback((_e: MouseEvent, id: string) => {
    setDocks((prev) => {
      const dragged = prev.find((d) => d.id === id)
      const target = dropTarget
      setDropTarget(null)

      if (target && dragged) {
        // Group: put dragged dock into target's group (or create a new group)
        const targetDock = prev.find((d) => d.id === target)
        const groupId = targetDock?.group || `group-${target}-${Date.now()}`
        return prev.map((d) => {
          if (d.id === id) {
            const { _dragStart, ...rest } = d as any
            return { ...rest, dragging: false, group: groupId, tabActive: false, position: targetDock?.position || d.position, size: targetDock?.size || d.size }
          }
          if (d.id === target) {
            return { ...d, group: groupId, tabActive: true }
          }
          if (d.group === groupId && d.id !== target) {
            return { ...d, group: groupId, tabActive: false }
          }
          return d
        })
      }

      return prev.map((d) => {
        if (d.id !== id) return d
        const { _dragStart, ...rest } = d as any
        return { ...rest, dragging: false }
      })
    })
  }, [dropTarget])

  const handleResizeStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      return { ...d, resizing: true, _resizeStart: { mouseX: e.clientX, mouseY: e.clientY, w: d.size.width, h: d.size.height } } as any
    }))
  }, [])

  const handleResize = useCallback((e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id || !d.resizing) return d
      const rs = (d as any)._resizeStart
      if (!rs) return d
      const newSize = {
        width: Math.max(MIN_DOCK_W, rs.w + (e.clientX - rs.mouseX)),
        height: Math.max(MIN_DOCK_H, rs.h + (e.clientY - rs.mouseY)),
      }
      // If grouped, resize all docks in the group
      if (d.group) {
        return prev.map((gd) => gd.group === d.group ? { ...gd, size: newSize } : gd).find((gd) => gd.id === d.id) || d
      }
      return { ...d, size: newSize }
    }))
  }, [])

  const handleResizeEnd = useCallback((_e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      const { _resizeStart, ...rest } = d as any
      return { ...rest, resizing: false }
    }))
  }, [])

  // Tab drag (ungroup)
  const handleTabDragStart = useCallback((e: React.MouseEvent, dockId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDocks((prev) => prev.map((d) => {
      if (d.id !== dockId) return d
      return { ...d, _tabDragging: true, _tabDragStart: { mouseX: e.clientX, mouseY: e.clientY, elX: d.position.x, elY: d.position.y } } as any
    }))
  }, [])

  const handleTabDrag = useCallback((e: MouseEvent, dockId: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === dockId) as any
      if (!dock?._tabDragging) return prev
      const ds = dock._tabDragStart
      const dx = Math.abs(e.clientX - ds.mouseX)
      const dy = Math.abs(e.clientY - ds.mouseY)
      // Only ungroup if dragged far enough (not just a click)
      if (dx < 10 && dy < 10) return prev
      const groupId = dock.group
      if (!groupId) return prev
      // Ungroup: remove from group, create standalone
      return prev.map((d) => {
        if (d.id === dockId) {
          const { _tabDragging, _tabDragStart, ...rest } = d as any
          return { ...rest, group: null, tabActive: true, position: { x: e.clientX - 50, y: e.clientY - 16 }, _dragStart: { mouseX: e.clientX, mouseY: e.clientY, elX: e.clientX - 50, elY: e.clientY - 16 }, dragging: true }
        }
        // If only 2 in group and one leaves, dissolve group
        if (d.group === groupId) {
          const remaining = prev.filter((rd) => rd.group === groupId && rd.id !== dockId)
          if (remaining.length === 1) {
            return { ...d, group: null, tabActive: true }
          }
          return { ...d, tabActive: true }
        }
        return d
      })
    })
  }, [])

  const handleTabDragEnd = useCallback((_e: MouseEvent, dockId: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== dockId) return d
      const { _tabDragging, _tabDragStart, ...rest } = d as any
      return { ...rest, dragging: false }
    }))
  }, [])

  const toggleCollapse = useCallback((id: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === id)
      if (dock?.group) {
        return prev.map((d) => d.group === dock.group ? { ...d, collapsed: !d.collapsed } : d)
      }
      return prev.map((d) => d.id === id ? { ...d, collapsed: !d.collapsed } : d)
    })
  }, [])

  const togglePin = useCallback((id: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === id)
      if (dock?.group) {
        return prev.map((d) => d.group === dock.group ? { ...d, pinned: !d.pinned } : d)
      }
      return prev.map((d) => d.id === id ? { ...d, pinned: !d.pinned } : d)
    })
  }, [])

  const hideDock = useCallback((id: string) => {
    setDocks((prev) => {
      const dock = prev.find((d) => d.id === id)
      if (dock?.group) {
        const groupId = dock.group
        const remaining = prev.filter((d) => d.group === groupId && d.id !== id)
        if (remaining.length <= 1) {
          // Dissolve group
          return prev.map((d) => {
            if (d.id === id) return { ...d, visible: false, group: null }
            if (d.group === groupId) return { ...d, group: null, tabActive: true }
            return d
          })
        }
        return prev.map((d) => {
          if (d.id === id) return { ...d, visible: false, group: null }
          if (d.group === groupId && d.tabActive) {
            const next = remaining[0]
            return { ...d, tabActive: d.id === next.id }
          }
          return d
        })
      }
      return prev.map((d) => d.id === id ? { ...d, visible: false } : d)
    })
  }, [])

  const selectTab = useCallback((groupId: string, dockId: string) => {
    setDocks((prev) => prev.map((d) => d.group === groupId ? { ...d, tabActive: d.id === dockId } : d))
  }, [])

  const resetAll = useCallback(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    setDocks((prev) => prev.map((d, i) => ({
      ...d,
      visible: true,
      position: positionFromLabel(d.config.defaultPosition, i, prev.length, vw, vh),
      size: { ...d.config.defaultSize },
      collapsed: d.config.defaultCollapsed,
      pinned: false,
      group: null,
      tabActive: true,
    })))
  }, [])

  const visibleDocks = docks.filter((d) => d.visible)
  const ungrouped = visibleDocks.filter((d) => !d.group)
  const groups = new Map<string, DockableState[]>()
  for (const d of visibleDocks) {
    if (!d.group) continue
    if (!groups.has(d.group)) groups.set(d.group, [])
    groups.get(d.group)!.push(d)
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        background: "rgba(10, 10, 30, 0.7)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          background: "rgba(13, 13, 26, 0.85)",
          borderBottom: "1px solid rgba(42, 42, 74, 0.5)",
          zIndex: 200,
          fontFamily: "13px/1.5 system-ui, sans-serif",
          color: "#eef0ff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🎯</span>
          <strong>Overlay Preview</strong>
          <span style={{ opacity: 0.6, fontSize: 12 }}>
            {visibleDocks.length}/{docks.length} panels · Drag onto another dock to group · Drag tab out to ungroup · ESC to close
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Global opacity */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9aa0c0" }}>
            <span>Opacity</span>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(globalOpacity * 100)}
              onChange={(e) => setGlobalOpacity(Number(e.target.value) / 100)}
              title={`Opacity: ${Math.round(globalOpacity * 100)}%`}
              style={{ width: 80, height: 3 }}
            />
            <span style={{ width: 28, textAlign: "right" }}>{Math.round(globalOpacity * 100)}%</span>
          </div>
          <button
            onClick={() => setShowSettings((s) => !s)}
            style={{
              background: showSettings ? "rgba(108, 99, 255, 0.25)" : "rgba(108, 99, 255, 0.15)",
              border: "1px solid rgba(108, 99, 255, 0.3)",
              borderRadius: 6, color: "#eef0ff", padding: "4px 12px", cursor: "pointer", fontSize: 12,
            }}
          >
            ⚙ Settings
          </button>
          <button
            onClick={resetAll}
            style={{
              background: "rgba(108, 99, 255, 0.15)",
              border: "1px solid rgba(108, 99, 255, 0.3)",
              borderRadius: 6, color: "#eef0ff", padding: "4px 12px", cursor: "pointer", fontSize: 12,
            }}
          >
            ↺ Reset
          </button>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 107, 107, 0.15)",
              border: "1px solid rgba(255, 107, 107, 0.3)",
              borderRadius: 6, color: "#eef0ff", padding: "4px 12px", cursor: "pointer", fontSize: 12,
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Settings flyout */}
      {showSettings && (
        <div
          style={{
            position: "absolute",
            top: 52,
            right: 20,
            width: 240,
            background: "rgba(13, 13, 26, 0.95)",
            border: "1px solid #2a2a4a",
            borderRadius: 8,
            padding: 12,
            zIndex: 201,
            boxShadow: "0 8px 32px rgba(0,0,0,.5)",
            fontFamily: "12px/1.4 system-ui, sans-serif",
            color: "#eef0ff",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12, color: "#6c63ff", marginBottom: 8 }}>Panel Visibility</div>
          {docks.map((d) => (
            <label
              key={d.id}
              style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "3px 0",
                cursor: "pointer", opacity: d.visible ? 1 : 0.5,
              }}
            >
              <input
                type="checkbox"
                checked={d.visible}
                onChange={() => {
                  if (d.visible) hideDock(d.id)
                  else setDocks((prev) => prev.map((p) => p.id === d.id ? { ...p, visible: true } : p))
                }}
                style={{ width: 12, height: 12 }}
              />
              <span>{d.config.icon}</span>
              <span>{d.config.title}</span>
            </label>
          ))}
        </div>
      )}

      {/* Grouped dock containers */}
      {Array.from(groups.entries()).map(([groupId, groupDocks]) => (
        <GroupContainer
          key={groupId}
          groupId={groupId}
          docks={groupDocks}
          globalOpacity={globalOpacity}
          onTabSelect={selectTab}
          onTabDragStart={handleTabDragStart}
          onTabDrag={handleTabDrag}
          onTabDragEnd={handleTabDragEnd}
          onDragStart={handleDragStart}
          onResizeStart={handleResizeStart}
          onToggleCollapse={toggleCollapse}
          onTogglePin={togglePin}
          onClose={hideDock}
        />
      ))}

      {/* Standalone docks */}
      {ungrouped.map((dock) => (
        <StandaloneDock
          key={dock.id}
          dock={dock}
          globalOpacity={globalOpacity}
          dropTarget={dropTarget}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
          onToggleCollapse={toggleCollapse}
          onTogglePin={togglePin}
          onClose={hideDock}
        />
      ))}

      {/* Bottom legend */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "10px 20px",
          background: "rgba(13, 13, 26, 0.85)",
          borderTop: "1px solid rgba(42, 42, 74, 0.5)",
          zIndex: 200,
          fontFamily: "11px/1.5 system-ui, sans-serif",
          color: "#9aa0c0",
        }}
      >
        {docks.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              if (d.visible) hideDock(d.id)
              else setDocks((prev) => prev.map((p) => p.id === d.id ? { ...p, visible: true } : p))
            }}
            style={{
              background: d.visible ? "rgba(108, 99, 255, 0.2)" : "transparent",
              border: `1px solid ${d.visible ? "#6c63ff" : "#333"}`,
              borderRadius: 4,
              color: d.visible ? "#eef0ff" : "#9aa0c0",
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 11,
              transition: "all 0.15s",
            }}
          >
            {d.config.icon} {d.config.title}
          </button>
        ))}
      </div>
    </div>
  )
}
