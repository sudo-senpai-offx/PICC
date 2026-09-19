import { NavLink, Outlet, useParams } from "react-router-dom"
import { suiteMeta } from "@/lib/suites"

export const INNER_NAV: Record<string, { to: string; label: string }[]> = {
  trading: [
    { to: "dashboard", label: "Dashboard" },
    { to: "markets", label: "Markets" },
    { to: "paper", label: "Paper" },
    { to: "autopilot", label: "Autopilot" },
    { to: "command-centre", label: "Command Centre" },
    { to: "simulator", label: "Simulator" },
    { to: "studio", label: "Studio" },
    { to: "settings", label: "Settings" }
  ],
  earnings: [
    { to: "dashboard", label: "Dashboard" },
    { to: "simulator", label: "Simulator" },
    { to: "studio", label: "Studio" },
    { to: "settings", label: "Settings" }
  ],
  intelligence: [
    { to: "dashboard", label: "Dashboard" },
    { to: "governor", label: "Governor" },
    { to: "guidance", label: "Guidance" },
    { to: "studio", label: "Studio" },
    { to: "settings", label: "Settings" }
  ]
}

export default function MinistryShell() {
  const { suiteId } = useParams<{ suiteId: string }>()
  const meta = suiteMeta(suiteId)
  if (!meta) return <p className="muted">Unknown ministry.</p>

  const entries = INNER_NAV[suiteId!] ?? []

  return (
    <div className="ministry-shell" data-theme={suiteId}>
      <aside className="ministry-sidebar">
        <div className="ministry-brand">
          <span style={{ fontSize: 22 }}>{meta.icon}</span>
          <div>
            <strong>{meta.label}</strong>
            <span className="muted small">{meta.status === "production" ? "production" : "under development"}</span>
          </div>
        </div>
        <nav className="nav">
          {entries.map((e) => (
            <NavLink
              key={e.to}
              to={e.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              <span className="nav-label">{e.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="ministry-content">
        <Outlet />
      </div>
    </div>
  )
}
