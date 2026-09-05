import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card, Skeleton } from "@/components/ui"
import {
  getCommandCentreOverview,
  setCommandCentreKillSwitch,
  type CommandCentreGateStatus,
  type CommandCentreMode,
  type CommandCentreOverview
} from "@/lib/api"

/**
 * Command Centre (spec slice 4) — the surface for the enforcement layer.
 * One component, mounted as the "Command Centre" tab on the trading AND the
 * bandwidth suite details (the `stream` prop filters which rows load).
 *
 * Honesty contract:
 *   • every cell renders what the server observed — a "not-wired" / "not-decided"
 *     state is rendered as that state, never as an OK
 *   • toggling a kill switch POSTs to the same store the sidecar gate reads;
 *     the panel re-renders from the response + a fresh overview, so a kill
 *     shown on a card IS a kill the enforcement layer will act on
 *   • the global kill switch header dominates every site card
 */
export function CommandCentrePanel({ stream }: { stream: "trading" | "bandwidth" }) {
  const [overview, setOverview] = useState<CommandCentreOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getCommandCentreOverview(stream)
      if (!res.ok) throw new Error("overview reported not ok")
      setOverview(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "command centre failed")
    }
    setLoading(false)
  }, [stream])

  useEffect(() => { void refresh() }, [refresh])

  const toggleKill = useCallback(
    async (scope: string, kill: boolean) => {
      setError(null)
      try {
        await setCommandCentreKillSwitch(scope, kill)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "kill-switch update failed")
      }
    },
    [refresh]
  )

  const killed = overview?.killSwitch
  const globalKill = killed?.global === true

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          Command Centre <span className="muted small">· {stream}</span>
        </div>
        <div className="row gap" style={{ alignItems: "center" }}>
          <span className="muted small">Global kill switch</span>
          <button
            type="button"
            className="toggle"
            aria-label="global kill switch"
            aria-pressed={globalKill}
            onClick={() => toggleKill("global", !globalKill)}
          >
            <span className="toggle-knob" />
          </button>
          <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      ) : !overview ? (
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="60%" />
          <Skeleton width="85%" />
          <Skeleton width="45%" />
        </div>
      ) : (
        <>
          {globalKill && (
            <div style={{ fontSize: 11, color: "#ff6b6b", marginBottom: 8 }}>
              GLOBAL KILL ACTIVE — every site below is BLOCKED until the human rearms
            </div>
          )}
          {overview.sites.map((site) => (
            <SiteCard key={site.site} site={site} globalKill={globalKill} onToggleKill={toggleKill} />
          ))}
        </>
      )}
    </Card>
  )
}

const MODE_TONE: Record<CommandCentreMode, "danger" | "warn" | "accent" | "muted" | "success"> = {
  BLOCKED: "danger",
  HOLD: "warn",
  COPILOT: "accent",
  AUTOPILOT_DEMO: "muted",
  AUTOPILOT: "success"
}

const GATE_TONE: Record<CommandCentreGateStatus, "success" | "danger" | "warn" | "accent" | "muted"> = {
  pass: "success",
  block: "danger",
  restricted: "warn",
  "mechanism-on": "accent",
  "not-wired": "muted",
  "not-decided": "muted"
}

function SiteCard({
  site,
  globalKill,
  onToggleKill
}: {
  site: CommandCentreOverview["sites"][number]
  globalKill: boolean
  onToggleKill: (scope: string, kill: boolean) => void
}) {
  const siteKill = site.inputs.killSwitch === true
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{site.site}</span>
          <span className="muted small" style={{ marginLeft: 6 }}>{site.venue}</span>
          <Badge tone={MODE_TONE[site.mode]}>{site.mode}</Badge>
          <span className="muted small" style={{ marginLeft: 6 }}>{site.executionPower}</span>
        </div>
        <div className="row gap" style={{ alignItems: "center" }}>
          {site.metrics.source !== "observed" ? (
            <span className="muted small" title={site.metrics.note}>{site.metrics.source}</span>
          ) : (
            <span className="muted small" title={site.metrics.observedAt}>
              observed{site.metrics.stale ? " · stale" : ""}
            </span>
          )}
          <span className="muted small">kill</span>
          <button
            type="button"
            className="toggle"
            aria-label={`kill switch ${site.site}`}
            aria-pressed={siteKill}
            onClick={() => onToggleKill(site.site, !siteKill)}
          >
            <span className="toggle-knob" />
          </button>
          {globalKill && <span className="muted small">(global)</span>}
        </div>
      </div>

      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {site.reasons.slice(0, 4).map((r) => (
          <div key={r}>· {r}</div>
        ))}
      </div>

      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        <div>Opt-in: {site.inputs.optIn.status}</div>
        <div>Workability: {site.inputs.workability.value === null ? "not-wired" : site.inputs.workability.value.toFixed(3)}</div>
        <div>Deliberation: {typeof site.inputs.deliberation === "string" ? site.inputs.deliberation : "converged"}</div>
      </div>

      <div className="row gap" style={{ flexWrap: "wrap", marginTop: 6 }}>
        {site.gates.map((g) => (
          <span key={g.gate} title={`${g.gate}: ${g.note}`} style={{ cursor: "help", textTransform: "none" }}>
            <Badge tone={GATE_TONE[g.status]}>{g.gate}</Badge>
          </span>
        ))}
      </div>
    </div>
  )
}