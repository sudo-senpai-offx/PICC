import { useEffect, useMemo, useState } from "react"
import { Badge, Button, Card, Spinner } from "@/components/ui"
import {
  getBountyBoards,
  getOpportunities,
  getWorkflowTemplates,
  type BountyBoardResult,
  type Opportunity,
  type OpportunityCatalogResult,
  type WorkflowTemplate
} from "@/lib/api"

const STATUS_TONE: Record<Opportunity["status"], "success" | "warn" | "muted"> = {
  ready: "success",
  track: "warn",
  needs_research: "muted"
}

function effortStars(effort: Opportunity["effort"]) {
  return { low: "1", medium: "2", high: "3" }[effort] ?? "?"
}

export function Opportunities() {
  const [catalog, setCatalog] = useState<OpportunityCatalogResult | null>(null)
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([])
  const [boards, setBoards] = useState<BountyBoardResult[]>([])
  const [workflowNote, setWorkflowNote] = useState<string | null>(null)
  const [category, setCategory] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.allSettled([getOpportunities(), getWorkflowTemplates(), getBountyBoards()])
      .then(([cat, wf, bb]) => {
        if (!alive) return
        if (cat.status === "fulfilled") setCatalog(cat.value)
        if (wf.status === "fulfilled") {
          setWorkflows(wf.value.workflows)
          setWorkflowNote(wf.value.dirFound ? null : "Template repo not found — showing known PICC templates.")
        }
        if (bb.status === "fulfilled") setBoards(bb.value.boards)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        setError((err as Error).message)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const shown = useMemo(() => {
    if (!catalog) return []
    return category === "all"
      ? catalog.opportunities
      : catalog.opportunities.filter((o) => o.category === category)
  }, [catalog, category])

  if (loading) return <Spinner label="Loading the opportunity catalog…" />

  return (
    <div className="stack stack-lg">
      <header>
        <h1>Opportunities</h1>
        <p className="muted">
          The 2026 income-classification research (categories A–G) as an actionable backlog. Every
          entry is flagged by how well it was verified — nothing is oversold.
        </p>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="grid-2">
        {catalog?.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`card cat-chip${category === c.id ? " active" : ""}`}
            onClick={() => setCategory(category === c.id ? "all" : c.id)}
          >
            <div className="row space-between">
              <strong>
                {c.id} · {c.label}
              </strong>
              <Badge tone={category === c.id ? "accent" : "muted"}>{c.id}</Badge>
            </div>
            <p className="muted small">{c.blurb}</p>
          </button>
        ))}
      </div>

      <div className="row space-between">
        <h2 className="h2">
          {category === "all" ? "All opportunities" : `Category ${category}`}
          <span className="muted small"> · {shown.length}</span>
        </h2>
        {category !== "all" ? (
          <Button variant="ghost" onClick={() => setCategory("all")}>
            Clear filter
          </Button>
        ) : null}
      </div>

      {shown.length === 0 ? <p className="muted">Nothing in this category yet.</p> : null}

      <div className="grid-2">
        {shown.map((o) => (
          <Card key={o.id} className="stack">
            <div className="row space-between">
              <h3 className="h3">{o.title}</h3>
              <Badge tone={STATUS_TONE[o.status]}>
                {o.status === "ready" ? "Ready" : o.status === "track" ? "Track" : "Needs research"}
              </Badge>
            </div>
            <p className="small">{o.description}</p>
            <p className="muted small">
              <strong>Automates:</strong> {o.whatItAutomates}
            </p>
            <div className="row wrap gap">
              <Badge tone="muted">Effort {effortStars(o.effort)}/3</Badge>
              <Badge tone="muted">Value: {o.expectedValue}</Badge>
              {o.verified ? (
                <Badge tone="success">Verified</Badge>
              ) : (
                <Badge tone="warn">Unverified</Badge>
              )}
            </div>
            {o.integrations.length ? (
              <p className="muted small">
                <strong>Integrations:</strong> {o.integrations.join(" · ")}
              </p>
            ) : null}
            {o.sourceUrl ? (
              <a className="small" href={o.sourceUrl} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            ) : null}
          </Card>
        ))}
      </div>

      <Card className="stack">
        <div className="row space-between">
          <h2 className="h2">n8n workflow templates</h2>
          <Badge tone="muted">{workflows.length}</Badge>
        </div>
        {workflowNote ? <p className="muted small">{workflowNote}</p> : null}
        {workflows.length === 0 ? (
          <p className="muted">No templates found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Description</th>
                <th>Triggers</th>
                <th>Install</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((w) => (
                <tr key={w.file}>
                  <td>
                    <Badge>{w.name}</Badge>
                    {w.embedded ? <span className="muted small"> · bundled</span> : null}
                  </td>
                  <td className="small">{w.description}</td>
                  <td className="small">{(w.triggers ?? []).join(", ") || "manual"}</td>
                  <td className="small muted">{w.install}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="stack">
        <h2 className="h2">Agent-economy bounty boards</h2>
        {boards.length === 0 ? <p className="muted">Boards unavailable.</p> : null}
        <div className="grid-2">
          {boards.map((b) => (
            <div key={b.id} className="stack">
              <div className="row space-between">
                <strong>{b.name}</strong>
                <Badge tone={b.reachable ? "success" : "danger"}>
                  {b.reachable ? "Reachable" : "Unreachable"}
                </Badge>
              </div>
              <p className="muted small">{b.note}</p>
              {b.reachable ? (
                <p className="small">
                  {b.count != null && b.kind === "json"
                    ? `${b.count} open entry(ies)`
                    : b.pageTitle
                      ? `Page: ${b.pageTitle}`
                      : "Board responded."}
                </p>
              ) : (
                <p className="small form-error">Last scan: {b.error ?? "failed"}</p>
              )}
              <a className="small" href={b.url} target="_blank" rel="noreferrer">
                Open board ↗
              </a>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
