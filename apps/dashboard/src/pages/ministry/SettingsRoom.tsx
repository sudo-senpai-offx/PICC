import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { getMinistrySettings, saveMinistrySettings } from "@/lib/ministrySettings"
import type { AutopilotMode } from "@/lib/ministrySettings"
import type { SuiteId } from "@/lib/suites"
import { Badge } from "@/components/ui"
import { fetchIntegrations } from "@/lib/integrations"
import type { IntegrationEntry } from "@/lib/integrations"

const VALID_SUITES = new Set<string>(["trading", "earnings", "intelligence"])

function statusBadge(state: IntegrationEntry["state"]) {
  const label = state === "connected" ? "Connected" : state === "degraded" ? "Degraded" : "Unconfigured"
  const tone = state === "connected" ? "success" : state === "degraded" ? "warn" : "muted"
  return <Badge tone={tone}>{label}</Badge>
}

export function SettingsRoom() {
  const { suiteId: raw } = useParams<{ suiteId: string }>()
  const suiteId = VALID_SUITES.has(raw ?? "") ? (raw as SuiteId) : null

  const [mode, setMode] = useState<AutopilotMode>("auto")
  const [threshold, setThreshold] = useState(0.6)
  const [integrations, setIntegrations] = useState<IntegrationEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!suiteId) return
    const s = getMinistrySettings(suiteId)
    setMode(s.mode)
    setThreshold(s.confidenceThreshold)
  }, [suiteId])

  useEffect(() => {
    if (!suiteId) return
    let cancelled = false
    setLoading(true)
    fetchIntegrations(suiteId)
      .then((entries) => {
        if (!cancelled) setIntegrations(entries)
      })
      .catch(() => {
        if (!cancelled) setIntegrations([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [suiteId])

  if (!suiteId) {
    return (
      <div className="stack">
        <header data-room="settings">
          <h2>Settings</h2>
        </header>
        <p className="muted">Unknown ministry.</p>
      </div>
    )
  }

  const flipMode = () => {
    const next: AutopilotMode = mode === "auto" ? "copilot" : "auto"
    setMode(next)
    saveMinistrySettings(suiteId, { mode: next })
  }

  const setConfidence = (v: number) => {
    setThreshold(v)
    saveMinistrySettings(suiteId, { confidenceThreshold: v })
  }

  return (
    <div className="stack">
      <header data-room="settings">
        <h2>Settings</h2>
      </header>

      <div className="card">
        <label className="row" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={mode === "copilot"}
            onChange={flipMode}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Autopilot mode</strong>
            <span className="muted">
              {" "}
              — a local preference for this ministry, used by ministry features as they land.
            </span>
          </span>
        </label>
        <p className="muted small" style={{ margin: "4px 0 0 24px" }}>
          Turning copilot on does not enable the live autopilot service or override demo gates.
        </p>
      </div>

      <div className="card">
        <label>
          <strong>Confidence threshold</strong>
          <span className="muted"> — {threshold.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setConfidence(parseFloat(e.target.value))}
            style={{ display: "block", marginTop: 6 }}
          />
        </label>
        <p className="muted small" style={{ margin: "4px 0 0 0" }}>
          The stored threshold value used by ministry logic.
        </p>
      </div>

      <p className="muted small" style={{ margin: "8px 0 0 0" }}>
        Settings are stored locally on this machine per ministry.
      </p>

      <div className="card">
        <h3 className="h3">Integrations</h3>
        <p className="muted small" style={{ margin: "0 0 12px 0" }}>
          Read-only info acquisition honoring each source's free-tier boundaries.
        </p>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : integrations.length === 0 ? (
          <p className="muted">No integration data available</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>What It Does</th>
                  <th>Free Tier</th>
                  <th>Rate Limit</th>
                  <th>Key?</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.name}</strong></td>
                    <td>{i.purpose}</td>
                    <td>{i.boundary.freeTier}</td>
                    <td>{i.boundary.rateLimit}</td>
                    <td>{i.boundary.keyRequired ? "Yes" : "No"}</td>
                    <td>{statusBadge(i.state)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ margin: "12px 0 0 0" }}>
          New sources are added over time (PICC-as-a-country).
        </p>
      </div>
    </div>
  )
}
