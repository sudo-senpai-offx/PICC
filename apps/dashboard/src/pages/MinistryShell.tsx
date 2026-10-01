import { NavLink, Outlet, useParams } from "react-router-dom"
import { suiteMeta } from "@/lib/suites"
import { DispatchBell } from "@/pages/ministry/DispatchBell"

export const INNER_NAV: Record<string, { to: string; label: string }[]> = {
  trading: [
    { to: "dashboard", label: "Dashboard" },
    { to: "markets", label: "Markets" },
    // WS-7 T7R-A — four keys added by owner ruling of 2026-09-30, recorded as an
    // amendment to WS-6 §0.3 "Room keys" (18/11 -> 22/15). Inserted at their D1
    // order positions: Markets -> Risk -> Ceremony -> Ministry -> Strategy ->
    // Paper/Live (`...MATURITY_v1.md:97`). This list is the ordered pin at
    // `__tests__/ministryRooms.test.tsx:165-177`, so the order is load-bearing.
    { to: "risk", label: "Risk" },
    { to: "ceremony", label: "Ceremony" },
    { to: "ministry", label: "Ministry" },
    { to: "strategy", label: "Strategy" },
    { to: "paper", label: "Paper" },
    { to: "autopilot", label: "Autopilot" },
    { to: "command-centre", label: "Command Centre" },
    { to: "dispatch", label: "Dispatch" },
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
          {entries.map((e) =>
            e.to === "dispatch" ? (
              <DispatchBell key={e.to} />
            ) : (
              <NavLink
                key={e.to}
                to={e.to}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                <span className="nav-label">{e.label}</span>
              </NavLink>
            )
          )}
        </nav>
      </aside>
      <div className="ministry-content">
        <Outlet />
      </div>
    </div>
  )
}
