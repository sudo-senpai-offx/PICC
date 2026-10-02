import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { getMinistrySettings, saveMinistrySettings } from "@/lib/ministrySettings"
import type { AutopilotMode } from "@/lib/ministrySettings"
import type { SuiteId } from "@/lib/suites"
import { Badge } from "@/components/ui"
import { fetchIntegrations } from "@/lib/integrations"
import type { IntegrationEntry } from "@/lib/integrations"
import { ReadOnlyRoom } from "@/terminal/routes/ReadOnlyRoom"
import { useReadOnlyView } from "./useReadOnlyView"
// WS-7 T14 / D11 (spec :187, :191): notification configuration lives in the
// GENERAL Settings room and is not ministry-gated. The component is the
// pre-existing `SignalNotificationsCard`, mounted here unmodified in behaviour
// - it already owns every notification route (`/notifications/status`,
// `/prefs`, `/test`, and the shared web-push hook behind `subscribe-push`).
//
// WHY THE EXISTING COMPONENT AND NOT A NEW ONE. A new form over the same
// routes would be a second route over one store, which gives that store two
// answers taken at two moments - the defect T8 declined to create for the
// ceremony store (recorded at readOnlyRoomCompletions.ts:132-133). The card is
// also still rendered on trading/dashboard and trading/autopilot, which T8
// declared as PRE-EXISTING affordances and explicitly did not remove
// (readOnlyRoomCompletions.ts:186-189); deleting it from there would be
// removing shipped product behaviour, which D27 prohibits a task doing
// silently. So the configuration is now REACHABLE in the room D11 names, and
// the pre-existing surfaces are left alone. That is the reading of D11 this
// task records: "lives in" is a placement requirement, not an exclusivity one.
import { SignalNotificationsCard } from "@/components/TradingSuite"

const VALID_SUITES = new Set<string>(["trading", "earnings", "intelligence"])

function statusBadge(state: IntegrationEntry["state"]) {
  const label = state === "connected" ? "Connected" : state === "degraded" ? "Degraded" : "Unconfigured"
  const tone = state === "connected" ? "success" : state === "degraded" ? "warn" : "muted"
  return <Badge tone={tone}>{label}</Badge>
}

export function SettingsRoom() {
  const { suiteId: raw } = useParams<{ suiteId: string }>()
  const suiteId = VALID_SUITES.has(raw ?? "") ? (raw as SuiteId) : null

  // WS-7 T10 (d1Order 13) — the read-only record. It reports the integration count
  // only when /api/integrations answered, and reports nothing when it did not:
  // "0 integrations" would read as a product with no data sources, which is a
  // different and false claim.
  const { view: readOnlyView } = useReadOnlyView("settings", suiteId === "earnings" || suiteId === "intelligence" ? suiteId : "trading")

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
      <ReadOnlyRoom view={readOnlyView} />

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
                  {/* WS-7 T18 / D17 — the two columns the "licensed and labeled"
                      obligation needs and this table lacked. `retrievalMode` is
                      HOW the source is reached (one of four modes D17:241
                      permits) and `licensedBasis` is why it is trusted. Rows
                      that predate D17 carry neither, and render an explicit "—"
                      rather than a blank that would read as an oversight. */}
                  <th>Retrieval Mode</th>
                  <th>Licensed Basis</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((i) => (
                  <tr key={i.id} data-integration={i.id}>
                    <td><strong>{i.name}</strong></td>
                    <td>{i.purpose}</td>
                    <td>{i.boundary.freeTier}</td>
                    <td>{i.boundary.rateLimit}</td>
                    <td>{i.boundary.keyRequired ? "Yes" : "No"}</td>
                    <td>
                      {statusBadge(i.state)}
                      {/* The named absence, so "Unconfigured" says WHICH setting
                          is missing rather than only that something is. T14
                          established the same rule for notifications. */}
                      {i.state === "unconfigured" && i.unconfiguredReason ? (
                        <span className="muted small" style={{ display: "block" }}>{i.unconfiguredReason}</span>
                      ) : null}
                      {i.state === "degraded" && i.configEvidence ? (
                        <span className="muted small" style={{ display: "block" }}>configured by {i.configEvidence} — never probed</span>
                      ) : null}
                    </td>
                    <td>{i.retrievalMode ?? "—"}</td>
                    <td>{i.licensedBasis ?? "—"}</td>
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

      {/* WS-7 T14 / D11 - the notifications section, NOT ministry-gated. It is
          the same component the trading dashboard and autopilot already render,
          so the operator has one configuration surface with one set of answers
          rather than a second form over the same routes. */}
      <div className="card" data-room="notifications">
        <SignalNotificationsCard />
      </div>
    </div>
  )
}
