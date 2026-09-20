import { useEffect, useState } from "react"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { fetchDispatch, markDispatchRead } from "@/lib/dispatch"
import type { DispatchInbox } from "@/lib/dispatch"
import { KIND_LABEL, SEVERITY_LABEL } from "@/lib/dispatch"

export function DispatchRoom() {
  const { snapshot, connected } = useRealtimeSuite()
  const [inbox, setInbox] = useState<DispatchInbox | null>(null)

  useEffect(() => {
    let alive = true
    fetchDispatch().then((d) => { if (alive) setInbox(d) }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!snapshot?.dispatch) return
    setInbox({ ok: true, unread: snapshot.dispatch.unread, entries: snapshot.dispatch.entries })
  }, [snapshot])

  const entries = inbox?.entries ?? []

  return (
    <div className="stack">
      <header data-room="dispatch">
        <h2>Dispatch</h2>
        <p className="muted small">The copilot&apos;s notification spine — decisions, milestones, venue notices and system events.</p>
      </header>
      {!connected ? <p className="muted small">stream reconnecting — showing last known dispatch</p> : null}
      {inbox && entries.length === 0 ? (
        <div className="panel muted">
          <p>The registers are empty.</p>
          <p className="muted small">no dispatch yet — decisions, feed losses and venue notices appear here.</p>
        </div>
      ) : (
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((e) => (
            <li key={e.id} className="panel" data-severity={e.severity}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{e.title}</strong>
                <span className="muted small">{e.read ? "read" : "new"}</span>
              </div>
              {e.body ? <p className="muted small">{e.body}</p> : null}
              <div className="muted small">
                {KIND_LABEL[e.kind] ?? e.kind} · {SEVERITY_LABEL[e.severity] ?? e.severity}
              </div>
              {!e.read ? (
                <button
                  className="btn"
                  data-testid={`read-${e.id}`}
                  onClick={async () => {
                    try {
                      await markDispatchRead(e.id)
                      const fresh = await fetchDispatch()
                      setInbox(fresh)
                    } catch { /* honest no-op: entry stays unread */ }
                  }}
                >
                  Mark read
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}