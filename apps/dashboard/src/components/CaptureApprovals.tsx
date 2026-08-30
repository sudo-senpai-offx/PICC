import { useEffect, useState } from "react"
import { Card, Badge } from "@/components/ui"
import { getInterventions, respondIntervention, type InterventionProposal } from "@/lib/api"

// Capture-approval queue (T9 gate / headless-capture engine). The capture
// engine's FIRST observation of a venue session needs a human decision before
// any token is saved — the "capture" proposals live in the same interventions
// review queue as workflow steps, but NO surface ever rendered them, so a
// logged-in venue could sit at "awaiting approval" forever with no button to
// approve it. This card is that surface.
//
// Honest by construction: it renders ONLY pending capture proposals. When
// there is nothing pending (or the API is unreachable) the card is absent —
// it never claims "all approved" or "nothing to do".
const POLL_MS = 10_000

export function CaptureApprovals() {
  const [pending, setPending] = useState<InterventionProposal[]>([])

  useEffect(() => {
    let alive = true
    const poll = () => {
      getInterventions()
        .then((st) => {
          if (!alive) return
          setPending(Array.isArray(st.proposals) ? st.proposals.filter((p) => p.source === "capture" && p.status === "pending") : [])
        })
        .catch(() => {
          if (alive) setPending([]) // unreachable / unauthenticated — render nothing, never a fabricated list
        })
    }
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (pending.length === 0) return null

  const decide = async (id: string, decision: "approve" | "reject") => {
    try {
      const st = await respondIntervention(id, decision)
      setPending(Array.isArray(st.proposals) ? st.proposals.filter((p) => p.source === "capture" && p.status === "pending") : [])
    } catch {
      // leave the row visible so the human can retry — a failed approval is
      // never silently swallowed into "done"
    }
  }

  return (
    <Card className="stack">
      <div className="row-between">
        <h2 className="h2" style={{ margin: 0 }}>⚖️ Capture approvals needed</h2>
        <Badge tone="warn">{pending.length}</Badge>
      </div>
      <p className="muted small">
        The headless-capture engine observed a session on one of your venue tabs and is waiting for a human
        decision before anything is saved. Approving saves the token it already sees on your logged-in tab;
        nothing is bought, sold or executed.
      </p>
      <ul className="list">
        {pending.map((p) => (
          <li key={p.id} className="list-row">
            <span className="stack">
              <strong>{p.workflowName}</strong>
              <span className="muted small">{p.label}</span>
            </span>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => decide(p.id, "approve")}>
                Approve
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => decide(p.id, "reject")}>
                Reject
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}