import { useEffect, useState } from "react"
import { AutopilotSuite, ProAnalysisCard, PredictionCard } from "@/components/TradingSuite"
import { ModelMatrixPanel } from "@/components/ModelMatrixPanel"
import { Badge, Button, Card, Spinner } from "@/components/ui"
import { getAutopilotDecisions, whyAutopilot } from "@/lib/trading"
import type { AutopilotDecisionEntry, AutopilotWhyResult } from "@/lib/trading"

type WhyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AutopilotWhyResult | null }
  | { status: "error"; message: string }

function directionTone(direction?: string | null): "success" | "danger" | "muted" {
  if (direction === "call" || direction === "up") return "success"
  if (direction === "put" || direction === "down") return "danger"
  return "muted"
}

function gateDetail(g: { name: string; pass: boolean; detail: string | null }): string {
  if (g.name === "token" && !g.pass) return "Needs credentials configured"
  return g.detail ?? "—"
}

function DecisionRow({
  d,
  why,
  onWhy
}: {
  d: AutopilotDecisionEntry
  why: WhyState
  onWhy: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card pad stack" style={{ gap: 6 }}>
      <div className="row-between">
        <strong className="small">{d.assetId ?? "—"}</strong>
        <div className="row gap">
          {d.trade ? <Badge tone="success">TRADE</Badge> : <Badge tone="muted">SKIP</Badge>}
          {d.direction ? (
            <Badge tone={directionTone(d.direction)}>{d.direction}</Badge>
          ) : null}
          {d.confidence != null ? <span className="muted small">{d.confidence}% conf</span> : null}
        </div>
      </div>
      <p className="muted small">{d.reason}</p>
      <div className="row-between muted small">
        <span>{new Date(d.at).toLocaleTimeString()}</span>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen((v) => !v)
            if (why.status === "idle") onWhy()
          }}
        >
          {open ? "hide why" : "why now?"}
        </Button>
      </div>
      {open ? (
        why.status === "loading" ? (
          <Spinner label="Checking the gate chain…" />
        ) : why.status === "error" ? (
          <p className="danger-text small">{why.message}</p>
        ) : why.status === "ready" ? (
          <div className="stack small" style={{ gap: 4 }}>
            <p className="muted">
              {why.data?.reason ?? "No answer yet."}
              {why.data?.wouldTrade ? "" : " Dry-run decision support only — no order is placed."}
            </p>
            <div className="stack" style={{ gap: 2 }}>
              {(why.data?.gates ?? []).map((g) => (
                <div className="row-between" key={g.name}>
                  <span>
                    {g.name} <span className="muted">{gateDetail(g)}</span>
                  </span>
                  <Badge tone={g.pass ? "success" : "warn"}>{g.pass ? "pass" : "fail"}</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted small" />
        )
      ) : null}
    </div>
  )
}

function AutopilotDecisionsCard() {
  const [decisions, setDecisions] = useState<AutopilotDecisionEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [whys, setWhys] = useState<Record<string, WhyState>>({})

  useEffect(() => {
    let alive = true
    getAutopilotDecisions(50)
      .then((g) => {
        if (!alive) return
        if (Array.isArray(g?.decisions)) setDecisions(g.decisions)
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : "decisions unavailable")
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  const askWhy = (assetId?: string) => {
    if (!assetId) return
    setWhys((prev) => ({ ...prev, [assetId]: { status: "loading" } }))
    whyAutopilot(assetId)
      .then((data) => {
        setWhys((prev) => ({ ...prev, [assetId]: { status: "ready", data } }))
      })
      .catch((e) => {
        setWhys((prev) => ({
          ...prev,
          [assetId]: { status: "error", message: e instanceof Error ? e.message : "why check failed" }
        }))
      })
  }

  const tally = (decisions ?? []).reduce<Record<string, number>>((acc, d) => {
    if (d.trade) return acc
    const gate = d.gate || "other"
    acc[gate] = (acc[gate] || 0) + 1
    return acc
  }, {})

  return (
    <Card className="pad stack">
      <div className="row-between">
        <div className="row">
          <strong>Autopilot Decisions</strong>
          {decisions ? (
            <span className="muted small">
              {decisions.length} in window · {decisions.filter((d) => d.trade).length} trade ·{" "}
              {decisions.filter((d) => !d.trade).length} skip
            </span>
          ) : null}
        </div>
        <Button variant="ghost" onClick={() => setReloadKey((k) => k + 1)}>
          refresh
        </Button>
      </div>

      {error && decisions == null ? <p className="danger-text small">{error}</p> : null}
      {decisions == null ? (
        error ? null : (
          <Spinner label="Loading decisions…" />
        )
      ) : decisions.length === 0 ? (
        <p className="muted small">
          No autopilot decisions recorded yet — decisions appear once the demo engine evaluates a tick.
        </p>
      ) : (
        <>
          <div className="stack" style={{ gap: 8 }}>
            {decisions.map((d, i) => (
              <DecisionRow
                key={i}
                d={d}
                why={whys[d.assetId ?? ""] ?? { status: "idle" }}
                onWhy={() => askWhy(d.assetId)}
              />
            ))}
          </div>
          {Object.keys(tally).length ? (
            <p className="muted small">
              rejection tally: {Object.entries(tally).map(([g, n]) => `${g} ${n}`).join(" · ")}
            </p>
          ) : null}
        </>
      )}
    </Card>
  )
}

export function AutopilotRoom() {
  return (
    <div className="stack">
      <header data-room="autopilot">
        <h2>Autopilot</h2>
        <p className="muted small">Automated demo-trading engine — configure scope and risk, monitor the engine, and inspect prediction and model confidence.</p>
      </header>
      <AutopilotDecisionsCard />
      <AutopilotSuite />
      <ProAnalysisCard />
      <PredictionCard recordSignal={() => {}} />
      <ModelMatrixPanel assetId="EURUSD" />
    </div>
  )
}