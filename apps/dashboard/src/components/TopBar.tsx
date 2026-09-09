import { useLocation } from "react-router-dom"
import { NotificationCenter } from "@/components/NotificationCenter"
import { SUITE_META } from "@/lib/suites"

const TITLES: Record<string, string> = {
  "/": "Command Center",
  "/suites": "Suites",
  "/opportunities": "Opportunities",
  "/settings": "Settings",
  "/profile": "Profile"
}

// Real ministry context: inside /suites/:suiteId/... show the ministry's label
// (Trading, Earnings, Intelligence for PICC) instead of falling back to "PICC".
function suiteTitleFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/suites\/([^/]+)/)
  if (!match) return null
  const meta = SUITE_META[match[1]]
  return meta ? meta.label : null
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
  const title = suiteTitleFromPath(pathname) ?? TITLES[pathname] ?? "PICC"

  return (
    <header className="topbar">
      <button type="button" className="topbar-burger" onClick={onToggleSidebar} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        ☰
      </button>
      <span className="topbar-title">{title}</span>
      <button type="button" className="topbar-search" onClick={onOpenPalette} aria-label="Open command palette" title="Command palette">
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
