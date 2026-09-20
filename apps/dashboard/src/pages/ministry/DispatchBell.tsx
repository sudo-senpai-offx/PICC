import { useEffect, useState } from "react"
import { NavLink } from "react-router-dom"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { fetchDispatch } from "@/lib/dispatch"

export function DispatchBell() {
  const { snapshot } = useRealtimeSuite()
  const liveUnread = snapshot?.dispatch?.unread ?? null
  const [fallback, setFallback] = useState<number | null>(null)

  useEffect(() => {
    if (liveUnread != null) return
    let alive = true
    fetchDispatch().then((inbox) => { if (alive) setFallback(inbox.unread) }).catch(() => {})
    return () => { alive = false }
  }, [liveUnread])

  const unread = liveUnread ?? fallback ?? 0
  return (
    <NavLink to="dispatch" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
      <span className="nav-label">Dispatch</span>
      {unread > 0 ? <span className="nav-badge" aria-label={`${unread} unread`}>{unread}</span> : null}
    </NavLink>
  )
}