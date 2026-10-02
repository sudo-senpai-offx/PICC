import { useEffect, useState } from "react"
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui"
import { getHealth, runAgentCrew } from "@/lib/api"
import type { HealthInfo } from "@/lib/api"
import { useUser } from "@/hooks/useAuth"
import { listData } from "@/lib/localdata"
import type { AgentLog } from "@/lib/types"
import { ReadOnlyRoom } from "@/terminal/routes/ReadOnlyRoom"
import { useReadOnlyView } from "./useReadOnlyView"
// WS-7 T14 / D11 — see the note at the `data-room="notifications"` block below.
import { SignalNotificationsCard } from "@/components/TradingSuite"

/**
 * WS-7 T10 — the three intelligence instances that were `HonestScaffold`.
 *
 * `HonestScaffold` rendered the literal words "under development" and no data at
 * all. That is a reserved placeholder, and AC-020:929 treats a reserved
 * placeholder as FAILING the room-completion criterion, so these three could not
 * stay as they were. Each is now the shared read-only room, and the read-only
 * record for each one states in its own `absences` what its producer actually
 * reports — which for the Governor and Settings rooms is service health and the
 * agents service's configuration, and for a default installation means two named
 * refusals rather than two figures.
 *
 * THE COMPONENT IS DELETED, NOT LEFT UNUSED, for the reason T8 gave when it
 * deleted its own two reserved bodies: an unused export of a placeholder reads as
 * a live fallback, and a later edit re-pointing the router at the import path
 * would find a placeholder waiting rather than a missing module. Nothing else in
 * the tree imports it — the grep is in the T10 test file.
 */
export function IntelligenceDashboardRoom() {
  const { view } = useReadOnlyView("dashboard", "intelligence")
  return <ReadOnlyRoom view={view} />
}

export function IntelligenceGovernorRoom() {
  const { view } = useReadOnlyView("governor", "intelligence")
  return <ReadOnlyRoom view={view} />
}

export function IntelligenceSettingsRoom() {
  const { view } = useReadOnlyView("settings", "intelligence")
  return (
    <div className="stack">
      <ReadOnlyRoom view={view} />
      {/* WS-7 T14 / D11 — the notifications section, NOT ministry-gated. This room
          was the read-only instance with ZERO write affordances, so its record had
          nothing to name; D11 puts notification configuration in the general
          Settings room, which this is, and the record now names the four routes
          the control writes. The same pre-existing SignalNotificationsCard is
          mounted here as in the other two settings rooms, so the configuration is
          one surface with one set of answers rather than three. */}
      <div className="card" data-room="notifications">
        <SignalNotificationsCard />
      </div>
    </div>
  )
}

const AGENT_ROLES = [
  { name: "Researcher", emoji: "🔎", crew: true, desc: "Finds trending products, topics, and market data." },
  { name: "Analyst", emoji: "📈", crew: true, desc: "Turns research into clear, actionable recommendations." },
  { name: "Content Creator", emoji: "✍️", crew: true, desc: "Writes platform-optimized scripts, posts, and reviews." },
  { name: "Listing Optimizer", emoji: "🛒", crew: true, desc: "Suggests Amazon listing improvements (read-only)." }
]

export function IntelligenceGuidanceRoom() {
  const user = useUser()
  // WS-7 T10 (d1Order 20) — the read-only record for this instance.
  const { view: readOnlyView } = useReadOnlyView("guidance", "intelligence")
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [topic, setTopic] = useState("What is a good passive income strategy in 2026?")
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null))
    if (!user) {
      setLoading(false)
      return
    }
    listData<AgentLog>("agent_logs")
      .then(({ rows }) => {
        setLogs(rows.filter((r) => r.user_id === user.id).slice(0, 20))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [user])

  const agentsOnline = Boolean(health?.agents?.ok)

  const runCrew = async () => {
    setRunning(true)
    setError(null)
    setReport(null)
    try {
      const data = await runAgentCrew({ crew: "research", inputs: { topic } })
      if (data.error) {
        setError(data.error)
      } else {
        setReport(data.report ?? "(empty report)")
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="stack stack-lg">
      {/* WS-7 T10 (d1Order 20) — the read-only record. Rendered ABOVE the crew
          panels so the three crew states — not configured, configured but
          unreachable, reachable — are structural before they are prose. */}
      <ReadOnlyRoom view={readOnlyView} />

      <header data-room="guidance">
        <h2>Guidance</h2>
        <p className="muted small">
          A CrewAI-style team of specialized agents works on your behalf. They advise — they never
          act for you.
        </p>
      </header>

      <div className="grid-2">
        {AGENT_ROLES.map((a) => (
          <Card key={a.name}>
            <div className="row space-between">
              <h3 className="h3">
                {a.emoji} {a.name}
              </h3>
              <Badge tone={agentsOnline ? "success" : "muted"}>
                ● {agentsOnline ? "Online" : "Offline"}
              </Badge>
            </div>
            <p className="muted">{a.desc}</p>
            <span className="badge badge-muted">CrewAI · decision-support only</span>
          </Card>
        ))}
      </div>

      <Card className="stack">
        <h2 className="h2">Run the research crew</h2>
        <p className="muted small">
          {agentsOnline
            ? "The CrewAI microservice is reachable — this runs the live Researcher → Analyst pipeline (needs OPENAI_API_KEY in agents/.env)."
            : "Start the agents service to run the live crew: `uvicorn server:app --port 8000` inside agents/picc_agents and set PICC_AGENTS_URL in the dashboard .env."}
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void runCrew()
          }}
        >
          <Field label="Research topic">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={running || !agentsOnline}>
              {running ? "Running crew…" : "▶ Run research crew"}
            </Button>
          </div>
        </form>
        {running ? <Spinner label="Researcher → Analyst running…" /> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {report ? (
          <pre className="pre">{report}</pre>
        ) : null}
      </Card>

      <Card>
        <h2 className="h2">Activity log</h2>
        {loading ? (
          <Spinner />
        ) : logs.length === 0 ? (
          <p className="muted">
            No agent activity yet. Run a simulation or generate content to see it here.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Action</th>
                <th>Input</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td><Badge>{l.agent_name}</Badge></td>
                  <td>{l.action}</td>
                  <td className="muted">{JSON.stringify(l.input).slice(0, 60)}</td>
                  <td className="muted">{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}