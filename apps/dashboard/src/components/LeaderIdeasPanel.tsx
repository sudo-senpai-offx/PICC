import { useEffect, useState } from "react"
import { Badge, Card } from "@/components/ui"
import {
  getLeaderIdeas,
  type LeaderGuardCell,
  type LeaderIdea,
  type LeaderIdeaRow,
  type LeaderIdeasOverview
} from "@/lib/api"

// Honesty contract: every cell renders what the readout reports — deny reasons
// verbatim, unverified as a muted badge (never a deny, never a pass), and
// absent/errored data as "not-wired"; nothing absent ever reads as a pass.
export function LeaderIdeasPanel() {
  const [data, setData] = useState<LeaderIdeasOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getLeaderIdeas()
      .then((res) => {
        if (!alive) return
        if (!res.ok) throw new Error("leader-ideas readout reported not ok")
        setData(res)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "leader-ideas readout failed")
      })
    return () => { alive = false }
  }, [])

  let body: React.ReactNode
  const leaders = data?.leaders
  if (error) {
    body = (
      <div className="muted small" aria-label="leader ideas honesty">
        not-wired — leader-ideas readout unavailable: {error}
      </div>
    )
  } else if (data?.storeUnhealthy) {
    body = (
      <div className="muted small" aria-label="leader ideas honesty">
        not-wired — {data.deny ?? "leader:deny:store-unhealthy"}
      </div>
    )
  } else if (leaders && leaders.length > 0) {
    body = leaders.map((ldr) => <LeaderCard key={ldr.id} leader={ldr} />)
  } else if (data) {
    body = (
      <div className="muted small" aria-label="leader ideas honesty">
        not-wired — no leaders reported
      </div>
    )
  } else {
    body = <div className="muted small">loading leader-ideas readout…</div>
  }

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Leader ideas</div>
      {body}
    </Card>
  )
}

function LeaderCard({ leader }: { leader: LeaderIdea }) {
  const trust = leader.platformTrust
  const trustValue = trust?.value ?? "UNVERIFIED"
  const trustBadge = trustValue === "VERIFIED"
    ? { tone: "success" as const, label: "verified" }
    : trustValue === "ADVERSARIAL"
      ? { tone: "danger" as const, label: "adversarial" }
      : { tone: "muted" as const, label: "unverified" }
  const hasIdeas = Array.isArray(leader.ideas) && leader.ideas.length > 0
  return (
    <div
      aria-label={`leader idea ${leader.id}`}
      style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{leader.label}</span>
        <Badge tone="accent">{leader.source}</Badge>
        <Badge tone={leader.status === "auto-unfollowed" ? "warn" : "muted"}>{leader.status}</Badge>
        <Badge tone={trustBadge.tone}>{trustBadge.label}</Badge>
      </div>

      {leader.deny && (
        <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>{leader.deny}</div>
      )}

      <div className="row gap" style={{ flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
        {leader.qualification?.verdict === "qualified" ? (
          <Badge tone="success">qualified</Badge>
        ) : leader.qualification?.deny ? (
          <Badge tone="danger">denied</Badge>
        ) : (
          <Badge tone="danger">unqualified</Badge>
        )}
        {leader.qualification?.deny ? (
          <span style={{ color: "var(--danger)" }}>{leader.qualification.deny}</span>
        ) : leader.qualification?.verdict === "qualified" ? null : (
          <span className="muted small">qualification not-wired</span>
        )}
      </div>

      <div className="muted small" style={{ marginTop: 4, fontSize: 11 }}>
        auto-unfollow: {guardCell(leader.guard?.autoUnfollow)} · 7d stop: {guardCell(leader.guard?.sevenDay)}
      </div>

      <div style={{ marginTop: 6 }}>
        <div className="muted small" style={{ fontSize: 11 }}>
          ideas
        </div>
        {hasIdeas ? (
          leader.ideas.map((row) => <IdeaRow key={row.id} row={row} />)
        ) : (
          <div className="muted small">ideas not-wired</div>
        )}
      </div>
    </div>
  )
}

function guardCell(guard: LeaderGuardCell | null | undefined): string {
  if (guard == null) return "not-wired"
  if (guard.active) return guard.reason ?? "active — no reason recorded"
  return "not engaged"
}

function IdeaRow({ row }: { row: LeaderIdeaRow }) {
  const closed = row.closedAt != null
  const pnl = row.pnlAfterCosts
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11, marginTop: 3 }}>
      <Badge tone={closed ? "muted" : "accent"}>{row.direction}</Badge>
      <span className="muted small">
        {row.asset} · size ${row.sizeUsd.toLocaleString()} · pnl {pnl == null ? "–" : `$${pnl}`}
      </span>
    </div>
  )
}