import { useCallback, useEffect, useRef, useState } from "react"
import { SUITE_DOCKABLES, type DockableConfig } from "@/lib/overlaySettings"

/**
 * DockablePreview — a full-viewport preview of all overlay dockables for a suite.
 * Shows every dockable panel in its default position with full interactive behaviors:
 * drag, edge-dock, resize, opacity, collapse, show/hide.
 *
 * This is a React-only simulation of the content.js overlay system so the user
 * can preview and arrange dockables without needing the extension installed.
 */

const EDGE_DOCK_THRESHOLD = 24
const MIN_DOCK_W = 200
const MIN_DOCK_H = 100

interface DockableState {
  id: string
  config: DockableConfig
  visible: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  opacity: number
  collapsed: boolean
  dragging: boolean
  resizing: boolean
  pinned: boolean
}

function positionFromLabel(label: string, idx: number, total: number, vw: number, vh: number): { x: number; y: number } {
  const margin = 16
  const cols = Math.ceil(Math.sqrt(total))
  const row = Math.floor(idx / cols)
  const col = idx % cols
  const cellW = (vw - margin * 2) / cols
  const cellH = (vh - margin * 2) / Math.ceil(total / cols)

  switch (label) {
    case "top-left": return { x: margin, y: margin }
    case "top-right": return { x: vw - 280 - margin, y: margin }
    case "bottom-left": return { x: margin, y: vh - 180 - margin }
    case "bottom-right": return { x: vw - 280 - margin, y: vh - 180 - margin }
    case "left": return { x: margin, y: margin + row * cellH + 20 }
    case "right": return { x: vw - 280 - margin, y: margin + row * cellH + 20 }
    default: return { x: col * cellW + margin, y: margin + row * cellH }
  }
}

function clampEdge(pos: { x: number; y: number }, size: { width: number; height: number }, vw: number, vh: number) {
  let { x, y } = pos
  // Snap to edges
  if (x < EDGE_DOCK_THRESHOLD) x = 0
  if (y < EDGE_DOCK_THRESHOLD) y = 0
  if (x + size.width > vw - EDGE_DOCK_THRESHOLD) x = vw - size.width
  if (y + size.height > vh - EDGE_DOCK_THRESHOLD) y = vh - size.height
  // Clamp to viewport
  x = Math.max(0, Math.min(vw - size.width, x))
  y = Math.max(0, Math.min(vh - size.height, y))
  return { x, y }
}

function DockablePanel({
  dock,
  onDragStart,
  onDrag,
  onDragEnd,
  onResizeStart,
  onResize,
  onResizeEnd,
  onToggleCollapse,
  onTogglePin,
  onOpacityChange,
  onClose,
}: {
  dock: DockableState
  onDragStart: (e: React.MouseEvent, id: string) => void
  onDrag: (e: MouseEvent, id: string) => void
  onDragEnd: (e: MouseEvent, id: string) => void
  onResizeStart: (e: React.MouseEvent, id: string) => void
  onResize: (e: MouseEvent, id: string) => void
  onResizeEnd: (e: MouseEvent, id: string) => void
  onToggleCollapse: (id: string) => void
  onTogglePin: (id: string) => void
  onOpacityChange: (id: string, val: number) => void
  onClose: (id: string) => void
}) {
  const dockRef = useRef<HTMLDivElement>(null)

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
      style={{
        position: "fixed",
        left: dock.position.x,
        top: dock.position.y,
        width: dock.size.width,
        height: dock.collapsed ? 36 : dock.size.height,
        opacity: dock.opacity,
        background: "rgba(13, 13, 26, 0.92)",
        border: dock.pinned ? "1px solid var(--accent, #6c63ff)" : "1px solid rgba(42, 42, 74, 0.8)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        zIndex: dock.dragging ? 100 : 10,
        transition: dock.dragging || dock.resizing ? "none" : "opacity 0.2s, border-color 0.2s",
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

        {/* Pin toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(dock.id) }}
          title={dock.pinned ? "Unpin" : "Pin to top"}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: dock.pinned ? "var(--accent, #6c63ff)" : "var(--text-muted, #9aa0c0)",
            fontSize: 12, padding: "0 2px", lineHeight: 1,
          }}
        >📌</button>

        {/* Collapse toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(dock.id) }}
          title={dock.collapsed ? "Expand" : "Collapse"}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted, #9aa0c0)", fontSize: 14, padding: "0 2px", lineHeight: 1,
          }}
        >{dock.collapsed ? "▸" : "▾"}</button>

        {/* Close */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(dock.id) }}
          title="Hide panel"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted, #9aa0c0)", fontSize: 14, padding: "0 2px", lineHeight: 1,
          }}
        >✕</button>
      </div>

      {/* Content body (placeholder for preview) */}
      {!dock.collapsed && (
        <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-muted, #9aa0c0)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{dock.config.description}</span>
            </div>
            <div style={{ marginTop: 4, padding: "6px 8px", background: "rgba(108, 99, 255, 0.08)", borderRadius: 4, fontSize: 10 }}>
              {dock.config.defaultSize.width}×{dock.config.defaultSize.height} · {dock.config.defaultPosition}
              {dock.pinned ? " · 📌 pinned" : ""}
            </div>
          </div>
        </div>
      )}

      {/* Opacity slider (visible when not collapsed) */}
      {!dock.collapsed && (
        <div style={{ padding: "4px 10px 6px" }}>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(dock.opacity * 100)}
            onChange={(e) => onOpacityChange(dock.id, Number(e.target.value) / 100)}
            title={`Opacity: ${Math.round(dock.opacity * 100)}%`}
            style={{ width: "100%", height: 3 }}
          />
        </div>
      )}

      {/* Resize handle (bottom-right corner) */}
      {!dock.collapsed && (
        <div
          onMouseDown={(e) => onResizeStart(e, dock.id)}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
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
    }))
  })

  // Keyboard shortcut to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      return {
        ...d,
        dragging: true,
        _dragStart: { mouseX: e.clientX, mouseY: e.clientY, elX: d.position.x, elY: d.position.y },
      }
    }))
  }, [])

  const handleDrag = useCallback((e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id || !d.dragging) return d
      const ds = (d as any)._dragStart
      if (!ds) return d
      const newX = ds.elX + (e.clientX - ds.mouseX)
      const newY = ds.elY + (e.clientY - ds.mouseY)
      const pos = clampEdge({ x: newX, y: newY }, d.size, window.innerWidth, window.innerHeight)
      return { ...d, position: pos }
    }))
  }, [])

  const handleDragEnd = useCallback((_e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      const { _dragStart, ...rest } = d as any
      return { ...rest, dragging: false }
    }))
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      return {
        ...d,
        resizing: true,
        _resizeStart: { mouseX: e.clientX, mouseY: e.clientY, w: d.size.width, h: d.size.height },
      }
    }))
  }, [])

  const handleResize = useCallback((e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id || !d.resizing) return d
      const rs = (d as any)._resizeStart
      if (!rs) return d
      return {
        ...d,
        size: {
          width: Math.max(MIN_DOCK_W, rs.w + (e.clientX - rs.mouseX)),
          height: Math.max(MIN_DOCK_H, rs.h + (e.clientY - rs.mouseY)),
        },
      }
    }))
  }, [])

  const handleResizeEnd = useCallback((_e: MouseEvent, id: string) => {
    setDocks((prev) => prev.map((d) => {
      if (d.id !== id) return d
      const { _resizeStart, ...rest } = d as any
      return { ...rest, resizing: false }
    }))
  }, [])

  const toggleCollapse = useCallback((id: string) => {
    setDocks((prev) => prev.map((d) => d.id === id ? { ...d, collapsed: !d.collapsed } : d))
  }, [])

  const togglePin = useCallback((id: string) => {
    setDocks((prev) => prev.map((d) => d.id === id ? { ...d, pinned: !d.pinned } : d))
  }, [])

  const setOpacity = useCallback((id: string, val: number) => {
    setDocks((prev) => prev.map((d) => d.id === id ? { ...d, opacity: val } : d))
  }, [])

  const hideDock = useCallback((id: string) => {
    setDocks((prev) => prev.map((d) => d.id === id ? { ...d, visible: false } : d))
  }, [])

  const resetAll = useCallback(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    setDocks((prev) => prev.map((d, i) => ({
      ...d,
      visible: true,
      position: positionFromLabel(d.config.defaultPosition, i, prev.length, vw, vh),
      size: { ...d.config.defaultSize },
      opacity: d.config.defaultOpacity,
      collapsed: d.config.defaultCollapsed,
      pinned: false,
    })))
  }, [])

  const visibleCount = docks.filter((d) => d.visible).length

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
          <span className="muted small" style={{ opacity: 0.6 }}>
            {visibleCount}/{docks.length} panels visible · Drag panels to reposition · ESC to close
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={resetAll}
            style={{
              background: "rgba(108, 99, 255, 0.15)",
              border: "1px solid rgba(108, 99, 255, 0.3)",
              borderRadius: 6,
              color: "#eef0ff",
              padding: "4px 12px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Reset Layout
          </button>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 107, 107, 0.15)",
              border: "1px solid rgba(255, 107, 107, 0.3)",
              borderRadius: 6,
              color: "#eef0ff",
              padding: "4px 12px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Dockable panels */}
      {docks.map((dock) => (
        <DockablePanel
          key={dock.id}
          dock={dock}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
          onToggleCollapse={toggleCollapse}
          onTogglePin={togglePin}
          onOpacityChange={setOpacity}
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
          gap: 16,
          padding: "10px 20px",
          background: "rgba(13, 13, 26, 0.85)",
          borderTop: "1px solid rgba(42, 42, 74, 0.5)",
          zIndex: 200,
          fontFamily: "11px/1.5 system-ui, sans-serif",
          color: "var(--text-muted, #9aa0c0)",
        }}
      >
        {docks.map((d) => (
          <button
            key={d.id}
            onClick={() => setDocks((prev) => prev.map((p) => p.id === d.id ? { ...p, visible: !p.visible } : p))}
            style={{
              background: d.visible ? "rgba(108, 99, 255, 0.2)" : "transparent",
              border: `1px solid ${d.visible ? "var(--accent, #6c63ff)" : "var(--border, #333)"}`,
              borderRadius: 4,
              color: d.visible ? "#eef0ff" : "var(--text-muted, #9aa0c0)",
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
