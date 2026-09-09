import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { getMinistrySettings, saveMinistrySettings } from "@/lib/ministrySettings"
import type { AutopilotMode } from "@/lib/ministrySettings"
import type { SuiteId } from "@/lib/suites"

const VALID_SUITES = new Set<string>(["trading", "earnings", "intelligence"])

export function SettingsRoom() {
  const { suiteId: raw } = useParams<{ suiteId: string }>()
  const suiteId = VALID_SUITES.has(raw ?? "") ? (raw as SuiteId) : null

  const [mode, setMode] = useState<AutopilotMode>("auto")
  const [threshold, setThreshold] = useState(0.6)

  useEffect(() => {
    if (!suiteId) return
    const s = getMinistrySettings(suiteId)
    setMode(s.mode)
    setThreshold(s.confidenceThreshold)
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
    </div>
  )
}
