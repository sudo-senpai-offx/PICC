import { Navigate, NavLink, useParams, useSearchParams } from "react-router-dom"
import { suiteMeta } from "@/lib/suites"
import { INNER_NAV } from "@/pages/MinistryShell"
import { getLastRoom } from "@/lib/ministryNav"
import { MarketsSuite } from "@/components/TradingSuite"

/**
 * Ministry index landing (/suites/:suiteId).
 *
 * Three branches, in order:
 * 1. Deep link (T6 / REQ-9): notification links carry ?asset=…&panel=chart
 *    and must land directly on the trading market panel — no redirect, no
 *    room history involved.
 * 2. Resume: the suite reopens on the room you last closed (per-suite
 *    lastRoom preference). A stored room that no longer exists falls through
 *    to the landing instead of a dead link.
 * 3. Default: fresh suite (no history) shows ONLY this suite's inner nav
 *    links — no marketing copy, no other-suite cards. The outer sidebar owns
 *    suite switching.
 */
export function Suites() {
  const { suiteId } = useParams<{ suiteId: string }>()
  const [searchParams] = useSearchParams()
  const meta = suiteMeta(suiteId)

  if (searchParams.has("asset") || searchParams.has("panel") || searchParams.has("venue")) {
    return (
      <div className="stack stack-lg">
        <header>
          <h1>{meta?.label ?? "Suites"}</h1>
        </header>
        <MarketsSuite />
      </div>
    )
  }

  if (suiteId && meta) {
    const entries = INNER_NAV[suiteId] ?? []
    const last = getLastRoom(suiteId, entries.map((e) => e.to))
    if (last) return <Navigate to={last} replace />

    return (
      <div className="stack stack-lg">
        <header>
          <h1>{meta.label}</h1>
        </header>
        <nav className="grid">
          {entries.map((e) => (
            <NavLink key={e.to} to={e.to} className="nav-link card">
              <div style={{ fontWeight: 600 }}>{e.label}</div>
            </NavLink>
          ))}
        </nav>
      </div>
    )
  }

  // Bare /suites (no id) — keep the redirect contract for any standalone use.
  const qs = searchParams.toString()
  return <Navigate to={`/suites/trading${qs ? `?${qs}` : ""}`} replace />
}