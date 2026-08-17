import { useEffect, useState } from "react"
import { Button, Card, Badge, Spinner, Field, Input } from "@/components/ui"
import { getHealth, runAgentCrew } from "@/lib/api"
import { useUser } from "@/hooks/useAuth"
import { listData } from "@/lib/localdata"
import type { AgentLog } from "@/lib/types"
import type { HealthInfo } from "@/lib/api"

const AGENT_ROLES = [
  { name: "Researcher", emoji: "🔎", crew: true, desc: "Finds trending products, topics, and market data." },
  { name: "Analyst", emoji: "📈", crew: true, desc: "Turns research into clear, actionable recommendations." },
  { name: "Content Creator", emoji: "✍️", crew: true, desc: "Writes platform-optimized scripts, posts, and reviews." },
  { name: "Listing Optimizer", emoji: "🛒", crew: true, desc: "Suggests Amazon listing improvements (read-only)." }
]

export function Agents() {
  const user = useUser()
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
      <header>
        <h1>AI Agent Team</h1>
        <p className="muted">
          A CrewAI-style team of specialized agents works on your behalf. They advise — they never
          act for you.
        </p>
      </header>

      <div className="grid-2">
        {AGENT_ROLES.map((a) => (
          <Card key={a.name}>
            <div className="row space-between">
              <h2 className="h2">
                {a.emoji} {a.name}
              </h2>
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
