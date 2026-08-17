import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { signOutLocal } from "@/lib/auth"
import { useAuth } from "@/hooks/useAuth"
import { isFeatureOn } from "@/lib/settings"
import type { FeatureKey } from "@/lib/settings"
import { CommandPalette } from "@/components/CommandPalette"
import { TopBar } from "@/components/TopBar"
import { browserOverlay, browserOverlayToggle, browserTab, getBrowserStatus, getHealth, openBrowser } from "@/lib/api"
import type { HealthInfo } from "@/lib/api"

/**
 * Route external "open in new tab" links into the PICC in-app browser instead of
 * a separate Chrome/Edge window, so every platform page keeps PICC intervention
 * (overlay, autofill, safe automation). Internal PICC links, downloads and
 * modified clicks (Ctrl/Cmd) are left untouched.
 */
function useExternalLinkRouter() {
  useEffect(() => {
    const onCaptureClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const el = (e.target as Element | null)?.closest?.("a")
      if (!el || el.target !== "_blank" || el.hasAttribute("download")) return
      let url: URL
      try {
        url = new URL(el.href, window.location.href)
      } catch {
        return
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return
      if (url.origin === window.location.origin) return
      e.preventDefault()
      void (async () => {
        try {
          const s = await getBrowserStatus()
          if (!s.open) await openBrowser()
          await browserOverlayToggle(true)
          await browserTab({ action: "new", url: url.href })
        } catch {
          window.open(url.href, "_blank", "noopener,noreferrer")
        }
      })()
    }
    document.addEventListener("click", onCaptureClick, true)
    return () => document.removeEventListener("click", onCaptureClick, true)
  }, [])
}

const NAV: { section: string; items: { to: string; label: string; icon: string; feature: FeatureKey | null }[] }[] = [
  {
    section: "Command",
    items: [
      { to: "/", label: "Dashboard", icon: "▦", feature: null },
      { to: "/simulator", label: "Simulator", icon: "📊", feature: "simulator" },
      { to: "/agents", label: "Agents", icon: "🤖", feature: "agents" },
      { to: "/opportunities", label: "Opportunities", icon: "🧭", feature: "opportunities" }
    ]
  },
  {
    section: "Financial",
    items: [
      { to: "/suites", label: "Suites", icon: "📈", feature: "trading" },
      { to: "/income", label: "Income", icon: "💰", feature: "income" }
    ]
  },
  {
    section: "Account",
    items: [
      { to: "/settings", label: "Settings", icon: "⚙️", feature: null },
      { to: "/profile", label: "Profile", icon: "👤", feature: null }
    ]
  }
]

function useSidebarState() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("picc.sidebar.collapsed") === "1"
    } catch {
      return false
    }
  })
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem("picc.sidebar.collapsed", next ? "1" : "0")
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }
  return { collapsed, toggle }
}

function ShellFooter() {
  const [health, setHealth] = useState<HealthInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = () =>
      getHealth()
        .then((h) => { if (!cancelled) setHealth(h) })
        .catch(() => { if (!cancelled) setHealth(null) })
    poll()
    const id = window.setInterval(poll, 10_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [])

  const connected = health?.ok === true
  return (
    <div className="shell-footer">
      <span className="shell-footer-item">
        <span className={`dock-dot ${connected ? "dock-success" : "dock-danger"}`} />
        <span className="muted small">{connected ? "Server connected" : "Server offline"}</span>
      </span>
      <span className="shell-footer-item muted small">
        PICC {health?.version ?? "—"}
      </span>
    </div>
  )
}

export function AppShell() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { collapsed, toggle } = useSidebarState()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useExternalLinkRouter()

  // Hide overlays when navigating within PICC to avoid display conflicts
  useEffect(() => {
    void getBrowserStatus()
      .then((s) => { if (s.open) return browserOverlay({ clear: true }) })
      .catch(() => {})
  }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const signOut = async () => {
    await signOutLocal()
    navigate("/login")
  }

  const visibleSections = NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.feature === null || isFeatureOn(item.feature))
  })).filter((section) => section.items.length > 0)

  return (
    <div className={collapsed ? "shell collapsed" : "shell"}>
      <TopBar collapsed={collapsed} onToggleSidebar={toggle} onOpenPalette={() => setPaletteOpen(true)} />
      <div className="shell-body">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">🧠</span>
            <div className="brand-text">
              <strong>PICC</strong>
              <span className="brand-sub">Passive Income Command Center</span>
            </div>
          </div>
          <nav className="nav">
            {visibleSections.map((section) => (
              <div key={section.section} className="nav-section">
                <div className="nav-section-title">{section.section}</div>
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            {session ? (
              <button className="btn btn-ghost btn-sm" onClick={signOut}>
                Sign out
              </button>
            ) : null}
          </div>
        </aside>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <ShellFooter />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
