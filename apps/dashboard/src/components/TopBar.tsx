import { useLocation } from "react-router-dom"
import { NotificationCenter } from "@/components/NotificationCenter"

const TITLES: Record<string, string> = {
  "/": "Command Center",
  "/simulator": "Simulator",
  "/suites": "Suites",
  "/agents": "Agents",
  "/opportunities": "Opportunities",
  "/income": "Income",
  "/settings": "Settings",
  "/profile": "Profile"
}

export function TopBar({
  collapsed,
  onToggleSidebar,
  onOpenPalette
}: {
  collapsed: boolean
  onToggleSidebar: () => void
  onOpenPalette: () => void
}) {
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? "PICC"

  return (
    <header className="topbar">
      <button type="button" className="topbar-burger" onClick={onToggleSidebar} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label="Toggle sidebar">
        ☰
      </button>
      <span className="topbar-title">{title}</span>
      <button type="button" className="topbar-search" onClick={onOpenPalette} title="Command palette">
        <span className="topbar-search-icon">⌕</span>
        <span className="topbar-search-text muted">Search, launch, control…</span>
        <kbd className="topbar-kbd">Ctrl K</kbd>
      </button>
      <div className="topbar-actions">
        <NotificationCenter />
        <button type="button" className="btn btn-sm btn-secondary" onClick={onOpenPalette}>
          ⚡ Actions
        </button>
      </div>
    </header>
  )
}
