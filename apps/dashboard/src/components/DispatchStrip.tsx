// The Dispatch band of the Command Deck spine (PICC_COPILOT_REDESIGN ch.3):
// a first-class, compact view of the dispatch inbox (unread count + latest)
// with a direct link to the full Dispatch room. Rides the existing realtime
// snapshot — no new polls, no new dependency.
import { NavLink } from "react-router-dom"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { KIND_LABEL } from "@/lib/dispatch"
import { Card, Badge } from "@/components/ui"

const LATEST = 3

export function DispatchStrip() {
  const { snapshot } = useRealtimeSuite()
  const dispatch = snapshot?.dispatch ?? null
  const entries = dispatch?.entries?.slice(0, LATEST) ?? []

  return (
    <Card className="pad stack">
      <div className="row-between">
        <div className="row">
          <strong>Dispatch</strong>
          {dispatch ? (
            <Badge tone={dispatch.unread > 0 ? "warn" : "muted"}>{dispatch.unread} unread</Badge>
          ) : (
            <Badge tone="muted">no data yet</Badge>
          )}
        </div>
        <NavLink className="small" to="/suites/trading/dispatch">Open Dispatch →</NavLink>
      </div>
      {entries.length ? (
        <div className="stack small" style={{ marginTop: 4 }}>
          {entries.map((e) => (
            <div key={e.id} className="row-between muted small">
              <span>{KIND_LABEL[e.kind] ?? e.kind}: {e.title}</span>
              <span className="tiny">{new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Nothing dispatched yet — PICC is watching.</p>
      )}
    </Card>
  )
}